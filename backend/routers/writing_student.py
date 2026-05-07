"""routers/writing_student.py — student-facing Writing Coach reads.

Phase 2.1 ships two endpoints:

  GET /api/writing/my-essays
  GET /api/writing/my-essays/{essay_id}

Auth model: Supabase JWT → users.id → students.user_id (the link is
established by /activate's Step 6, see routers/auth.py). A request
whose user has no students row gets 403 — they must be set up by
admin first. Submission endpoints (paste / upload / IELTS-mode) are
Phase 2.3 scope and intentionally absent here.

Access scoping: queries go through `supabase_admin` (service role,
bypasses RLS) but every query carries an explicit
`student_id = student["id"]` filter. The migration-035 RLS policies
are defense-in-depth for any future client-direct access path.

Feedback gate: feedback_json + per-criterion bands are returned only
when essay.status == 'delivered'. The 'graded' / 'reviewed' states
are admin-internal — Andy edits AI output before delivery, so showing
raw AI feedback would leak un-curated content. The endpoint surfaces
status either way so the frontend can render a "feedback đang được
duyệt" placeholder without a separate poll.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from database import supabase_admin
from routers.auth import get_supabase_user
from services import essay_service
from services.file_extract_service import FileExtractError, extract_text
from services.spam_detector import detect_flags, format_flag_explanation_vi

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/writing", tags=["writing-student"])


# Cap on prompt preview length in the list response — keeps payloads
# small for the dashboard list UI without losing context. Anything
# longer is truncated with an ellipsis.
_PROMPT_PREVIEW_CHARS = 200


async def get_current_student(
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """Resolve the students row owned by the authenticated user.

    Raises 403 when the JWT is valid but the user has not been linked
    to any students row — that's the case where admin hasn't created
    a student record OR /activate's linking step has not run yet for
    this code. The error message is Vietnamese to match the rest of
    the app's user-facing strings.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    try:
        # `user_id` is part of the projection so Phase 2.3b's submit
        # endpoint can stamp it on the writing_essays audit row
        # (`submitted_by_admin` FK → users(id) — column name reused
        # for student submissions).
        result = (
            supabase_admin.table("students")
            .select("id, user_id, student_code, full_name, target_band")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.warning("[writing-student] students lookup failed user=%s: %s", user_id, e)
        raise HTTPException(
            status_code=500,
            detail="Lỗi khi tra cứu hồ sơ học viên",
        )

    if not result.data:
        raise HTTPException(
            status_code=403,
            detail=(
                "Bạn chưa được link với tài khoản học viên. "
                "Vui lòng liên hệ giảng viên."
            ),
        )
    return result.data[0]


@router.get("/my-essays")
async def list_my_essays(student: dict = Depends(get_current_student)):
    """List all essays for the authenticated student, newest first.

    Each row carries the prompt preview, status, and timestamps. The
    feedback itself isn't included here — clients fetch the per-essay
    detail endpoint when the user opens one (and only delivered
    essays surface feedback there).
    """
    try:
        result = (
            supabase_admin.table("writing_essays")
            .select(
                "id, task_type, prompt_text, status, "
                "created_at, delivered_at, "
                "is_flagged, flag_reasons"
            )
            .eq("student_id", student["id"])
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as e:
        logger.warning(
            "[writing-student] list essays failed student=%s: %s",
            student["id"], e,
        )
        raise HTTPException(status_code=500, detail="Lỗi khi tải danh sách bài viết")

    essays: list[dict] = []
    for e in result.data or []:
        prompt = e.get("prompt_text") or ""
        if len(prompt) > _PROMPT_PREVIEW_CHARS:
            prompt_preview = prompt[:_PROMPT_PREVIEW_CHARS].rstrip() + "..."
        else:
            prompt_preview = prompt
        essays.append({
            "id":             e["id"],
            "task_type":      e.get("task_type"),
            "prompt_preview": prompt_preview,
            "status":         e["status"],
            "created_at":     e["created_at"],
            "delivered_at":   e.get("delivered_at"),
            "is_flagged":     bool(e.get("is_flagged")),
            "flag_reasons":   e.get("flag_reasons") or [],
        })

    return {
        "student": {
            "full_name":    student.get("full_name"),
            "student_code": student.get("student_code"),
            "target_band":  student.get("target_band"),
        },
        "essays": essays,
    }


@router.get("/my-essays/{essay_id}")
async def get_my_essay(
    essay_id: str,
    student: dict = Depends(get_current_student),
):
    """Return one essay + its feedback (if delivered).

    Two filters on the SELECT (id + student_id) so a request for an
    essay belonging to another student returns 404 — same as a
    nonexistent essay, no information leak about what other students
    own.

    Feedback is gated on `status == 'delivered'`. Earlier states
    ('grading' / 'graded' / 'reviewed') return feedback=None even if
    the writing_feedback row exists, because Andy may still be
    editing the AI output before release.
    """
    try:
        essay_result = (
            supabase_admin.table("writing_essays")
            .select(
                "id, task_type, prompt_text, essay_text, "
                "status, created_at, delivered_at, "
                "is_flagged, flag_reasons, flagged_at, error_message"
            )
            .eq("id", essay_id)
            .eq("student_id", student["id"])
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.warning(
            "[writing-student] essay lookup failed student=%s essay=%s: %s",
            student["id"], essay_id, e,
        )
        raise HTTPException(status_code=500, detail="Lỗi khi tải bài viết")

    if not essay_result.data:
        # 404 covers both "doesn't exist" and "exists but not yours"
        # — intentional symmetry to avoid leaking ownership info.
        raise HTTPException(status_code=404, detail="Essay không tìm thấy")

    essay = essay_result.data[0]

    feedback = None
    if essay.get("status") == "delivered":
        try:
            fb_result = (
                supabase_admin.table("writing_feedback")
                .select(
                    "feedback_json, overall_band_score, "
                    "band_main_criterion, band_coherence_cohesion, "
                    "band_lexical_resource, band_grammatical_range, "
                    "created_at"
                )
                .eq("essay_id", essay_id)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            feedback = fb_result.data[0] if fb_result.data else None
        except Exception as e:
            # Feedback fetch failure shouldn't 500 the whole essay
            # detail — return the essay with feedback=None so the UI
            # can render the body and a "feedback temporarily
            # unavailable" affordance.
            logger.warning(
                "[writing-student] feedback fetch failed essay=%s: %s",
                essay_id, e,
            )

    return {
        "essay":    essay,
        "feedback": feedback,
    }


# ── Phase 2.3b: assignments + draft + submit ─────────────────────────


# Active states where the student is allowed to write/edit a draft and
# eventually submit. Anything past `in_progress` is locked: the row has
# already been handed to the grader and any further "edit" would
# silently lose the submitted essay.
_ACTIVE_ASSIGNMENT_STATES = {"pending", "in_progress"}

# Phase 2.6: when a student's flagged-essay counter crosses this
# threshold we auto-flip `students.is_under_review` so the admin
# review queue picks them up. Three is "more than one bad-faith
# attempt and one accidental misclick"; lower would page admins on
# noise, higher would let real abuse compound for too long.
_AUTO_REVIEW_FLAG_THRESHOLD = 3


def _word_count(text: str) -> int:
    """Whitespace-split word count. Matches the column constraint
    on writing_essays.word_count which is `>= 0`."""
    return len((text or "").split())


def _compute_timer_state(assignment: dict) -> dict:
    """Compute the IELTS-mode timer state for one assignment row.

    Server time is the truth — the frontend only ticks locally for
    a smooth countdown UX. This function is the source the
    `/timer` endpoint, the detail endpoint, and the
    expiry-rejection branch in `upsert_my_draft` all read from.

    Returns the same shape regardless of `is_timed` so the frontend
    never has to branch on missing keys:
      • is_timed              — pass-through from the row
      • time_limit_minutes    — pass-through (None when not timed)
      • started_at            — pass-through (None until first save)
      • expires_at            — started_at + time_limit_minutes
      • time_remaining_seconds — int; negative once past expiry
      • is_expired            — True when remaining <= 0

    Three terminal states for `is_timed=true`:
      1. Not started: started_at is None → expires_at + remaining
         are both None, is_expired=False.  The clock hasn't begun.
      2. Active: clock running, remaining > 0.
      3. Expired: started_at + time_limit_minutes <= now.
    """
    is_timed = bool(assignment.get("is_timed"))
    time_limit_minutes = assignment.get("time_limit_minutes")
    started_at_str = assignment.get("started_at")

    state = {
        "is_timed":               is_timed,
        "time_limit_minutes":     time_limit_minutes,
        "started_at":             started_at_str,
        "expires_at":             None,
        "time_remaining_seconds": None,
        "is_expired":             False,
    }

    # Anything missing → can't compute expiry. The frontend treats
    # these as "no countdown" which is exactly the not-yet-started
    # state we want.
    if not is_timed or not started_at_str or not time_limit_minutes:
        return state

    # Supabase returns timestamps with `+00:00`; older rows or any
    # raw-API insert can come back with a trailing `Z`. Normalise
    # both shapes so `fromisoformat` accepts either.
    started_at = datetime.fromisoformat(started_at_str.replace("Z", "+00:00"))
    expires_at = started_at + timedelta(minutes=time_limit_minutes)
    now = datetime.now(timezone.utc)
    remaining = (expires_at - now).total_seconds()

    state["expires_at"]             = expires_at.isoformat()
    state["time_remaining_seconds"] = int(remaining)
    state["is_expired"]             = remaining <= 0
    return state


class DraftUpsert(BaseModel):
    """Body for PATCH .../draft. Empty-string is a valid payload —
    the dashboard fires `draft_text=""` once when the textarea opens
    fresh, which seeds a row so subsequent debounced saves are pure
    UPDATEs (no first-keystroke INSERT delay)."""
    draft_text: str = Field(default="", max_length=15000)


class SubmitEssay(BaseModel):
    """Body for POST .../submit. `essay_text` is optional — when
    omitted, the endpoint pulls the student's last saved draft from
    `writing_drafts`. Cap matches admin-side `writing_essays.essay_text`
    (10000) so a student who pastes a giant document gets a clean 422
    instead of an opaque DB error downstream."""
    essay_text: Optional[str] = Field(default=None, max_length=10000)


def _persist_flagged_submission(
    *,
    assignment_id: UUID,
    assignment: dict,
    student_id: str,
    user_id: str,
    prompt_text: str,
    task_type: str,
    essay_text: str,
    flags: list[str],
    paste_events: Optional[list] = None,
    suspicious_paste: bool = False,
) -> dict:
    """Phase 2.6: write the row tree for a flagged submission.

    Skips `essay_service.create_essay_with_job` entirely — that path
    queues a grading job, which we explicitly do NOT want for
    flagged essays.  Instead we insert a `writing_essays` row in the
    terminal `delivered` state, with `is_flagged=True` and the
    detector's reason codes captured immutably.

    NO `writing_feedback` row is written. That table's
    `overall_band_score` is NOT NULL with `CHECK >= 0`, and stamping
    a stub score (0.0 or otherwise) would skew every "average band"
    / "graded essay count" admin query.  Frontend reads
    `essay.is_flagged + essay.flag_reasons` directly off the
    writing_essays row to render the explanation.

    Side effects (best-effort, never raised — the essay row is the
    audit-critical write):
      • writing_assignments → status=delivered + essay_id link
      • students.flag_count++ + last_flagged_at stamped
      • students.is_under_review flipped TRUE on the threshold cross
      • writing_drafts row deleted (the form is locked now)

    Returns the response shape the frontend's submitEssay branch
    keys off — `is_flagged=True` + Vietnamese `message` so the
    student sees a friendly alert instead of a generic "submitted".
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    explanation_vi = format_flag_explanation_vi(flags)

    # Phase 2.3c-3: a flagged submission still preserves the timer
    # audit. If the timer was already expired when the student tried
    # to submit garbage, `auto_submitted=true` records that on the
    # assignment row — admin reviewing a flagged essay can tell at
    # a glance whether the student ran out of time or just typed
    # nonsense from the start.
    timer = _compute_timer_state(assignment)
    auto_submitted_flag = bool(timer["is_expired"])

    essay_payload = {
        "student_id":         student_id,
        "submitted_by_admin": user_id,  # see "Audit-field caveat" — column
                                        # naming is misleading; we stamp
                                        # the student's user_id here.
        "task_type":          task_type,
        "prompt_text":        prompt_text,
        "essay_text":         essay_text or "",
        "word_count":         _word_count(essay_text),
        "analysis_level":     3,
        "form_of_address":    "em",
        "selected_model":     "gemini-2.5-pro",
        "status":             "delivered",
        "is_flagged":         True,
        "flag_reasons":       flags,
        "flagged_at":         now_iso,
        "delivered_at":       now_iso,
        # Capture the Vietnamese explanation in error_message so the
        # admin moderation queue can render it without re-running the
        # formatter.
        "error_message":      explanation_vi,
        # Sprint 2.6.1: paste forensic trail. Carried straight into
        # the row even when the essay never reached the grader.
        "paste_events":       paste_events or [],
        "suspicious_paste":   bool(suspicious_paste),
    }

    try:
        er = supabase_admin.table("writing_essays").insert(essay_payload).execute()
    except Exception as exc:
        logger.error("[writing-student] flagged essay insert failed: %s", exc)
        raise HTTPException(500, "Không tạo được bản ghi bài.")

    if not er.data:
        raise HTTPException(500, "Không tạo được bản ghi bài.")
    essay_id = er.data[0]["id"]

    logger.warning(
        "[writing-student] flagged submission: assignment=%s student=%s "
        "essay=%s flags=%s",
        assignment_id, student_id, essay_id, flags,
    )

    # writing_assignments transition → delivered. We skip the usual
    # `submitted` intermediate state on purpose: the row never enters
    # the grading queue, so the admin dashboard's "submitted = needs
    # grading" filter shouldn't surface it.
    try:
        (
            supabase_admin.table("writing_assignments")
            .update({
                "essay_id":       essay_id,
                "status":         "delivered",
                "submitted_at":   now_iso,
                "delivered_at":   now_iso,
                "auto_submitted": auto_submitted_flag,
            })
            .eq("id", str(assignment_id))
            .execute()
        )
    except Exception as exc:
        # Audit row exists; the assignment link is recoverable by
        # hand. Don't 500 the student response.
        logger.error(
            "[writing-student] flagged assignment link failed "
            "assignment=%s essay=%s: %s",
            assignment_id, essay_id, exc,
        )

    # Student rollup: increment counter + maybe flip is_under_review.
    # Read-modify-write because Supabase's Python client doesn't
    # expose `flag_count = flag_count + 1` directly. The race is
    # negligible — students can't submit two assignments in the
    # same millisecond.
    try:
        sr = (
            supabase_admin.table("students")
            .select("flag_count, is_under_review")
            .eq("id", student_id)
            .limit(1)
            .execute()
        )
        cur_count        = (sr.data[0].get("flag_count") if sr.data else 0) or 0
        cur_under_review = bool(sr.data[0].get("is_under_review")) if sr.data else False
        new_count        = cur_count + 1
        student_update: dict = {
            "flag_count":      new_count,
            "last_flagged_at": now_iso,
        }
        if not cur_under_review and new_count >= _AUTO_REVIEW_FLAG_THRESHOLD:
            student_update["is_under_review"] = True
            logger.warning(
                "[writing-student] student auto-flagged for review: "
                "student=%s flag_count=%d",
                student_id, new_count,
            )

        (
            supabase_admin.table("students")
            .update(student_update)
            .eq("id", student_id)
            .execute()
        )
    except Exception as exc:
        # Rollup failure is purely a metric — the per-essay flag is
        # the load-bearing record.
        logger.warning(
            "[writing-student] student rollup update failed "
            "student=%s: %s",
            student_id, exc,
        )

    # Drafts cleanup — same as the happy-path submit. The form is
    # now locked (assignment.status=delivered) so a stale draft
    # would just confuse the dashboard.
    try:
        (
            supabase_admin.table("writing_drafts")
            .delete()
            .eq("assignment_id", str(assignment_id))
            .execute()
        )
    except Exception as exc:
        logger.warning(
            "[writing-student] flagged draft cleanup failed "
            "assignment=%s: %s",
            assignment_id, exc,
        )

    return {
        "essay_id":       essay_id,
        "assignment_id":  str(assignment_id),
        "status":         "delivered",
        "is_flagged":     True,
        "flag_reasons":   flags,
        "message":        (
            f"Bài đã nộp nhưng không được chấm do {explanation_vi}. "
            f"Em vui lòng kiểm tra lại bài viết."
        ),
    }


def _resolve_active_assignment(student_id: str, assignment_id: str) -> dict:
    """Fetch one assignment owned by `student_id`. 404s on any miss
    (wrong owner OR nonexistent) — same symmetry rule as the essay
    detail endpoint above (no information leak about other students).
    Joins the prompt because every Phase 2.3b path needs it."""
    r = (
        supabase_admin.table("writing_assignments")
        .select(
            "id, status, deadline, instructions, "
            "created_at, submitted_at, delivered_at, "
            "essay_id, prompt_id, "
            "is_timed, time_limit_minutes, started_at, auto_submitted, "
            "writing_prompts(id, title, prompt_text, task_type, difficulty, prompt_image_url)"
        )
        .eq("id", assignment_id)
        .eq("student_id", student_id)
        .limit(1)
        .execute()
    )
    if not r.data:
        raise HTTPException(404, "Assignment không tìm thấy")
    return r.data[0]


@router.get("/my-assignments")
async def list_my_assignments(
    status_filter: Optional[str] = None,
    student: dict = Depends(get_current_student),
):
    """List the calling student's writing assignments, newest first.

    Joins each assignment with its library prompt (title /
    prompt_text / task_type / difficulty) so the dashboard can
    render the card without a per-row round-trip. Each row is also
    annotated with `has_draft` / `draft_word_count` /
    `draft_updated_at` from a single batched lookup against
    `writing_drafts`, which the UI uses to surface "📝 Bản nháp: 250
    từ" without N+1 fetches.
    """
    student_id = student["id"]

    q = (
        supabase_admin.table("writing_assignments")
        .select(
            "id, status, deadline, instructions, "
            "created_at, submitted_at, delivered_at, essay_id, "
            "is_timed, time_limit_minutes, started_at, auto_submitted, "
            "writing_prompts(id, title, prompt_text, task_type, difficulty, prompt_image_url)"
        )
        .eq("student_id", student_id)
        .order("created_at", desc=True)
    )
    if status_filter:
        q = q.eq("status", status_filter)
    try:
        result = q.execute()
    except Exception as exc:
        logger.warning(
            "[writing-student] list assignments failed student=%s: %s",
            student_id, exc,
        )
        raise HTTPException(500, "Lỗi khi tải bài giao")

    assignments = result.data or []

    # Batch draft lookup keyed by assignment_id — saves N round-trips.
    drafts_by_assignment: dict[str, dict] = {}
    if assignments:
        try:
            d = (
                supabase_admin.table("writing_drafts")
                .select("assignment_id, word_count, updated_at")
                .eq("student_id", student_id)
                .execute()
            )
            for row in (d.data or []):
                aid = row.get("assignment_id")
                if aid:
                    drafts_by_assignment[aid] = row
        except Exception as exc:
            # Non-fatal: drafts annotation is a UX hint, not load-bearing.
            logger.warning(
                "[writing-student] drafts batch failed student=%s: %s",
                student_id, exc,
            )

    annotated = []
    for a in assignments:
        d = drafts_by_assignment.get(a["id"])
        annotated.append({
            **a,
            "has_draft":         d is not None,
            "draft_word_count":  (d or {}).get("word_count", 0),
            "draft_updated_at":  (d or {}).get("updated_at"),
        })

    return {
        "student": {
            "full_name":    student.get("full_name"),
            "student_code": student.get("student_code"),
            "target_band":  student.get("target_band"),
        },
        "assignments": annotated,
    }


@router.get("/my-assignments/{assignment_id}")
async def get_my_assignment(
    assignment_id: UUID,
    student: dict = Depends(get_current_student),
):
    """Single-assignment detail with the full prompt embedded plus
    the draft (if any). The dashboard's expandable inline form hits
    this on click to populate the textarea + the prompt preview."""
    assignment = _resolve_active_assignment(student["id"], str(assignment_id))

    try:
        d = (
            supabase_admin.table("writing_drafts")
            .select("draft_text, word_count, updated_at")
            .eq("assignment_id", str(assignment_id))
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.warning(
            "[writing-student] draft lookup failed assignment=%s: %s",
            assignment_id, exc,
        )
        d = None

    return {
        "assignment": assignment,
        "draft":      (d.data[0] if (d and d.data) else None),
        "timer":      _compute_timer_state(assignment),
    }


@router.patch("/my-assignments/{assignment_id}/draft")
async def upsert_my_draft(
    assignment_id: UUID,
    body: DraftUpsert,
    student: dict = Depends(get_current_student),
):
    """Upsert the student's draft for one assignment.

    PATCH is the right verb here because `api.js` doesn't expose PUT
    and the operation is idempotent — sending the same body twice in
    a row yields the same row state.

    Side effect: if the assignment is still in `pending`, this call
    auto-transitions it to `in_progress`. That single state move is
    intentional even when `draft_text` is empty (the textarea
    opening seeds an empty save) — once a student has touched the
    card, the assignment shouldn't read as "Chờ làm" anymore.
    """
    student_id = student["id"]
    assignment = _resolve_active_assignment(student_id, str(assignment_id))

    if assignment["status"] not in _ACTIVE_ASSIGNMENT_STATES:
        raise HTTPException(
            409,
            f"Không thể chỉnh draft — trạng thái bài là '{assignment['status']}'.",
        )

    # Sprint 2.6.1 — IELTS-mode timer expiry check.
    # The auto-stamp branch that used to live here was REMOVED:
    # `started_at` is now stamped explicitly by POST /start when the
    # student opens the submit modal, so a draft save can never be
    # the first thing that starts the clock.  This rules out the
    # "banner reads '—' until first save" canary 2026-05-06 and
    # makes the timer behaviour match what the student sees the
    # moment they click "Làm bài".
    #
    # We still re-check expiry here because a long-typing student
    # can cross the deadline mid-keystroke; rejecting the save with
    # 410 Gone is what tells the frontend to force-submit.
    timer = _compute_timer_state(assignment)
    if timer["is_expired"]:
        raise HTTPException(
            410,
            "Hết giờ làm bài. Hệ thống đang nộp bài tự động.",
        )

    payload = {
        "assignment_id": str(assignment_id),
        "student_id":    student_id,
        "draft_text":    body.draft_text,
    }
    try:
        r = (
            supabase_admin.table("writing_drafts")
            .upsert(payload, on_conflict="assignment_id")
            .execute()
        )
    except Exception as exc:
        logger.warning(
            "[writing-student] draft upsert failed assignment=%s: %s",
            assignment_id, exc,
        )
        raise HTTPException(500, "Không lưu được bản nháp")

    if not r.data:
        raise HTTPException(500, "Không lưu được bản nháp")

    if assignment["status"] == "pending":
        try:
            (
                supabase_admin.table("writing_assignments")
                .update({"status": "in_progress"})
                .eq("id", str(assignment_id))
                .execute()
            )
        except Exception as exc:
            # Non-fatal — the draft is saved; status will move on
            # the next save attempt.
            logger.warning(
                "[writing-student] auto-transition pending→in_progress "
                "failed assignment=%s: %s",
                assignment_id, exc,
            )

    return r.data[0]


@router.post("/my-assignments/{assignment_id}/submit")
async def submit_my_assignment(
    assignment_id: UUID,
    body: SubmitEssay,
    background_tasks: BackgroundTasks,
    student: dict = Depends(get_current_student),
):
    """Final submission: writing_essays insert + writing_jobs queue +
    BG grader task, then link essay_id back onto the assignment and
    delete the draft.

    Reuses `essay_service.create_essay_with_job` + `_bg_grade_essay`
    so this path goes through the same retry / cost / pricing logic
    as admin-side submissions.

    Audit-field caveat: `writing_essays.submitted_by_admin` is
    NOT NULL with a FK to users(id). For student submissions we
    stamp the student's `user_id` (the activated student is a row
    in `users` because /activate established the link). The column
    name is misleading but the FK semantic — "the user who
    submitted" — holds; renaming it is queued for a later sprint.
    """
    student_id = student["id"]
    user_id    = student.get("user_id")
    if not user_id:
        # Defensive — a student without user_id can't submit because
        # the audit column is NOT NULL and we have nothing to stamp.
        # Should be unreachable: get_current_student already filters
        # by user_id = auth.uid().
        raise HTTPException(403, "Tài khoản chưa được link với học viên đầy đủ.")

    assignment = _resolve_active_assignment(student_id, str(assignment_id))

    prompt = assignment.get("writing_prompts") or {}
    prompt_text = prompt.get("prompt_text")
    task_type   = prompt.get("task_type")
    if not prompt_text or not task_type:
        # The assignment can outlive its prompt (ON DELETE RESTRICT
        # blocks hard deletes, but soft-deleted prompts could leave
        # this null in edge cases) — fail clearly rather than
        # creating an essay row without context.
        raise HTTPException(
            500,
            "Đề bài của assignment không khả dụng. Vui lòng liên hệ giảng viên.",
        )

    # ── Sprint 2.7 fix #3: atomic claim against two-tab race ──────
    # Pre-2.7 we did a SELECT-then-UPDATE: tab A reads `in_progress`,
    # tab B reads `in_progress`, both UPDATE → two essay rows for one
    # assignment, the second overwrites the link. Replace with a
    # single conditional UPDATE filtered on the current status —
    # only one tab gets non-empty `data` back.
    #
    # Status flips to `submitted` (the spam path will move it to
    # `delivered` later, which is allowed by the state matrix).
    # `submitted_at` + `auto_submitted` are stamped here so the
    # audit timestamps match the moment we won the race, not the
    # moment essay creation finished.
    original_status     = assignment["status"]
    timer               = _compute_timer_state(assignment)
    auto_submitted_flag = bool(timer["is_expired"])
    now_iso             = datetime.now(timezone.utc).isoformat()

    try:
        claim_resp = (
            supabase_admin.table("writing_assignments")
            .update({
                "status":         "submitted",
                "submitted_at":   now_iso,
                "auto_submitted": auto_submitted_flag,
            })
            .eq("id", str(assignment_id))
            .eq("student_id", student_id)
            .in_("status", list(_ACTIVE_ASSIGNMENT_STATES))
            .execute()
        )
    except Exception as exc:
        logger.error(
            "[writing-student] atomic claim failed "
            "assignment=%s: %s",
            assignment_id, exc,
        )
        raise HTTPException(500, "Không nộp được bài. Vui lòng thử lại.")

    if not claim_resp.data:
        # Lost the race (or the row drifted out of an active state
        # between resolve and claim). Re-fetch the canonical status
        # so the error message tells the student what happened.
        try:
            fresh = (
                supabase_admin.table("writing_assignments")
                .select("status")
                .eq("id", str(assignment_id))
                .eq("student_id", student_id)
                .limit(1)
                .execute()
            )
            cur = fresh.data[0]["status"] if fresh.data else "unknown"
        except Exception:
            cur = "unknown"
        raise HTTPException(
            409,
            f"Không thể nộp — trạng thái bài là '{cur}' "
            f"(có thể đã được nộp ở tab khác).",
        )

    # ── Post-claim work ───────────────────────────────────────────
    # Wrapped in try/except: any HTTPException raised below means
    # essay creation failed AFTER we claimed the row, so we have to
    # roll the assignment back to its original status. Otherwise the
    # student is stuck on a `submitted` row with no essay attached.
    try:
        # Prefer the body-supplied essay_text; fall back to the
        # saved draft so a student with bad connectivity who lost
        # the form can still submit "what was last saved".
        # Sprint 2.6.1: ALSO read `paste_events` from the same draft
        # row in one round-trip so we can copy the audit array onto
        # the essay regardless of which branch (flagged / clean) we
        # end up taking.
        essay_text = (body.essay_text or "").strip() if body.essay_text else ""
        paste_events: list = []
        try:
            d = (
                supabase_admin.table("writing_drafts")
                .select("draft_text, paste_events")
                .eq("assignment_id", str(assignment_id))
                .limit(1)
                .execute()
            )
            if d.data:
                if not essay_text:
                    essay_text = (d.data[0].get("draft_text") or "").strip()
                paste_events = d.data[0].get("paste_events") or []
        except Exception as exc:
            logger.warning(
                "[writing-student] draft fallback fetch failed "
                "assignment=%s: %s",
                assignment_id, exc,
            )

        # Sprint 2.6.1: an event with char_count >= 50 is the "log"
        # tier that the frontend allowed but recorded; its presence
        # is the admin signal "this submission warrants a closer
        # look".
        suspicious_paste = any(
            (e or {}).get("char_count", 0) >= 50 for e in paste_events
        )

        # ── Phase 2.6: spam / quality flag gate ───────────────────
        # Replaces the pre-2.6 hard 400 "essay too short" reject.
        # We now accept the submission, skip grading, and stamp the
        # row with the triggered flag reasons so the student isn't
        # stuck on a locked assignment and the admin still has full
        # audit context.
        flags = detect_flags(essay_text)
        if flags:
            return _persist_flagged_submission(
                assignment_id    = assignment_id,
                assignment       = assignment,
                student_id       = student_id,
                user_id          = user_id,
                prompt_text      = prompt_text,
                task_type        = task_type,
                essay_text       = essay_text,
                flags            = flags,
                paste_events     = paste_events,
                suspicious_paste = suspicious_paste,
            )

        # Reuse the admin-side submission pipeline. analysis_level=3
        # is the Phase-1 default (matches `services.essay_service`
        # ETA table); admins still control the ceiling via the
        # prompt-text / essay-text caps inside
        # `create_essay_with_job`.
        info = essay_service.create_essay_with_job(
            data={
                "student_id":      student_id,
                "task_type":       task_type,
                "prompt_text":     prompt_text,
                "essay_text":      essay_text,
                "analysis_level":  3,
                "form_of_address": "em",
                "selected_model":  "gemini-2.5-pro",
            },
            admin_id=user_id,  # see "Audit-field caveat" above
        )

        # Sprint 2.6.1: stamp paste audit onto the new essay row.
        # Best-effort — failure here doesn't roll back the essay
        # (grading is already queued).
        if paste_events:
            try:
                (
                    supabase_admin.table("writing_essays")
                    .update({
                        "paste_events":     paste_events,
                        "suspicious_paste": suspicious_paste,
                    })
                    .eq("id", info["essay_id"])
                    .execute()
                )
            except Exception as exc:
                logger.warning(
                    "[writing-student] paste audit stamp failed "
                    "essay=%s: %s",
                    info["essay_id"], exc,
                )

        background_tasks.add_task(
            essay_service._bg_grade_essay,
            info["essay_id"],
            info["job_id"],
        )

        # Link the essay onto the already-claimed assignment row.
        # Sprint 2.7 fix #3: status / submitted_at / auto_submitted
        # were stamped by the atomic claim; this UPDATE only adds
        # the essay_id so a `id IS NOT NULL` filter on the row
        # surfaces it as "fully linked".
        try:
            (
                supabase_admin.table("writing_assignments")
                .update({"essay_id": info["essay_id"]})
                .eq("id", str(assignment_id))
                .execute()
            )
        except Exception as exc:
            # Don't roll back the essay — grading is already in
            # flight and the student saw a successful submit. Log
            # loudly so admin can hand-link if needed.
            logger.error(
                "[writing-student] assignment link failed "
                "assignment=%s essay=%s: %s",
                assignment_id, info["essay_id"], exc,
            )

        # Delete the draft now that it's been promoted to an essay.
        # Best-effort — a stale draft after submit is recoverable,
        # but showing it in the dashboard would be confusing.
        try:
            (
                supabase_admin.table("writing_drafts")
                .delete()
                .eq("assignment_id", str(assignment_id))
                .execute()
            )
        except Exception as exc:
            logger.warning(
                "[writing-student] draft cleanup failed assignment=%s: %s",
                assignment_id, exc,
            )

        return {
            "essay_id":      info["essay_id"],
            "job_id":        info["job_id"],
            "assignment_id": str(assignment_id),
            "status":        "submitted",
            "eta_seconds":   info.get("eta_seconds"),
            "message":       "Bài viết đã được nộp. Em sẽ nhận kết quả sớm.",
        }
    except HTTPException:
        # Roll the assignment back to its pre-claim state so the
        # student can retry. We deliberately don't try to clean up
        # writing_essays here — `create_essay_with_job` either
        # raises before insert (nothing to clean) or after the
        # essay row is committed (the row stands as an audit trail).
        try:
            (
                supabase_admin.table("writing_assignments")
                .update({
                    "status":         original_status,
                    "submitted_at":   None,
                    "auto_submitted": False,
                })
                .eq("id", str(assignment_id))
                .execute()
            )
        except Exception as exc:
            logger.error(
                "[writing-student] claim rollback failed "
                "assignment=%s original=%s: %s",
                assignment_id, original_status, exc,
            )
        raise


# ── Phase 2.3c-3 — IELTS-mode timer state ────────────────────────────


@router.get("/my-assignments/{assignment_id}/timer")
async def get_timer_state(
    assignment_id: UUID,
    student: dict = Depends(get_current_student),
):
    """Lightweight read-only endpoint for client-side timer sync.

    The frontend ticks locally for a smooth countdown but reconciles
    every ~30 seconds against this endpoint so client clock drift
    doesn't accumulate.  Server time is the truth — if the client
    sees 02:14 remaining and the server says 01:08, the client must
    snap down to match.

    Auth uses `Depends(get_current_student)` (the same dependency
    every other student-facing endpoint here uses) so an admin or
    a student belonging to a different `students` row can't poll
    a stranger's timer.

    Response shape mirrors `_compute_timer_state` plus two extra
    fields (`status`, `auto_submitted`) the client uses to decide
    whether the form should still accept input at all.
    """
    student_id = student["id"]

    r = (
        supabase_admin.table("writing_assignments")
        .select(
            "status, is_timed, time_limit_minutes, started_at, auto_submitted"
        )
        .eq("id", str(assignment_id))
        .eq("student_id", student_id)
        .limit(1)
        .execute()
    )
    if not r.data:
        raise HTTPException(404, "Assignment không tìm thấy")

    row = r.data[0]
    timer = _compute_timer_state(row)
    timer["status"]         = row["status"]
    timer["auto_submitted"] = bool(row.get("auto_submitted"))
    return timer


# ── Sprint 2.6.1 — explicit start trigger + paste-event log ──────────


class PasteLog(BaseModel):
    """Body for POST /paste-log. The frontend's paste handler decides
    whether to block (>200 chars) or just log (50-200 chars) and
    reports the verdict via `blocked` so the audit trail records
    BOTH branches.  We don't trust char_count to be honest — it's a
    forensic signal, not a security boundary."""
    char_count: int  = Field(..., ge=0,    le=100_000)
    blocked:    bool = False


@router.post("/my-assignments/{assignment_id}/start")
async def start_assignment(
    assignment_id: UUID,
    student: dict = Depends(get_current_student),
):
    """Explicit timer start, called when the student clicks "Làm bài".

    Replaces the pre-2.6.1 pattern where `started_at` was auto-stamped
    on the first PATCH /draft. The auto-stamp had a 3-second visible
    delay (the auto-save debounce) during which the timer banner
    rendered '—' — confusing canary 2026-05-06.

    Behaviour:
      • Stamps `started_at` if NULL (timer begins now).
      • Transitions status `pending` → `in_progress` if pending.
      • Both writes are idempotent — re-clicking "Làm bài" on an
        already-started timed assignment is a no-op for `started_at`
        (we never overwrite a running clock).

    Returns the fresh timer state so the frontend can start the
    countdown immediately without a follow-up GET.
    """
    student_id = student["id"]

    r = (
        supabase_admin.table("writing_assignments")
        .select(
            "status, is_timed, time_limit_minutes, started_at, auto_submitted"
        )
        .eq("id", str(assignment_id))
        .eq("student_id", student_id)
        .limit(1)
        .execute()
    )
    if not r.data:
        raise HTTPException(404, "Assignment không tìm thấy")
    row = r.data[0]

    # Past `in_progress` means the row has been handed to the grader
    # (or already delivered). Re-starting it would silently reset
    # the audit trail; bounce with 409 so the frontend can show the
    # right state instead.
    if row["status"] not in _ACTIVE_ASSIGNMENT_STATES:
        raise HTTPException(
            409,
            f"Không thể bắt đầu — trạng thái bài là '{row['status']}'.",
        )

    update_payload: dict = {}
    if row["status"] == "pending":
        update_payload["status"] = "in_progress"
    if not row.get("started_at"):
        update_payload["started_at"] = datetime.now(timezone.utc).isoformat()

    if update_payload:
        try:
            (
                supabase_admin.table("writing_assignments")
                .update(update_payload)
                .eq("id", str(assignment_id))
                .execute()
            )
            # Reflect the patch on the local row so the timer state
            # we return matches what the DB will return on the next
            # read.
            row.update(update_payload)
        except Exception as exc:
            logger.warning(
                "[writing-student] start stamp failed assignment=%s: %s",
                assignment_id, exc,
            )

    timer = _compute_timer_state(row)
    timer["status"]         = row["status"]
    timer["auto_submitted"] = bool(row.get("auto_submitted"))
    return {"started": True, "timer": timer}


@router.post("/my-assignments/{assignment_id}/paste-log")
async def log_paste(
    assignment_id: UUID,
    body: PasteLog,
    student: dict = Depends(get_current_student),
):
    """Append a paste event to the assignment's draft row.

    The events stay on `writing_drafts.paste_events` until submit,
    when they're copied onto `writing_essays.paste_events` (so the
    audit survives the draft delete).

    Sprint 2.7 fix #5: switched from a SELECT-then-UPDATE pattern to
    the `append_paste_event` SQL function (migration 042) which does
    INSERT...ON CONFLICT DO UPDATE with the JSONB `||` operator
    inside a single statement. Eliminates the read-modify-write race
    window where two near-simultaneous pastes could each write past
    the other's append.

    Auth: ownership-checked through `get_current_student` + an
    explicit student_id filter on the assignment lookup so a paste
    log for someone else's assignment 404s instead of leaking.
    """
    student_id = student["id"]

    a_resp = (
        supabase_admin.table("writing_assignments")
        .select("id, status")
        .eq("id", str(assignment_id))
        .eq("student_id", student_id)
        .limit(1)
        .execute()
    )
    if not a_resp.data:
        raise HTTPException(404, "Assignment không tìm thấy")
    if a_resp.data[0]["status"] not in _ACTIVE_ASSIGNMENT_STATES:
        # No point logging pastes against a submitted/delivered row.
        raise HTTPException(
            409,
            f"Không thể log paste — trạng thái bài là '{a_resp.data[0]['status']}'.",
        )

    event = {
        "at":         datetime.now(timezone.utc).isoformat(),
        "char_count": body.char_count,
        "blocked":    bool(body.blocked),
    }

    try:
        rpc_resp = supabase_admin.rpc(
            "append_paste_event",
            {
                "p_assignment_id": str(assignment_id),
                "p_student_id":    student_id,
                "p_event":         event,
            },
        ).execute()
    except Exception as exc:
        logger.warning(
            "[writing-student] paste-log rpc failed assignment=%s: %s",
            assignment_id, exc,
        )
        raise HTTPException(500, "Không log được sự kiện paste")

    # The RPC returns the new total event count as a scalar — older
    # supabase-py clients wrap it in `data` as the raw value, newer
    # ones surface a list. Handle both shapes defensively.
    raw = getattr(rpc_resp, "data", None)
    if isinstance(raw, list) and raw:
        total = int(raw[0]) if raw[0] is not None else 0
    elif isinstance(raw, (int, float)):
        total = int(raw)
    else:
        total = 0
    return {"logged": True, "total_events": total}


# ── Phase 2.3c-2 — extract text from .docx / .txt upload ─────────────


@router.post("/extract-text")
async def extract_essay_text(
    file: UploadFile = File(...),
    student: dict = Depends(get_current_student),
):
    """Parse a student-uploaded .docx / .txt and return plain text.

    Stateless on purpose — the extracted text is appended to the
    submit form's textarea client-side, then auto-saved through the
    existing `PATCH /my-assignments/{id}/draft` flow.  Decoupling the
    extract step from draft persistence keeps the failure surface
    small: a parse error surfaces a 400 to the file picker without
    touching the saved draft.

    Auth: gated by `get_current_student` rather than a generic
    "any authenticated user" — only students with a `students` row
    write essays, and the endpoint serves that single use case.
    Admins testing the parse path can hit it locally with a service
    token.
    """
    # `student` is unused below but the Depends() call enforces auth
    # + the linked-student check before we read the upload body.
    _ = student

    file_bytes = await file.read()

    try:
        text = extract_text(file.filename or "", file_bytes)
    except FileExtractError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        # Unexpected failure shape — log enough to debug but don't
        # leak the SDK error string to the user.
        logger.error(
            "[writing-student] extract-text unexpected error filename=%s: %s",
            file.filename, exc,
        )
        raise HTTPException(
            status_code=500,
            detail="Lỗi xử lý file. Vui lòng thử lại.",
        )

    return {
        "filename":   file.filename,
        "text":       text,
        "char_count": len(text),
        "word_count": len(text.split()),
    }
