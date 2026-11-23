"""COURSEACCESS-0055 G04-T04 — learner enrollment-order API (plan 5.9).

The 384 RPCs are faked here with their documented answers; the real RPCs run
in ``tests/test_enrollment_orders_pg.py``."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from routers import enrollment
from services import enrollment_orders as eo
from services import runtime_flags
from tests._commerce_fake_db import FakeDB

AUTH = {"Authorization": "Bearer token"}
NOW = datetime.now(timezone.utc)
PRODUCT = {"id": "p1", "course_id": "c1", "slug": "ielts-6", "kind": "online", "title": "IELTS 6.0",
           "short_title": "6.0", "status": "open", "is_public": True, "archived_at": None}


def _order(code="AVER-ABCDEF", status="awaiting_transfer", user_id="u1", **extra):
    return {"id": "o-" + code, "order_code": code, "user_id": user_id, "product_id": "p1", "status": status,
            "tuition_vnd": 1990000, "access_days": 180, "ai_credits": 40, "credit_valid_days": None,
            "product_title": "IELTS 6.0", "learner_note": None, "info_kind": None, "received_vnd": None,
            "admin_message": None, "supplement_by": None, "pay_by": (NOW + timedelta(hours=48)).isoformat(),
            "transfer_reported_at": None, "late_transfer_reported_at": None, "confirmed_at": None,
            "cancelled_at": None, "expired_at": None, "reopened_at": None, "cancelled_by": None,
            "cancel_reason": None, "entitlement_id": None, "created_at": NOW.isoformat(), **extra}


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def world(monkeypatch):
    state = {"user": {"id": "u1", "email": "a@example.com", "email_confirmed_at": "2026-11-01T00:00:00Z"},
             "flag": True, "flag_error": False, "collisions": 0}
    db = FakeDB(tables={"course_products": [dict(PRODUCT)], "entitlements": [], "enrollment_orders": []})

    def create(params):
        if state["collisions"]:
            state["collisions"] -= 1
            return {"status": "code_collision"}
        orders = db.tables["enrollment_orders"]
        same_key = [o for o in orders if o["user_id"] == params["p_user_id"]
                    and o["request_key"] == params["p_request_key"]]
        if same_key:
            if same_key[0]["product_id"] != params["p_product_id"]:
                return {"status": "request_key_conflict"}
            return {"status": "replay", "order": same_key[0]}
        open_ = [o for o in orders if o["user_id"] == params["p_user_id"] and o["product_id"] == params["p_product_id"]
                 and o["status"] in eo.OPEN_STATUSES]
        if open_:
            return {"status": "existing_open", "order": open_[0]}
        order = {**_order(params["p_order_code"]), "request_key": params["p_request_key"],
                 "user_id": params["p_user_id"]}
        orders.append(order)
        return {"status": "created", "order": order}

    def learner_action(params):
        rows = [o for o in db.tables["enrollment_orders"]
                if o["order_code"] == params["p_order_code"] and o["user_id"] == params["p_user_id"]]
        if not rows:
            return {"status": "not_found"}
        order = rows[0]
        action, status = params["p_action"], order["status"]
        if action == "report_transfer" and status == "expired":
            order["late_transfer_reported_at"] = NOW.isoformat()
            return {"status": "ok", "late": True, "order": order}
        if action == "report_transfer" and status == "awaiting_transfer":
            order.update(status="transfer_reported", transfer_reported_at=NOW.isoformat())
        elif action == "cancel" and status in eo.OPEN_STATUSES:
            order.update(status="cancelled", cancelled_at=NOW.isoformat(), cancelled_by=params["p_user_id"])
        elif action == "supplement" and status == "needs_info":
            order.update(status="transfer_reported", learner_note=params["p_note"])
        else:
            return {"status": "invalid_transition", "order_status": status}
        return {"status": "ok", "late": False, "order": order}

    db.handlers = {"fn_enrollment_order_create": create, "fn_enrollment_order_learner_action": learner_action}
    monkeypatch.setattr(eo, "supabase_admin", db)
    monkeypatch.setattr(enrollment, "supabase_admin", db)

    def flag(key, default=False):
        assert key == "enrollment_orders" and default is False
        if state["flag_error"]:
            raise runtime_flags.FlagLookupError(key)
        return state["flag"]

    monkeypatch.setattr(eo.runtime_flags, "is_enabled_strict", flag)

    async def user(authorization):
        if not authorization:
            raise HTTPException(401, "Missing or invalid Authorization header")
        return state["user"]

    monkeypatch.setattr(enrollment, "get_supabase_user", AsyncMock(side_effect=user))
    s = eo.settings
    for name, value in (("ENROLLMENT_PAY_HOURS", 48), ("ENROLL_BANK_BIN", "970436"),
                        ("ENROLL_BANK_NAME", "Vietcombank"), ("ENROLL_BANK_ACCOUNT_NO", "0123456789"),
                        ("ENROLL_BANK_ACCOUNT_NAME", "CONG TY AVER"),
                        ("ENROLL_VIETQR_IMAGE_TEMPLATE",
                         "https://img.vietqr.io/image/{bank_bin}-{account_no}-compact.png?amount={amount}&addInfo={memo}"),
                        ("ENROLL_RENEW_WINDOW_DAYS", 30)):
        monkeypatch.setattr(s, name, value)
    state["db"] = db
    return state


def _real_vietqr():
    try:
        from services import vietqr
    except ImportError:
        return None
    return vietqr


def _cfg(**over):
    base = dict(pay_hours=48, bank_bin="970436", bank_name="Vietcombank", account_no="0123456789",
                account_name="CONG TY AVER", vietqr_image_template="", renew_window_days=30,
                reminder_hours_before=12, reminder_min_age_hours=6, supplement_hours=72,
                carry_percent=50, carry_window_days=60)
    base.update(over)
    return eo.EnrollmentConfig(**base)


def test_vietqr_payload_calls_the_real_builder_with_its_keyword():
    """No mock: the real services.vietqr (#2486) must accept the call as made.
    Skips only while that module is not on this branch."""
    vietqr = pytest.importorskip("services.vietqr")
    payload = eo._vietqr_payload(_cfg(), 1990000, "AVER-7K2QXM")
    assert payload is not None and payload.startswith("000201")
    assert payload == vietqr.build_payload(bank_bin="970436", account_no="0123456789",
                                           amount_vnd=1990000, note="AVER-7K2QXM")
    assert "AVER-7K2QXM" in payload


def test_vietqr_payload_is_null_when_the_real_builder_rejects_the_settings():
    pytest.importorskip("services.vietqr")
    assert eo._vietqr_payload(_cfg(bank_bin="97043"), 1990000, "AVER-7K2QXM") is None
    assert eo._vietqr_payload(_cfg(), 0, "AVER-7K2QXM") is None


def test_vietqr_signature_mismatch_surfaces_instead_of_a_silent_null(monkeypatch):
    """A builder whose keywords differ (the memo=/note= drift) raises TypeError,
    which must not be swallowed into vietqr_payload = null."""
    import sys
    import types

    import services

    stale = types.ModuleType("services.vietqr")

    def build_payload(*, bank_bin, account_no, amount_vnd, memo):  # old keyword
        return "never"

    stale.build_payload = build_payload
    monkeypatch.setitem(sys.modules, "services.vietqr", stale)
    monkeypatch.setattr(services, "vietqr", stale, raising=False)
    with pytest.raises(TypeError):
        eo._vietqr_payload(_cfg(), 1990000, "AVER-7K2QXM")


def _create(client, key="key-12345678", slug="ielts-6"):
    return client.post("/api/enrollment-orders", json={"product_slug": slug, "request_key": key}, headers=AUTH)


def test_requires_sign_in(client, world):
    assert client.post("/api/enrollment-orders", json={"product_slug": "x", "request_key": "k" * 8}).status_code == 401
    assert client.get("/api/enrollment-orders/me").status_code == 401


def test_create_then_replay_same_request_key_returns_the_same_order(client, world):
    first = _create(client)
    assert first.status_code == 201
    order = first.json()["order"]
    assert order["order_code"].startswith("AVER-") and len(order["order_code"]) == 11
    assert order["status"] == "awaiting_transfer" and order["tuition_vnd"] == 1990000
    transfer = order["transfer"]
    assert transfer["memo"] == order["order_code"] and transfer["amount_vnd"] == 1990000
    assert transfer["account_no"] == "0123456789"
    if _real_vietqr() is None:  # G05-T11 (#2486) not merged here yet
        assert transfer["vietqr_payload"] is None
    else:
        assert transfer["vietqr_payload"] == _real_vietqr().build_payload(
            bank_bin="970436", account_no="0123456789", amount_vnd=1990000, note=order["order_code"])
    assert transfer["qr_image_url"] == (f"https://img.vietqr.io/image/970436-0123456789-compact.png"
                                        f"?amount=1990000&addInfo={order['order_code']}")
    again = _create(client)
    assert again.status_code == 200 and again.json()["order"]["order_code"] == order["order_code"]
    create_calls = [p for n, p in world["db"].rpcs if n == "fn_enrollment_order_create"]
    assert create_calls[0]["p_pay_hours"] == 48


def test_second_open_order_for_the_course_returns_the_open_one(client, world):
    code = _create(client).json()["order"]["order_code"]
    other = _create(client, key="key-other-999")
    assert other.status_code == 200 and other.json()["order"]["order_code"] == code


def test_code_collision_retries_with_a_new_code(client, world):
    world["collisions"] = 2
    assert _create(client).status_code == 201
    codes = [p["p_order_code"] for n, p in world["db"].rpcs if n == "fn_enrollment_order_create"]
    assert len(codes) == 3 and len(set(codes)) == 3


@pytest.mark.parametrize("missing", ["ENROLLMENT_PAY_HOURS", "ENROLL_BANK_ACCOUNT_NO"])
def test_missing_settings_pause_orders(client, world, monkeypatch, missing):
    monkeypatch.setattr(eo.settings, missing, 0 if missing == "ENROLLMENT_PAY_HOURS" else "")
    res = _create(client)
    assert res.status_code == 503 and res.json()["detail"]["error_code"] == "orders_paused"
    assert world["db"].rpcs == []


def test_flag_off_pauses_and_flag_error_is_unavailable(client, world):
    world["flag"] = False
    res = _create(client)
    assert res.status_code == 503 and res.json()["detail"]["error_code"] == "orders_paused"
    world["flag"], world["flag_error"] = True, True
    res = _create(client)
    assert res.status_code == 503 and res.json()["detail"]["error_code"] == "orders_unavailable"


def test_unconfirmed_gotrue_email_must_sign_in_again(client, world):
    world["user"] = {"id": "u1", "email": "a@example.com", "email_confirmed_at": None,
                     "user_metadata": {"email_confirmed_at": "2026-01-01"}}
    res = _create(client)
    assert res.status_code == 403
    assert res.json()["detail"] == {"error_code": "sign_in_again",
                                    "message": "Vui lòng đăng nhập lại bằng Google hoặc mã gửi qua email."}


@pytest.mark.parametrize("change,status,code", [
    ({"slug": "khac"}, 404, "course_not_found"),
    ({"kind": "class"}, 404, "course_not_found"),
    ({"is_public": False}, 404, "course_not_found"),
    ({"archived_at": "2026-11-01T00:00:00Z"}, 404, "course_not_found"),
    ({"status": "coming_soon"}, 409, "course_not_open"),
    ({"status": "closed"}, 409, "course_not_open"),
])
def test_only_an_open_public_online_course_takes_orders(client, world, change, status, code):
    world["db"].tables["course_products"][0].update(change)
    res = _create(client)
    assert res.status_code == status and res.json()["detail"]["error_code"] == code


def test_already_enrolled_unless_inside_the_renew_window(client, world):
    ents = world["db"].tables["entitlements"]
    ents.append({"id": "e1", "user_id": "u1", "product_id": "p1", "status": "active",
                 "starts_at": (NOW - timedelta(days=10)).isoformat(),
                 "expires_at": (NOW + timedelta(days=100)).isoformat()})
    res = _create(client)
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "already_enrolled"
    ents[0]["expires_at"] = (NOW + timedelta(days=20)).isoformat()   # inside 30 days: renewal allowed
    assert _create(client).status_code == 201
    ents[0]["status"] = "revoked"
    assert _create(client, key="key-after-revoke").status_code == 200  # the open order again


def test_a_retry_after_the_order_was_confirmed_replays_it(client, world):
    first = _create(client)
    code = first.json()["order"]["order_code"]
    order = world["db"].tables["enrollment_orders"][0]
    order.update(status="confirmed", confirmed_at=NOW.isoformat())
    world["db"].tables["entitlements"].append({
        "id": "e1", "user_id": "u1", "product_id": "p1", "status": "active",
        "starts_at": NOW.isoformat(), "expires_at": (NOW + timedelta(days=180)).isoformat()})
    world["db"].tables["course_products"][0]["status"] = "coming_soon"   # closed since, too
    calls = len(world["db"].rpcs)
    again = _create(client)
    assert again.status_code == 200, again.text
    assert again.json()["order"]["order_code"] == code and again.json()["order"]["status"] == "confirmed"
    assert len(world["db"].rpcs) == calls        # answered from the stored order, no new create
    # A new key is a new order and meets the checks.
    assert _create(client, key="key-new-0001").json()["detail"]["error_code"] == "course_not_open"


def test_the_same_key_for_another_course_is_a_conflict_before_the_checks(client, world):
    _create(client)
    world["db"].tables["course_products"].append({**PRODUCT, "id": "p2", "slug": "ielts-7", "status": "coming_soon"})
    res = _create(client, slug="ielts-7")
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "request_key_conflict"


def test_rpc_answers_map_to_errors(client, world):
    for answer, status, code in (({"status": "account_suspended"}, 403, "account_suspended"),
                                 ({"status": "product_unavailable"}, 409, "course_not_open"),
                                 ({"status": "request_key_conflict"}, 409, "request_key_conflict"),
                                 (RuntimeError("down"), 503, "orders_unavailable"),
                                 ({"status": "weird"}, 503, "orders_unavailable")):
        world["db"].handlers["fn_enrollment_order_create"] = lambda p, a=answer: a
        res = _create(client)
        assert (res.status_code, res.json()["detail"]["error_code"]) == (status, code)


def test_list_and_read_only_own_orders(client, world):
    orders = world["db"].tables["enrollment_orders"]
    orders.append(_order("AVER-AAAAAA", created_at=(NOW - timedelta(days=2)).isoformat()))
    orders.append(_order("AVER-BBBBBB", created_at=(NOW - timedelta(days=1)).isoformat()))
    orders.append(_order("AVER-CCCCCC", user_id="u2"))
    page = client.get("/api/enrollment-orders/me?limit=1", headers=AUTH).json()
    assert [o["order_code"] for o in page["items"]] == ["AVER-BBBBBB"] and page["next_cursor"]
    rest = client.get(f"/api/enrollment-orders/me?limit=1&cursor={page['next_cursor']}", headers=AUTH).json()
    assert [o["order_code"] for o in rest["items"]] == ["AVER-AAAAAA"] and rest["next_cursor"] is None
    assert client.get("/api/enrollment-orders/AVER-BBBBBB", headers=AUTH).status_code == 200
    # Lower case and a dropped dash still find it; another user's order is 404.
    assert client.get("/api/enrollment-orders/averbbbbbb", headers=AUTH).json()["order"]["order_code"] == "AVER-BBBBBB"
    res = client.get("/api/enrollment-orders/AVER-CCCCCC", headers=AUTH)
    assert res.status_code == 404 and res.json()["detail"]["error_code"] == "order_not_found"


def test_report_transfer_on_time_and_late(client, world):
    orders = world["db"].tables["enrollment_orders"]
    orders.append(_order("AVER-AAAAAA"))
    orders.append(_order("AVER-BBBBBB", status="expired"))
    res = client.post("/api/enrollment-orders/AVER-AAAAAA/report-transfer", json={"note": " đã chuyển "},
                      headers=AUTH)
    assert res.status_code == 200 and res.json()["late"] is False
    assert res.json()["order"]["status"] == "transfer_reported"
    assert world["db"].rpcs[-1][1]["p_note"] == "đã chuyển"
    late = client.post("/api/enrollment-orders/AVER-BBBBBB/report-transfer", json={}, headers=AUTH).json()
    assert late["late"] is True and late["order"]["status"] == "expired"
    assert late["order"]["transfer"]["memo"] == "AVER-BBBBBB"  # an expired order still shows the memo
    again = client.post("/api/enrollment-orders/AVER-AAAAAA/report-transfer", json={}, headers=AUTH)
    assert again.status_code == 409 and again.json()["detail"]["error_code"] == "invalid_transition"


def test_supplement_needs_a_note_and_a_needs_info_order(client, world):
    world["db"].tables["enrollment_orders"].append(_order("AVER-AAAAAA", status="needs_info"))
    assert client.post("/api/enrollment-orders/AVER-AAAAAA/supplement", json={"note": "ab"},
                       headers=AUTH).status_code == 422
    assert client.post("/api/enrollment-orders/AVER-AAAAAA/supplement", json={"note": "   abc  "[:4]},
                       headers=AUTH).status_code == 422
    ok = client.post("/api/enrollment-orders/AVER-AAAAAA/supplement", json={"note": "Đã chuyển thêm"}, headers=AUTH)
    assert ok.status_code == 200 and ok.json()["order"]["status"] == "transfer_reported"


def test_cancel_by_the_learner(client, world):
    world["db"].tables["enrollment_orders"].append(_order("AVER-AAAAAA"))
    res = client.post("/api/enrollment-orders/AVER-AAAAAA/cancel", json={}, headers=AUTH)
    order = res.json()["order"]
    assert (order["status"], order["cancel_reason"], order["cancel_note"]) == ("cancelled", "learner", None)
    assert order["transfer"] is None
    assert client.post("/api/enrollment-orders/AVER-AAAAAA/cancel", json={}, headers=AUTH).status_code == 409


def test_order_view_fields():
    cfg = eo.EnrollmentConfig(48, "970436", "VCB", "0123", "AVER", "", 30, 24, 6, 72, 100, 60)
    admin_cancel = eo.order_view(_order(status="cancelled", cancelled_by="admin-1", cancel_reason="Trùng đơn"),
                                 product=PRODUCT, cfg=cfg)
    assert (admin_cancel["cancel_reason"], admin_cancel["cancel_note"]) == ("admin", "Trùng đơn")
    over = eo.order_view(_order(status="needs_info", received_vnd=2000000), product=PRODUCT, cfg=cfg)
    assert over["overpaid_vnd"] == 10000
    under = eo.order_view(_order(status="needs_info", received_vnd=1000), product=PRODUCT, cfg=cfg)
    assert under["overpaid_vnd"] is None
    confirmed = eo.order_view(_order(status="confirmed", entitlement_id="e1"), product=PRODUCT, cfg=cfg,
                              entitlement_expires_at="2027-05-15T00:00:00+00:00")
    assert confirmed["transfer"] is None and confirmed["credits_granted"] == 40
    assert confirmed["entitlement_expires_at"] == "2027-05-15T00:00:00Z"
    assert eo.order_view(_order(), product=PRODUCT, cfg=cfg)["credits_granted"] is None
    # The title captured on the order wins over a later rename.
    renamed = eo.order_view(_order(), product={**PRODUCT, "title": "Tên mới"}, cfg=cfg)
    assert renamed["product"] == {"slug": "ielts-6", "title": "IELTS 6.0", "short_title": "6.0"}


@pytest.mark.parametrize("raw,code", [
    ("AVER-7K2QXM", "AVER-7K2QXM"), ("aver7k2qxm", "AVER-7K2QXM"), (" AVER 7K2 QXM ", "AVER-7K2QXM"),
    ("AVER-7K2QX", None), ("AVER-7K2QX1", None), ("ABCD-7K2QXM", None), ("", None), (None, None),
])
def test_normalize_order_code(raw, code):
    assert eo.normalize_order_code(raw) == code


def test_order_codes_use_the_alphabet():
    codes = {eo.new_order_code() for _ in range(200)}
    assert all(eo.normalize_order_code(c) == c for c in codes) and len(codes) > 190
