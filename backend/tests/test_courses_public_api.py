"""COURSEACCESS-0055 T003 — GET /api/courses and /api/courses/{slug}."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from routers import courses_public
from services import entitlements as ent

COURSE = "11111111-1111-1111-1111-111111111111"
PRODUCT = {
    "id": "p1", "course_id": COURSE, "slug": "ielts-6", "kind": "online", "title": "IELTS 6.0",
    "short_title": "6.0", "summary": "Khoá online", "status": "open", "is_public": True, "tuition_vnd": 1990000,
    "access_days": 180, "ai_credits": 40, "credit_valid_days": None, "features": ["speaking", "writing"],
    "display_order": 1, "expected_open_on": None, "archived_at": None,
    "presentation": {"level_from": "4.5", "level_to": "6.0", "author": {"name": "Andy", "bio_line": "8.5"},
                     "faq": [{"q": "Học bao lâu?", "a": "180 ngày"}, {"q": "x"}]},
}


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def catalog(monkeypatch):
    state = {"products": [dict(PRODUCT)], "rows": [], "orders": {}, "user": None, "error": False}

    def products(slug=None):
        if state["error"]:
            raise RuntimeError("db down")
        items = state["products"]
        return [p for p in items if p["slug"] == slug] if slug is not None else items

    async def user(authorization):
        if state["user"] is None:
            raise HTTPException(401, "Invalid token")
        return state["user"]

    monkeypatch.setattr(courses_public, "fetch_catalog_products", products)
    monkeypatch.setattr(courses_public, "fetch_course_codes", lambda ids: {COURSE: "IELTS-6"})
    monkeypatch.setattr(courses_public, "get_supabase_user", AsyncMock(side_effect=user))
    monkeypatch.setattr(ent, "fetch_entitlement_rows", lambda uid: state["rows"])
    monkeypatch.setattr(ent, "fetch_open_orders", lambda uid: state["orders"])
    return state


def _row(expires_at, status="active"):
    return {"id": "e1", "product_id": "p1", "course_id": COURSE, "source": "enrollment_order", "status": status,
            "starts_at": "2026-01-01T00:00:00+00:00",
            "expires_at": expires_at.isoformat() if expires_at else None}


AUTH = {"Authorization": "Bearer token"}


def test_guest_catalog_shape(client, catalog):
    res = client.get("/api/courses")
    assert res.status_code == 200
    (item,) = res.json()["items"]
    assert item["viewer"] == {"state": "guest", "days_left": None, "can_renew": False, "open_order_code": None}
    assert item["credits_expire_note"] == "Dùng tới hết hạn khoá"
    assert (item["credit_carry_percent"], item["credit_carry_valid_days"]) == (100, 60)
    assert item["author"] == {"name": "Andy", "bio_line": "8.5", "photo_url": None}
    assert item["lesson_count"] is None and item["level_from"] == "4.5"
    assert "chapters" not in item and "course_code" not in item
    assert "id" not in item and "course_id" not in item


def test_coming_soon_hides_a_stored_fee_in_list_and_detail(client, catalog):
    """FR-002 (owner HOLD + Codex P2 + CR B1 on 37de4c62): 383 allows a fee on
    a coming_soon row; the public API must not show it."""
    catalog["products"] = [{**PRODUCT, "status": "coming_soon", "tuition_vnd": 2490000}]
    (item,) = client.get("/api/courses").json()["items"]
    assert item["status"] == "coming_soon" and item["tuition_vnd"] is None
    detail = client.get("/api/courses/ielts-6").json()
    assert detail["status"] == "coming_soon" and detail["tuition_vnd"] is None
    catalog["products"] = [{**PRODUCT, "status": "closed"}]
    assert client.get("/api/courses").json()["items"][0]["tuition_vnd"] == 1990000
    assert client.get("/api/courses/ielts-6").json()["tuition_vnd"] == 1990000


def test_invalid_token_is_a_guest(client, catalog):
    assert client.get("/api/courses", headers=AUTH).json()["items"][0]["viewer"]["state"] == "guest"


def test_catalog_query_excludes_class_draft_and_archived(monkeypatch):
    """The read itself filters: public, online, unarchived, listed statuses."""
    query = MagicMock()
    for name in ("select", "eq", "is_", "in_", "order", "limit"):
        getattr(query, name).return_value = query
    query.execute.return_value.data = []
    db = MagicMock()
    db.table.return_value = query
    monkeypatch.setattr(courses_public, "supabase_admin", db)
    courses_public.fetch_catalog_products()
    db.table.assert_called_with("course_products")
    eqs = {c.args for c in query.eq.call_args_list}
    assert ("is_public", True) in eqs and ("kind", "online") in eqs
    query.is_.assert_any_call("archived_at", "null")
    query.in_.assert_any_call("status", ["open", "coming_soon", "closed"])


def test_carry_fields_null_when_percent_is_zero(client, catalog, monkeypatch):
    monkeypatch.setattr(courses_public.settings, "CREDIT_CARRY_PERCENT", 0)
    item = client.get("/api/courses").json()["items"][0]
    assert item["credit_carry_percent"] is None and item["credit_carry_valid_days"] is None


def test_credits_expire_note_variants():
    assert courses_public.credits_expire_note({"ai_credits": 0}) is None
    assert courses_public.credits_expire_note({"ai_credits": 5, "credit_valid_days": 90}) \
        == "Dùng trong 90 ngày kể từ ngày mở khoá"


def test_viewer_days_left_rounds_up_and_expired_at_the_deadline():
    now = datetime(2026, 11, 20, 12, tzinfo=timezone.utc)
    v = courses_public.viewer_for(PRODUCT, [_row(now + timedelta(seconds=1))], {}, now)
    assert (v["state"], v["days_left"], v["can_renew"]) == ("enrolled", 1, True)
    v = courses_public.viewer_for(PRODUCT, [_row(now)], {}, now)
    assert (v["state"], v["days_left"], v["can_renew"]) == ("expired", 0, True)


def test_viewer_can_renew_three_cases():
    now = datetime(2026, 11, 20, 12, tzinfo=timezone.utc)
    far = courses_public.viewer_for(PRODUCT, [_row(now + timedelta(days=100))], {}, now)
    assert (far["state"], far["can_renew"]) == ("enrolled", False)
    near = courses_public.viewer_for(PRODUCT, [_row(now + timedelta(days=10))], {}, now)
    assert near["can_renew"] is True
    pending = courses_public.viewer_for(PRODUCT, [_row(now + timedelta(days=10))], {"p1": "AVER-ABC234"}, now)
    assert (pending["can_renew"], pending["open_order_code"]) == (False, "AVER-ABC234")


def test_viewer_states(client, catalog):
    catalog["user"] = {"id": "u1"}
    assert client.get("/api/courses", headers=AUTH).json()["items"][0]["viewer"]["state"] == "can_enroll"
    catalog["orders"] = {"p1": "AVER-ABC234"}
    viewer = client.get("/api/courses", headers=AUTH).json()["items"][0]["viewer"]
    assert (viewer["state"], viewer["open_order_code"]) == ("open_order", "AVER-ABC234")
    catalog["orders"] = {}
    catalog["rows"] = [_row(datetime.now(timezone.utc) + timedelta(days=50))]
    viewer = client.get("/api/courses", headers=AUTH).json()["items"][0]["viewer"]
    assert (viewer["state"], viewer["days_left"]) == ("enrolled", 50)
    catalog["rows"] = [_row(datetime.now(timezone.utc) + timedelta(days=50), status="revoked")]
    assert client.get("/api/courses", headers=AUTH).json()["items"][0]["viewer"]["state"] == "can_enroll"


def test_detail_adds_code_faq_and_chapters(client, catalog):
    res = client.get("/api/courses/ielts-6")
    assert res.status_code == 200
    body = res.json()
    assert body["course_code"] == "IELTS-6"
    assert body["faq"] == [{"q": "Học bao lâu?", "a": "180 ngày"}]
    assert body["chapters"] is None


def test_detail_unknown_or_hidden_is_404(client, catalog):
    res = client.get("/api/courses/khong-co")
    assert res.status_code == 404
    assert res.json()["detail"]["error_code"] == "course_not_found"


def test_read_error_is_503(client, catalog):
    catalog["error"] = True
    for path in ("/api/courses", "/api/courses/ielts-6"):
        res = client.get(path)
        assert res.status_code == 503
        assert res.json()["detail"]["error_code"] == "catalog_unavailable"
