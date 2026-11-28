"""LEARNERCORE-0063 FR-091..FR-094 (G07-T26): the two routes an inactive
learner_v2 account may reach, on the REAL app with the REAL gate.

`GET /api/student/today` and `PATCH /auth/profile` are in
ACTIVATION_EXEMPT_ROUTES, so the router gate skips them and each handler
re-checks its caller through `activation_gate.aopen_learner_status`:

  * a users-row read failure is 503 (fail closed);
  * a suspended account is 403 `account_suspended`, flag or not;
  * an inactive account without learner_v2 gets the gate's own 403;
  * an inactive account with learner_v2 gets Today without any work block,
    and may write only onboarding_completed / target_band / exam_date.

Every other learner route still answers the gate's 403 to that account.
"""

from __future__ import annotations

import logging

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
import routers.auth as auth_module
from config import settings
from routers import student_home
from services import activation_gate, feature_flags, session_gate
from services import student_today as st
from services.activation_gate import INACTIVE_DETAIL
from services.staff_security import ACCOUNT_SUSPENDED_CODE

ACTIVE, INACTIVE, SUSPENDED, NO_ROW = "u-active", "u-inactive", "u-suspended", "u-missing"


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.payload = db, table, {}, None

    def select(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self
    def in_(self, *_a, **_k): return self
    def is_(self, *_a, **_k): return self
    def gt(self, *_a, **_k): return self
    def gte(self, *_a, **_k): return self
    def lt(self, *_a, **_k): return self
    def neq(self, *_a, **_k): return self
    def range(self, *_a, **_k): return self

    def eq(self, col, val):
        self.filters[col] = val
        return self

    def update(self, payload):
        self.payload = payload
        return self

    def execute(self):
        self.db.reads.append(self.table)
        if self.table == "users" and self.db.fail:
            raise RuntimeError("users lookup down")
        if self.table != "users":
            return _Result([])
        rows = [r for r in self.db.users if all(r.get(k) == v for k, v in self.filters.items())]
        if self.payload is not None:
            self.db.writes.append(dict(self.payload))
            for r in rows:
                r.update(self.payload)
        return _Result([dict(r) for r in rows])


class _DB:
    def __init__(self):
        self.users = [
            {"id": ACTIVE, "email": "a@x.test", "is_active": True, "feature_flags": {}},
            {"id": INACTIVE, "email": "i@x.test", "is_active": False, "feature_flags": {}},
            {"id": SUSPENDED, "email": "s@x.test", "is_active": False, "feature_flags": {},
             "suspended_at": "2026-11-20T00:00:00+00:00"},
        ]
        self.reads: list = []
        self.writes: list = []
        self.fail = False

    def table(self, name):
        return _Query(self, name)


class _AuthResponse:
    def __init__(self, user):
        self.status_code = 200
        self._user = user

    def json(self):
        return self._user


class _AuthClient:
    is_closed = False

    def __init__(self):
        class _Jar:
            def clear(self):
                pass
        self.cookies = _Jar()

    async def get(self, _url, headers):
        uid = headers["Authorization"].removeprefix("Bearer ")
        return _AuthResponse({"id": uid, "email": f"{uid}@x.test", "user_metadata": {}})


@pytest.fixture
def app(live_activation_gate, monkeypatch):
    db = _DB()
    flag = {"on": True}
    monkeypatch.setattr(settings, "USE_ASYNC_DB", False, raising=False)
    monkeypatch.setattr(activation_gate, "supabase_admin", db)
    monkeypatch.setattr(auth_module, "supabase_admin", db)
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _AuthClient())
    monkeypatch.setattr(student_home, "thread_supabase_admin", lambda: db)
    monkeypatch.setattr(feature_flags, "is_learner_v2_enabled",
                        lambda _uid, per_user=None: flag["on"])

    def no_class_read(*_a, **_k):
        raise AssertionError("an inactive account must not read class assignments")

    monkeypatch.setattr(st, "_visible_assignments_for", no_class_read)
    from services import runtime_flags
    monkeypatch.setattr(runtime_flags, "is_enabled", lambda _key, default=True, **_k: default)

    class Harness:
        users = db
        learner_v2 = flag
        api = TestClient(main.app, raise_server_exceptions=False)

        @staticmethod
        def call(method, path, uid, **kw):
            return Harness.api.request(method, path, headers={"Authorization": f"Bearer {uid}"}, **kw)

    return Harness


def _gate_403(resp):
    return resp.status_code == 403 and resp.json().get("detail") == INACTIVE_DETAIL


