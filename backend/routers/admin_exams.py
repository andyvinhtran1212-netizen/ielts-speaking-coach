"""routers/admin_exams.py — admin import + listing for the exam module (Phase 3).

Mirrors admin_reading: dry-run-first markdown import (validate before commit) and
a list that includes drafts. Admin-gated (require_admin).

  GET  /admin/exams              — all exams incl. drafts.
  POST /admin/exams/import       — import one exam markdown file (dry_run default).
"""
from __future__ import annotations

import asyncio
import weakref
from contextlib import suppress

from fastapi import APIRouter, File, Header, Query, UploadFile

from routers.admin import require_admin
from services import exam_service

router = APIRouter(prefix="/admin/exams", tags=["admin-exams"])


# Imports are infrequent: serialize commits without parsing the upload twice.
# Holders and waiters retain the shared lock; idle event loops are not retained.
_import_lock: weakref.ReferenceType[asyncio.Lock] | None = None


async def _commit_import(text: str):
    global _import_lock
    lock = _import_lock() if _import_lock is not None else None
    if lock is None:
        lock = asyncio.Lock()
        _import_lock = weakref.ref(lock)
    async with lock:
        work = asyncio.ensure_future(asyncio.to_thread(exam_service.import_exam, text, dry_run=False))
        try:
            return await asyncio.shield(work)
        except asyncio.CancelledError:
            # Cancellation cannot stop the thread between metadata upsert and
            # question replacement. Keep the lock until every write finishes.
            while not work.done():
                with suppress(asyncio.CancelledError):
                    await asyncio.wait({work})
            if not work.cancelled():
                work.exception()
            raise


@router.get("")
async def admin_list_exams(authorization: str | None = Header(default=None)):
    await require_admin(authorization)
    return {"exams": await asyncio.to_thread(exam_service.admin_list_all)}


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
    if dry_run:
        return await asyncio.to_thread(exam_service.import_exam, text, dry_run=True)
    return await _commit_import(text)
