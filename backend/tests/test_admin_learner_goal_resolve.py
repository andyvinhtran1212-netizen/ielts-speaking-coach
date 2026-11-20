"""POST /admin/learners/{ref}/goal/resolve (ADMINIA-0074 FR-030; G09-T04b).

The route around ``fn_learner_goal_resolve`` (mig 452, whose SQL behaviour is
tested in test_migration_452_learner_goal_events.py). Here a fake RPC applies
the same rule to the in-memory rows, so the tests check what the route
promises: it calls the function with the chosen source and the admin, it
answers the goal read back from the rows (not the value sent), "nothing to
resolve" is 409 ``no_conflict``, and a failed or missing function is 503 with
nothing written.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from models.admin_learner_profile import GoalResolveIn
from routers import admin_learner_profile as mod
from test_admin_learner_profile import db  # noqa: F401  (fixture)
from test_admin_learners import S_LAN, S_OFFLINE, U_ADMIN, U_LAN, U_ONLY


class _Rpc:
    def __init__(self, fake, name, params):
        self.fake, self.name, self.params = fake, name, params

    def execute(self):
        self.fake.rpc_calls.append((self.name, dict(self.params)))
        if self.fake.rpc_error:
            raise RuntimeError(self.fake.rpc_error)
        p = self.params
        student = next(r for r in self.fake.rows["students"] if r["id"] == p["p_student_id"])
        user = next(r for r in self.fake.rows["users"] if r["id"] == p["p_user_id"])
        admin = (student.get("target_band"), student.get("target_date"))
        learner = (user.get("target_band"), user.get("exam_date"))
        # The same rule as the SQL function (mig 452, tested there).
        if not any(a is not None and b is not None and a != b for a, b in zip(admin, learner)):
            raise RuntimeError("{'code': 'P0001', 'message': 'no_conflict'}")
        chosen, other = (admin, learner) if p["p_use"] == "admin" else (learner, admin)
        band, day = (c if c is not None else o for c, o in zip(chosen, other))
        student.update(target_band=band, target_date=day)
        user.update(target_band=band, exam_date=day)
        return type("R", (), {"data": {"target_band": band, "target_date": day}})()


@pytest.fixture
def rpc(db):  # noqa: F811
    db.rpc_calls, db.rpc_error = [], None
    db.rpc = lambda name, params: _Rpc(db, name, params)
    return db


def _resolve(ref, use):
    return asyncio.run(mod.resolve_learner_goal(ref, GoalResolveIn(use=use), "Bearer x"))


def _conflict(db):
    """Lan's own goal differs from the admin's."""
    user = next(u for u in db.rows["users"] if u["id"] == U_LAN)
    user.update(target_band=7.5, exam_date="2027-02-01")


def test_resolve_writes_the_chosen_source_and_answers_the_goal_read_back(rpc):
    _conflict(rpc)
    out = _resolve(f"u-{U_LAN}", "learner")
    assert rpc.rpc_calls == [("fn_learner_goal_resolve", {
        "p_student_id": S_LAN, "p_user_id": U_LAN, "p_use": "learner", "p_actor": U_ADMIN})]
    assert out["goal"]["admin"] == {"target_band": 7.5, "target_date": "2027-02-01"}
    assert out["goal"]["learner"] == {"target_band": 7.5, "exam_date": "2027-02-01"}
    assert out["goal"]["conflict"] is False


def test_the_profile_ref_resolves_against_its_account(rpc):
    _conflict(rpc)
    out = _resolve(f"s-{S_LAN}", "admin")
    assert out["goal"]["learner"] == {"target_band": 7.0, "exam_date": "2027-01-10"}


def test_nothing_to_resolve_is_409_and_writes_nothing(rpc):
    # Lan's two goals already agree (fixture).
    with pytest.raises(HTTPException) as caught:
        _resolve(f"u-{U_LAN}", "admin")
    assert caught.value.status_code == 409 and caught.value.detail["code"] == "no_conflict"
    # A profile without an account, or an account without a profile, has one
    # source only: nothing is sent to the database.
    rpc.rpc_calls.clear()
    for ref in (f"s-{S_OFFLINE}", f"u-{U_ONLY}"):
        with pytest.raises(HTTPException) as caught:
            _resolve(ref, "admin")
        assert caught.value.status_code == 409
    assert rpc.rpc_calls == []


def test_a_failed_write_is_503_and_the_goals_stay(rpc):
    _conflict(rpc)
    rpc.rpc_error = "Could not find the function public.fn_learner_goal_resolve"   # 452 not applied
    with pytest.raises(HTTPException) as caught:
        _resolve(f"u-{U_LAN}", "admin")
    assert caught.value.status_code == 503 and caught.value.detail["code"] == "goal_write_failed"
    user = next(u for u in rpc.rows["users"] if u["id"] == U_LAN)
    assert (user["target_band"], user["exam_date"]) == (7.5, "2027-02-01")


def test_only_admin_or_learner_is_accepted():
    with pytest.raises(ValidationError):
        GoalResolveIn(use="both")
    with pytest.raises(ValidationError):
        GoalResolveIn(use="admin", value=9)
