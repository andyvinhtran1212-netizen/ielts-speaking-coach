"""The create-exam picker must search the complete source, not a capped preload."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from routers import admin_mock_exams as router
from services import mock_exam_service as service


@pytest.mark.parametrize("kind,table,field,value", [
    ("reading", "reading_tests", "test_type", "full"),
    ("listening", "listening_tests", "status", "published"),
    ("writing-task1", "writing_prompts", "is_active", True),
    ("writing-task2", "writing_prompts", "task_type", "task2"),
])
def test_picker_search_and_page_are_database_scoped(kind, table, field, value):
    query = MagicMock()
    query.select.return_value = query
    query.eq.return_value = query
    query.in_.return_value = query
    query.or_.return_value = query
    query.order.return_value = query
    query.range.return_value = query
    query.execute.return_value = type("Response", (), {
        "data": [{"id": "row-101", "title": "Target"}], "count": 101,
    })()
    db = MagicMock()
    db.table.return_value = query
    with patch.object(service, "supabase_admin", db):
        page = service.admin_exam_picker_page(kind, "target,%_", 25, 100)
    db.table.assert_called_once_with(table)
    query.select.assert_called_once()
    assert query.select.call_args.kwargs["count"] == "exact"
    query.eq.assert_any_call(field, value)
    query.range.assert_called_once_with(100, 124)
    assert page == {"items": [{"id": "row-101", "title": "Target"}], "total": 101, "limit": 25, "offset": 100}
    assert '"%target,\\\\%\\\\_%"' in query.or_.call_args.args[0]


@pytest.mark.asyncio
async def test_picker_route_requires_admin_and_passes_bounded_query():
    with patch.object(router, "require_admin", new=AsyncMock()) as gate, \
         patch.object(router.svc, "admin_exam_picker_page", return_value={"items": [], "total": 0, "limit": 25, "offset": 0}) as picker:
        result = await router.exam_picker_page("reading", q="  needle  ", limit=25, offset=0, authorization="Bearer x")
    gate.assert_awaited_once_with("Bearer x")
    picker.assert_called_once_with("reading", "needle", 25, 0)
    assert result["total"] == 0
