"""COURSEACCESS-0055 T014 (G04-T16): "Lần đăng nhập gần đây".

Reuses the single-session harness of tests/test_session_gate.py (real gate,
real activation gate, in-memory session store and direct engine) and adds an
in-memory ``learner_login_events`` table behind ``login_events.supabase_admin``
that honours UNIQUE (user_id, session_id, outcome) with ON CONFLICT DO NOTHING.
"""

from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from services import login_events, session_gate
from services.timed_work import TimedWork
from test_session_gate import CHROME_WIN, LEARNER, ADMIN, S1, S2, gate  # noqa: F401  (fixture)

IPHONE = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 "
          "(KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1")
IPAD = ("Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1")
ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"


def _token(sub, sid, amr_method=None):
    payload = {"sub": sub, "session_id": sid}
    if amr_method:
        payload["amr"] = [{"method": amr_method, "timestamp": 1763884800}]
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"eyJhbGciOiJIUzI1NiJ9.{body}.c2ln"


# ── In-memory learner_login_events ───────────────────────────────────────────

class _Res:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db):
        self.db, self.filters, self.mode, self.payload = db, [], "select", None
        self._order, self._limit = [], None

    def select(self, *_a, **_k):
        return self

    def upsert(self, row, on_conflict="", ignore_duplicates=False, **_k):
        assert on_conflict == "user_id,session_id,outcome" and ignore_duplicates
        self.mode, self.payload = "upsert", dict(row)
        return self

    def delete(self):
        self.mode = "delete"
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) == str(val))
        return self

    def in_(self, col, vals):
        self.filters.append(lambda r: r.get(col) in vals)
        return self

    def lt(self, col, val):
        self.filters.append(lambda r: r.get(col) < val)
        return self

    def order(self, col, desc=False):
        self._order.append((col, desc))
        return self

    def limit(self, n):
        self._limit = n
        return self

    def execute(self):
        db = self.db
        db.calls.append(self.mode)
        if db.fail:
            raise RuntimeError("login events down")
        if self.mode == "upsert":
            row = self.payload
            key = (row["user_id"], row["session_id"], row["outcome"])
            if any((r["user_id"], r["session_id"], r["outcome"]) == key for r in db.rows):
                return _Res([])
            db.seq += 1
            stored = {"id": db.seq, "occurred_at": db.now().isoformat(), **row}
            db.rows.append(stored)
            return _Res([stored])
        matched = [r for r in db.rows if all(f(r) for f in self.filters)]
        if self.mode == "delete":
            db.rows = [r for r in db.rows if r not in matched]
            return _Res(matched)
        for col, desc in reversed(self._order):
            matched.sort(key=lambda r: r[col], reverse=desc)
        return _Res(matched[: self._limit] if self._limit else matched)


class _EventsDB:
    def __init__(self):
        self.rows, self.calls, self.fail, self.seq = [], [], False, 0
        self.clock = datetime(2026, 11, 23, 9, 0, tzinfo=timezone.utc)

    def now(self):
        self.clock += timedelta(seconds=1)
        return self.clock

    def table(self, name):
        assert name == "learner_login_events", name
        return _Query(self)

    def outcomes(self, session=None):
        return [r["outcome"] for r in self.rows if session is None or r["session_id"] == session]


@pytest.fixture
def events(gate, monkeypatch):  # noqa: F811
    db = _EventsDB()
    monkeypatch.setattr(login_events, "supabase_admin", db)
    return db


def _call(gate, method, path, sid, ua=CHROME_WIN, amr=None, uid=LEARNER, **kw):  # noqa: F811
    headers = {"Authorization": f"Bearer {_token(uid, sid, amr)}", "User-Agent": ua}
    return gate.api.request(method, path, headers=headers, **kw)


# ── Flag off / staff ─────────────────────────────────────────────────────────

