"""tests/test_writing_soft_delete.py — R2a writing soft-delete (PR-A).

Two layers:
  1. BEHAVIOURAL — DELETE /admin/writing/essays/{id} sets deleted_at via UPDATE
     (never .delete() → no cascade), returns 204; missing/already-deleted → 404;
     _fetch_status_or_404 treats a soft-deleted essay as gone (404) so admin
     mutations refuse it. Handlers are called directly (no `main` import → no
     network-blocked router warmup).
  2. SOURCE-COVERAGE — every read path in §3 of Discovery carries the
     `deleted_at IS NULL` filter, so a future edit can't silently drop one and
     resurrect deleted essays.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from routers import admin_writing as AW

_ESSAY_ID = "00000000-0000-0000-0000-000000000002"
BACKEND = Path(__file__).resolve().parents[1]


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── 1. BEHAVIOURAL ────────────────────────────────────────────────────────────

def test_delete_essay_soft_deletes_and_returns_204(monkeypatch):
    monkeypatch.setattr(AW, "require_admin", AsyncMock(return_value={"id": "admin-1"}))
    db = MagicMock()
    # table().update().eq().is_().execute().data → a live row updated
    db.table.return_value.update.return_value.eq.return_value.is_.return_value.execute.return_value.data = [{"id": _ESSAY_ID}]
    monkeypatch.setattr(AW, "supabase_admin", db)

    from uuid import UUID
    res = _run(AW.delete_essay(UUID(_ESSAY_ID), authorization="x"))
    assert res is None                                   # 204 No Content

    # it was an UPDATE setting deleted_at — NOT a hard delete (no cascade)
    update_arg = db.table.return_value.update.call_args[0][0]
    assert "deleted_at" in update_arg and update_arg["deleted_at"]
    db.table.return_value.delete.assert_not_called()
    # only acts on a live row (idempotent re-delete is a no-op → 404)
    db.table.return_value.update.return_value.eq.return_value.is_.assert_called_with("deleted_at", "null")


def test_delete_essay_missing_or_already_deleted_404(monkeypatch):
    monkeypatch.setattr(AW, "require_admin", AsyncMock(return_value={"id": "admin-1"}))
    db = MagicMock()
    db.table.return_value.update.return_value.eq.return_value.is_.return_value.execute.return_value.data = []
    monkeypatch.setattr(AW, "supabase_admin", db)

    from uuid import UUID
    with pytest.raises(HTTPException) as e:
        _run(AW.delete_essay(UUID(_ESSAY_ID), authorization="x"))
    assert e.value.status_code == 404


def test_fetch_status_treats_soft_deleted_as_404(monkeypatch):
    db = MagicMock()
    chain = db.table.return_value.select.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value
    # soft-deleted essay → filtered out → empty → 404 (so feedback/mark-delivered/regrade refuse it)
    chain.data = []
    monkeypatch.setattr(AW, "supabase_admin", db)
    with pytest.raises(HTTPException) as e:
        AW._fetch_status_or_404(_ESSAY_ID)
    assert e.value.status_code == 404
    # the filter was applied
    db.table.return_value.select.return_value.eq.return_value.is_.assert_called_with("deleted_at", "null")


def test_fetch_status_live_essay_ok(monkeypatch):
    db = MagicMock()
    chain = db.table.return_value.select.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value
    chain.data = [{"status": "graded"}]
    monkeypatch.setattr(AW, "supabase_admin", db)
    assert AW._fetch_status_or_404(_ESSAY_ID) == "graded"


# ── 2. SOURCE-COVERAGE — every §3 read path filters deleted_at ────────────────
# (min expected `is_("deleted_at", ...)` occurrences per file — a guard so a
#  future refactor can't drop a filter and resurrect deleted essays.)
_EXPECTED = {
    "routers/admin_writing.py":            4,   # _fetch_status_or_404, delete, regrade, student_summary
    "services/essay_service.py":           4,   # list / with_feedback / render_context / status
    "routers/writing_student.py":          4,   # my-essays, detail, export, regrade-request
    "services/student_home_aggregator.py": 2,   # list + latest-delivered
    "routers/admin_overview.py":           3,   # recent / total / pending
    "services/admin_dashboard.py":         1,   # writing_pending count
    "services/instructor_workflow.py":     1,   # queue hydration
    "routers/admin_writing_cohorts.py":    1,   # cohort essays
    "services/student_service.py":         1,   # student history
    "routers/admin_writing_regrade.py":    1,   # regrade-request list
    "services/writing_history.py":         3,   # recurring / trajectory / sentence-structure
}


@pytest.mark.parametrize("rel,minimum", list(_EXPECTED.items()))
def test_read_path_filters_deleted_at(rel, minimum):
    src = (BACKEND / rel).read_text(encoding="utf-8")
    n = src.count('is_("deleted_at"') + src.count('is_("writing_essays.deleted_at"')
    assert n >= minimum, f"{rel}: expected >= {minimum} deleted_at filters, found {n}"


def test_delete_handler_never_hard_deletes_essays():
    # PR-A must NOT add any .delete() on writing_essays in the delete handler.
    src = (BACKEND / "routers/admin_writing.py").read_text(encoding="utf-8")
    # the delete_essay function body uses update(... deleted_at ...), not .delete()
    body = src[src.index("async def delete_essay"):src.index("async def delete_essay") + 1200]
    assert ".update({" in body and "deleted_at" in body
    assert ".delete()" not in body


def test_migration_101_present_and_additive():
    sql = (BACKEND / "migrations/101_writing_essay_soft_delete.sql").read_text(encoding="utf-8")
    assert "ADD COLUMN IF NOT EXISTS deleted_at timestamptz" in sql
    assert "DROP TABLE" not in sql and "DELETE FROM" not in sql   # additive only
