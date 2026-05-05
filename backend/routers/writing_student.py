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
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from database import supabase_admin
from routers.auth import get_supabase_user

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
        result = (
            supabase_admin.table("students")
            .select("id, student_code, full_name, target_band")
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
