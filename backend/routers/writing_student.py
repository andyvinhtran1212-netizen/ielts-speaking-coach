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
                "created_at, delivered_at"
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
                "status, created_at, delivered_at"
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


# A submission with `essay_text` shorter than this is almost certainly
# a misclick — fail fast rather than burning a Gemini grade on it.
_MIN_SUBMIT_CHARS = 50

# Active states where the student is allowed to write/edit a draft and
# eventually submit. Anything past `in_progress` is locked: the row has
# already been handed to the grader and any further "edit" would
# silently lose the submitted essay.
_ACTIVE_ASSIGNMENT_STATES = {"pending", "in_progress"}


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

    # Phase 2.3c-3 — IELTS-mode timer.
    # 1. If timed and not yet started, stamp `started_at` BEFORE we
    #    write the draft. Once stamped the timer is running, and
    #    the very save that triggered it is the first valid save.
    # 2. If already started, re-check expiry against server time
    #    against the row we just stamped. A draft save that lands
    #    after expiry must be rejected (410 Gone) — accepting it
    #    would let a student keep editing past the deadline.
    if assignment.get("is_timed") and not assignment.get("started_at"):
        now_iso = datetime.now(timezone.utc).isoformat()
        try:
            (
                supabase_admin.table("writing_assignments")
                .update({"started_at": now_iso})
                .eq("id", str(assignment_id))
                .execute()
            )
        except Exception as exc:
            logger.warning(
                "[writing-student] started_at stamp failed "
                "assignment=%s: %s",
                assignment_id, exc,
            )
        # Reflect the stamp on the in-memory row so the expiry
        # check below sees it.
        assignment["started_at"] = now_iso

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

    if assignment["status"] not in _ACTIVE_ASSIGNMENT_STATES:
        raise HTTPException(
            409,
            f"Không thể nộp — trạng thái bài là '{assignment['status']}'.",
        )

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

    # Prefer the body-supplied essay_text; fall back to the saved
    # draft so a student with bad connectivity who lost the form can
    # still submit "what was last saved".
    essay_text = (body.essay_text or "").strip() if body.essay_text else ""
    if not essay_text:
        try:
            d = (
                supabase_admin.table("writing_drafts")
                .select("draft_text")
                .eq("assignment_id", str(assignment_id))
                .limit(1)
                .execute()
            )
            if d.data:
                essay_text = (d.data[0].get("draft_text") or "").strip()
        except Exception as exc:
            logger.warning(
                "[writing-student] draft fallback fetch failed "
                "assignment=%s: %s",
                assignment_id, exc,
            )

    if len(essay_text) < _MIN_SUBMIT_CHARS:
        raise HTTPException(
            400,
            f"Bài viết quá ngắn (cần ≥{_MIN_SUBMIT_CHARS} ký tự). "
            f"Hiện có {len(essay_text)} ký tự.",
        )

    # Reuse the admin-side submission pipeline. analysis_level=3 is
    # the Phase-1 default (matches `services.essay_service` ETA
    # table); admins still control the ceiling via the prompt-text /
    # essay-text caps inside `create_essay_with_job`.
    info = essay_service.create_essay_with_job(
        data={
            "student_id":     student_id,
            "task_type":      task_type,
            "prompt_text":    prompt_text,
            "essay_text":     essay_text,
            "analysis_level": 3,
            "form_of_address": "em",
            "selected_model":  "gemini-2.5-pro",
        },
        admin_id=user_id,  # see "Audit-field caveat" above
    )

    background_tasks.add_task(
        essay_service._bg_grade_essay,
        info["essay_id"],
        info["job_id"],
    )

    # Link essay back to the assignment + advance to `submitted`.
    # Stamp `submitted_at` server-side so the dashboard never has to
    # compute it client-side.
    #
    # Phase 2.3c-3: also set `auto_submitted=true` when the timer
    # was expired at submit time. The frontend triggers submit at
    # 0:00 client-side, but a few-second drift between client and
    # server clocks is normal — `_compute_timer_state` uses server
    # time so the audit flag matches what the backend saw, not what
    # the student's laptop clock said.
    timer = _compute_timer_state(assignment)
    auto_submitted_flag = bool(timer["is_expired"])

    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        (
            supabase_admin.table("writing_assignments")
            .update({
                "essay_id":       info["essay_id"],
                "status":         "submitted",
                "submitted_at":   now_iso,
                "auto_submitted": auto_submitted_flag,
            })
            .eq("id", str(assignment_id))
            .execute()
        )
    except Exception as exc:
        # Don't roll back the essay — grading is already in flight
        # and the student saw a successful submit. Log loudly so
        # admin can hand-link if needed.
        logger.error(
            "[writing-student] assignment link failed "
            "assignment=%s essay=%s: %s",
            assignment_id, info["essay_id"], exc,
        )

    # Delete the draft now that it's been promoted to an essay.
    # Best-effort — a stale draft after submit is recoverable, but
    # showing it in the dashboard would be confusing.
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
