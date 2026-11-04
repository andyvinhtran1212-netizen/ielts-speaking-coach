"""F07 — access codes are minted with a CSPRNG and survive collisions.

Pins:
  - format XXXX-XXXX-XXXX over the 31-char unambiguous alphabet;
  - generation never touches the `random` module (Mersenne Twister);
  - batches are unique; existing DB codes are pre-checked and avoided;
  - a Postgres 23505 on `code` regenerates and retries (bounded) at BOTH admin
    insert sites — POST /admin/access-codes/generate and _issue_code_and_assign —
    and at instructor POST /instructor/codes (CODEUNIQ-0028 FR-004);
  - a 23505 on some other column is not retried;
  - legacy 8-char codes (and new 14-char codes) still activate via /auth/activate.
"""

from __future__ import annotations

import asyncio
import random
import re
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

import routers.admin as admin_module
from services import access_code_gen
from services.access_code_gen import ALPHABET, generate_access_code, generate_unique_codes

_A = re.escape(ALPHABET)
CODE_RE = re.compile(rf"^[{_A}]{{4}}-[{_A}]{{4}}-[{_A}]{{4}}$")


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _dup_error(column: str = "code") -> APIError:
    return APIError({
        "code": "23505",
        "message": f'duplicate key value violates unique constraint "access_codes_{column}_key"',
        "details": f"Key ({column})=(X) already exists.",
        "hint": None,
    })


# ── Fake supabase: enforces .eq/.in_ on reads, scripted insert failures ──────

