"""routers/admin_exam_content.py — màn "Đề kỳ thi" (Đợt 3).

One screen across all three libraries: which papers exist, what course level
they target, which classes they are meant for. The question is asked ACROSS
reading/listening/writing, so it gets its own router rather than three separate
per-library additions.

Admin-only throughout — nothing here is ever student-facing.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from routers.admin import require_admin
from services import exam_content_service as svc

router = APIRouter(prefix="/admin/exam-content", tags=["admin-exam-content"])


class LevelBody(BaseModel):
    # Optional so the admin can CLEAR a level; "" is normalised to NULL by the
    # service. No pattern: the values are the centre's own course ladder and a
    # whitelist here would need a code change per new course.
    course_level: Optional[str] = Field(None, max_length=40)


class CohortsBody(BaseModel):
    # The FULL intended set — the screen shows every tick, so what it sends is
    # the state, not a delta.
    cohort_ids: list[str] = Field(default_factory=list, max_length=200)


@router.get("")
async def list_exam_content(
    kind: Optional[str] = Query(default=None),
    course_level: Optional[str] = Query(default=None),
    cohort_id: Optional[str] = Query(default=None),
    exam_only: Optional[bool] = Query(default=None),
    authorization: str | None = Header(default=None),
):
    """Papers across all three libraries with level + classes, filterable."""
    await require_admin(authorization)
    try:
        res = svc.list_exam_content(kind, course_level, cohort_id, exam_only)
        return {
            "items":  res["items"],
            # Named so the screen can say "Listening không tải được" instead of
            # rendering an empty library as if it were genuinely empty.
            "failed_kinds": res["failed_kinds"],
            "levels": svc.known_course_levels(),
        }
    except svc.UnknownKindError as e:
        raise HTTPException(422, str(e))


@router.patch("/{kind}/{content_id}/level")
async def set_course_level(
    kind: str, content_id: str, body: LevelBody,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    try:
        row = svc.set_course_level(kind, content_id, body.course_level)
    except svc.UnknownKindError as e:
        raise HTTPException(422, str(e))
    except LookupError as e:
        raise HTTPException(404, str(e))
    return {"id": row.get("id"), "course_level": row.get("course_level")}


@router.patch("/{kind}/{content_id}/cohorts")
async def set_cohorts(
    kind: str, content_id: str, body: CohortsBody,
    authorization: str | None = Header(default=None),
):
    """Thay TOÀN BỘ tập lớp của nội dung này — body là trạng thái, không phải delta.

    PATCH rather than PUT purely so the browser stays inside the CORS allowlist:
    _CORS_METHODS lists only the verbs the app actually uses, and adding PUT for
    one endpoint would mean a preflight that fails for everyone who has a cached
    one — the exact failure that swallowed a student's whole paper on
    2026-07-26. POST would be worse than either: it reads as "add one".
    """
    admin = await require_admin(authorization)
    try:
        return svc.set_cohorts(kind, content_id, body.cohort_ids,
                               created_by=admin.get("id"))
    except svc.UnknownKindError as e:
        raise HTTPException(422, str(e))
    except LookupError as e:
        raise HTTPException(404, str(e))
