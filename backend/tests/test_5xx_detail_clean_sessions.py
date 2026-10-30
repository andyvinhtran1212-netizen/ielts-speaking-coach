"""Speaking session 5xx errors stay safe even without main.py's HTTPException handler."""

import asyncio
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import BackgroundTasks, HTTPException
from fastapi.testclient import TestClient

from config import settings
from routers import sessions
from services.errors import GENERIC_MESSAGE


_DB_ERROR = 'relation "users" column secret_col contains private-db-value'
_ID = "00000000-0000-0000-0000-000000000001"
_P1, _P2, _P3 = (f"00000000-0000-0000-0000-00000000010{n}" for n in (1, 2, 3))
_AUTH = "Bearer test"


class _Query:
    """Chainable PostgREST stand-in: scripted rows per execute(), then the DB error."""

    def __init__(self, results):
        self._results = results

    def __getattr__(self, _name):
        return lambda *_a, **_k: self

    def execute(self):
        result = self._results.pop(0)
        if isinstance(result, Exception):
            raise result
        return SimpleNamespace(data=result, count=len(result))


class _FailingClient:
    def __init__(self, rows_before_error=()):
        self._results = [*(list(rows) for rows in rows_before_error), Exception(_DB_ERROR)]

    def table(self, _name):
        return _Query(self._results)

    def rpc(self, _name, _params=None):
        return _Query(self._results)


def _raise_db_error(*_a, **_k):
    raise Exception(_DB_ERROR)


def _create_body(**overrides):
    return sessions.CreateSessionBody(**{"mode": "practice", "part": 1, "topic": "Hometown", **overrides})


def _full_test_rows(status="submitted"):
    return [
        {"id": sid, "mode": "test_full", "part": part, "status": status,
         "sitting_id": None, "full_test_attempt_id": _ID, "resume_expires_at": None}
        for part, sid in enumerate((_P1, _P2, _P3), start=1)
    ]


def _patch_create_session_guards(monkeypatch, *, quota=None):
    monkeypatch.setattr(sessions, "_require_active", lambda _user_id: None)
    monkeypatch.setattr(sessions, "_require_permission", lambda _user_id, _mode: None)
    monkeypatch.setattr(sessions.staff_guard, "holds_admin_privilege", lambda *_a, **_k: False)
    monkeypatch.setattr(
        sessions, "get_user_session_quota",
        quota or (lambda _user_id: {"unlimited": True, "used": 0, "limit": None}),
    )


def _setup_permission(monkeypatch):
    monkeypatch.setattr(sessions, "get_user_access_code_permissions_cached", _raise_db_error)


def _setup_quota(monkeypatch):
    _patch_create_session_guards(monkeypatch, quota=_raise_db_error)


def _setup_create(monkeypatch):
    _patch_create_session_guards(monkeypatch)


def _setup_complete_update(monkeypatch):
    monkeypatch.setattr(sessions, "_compute_session_bands", lambda _sid: {
        "overall_band": 6.5, "band_fc": 6.5, "band_lr": 6.5, "band_gra": 6.5, "band_p": 6.5,
    })


def _completed_without_band():
    return [{"id": _ID, "mode": "practice", "part": 1, "status": "completed",
             "overall_band": None, "completed_at": "2026-10-30T00:00:00+00:00"}]


