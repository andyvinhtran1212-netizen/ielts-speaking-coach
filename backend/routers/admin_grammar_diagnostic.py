"""Admin-only educator view for MASTER30 Grammar Diagnostic reports."""

from __future__ import annotations

from fastapi import APIRouter, Header
from pydantic import BaseModel

from routers.admin import require_admin
from routers.grammar_diagnostic import EducatorReportResponse
from services import grammar_diagnostic_service as service
from services import runtime_flags
from database import supabase_admin


router = APIRouter(prefix="/admin/grammar-diagnostic", tags=["admin", "grammar-diagnostic"])


class GrammarDiagnosticCatalogEntry(BaseModel):
    id: str
    code: str
    title: str
    part: None = None
    lesson_no: None = None
    ready: bool
    already_given: bool
    reason: str | None = None
    exam_only: bool
    cohort_ids: list[str]
    explanation_ready: bool
    explanation_state: str
    explanation_count: int | None = None
    explanation_ready_count: int | None = None
    runtime: str


@router.get("/catalog", response_model=list[GrammarDiagnosticCatalogEntry])
async def catalog(
    authorization: str | None = Header(default=None),
) -> list[GrammarDiagnosticCatalogEntry]:
    await require_admin(authorization)
    enabled = runtime_flags.is_enabled("master30_grammar_diagnostic", default=False)
    releases = (
        supabase_admin.table("grammar_content_releases")
        .select("id, validation").eq("status", "active").limit(1).execute().data
    ) or []
    content_ready = bool(
        releases and (releases[0].get("validation") or {}).get("passed")
    )
    ready = enabled and content_ready
    if not content_ready:
        reason = "Chưa có release nội dung đã kiểm tra và kích hoạt"
    elif not enabled:
        reason = "Đang khóa cho tới khi hoàn tất smoke gate"
    else:
        reason = None
    shared = {
        "part": None, "lesson_no": None, "ready": ready,
        "already_given": False, "reason": reason, "exam_only": False,
        "cohort_ids": [], "explanation_ready": False,
        "explanation_state": "not_applicable", "explanation_count": None,
        "explanation_ready_count": None, "runtime": "master30_grammar",
    }
    return [
        {**shared, "id": "master30-quick", "code": "MASTER30-Q",
         "title": "Quick Grammar Check-up · 28 câu"},
        {**shared, "id": "master30-full", "code": "MASTER30-F",
         "title": "Full Grammar Diagnostic · tối đa 54 câu"},
    ]


@router.get("/sessions/{session_id}/report", response_model=EducatorReportResponse)
async def report(
    session_id: str,
    authorization: str | None = Header(default=None),
) -> EducatorReportResponse:
    await require_admin(authorization)
    return service.educator_report(session_id)
