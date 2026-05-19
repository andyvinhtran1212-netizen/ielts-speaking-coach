"""Tests for Sprint 12.6 — admin D1 question curation endpoints.

Endpoints under test (routers/admin.py):
    GET    /admin/vocab/d1-questions       — list + filter + pagination
    PATCH  /admin/vocab/d1-questions/{id}  — edit fields / toggle is_active
    DELETE /admin/vocab/d1-questions/{id}  — soft delete (is_active=false)

The fake Supabase client mirrors test_admin_cohorts.py with extensions
for the `range()`, `ilike()`, and count='exact' patterns the D1 router
exercises.
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
        self.in_filter: tuple[str, list] | None = None
        self.limit_n = None
        self._range: tuple[int, int] | None = None
        self._order_field = None
        self._order_desc = False

    def select(self, *_args, count=None, **_kw):
        self._mode = "select"
        self._count_mode = count
        return self

    def insert(self, payload):
        self._mode = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._mode = "update"
        self._update = payload
        return self

    def delete(self):
        self._mode = "delete"
        return self

    def eq(self, field, value):
        self.filters.append((field, "eq", value))
        return self

    def in_(self, field, values):
        self.in_filter = (field, list(values))
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
        self._order_field = field
        self._order_desc = bool(desc)
        return self

    def execute(self):
        rows = self.fake.tables.setdefault(self.table_name, [])

        if self._mode == "insert":
            new = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = []
            for r in new:
                row = dict(r)
                row.setdefault("id", str(uuid4()))
                rows.append(row)
                inserted.append(row)
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

        # select
        if self._order_field:
            matched = sorted(
                matched,
                key=lambda r: r.get(self._order_field) or "",
                reverse=self._order_desc,
            )
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
        if self.in_filter:
            field, values = self.in_filter
            if row.get(field) not in values:
                return False
        return True


class _FakeSupabase:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {
            "user_d1_questions": [],
            "user_vocabulary": [],
        }

    def table(self, name: str):
        return _TableQuery(self, name)


_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}


@pytest.fixture
def fake_db(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr("routers.admin.supabase_admin", fake)
    return fake


@pytest.fixture
def client(fake_db):
    from main import app
    with patch("routers.admin.require_admin", new=AsyncMock(return_value=_ADMIN_USER)):
        with TestClient(app) as c:
            yield c


def _seed_question(fake_db, **overrides):
    q = {
        "id": str(uuid4()),
        "user_id":           overrides.get("user_id") or str(uuid4()),
        "vocabulary_id":     overrides.get("vocabulary_id") or str(uuid4()),
        "context_sentence":  overrides.get("context_sentence", "I want to ____ my skills."),
        "target_answer":     overrides.get("target_answer", "improve"),
        "acceptable_variants": overrides.get("acceptable_variants", []),
        "hint":               overrides.get("hint", "verb meaning to get better"),
        "source_evidence_substring": overrides.get("source_evidence_substring"),
        "generated_by":       overrides.get("generated_by", "haiku"),
        "generated_at":       overrides.get("generated_at", "2026-05-19T00:00:00Z"),
        "is_active":          overrides.get("is_active", True),
        "attempt_count":      overrides.get("attempt_count", 0),
        "last_used_at":       overrides.get("last_used_at"),
        "created_at":         overrides.get("created_at", "2026-05-19T00:00:00Z"),
    }
    fake_db.tables["user_d1_questions"].append(q)
    return q


# ── GET /admin/vocab/d1-questions ──────────────────────────────────


class TestD1List:
    def test_list_returns_items_with_total(self, client, fake_db):
        _seed_question(fake_db, generated_by="haiku")
        _seed_question(fake_db, generated_by="fallback_evidence")

        r = client.get("/admin/vocab/d1-questions", headers=_ADMIN_AUTH)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total"] == 2
        assert len(body["items"]) == 2
        assert body["offset"] == 0

    def test_filter_by_source_returns_only_haiku(self, client, fake_db):
        _seed_question(fake_db, generated_by="haiku")
        _seed_question(fake_db, generated_by="fallback_evidence")
        _seed_question(fake_db, generated_by="gemini")

        r = client.get("/admin/vocab/d1-questions?source=haiku", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["generated_by"] == "haiku"

    def test_filter_active_true_excludes_archived(self, client, fake_db):
        _seed_question(fake_db, is_active=True)
        _seed_question(fake_db, is_active=False)

        r = client.get("/admin/vocab/d1-questions?active=true", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        assert all(i["is_active"] is True for i in r.json()["items"])

    def test_filter_active_false_returns_only_archived(self, client, fake_db):
        _seed_question(fake_db, is_active=True)
        _seed_question(fake_db, is_active=False)

        r = client.get("/admin/vocab/d1-questions?active=false", headers=_ADMIN_AUTH)
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["is_active"] is False

    def test_filter_by_user_id(self, client, fake_db):
        target = str(uuid4())
        _seed_question(fake_db, user_id=target)
        _seed_question(fake_db, user_id=str(uuid4()))

        r = client.get(f"/admin/vocab/d1-questions?user_id={target}", headers=_ADMIN_AUTH)
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["user_id"] == target

    def test_headword_hydration(self, client, fake_db):
        vocab_id = str(uuid4())
        fake_db.tables["user_vocabulary"].append(
            {"id": vocab_id, "headword": "improve"}
        )
        _seed_question(fake_db, vocabulary_id=vocab_id, target_answer="improve")

        r = client.get("/admin/vocab/d1-questions", headers=_ADMIN_AUTH)
        assert r.status_code == 200
        items = r.json()["items"]
        assert items[0]["headword"] == "improve"

    def test_pagination_offset_limit(self, client, fake_db):
        for _ in range(5):
            _seed_question(fake_db)

        r = client.get("/admin/vocab/d1-questions?offset=2&limit=2", headers=_ADMIN_AUTH)
        body = r.json()
        assert body["total"] == 5
        assert len(body["items"]) == 2
        assert body["offset"] == 2


# ── PATCH /admin/vocab/d1-questions/{id} ───────────────────────────


class TestD1Patch:
    def test_patch_updates_context_and_target(self, client, fake_db):
        q = _seed_question(fake_db)
        r = client.patch(
            f"/admin/vocab/d1-questions/{q['id']}",
            json={"context_sentence": "I want to ____ my work.", "target_answer": "boost"},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert "context_sentence" in body["updated_fields"]
        # Verify in-memory row updated
        row = fake_db.tables["user_d1_questions"][0]
        assert row["context_sentence"] == "I want to ____ my work."
        assert row["target_answer"] == "boost"

    def test_patch_toggle_is_active(self, client, fake_db):
        q = _seed_question(fake_db, is_active=True)
        r = client.patch(
            f"/admin/vocab/d1-questions/{q['id']}",
            json={"is_active": False},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 200
        assert fake_db.tables["user_d1_questions"][0]["is_active"] is False

    def test_patch_empty_payload_returns_400(self, client, fake_db):
        q = _seed_question(fake_db)
        r = client.patch(
            f"/admin/vocab/d1-questions/{q['id']}",
            json={},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 400

    def test_patch_missing_row_returns_404(self, client, fake_db):
        r = client.patch(
            f"/admin/vocab/d1-questions/{uuid4()}",
            json={"is_active": False},
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 404


# ── DELETE /admin/vocab/d1-questions/{id} (soft delete) ────────────


class TestD1Delete:
    def test_soft_delete_flips_is_active(self, client, fake_db):
        q = _seed_question(fake_db, is_active=True)
        r = client.delete(
            f"/admin/vocab/d1-questions/{q['id']}",
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 204
        # Row still present, just is_active=False
        rows = fake_db.tables["user_d1_questions"]
        assert len(rows) == 1
        assert rows[0]["is_active"] is False

    def test_soft_delete_missing_row_returns_404(self, client):
        r = client.delete(
            f"/admin/vocab/d1-questions/{uuid4()}",
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 404
