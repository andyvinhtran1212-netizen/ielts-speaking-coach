"""services/mock_exam_service.py — 4-skill mock exam orchestration (Phase 1).

The sitting is the cross-skill coordinator. This service owns:

  - create_sitting   — open a sitting (window + cohort gate; one active per user)
  - advance_section  — ADMIN advances the shared exam clock to the next section
  - attach_attempt   — bind a domain attempt to the sitting (both directions)
  - submit_section   — collect one section (listening/reading/writing) for a sitting
  - record_speaking  — attach the (decoupled) speaking sessions
  - is_sealed        — the hook domain submit/review endpoints check

Student work stays canonical in its own domain table (reading_test_attempts /
listening_test_attempts / writing_essays / sessions). This service never
duplicates answers — it only binds ids and drives the status machine.

SEQUENTIAL model (2026-07-12, supersedes the all-at-once model from mig 150):
the three seated sections open ONE AT A TIME, gated by the admin —
Listening → (admin sees all submitted, opens Reading) → Reading → (admin opens
Writing) → Writing. Each section has its own SERVER-authoritative start
timestamp on the EXAM (one shared classroom clock, not one per student) and a
fixed duration (Listening = audio length + buffer; Reading/Writing = admin-set
minutes). There is no early manual submit — a section is collected only when
its own clock reaches zero (client auto-submit) or, as a stragglers safety
net, when the admin advances past it (`_force_collect_section`).

Speaking is decoupled from LRW: it may be taken before or after the seated flow,
anytime within the exam window. `_reconcile_terminal` flips the sitting to
`all_submitted` (and creates the review) once BOTH the LRW mạch and speaking are
in — regardless of order.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from database import supabase_admin

logger = logging.getLogger(__name__)

# The seated block now runs SEQUENTIALLY, admin-gated, in this fixed order.
# Speaking is decoupled (not part of this sequence).
_LRW_ORDER = ("listening", "reading", "writing")
_SUBMITTED_COL = {s: f"{s}_submitted_at" for s in _LRW_ORDER}
# LRW sections backed by a domain attempt (writing is native — no attempt row).
# (link column on the sitting, domain attempt table, exam's configured-test column)
_SECTION_ATTEMPT = {
    "listening": ("listening_attempt_id", "listening_test_attempts", "listening_test_id"),
    "reading":   ("reading_attempt_id",   "reading_test_attempts",   "reading_test_id"),
}
# Default fallback if a listening test's audio duration is unknown (should not
# happen for a published test, but a mock must never divide by/anchor on None).
_DEFAULT_LISTENING_MINUTES = 30
_LISTENING_BUFFER_SECONDS = 120
# No early manual submit: submit_section rejects unless the section's shared
# clock has (about) run out. A few seconds of grace absorbs the gap between
# the client's local tick hitting 0 and the request actually landing.
_EARLY_SUBMIT_GRACE_SECONDS = 5
# Student runners poll the shared collection marker every 8 seconds, then may
# need up to 3 seconds to drain an embedded player's debounced requests.  Keep
# the server-side sweep behind a larger bounded window; acknowledged clients
# release the wait immediately, while closed/offline tabs cannot block a room
# forever.
_COLLECTION_FLUSH_GRACE_SECONDS = 15.0
_COLLECTION_FLUSH_POLL_SECONDS = 0.25
# Statuses from which _reconcile_terminal may still advance the sitting.
# Once an admin has claimed (under_review) or beyond, we never downgrade.
_PRE_REVIEW = {
    "registered", "lrw_in_progress", "lrw_submitted", "speaking_pending",
}


# ── Errors ────────────────────────────────────────────────────────────


class MockExamError(Exception):
    """Base for mock-exam orchestration errors."""


class NotFoundError(MockExamError):
    """Exam or sitting not found."""


class WindowClosedError(MockExamError):
    """Attempt to enter outside the exam's open_from/open_until window."""


class NotEligibleError(MockExamError):
    """User is not in the exam's restricted cohort."""


class SittingConflictError(MockExamError):
    """State-machine transition not allowed from the current status."""


# ── Helpers ───────────────────────────────────────────────────────────


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _parse_ts(value) -> Optional[datetime]:
    """Parse a Supabase ISO timestamp (may end in 'Z') to aware UTC."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _retake_assigned_exam_ids(user_id: str) -> set:
    """Exam ids this user is assigned to for retake AND is currently inside the
    window for (locked out before open_from / after open_until)."""
    rows = supabase_admin.table("mock_exam_assignments").select(
        "exam_id, open_from, open_until",
    ).eq("user_id", str(user_id)).execute().data or []
    now = _now()
    out = set()
    for a in rows:
        of, ou = _parse_ts(a.get("open_from")), _parse_ts(a.get("open_until"))
        if of and now < of:
            continue
        if ou and now > ou:
            continue
        out.add(a["exam_id"])
    return out


def list_open_exams(user_id: str) -> list[dict]:
    """Exams the student can enter right now — powers the full-test entry page
    (card metadata only, no content). Sequential: published + live-open +
    cohort-eligible. Retake: published + the student has an assignment inside
    its window (no cohort / no shared is_open)."""
    resp = supabase_admin.table("mock_exams").select(
        "id, code, title, total_minutes, cohort_id, review_sla_days, "
        "exam_mode, is_open, active_section",
    ).eq("status", "published").execute()
    assigned = _retake_assigned_exam_ids(user_id)
    # C3 — the student may only be seated at one exam at a time. Report WHICH
    # sitting is holding them rather than letting them press a button that will
    # only 409: the entry page can then send them back to the exam they are
    # actually in the middle of.
    live = live_sitting_for_user(user_id)
    out = []
    mine_exam_id = str(live["mock_exam_id"]) if live else None
    for e in (resp.data or []):
        # A student's OWN in-progress exam always stays listed, even once it
        # fails the new-entry gates. The admin closing the live toggle to block
        # late entrants (or a retake window lapsing) would otherwise drop the
        # exam from the list BEFORE my_sitting_id could be attached — so the
        # entry page showed the empty state instead of the resume link it
        # promises, to precisely the student who is mid-exam
        # (Codex review, PR #841). Only ever relaxes the gate for the one
        # person who already has a sitting on that exam.
        is_mine = mine_exam_id is not None and str(e["id"]) == mine_exam_id
        if is_retake(e):
            if e["id"] not in assigned and not is_mine:
                continue
        elif not is_mine:
            if not e.get("is_open"):
                continue
            # A finished exam has no section left to open, so entering it can
            # only produce a dead `registered` row that holds the student's one
            # live seat. Belt and braces with the same gate in create_sitting:
            # this stops the button from ever being shown.
            if (e.get("active_section") or "not_started") == "done":
                continue
            if e.get("cohort_id") and not _user_in_cohort(user_id, e["cohort_id"]):
                continue
        row = {k: v for k, v in e.items()
               if k not in ("cohort_id", "is_open", "active_section")}
        blocked = bool(live and str(live.get("mock_exam_id")) != str(e["id"]))
        row["blocked_by_sitting_id"] = str(live["id"]) if blocked else None
        # Their own in-progress sitting on THIS exam — the entry page turns the
        # button into "tiếp tục" instead of "bắt đầu".
        row["my_sitting_id"] = (
            str(live["id"]) if live and str(live.get("mock_exam_id")) == str(e["id"]) else None
        )
        out.append(row)
    return out


def list_my_sittings(user_id: str) -> list[dict]:
    """The caller's own mock sittings — powers the student home: what to resume
    and which results are RELEASED. A released sitting carries its overall band +
    released_at (from the review) so the home can show a result tile without a
    second fetch. Voided sittings are excluded; newest first."""
    rows = (supabase_admin.table("mock_exam_sittings")
            .select("id, mock_exam_id, status, created_at")
            .eq("user_id", str(user_id)).neq("status", "void")
            .order("created_at", desc=True).execute()).data or []
    if not rows:
        return []
    exam_ids = list({r["mock_exam_id"] for r in rows if r.get("mock_exam_id")})
    exams: dict = {}
    if exam_ids:
        er = (supabase_admin.table("mock_exams").select("id, code, title")
              .in_("id", exam_ids).execute()).data or []
        exams = {e["id"]: e for e in er}
    released_ids = [r["id"] for r in rows if r.get("status") == "released"]
    reviews: dict = {}
    if released_ids:
        rv = (supabase_admin.table("mock_exam_reviews")
              .select("sitting_id, final_bands, released_at")
              .in_("sitting_id", released_ids).execute()).data or []
        reviews = {x["sitting_id"]: x for x in rv}
    out = []
    for r in rows:
        ex = exams.get(r.get("mock_exam_id"), {})
        rvw = reviews.get(r["id"], {})
        fb = rvw.get("final_bands") or {}
        released = r.get("status") == "released"
        out.append({
            "sitting_id":   r["id"],
            "mock_exam_id": r.get("mock_exam_id"),
            "code":         ex.get("code"),
            "title":        ex.get("title"),
            "status":       r.get("status"),
            "released":     released,
            "overall":      fb.get("overall") if released else None,
            "released_at":  rvw.get("released_at"),
        })
    return out


def get_published_exam(code: str) -> Optional[dict]:
    resp = supabase_admin.table("mock_exams").select("*").eq(
        "code", code,
    ).eq("status", "published").limit(1).execute()
    return resp.data[0] if resp.data else None


def get_published_exam_by_id(exam_id: str) -> Optional[dict]:
    resp = supabase_admin.table("mock_exams").select("*").eq(
        "id", str(exam_id),
    ).limit(1).execute()
    return resp.data[0] if resp.data else None


def get_exam_content_for_sitting(sitting: dict) -> dict:
    """Resolve the content refs the frontend runner needs to launch each section.

    Reading pages link by the reading test CODE (reading_tests.test_id), listening
    by the listening test UUID — this bridges the FK ids stored on mock_exams to
    the values the existing runner pages expect in their URL. Writing returns the
    two prompt texts for the native writing step.
    """
    exam = get_published_exam_by_id(sitting["mock_exam_id"]) or {}
    out: dict = {
        "listening_test_id": exam.get("listening_test_id"),
        "reading_test_code": None,
        "writing_task1": None,
        "writing_task2": None,
        "speaking_topic_set": exam.get("speaking_topic_set") or {},
        "total_minutes": exam.get("total_minutes") or 150,
        "active_section": exam.get("active_section") or "not_started",
        "reading_minutes": exam.get("reading_minutes") or 60,
        "writing_minutes": exam.get("writing_minutes") or 60,
    }
    if exam.get("reading_test_id"):
        r = supabase_admin.table("reading_tests").select("test_id, title").eq(
            "id", str(exam["reading_test_id"]),
        ).limit(1).execute()
        if r.data:
            out["reading_test_code"] = r.data[0].get("test_id")
            out["reading_title"] = r.data[0].get("title")
    for slot, col in (("writing_task1", "writing_task1_prompt_id"),
                      ("writing_task2", "writing_task2_prompt_id")):
        if exam.get(col):
            p = supabase_admin.table("writing_prompts").select(
                "id, task_type, prompt_text, title, prompt_image_url",
            ).eq("id", str(exam[col])).limit(1).execute()
            if p.data:
                out[slot] = p.data[0]
    return out


def get_sitting(sitting_id: UUID | str) -> Optional[dict]:
    resp = supabase_admin.table("mock_exam_sittings").select("*").eq(
        "id", str(sitting_id),
    ).limit(1).execute()
    return resp.data[0] if resp.data else None


def sittings_in_exam(exam_id: UUID | str, sitting_ids) -> set:
    """The subset of `sitting_ids` that really belongs to `exam_id`.

    A per-exam roster action must not reach into another exam's work — the
    exam_id in the path is the admin's stated scope, so a sitting from outside it
    arrived via a stale tab or a hand-made call, not the roster. writing/bulk-grade
    has always enforced this per row; the bulk claim/band/release routes take the
    set in ONE query instead of one per id.
    """
    ids = [str(s) for s in sitting_ids]
    if not ids:
        return set()
    resp = supabase_admin.table("mock_exam_sittings").select("id").eq(
        "mock_exam_id", str(exam_id),
    ).in_("id", ids).execute()
    return {str(r["id"]) for r in (resp.data or [])}


def is_sealed(sitting_id: UUID | str) -> bool:
    """The hook domain endpoints call: is this sitting still withholding scores?

    A missing sitting is treated as NOT sealed (fail-open would be wrong for a
    real sitting, but a missing row means "not part of a mock" — the caller only
    reaches here when attempt.sitting_id is set, and a dangling id shouldn't
    hard-block a normal review path). Released/void sittings are not sealed.
    """
    sitting = get_sitting(sitting_id)
    if not sitting:
        return False
    return bool(sitting.get("sealed"))


# C3 — statuses that mean "this student is ACTIVELY SEATED right now".
# Deliberately NOT speaking_pending: that state waits on a viva appointment and
# can legitimately last days, so blocking on it would lock a student out of an
# unrelated exam for a week over something that is not a conflict at all.
_LIVE_STATUSES = ("registered", "lrw_in_progress")


def live_sitting_for_user(user_id: str, exclude_exam_id=None) -> Optional[dict]:
    """The student's currently-seated sitting, if any (optionally ignoring one
    exam's own sitting).

    Fail-open on a lookup error: this gates ENTRY to an exam, and a transient
    DB blip must not stop a legitimately-eligible student from sitting down.
    The partial unique index (mig 162) is the hard backstop underneath.
    """
    try:
        rows = supabase_admin.table("mock_exam_sittings").select(
            "id, mock_exam_id",
        ).eq("user_id", str(user_id)).in_(
            "status", list(_LIVE_STATUSES),
        ).execute().data or []
    except Exception:  # noqa: BLE001
        logger.warning("[mock-exam] live-sitting lookup failed for user=%s", user_id)
        return None
    for r in rows:
        if exclude_exam_id and str(r.get("mock_exam_id")) == str(exclude_exam_id):
            continue
        return r
    return None


# EVERY column on mock_exam_sittings that can carry, or point at, student work.
# ONE list, because this is the input to an automatic VOID: anything missing
# here is a paper that gets destroyed. The first version of this check keyed on
# `{section}_started_at` alone and was blind for the mode it targets —
# start_section() is RETAKE-ONLY, so a SEQUENTIAL student's section clock lives
# on the EXAM row and their sitting stays `registered` with every one of those
# columns null until they submit. A student mid-exam with a bound attempt and 30
# answers matched "no work" (Codex adversarial review, 2026-07-26).
_WORK_BEARING_COLS = (
    "lrw_started_at",
    "listening_started_at", "reading_started_at", "writing_started_at",
    "listening_submitted_at", "reading_submitted_at", "writing_submitted_at",
    # The real evidence for a SEQUENTIAL student: the runner binds the domain
    # attempt as soon as the section opens, long before anything is submitted.
    "listening_attempt_id", "reading_attempt_id",
    "essay_task1_id", "essay_task2_id",
    "writing_submission",          # the autosaved draft (mig 149)
    "speaking_completed_at", "speaking_session_ids",
)

# The subset the compare-and-set can predicate on. `speaking_session_ids` is
# JSONB NOT NULL DEFAULT '[]' (mig 146), so `.is_(…, "null")` matches NOTHING
# and would silently disable the entire statement — the guard would look
# stricter and do less. Both writers of that column stamp
# speaking_completed_at in the same update (record_speaking / the admin path),
# so the nullable stamp is an exact proxy for it.
_WORK_BEARING_NULLABLE_COLS = tuple(
    c for c in _WORK_BEARING_COLS if c != "speaking_session_ids"
)


def _is_abandoned(sitting: dict, exam: dict) -> bool:
    """A sitting that can never progress and holds NO work.

    Strict on purpose — this decides whether it is safe to cancel a row without
    an admin looking at it, so every clause has to be about the ABSENCE of work:

      · status still `registered` — never progressed
      · every work-bearing column empty (see _WORK_BEARING_COLS: stamps AND the
        attempt/essay/draft pointers, because for a sequential sitting the
        pointers are the only signal there is)
      · the exam itself is over: a SEQUENTIAL exam walked to `done`

    Deliberately NOT keyed on `is_open`: an invigilator closes the toggle
    mid-session to block late entrants, and a student waiting in the waiting
    room for the next section is registered with nothing started — voiding them
    there would cancel someone who is sitting in the room. `active_section ==
    'done'` is the only unambiguous "this exam is finished" signal.

    Retake is excluded: the reaper already force-collects a retake sitting once
    its window closes, so those retire themselves.
    """
    if sitting.get("status") != "registered":
        return False
    if is_retake(exam) or (exam.get("active_section") or "not_started") != "done":
        return False
    return not any(sitting.get(c) for c in _WORK_BEARING_COLS)


def _retire_abandoned_sitting(sitting: dict, exam: dict) -> bool:
    """Cancel an abandoned sitting so it stops holding the student's ONE live
    seat. Returns True if this call is the one that retired it.

    WHY THIS EXISTS. Mig 162 (C3) enforces one live sitting per student across
    ALL exams via a partial unique index on status IN
    ('registered','lrw_in_progress'). That turned a previously-harmless leak
    into a lockout: a student who was rostered onto an exam, never opened it,
    and whose exam then finished keeps a `registered` row FOREVER — nothing
    collects it (the advance sweep stamps sections, the reaper only handles
    retake), and from then on every future exam answers "Bạn đang có một bài
    thi chưa hoàn thành. Hãy hoàn thành bài đó trước." — an instruction that
    cannot be followed, because the exam it names ended weeks ago.

    Found in production 2026-07-26: two students blocked from a retake by empty
    `registered` rows on an exam that reached `done` on 2026-07-12.

    Relaxing the Python gate alone would not work — the unique index is the hard
    constraint, so the stale row has to actually stop being `registered`.
    """
    if not _is_abandoned(sitting, exam):
        return False
    now = _now_iso()
    audit = {
        **(sitting.get("integrity") or {}),
        "void_reason": "Không tham gia — kỳ thi đã kết thúc (hệ thống tự dọn).",
        "voided_by":   "system",
        "voided_at":   now,
    }
    # COMPARE-AND-SET on every "no work" column, not just on the id. The read
    # above and this write are not atomic, and the one thing that must never
    # happen is cancelling a paper someone is sitting: if any clock started in
    # between, the predicate no longer matches and this is a no-op.
    q = supabase_admin.table("mock_exam_sittings").update({
        "status": "void", "integrity": audit,
    }).eq("id", str(sitting["id"])).eq("status", "registered")
    for col in _WORK_BEARING_NULLABLE_COLS:
        # SAME list as the check above (minus the one column that is never
        # NULL — see the constant). Predicating on a narrower set than
        # _is_abandoned reads would leave the write able to land on a row the
        # check would have spared — the guard has to be enforced by the
        # statement, not only by the branch that leads to it.
        q = q.is_(col, "null")
    try:
        won = q.execute()
    except Exception:  # noqa: BLE001 — cleanup must never break the caller
        logger.exception("[mock-exam] retire failed sitting=%s", sitting["id"])
        return False
    if not won.data:
        return False
    logger.info(
        "[mock-exam] sitting=%s retired — registered with no work on exam=%s "
        "which already finished; it was holding the student's live seat",
        sitting["id"], sitting.get("mock_exam_id"),
    )
    return True


def retire_abandoned_sittings() -> dict:
    """Platform sweep for the above. Cheap: one indexed status filter, then the
    exam rows the survivors point at. Returns {"retired": n}."""
    try:
        rows = _paged(
            lambda: supabase_admin.table("mock_exam_sittings").select("*")
            .eq("status", "registered").order("id")
        )
    except Exception:  # noqa: BLE001
        logger.exception("[mock-exam] abandoned-sitting lookup failed")
        return {"retired": 0}
    exams: dict = {}
    retired = 0
    for row in rows:
        eid = str(row.get("mock_exam_id") or "")
        if not eid:
            continue
        if eid not in exams:
            exams[eid] = get_published_exam_by_id(eid) or {}
        if _retire_abandoned_sitting(row, exams[eid]):
            retired += 1
    if retired:
        logger.info("[mock-exam] retired %d abandoned sitting(s)", retired)
    return {"retired": retired}


def _user_in_cohort(user_id: str, cohort_id: str) -> bool:
    from services.class_membership_service import active_cohort_ids_for_student

    students = (supabase_admin.table("students").select("id, cohort_id")
                .eq("user_id", str(user_id)).limit(1).execute().data) or []
    if not students:
        return False
    return str(cohort_id) in active_cohort_ids_for_student(
        supabase_admin, students[0])


def _assert_window_open(exam: dict) -> None:
    now = _now()
    open_from = _parse_ts(exam.get("open_from"))
    open_until = _parse_ts(exam.get("open_until"))
    if open_from and now < open_from:
        raise WindowClosedError("Kỳ thi chưa mở.")
    if open_until and now > open_until:
        raise WindowClosedError("Kỳ thi đã đóng.")


def _assert_owner(sitting: dict, user_id: str) -> None:
    if str(sitting.get("user_id")) != str(user_id):
        raise PermissionError("Sitting không thuộc về người dùng này.")


def _assert_prior_section_submitted(sitting: dict, section: str) -> None:
    """Raise unless `section`'s linked domain attempt exists and is submitted.

    Guards the advance transition against fabricating a submission from
    navigation alone (a student calling the next section's start endpoint
    without having actually submitted the prior section)."""
    link_col, table, _ = _SECTION_ATTEMPT.get(section, (None, None, None))
    if not link_col:
        return  # writing has no attempt
    attempt_id = sitting.get(link_col)
    if not attempt_id:
        raise SittingConflictError(
            f"Chưa thể chuyển tiếp: phần {section} chưa được nộp."
        )
    r = supabase_admin.table(table).select("status").eq(
        "id", str(attempt_id),
    ).limit(1).execute()
    if not r.data or r.data[0].get("status") != "submitted":
        raise SittingConflictError(
            f"Chưa thể chuyển tiếp: phần {section} chưa nộp bài."
        )


def _configured_sections(exam: dict) -> list[str]:
    """The seated sequence this exam actually has content for, in order.

    Listening/Reading are skipped if the exam has no test configured for them
    (an LRW-only exam might be reading+writing only, etc.). Writing is always
    part of the sequence — even with no prompts configured, the admin still
    opens a Writing step (the runner will just show "không có đề")."""
    seq = []
    if exam.get("listening_test_id"):
        seq.append("listening")
    if exam.get("reading_test_id"):
        seq.append("reading")
    seq.append("writing")
    return seq


def _listening_audio_duration_seconds(test_id) -> Optional[int]:
    if not test_id:
        return None
    r = supabase_admin.table("listening_tests").select(
        "full_audio_duration_seconds",
    ).eq("id", str(test_id)).limit(1).execute()
    if r.data:
        return r.data[0].get("full_audio_duration_seconds")
    return None


def section_duration_seconds(exam: dict, section: str) -> Optional[int]:
    """Public wrapper: full length of a seated section, None for not_started/done.

    The student endpoint returns this alongside time_left so a resuming runner
    can derive ELAPSED and seek the audio to where the room already is.
    """
    if section not in _LRW_ORDER:
        return None
    return _section_duration_seconds(exam, section)


def _section_duration_seconds(exam: dict, section: str) -> int:
    """Fixed duration for one seated section — the shared classroom clock."""
    if section == "listening":
        audio = _listening_audio_duration_seconds(exam.get("listening_test_id"))
        base = audio if audio else _DEFAULT_LISTENING_MINUTES * 60
        return int(base) + _LISTENING_BUFFER_SECONDS
    if section == "reading":
        return int(exam.get("reading_minutes") or 60) * 60
    if section == "writing":
        return int(exam.get("writing_minutes") or 60) * 60
    return 0


def section_time_remaining_seconds(exam: dict, section: str) -> Optional[int]:
    """Seconds left in `section`'s shared countdown, from the SERVER start
    stamped on the exam. None if that section hasn't been opened yet."""
    if section not in _LRW_ORDER:
        return None
    started = _parse_ts(exam.get(f"{section}_started_at"))
    if not started:
        return None
    duration = _section_duration_seconds(exam, section)
    elapsed = (_now() - started).total_seconds()
    return max(0, int(duration - elapsed))


