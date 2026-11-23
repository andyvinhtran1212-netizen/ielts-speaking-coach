"""COURSEACCESS-0055 T009 — one active session per learner account.

The gate runs for real inside the real activation gate on main.app (Supabase
Auth replaced by an in-memory client that decodes the test token). Its data
seams (``_load``, ``_insert_first``, ``_read_row``, ``_displaced_row``,
``_timed``, ``_engine``) are replaced by an in-memory store and a fake direct
engine that records every SQL statement, so each case can say exactly which
query ran and that no DELETE ran where none may.
"""

from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
import routers.auth as auth_module
from services import activation_gate, session_gate, timed_work
from services.timed_work import TimedWork

LEARNER = "11111111-1111-1111-1111-111111111111"
ADMIN = "22222222-2222-2222-2222-222222222222"
S1 = "aaaaaaaa-0000-0000-0000-000000000001"
S2 = "aaaaaaaa-0000-0000-0000-000000000002"
CHROME_WIN = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def _token(sub: str, session_id: str | None = None) -> str:
    payload = {"sub": sub}
    if session_id is not None:
        payload["session_id"] = session_id
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"eyJhbGciOiJIUzI1NiJ9.{body}.c2ln"


# ── Fakes ────────────────────────────────────────────────────────────────────

class _Result:
    def __init__(self, scalar=None, rowcount=0):
        self._scalar, self.rowcount = scalar, rowcount

    def scalar(self):
        return self._scalar


class _Conn:
    def __init__(self, engine):
        self.engine = engine

    async def execute(self, sql, params=None):
        statement = " ".join(str(sql).split())
        self.engine.statements.append((statement, dict(params or {})))
        store = self.engine.store
        if self.engine.fail:
            raise RuntimeError("direct connection down")
        if statement.startswith("SELECT session_id::text"):
            row = store.rows.get(params["uid"])
            return _Result(scalar=row["session_id"] if row else None)
        if statement.startswith("INSERT INTO public.learner_active_sessions"):
            store.rows[params["uid"]] = {
                "session_id": params["sid"], "device_label": params["label"],
                "claimed_at": "2026-11-23T09:00:00+00:00", "revoke_pending_at": None,
                "previous_session_id": params["prev"],
                "displaced_at": "2026-11-23T09:00:00+00:00" if params["prev"] else None,
            }
            return _Result(rowcount=1)
        if statement.startswith("DELETE FROM auth.sessions"):
            uid = params["uid"]
            before = list(store.auth_sessions.get(uid, []))
            if "AND id <>" in statement:
                kept = [s for s in before if s == params["sid"]]
            elif "AND id =" in statement:
                kept = [s for s in before if s != params["sid"]]
            else:
                kept = []
            store.auth_sessions[uid] = kept
            return _Result(rowcount=len(before) - len(kept))
        if statement.startswith("DELETE FROM public.learner_active_sessions"):
            store.rows.pop(params["uid"], None)
            return _Result(rowcount=1)
        if statement.startswith("UPDATE public.learner_active_sessions SET revoke_pending_at"):
            store.rows[params["uid"]]["revoke_pending_at"] = "2026-11-23T09:05:00+00:00"
            return _Result(rowcount=1)
        raise AssertionError(f"unexpected SQL: {statement}")


class _Begin:
    def __init__(self, engine):
        self.engine = engine

    async def __aenter__(self):
        return _Conn(self.engine)

    async def __aexit__(self, *exc):
        return False


class _Engine:
    def __init__(self, store):
        self.store, self.statements, self.fail = store, [], False

    def begin(self):
        return _Begin(self)

    def deletes(self):
        return [s for s, _ in self.statements if s.startswith("DELETE FROM auth.sessions")]


class _Store:
    def __init__(self):
        self.roles = {LEARNER: "student", ADMIN: "admin"}
        self.rows: dict[str, dict] = {}
        self.auth_sessions = {LEARNER: [S1, S2], ADMIN: [S1, S2]}
        self.loads: list[str] = []
        self.inserts: list[tuple] = []
        self.load_fails = False
        self.timed: TimedWork | None = None
        self.timed_fails = False


class _AuthResponse:
    def __init__(self, user):
        self.status_code = 200 if user else 401
        self._user = user

    def json(self):
        return self._user


class _AuthClient:
    is_closed = False

    def __init__(self, store):
        self.store = store

        class _Jar:
            def clear(self):
                pass
        self.cookies = _Jar()

    async def get(self, _url, headers):
        token = headers["Authorization"].removeprefix("Bearer ")
        try:
            segment = token.split(".")[1]
            payload = json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4)))
        except Exception:
            return _AuthResponse(None)
        uid, sid = payload.get("sub"), payload.get("session_id")
        if sid is not None and sid not in self.store.auth_sessions.get(uid, []):
            return _AuthResponse(None)  # GoTrue rejects a deleted session
        return _AuthResponse({"id": uid, "email": f"{uid}@example.test"})


