from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import admin  # noqa: E402


class _Query:
    def __init__(self, db, table):
        self.db = db
        self.table = table
        self.action = "select"
        self.payload = None

    def select(self, *_args, **_kwargs): self.action = "select"; return self
    def update(self, payload, *_args, **_kwargs): self.action = "update"; self.payload = payload; return self
    def eq(self, *_args, **_kwargs): return self
    def in_(self, *_args, **_kwargs): return self
    def ilike(self, *_args, **_kwargs): return self
    def range(self, *_args, **_kwargs): return self
    def filter(self, *_args, **_kwargs): return self
    def is_(self, *_args, **_kwargs): return self
    def order(self, *_args, **_kwargs): return self
    def lt(self, *_args, **_kwargs): return self
    def limit(self, *_args, **_kwargs): return self
    def execute(self):
        self.db.calls.append((self.table, self.action, self.payload))
        if self.action == "update": return SimpleNamespace(data=[self.payload])
        if self.table == "sessions": return SimpleNamespace(data=self.db.sessions)
        if self.table == "questions": return SimpleNamespace(data=self.db.questions)
        if self.table == "responses": return SimpleNamespace(data=self.db.responses)
        if self.table == "users":
            if self.db.fail_users: raise RuntimeError("user lookup unavailable")
            return SimpleNamespace(data=self.db.users)
        return SimpleNamespace(data=[])


class _DB:
    def __init__(self, *, sessions=None, questions=None, responses=None, users=None, fail_users=False):
        self.sessions = sessions or []
        self.questions = questions or []
        self.responses = responses or []
        self.users = users or []
        self.fail_users = fail_users
        self.calls = []

    def table(self, name): return _Query(self, name)


async def _admin(_authorization):
    return {"id": "admin-1", "email": "admin@example.test"}


def test_targeted_repair_with_remaining_failure_stays_degraded(monkeypatch):
    db = _DB(
        sessions=[{"id": "s1", "part": 1, "mode": "test_part", "user_id": "u1", "status": "grading_failed", "regrade_count": 0}],
        questions=[{"id": "q1", "question_text": "Question"}],
        responses=[{"id": "r1", "session_id": "s1", "question_id": "q1", "transcript": "answer", "audio_storage_path": None, "grading_status": "failed", "overall_band": None, "regrade_count": 0}],
    )
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "require_admin", _admin)
    monkeypatch.setattr(admin, "_regrade_compute_session_bands", lambda _sid: {"overall_band": 6.0, "band_fc": 6.0, "band_lr": 6.0, "band_gra": 6.0, "band_p": 6.0})
    monkeypatch.setattr(admin, "sync_class_item_score", lambda *_args: None)

    async def fail_regrade(*_args, **_kwargs):
        raise HTTPException(502, "grader unavailable")

    monkeypatch.setattr(admin, "_run_regrade_response", fail_regrade)
    result = asyncio.run(admin.admin_regrade_session("s1", force=False, authorization="Bearer test"))

    assert result["ok"] is False
    assert result["partial_failure"] is True
    assert result["failed"] == 1
    updates = [payload for table, action, payload in db.calls if table == "sessions" and action == "update"]
    assert updates[-1]["status"] == "grading_failed"
    assert updates[-1]["error_code"] == "grading_failed"
    assert updates[-1]["failed_step"] == "admin_regrade_session"


def test_rebuild_clears_stale_error_and_syncs_class_score(monkeypatch):
    db = _DB(sessions=[{"id": "s1", "mode": "test_part", "status": "grading_failed"}])
    synced = []
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "require_admin", _admin)
    monkeypatch.setattr(admin, "_regrade_compute_session_bands", lambda _sid: {"overall_band": 6.5, "band_fc": 6.0, "band_lr": 6.5, "band_gra": 6.0, "band_p": 7.0})
    monkeypatch.setattr(admin, "sync_class_item_score", lambda _db, sid: synced.append(sid))

    result = asyncio.run(admin.admin_rebuild_summary("s1", p2_id=None, p3_id=None, authorization="Bearer test"))

    assert result["sessions"] == [{"session_id": "s1", "ok": True, "overall_band": 6.5, "band_fc": 6.0, "band_lr": 6.5, "band_gra": 6.0, "band_p": 7.0}]
    updates = [payload for table, action, payload in db.calls if table == "sessions" and action == "update"]
    assert updates[-1]["status"] == "completed"
    assert updates[-1]["error_code"] is None
    assert updates[-1]["error_message"] is None
    assert updates[-1]["failed_step"] is None
    assert updates[-1]["last_error_at"] is None
    assert synced == ["s1"]


