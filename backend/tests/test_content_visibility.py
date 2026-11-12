"""The namespace boundary must precede projection, counts and pagination."""
from types import SimpleNamespace

import pytest

from services import content_visibility as visibility


@pytest.mark.parametrize("row,expected", [
    (None, True), ({}, True), ({"restricted": None}, True),
    ({"restricted": True}, True), ({"restricted": False}, False),
    ({"restricted": 0}, True), ({"restricted": "false"}, True),
    ({"restricted": False, "metadata": {"blackeye": {}}}, False),
])
def test_only_explicit_database_false_allows_access(row, expected):
    # The last case proves consumers read the flag rather than reclassifying.
    assert visibility.is_restricted(row) is expected


@pytest.mark.parametrize("builder,view", [
    (visibility.public_tests, "v_listening_tests_public"),
    (visibility.public_content, "v_listening_content_public"),
    (visibility.public_attempts, "v_listening_attempts_public"),
    (visibility.public_dictation, "v_dictation_sessions_public"),
])
def test_builders_return_the_unexecuted_view_query(builder, view):
    query = object()
    calls = []

    def table(name):
        calls.append(name)
        return query

    assert builder(SimpleNamespace(table=table)) is query
    assert calls == [view]


@pytest.mark.asyncio
async def test_content_lists_filter_standalone_flags_before_count_and_page(monkeypatch):
    from unittest.mock import AsyncMock
    from routers import listening
    from test_listening_overview import _FakeSB

    db = _FakeSB({"listening_content": [
        {"id": "hidden", "restricted": True, "status": "published", "test_id": None},
        {"id": "ordinary-one", "restricted": False, "status": "published", "test_id": None},
        {"id": "ordinary-two", "restricted": False, "status": "published", "test_id": None},
    ]})
    monkeypatch.setattr(listening, "supabase_admin", db)
    monkeypatch.setattr(listening, "require_admin", AsyncMock(return_value={"id": "admin"}))
    page = await listening.admin_list_listening_content(
        status="all", limit=1, offset=1, authorization="Bearer fixture")
    assert page["total"] == 2
    assert [row["id"] for row in page["items"]] == ["ordinary-two"]
    assert [row["id"] for row in listening._published_content_rows()] == [
        "ordinary-one", "ordinary-two"]
