"""Tests for services.topic_service (Pha 0 — content topics spine).

supabase_admin is mocked (no DB IO). Mirrors the fake-client style used in
tests/test_essay_service.py.
"""

from __future__ import annotations

from typing import Optional
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from services import topic_service

_TOPIC_ID = "00000000-0000-0000-0000-0000000000a1"


class _FakeSupabase:
    def __init__(self, responses: dict | None = None) -> None:
        # {(table, op): list | Exception}
        self.responses = responses or {}
        self.calls: list[dict] = []

    def table(self, name: str) -> "_FakeQuery":
        return _FakeQuery(self, name)


class _FakeQuery:
    def __init__(self, parent: _FakeSupabase, table: str) -> None:
        self._p = parent
        self._t = table
        self._op: Optional[str] = None
        self._payload = None
        self._count = False
        self._filters: list[tuple] = []

    def insert(self, payload):
        self._op = "insert"; self._payload = payload; return self

    def update(self, payload):
        self._op = "update"; self._payload = payload; return self

    def delete(self):
        self._op = "delete"; return self

    def select(self, cols, count=None):
        self._op = "select"; self._count = count is not None; return self

    def eq(self, c, v):
        self._filters.append(("eq", c, v)); return self

    def order(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def execute(self):
        key = (self._t, self._op)
        data = self._p.responses.get(key, [])
        self._p.calls.append({"table": self._t, "op": self._op,
                              "payload": self._payload, "filters": list(self._filters)})
        if isinstance(data, Exception):
            raise data
        return MagicMock(data=data, count=(len(data) if self._count else None))


# ── list ─────────────────────────────────────────────────────────────

def test_list_topics_filters_by_skill_area():
    fake = _FakeSupabase(responses={("content_topics", "select"): [{"id": _TOPIC_ID}]})
    with patch.object(topic_service, "supabase_admin", fake):
        out = topic_service.list_topics(skill_area="vocab")
    assert out == [{"id": _TOPIC_ID}]
    sel = next(c for c in fake.calls if c["table"] == "content_topics")
    assert ("eq", "skill_area", "vocab") in sel["filters"]


# ── create ───────────────────────────────────────────────────────────

def test_create_topic_derives_slug_from_title():
    fake = _FakeSupabase(responses={("content_topics", "insert"): [{"id": _TOPIC_ID, "slug": "work-careers"}]})
    with patch.object(topic_service, "supabase_admin", fake):
        out = topic_service.create_topic(title="Work & Careers", skill_area="vocab")
    assert out["slug"] == "work-careers"
    ins = next(c for c in fake.calls if c["op"] == "insert")
    assert ins["payload"]["slug"] == "work-careers"      # slugified from title
    assert ins["payload"]["skill_area"] == "vocab"


def test_create_topic_rejects_bad_skill_area():
    fake = _FakeSupabase()
    with patch.object(topic_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as e:
            topic_service.create_topic(title="X", skill_area="speaking")
    assert e.value.status_code == 422


def test_create_topic_requires_title():
    fake = _FakeSupabase()
    with patch.object(topic_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as e:
            topic_service.create_topic(title="   ")
    assert e.value.status_code == 422


def test_create_topic_duplicate_maps_to_409():
    fake = _FakeSupabase(responses={
        ("content_topics", "insert"): Exception('duplicate key value violates unique constraint'),
    })
    with patch.object(topic_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as e:
            topic_service.create_topic(title="Work", slug="work", skill_area="vocab")
    assert e.value.status_code == 409


# ── get / update ─────────────────────────────────────────────────────

def test_get_topic_404_when_missing():
    fake = _FakeSupabase(responses={("content_topics", "select"): []})
    with patch.object(topic_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as e:
            topic_service.get_topic(_TOPIC_ID)
    assert e.value.status_code == 404


def test_update_topic_only_writes_editable_fields():
    fake = _FakeSupabase(responses={
        ("content_topics", "select"): [{"id": _TOPIC_ID, "title": "Old"}],
        ("content_topics", "update"): [{"id": _TOPIC_ID, "title": "New"}],
    })
    with patch.object(topic_service, "supabase_admin", fake):
        out = topic_service.update_topic(_TOPIC_ID, {"title": "New", "bogus": "x", "skill_area": "grammar"})
    assert out["title"] == "New"
    upd = next(c for c in fake.calls if c["op"] == "update")
    assert upd["payload"] == {"title": "New"}            # bogus + skill_area dropped


# ── delete ───────────────────────────────────────────────────────────

def test_delete_topic_blocked_when_cards_reference_it():
    fake = _FakeSupabase(responses={
        ("content_topics", "select"): [{"id": _TOPIC_ID}],
        ("vocab_cards", "select"): [{"id": "c1"}, {"id": "c2"}],   # count → 2
    })
    with patch.object(topic_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as e:
            topic_service.delete_topic(_TOPIC_ID)
    assert e.value.status_code == 409
    assert not any(c["op"] == "delete" for c in fake.calls)        # never deleted


def test_delete_topic_succeeds_when_unreferenced():
    fake = _FakeSupabase(responses={
        ("content_topics", "select"): [{"id": _TOPIC_ID}],
        ("vocab_cards", "select"): [],                              # count → 0
    })
    with patch.object(topic_service, "supabase_admin", fake):
        out = topic_service.delete_topic(_TOPIC_ID)
    assert out == {"id": _TOPIC_ID, "deleted": True}
    assert any(c["op"] == "delete" for c in fake.calls)


# ── bundle ───────────────────────────────────────────────────────────

def test_get_topic_bundle_shape():
    fake = _FakeSupabase(responses={
        ("content_topics", "select"): [{"id": _TOPIC_ID, "slug": "work-careers"}],
        ("vocab_cards", "select"): [{"id": "c1", "headword": "Vocation"}],
    })
    with patch.object(topic_service, "supabase_admin", fake):
        out = topic_service.get_topic_bundle(_TOPIC_ID)
    assert out["topic"]["slug"] == "work-careers"
    assert out["counts"] == {"vocab_cards": 1, "quiz_banks": 0}
    assert out["quiz_banks"] == []


# ── resolve_topic_id_for_category (P2: keep topic_id in sync on vocab writes) ──

def test_resolve_returns_existing_topic_id():
    fake = _FakeSupabase(responses={("content_topics", "select"): [{"id": "t-1"}]})
    with patch.object(topic_service, "supabase_admin", fake):
        tid = topic_service.resolve_topic_id_for_category("Work & Careers")
    assert tid == "t-1"
    assert not any(c["op"] == "insert" for c in fake.calls)   # found → no create


def test_resolve_creates_topic_when_missing():
    fake = _FakeSupabase(responses={
        ("content_topics", "select"): [],
        ("content_topics", "insert"): [{"id": "t-new"}],
    })
    with patch.object(topic_service, "supabase_admin", fake):
        tid = topic_service.resolve_topic_id_for_category("Brand New Topic")
    assert tid == "t-new"
    ins = next(c for c in fake.calls if c["op"] == "insert")
    assert ins["payload"]["slug"] == "brand-new-topic"
    assert ins["payload"]["skill_area"] == "vocab"


def test_resolve_blank_category_returns_none():
    fake = _FakeSupabase()
    with patch.object(topic_service, "supabase_admin", fake):
        assert topic_service.resolve_topic_id_for_category("   ") is None
    assert fake.calls == []   # no DB touched
