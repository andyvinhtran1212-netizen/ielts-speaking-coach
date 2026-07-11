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

# The seated block: all three run at once under one timer. Speaking is decoupled.
_LRW_ORDER = ("listening", "reading", "writing")
_SUBMITTED_COL = {s: f"{s}_submitted_at" for s in _LRW_ORDER}
# LRW sections backed by a domain attempt (writing is native — no attempt row).
# (link column on the sitting, domain attempt table, exam's configured-test column)
_SECTION_ATTEMPT = {
    "listening": ("listening_attempt_id", "listening_test_attempts", "listening_test_id"),
    "reading":   ("reading_attempt_id",   "reading_test_attempts",   "reading_test_id"),
}
# Statuses from which _reconcile_terminal may still advance the sitting.
# Once an admin has claimed (under_review) or beyond, we never downgrade.
_PRE_REVIEW = {
    "registered", "lrw_in_progress", "lrw_submitted", "speaking_pending",
}
# Grace after the deadline before a late submit is flagged (ms).
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
        "total_minutes": exam.get("total_minutes") or 150,
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
    # LIVE gate: the admin must have opened the exam. An optional time window is
    # still enforced when set, but is_open is the primary proctor toggle.
    if not exam.get("is_open"):
        raise WindowClosedError("Kỳ thi chưa mở. Vui lòng chờ giám khảo mở kỳ.")
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


def start_lrw(sitting_id: str, user_id: str) -> dict:
    """Open the seated LRW block — all three sections at once under ONE timer.

    Stamps the server-authoritative `lrw_started_at` (the single countdown
    anchor) and moves the sitting to `lrw_in_progress`. Idempotent: if already
    started, returns the sitting unchanged so the client resumes from the stored
    start time (the total time left is computed from it). The student then works
    Listening / Reading / Writing freely as tabs; there is no per-section
    sequencing or gating.
    """
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    _assert_owner(sitting, user_id)
    if sitting["status"] in ("released", "void"):
        raise SittingConflictError(f"Sitting đang ở trạng thái {sitting['status']!r}.")
    # Resume: already started (or beyond) → no-op.
    if sitting.get("lrw_started_at"):
        return sitting

    now = _now_iso()
    update = {"status": "lrw_in_progress", "lrw_started_at": now}
    resp = supabase_admin.table("mock_exam_sittings").update(update).eq(
        "id", str(sitting_id),
    ).eq("status", "registered").execute()
    logger.info("[mock-exam] sitting=%s LRW started (all-at-once)", sitting_id)
    return resp.data[0] if resp.data else {**sitting, **update}


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

    r = supabase_admin.table(domain_table).select(
        "id, user_id, test_id, status",
    ).eq("id", str(attempt_id)).limit(1).execute()
    if not r.data:
        raise NotFoundError(f"Attempt {attempt_id} không tồn tại.")
    att = r.data[0]
    if str(att.get("user_id")) != str(sitting["user_id"]):
        raise PermissionError("Bài làm không thuộc về thí sinh của kỳ thi này.")

    exam = get_published_exam_by_id(sitting["mock_exam_id"]) or {}
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


def submit_lrw(sitting_id: str, user_id: str) -> dict:
    """Collect the whole LRW block at once and finalise.

    Called when the student presses "Nộp toàn bộ" or the total timer hits 0
    (the client submits the Listening + Reading attempts and saves the Writing
    text first). Requires real work — every section the exam configures must
    have a submitted attempt, and the Writing text must be present. Then
    reconciles to the terminal state.
    """
    sitting = get_sitting(sitting_id)
    if not sitting:
        raise NotFoundError(f"Sitting {sitting_id} không tồn tại.")
    _assert_owner(sitting, user_id)
    if sitting["status"] in ("released", "void"):
        raise SittingConflictError(f"Sitting đang ở trạng thái {sitting['status']!r}.")

    # Idempotent: already finalised (or beyond) → no-op. Guards the one-way
    # status machine — a stale retry must never regress an under_review/reviewed
    # sitting back to 'lrw_submitted'.
    if sitting.get("writing_submitted_at"):
        return sitting

    # The block must have been started (all-at-once) before it can be collected.
    if not sitting.get("lrw_started_at") or sitting["status"] != "lrw_in_progress":
        raise SittingConflictError("Kỳ thi chưa bắt đầu — không thể nộp bài.")

    # Require real work: every configured section has a submitted attempt, and
    # the Writing text is present.
    exam = get_published_exam_by_id(sitting["mock_exam_id"]) or {}
    if exam.get("listening_test_id"):
        _assert_prior_section_submitted(sitting, "listening")
    if exam.get("reading_test_id"):
        _assert_prior_section_submitted(sitting, "reading")
    if not sitting.get("writing_submission"):
        raise SittingConflictError("Chưa nộp bài Writing — không thể nộp mạch.")

    now = _now_iso()
    update: dict = {
        "status": "lrw_submitted",
        "listening_submitted_at": sitting.get("listening_submitted_at") or now,
        "reading_submitted_at":   sitting.get("reading_submitted_at") or now,
        "writing_submitted_at":   now,
    }
    supabase_admin.table("mock_exam_sittings").update(update).eq(
        "id", str(sitting_id),
    ).execute()
    logger.info("[mock-exam] sitting=%s LRW submitted (all-at-once)", sitting_id)
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
    # Only accept writing while the LRW block is live. Once submit-lrw has run
    # (writing_submitted_at set / status past lrw_in_progress) the text is final —
    # a retry must NOT overwrite the graded submission.
    if sitting["status"] != "lrw_in_progress" or sitting.get("writing_submitted_at"):
        raise SittingConflictError(
            "Không thể nộp/sửa Writing khi kỳ thi chưa mở hoặc đã nộp bài."
        )

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
    "total_minutes", "open_from", "open_until", "cohort_id",
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


def lrw_time_remaining_seconds(sitting: dict, exam: dict) -> Optional[int]:
    """Seconds left in the whole LRW block (single total timer), from the SERVER
    start. None if not started yet. Negative clamped to 0 for display; the caller
    handles late submits via LATE_GRACE_MS.
    """
    started = _parse_ts(sitting.get("lrw_started_at"))
    if not started:
        return None
    minutes = exam.get("total_minutes") or 150
    elapsed = (_now() - started).total_seconds()
    return max(0, int(minutes * 60 - elapsed))


# ── Admin: open/close + exclusivity ──────────────────────────────────


def set_open(exam_id: str, is_open: bool, admin_id: str) -> dict:
    """Admin live toggle — open the exam so students can start, or close it."""
    resp = supabase_admin.table("mock_exams").update({
        "is_open": bool(is_open),
    }).eq("id", str(exam_id)).execute()
    if not resp.data:
        raise NotFoundError(f"Mock exam {exam_id} không tồn tại.")
    logger.info("[mock-exam] exam=%s is_open=%s by admin=%s", exam_id, is_open, admin_id)
    return resp.data[0]


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