def test_flag_off_writes_nothing_and_the_api_is_disabled(gate, events, monkeypatch):  # noqa: F811
    async def _off():
        return False
    monkeypatch.setattr(session_gate, "flag_on", _off)
    _call(gate, "GET", "/topics", S1)
    _call(gate, "GET", "/api/account/session/status", S2)
    _call(gate, "POST", "/api/account/session/claim", S2)
    assert _call(gate, "GET", "/api/account/login-events", S1).json() == {"enabled": False, "items": []}
    assert events.calls == []


def test_staff_accounts_get_no_events(gate, events):  # noqa: F811
    _call(gate, "GET", "/topics", S1, uid=ADMIN)
    assert _call(gate, "GET", "/api/account/login-events", S1, uid=ADMIN).json() == {"enabled": False, "items": []}
    assert events.rows == []


# ── The six outcomes ─────────────────────────────────────────────────────────

def test_first_session_writes_one_signed_in_however_many_requests(gate, events):  # noqa: F811
    for _ in range(21):
        assert _call(gate, "GET", "/topics", S1, amr="oauth").status_code == 418
    assert events.outcomes() == ["signed_in"]
    row = events.rows[0]
    assert (row["device_kind"], row["device_label"], row["method"]) == ("desktop", "Chrome trên Windows", "google")
    # The normal (current) branch adds no login-event query at all.
    assert events.calls == ["upsert"]


def test_second_session_is_pending_once(gate, events):  # noqa: F811
    _call(gate, "GET", "/topics", S1, amr="oauth")
    for _ in range(5):
        assert _call(gate, "GET", "/api/account/session/status", S2, ua=IPHONE, amr="otp").json()["state"] == "other_device"
    assert events.outcomes(S2) == ["pending"]
    row = [r for r in events.rows if r["session_id"] == S2][0]
    assert (row["device_kind"], row["method"]) == ("phone", "email_code")


def test_claim_writes_claimed_and_displaced_with_the_old_device(gate, events):  # noqa: F811
    _call(gate, "GET", "/topics", S1, amr="oauth")
    resp = _call(gate, "POST", "/api/account/session/claim", S2, ua=IPHONE, amr="otp")
    assert resp.status_code == 200
    new = [r for r in events.rows if r["session_id"] == S2]
    old = [r for r in events.rows if r["session_id"] == S1 and r["outcome"] == "displaced"]
    assert [r["outcome"] for r in new] == ["claimed"]
    assert (new[0]["device_kind"], new[0]["method"]) == ("phone", "email_code")
    assert len(old) == 1
    # Label stored for S1 before the upsert; method and kind from S1's own sign-in.
    assert (old[0]["device_label"], old[0]["device_kind"], old[0]["method"]) == (
        "Chrome trên Windows", "desktop", "google")


def test_timed_refusal_is_one_row_however_often_it_is_seen(gate, events):  # noqa: F811
    _call(gate, "GET", "/topics", S1)
    gate.store.timed = TimedWork("Bài kiểm tra", 10)
    for _ in range(3):
        _call(gate, "GET", "/api/account/session/status", S2)
    assert _call(gate, "POST", "/api/account/session/claim", S2).status_code == 409
    assert events.outcomes(S2) == ["claim_refused_timed"]


def test_revoke_all_writes_signed_out_all(gate, events):  # noqa: F811
    _call(gate, "GET", "/topics", S1)
    assert _call(gate, "POST", "/api/account/sessions/revoke-all", S1).status_code == 200
    assert events.outcomes(S1) == ["signed_in", "signed_out_all"]


def test_a_failing_event_write_never_fails_the_request(gate, events):  # noqa: F811
    _call(gate, "GET", "/topics", S1)
    events.fail = True
    resp = _call(gate, "POST", "/api/account/session/claim", S2)
    assert resp.status_code == 200 and resp.json()["state"] == "current"
    assert _call(gate, "GET", "/topics", S2).status_code == 418


# ── API ──────────────────────────────────────────────────────────────────────