@pytest.fixture
def gate(live_activation_gate, live_session_gate, monkeypatch):
    store = _Store()
    engine = _Engine(store)

    async def _active(_uid):
        return True

    async def _on():
        return True

    monkeypatch.setattr(activation_gate, "alookup_is_active", _active)
    monkeypatch.setattr(session_gate, "flag_on", _on)
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _AuthClient(store))

    def _load(uid):
        store.loads.append(uid)
        if store.load_fails:
            raise RuntimeError("users lookup down")
        return store.roles.get(uid), (dict(store.rows[uid]) if uid in store.rows else None)

    def _insert_first(uid, sid, label):
        store.inserts.append((uid, sid, label))
        if uid in store.rows:
            return None
        store.rows[uid] = {"session_id": sid, "device_label": label, "claimed_at": "2026-11-23T08:00:00+00:00",
                           "revoke_pending_at": None, "previous_session_id": None, "displaced_at": None}
        return dict(store.rows[uid])

    def _displaced_row(uid, sid):
        row = store.rows.get(uid)
        if row and row.get("previous_session_id") == sid:
            return {"displaced_at": row["displaced_at"]}
        return None

    async def _timed(_uid):
        if store.timed_fails:
            raise RuntimeError("timed lookup down")
        return store.timed

    monkeypatch.setattr(session_gate, "_load", _load)
    monkeypatch.setattr(session_gate, "_insert_first", _insert_first)
    monkeypatch.setattr(session_gate, "_read_row", lambda uid: store.rows.get(uid))
    monkeypatch.setattr(session_gate, "_displaced_row", _displaced_row)
    monkeypatch.setattr(session_gate, "_timed", _timed)
    monkeypatch.setattr(session_gate, "_engine", lambda: engine)

    async def _handler_reached(*_a, **_k):
        raise HTTPException(418, "handler reached")

    monkeypatch.setattr(main, "get_supabase_user", _handler_reached)

    class Harness:
        api = TestClient(main.app, raise_server_exceptions=False)

        @staticmethod
        def call(method, path, uid, sid, **kw):
            headers = {"Authorization": f"Bearer {_token(uid, sid)}", "User-Agent": CHROME_WIN}
            return Harness.api.request(method, path, headers=headers, **kw)

        @staticmethod
        def learner_route(uid=LEARNER, sid=S1):
            return Harness.call("GET", "/topics", uid, sid)

    Harness.store, Harness.engine = store, engine
    return Harness


def _code(resp):
    detail = resp.json().get("detail")
    return detail.get("error_code") if isinstance(detail, dict) else None


# ── Flag off / roles ─────────────────────────────────────────────────────────

def test_flag_off_queries_nothing(gate, monkeypatch):
    async def _off():
        return False
    monkeypatch.setattr(session_gate, "flag_on", _off)
    gate.store.rows[LEARNER] = {"session_id": S2, "device_label": None, "claimed_at": None, "revoke_pending_at": None}
    assert gate.learner_route().status_code == 418
    assert gate.store.loads == [] and gate.engine.statements == []
    status = gate.call("GET", "/api/account/session/status", LEARNER, S1).json()
    assert status == {"enabled": False, "state": "current", "other_session": None, "timed_activity": None}
    assert gate.call("POST", "/api/account/session/claim", LEARNER, S1).json() == {
        "enabled": False, "state": "current", "revoked": 0}
    resp = gate.call("POST", "/api/account/sessions/revoke-all", LEARNER, S1)
    assert resp.status_code == 404 and _code(resp) == "single_session_disabled"
    assert gate.store.loads == [] and gate.engine.statements == []


@pytest.mark.parametrize("role", ["admin", "instructor"])
def test_staff_roles_are_never_409(gate, role):
    gate.store.roles[ADMIN] = role
    gate.store.rows[ADMIN] = {"session_id": S1, "device_label": None, "claimed_at": None, "revoke_pending_at": None}
    assert gate.learner_route(ADMIN, S2).status_code == 418
    assert gate.store.inserts == []
    assert gate.call("GET", "/api/account/session/status", ADMIN, S2).json()["enabled"] is False


# ── First and second session ─────────────────────────────────────────────────