_SITES = [
    pytest.param(lambda: sessions._require_permission(_ID, "practice"),
                 (), _setup_permission, "permission lookup", id="313-require-permission"),
    pytest.param(lambda: sessions._require_active(_ID),
                 (), None, "account lookup", id="338-require-active"),
    pytest.param(lambda: sessions.require_speaking_entitlement(_ID, None),
                 ([{"is_active": True}],), _setup_permission, "speaking entitlement lookup", id="360-speaking-entitlement"),
    pytest.param(lambda: sessions._resolve_full_test_attempt_id(
                     _ID, _create_body(mode="test_full", part=2, previous_session_id=_P1)),
                 (), None, "full test chain lookup", id="406-full-test-chain"),
    pytest.param(lambda: sessions._find_replayable_full_test_part(
                     _ID, _ID, _create_body(mode="test_full", part=2, previous_session_id=_P1)),
                 (), None, "full test part replay lookup", id="481-full-test-replay"),
    pytest.param(lambda: sessions.create_session(_create_body(), _AUTH),
                 (), _setup_quota, "quota lookup", id="614-create-quota"),
    pytest.param(lambda: sessions.create_session(_create_body(), _AUTH),
                 (), _setup_create, "create", id="694-create-rpc"),
    pytest.param(lambda: sessions.list_sessions(
                     authorization=_AUTH, status=None, part=None, limit=20, search=None,
                     sort="newest", date_from=None, date_to=None, page=None,
                     page_size=20, include_hidden=False),
                 (), None, "list", id="907-list"),
    pytest.param(lambda: sessions.get_session_stats(limit=10, authorization=_AUTH),
                 (), None, "stats lookup", id="958-stats"),
    pytest.param(lambda: sessions.get_session(_ID, BackgroundTasks(), _AUTH),
                 (), None, "get", id="1098-get"),
    pytest.param(lambda: sessions.get_session_audio_urls(_ID, _AUTH),
                 (), None, "audio-urls session lookup", id="1272-audio-session"),
    pytest.param(lambda: sessions.get_session_audio_urls(_ID, _AUTH),
                 ([{"id": _ID}],), None, "audio-urls responses lookup", id="1286-audio-responses"),
    pytest.param(lambda: sessions.finalize_full_test(
                     sessions.FinalizeFullTestBody(p1_id=_P1, p2_id=_P2, p3_id=_P3),
                     BackgroundTasks(), _AUTH),
                 (), None, "finalize-full-test sessions lookup", id="1894-finalize-sessions"),
    pytest.param(lambda: sessions.finalize_full_test(
                     sessions.FinalizeFullTestBody(p1_id=_P1, p2_id=_P2, p3_id=_P3),
                     BackgroundTasks(), _AUTH),
                 (_full_test_rows(),), None, "finalize-full-test questions lookup", id="1930-finalize-questions"),
    pytest.param(lambda: sessions.complete_session(_ID, _AUTH),
                 (), None, "complete lookup", id="2070-complete-lookup"),
    pytest.param(lambda: sessions.complete_session(_ID, _AUTH),
                 (_completed_without_band(),), _setup_complete_update, "complete update", id="2180-complete-update"),
]


@pytest.mark.parametrize("call,rows_before_error,setup,operation", _SITES)
def test_direct_sessions_5xx_detail_is_clean(
    monkeypatch, caplog, call, rows_before_error, setup, operation,
):
    monkeypatch.setattr(settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", False)
    monkeypatch.setattr(sessions, "get_supabase_user", AsyncMock(return_value={"id": _ID}))
    monkeypatch.setattr(sessions, "supabase_admin", _FailingClient(rows_before_error))
    if setup:
        setup(monkeypatch)

    with caplog.at_level(logging.ERROR, logger=sessions.logger.name):
        with pytest.raises(HTTPException) as exc_info:
            result = call()
            if asyncio.iscoroutine(result):
                asyncio.run(result)

    error = exc_info.value
    assert error.status_code == 500
    assert isinstance(error.detail, str)
    assert error.detail.endswith("Vui lòng thử lại.")
    for internal in (_DB_ERROR, "relation", "secret_col", "private-db-value",
                     "users", "responses", "questions"):
        assert internal not in error.detail
    assert error.__cause__ is None
    assert error.__suppress_context__ is True
    assert any(record.name == sessions.logger.name
               and record.levelno == logging.ERROR
               and record.getMessage().startswith(f"[sessions] {operation} failed: ")
               and record.exc_info is not None
               for record in caplog.records)


@pytest.mark.parametrize("method,path,rows_before_error", [
    pytest.param("get", "/sessions/stats", (), id="stats-main-app"),
    pytest.param("patch", f"/sessions/{_ID}/complete", (), id="complete-main-app"),
])
def test_main_app_preserves_safe_500_shape(monkeypatch, method, path, rows_before_error):
    import main

    monkeypatch.setattr(settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", False)
    monkeypatch.setattr(sessions, "get_supabase_user", AsyncMock(return_value={"id": _ID}))
    monkeypatch.setattr(sessions, "supabase_admin", _FailingClient(rows_before_error))

    client = TestClient(main.app)
    try:
        response = getattr(client, method)(path, headers={"Authorization": _AUTH})
    finally:
        client.close()

    assert response.status_code == 500
    assert response.json() == {"detail": {
        "error_code": "internal_error",
        "message": GENERIC_MESSAGE,
        "ref": response.headers["X-Request-ID"],
    }}
    assert response.json()["detail"]["ref"]
    for internal in (_DB_ERROR, "relation", "secret_col", "private-db-value"):
        assert internal not in response.text
