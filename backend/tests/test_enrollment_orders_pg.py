"""COURSEACCESS-0055 G04-T04 — the order flow end to end on PostgreSQL.

The learner and admin routes, the learner mail dispatcher and
``/api/me/courses`` run against the real 383/384 tables, triggers and RPCs
(the ``pg`` harness of the 384 test: TEST_PG_URL, REQUIRE_PG=1 forbids the
skip). Only auth and the Resend endpoint are faked.
"""

from __future__ import annotations

import asyncio
import json
from datetime import timedelta
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from routers import admin_commerce, enrollment, me_access
from services import enrollment_orders as eo
from services import entitlements as ent
from services import learner_email as le
from services import runtime_flags
from tests._pg_supabase import PgSupabase
from tests.test_migration_384_credit_ledger_enrollment_rpcs import ADMIN, pg  # noqa: F401  (fixture)

AUTH = {"Authorization": "Bearer learner"}
ADMIN_AUTH = {"Authorization": "Bearer admin"}


@pytest.fixture
def wire(monkeypatch):
    def setup(harness, user_id):
        db = PgSupabase(harness.con, asyncio.get_running_loop())
        for module in (eo, enrollment, admin_commerce, le, ent, me_access):
            monkeypatch.setattr(module, "supabase_admin", db)
        monkeypatch.setattr(eo.runtime_flags, "is_enabled_strict", lambda key, default=False: True)

        async def learner(authorization):
            if authorization != AUTH["Authorization"]:
                raise HTTPException(401, "Invalid token")
            return {"id": str(user_id), "email": "hv@example.test", "email_confirmed_at": "2026-11-01T00:00:00Z"}

        async def admin(authorization):
            return {"id": str(ADMIN)}

        for module in (enrollment, me_access):
            monkeypatch.setattr(module, "get_supabase_user", AsyncMock(side_effect=learner))
        monkeypatch.setattr(admin_commerce, "require_admin", AsyncMock(side_effect=admin))
        s = eo.settings
        for name, value in (("ENROLLMENT_PAY_HOURS", 48), ("ENROLL_BANK_BIN", "970436"),
                            ("ENROLL_BANK_NAME", "Vietcombank"), ("ENROLL_BANK_ACCOUNT_NO", "0123456789"),
                            ("ENROLL_BANK_ACCOUNT_NAME", "CONG TY AVER"), ("LEARNER_EMAIL_FROM", "hv@averlearning.com"),
                            ("PUBLIC_SITE_URL", "https://www.averlearning.com")):
            monkeypatch.setattr(s, name, value)
        monkeypatch.setenv("RESEND_API_KEY", "re_test")
        return db
    return setup


async def _call(client, method, path, **kw):
    return await asyncio.to_thread(getattr(client, method), path, **kw)


async def _outbox(con):
    rows = await con.fetch("SELECT template, status, payload::text AS payload FROM learner_email_outbox ORDER BY created_at")
    return [(r["template"], r["status"], json.loads(r["payload"])) for r in rows]


async def _learner(pg, active=False):  # noqa: F811
    user = await pg.user(active=active)
    await pg.con.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text")
    # Production columns the 384 harness leaves out (legacy access codes, read by /api/me/courses).
    await pg.con.execute("ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS permissions text[], "
                         "ADD COLUMN IF NOT EXISTS session_limit integer, "
                         "ADD COLUMN IF NOT EXISTS product_id uuid")
    await pg.con.execute("UPDATE users SET display_name = 'Minh Anh' WHERE id = $1", user)
    return user


