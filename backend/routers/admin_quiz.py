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
import json
import asyncio
from uuid import UUID

from fastapi import APIRouter, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool
from starlette.concurrency import run_in_threadpool

from database import supabase_admin
from routers.admin import require_admin
from services.quiz_import import PublishState, import_quiz_file
from models.grammar_quiz_revisions import (
    MAX_SOURCE_BYTES, GrammarRevisionCommitRequest, GrammarRevisionCommitResult,
    GrammarRevisionErrorResponse, GrammarRevisionPreview, GrammarRevisionPreviewRequest,
    GrammarRevisionRead,
)
from services import grammar_quiz_revisions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/quiz", tags=["admin-quiz"])
_GRAMMAR_REVISION_ERRORS = {status:{'model':GrammarRevisionErrorResponse} for status in (404,409,422,503)}


def _grammar_revision_thread_call(action,url,*args):
    async def execute():
        # Request-scoped connection, using the existing configured owner URL.
        # No pooled async connection crosses event loops; no credentials reload.
        engine=create_async_engine(url,poolclass=NullPool)
        try:
            return await action(engine,*args)
        finally:
            await engine.dispose()
    return asyncio.run(execute())


async def _grammar_revision_call(action,*args):
    from routers import admin
    try:
        if admin._db_engine is not None:
            # Legacy synchronous PostgREST writers can block the HTTP loop
            # while waiting for a queued exclusive cutover. Run all three
            # owner transactions independently of that HTTP event loop so
            # both shared readers and the cutover can release their gates.
            return await run_in_threadpool(_grammar_revision_thread_call,action,admin._db_engine.url,*args)
        return await action(admin._db_engine,*args)
    except grammar_quiz_revisions.GrammarRevisionError as error:
        raise HTTPException(error.status_code,{'error_code':error.code,
            'message':error.message,'current_revision':error.current_revision}) from None


class _BoundedGrammarRevisionRoute(APIRoute):
    """Bound original bytes and invalid Unicode before framework decoding.

    A lone escaped surrogate can otherwise survive JSON parsing and break
    FastAPI's 422 encoder while it reflects the invalid input. Keep errors
    static and retain the normal typed body/OpenAPI contract.
    """
    def get_route_handler(self):
        handler=super().get_route_handler()
        async def bounded(request: Request):
            raw=await request.body()
            if len(raw)>MAX_SOURCE_BYTES:
                return JSONResponse(status_code=422,content={'detail':{'error_code':'grammar_source_too_large',
                    'message':'Nội dung gửi vượt giới hạn 256KiB.','current_revision':None}})
            def unique(pairs):
                value={}
                for key,item in pairs:
                    if key in value: raise ValueError('duplicate request key')
                    value[key]=item
                return value
            def nonfinite(value):
                raise ValueError('nonfinite JSON number')
            try:
                pending=[(json.loads(raw,object_pairs_hook=unique,parse_constant=nonfinite),0)]
                while pending:
                    value,depth=pending.pop()
                    # These commands are flat typed objects. Bound invalid
                    # nested input before framework validation reflects it.
                    if depth>64: raise ValueError('request nesting too deep')
                    if isinstance(value,str): value.encode('utf8')
                    elif isinstance(value,dict):
                        pending.extend((item,depth+1) for item in value)
                        pending.extend((item,depth+1) for item in value.values())
                    elif isinstance(value,list): pending.extend((item,depth+1) for item in value)
            except (UnicodeError,ValueError,RecursionError):
                return JSONResponse(status_code=422,content={'detail':[{'loc':['body'],
                    'type':'json_invalid','msg':'Nội dung phải là JSON UTF-8 hợp lệ với khóa duy nhất.'}]})
            return await handler(request)
        return bounded


@router.get('/grammar-revisions/{canonical_code}',response_model=GrammarRevisionRead,
    responses=_GRAMMAR_REVISION_ERRORS)
async def read_grammar_revision(canonical_code: str,authorization: str | None=Header(None)):
    await require_admin(authorization)
    return await _grammar_revision_call(grammar_quiz_revisions.read_revision,canonical_code)


async def preview_grammar_revision(canonical_code: str,body: GrammarRevisionPreviewRequest,
    authorization: str | None=Header(None)):
    await require_admin(authorization)
    return await _grammar_revision_call(grammar_quiz_revisions.preview_revision,canonical_code,body)


async def commit_grammar_revision(canonical_code: str,body: GrammarRevisionCommitRequest,
    authorization: str | None=Header(None)):
    actor = await require_admin(authorization)
    return await _grammar_revision_call(grammar_quiz_revisions.commit_revision,canonical_code,actor['id'],body)


router.add_api_route('/grammar-revisions/{canonical_code}/preview',preview_grammar_revision,
    methods=['POST'],response_model=GrammarRevisionPreview,responses=_GRAMMAR_REVISION_ERRORS,
    route_class_override=_BoundedGrammarRevisionRoute)
router.add_api_route('/grammar-revisions/{canonical_code}/commit',commit_grammar_revision,
    methods=['POST'],response_model=GrammarRevisionCommitResult,responses=_GRAMMAR_REVISION_ERRORS,
    route_class_override=_BoundedGrammarRevisionRoute)


