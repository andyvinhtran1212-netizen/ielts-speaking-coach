"""PC-J75 F4 — POST /admin/vocab/backfill-enrichment is admin-only.

`dry_run=true` returns each candidate row's `user_id` and `headword`, i.e.
learner data, and `dry_run=false` queues a Gemini job that writes
user_vocabulary. These tests run the REAL admin guard (services/staff_guard
through routers.admin's get_supabase_user / supabase_admin seams) and pin that
a signed-in non-admin gets 403 before any candidate read, model call or
queued job — and that the same harness as admin does reach them.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from config import settings
from main import app
from routers import admin
from services import staff_guard, vocab_enrichment

CALLER = "00000000-0000-0000-0000-00000000c002"
PATH = "/admin/vocab/backfill-enrichment"
_AUTH = {"Authorization": "Bearer fake.caller.jwt"}


class _Query:
    def __init__(self, db, table):
        self.db, self.table = db, table

    def __getattr__(self, _method):
        return lambda *_a, **_k: self

    def execute(self):
        if self.table == "users":
            return SimpleNamespace(data=[{"role": self.db.role}])
        return SimpleNamespace(data=[])


class _GuardDB:
    """routers.admin.supabase_admin: answers the users.role read and records
    every table touched (the backfill reads user_vocabulary/users through the
    same client, so anything past the guard shows up here)."""

    def __init__(self, role):
        self.role = role
        self.touched: list = []

    def table(self, name):
        self.touched.append(name)
        return _Query(self, name)

    def rpc(self, name, _params):
        self.touched.append(f"rpc:{name}")
        return _Query(self, name)


@pytest.fixture
def call_as(monkeypatch):
    seen = {"dry_run": 0, "run": 0, "gemini": 0}

    def _dry_run(_job_id, _limit):
        seen["dry_run"] += 1
        return {"rows": [], "column_counts": {}}

    def _run(_job_id, _limit):
        seen["run"] += 1

    def _gemini(_words):
        seen["gemini"] += 1
        return {}

    monkeypatch.setattr(admin, "_backfill_dry_run", _dry_run)
    monkeypatch.setattr(admin, "_backfill_run", _run)
    monkeypatch.setattr(vocab_enrichment, "enrich_vocabulary_batch", _gemini)
    monkeypatch.setattr(settings, "ADMIN_AAL2_ENFORCE", False)

    def _call(role, dry_run):
        db = _GuardDB(role)
        with patch.object(admin, "get_supabase_user",
                          new=AsyncMock(return_value={"id": CALLER, "email": f"{role}@x"})), \
             patch.object(admin, "supabase_admin", db):
            r = TestClient(app, raise_server_exceptions=False).post(
                f"{PATH}?dry_run={'true' if dry_run else 'false'}&limit=5", headers=_AUTH)
        return r, db, seen

    return _call


@pytest.mark.parametrize("role", ["user", "instructor"])
@pytest.mark.parametrize("dry_run", [True, False], ids=["dry_run", "real_run"])
def test_non_admin_is_refused_before_any_candidate_read_or_job(call_as, role, dry_run):
    r, db, seen = call_as(role, dry_run)
    assert r.status_code == 403, r.text
    assert r.json()["detail"] == staff_guard.ADMIN_ROLE_DENIED
    assert "rows" not in r.json() and "job_id" not in r.json()
    assert db.touched == ["users"]                 # the guard's own role read only
    assert seen == {"dry_run": 0, "run": 0, "gemini": 0}


def test_missing_token_is_401_before_anything(call_as):
    with patch.object(admin, "supabase_admin", _GuardDB("admin")) as db:
        r = TestClient(app).post(f"{PATH}?dry_run=true")
    assert r.status_code == 401
    assert db.touched == []


def test_admin_control_reaches_the_dry_run_and_the_queued_job(call_as):
    # Same harness, role=admin: proves the "never reached" asserts above can fail.
    r, _db, seen = call_as("admin", True)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "dry_run"
    assert seen["dry_run"] == 1

    r, _db, seen = call_as("admin", False)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "queued"
    assert seen["run"] == 1                         # BackgroundTasks ran the job