def _suspended_403(resp):
    detail = resp.json().get("detail")
    return resp.status_code == 403 and isinstance(detail, dict) and detail.get("code") == ACCOUNT_SUSPENDED_CODE


_WORK_TABLES = {"sessions", "writing_essays", "writing_drafts", "listening_test_attempts",
                "reading_test_attempts", "dictation_attempts", "students", "class_members"}


# ── GET /api/student/today ───────────────────────────────────────────────────


def test_inactive_learner_v2_gets_today_without_work_blocks(app):
    resp = app.call("GET", "/api/student/today", INACTIVE)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["state"] == "no_course"
    assert body["assigned"] == [] and body["resume"] == [] and body["new_results"] == []
    assert body["next_lesson"] is None and body["repeat_error"] is None
    assert body["mock_exams"] == [] and body["open_surveys"] == []
    assert body["degraded"] == []
    assert not (_WORK_TABLES & set(app.users.reads)), app.users.reads
    assert resp.headers["cache-control"] == "private, no-store"


def test_inactive_without_learner_v2_gets_the_gates_403_on_today(app):
    app.learner_v2["on"] = False
    assert _gate_403(app.call("GET", "/api/student/today", INACTIVE))
    assert _gate_403(app.call("GET", "/api/student/today", NO_ROW))


def test_suspended_is_403_account_suspended_on_today_even_with_the_flag(app):
    assert _suspended_403(app.call("GET", "/api/student/today", SUSPENDED))


def test_today_activation_read_failure_is_503(app):
    app.users.fail = True
    assert app.call("GET", "/api/student/today", INACTIVE).status_code == 503