class BankUpdate(BaseModel):
    title: str | None = None
    topic_id: str | None = None
    is_published: bool | None = None


@router.post("/import")
async def import_bank(
    file: UploadFile = File(...),
    topic_id: str | None = Query(default=None),
    dry_run: bool = Query(default=True),
    publish_state: PublishState = Query(default="preserve"),
    authorization: str | None = Header(None),
):
    await require_admin(authorization)
    text = (await file.read()).decode("utf-8", errors="replace")
    return import_quiz_file(
        text, topic_id=topic_id, dry_run=dry_run,
        publish_state=publish_state,
    )


@router.get("/banks")
async def list_banks(
    topic_id: str | None = Query(default=None),
    skill_area: str | None = Query(default=None),
    authorization: str | None = Header(None),
):
    await require_admin(authorization)
    q = supabase_admin.table("quiz_banks").select(
        "id, topic_id, code, title, skill_area, words_count, source, version, "
        "is_published, updated_at, grammar_canonical_code, grammar_revision, "
        "grammar_is_current, grammar_new_starts_enabled"
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


@router.get("/banks/{bank_id}/attempt-report")
async def bank_attempt_report(
    bank_id: UUID,
    assignment_id: UUID = Query(...),
    authorization: str | None = Header(None),
):
    """Học viên làm bài tập theo buổi trong bao lâu, và vướng ở đâu.

    Trả `{students, axes}`. `students[].state` phân biệt ba chuyện mà tới nay
    bị gộp thành "chưa nộp": đang làm dở, bỏ dở quá 24 giờ, và chưa mở bài lần
    nào — chỉ chuyện thứ ba mới thật sự là "chưa làm".
    """
    await require_admin(authorization)
    from services import quiz_service
    return quiz_service.course_attempt_report(bank_id=str(bank_id), assignment_id=str(assignment_id))


@router.get("/banks/{bank_id}/students/{user_id}/report")
async def student_answer_report(
    bank_id: UUID,
    user_id: UUID,
    assignment_id: UUID = Query(...),
    authorization: str | None = Header(None),
):
    """Bài làm chi tiết của MỘT học viên trong MỘT bài giao.

    Trước đó giáo viên chỉ thấy một con số phần trăm và không có cách nào biết
    em ấy sai ở đâu, chọn nhầm phương án nào, hay mất bao lâu cho mỗi câu.
    """
    await require_admin(authorization)
    from services import quiz_service
    return quiz_service.course_answer_report(
        user_id=str(user_id), bank_id=str(bank_id), assignment_id=str(assignment_id),
    )


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
async def quiz_student_detail(
    user_id: UUID,
    skill_area: str = Query(default="vocab"),
    authorization: str | None = Header(None),
):
    """One learner's practice detail — per-bank progress + recent sessions, scoped
    to skill_area so the vocab report doesn't leak grammar practice."""
    await require_admin(authorization)
    from services import quiz_service
    return quiz_service.admin_student_detail(str(user_id), skill_area=skill_area)


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
        if 'grammar_managed_bank_' in str(exc):
            raise HTTPException(409,'Bank Grammar đã được giữ theo phiên bản; dùng thao tác sửa đã duyệt.') from exc
        raise HTTPException(500, f"Lỗi cập nhật bank: {exc}")
    if not res.data:
        raise HTTPException(404, "Không tìm thấy bank")
    return res.data[0]


@router.delete("/banks/{bank_id}")
async def delete_bank(bank_id: UUID, authorization: str | None = Header(None)):
    await require_admin(authorization)
    try:
        rows = (supabase_admin.table("quiz_banks").select("id,meta,grammar_canonical_code")
                .eq("id", str(bank_id)).limit(1).execute().data) or []
        if not rows:
            raise HTTPException(404, "Không tìm thấy bank")
        if rows[0].get('grammar_canonical_code') is not None:
            raise HTTPException(409,'Bank Grammar giữ câu hỏi và lịch sử theo phiên bản; không thể xóa.')
        runtime = ((rows[0].get("meta") or {}).get("runtime") or {}).get("kind")
        if runtime == "advanced_vocab":
            raise HTTPException(
                409,
                "Bank Advanced Vocabulary là nội dung bất biến; hãy bỏ xuất bản "
                "để ngăn giao bài mới.",
            )
        supabase_admin.table("quiz_banks").delete().eq("id", str(bank_id)).execute()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        if 'grammar_managed_bank_' in str(exc):
            raise HTTPException(409,'Bank Grammar giữ lịch sử theo phiên bản; không thể xóa.') from exc
        if "cannot delete immutable advanced vocabulary bank" in str(exc):
            raise HTTPException(
                409,
                "Bank Advanced Vocabulary là nội dung bất biến; hãy bỏ xuất bản "
                "để ngăn giao bài mới.",
            ) from exc
        raise HTTPException(500, f"Lỗi xoá bank: {exc}")
    return {"id": str(bank_id), "deleted": True}