class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, fake, table):
        self.fake, self.table = fake, table
        self.filters: list = []
        self.write = None

    def select(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def order(self, *a, **k): return self
    def neq(self, *a, **k): return self

    def eq(self, col, val):
        self.filters.append((col, lambda v, val=val: v == val)); return self

    def in_(self, col, vals):
        self.fake.prechecks.append((self.table, list(vals)))
        self.filters.append((col, lambda v, vals=set(vals): v in vals)); return self

    def insert(self, payload): self.write = ("insert", payload); return self
    def update(self, payload): self.write = ("update", payload); return self
    def upsert(self, payload, **k): self.write = ("upsert", payload); return self

    def execute(self):
        rows = self.fake.tables.setdefault(self.table, [])
        if self.write is None:
            out = list(rows)
            for col, ok in self.filters:
                out = [r for r in out if ok(r.get(col))]
            return _Result(out)
        kind, payload = self.write
        if kind == "insert":
            self.fake.inserts.append((self.table, payload))
            failures = self.fake.insert_failures.get(self.table)
            if failures:
                raise failures.pop(0)
            batch = payload if isinstance(payload, list) else [payload]
            stored = [{**r, "id": f"{self.table}-{len(rows) + i}"} for i, r in enumerate(batch)]
            rows.extend(stored)
            return _Result(stored)
        (self.fake.updates if kind == "update" else self.fake.upserts).append((self.table, payload))
        return _Result([{}])


class _FakeSB:
    def __init__(self, tables=None, insert_failures=None):
        self.tables = tables or {}
        self.insert_failures = insert_failures or {}
        self.inserts: list = []
        self.updates: list = []
        self.upserts: list = []
        self.prechecks: list = []

    def table(self, name):
        return _Query(self, name)


def _wire_admin(monkeypatch, fake):
    async def _ok(_authz):
        return {"id": "admin-1"}
    monkeypatch.setattr(admin_module, "require_admin", _ok)
    monkeypatch.setattr(admin_module, "supabase_admin", fake)
    monkeypatch.setattr(admin_module, "_audit_entitlement", lambda *a, **k: None)


def _code_inserts(fake):
    return [p for (t, p) in fake.inserts if t == "access_codes"]


# ── Generator ────────────────────────────────────────────────────────────────

def test_alphabet_is_31_unambiguous_chars():
    assert len(ALPHABET) == len(set(ALPHABET)) == 31
    assert not set(ALPHABET) & set("0O1IL")


def test_format_matches_regex():
    for _ in range(500):
        assert CODE_RE.fullmatch(generate_access_code())
    assert CODE_RE.fullmatch(admin_module._gen_code())   # kept shim


def test_generation_does_not_use_random_module(monkeypatch):
    def _boom(*a, **k):
        raise AssertionError("access codes must not use the random module")
    monkeypatch.setattr(random, "choices", _boom)
    monkeypatch.setattr(random, "choice", _boom)
    assert CODE_RE.fullmatch(generate_access_code())
    assert CODE_RE.fullmatch(admin_module._gen_code())
    assert len(generate_unique_codes(5)) == 5


def test_admin_router_no_longer_imports_random():
    assert not hasattr(admin_module, "random")


def test_1000_codes_unique():
    codes = generate_unique_codes(1000)
    assert len(codes) == len(set(codes)) == 1000
    assert all(CODE_RE.fullmatch(c) for c in codes)


def test_unique_codes_skip_excluded(monkeypatch):
    seq = iter(["AAAA-AAAA-AAAA", "AAAA-AAAA-AAAA", "BBBB-BBBB-BBBB", "CCCC-CCCC-CCCC"])
    monkeypatch.setattr(access_code_gen, "generate_access_code", lambda: next(seq))
    assert generate_unique_codes(2, exclude={"BBBB-BBBB-BBBB"}) == ["AAAA-AAAA-AAAA", "CCCC-CCCC-CCCC"]


# ── POST /admin/access-codes/generate ────────────────────────────────────────

def _generate(count=3):
    body = admin_module.GenerateCodesRequest(count=count, permissions=["all"], code_type="mass")
    return _run(admin_module.generate_access_codes(body, authorization="Bearer x"))


def test_generate_returns_new_format_codes(monkeypatch):
    fake = _FakeSB()
    _wire_admin(monkeypatch, fake)
    out = _generate(5)
    assert out["created"] == 5 and len(set(out["codes"])) == 5
    assert all(CODE_RE.fullmatch(c) for c in out["codes"])
    assert [r["code"] for r in fake.tables["access_codes"]] == out["codes"]
    assert fake.prechecks, "existing codes must be pre-checked before insert"


def test_generate_retries_after_unique_violation(monkeypatch):
    fake = _FakeSB(insert_failures={"access_codes": [_dup_error()]})
    _wire_admin(monkeypatch, fake)
    out = _generate(3)
    first, second = _code_inserts(fake)
    assert out["created"] == 3
    assert out["codes"] == [r["code"] for r in second]
    assert not {r["code"] for r in first} & set(out["codes"]), "colliding batch must be regenerated"
    assert len(fake.tables["access_codes"]) == 3


def test_generate_avoids_codes_already_in_db(monkeypatch):
    fake = _FakeSB(tables={"access_codes": [{"id": "old", "code": "TAKE-NNNN-NNNN"}]})
    _wire_admin(monkeypatch, fake)
    seq = iter(["TAKE-NNNN-NNNN", "FREE-AAAA-AAAA", "FREE-BBBB-BBBB"])
    monkeypatch.setattr(access_code_gen, "generate_access_code", lambda: next(seq))
    out = _generate(2)
    assert out["codes"] == ["FREE-BBBB-BBBB", "FREE-AAAA-AAAA"]
    assert len(_code_inserts(fake)) == 1


def test_generate_gives_up_after_bounded_retries(monkeypatch):
    errors = [_dup_error() for _ in range(access_code_gen.MAX_INSERT_RETRIES + 1)]
    fake = _FakeSB(insert_failures={"access_codes": errors})
    _wire_admin(monkeypatch, fake)
    with pytest.raises(admin_module.HTTPException) as ei:
        _generate(1)
    assert ei.value.status_code == 500
    assert len(_code_inserts(fake)) == access_code_gen.MAX_INSERT_RETRIES + 1


def test_generate_does_not_retry_other_unique_violations(monkeypatch):
    fake = _FakeSB(insert_failures={"access_codes": [_dup_error(column="id")]})
    _wire_admin(monkeypatch, fake)
    with pytest.raises(admin_module.HTTPException):
        _generate(1)
    assert len(_code_inserts(fake)) == 1


# ── _issue_code_and_assign (/refill, /generate-and-assign, cohort add) ───────

def test_issue_code_and_assign_retries_after_unique_violation(monkeypatch):
    fake = _FakeSB(insert_failures={"access_codes": [_dup_error()]})
    _wire_admin(monkeypatch, fake)
    new_code = admin_module._issue_code_and_assign(user_id="u1", admin_id="admin-1", reason=None)
    first, second = _code_inserts(fake)
    assert isinstance(second, dict), "single-row insert keeps its object shape"
    assert CODE_RE.fullmatch(new_code["code"]) and new_code["code"] == second["code"]
    assert first["code"] != second["code"]
    assert new_code["used_by"] == "u1" and new_code["is_used"] is True
    assigns = [p for (t, p) in fake.upserts if t == "user_code_assignments"]
    assert assigns == [{**assigns[0], "code_id": new_code["id"], "user_id": "u1", "is_active": True}]


def test_refill_returns_new_format_code(monkeypatch):
    fake = _FakeSB(tables={"access_codes": [{"id": "c1", "code": "LEGACY01", "used_by": "u1",
                                             "code_type": "direct", "permissions": ["all"]}]})
    _wire_admin(monkeypatch, fake)
    out = _run(admin_module.refill_code("c1", admin_module.RefillRequest(), authorization="x"))
    assert CODE_RE.fullmatch(out["new_code"])


# ── POST /instructor/codes (CODEUNIQ-0028 FR-004) ────────────────────────────

_INST = "00000000-0000-0000-0000-0000000000cc"


def _mint(monkeypatch, fake, count=3, cohort_id=None):
    import routers.instructor as instructor_module
    import services.instructor_access as instructor_access

    async def _me(_authz, _request=None):
        return _INST
    monkeypatch.setattr(instructor_module, "_me", _me)
    monkeypatch.setattr(instructor_module, "supabase_admin", fake)    # _audit_code
    monkeypatch.setattr(instructor_access, "supabase_admin", fake)    # instructor_db
    body = instructor_module.CodeMintBody(count=count, cohort_id=cohort_id)
    return _run(instructor_module.mint_codes(None, body, authorization="Bearer x"))


def test_instructor_mint_returns_canonical_unique_codes_stamped_to_me(monkeypatch):
    fake = _FakeSB()
    out = _mint(monkeypatch, fake, count=5)
    stored = fake.tables["access_codes"]
    assert out["created"] == 5 and len(set(out["codes"])) == 5
    assert all(CODE_RE.fullmatch(c) for c in out["codes"])
    assert [r["code"] for r in stored] == out["codes"]
    assert {r["issued_by"] for r in stored} == {_INST}
    assert all(r.get("grants_role") is None for r in stored)
    assert fake.prechecks, "existing codes must be pre-checked before insert"
    audits = [p for (t, p) in fake.inserts if t == "access_code_audit"]
    assert len(audits) == 5 and {a["action"] for a in audits} == {"code_mint"}


def test_instructor_mint_retries_after_unique_violation(monkeypatch):
    fake = _FakeSB(insert_failures={"access_codes": [_dup_error()]})
    out = _mint(monkeypatch, fake, count=3)
    first, second = _code_inserts(fake)
    assert out["created"] == 3
    assert out["codes"] == [r["code"] for r in second]
    assert not {r["code"] for r in first} & set(out["codes"]), "colliding batch must be regenerated"
    assert all(r["issued_by"] == _INST for r in first + second), "every attempt goes through the accessor"
    assert len(fake.tables["access_codes"]) == 3


def test_instructor_mint_dedupes_batch_and_avoids_own_existing_codes(monkeypatch):
    fake = _FakeSB(tables={"access_codes": [{"id": "old", "code": "TAKE-NNNN-NNNN", "issued_by": _INST}]})
    seq = iter(["TAKE-NNNN-NNNN", "FREE-AAAA-AAAA", "FREE-AAAA-AAAA", "FREE-BBBB-BBBB", "FREE-CCCC-CCCC"])
    monkeypatch.setattr(access_code_gen, "generate_access_code", lambda: next(seq))
    out = _mint(monkeypatch, fake, count=2)
    assert out["codes"] == ["FREE-BBBB-BBBB", "FREE-AAAA-AAAA"]
    assert len(_code_inserts(fake)) == 1


def test_instructor_mint_precheck_stays_owner_scoped(monkeypatch):
    # The accessor scopes the pre-check to issued_by=me (no cross-tenant read);
    # another instructor's code is only caught by the insert's 23505 retry.
    fake = _FakeSB(tables={"access_codes": [{"id": "theirs", "code": "TAKE-NNNN-NNNN", "issued_by": "other"}]},
                   insert_failures={"access_codes": [_dup_error()]})
    seq = iter(["TAKE-NNNN-NNNN", "FREE-AAAA-AAAA"])
    monkeypatch.setattr(access_code_gen, "generate_access_code", lambda: next(seq))
    out = _mint(monkeypatch, fake, count=1)
    assert out["codes"] == ["FREE-AAAA-AAAA"]
    assert [p[0]["code"] for p in _code_inserts(fake)] == ["TAKE-NNNN-NNNN", "FREE-AAAA-AAAA"]


def test_instructor_mint_gives_up_after_bounded_retries(monkeypatch):
    errors = [_dup_error() for _ in range(access_code_gen.MAX_INSERT_RETRIES + 1)]
    fake = _FakeSB(insert_failures={"access_codes": errors})
    with pytest.raises(APIError):
        _mint(monkeypatch, fake, count=1)
    assert len(_code_inserts(fake)) == access_code_gen.MAX_INSERT_RETRIES + 1
    assert not fake.tables["access_codes"]


def test_instructor_mint_does_not_retry_other_unique_violations(monkeypatch):
    fake = _FakeSB(insert_failures={"access_codes": [_dup_error(column="id")]})
    with pytest.raises(APIError):
        _mint(monkeypatch, fake, count=1)
    assert len(_code_inserts(fake)) == 1


# ── /auth/activate: legacy and new codes both resolve by exact match ─────────

_UID = "00000000-0000-0000-0000-0000000000bb"


def _activate(stored_code, typed):
    fake = _FakeSB({
        "access_codes": [{
            "id": "code-1", "code": stored_code, "is_used": False, "is_revoked": False,
            "is_active": True, "permissions": ["all"], "expires_at": None,
            "grants_role": None, "intended_email": None,
        }],
        "users": [{"id": _UID, "role": "user", "is_active": False}],
        "students": [],
    })
    auth_user = {"id": _UID, "email": "student@x.com", "user_metadata": {}}
    from main import app
    with patch("routers.auth.get_supabase_user", new=AsyncMock(return_value=auth_user)), \
         patch("routers.auth.supabase_admin", fake):
        resp = TestClient(app).post("/auth/activate", headers={"Authorization": "Bearer t"},
                                    json={"access_code": typed})
    return resp, fake


@pytest.mark.parametrize("stored,typed", [
    ("AB12-CD34", "AB12-CD34"),            # legacy 8-char format
    ("AB12-CD34", "  ab12-cd34 "),          # legacy, typed lower-case with spaces
    ("K7MP-Q2XR-9HTW", "k7mp-q2xr-9htw"),   # new 14-char format
    ("ABCD-EFGH-JKMN", "  abcd-efgh-jkmn "),  # CODEUNIQ-0028 scenario 3 (FR-005)
])
def test_codes_activate(stored, typed):
    resp, fake = _activate(stored, typed)
    assert resp.status_code == 200, resp.text
    consumed = [p for (t, p) in fake.updates if t == "access_codes" and p.get("is_used") is True]
    assert consumed, "activation must consume the matched code"


def test_unknown_code_still_rejected():
    resp, _ = _activate("AB12-CD34", "AB12-CD35")
    assert resp.status_code == 400


# ── ADMINAAL2-0032 Amendment 2 (FR-020, spec.md AC14): role-granting codes ───
# A code with a normalized non-null grants_role needs step-up before any DB
# call; an ordinary code keeps the FR-001 guard only. Claims/fixtures only.

import json  # noqa: E402
import logging  # noqa: E402
import time  # noqa: E402

from fastapi import HTTPException  # noqa: E402

from config import settings  # noqa: E402
from services import staff_guard  # noqa: E402
from tests.test_staff_guard import VERIFIED, aal2_claims, iso, jwt  # noqa: E402

_EMAIL = "new-teacher@example.test"


def _recent_factor():
    at = iso(time.time() - 3600)
    return {"id": "f-new", "factor_type": "totp", "status": "verified", "created_at": at, "updated_at": at}


class _Recorder(_FakeSB):
    """Records every table() call, so 'no DB call' covers reads too."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.tables_called: list = []

    def table(self, name):
        self.tables_called.append(name)
        return super().table(name)


@pytest.fixture
def granting(monkeypatch):
    fake = _Recorder()
    audits: list = []
    state = {"factors": VERIFIED}

    async def _admin(_authz):
        return {"id": "admin-1", "email": "admin@example.test", "factors": state["factors"]}

    monkeypatch.setattr(admin_module, "require_admin", _admin)
    monkeypatch.setattr(admin_module, "supabase_admin", fake)
    monkeypatch.setattr(admin_module, "_audit_entitlement", lambda *a, **k: audits.append((a, k)))
    monkeypatch.setattr(settings, "ADMIN_STEP_UP_ENFORCE", True)
    monkeypatch.setattr(settings, "ADMIN_STEP_UP_MINUTES", 15)

    class G:
        db = fake
        audit = audits

        @staticmethod
        def factors(value):
            state["factors"] = value

        @staticmethod
        def enforce(on: bool):
            monkeypatch.setattr(settings, "ADMIN_STEP_UP_ENFORCE", on)

        @staticmethod
        def call(totp_age: float, **fields):
            body = admin_module.GenerateCodesRequest(count=2, **fields)
            bearer = f"Bearer {jwt(aal2_claims('admin-1', totp_age=totp_age))}"
            return _run(admin_module.generate_access_codes(body, authorization=bearer))

        @staticmethod
        def refused(totp_age: float, **fields) -> dict:
            with pytest.raises(HTTPException) as ei:
                G.call(totp_age, **fields)
            assert ei.value.status_code == 403, ei.value.detail
            return ei.value.detail

        @staticmethod
        def untouched():
            return fake.tables_called == [] and fake.inserts == [] and audits == []

    return G


INSTRUCTOR_CODE = {"grants_role": "instructor", "intended_email": _EMAIL}


@pytest.mark.parametrize("role", ["instructor", " INSTRUCTOR ", "Instructor"])
def test_role_code_with_a_16_minute_totp_is_refused_before_any_db_call(granting, role):
    detail = granting.refused(16 * 60, grants_role=role, intended_email=_EMAIL)
    assert detail["code"] == "step_up_required" and detail["max_age_seconds"] == 900
    assert "reason" not in detail
    assert granting.untouched()


def test_role_code_with_a_14_minute_totp_and_old_factors_is_created(granting):
    out = granting.call(14 * 60, **INSTRUCTOR_CODE)
    assert set(out) == {"created", "codes"} and out["created"] == 2 and len(out["codes"]) == 2
    stored = granting.db.tables["access_codes"]
    assert [r["code"] for r in stored] == out["codes"]
    assert {(r["grants_role"], r["intended_email"]) for r in stored} == {("instructor", _EMAIL)}
    assert len(granting.audit) == 2


def test_role_code_with_a_fresh_totp_and_a_recent_factor_is_the_cooloff_refusal(granting):
    granting.factors(VERIFIED + [_recent_factor()])
    detail = granting.refused(5, **INSTRUCTOR_CODE)
    assert detail["reason"] == "new_factor_cooloff"
    assert detail["message"] == staff_guard.STEP_UP_COOLOFF_MESSAGE
    assert granting.untouched()


@pytest.mark.parametrize("factors,totp_age,reason", [
    (VERIFIED, 16 * 60, "totp_stale"),
    (VERIFIED + [_recent_factor()], 5, "new_factor_cooloff"),
], ids=["stale", "cooloff"])
def test_report_only_role_code_is_created_with_one_would_block_line(granting, caplog, factors, totp_age, reason):
    granting.enforce(False)
    granting.factors(factors)
    with caplog.at_level(logging.WARNING, logger=staff_guard.logger.name):
        out = granting.call(totp_age, **INSTRUCTOR_CODE)
    assert out["created"] == 2
    lines = [r.getMessage() for r in caplog.records
             if r.getMessage().startswith(staff_guard.STEP_UP_WOULD_BLOCK_EVENT)]
    assert len(lines) == 1
    assert json.loads(lines[0].split(" ", 1)[1])["reason"] == reason
    assert _EMAIL not in lines[0]


@pytest.mark.parametrize("fields", [
    {}, {"grants_role": None}, {"grants_role": ""}, {"grants_role": "   "},
], ids=["omitted", "null", "empty", "whitespace"])
def test_ordinary_code_takes_no_step_up_or_cooloff(granting, monkeypatch, caplog, fields):
    # Stale TOTP AND a recent factor under enforcement: an ordinary code is
    # still created, and require_recent_mfa is never called.
    calls: list = []
    monkeypatch.setattr(staff_guard, "require_recent_mfa", lambda *a: calls.append(a))
    granting.factors(VERIFIED + [_recent_factor()])
    with caplog.at_level(logging.WARNING, logger=staff_guard.logger.name):
        out = granting.call(16 * 60, **fields)
    assert out["created"] == 2 and calls == []
    assert all("grants_role" not in r for r in granting.db.tables["access_codes"])
    assert not [r for r in caplog.records if r.getMessage().startswith(staff_guard.STEP_UP_WOULD_BLOCK_EVENT)]


def test_ordinary_code_spy_control_role_code_calls_the_step_up(granting, monkeypatch):
    # Negative control for the spy above: the same spy sees a role code.
    calls: list = []
    monkeypatch.setattr(staff_guard, "require_recent_mfa", lambda *a: calls.append(a))
    granting.call(16 * 60, **INSTRUCTOR_CODE)
    assert len(calls) == 1


def test_unsupported_role_is_guarded_first_then_keeps_the_400(granting):
    detail = granting.refused(16 * 60, grants_role="admin", intended_email=_EMAIL)
    assert detail["code"] == "step_up_required" and granting.untouched()
    with pytest.raises(HTTPException) as ei:
        granting.call(5, grants_role="admin", intended_email=_EMAIL)
    assert ei.value.status_code == 400 and "grants_role" in ei.value.detail
    assert granting.untouched()


def test_instructor_code_without_email_keeps_the_400_after_step_up(granting):
    with pytest.raises(HTTPException) as ei:
        granting.call(5, grants_role="instructor")
    assert ei.value.status_code == 400 and "intended_email" in ei.value.detail
    assert granting.untouched()


def test_a_failed_fr001_guard_never_reaches_the_step_up(granting, monkeypatch):
    calls: list = []

    async def _deny(_authz):
        raise HTTPException(403, "Bạn không có quyền truy cập trang này")

    monkeypatch.setattr(admin_module, "require_admin", _deny)
    monkeypatch.setattr(staff_guard, "require_recent_mfa", lambda *a: calls.append(a))
    with pytest.raises(HTTPException) as ei:
        granting.call(5, **INSTRUCTOR_CODE)
    assert ei.value.status_code == 403 and calls == [] and granting.untouched()


def test_generate_route_documents_the_step_up_403():
    from main import app

    op = app.openapi()["paths"]["/admin/access-codes/generate"]["post"]
    assert "403" in op["responses"]
    schemas = app.openapi()["components"]["schemas"]
    reason = schemas["StepUpRequiredDetail"]["properties"]["reason"]
    assert "new_factor_cooloff" in json.dumps(reason)
    assert "reason" not in schemas["StepUpRequiredDetail"].get("required", [])