# ── Retake mode (per-student, skill-scoped, self-timed) ────────────────


def is_retake(exam: Optional[dict]) -> bool:
    return (exam or {}).get("exam_mode") == "retake"


def _sitting_sections(sitting: dict, exam: dict) -> list[str]:
    """The sections THIS sitting must complete. Retake → the sitting's snapshot
    of assigned_skills (order-stable by _LRW_ORDER); sequential → the exam's
    configured sections."""
    if is_retake(exam):
        assigned = set(sitting.get("assigned_skills") or [])
        return [s for s in _LRW_ORDER if s in assigned]
    return _configured_sections(exam)


def retake_time_remaining_seconds(sitting: dict, exam: dict, section: str) -> Optional[int]:
    """Seconds left in a RETAKE section's countdown — clocked PER SITTING (each
    student times independently). None until the student starts the section."""
    if section not in _LRW_ORDER:
        return None
    started = _parse_ts(sitting.get(f"{section}_started_at"))
    if not started:
        return None
    duration = _section_duration_seconds(exam, section)
    elapsed = (_now() - started).total_seconds()
    return max(0, int(duration - elapsed))


def retake_active_section(sitting: dict, exam: dict) -> tuple[str, Optional[int]]:
    """(active_section, time_left) for a retake sitting, computed per-student.
    A started-but-not-submitted section is the active one (its clock runs); if
    none is in progress the student is at the section MENU ('not_started'); once
    every assigned section is submitted → 'done'."""
    sections = _sitting_sections(sitting, exam)
    for s in sections:
        if sitting.get(f"{s}_started_at") and not sitting.get(_SUBMITTED_COL[s]):
            return s, retake_time_remaining_seconds(sitting, exam, s)
    if sections and all(sitting.get(_SUBMITTED_COL[s]) for s in sections):
        return "done", None
    return "not_started", None


def _get_assignment(exam_id: str, user_id: str) -> Optional[dict]:
    rows = supabase_admin.table("mock_exam_assignments").select("*").eq(
        "exam_id", str(exam_id),
    ).eq("user_id", str(user_id)).limit(1).execute().data or []
    return rows[0] if rows else None


def _assert_retake_window_open(assignment: dict) -> None:
    """The per-student availability window. Raises WindowClosedError outside it."""
    now = _now()
    of = _parse_ts(assignment.get("open_from"))
    ou = _parse_ts(assignment.get("open_until"))
    if of and now < of:
        raise WindowClosedError("Chưa đến giờ làm bài test lại.")
    if ou and now > ou:
        raise WindowClosedError("Đã quá giờ làm bài test lại.")


# ── Lifecycle ─────────────────────────────────────────────────────────


def create_sitting(user_id: str, code: str) -> dict:
    """Open (or resume) a sitting for `user_id` on the exam identified by `code`.

    Gates: exam must be published, inside its window, and — if the exam is
    cohort-restricted — the user must be a member. Idempotent: an existing
    non-terminal sitting (status not in released/void) is returned as-is, so a
    reload or double-click doesn't create a second sitting. The
    uq_mock_sitting_active partial index (mig 146) is the DB backstop.
    """
    exam = get_published_exam(code)
    if not exam:
        raise NotFoundError(f"Không tìm thấy kỳ thi đã publish với mã {code!r}.")

    # RESUME FIRST: return an existing non-terminal sitting before applying the
    # entry gates. A mid-exam student who refreshes after the admin CLOSED the
    # live gate (to block late entrants) must not be locked out of their own
    # in-progress sitting.
    existing = supabase_admin.table("mock_exam_sittings").select("*").eq(
        "mock_exam_id", exam["id"],
    ).eq("user_id", str(user_id)).not_.in_(
        "status", ["released", "void"],
    ).limit(1).execute()
    if existing.data:
        # SAY SO. The runner counts a "resume" as an integrity signal, and it
        # was inferring newness from mutable sitting fields: a reload before the
        # first section is collected looks exactly like a fresh 'registered' row
        # with nothing submitted, while a genuinely new arrival during a section
        # PAUSE is born with a submitted stamp and looked like a resume
        # (Codex review, PR #849). Only this function knows which happened.
        return {**existing.data[0], "created": False}

    # NEW sitting only: apply the entry gates.
    #
    # C3 — one live sitting per student, across ALL exams. A student in two
    # cohorts could see (and open) two exams at once; the pre-existing unique
    # index is per (exam, user) and never stopped that. Checked AFTER the resume
    # branch above, so this can never block someone from their own exam in
    # progress — only from starting a second one on top of it.
    other = live_sitting_for_user(user_id, exclude_exam_id=exam["id"])
    if other:
        # ...unless the seat is being held by a row that can never progress. A
        # student rostered onto an exam they never opened keeps a `registered`
        # sitting after that exam finishes, and nothing collects it — so the
        # message below would tell them to go and finish an exam that ended
        # weeks ago. Retire it here rather than making them wait for the next
        # janitor tick; strictly guarded, so a real paper is never touched.
        blocker = get_sitting(other["id"]) or {}
        blocking_exam = get_published_exam_by_id(str(other["mock_exam_id"])) or {}
        if not _retire_abandoned_sitting(blocker, blocking_exam):
            raise SittingConflictError(
                "Bạn đang có một bài thi chưa hoàn thành. Hãy hoàn thành bài đó "
                "trước khi bắt đầu kỳ thi khác."
            )

    new_row = {
        "mock_exam_id": exam["id"],
        "user_id":      str(user_id),
        "status":       "registered",
        "sealed":       True,
    }
    if is_retake(exam):
        # Retake: access via a per-student assignment within its window (NOT
        # cohort / NOT the shared is_open gate). Snapshot the assigned skills +
        # window onto the sitting so the runner/reconcile are skill-scoped and
        # each student times independently.
        assignment = _get_assignment(exam["id"], user_id)
        if not assignment:
            raise NotEligibleError("Bạn chưa được gán làm bài test lại này.")
        _assert_retake_window_open(assignment)
        new_row["assigned_skills"]   = assignment.get("skills") or []
        new_row["retake_open_from"]  = assignment.get("open_from")
        new_row["retake_open_until"] = assignment.get("open_until")
    else:
        # Sequential: live-open toggle (primary proctor gate) + optional window
        # + cohort membership.
        if not exam.get("is_open"):
            raise WindowClosedError("Kỳ thi chưa mở. Vui lòng chờ giám khảo mở kỳ.")
        if (exam.get("active_section") or "not_started") == "done":
            # AN EXAM THAT HAS ENDED CANNOT SEAT ANYONE. `is_open` is a manual
            # toggle the invigilator can simply forget after the final advance,
            # and it was the only gate here — so a student arriving late got a
            # `registered` sitting on an exam with no section left to open. That
            # row is a dead end that then holds their ONE live seat (mig 162)
            # and locks them out of every future exam until the janitor runs
            # (Codex adversarial review, 2026-07-26).
            raise WindowClosedError(
                "Kỳ thi đã kết thúc — không còn phần nào để làm."
            )
        _assert_window_open(exam)
        if exam.get("cohort_id") and not _user_in_cohort(user_id, exam["cohort_id"]):
            raise NotEligibleError("Bạn không thuộc lớp được mở kỳ thi này.")
        # ARRIVING DURING THE PAUSE. Papers for the active section are already
        # in; the invigilator has not opened the next one. Being born with that
        # section stamped submitted is what keeps this student in the waiting
        # room — otherwise their fresh row has no stamp, the runner's
        # isOpenSection test passes, and they are handed the collected paper
        # with the class clock running (Codex review, PR #843).
        paused_on = exam.get("collected_section")
        if paused_on and paused_on == (exam.get("active_section") or "not_started"):
            new_row[_SUBMITTED_COL[paused_on]] = _now_iso()

    try:
        inserted = supabase_admin.table("mock_exam_sittings").insert(new_row).execute()
    except Exception as exc:  # noqa: BLE001
        # uq_mock_sitting_one_live_per_user (mig 162) is the DB backstop for the
        # C3 check above — it also catches the race where two tabs pass the
        # check simultaneously. Translate it, don't leak a constraint name.
        if "uq_mock_sitting_one_live_per_user" in str(exc):
            raise SittingConflictError(
                "Bạn đang có một bài thi chưa hoàn thành. Hãy hoàn thành bài đó "
                "trước khi bắt đầu kỳ thi khác."
            )
        raise
    if not inserted.data:
        raise MockExamError(f"Không tạo được sitting cho exam={code}.")
    row = inserted.data[0]

    # RE-READ THE PAUSE MARKER AFTER THE INSERT. The check above ran against an
    # exam row read BEFORE the insert, while /collect sets `collected_section`
    # and sweeps the sittings as separate queries. A student who started opening
    # the exam before the marker was set but whose row landed after the sweep is
    # therefore neither swept NOR born submitted — and the runner hands them the
    # section the room already turned in (Codex review, PR #843).
    #
    # There is no cross-table transaction through PostgREST, so this closes the
    # window from the other end: whatever the marker says NOW is what the
    # freshly-inserted row is made to agree with.
    if not is_retake(exam):
        fresh = get_published_exam_by_id(exam["id"]) or {}
        paused_now = fresh.get("collected_section")
        if (paused_now
                and paused_now == (fresh.get("active_section") or "not_started")
                and not row.get(_SUBMITTED_COL[paused_now])):
            stamped = supabase_admin.table("mock_exam_sittings").update({
                _SUBMITTED_COL[paused_now]: _now_iso(),
            }).eq("id", row["id"]).is_(
                _SUBMITTED_COL[paused_now], "null",
            ).execute()
            if stamped.data:
                logger.info(
                    "[mock-exam] sitting=%s born during the %s pause — stamped submitted",
                    row["id"], paused_now,
                )
                row = stamped.data[0]

    logger.info(
        "[mock-exam] created sitting=%s user=%s exam=%s", row["id"], user_id, code,
    )
    return {**row, "created": True}


def attach_attempt(
    sitting_id: str, user_id: str, section: str, attempt_id: str,
) -> dict:
    """Bind a validated domain attempt to the sitting (both directions).

    Only reading/listening (writing is the native step; speaking uses
    record_speaking). Before binding, VALIDATE — an authenticated student owns
    this endpoint, so we cannot trust the supplied attempt id:
      - the attempt row must exist,
      - it must belong to the sitting's owner (no attaching someone else's work),
      - it must be an attempt of the exam's CONFIGURED test for this section
        (no attaching an unrelated / easier test), and
      - the section must not already be bound to a DIFFERENT attempt (no swap
        after a retake).
    Then write the id onto the sitting (→ review console) and sitting_id back
    onto the attempt (→ the seal hook the submit/review endpoints check).
    """
    binding = _SECTION_ATTEMPT.get(section)
    if not binding:
        raise SittingConflictError(f"Section không gắn được attempt: {section!r}")
    link_col, domain_table, exam_test_col = binding

    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    _assert_owner(sitting, user_id)
    if sitting["status"] in ("released", "void"):
        raise SittingConflictError(f"Sitting đang ở trạng thái {sitting['status']!r}.")

    exam = get_published_exam_by_id(sitting["mock_exam_id"]) or {}
    if is_retake(exam):
        # Retake has no shared advance gate: the section must be assigned to this
        # student and already STARTED (its per-sitting clock running).
        if section not in _sitting_sections(sitting, exam):
            raise SittingConflictError(f"Bạn không được gán phần {section}.")
        if not sitting.get(f"{section}_started_at"):
            raise SittingConflictError(f"Phần {section} chưa bắt đầu.")
    # Sequential gate: a domain attempt can only be attached while the ADMIN has
    # this section open. Defense in depth — the runner UI only shows a section
    # once it's active, but the endpoint itself must not trust that.
    elif (exam.get("active_section") or "not_started") != section:
        raise SittingConflictError(
            f"Phần {section} chưa được giám thị mở — không thể nộp bài."
        )
    elif exam.get("collected_section") == section:
        # THE PAUSE DELIBERATELY LEAVES active_section ALONE, so the gate above
        # cannot see it. Without this, an attempt whose creation finished after
        # the sweep still attaches: _collect_section_for_sitting() has already
        # stamped the sitting and skipped grading (no attempt was bound yet),
        # later sweeps skip the now-submitted sitting, and that attempt is never
        # graded — an incomplete full-test result nobody is told about
        # (Codex review, PR #843).
        raise SittingConflictError(
            f"Phần {section} đã được thu bài — không nhận thêm bài làm."
        )

    # Same fact from the SITTING's side: this student's paper is already in.
    # Belt and braces, because collect stamps the sittings one by one and the
    # exam-level marker is cleared the moment the admin advances.
    if sitting.get(_SUBMITTED_COL.get(section) or ""):
        raise SittingConflictError(
            f"Phần {section} của bạn đã được thu — không nhận thêm bài làm."
        )

    r = supabase_admin.table(domain_table).select(
        "id, user_id, test_id, status",
    ).eq("id", str(attempt_id)).limit(1).execute()
    if not r.data:
        raise NotFoundError(f"Attempt {attempt_id} không tồn tại.")
    att = r.data[0]
    if str(att.get("user_id")) != str(sitting["user_id"]):
        raise PermissionError("Bài làm không thuộc về thí sinh của kỳ thi này.")

    expected_test = exam.get(exam_test_col)
    if expected_test and str(att.get("test_id")) != str(expected_test):
        raise SittingConflictError("Bài làm không khớp đề của kỳ thi này.")

    existing = sitting.get(link_col)
    if existing and str(existing) != str(attempt_id):
        # Allow REPLACING an unsubmitted prior attempt (resume after a reload
        # abandoned the first attempt and the runner minted a new one). Only a
        # SUBMITTED prior attempt is locked — no swap-to-a-better one after
        # finishing.
        prev = supabase_admin.table(domain_table).select(
            "status, answers",
        ).eq("id", str(existing)).limit(1).execute()
        if prev.data and prev.data[0].get("status") == "submitted":
            raise SittingConflictError(
                f"Phần {section} đã nộp — không thể thay bài làm khác."
            )
        # Never trade WORK for a blank page. The runner is supposed to resume an
        # open attempt, but if that ever fails and it mints an empty one instead,
        # re-binding here would hand the examiner the empty one and the answers
        # the student actually gave would be orphaned on the abandoned row.
        # Losing the swap is recoverable; losing the answers is not.
        if _attempt_has_answers(domain_table, existing) \
                and not _attempt_has_answers(domain_table, attempt_id):
            raise SittingConflictError(
                f"Phần {section} đã có bài làm — không thể thay bằng bài trống."
            )
        # else: fall through and re-bind to the fresh (resumed) attempt.

    supabase_admin.table("mock_exam_sittings").update({
        link_col: str(attempt_id),
    }).eq("id", str(sitting_id)).execute()
    supabase_admin.table(domain_table).update({
        "sitting_id": str(sitting_id),
    }).eq("id", str(attempt_id)).execute()
    logger.info(
        "[mock-exam] sitting=%s attach %s attempt=%s", sitting_id, section, attempt_id,
    )
    return get_sitting(sitting_id) or sitting


