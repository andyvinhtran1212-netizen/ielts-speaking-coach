"""Sprint 20.8 A4 — admin GET /admin/reading/content L3 listing.

Before 20.8 the endpoint queried only `reading_passages` so an `?library=l3_test`
filter returned 3 rows per L3 test (one per `passage_order`). 20.8 switched
to query `reading_tests` directly for the L3 case, returning one row per
`test_id`, normalised to the L1/L2 row shape so the frontend's table template
stays uniform.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}


def test_l3_filter_queries_reading_tests_not_passages():
    """When library=l3_test, the endpoint must query the reading_tests table
    so the listing is one row per test (not 3 rows per test via passages)."""
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value.order.return_value.range.return_value
    chain.execute.return_value = MagicMock(
        data=[{
            "id": "uuid-1", "test_id": "AVR-READ-001", "title": "Academic Reading — Test 1",
            "module": "academic", "time_limit_minutes": 60, "passage_count": 3,
            "total_questions": 40, "band_target": 7.0, "status": "published",
            "updated_at": "2026-05-29T10:00:00+00:00",
            "created_at": "2026-05-28T10:00:00+00:00",
        }],
        count=1,
    )

    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _client().get("/admin/reading/content?library=l3_test", headers=_ADMIN_AUTH)

    assert r.status_code == 200
    called = [c.args[0] for c in mock_db.table.call_args_list]
    assert "reading_tests" in called, f"expected reading_tests query, got: {called}"
    assert "reading_passages" not in called, (
        f"L3 listing must NOT query reading_passages (would return 3 rows/test); got: {called}"
    )


def test_l3_row_normalised_to_l1_l2_shape():
    """The frontend uses one table template across all libraries. The L3 branch
    must normalise the test row into the same fields the L1/L2 rows carry."""
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value.order.return_value.range.return_value
    chain.execute.return_value = MagicMock(
        data=[{
            "id": "uuid-1", "test_id": "AVR-READ-001", "title": "Academic Reading — Test 1",
            "module": "academic", "time_limit_minutes": 60, "passage_count": 3,
            "total_questions": 40, "band_target": 7.0, "status": "published",
            "updated_at": "2026-05-29T10:00:00+00:00",
            "created_at": "2026-05-28T10:00:00+00:00",
        }],
        count=1,
    )
    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _client().get("/admin/reading/content?library=l3_test", headers=_ADMIN_AUTH)

    body = r.json()
    assert len(body["items"]) == 1
    it = body["items"][0]
    # Same keys as the L1/L2 row shape — the frontend's renderList template
    # reads exactly these.
    for key in ("id", "slug", "library", "title", "status", "difficulty_level",
                "skill_focus", "topic_tags", "updated_at", "created_at"):
        assert key in it, f"missing key {key} in L3 row"
    # L3-specific projection: slug ← test_id; difficulty_level ← module;
    # skill_focus ← '60 phút · 40 câu' summary.
    assert it["slug"] == "AVR-READ-001"
    assert it["library"] == "l3_test"
    assert it["difficulty_level"] == "academic"
    assert "60 phút" in it["skill_focus"]
    assert "40 câu" in it["skill_focus"]


def test_no_library_filter_still_queries_passages():
    """Regression: 'Tất cả' filter (no library) keeps the original
    reading_passages query — L1/L2 listings unchanged."""
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value.order.return_value.range.return_value
    chain.execute.return_value = MagicMock(data=[], count=0)

    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _client().get("/admin/reading/content", headers=_ADMIN_AUTH)

    assert r.status_code == 200
    called = [c.args[0] for c in mock_db.table.call_args_list]
    assert "reading_passages" in called
    assert "reading_tests" not in called


def test_l1_filter_still_queries_passages():
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value.order.return_value.range.return_value.eq.return_value
    chain.execute.return_value = MagicMock(data=[], count=0)

    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _client().get("/admin/reading/content?library=l1_vocab", headers=_ADMIN_AUTH)

    assert r.status_code == 200
    called = [c.args[0] for c in mock_db.table.call_args_list]
    assert "reading_passages" in called
    assert "reading_tests" not in called


def test_unknown_library_rejected_422():
    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().get("/admin/reading/content?library=l4_nope", headers=_ADMIN_AUTH)
    assert r.status_code == 422


def test_status_filter_applied_on_l3_branch():
    """status= filter must still be honoured on the L3 branch (admin can
    list only draft tests, for instance)."""
    mock_db = MagicMock()
    # First range -> eq (status filter) -> execute
    chain = mock_db.table.return_value.select.return_value.order.return_value.range.return_value.eq.return_value
    chain.execute.return_value = MagicMock(data=[], count=0)

    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _client().get("/admin/reading/content?library=l3_test&status=draft",
                          headers=_ADMIN_AUTH)
    assert r.status_code == 200
    # Confirm a .eq("status", "draft") was applied somewhere on the chain.
    eq_calls = mock_db.table.return_value.select.return_value.order.return_value.range.return_value.eq.call_args_list
    assert any(c.args[:2] == ("status", "draft") for c in eq_calls), (
        f"status=draft filter not applied; eq calls: {eq_calls}"
    )
