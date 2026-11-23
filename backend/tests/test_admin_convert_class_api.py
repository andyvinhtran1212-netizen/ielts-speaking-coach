"""COURSEACCESS-0055 G04-T15: the three convert-class admin routes (plan 5.9,
5.18) and what changes for the class once it is converted. The RPC itself is
tested against PostgreSQL in test_migration_387_class_credit_conversion.py;
here a fake stands in for it."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from config import settings
from routers import admin_commerce
from services import credits
from services import entitlements as ent
from tests._commerce_fake_db import FakeDB

NOW = datetime.now(timezone.utc)
COURSE = "c0000000-0000-4000-8000-000000000001"
COHORT = "d0000000-0000-4000-8000-000000000001"
PRODUCT = "a0000000-0000-4000-8000-000000000001"
A, B, C, E = (f"b0000000-0000-4000-8000-00000000000{i}" for i in (1, 2, 3, 5))
KEY = "f0000000-0000-4000-8000-000000000001"
AUTH = {"Authorization": "Bearer admin"}


def _member(n, user, cohort=COHORT):
    return ([{"id": f"m{n}", "student_id": f"s{n}", "cohort_id": cohort, "is_active": True}],
            [{"id": f"s{n}", "user_id": user, "full_name": f"Học viên {n}"}])


@pytest.fixture
def world(monkeypatch):
    memberships, students = [], []
    for n, user in enumerate((A, B, C, None), start=1):
        m, s = _member(n, user)
        memberships += m
        students += s
    db = FakeDB(tables={
        "cohorts": [{"id": COHORT, "name": "Lớp IELTS 6.5", "course_id": COURSE, "archived_at": None}],
        "courses": [{"id": COURSE, "code": "IE65", "name": "IELTS 6.5"}],
        "course_products": [{"id": PRODUCT, "course_id": COURSE, "kind": "class", "title": "Lớp IELTS 6.5",
                             "archived_at": None, "features": ["speaking", "writing"]}],
        "student_cohort_memberships": memberships,
        "students": students,
        "access_codes": [
            {"id": "code-a", "cohort_id": COHORT, "product_id": None, "used_by": None, "is_revoked": False,
             "is_active": True, "expires_at": (NOW + timedelta(days=40)).isoformat()},
            {"id": "code-b", "cohort_id": COHORT, "product_id": None, "used_by": B, "is_revoked": False,
             "is_active": True, "expires_at": None},
        ],
        "user_code_assignments": [{"id": "uca-1", "user_id": A, "code_id": "code-a", "is_active": True}],
        "entitlements": [],
        "users": [{"id": u, "display_name": f"User {u[-1]}"} for u in (A, B, C, E)],
    })

    def convert(params):
        converted, skipped = [], []
        for m in db.tables["student_cohort_memberships"]:
            if m["cohort_id"] != params["p_cohort_id"] or not m["is_active"]:
                continue
            user = next(s["user_id"] for s in db.tables["students"] if s["id"] == m["student_id"])
            if user is None:
                skipped.append({"user_id": None, "reason": "no_account"})
            elif any(e["user_id"] == user for e in db.tables["entitlements"]):
                skipped.append({"user_id": user, "reason": "already_metered"})
            else:
                row = {"id": f"e-{user[-1]}", "user_id": user, "product_id": params["p_product_id"],
                       "course_id": COURSE, "source": "class_conversion", "source_ref": params["p_cohort_id"],
                       "status": "active", "starts_at": NOW.isoformat(), "expires_at": None,
                       "credits_expire_at": None, "credits_closed_at": None, "review_mode": None}
                db.tables["entitlements"].append(row)
                converted.append({"user_id": user, "entitlement_id": row["id"], "expires_at": None,
                                  "balance": params["p_credits_per_member"]})
        return {"status": "converted", "converted": converted, "skipped": skipped}

    db.handlers = {"fn_credit_convert_class": convert}
    for module in (credits, ent, admin_commerce):
        monkeypatch.setattr(module, "supabase_admin", db)
    state = {"admin": True}

    async def require_admin(authorization):
        if not state["admin"]:
            raise HTTPException(403, "Chỉ admin mới truy cập được.")
        return {"id": "admin-1", "role": "admin"}

    monkeypatch.setattr(admin_commerce, "require_admin", require_admin)
    step_up = []
    monkeypatch.setattr(admin_commerce.staff_guard, "require_recent_mfa",
                        lambda admin, authorization: step_up.append(admin["id"]))
    monkeypatch.setattr(settings, "LEGACY_CLASS_INITIAL_CREDITS", None)
    return {"db": db, "state": state, "step_up": step_up}


@pytest.fixture
def client():
    return TestClient(main.app)


def _post(client, credits_per_member=10, **extra):
    return client.post("/admin/credits/convert-class", headers=AUTH,
                       json={"cohort_id": COHORT, "credits_per_member": credits_per_member, "request_key": KEY,
                             **extra})


def test_every_route_needs_an_admin(client, world):
    world["state"]["admin"] = False
    for res in (client.get("/admin/credits/convert-class/pending", headers=AUTH),
                client.get("/admin/credits/convert-class/preview", params={"cohort_id": COHORT}, headers=AUTH),
                _post(client)):
        assert res.status_code == 403
    assert world["db"].calls == [] and world["db"].rpcs == []
    # A bad body is 422 before the guard, and nothing is read.
    res = client.post("/admin/credits/convert-class", headers=AUTH,
                      json={"cohort_id": COHORT, "credits_per_member": -1, "request_key": KEY})
    assert res.status_code == 422 and world["db"].calls == []


def test_preview_counts_expiry_and_suggested_credits(client, world, monkeypatch):
    res = client.get("/admin/credits/convert-class/preview", params={"cohort_id": COHORT}, headers=AUTH)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["cohort"] == {"id": COHORT, "name": "Lớp IELTS 6.5", "course_code": "IE65"}
    assert body["product"] == {"id": PRODUCT, "title": "Lớp IELTS 6.5"} and len(body["products"]) == 1
    assert body["counts"] == {"to_convert": 3, "already_metered": 0, "no_account": 1}
    assert body["suggested_credits"] is None
    by_user = {m["user_id"]: m for m in body["members"]}
    assert ent.parse_ts(by_user[A]["expires_at"]) == ent.parse_ts(world["db"].tables["access_codes"][0]["expires_at"])
    assert by_user[B]["expires_at"] is None and by_user[C]["expires_at"] is None
    assert by_user[None]["state"] == "no_account" and by_user[None]["display_name"] == "Học viên 4"
    assert by_user[A]["display_name"] == "User 1"
    monkeypatch.setattr(settings, "LEGACY_CLASS_INITIAL_CREDITS", 12)
    body = client.get("/admin/credits/convert-class/preview", params={"cohort_id": COHORT}, headers=AUTH).json()
    assert body["suggested_credits"] == 12
    # The preview writes nothing.
    assert not any(op != "select" for _, op in world["db"].calls) and world["db"].rpcs == []


def test_preview_refusals(client, world):
    res = client.get("/admin/credits/convert-class/preview",
                     params={"cohort_id": "d0000000-0000-4000-8000-0000000000ff"}, headers=AUTH)
    assert res.status_code == 404 and res.json()["detail"]["error_code"] == "cohort_not_found"
    world["db"].tables["cohorts"][0]["archived_at"] = NOW.isoformat()
    res = client.get("/admin/credits/convert-class/preview", params={"cohort_id": COHORT}, headers=AUTH)
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "cohort_archived"
    world["db"].tables["cohorts"][0].update(archived_at=None, course_id=None)
    res = client.get("/admin/credits/convert-class/preview", params={"cohort_id": COHORT}, headers=AUTH)
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "cohort_has_no_course"


def test_pending_before_after_and_with_a_new_member(client, world):
    pending = client.get("/admin/credits/convert-class/pending", headers=AUTH).json()["items"]
    assert pending == [{"cohort_id": COHORT, "cohort_name": "Lớp IELTS 6.5", "course_code": "IE65",
                        "members": 4, "pending_members": 3}]
    res = _post(client)
    assert res.status_code == 200 and res.json()["status"] == "converted"
    assert len(res.json()["converted"]) == 3 and res.json()["skipped"] == [{"user_id": None, "reason": "no_account"}]
    assert world["step_up"] == ["admin-1"]
    assert client.get("/admin/credits/convert-class/pending", headers=AUTH).json()["items"] == []
    m, s = _member(5, E)
    world["db"].tables["student_cohort_memberships"] += m
    world["db"].tables["students"] += s
    pending = client.get("/admin/credits/convert-class/pending", headers=AUTH).json()["items"]
    assert [(p["cohort_id"], p["pending_members"]) for p in pending] == [(COHORT, 1)]


def test_product_choice(client, world):
    world["db"].tables["course_products"][0]["kind"] = "online"
    res = _post(client)
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "no_class_product"
    world["db"].tables["course_products"][0]["kind"] = "class"
    world["db"].tables["course_products"].append({"id": "a0000000-0000-4000-8000-000000000002",
                                                  "course_id": COURSE, "kind": "class", "title": "Lớp B",
                                                  "archived_at": None})
    res = _post(client)
    assert res.status_code == 409 and res.json()["detail"]["error_code"] == "product_ambiguous"
    assert world["db"].rpcs == []
    res = _post(client, product_id=PRODUCT)
    assert res.status_code == 200 and world["db"].rpcs[0][1]["p_product_id"] == PRODUCT
    assert world["db"].rpcs[0][1]["p_credits_per_member"] == 10 and world["db"].rpcs[0][1]["p_admin_id"] == "admin-1"


def test_zero_credits_needs_no_step_up_and_a_failed_rpc_is_503(client, world):
    assert _post(client, credits_per_member=0).status_code == 200 and world["step_up"] == []
    world["db"].handlers["fn_credit_convert_class"] = lambda params: RuntimeError("down")
    res = client.post("/admin/credits/convert-class", headers=AUTH,
                      json={"cohort_id": COHORT, "credits_per_member": 1,
                            "request_key": "f0000000-0000-4000-8000-000000000002"})
    assert res.status_code == 503 and res.json()["detail"]["error_code"] == "credits_unavailable"
    world["db"].handlers["fn_credit_convert_class"] = lambda params: {"status": "product_invalid"}
    res = _post(client, product_id=PRODUCT)
    assert res.status_code == 422 and res.json()["detail"]["error_code"] == "product_invalid"


def test_after_conversion_class_work_is_metered_and_shows_one_row(client, world, monkeypatch):
    monkeypatch.setattr(credits, "_metering_on", lambda: True)
    plan = credits.charge_plan(A, "speaking_grading", assignment={"cohort_id": COHORT})
    assert (plan.metered, plan.reason) == (False, "legacy_class")
    _post(client, credits_per_member=2)
    plan = credits.charge_plan(A, "speaking_grading", assignment={"cohort_id": COHORT})
    assert (plan.metered, plan.reason) == (True, "class")
    # Revoking the member does not make the class free again (plan 5.18).
    world["db"].tables["entitlements"][0].update(status="revoked", revoked_at=NOW.isoformat())
    plan = credits.charge_plan(A, "speaking_grading", assignment={"cohort_id": COHORT})
    assert (plan.metered, plan.reason) == (True, "class")
    world["db"].tables["entitlements"][0].update(status="active", revoked_at=None)
    # /api/me/courses: one row for the class's course, the converted entitlement.
    rows = ent.fetch_entitlement_rows(A)
    items = ent.build_access(rows, ent.fetch_products(r["product_id"] for r in rows), [COURSE], [], NOW)
    assert [(i.course_id, i.source, i.kind) for i in items] == [(COURSE, "class_conversion", "class")]
    # grant-extra for the whole class now reaches these members.
    chosen = credits._class_entitlements([A, B, C], COURSE)
    assert chosen == {A: "e-1", B: "e-2", C: "e-3"}