def _attempt_has_answers(domain_table: str, attempt_id) -> bool:
    """Does this domain attempt hold at least one non-empty answer?

    The two runners persist answers differently — Listening keeps a JSONB array
    on the attempt row, Reading keeps one row per question in
    reading_attempt_answers (mig 088) — so the check has to branch. Blank
    strings don't count: a row exists the moment a field is touched and cleared.

    Raises on a lookup failure rather than returning False. The caller uses this
    to decide whether a re-bind would ORPHAN existing work, so "I couldn't
    check" must not be answered with "there is nothing there" — that is the one
    wrong answer, and it fails in exactly the direction this guard exists to
    prevent (Codex review, PR #834).
    """
    if not attempt_id:
        return False
    try:
        if domain_table == "reading_test_attempts":
            rows = supabase_admin.table("reading_attempt_answers").select(
                "user_answer",
            ).eq("attempt_id", str(attempt_id)).execute().data or []
            return any(str(r.get("user_answer") or "").strip() for r in rows)
        rows = supabase_admin.table(domain_table).select("answers").eq(
            "id", str(attempt_id),
        ).limit(1).execute().data or []
        if not rows:
            return False
        return any(
            str(a.get("user_answer") or "").strip()
            for a in (rows[0].get("answers") or [])
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("[mock-exam] answer-presence check failed for %s", attempt_id)
        raise MockExamError(
            "Không kiểm tra được bài làm hiện có — tạm dừng để tránh mất bài."
        ) from exc


def _word_count(text: str) -> int:
    return len((text or "").split())


def submit_writing(
    sitting_id: str, user_id: str, task1_text: str, task2_text: str,
    *, finalize: bool = False,
) -> dict:
    """Store the two essay texts on the sitting (P1 native writing capture).

    `finalize=False` (autosave) writes the draft only. `finalize=True` writes
    the payload AND stamps writing_submitted_at IN THE SAME STATEMENT — see
    below for why that has to be one write. Sealed by construction: the text
    lives on the sitting (admin-only); the student sees no band until release.
    """
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    _assert_owner(sitting, user_id)
    # Only accept writing while the LRW block is live and Writing is the
    # currently-open section. Once finalised the text is final — a retry must
    # NOT overwrite the graded submission.
    if sitting["status"] != "lrw_in_progress" or sitting.get("writing_submitted_at"):
        raise SittingConflictError(
            "Không thể nộp/sửa Writing khi kỳ thi chưa mở hoặc đã nộp bài."
        )
    exam = get_published_exam_by_id(sitting["mock_exam_id"]) or {}
    if is_retake(exam):
        # Retake: Writing must be assigned + started (per-student), not gated on
        # a shared active_section.
        if "writing" not in _sitting_sections(sitting, exam):
            raise SittingConflictError("Bạn không được gán phần Writing.")
        if not sitting.get("writing_started_at"):
            raise SittingConflictError("Phần Writing chưa bắt đầu.")
    elif (exam.get("active_section") or "not_started") != "writing":
        raise SittingConflictError("Phần Writing chưa được giám thị mở.")
    elif exam.get("collected_section") == "writing" and not finalize:
        # THE PAUSE STOPS BACKGROUND AUTOSAVES, NOT THE STUDENT'S OWN SUBMIT.
        #
        # This guard used to reject both. But the FINAL submit is the request
        # carrying the newest text — everything typed since the last 15s
        # autosave — and the runner treats a 409 during the pause as "already
        # collected, we're done". So an admin pressing "Thu bài" while a student
        # was submitting silently dropped that text, and the sweep then promoted
        # the OLDER draft for grading: the guard meant to protect the paper was
        # the thing losing it (Codex adversarial review, 2026-07-26).
        #
        # Letting it through is safe because the write below is a
        # compare-and-set on writing_submitted_at being NULL. That stamp is
        # exactly what the sweep claims BEFORE _promote_writing_essays() reads
        # the payload, so a submit landing after the claim still cannot change
        # what was graded — and one landing before it saves work that would
        # otherwise be lost. The stamp, not the pause marker, is the real
        # boundary.
        raise SittingConflictError(
            "Phần Writing đã được thu bài — không nhận thêm bản nháp."
        )

    now = _now_iso()
    submission = {
        "task1": {"text": task1_text or "", "word_count": _word_count(task1_text),
                  "submitted_at": now},
        "task2": {"text": task2_text or "", "word_count": _word_count(task2_text),
                  "submitted_at": now},
    }
    # CONDITIONAL on the section still being open. The check above and this
    # write are not atomic, so an admin advance, the retake reaper, or another
    # tab could finalise Writing in between — and a late autosave would then
    # overwrite writing_submission AFTER _promote_writing_essays() had already
    # copied the older text, leaving the admin's word count disagreeing with the
    # essay actually graded (Codex review, PR #835).
    update: dict = {"writing_submission": submission}
    if finalize:
        # ONE STATEMENT, not two. Stamping writing_submitted_at separately left
        # a window in which an autosave from another tab — or an older request
        # the client no longer tracks — passed the null-timestamp predicate and
        # replaced the final payload BEFORE _promote_writing_essays() read it.
        # The student would then submit one essay and have a stale draft graded
        # (Codex review, PR #835).
        update[_SUBMITTED_COL["writing"]] = now
    resp = supabase_admin.table("mock_exam_sittings").update(update).eq(
        "id", str(sitting_id),
    ).is_("writing_submitted_at", "null").execute()
    if not resp.data:
        raise SittingConflictError(
            "Phần Writing vừa được thu — bản nháp gửi sau không được ghi đè."
        )
    logger.info("[mock-exam] sitting=%s writing captured", sitting_id)
    return resp.data[0] if resp.data else {**sitting, "writing_submission": submission}


def _promote_writing_essays(sitting_id: str) -> None:
    """Turn a submitted Writing section's raw JSON (writing_submission) into
    real writing_essays rows — the SAME rows grade.html/queue.html already
    manage — so the existing tier-pick → AI-grade → admin-review pipeline
    (built for regular Writing) works for mock essays too, instead of a
    separate bespoke display (2026-07-12).

    Rows are created with status='pending'. On the student-submit path the
    router then auto-starts AI grading (claim_mock_writing_grading), so a mock
    essay lands 'graded' and ready for admin review without a manual "Bắt đầu
    chấm" click; the server-side reaper/closed-tab path leaves them 'pending' for
    that button. The admin can also (re)grade via POST
    /admin/writing/essays/{id}/start-grading. Idempotent (skips a task whose
    essay id is already stamped) and never raises — a promotion failure must not
    block the section from being collected."""
    try:
        sitting = get_sitting(sitting_id)
        if not sitting:
            return
        submission = sitting.get("writing_submission") or {}
        if not submission:
            return
        exam = get_published_exam_by_id(sitting["mock_exam_id"]) or {}
        student_res = supabase_admin.table("students").select("id").eq(
            "user_id", str(sitting["user_id"]),
        ).limit(1).execute()
        if not student_res.data:
            logger.warning(
                "[mock-exam] promote-writing sitting=%s: no students row for user=%s",
                sitting_id, sitting["user_id"],
            )
            return
        student_id = student_res.data[0]["id"]

        from services import essay_service
        updates: dict = {}
        for task_key, prompt_col, link_col in (
            ("task1", "writing_task1_prompt_id", "essay_task1_id"),
            ("task2", "writing_task2_prompt_id", "essay_task2_id"),
        ):
            if sitting.get(link_col):
                continue  # already promoted
            d = submission.get(task_key) or {}
            text = (d.get("text") or "").strip()
            if not text:
                continue
            prompt_id = exam.get(prompt_col)
            if not prompt_id:
                continue
            prompt_res = supabase_admin.table("writing_prompts").select(
                "task_type, prompt_text, title, prompt_image_url, "
                "prompt_image_analysis, prompt_image_analysis_reviewed",
            ).eq("id", str(prompt_id)).limit(1).execute()
            if not prompt_res.data:
                continue
            prompt = prompt_res.data[0]
            # only a REVIEWED extraction is trustworthy as a grading anchor —
            # mirrors routers/writing_student.py's submit-time snapshot so mock
            # Task 1 essays get the same verified answer key as regular ones
            # (they have no writing_assignments row, so the grading-time
            # fallback lookup can't find facts for them otherwise).
            prompt_image_analysis = (
                prompt.get("prompt_image_analysis")
                if prompt.get("prompt_image_analysis_reviewed") else None
            )
            row_info = essay_service.create_essay_row_only(
                data={
                    "student_id":            student_id,
                    "task_type":             prompt["task_type"],
                    "prompt_text":           prompt["prompt_text"],
                    "prompt_image_url":      prompt.get("prompt_image_url"),
                    "prompt_image_analysis": prompt_image_analysis,
                    "essay_text":            d["text"],
                    "analysis_level":        3,
                    "status":                "pending",
                    # Stamp the reverse link so the grading queue can filter mock
                    # essays into their own tab (mig 148 column, mig 156 backfill).
                    "sitting_id":            str(sitting_id),
                },
                # Audit convention matches regular self-submit: the STUDENT's
                # own user_id, not the reviewing admin.
                admin_id=str(sitting["user_id"]),
            )
            updates[link_col] = row_info["essay_id"]

        if updates:
            supabase_admin.table("mock_exam_sittings").update(updates).eq(
                "id", str(sitting_id),
            ).execute()
            logger.info(
                "[mock-exam] sitting=%s promoted writing essays: %s", sitting_id, updates,
            )
    except Exception:  # noqa: BLE001
        logger.exception("[mock-exam] promote-writing failed sitting=%s", sitting_id)


def backfill_promote_writing(exam_id: str) -> dict:
    """Create the missing writing_essays for a mock exam's sittings whose Writing
    was collected but never promoted — e.g. a cohort that sat the exam BEFORE the
    promotion feature shipped (PR #720, 2026-07-12), so their `writing_submission`
    text was captured but no essay rows were ever created and there is nothing to
    grade.

    Idempotent: `_promote_writing_essays` skips a task whose essay id is already
    stamped, so re-running is safe. Completeness is checked PER TASK — a sitting
    with only ONE task promoted (a partial earlier run) still has its other
    submitted task backfilled, instead of being treated as done. Per-sitting
    outcome:
      - already   : every submitted-with-text task already has an essay
      - promoted  : a missing task's essay was created now
      - no_writing: neither task has non-empty text
      - failed    : a task with text still has no essay after promotion (e.g. no
                    students row for the user, or the prompt is missing)
    Does NOT grade — grading is the separate bulk-grade step (and costs Gemini)."""
    sittings = (supabase_admin.table("mock_exam_sittings")
                .select("id, essay_task1_id, essay_task2_id, writing_submission")
                .eq("mock_exam_id", str(exam_id)).neq("status", "void")
                .execute()).data or []
    out: dict = {"total": len(sittings), "already": [], "promoted": [],
                 "no_writing": [], "failed": []}

    def _has_text(sub, task):
        return bool(((sub.get(task) or {}).get("text") or "").strip())

    for s in sittings:
        sid = s["id"]
        sub = s.get("writing_submission") or {}
        text = {"task1": _has_text(sub, "task1"), "task2": _has_text(sub, "task2")}
        if not (text["task1"] or text["task2"]):
            out["no_writing"].append(sid)
            continue
        # A task needs promotion if it has text but no essay id yet (per-task).
        essay = {"task1": bool(s.get("essay_task1_id")), "task2": bool(s.get("essay_task2_id"))}
        needs = [t for t in ("task1", "task2") if text[t] and not essay[t]]
        if not needs:
            out["already"].append(sid)
            continue
        _promote_writing_essays(str(sid))          # idempotent, never raises
        after = get_sitting(sid) or {}
        essay_after = {"task1": bool(after.get("essay_task1_id")),
                       "task2": bool(after.get("essay_task2_id"))}
        still_missing = [t for t in needs if not essay_after[t]]
        (out["failed"] if still_missing else out["promoted"]).append(sid)

    logger.info("[mock-exam] backfill promote exam=%s → %s", exam_id,
                {k: len(v) if isinstance(v, list) else v for k, v in out.items()})
    return out


# Auto-grade config for promoted mock Writing essays. 'standard' = AI grade only
# (the human review happens in the mock-review console, never the instructor
# queue — so mock essays deliberately don't create an instructor_reviews row);
# level 3 mirrors what _promote_writing_essays gives create_essay_row_only.
_MOCK_WRITING_GRADING_TIER = "standard"
_MOCK_WRITING_ANALYSIS_LEVEL = 3

# IELTS word minimums. Below these a task's essay is "too short" and is NOT
# auto-graded — it's held 'pending' for the admin to decide in the Mock queue tab
# whether to grade it anyway or skip it. task_type 'task1_*' → task1 threshold.
_WRITING_MIN_WORDS = {"task1": 150, "task2": 250}


def _sitting_lr_skills(sitting: dict) -> set:
    """Which of Listening/Reading this sitting actually runs.

    Mirrors mock_review_workflow._required_skills' two branches without importing
    it (that module imports this one — the dependency only goes one way):
      · assigned_skills set  → a retake, banded on THAT student's subset
      · otherwise            → the exam's configured sections
    """
    assigned = sitting.get("assigned_skills") or []
    if assigned:
        return {s for s in ("listening", "reading") if s in assigned}
    exam = get_published_exam_by_id(sitting.get("mock_exam_id")) or {}
    configured = set(_configured_sections(exam))
    return {s for s in ("listening", "reading") if s in configured}


def lr_skill_states(sitting: dict) -> list:
    """Why a Listening/Reading skill has no band — for the student's TRF.

    The TRF lists only the skills carrying a band, so a bandless one VANISHED
    from the grid with no explanation: the student saw Reading and Writing and
    was left to guess what happened to Listening. This says it.

    The states are kept apart because they are different truths, and production
    proves they diverge — every stuck sitting here DID submit, on time, with a
    timestamp and 40 questions. Telling those students "không nhận được bài làm"
    would be a lie about their own exam:

      scored       — band exists; nothing to explain
      no_attempt   — no attempt row at all → genuinely never received
      no_answers   — submitted, but not one question answered → blank paper
      below_table  — answered some, scored too low for the published table
                     (e.g. 3/40): a real attempt, just no band to give

    Reads the persisted band_estimate (module-aware — General Training Reading
    has no Phase-1 table) rather than recomputing, same as _unconvertible_skills.

    Only the skills this sitting actually RUNS are reported. A writing-only
    retake, or a Reading+Writing exam (_configured_sections supports both), has
    no Listening — emitting it anyway would render "Không nhận được bài làm" for
    a skill the student was never set, which is the same falsehood
    writing_task_states already guards against (Codex review, PR #780).
    """
    lr = _sitting_lr_skills(sitting)
    out = []
    for skill, col, table in (
        ("listening", "listening_attempt_id", "listening_test_attempts"),
        ("reading",   "reading_attempt_id",   "reading_test_attempts"),
    ):
        if skill not in lr:
            continue
        aid = sitting.get(col)
        if not aid:
            out.append({"skill": skill, "state": "no_attempt",
                        "score": None, "max": None, "answered": None})
            continue
        rows = supabase_admin.table(table).select(
            "score, band_estimate, grading_details",
        ).eq("id", str(aid)).limit(1).execute().data
        if not rows:
            # The sitting points at an attempt that isn't there — broken data, not
            # a blank paper. "Never received" is the honest thing to say.
            out.append({"skill": skill, "state": "no_attempt",
                        "score": None, "max": None, "answered": None})
            continue
        r = rows[0]
        gd = r.get("grading_details") or []
        answered = sum(1 for q in gd if str(q.get("user_answer") or "").strip())
        if r.get("band_estimate") is not None:
            state = "scored"
        elif answered == 0:
            state = "no_answers"
        else:
            state = "below_table"
        out.append({
            "skill":    skill,
            "state":    state,
            "score":    r.get("score"),
            "max":      len(gd) or None,
            "answered": answered,
        })
    return out


def writing_task_states(sitting: dict, delivered: set) -> list:
    """Per-task Writing outcome for the student's TRF — one entry per task.

    Pure: `delivered` is the set the caller already computed (essay_service.
    delivered_essay_ids) and the word counts come off the sitting's own
    writing_submission — the same blob the admin roster reads. An earlier cut
    re-queried both and bought nothing but a second round-trip and a function
    that couldn't be tested without a database.

    The TRF used to surface a feedback link only for a DELIVERED essay and say
    nothing at all about a task that never got graded, so a student whose Task 2
    was too short just saw one link and no explanation of the gap. This reports
    what actually happened to each task so the page can say it out loud.

    States, straight off the row (never inferred from the band):
      delivered  — graded + reviewed + released → feedback is readable
      too_short  — below the IELTS minimum, so it was never auto-graded
      not_graded — has an essay, but no feedback the student can open
      missing    — the student wrote nothing for this task

    `too_short` is reported from word_count vs the minimum, NOT from the admin's
    retest decision: the word count is a fact on the row, while a retest flag is
    a judgement the admin may simply not have recorded. The page must be able to
    explain the gap either way.
    """
    # A retake may be assigned Listening/Reading only — assigned_skills is set
    # ONLY when the sitting is created from a retake assignment, so a non-empty
    # list without 'writing' means this student was never set Writing. The TRF
    # renders every non-delivered task as a gap, so returning tasks here would
    # tell them they failed to submit work that was never asked for (Codex
    # review, PR #777). Read off the sitting — mirrors _required_skills' retake
    # branch without paying its two queries.
    assigned = sitting.get("assigned_skills") or []
    if assigned and "writing" not in assigned:
        return []

    ws = sitting.get("writing_submission") or {}
    ids = {"task1": sitting.get("essay_task1_id"), "task2": sitting.get("essay_task2_id")}

    out = []
    for task in ("task1", "task2"):
        eid = ids[task]
        blob = ws.get(task) or {}
        wc = blob.get("word_count")
        minimum = _WRITING_MIN_WORDS[task]
        # Did the student actually write anything? The essay id is NOT the test:
        # _promote_writing_essays is best-effort and returns without stamping one
        # (e.g. no students row), so text can sit on the sitting with no essay.
        # Calling that "missing" would tell the student they never submitted work
        # the row itself has captured (Codex review, PR #777).
        wrote = bool(str(blob.get("text") or "").strip()) or bool(wc)

        if eid and str(eid) in delivered:
            state = "delivered"
        elif not wrote:
            state = "missing"
        elif wc is not None and wc < minimum:
            state = "too_short"
        else:
            state = "not_graded"

        out.append({
            "task":       task,
            "state":      state,
            "word_count": wc,
            "min_words":  minimum,
            # only a readable essay gets an id — an unreadable one would be a
            # dead-end link (writing-result.html gates on 'delivered').
            "essay_id":   str(eid) if (eid and str(eid) in delivered) else None,
        })
    return out


def writing_meets_min_words(essay: dict) -> bool:
    """True if the essay is long enough to auto-grade (Task 1 ≥150, Task 2 ≥250
    words). A missing/zero word_count fails the gate (held for admin decision)."""
    tt = str(essay.get("task_type") or "")
    key = "task1" if tt.startswith("task1") else "task2"
    return int(essay.get("word_count") or 0) >= _WRITING_MIN_WORDS[key]


def claim_mock_writing_grading(
    essay_ids: list, *, grading_tier: str = _MOCK_WRITING_GRADING_TIER,
    analysis_level: int = _MOCK_WRITING_ANALYSIS_LEVEL,
    selected_model: str | None = None,
) -> dict:
    """Word-count-gated claim of promoted mock Writing essays for AI grading.

    For each still-'pending' essay that MEETS the word minimum, atomically claim
    it (pending→grading + a job row). Returns
      {"queued": [(essay_id, job_id)], "short": [essay_id], "skipped": [essay_id]}
    — `queued` pairs the CALLER must launch as request-scoped BackgroundTasks (a
    service can't own request lifecycle); `short` = below the word minimum, left
    'pending' for the admin to decide in the Mock queue tab; `skipped` = not
    'pending' (already grading/graded) or lost the claim race.

    `analysis_level` / `selected_model` configure the grading JOB (the word gate
    itself is fixed at the IELTS minimums). The auto-grade path uses the mock
    defaults; bulk-grade passes the admin's chosen depth/model through. A None
    model resolves to the level-aware default.

    Idempotent + best-effort: a falsy id is ignored; a read/claim error is
    logged, never raised — auto-grading must not fail the student's submit."""
    from services import essay_service  # local import avoids import-order coupling
    ids = [str(e) for e in essay_ids if e]
    result: dict = {"queued": [], "short": [], "skipped": []}
    if not ids:
        return result
    try:
        rows = supabase_admin.table("writing_essays").select(
            "id, task_type, word_count, status",
        ).in_("id", ids).execute().data or []
    except Exception:  # noqa: BLE001
        logger.exception("[mock-exam] auto-grade: essay lookup failed ids=%s", ids)
        return result
    by_id = {r["id"]: r for r in rows}
    for eid in ids:
        essay = by_id.get(eid)
        if not essay:
            continue
        if essay.get("status") != "pending":
            result["skipped"].append(eid)          # already grading/graded/etc.
            continue
        if not writing_meets_min_words(essay):
            result["short"].append(eid)            # held for admin decision
            continue
        try:
            job = essay_service.claim_pending_for_grading(
                eid,
                grading_tier=grading_tier,
                analysis_level=analysis_level,
                selected_model=selected_model or essay_service.default_grading_model(analysis_level),
            )
        except Exception:  # noqa: BLE001
            logger.exception("[mock-exam] auto-grade claim failed essay=%s", eid)
            continue
        if job:
            result["queued"].append((eid, job["job_id"]))
        else:
            result["skipped"].append(eid)          # lost the pending→grading race
    return result


def skip_mock_writing_grading(essay_id: str, *, admin_id: str) -> dict:
    """Admin decides NOT to grade a too-short mock Writing essay — stamp
    grading_skipped_at (mig 156) so the mock release gate stops blocking on it.

    Narrowly scoped, because grading_skipped_at makes the release gate treat the
    essay as resolved: it may ONLY be set on a mock essay (sitting_id), that is
    still 'pending' (not in-flight/graded/reviewed/delivered), AND is genuinely
    too short (below the Task 1/Task 2 word minimum). This prevents a stray API
    call from publishing a gradeable or in-flight Writing task with no feedback."""
    try:
        rows = (supabase_admin.table("writing_essays")
                .select("id, sitting_id, status, task_type, word_count")
                .eq("id", str(essay_id)).limit(1).execute()).data
    except Exception as exc:  # noqa: BLE001
        raise MockExamError(f"Lỗi truy vấn bài viết: {exc}")
    if not rows:
        raise NotFoundError("Không tìm thấy bài viết.")
    essay = rows[0]
    if not essay.get("sitting_id"):
        raise SittingConflictError("Chỉ áp dụng cho bài Writing của mock test.")
    if essay.get("status") != "pending":
        raise SittingConflictError(
            "Chỉ bỏ qua được bài chưa chấm (pending) — bài đang chấm/đã chấm hãy dùng luồng thường.")
    if writing_meets_min_words(essay):
        raise SittingConflictError("Bài đủ số từ — hãy chấm thay vì bỏ qua.")
    try:
        supabase_admin.table("writing_essays").update({
            "grading_skipped_at": _now_iso(),
            "grading_skipped_by": str(admin_id),
        }).eq("id", str(essay_id)).execute()
    except Exception as exc:  # noqa: BLE001
        raise MockExamError(f"Lỗi cập nhật bài viết: {exc}")
    return {"ok": True, "essay_id": str(essay_id), "grading_skipped": True}


def start_section(sitting_id: str, user_id: str, section: str) -> dict:
    """Retake only: the student begins a section → stamp its PER-SITTING clock.
    (Sequential opens sections via the admin's advance_section instead.)

    Validates: retake exam, the section is assigned to this student, the window
    is still open, the section isn't already submitted, and NO OTHER assigned
    section is currently in progress (one clock at a time). Idempotent — if THIS
    section's clock is already running, returns the sitting unchanged (a refresh
    mid-section must NOT restart the timer)."""
    if section not in _LRW_ORDER:
        raise SittingConflictError(f"Section không hợp lệ: {section!r}")
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    _assert_owner(sitting, user_id)
    if sitting["status"] in ("released", "void"):
        raise SittingConflictError(f"Sitting đang ở trạng thái {sitting['status']!r}.")

    exam = get_published_exam_by_id(sitting["mock_exam_id"]) or {}
    if not is_retake(exam):
        raise SittingConflictError("Chỉ đề test lại mới tự bắt đầu từng phần.")
    if section not in _sitting_sections(sitting, exam):
        raise SittingConflictError(f"Bạn không được gán phần {section}.")
    # DO NOT START A CLOCK ON A SECTION THAT CANNOT BE RENDERED. assign() now
    # refuses to hand out a skill this exam has no paper for, but assignments
    # made before that check exist, and an exam can lose a test by a later
    # PATCH. Starting anyway stamped {section}_started_at, loaded an iframe with
    # `id=undefined`, and let the student's own countdown drain against nothing
    # until the reaper collected the empty paper and it was graded.
    from services.mock_exam_assignment_service import servable_skills
    if section not in servable_skills(exam):
        raise SittingConflictError(
            f"Phần {section} chưa có đề trong kỳ test lại này — báo giáo viên. "
            "Đồng hồ của bạn chưa chạy."
        )
    _assert_retake_window_open({
        "open_from":  sitting.get("retake_open_from"),
        "open_until": sitting.get("retake_open_until"),
    })
    if sitting.get(_SUBMITTED_COL[section]):
        raise SittingConflictError(f"Phần {section} đã nộp.")

    started_col = f"{section}_started_at"
    if sitting.get(started_col):
        return sitting  # idempotent — clock already running

    # One clock at a time: block starting a DIFFERENT assigned section while one
    # is already started-but-unsubmitted. Two concurrent per-sitting clocks (a
    # double-click across "Bắt đầu" buttons, or a direct API call) would let the
    # section the runner ISN'T showing silently bleed time / be reaped unseen.
    for other in _sitting_sections(sitting, exam):
        if other != section and sitting.get(f"{other}_started_at") \
                and not sitting.get(_SUBMITTED_COL[other]):
            raise SittingConflictError(
                f"Đang làm phần {other} — nộp xong mới bắt đầu phần khác."
            )

    updates = {started_col: _now_iso()}
    if sitting["status"] == "registered":
        updates["status"] = "lrw_in_progress"
    resp = supabase_admin.table("mock_exam_sittings").update(updates).eq(
        "id", str(sitting_id),
    ).is_(started_col, "null").execute()
    if not resp.data:
        # Someone stamped this clock between the read above and this write —
        # another tab, or a double-click. Idempotent, same as the guard above.
        return get_sitting(sitting_id) or {**sitting, **updates}

    # THE OTHER HALF OF THE REASSIGNMENT RACE. `_refresh_open_sitting()` now
    # compare-and-sets on every clock being null, which covers the ordering
    # where the student started FIRST. The mirror image — this function reads
    # the old assigned_skills, the admin's refresh commits while every clock is
    # still null, and then this write lands — left the sitting with a running
    # clock for a skill the refreshed snapshot no longer includes: the runner
    # can hide the section the student is sitting, and completion/reaping
    # disagree about what is owed (Codex review, PR #845).
    #
    # PostgREST has no cross-table transaction, so close it by RE-READING the
    # authority we depend on and rolling the clock back if it moved.
    fresh = get_sitting(sitting_id) or {}
    if section not in _sitting_sections(fresh, exam):
        supabase_admin.table("mock_exam_sittings").update({started_col: None}).eq(
            "id", str(sitting_id),
        ).execute()
        logger.warning(
            "[mock-exam] sitting=%s start of %s rolled back — reassigned mid-start",
            sitting_id, section,
        )
        raise SittingConflictError(
            f"Phần {section} vừa bị gỡ khỏi bài test lại của bạn — tải lại trang."
        )

    logger.info("[mock-exam] sitting=%s retake section=%s started", sitting_id, section)
    return fresh or (resp.data[0] if resp.data else {**sitting, **updates})


def submit_section(
    sitting_id: str, user_id: str, section: str,
    task1_text: str = "", task2_text: str = "",
) -> dict:
    """Collect ONE section for this sitting — the sequential-model equivalent
    of the old all-at-once `submit_lrw`.

    Called when the section's shared clock hits 0 (client auto-submit; there
    is no early manual submit — see module docstring). For listening/reading
    the domain attempt must already be submitted (the runner's own submit,
    sealed via attach_attempt); this just stamps the sitting's collected-at
    timestamp. For writing, the text is saved (like submit_writing) and
    stamped in the same call. Idempotent per section. Once every section the
    exam configures is collected, finalises to `lrw_submitted` and reconciles
    the terminal state (same as the old submit_lrw's tail).
    """
    if section not in _LRW_ORDER:
        raise SittingConflictError(f"Section không hợp lệ: {section!r}")
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    _assert_owner(sitting, user_id)
    if sitting["status"] in ("released", "void"):
        raise SittingConflictError(f"Sitting đang ở trạng thái {sitting['status']!r}.")

    col = _SUBMITTED_COL[section]
    if sitting.get(col):
        return sitting  # idempotent — already collected

    exam = get_published_exam_by_id(sitting["mock_exam_id"]) or {}
    if is_retake(exam):
        # Retake is self-paced: the section must be assigned + started, but the
        # student MAY finish early (no shared "who submits first" fairness rule).
        # The clock still auto-submits at 0 (client) and the reaper backstops a
        # closed tab.
        if section not in _sitting_sections(sitting, exam):
            raise SittingConflictError(f"Bạn không được gán phần {section}.")
        if not sitting.get(f"{section}_started_at"):
            raise SittingConflictError(f"Phần {section} chưa bắt đầu.")
    else:
        if (exam.get("active_section") or "not_started") != section:
            raise SittingConflictError(
                f"Phần {section} chưa được giám thị mở — không thể nộp bài."
            )
        if exam.get("collected_section") == section and section != "writing":
            # The papers for this section are already in. active_section is
            # deliberately unchanged during the pause, so the gate above cannot
            # see it — without this a student whose row the background sweep has
            # not reached yet could still submit into a collected section
            # (Codex adversarial review, 2026-07-26).
            #
            # WRITING IS EXEMPT, because for Writing this request IS the paper.
            # L/R answers are already persisted server-side answer-by-answer, so
            # refusing their submit costs nothing — the sweep grades exactly what
            # the student had. Writing's newest text exists ONLY here, and
            # refusing it threw away everything typed since the last 15s
            # autosave while the sweep promoted the older draft for grading.
            # submit_writing's own compare-and-set on writing_submitted_at is
            # the real boundary and still refuses anything arriving after the
            # sweep has claimed the sitting (Codex adversarial review, round 2).
            raise SittingConflictError(
                f"Phần {section} đã được thu bài — không nhận thêm bài nộp."
            )
        # No early manual submit: this endpoint only fires client-side at the
        # section's own clock hitting 0 — but it's a plain authenticated API
        # call, so enforce that server-side too (a small grace absorbs
        # client/server timing skew, not enough to game "who submits first").
        remaining = section_time_remaining_seconds(exam, section)
        if remaining is None or remaining > _EARLY_SUBMIT_GRACE_SECONDS:
            raise SittingConflictError(
                f"Chưa hết giờ phần {section} — không thể nộp sớm."
            )

    # Flip registered → lrw_in_progress BEFORE the section-specific submit —
    # submit_writing itself gates on lrw_in_progress, so for a student whose
    # FIRST configured section is Writing (e.g. a writing-only exam) the flip
    # must happen first, not after.
    if sitting["status"] == "registered":
        supabase_admin.table("mock_exam_sittings").update({
            "status": "lrw_in_progress",
        }).eq("id", str(sitting_id)).eq("status", "registered").execute()
        sitting = {**sitting, "status": "lrw_in_progress"}

    if section == "writing":
        # submit_writing raises if Writing isn't the open section or is already
        # final — that propagates as-is (nothing further to validate here: an
        # empty essay is a valid, if weak, submission — not an error).
        # finalize=True so the payload and the submitted stamp land together;
        # see submit_writing for the race that two statements left open.
        sitting = submit_writing(
            sitting_id, user_id, task1_text, task2_text, finalize=True,
        )
        _promote_writing_essays(sitting_id)
    else:
        _assert_prior_section_submitted(sitting, section)
        # SAME CLAIM PRIMITIVE AS THE SWEEP. A blind write here meant the two
        # writers were not actually serialised: a sweep could claim the stamp,
        # this submit could overwrite it with its own timestamp, and the sweep's
        # later rollback would then delete a real submission. Losing the race is
        # not an error — it means the paper is already in, which is exactly what
        # the student asked for (Codex adversarial review, 2026-07-26).
        won = supabase_admin.table("mock_exam_sittings").update(
            {col: _now_iso()},
        ).eq("id", str(sitting_id)).is_(col, "null").execute()
        if not won.data:
            logger.info(
                "[mock-exam] sitting=%s section=%s already collected — submit is a no-op",
                sitting_id, section,
            )
        sitting = get_sitting(sitting_id) or sitting
    logger.info("[mock-exam] sitting=%s section=%s collected", sitting_id, section)

    exam = get_published_exam_by_id(sitting["mock_exam_id"]) or {}
    sections = _sitting_sections(sitting, exam)   # retake → assigned, seq → configured
    if sections and all(sitting.get(_SUBMITTED_COL[s]) for s in sections):
        supabase_admin.table("mock_exam_sittings").update({
            "status": "lrw_submitted",
        }).eq("id", str(sitting_id)).execute()
        logger.info("[mock-exam] sitting=%s LRW submitted", sitting_id)
        return _reconcile_terminal(sitting_id)
    return sitting


# Counters the runner reports. mock_exam_sittings.integrity has been reserved
# for exactly this since mig 146 ({blur_count, late_ms, resumes}) and nothing
# has ever written to it.
_INTEGRITY_COUNTERS = ("blur_count", "blur_seconds", "resumes", "offline_events")
# A single value can't be gamed downwards, but it also shouldn't grow without
# bound from a stuck client.
_INTEGRITY_MAX = 100000


def record_integrity(sitting_id: str, user_id: str, signals: dict) -> dict:
    """Merge soft integrity counters reported by the student's runner.

    INFORMATIONAL ONLY — the mig 146 comment is explicit that these never
    auto-penalise, and nothing here feeds a band. They exist so an examiner
    looking at a surprising result can see whether the tab was hidden for ten
    minutes or the connection died six times, instead of guessing.

    Counters are MONOTONIC (max, not sum): the client keeps its running total in
    localStorage so it survives a reload, and sending an absolute value makes
    the write idempotent under retries. Taking the max also means a client can
    never DECREASE its own record — which is the whole point of storing it
    server-side rather than trusting a report at submit time.
    """
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    _assert_owner(sitting, user_id)
    if sitting["status"] in ("released", "void"):
        raise SittingConflictError(f"Sitting đang ở trạng thái {sitting['status']!r}.")

    # Sanitise here (junk is dropped, never raised — a soft signal must not be
    # able to break an exam), then merge in ONE statement. The old Python
    # read-modify-write let two overlapping reports both read the same value so
    # the SMALLER total could write last, and could clobber void_reason written
    # by a concurrent void_sitting (Codex review, PR #849).
    params: dict = {"p_sitting_id": str(sitting_id)}
    for key in _INTEGRITY_COUNTERS:
        raw = signals.get(key)
        if raw is None:
            continue
        try:
            value = int(raw)
        except (TypeError, ValueError):
            continue
        if value < 0:
            continue
        params[f"p_{key}"] = min(value, _INTEGRITY_MAX)

    res = supabase_admin.rpc("fn_merge_sitting_integrity", params).execute()
    return res.data or {}


def bind_session_to_sitting(session_id: str, user_id: str, sitting_id: str) -> None:
    """Link a speaking session to a sitting AT CREATION (before any response is
    graded), so per-response grading is sealed from the first answer.

    Validated: the sitting must exist, belong to the caller, and be sealed
    (not released/void). Called by POST /sessions when sitting_id is supplied."""
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    _assert_owner(sitting, user_id)
    if sitting["status"] in ("released", "void") or not sitting.get("sealed"):
        raise SittingConflictError("Kỳ thi không nhận thêm bài Speaking.")
    supabase_admin.table("sessions").update({
        "sitting_id": str(sitting_id),
    }).eq("id", str(session_id)).eq("user_id", str(user_id)).execute()


def record_speaking(sitting_id: str, user_id: str, session_ids: list[str]) -> dict:
    """Mark speaking complete for the sitting.

    Validated (the endpoint is student-authenticated): session_ids must be
    non-empty, every session must exist, belong to the sitting's owner, AND
    already be linked to THIS sitting — i.e. created within it via
    bind_session_to_sitting, so its per-response grading was sealed. We do NOT
    post-hoc link here (that would seal only the read, after feedback already
    leaked during grading). Then reconciles the terminal state.
    """
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    _assert_owner(sitting, user_id)
    if sitting["status"] in ("released", "void"):
        raise SittingConflictError(f"Sitting đang ở trạng thái {sitting['status']!r}.")

    ids = [str(s) for s in (session_ids or [])]
    if not ids:
        raise SittingConflictError("Chưa có bài Speaking để nộp.")
    rows = supabase_admin.table("sessions").select(
        "id, user_id, sitting_id, status",
    ).in_("id", ids).execute()
    found = {r["id"]: r for r in (rows.data or [])}
    # A session only counts if the student actually spoke — it must carry ≥1
    # response, not be a bare in_progress shell.
    resp_rows = supabase_admin.table("responses").select(
        "session_id",
    ).in_("session_id", ids).execute()
    have_response = {r["session_id"] for r in (resp_rows.data or [])}
    for sid in ids:
        r = found.get(sid)
        if not r or str(r.get("user_id")) != str(sitting["user_id"]):
            raise PermissionError("Bài Speaking không hợp lệ hoặc không thuộc về thí sinh.")
        if str(r.get("sitting_id")) != str(sitting_id):
            raise SittingConflictError(
                "Bài Speaking phải được tạo trong kỳ thi này (để chấm kín)."
            )
        if r.get("status") == "in_progress" or sid not in have_response:
            raise SittingConflictError(
                "Bài Speaking chưa hoàn thành (chưa nộp hoặc chưa có phần nói)."
            )

    supabase_admin.table("mock_exam_sittings").update({
        "speaking_session_ids": ids,
        "speaking_completed_at": _now_iso(),
    }).eq("id", str(sitting_id)).execute()
    logger.info(
        "[mock-exam] sitting=%s speaking recorded (%d sessions)",
        sitting_id, len(ids),
    )
    return _reconcile_terminal(sitting_id)


def admin_record_speaking(sitting_id: str, admin_id: str) -> dict:
    """Unstick a sitting whose Speaking never got reported (A5).

    The student's report call is fire-and-forget from practice.js: if it fails,
    the sitting stays `speaking_pending` FOREVER — no review row is created, it
    is never released, and there was no way for anyone to fix it. The speaking
    work itself is fine; only the last hop was lost.

    DISCOVERS the sessions already bound to this sitting rather than taking ids
    from the caller. An admin unsticking a sitting must not be able to attach
    work that isn't there, so this can only ever ratify what the student
    actually did inside the sitting (sessions are bound at creation via
    bind_session_to_sitting, which is what makes their grading sealed).
    """
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    if sitting["status"] in ("released", "void"):
        raise SittingConflictError(f"Sitting đang ở trạng thái {sitting['status']!r}.")
    if sitting.get("speaking_completed_at"):
        # IDEMPOTENT, BUT STILL RECONCILE. The speaking stamp and the terminal
        # transition are separate writes: if the stamp committed and the status
        # transition then failed transiently, returning here reported success
        # while the sitting stayed `speaking_pending` with no review row — and
        # this admin recovery, the last-resort unstick, could never fix it
        # (Codex review, PR #847).
        return _reconcile_terminal(sitting_id) or sitting

    rows = supabase_admin.table("sessions").select("id, status").eq(
        "sitting_id", str(sitting_id),
    ).execute().data or []
    ids = [r["id"] for r in rows if r.get("status") != "in_progress"]
    if ids:
        resp = supabase_admin.table("responses").select("session_id").in_(
            "session_id", ids,
        ).execute().data or []
        have = {r["session_id"] for r in resp}
        ids = [i for i in ids if i in have]
    if not ids:
        raise SittingConflictError(
            "Kỳ thi này chưa có bài Speaking nào hoàn thành để ghi nhận."
        )

    supabase_admin.table("mock_exam_sittings").update({
        "speaking_session_ids":  ids,
        "speaking_completed_at": _now_iso(),
    }).eq("id", str(sitting_id)).execute()
    logger.info("[mock-exam] sitting=%s speaking recorded by ADMIN=%s (%d sessions)",
                sitting_id, admin_id, len(ids))
    return _reconcile_terminal(sitting_id)


def _reconcile_terminal(sitting_id: str, exam: Optional[dict] = None) -> dict:
    """Flip to all_submitted (+ create review) once LRW and speaking are both in.

    Order-independent: whether speaking came first or LRW first, this converges.
    Never downgrades a sitting already claimed for review or beyond.

    `exam` lets a SWEEP hand over the snapshot it already holds. Called once per
    collected sitting, its own lookup was the remaining per-sitting round-trip
    in the reaper's loop (Codex review, PR #851). The single-sitting callers —
    the student submit paths — pass nothing and it looks the exam up.
    """
    sitting = get_sitting(sitting_id)
    if not sitting:
        return {}
    if sitting["status"] == "all_submitted":
        # REPAIR ONLY — never re-derive the status from here. The transition to
        # all_submitted and the review insert are two calls, so a failure
        # between them left a sitting that is terminal with NO review row: the
        # admin queue never shows it, and every path that could fix it bails on
        # the status. Creating the review is idempotent (one_review_per_sitting),
        # so simply asking for it again converges (Codex review, PR #853).
        #
        # Re-deriving would be actively unsafe: a sitting whose speaking stamp
        # is missing computes `speaking_pending`, which is a DOWNGRADE out of a
        # terminal state.
        _ensure_review(sitting)
        return sitting
    if sitting["status"] not in _PRE_REVIEW:
        return sitting

    # "LRW done" = every section THIS sitting must do is submitted. For retake
    # that's the assigned skills (a retaker may do only Writing, or only L+R);
    # for sequential it's the exam's configured sections. Keying on the writing
    # column alone would be wrong for a retaker not assigned Writing.
    if exam is None:
        exam = get_published_exam_by_id(sitting["mock_exam_id"]) or {}
    sections = _sitting_sections(sitting, exam)
    lrw_done = bool(sections) and all(sitting.get(_SUBMITTED_COL[s]) for s in sections)
    # Speaking is required only when the exam defines a speaking component AND
    # this isn't a retake (retake v1 covers L/R/W only — no speaking assigned).
    speaking_required = bool(exam.get("speaking_topic_set")) and not is_retake(exam)
    speaking_done = (bool(sitting.get("speaking_completed_at"))
                     if speaking_required else True)

    if lrw_done and speaking_done:
        new_status = "all_submitted"
    elif lrw_done and not speaking_done:
        new_status = "speaking_pending"
    else:
        return sitting  # speaking-only-so-far or nothing terminal yet

    if new_status != sitting["status"]:
        supabase_admin.table("mock_exam_sittings").update({
            "status": new_status,
        }).eq("id", str(sitting_id)).execute()
        sitting = {**sitting, "status": new_status}

    if new_status == "all_submitted":
        _ensure_review(sitting)
    return sitting


def _ensure_review(sitting: dict) -> None:
    """Queue this sitting's review row. Idempotent — the one_review_per_sitting
    UNIQUE constraint makes a duplicate call return the existing row, which is
    what lets both the forward transition and the repair path call it freely."""
    from services import mock_review_workflow  # local import avoids cycle
    try:
        ai_draft = assemble_ai_draft(sitting)
    except Exception:  # noqa: BLE001 — drafting must never block finalisation
        logger.exception("[mock-exam] ai_draft assembly failed sitting=%s", sitting["id"])
        ai_draft = {}
    mock_review_workflow.create_review(sitting["id"], ai_draft=ai_draft)
    logger.info("[mock-exam] sitting=%s all_submitted → review queued", sitting["id"])


def assemble_ai_draft(sitting: dict) -> dict:
    """Best-effort gather of AI nháp bands from the domain tables.

    Read-only, never authoritative. Failures are swallowed by the caller — the
    admin can still review from the raw attempts if drafting is incomplete.
    """
    draft: dict = {}

    la = sitting.get("listening_attempt_id")
    if la:
        r = supabase_admin.table("listening_test_attempts").select(
            "score, band_estimate",
        ).eq("id", str(la)).limit(1).execute()
        if r.data:
            draft["listening"] = {
                "raw": r.data[0].get("score"),
                "band": r.data[0].get("band_estimate"),
            }
    ra = sitting.get("reading_attempt_id")
    if ra:
        r = supabase_admin.table("reading_test_attempts").select(
            "score, band_estimate",
        ).eq("id", str(ra)).limit(1).execute()
        if r.data:
            draft["reading"] = {
                "raw": r.data[0].get("score"),
                "band": r.data[0].get("band_estimate"),
            }
    return draft


_EXAM_WRITABLE = {
    "code", "title", "exam_mode", "listening_test_id", "reading_test_id",
    "writing_task1_prompt_id", "writing_task2_prompt_id", "speaking_topic_set",
    "total_minutes", "reading_minutes", "writing_minutes",
    "open_from", "open_until", "cohort_id",
    "review_sla_days", "status",
}


def admin_list_exams() -> list[dict]:
    resp = supabase_admin.table("mock_exams").select("*").order(
        "created_at", desc=True,
    ).execute()
    return resp.data or []


# Content columns on mock_exams → (table, is-a-list-of-prompts).
_EXAM_CONTENT_COLS = (
    ("reading_test_id",          "reading_tests"),
    ("listening_test_id",        "listening_tests"),
    ("writing_task1_prompt_id",  "writing_prompts"),
    ("writing_task2_prompt_id",  "writing_prompts"),
)


def _exam_content_row(table: str, content_id, columns: str) -> Optional[dict]:
    """Read one configured paper while failing closed on lookup uncertainty.

    Publishing/opening a timed exam is an operational gate: a database error is
    not evidence that the paper is ready.  Keep this helper deliberately small
    so every caller gets the same truth instead of reimplementing a weaker UI
    check.
    """
    try:
        response = supabase_admin.table(table).select(columns).eq(
            "id", str(content_id),
        ).limit(1).execute()
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "[mock-exam] content readiness lookup failed table=%s id=%s",
            table, content_id,
        )
        raise ValueError(
            "Không kiểm tra được nội dung đề thi lúc này — chưa thể publish hoặc "
            "mở kỳ thi. Thử lại sau giây lát."
        ) from exc
    return response.data[0] if response.data else None


