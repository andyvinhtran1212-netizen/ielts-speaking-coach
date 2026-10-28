"""W-03 round 2 — findings from the Security Auditor's live staging probe.

(1) The activation 403 comes BEFORE any resource/id lookup: an inactive
    account probing with a nonexistent id must get "Tài khoản chưa được kích
    hoạt", never the 404 / student-link 403 that would leak which ids exist —
    and the lookup, DB and grader must not run at all.
(2) GET /api/student/permissions: an inactive account holding ['all'] is
    refused by the gate, and the permission helper itself answers all-false
    for it, so no other caller can leak an unactivated grant.
(3) The learner GETs the probe found open are gated (inactive → 403,
    active → 200).

Reuses the live-gate harness of tests/test_activation_gate.py.
"""

from __future__ import annotations

import pytest

from services import access_code_permissions as acp
from services import activation_gate
from tests.test_activation_gate import ACTIVE, INACTIVE, _inactive, gate  # noqa: F401 — fixture

FAKE_ID = "27a8d069-58d2-4b01-9be0-9d62d3dd05cd"


class _Tripwire:
    """Records a call, then answers what a nonexistent id would (404)."""

    def __init__(self):
        self.calls = 0

    def __call__(self, *_a, **_k):
        from fastapi import HTTPException
        self.calls += 1
        raise HTTPException(404, "lookup reached")


class _AsyncTripwire(_Tripwire):
    async def __call__(self, *a, **k):  # type: ignore[override]
        return super().__call__(*a, **k)


class _DBTripwire:
    """Any table access is recorded — the handler reached the database."""

    def __init__(self):
        self.tables: list[str] = []

    def table(self, name):
        self.tables.append(name)
        raise AssertionError(f"DB touched: {name}")


# (endpoint, patch target replaced by a lookup tripwire, json body)
PRE_LOOKUP = [
    ("POST", "/tts", "routers.tts._load_owned_session",
     {"text": "Describe your hometown", "session_id": FAKE_ID}),
    ("POST", "/api/listening/attempts", "routers.listening._resolve_attempt_target",
     {"mode": "gist", "content_id": FAKE_ID, "user_transcript": "the gist"}),
    ("POST", "/api/quiz/course/writing", "services.quiz_service.submit_course_writing",
     {"bank_id": FAKE_ID, "answers": {"q1": "An answer."}}),
    ("POST", f"/api/writing/my-assignments/{FAKE_ID}/submit",
     "routers.writing_student.fetch_linked_student", {"essay_text": "An essay."}),
]
_DB_MODULES = ["routers.tts", "routers.listening", "routers.writing_student", "services.quiz_service"]


@pytest.fixture
def tripwires(monkeypatch):
    dbs = {}
    for mod in _DB_MODULES:
        dbs[mod] = _DBTripwire()
        monkeypatch.setattr(f"{mod}.supabase_admin", dbs[mod])

    def _arm(target):
        wire = _AsyncTripwire() if target.endswith("submit_course_writing") else _Tripwire()
        monkeypatch.setattr(target, wire)
        return wire

    return dbs, _arm


@pytest.mark.parametrize("method,path,target,body", PRE_LOOKUP)
def test_inactive_account_gets_activation_403_for_a_nonexistent_id(gate, tripwires, method, path, target, body):
    dbs, arm = tripwires
    lookup = arm(target)
    resp = gate.call(method, path, INACTIVE, json=body)
    assert _inactive(resp), (resp.status_code, resp.text)
    assert lookup.calls == 0                                  # no id lookup / grader
    assert all(not db.tables for db in dbs.values())          # no handler DB access
    assert gate.users.lookups == [{"id": INACTIVE}]           # only the activation read


@pytest.mark.parametrize("method,path,target,body", PRE_LOOKUP)
def test_active_account_reaches_the_lookup(gate, tripwires, method, path, target, body):
    _dbs, arm = tripwires
    lookup = arm(target)
    resp = gate.call(method, path, ACTIVE, json=body)
    # The handler's own lookup answers (get_current_student maps a lookup
    # error to 500); what matters is that it ran and the gate did not refuse.
    assert lookup.calls == 1, (resp.status_code, resp.text)
    assert not _inactive(resp)


def test_tts_checks_activation_before_loading_the_session(gate, monkeypatch):
    """Defence in depth inside the handler: even if the router gate were
    skipped, the activation check precedes _load_owned_session."""
    import asyncio
    from fastapi import HTTPException
    from routers import tts

    async def _user(_authorization):
        return {"id": INACTIVE}

    lookup = _Tripwire()
    monkeypatch.setattr(tts, "get_supabase_user", _user)
    monkeypatch.setattr(tts, "_load_owned_session", lookup)
    monkeypatch.setattr(tts, "_throttle_ip", lambda _r: None)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(tts.text_to_speech(tts.TTSRequest(text="hi", session_id=FAKE_ID), "Bearer x", None))
    assert ei.value.status_code == 403 and ei.value.detail == activation_gate.INACTIVE_DETAIL
    assert lookup.calls == 0


