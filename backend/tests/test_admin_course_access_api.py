"""COURSEACCESS-0055 G04-T05 — admin products, entitlements, credits and a
learner's access (plan 5.9, 5.3 step-up Q13)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

import main
from routers import admin_commerce, me_access
from services import entitlements as ent
from services import retention_policy, staff_guard
from tests._commerce_fake_db import FakeDB

AUTH = {"Authorization": "Bearer admin"}
NOW = datetime.now(timezone.utc)
COURSE = "c0000000-0000-4000-8000-000000000001"
PID = "a0000000-0000-4000-8000-000000000001"
UID = "b0000000-0000-4000-8000-000000000001"
EID = "e0000000-0000-4000-8000-000000000001"
KEY = "f0000000-0000-4000-8000-000000000001"

PRODUCT = {"id": PID, "course_id": COURSE, "slug": "ngu-phap-nen-tang", "kind": "online",
           "title": "Ngữ pháp nền tảng", "short_title": None, "summary": None, "status": "open", "is_public": True,
           "tuition_vnd": 1990000, "access_days": 180, "ai_credits": 51, "credit_valid_days": None,
           "features": ["writing"], "review_mode": "ai_instant", "display_order": 1, "expected_open_on": None,
           "presentation": {}, "archived_at": None, "archived_by": None, "created_by": None,
           "created_at": NOW.isoformat(), "updated_at": NOW.isoformat()}


def _ent(eid=EID, *, user=UID, expires=NOW + timedelta(days=90), status="active", source="admin_grant"):
    return {"id": eid, "user_id": user, "product_id": PID, "course_id": COURSE, "source": source,
            "status": status, "starts_at": (NOW - timedelta(days=10)).isoformat(),
            "expires_at": expires.isoformat() if expires else None, "credits_expire_at": None,
            "credits_closed_at": None, "review_mode": None, "granted_by": "admin-1", "reason": "Cấp quyền",
            "revoked_at": None, "revoked_by": None, "revoke_reason": None, "created_at": NOW.isoformat()}


def _api_error(code: str, message: str) -> APIError:
    return APIError({"code": code, "message": message, "details": None, "hint": None})


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def world(monkeypatch):
    state = {"admin": True, "step_up": []}
    db = FakeDB(tables={
        "course_products": [dict(PRODUCT)],
        "courses": [{"id": COURSE, "code": "NP1", "name": "Ngữ pháp"}],
        "entitlements": [_ent()],
        "entitlement_events": [{"id": 1, "entitlement_id": EID, "action": "grant", "actor_id": "admin-1",
                                "actor_kind": "admin", "before": None, "after": {"credits": 10},
                                "reason": "Cấp quyền", "created_at": NOW.isoformat()}],
        "enrollment_orders": [{"id": "o1", "product_id": PID, "status": "awaiting_transfer", "user_id": "u9",
                               "tuition_vnd": 1990000, "product_title": "Ngữ pháp nền tảng"}],
        "credit_ledger": [{"id": 1, "user_id": UID, "entitlement_id": EID, "delta": 10, "reason": "grant",
                           "feature": None, "note": None, "actor_id": "admin-1", "created_at": NOW.isoformat()},
                          {"id": 2, "user_id": UID, "entitlement_id": EID, "delta": -2, "reason": "admin_adjust",
                           "feature": None, "note": "Trừ lượt chấm lỗi", "actor_id": "admin-1",
                           "created_at": NOW.isoformat()}],
        "users": [{"id": UID, "email": "hocvien@example.com", "display_name": "Học viên"},
                  {"id": "admin-1", "email": "admin@example.com", "display_name": "Admin"}],
    })

    def balance_of(eid):
        return sum(int(r["delta"]) for r in db.tables["credit_ledger"] if r["entitlement_id"] == eid)

    def adjust(params):
        key = "admin:" + params["p_request_key"]
        row = next((e for e in db.tables["entitlements"] if e["id"] == params["p_entitlement_id"]), None)
        if row is None:
            return {"status": "not_found"}
        prior = next((r for r in db.tables["credit_ledger"] if r.get("idempotency_key") == key), None)
        if prior is not None:  # 384 replays on the key alone
            return {"status": "replay", "ledger_id": prior["id"]}
        if row["status"] != "active":
            return {"status": "not_usable"}
        balance = balance_of(row["id"])
        if balance + params["p_delta"] < 0:
            return {"status": "would_go_negative", "balance": balance}
        db.tables["credit_ledger"].append({"id": len(db.tables["credit_ledger"]) + 1, "user_id": row["user_id"],
                                           "entitlement_id": row["id"], "delta": params["p_delta"],
                                           "reason": "admin_adjust", "note": params["p_reason"],
                                           "idempotency_key": key, "actor_id": params["p_admin_id"],
                                           "feature": None, "created_at": NOW.isoformat()})
        return {"status": "adjusted", "ledger_id": db.tables["credit_ledger"][-1]["id"],
                "balance_after": balance + params["p_delta"]}

    def grant(params):
        existing = next((e for e in db.tables["entitlements"] if e.get("source_ref") == params["p_request_key"]),
                        None)
        if existing:  # 384 replays on (request_key, user) alone
            return {"status": "replay", "entitlement_id": existing["id"]}
        product = next((p for p in db.tables["course_products"] if p["id"] == params["p_product_id"]), None)
        if product is None or product.get("archived_at"):
            return {"status": "product_invalid"}
        if not any(u["id"] == params["p_user_id"] for u in db.tables["users"]):
            return _api_error("23503", 'insert or update on table "entitlements" violates foreign key constraint')
        row = {**_ent(f"e-new-{len(db.tables['entitlements'])}", user=params["p_user_id"]),
               "product_id": params["p_product_id"], "granted_by": params["p_admin_id"],
               "source_ref": params["p_request_key"], "review_mode": params["p_review_mode"]}
        db.tables["entitlements"].append(row)
        # 384 writes the resolved length and credits on the grant event.
        db.tables["entitlement_events"].append({
            "id": len(db.tables["entitlement_events"]) + 1, "entitlement_id": row["id"], "action": "grant",
            "actor_id": params["p_admin_id"], "actor_kind": "admin", "before": None,
            "after": {"source": "admin_grant",
                      "access_days": product["access_days"] if params["p_days"] is None else params["p_days"],
                      "credits": product["ai_credits"] if params["p_credits"] is None else params["p_credits"],
                      "review_mode": params["p_review_mode"]},
            "reason": params["p_reason"], "created_at": NOW.isoformat()})
        return {"status": "granted", "entitlement_id": row["id"]}

    def revoke(params):
        row = next((e for e in db.tables["entitlements"] if e["id"] == params["p_entitlement_id"]), None)
        if row is None:
            return {"status": "not_found"}
        if row["status"] == "revoked":
            return {"status": "already_revoked", "entitlement_id": row["id"]}
        row.update(status="revoked", revoked_at=NOW.isoformat(), revoke_reason=params["p_reason"])
        return {"status": "revoked", "entitlement_id": row["id"]}

    def extend(params):
        row = next((e for e in db.tables["entitlements"] if e["id"] == params["p_entitlement_id"]), None)
        if row is None:
            return {"status": "not_found"}
        if row["expires_at"] is None:
            return {"status": "no_expiry", "entitlement_id": row["id"]}
        row["expires_at"] = (datetime.fromisoformat(row["expires_at"]) + timedelta(days=params["p_days"])).isoformat()
        return {"status": "extended", "entitlement_id": row["id"]}

    def archive(params):
        active = [e for e in db.tables["entitlements"] if e["product_id"] == params["p_product_id"]
                  and e["status"] == "active"]
        if active:
            return {"status": "has_active_learners", "n": len(active)}
        if any(o["product_id"] == params["p_product_id"] and o["status"] == "awaiting_transfer"
               for o in db.tables["enrollment_orders"]):
            return {"status": "has_open_orders", "n": 1}
        product = next(p for p in db.tables["course_products"] if p["id"] == params["p_product_id"])
        product.update(archived_at=NOW.isoformat(), status="closed", is_public=False)
        return {"status": "archived"}

    def credit_balance(params):
        items = [{"entitlement_id": e["id"], "course_id": COURSE, "product_id": PID, "product_kind": "online",
                  "balance": balance_of(e["id"]), "usable_from": None, "usable_until": None,
                  "carry_balance": 0, "carry_expires_at": None}
                 for e in db.tables["entitlements"] if e["user_id"] == params["p_user_id"] and e["status"] == "active"]
        return {"items": items, "total": sum(i["balance"] for i in items)}

    db.handlers = {"fn_credit_admin_adjust": adjust, "fn_entitlement_admin_grant": grant,
                   "fn_entitlement_admin_revoke": revoke, "fn_entitlement_admin_extend": extend,
                   "fn_course_product_archive": archive, "fn_credit_balance": credit_balance}
    for module in (admin_commerce, me_access, ent):
        monkeypatch.setattr(module, "supabase_admin", db)
    monkeypatch.setattr(ent, "fetch_membership_course_ids", lambda user_id: [])
    monkeypatch.setattr(ent, "fetch_legacy_code_rows", lambda user_id: [])
    monkeypatch.setattr(ent, "fetch_open_orders", lambda user_id: {})
    monkeypatch.setattr(retention_policy, "enabled", lambda: False)

    async def require_admin(authorization):
        if not state["admin"]:
            raise HTTPException(403, "Chỉ admin mới truy cập được.")
        return {"id": "admin-1"}

    def require_recent_mfa(admin, authorization):
        state["step_up"].append(authorization)
        if state.get("refuse_step_up"):
            raise HTTPException(403, detail={"code": "step_up_required"})

    state["require_admin"] = AsyncMock(side_effect=require_admin)
    monkeypatch.setattr(admin_commerce, "require_admin", state["require_admin"])
    monkeypatch.setattr(staff_guard, "require_recent_mfa", require_recent_mfa)
    state["db"] = db
    return state


GRANT = {"user_id": UID, "product_id": PID, "credits": 10, "reason": "Cấp quyền luyện lại", "request_key": KEY}
ADJUST = {"entitlement_id": EID, "delta": 5, "reason": "Bù lượt chấm bị lỗi", "request_key": KEY}


def _calls():
    return [("get", "/admin/course-products", None), ("post", "/admin/course-products", {
                "course_id": COURSE, "slug": "x", "kind": "class", "title": "X"}),
            ("patch", f"/admin/course-products/{PID}", {"title": "Y"}),
            ("post", f"/admin/course-products/{PID}/archive", {"confirm_title": "Ngữ pháp nền tảng"}),
            ("get", f"/admin/users/{UID}/access", None), ("get", f"/admin/users/{UID}/credits", None),
            ("post", "/admin/entitlements", GRANT),
            ("post", f"/admin/entitlements/{EID}/revoke", {"reason": "Học viên xin dừng"}),
            ("post", f"/admin/entitlements/{EID}/extend", {"days": 30, "reason": "Gia hạn bù"}),
            ("post", "/admin/credits/adjust", ADJUST)]


def test_every_route_needs_an_admin_and_touches_no_data(client, world):
    world["admin"] = False
    for method, path, body in _calls():
        res = getattr(client, method)(path, headers=AUTH, **({"json": body} if body is not None else {}))
        assert res.status_code == 403, path
    assert world["db"].calls == [] and world["db"].rpcs == []


def test_a_bad_body_is_422_before_the_admin_guard_and_grants_nothing(client, world):
    bad = [("/admin/entitlements", {**GRANT, "credits": 100001}), ("/admin/entitlements", {**GRANT, "reason": "x"}),
           ("/admin/credits/adjust", {**ADJUST, "delta": 0}), ("/admin/credits/adjust", {**ADJUST, "reason": "ngắn"}),
           ("/admin/course-products", {"course_id": COURSE, "slug": "Có Dấu", "kind": "online", "title": "T"})]
    for path, body in bad:
        res = client.post(path, json=body)  # no token at all
        assert res.status_code == 422, (path, res.text)
    assert world["require_admin"].await_count == 0
    assert world["db"].calls == [] and world["db"].rpcs == []


# ── Products ────────────────────────────────────────────────────────────────


def test_products_list_create_and_counts(client, world):
    items = client.get("/admin/course-products", headers=AUTH).json()["items"]
    assert items[0]["id"] == PID and items[0]["open_orders"] == 1 and items[0]["active_learners"] == 1
    res = client.post("/admin/course-products", headers=AUTH, json={
        "course_id": COURSE, "slug": "luyen-lai", "kind": "repractice", "title": " Luyện lại ",
        "short_title": "Luyện lại", "credit_valid_days": 30, "features": ["writing", "speaking", "writing"],
        "presentation": {"level_from": "B1", "faq": [{"q": "Học bao lâu?", "a": "30 ngày"}]}})
    assert res.status_code == 201, res.text
    product = res.json()["product"]
    assert product["title"] == "Luyện lại" and product["features"] == ["speaking", "writing"]
    assert product["created_by"] == "admin-1" and product["open_orders"] == 0
    assert product["presentation"] == {"level_from": "B1", "faq": [{"q": "Học bao lâu?", "a": "30 ngày"}]}
    bad = client.post("/admin/course-products", headers=AUTH, json={
        "course_id": COURSE, "slug": "x", "kind": "online", "title": "T", "presentation": {"color": "red"}})
    assert bad.status_code == 422


def test_a_check_violation_is_a_vietnamese_422_without_column_names(client, world):
    world["db"].write_errors["course_products"] = _api_error(
        "23514", 'new row for relation "course_products" violates check constraint "course_products_public_online"')
    res = client.post("/admin/course-products", headers=AUTH, json={
        "course_id": COURSE, "slug": "lop-a", "kind": "class", "title": "Lớp A", "is_public": True})
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail == {"error_code": "check_violation", "message": "Chỉ khoá học online mới được hiển thị công khai."}
    for leak in ("is_public", "course_products", "constraint", "kind"):
        assert leak not in detail["message"]
    world["db"].write_errors["course_products"] = _api_error("23514", 'violates check constraint "something_new"')
    detail = client.patch(f"/admin/course-products/{PID}", headers=AUTH, json={"status": "open"}).json()["detail"]
    assert detail["error_code"] == "check_violation" and "something_new" not in detail["message"]


def test_slug_taken_and_kind_locked(client, world):
    world["db"].write_errors["course_products"] = _api_error(
        "23505", 'duplicate key value violates unique constraint "course_products_slug_key"')
    res = client.post("/admin/course-products", headers=AUTH, json={
        "course_id": COURSE, "slug": "ngu-phap-nen-tang", "kind": "online", "title": "T"})
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "slug_taken"
    world["db"].write_errors["course_products"] = _api_error("P0001", "course_product_kind_locked")
    res = client.patch(f"/admin/course-products/{PID}", headers=AUTH, json={"kind": "class"})
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "product_locked"


def test_editing_the_tuition_does_not_change_an_order_already_created(client, world):
    res = client.patch(f"/admin/course-products/{PID}", headers=AUTH, json={"tuition_vnd": 2490000})
    assert res.status_code == 200 and res.json()["product"]["tuition_vnd"] == 2490000
    order = world["db"].tables["enrollment_orders"][0]          # read back the order
    assert order["tuition_vnd"] == 1990000
    assert not any(t == "enrollment_orders" and op == "update" for t, op in world["db"].calls)
    assert client.patch(f"/admin/course-products/{PID}", headers=AUTH, json={"title": None}).status_code == 422


def test_archive_needs_the_title_and_no_active_learner(client, world):
    res = client.post(f"/admin/course-products/{PID}/archive", headers=AUTH, json={"confirm_title": "Sai tên"})
    assert res.status_code == 422 and res.json()["detail"]["error_code"] == "title_mismatch"
    assert world["db"].rpcs == []
    res = client.post(f"/admin/course-products/{PID}/archive", headers=AUTH,
                      json={"confirm_title": "Ngữ pháp nền tảng"})
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "has_active_learners"
    world["db"].tables["entitlements"].clear()
    res = client.post(f"/admin/course-products/{PID}/archive", headers=AUTH,
                      json={"confirm_title": "Ngữ pháp nền tảng"})
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "has_open_orders"
    world["db"].tables["enrollment_orders"].clear()
    res = client.post(f"/admin/course-products/{PID}/archive", headers=AUTH,
                      json={"confirm_title": " Ngữ pháp nền tảng "})
    assert res.status_code == 200 and res.json()["product"]["archived_at"] is not None
    assert client.get("/admin/course-products", headers=AUTH).json()["items"] == []
    assert len(client.get("/admin/course-products", params={"include_archived": True},
                          headers=AUTH).json()["items"]) == 1
    res = client.patch(f"/admin/course-products/{PID}", headers=AUTH, json={"title": "Mới"})
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "product_archived"


def test_an_archive_that_lands_after_any_read_still_blocks_the_edit(client, world, monkeypatch):
    """HOLD 11:12Z: the archive commits after the handler could have read the
    product. Reads made before the write see the stale, unarchived row; the
    write itself must refuse, and no field may change."""
    db = world["db"]
    real_fetch = admin_commerce.fetch_product
    stale = dict(db.tables["course_products"][0])
    db.tables["course_products"][0].update(archived_at=NOW.isoformat(), status="closed", is_public=False)
    archived = dict(db.tables["course_products"][0])

    def fetch(product_id):
        if ("course_products", "update") not in db.calls:
            return dict(stale)                       # read before the archive committed
        return real_fetch(product_id)

    monkeypatch.setattr(admin_commerce, "fetch_product", fetch)
    res = client.patch(f"/admin/course-products/{PID}", headers=AUTH,
                       json={"title": "Tên mới", "tuition_vnd": 1, "summary": "Sửa sau khi lưu trữ"})
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "product_archived"
    assert db.tables["course_products"][0] == archived
    res = client.patch("/admin/course-products/a0000000-0000-4000-8000-0000000000ff", headers=AUTH,
                       json={"title": "Tên mới"})
    assert res.status_code == 404 and res.json()["detail"]["error_code"] == "product_not_found"


# ── Entitlements and credits ────────────────────────────────────────────────


def test_grant_replays_by_request_key(client, world):
    first = client.post("/admin/entitlements", headers=AUTH, json=GRANT)
    assert first.status_code == 200 and first.json()["status"] == "granted"
    again = client.post("/admin/entitlements", headers=AUTH, json=GRANT)
    assert again.json() == {**first.json(), "status": "replay"}
    assert len(world["db"].tables["entitlements"]) == 2
    res = client.post("/admin/entitlements", headers=AUTH,
                      json={**GRANT, "user_id": "b0000000-0000-4000-8000-0000000000ff",
                            "request_key": "f0000000-0000-4000-8000-0000000000ff"})
    assert res.status_code == 404
    res = client.post("/admin/entitlements", headers=AUTH,
                      json={**GRANT, "product_id": "a0000000-0000-4000-8000-0000000000ff",
                            "request_key": "f0000000-0000-4000-8000-0000000000fe"})
    assert res.status_code == 404 and res.json()["detail"]["error_code"] == "product_not_found"


def test_a_grant_key_reused_for_another_product_is_a_conflict_not_a_replay(client, world):
    assert client.post("/admin/entitlements", headers=AUTH, json=GRANT).json()["status"] == "granted"
    rows = list(world["db"].tables["entitlements"])
    other = "a0000000-0000-4000-8000-000000000002"
    world["db"].tables["course_products"].append({**PRODUCT, "id": other, "slug": "khoa-khac"})
    res = client.post("/admin/entitlements", headers=AUTH, json={**GRANT, "product_id": other})
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "request_key_conflict"
    assert world["db"].tables["entitlements"] == rows
    assert client.post("/admin/entitlements", headers=AUTH,
                       json={**GRANT, "product_id": PID.upper()}).json()["status"] == "replay"


def test_a_grant_key_reused_with_another_length_amount_mode_or_admin_is_a_conflict(client, world):
    """CR nit on 08c0015b: replay only for the same days, credits, review mode and admin."""
    assert client.post("/admin/entitlements", headers=AUTH, json=GRANT).json()["status"] == "granted"
    for body in ({**GRANT, "days": 30}, {**GRANT, "credits": 11}, {**GRANT, "credits": None},
                 {**GRANT, "review_mode": "teacher_review"}):
        res = client.post("/admin/entitlements", headers=AUTH, json=body)
        assert res.status_code == 409 and res.json()["detail"]["error_code"] == "request_key_conflict", body
    # Leaving days empty is the product's default (180): the same request.
    assert client.post("/admin/entitlements", headers=AUTH,
                       json={**GRANT, "days": 180}).json()["status"] == "replay"
    world["db"].tables["entitlements"][-1]["granted_by"] = "admin-2"
    res = client.post("/admin/entitlements", headers=AUTH, json=GRANT)
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "request_key_conflict"


def test_revoke_and_extend(client, world):
    res = client.post(f"/admin/entitlements/{EID}/extend", headers=AUTH, json={"days": 30, "reason": "Gia hạn bù"})
    assert res.status_code == 200 and res.json()["status"] == "extended"
    res = client.post(f"/admin/entitlements/{EID}/revoke", headers=AUTH, json={"reason": "Học viên xin dừng"})
    assert res.json()["status"] == "revoked" and res.json()["entitlement"]["status"] == "revoked"
    assert client.post(f"/admin/entitlements/{EID}/revoke", headers=AUTH,
                       json={"reason": "Học viên xin dừng"}).json()["status"] == "already_revoked"
    world["db"].tables["entitlements"].append(_ent("e0000000-0000-4000-8000-000000000002", expires=None))
    res = client.post("/admin/entitlements/e0000000-0000-4000-8000-000000000002/extend", headers=AUTH,
                      json={"days": 30, "reason": "Gia hạn bù"})
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "entitlement_no_expiry"
    res = client.post("/admin/entitlements/e0000000-0000-4000-8000-0000000000ff/revoke", headers=AUTH,
                      json={"reason": "Không có"})
    assert res.status_code == 404


def test_adjust_replays_and_never_goes_negative(client, world):
    res = client.post("/admin/credits/adjust", headers=AUTH, json=ADJUST)
    assert res.json() == {"status": "adjusted", "balance": 13}
    assert client.post("/admin/credits/adjust", headers=AUTH, json=ADJUST).json() == {"status": "replay",
                                                                                      "balance": 13}
    before = list(world["db"].tables["credit_ledger"])
    res = client.post("/admin/credits/adjust", headers=AUTH,
                      json={**ADJUST, "delta": -14, "request_key": "f0000000-0000-4000-8000-000000000002"})
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "would_go_negative"
    assert res.json()["detail"]["balance"] == 13 and world["db"].tables["credit_ledger"] == before
    assert client.post("/admin/credits/adjust", headers=AUTH, json={**ADJUST, "reason": "ngắn quá"}).status_code == 422


def test_an_adjust_key_reused_for_another_entitlement_or_delta_is_a_conflict(client, world):
    assert client.post("/admin/credits/adjust", headers=AUTH, json=ADJUST).json()["status"] == "adjusted"
    other = "e0000000-0000-4000-8000-000000000002"
    world["db"].tables["entitlements"].append(_ent(other))
    before = list(world["db"].tables["credit_ledger"])
    for body in ({**ADJUST, "entitlement_id": other, "delta": 60}, {**ADJUST, "delta": 6},
                 {**ADJUST, "delta": -5}):
        res = client.post("/admin/credits/adjust", headers=AUTH, json=body)
        assert res.status_code == 409 and res.json()["detail"]["error_code"] == "request_key_conflict", body
    assert world["db"].tables["credit_ledger"] == before
    assert client.post("/admin/credits/adjust", headers=AUTH, json=ADJUST).json()["status"] == "replay"
    # CR nit on 08c0015b: the same key from another admin is not this adjustment.
    world["db"].tables["credit_ledger"][-1]["actor_id"] = "admin-2"
    res = client.post("/admin/credits/adjust", headers=AUTH, json=ADJUST)
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "request_key_conflict"


@pytest.mark.parametrize("reason", ["Liên hệ hocvien@example.com", "Gọi 0912 345 678 để báo"])
def test_reasons_with_contact_data_are_refused_before_any_write(client, world, reason):
    for path, body in (("/admin/credits/adjust", {**ADJUST, "reason": reason}),
                       ("/admin/entitlements", {**GRANT, "reason": reason}),
                       (f"/admin/entitlements/{EID}/revoke", {"reason": reason})):
        res = client.post(path, headers=AUTH, json=body)
        assert res.status_code == 422 and res.json()["detail"]["error_code"] == "note_contains_contact", path
    assert world["db"].rpcs == []


# ── Step-up (Q13): the condition comes from the body only ─────────────────


@pytest.mark.parametrize("delta,guarded", [(51, True), (50, False), (-51, True), (-50, False)])
def test_adjust_step_up_pairs(client, world, delta, guarded):
    world["refuse_step_up"] = True
    world["db"].tables["credit_ledger"].append({"id": 3, "user_id": UID, "entitlement_id": EID, "delta": 100,
                                                "reason": "grant", "feature": None, "note": None,
                                                "actor_id": None, "created_at": NOW.isoformat()})
    res = client.post("/admin/credits/adjust", headers=AUTH, json={**ADJUST, "delta": delta})
    assert (res.status_code == 403) is guarded, res.text
    assert bool(world["step_up"]) is guarded
    assert (world["db"].rpcs == []) is guarded


@pytest.mark.parametrize("credits,guarded", [("absent", True), (None, True), (50, False), (51, True)])
def test_grant_step_up_pairs(client, world, credits, guarded):
    world["refuse_step_up"] = True
    body = {k: v for k, v in GRANT.items() if k != "credits"}
    if credits != "absent":
        body["credits"] = credits
    res = client.post("/admin/entitlements", headers=AUTH, json=body)
    assert (res.status_code == 403) is guarded, res.text
    assert (world["db"].rpcs == []) is guarded
    assert len(world["db"].tables["entitlements"]) == (1 if guarded else 2)


# ── A learner's access and credits ─────────────────────────────────────────


def test_user_access_is_the_learner_view_plus_entitlement_and_events(client, world):
    body = client.get(f"/admin/users/{UID}/access", headers=AUTH).json()
    assert body["items"][0]["entitlement_id"] == EID and body["items"][0]["credits"]["balance"] == 8
    assert body["events"][0]["action"] == "grant" and body["events"][0]["entitlement_id"] == EID
    assert body["content_visible_until"] is None and body["content_days_after_expiry"] is None
    res = client.get("/admin/users/b0000000-0000-4000-8000-0000000000ff/access", headers=AUTH)
    assert res.status_code == 404 and res.json()["detail"]["error_code"] == "user_not_found"


def test_user_access_carries_the_retention_window(client, world, monkeypatch):
    monkeypatch.setattr(retention_policy, "enabled", lambda: True)
    world["db"].tables["entitlements"][0]["expires_at"] = (NOW - timedelta(days=10)).isoformat()
    body = client.get(f"/admin/users/{UID}/access", headers=AUTH).json()
    assert body["content_days_after_expiry"] == 45 and body["content_visible_until"] is not None


def test_user_credits_add_the_entitlement_actor_and_note(client, world):
    body = client.get(f"/admin/users/{UID}/credits", headers=AUTH).json()
    newest = body["items"][0]
    assert newest["reason"] == "admin_adjust" and newest["entitlement_id"] == EID
    assert newest["actor"]["email"] == "admin@example.com" and newest["note"] == "Trừ lượt chấm lỗi"
    assert body["balance"] == 8
    page = client.get(f"/admin/users/{UID}/credits", params={"limit": 1, "cursor": "2"}, headers=AUTH).json()
    assert [i["delta"] for i in page["items"]] == [10] and page["items"][0]["entitlement_id"] == EID
    assert client.get(f"/admin/users/{UID}/credits", params={"cursor": "x"}, headers=AUTH).status_code == 422