def _exam_content_readiness_issues(
    exam: dict,
    sections: Optional[tuple[str, ...]] = None,
) -> list[str]:
    """Return concrete reasons a configured timed section cannot be served.

    The admin pickers are convenience filters, not security/correctness gates:
    stale tabs and direct API calls can still submit old IDs.  The canonical
    service therefore re-checks the referenced rows before publish/open and
    immediately before a shared clock starts.
    """
    wanted = set(sections or tuple(_configured_sections(exam)))
    issues: list[str] = []

    if "listening" in wanted and exam.get("listening_test_id"):
        row = _exam_content_row(
            "listening_tests",
            exam["listening_test_id"],
            "id,status,test_type,full_audio_storage_path,assembled_audio_storage_path,"
            "full_audio_duration_seconds",
        )
        if not row:
            issues.append("Listening không còn tồn tại")
        else:
            if row.get("status") != "published":
                issues.append("Listening chưa được publish")
            if row.get("test_type") != "full":
                issues.append("Listening phải là đề full test")
            if not (
                str(row.get("assembled_audio_storage_path") or "").strip()
                or str(row.get("full_audio_storage_path") or "").strip()
            ):
                issues.append("Listening chưa có audio phát được")
            try:
                duration = int(row.get("full_audio_duration_seconds") or 0)
            except (TypeError, ValueError):
                duration = 0
            if duration <= 0:
                issues.append("Listening chưa có thời lượng audio hợp lệ")

    if "reading" in wanted and exam.get("reading_test_id"):
        row = _exam_content_row(
            "reading_tests", exam["reading_test_id"], "id,status,test_type",
        )
        if not row:
            issues.append("Reading không còn tồn tại")
        else:
            if row.get("status") != "published":
                issues.append("Reading chưa được publish")
            if row.get("test_type") != "full":
                issues.append("Reading phải là đề full test")

    if "writing" in wanted:
        for label, column, expected in (
            ("Writing Task 1", "writing_task1_prompt_id", "task1"),
            ("Writing Task 2", "writing_task2_prompt_id", "task2"),
        ):
            prompt_id = exam.get(column)
            if not prompt_id:
                continue
            row = _exam_content_row(
                "writing_prompts", prompt_id, "id,task_type,prompt_text,is_active",
            )
            if not row:
                issues.append(f"{label} không còn tồn tại")
                continue
            if row.get("is_active") is False:
                issues.append(f"{label} đã bị vô hiệu hóa")
            task_type = str(row.get("task_type") or "")
            type_matches = task_type.startswith("task1") if expected == "task1" else task_type == "task2"
            if not type_matches:
                issues.append(f"{label} đang trỏ nhầm loại đề")
            if not str(row.get("prompt_text") or "").strip():
                issues.append(f"{label} chưa có nội dung đề")

    for section, column in (("Reading", "reading_minutes"), ("Writing", "writing_minutes")):
        if section.lower() not in wanted:
            continue
        try:
            minutes = int(exam.get(column) or 60)
        except (TypeError, ValueError):
            minutes = 0
        if minutes <= 0:
            issues.append(f"Thời gian {section} phải lớn hơn 0 phút")
    return issues