# ── (2) /api/student/permissions ─────────────────────────────────────────────

_ALL_FALSE = {
    "writing": False,
    "speaking_practice_single": False,
    "speaking_practice_part": False,
    "speaking_practice_full": False,
    "is_admin_override": False,
}
_ALL_TRUE = {k: True for k in _ALL_FALSE}


@pytest.fixture
def holds_all(monkeypatch):
    monkeypatch.setattr(acp, "get_user_access_code_permissions", lambda _uid: ["all"])
    monkeypatch.setattr(acp, "student_id_for_user", lambda *_a, **_k: "student-1")
    monkeypatch.setattr(acp, "student_has_writing_assignment", lambda _sid: True)


def test_permissions_endpoint_refuses_inactive_account_holding_all(gate, holds_all):
    resp = gate.call("GET", "/api/student/permissions", INACTIVE)
    assert _inactive(resp), resp.text


def test_permissions_endpoint_unchanged_for_active_account_holding_all(gate, holds_all):
    resp = gate.call("GET", "/api/student/permissions", ACTIVE)
    assert resp.status_code == 200 and resp.json() == _ALL_TRUE


def test_permission_helper_is_all_false_for_inactive_account_holding_all(gate, holds_all):
    assert acp.get_account_permissions_summary(INACTIVE) == _ALL_FALSE


def test_permission_helper_is_all_false_for_account_without_users_row(gate, holds_all):
    assert acp.get_account_permissions_summary("user-missing") == _ALL_FALSE


def test_permission_helper_unchanged_for_active_account_holding_all(gate, holds_all):
    assert acp.get_account_permissions_summary(ACTIVE) == _ALL_TRUE


def test_permission_helper_inactive_ignores_writing_assignment_bridge(gate, monkeypatch):
    monkeypatch.setattr(acp, "get_user_access_code_permissions", lambda _uid: [])
    monkeypatch.setattr(acp, "student_id_for_user", lambda *_a, **_k: "student-1")
    monkeypatch.setattr(acp, "student_has_writing_assignment", lambda _sid: True)
    assert acp.get_account_permissions_summary(INACTIVE)["writing"] is False
    assert acp.get_account_permissions_summary(ACTIVE)["writing"] is True


# ── (3) Learner GETs found open on staging ──────────────────────────────────

class _Empty:
    """Chainable Supabase stand-in: every query returns no rows."""

    data: list = []
    count = 0

    def __getattr__(self, _name):
        return lambda *_a, **_k: self

    def execute(self):
        return self


def _stub_home(mp):
    mp.setattr("routers.student_home.get_home_summary", lambda *_a, **_k: {"ok": True})


def _stub_permissions(mp):
    mp.setattr(acp, "get_user_access_code_permissions", lambda _uid: ["all"])


def _stub_listening(mp):
    mp.setattr("routers.listening.supabase_admin", _Empty())


def _stub_reading(mp):
    mp.setattr("routers.reading_student.supabase_admin", _Empty())


def _stub_quiz(mp):
    mp.setattr("services.quiz_service.list_published_banks", lambda **_k: [])


def _stub_mock(mp):
    mp.setattr("routers.mock_exams.svc.list_open_exams", lambda _uid: [])


def _stub_grammar(mp):
    # The router's own kill-switch (master30_grammar_diagnostic) is on; the
    # self-serve flag the handler reports stays off.
    mp.setattr("services.runtime_flags.is_enabled",
               lambda key, **_k: key == "master30_grammar_diagnostic")


def _stub_class(mp):
    mp.setattr("routers.class_student._student_for_user", lambda *_a, **_k: None)


def _stub_tips(mp):
    mp.setattr("routers.writing_student.supabase_admin", _Empty())


LEARNER_GETS = [
    ("/api/student/home-summary", _stub_home),
    ("/api/student/permissions", _stub_permissions),
    ("/api/listening/content", _stub_listening),
    ("/api/reading/test", _stub_reading),
    ("/api/quiz/banks", _stub_quiz),
    ("/api/mock-exams", _stub_mock),
    ("/api/grammar/diagnostics/availability", _stub_grammar),
    ("/api/class/my-assignments", _stub_class),
    ("/api/writing/tips", _stub_tips),
]


@pytest.mark.parametrize("path,stub", LEARNER_GETS)
def test_learner_get_refuses_inactive_account(gate, monkeypatch, path, stub):
    stub(monkeypatch)
    resp = gate.call("GET", path, INACTIVE)
    assert _inactive(resp), (resp.status_code, resp.text)


@pytest.mark.parametrize("path,stub", LEARNER_GETS)
def test_learner_get_serves_active_account(gate, monkeypatch, path, stub):
    stub(monkeypatch)
    resp = gate.call("GET", path, ACTIVE)
    assert resp.status_code == 200, (resp.status_code, resp.text)


@pytest.mark.parametrize("path,_stub", LEARNER_GETS)
def test_learner_get_is_not_exempt(path, _stub):
    assert not activation_gate.is_exempt("GET", path)
    assert not activation_gate.is_staff_path(path)