def test_first_session_becomes_current_and_second_is_not_current(gate):
    assert gate.learner_route(sid=S1).status_code == 418
    assert gate.store.inserts == [(LEARNER, S1, "Chrome trên Windows")]
    assert gate.store.rows[LEARNER]["session_id"] == S1

    resp = gate.learner_route(sid=S2)
    assert resp.status_code == 409 and _code(resp) == "session_not_current"

    status = gate.call("GET", "/api/account/session/status", LEARNER, S2).json()
    assert status["enabled"] is True and status["state"] == "other_device"
    assert status["other_session"] == {"device_label": "Chrome trên Windows",
                                       "since": "2026-11-23T08:00:00+00:00", "approx_location": None}
    assert status["timed_activity"] is None
    # Signing in and looking at the state never deletes anything.
    assert gate.engine.statements == []
    assert gate.store.auth_sessions[LEARNER] == [S1, S2]


def test_current_session_costs_one_query_per_request(gate):
    gate.store.rows[LEARNER] = {"session_id": S1, "device_label": None, "claimed_at": None, "revoke_pending_at": None}
    assert gate.learner_route().status_code == 418
    assert gate.learner_route().status_code == 418
    assert gate.store.loads == [LEARNER, LEARNER]
    assert gate.store.inserts == []


def test_memo_skips_a_second_check_in_the_same_request(gate):
    gate.store.rows[LEARNER] = {"session_id": S1, "device_label": None, "claimed_at": None, "revoke_pending_at": None}
    import asyncio

    async def _twice():
        token = activation_gate.begin_request_memo()
        try:
            auth = f"Bearer {_token(LEARNER, S1)}"
            await session_gate.ensure_current(LEARNER, auth)
            await session_gate.ensure_current(LEARNER, auth)
        finally:
            activation_gate.reset_request_memo(token)

    asyncio.run(_twice())
    assert gate.store.loads == [LEARNER]


# ── Claim ────────────────────────────────────────────────────────────────────

def test_claim_moves_the_account_and_deletes_only_the_other_sessions(gate):
    gate.learner_route(sid=S1)
    resp = gate.call("POST", "/api/account/session/claim", LEARNER, S2)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"enabled": True, "state": "current", "revoked": 1}
    deletes = [(s, p) for s, p in gate.engine.statements if s.startswith("DELETE FROM auth.sessions")]
    assert len(deletes) == 1 and "id <> CAST(:sid AS uuid)" in deletes[0][0]
    assert deletes[0][1] == {"uid": LEARNER, "sid": S2}
    row = gate.store.rows[LEARNER]
    assert row["session_id"] == S2 and row["previous_session_id"] == S1 and row["displaced_at"]
    assert gate.store.auth_sessions[LEARNER] == [S2]
    assert gate.learner_route(sid=S2).status_code == 418


def test_old_device_gets_401_session_displaced(gate):
    gate.learner_route(sid=S1)
    gate.call("POST", "/api/account/session/claim", LEARNER, S2)
    resp = gate.learner_route(sid=S1)
    assert resp.status_code == 401
    assert resp.json()["detail"] == {"error_code": "session_displaced",
                                     "displaced_at": "2026-11-23T09:00:00+00:00"}


def test_unrelated_bad_token_keeps_the_generic_401(gate):
    gate.learner_route(sid=S1)
    gate.call("POST", "/api/account/session/claim", LEARNER, S2)
    gone = "aaaaaaaa-0000-0000-0000-0000000000ff"
    resp = gate.learner_route(sid=gone)  # never the displaced session
    assert resp.status_code == 401 and resp.json()["detail"] == "Token không hợp lệ hoặc đã hết hạn"
    resp = gate.api.get("/topics", headers={"Authorization": "Bearer not-a-jwt"})
    assert resp.status_code == 401 and resp.json()["detail"] == "Token không hợp lệ hoặc đã hết hạn"


def test_displaced_code_needs_the_flag(gate, monkeypatch):
    gate.learner_route(sid=S1)
    gate.call("POST", "/api/account/session/claim", LEARNER, S2)

    async def _off():
        return False
    monkeypatch.setattr(session_gate, "flag_on", _off)
    resp = gate.learner_route(sid=S1)
    assert resp.status_code == 401 and resp.json()["detail"] == "Token không hợp lệ hoặc đã hết hạn"