def _require_exam_content_ready(
    exam: dict,
    *,
    sections: Optional[tuple[str, ...]] = None,
    error_type=ValueError,
) -> None:
    issues = _exam_content_readiness_issues(exam, sections)
    if issues:
        raise error_type("Nội dung kỳ thi chưa sẵn sàng: " + "; ".join(issues) + ".")


def _reserve_exam_content(row: dict) -> None:
    """Flag every test/prompt this exam uses as exam_only (mig 170).

    The admin can tick the flag at upload, but the moment that actually matters
    is this one: the content is now a live exam paper, and nobody should have to
    remember a checkbox for it to stop being practisable. Doing it here also
    makes the flag survive the exam being archived — the hole in
    reserved_test_ids() that republished last cohort's paper to the next one.

    Best-effort: never let a bookkeeping write fail exam creation. The dynamic
    reserved_test_ids() filter still hides live-exam content meanwhile.
    """
    for col, table in _EXAM_CONTENT_COLS:
        value = row.get(col)
        if not value:
            continue
        try:
            supabase_admin.table(table).update({"exam_only": True}).eq(
                "id", str(value),
            ).execute()
        except Exception:  # noqa: BLE001
            logger.warning("[mock-exam] could not reserve %s=%s in %s", col, value, table)


def admin_create_exam(payload: dict, created_by: str) -> dict:
    row = {k: v for k, v in payload.items() if k in _EXAM_WRITABLE}
    if not row.get("code") or not row.get("title"):
        raise ValueError("code và title là bắt buộc.")
    row["created_by"] = str(created_by)
    inserted = supabase_admin.table("mock_exams").insert(row).execute()
    if not inserted.data:
        raise MockExamError("Không tạo được mock exam.")
    _reserve_exam_content(inserted.data[0])
    return inserted.data[0]


def admin_update_exam(exam_id: str, patch: dict) -> dict:
    upd = {k: v for k, v in patch.items() if k in _EXAM_WRITABLE}
    if not upd:
        raise ValueError("Không có trường hợp lệ để cập nhật.")
    current: Optional[dict] = None
    readiness_fields = {
        "status", "listening_test_id", "reading_test_id",
        "writing_task1_prompt_id", "writing_task2_prompt_id",
        "reading_minutes", "writing_minutes",
    }
    if readiness_fields.intersection(upd):
        current = get_published_exam_by_id(exam_id)
        if not current:
            raise NotFoundError(f"Mock exam {exam_id} không tồn tại.")
        candidate = {**current, **upd}
        if candidate.get("status") == "published":
            # Validate before fn_set_exam_mode: that RPC commits independently.
            # A mixed patch must not report a readiness error after the mode has
            # already changed underneath every existing sitting contract.
            if "status" in upd:
                _require_exam_content_ready(candidate)
            else:
                affected_sections = []
                if "listening_test_id" in upd:
                    affected_sections.append("listening")
                if {"reading_test_id", "reading_minutes"}.intersection(upd):
                    affected_sections.append("reading")
                if {
                    "writing_task1_prompt_id", "writing_task2_prompt_id",
                    "writing_minutes",
                }.intersection(upd):
                    affected_sections.append("writing")
                if affected_sections:
                    _require_exam_content_ready(
                        candidate, sections=tuple(affected_sections),
                    )
    if "exam_mode" in upd:
        # MODE IS NOT A SETTING, IT IS THE CONTRACT A SITTING IS READ UNDER.
        #
        # Nothing stores the mode on the sitting: _sitting_sections() resolves
        # it from the exam on EVERY read. So flipping a sequential exam that has
        # live sittings to retake makes those rows resolve to an EMPTY skill set
        # (they carry no assigned_skills) — the runner shows an empty retake
        # menu, the reaper skips them because they are not assignments, and the
        # papers can never be collected or finalised. The reverse direction is
        # just as bad: retake sittings suddenly owe the exam's full configured
        # sequence, including sections their student was never assigned.
        #
        # PR #851 closed one write path (advance) against a mid-request mode
        # flip; that guarded the transition, not the invariant underneath it
        # (Codex adversarial review, 2026-07-26).
        current = get_published_exam_by_id(exam_id)
        if not current:
            raise NotFoundError(f"Mock exam {exam_id} không tồn tại.")
        if (current.get("exam_mode") or "sequential") != upd["exam_mode"]:
            # ONE STATEMENT (mig 169), not read-then-write. Checking for
            # dependents and then PATCHing were two PostgREST requests, and a
            # sitting inserted between them is read under the WRONG mode — the
            # exact failure this guard exists to prevent (Codex review, PR
            # #859). The RPC evaluates the same NOT EXISTS conditions in the
            # statement that performs the write.
            try:
                changed = supabase_admin.rpc("fn_set_exam_mode", {
                    "p_exam_id": str(exam_id),
                    "p_mode":    upd["exam_mode"],
                }).execute().data
            except Exception as exc:  # noqa: BLE001
                # FAIL CLOSED. Not knowing whether the exam is free is not the
                # same as knowing it is: guessing "free" is how a live classroom
                # loses its papers.
                logger.exception("[mock-exam] mode change failed exam=%s", exam_id)
                raise ValueError(
                    "Không đổi được chế độ lúc này — thử lại sau giây lát."
                ) from exc
            if not changed:
                raise ValueError(
                    "Không đổi được chế độ của đề đã có lượt thi hoặc bài được "
                    "gán. Tạo đề mới, hoặc huỷ hết lượt thi và gỡ hết phần gán "
                    "trước khi đổi."
                )
            upd.pop("exam_mode")     # already written, atomically
            if not upd:
                return changed
        else:
            upd.pop("exam_mode")     # a no-op write, not a mode change
            if not upd:
                return current       # nothing left to write
    resp = supabase_admin.table("mock_exams").update(upd).eq(
        "id", str(exam_id),
    ).execute()
    if not resp.data:
        raise NotFoundError(f"Mock exam {exam_id} không tồn tại.")
    # Swapping a test INTO an exam reserves it too. The old one keeps its flag:
    # it was an exam paper once, and students who sat it can still review it.
    _reserve_exam_content(resp.data[0])
    return resp.data[0]


def admin_list_sittings(exam_id: str) -> list[dict]:
    resp = supabase_admin.table("mock_exam_sittings").select("*").eq(
        "mock_exam_id", str(exam_id),
    ).order("created_at", desc=True).execute()
    return resp.data or []


def void_sitting(sitting_id: str, admin_id: str, reason: str = "") -> dict:
    """Admin voids a sitting (tech failure / retake). Keeps the row for audit.

    A RELEASED sitting cannot be voided. It is a published result the student
    can already see; voiding would erase it and leave a `void` row whose seal
    was lifted at release, i.e. a cancelled sitting still exposing scores.
    The invigilator console hides the control for released rows, but the rule
    belongs here — the UI is not the guard (Codex review, PR #840).
    """
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    if sitting.get("status") == "released":
        raise SittingConflictError(
            "Không huỷ được lượt thi đã công bố kết quả."
        )
    # ONE statement (mig 168). This used to read `integrity`, add the two audit
    # fields in Python, and write the whole document back — so an integrity
    # report committing between the read and the write had its counters erased,
    # breaking from the other side the monotonic guarantee mig 163 makes
    # (Codex review, PR #849). `integrity || {...}` keeps every key this path
    # does not touch.
    #
    # The sitting stays SEALED: a voided (cancelled) exam never publishes
    # results, and unsealing here would expose scores / reviews / answer keys
    # for the linked attempts without going through the release workflow. Only
    # release_results ever lifts the seal.
    voided = supabase_admin.rpc("fn_void_sitting", {
        "p_sitting_id": str(sitting_id),
        "p_admin_id":   str(admin_id),
        "p_reason":     reason,
    }).execute().data
    if not voided:
        # The RPC's own status guard refused. That happens when a release
        # committed between the read above and this call, so the row is now
        # `released`. Fabricating a void response here logged success and
        # answered the admin 200 while the persisted row said the opposite
        # (Codex review, PR #849). Report the state that actually holds.
        fresh = get_sitting(sitting_id) or {}
        raise SittingConflictError(
            "Không huỷ được lượt thi — trạng thái hiện tại là "
            f"{fresh.get('status') or 'không rõ'}. Tải lại trang để xem trạng thái mới nhất."
        )
    # Cancel the linked review too. Leaving it 'reviewed' let a stale review page
    # still call release_results(), which flips the sitting back to 'released'
    # with sealed=False — publishing an exam that was explicitly cancelled.
    # release_results now refuses a voided sitting as well; this is the other
    # half, so the two records cannot disagree (Codex review, PR #840).
    try:
        supabase_admin.table("mock_exam_reviews").update({
            "status": "void",
        }).eq("sitting_id", str(sitting_id)).not_.in_(
            "status", ["released", "void"],
        ).execute()
    except Exception:  # noqa: BLE001 — the sitting is already void; log and move on
        logger.exception("[mock-exam] void: review cancel failed sitting=%s", sitting_id)
    logger.info("[mock-exam] sitting=%s VOIDED by admin=%s", sitting_id, admin_id)
    return voided


def set_sitting_retest(
    sitting_id: str, admin_id: str, needs_retest: bool, reason: str = "",
) -> dict:
    """Admin's EARLY (pre-grading) 'this student will retake' toggle (mig 153).
    Set from the roster off the auto-graded L/R results so the Writing
    bulk-grade can skip a retaker before spending grading budget. Idempotent —
    just writes the boolean + a light audit stamp; clearing it (needs_retest=
    False) wipes the stamp."""
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    update = {
        "needs_retest":        bool(needs_retest),
        "needs_retest_at":     _now_iso() if needs_retest else None,
        "needs_retest_by":     str(admin_id) if needs_retest else None,
        "needs_retest_reason": (reason or None) if needs_retest else None,
    }
    resp = supabase_admin.table("mock_exam_sittings").update(update).eq(
        "id", str(sitting_id),
    ).execute()
    logger.info("[mock-exam] sitting=%s needs_retest=%s by admin=%s",
                sitting_id, bool(needs_retest), admin_id)
    return resp.data[0] if resp.data else {**sitting, **update}


# ── Admin: open/close + section advance + exclusivity ──────────────────


def set_open(exam_id: str, is_open: bool, admin_id: str) -> dict:
    """Admin live toggle — open the exam so students can start, or close it.

    OPENING a finished exam is refused. The final advance now closes the room
    and three separate gates reject a student entering a `done` exam — but this
    toggle wrote `is_open` unconditionally, so an admin could press "Mở kỳ", be
    told it worked, and have `is_open=true` persisted while every student was
    still turned away. An admin console that reports a state the system does not
    honour is worse than one that refuses (Codex review, PR #858).

    CLOSING stays allowed from any state: it is the safe direction and must
    never be blocked.
    """
    if is_open:
        exam = get_published_exam_by_id(exam_id)
        if not exam:
            raise NotFoundError(f"Mock exam {exam_id} không tồn tại.")
        if exam.get("status") != "published":
            raise SittingConflictError(
                "Đề chưa được publish — chưa thể mở kỳ thi cho học viên."
            )
        if (exam.get("active_section") or "not_started") == "done":
            raise SittingConflictError(
                "Kỳ thi đã kết thúc — không mở lại được. Tạo đề mới nếu cần thi lại."
            )
        try:
            _require_exam_content_ready(exam)
        except ValueError as exc:
            raise SittingConflictError(str(exc)) from exc
    resp = supabase_admin.table("mock_exams").update({
        "is_open": bool(is_open),
    }).eq("id", str(exam_id)).execute()
    if not resp.data:
        raise NotFoundError(f"Mock exam {exam_id} không tồn tại.")
    logger.info("[mock-exam] exam=%s is_open=%s by admin=%s", exam_id, is_open, admin_id)
    return resp.data[0]


def _grade_and_finalize_listening(attempt_id: str) -> None:
    """Straggler grading: mirrors routers/listening.py's submit endpoint, but
    driven server-side (no live client) from whatever answers are already
    persisted on the attempt row. Always leaves the attempt `submitted` —
    even a grading failure (missing test bundle, etc.) still collects the
    paper, just with blank score/band fields, rather than leaving it stuck
    `in_progress` forever."""
    from services import listening_test_grader as grader

    attempt_res = supabase_admin.table("listening_test_attempts").select(
        "*",
    ).eq("id", attempt_id).limit(1).execute()
    if not attempt_res.data:
        return
    attempt = attempt_res.data[0]
    if attempt.get("status") == "submitted":
        return  # already graded — the client's own submit beat the sweep

    update: dict = {"status": "submitted", "submitted_at": _now_iso()}
    try:
        test_id = attempt["test_id"]
        section_ids = [r["id"] for r in (
            supabase_admin.table("listening_content").select("id")
            .eq("test_id", test_id).execute().data or []
        )]
        ex_rows = (
            supabase_admin.table("listening_exercises").select("payload")
            .in_("content_id", section_ids).execute().data
            if section_ids else []
        )
        answer_key = grader.collect_answer_key(ex_rows or [])
        result = grader.grade_attempt(attempt.get("answers") or [], answer_key)
        update.update({
            "score":           result["score"],
            "grading_details": result["per_question"],
            "trap_analytics":  result["trap_analytics"],
            "band_estimate":   result["band_estimate"],
        })
    except Exception:  # noqa: BLE001 — collection must not get stuck on a grading bug
        logger.exception(
            "[mock-exam] force-collect: grading failed listening attempt=%s", attempt_id,
        )
    supabase_admin.table("listening_test_attempts").update(update).eq(
        "id", attempt_id,
    ).execute()


def _grade_and_finalize_reading(attempt_id: str) -> None:
    """Straggler grading for Reading — mirrors routers/reading_student.py's
    submit endpoint (grading from the persisted `reading_attempt_answers`
    autosave rows, since there is no live request body to fall back on).
    Same always-submitted guarantee as the Listening sibling above."""
    from services import reading_test_grader as grader

    attempt_res = supabase_admin.table("reading_test_attempts").select(
        "*",
    ).eq("id", attempt_id).limit(1).execute()
    if not attempt_res.data:
        return
    attempt = attempt_res.data[0]
    if attempt.get("status") == "submitted":
        return

    update: dict = {"status": "submitted", "submitted_at": _now_iso()}
    try:
        test_uuid = attempt["test_id"]
        test_res = supabase_admin.table("reading_tests").select(
            "id, module",
        ).eq("id", test_uuid).limit(1).execute()
        module = test_res.data[0].get("module") if test_res.data else None
        passages = (
            supabase_admin.table("reading_passages").select("id, passage_order")
            .eq("test_id", test_uuid).eq("library", "l3_test").execute().data or []
        )
        passage_order_by_id = {p["id"]: p.get("passage_order") for p in passages}
        q_rows = (
            supabase_admin.table("reading_questions")
            .select("q_num,answer,skill_tag,explanation,passage_id")
            .in_("passage_id", list(passage_order_by_id.keys())).execute().data
            if passage_order_by_id else []
        )
        answer_key = grader.collect_answer_key(q_rows or [], passage_order_by_id)
        persisted = (
            supabase_admin.table("reading_attempt_answers")
            .select("q_num,user_answer").eq("attempt_id", attempt_id).execute().data or []
        )
        answers_by_qnum: dict[int, str] = {}
        for row in persisted:
            try:
                qn = int(row["q_num"])
            except (KeyError, TypeError, ValueError):
                continue
            answers_by_qnum[qn] = row.get("user_answer") or ""
        user_answers = [
            {"q_num": qn, "user_answer": ua}
            for qn, ua in sorted(answers_by_qnum.items())
        ]
        result = grader.grade_attempt(user_answers, answer_key, module=module or "academic")
        update.update({
            "answers":         user_answers,
            "score":           result["score"],
            "grading_details": result["per_question"],
            "skill_breakdown": result["skill_breakdown"],
            "band_estimate":   result["band_estimate"],
        })
    except Exception:  # noqa: BLE001
        logger.exception(
            "[mock-exam] force-collect: grading failed reading attempt=%s", attempt_id,
        )
    supabase_admin.table("reading_test_attempts").update(update).eq(
        "id", attempt_id,
    ).execute()


def _force_collect_section(exam_id: str, section: str, *, strict: bool = False) -> int:
    """Straggler safety net: sweep up every paper for `section` as-is.

    Every non-terminal sitting that hasn't submitted this section yet (e.g. a
    disconnected student) is best-effort collected — mirrors a real proctor
    taking in papers when time's up, regardless of whether the student
    finished.

    Returns the number of sittings swept, so the caller can tell the admin what
    it actually did rather than just "ok".

    `strict` decides what a LOOKUP failure means. Best-effort is right for the
    advance safety net (a stumble there must not block the class from moving
    on), but wrong for the explicit "Thu bài" action: returning 0 there told the
    admin "Đã thu bài … 0 bài" — a success message — while every student was
    still working (Codex review, PR #843).
    """
    col = _SUBMITTED_COL.get(section)
    if not col:
        return 0
    try:
        rows = supabase_admin.table("mock_exam_sittings").select("*").eq(
            "mock_exam_id", str(exam_id),
        ).is_(col, "null").not_.in_(
            "status", ["released", "void"],
        ).execute()
    except Exception as exc:  # noqa: BLE001
        logger.exception("[mock-exam] force-collect lookup failed exam=%s section=%s", exam_id, section)
        if strict:
            raise MockExamError(
                "Không đọc được danh sách bài chưa nộp — CHƯA thu được bài nào. "
                "Thử lại sau giây lát."
            ) from exc
        return 0

    # ONE lookup for the whole sweep — every row here belongs to `exam_id`.
    exam = get_published_exam_by_id(str(exam_id)) or {}
    n = 0
    for row in (rows.data or []):
        if _collect_section_for_sitting(row, section, exam):
            n += 1
    # A sweep is exactly where a paper gets stranded — stamped, then a failure
    # before the status write or the review insert — and the stranded row is
    # invisible to the NEXT sweep (this query selects null stamps only). So
    # every sweep also settles what an earlier one left behind: pressing "Thu
    # bài" / "Thu lại", or advancing, now repairs those rows instead of walking
    # past them. Never raises (Codex review, PR #853).
    reconcile_stalled_sittings(str(exam_id))
    return n


def pending_in_section(exam_id: str, section: str) -> int:
    """How many non-terminal sittings still owe this section — the number the
    admin needs BEFORE a sweep is queued, since the sweep itself now runs in the
    background and can't report back synchronously."""
    col = _SUBMITTED_COL.get(section)
    if not col:
        return 0
    try:
        rows = supabase_admin.table("mock_exam_sittings").select("id").eq(
            "mock_exam_id", str(exam_id),
        ).is_(col, "null").not_.in_("status", ["released", "void"]).execute()
    except Exception as exc:  # noqa: BLE001
        # Returning 0 turned "we don't know" into a valid count: /collect still
        # answered 202 and the console said it was collecting ZERO papers, while
        # the queued sweep — hitting the same failing database — collected
        # nothing either. The admin found out from a missed-paper warning much
        # later, if at all (Codex review, PR #844).
        logger.exception("[mock-exam] pending count failed exam=%s section=%s", exam_id, section)
        raise MockExamError(
            "Không đọc được danh sách bài chưa nộp — chưa xác nhận được sẽ thu "
            "bao nhiêu bài, nên chưa thu. Thử lại sau giây lát."
        ) from exc
    return len(rows.data or [])


def _pending_collection_flush_ids(exam_id: str, section: str) -> list[str]:
    """Outstanding papers whose clients have not ACKed their final autosave.

    The exam marker is checked on every pass.  If another invigilator already
    advanced, the advance path owns the idempotent recovery sweep and this
    grace loop must not keep a background task asleep unnecessarily.
    """
    col = _SUBMITTED_COL.get(section)
    if not col:
        return []
    exam = get_published_exam_by_id(str(exam_id)) or {}
    if (exam.get("active_section") != section
            or exam.get("collected_section") != section):
        return []
    rows = (
        supabase_admin.table("mock_exam_sittings")
        .select(f"id,{col},collection_flush_acks")
        .eq("mock_exam_id", str(exam_id))
        .is_(col, "null")
        .not_.in_("status", ["released", "void"])
        .execute().data or []
    )
    return [
        str(row["id"])
        for row in rows
        if not (row.get("collection_flush_acks") or {}).get(section)
    ]


def wait_for_collection_flush(
    exam_id: str,
    section: str,
    *,
    grace_seconds: float = _COLLECTION_FLUSH_GRACE_SECONDS,
    poll_seconds: float = _COLLECTION_FLUSH_POLL_SECONDS,
) -> list[str]:
    """Wait until final-save ACKs arrive, returning IDs that timed out.

    This is intentionally bounded: a disconnected student still has their
    server-held answers force-collected after the grace window.  Database read
    failures consume the remaining grace instead of turning a transient lookup
    failure into an immediate destructive sweep.
    """
    deadline = time.monotonic() + max(0.0, grace_seconds)
    unacked: list[str] = []
    while True:
        try:
            unacked = _pending_collection_flush_ids(exam_id, section)
        except Exception:  # noqa: BLE001 — bounded retry before strict sweep
            logger.exception(
                "[mock-exam] collection-flush lookup failed exam=%s section=%s",
                exam_id, section,
            )
            unacked = ["lookup-failed"]
        if not unacked:
            return []
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            logger.warning(
                "[mock-exam] collection-flush grace expired exam=%s section=%s pending=%s",
                exam_id, section, unacked,
            )
            return unacked
        time.sleep(min(max(0.01, poll_seconds), remaining))


