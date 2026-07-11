"""services/mock_exam_service.py — 4-skill mock exam orchestration (Phase 1).

The sitting is the cross-skill coordinator. This service owns:

  - create_sitting  — open a sitting (window + cohort gate; one active per user)
  - start_section   — record a SERVER-authoritative section start (one-way)
  - attach_attempt  — bind a domain attempt to the sitting (both directions)
  - submit_lrw      — finalise the seated LRW mạch
  - record_speaking — attach the (decoupled) speaking sessions
  - is_sealed       — the hook domain submit/review endpoints check

Student work stays canonical in its own domain table (reading_test_attempts /
listening_test_attempts / writing_essays / sessions). This service never
duplicates answers — it only binds ids and drives the status machine.

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

# LRW section order — forward-only. (Speaking is decoupled, not in this chain.)
_LRW_ORDER = ("listening", "reading", "writing")
_STARTED_COL = {s: f"{s}_started_at" for s in _LRW_ORDER}
_SUBMITTED_COL = {s: f"{s}_submitted_at" for s in _LRW_ORDER}
_SECTION_STATUS = {
    "listening": "lrw_listening",
    "reading": "lrw_reading",
    "writing": "lrw_writing",
}
# Statuses from which _reconcile_terminal may still advance the sitting.
# Once an admin has claimed (under_review) or beyond, we never downgrade.
_PRE_REVIEW = {
    "registered", "lrw_listening", "lrw_reading", "lrw_writing",
    "lrw_submitted", "speaking_pending",
}
# Grace after a section deadline before a late submit is flagged (ms).
LATE_GRACE_MS = 30_000


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
        "section_minutes": exam.get("section_minutes") or {},
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
                "id, task_type, prompt_text, title",
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
    _assert_window_open(exam)
    if exam.get("cohort_id") and not _user_in_cohort(user_id, exam["cohort_id"]):
        raise NotEligibleError("Bạn không thuộc lớp được mở kỳ thi này.")

    existing = supabase_admin.table("mock_exam_sittings").select("*").eq(
        "mock_exam_id", exam["id"],
    ).eq("user_id", str(user_id)).not_.in_(
        "status", ["released", "void"],
    ).limit(1).execute()
    if existing.data:
        return existing.data[0]

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


def start_section(sitting_id: str, user_id: str, section: str) -> dict:
    """Record a server-authoritative start for an LRW section. One-way.

    Rules:
      - section ∈ {listening, reading, writing}
      - forward-only: a section can start only after all prior LRW sections have
        started (you can't jump to writing without having entered listening)
      - idempotent resume: if the section already started, return the sitting
        unchanged (the client resumes from the stored timestamp — no restart)
      - advancing auto-submits the previous section (its submitted_at is stamped)
    """
    if section not in _LRW_ORDER:
        raise SittingConflictError(f"Section không hợp lệ: {section!r}")
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    _assert_owner(sitting, user_id)
    if sitting["status"] in ("released", "void"):
        raise SittingConflictError(f"Sitting đang ở trạng thái {sitting['status']!r}.")

    idx = _LRW_ORDER.index(section)
    # Resume: already started → no-op.
    if sitting.get(_STARTED_COL[section]):
        return sitting
    # Forward-only: every prior section must have been started.
    for prior in _LRW_ORDER[:idx]:
        if not sitting.get(_STARTED_COL[prior]):
            raise SittingConflictError(
                f"Chưa thể vào {section}: phải bắt đầu {prior} trước."
            )

    now = _now_iso()
    update: dict = {
        _STARTED_COL[section]: now,
        "status": _SECTION_STATUS[section],
    }
    if not sitting.get("lrw_started_at"):
        update["lrw_started_at"] = now
    # Auto-submit the immediately prior section on advance.
    if idx > 0:
        prior = _LRW_ORDER[idx - 1]
        if not sitting.get(_SUBMITTED_COL[prior]):
            update[_SUBMITTED_COL[prior]] = now

    resp = supabase_admin.table("mock_exam_sittings").update(update).eq(
        "id", str(sitting_id),
    ).execute()
    logger.info("[mock-exam] sitting=%s start section=%s", sitting_id, section)
    return resp.data[0] if resp.data else {**sitting, **update}


def attach_attempt(
    sitting_id: str, user_id: str, section: str, attempt_id: str,
) -> dict:
    """Bind a domain attempt to the sitting (both directions).

    - Writes the id onto the sitting (sitting → attempt: lets the review console
      load all 4 skills).
    - Writes sitting_id back onto the domain attempt (attempt → sitting: the
      hook the domain submit/review endpoints check for sealing).

    `section` ∈ {listening, reading, writing_task1, writing_task2}. Speaking
    uses record_speaking (multiple sessions).
    """
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    _assert_owner(sitting, user_id)

    link_col, domain_table = {
        "listening":     ("listening_attempt_id", "listening_test_attempts"),
        "reading":       ("reading_attempt_id",   "reading_test_attempts"),
        "writing_task1": ("essay_task1_id",       "writing_essays"),
        "writing_task2": ("essay_task2_id",       "writing_essays"),
    }.get(section, (None, None))
    if not link_col:
        raise SittingConflictError(f"Section không gắn được attempt: {section!r}")

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


def submit_lrw(sitting_id: str, user_id: str) -> dict:
    """Finalise the seated LRW mạch: stamp writing_submitted_at + advance.

    Auto-submits any LRW section not yet submitted (e.g. writing, and reading if
    the student jumped straight to submit). Then reconciles to the terminal
    state (all_submitted if speaking already done, else speaking_pending).
    """
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    _assert_owner(sitting, user_id)
    if sitting["status"] in ("released", "void"):
        raise SittingConflictError(f"Sitting đang ở trạng thái {sitting['status']!r}.")

    now = _now_iso()
    update: dict = {"status": "lrw_submitted"}
    for section in _LRW_ORDER:
        if sitting.get(_STARTED_COL[section]) and not sitting.get(_SUBMITTED_COL[section]):
            update[_SUBMITTED_COL[section]] = now
    # Writing is the last section; always stamp its submit on LRW finalise.
    if not sitting.get(_SUBMITTED_COL["writing"]):
        update[_SUBMITTED_COL["writing"]] = now

    supabase_admin.table("mock_exam_sittings").update(update).eq(
        "id", str(sitting_id),
    ).execute()
    logger.info("[mock-exam] sitting=%s LRW submitted", sitting_id)
    return _reconcile_terminal(sitting_id)


def _word_count(text: str) -> int:
    return len((text or "").split())


def submit_writing(
    sitting_id: str, user_id: str, task1_text: str, task2_text: str,
) -> dict:
    """Store the two essay texts on the sitting (P1 native writing capture).

    Does NOT stamp writing_submitted_at / advance status — the client calls
    submit_lrw next to finalise the whole seated mạch. Sealed by construction:
    the text lives on the sitting (admin-only); the student sees no band until
    release.
    """
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    _assert_owner(sitting, user_id)
    if sitting["status"] in ("released", "void"):
        raise SittingConflictError(f"Sitting đang ở trạng thái {sitting['status']!r}.")

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


def record_speaking(sitting_id: str, user_id: str, session_ids: list[str]) -> dict:
    """Attach the decoupled speaking sessions and mark speaking complete.

    Also stamps sessions.sitting_id on each session (the sealed hook for the
    speaking result endpoint). Then reconciles the terminal state.
    """
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    _assert_owner(sitting, user_id)
    if sitting["status"] in ("released", "void"):
        raise SittingConflictError(f"Sitting đang ở trạng thái {sitting['status']!r}.")

    supabase_admin.table("mock_exam_sittings").update({
        "speaking_session_ids": [str(s) for s in session_ids],
        "speaking_completed_at": _now_iso(),
    }).eq("id", str(sitting_id)).execute()
    for sid in session_ids:
        supabase_admin.table("sessions").update({
            "sitting_id": str(sitting_id),
        }).eq("id", str(sid)).execute()
    logger.info(
        "[mock-exam] sitting=%s speaking recorded (%d sessions)",
        sitting_id, len(session_ids),
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
    "section_minutes", "open_from", "open_until", "cohort_id",
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
    resp = supabase_admin.table("mock_exam_sittings").update({
        "status": "void",
        "sealed": False,
        "integrity": integrity,
    }).eq("id", str(sitting_id)).execute()
    logger.info("[mock-exam] sitting=%s VOIDED by admin=%s", sitting_id, admin_id)
    return resp.data[0] if resp.data else {**sitting, "status": "void"}


def section_time_remaining_seconds(
    sitting: dict, exam: dict, section: str,
) -> Optional[int]:
    """Seconds left in a section, computed from the SERVER start timestamp.

    Returns None if the section hasn't started. Negative clamped to 0 for
    display; the caller decides late handling via LATE_GRACE_MS.
    """
    started = _parse_ts(sitting.get(_STARTED_COL.get(section)))
    if not started:
        return None
    minutes = (exam.get("section_minutes") or {}).get(section)
    if not minutes:
        return None
    elapsed = (_now() - started).total_seconds()
    return max(0, int(minutes * 60 - elapsed))
