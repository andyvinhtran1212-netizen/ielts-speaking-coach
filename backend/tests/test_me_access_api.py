"""COURSEACCESS-0055 T003 — GET /api/me/courses and /api/me/credits."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from routers import me_access
from services import entitlements as ent

COURSE = "11111111-1111-1111-1111-111111111111"
CLASS_COURSE = "22222222-2222-2222-2222-222222222222"
AUTH = {"Authorization": "Bearer token"}
NOW = datetime.now(timezone.utc)
ONLINE = {"id": "p1", "course_id": COURSE, "slug": "ielts-6", "kind": "online", "title": "IELTS 6.0",
          "short_title": "6.0", "features": ["speaking", "writing"], "review_mode": "ai_instant", "status": "open",
          "archived_at": None}


def _iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def me(monkeypatch):
    state = {"user": {"id": "u1"}, "error": False, "ledger": [], "sources": {},
             "balance": {"items": [], "total": 0}, "orders": {}}
    expires = NOW + timedelta(days=10)
    carry_until = NOW + timedelta(days=40)
    state["items"] = [
        ent.AccessItem(course_id=COURSE, product_id="p1", kind="online", source="enrollment_order",
                       starts_at=NOW - timedelta(days=20), expires_at=expires, status="active",
                       review_mode="ai_instant", features=("speaking", "writing"), entitlement_id="e1",
                       product=ONLINE),
        ent.AccessItem(course_id=CLASS_COURSE, product_id=None, kind=None, source="class_membership",
                       starts_at=None, expires_at=None, status="active", review_mode=None),
    ]
    state["balance"] = {"total": 7, "items": [
        {"entitlement_id": "e1", "course_id": COURSE, "product_id": "p1", "product_kind": "online", "balance": 7,
         "usable_from": (NOW - timedelta(days=20)).isoformat(), "usable_until": expires.isoformat(),
         "carry_balance": 3, "carry_expires_at": carry_until.isoformat()},
        {"entitlement_id": "e-future", "course_id": COURSE, "product_id": "p1", "product_kind": "online",
         "balance": 40, "usable_from": expires.isoformat(), "usable_until": None, "carry_balance": 0,
         "carry_expires_at": None}]}
    state["expires"], state["carry_until"] = expires, carry_until

    async def user(authorization):
        if not authorization:
            raise HTTPException(401, "Missing or invalid Authorization header")
        return state["user"]

    def guard(fn):
        def inner(*a):
            if state["error"]:
                raise RuntimeError("db down")
            return fn(*a)
        return inner

    monkeypatch.setattr(me_access, "get_supabase_user", AsyncMock(side_effect=user))
    monkeypatch.setattr(ent, "list_access", guard(lambda uid: state["items"]))
    monkeypatch.setattr(ent, "fetch_open_orders", lambda uid: state["orders"])
    monkeypatch.setattr(me_access, "fetch_credit_balance", guard(lambda uid: state["balance"]))
    monkeypatch.setattr(me_access, "fetch_courses", lambda ids: {
        COURSE: {"id": COURSE, "code": "IELTS-6", "name": "IELTS 6.0"},
        CLASS_COURSE: {"id": CLASS_COURSE, "code": "C2", "name": "Lớp kỹ năng nền"}})
    monkeypatch.setattr(me_access, "fetch_ledger", guard(lambda uid: state["ledger"]))
    monkeypatch.setattr(me_access, "fetch_entitlement_sources", lambda ids: state["sources"])
    return state


def test_requires_sign_in(client, me):
    assert client.get("/api/me/courses").status_code == 401
    assert client.get("/api/me/credits").status_code == 401


def test_my_courses_shape_and_carry_from_fn_credit_balance(client, me):
    res = client.get("/api/me/courses", headers=AUTH)
    assert res.status_code == 200
    body = res.json()
    online, klass = body["items"]
    assert online["course_code"] == "IELTS-6" and online["product_slug"] == "ielts-6"
    assert (online["kind"], online["source"], online["state"], online["days_left"]) == \
        ("online", "enrollment_order", "active", 10)
    assert online["can_renew"] is True and online["renew_order_code"] is None
    assert online["credits"]["balance"] == 7
    assert online["credits"]["carry_balance"] == 3
    assert online["credits"]["carry_expires_at"] == _iso(me["carry_until"])
    assert online["expires_at"] == _iso(me["expires"])
    assert (klass["source"], klass["title"], klass["credits"], klass["can_renew"]) == \
        ("class_membership", "Lớp kỹ năng nền", None, False)
    # A renewal that has not started yet is listed but not counted.
    assert body["credits"] == {"total": 7, "by_kind": {"online": 7, "class": 0}}
    assert "content_visible_until" in body and body["content_visible_until"] is None
    assert "content_days_after_expiry" in body and body["content_days_after_expiry"] is None


def test_my_courses_open_renewal_order(client, me):
    me["orders"] = {"p1": "AVER-ABC234"}
    online = client.get("/api/me/courses", headers=AUTH).json()["items"][0]
    assert (online["can_renew"], online["renew_order_code"]) == (False, "AVER-ABC234")


def test_my_courses_read_error_is_503(client, me):
    me["error"] = True
    res = client.get("/api/me/courses", headers=AUTH)
    assert res.status_code == 503 and res.json()["detail"]["error_code"] == "access_unavailable"


def _ledger(*rows):
    out = []
    for i, (delta, reason, extra) in enumerate(rows, start=1):
        out.append({"id": i, "entitlement_id": extra.pop("ent", "e1"), "delta": delta, "reason": reason,
                    "feature": extra.pop("feature", None), "note": extra.pop("note", None),
                    "created_at": (NOW - timedelta(hours=100 - i)).isoformat()})
    return out


def test_credit_history_balance_after_and_paging(client, me):
    me["sources"] = {"e1": {"id": "e1", "source": "enrollment_order", "course_id": COURSE}}
    me["ledger"] = _ledger((10, "grant", {}), (-1, "reserve", {"feature": "speaking_grading"}),
                           (-1, "reserve", {"feature": "writing_grading"}), (1, "release", {}),
                           (-1, "reserve", {"feature": "short_writing_feedback"}))
    body = client.get("/api/me/credits?limit=3", headers=AUTH).json()
    assert body["balance"] == 7
    assert [i["balance_after"] for i in body["items"]] == [8, 9, 8]
    assert [i["label_vi"] for i in body["items"]] == ["Nhận xét đoạn viết", "Hoàn lượt khi chấm lỗi", "Chấm bài"]
    assert body["items"][0]["course_code"] == "IELTS-6"
    assert body["next_cursor"] == "3"
    rest = client.get("/api/me/credits?limit=3&cursor=3", headers=AUTH).json()
    assert [i["balance_after"] for i in rest["items"]] == [9, 10]
    assert rest["next_cursor"] is None
    assert client.get("/api/me/credits?cursor=abc", headers=AUTH).status_code == 422


def test_credit_history_read_error_is_503(client, me):
    me["error"] = True
    res = client.get("/api/me/credits", headers=AUTH)
    assert res.status_code == 503 and res.json()["detail"]["error_code"] == "access_unavailable"


@pytest.mark.parametrize("row,source,label", [
    ({"reason": "grant"}, "enrollment_order", "Cộng khi mở khoá"),
    ({"reason": "grant"}, "access_code", "Cộng kèm mã lớp"),
    ({"reason": "grant"}, "class_conversion", "Cộng khi lớp chuyển sang tính lượt"),
    ({"reason": "grant_extra"}, "access_code", "Cấp thêm bởi admin"),
    ({"reason": "carry_over", "note": "carry 100%"}, "enrollment_order",
     "Chuyển lượt chưa dùng từ kỳ trước khi đăng ký lại"),
    ({"reason": "carry_over", "note": "carry 50%"}, "enrollment_order",
     "Chuyển lượt chưa dùng từ kỳ trước khi đăng ký lại (50%)"),
    ({"reason": "carry_over"}, "enrollment_order", "Chuyển lượt chưa dùng từ kỳ trước khi đăng ký lại"),
    ({"reason": "carry_expire"}, "enrollment_order", "Lượt chuyển hết hạn bảo lưu"),
    ({"reason": "reserve", "feature": "speaking_grading"}, "enrollment_order", "Chấm bài"),
    ({"reason": "reserve", "feature": "short_writing_feedback"}, "enrollment_order", "Nhận xét đoạn viết"),
    ({"reason": "release"}, "enrollment_order", "Hoàn lượt khi chấm lỗi"),
    ({"reason": "admin_adjust", "note": "Bù lượt chấm lỗi"}, "admin_grant", "Điều chỉnh bởi admin"),
    ({"reason": "expire"}, "enrollment_order", "Hết hạn cùng khoá"),
])
def test_label_vi_for_every_reason(row, source, label):
    assert me_access.label_vi(row, source) == label


def test_internal_notes_are_not_shown(client, me):
    me["sources"] = {"e1": {"id": "e1", "source": "enrollment_order", "course_id": COURSE}}
    me["ledger"] = _ledger((10, "grant", {"note": "internal"}), (2, "admin_adjust", {"note": "Bù lượt"}))
    items = client.get("/api/me/credits", headers=AUTH).json()["items"]
    assert [i["note"] for i in items] == ["Bù lượt", None]
