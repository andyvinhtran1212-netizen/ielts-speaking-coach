"""COURSEACCESS-0055 G04-T04 — admin enrollment-order API (plan 5.9)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

import main
from routers import admin_commerce
from services import enrollment_orders as eo
from tests._commerce_fake_db import FakeDB
from tests.test_enrollment_orders_api import PRODUCT, _order

AUTH = {"Authorization": "Bearer admin"}
NOW = datetime.now(timezone.utc)
OID = "11111111-2222-3333-4444-555555555555"


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def world(monkeypatch):
    state = {"admin": True}
    order = {**_order("AVER-7K2QXM"), "id": OID}
    db = FakeDB(tables={
        "course_products": [dict(PRODUCT)],
        "entitlements": [{"id": "e1", "expires_at": (NOW + timedelta(days=180)).isoformat()}],
        "enrollment_orders": [order],
        "enrollment_order_events": [
            {"id": 1, "order_id": OID, "from_status": None, "to_status": "awaiting_transfer", "action": "create",
             "actor_id": "u1", "actor_kind": "learner", "note": None, "created_at": NOW.isoformat()}],
        "users": [{"id": "u1", "email": "minhanh@example.com", "display_name": "Minh Anh"}],
    })

    def confirm(params):
        row = next((o for o in db.tables["enrollment_orders"] if o["id"] == params["p_order_id"]), None)
        if row is None:
            return {"status": "not_found"}
        if row["status"] == "confirmed":
            return {"status": "already_confirmed", "entitlement_id": "e1", "credits_granted": 40,
                    "reopened": False}
        if row["status"] == "cancelled" or (row["status"] == "expired" and not params["p_allow_expired"]):
            return {"status": "invalid_transition", "order_status": row["status"]}
        reopened = row["status"] == "expired"
        row.update(status="confirmed", entitlement_id="e1", confirmed_at=NOW.isoformat())
        return {"status": "confirmed", "entitlement_id": "e1", "starts_at": NOW.isoformat(),
                "expires_at": (NOW + timedelta(days=180)).isoformat(), "credits_expire_at": None,
                "credits_granted": 40, "reopened": reopened, "renews_entitlement_id": None}

    def admin_action(params):
        row = next((o for o in db.tables["enrollment_orders"] if o["id"] == params["p_order_id"]), None)
        if row is None:
            return {"status": "not_found"}
        if row["status"] not in eo.OPEN_STATUSES:
            return {"status": "invalid_transition", "order_status": row["status"]}
        if params["p_action"] == "request_info":
            row.update(status="needs_info", info_kind=params["p_reason"], admin_message=params["p_message"],
                       supplement_by=params["p_supplement_by"], received_vnd=params["p_received_vnd"])
        else:
            row.update(status="cancelled", cancelled_by="admin-1", cancel_reason=params["p_message"])
        return {"status": "ok", "order": row}

    state["lifecycle"] = []

    def lifecycle(params):
        state["lifecycle"].append(params)
        return state.get("lifecycle_answer", {"closed": 0, "carried": 0, "carry_expired": 0})

    db.handlers = {"fn_enrollment_order_confirm": confirm, "fn_enrollment_order_admin_action": admin_action,
                   "fn_credit_expire_entitlements": lifecycle}
    for module in (eo, admin_commerce):
        monkeypatch.setattr(module, "supabase_admin", db)

    async def require_admin(authorization):
        if not state["admin"]:
            raise HTTPException(403, "Chỉ admin mới truy cập được.")
        return {"id": "admin-1"}

    monkeypatch.setattr(admin_commerce, "require_admin", AsyncMock(side_effect=require_admin))
    monkeypatch.setattr(eo.settings, "ENROLL_BANK_ACCOUNT_NO", "0123456789")
    monkeypatch.setattr(eo.settings, "CREDIT_CARRY_VALID_DAYS", 60)
    monkeypatch.setattr(eo.settings, "CREDIT_CARRY_PERCENT", 100)
    monkeypatch.setattr(eo.settings, "ENROLL_SUPPLEMENT_HOURS", 72)
    state["db"], state["order"] = db, order
    return state


def test_every_route_needs_an_admin_and_touches_no_data(client, world):
    world["admin"] = False
    calls = [("get", "/admin/enrollment-orders", None), ("get", "/admin/enrollment-orders/counts", None),
             ("get", f"/admin/enrollment-orders/{OID}", None),
             ("post", f"/admin/enrollment-orders/{OID}/confirm", {}),
             ("post", f"/admin/enrollment-orders/{OID}/request-info",
              {"info_kind": "other", "message": "Bổ sung giúp"}),
             ("post", f"/admin/enrollment-orders/{OID}/cancel",
              {"message": "Trùng đơn", "confirm_order_code": "AVER-7K2QXM"})]
    for method, path, body in calls:
        res = getattr(client, method)(path, headers=AUTH, **({"json": body} if body is not None else {}))
        assert res.status_code == 403, path
    assert world["db"].calls == [] and world["db"].rpcs == []


def test_list_with_user_and_search_by_code_without_the_dash(client, world):
    items = client.get("/admin/enrollment-orders", headers=AUTH).json()["items"]
    assert items[0]["id"] == OID and items[0]["user"]["email"] == "minhanh@example.com"
    for q in ("AVER-7K2QXM", "aver7k2qxm", "AVER 7K2QXM"):
        found = client.get("/admin/enrollment-orders", params={"q": q}, headers=AUTH).json()["items"]
        assert [o["order_code"] for o in found] == ["AVER-7K2QXM"], q
    assert client.get("/admin/enrollment-orders", params={"q": "Minhanh@Example.com"},
                      headers=AUTH).json()["items"][0]["id"] == OID
    assert client.get("/admin/enrollment-orders", params={"q": "nobody@example.com"},
                      headers=AUTH).json()["items"] == []
    assert client.get("/admin/enrollment-orders", params={"status": "confirmed"},
                      headers=AUTH).json()["items"] == []


def test_late_filter_and_counts(client, world):
    world["order"].update(status="expired", late_transfer_reported_at=NOW.isoformat())
    world["db"].tables["enrollment_orders"].append({**_order("AVER-BBBBBB", status="expired"),
                                                    "id": "99999999-2222-3333-4444-555555555555"})
    late = client.get("/admin/enrollment-orders", params={"late": 1}, headers=AUTH).json()["items"]
    assert [o["order_code"] for o in late] == ["AVER-7K2QXM"]
    counts = client.get("/admin/enrollment-orders/counts", headers=AUTH).json()
    assert counts["expired"] == 2 and counts["expired_late_reported"] == 1 and counts["confirmed"] == 0
    assert set(counts) == set(eo.STATUSES) | {"expired_late_reported"}


def test_detail_has_events_and_the_other_open_order(client, world):
    world["db"].tables["enrollment_orders"].append({**_order("AVER-BBBBBB"),
                                                    "id": "99999999-2222-3333-4444-555555555555"})
    detail = client.get(f"/admin/enrollment-orders/{OID}", headers=AUTH).json()
    assert detail["events"][0]["action"] == "create" and detail["events"][0]["actor_kind"] == "learner"
    assert detail["other_open_order_code"] == "AVER-BBBBBB"
    missing = client.get("/admin/enrollment-orders/00000000-0000-0000-0000-000000000000", headers=AUTH)
    assert missing.status_code == 404


def test_confirm_grants_and_runs_the_lifecycle_with_server_values(client, world):
    res = client.post(f"/admin/enrollment-orders/{OID}/confirm",
                      json={"note": "Đã nhận đủ", "received_vnd": 1990000}, headers=AUTH)
    body = res.json()
    assert res.status_code == 200 and body["status"] == "confirmed" and body["credits_granted"] == 40
    assert body["order"]["status"] == "confirmed" and body["order"]["entitlement_expires_at"]
    assert body["entitlement"]["id"] == "e1" and body["reopened"] is False
    name, params = next(r for r in world["db"].rpcs if r[0] == "fn_enrollment_order_confirm")
    assert params["p_carry_window_days"] == 60 and params["p_admin_id"] == "admin-1"
    assert params["p_received_vnd"] == 1990000 and params["p_allow_expired"] is False
    assert world["lifecycle"] == [{"p_user_id": "u1", "p_limit": 100, "p_carry_percent": 100,
                                   "p_carry_valid_days": 60}]
    again = client.post(f"/admin/enrollment-orders/{OID}/confirm", json={}, headers=AUTH).json()
    assert again["status"] == "already_confirmed" and len(world["lifecycle"]) == 1


def test_confirm_lifecycle_ignores_body_fields(client, world):
    """SA-2335-R7-C2: nothing from the body reaches fn_credit_expire_entitlements."""
    client.post(f"/admin/enrollment-orders/{OID}/confirm",
                json={"p_user_id": "evil", "p_carry_percent": 0, "user_id": "evil"}, headers=AUTH)
    assert world["lifecycle"][0]["p_user_id"] == "u1" and world["lifecycle"][0]["p_carry_percent"] == 100


def test_confirm_missing_lifecycle_function_is_skipped(client, world):
    world["db"].handlers["fn_credit_expire_entitlements"] = \
        lambda p: APIError({"code": "PGRST202", "message": "Could not find the function"})
    res = client.post(f"/admin/enrollment-orders/{OID}/confirm", json={}, headers=AUTH)
    assert res.status_code == 200 and res.json()["status"] == "confirmed"


def test_confirm_an_expired_order_needs_allow_expired_and_reopens(client, world):
    world["order"]["status"] = "expired"
    res = client.post(f"/admin/enrollment-orders/{OID}/confirm", json={}, headers=AUTH)
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "invalid_transition"
    res = client.post(f"/admin/enrollment-orders/{OID}/confirm", json={"allow_expired": True}, headers=AUTH)
    assert res.json()["reopened"] is True


@pytest.mark.parametrize("answer,status,code", [
    ({"status": "has_open_order"}, 409, "has_open_order"),
    ({"status": "account_suspended"}, 409, "account_suspended"),
    ({"status": "not_found"}, 404, "order_not_found"),
    (APIError({"code": "22023", "message": "order_confirm_overpaid_needs_note"}), 422, "note_required"),
    (APIError({"code": "22023", "message": "order_confirm_invalid_argument"}), 422, "invalid_argument"),
    (APIError({"code": "57014", "message": "canceling statement"}), 503, "orders_unavailable"),
])
def test_confirm_answers(client, world, answer, status, code):
    world["db"].handlers["fn_enrollment_order_confirm"] = lambda p: answer
    res = client.post(f"/admin/enrollment-orders/{OID}/confirm", json={}, headers=AUTH)
    assert (res.status_code, res.json()["detail"]["error_code"]) == (status, code)
    assert world["lifecycle"] == []


def test_request_info_defaults_the_deadline_and_checks_underpaid(client, world):
    res = client.post(f"/admin/enrollment-orders/{OID}/request-info",
                      json={"info_kind": "not_found", "message": "Chưa thấy khoản chuyển"}, headers=AUTH)
    assert res.status_code == 200 and res.json()["order"]["status"] == "needs_info"
    params = world["db"].rpcs[-1][1]
    deadline = datetime.fromisoformat(params["p_supplement_by"])
    assert timedelta(hours=71, minutes=59) < deadline - NOW < timedelta(hours=72, minutes=1)
    world["order"]["status"] = "awaiting_transfer"
    res = client.post(f"/admin/enrollment-orders/{OID}/request-info",
                      json={"info_kind": "underpaid", "message": "Thiếu tiền"}, headers=AUTH)
    assert res.status_code == 422 and res.json()["detail"]["error_code"] == "received_required"
    past = (NOW - timedelta(hours=1)).isoformat()
    res = client.post(f"/admin/enrollment-orders/{OID}/request-info",
                      json={"info_kind": "other", "message": "abc", "supplement_by": past}, headers=AUTH)
    assert res.status_code == 422 and res.json()["detail"]["error_code"] == "invalid_supplement_by"
    assert client.post(f"/admin/enrollment-orders/{OID}/request-info",
                       json={"info_kind": "refund", "message": "abc"}, headers=AUTH).status_code == 422


def test_cancel_requires_typing_the_order_code(client, world):
    res = client.post(f"/admin/enrollment-orders/{OID}/cancel",
                      json={"message": "Trùng đơn", "confirm_order_code": "AVER-AAAAAA"}, headers=AUTH)
    assert res.status_code == 422 and res.json()["detail"]["error_code"] == "order_code_mismatch"
    assert world["db"].rpcs == []
    res = client.post(f"/admin/enrollment-orders/{OID}/cancel",
                      json={"message": "Trùng đơn", "confirm_order_code": "aver7k2qxm"}, headers=AUTH)
    order = res.json()["order"]
    assert (order["status"], order["cancel_reason"], order["cancel_note"]) == ("cancelled", "admin", "Trùng đơn")
    again = client.post(f"/admin/enrollment-orders/{OID}/cancel",
                        json={"message": "Trùng đơn", "confirm_order_code": "AVER-7K2QXM"}, headers=AUTH)
    assert again.status_code == 409


def test_invalid_body_is_422_before_the_admin_check(client, world):
    world["admin"] = False
    res = client.post(f"/admin/enrollment-orders/{OID}/confirm", json={"received_vnd": -1}, headers=AUTH)
    assert res.status_code == 422 and world["db"].rpcs == []