def test_claim_is_refused_during_timed_work_and_deletes_nothing(gate):
    gate.learner_route(sid=S1)
    gate.store.timed = TimedWork(title="Bài kiểm tra Unit 3", minutes_left=12)
    status = gate.call("GET", "/api/account/session/status", LEARNER, S2).json()
    assert status["state"] == "other_device_timed"
    assert status["timed_activity"] == {"title": "Bài kiểm tra Unit 3", "device_label": "Chrome trên Windows",
                                        "minutes_left": 12}
    resp = gate.call("POST", "/api/account/session/claim", LEARNER, S2)
    assert resp.status_code == 409 and _code(resp) == "timed_activity_in_progress"
    assert resp.json()["detail"]["timed_activity"]["minutes_left"] == 12
    assert gate.engine.statements == []
    assert gate.store.rows[LEARNER]["session_id"] == S1


def test_unknown_timed_state_refuses_the_claim(gate):
    gate.learner_route(sid=S1)
    gate.store.timed_fails = True
    resp = gate.call("POST", "/api/account/session/claim", LEARNER, S2)
    assert resp.status_code == 503 and _code(resp) == "session_claim_unavailable"
    assert gate.engine.statements == []
    resp = gate.call("GET", "/api/account/session/status", LEARNER, S2)
    assert resp.status_code == 503 and _code(resp) == "session_status_unavailable"


def test_claim_write_failure_is_503(gate):
    gate.learner_route(sid=S1)
    gate.engine.fail = True
    resp = gate.call("POST", "/api/account/session/claim", LEARNER, S2)
    assert resp.status_code == 503 and _code(resp) == "session_claim_unavailable"
    assert gate.store.rows[LEARNER]["session_id"] == S1


def test_claim_by_the_current_session_changes_nothing(gate):
    gate.learner_route(sid=S1)
    assert gate.call("POST", "/api/account/session/claim", LEARNER, S1).json() == {
        "enabled": True, "state": "current", "revoked": 0}
    assert gate.engine.statements == []


# ── Revoke all ───────────────────────────────────────────────────────────────

def test_revoke_all_without_timed_work_signs_out_everywhere(gate):
    gate.learner_route(sid=S1)
    resp = gate.call("POST", "/api/account/sessions/revoke-all", LEARNER, S1)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["revoked"] == 2 and body["deferred_timed"] is None and body["at"]
    assert gate.store.auth_sessions[LEARNER] == [] and LEARNER not in gate.store.rows


def test_revoke_all_keeps_the_session_in_timed_work_until_it_ends(gate):
    gate.learner_route(sid=S1)
    gate.store.timed = TimedWork(title="Thi thử", minutes_left=30)
    resp = gate.call("POST", "/api/account/sessions/revoke-all", LEARNER, S2)
    body = resp.json()
    assert resp.status_code == 200 and body["revoked"] == 1
    assert body["deferred_timed"] == {"title": "Thi thử", "device_label": "Chrome trên Windows", "minutes_left": 30}
    assert gate.store.auth_sessions[LEARNER] == [S1]          # the exam device stays signed in
    assert all("id <>" in s for s in gate.engine.deletes())
    assert gate.store.rows[LEARNER]["revoke_pending_at"]

    # Still in the exam: the device keeps working.
    assert gate.learner_route(sid=S1).status_code == 418
    # Exam over: the next request of that session signs it out.
    gate.store.timed = None
    resp = gate.learner_route(sid=S1)
    assert resp.status_code == 401 and _code(resp) == "session_revoked"
    assert gate.store.auth_sessions[LEARNER] == [] and LEARNER not in gate.store.rows


def test_revoke_all_with_unknown_timed_state_deletes_nothing(gate):
    gate.learner_route(sid=S1)
    gate.store.timed_fails = True
    resp = gate.call("POST", "/api/account/sessions/revoke-all", LEARNER, S1)
    assert resp.status_code == 503 and _code(resp) == "session_revoke_unavailable"
    assert gate.engine.statements == []


# ── Fail-open read path ──────────────────────────────────────────────────────

def test_lookup_error_lets_the_request_through(gate, caplog):
    gate.store.load_fails = True
    with caplog.at_level(logging.WARNING):
        assert gate.learner_route().status_code == 418
    assert "[session] gate_lookup_failed" in caplog.text


def test_token_without_session_id_passes_and_logs(gate, caplog):
    with caplog.at_level(logging.WARNING):
        assert gate.learner_route(sid=None).status_code == 418
    assert "[session] gate_no_session_id" in caplog.text
    assert gate.store.loads == [] and gate.store.inserts == []


def test_unreadable_flag_is_off(live_session_gate, monkeypatch):
    def _boom(*_a, **_k):
        raise RuntimeError("flags down")
    monkeypatch.setattr(session_gate.runtime_flags, "is_enabled", _boom)
    import asyncio
    assert asyncio.run(session_gate.flag_on()) is False