@pytest.mark.asyncio
async def test_create_report_needs_info_supplement_confirm_and_mail(pg, wire):  # noqa: F811
    user = await _learner(pg)
    product = await pg.product(ai_credits=40, access_days=180)
    slug = await pg.con.fetchval("SELECT slug FROM course_products WHERE id = $1", product)
    wire(pg, user)
    client = TestClient(main.app)

    body = {"product_slug": slug, "request_key": "req-key-0001"}
    created = await _call(client, "post", "/api/enrollment-orders", json=body, headers=AUTH)
    assert created.status_code == 201, created.text
    code = created.json()["order"]["order_code"]
    replay = await _call(client, "post", "/api/enrollment-orders", json=body, headers=AUTH)
    assert replay.status_code == 200 and replay.json()["order"]["order_code"] == code
    other_key = await _call(client, "post", "/api/enrollment-orders",
                            json={**body, "request_key": "req-key-0002"}, headers=AUTH)
    assert other_key.status_code == 200 and other_key.json()["order"]["order_code"] == code

    reported = await _call(client, "post", f"/api/enrollment-orders/{code}/report-transfer",
                           json={"note": "Chuyển lúc 9h"}, headers=AUTH)
    assert reported.json()["order"]["status"] == "transfer_reported"
    assert [t for t, _, _ in await _outbox(pg.con)] == ["order_created"]  # no letter for a report

    order_id = await pg.con.fetchval("SELECT id::text FROM enrollment_orders WHERE order_code = $1", code)
    message = "Bạn chuyển thiếu 490.000 đ.\nChuyển thêm giúp nhé."
    info = await _call(client, "post", f"/admin/enrollment-orders/{order_id}/request-info",
                       json={"info_kind": "underpaid", "received_vnd": 500000, "message": message},
                       headers=ADMIN_AUTH)
    assert info.status_code == 200, info.text
    assert info.json()["order"]["status"] == "needs_info" and info.json()["order"]["received_vnd"] == 500000
    supplemented = await _call(client, "post", f"/api/enrollment-orders/{code}/supplement",
                               json={"note": "Đã chuyển thêm"}, headers=AUTH)
    assert supplemented.json()["order"]["status"] == "transfer_reported"

    confirmed = await _call(client, "post", f"/admin/enrollment-orders/{order_id}/confirm",
                            json={"received_vnd": 1000000}, headers=ADMIN_AUTH)
    assert confirmed.status_code == 200, confirmed.text
    out = confirmed.json()
    assert out["status"] == "confirmed" and out["credits_granted"] == 40 and out["reopened"] is False
    assert out["order"]["credits_granted"] == 40 and out["order"]["entitlement_expires_at"]
    assert await pg.con.fetchval("SELECT is_active FROM users WHERE id = $1", user) is True
    again = await _call(client, "post", f"/admin/enrollment-orders/{order_id}/confirm", json={},
                        headers=ADMIN_AUTH)
    assert again.json()["status"] == "already_confirmed"

    courses = await _call(client, "get", "/api/me/courses", headers=AUTH)
    assert courses.status_code == 200, courses.text
    item = next(i for i in courses.json()["items"] if i["source"] == "enrollment_order")
    assert item["state"] == "active" and item["credits"]["balance"] == 40
    assert courses.json()["credits"]["total"] == 40

    letters = await _outbox(pg.con)
    assert [t for t, _, _ in letters] == ["order_created", "order_needs_info", "order_confirmed"]
    assert letters[1][2]["admin_message"] == message  # verbatim (FR-037)

    detail = await _call(client, "get", f"/admin/enrollment-orders/{order_id}", headers=ADMIN_AUTH)
    assert [e["action"] for e in detail.json()["events"]] == \
        ["create", "report_transfer", "request_info", "supplement", "confirm"]

    sent = []

    def resend(request):
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"id": "re"})

    async def dispatch():  # own loop: the store calls block on the test loop's connection
        async with httpx.AsyncClient(transport=httpx.MockTransport(resend)) as http:
            return await le.dispatch_due(50, client=http)

    summary = await asyncio.to_thread(asyncio.run, dispatch())
    assert summary.sent == 3, summary
    assert {m["to"][0] for m in sent} == {f"{str(user)[:8]}@example.test"}
    assert any("Bạn chuyển thiếu 490.000 đ.\nChuyển thêm giúp nhé." in m["text"] for m in sent)
    assert [s for _, s, _ in await _outbox(pg.con)] == ["sent", "sent", "sent"]


@pytest.mark.asyncio
async def test_cancel_and_expire_send_nothing_and_expired_confirm_reopens(pg, wire):  # noqa: F811
    user = await _learner(pg, active=True)
    product = await pg.product(ai_credits=5, access_days=180)  # well outside the renew window
    slug = await pg.con.fetchval("SELECT slug FROM course_products WHERE id = $1", product)
    wire(pg, user)
    client = TestClient(main.app)

    first = await _call(client, "post", "/api/enrollment-orders",
                        json={"product_slug": slug, "request_key": "cancel-key-1"}, headers=AUTH)
    code = first.json()["order"]["order_code"]
    cancelled = await _call(client, "post", f"/api/enrollment-orders/{code}/cancel", json={}, headers=AUTH)
    assert cancelled.json()["order"]["cancel_reason"] == "learner"

    second = await _call(client, "post", "/api/enrollment-orders",
                         json={"product_slug": slug, "request_key": "expire-key-1"}, headers=AUTH)
    code2 = second.json()["order"]["order_code"]
    # Push pay_by into the past (the transition trigger allows it), then sweep.
    await pg.con.execute("UPDATE enrollment_orders SET pay_by = now() - interval '1 minute' WHERE order_code = $1",
                         code2)
    from scripts import enrollment_sweep
    assert await asyncio.to_thread(enrollment_sweep.run, no_mail=True) == 0
    assert await pg.con.fetchval("SELECT status FROM enrollment_orders WHERE order_code = $1", code2) == "expired"
    late = await _call(client, "post", f"/api/enrollment-orders/{code2}/report-transfer", json={}, headers=AUTH)
    assert late.json()["late"] is True and late.json()["order"]["transfer"]["memo"] == code2
    assert [t for t, _, _ in await _outbox(pg.con)] == ["order_created", "order_created"]

    order2 = await pg.con.fetchval("SELECT id::text FROM enrollment_orders WHERE order_code = $1", code2)
    listed = await _call(client, "get", "/admin/enrollment-orders", params={"late": 1, "q": code2.replace("-", "")},
                         headers=ADMIN_AUTH)
    assert [o["order_code"] for o in listed.json()["items"]] == [code2]
    counts = (await _call(client, "get", "/admin/enrollment-orders/counts", headers=ADMIN_AUTH)).json()
    assert counts["cancelled"] == 1 and counts["expired"] == 1 and counts["expired_late_reported"] == 1
    refused = await _call(client, "post", f"/admin/enrollment-orders/{order2}/confirm", json={}, headers=ADMIN_AUTH)
    assert refused.status_code == 409
    reopened = await _call(client, "post", f"/admin/enrollment-orders/{order2}/confirm",
                           json={"allow_expired": True}, headers=ADMIN_AUTH)
    assert reopened.json()["reopened"] is True and reopened.json()["order"]["reopened_at"]
    assert [t for t, _, _ in await _outbox(pg.con)] == ["order_created", "order_created", "order_confirmed"]

    renew = await _call(client, "post", "/api/enrollment-orders",
                        json={"product_slug": slug, "request_key": "renew-key-1"}, headers=AUTH)
    assert renew.status_code == 409 and renew.json()["detail"]["error_code"] == "already_enrolled"
