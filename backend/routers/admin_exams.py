"""routers/admin_exams.py — admin import + listing for the exam module (Phase 3).

Mirrors admin_reading: dry-run-first markdown import (validate before commit) and
a list that includes drafts. Admin-gated (require_admin).

  GET  /admin/exams              — all exams incl. drafts.
  POST /admin/exams/import       — import one exam markdown file (dry_run default).
"""
from __future__ import annotations

from fastapi import APIRouter, File, Header, Query, UploadFile

from routers.admin import require_admin
from services import exam_service

router = APIRouter(prefix="/admin/exams", tags=["admin-exams"])


@router.get("")
async def admin_list_exams(authorization: str | None = Header(default=None)):
    await require_admin(authorization)
    return {"exams": exam_service.admin_list_all()}


@router.post("/import")
async def admin_import_exam(
    file: UploadFile = File(...),
    dry_run: bool = Query(default=True),
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    raw = await file.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return {"ok": False, "validation_errors": [{"field": "file", "message": "File phải là UTF-8."}]}
    return exam_service.import_exam(text, dry_run=dry_run)