# ── Pure helpers ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("ua,label", [
    (CHROME_WIN, "Chrome trên Windows"),
    ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) "
     "Version/17.1 Safari/605.1.15", "Safari trên macOS"),
    ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) "
     "CriOS/120.0 Mobile/15E148 Safari/604.1", "Chrome trên iPhone"),
    ("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile "
     "Safari/537.36 EdgA/120.0", "Edge trên Android"),
    ("Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0", "Firefox trên Linux"),
    ("curl/8.4.0", None),
    ("", None),
    (None, None),
])
def test_device_label_from(ua, label):
    assert session_gate.device_label_from(ua) == label


def test_session_id_is_read_only_from_this_users_token():
    assert session_gate.session_id_of(f"Bearer {_token(LEARNER, S1)}", LEARNER) == S1
    assert session_gate.session_id_of(f"Bearer {_token(LEARNER, S1)}", ADMIN) is None
    assert session_gate.session_id_of(f"Bearer {_token(LEARNER, 'not-a-uuid')}", LEARNER) is None
    assert session_gate.session_id_of("Bearer garbage", LEARNER) is None


# ── timed_work ───────────────────────────────────────────────────────────────

class _Q:
    def __init__(self, rows, fail=False):
        self.rows, self.fail = rows, fail

    def __getattr__(self, _name):
        return lambda *_a, **_k: self

    def execute(self):
        if self.fail:
            raise RuntimeError("read failed")

        class R:
            data = self.rows
        return R()


class _DB:
    def __init__(self, tables, fail=()):
        self.tables, self.fail = tables, set(fail)

    def table(self, name):
        return _Q(self.tables.get(name, []), name in self.fail)


def _iso(delta_minutes):
    return (datetime.now(timezone.utc) + timedelta(minutes=delta_minutes)).isoformat()


def test_timed_work_class_item_and_reading(monkeypatch):
    db = _DB({
        "students": [{"id": "st-1"}],
        "class_assignment_items": [{"timed_expires_at": _iso(9.5), "class_assignments": {"title": "Quiz Unit 2"}}],
        "reading_test_attempts": [{"started_at": _iso(-10), "reading_tests": {"title": "R1", "time_limit_minutes": 60}}],
    })
    monkeypatch.setattr(timed_work, "supabase_admin", db)
    assert timed_work.class_item_work(LEARNER) == TimedWork("Quiz Unit 2", 10)
    assert timed_work.reading_attempt_work(LEARNER) == TimedWork("R1", 50)
    monkeypatch.setattr(timed_work, "mock_exam_work", lambda _uid: None)
    assert timed_work.active_timed_work(LEARNER) == TimedWork("Quiz Unit 2", 10)


def test_timed_work_ignores_finished_work(monkeypatch):
    db = _DB({
        "students": [{"id": "st-1"}],
        "class_assignment_items": [{"timed_expires_at": _iso(-1), "class_assignments": {"title": "Old"}}],
        "reading_test_attempts": [{"started_at": _iso(-61), "reading_tests": {"title": "R1", "time_limit_minutes": 60}}],
        "mock_exam_sittings": [],
    })
    monkeypatch.setattr(timed_work, "supabase_admin", db)
    assert timed_work.active_timed_work(LEARNER) is None


def test_timed_work_raises_on_any_lookup_error(monkeypatch):
    monkeypatch.setattr(timed_work, "supabase_admin", _DB({}, fail={"mock_exam_sittings"}))
    with pytest.raises(RuntimeError):
        timed_work.active_timed_work(LEARNER)
    monkeypatch.setattr(timed_work, "supabase_admin", _DB({"students": [{"id": "s"}]}, fail={"class_assignment_items"}))
    monkeypatch.setattr(timed_work, "mock_exam_work", lambda _uid: None)
    with pytest.raises(RuntimeError):
        timed_work.active_timed_work(LEARNER)


def test_timed_work_mock_exam_section_clock(monkeypatch):
    sitting = {"id": "sit-1", "mock_exam_id": "ex-1", "status": "lrw_in_progress",
               "listening_submitted_at": _iso(-20)}
    exam = {"id": "ex-1", "title": "Mock tháng 11", "exam_mode": "sequential",
            "listening_test_id": "lt", "reading_test_id": "rt", "reading_minutes": 60,
            "reading_started_at": _iso(-15)}
    monkeypatch.setattr(timed_work, "supabase_admin", _DB({"mock_exam_sittings": [sitting], "mock_exams": [exam]}))
    monkeypatch.setattr(timed_work.mock_exam_service, "_listening_audio_duration_seconds", lambda _t: 1800)
    work = timed_work.mock_exam_work(LEARNER)
    assert work is not None and work.title == "Mock tháng 11" and 44 <= work.minutes_left <= 46