def test_single_response_regrade_keeps_session_degraded_when_another_response_failed(monkeypatch):
    db = _DB(
        sessions=[{"id": "s1", "part": 1, "mode": "test_part", "user_id": "u1"}],
        questions=[{"question_text": "Question"}],
        responses=[
            {"id": "r1", "session_id": "s1", "question_id": "q1", "transcript": "a valid answer", "audio_storage_path": None, "grading_status": "completed", "overall_band": 6.5, "regrade_count": 0},
            {"id": "r2", "session_id": "s1", "question_id": "q2", "grading_status": "failed", "overall_band": None},
        ],
    )
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "require_admin", _admin)
    monkeypatch.setattr(admin, "_regrade_compute_session_bands", lambda _sid: {"overall_band": 6.5, "band_fc": 6.5, "band_lr": 6.5, "band_gra": 6.5, "band_p": 6.5})
    monkeypatch.setattr(admin, "sync_class_item_score", lambda *_args: (_ for _ in ()).throw(AssertionError("partial score must not sync")))

    async def regrade_ok(*_args, **_kwargs):
        return {"overall_band": 6.5, "re_transcribed": False}

    monkeypatch.setattr(admin, "_run_regrade_response", regrade_ok)
    result = asyncio.run(admin.admin_regrade_response("r1", authorization="Bearer test"))

    assert result["session_updated"] is False
    assert result["remaining_failed"] == 1
    updates = [payload for table, action, payload in db.calls if table == "sessions" and action == "update"]
    assert updates[-1]["status"] == "grading_failed"
    assert updates[-1]["failed_step"] == "admin_regrade_response"


def test_rebuild_does_not_complete_or_sync_with_failed_response(monkeypatch):
    db = _DB(
        sessions=[{"id": "s1", "mode": "test_part", "status": "grading_failed"}],
        responses=[{"id": "r2", "grading_status": "failed", "overall_band": None}],
    )
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "require_admin", _admin)
    monkeypatch.setattr(admin, "_regrade_compute_session_bands", lambda _sid: {"overall_band": 6.0, "band_fc": 6.0, "band_lr": 6.0, "band_gra": 6.0, "band_p": 6.0})
    monkeypatch.setattr(admin, "sync_class_item_score", lambda *_args: (_ for _ in ()).throw(AssertionError("partial score must not sync")))

    result = asyncio.run(admin.admin_rebuild_summary(
        "s1", p2_id=None, p3_id=None, authorization="Bearer test",
    ))

    assert result["sessions"][0]["ok"] is False
    assert "1 response" in result["sessions"][0]["error"]
    updates = [payload for table, action, payload in db.calls if table == "sessions" and action == "update"]
    assert updates[-1]["status"] == "grading_failed"
    assert updates[-1]["failed_step"] == "admin_rebuild_summary"


def test_session_list_exposes_user_lookup_failure(monkeypatch):
    db = _DB(sessions=[{"id": "s1", "user_id": "u1"}], fail_users=True)
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "require_admin", _admin)

    rows = asyncio.run(admin.admin_list_sessions(authorization="Bearer test", limit=50, offset=0))

    assert rows[0]["user_email"] == ""
    assert rows[0]["user_lookup_failed"] is True


def test_session_list_resolves_exact_email_before_session_query(monkeypatch):
    db = _DB(
        sessions=[{"id": "s1", "user_id": "u1"}],
        users=[{"id": "u1", "email": "student@example.test"}],
    )
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "require_admin", _admin)

    rows = asyncio.run(admin.admin_list_sessions(
        authorization="Bearer test", user_email="Student@Example.Test", limit=50, offset=0,
    ))

    assert rows[0]["id"] == "s1"
    assert [table for table, action, _payload in db.calls if action == "select"][:2] == ["users", "sessions"]


def test_session_list_email_lookup_failure_is_not_empty_truth(monkeypatch):
    db = _DB(fail_users=True)
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "require_admin", _admin)

    try:
        asyncio.run(admin.admin_list_sessions(
            authorization="Bearer test", user_email="student@example.test", limit=50, offset=0,
        ))
    except HTTPException as exc:
        assert exc.status_code == 500
        assert "tra email" in str(exc.detail)
    else:
        raise AssertionError("lookup failure must not masquerade as an empty session list")
