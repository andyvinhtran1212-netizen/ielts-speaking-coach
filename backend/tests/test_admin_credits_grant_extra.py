"""COURSEACCESS-0055 G04-T12 — POST /admin/credits/grant-extra (plan 5.15).

The RPC is faked with 385's idempotency rule (one row per request key and
entitlement); the SQL itself is covered by test_migration_385_credit_lifecycle.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from routers import admin_commerce
from services import credits
from tests._commerce_fake_db import FakeDB

AUTH = {"Authorization": "Bearer admin"}
NOW = datetime.now(timezone.utc)
COHORT = "c0000000-0000-0000-0000-000000000001"
COURSE = "c0000000-0000-0000-0000-0000000000aa"
KEY = "9a9a9a9a-0000-4000-8000-000000000001"
U1, U2, U3 = (f"00000000-0000-4000-8000-00000000000{i}" for i in (1, 2, 3))


def _ent(eid, user, product, *, days=30, **extra):
    return {"id": eid, "user_id": user, "product_id": product, "course_id": COURSE, "source": "access_code",
            "status": "active", "starts_at": (NOW - timedelta(days=1)).isoformat(),
            "expires_at": (NOW + timedelta(days=days)).isoformat() if days is not None else None,
            "credits_expire_at": None, "credits_closed_at": None, "review_mode": None,
            "created_at": NOW.isoformat(), **extra}


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def world(monkeypatch):
    state = {"admin": True, "step_up": []}
    db = FakeDB(tables={
        "cohorts": [{"id": COHORT, "course_id": COURSE}],
        "course_products": [{"id": "p-class", "course_id": COURSE, "kind": "class"},
                            {"id": "p-online", "course_id": COURSE, "kind": "online"}],
        "entitlements": [
            _ent("e1-short", U1, "p-class", days=10), _ent("e1-long", U1, "p-class", days=90),
            _ent("e2", U2, "p-class", days=None),
            # U3 has only an online term of the course (and, in real life, a legacy code): no class entitlement.
            _ent("e3", U3, "p-online"),
        ],
    })
    ledger: dict[str, dict] = {}
    balances = {"e1-short": 0, "e1-long": 2, "e2": 0, "e3": 4}

    def grant(params):
        assert params["p_actor_kind"] == "admin" and params["p_actor_id"] == "admin-1"
        eid = params["p_entitlement_id"]
        user = next(r["user_id"] for r in db.tables["entitlements"] if r["id"] == eid)
        key = f"extra:{params['p_request_key']}:{user}"  # 385: one row per key and learner
        if key in ledger:
            prior = ledger[key]
            if (prior["credits"], prior["reason"]) != (params["p_credits"], params["p_reason"].strip()):
                return {"status": "request_key_conflict"}
            return {"status": "replay", "ledger_id": prior["id"], "entitlement_id": prior["entitlement_id"],
                    "balance": balances[prior["entitlement_id"]]}
        ledger[key] = {"id": len(ledger) + 1, "entitlement_id": eid, "credits": params["p_credits"],
                       "reason": params["p_reason"].strip()}
        balances[eid] += params["p_credits"]
        return {"status": "granted", "ledger_id": ledger[key]["id"], "entitlement_id": eid, "balance": balances[eid]}

    db.handlers = {"fn_credit_grant_extra": grant}
    for module in (credits, credits.ent):
        monkeypatch.setattr(module, "supabase_admin", db)
    monkeypatch.setattr(credits, "_cohort_user_ids", lambda cohort_id: [U1, U2, U3] if cohort_id == COHORT else [])

    async def require_admin(authorization):
        if not state["admin"]:
            raise HTTPException(403, "Chỉ admin mới truy cập được.")
        return {"id": "admin-1"}

    monkeypatch.setattr(admin_commerce, "require_admin", AsyncMock(side_effect=require_admin))
    monkeypatch.setattr(admin_commerce.staff_guard, "require_recent_mfa",
                        lambda admin, authorization: state["step_up"].append(admin["id"]))
    state.update(db=db, ledger=ledger, balances=balances)
    return state


def _post(client, **body):
    return client.post("/admin/credits/grant-extra", headers=AUTH,
                       json={"credits": 5, "reason": "Bù bài chấm lỗi", "request_key": KEY, **body})


def test_class_grant_skips_a_learner_without_a_class_entitlement_and_replays(client, world):
    res = _post(client, cohort_id=COHORT)
    assert res.status_code == 200, res.text
    assert res.json() == {
        "granted": [{"user_id": U1, "entitlement_id": "e1-long", "balance": 7},
                    {"user_id": U2, "entitlement_id": "e2", "balance": 5}],
        "skipped": [{"user_id": U3, "reason": "no_class_entitlement"}],
    }
    assert world["step_up"] == ["admin-1"]  # a class grant always steps up (Q13)
    again = _post(client, cohort_id=COHORT)
    assert again.json()["granted"] == res.json()["granted"]
    assert world["balances"] == {"e1-short": 0, "e1-long": 7, "e2": 5, "e3": 4}
    assert len(world["ledger"]) == 2


def test_a_retry_after_the_chosen_entitlement_changed_replays_the_first_grant(client, world):
    first = _post(client, cohort_id=COHORT, user_ids=[U1])
    assert first.json()["granted"] == [{"user_id": U1, "entitlement_id": "e1-long", "balance": 7}]
    # A newer class term is granted before the admin retries the same request.
    world["db"].tables["entitlements"].append(_ent("e1-newer", U1, "p-class", days=200))
    world["balances"]["e1-newer"] = 0
    again = _post(client, cohort_id=COHORT, user_ids=[U1])
    assert again.json()["granted"] == first.json()["granted"]
    assert world["balances"]["e1-newer"] == 0 and len(world["ledger"]) == 1


def test_the_same_key_with_other_credits_or_reason_is_a_conflict(client, world):
    assert _post(client, cohort_id=COHORT, user_ids=[U1]).status_code == 200
    for change in ({"credits": 6}, {"reason": "Một lý do khác"}):
        res = _post(client, cohort_id=COHORT, user_ids=[U1], **change)
        assert res.status_code == 409 and res.json()["detail"]["error_code"] == "request_key_conflict"
    assert world["balances"]["e1-long"] == 7 and len(world["ledger"]) == 1


def test_a_large_class_reads_entitlements_in_lots_of_100(client, world, monkeypatch):
    members = [f"00000000-0000-4000-8000-{i:012d}" for i in range(100, 350)]
    for i, user in enumerate(members):
        world["db"].tables["entitlements"].append(_ent(f"big-{i}", user, "p-class"))
        world["balances"][f"big-{i}"] = 0
    monkeypatch.setattr(credits, "_cohort_user_ids", lambda cohort_id: members)
    lots = []
    real_in = type(world["db"].table("entitlements")).in_

    def spy(query, column, values):
        values = list(values)
        if query._table == "entitlements" and column == "user_id":
            lots.append(len(values))
        return real_in(query, column, values)

    monkeypatch.setattr(type(world["db"].table("entitlements")), "in_", spy)
    res = _post(client, cohort_id=COHORT)
    assert res.status_code == 200 and len(res.json()["granted"]) == 250
    assert lots == [100, 100, 50]


def test_a_closed_entitlement_is_not_chosen_and_an_unusable_one_is_skipped(client, world):
    for row in world["db"].tables["entitlements"]:
        if row["id"] == "e1-long":
            row["credits_closed_at"] = NOW.isoformat()
    world["db"].handlers["fn_credit_grant_extra"] = lambda params: {"status": "not_usable"} \
        if params["p_entitlement_id"] == "e2" else {"status": "granted", "ledger_id": 1, "balance": 5}
    res = _post(client, cohort_id=COHORT, user_ids=[U1, U2])
    assert res.json() == {"granted": [{"user_id": U1, "entitlement_id": "e1-short", "balance": 5}],
                          "skipped": [{"user_id": U2, "reason": "not_usable"}]}


def test_one_learner_needs_their_own_entitlement(client, world):
    res = _post(client, user_ids=[U3], entitlement_id="e3")
    assert res.status_code == 422  # not a UUID
    world["db"].tables["entitlements"].append(_ent("e0000000-0000-4000-8000-000000000003", U3, "p-online"))
    world["balances"]["e0000000-0000-4000-8000-000000000003"] = 1
    ok = _post(client, user_ids=[U3], entitlement_id="e0000000-0000-4000-8000-000000000003")
    assert ok.status_code == 200 and ok.json()["granted"][0]["balance"] == 6
    assert world["step_up"] == []  # 5 credits for one learner: no step-up
    other = _post(client, user_ids=[U1], entitlement_id="e0000000-0000-4000-8000-000000000003")
    assert other.status_code == 404 and other.json()["detail"]["error_code"] == "entitlement_not_found"


def test_more_than_fifty_credits_steps_up(client, world):
    world["db"].tables["entitlements"].append(_ent("e0000000-0000-4000-8000-000000000001", U1, "p-class"))
    world["balances"]["e0000000-0000-4000-8000-000000000001"] = 0
    assert _post(client, user_ids=[U1], entitlement_id="e0000000-0000-4000-8000-000000000001",
                 credits=50).status_code == 200
    assert world["step_up"] == []
    assert _post(client, user_ids=[U1], entitlement_id="e0000000-0000-4000-8000-000000000001", credits=51,
                 request_key="9a9a9a9a-0000-4000-8000-000000000002").status_code == 200
    assert world["step_up"] == ["admin-1"]


def test_step_up_counts_each_request_not_the_admins_running_total(client, world):
    # Andy 23/11 17:00Z: step-up is per request (Q13). Two grants of 30 by the
    # same admin add up to 60, yet neither request alone exceeds 50.
    world["db"].tables["entitlements"].append(_ent("e0000000-0000-4000-8000-000000000001", U1, "p-class"))
    world["balances"]["e0000000-0000-4000-8000-000000000001"] = 0
    for key in ("9a9a9a9a-0000-4000-8000-000000000011", "9a9a9a9a-0000-4000-8000-000000000012"):
        assert _post(client, user_ids=[U1], entitlement_id="e0000000-0000-4000-8000-000000000001",
                     credits=30, request_key=key).status_code == 200
    assert world["step_up"] == []


@pytest.mark.parametrize("body", [
    {"cohort_id": COHORT, "reason": "  "},            # no reason
    {"cohort_id": COHORT, "reason": "ab"},            # too short
    {"cohort_id": COHORT, "credits": 0},
    {"cohort_id": COHORT, "credits": 100_001},
    {"cohort_id": COHORT, "request_key": "short"},
    {"user_ids": [U1]},                               # one learner without entitlement_id
    {"user_ids": [U1, U2], "entitlement_id": "e0000000-0000-4000-8000-000000000001"},
    {"cohort_id": COHORT, "entitlement_id": "e0000000-0000-4000-8000-000000000001"},
    {"cohort_id": COHORT, "user_ids": ["not-a-uuid"]},
])
def test_invalid_requests_are_422_and_touch_nothing(client, world, body):
    res = _post(client, **body)
    assert res.status_code == 422, body
    assert world["db"].rpcs == [] and world["ledger"] == {}


def test_unknown_cohort_and_strangers(client, world):
    res = _post(client, cohort_id="c0000000-0000-0000-0000-0000000000ff")
    assert res.status_code == 404 and res.json()["detail"]["error_code"] == "cohort_not_found"
    res = _post(client, cohort_id=COHORT, user_ids=["00000000-0000-4000-8000-000000000009"])
    assert res.status_code == 422 and res.json()["detail"]["error_code"] == "not_in_cohort"
    assert world["db"].rpcs == []


def test_admin_only_and_a_db_failure_is_503(client, world, monkeypatch):
    world["admin"] = False
    assert _post(client, cohort_id=COHORT).status_code == 403
    assert world["db"].calls == [] and world["db"].rpcs == []
    world["admin"] = True

    def down(params):
        raise RuntimeError("PostgREST down")

    world["db"].handlers["fn_credit_grant_extra"] = down
    res = _post(client, cohort_id=COHORT)
    assert res.status_code == 503 and res.json()["detail"]["error_code"] == "credits_unavailable"
