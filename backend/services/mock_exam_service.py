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


def list_open_exams(user_id: str) -> list[dict]:
    """Published + currently-open exams the student is eligible for (cohort).

    Powers the student full-test entry page. Only card metadata — no content."""
    resp = supabase_admin.table("mock_exams").select(
        "id, code, title, total_minutes, cohort_id, review_sla_days",
    ).eq("status", "published").eq("is_open", True).execute()
    out = []
    for e in (resp.data or []):
        if e.get("cohort_id") and not _user_in_cohort(user_id, e["cohort_id"]):
            continue
        out.append({k: v for k, v in e.items() if k != "cohort_id"})
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

    # NEW sitting only: apply the entry gates (live-open toggle + optional window
    # + cohort). is_open is the primary proctor gate.
    if not exam.get("is_open"):
        raise WindowClosedError("Kỳ thi chưa mở. Vui lòng chờ giám khảo mở kỳ.")
    _assert_window_open(exam)
    if exam.get("cohort_id") and not _user_in_cohort(user_id, exam["cohort_id"]):
        raise NotEligibleError("Bạn không thuộc lớp được mở kỳ thi này.")

    inserted = supabase_admin.table("mock_exam_sittings").insert({
        "mock_exam_id": exam["id"],
        "user_id":      str(user_id),
        "status":       "registered",
        "sealed":       True,
    }).execute()
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
    # Sequential gate: a domain attempt can only be attached while the ADMIN has
    # this section open. Defense in depth — the runner UI only shows a section
    # once it's active, but the endpoint itself must not trust that.
    if (exam.get("active_section") or "not_started") != section:
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
    if (exam.get("active_section") or "not_started") != "writing":
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
    if (exam.get("active_section") or "not_started") != section:
        raise SittingConflictError(
            f"Phần {section} chưa được giám thị mở — không thể nộp bài."
        )
    # No early manual submit: this endpoint only fires client-side at the
    # section's own clock hitting 0 — but it's a plain authenticated API call,
    # so enforce that server-side too (a small grace absorbs client/server
    # timing skew, not enough to game "who submits first").
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
    logger.info("[mock-exam] sitting=%s section=%s collected", sitting_id, section)

    exam = get_published_exam_by_id(sitting["mock_exam_id"]) or {}
    configured = _configured_sections(exam)
    if all(sitting.get(_SUBMITTED_COL[s]) for s in configured):
        supabase_admin.table("mock_exam_sittings").update({
            "status": "lrw_submitted",
        }).eq("id", str(sitting_id)).execute()
        logger.info("[mock-exam] sitting=%s LRW submitted (sequential)", sitting_id)
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

    lrw_done = bool(sitting.get(_SUBMITTED_COL["writing"]))
    # Speaking is required only when the exam defines a speaking component.
    # An LRW-only exam (no speaking_topic_set) finalises on the seated mạch
    # alone — this is what makes an LRW-only mock fully end-to-end in P1.
    exam = get_published_exam_by_id(sitting["mock_exam_id"]) or {}
    speaking_required = bool(exam.get("speaking_topic_set"))
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
    "code", "title", "listening_test_id", "reading_test_id",
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

    now = _now_iso()
    for row in (rows.data or []):
        try:
            update: dict = {col: now}
            if row.get("status") == "registered":
                update["status"] = "lrw_in_progress"
            supabase_admin.table("mock_exam_sittings").update(update).eq(
                "id", row["id"],
            ).execute()
            if section in _SECTION_ATTEMPT:
                link_col, _table, _ = _SECTION_ATTEMPT[section]
                attempt_id = row.get(link_col)
                if attempt_id:
                    grade_fn = (_grade_and_finalize_listening if section == "listening"
                                else _grade_and_finalize_reading)
                    grade_fn(str(attempt_id))
            logger.info(
                "[mock-exam] sitting=%s section=%s force-collected (straggler)",
                row["id"], section,
            )
            # Re-check terminal reconciliation now that this section is in.
            fresh = get_sitting(row["id"])
            exam = get_published_exam_by_id(str(exam_id)) or {}
            configured = _configured_sections(exam)
            if fresh and all(fresh.get(_SUBMITTED_COL[s]) for s in configured):
                supabase_admin.table("mock_exam_sittings").update({
                    "status": "lrw_submitted",
                }).eq("id", row["id"]).execute()
                _reconcile_terminal(row["id"])
        except Exception:  # noqa: BLE001
            logger.exception(
                "[mock-exam] force-collect failed sitting=%s section=%s", row["id"], section,
            )


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
    """Reading/listening test ids reserved by a mock exam (any non-archived one).

    Used to HIDE those tests from the normal reading/listening practice lists —
    a test chosen for a full mock is exclusive to it."""
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