def acknowledge_collection_flush(
    sitting_id: str, user_id: str, section: str,
) -> dict:
    """Persist the owner's ACK after their final section autosave completes."""
    col = _SUBMITTED_COL.get(section)
    if not col:
        raise SittingConflictError("Phần thi không hợp lệ.")
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError("Sitting không tồn tại.")
    if str(sitting.get("user_id")) != str(user_id):
        raise PermissionError("Sitting không thuộc về bạn.")

    # A sweep can win the last millisecond race between the client's final save
    # and this ACK.  Once the canonical section stamp exists, ACK is idempotently
    # settled and the client may close its workspace.
    if sitting.get(col):
        return {"section": section, "acknowledged": True, "settled": True}

    exam = get_published_exam_by_id(str(sitting["mock_exam_id"])) or {}
    if is_retake(exam):
        raise SittingConflictError("Bài test lại không dùng thu bài đồng loạt.")
    if (exam.get("active_section") != section
            or exam.get("collected_section") != section):
        raise SittingConflictError("Phần thi này chưa ở trạng thái thu bài.")

    acks = dict(sitting.get("collection_flush_acks") or {})
    acks[section] = _now().isoformat()
    updated = (
        supabase_admin.table("mock_exam_sittings")
        .update({"collection_flush_acks": acks})
        .eq("id", str(sitting_id))
        .eq("user_id", str(user_id))
        .is_(col, "null")
        .execute().data or []
    )
    if updated:
        return {"section": section, "acknowledged": True, "settled": False}

    # The strict update lost a race to collection.  Re-read canonical state;
    # never manufacture a successful ACK from an empty update.
    fresh = get_sitting(sitting_id) or {}
    if fresh.get(col):
        return {"section": section, "acknowledged": True, "settled": True}
    raise SittingConflictError("Không ghi nhận được xác nhận lưu bài.")


def collect_section_after_flush_grace(
    exam_id: str, admin_id: str, section: str,
) -> dict:
    """Background collect that gives active clients a final-save handshake."""
    wait_for_collection_flush(exam_id, section)
    return collect_section(exam_id, admin_id, section)


def collect_preflight(exam_id: str, section: Optional[str] = None,
                      from_section: Optional[str] = None) -> dict:
    """Validate a collect request and report what it will sweep.

    Split from the sweep itself because the sweep is queued as a background
    task: without this the admin would get a 202 for a request that was always
    going to be rejected, and would learn about it only from the logs.
    """
    exam = get_published_exam_by_id(exam_id)
    if not exam:
        raise NotFoundError(f"Mock exam {exam_id} không tồn tại.")
    if is_retake(exam):
        raise SittingConflictError("Đề test lại tự thu bài theo từng học viên.")
    current = exam.get("active_section") or "not_started"
    # Same stale-screen guard as /advance. Without it a monitor still showing
    # Listening — because another invigilator advanced during the confirm dialog
    # or inside the 5s poll window — sends a request carrying no section
    # identity, and this re-reads the CANONICAL active_section and sweeps
    # READING instead: irreversibly submitting every Reading paper the moment it
    # opened (Codex review, PR #843).
    if from_section and from_section != current:
        raise SittingConflictError(
            f"Màn hình của bạn đang hiển thị phần {from_section!r} nhưng kỳ thi "
            f"đã ở phần {current!r} — có thao tác khác vừa chuyển phần. Tải lại trang."
        )
    target = section or current
    if target not in _LRW_ORDER:
        raise SittingConflictError("Chưa có phần nào đang mở để thu bài.")
    if target not in _configured_sections(exam):
        raise SittingConflictError(f"Kỳ thi này không có phần {target}.")
    # Only the OPEN section or an earlier one may be swept. Without this,
    # /collect?section=writing while Listening is active would stamp every
    # student's future Writing as submitted before they were ever given it —
    # taking papers that do not exist yet (Codex review, PR #844).
    if _seq_index(exam, target) > _seq_index(exam, current):
        raise SittingConflictError(
            f"Phần {target} chưa được mở — chưa có bài để thu."
        )
    return {"section": target, "pending": pending_in_section(exam_id, target)}



def mark_section_collected(exam_id: str, section: str) -> bool:
    """CLOSE ADMISSIONS for `section` — the canonical "papers are in, next
    section not open yet" state (mig 166).

    Stamping the sittings alone left the pause with no representation on the
    exam row: an eligible student who had not opened the exam yet could create a
    sitting during the pause, and their brand-new row carries no submission
    stamp — so the runner handed them the paper the room had already turned in,
    with the class clock running (Codex review, PR #843). create_sitting() reads
    this and is born submitted.

    The `.eq("active_section", section)` is what keeps a RECOVERY re-sweep of an
    earlier section from pushing a live exam into a pause it is not in.
    """
    updated = supabase_admin.table("mock_exams").update({
        "collected_section": section,
        "collection_sweep_completed_section": None,
    }).eq("id", str(exam_id)).eq("active_section", section).execute().data or []
    return bool(updated)


def mark_collection_sweep_completed(exam_id: str, section: str) -> bool:
    """Publish that the ACK-gated sweep finished for the paused section."""
    updated = (
        supabase_admin.table("mock_exams")
        .update({"collection_sweep_completed_section": section})
        .eq("id", str(exam_id))
        .eq("active_section", section)
        .eq("collected_section", section)
        .execute().data or []
    )
    return bool(updated)


def collect_section(exam_id: str, admin_id: str, section: Optional[str] = None,
                    from_section: Optional[str] = None) -> dict:
    """Admin THU BÀI for the open section — without opening the next one (B4).

    "Thu bài" and "mở phần sau" used to be one irreversible button, so the real
    proctor sequence — take the papers in, check everyone is accounted for, let
    the room breathe, THEN hand out the next section — could not be expressed:
    the moment you collected, the next clock was already running.

    Collecting stamps each sitting's {section}_submitted_at, which makes the
    runner's own isOpenSection test false, so every student drops into the
    waiting room with NO clock running until the admin advances. It ALSO records
    the pause on the exam row so a LATE entrant cannot be handed the collected
    paper — see mark_section_collected().

    `section` defaults to the open one; passing an EARLIER section re-sweeps it,
    which is the recovery path when a background sweep died half-way (a Railway
    restart mid-task) and left papers uncollected behind a moved-on exam.
    """
    target = collect_preflight(exam_id, section, from_section)["section"]
    mark_section_collected(exam_id, target)
    collected = _force_collect_section(exam_id, target, strict=True)
    mark_collection_sweep_completed(exam_id, target)
    logger.info("[mock-exam] exam=%s section=%s COLLECTED %d by admin=%s",
                exam_id, target, collected, admin_id)
    return {"section": target, "collected": collected}


def _collect_section_for_sitting(sitting: dict, section: str,
                                 exam: Optional[dict] = None) -> bool:
    """Force-collect ONE section of ONE sitting AS-IS (time's up / straggler /
    closed tab). Stamps the collected-at timestamp, grades the bound L/R attempt
    (or promotes Writing) if present, then re-checks terminal reconciliation on
    the sitting's OWN sections (retake → assigned skills; sequential →
    configured). Idempotent + best-effort — never raises. Shared by the admin
    advance sweep and the retake reaper.

    `exam` is the caller's snapshot of this sitting's exam. Both callers already
    hold it — the reaper keyed by exam id, the admin sweep because every row it
    loops over belongs to ONE exam — and every sitting in a given sweep resolves
    to the SAME row, so looking it up per sitting made a class of 30 pay 60
    round-trips inside a timer-driven task. Passing it in keeps the query count
    flat as the class grows (Codex review, PR #851). Omitted → looked up, which
    keeps the function usable standalone."""
    col = _SUBMITTED_COL.get(section)
    if not col or sitting.get(col):
        return False
    # NEVER STAMP A SECTION THIS SITTING DOES NOT OWN. The callers decide WHICH
    # section to sweep from the EXAM (sequential) or from the reaper's own scan,
    # but what a given sitting owes is a property of the SITTING — assigned
    # skills for a retake, configured sections otherwise. Without this a sweep
    # aimed at the wrong mode, or at a section a retake student was never
    # assigned, would stamp a paper that does not exist
    # (Codex adversarial review, 2026-07-26).
    try:
        exam_for_scope = (
            exam if exam is not None
            else get_published_exam_by_id(str(sitting["mock_exam_id"])) or {}
        )
        if section not in _sitting_sections(sitting, exam_for_scope):
            logger.info(
                "[mock-exam] sitting=%s section=%s not owned by this sitting — not swept",
                sitting["id"], section,
            )
            return False
    except Exception:  # noqa: BLE001 — scope lookup must not break the sweep
        logger.exception("[mock-exam] sweep scope check failed sitting=%s", sitting["id"])
        return False
    claimed_at = None
    terminal_started = False
    try:
        update: dict = {col: _now_iso()}
        if sitting.get("status") == "registered":
            update["status"] = "lrw_in_progress"
        # ATOMIC CLAIM, not a blind write. The sweep now runs as a background
        # task, so an admin who presses "Thu bài" again — or advances — before
        # the first one finishes queues a SECOND sweep over the same rows. Each
        # snapshots the rows with a null submitted stamp, so without a
        # compare-and-set both tasks proceed to grade the same attempt, and two
        # concurrent Writing sweeps each call _promote_writing_essays() before
        # either has stored essay_task*_id — creating duplicate essays (Codex
        # review, PR #844). Winning the stamp is the right to do the work.
        claimed_at = update[col]
        claim = supabase_admin.table("mock_exam_sittings").update(update).eq(
            "id", sitting["id"],
        ).is_(col, "null").execute()
        if not claim.data:
            logger.info(
                "[mock-exam] sitting=%s section=%s already claimed by another sweep",
                sitting["id"], section,
            )
            return False
        if section in _SECTION_ATTEMPT:
            link_col, _table, _ = _SECTION_ATTEMPT[section]
            attempt_id = sitting.get(link_col)
            if attempt_id:
                grade_fn = (_grade_and_finalize_listening if section == "listening"
                            else _grade_and_finalize_reading)
                grade_fn(str(attempt_id))
        elif section == "writing":
            _promote_writing_essays(str(sitting["id"]))
        logger.info(
            "[mock-exam] sitting=%s section=%s force-collected", sitting["id"], section,
        )
        # Re-check terminal reconciliation now that this section is in.
        fresh = get_sitting(sitting["id"])
        sections = _sitting_sections(fresh, exam_for_scope) if fresh else []
        if fresh and sections and all(fresh.get(_SUBMITTED_COL[s]) for s in sections):
            # PAST THE POINT OF NO RETURN. Once the sitting is moved to a
            # terminal status the stamp must NEVER be rolled back: an
            # all_submitted row with a cleared final stamp and no review row is
            # unreachable by every repair path (_reconcile_terminal does not
            # come back from all_submitted).
            terminal_started = True
            supabase_admin.table("mock_exam_sittings").update({
                "status": "lrw_submitted",
            }).eq("id", sitting["id"]).execute()
            _reconcile_terminal(sitting["id"], exam_for_scope)
        return True
    except Exception:  # noqa: BLE001
        logger.exception(
            "[mock-exam] force-collect failed sitting=%s section=%s",
            sitting["id"], section,
        )
        # RELEASE THE CLAIM. The stamp is written BEFORE grading / Writing
        # promotion / terminal reconciliation, so a failure after it left the
        # paper looking submitted to every later sweep — which select only null
        # stamps — while nothing had been graded. The monitor showed it in, the
        # recovery button never offered it, and the attempt stayed ungraded
        # forever (Codex review, PR #844). Rolling the stamp back makes the row
        # claimable again, which is what both the retry and the admin's "thu
        # lại" depend on.
        if terminal_started:
            # Leave the stamp. The row is (or is becoming) terminal; clearing it
            # would strand it in a state no repair path can reach. Reconcile is
            # idempotent, so re-running the sweep or the admin's "thu lại" can
            # still finish the job.
            logger.error(
                "[mock-exam] sitting=%s section=%s failed AFTER the terminal "
                "transition — stamp kept, needs a reconcile retry",
                sitting["id"], section,
            )
            return False
        try:
            # MATCH THE EXACT STAMP WE WROTE. An unconditional clear also erased
            # a DIFFERENT writer's successful submit: the student's own
            # submit_section can land between our claim and our failure, and
            # rolling back blindly deleted their real submission — turning the
            # guard that exists to save a paper into the thing that loses one
            # (Codex adversarial review, 2026-07-26).
            supabase_admin.table("mock_exam_sittings").update({col: None}).eq(
                "id", sitting["id"],
            ).eq(col, claimed_at).execute()
        except Exception:  # noqa: BLE001 — nothing further we can do here
            logger.exception(
                "[mock-exam] force-collect: could not release the claim sitting=%s "
                "section=%s — this paper needs manual attention",
                sitting["id"], section,
            )
        # Report the failure so the caller's count reflects papers ACTUALLY
        # taken. Counting unconditionally told the admin "N bài đã thu" for
        # papers still sitting with the student, and the next poll silently
        # contradicted it (Codex review, PR #843).
        return False


def _retake_section_expired(sitting: dict, exam: dict, section: str, grace_seconds: int) -> bool:
    """True once a STARTED retake section has run past its limit + grace. The
    grace lets a still-connected browser auto-submit first (client owns the
    happy path; the reaper is the closed-tab backstop)."""
    started = _parse_ts(sitting.get(f"{section}_started_at"))
    if not started:
        return False
    duration = _section_duration_seconds(exam, section)
    elapsed = (_now() - started).total_seconds()
    return elapsed >= duration + grace_seconds


# PostgREST answers with ONE page and no error when a query outgrows its row
# cap, so any select that can grow with the platform must ask for the next page
# explicitly. `_ID_CHUNK` keeps a generated `in.(...)` list off the URL-length
# limit, which bites earlier than the row cap does.
_PAGE = 1000
_ID_CHUNK = 100


def _paged(build) -> list:
    """Drain every page of `build()` — a zero-arg factory returning a fresh
    query builder (a builder cannot be re-ranged after execute)."""
    out: list = []
    start = 0
    while True:
        page = build().range(start, start + _PAGE - 1).execute().data or []
        out.extend(page)
        if len(page) < _PAGE:
            return out
        start += _PAGE


# Statuses a sitting can be stuck in while its paper is, in fact, fully in.
_STALLED_CANDIDATE = ["registered", "lrw_in_progress", "lrw_submitted",
                      "speaking_pending", "all_submitted"]


def reconcile_stalled_sittings(exam_id: Optional[str] = None) -> dict:
    """Finish sittings whose paper is all in but whose finalisation did not land.

    THE HOLE THIS FILLS (Codex review, PR #853). Collecting a section is one
    stamp, then a status write, then a review insert — three calls, no
    transaction. A failure between them leaves a row that:

      · has every section stamped, so `_force_collect_section` (which selects
        only NULL stamps) cannot see it and `_collect_section_for_sitting`
        returns early on it — no re-sweep and no "thu lại" reaches it; and
      · is not terminal, or is terminal with no review row — so it never
        appears in the admin queue either.

    Nothing in the system moved it after that: not the student (their section
    is stamped), not the sweep, not the admin. The result was released to
    nobody, forever. Three shapes, all repaired here:

      A. every section stamped, status registered/lrw_in_progress — the status
         write failed
      B. every section stamped, status lrw_submitted — reconciliation failed
      C. status all_submitted with no review row — the review insert failed
         (reachable from the student submit paths too, not just the sweep)
      D. status speaking_pending with the speaking stamp already in — the same
         gap on the Speaking path

    Idempotent and cheap when healthy: one paged select plus one batched review
    lookup, and normally nothing to do. Returns {"repaired": n}.
    """
    try:
        def _sittings(_c=None):
            q = supabase_admin.table("mock_exam_sittings").select("*").in_(
                "status", _STALLED_CANDIDATE,
            ).order("id")
            return q.eq("mock_exam_id", str(exam_id)) if exam_id else q
        rows = _paged(_sittings)
    except Exception:  # noqa: BLE001
        logger.exception("[mock-exam] stalled-sitting lookup failed exam=%s", exam_id)
        return {"repaired": 0}
    if not rows:
        return {"repaired": 0}

    exams: dict = {}
    fully_in: list = []
    for row in rows:
        eid = str(row["mock_exam_id"])
        if eid not in exams:
            exams[eid] = get_published_exam_by_id(eid) or {}
        sections = _sitting_sections(row, exams[eid])
        if sections and all(row.get(_SUBMITTED_COL[s]) for s in sections):
            fully_in.append(row)
    if not fully_in:
        return {"repaired": 0}

    # An all_submitted row is only stalled if its review row is MISSING. Asking
    # per sitting would put an N+1 on a timer; one chunked lookup answers for
    # the whole batch. A lookup failure must not be read as "no reviews exist" —
    # that would re-drive every healthy terminal sitting — so bail instead.
    terminal_ids = [str(r["id"]) for r in fully_in if r["status"] == "all_submitted"]
    reviewed: set = set()
    if terminal_ids:
        try:
            for i in range(0, len(terminal_ids), _ID_CHUNK):
                chunk = terminal_ids[i:i + _ID_CHUNK]
                reviewed.update(
                    str(r["sitting_id"]) for r in _paged(
                        lambda c=chunk: supabase_admin.table("mock_exam_reviews")
                        .select("sitting_id").in_("sitting_id", c).order("sitting_id")
                    )
                )
        except Exception:  # noqa: BLE001
            logger.exception("[mock-exam] stalled-sitting review lookup failed")
            return {"repaired": 0}

    repaired = 0
    for row in fully_in:
        if row["status"] == "all_submitted" and str(row["id"]) in reviewed:
            continue                      # healthy — waiting on the admin
        if row["status"] == "speaking_pending" and not row.get("speaking_completed_at"):
            continue                      # healthy — genuinely waiting on Speaking
        # ...but a speaking_pending row whose speaking IS in should have moved:
        # the same three-call gap exists on that path (D). Decided in memory so
        # a class waiting on Speaking costs no queries per tick.
        try:
            if row["status"] in ("registered", "lrw_in_progress"):
                supabase_admin.table("mock_exam_sittings").update({
                    "status": "lrw_submitted",
                }).eq("id", row["id"]).execute()
            _reconcile_terminal(row["id"], exams[str(row["mock_exam_id"])])
            logger.warning(
                "[mock-exam] sitting=%s was stalled at %s with the paper fully in "
                "— finalisation retried", row["id"], row["status"],
            )
            repaired += 1
        except Exception:  # noqa: BLE001 — one bad row must not stop the rest
            logger.exception("[mock-exam] stalled-sitting repair failed sitting=%s", row["id"])
    if repaired:
        logger.info("[mock-exam] reconciled %d stalled sitting(s) exam=%s", repaired, exam_id)
    return {"repaired": repaired}


def reap_expired_retake_sittings(grace_seconds: int = 30) -> dict:
    """Server-side backstop for retake self-timing (no invigilator). For each
    pre-review retake sitting: collect any STARTED section whose per-sitting
    clock ran out (+grace, so a live browser auto-submits first), and — once the
    per-student window has closed — collect every remaining assigned section so
    the sitting finalises even if the student never came back. Idempotent;
    per-sitting failures isolated. Returns {"collected": n, "sittings": m}.

    ALSO runs the platform janitor (reconcile_stalled_sittings) on every tick,
    including the paths that find no retake work — this is the only timer the
    mock subsystem has, and a stranded SEQUENTIAL sitting has nothing else that
    would ever come back for it (Codex review, PR #853)."""
    def _done(collected: int, touched: int) -> dict:
        reconcile_stalled_sittings()
        # ...and free the seats held by rows that will never progress, so the
        # admin console stops listing phantom "registered" students and nobody
        # is locked out of a future exam by one.
        retire_abandoned_sittings()
        return {"collected": collected, "sittings": touched}

    # Narrow at the DATABASE, not in Python. The old sweep pulled EVERY
    # registered/lrw_in_progress sitting across every exam, then did one
    # get_published_exam_by_id per row just to discard the sequential ones —
    # an N+1 whose N is "the whole platform's live sittings", on a timer.
    try:
        retake_exams = {
            e["id"]: e for e in _paged(
                lambda: supabase_admin.table("mock_exams").select("*")
                .eq("exam_mode", "retake").order("id")
            )
        }
    except Exception:  # noqa: BLE001
        logger.exception("[retake-reaper] exam lookup failed")
        return _done(0, 0)
    if not retake_exams:
        return _done(0, 0)

    # Both queries are PAGED, and the id filter is CHUNKED. Unpaginated, the
    # exam lookup silently returns only the first PostgREST page once historical
    # retake definitions pass the row cap — so an active sitting whose exam id
    # fell off the end is never fetched and never finalised. The generated
    # `in.(...)` URL also grows without bound and can be rejected as too long
    # well before that (Codex review, PR #846).
    exam_ids = list(retake_exams)
    rows: list = []
    try:
        for i in range(0, len(exam_ids), _ID_CHUNK):
            chunk = exam_ids[i:i + _ID_CHUNK]
            rows.extend(_paged(
                lambda c=chunk: supabase_admin.table("mock_exam_sittings").select("*")
                .in_("status", ["registered", "lrw_in_progress"])
                .in_("mock_exam_id", c).order("id")
            ))
    except Exception:  # noqa: BLE001
        logger.exception("[retake-reaper] lookup failed")
        return _done(0, 0)

    now = _now()
    collected = 0
    touched = 0
    for sitting in rows:
        # assigned_skills is set only on retake sittings — sequential stragglers
        # are the admin advance-sweep's job, not the reaper's.
        if not sitting.get("assigned_skills"):
            continue
        exam = retake_exams.get(sitting["mock_exam_id"]) or {}
        if not exam:
            continue
        window_until = _parse_ts(sitting.get("retake_open_until"))
        window_closed = bool(window_until and now > window_until)
        did = False
        sections = _sitting_sections(sitting, exam)
        for section in sections:
            if sitting.get(_SUBMITTED_COL[section]):
                continue
            if window_closed or _retake_section_expired(sitting, exam, section, grace_seconds):
                _collect_section_for_sitting(sitting, section, exam)
                collected += 1
                did = True
                sitting = get_sitting(sitting["id"]) or sitting   # refresh for next section's terminal check
        if did:
            touched += 1
        # Retry-reconcile: if a PRIOR pass stamped every assigned section but
        # died before finalising (e.g. an L/R grade write raised after the
        # submitted_at write), this sweep would otherwise `continue` past all
        # sections, never re-finalise, and strand the sitting in lrw_in_progress
        # with no review. Re-run the terminal transition for a fully-stamped but
        # not-yet-terminal sitting.
        elif sections and all(sitting.get(_SUBMITTED_COL[s]) for s in sections) \
                and sitting.get("status") in ("registered", "lrw_in_progress"):
            supabase_admin.table("mock_exam_sittings").update({
                "status": "lrw_submitted",
            }).eq("id", sitting["id"]).execute()
            _reconcile_terminal(sitting["id"], exam)
            touched += 1
    if collected:
        logger.info("[retake-reaper] collected=%d across %d sitting(s)", collected, touched)
    return _done(collected, touched)