def test_flag_read_failure_is_off(app, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("flags down")

    monkeypatch.setattr(feature_flags, "is_learner_v2_enabled", boom)
    assert _gate_403(app.call("GET", "/api/student/today", INACTIVE))


# ── PATCH /auth/profile ──────────────────────────────────────────────────────


def test_inactive_learner_v2_may_set_only_the_onboarding_fields(app):
    resp = app.call("PATCH", "/auth/profile", INACTIVE,
                    json={"onboarding_completed": True, "target_band": 6.5, "exam_date": "2027-03-14"})
    assert resp.status_code == 200, resp.text
    assert app.users.writes == [{"onboarding_completed": True, "target_band": 6.5,
                                 "exam_date": "2027-03-14"}]


@pytest.mark.parametrize("payload", [
    {"display_name": "x"},
    {"onboarding_completed": True, "self_level": "advanced"},
    {"preferred_topics": None},
])
def test_inactive_learner_v2_other_profile_fields_are_403_and_not_written(app, payload):
    assert _gate_403(app.call("PATCH", "/auth/profile", INACTIVE, json=payload))
    assert app.users.writes == []


def test_inactive_without_learner_v2_cannot_edit_profile(app):
    app.learner_v2["on"] = False
    assert _gate_403(app.call("PATCH", "/auth/profile", INACTIVE, json={"onboarding_completed": True}))
    assert app.users.writes == []


def test_suspended_cannot_edit_profile(app):
    assert _suspended_403(app.call("PATCH", "/auth/profile", SUSPENDED, json={"onboarding_completed": True}))
    assert app.users.writes == []


def test_active_account_keeps_every_profile_field(app):
    resp = app.call("PATCH", "/auth/profile", ACTIVE, json={"display_name": "Minh", "weekly_goal": 3})
    assert resp.status_code == 200, resp.text
    assert app.users.writes == [{"display_name": "Minh", "weekly_goal": 3}]


def test_profile_activation_read_failure_is_503_and_not_written(app):
    app.users.fail = True
    resp = app.call("PATCH", "/auth/profile", INACTIVE, json={"onboarding_completed": True})
    assert resp.status_code == 503 and app.users.writes == []


# ── every other learner route stays gated ────────────────────────────────────


@pytest.mark.parametrize("method,path", [
    ("POST", "/api/student/today/seen"),
    ("GET", "/api/student/home-summary"),
    ("GET", "/api/student/assigned"),
    ("GET", "/api/student/permissions"),
    ("GET", "/topics"),
])
def test_other_learner_routes_still_403_for_inactive_learner_v2(app, method, path):
    kw = {"json": {"seen_until": "2026-11-20T00:00:00Z", "seen_key": "writing:e1"}} if method == "POST" else {}
    assert _gate_403(app.call(method, path, INACTIVE, **kw))


# ── GET /auth/check-active ───────────────────────────────────────────────────


def test_check_active_reports_learner_v2(app):
    assert app.call("GET", "/auth/check-active", INACTIVE).json() == {
        "is_active": False, "suspended": False, "learner_v2_enabled": True}
    assert app.call("GET", "/auth/check-active", ACTIVE).json() == {
        "is_active": True, "suspended": False, "learner_v2_enabled": True}


def test_check_active_learner_v2_is_false_when_suspended_or_off(app):
    assert app.call("GET", "/auth/check-active", SUSPENDED).json() == {
        "is_active": False, "suspended": True, "learner_v2_enabled": False}
    app.learner_v2["on"] = False
    assert app.call("GET", "/auth/check-active", INACTIVE).json()["learner_v2_enabled"] is False


def test_check_active_flag_failure_is_false(app, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("flags down")

    monkeypatch.setattr(feature_flags, "is_learner_v2_enabled", boom)
    resp = app.call("GET", "/auth/check-active", INACTIVE)
    assert resp.status_code == 200 and resp.json()["learner_v2_enabled"] is False


# ── USE_ASYNC_DB on: same answers over the async facade ──────────────────────


def test_async_db_path_gives_the_same_answers(app, monkeypatch):
    async def aexecute(build, **_k):
        return build(app.users).execute()

    async def ais_flag(_uid, *, run, per_user=None):
        return app.learner_v2["on"]

    monkeypatch.setattr(settings, "USE_ASYNC_DB", True, raising=False)
    monkeypatch.setattr(activation_gate, "aexecute", aexecute)
    monkeypatch.setattr(feature_flags, "ais_learner_v2_enabled", ais_flag)

    import asyncio
    assert asyncio.run(activation_gate.aopen_learner_status(INACTIVE)) == activation_gate.OPEN_INACTIVE
    assert asyncio.run(activation_gate.aopen_learner_status(ACTIVE)) == activation_gate.OPEN_ACTIVE
    with pytest.raises(Exception) as suspended:
        asyncio.run(activation_gate.aopen_learner_status(SUSPENDED))
    assert suspended.value.status_code == 403
    app.learner_v2["on"] = False
    with pytest.raises(Exception) as off:
        asyncio.run(activation_gate.aopen_learner_status(INACTIVE))
    assert off.value.detail == INACTIVE_DETAIL
    app.users.fail = True
    with pytest.raises(Exception) as failed:
        asyncio.run(activation_gate.aopen_learner_status(INACTIVE))
    assert failed.value.status_code == 503

@pytest.mark.parametrize("method,path,kwargs", [
    ("GET", "/api/student/today", {}),
    ("PATCH", "/auth/profile", {"json": {"target_band": 7}}),
])
@pytest.mark.parametrize("uid", [ACTIVE, INACTIVE])
def test_open_routes_keep_the_current_session_gate(app, monkeypatch, method, path, kwargs, uid):
    calls = []

    async def check_session(user_id, authorization, user_agent):
        calls.append((user_id, authorization, user_agent))
        raise HTTPException(409, {"code": "session_not_current"})

    monkeypatch.setattr(session_gate, "ensure_current", check_session)
    response = app.call(method, path, uid, **kwargs)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "session_not_current"
    assert calls == [(uid, f"Bearer {uid}", "testclient")]
    assert not app.users.writes
    assert not (_WORK_TABLES & set(app.users.reads))


@pytest.mark.parametrize("method,path,kwargs", [
    ("GET", "/api/student/today", {}),
    ("PATCH", "/auth/profile", {"json": {"target_band": 7}}),
])
def test_inactive_open_monitor_counts_each_admitted_request(app, monkeypatch, caplog, method, path, kwargs):
    caplog.set_level(logging.INFO, logger=activation_gate.__name__)
    monkeypatch.setattr(student_home, "is_learner_v2_enabled", lambda _user_id: True)

    for _ in range(2):
        assert app.call(method, path, INACTIVE, **kwargs).status_code == 200
    assert app.call(method, path, ACTIVE, **kwargs).status_code == 200
    assert app.call(method, path, SUSPENDED, **kwargs).status_code == 403

    async def displaced(*_args):
        raise HTTPException(409, {"code": "session_not_current"})

    monkeypatch.setattr(session_gate, "ensure_current", displaced)
    assert app.call(method, path, INACTIVE, **kwargs).status_code == 409

    events = [record.getMessage() for record in caplog.records
              if record.name == activation_gate.__name__
              and record.getMessage().startswith("learner_v2_inactive_open_request ")]
    assert events == [f"learner_v2_inactive_open_request method={method} path={path} user_id={INACTIVE}"] * 2
