"""Security contract for the staging-only Gate E session cleanup seam."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from routers import admin


class _Query:
    def __init__(self, db, table):
        self.db = db
        self.table = table
        self.action = "select"
        self.equals = []

    def select(self, *_args, **_kwargs):
        return self

    def delete(self, *_args, **_kwargs):
        self.action = "delete"
        return self

    def eq(self, column, value, *_args, **_kwargs):
        self.equals.append((column, value))
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        rows = self.db.tables.get(self.table, [])
        matching = [
            row for row in rows
            if all(row.get(column) == value for column, value in self.equals)
        ]
        self.db.calls.append((self.table, self.action, tuple(self.equals)))
        if self.action == "delete":
            self.db.tables[self.table] = [row for row in rows if row not in matching]
        return SimpleNamespace(data=matching)


class _DB:
    def __init__(self, tables):
        self.tables = {name: list(rows) for name, rows in tables.items()}
        self.calls = []

    def table(self, name):
        return _Query(self, name)


async def _admin(_authorization):
    return {"id": "admin-1", "role": "admin"}


def _run(coro):
    return asyncio.run(coro)


def _install(monkeypatch, session, *, email="e2e-student-smoke@staging-e2e.averlearning.com"):
    db = _DB({
        "sessions": [session],
        "users": [{"id": session["user_id"], "email": email}],
        "grammar_recommendations": [{"id": "rec-1", "session_id": session["id"]}],
    })
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(admin, "require_admin", _admin)
    monkeypatch.setattr(admin.settings, "ENVIRONMENT", "staging")
    monkeypatch.setattr(
        admin.settings,
        "SUPABASE_URL",
        "https://zjphffoujxkpltixsbzj.supabase.co",
    )
    return db


def _session(**overrides):
    row = {
        "id": "session-1",
        "user_id": "student-1",
        "topic": "Gate E live failure injection",
        "sitting_id": None,
        "class_assignment_item_id": None,
    }
    row.update(overrides)
    return row


def test_cleanup_deletes_only_dependency_then_session(monkeypatch):
    db = _install(monkeypatch, _session())

    response = _run(admin.admin_cleanup_e2e_session("session-1", "Bearer admin"))

    assert response.status_code == 204
    deletes = [(table, filters) for table, action, filters in db.calls if action == "delete"]
    assert deletes == [
        ("grammar_recommendations", (("session_id", "session-1"),)),
        ("sessions", (("id", "session-1"),)),
    ]
    assert db.tables["sessions"] == []
    assert db.tables["grammar_recommendations"] == []


def test_cleanup_is_idempotent_when_session_is_absent(monkeypatch):
    db = _install(monkeypatch, _session())
    db.tables["sessions"] = []

    response = _run(admin.admin_cleanup_e2e_session("missing", "Bearer admin"))

    assert response.status_code == 204
    assert not [call for call in db.calls if call[1] == "delete"]


@pytest.mark.parametrize(
    ("session_overrides", "email"),
    [
        ({"topic": "A real learner topic"}, "e2e-student-smoke@staging-e2e.averlearning.com"),
        ({"sitting_id": "sitting-1"}, "e2e-student-smoke@staging-e2e.averlearning.com"),
        ({"class_assignment_item_id": "class-item-1"}, "e2e-student-smoke@staging-e2e.averlearning.com"),
        ({}, "student@example.com"),
    ],
)
def test_cleanup_rejects_non_e2e_or_linked_sessions(monkeypatch, session_overrides, email):
    db = _install(monkeypatch, _session(**session_overrides), email=email)

    with pytest.raises(HTTPException) as exc:
        _run(admin.admin_cleanup_e2e_session("session-1", "Bearer admin"))

    assert exc.value.status_code == 403
    assert not [call for call in db.calls if call[1] == "delete"]


@pytest.mark.parametrize(
    ("environment", "supabase_url"),
    [
        ("production", "https://zjphffoujxkpltixsbzj.supabase.co"),
        ("staging", "https://huwsmtubwulikhlmcirx.supabase.co"),
    ],
)
def test_cleanup_is_hidden_outside_certified_staging(monkeypatch, environment, supabase_url):
    db = _install(monkeypatch, _session())
    monkeypatch.setattr(admin.settings, "ENVIRONMENT", environment)
    monkeypatch.setattr(admin.settings, "SUPABASE_URL", supabase_url)

    with pytest.raises(HTTPException) as exc:
        _run(admin.admin_cleanup_e2e_session("session-1", "Bearer admin"))

    assert exc.value.status_code == 404
    assert db.calls == []
