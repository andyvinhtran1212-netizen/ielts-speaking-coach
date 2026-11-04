"""ADMINAAL2-0032 lot 03 (T004) — the staff guard matrix.

Runs the REAL ``require_admin`` / ``require_instructor`` (services/staff_guard.py)
and the REAL ``is_active`` lookup over an in-memory ``users`` table. Supabase
Auth is a fake that accepts only the tokens registered in ``TOKENS`` and answers
401 for anything else, the way GoTrue rejects a forged, tampered or ``alg:none``
token. Any non-``users`` table read answers 418 and is recorded, so a 418 or a
recorded table proves a request got past the guard.

Covers the Security Auditor's acceptance list (SEC-20261028-04): AAL1 → 403
``mfa_required``; AAL2 after the factor was deleted → 403; TOTP ``amr`` older
than 12 h → 403; forged / tampered / ``alg:none`` → 401; flag off → unchanged
(plus one ``admin_aal2_would_block`` warning per request).
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

import main
import routers.admin as admin_module
import routers.auth as auth_module
import routers.feedback as feedback_module
import routers.health as health_module
import routers.instructor as instructor_module
import routers.listening as listening_module
import routers.reading_student as reading_module
from config import Settings, settings
from services import activation_gate, staff_guard
from services.activation_gate import INACTIVE_DETAIL

# Collection-time clock, only for parametrize values that are far from any
# boundary. Token timestamps use time.time() when the token is built.
NOW = time.time()
HOUR = 3600

USERS = {
    "admin-active":        {"role": "admin",      "is_active": True},
    "admin-inactive":      {"role": "admin",      "is_active": False},
    "instructor-active":   {"role": "instructor", "is_active": True},
    "instructor-inactive": {"role": "instructor", "is_active": False},
    "learner-active":      {"role": "user",       "is_active": True},
    "learner-inactive":    {"role": "user",       "is_active": False},
    "target-instructor":   {"role": "instructor", "is_active": True},
}



def iso(ts: float) -> str:
    """A GoTrue factor timestamp (RFC 3339, UTC, ``Z``)."""
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


# Amendment 2 (FR-020a): the shared verified factor is 30 days old, so the
# step-up tests isolate the 15-minute rule from the 24-hour cool-off (AC12).
OLD_FACTOR_AT = iso(NOW - 30 * 24 * HOUR)
VERIFIED = [{"id": "f-1", "factor_type": "totp", "status": "verified",
             "created_at": OLD_FACTOR_AT, "updated_at": OLD_FACTOR_AT}]
UNVERIFIED = [{"id": "f-2", "factor_type": "totp", "status": "unverified"}]


def _b64(obj) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")


def jwt(claims: dict, *, alg: str = "HS256", sig: str = "c2ln") -> str:
    return f"{_b64({'alg': alg, 'typ': 'JWT'})}.{_b64(claims)}.{sig}"


def aal2_claims(uid: str, *, totp_age: float = 60, aal: str = "aal2") -> dict:
    now = time.time()
    return {
        "sub": uid, "aal": aal, "session_id": "s-1",
        "amr": [
            {"method": "totp", "timestamp": int(now - totp_age)},
            {"method": "password", "timestamp": int(now - totp_age - 30)},
        ],
    }


def aal1_claims(uid: str) -> dict:
    return {"sub": uid, "aal": "aal1", "session_id": "s-1",
            "amr": [{"method": "password", "timestamp": int(time.time() - 60)}]}


# token → GoTrue user object. Only these tokens are "accepted".
TOKENS: dict[str, dict] = {}


def accept(uid: str, claims: dict | None, *, factors=None, raw: str | None = None) -> str:
    token = raw if raw is not None else jwt(claims)
    user = {"id": uid, "email": f"{uid}@example.test", "user_metadata": {}}
    if factors is not None:
        user["factors"] = factors
    TOKENS[token] = user
    return token


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, name):
        self.db, self.name, self.uid = db, name, None

    def select(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def eq(self, col, val):
        self.uid = val
        return self

    def insert(self, row):
        self.db.inserts.append((self.name, row))
        return self

    def __getattr__(self, method):
        # The guard only uses select/eq/limit; any other builder call is a
        # handler query (e.g. the users list's .order) — the guard was passed.
        def reached(*_a, **_k):
            self.db.touched.append(f"{self.name}.{method}")
            raise HTTPException(418, f"handler reached ({self.name}.{method})")
        return reached

    def execute(self):
        if self.name != "users":
            self.db.touched.append(self.name)
            raise HTTPException(418, f"handler reached ({self.name})")
        self.db.users_reads += 1
        if self.db.fail_users_read_no is not None and self.db.users_reads == self.db.fail_users_read_no:
            raise RuntimeError("users lookup down")
        row = USERS.get(self.uid)
        return _Result([{"id": self.uid, **row}] if row else [])


class _DB:
    def __init__(self):
        self.touched: list = []
        self.inserts: list = []
        self.users_reads = 0
        self.fail_users_read_no: int | None = None  # 1 = role read, 2 = is_active read

    def table(self, name):
        # A non-users read or write is recorded (and answers 418) on execute().
        return _Query(self, name)


class _AuthResponse:
    def __init__(self, user):
        self._user = user
        self.status_code = 200 if user is not None else 401

    def json(self):
        return dict(self._user)


class _AuthClient:
    is_closed = False

    class cookies:  # noqa: N801 — mimics httpx.AsyncClient.cookies
        @staticmethod
        def clear():
            pass

    def __init__(self, calls):
        self.calls = calls

    async def get(self, _url, headers):
        token = headers["Authorization"].removeprefix("Bearer ")
        self.calls.append(token)
        return _AuthResponse(TOKENS.get(token))


@pytest.fixture
def harness(live_activation_gate, monkeypatch):
    TOKENS.clear()
    db = _DB()
    auth_calls: list = []
    for module in (admin_module, activation_gate, instructor_module, feedback_module, listening_module):
        monkeypatch.setattr(module, "supabase_admin", db)
    monkeypatch.setattr(auth_module, "_get_auth_http_client", lambda: _AuthClient(auth_calls))

    def _instructor_db_reached(_me):
        raise HTTPException(418, "handler reached (instructor_db)")

    monkeypatch.setattr(instructor_module, "instructor_db", _instructor_db_reached)
    monkeypatch.setattr(settings, "ADMIN_AAL2_ENFORCE", False)
    api = TestClient(main.app, raise_server_exceptions=False)

    class H:
        users = db
        auth = auth_calls

        @staticmethod
        def enforce(on: bool = True):
            monkeypatch.setattr(settings, "ADMIN_AAL2_ENFORCE", on)

        @staticmethod
        def get(path, token):
            return api.get(path, headers={"Authorization": f"Bearer {token}"})

    yield H
    TOKENS.clear()


def run_guard(fn, token, **kwargs):
    return asyncio.run(fn(f"Bearer {token}", **kwargs))


def denied(fn, token, **kwargs) -> HTTPException:
    with pytest.raises(HTTPException) as ei:
        run_guard(fn, token, **kwargs)
    return ei.value


def is_mfa_required(exc_or_detail, next_step: str | None = None) -> bool:
    detail = getattr(exc_or_detail, "detail", exc_or_detail)
    ok = isinstance(detail, dict) and detail.get("code") == "mfa_required"
    return ok and (next_step is None or detail.get("next_step") == next_step)


def would_block_records(caplog):
    return [r for r in caplog.records if r.getMessage().startswith(staff_guard.WOULD_BLOCK_EVENT)]


def would_block_fields(record) -> dict:
    return json.loads(record.getMessage().split(" ", 1)[1])


# ── Matrix: role × is_active × aal × flag ────────────────────────────────────

GUARDS = {"admin": admin_module.require_admin, "instructor": admin_module.require_instructor}


@pytest.mark.parametrize("enforce", [False, True])
@pytest.mark.parametrize("aal", ["aal1", "aal2"])
@pytest.mark.parametrize("uid", list(USERS))
@pytest.mark.parametrize("guard", list(GUARDS))
def test_guard_matrix(harness, guard, uid, aal, enforce):
    harness.enforce(enforce)
    claims = aal2_claims(uid) if aal == "aal2" else aal1_claims(uid)
    token = accept(uid, claims, factors=VERIFIED)
    row = USERS[uid]
    fn = GUARDS[guard]

    allowed_roles = ("admin",) if guard == "admin" else ("instructor", "admin")
    if row["role"] not in allowed_roles:
        exc = denied(fn, token)
        assert exc.status_code == 403 and not is_mfa_required(exc)
        assert exc.detail in (staff_guard.ADMIN_ROLE_DENIED, staff_guard.INSTRUCTOR_ROLE_DENIED)
    elif not row["is_active"]:
        exc = denied(fn, token)
        assert exc.status_code == 403 and exc.detail == INACTIVE_DETAIL
    elif row["role"] == "admin" and aal == "aal1" and enforce:
        exc = denied(fn, token)
        assert exc.status_code == 403 and is_mfa_required(exc, "challenge")
    else:
        # Instructors are not asked for MFA in this phase (FR-005), and with
        # the flag off an AAL1 admin keeps the phase-0 behaviour (FR-003).
        assert run_guard(fn, token)["id"] == uid
    assert harness.users.touched == []


def test_mfa_required_detail_is_the_published_contract(harness):
    harness.enforce()
    exc = denied(admin_module.require_admin, accept("admin-active", aal1_claims("admin-active"), factors=VERIFIED))
    assert exc.status_code == 403
    assert exc.detail == {
        "code": "mfa_required",
        "next_step": "challenge",
        "message": "Cần xác thực 2 bước để dùng quyền admin.",
    }


# ── Ticket acceptance (SEC-20261028-04) ──────────────────────────────────────

def test_aal1_admin_without_any_factor_is_sent_to_enroll(harness):
    harness.enforce()
    token = accept("admin-active", aal1_claims("admin-active"))  # `factors` key absent
    assert is_mfa_required(denied(admin_module.require_admin, token), "enroll")


@pytest.mark.parametrize("factors", [None, [], UNVERIFIED,
                                     [{"id": "p", "factor_type": "phone", "status": "verified"}]],
                         ids=["key-absent", "empty", "only-unverified", "non-totp"])
def test_aal2_token_whose_factor_was_deleted_is_refused(harness, factors):
    # research §9.1: an AAL2 access token keeps aal2 for up to an hour after
    # its factor is deleted; the user object then lists no verified factor.
    harness.enforce()
    token = accept("admin-active", aal2_claims("admin-active"), factors=factors)
    exc = denied(admin_module.require_admin, token)
    assert exc.status_code == 403 and is_mfa_required(exc, "enroll")


def test_totp_older_than_12h_is_refused(harness):
    harness.enforce()
    stale = accept("admin-active", aal2_claims("admin-active", totp_age=12 * HOUR + 120), factors=VERIFIED)
    exc = denied(admin_module.require_admin, stale)
    assert exc.status_code == 403 and is_mfa_required(exc, "challenge")


def test_totp_age_boundary(harness):
    harness.enforce()
    fresh = accept("admin-active", aal2_claims("admin-active", totp_age=12 * HOUR - 120), factors=VERIFIED)
    assert run_guard(admin_module.require_admin, fresh)["id"] == "admin-active"
    user = TOKENS[fresh]
    at = staff_guard.evaluate_admin_assurance
    claims = aal2_claims("admin-active", totp_age=0)
    t0 = claims["amr"][0]["timestamp"]
    bearer = f"Bearer {jwt(claims)}"
    assert at(user, bearer, now=t0 + 12 * HOUR).satisfied
    assert at(user, bearer, now=t0 + 12 * HOUR + 1).reason == "totp_expired"


@pytest.mark.parametrize("amr", [None, [], [{"method": "password", "timestamp": int(NOW)}],
                                 [{"method": "totp", "timestamp": "yesterday"}],
                                 [{"method": "totp", "timestamp": int(NOW + 48 * HOUR)}]],
                         ids=["absent", "empty", "password-only", "non-numeric", "future"])
def test_aal2_without_a_usable_totp_amr_counts_as_expired(harness, amr):
    harness.enforce()
    claims = {"sub": "admin-active", "aal": "aal2"}
    if amr is not None:
        claims["amr"] = amr
    exc = denied(admin_module.require_admin, accept("admin-active", claims, factors=VERIFIED))
    assert is_mfa_required(exc, "challenge")


def test_refresh_keeps_the_original_totp_timestamp(harness):
    # A refreshed token carries a new iat but the SAME amr totp timestamp
    # (research §9.1), so refreshing cannot extend the 12 h window.
    harness.enforce()
    claims = aal2_claims("admin-active", totp_age=13 * HOUR)
    claims["iat"] = int(time.time())
    exc = denied(admin_module.require_admin, accept("admin-active", claims, factors=VERIFIED))
    assert is_mfa_required(exc, "challenge")


@pytest.mark.parametrize("make_token", [
    # alg:none with a self-asserted aal2 payload
    lambda: jwt(aal2_claims("admin-active"), alg="none", sig=""),
    # a registered aal1 token whose payload was swapped for aal2 (tampered)
    lambda: ".".join([accept("admin-active", aal1_claims("admin-active"), factors=VERIFIED).split(".")[0],
                      _b64(aal2_claims("admin-active")),
                      "c2ln"]),
    # forged signature
    lambda: jwt(aal2_claims("admin-active"), sig="Zm9yZ2Vk"),
], ids=["alg-none", "tampered-payload", "forged-signature"])
@pytest.mark.parametrize("enforce", [False, True])
def test_forged_tampered_or_alg_none_token_is_401(harness, make_token, enforce):
    harness.enforce(enforce)
    token = make_token()
    assert token not in TOKENS
    exc = denied(admin_module.require_admin, token)
    assert exc.status_code == 401
    # Rejected before any privilege read: the payload is never trusted alone.
    assert harness.users.users_reads == 0 and harness.users.touched == []


def test_route_with_forged_aal2_token_is_401(harness):
    harness.enforce()
    resp = harness.get("/admin/users", jwt(aal2_claims("admin-active"), alg="none", sig=""))
    assert resp.status_code == 401
    assert harness.users.touched == []


@pytest.mark.parametrize("raw", ["opaque-test-token", "a.b.c", f"x.{_b64(['aal2'])}.y", "x.!!!.y"],
                         ids=["opaque", "garbage-segments", "non-object", "bad-base64"])
def test_accepted_token_with_undecodable_payload_counts_as_aal1(harness, raw):
    token = accept("admin-active", None, factors=VERIFIED, raw=raw)
    a = staff_guard.evaluate_admin_assurance(TOKENS[token], f"Bearer {token}")
    assert a.aal == "aal1" and not a.satisfied and a.next_step == "challenge"
    harness.enforce()
    assert is_mfa_required(denied(admin_module.require_admin, token), "challenge")
    harness.enforce(False)
    assert run_guard(admin_module.require_admin, token)["id"] == "admin-active"


def test_payload_of_another_subject_counts_as_aal1(harness):
    harness.enforce()
    token = accept("admin-active", aal2_claims("someone-else"), factors=VERIFIED)
    assert is_mfa_required(denied(admin_module.require_admin, token))


def test_aal2_admin_passes_both_guards(harness):
    harness.enforce()
    token = accept("admin-active", aal2_claims("admin-active"), factors=VERIFIED)
    assert run_guard(admin_module.require_admin, token)["id"] == "admin-active"
    assert run_guard(admin_module.require_instructor, token)["id"] == "admin-active"


def test_guard_returns_the_auth_user_dict_unchanged(harness):
    token = accept("admin-active", aal2_claims("admin-active"), factors=VERIFIED)
    assert run_guard(admin_module.require_admin, token) == TOKENS[token]


# ── Flag off: behaviour unchanged, one would-block warning ───────────────────

def test_flag_defaults_off():
    assert Settings(_env_file=None).ADMIN_AAL2_ENFORCE is False


@pytest.mark.parametrize("value,expected", [("false", False), ("true", True), ("0", False), ("1", True)])
def test_flag_uses_standard_boolean_parsing(monkeypatch, value, expected):
    monkeypatch.setenv("ADMIN_AAL2_ENFORCE", value)
    assert Settings(_env_file=None).ADMIN_AAL2_ENFORCE is expected


@pytest.mark.parametrize("value", ["maybe", "enforce", "flase", ""])
def test_unparseable_flag_fails_startup(monkeypatch, value):
    monkeypatch.setenv("ADMIN_AAL2_ENFORCE", value)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_flag_off_route_unchanged_and_logs_exactly_once(harness, caplog):
    token = accept("admin-active", aal1_claims("admin-active"), factors=VERIFIED)
    with caplog.at_level(logging.WARNING, logger=staff_guard.logger.name):
        resp = harness.get("/admin/users", token)
    # Past the guard into the handler (its users list query).
    assert resp.status_code != 403 and harness.users.touched == ["users.order"]
    records = would_block_records(caplog)
    assert len(records) == 1
    fields = would_block_fields(records[0])
    assert fields == {
        "event": "admin_aal2_would_block",
        "user_id": "admin-active",
        "method": "GET",
        "route": "/admin/users",
        "aal": "aal1",
        "next_step": "challenge",
        "reason": "aal1",
    }
    message = records[0].getMessage()
    assert "@" not in message and token not in message and "Bearer" not in message


def test_would_block_logs_once_per_request_even_when_checked_twice(harness, caplog):
    token = accept("admin-active", aal1_claims("admin-active"))

    async def one_request():
        ctx = staff_guard.begin_request({"method": "GET", "path": "/admin/users"})
        try:
            await admin_module.require_admin(f"Bearer {token}")
            await admin_module.require_instructor(f"Bearer {token}")
            await health_module._is_admin(f"Bearer {token}")
        finally:
            staff_guard.reset_request(ctx)

    with caplog.at_level(logging.WARNING, logger=staff_guard.logger.name):
        asyncio.run(one_request())
        asyncio.run(one_request())
    records = would_block_records(caplog)
    assert len(records) == 2  # one per request
    assert {would_block_fields(r)["next_step"] for r in records} == {"enroll"}


def test_no_would_block_for_a_satisfied_admin_or_a_non_admin(harness, caplog):
    admin = accept("admin-active", aal2_claims("admin-active"), factors=VERIFIED)
    instructor = accept("instructor-active", aal1_claims("instructor-active"))
    with caplog.at_level(logging.WARNING, logger=staff_guard.logger.name):
        run_guard(admin_module.require_admin, admin)
        run_guard(admin_module.require_instructor, instructor)
    assert would_block_records(caplog) == []


def test_enforced_denial_does_not_log_would_block(harness, caplog):
    harness.enforce()
    token = accept("admin-active", aal1_claims("admin-active"), factors=VERIFIED)
    with caplog.at_level(logging.WARNING, logger=staff_guard.logger.name):
        denied(admin_module.require_admin, token)
    assert would_block_records(caplog) == []


# ── 503 fail-closed ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("enforce", [False, True])
@pytest.mark.parametrize("fail_read", [1, 2], ids=["role-read", "is_active-read"])
@pytest.mark.parametrize("guard", list(GUARDS))
def test_lookup_failure_is_503_and_never_grants(harness, guard, fail_read, enforce):
    harness.enforce(enforce)
    harness.users.fail_users_read_no = fail_read
    token = accept("admin-active", aal2_claims("admin-active"), factors=VERIFIED)
    exc = denied(GUARDS[guard], token)
    assert exc.status_code == 503
    assert "users lookup down" not in str(exc.detail)


def test_assurance_failure_is_503_under_enforcement(harness, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("bug")

    monkeypatch.setattr(staff_guard, "evaluate_admin_assurance", boom)
    token = accept("admin-active", aal2_claims("admin-active"), factors=VERIFIED)
    harness.enforce()
    assert denied(admin_module.require_admin, token).status_code == 503
    harness.enforce(False)
    assert run_guard(admin_module.require_admin, token)["id"] == "admin-active"


def test_route_lookup_failure_is_503(harness):
    harness.enforce()
    harness.users.fail_users_read_no = 1
    resp = harness.get("/admin/users", accept("admin-active", aal2_claims("admin-active"), factors=VERIFIED))
    assert resp.status_code == 503 and harness.users.touched == []


# ── allow_aal1 is honoured only on the allow-listed route ────────────────────

def _with_route(method, path, coro_fn):
    async def go():
        ctx = staff_guard.begin_request({"method": method, "path": path})
        try:
            return await coro_fn()
        finally:
            staff_guard.reset_request(ctx)
    return asyncio.run(go())


def test_allow_aal1_on_mfa_status_admits_an_aal1_admin(harness):
    harness.enforce()
    token = accept("admin-active", aal1_claims("admin-active"))
    user = _with_route("GET", "/admin/mfa/status",
                       lambda: admin_module.require_admin(f"Bearer {token}", allow_aal1=True))
    assert user["id"] == "admin-active"


@pytest.mark.parametrize("method,path", [("GET", "/admin/users"), ("POST", "/admin/mfa/status"), ("", "")])
def test_allow_aal1_is_ignored_on_any_other_route(harness, method, path):
    harness.enforce()
    token = accept("admin-active", aal1_claims("admin-active"))
    with pytest.raises(HTTPException) as ei:
        if method:
            _with_route(method, path, lambda: admin_module.require_admin(f"Bearer {token}", allow_aal1=True))
        else:  # no request context at all
            run_guard(admin_module.require_admin, token, allow_aal1=True)
    assert is_mfa_required(ei.value)


@pytest.mark.parametrize("uid", ["admin-inactive", "instructor-active", "learner-active"])
def test_allow_aal1_still_requires_an_active_admin(harness, uid):
    harness.enforce()
    token = accept(uid, aal1_claims(uid))
    with pytest.raises(HTTPException) as ei:
        _with_route("GET", "/admin/mfa/status",
                    lambda: admin_module.require_admin(f"Bearer {token}", allow_aal1=True))
    assert ei.value.status_code == 403 and not is_mfa_required(ei.value)


# ── Soft admin checks (FR-002, Q7) ───────────────────────────────────────────

SOFT_CHECKS = [health_module._is_admin, reading_module._is_admin, listening_module._is_admin]


@pytest.mark.parametrize("soft", SOFT_CHECKS, ids=["health", "reading", "listening"])
def test_soft_checks_treat_an_aal1_admin_as_non_admin_under_enforcement(harness, soft):
    aal1 = accept("admin-active", aal1_claims("admin-active"), factors=VERIFIED)
    aal2 = accept("admin-active", aal2_claims("admin-active"), factors=VERIFIED)
    harness.enforce()
    assert asyncio.run(soft(f"Bearer {aal1}")) is False
    assert asyncio.run(soft(f"Bearer {aal2}")) is True
    harness.enforce(False)
    assert asyncio.run(soft(f"Bearer {aal1}")) is True


@pytest.mark.parametrize("enforce,uid,aal,expected", [
    (True,  "admin-active",      "aal1", False),
    (True,  "admin-active",      "aal2", True),
    (False, "admin-active",      "aal1", True),
    (True,  "admin-inactive",    "aal2", False),
    (False, "instructor-active", "aal2", False),
    (False, "learner-active",    "aal2", False),
])
def test_quota_bypass_soft_check(harness, enforce, uid, aal, expected):
    harness.enforce(enforce)
    claims = aal2_claims(uid) if aal == "aal2" else aal1_claims(uid)
    token = accept(uid, claims, factors=VERIFIED)
    assert staff_guard.holds_admin_privilege(TOKENS[token], f"Bearer {token}", db=harness.users) is expected


def test_quota_bypass_soft_check_never_raises_on_lookup_failure(harness):
    harness.users.fail_users_read_no = 1
    token = accept("admin-active", aal2_claims("admin-active"), factors=VERIFIED)
    assert staff_guard.holds_admin_privilege(TOKENS[token], f"Bearer {token}", db=harness.users) is False


# ── Impersonation (FR-005, AC1) ──────────────────────────────────────────────

def test_aal1_admin_cannot_impersonate_and_no_audit_row_is_written(harness):
    harness.enforce()
    token = accept("admin-active", aal1_claims("admin-active"), factors=VERIFIED)
    resp = harness.get("/instructor/students?as_instructor=target-instructor", token)
    assert resp.status_code == 403 and is_mfa_required(resp.json()["detail"], "challenge")
    assert harness.users.touched == [] and harness.users.inserts == []


def test_aal2_admin_impersonation_still_audited(harness):
    harness.enforce()
    token = accept("admin-active", aal2_claims("admin-active"), factors=VERIFIED)
    resp = harness.get("/instructor/students?as_instructor=target-instructor", token)
    # The fail-closed governance_audit insert is the first non-users write.
    assert resp.status_code != 403
    assert ("governance_audit", {
        "action": "impersonate", "admin_id": "admin-active",
        "target_instructor": "target-instructor", "detail": "/instructor/students",
    }) in harness.users.inserts


def test_flag_off_aal1_admin_impersonation_unchanged(harness):
    token = accept("admin-active", aal1_claims("admin-active"), factors=VERIFIED)
    harness.get("/instructor/students?as_instructor=target-instructor", token)
    assert [name for name, _ in harness.users.inserts] == ["governance_audit"]


def test_aal1_instructor_is_not_asked_for_mfa(harness):
    harness.enforce()
    resp = harness.get("/instructor/students", accept("instructor-active", aal1_claims("instructor-active")))
    assert resp.status_code != 403


# ── AC1 routes over HTTP ─────────────────────────────────────────────────────

AC1_ROUTES = [
    "/admin/users",
    "/api/admin/feedback",
    "/admin/listening/content/00000000-0000-0000-0000-000000000001",
    "/instructor/students?as_instructor=target-instructor",
]


@pytest.mark.parametrize("path", AC1_ROUTES)
def test_ac1_aal1_admin_refused_without_data(harness, path):
    harness.enforce()
    resp = harness.get(path, accept("admin-active", aal1_claims("admin-active"), factors=VERIFIED))
    assert resp.status_code == 403
    assert resp.json() == {"detail": {
        "code": "mfa_required", "next_step": "challenge",
        "message": "Cần xác thực 2 bước để dùng quyền admin.",
    }}
    assert harness.users.touched == [] and harness.users.inserts == []


@pytest.mark.parametrize("path", AC1_ROUTES)
def test_ac2_aal2_admin_reaches_the_handler(harness, path):
    harness.enforce()
    resp = harness.get(path, accept("admin-active", aal2_claims("admin-active"), factors=VERIFIED))
    assert resp.status_code != 403


def test_would_block_log_carries_the_route_template_not_the_raw_path(harness, caplog):
    token = accept("admin-active", aal1_claims("admin-active"), factors=VERIFIED)
    with caplog.at_level(logging.WARNING, logger=staff_guard.logger.name):
        harness.get("/admin/listening/content/00000000-0000-0000-0000-000000000001", token)
    [record] = would_block_records(caplog)
    assert would_block_fields(record)["route"] == "/admin/listening/content/{content_id}"


# ── Amendment 1: AAL2 max age (FR-012, spec.md AC11) ─────────────────────────

def _config_errors(caplog, name: str) -> list:
    return [r for r in caplog.records
            if r.name == "config" and r.levelno == logging.ERROR and name in r.getMessage()]


def test_aal2_max_age_defaults_to_12_hours():
    assert Settings(_env_file=None).ADMIN_AAL2_MAX_AGE_HOURS == 12
    assert staff_guard.aal2_max_age_seconds() == 12 * HOUR


def test_totp_12h_plus_1s_is_refused_under_enforcement(harness):
    harness.enforce()
    stale = accept("admin-active", aal2_claims("admin-active", totp_age=12 * HOUR + 1), factors=VERIFIED)
    exc = denied(admin_module.require_admin, stale)
    assert exc.status_code == 403 and is_mfa_required(exc, "challenge")


def test_totp_11h59m_is_allowed_under_enforcement(harness):
    harness.enforce()
    fresh = accept("admin-active", aal2_claims("admin-active", totp_age=11 * HOUR + 59 * 60), factors=VERIFIED)
    assert run_guard(admin_module.require_admin, fresh)["id"] == "admin-active"


@pytest.mark.parametrize("amr,reason", [
    (None, "totp_expired"), ([], "totp_expired"),
    ([{"method": "password", "timestamp": int(NOW)}], "totp_expired"),
    ([{"method": "totp", "timestamp": "yesterday"}], "totp_expired"),
    ([{"method": "totp", "timestamp": int(NOW + 301)}], "totp_invalid"),
], ids=["absent", "empty", "password-only", "non-numeric", "future-beyond-skew"])
def test_missing_amr_counts_as_expired_and_a_future_one_is_invalid(amr, reason):
    claims = {"sub": "admin-active", "aal": "aal2"}
    if amr is not None:
        claims["amr"] = amr
    user = {"id": "admin-active", "factors": VERIFIED}
    a = staff_guard.evaluate_admin_assurance(user, f"Bearer {jwt(claims)}", now=NOW)
    assert not a.satisfied and a.reason == reason and a.next_step == "challenge"


def test_future_amr_within_the_clock_skew_is_accepted():
    claims = {"sub": "admin-active", "aal": "aal2", "amr": [{"method": "totp", "timestamp": int(NOW) + 300}]}
    user = {"id": "admin-active", "factors": VERIFIED}
    assert staff_guard.evaluate_admin_assurance(user, f"Bearer {jwt(claims)}", now=int(NOW)).satisfied


@pytest.mark.parametrize("value", ["abc", "0", "48", "-1", "12.5", "13", "١٢"])
def test_invalid_aal2_max_age_falls_back_to_12_with_a_startup_log(monkeypatch, caplog, value):
    monkeypatch.setenv("ADMIN_AAL2_MAX_AGE_HOURS", value)
    with caplog.at_level(logging.ERROR, logger="config"):
        assert Settings(_env_file=None).ADMIN_AAL2_MAX_AGE_HOURS == 12
    assert len(_config_errors(caplog, "ADMIN_AAL2_MAX_AGE_HOURS")) == 1


@pytest.mark.parametrize("value,hours", [("1", 1), ("6", 6), (" 12 ", 12)])
def test_valid_aal2_max_age_is_used(monkeypatch, caplog, value, hours):
    monkeypatch.setenv("ADMIN_AAL2_MAX_AGE_HOURS", value)
    with caplog.at_level(logging.ERROR, logger="config"):
        assert Settings(_env_file=None).ADMIN_AAL2_MAX_AGE_HOURS == hours
    assert _config_errors(caplog, "ADMIN_AAL2_MAX_AGE_HOURS") == []


def test_a_shorter_configured_max_age_is_enforced(harness, monkeypatch):
    harness.enforce()
    monkeypatch.setattr(settings, "ADMIN_AAL2_MAX_AGE_HOURS", 6)
    token = accept("admin-active", aal2_claims("admin-active", totp_age=6 * HOUR + 1), factors=VERIFIED)
    assert is_mfa_required(denied(admin_module.require_admin, token), "challenge")


@pytest.mark.parametrize("value", [0, 48, 10**6, "12", True, None])
def test_no_max_age_value_can_widen_or_disable_the_check(monkeypatch, value):
    monkeypatch.setattr(settings, "ADMIN_AAL2_MAX_AGE_HOURS", value)
    assert staff_guard.aal2_max_age_seconds() == 12 * HOUR


def test_report_only_expired_totp_logs_one_totp_expired_line_and_succeeds(harness, caplog):
    stale = accept("admin-active", aal2_claims("admin-active", totp_age=12 * HOUR + 1), factors=VERIFIED)
    with caplog.at_level(logging.WARNING, logger=staff_guard.logger.name):
        resp = harness.get("/admin/users", stale)
    assert resp.status_code != 403 and harness.users.touched == ["users.order"]
    records = would_block_records(caplog)
    assert len(records) == 1
    assert would_block_fields(records[0])["reason"] == "totp_expired"


# ── Amendment 1: step-up (FR-020, spec.md AC12) ──────────────────────────────

def step_up_records(caplog):
    return [r for r in caplog.records if r.getMessage().startswith(staff_guard.STEP_UP_WOULD_BLOCK_EVENT)]


def _step_up(uid: str, totp_age: float, *, factors=VERIFIED):
    token = jwt(aal2_claims(uid, totp_age=totp_age))
    return staff_guard.require_recent_mfa({"id": uid, "factors": factors}, f"Bearer {token}")


@pytest.fixture
def step_up(monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_STEP_UP_ENFORCE", False)
    monkeypatch.setattr(settings, "ADMIN_STEP_UP_MINUTES", 15)

    def enforce(on: bool = True):
        monkeypatch.setattr(settings, "ADMIN_STEP_UP_ENFORCE", on)

    return enforce


def test_step_up_defaults():
    s = Settings(_env_file=None)
    assert s.ADMIN_STEP_UP_MINUTES == 15 and s.ADMIN_STEP_UP_ENFORCE is False


def test_step_up_16_minutes_is_refused_under_enforcement(step_up):
    step_up()
    with pytest.raises(HTTPException) as ei:
        _step_up("admin-active", 16 * 60)
    assert ei.value.status_code == 403
    assert ei.value.detail == {
        "code": "step_up_required", "next_step": "challenge", "max_age_seconds": 900,
        "message": "Thao tác này cần nhập lại mã xác thực 2 bước.",
    }


def test_step_up_14_minutes_passes_under_enforcement(step_up, caplog):
    step_up()
    with caplog.at_level(logging.WARNING, logger=staff_guard.logger.name):
        assert _step_up("admin-active", 14 * 60) is None
    assert step_up_records(caplog) == []


@pytest.mark.parametrize("factors,claims", [
    (VERIFIED, aal1_claims("admin-active")),                    # no fresh TOTP at all
    ([], aal2_claims("admin-active", totp_age=60)),            # factor deleted
    (VERIFIED, aal2_claims("someone-else", totp_age=60)),      # another subject's payload
    (VERIFIED, {"sub": "admin-active", "aal": "aal2"}),        # missing amr
], ids=["aal1", "no-verified-factor", "other-sub", "missing-amr"])
def test_step_up_needs_a_satisfied_second_factor(step_up, factors, claims):
    step_up()
    with pytest.raises(HTTPException) as ei:
        staff_guard.require_recent_mfa({"id": "admin-active", "factors": factors}, f"Bearer {jwt(claims)}")
    assert ei.value.detail["code"] == "step_up_required"


def test_step_up_report_only_logs_exactly_one_line_per_request(step_up, caplog):
    ctx = staff_guard.begin_request({"method": "PATCH", "path": "/admin/users/{user_id}/role"})
    try:
        with caplog.at_level(logging.WARNING, logger=staff_guard.logger.name):
            assert _step_up("admin-active", 16 * 60) is None
            assert _step_up("admin-active", 16 * 60) is None
    finally:
        staff_guard.reset_request(ctx)
    records = step_up_records(caplog)
    assert len(records) == 1
    fields = json.loads(records[0].getMessage().split(" ", 1)[1])
    assert fields["event"] == "admin_step_up_would_block"
    assert fields["route"] == "/admin/users/{user_id}/role" and fields["method"] == "PATCH"
    assert fields["reason"] == "totp_stale" and fields["max_age_seconds"] == 900
    assert 16 * 60 <= fields["totp_age_seconds"] <= 16 * 60 + 5
    assert set(fields) == {"event", "user_id", "method", "route", "aal", "reason",
                           "totp_age_seconds", "max_age_seconds"}


def test_step_up_uses_the_configured_window(step_up, monkeypatch):
    step_up()
    monkeypatch.setattr(settings, "ADMIN_STEP_UP_MINUTES", 5)
    with pytest.raises(HTTPException) as ei:
        _step_up("admin-active", 6 * 60)
    assert ei.value.detail["max_age_seconds"] == 300
    assert _step_up("admin-active", 4 * 60) is None


@pytest.mark.parametrize("value", ["abc", "0", "16", "60", "7.5"])
def test_invalid_step_up_minutes_fall_back_to_15_with_a_startup_log(monkeypatch, caplog, value):
    monkeypatch.setenv("ADMIN_STEP_UP_MINUTES", value)
    with caplog.at_level(logging.ERROR, logger="config"):
        assert Settings(_env_file=None).ADMIN_STEP_UP_MINUTES == 15
    assert len(_config_errors(caplog, "ADMIN_STEP_UP_MINUTES")) == 1


@pytest.mark.parametrize("value", [0, 16, 10**6, "15", False, None])
def test_no_step_up_minutes_value_can_widen_or_disable_the_check(monkeypatch, value):
    monkeypatch.setattr(settings, "ADMIN_STEP_UP_MINUTES", value)
    assert staff_guard.step_up_max_age_seconds() == 15 * 60


@pytest.mark.parametrize("value,expected", [("true", True), ("TRUE", True), (" True ", True),
                                            ("false", False), ("False", False), ("", False)])
def test_step_up_enforce_accepts_only_true_or_false(monkeypatch, caplog, value, expected):
    monkeypatch.setenv("ADMIN_STEP_UP_ENFORCE", value)
    with caplog.at_level(logging.ERROR, logger="config"):
        assert Settings(_env_file=None).ADMIN_STEP_UP_ENFORCE is expected
    assert _config_errors(caplog, "ADMIN_STEP_UP_ENFORCE") == []


@pytest.mark.parametrize("value", ["maybe", "1", "yes", "on", "enforce", "flase"])
def test_invalid_step_up_enforce_is_false_with_a_startup_log(monkeypatch, caplog, value):
    monkeypatch.setenv("ADMIN_STEP_UP_ENFORCE", value)
    with caplog.at_level(logging.ERROR, logger="config"):
        assert Settings(_env_file=None).ADMIN_STEP_UP_ENFORCE is False
    assert len(_config_errors(caplog, "ADMIN_STEP_UP_ENFORCE")) == 1


def test_step_up_assurance_failure_never_grants(step_up, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("bug")

    monkeypatch.setattr(staff_guard, "evaluate_admin_assurance", boom)
    step_up()
    with pytest.raises(HTTPException) as ei:
        _step_up("admin-active", 60)
    assert ei.value.status_code == 503


# ── Amendment 2: FR-012 non-finite TOTP timestamps (spec.md AC15) ────────────

NAN, INF = float("nan"), float("inf")


def _amr_claims(*stamps) -> dict:
    # json.dumps writes NaN / Infinity / -Infinity and json.loads reads them
    # back, so these reach the guard exactly as a crafted payload would.
    return {"sub": "admin-active", "aal": "aal2",
            "amr": [{"method": "totp", "timestamp": s} for s in stamps]}


def _assure(*stamps, now: float = NOW):
    user = {"id": "admin-active", "factors": VERIFIED}
    return staff_guard.evaluate_admin_assurance(user, f"Bearer {jwt(_amr_claims(*stamps))}", now=now)


@pytest.mark.parametrize("stamps", [(NAN,), (INF,), (-INF,), (NAN, INF, -INF), (10**400,)],
                         ids=["nan", "+inf", "-inf", "all-three", "int-beyond-float"])
def test_non_finite_totp_timestamp_counts_as_no_totp(stamps):
    a = _assure(*stamps)
    assert not a.satisfied and a.reason == "totp_expired" and a.next_step == "challenge"
    assert a.totp_verified_at is None


def test_nan_alone_used_to_pass_and_now_does_not():
    # Negative control for the old filter: NaN compares false with every age
    # bound, so without isfinite it fell through to "ok" (SA P3-1).
    assert not (NAN > NOW + 300) and not (NOW - NAN > 12 * HOUR)
    assert _assure(NAN).reason == "totp_expired"


@pytest.mark.parametrize("bad", [NAN, INF, -INF], ids=["nan", "+inf", "-inf"])
@pytest.mark.parametrize("order", ["bad-first", "bad-last"])
def test_only_the_finite_timestamp_counts_in_mixed_claims(bad, order):
    fresh, expired = int(NOW - 60), int(NOW - 13 * HOUR)
    pair = (bad, fresh) if order == "bad-first" else (fresh, bad)
    a = _assure(*pair)
    assert a.satisfied and a.totp_verified_at == fresh
    pair = (bad, expired) if order == "bad-first" else (expired, bad)
    a = _assure(*pair)
    assert a.reason == "totp_expired" and a.totp_verified_at == expired


@pytest.mark.parametrize("stamps,reason", [
    ((True,), "totp_expired"), ((NAN, "yesterday"), "totp_expired"),
    ((NAN, int(NOW + 301)), "totp_invalid"), ((INF, int(NOW + 300)), "ok"),
], ids=["bool", "nan+non-numeric", "nan+future-beyond-skew", "inf+future-within-skew"])
def test_existing_bool_and_skew_rules_still_apply_next_to_non_finite(stamps, reason):
    assert _assure(*stamps, now=int(NOW)).reason == reason


@pytest.mark.parametrize("bad", [NAN, INF, -INF], ids=["nan", "+inf", "-inf"])
def test_non_finite_only_is_mfa_required_under_aal2_enforcement(harness, bad):
    harness.enforce()
    exc = denied(admin_module.require_admin, accept("admin-active", _amr_claims(bad), factors=VERIFIED))
    assert exc.status_code == 403 and is_mfa_required(exc, "challenge")
    assert harness.users.touched == []


@pytest.mark.parametrize("bad", [NAN, INF, -INF], ids=["nan", "+inf", "-inf"])
def test_non_finite_only_report_only_logs_one_totp_expired_line(harness, caplog, bad):
    token = accept("admin-active", _amr_claims(bad), factors=VERIFIED)
    with caplog.at_level(logging.WARNING, logger=staff_guard.logger.name):
        resp = harness.get("/admin/users", token)
    assert resp.status_code != 403 and harness.users.touched == ["users.order"]
    records = would_block_records(caplog)
    assert len(records) == 1 and would_block_fields(records[0])["reason"] == "totp_expired"
    # No conversion error from the guard (the handler's own 418 log is the fake).
    assert [r for r in caplog.records if r.name == staff_guard.logger.name and r.levelno >= logging.ERROR] == []


@pytest.mark.parametrize("bad", [NAN, INF, -INF], ids=["nan", "+inf", "-inf"])
def test_non_finite_only_step_up_enforced_and_report_only(monkeypatch, caplog, bad):
    monkeypatch.setattr(settings, "ADMIN_AAL2_ENFORCE", False)
    monkeypatch.setattr(settings, "ADMIN_STEP_UP_MINUTES", 15)
    user = {"id": "admin-active", "factors": VERIFIED}
    bearer = f"Bearer {jwt(_amr_claims(bad))}"
    monkeypatch.setattr(settings, "ADMIN_STEP_UP_ENFORCE", True)
    with pytest.raises(HTTPException) as ei:
        staff_guard.require_recent_mfa(user, bearer)
    assert ei.value.status_code == 403 and ei.value.detail["code"] == "step_up_required"
    assert "reason" not in ei.value.detail  # old factors: not the cool-off
    monkeypatch.setattr(settings, "ADMIN_STEP_UP_ENFORCE", False)
    with caplog.at_level(logging.WARNING, logger=staff_guard.logger.name):
        assert staff_guard.require_recent_mfa(user, bearer) is None
    records = step_up_records(caplog)
    assert len(records) == 1
    fields = json.loads(records[0].getMessage().split(" ", 1)[1])
    assert fields["reason"] == "totp_expired" and fields["totp_age_seconds"] is None
    assert [r for r in caplog.records if r.levelno >= logging.ERROR] == []


# ── Amendment 2: FR-020a 24-hour new-factor cool-off (spec.md AC13) ──────────

T = 1_800_000_000.0   # fixed UTC clock for the boundary cases
DAY = 24 * HOUR


def _factor(fid: str, *, created: float, updated: float | None = None,
            status: str = "verified", factor_type: str = "totp") -> dict:
    return {"id": fid, "factor_type": factor_type, "status": status,
            "created_at": iso(created), "updated_at": iso(created if updated is None else updated)}


OLD = _factor("f-old", created=T - 30 * DAY)


@pytest.fixture
def frozen(monkeypatch):
    """ADMIN_STEP_UP_ENFORCE on, time.time() == T inside staff_guard."""
    monkeypatch.setattr(staff_guard, "time", SimpleNamespace(time=lambda: T))
    monkeypatch.setattr(settings, "ADMIN_STEP_UP_ENFORCE", True)
    monkeypatch.setattr(settings, "ADMIN_STEP_UP_MINUTES", 15)

    def enforce(on: bool = True):
        monkeypatch.setattr(settings, "ADMIN_STEP_UP_ENFORCE", on)

    return enforce


def _bearer_at(totp_at: float, *, uid: str = "admin-active", extra: dict | None = None) -> str:
    claims = {"sub": uid, "aal": "aal2", "session_id": "s-1",
              "amr": [{"method": "totp", "timestamp": int(totp_at)},
                      {"method": "password", "timestamp": int(totp_at) - 30}]}
    claims.update(extra or {})
    return f"Bearer {jwt(claims)}"


def _recent_mfa(factors, *, totp_at: float = T - 60, bearer: str | None = None):
    user = {"id": "admin-active", "email": "admin-active@example.test", "factors": factors}
    return staff_guard.require_recent_mfa(user, bearer or _bearer_at(totp_at))


def _refusal(factors, **kwargs) -> dict:
    with pytest.raises(HTTPException) as ei:
        _recent_mfa(factors, **kwargs)
    assert ei.value.status_code == 403
    return ei.value.detail


COOLOFF_DETAIL = {
    "code": "step_up_required", "next_step": "challenge", "max_age_seconds": 900,
    "reason": "new_factor_cooloff", "message": staff_guard.STEP_UP_COOLOFF_MESSAGE,
}
ALMOST = T - (DAY - 1)   # 23 h 59 m 59 s old


def test_aal1_recent_factor_step_up_does_not_disclose_cooloff(frozen, monkeypatch):
    # AAL1 can reach step-up while the ordinary admin guard is report-only.
    monkeypatch.setattr(settings, "ADMIN_AAL2_ENFORCE", False)
    claims = {"sub": "admin-active", "aal": "aal1",
              "amr": [{"method": "password", "timestamp": int(T - 60)}]}
    bearer = f"Bearer {jwt(claims)}"
    factors = [_factor("f-1", created=T - 30 * DAY, updated=T - 60)]
    detail = _refusal(factors, bearer=bearer)
    assert detail == {
        "code": "step_up_required", "next_step": "challenge", "max_age_seconds": 900,
        "message": staff_guard.STEP_UP_REQUIRED_MESSAGE,
    }
    assert "reason" not in detail
    assert staff_guard.STEP_UP_COOLOFF_REASON not in json.dumps(detail)
    assert detail["message"] != staff_guard.STEP_UP_COOLOFF_MESSAGE

    # Assurance failure must not short-circuit validation of any factor.
    factors.append({**OLD, "updated_at": "malformed"})
    with pytest.raises(HTTPException) as ei:
        _recent_mfa(factors, bearer=bearer)
    assert ei.value.status_code == 503 and ei.value.detail == staff_guard.LOOKUP_FAILED_DETAIL


def test_aal2_fresh_totp_recent_factor_step_up_keeps_cooloff(frozen):
    factors = [_factor("f-1", created=T - 30 * DAY, updated=T - 60)]
    assert _refusal(factors, totp_at=T - 60) == COOLOFF_DETAIL


@pytest.mark.parametrize("factors", [
    [_factor("f-new", created=ALMOST)],
    [_factor("f-1", created=T - 30 * DAY, updated=ALMOST)],
    [_factor("f-1", created=ALMOST, updated=T - 30 * DAY)],
    [OLD, _factor("f-backup", created=ALMOST)],
    [_factor("f-backup", created=ALMOST), OLD],
    [OLD, _factor("f-2", created=T - 30 * DAY, updated=ALMOST)],
    [_factor("f-future", created=T + HOUR)],
    [OLD, _factor("f-future", created=T - 30 * DAY, updated=T + 60)],
], ids=["single-new", "updated-recent", "created-recent", "old-then-new-backup",
        "new-backup-then-old", "old-then-updated", "future-created", "future-updated"])
def test_any_recent_verified_factor_refuses_step_up_with_a_fresh_totp(frozen, factors):
    assert _refusal(factors) == COOLOFF_DETAIL


def test_cooloff_restarts_after_factor_rename(frozen):
    # GoTrue UpdateFriendlyName bumps updated_at only (spec.md FR-020a / AC13):
    # a 30-day-old factor renamed a minute ago is a changed factor again.
    renamed = _factor("f-renamed", created=T - 30 * DAY, updated=T - 60)
    assert _refusal([renamed], totp_at=T - 60) == COOLOFF_DETAIL
    assert _refusal([OLD, renamed], totp_at=T - 60) == COOLOFF_DETAIL
    # The same factor left untouched for a full day after the rename passes.
    assert _recent_mfa([{**renamed, "updated_at": iso(T - DAY)}]) is None


def test_challenge_does_not_restart_cooloff(frozen):
    # Challenge/re-verify only advances last_challenged_at for an already
    # verified factor; its old created_at/updated_at still clear FR-020a.
    factor = _factor("f-challenged", created=T - 30 * DAY, updated=T - 2 * DAY)
    factor["last_challenged_at"] = iso(T - 60)
    assert _recent_mfa([factor], totp_at=T - 60) is None


def test_cooloff_message_explains_the_24_hour_wait():
    assert "24 giờ" in staff_guard.STEP_UP_COOLOFF_MESSAGE
    assert staff_guard.STEP_UP_COOLOFF_MESSAGE != staff_guard.STEP_UP_REQUIRED_MESSAGE


@pytest.mark.parametrize("factors", [
    [_factor("f-1", created=T - DAY)],
    [_factor("f-1", created=T - 30 * DAY, updated=T - DAY)],
    [OLD, _factor("f-2", created=T - DAY - 1)],
    [OLD],
], ids=["exactly-24h", "updated-exactly-24h", "two-old", "30-days"])
def test_factors_24_hours_old_or_older_pass_with_a_fresh_totp(frozen, factors, caplog):
    with caplog.at_level(logging.WARNING, logger=staff_guard.logger.name):
        assert _recent_mfa(factors) is None
    assert step_up_records(caplog) == []


def test_exactly_24_hours_does_not_waive_the_15_minute_rule(frozen):
    detail = _refusal([_factor("f-1", created=T - DAY)], totp_at=T - 16 * 60)
    assert detail["code"] == "step_up_required" and "reason" not in detail
    assert detail["message"] == staff_guard.STEP_UP_REQUIRED_MESSAGE


def test_one_second_short_of_24_hours_is_still_refused(frozen):
    # Paired negative control for the exact boundary above.
    assert _refusal([_factor("f-1", created=T - DAY + 1)])["reason"] == "new_factor_cooloff"


@pytest.mark.parametrize("factors", [
    [OLD, _factor("f-pending", created=T - 60, status="unverified")],
    [OLD, _factor("f-phone", created=T - 60, factor_type="phone")],
    [OLD, {"id": "f-pending", "factor_type": "totp", "status": "unverified"}],
], ids=["unverified-totp", "verified-phone", "unverified-without-timestamps"])
def test_unverified_and_non_totp_factors_do_not_start_the_cooloff(frozen, factors):
    assert _recent_mfa(factors) is None


def test_cooloff_beats_a_stale_totp(frozen):
    assert _refusal([OLD, _factor("f-new", created=T - HOUR)], totp_at=T - 16 * 60) == COOLOFF_DETAIL


@pytest.mark.parametrize("bearer", [
    _bearer_at(T - 5, extra={"iat": int(T)}),                                   # refreshed token
    f"Bearer {jwt({'sub': 'admin-active', 'aal': 'aal2', 'amr': [{'method': 'totp', 'timestamp': int(T - 3600)}, {'method': 'totp', 'timestamp': int(T - 1)}]})}",  # another challenge
], ids=["refresh", "second-challenge"])
def test_a_new_challenge_or_refresh_cannot_clear_a_recent_factor(frozen, bearer):
    # A challenge on the OLD factor also only adds a fresh amr totp entry; the
    # recent factor is still in the accepted Auth factor list.
    assert _refusal([OLD, _factor("f-new", created=T - HOUR)], bearer=bearer) == COOLOFF_DETAIL


def _bad(**overrides) -> dict:
    f = _factor("f-bad", created=T - 30 * DAY)
    for key, value in overrides.items():
        if value is ...:
            f.pop(key)
        else:
            f[key] = value
    return f


BAD_METADATA = {
    "created-missing": _bad(created_at=...),
    "updated-missing": _bad(updated_at=...),
    "created-null": _bad(created_at=None),
    "updated-empty": _bad(updated_at=" "),
    "malformed": _bad(created_at="yesterday"),
    "naive-no-offset": _bad(updated_at="2026-10-01T00:00:00"),
    "date-only": _bad(created_at="2026-10-01"),
    "number": _bad(created_at=T - 30 * DAY),
}


@pytest.mark.parametrize("bad", list(BAD_METADATA))
@pytest.mark.parametrize("order", ["bad-only", "old-first", "new-first"])
def test_unusable_verified_factor_metadata_fails_closed(frozen, caplog, bad, order):
    factors = {"bad-only": [BAD_METADATA[bad]],
               "old-first": [OLD, BAD_METADATA[bad]],
               "new-first": [_factor("f-new", created=T - 60), BAD_METADATA[bad]]}[order]
    with pytest.raises(HTTPException) as ei:
        _recent_mfa(factors)
    assert ei.value.status_code == 503 and ei.value.detail == staff_guard.LOOKUP_FAILED_DETAIL
    # Report-only keeps the existing error behaviour: logged, not granted a
    # would-block reason, request unchanged.
    frozen(False)
    caplog.clear()
    with caplog.at_level(logging.WARNING, logger=staff_guard.logger.name):
        assert _recent_mfa(factors) is None
    assert step_up_records(caplog) == []
    assert [r for r in caplog.records if "step-up check failed" in r.getMessage()]


def test_usable_metadata_control_for_the_fail_closed_cases(frozen):
    # Same factor with both timestamps usable → passes (negative control).
    assert _recent_mfa([_bad()]) is None


@pytest.mark.parametrize("totp_at", [T - 60, T - 16 * 60], ids=["fresh-totp", "stale-totp"])
def test_cooloff_report_only_logs_one_reasoned_line_and_passes(frozen, caplog, totp_at):
    frozen(False)
    ctx = staff_guard.begin_request({"method": "PATCH", "path": "/admin/users/{user_id}/role"})
    try:
        with caplog.at_level(logging.WARNING, logger=staff_guard.logger.name):
            factors = [OLD, _factor("f-new", created=T - HOUR)]
            assert _recent_mfa(factors, totp_at=totp_at) is None
            assert _recent_mfa(factors, totp_at=totp_at) is None
    finally:
        staff_guard.reset_request(ctx)
    records = step_up_records(caplog)
    assert len(records) == 1
    message = records[0].getMessage()
    fields = json.loads(message.split(" ", 1)[1])
    assert fields["reason"] == "new_factor_cooloff"
    assert set(fields) == {"event", "user_id", "method", "route", "aal", "reason",
                           "totp_age_seconds", "max_age_seconds"}
    assert "example.test" not in message and "Bearer" not in message and "eyJ" not in message


def test_cooloff_applies_only_to_step_up_not_to_the_fr001_guard(harness, monkeypatch):
    # An admin who just enrolled is a valid AAL2 admin for ordinary routes.
    harness.enforce()
    recent = [_factor("f-new", created=time.time() - 60)]
    token = accept("admin-active", aal2_claims("admin-active"), factors=recent)
    assert run_guard(admin_module.require_admin, token)["id"] == "admin-active"
    monkeypatch.setattr(settings, "ADMIN_STEP_UP_ENFORCE", True)
    with pytest.raises(HTTPException) as ei:
        staff_guard.require_recent_mfa(TOKENS[token], f"Bearer {token}")
    assert ei.value.detail["reason"] == "new_factor_cooloff"


def test_cooloff_reads_only_the_accepted_auth_user(frozen, monkeypatch):
    # No DB or GoTrue lookup: the only factor source is auth_user["factors"].
    def no_io(*_a, **_k):
        raise AssertionError("step-up must not do I/O")

    monkeypatch.setattr(admin_module, "supabase_admin", SimpleNamespace(table=no_io, rpc=no_io))
    monkeypatch.setattr(auth_module, "_get_auth_http_client", no_io)
    assert _refusal([_factor("f-new", created=T - HOUR)])["reason"] == "new_factor_cooloff"
    assert _recent_mfa([OLD]) is None
