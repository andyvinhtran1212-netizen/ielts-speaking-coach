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
        "exam_mode, is_open",
    ).eq("status", "published").execute()
    assigned = _retake_assigned_exam_ids(user_id)
    out = []
    for e in (resp.data or []):
        if is_retake(e):
            if e["id"] not in assigned:
                continue
        else:
            if not e.get("is_open"):
                continue
            if e.get("cohort_id") and not _user_in_cohort(user_id, e["cohort_id"]):
                continue
        out.append({k: v for k, v in e.items() if k not in ("cohort_id", "is_open")})
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


def _user_in_cohort(user_id: str, cohort_id: str) -> bool:
    resp = supabase_admin.table("students").select("cohort_id").eq(
        "user_id", str(user_id),
    ).execute()
    return any(str(r.get("cohort_id")) == str(cohort_id) for r in (resp.data or []))


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
        return existing.data[0]

    # NEW sitting only: apply the entry gates.
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
        _assert_window_open(exam)
        if exam.get("cohort_id") and not _user_in_cohort(user_id, exam["cohort_id"]):
            raise NotEligibleError("Bạn không thuộc lớp được mở kỳ thi này.")

    inserted = supabase_admin.table("mock_exam_sittings").insert(new_row).execute()
    if not inserted.data:
        raise MockExamError(f"Không tạo được sitting cho exam={code}.")
    logger.info(
        "[mock-exam] created sitting=%s user=%s exam=%s",
        inserted.data[0]["id"], user_id, code,
    )
    return inserted.data[0]


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
        prev = supabase_admin.table(domain_table).select("status").eq(
            "id", str(existing),
        ).limit(1).execute()
        if prev.data and prev.data[0].get("status") == "submitted":
            raise SittingConflictError(
                f"Phần {section} đã nộp — không thể thay bài làm khác."
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


def _word_count(text: str) -> int:
    return len((text or "").split())


def submit_writing(
    sitting_id: str, user_id: str, task1_text: str, task2_text: str,
) -> dict:
    """Store the two essay texts on the sitting (P1 native writing capture).

    Does NOT stamp writing_submitted_at — call submit_section("writing") to
    finalise. Sealed by construction: the text lives on the sitting
    (admin-only); the student sees no band until release.
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

    now = _now_iso()
    submission = {
        "task1": {"text": task1_text or "", "word_count": _word_count(task1_text),
                  "submitted_at": now},
        "task2": {"text": task2_text or "", "word_count": _word_count(task2_text),
                  "submitted_at": now},
    }
    resp = supabase_admin.table("mock_exam_sittings").update({
        "writing_submission": submission,
    }).eq("id", str(sitting_id)).execute()
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
    ).execute()
    logger.info("[mock-exam] sitting=%s retake section=%s started", sitting_id, section)
    return resp.data[0] if resp.data else {**sitting, **updates}


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
        sitting = submit_writing(sitting_id, user_id, task1_text, task2_text)
    else:
        _assert_prior_section_submitted(sitting, section)

    now = _now_iso()
    supabase_admin.table("mock_exam_sittings").update({col: now}).eq(
        "id", str(sitting_id),
    ).execute()
    sitting = {**sitting, col: now}
    if section == "writing":
        _promote_writing_essays(sitting_id)
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


def _reconcile_terminal(sitting_id: str) -> dict:
    """Flip to all_submitted (+ create review) once LRW and speaking are both in.

    Order-independent: whether speaking came first or LRW first, this converges.
    Never downgrades a sitting already claimed for review or beyond.
    """
    sitting = get_sitting(sitting_id)
    if not sitting or sitting["status"] not in _PRE_REVIEW:
        return sitting or {}

    # "LRW done" = every section THIS sitting must do is submitted. For retake
    # that's the assigned skills (a retaker may do only Writing, or only L+R);
    # for sequential it's the exam's configured sections. Keying on the writing
    # column alone would be wrong for a retaker not assigned Writing.
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
        # Idempotent — safe if a retry lands here twice.
        from services import mock_review_workflow  # local import avoids cycle
        try:
            ai_draft = assemble_ai_draft(sitting)
        except Exception:  # noqa: BLE001 — drafting must never block finalisation
            logger.exception("[mock-exam] ai_draft assembly failed sitting=%s", sitting_id)
            ai_draft = {}
        mock_review_workflow.create_review(sitting["id"], ai_draft=ai_draft)
        logger.info("[mock-exam] sitting=%s all_submitted → review queued", sitting_id)
    return sitting


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


def admin_create_exam(payload: dict, created_by: str) -> dict:
    row = {k: v for k, v in payload.items() if k in _EXAM_WRITABLE}
    if not row.get("code") or not row.get("title"):
        raise ValueError("code và title là bắt buộc.")
    row["created_by"] = str(created_by)
    inserted = supabase_admin.table("mock_exams").insert(row).execute()
    if not inserted.data:
        raise MockExamError("Không tạo được mock exam.")
    return inserted.data[0]


def admin_update_exam(exam_id: str, patch: dict) -> dict:
    upd = {k: v for k, v in patch.items() if k in _EXAM_WRITABLE}
    if not upd:
        raise ValueError("Không có trường hợp lệ để cập nhật.")
    resp = supabase_admin.table("mock_exams").update(upd).eq(
        "id", str(exam_id),
    ).execute()
    if not resp.data:
        raise NotFoundError(f"Mock exam {exam_id} không tồn tại.")
    return resp.data[0]


def admin_list_sittings(exam_id: str) -> list[dict]:
    resp = supabase_admin.table("mock_exam_sittings").select("*").eq(
        "mock_exam_id", str(exam_id),
    ).order("created_at", desc=True).execute()
    return resp.data or []


def void_sitting(sitting_id: str, admin_id: str, reason: str = "") -> dict:
    """Admin voids a sitting (tech failure / retake). Keeps the row for audit."""
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    integrity = dict(sitting.get("integrity") or {})
    integrity["void_reason"] = reason
    integrity["voided_by"] = str(admin_id)
    # Keep the sitting SEALED. A voided (cancelled) exam never publishes results —
    # unsealing here would expose scores / reviews / answer keys for the linked
    # attempts without going through the release workflow. Only release_results
    # ever lifts the seal.
    resp = supabase_admin.table("mock_exam_sittings").update({
        "status": "void",
        "integrity": integrity,
    }).eq("id", str(sitting_id)).execute()
    logger.info("[mock-exam] sitting=%s VOIDED by admin=%s", sitting_id, admin_id)
    return resp.data[0] if resp.data else {**sitting, "status": "void"}


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
    """Admin live toggle — open the exam so students can start, or close it."""
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


def _force_collect_section(exam_id: str, section: str) -> None:
    """Straggler safety net: called right before the admin advances PAST
    `section`. Every non-terminal sitting that hasn't submitted this section
    yet (e.g. a disconnected student) is best-effort collected as-is — mirrors
    a real proctor sweeping up papers when time's up, regardless of whether
    the student finished. Never raises; a collection failure must not block
    the admin's advance."""
    col = _SUBMITTED_COL.get(section)
    if not col:
        return
    try:
        rows = supabase_admin.table("mock_exam_sittings").select("*").eq(
            "mock_exam_id", str(exam_id),
        ).is_(col, "null").not_.in_(
            "status", ["released", "void"],
        ).execute()
    except Exception:  # noqa: BLE001
        logger.exception("[mock-exam] force-collect lookup failed exam=%s section=%s", exam_id, section)
        return

    for row in (rows.data or []):
        _collect_section_for_sitting(row, section)


def _collect_section_for_sitting(sitting: dict, section: str) -> None:
    """Force-collect ONE section of ONE sitting AS-IS (time's up / straggler /
    closed tab). Stamps the collected-at timestamp, grades the bound L/R attempt
    (or promotes Writing) if present, then re-checks terminal reconciliation on
    the sitting's OWN sections (retake → assigned skills; sequential →
    configured). Idempotent + best-effort — never raises. Shared by the admin
    advance sweep and the retake reaper."""
    col = _SUBMITTED_COL.get(section)
    if not col or sitting.get(col):
        return
    try:
        update: dict = {col: _now_iso()}
        if sitting.get("status") == "registered":
            update["status"] = "lrw_in_progress"
        supabase_admin.table("mock_exam_sittings").update(update).eq(
            "id", sitting["id"],
        ).execute()
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
        exam = get_published_exam_by_id(str(sitting["mock_exam_id"])) or {}
        sections = _sitting_sections(fresh, exam) if fresh else []
        if fresh and sections and all(fresh.get(_SUBMITTED_COL[s]) for s in sections):
            supabase_admin.table("mock_exam_sittings").update({
                "status": "lrw_submitted",
            }).eq("id", sitting["id"]).execute()
            _reconcile_terminal(sitting["id"])
    except Exception:  # noqa: BLE001
        logger.exception(
            "[mock-exam] force-collect failed sitting=%s section=%s",
            sitting["id"], section,
        )


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


def reap_expired_retake_sittings(grace_seconds: int = 30) -> dict:
    """Server-side backstop for retake self-timing (no invigilator). For each
    pre-review retake sitting: collect any STARTED section whose per-sitting
    clock ran out (+grace, so a live browser auto-submits first), and — once the
    per-student window has closed — collect every remaining assigned section so
    the sitting finalises even if the student never came back. Idempotent;
    per-sitting failures isolated. Returns {"collected": n, "sittings": m}."""
    try:
        rows = supabase_admin.table("mock_exam_sittings").select("*").in_(
            "status", ["registered", "lrw_in_progress"],
        ).execute().data or []
    except Exception:  # noqa: BLE001
        logger.exception("[retake-reaper] lookup failed")
        return {"collected": 0, "sittings": 0}

    now = _now()
    collected = 0
    touched = 0
    for sitting in rows:
        # assigned_skills is set only on retake sittings — sequential stragglers
        # are the admin advance-sweep's job, not the reaper's.
        if not sitting.get("assigned_skills"):
            continue
        exam = get_published_exam_by_id(sitting["mock_exam_id"]) or {}
        if not is_retake(exam):
            continue
        window_until = _parse_ts(sitting.get("retake_open_until"))
        window_closed = bool(window_until and now > window_until)
        did = False
        sections = _sitting_sections(sitting, exam)
        for section in sections:
            if sitting.get(_SUBMITTED_COL[section]):
                continue
            if window_closed or _retake_section_expired(sitting, exam, section, grace_seconds):
                _collect_section_for_sitting(sitting, section)
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
            _reconcile_terminal(sitting["id"])
            touched += 1
    if collected:
        logger.info("[retake-reaper] collected=%d across %d sitting(s)", collected, touched)
    return {"collected": collected, "sittings": touched}


def advance_section(exam_id: str, admin_id: str) -> dict:
    """Admin advances the shared classroom clock to the NEXT configured section.

    not_started → listening → reading → writing → done (skipping any section
    the exam has no test/prompt for). Force-collects stragglers of the section
    being closed, then stamps `{next}_started_at` — every sitting under this
    exam picks up the new section on its next poll.
    """
    exam = get_published_exam_by_id(exam_id)
    if not exam:
        raise NotFoundError(f"Mock exam {exam_id} không tồn tại.")
    current = exam.get("active_section") or "not_started"
    if current == "done":
        raise SittingConflictError("Kỳ thi đã kết thúc tất cả các phần.")

    seq = _configured_sections(exam)
    if current == "not_started":
        nxt = seq[0] if seq else "done"
    else:
        if current in seq:
            idx = seq.index(current)
            nxt = seq[idx + 1] if idx + 1 < len(seq) else "done"
        else:
            nxt = "done"
        _force_collect_section(exam_id, current)

    update: dict = {"active_section": nxt}
    if nxt in _LRW_ORDER:
        update[f"{nxt}_started_at"] = _now_iso()
    resp = supabase_admin.table("mock_exams").update(update).eq(
        "id", str(exam_id),
    ).execute()
    logger.info(
        "[mock-exam] exam=%s section %s → %s by admin=%s",
        exam_id, current, nxt, admin_id,
    )
    return resp.data[0] if resp.data else {**exam, **update}


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
        .order("created_at", desc=True)
        .execute()
    )
    rows = res.data or []
    return [r for r in rows if (r.get("metadata") or {}).get("test_type") != "mini"]
