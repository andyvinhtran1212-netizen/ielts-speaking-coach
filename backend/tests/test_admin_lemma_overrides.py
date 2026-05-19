"""Tests for Sprint 12.6 — admin lemma override CRUD.

Endpoints under test (routers/admin.py):
    GET    /admin/vocab/lemmas/overrides
    POST   /admin/vocab/lemmas/overrides
    DELETE /admin/vocab/lemmas/overrides/{id}

Plus: the create + delete handlers must call lemmatizer.reload_overrides()
so the running worker picks up the change without a restart.
"""

from __future__ import annotations

from uuid import uuid4
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


class _Resp:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _TableQuery:
    def __init__(self, fake, table_name):
        self.fake = fake
        self.table_name = table_name
        self._mode = "select"
        self._payload = None
        self._update = None
        self._count_mode = None
        self.filters: list[tuple[str, str, object]] = []
        self._range: tuple[int, int] | None = None
        self._order_field = None
        self._order_desc = False
        self.limit_n = None

    def select(self, *_args, count=None, **_kw):
        self._mode = "select"; self._count_mode = count
        return self

    def insert(self, payload):
        # Honour the UNIQUE constraint on original_word
        existing_words = {r.get("original_word") for r in self.fake.tables.get(self.table_name, [])}
        if isinstance(payload, dict) and payload.get("original_word") in existing_words:
            raise Exception("duplicate key value violates unique constraint")
        self._mode = "insert"; self._payload = payload
        return self

    def update(self, payload):
        self._mode = "update"; self._update = payload
        return self

    def delete(self):
        self._mode = "delete"
        return self

    def eq(self, field, value):
        self.filters.append((field, "eq", value))
        return self

    def ilike(self, field, pattern):
        self.filters.append((field, "ilike", pattern))
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def range(self, lo, hi):
        self._range = (lo, hi)
        return self

    def order(self, field, desc=False):
        self._order_field = field; self._order_desc = bool(desc)
        return self

    def execute(self):
        rows = self.fake.tables.setdefault(self.table_name, [])

        if self._mode == "insert":
            new = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = []
            for r in new:
                row = dict(r)
                row.setdefault("id", str(uuid4()))
                row.setdefault("created_at", "2026-05-19T00:00:00Z")
                rows.append(row); inserted.append(row)
            return _Resp(inserted)

        matched = [r for r in rows if self._matches(r)]

        if self._mode == "update":
            for r in matched:
                r.update(self._update or {})
            return _Resp(matched)
        if self._mode == "delete":
            for r in matched:
                rows.remove(r)
            return _Resp(matched)

        if self._order_field:
            matched = sorted(matched, key=lambda r: r.get(self._order_field) or "",
                             reverse=self._order_desc)
        count = len(matched) if self._count_mode == "exact" else None
        if self._range is not None:
            lo, hi = self._range
            matched = matched[lo : hi + 1]
        elif self.limit_n is not None:
            matched = matched[: self.limit_n]
        return _Resp(matched, count=count)

    def _matches(self, row):
        for field, op, value in self.filters:
            v = row.get(field)
            if op == "eq" and v != value:
                return False
            if op == "ilike":
                pat = (value or "").lower().replace("%", "")
                if not (v or "").lower().startswith(pat):
                    return False
        return True


class _FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {"lemma_overrides": []}

    def table(self, name):
        return _TableQuery(self, name)


_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa"}
_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}


@pytest.fixture
def fake_db(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr("routers.admin.supabase_admin", fake)
    return fake


@pytest.fixture
def reload_spy(monkeypatch):
    """Spy on services.lemmatizer.reload_overrides so we can assert
    create + delete handlers fire it without restarting the worker."""
    calls = {"n": 0}

    def fake_reload():
        calls["n"] += 1

    monkeypatch.setattr("services.lemmatizer.reload_overrides", fake_reload)
    return calls


@pytest.fixture
def client(fake_db):
    from main import app
    with patch("routers.admin.require_admin", new=AsyncMock(return_value=_ADMIN_USER)):
        with TestClient(app) as c:
            yield c


# ── GET ────────────────────────────────────────────────────────────


class TestLemmaList:
    def test_list_empty(self, client):
        r = client.get("/admin/vocab/lemmas/overrides", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 0
        assert body["items"] == []

    def test_list_returns_seeded_rows(self, client, fake_db):
        fake_db.tables["lemma_overrides"] = [
            {"id": "a", "original_word": "phở", "lemma": "phở", "pos_tag": "NOUN",
             "notes": "loanword", "created_at": "2026-05-19T00:00:00Z"},
        ]
        r = client.get("/admin/vocab/lemmas/overrides", headers=_ADMIN_AUTH)
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["original_word"] == "phở"

    def test_search_prefix_filters_rows(self, client, fake_db):
        fake_db.tables["lemma_overrides"] = [
            {"id": "a", "original_word": "phở",   "lemma": "phở",
             "created_at": "2026-05-19T00:00:00Z"},
            {"id": "b", "original_word": "data",  "lemma": "data",
             "created_at": "2026-05-19T00:00:00Z"},
        ]
        r = client.get("/admin/vocab/lemmas/overrides?search=ph", headers=_ADMIN_AUTH)
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["original_word"] == "phở"


# ── POST ───────────────────────────────────────────────────────────


class TestLemmaCreate:
    def test_create_lowercases_original_word(self, client, fake_db, reload_spy):
        r = client.post(
            "/admin/vocab/lemmas/overrides",
            json={"original_word": "DATA", "lemma": "data", "pos_tag": "NOUN"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["item"]["original_word"] == "data"
        assert body["item"]["lemma"] == "data"
        assert body["item"]["pos_tag"] == "NOUN"
        # reload_overrides() must have been called once
        assert reload_spy["n"] == 1

    def test_create_duplicate_returns_409(self, client, fake_db, reload_spy):
        fake_db.tables["lemma_overrides"].append({
            "id": str(uuid4()), "original_word": "phở", "lemma": "phở",
        })
        r = client.post(
            "/admin/vocab/lemmas/overrides",
            json={"original_word": "phở", "lemma": "phở"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 409

    def test_create_rejects_blank_lemma(self, client):
        r = client.post(
            "/admin/vocab/lemmas/overrides",
            json={"original_word": "x", "lemma": ""},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 422


# ── DELETE ─────────────────────────────────────────────────────────


class TestLemmaDelete:
    def test_delete_removes_row_and_calls_reload(self, client, fake_db, reload_spy):
        override_id = str(uuid4())
        fake_db.tables["lemma_overrides"].append({
            "id": override_id, "original_word": "phở", "lemma": "phở",
        })
        r = client.delete(
            f"/admin/vocab/lemmas/overrides/{override_id}",
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 204
        assert fake_db.tables["lemma_overrides"] == []
        assert reload_spy["n"] == 1

    def test_delete_missing_returns_404(self, client, reload_spy):
        r = client.delete(
            f"/admin/vocab/lemmas/overrides/{uuid4()}",
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 404
        # No mutation, no reload
        assert reload_spy["n"] == 0