def test_api_newest_event_per_session_with_is_current(gate, events):  # noqa: F811
    _call(gate, "GET", "/topics", S1, amr="oauth")                       # S1 signed_in
    _call(gate, "GET", "/api/account/session/status", S2, ua=IPHONE)     # S2 pending
    _call(gate, "POST", "/api/account/session/claim", S2, ua=IPHONE)     # S2 claimed, S1 displaced
    body = _call(gate, "GET", "/api/account/login-events", S2, ua=IPHONE).json()
    assert body["enabled"] is True
    assert [(i["outcome"], i["is_current"]) for i in body["items"]] == [("claimed", True), ("displaced", False)]
    assert all(i["approx_location"] is None for i in body["items"])
    assert body["items"][1]["method"] == "google"
    one = _call(gate, "GET", "/api/account/login-events?limit=1", S2).json()
    assert len(one["items"]) == 1


def test_api_limit_bounds(gate, events):  # noqa: F811
    assert _call(gate, "GET", "/api/account/login-events?limit=11", S1).status_code == 422
    assert _call(gate, "GET", "/api/account/login-events?limit=0", S1).status_code == 422


def test_api_refuses_a_session_that_is_not_current(gate, events):  # noqa: F811
    _call(gate, "GET", "/topics", S1)
    resp = _call(gate, "GET", "/api/account/login-events", S2)
    assert resp.status_code == 409 and resp.json()["detail"]["error_code"] == "session_not_current"


def test_api_read_failure_is_503(gate, events):  # noqa: F811
    _call(gate, "GET", "/topics", S1)
    events.fail = True
    resp = _call(gate, "GET", "/api/account/login-events", S1)
    assert resp.status_code == 503 and resp.json()["detail"]["error_code"] == "login_events_unavailable"


# ── Pure helpers, purge, privacy ─────────────────────────────────────────────

@pytest.mark.parametrize("ua,kind", [
    (IPHONE, "phone"), (IPAD, "tablet"), (ANDROID_TABLET, "tablet"),
    ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
     "phone"),
    (CHROME_WIN, "desktop"), ("", "unknown"), (None, "unknown"), ("curl/8.4.0", "unknown"),
])
def test_device_kind_from(ua, kind):
    assert login_events.device_kind_from(ua) == kind


@pytest.mark.parametrize("claims,method", [
    ({"amr": [{"method": "oauth", "timestamp": 1}]}, "google"),
    ({"amr": [{"method": "otp", "timestamp": 1}]}, "email_code"),
    ({"amr": [{"method": "password", "timestamp": 1}]}, "unknown"),
    ({}, "unknown"), ({"amr": "oauth"}, "unknown"),
])
def test_method_from_amr(claims, method):
    assert login_events.method_from_amr(claims) == method


def test_record_never_raises_and_rejects_unknown_outcomes(monkeypatch):
    db = _EventsDB()
    monkeypatch.setattr(login_events, "supabase_admin", db)
    assert login_events.record(LEARNER, S1, "hacked") is False
    assert login_events.record(LEARNER, None, "signed_in") is False
    db.fail = True
    assert login_events.record(LEARNER, S1, "signed_in", user_agent=CHROME_WIN) is False


def test_purge_keeps_89_days_and_deletes_91(monkeypatch):
    db = _EventsDB()
    now = datetime(2026, 11, 23, tzinfo=timezone.utc)
    for sid, age in ((S1, 91), (S2, 89)):
        db.rows.append({"id": age, "user_id": LEARNER, "session_id": sid, "outcome": "signed_in",
                        "occurred_at": (now - timedelta(days=age)).isoformat()})
    assert login_events.purge_expired(90, db=db, now=now) == 1
    assert [r["session_id"] for r in db.rows] == [S2]


def test_no_address_or_location_code_path():
    backend = Path(__file__).resolve().parents[1]
    for name in ("services/login_events.py", "services/session_gate.py"):
        src = (backend / name).read_text(encoding="utf-8")
        for needle in ("client.host", "x-forwarded-for", "X-Forwarded-For"):
            assert needle not in src, (name, needle)