def advance_section(exam_id: str, admin_id: str,
                    expected_section: Optional[str] = None) -> dict:
    """Admin advances the shared classroom clock to the NEXT configured section.

    not_started → listening → reading → writing → done (skipping any section
    the exam has no test/prompt for). Every transition out of LRW requires the
    explicit collect flow to have completed its ACK-gated sweep; only then is
    `{next}_started_at` stamped for every sitting's next poll.
    """
    exam = get_published_exam_by_id(exam_id)
    if not exam:
        raise NotFoundError(f"Mock exam {exam_id} không tồn tại.")
    if is_retake(exam):
        # Retake has NO shared clock: each student starts and times each
        # assigned skill themselves. collect_preflight() already refuses this
        # mode; advance did not, so half the gate was missing. The live console
        # hides the button, but a UI is not a guard — a direct API call or a
        # stale admin tab could still walk a retake exam through the sequential
        # state machine and then queue _force_collect_section over it, stamping
        # students' papers outside their own self-timed flow
        # (Codex adversarial review, 2026-07-26).
        raise SittingConflictError(
            "Đề test lại không có phần thi chung để mở — mỗi học viên tự bắt "
            "đầu từng kỹ năng được gán."
        )
    current = exam.get("active_section") or "not_started"
    # `expected_section` is the section the ADMIN was looking at when they
    # clicked. Without it the compare-and-set below only catches requests whose
    # DB reads overlap — two clicks where the first has already committed both
    # read the NEW section and both advance, so the class still skips one.
    # Comparing against the caller's own view turns duplicate user actions into
    # a 409 as well (Codex review, PR #842).
    if expected_section and expected_section != current:
        raise SittingConflictError(
            f"Màn hình của bạn đang hiển thị phần {expected_section!r} nhưng kỳ thi "
            f"đã ở phần {current!r} — có thao tác khác vừa chuyển phần. Tải lại trang."
        )
    if current in _LRW_ORDER and exam.get("collected_section") != current:
        raise SittingConflictError(
            "Phải thu phần thi hiện tại và chờ lưu câu trả lời cuối trước khi "
            "mở phần tiếp theo."
        )
    if (current in _LRW_ORDER
            and exam.get("collection_sweep_completed_section") != current):
        raise SittingConflictError(
            "Hệ thống đang chờ lưu câu trả lời cuối và thu đủ bài của phần này. "
            "Chỉ mở phần tiếp theo sau khi bảng theo dõi xác nhận đã thu xong."
        )
    return _advance_from(exam_id, admin_id, current)


def _advance_from(exam_id: str, admin_id: str, current: str) -> dict:
    """The transition itself, from an EXPLICITLY supplied `current`.

    Split out so the optimistic guard is directly testable: a caller holding a
    stale `current` is exactly the concurrent-advance case, and reproducing it
    with real threads against a fake DB would be flaky theatre. Production
    always reaches here through advance_section, which reads `current` fresh.
    """
    exam = get_published_exam_by_id(exam_id)
    if not exam:
        raise NotFoundError(f"Mock exam {exam_id} không tồn tại.")
    if is_retake(exam):
        # The SAME gate as advance_section, re-asserted on the row this call is
        # actually about to write. advance_section reads the exam, checks the
        # mode, then calls us — and we re-read. `exam_mode` is admin-writable
        # (PATCH /admin/mock-exams/{id}), so a mode flip landing inside that gap
        # passed a check made against the sequential snapshot and then advanced
        # a retake exam anyway (Codex review, PR #851).
        raise SittingConflictError(
            "Đề test lại không có phần thi chung để mở — mỗi học viên tự bắt "
            "đầu từng kỹ năng được gán."
        )
    if current == "done":
        raise SittingConflictError("Kỳ thi đã kết thúc tất cả các phần.")

    paused = exam.get("collected_section") == current
    if current in _LRW_ORDER and not paused:
        raise SittingConflictError(
            "Phải thu phần thi hiện tại và chờ lưu câu trả lời cuối trước khi "
            "mở phần tiếp theo."
        )
    if (current in _LRW_ORDER
            and exam.get("collection_sweep_completed_section") != current):
        raise SittingConflictError(
            "Hệ thống đang chờ lưu câu trả lời cuối và thu đủ bài của phần này. "
            "Chỉ mở phần tiếp theo sau khi bảng theo dõi xác nhận đã thu xong."
        )

    seq = _configured_sections(exam)
    if current == "not_started":
        nxt = seq[0] if seq else "done"
    else:
        if current in seq:
            idx = seq.index(current)
            nxt = seq[idx + 1] if idx + 1 < len(seq) else "done"
        else:
            nxt = "done"

    if nxt in _LRW_ORDER:
        try:
            _require_exam_content_ready(exam, sections=(nxt,))
        except ValueError as exc:
            raise SittingConflictError(str(exc)) from exc

    # Opening the next section ENDS the collected-but-paused state, whatever it
    # was. Leaving it set would keep every sitting created afterwards born with
    # a stale section already stamped submitted.
    update: dict = {
        "active_section": nxt,
        "collected_section": None,
        "collection_sweep_completed_section": None,
    }
    if nxt in _LRW_ORDER:
        update[f"{nxt}_started_at"] = _now_iso()
    elif nxt == "done":
        # The final transition queues a sweep like every other one, so it needs
        # the same grace anchor (mig 167).
        update["done_at"] = _now_iso()
        # ...and it closes the room. Leaving `is_open` true after the last
        # section was the only thing standing between a late arrival and a
        # `registered` sitting on an exam with nothing left to open — a dead row
        # that then holds their one live seat. Closing it here means the
        # invigilator cannot forget (Codex adversarial review, 2026-07-26).
        update["is_open"] = False
    # OPTIMISTIC GUARD (B2). Without `.eq("active_section", current)` two
    # concurrent advances — a double-click, two invigilators, two tabs — both
    # read the same current section and both write. Two failure modes, both
    # silent and both unfair to the class:
    #   · the class skips a whole section, or
    #   · {next}_started_at is re-stamped, RESETTING the countdown and handing
    #     everyone extra time on a section that was already running.
    # Matching on the section we decided from makes the transition win-once.
    #
    # `.neq("exam_mode", "retake")` closes the read-check-write gap for real:
    # the guard above is still a check against a snapshot, so only predicating
    # the WRITE on the mode makes it impossible to advance a row that became a
    # retake in between. The column is NOT NULL DEFAULT 'sequential' (mig 154),
    # so this never silently excludes a legacy row.
    query = supabase_admin.table("mock_exams").update(update).eq(
        "id", str(exam_id),
    ).eq("active_section", current).neq("exam_mode", "retake")
    # Close the collect/advance TOCTOU gap. Every transition out of an LRW
    # section requires BOTH the collected marker and the completed sweep token;
    # direct Advance can therefore never bypass the final-save ACK grace.
    if paused:
        query = query.eq("collected_section", current).eq(
            "collection_sweep_completed_section", current,
        )
    else:
        query = query.is_("collected_section", "null")
    resp = query.execute()
    if not resp.data:
        # Someone else advanced between our read and our write. Report the state
        # that actually holds rather than pretending this call did it.
        fresh = get_published_exam_by_id(exam_id) or {}
        if is_retake(fresh):
            raise SittingConflictError(
                "Đề vừa được chuyển sang chế độ test lại — không còn phần thi "
                "chung để mở. Tải lại trang để xem trạng thái mới nhất."
            )
        if (fresh.get("collected_section") == current
                and fresh.get("collection_sweep_completed_section") != current):
            raise SittingConflictError(
                "Phần thi vừa được thu và vẫn đang đồng bộ câu trả lời cuối. "
                "Chờ xác nhận thu xong trước khi mở phần tiếp theo."
            )
        raise SittingConflictError(
            "Phần thi đã được mở bởi một thao tác khác (hiện đang ở: "
            f"{fresh.get('active_section') or 'không rõ'}). Tải lại trang để xem trạng thái mới nhất."
        )
    logger.info(
        "[mock-exam] exam=%s section %s → %s by admin=%s",
        exam_id, current, nxt, admin_id,
    )
    out = dict(resp.data[0])
    # Collection is now an explicit prerequisite for LRW transitions. The
    # ACK-gated sweep has already completed, so Advance must never queue a
    # second, uncoordinated sweep against the section it just closed.
    out["sweep_section"] = None
    return out


def admin_section_progress(exam_id: str) -> dict:
    """Live per-section submitted/total counts for the admin console — powers
    the "đã nộp X/Y" readout that informs when to advance."""
    exam = get_published_exam_by_id(exam_id)
    if not exam:
        raise NotFoundError(f"Mock exam {exam_id} không tồn tại.")
    rows = supabase_admin.table("mock_exam_sittings").select("*").eq(
        "mock_exam_id", str(exam_id),
    ).neq("status", "void").execute().data or []
    total = len(rows)
    sections: dict = {}
    for s in _LRW_ORDER:
        col = _SUBMITTED_COL[s]
        sections[s] = {
            "submitted": sum(1 for r in rows if r.get(col)),
            "total": total,
        }
    return {"active_section": exam.get("active_section") or "not_started", "sections": sections}


# How long a started-but-silent section goes before the monitor calls it stalled.
# Long enough that a student re-reading a passage isn't flagged, short enough that
# a dropped connection surfaces while the invigilator can still act.
_STALLED_AFTER_SECONDS = 300
# How long after the exam moves on before an uncollected paper is called
# `missed`. The straggler sweep runs in the BACKGROUND (B3), so immediately
# after /advance every not-yet-processed sitting legitimately has no submitted
# stamp — flagging those instantly would raise the interruption banner on every
# normal advance and offer a "Thu lại" that starts a SECOND concurrent sweep
# over the same rows (Codex review, PR #844). Comfortably longer than a sweep
# of a full class, short enough that a genuinely dead sweep still surfaces
# while the invigilator can act.
_SWEEP_GRACE_SECONDS = 180


def _sweep_grace_elapsed(exam: dict, active: str) -> bool:
    """Has the background straggler sweep had time to finish?

    Measured from when the CURRENT section opened, which is the same moment
    /advance queued the sweep for the previous one.
    """
    if active in _LRW_ORDER:
        started = _parse_ts(exam.get(f"{active}_started_at"))
    elif active == "done":
        # 'done' is a real transition with a real time — it just had nowhere to
        # record it until mig 167. Without an anchor this returned True
        # immediately, so a poll taken while the perfectly-healthy FINAL sweep
        # was still running labelled every unprocessed paper 'missed', claimed
        # the sweep had been interrupted, and offered a recollect that would
        # race the sweep still in flight (Codex review, PR #844).
        started = _parse_ts(exam.get("done_at"))
    else:
        started = None
    if not started:
        # Genuinely no anchor: an exam that reached 'done' before mig 167, or a
        # row with no timestamps at all. Don't suppress the verdict forever.
        return True
    return (_now() - started).total_seconds() >= _SWEEP_GRACE_SECONDS


def _seq_index(exam: dict, section: str) -> int:
    """Position of `section` in this exam's configured walk.

    'done' sorts after every real section, 'not_started' before them, so a
    simple `<` comparison answers "has the exam already moved past this?".
    """
    if section == "done":
        return 99
    if section == "not_started":
        return -1
    seq = _configured_sections(exam)
    return seq.index(section) if section in seq else 98


def _expected_roster(exam: dict) -> Optional[dict]:
    """Who is SUPPOSED to sit this exam, or None when that is UNKNOWABLE.

    This is the denominator `admin_section_progress` never had: it counts
    sittings, so a student who never opened the exam is invisible and a class of
    20 where 2 never showed reads as a complete 18/18. Sequential draws the
    roster from the exam's cohort; retake from its assignments.

    Returns {key: {"user_id", "name", "skills"}}. The key is the user_id when the
    student has an account and "student:<id>" when they do not — `students.user_id`
    is NULLABLE by design ("link to user account when student gets login", mig
    033), so a cohort member who has never activated is a REAL roster member.
    Filtering them out reproduced the exact bug this endpoint exists to kill: a
    class of 20 with two unactivated members reported 18 expected and those two
    could never show up as absent.

    None is NOT {}. A sequential exam with no cohort has no knowable roster,
    whereas a cohort with nobody in it is a real (empty) answer. Collapsing the
    two made every genuine sitting classify as off-roster, so the console showed
    "0 đã vào thi" and an outside-the-list warning while the class was actually
    sitting the exam.
    """
    if is_retake(exam):
        rows = supabase_admin.table("mock_exam_assignments").select(
            "user_id, skills",
        ).eq("exam_id", str(exam["id"])).execute().data or []
        return {
            str(r["user_id"]): {"user_id": str(r["user_id"]), "name": None,
                                "skills": r.get("skills") or []}
            for r in rows if r.get("user_id")
        }
    cohort_id = exam.get("cohort_id")
    if not cohort_id:
        return None                      # unknowable — not "nobody"
    rows = supabase_admin.table("students").select("id, user_id, full_name").eq(
        "cohort_id", str(cohort_id),
    ).execute().data or []
    out: dict = {}
    for r in rows:
        uid = r.get("user_id")
        key = str(uid) if uid else f"student:{r['id']}"
        out[key] = {"user_id": str(uid) if uid else None,
                    "name": r.get("full_name"), "skills": None}
    return out


def _answer_progress(rows, answer_key="user_answer", ts_key="answered_at") -> tuple:
    """(answered, last_activity_iso) over a list of persisted answer rows.

    Counts only NON-EMPTY answers — a row exists the moment a field is touched
    and cleared, so counting rows would report progress the student doesn't have.
    """
    answered, last = 0, None
    for r in rows or []:
        if str(r.get(answer_key) or "").strip():
            answered += 1
        ts = r.get(ts_key)
        if ts and (last is None or str(ts) > str(last)):
            last = ts
    return answered, last


def _listening_total_questions(test_id) -> Optional[int]:
    """How many questions a listening test HAS.

    `listening_tests` has NO question-count column and never has — mig 065
    defines the bundle (test_id/title/themes/…) and the `total_questions` in mig
    056 belongs to `listening_sessions`, a different table. Reading a phantom
    column made PostgREST answer 42703 ("column … does not exist"), which is an
    exception, not an empty result — so the invigilator console 500'd on EVERY
    exam that had a listening test (2026-07-26).

    Counted from the SAME answer key the grader uses, so the denominator can
    never disagree with the graded total, and it stays right for a mini-test /
    drill instead of assuming the Cambridge 40. Two queries per EXAM (not per
    student). None when it cannot be determined — the console renders "12"
    instead of "12/40" rather than failing.
    """
    if not test_id:
        return None
    try:
        from services import listening_test_grader as grader
        section_ids = [r["id"] for r in (
            supabase_admin.table("listening_content").select("id")
            .eq("test_id", str(test_id)).execute().data or []
        )]
        if not section_ids:
            return None
        rows = (supabase_admin.table("listening_exercises").select("payload")
                .in_("content_id", section_ids).execute().data or [])
        return len(grader.collect_answer_key(rows)) or None
    except Exception:  # noqa: BLE001 — a denominator is never worth a 500
        logger.warning("[mock-exam] listening total lookup failed test=%s", test_id)
        return None


def _reading_total_questions(test_id) -> Optional[int]:
    """Reading's counterpart. `reading_tests.total_questions` IS a real column
    (mig 086), but the read is guarded all the same: this powers a live console
    polled every few seconds during an exam, and no denominator is worth taking
    the whole board down for."""
    if not test_id:
        return None
    try:
        row = supabase_admin.table("reading_tests").select("total_questions").eq(
            "id", str(test_id)).limit(1).execute().data or []
        return (row[0].get("total_questions") if row else None) or None
    except Exception:  # noqa: BLE001
        logger.warning("[mock-exam] reading total lookup failed test=%s", test_id)
        return None


def _sitting_recency(s: dict) -> tuple:
    """Sort key that picks the sitting the invigilator actually means: a
    not-yet-released attempt always beats a released one, then newest wins."""
    return (0 if s.get("status") == "released" else 1,
            str(s.get("created_at") or ""))


def admin_live_monitor(exam_id: str) -> dict:
    """Per-STUDENT live state for the invigilator console (one poll, no N+1).

    `admin_section_progress` answers "how many submitted" and nothing else — it
    cannot say who is still working, who is sitting on a blank paper, who
    dropped off, or who never arrived. This does, for the whole roster at once:

      · the shared section clock (what's open, how long is left)
      · the expected roster vs who actually opened a sitting
      · per section per student: submitted / working / waiting, how many answers
        the SERVER holds, and when the last one landed

    Everything is read from persisted state — no new client telemetry — so a
    student whose browser is gone still reports truthfully (their answer count
    simply stops moving, which is exactly the signal the invigilator needs).
    """
    exam = get_published_exam_by_id(exam_id)
    if not exam:
        raise NotFoundError(f"Mock exam {exam_id} không tồn tại.")
    retake = is_retake(exam)
    active = exam.get("active_section") or "not_started"

    rows_raw = supabase_admin.table("mock_exam_sittings").select("*").eq(
        "mock_exam_id", str(exam_id),
    ).neq("status", "void").execute().data or []
    # A student CAN hold more than one non-void sitting for the same exam: the
    # one-live-per-user index only covers registered/lrw_in_progress, so an
    # already-released attempt sits alongside a fresh one. An unordered dict
    # comprehension kept whichever row PostgREST returned last, so the console
    # could show the OLD released attempt's answers and submission stamps while
    # the student is mid-exam. Pick deterministically (Codex review, PR #833).
    by_user: dict = {}
    for s in rows_raw:
        uid = str(s["user_id"])
        cur = by_user.get(uid)
        if cur is None or _sitting_recency(s) > _sitting_recency(cur):
            by_user[uid] = s
    sittings = list(by_user.values())

    # ── batched lookups (never per student) ──────────────────────────
    l_ids = [s["listening_attempt_id"] for s in sittings if s.get("listening_attempt_id")]
    r_ids = [s["reading_attempt_id"] for s in sittings if s.get("reading_attempt_id")]
    l_attempts = {}
    if l_ids:
        l_attempts = {r["id"]: r for r in (supabase_admin.table(
            "listening_test_attempts").select("id, status, answers")
            .in_("id", l_ids).execute().data or [])}
    r_attempts, r_answers = {}, {}
    if r_ids:
        r_attempts = {r["id"]: r for r in (supabase_admin.table(
            "reading_test_attempts").select("id, status")
            .in_("id", r_ids).execute().data or [])}
        for row in (supabase_admin.table("reading_attempt_answers")
                    .select("attempt_id, user_answer, answered_at")
                    .in_("attempt_id", r_ids).execute().data or []):
            r_answers.setdefault(str(row["attempt_id"]), []).append(row)

    totals = {
        "listening": _listening_total_questions(exam.get("listening_test_id")),
        "reading":   _reading_total_questions(exam.get("reading_test_id")),
    }

    roster = _expected_roster(exam)
    roster_known = roster is not None
    roster = roster or {}
    from services.mock_review_workflow import resolve_display_names
    # Only real account ids can be resolved against `users`; an unactivated
    # cohort member has no row there and carries students.full_name instead.
    names = resolve_display_names(
        {e["user_id"] for e in roster.values() if e.get("user_id")} | set(by_user)
    )

    now = _now()
    speaking_required = bool(exam.get("speaking_topic_set")) and not retake

    def _section_state(sitting, section):
        """One student's state in one section — persisted facts only."""
        if not sitting:
            return {"state": "absent", "answered": None, "total": totals.get(section),
                    "submitted_at": None, "last_activity_at": None, "live": True}
        if sitting.get(_SUBMITTED_COL[section]):
            state = "submitted"
        elif retake:
            state = "working" if sitting.get(f"{section}_started_at") else "waiting"
        elif active == section:
            state = "working"
        elif (_seq_index(exam, section) < _seq_index(exam, active)
              and _sweep_grace_elapsed(exam, active)):
            # The exam moved PAST this section, the sweep has had time to run,
            # and still no paper was taken — so the sweep died (a restart
            # mid-task). "waiting" would read as "not their turn yet", the
            # opposite of the truth, and would hide recoverable lost work.
            state = "missed"
        else:
            state = "waiting"

        answered = last = None
        live = True
        if section == "listening":
            att = l_attempts.get(str(sitting.get("listening_attempt_id") or ""))
            if att:
                answered, last = _answer_progress(att.get("answers") or [])
            elif state == "working":
                # In the open section with NO attempt bound: the runner is still
                # loading, or attempt creation failed. Either way the server
                # holds nothing for them. Leaving this None hid exactly this
                # student from the "trắng" filter, which only matches 0 — so the
                # one person who most needs checking on was the one the
                # invigilator could not see (Codex review, PR #833).
                answered = 0
        elif section == "reading":
            aid = str(sitting.get("reading_attempt_id") or "")
            if aid in r_attempts:
                answered, last = _answer_progress(r_answers.get(aid, []))
            elif state == "working":
                answered = 0
        else:
            # Writing autosaves to the server during the section (A2), so the
            # word count IS live now — `answered` is words, not questions, and
            # `total` stays None because Writing has no denominator.
            ws = (sitting.get("writing_submission") or {})
            if ws:
                answered = sum(int((ws.get(t) or {}).get("word_count") or 0)
                               for t in ("task1", "task2"))
                # The autosave stamps submitted_at on each task blob every time,
                # so the later of the two IS the last keystroke that reached us —
                # the same "have they gone quiet" signal L/R get from answered_at.
                last = max(
                    (str((ws.get(t) or {}).get("submitted_at") or "")
                     for t in ("task1", "task2")),
                    default="",
                ) or sitting.get("writing_submitted_at")
            else:
                # Nothing has arrived yet. 0 words is the truth once autosave is
                # running, but only after the student has actually been in the
                # section — before that there is simply no signal.
                answered = 0 if state == "working" else None

        stalled = bool(
            state == "working" and live and last
            and (now - (_parse_ts(last) or now)).total_seconds() > _STALLED_AFTER_SECONDS
        )
        return {
            "state": state, "answered": answered, "total": totals.get(section),
            "submitted_at": sitting.get(_SUBMITTED_COL[section]),
            "last_activity_at": last, "live": live, "stalled": stalled,
        }

    students = []
    # Roster keys are user_ids for activated students and "student:<id>" for
    # cohort members with no account; sitting keys are always user_ids, so a
    # roster member who HAS an account collapses onto the same key as their
    # sitting and is listed once.
    for key in set(roster) | set(by_user):
        entry = roster.get(key) or {}
        uid = entry.get("user_id") if key in roster else key
        sitting = by_user.get(uid) if uid else None
        assigned = (sitting.get("assigned_skills") if sitting else None) \
            or entry.get("skills")
        mine = ([s for s in _LRW_ORDER if s in (assigned or [])] if retake
                else _configured_sections(exam))
        sections = {s: _section_state(sitting, s) for s in mine}
        students.append({
            "user_id":       uid,
            # An unactivated cohort member has no `users` row, so their name
            # comes off the students record instead of resolving to "—".
            "student_name":  names.get(uid) or entry.get("name") or "—",
            "sitting_id":    (sitting or {}).get("id"),
            "status":        (sitting or {}).get("status") or "chưa vào",
            "started":       bool(sitting),
            # A sitting from someone outside the cohort/assignment list — they
            # are doing the exam but nobody put them on the roster. When the
            # roster is UNKNOWN nobody can be classified as outside it, so
            # everyone counts as in — otherwise a no-cohort exam reports zero
            # arrivals while the class is sitting it.
            "in_roster":     (not roster_known) or (key in roster),
            "assigned_skills": assigned,
            "sections":      sections,
            "speaking": {
                "required":  speaking_required,
                "count":     len((sitting or {}).get("speaking_session_ids") or []),
                "completed_at": (sitting or {}).get("speaking_completed_at"),
            },
            "needs_retest":  bool((sitting or {}).get("needs_retest")),
            # Soft signals from the runner. Surfaced here rather than written and
            # forgotten — a column nobody reads is exactly the criticism that
            # produced the pacing page. Informational: never a penalty.
            "integrity":     {
                k: v for k, v in ((sitting or {}).get("integrity") or {}).items()
                if k in _INTEGRITY_COUNTERS and v
            },
        })
    students.sort(key=lambda r: (r["student_name"] or "").lower())

    section_rollup = {}
    for s in _configured_sections(exam):
        rows = [st["sections"].get(s) for st in students if st["sections"].get(s)]
        section_rollup[s] = {
            "submitted": sum(1 for r in rows if r["state"] == "submitted"),
            "working":   sum(1 for r in rows if r["state"] == "working"),
            "absent":    sum(1 for r in rows if r["state"] == "absent"),
            # Papers the exam moved past without ever taking in — a sweep that
            # died. The console offers a re-collect for exactly this.
            "missed":    sum(1 for r in rows if r["state"] == "missed"),
            "expected":  len(rows),
        }

    return {
        "exam": {
            "id": exam["id"], "code": exam.get("code"), "title": exam.get("title"),
            "exam_mode": exam.get("exam_mode") or "sequential",
            "status": exam.get("status"), "is_open": bool(exam.get("is_open")),
            "active_section": active,
            # The pause between "thu bài" and "mở phần sau". active_section is
            # deliberately unchanged during it, so without this the console kept
            # rendering AND TICKING the collected section's clock — contradicting
            # the clock-free break it had just told the invigilator about
            # (Codex review, PR #843).
            "collected_section": exam.get("collected_section"),
            # A collected marker closes the paper immediately; this second
            # token becomes equal only after the ACK-gated background sweep
            # has finished. The console uses the distinction to keep Advance
            # disabled while final client saves are still being coordinated.
            "collection_sweep_completed_section": exam.get(
                "collection_sweep_completed_section"
            ),
            "section_started_at": exam.get(f"{active}_started_at") if active in _LRW_ORDER else None,
            "section_duration_seconds": (
                _section_duration_seconds(exam, active) if active in _LRW_ORDER else None),
            # None while paused: there is no running clock to report.
            "section_time_left_seconds": (
                None if exam.get("collected_section") == active
                else section_time_remaining_seconds(exam, active)),
            "configured_sections": _configured_sections(exam),
            "cohort_id": exam.get("cohort_id"),
        },
        "roster": {
            # None (not 0) when the exam has no cohort — "unknown" and "nobody"
            # are different answers to "how many should be here". An EMPTY
            # cohort is a real 0 and must not be reported as unknown.
            "expected":   len(roster) if roster_known else None,
            # Counted over ROSTER MEMBERS only. Including an off-roster sitting
            # here would inflate `started` against an `expected` that never
            # contained them, and the console renders the difference as "vắng" —
            # a walk-in would silently cancel out a genuine absentee.
            "started":    sum(1 for s in students if s["started"] and s["in_roster"]),
            "not_started": [s["student_name"] for s in students
                            if not s["started"] and s["in_roster"]],
            "off_roster": [s["student_name"] for s in students if not s["in_roster"]],
        },
        "sections":  section_rollup,
        "students":  students,
        "server_time": _now_iso(),
    }


