"""routers/admin_quiz.py — Admin console for Quick-Check quiz banks (Pha 1).

All endpoints require_admin; writes via supabase_admin bypass RLS (mig 118).

  POST   /admin/quiz/import?topic_id=&dry_run=   — import a .md bank (1-file/bank).
  GET    /admin/quiz/banks?topic_id=&skill_area= — list banks (no questions).
  GET    /admin/quiz/banks/{id}                  — bank + its questions.
  PATCH  /admin/quiz/banks/{id}                  — title/topic_id/is_published.
  DELETE /admin/quiz/banks/{id}                  — delete bank (cascades questions).

The parse→validate→commit pipeline lives in services/quiz_import.py.
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, File, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel

from database import supabase_admin
from routers.admin import require_admin
from services.quiz_import import import_quiz_file

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/quiz", tags=["admin-quiz"])


class BankUpdate(BaseModel):
    title: str | None = None
    topic_id: str | None = None
    is_published: bool | None = None


@router.post("/import")
async def import_bank(
    file: UploadFile = File(...),
    topic_id: str | None = Query(default=None),
    dry_run: bool = Query(default=True),
    authorization: str | None = Header(None),
):
    await require_admin(authorization)
    text = (await file.read()).decode("utf-8", errors="replace")
    return import_quiz_file(text, topic_id=topic_id, dry_run=dry_run)


@router.get("/banks")
async def list_banks(
    topic_id: str | None = Query(default=None),
    skill_area: str | None = Query(default=None),
    authorization: str | None = Header(None),
):
    await require_admin(authorization)
    q = supabase_admin.table("quiz_banks").select(
        "id, topic_id, code, title, skill_area, words_count, source, version, "
        "is_published, updated_at"
    )
    if topic_id:
        q = q.eq("topic_id", topic_id)
    if skill_area:
        q = q.eq("skill_area", skill_area)
    try:
        return q.order("skill_area").order("code").execute().data or []
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn banks: {exc}")


@router.get("/banks/{bank_id}/analytics")
async def bank_analytics(bank_id: UUID, authorization: str | None = Header(None)):
    """Class-wide 'từ dễ sai' for a bank — per-item + per-skill error rates."""
    await require_admin(authorization)
    from services import quiz_service
    return quiz_service.bank_analytics(str(bank_id))


@router.get("/students")
async def quiz_students(
    skill_area: str = Query(default="vocab"),
    authorization: str | None = Header(None),
):
    """Observe learners' practice for a skill_area — {overview, students}."""
    await require_admin(authorization)
    from services import quiz_service
    return quiz_service.admin_student_rollup(skill_area=skill_area)


@router.get("/students/{user_id}")
async def quiz_student_detail(user_id: UUID, authorization: str | None = Header(None)):
    """One learner's practice detail — per-bank progress + recent sessions."""
    await require_admin(authorization)
    from services import quiz_service
    return quiz_service.admin_student_detail(str(user_id))


@router.get("/banks/{bank_id}")
async def get_bank(bank_id: UUID, authorization: str | None = Header(None)):
    await require_admin(authorization)
    try:
        bank = (
            supabase_admin.table("quiz_banks").select("*")
            .eq("id", str(bank_id)).limit(1).execute()
        ).data
        if not bank:
            raise HTTPException(404, "Không tìm thấy bank")
        questions = (
            supabase_admin.table("quiz_questions").select("*")
            .eq("bank_id", str(bank_id)).order("order").execute()
        ).data or []
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi truy vấn bank: {exc}")
    return {"bank": bank[0], "questions": questions}


@router.patch("/banks/{bank_id}")
async def update_bank(
    bank_id: UUID, body: BankUpdate, authorization: str | None = Header(None)
):
    await require_admin(authorization)
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(422, "Không có trường nào để cập nhật")
    try:
        res = (
            supabase_admin.table("quiz_banks")
            .update(patch).eq("id", str(bank_id)).execute()
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi cập nhật bank: {exc}")
    if not res.data:
        raise HTTPException(404, "Không tìm thấy bank")
    return res.data[0]


@router.delete("/banks/{bank_id}")
async def delete_bank(bank_id: UUID, authorization: str | None = Header(None)):
    await require_admin(authorization)
    try:
        supabase_admin.table("quiz_banks").delete().eq("id", str(bank_id)).execute()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Lỗi xoá bank: {exc}")
    return {"id": str(bank_id), "deleted": True}
