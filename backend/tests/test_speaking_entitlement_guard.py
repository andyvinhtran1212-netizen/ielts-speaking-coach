"""F04 backend half: every paid Speaking step re-checks create_session's admission.

Staging audit 2026-10-25 F04: an account that never redeemed an access code
could INSERT a `sessions` row directly through PostgREST and then call the
question generator, the grader and the pronunciation assessor, which only
checked ownership. Migration 320 closes the INSERT; these endpoints must also
refuse an inactive or unentitled account on their own, so a row created any
other way (or an account deactivated / revoked mid-session) cannot spend AI
budget. Ownership is still resolved first, so a foreign session stays a 404.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import grading, pronunciation, questions
from routers import sessions as sessions_module

OWNER = "user-1"


class _Query:
    def __init__(self, rows, log):
        self._rows = list(rows)
        self._log = log

    def select(self, columns="*", *_a, **_k):
        self._log.append(("select", columns))
        return self

    def eq(self, column, value):
        self._rows = [r for r in self._rows if str(r.get(column)) == str(value)]
        return self

    def in_(self, column, values):
        self._rows = [r for r in self._rows if r.get(column) in values]
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        return SimpleNamespace(data=self._rows)


class _DB:
    def __init__(self, **tables):
        self.tables = tables
        self.log: list[tuple] = []

    def table(self, name):
        return _Query(self.tables.get(name, []), self.log)


def _session(**over):
    row = {"id": "sess-1", "user_id": OWNER, "part": 1, "topic": "Hometown",
           "mode": "practice", "status": "in_progress", "class_assignment_item_id": None,
           "resume_expires_at": "2999-01-01T00:00:00+00:00"}
    row.update(over)
    return row


def _deny(calls):
    def guard(user_id, session):
        calls.append((user_id, session))
        raise HTTPException(403, "Tài khoản chưa được kích hoạt")
    return guard


def _never(name):
    async def _call(*_a, **_k):
        pytest.fail(f"{name} ran for an unentitled account")
    return _call


# ── The guard itself ───────────────────────────────────────────────────────

def _guard_env(monkeypatch, *, active=True, perms=()):
    db = _DB(users=[{"id": OWNER, "is_active": active}])
    monkeypatch.setattr(sessions_module, "supabase_admin", db)
    monkeypatch.setattr(sessions_module, "get_user_access_code_permissions_cached",
                        lambda _uid: list(perms))


@pytest.mark.parametrize("session", [_session(), _session(class_assignment_item_id="item-1"), None])
def test_inactive_account_is_refused_for_every_shape(monkeypatch, session):
    _guard_env(monkeypatch, active=False, perms=("all",))
    with pytest.raises(HTTPException) as error:
        sessions_module.require_speaking_entitlement(OWNER, session)
    assert error.value.status_code == 403


@pytest.mark.parametrize(("mode", "scope"), [("practice", "practice_single"),
                                             ("test_part", "practice_part"),
                                             ("test_full", "practice_full")])
def test_session_mode_needs_its_own_scope(monkeypatch, mode, scope):
    others = sorted({"practice_single", "practice_part", "practice_full", "writing"} - {scope})
    _guard_env(monkeypatch, perms=others)
    with pytest.raises(HTTPException) as error:
        sessions_module.require_speaking_entitlement(OWNER, _session(mode=mode))
    assert error.value.status_code == 403

    _guard_env(monkeypatch, perms=(scope,))
    sessions_module.require_speaking_entitlement(OWNER, _session(mode=mode))
    _guard_env(monkeypatch, perms=("all",))
    sessions_module.require_speaking_entitlement(OWNER, _session(mode=mode))


def test_class_assignment_session_is_entitled_by_the_assignment(monkeypatch):
    """create_session lets a valid class assignment entitle its own mode."""
    _guard_env(monkeypatch, perms=())
    sessions_module.require_speaking_entitlement(
        OWNER, _session(mode="test_part", class_assignment_item_id="item-1"))


def test_sessionless_cue_card_needs_any_speaking_scope(monkeypatch):
    for perms in ((), ("writing",), ("admin",)):
        _guard_env(monkeypatch, perms=perms)
        with pytest.raises(HTTPException) as error:
            sessions_module.require_speaking_entitlement(OWNER, None)
        assert error.value.status_code == 403
    _guard_env(monkeypatch, perms=("practice_part",))
    sessions_module.require_speaking_entitlement(OWNER, None)


def test_permission_lookup_failure_fails_closed(monkeypatch):
    _guard_env(monkeypatch)

    def boom(_uid):
        raise RuntimeError("db down")
    monkeypatch.setattr(sessions_module, "get_user_access_code_permissions_cached", boom)
    for session in (_session(), None):
        with pytest.raises(HTTPException) as error:
            sessions_module.require_speaking_entitlement(OWNER, session)
        assert error.value.status_code == 500


# ── Wiring: ownership first, then entitlement, then any AI call ───────────

@pytest.mark.parametrize("call", ["generate", "custom"])
def test_question_endpoints_refuse_unentitled_owner_before_any_write(monkeypatch, call):
    db = _DB(sessions=[_session()])
    calls: list = []
    monkeypatch.setattr(questions, "supabase_admin", db)
    monkeypatch.setattr(questions, "get_supabase_user", AsyncMock(return_value={"id": OWNER}))
    monkeypatch.setattr(questions, "require_speaking_entitlement", _deny(calls))
    monkeypatch.setattr(questions, "generate_part1_questions", _never("Gemini"))
    run = (questions.generate_questions("sess-1", None) if call == "generate" else
           questions.save_custom_questions("sess-1", questions._CustomQBody(questions=["Q?"]), None))
    with pytest.raises(HTTPException) as error:
        asyncio.run(run)
    assert error.value.status_code == 403
    assert calls and calls[0][0] == OWNER
    # The guard sees the owned row, including the fields it decides on.
    assert calls[0][1]["mode"] == "practice" and "class_assignment_item_id" in calls[0][1]
    selected = [cols for kind, cols in db.log if kind == "select"][0]
    assert "mode" in selected and "class_assignment_item_id" in selected


@pytest.mark.parametrize("call", ["generate", "custom"])
def test_question_endpoints_keep_foreign_sessions_a_404(monkeypatch, call):
    calls: list = []
    monkeypatch.setattr(questions, "supabase_admin", _DB(sessions=[_session(user_id="someone-else")]))
    monkeypatch.setattr(questions, "get_supabase_user", AsyncMock(return_value={"id": OWNER}))
    monkeypatch.setattr(questions, "require_speaking_entitlement", _deny(calls))
    run = (questions.generate_questions("sess-1", None) if call == "generate" else
           questions.save_custom_questions("sess-1", questions._CustomQBody(questions=["Q?"]), None))
    with pytest.raises(HTTPException) as error:
        asyncio.run(run)
    assert error.value.status_code == 404 and calls == []


def test_cue_card_generator_refuses_unentitled_account(monkeypatch):
    import services.gemini as gemini

    calls: list = []
    monkeypatch.setattr(questions, "get_supabase_user", AsyncMock(return_value={"id": OWNER}))
    monkeypatch.setattr(questions, "require_speaking_entitlement", _deny(calls))
    monkeypatch.setattr(gemini, "generate_part2_cuecard", _never("Gemini"))
    with pytest.raises(HTTPException) as error:
        asyncio.run(questions.generate_cuecard_endpoint(
            questions._GenerateCueCardBody(trigger="a trip"), None))
    assert error.value.status_code == 403
    assert calls == [(OWNER, None)]


def _grade(monkeypatch, db, guard):
    async def execute(builder):
        return builder(db).execute()
    monkeypatch.setattr(grading, "aexecute", execute)
    monkeypatch.setattr(grading, "get_supabase_user", AsyncMock(return_value={"id": OWNER}))
    monkeypatch.setattr(grading, "require_speaking_entitlement", guard)
    monkeypatch.setattr(grading, "transcribe_from_bytes", _never("Whisper"))
    monkeypatch.setattr(grading, "enforce_grading_rate_limit",
                        lambda *_a: pytest.fail("rate limit consumed before admission"))
    upload = SimpleNamespace(filename="a.webm", content_type="audio/webm",
                             read=AsyncMock(return_value=b"audio"))
    return asyncio.run(grading.grade_response_endpoint("sess-1", "q-1", upload))


def test_grading_refuses_unentitled_owner_before_stt_or_quota(monkeypatch):
    db = _DB(sessions=[_session(mode="test_full")],
             questions=[{"id": "q-1", "session_id": "sess-1", "question_text": "Q?"}])
    calls: list = []
    with pytest.raises(HTTPException) as error:
        _grade(monkeypatch, db, _deny(calls))
    assert error.value.status_code == 403
    assert calls[0][1]["mode"] == "test_full"
    selected = [cols for kind, cols in db.log if kind == "select"][0]
    assert "class_assignment_item_id" in selected


def test_grading_keeps_foreign_sessions_a_404(monkeypatch):
    calls: list = []
    with pytest.raises(HTTPException) as error:
        _grade(monkeypatch, _DB(sessions=[_session(user_id="someone-else")]), _deny(calls))
    assert error.value.status_code == 404 and calls == []


def test_full_pronunciation_refuses_unentitled_owner_before_azure(monkeypatch):
    db = _DB(sessions=[_session(id="sess-1", mode="test_full"),
                       _session(id="sess-2", mode="test_full")])
    calls: list = []
    monkeypatch.setattr(pronunciation, "supabase_admin", db)
    monkeypatch.setattr(pronunciation, "get_supabase_user", AsyncMock(return_value={"id": OWNER}))
    monkeypatch.setattr(pronunciation, "require_speaking_entitlement", _deny(calls))
    body = pronunciation.FullPronRequest(extra_session_ids=["sess-2"])
    with pytest.raises(HTTPException) as error:
        asyncio.run(pronunciation.assess_full_test_pronunciation("sess-1", body=body))
    assert error.value.status_code == 403
    assert calls[0][1]["id"] == "sess-1" and calls[0][1]["mode"] == "test_full"
    assert [kind for kind, _ in db.log] == ["select"], "responses were read before admission"


def test_full_pronunciation_keeps_foreign_sessions_a_404(monkeypatch):
    calls: list = []
    monkeypatch.setattr(pronunciation, "supabase_admin", _DB(sessions=[_session(user_id="x")]))
    monkeypatch.setattr(pronunciation, "get_supabase_user", AsyncMock(return_value={"id": OWNER}))
    monkeypatch.setattr(pronunciation, "require_speaking_entitlement", _deny(calls))
    with pytest.raises(HTTPException) as error:
        asyncio.run(pronunciation.assess_full_test_pronunciation(
            "sess-1", body=pronunciation.FullPronRequest()))
    assert error.value.status_code == 404 and calls == []