# A gap this long between two answers is a pause worth showing the teacher —
# short enough to catch a stall, long enough not to flag normal reading.
_PACING_LONG_GAP_SECONDS = 90
# Answers landing in the closing minutes: the shape of a rushed finish.
_PACING_TAIL_SECONDS = 300


def _section_total(exam: dict, section: str, *, fallback: int = 0):
    """How many questions this section HAS — from the test definition.

    `grading_details` was the old source, and it is populated only on
    submission. The primary caller is the live console, i.e. a student who is
    still working: their attempt has answers and an empty grading_details, so
    the page rendered "17" instead of "17/40" for the whole section (Codex
    review, PR #848). The graded length stays as the fallback for an attempt
    whose test row has since gone.

    Shares its sources with the live console. This used to select
    `total_questions` off `listening_tests` too — a column that does not exist —
    so Listening silently fell through to the graded length here (the same read
    that DID 500 the console, only swallowed). Same bug, quieter symptom.
    """
    lookup = {"listening": (_listening_total_questions, "listening_test_id"),
              "reading":   (_reading_total_questions, "reading_test_id")}.get(section)
    if lookup:
        fn, col = lookup
        total = fn(exam.get(col))
        if total:
            return total
    return fallback or None


def sitting_pacing(sitting_id: str) -> dict:
    """How a student SPENT the exam, reconstructed from data already stored.

    Every answer write stamps `answered_at` — Listening on the attempt's JSONB
    array, Reading on reading_attempt_answers (mig 088). Nobody has ever read
    them. Together they give the order answers actually landed in, the pauses
    between them, and where the work stopped.

    HONEST LIMITS, because this is a teaching tool and a misread would be worse
    than no tool:
      · answered_at is OVERWRITTEN on each save, so it is the LAST touch of a
        question, not the first. Order here is "order last worked on", which is
        why revisiting shows up as a paper-order mismatch rather than a count.
      · `gap_seconds` is therefore time-since-the-previous-answer-landed, not
        time-spent-thinking-about-this-question. It brackets it; it isn't it.
      · A student who answered nothing leaves no trace at all — absence of
        timeline is not evidence of absence of effort.
    """
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    exam = get_published_exam_by_id(sitting["mock_exam_id"]) or {}
    retake = is_retake(exam)

    from services.mock_review_workflow import resolve_display_names
    names = resolve_display_names([sitting.get("user_id")])

    def _section_window(section):
        """(started_at, ended_at) for this section — per-exam for a sequential
        sitting (one classroom clock), per-sitting for a retake."""
        started = _parse_ts(
            sitting.get(f"{section}_started_at") if retake
            else exam.get(f"{section}_started_at")
        )
        ended = _parse_ts(sitting.get(_SUBMITTED_COL[section]))
        return started, ended

    def _timeline(stamps, section, answered=None):
        """[{q_num, at, gap_seconds, is_answered}] in the order the saves landed.

        `stamps` is (q_num, answered_at, is_answered). The flag rides along
        because the timeline counts every timestamped save — clearing a field IS
        activity, and dropping those made the last touch look older than it was
        — while the KPIs that mean "an answer" must not count a blank.
        """
        started, ended = _section_window(section)
        rows = sorted(
            ((q, _parse_ts(at), bool(ok)) for q, at, ok in stamps if at),
            key=lambda r: r[1],
        )
        out, prev = [], started
        for q, at, ok in rows:
            gap = int((at - prev).total_seconds()) if prev else None
            out.append({"q_num": q, "at": at.isoformat(), "gap_seconds": gap,
                        "is_answered": ok})
            prev = at
        summary = {
            "started_at":  started.isoformat() if started else None,
            "ended_at":    ended.isoformat() if ended else None,
            "answered":    len(out) if answered is None else answered,
            "total":       None,
            "timeline":    out,
            # Answers landing in the closing minutes — the shape of a rushed
            # finish, which a raw score never shows. Counts only saves that left
            # an ANSWER behind: a field cleared in the last five minutes is
            # activity for the timeline but is not an answer, and counting it
            # incremented "Đáp án 5 phút cuối" past what `answered` allows
            # (Codex review, PR #848).
            "answers_in_final_minutes": (
                sum(1 for r in out
                    if r["is_answered"]
                    and ended and (ended - _parse_ts(r["at"])).total_seconds() <= _PACING_TAIL_SECONDS)
                if ended else None
            ),
            # Where the work stopped relative to the section end. A big number
            # means they gave up (or dropped off) well before time.
            "idle_tail_seconds": (
                int((ended - _parse_ts(out[-1]["at"])).total_seconds())
                if (ended and out) else None
            ),
            "long_gaps": [r for r in out
                          if r["gap_seconds"] and r["gap_seconds"] >= _PACING_LONG_GAP_SECONDS],
            # Did they work straight down the paper, or jump around? Jumping is
            # not bad in itself — it is how a strong candidate skips and returns
            # — but it is invisible in the score.
            #
            # None, not True, for an empty timeline: comparing two empty lists
            # is trivially equal, so a sitting with no timestamped answers
            # rendered "Làm theo thứ tự đề: Có" right beside its own message
            # that nothing was saved. With no observations the order is UNKNOWN
            # (Codex review, PR #848).
            "worked_in_paper_order": (
                ([r["q_num"] for r in out] == sorted(r["q_num"] for r in out))
                if out else None
            ),
        }
        return summary

    sections: dict = {}

    # EVERY assigned L/R section gets an entry, attempt or no attempt. Creating
    # them only when an attempt id exists made an assigned section VANISH from
    # the page when the attempt had not been created yet — or its creation
    # failed, a state admin_live_monitor() explicitly supports — so an L/R-only
    # retake could open a completely blank pacing page instead of saying that no
    # answers were saved (Codex review, PR #848).
    for _sec in _sitting_sections(sitting, exam):
        if _sec in ("listening", "reading"):
            sections[_sec] = _timeline([], _sec, answered=0)
            sections[_sec]["total"] = _section_total(exam, _sec)

    lid = sitting.get("listening_attempt_id")
    if lid:
        rows = supabase_admin.table("listening_test_attempts").select(
            "answers, grading_details",
        ).eq("id", str(lid)).limit(1).execute().data or []
        answers = (rows[0].get("answers") or []) if rows else []
        # Every timestamped save is activity, INCLUDING clearing an answer:
        # both save paths persist the empty value with a fresh answered_at.
        # Filtering those out made the last touch look older than it was,
        # inflated idle_tail_seconds, hid a long gap, and reconstructed the
        # wrong work order (Codex review, PR #848). The answered COUNT still
        # counts only non-empty values.
        sections["listening"] = _timeline(
            [(a.get("q_num"), a.get("answered_at"),
              bool(str(a.get("user_answer") or "").strip()))
             for a in answers if a.get("answered_at")],
            "listening",
            answered=sum(1 for a in answers if str(a.get("user_answer") or "").strip()),
        )
        sections["listening"]["total"] = _section_total(
            exam, "listening",
            fallback=len(rows[0].get("grading_details") or []) if rows else 0,
        )

    rid = sitting.get("reading_attempt_id")
    if rid:
        rows = supabase_admin.table("reading_attempt_answers").select(
            "q_num, user_answer, answered_at",
        ).eq("attempt_id", str(rid)).execute().data or []
        sections["reading"] = _timeline(
            [(r.get("q_num"), r.get("answered_at"),
              bool(str(r.get("user_answer") or "").strip()))
             for r in rows if r.get("answered_at")],
            "reading",
            answered=sum(1 for r in rows if str(r.get("user_answer") or "").strip()),
        )
        att = supabase_admin.table("reading_test_attempts").select(
            "grading_details",
        ).eq("id", str(rid)).limit(1).execute().data or []
        sections["reading"]["total"] = _section_total(
            exam, "reading",
            fallback=len(att[0].get("grading_details") or []) if att else 0,
        )

    # Writing has no per-question stamps; what it has (since A2) is an autosaved
    # draft with a word count and a last-saved time per task.
    #
    # A retake may be assigned Listening and/or Reading only — assigned_skills
    # is the canonical retake scope (_sitting_sections). Rendering a blank
    # Writing block for those students told the teacher they were missing work
    # nobody ever asked them for (Codex review, PR #848).
    if retake and "writing" not in (sitting.get("assigned_skills") or []):
        return _pacing_payload(sitting, exam, names, sections)

    ws = sitting.get("writing_submission") or {}
    w_started, w_ended = _section_window("writing")
    sections["writing"] = {
        "started_at": w_started.isoformat() if w_started else None,
        "ended_at":   w_ended.isoformat() if w_ended else None,
        "tasks": [
            {
                "task": t,
                "word_count":   (ws.get(t) or {}).get("word_count"),
                "last_saved_at": (ws.get(t) or {}).get("submitted_at"),
            }
            for t in ("task1", "task2")
        ],
    }

    return _pacing_payload(sitting, exam, names, sections)


def _pacing_payload(sitting: dict, exam: dict, names: dict, sections: dict) -> dict:
    return {
        "sitting_id":   str(sitting["id"]),
        "student_name": names.get(str(sitting.get("user_id")), "—"),
        "exam_code":    exam.get("code"),
        "status":       sitting.get("status"),
        # The exam this sitting belongs to, so a page linking BACK to the live
        # console can return to the same classroom instead of whichever exam
        # happens to be first in the list (Codex review, PR #848).
        "exam_id":      str(sitting.get("mock_exam_id")),
        "sections":     sections,
        # Stated in the payload so a UI cannot quietly present these as exact
        # per-question think-time.
        "caveats": {
            "answered_at_is_last_touch": True,
            "gap_is_time_since_previous_answer": True,
        },
    }


def live_exams_using(kind: str, content_id) -> list[dict]:
    """Kỳ thi CHƯA lưu trữ đang dùng nội dung này — [{id, code}].

    Powers the refusal when an admin tries to hand a reserved paper back to the
    student library. Returning the exams, not a bool, is the point: "không trả
    về được" with no reason makes the admin guess which exam to archive first.

    ARCHIVED exams deliberately do NOT count (decided 2026-07-27). That means a
    paper from a finished, archived exam CAN go back to the library — and the
    next cohort could then practise exactly what the last one sat. The button
    says so before it acts; the decision to allow it is the operator's.

    Fail CLOSED: unable to prove nothing is using it is not the same as proving
    nothing is.
    """
    col = {
        "reading":   ("reading_test_id",),
        "listening": ("listening_test_id",),
        "writing":   ("writing_task1_prompt_id", "writing_task2_prompt_id"),
    }.get(kind)
    if not col or not content_id:
        raise ValueError(f"kind không hợp lệ: {kind!r}")
    try:
        rows = supabase_admin.table("mock_exams").select(
            "id, code, status, " + ", ".join(col),
        ).neq("status", "archived").execute().data or []
    except Exception as exc:  # noqa: BLE001
        logger.exception("[mock-exam] live-exam lookup failed %s/%s", kind, content_id)
        raise MockExamError(
            "Không kiểm tra được đề này có đang dùng cho kỳ thi nào không — "
            "chưa trả về thư viện được. Thử lại sau giây lát."
        ) from exc
    return [
        {"id": r["id"], "code": r.get("code")}
        for r in rows
        if any(str(r.get(c) or "") == str(content_id) for c in col)
    ]


def assert_can_unreserve(kind: str, content_id) -> None:
    """Raise if handing this content back to the library would pull a paper out
    from under a live exam."""
    live = live_exams_using(kind, content_id)
    if live:
        names = ", ".join(x["code"] or x["id"] for x in live)
        raise SittingConflictError(
            f"Không trả về thư viện được: đề này đang được kỳ thi {names} sử dụng. "
            "Lưu trữ kỳ thi đó trước, hoặc đổi đề của kỳ thi."
        )


def reserved_test_ids(kind: str) -> set:
    """Reading/listening test ids assigned to any non-archived mock exam.

    Used ONLY to hide those tests from the normal student reading/listening
    practice lists, so students can't self-practice on content that's staged
    as an upcoming mock exam. This does NOT make a test exclusive to one mock
    exam — the same reading test may be assigned to several mock exams, so the
    admin create-exam picker (admin_available_reading_tests) deliberately
    ignores this set (2026-07-12)."""
    col = {"reading": "reading_test_id", "listening": "listening_test_id"}.get(kind)
    if not col:
        return set()
    # Fail-open: if the reservation lookup errors, don't break the practice list —
    # a reserved test may momentarily show, which is far better than a 500.
    try:
        resp = supabase_admin.table("mock_exams").select(col).neq(
            "status", "archived",
        ).execute()
    except Exception:  # noqa: BLE001
        logger.warning("[mock-exam] reserved_test_ids lookup failed for %s", kind)
        return set()
    return {str(r[col]) for r in (resp.data or []) if r.get(col)}


def _sitting_may_open_section(sitting: dict, exam: dict, section: str) -> bool:
    """Is THIS section open to THIS sitting right now?

    Holding a sitting is not the same as being entitled to every paper the exam
    binds. A sequential student who has merely registered could otherwise fetch
    the Reading passages while the room is still on Listening, and a retake
    student assigned only Writing could fetch the Listening test they were never
    given (Codex review, PR #862).

    Three ways in, and only three:
      · the section is ALREADY SUBMITTED — they sat it, reviewing it is the point;
      · RETAKE — the skill is assigned AND they have started it;
      · SEQUENTIAL — the invigilator has opened this exact section.

    A released/reviewed sitting reaches this through the submitted branch, which
    is what keeps "look at my own finished paper" working.
    """
    col = _SUBMITTED_COL.get(section)
    if not col:
        return False
    if sitting.get(col):
        return True
    # Everything BELOW this line is "not submitted yet", i.e. a paper the student
    # has not earned the right to keep. That needs a LIVE exam, not just a
    # matching field: mig 170 deliberately backfilled archived exams' content and
    # `status` is admin-writable, so an archived or abandoned exam left sitting at
    # active_section='reading' would go on handing out its paper forever (Codex
    # adversarial review, 2026-07-26). A submitted section is unaffected — it
    # returned True above, which is what keeps review working after archiving.
    if (exam.get("status") or "draft") != "published":
        return False
    if is_retake(exam):
        if section not in _sitting_sections(sitting, exam):
            return False
        return bool(sitting.get(f"{section}_started_at"))
    return (exam.get("active_section") or "not_started") == section


def user_may_open_exam_content(user_id, kind: str, test_id) -> bool:
    """May THIS student open a test reserved for mock exams (mig 170)?

    Yes exactly when they hold a sitting on an exam that uses it. The mock
    runner loads Reading/Listening through the ORDINARY student endpoints
    (/pages/reading-exam.html?test_id=…&mock_embed=1), so a blanket 404 on an
    exam_only test would break the exam itself — the very thing the flag exists
    to protect. The sitting IS the entitlement.

    Voided sittings do not count: a cancelled exam grants nothing. Released ones
    DO — a student reviewing their own finished paper is the intended use.

    Fail CLOSED. If the lookup errors we cannot prove the student is entitled,
    and serving a reserved paper to someone who might not be is the failure that
    matters here; the practice library has other content while it recovers.
    """
    col = {"reading": "reading_test_id", "listening": "listening_test_id"}.get(kind)
    if not col or not user_id or not test_id:
        return False
    try:
        exams = {
            e["id"]: e for e in (
                supabase_admin.table("mock_exams").select("*").eq(
                    col, str(test_id),
                ).execute().data or []
            )
        }
        if not exams:
            return False
        rows = supabase_admin.table("mock_exam_sittings").select("*").eq(
            "user_id", str(user_id),
        ).in_("mock_exam_id", list(exams)).neq(
            "status", "void",
        ).execute().data or []
        return any(
            _sitting_may_open_section(r, exams.get(r.get("mock_exam_id")) or {}, kind)
            for r in rows
        )
    except Exception:  # noqa: BLE001
        logger.warning(
            "[mock-exam] exam-content entitlement lookup failed user=%s %s=%s",
            user_id, kind, test_id,
        )
        return False


def admin_available_reading_tests() -> list[dict]:
    """Published, non-mini reading tests for the create-exam picker.

    Unlike the student browse endpoint (reading_student.list_reading_tests),
    this intentionally does NOT exclude reading_test_ids already reserved by
    another mock exam — a reading test may be reused across multiple mock
    exams (2026-07-12)."""
    res = (
        supabase_admin.table("reading_tests")
        .select(
            "id,test_id,title,module,time_limit_minutes,passage_count,"
            "total_questions,band_target,metadata",
        )
        .eq("status", "published")
        # Mig 158 — test_type là cột thật (NOT NULL, full|mini); mini mới
        # không còn stamp metadata nên phải lọc trên cột.
        .eq("test_type", "full")
        .order("created_at", desc=True)
        .execute()
    )
    return res.data or []
