"""COURSEACCESS-0055 FR-019 (G04-T07b): /auth/me exposes course-based Speaking access.

With ``credit_metering`` on, sessions._require_permission admits a learner whose
course entitlement includes ``speaking`` even without an access code. /auth/me
reports that as ``speaking_course_access`` so the Speaking page opens the tabs
the backend admits. ``permissions`` stays the live access-code list.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import Response

import routers.auth as auth_module
import routers.sessions as sessions_module
import services.access_code_permissions as acp
from services import credits, entitlements

_USER_ID = "00000000-0000-4000-8000-0000000000cc"


class _Result:
    def __init__(self, data):
        self.data = data


class _Builder:
    def __init__(self, row):
        self._row = row

    def select(self, *_a, **_k):
        return self

    def update(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        return _Result([self._row])


class _FakeAdmin:
    def __init__(self, row):
        self.row = row

    def table(self, _name):
        return _Builder(self.row)


def _me(monkeypatch, *, perms, metering, entitled, active=True, suspended=False):
    row = {"id": _USER_ID, "email": "c@example.com", "role": "user", "is_active": active,
           "feature_flags": {}, "last_seen_at": None, "suspended_at": "2026-11-01T00:00:00Z" if suspended else None}
    calls = {"entitlement": 0}

    async def _fake_user(_authz):
        return {"id": _USER_ID, "email": "c@example.com", "user_metadata": {}}

    def _entitled(_uid, feature):
        calls["entitlement"] += 1
        assert feature == "speaking"
        if isinstance(entitled, Exception):
            raise entitled
        return entitled

    def _metering():
        if isinstance(metering, Exception):
            raise metering
        return metering

    monkeypatch.setattr(auth_module.settings, "USE_ASYNC_DB", False, raising=False)
    monkeypatch.setattr(auth_module, "get_supabase_user", _fake_user)
    monkeypatch.setattr(auth_module, "supabase_admin", _FakeAdmin(row))
    monkeypatch.setattr(acp, "get_user_access_code_permissions_cached", lambda _uid: perms)
    monkeypatch.setattr(credits, "_metering_on", _metering)
    monkeypatch.setattr(entitlements, "has_feature_entitlement", _entitled)
    out = asyncio.run(auth_module.get_me(Response(), authorization="Bearer x"))
    return out, calls


def test_course_only_learner_gets_speaking_access_while_metering_is_on(monkeypatch):
    out, calls = _me(monkeypatch, perms=[], metering=True, entitled=True)
    assert out["speaking_course_access"] is True
    # The access-code list is not rewritten.
    assert out["permissions"] == []
    assert calls["entitlement"] == 1


def test_flag_off_never_grants_and_never_reads_entitlements(monkeypatch):
    out, calls = _me(monkeypatch, perms=[], metering=False, entitled=True)
    assert out["speaking_course_access"] is False
    assert calls["entitlement"] == 0


def test_a_full_speaking_code_holder_does_no_extra_read(monkeypatch):
    out, calls = _me(monkeypatch, perms=["practice_single", "practice_part", "practice_full"], metering=True, entitled=True)
    assert out["speaking_course_access"] is False
    assert calls["entitlement"] == 0
    out, calls = _me(monkeypatch, perms=["all"], metering=True, entitled=True)
    assert calls["entitlement"] == 0


def test_a_partial_code_holder_still_gets_the_course_modes(monkeypatch):
    out, calls = _me(monkeypatch, perms=["practice_single"], metering=True, entitled=True)
    assert out["speaking_course_access"] is True
    assert out["permissions"] == ["practice_single"]


def test_no_speaking_entitlement_is_false(monkeypatch):
    out, _ = _me(monkeypatch, perms=[], metering=True, entitled=False)
    assert out["speaking_course_access"] is False


@pytest.mark.parametrize("error", [RuntimeError("db down"), credits.CreditUnavailable("credit_metering")])
def test_read_errors_fail_closed(monkeypatch, error):
    out, _ = _me(monkeypatch, perms=[], metering=True, entitled=error)
    assert out["speaking_course_access"] is False
    out, _ = _me(monkeypatch, perms=[], metering=error, entitled=True)
    assert out["speaking_course_access"] is False


def test_inactive_or_suspended_accounts_get_nothing(monkeypatch):
    out, calls = _me(monkeypatch, perms=[], metering=True, entitled=True, active=False)
    assert out["speaking_course_access"] is False and calls["entitlement"] == 0
    out, calls = _me(monkeypatch, perms=[], metering=True, entitled=True, suspended=True)
    assert out["speaking_course_access"] is False and calls["entitlement"] == 0


def test_the_field_matches_the_session_gate(monkeypatch):
    # Same rule as sessions._require_permission's fallback, not a copy of it.
    monkeypatch.setattr(credits, "_metering_on", lambda: True)
    monkeypatch.setattr(entitlements, "has_feature_entitlement", lambda _u, _f: True)
    assert sessions_module._course_speaking_entitlement(_USER_ID) is True
