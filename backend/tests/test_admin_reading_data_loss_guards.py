"""Báo cáo săn lỗi B1-11 / B1-12 / B1-13: hai đường làm mất dữ liệu Reading.

B1-11: DELETE /admin/reading/tests/{id} đếm lượt làm bằng count="exact"; khi
PostgREST không trả `count` (None) code cũ coi là 0 rồi xoá cứng, FK cascade
xoá luôn lượt làm của học viên.

B1-12 / B1-13: `reading_passages.slug` là khoá toàn bảng. Import L3 hoặc
L1/L2 "upsert theo slug" mà không xét chủ, nên ghi đè passage của đề khác và
bước thay câu hỏi xoá sạch câu hỏi của nó.
"""

from __future__ import annotations

import asyncio
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, UploadFile

from routers import admin_reading as ar


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.op, self.filters, self.payload = db, table, "select", [], None

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append((col, [val]))
        return self

    def in_(self, col, vals):
        self.filters.append((col, list(vals)))
        return self

    def limit(self, *_a):
        return self

    def order(self, *_a, **_k):
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def _match(self, row):
        return all(row.get(c) in vals for c, vals in self.filters)

    def execute(self):
        rows = self.db.rows.setdefault(self.table, [])
        self.db.ops.append((self.table, self.op))
        if self.op == "select":
            hit = [r for r in rows if self._match(r)]
            count = self.db.counts.get(self.table, len(hit))
            return SimpleNamespace(data=hit, count=count)
        if self.op == "insert":
            row = dict(self.payload, id=f"{self.table}-{len(rows) + 1}")
            rows.append(row)
            return SimpleNamespace(data=[row], count=None)
        if self.op == "update":
            for r in rows:
                if self._match(r):
                    r.update(self.payload)
            return SimpleNamespace(data=[r for r in rows if self._match(r)], count=None)
        keep = [r for r in rows if not self._match(r)]
        self.db.rows[self.table] = keep
        return SimpleNamespace(data=[], count=None)


class _DB:
    def __init__(self, rows=None, counts=None):
        self.rows, self.counts, self.ops = rows or {}, counts or {}, []

    def table(self, name):
        return _Q(self, name)

    def writes(self, table):
        return [op for t, op in self.ops if t == table and op != "select"]


@pytest.fixture
def wire(monkeypatch):
    def _wire(db):
        monkeypatch.setattr(ar, "supabase_admin", db)
        monkeypatch.setattr(ar, "require_admin", AsyncMock(return_value={"id": "admin-1"}))
        monkeypatch.setattr(ar, "active_exam_assignment_references", lambda *_a: [])
        monkeypatch.setattr(ar, "_fetch_admin_test_or_404", lambda tid: {"id": tid})
        return db
    return _wire


# ── B1-11 ────────────────────────────────────────────────────────────────────

def test_unknown_attempt_count_archives_instead_of_hard_deleting(wire):
    db = wire(_DB(rows={"reading_tests": [{"id": "t1", "status": "published"}]},
                  counts={"reading_test_attempts": None}))
    out = asyncio.run(ar.admin_delete_reading_test("t1", "auth"))
    assert out["action"] == "archived"
    assert "delete" not in db.writes("reading_tests")
    assert db.rows["reading_tests"][0]["status"] == "archived"


def test_known_zero_attempts_still_hard_deletes(wire):
    db = wire(_DB(rows={"reading_tests": [{"id": "t1", "status": "published"}]},
                  counts={"reading_test_attempts": 0}))
    out = asyncio.run(ar.admin_delete_reading_test("t1", "auth"))
    assert out["action"] == "deleted"
    assert db.rows["reading_tests"] == []


def test_count_none_but_a_row_seen_archives(wire):
    db = wire(_DB(rows={"reading_tests": [{"id": "t1"}],
                        "reading_test_attempts": [{"id": "a1", "test_id": "t1"}]},
                  counts={"reading_test_attempts": None}))
    out = asyncio.run(ar.admin_delete_reading_test("t1", "auth"))
    assert out["action"] == "archived" and out["attempts_preserved"] == 1


# ── B1-12 (L3) ───────────────────────────────────────────────────────────────

def _l3(monkeypatch, slugs):
    parsed = SimpleNamespace(test_id="CAM-NEW", as_preview=lambda: {})
    plan = {"test_row": {"test_id": "CAM-NEW", "title": "New"},
            "passage_rows": [{"slug": s, "title": s} for s in slugs],
            "passage_questions": [(s, [{"q_num": 1}]) for s in slugs]}
    monkeypatch.setattr(ar, "validate_reading_test", lambda _p: [])
    monkeypatch.setattr(ar, "build_reading_test_payloads", lambda _p: plan)
    monkeypatch.setattr(ar, "_snapshot_question_images", lambda _pid: {})
    return parsed


def test_l3_import_refuses_a_slug_owned_by_another_test_before_any_write(wire, monkeypatch):
    db = wire(_DB(rows={
        "reading_tests": [{"id": "old-test", "test_id": "CAM-OLD"}],
        "reading_passages": [{"id": "p-old", "slug": "shared", "test_id": "old-test"}],
        "reading_questions": [{"id": "q-old", "passage_id": "p-old"}],
    }))
    parsed = _l3(monkeypatch, ["shared"])
    with pytest.raises(HTTPException) as exc:
        asyncio.run(ar._commit_l3_parsed(parsed, False, {"id": "admin-1"}))
    assert exc.value.status_code == 409
    assert db.writes("reading_tests") == [] and db.writes("reading_passages") == []
    assert db.rows["reading_questions"] == [{"id": "q-old", "passage_id": "p-old"}]


def test_l3_reimport_of_its_own_passage_still_updates(wire, monkeypatch):
    db = wire(_DB(rows={
        "reading_tests": [{"id": "t-new", "test_id": "CAM-NEW"}],
        "reading_passages": [{"id": "p1", "slug": "mine", "test_id": "t-new"}],
    }))
    parsed = _l3(monkeypatch, ["mine"])
    out = asyncio.run(ar._commit_l3_parsed(parsed, False, {"id": "admin-1"}))
    assert out["action"] == "updated"
    assert db.rows["reading_passages"][0]["title"] == "mine"


# ── B1-13 (L1/L2) ────────────────────────────────────────────────────────────

def test_l1_import_refuses_to_take_over_an_l3_passage(wire, monkeypatch):
    db = wire(_DB(rows={
        "reading_passages": [{"id": "p-l3", "slug": "shared", "test_id": "some-test"}],
        "reading_questions": [{"id": "q-l3", "passage_id": "p-l3"}],
    }))
    parsed = SimpleNamespace(slug="shared", title="x", questions=[], image_url=None,
                             as_preview=lambda: {})
    monkeypatch.setattr(ar, "_split_frontmatter", lambda _t: ({"content_type": "reading_passage_l1"}, ""))
    monkeypatch.setattr(ar, "parse_reading_passage", lambda _t: parsed)
    monkeypatch.setattr(ar, "validate_reading_passage", lambda _p: [])
    monkeypatch.setattr(ar, "build_reading_passage_payload", lambda _p, slug: {"slug": slug})
    upload = UploadFile(BytesIO(b"---\ncontent_type: reading_passage_l1\n---\n"), filename="a.md")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(ar.import_reading_content(upload, False, "auth"))
    assert exc.value.status_code == 409
    assert db.writes("reading_passages") == []
    assert db.rows["reading_questions"] == [{"id": "q-l3", "passage_id": "p-l3"}]
