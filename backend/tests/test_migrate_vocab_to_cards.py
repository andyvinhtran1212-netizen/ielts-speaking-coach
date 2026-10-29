"""PC-J33 — scripts/migrate_vocab_to_cards.py is a dry run unless --commit, and an
update never overwrites a column the row already has with an empty value from
the markdown file (absent optional key → "" / []).

No live DB: an in-memory fake replaces supabase_admin and records every write."""

from __future__ import annotations

import copy

import pytest

from scripts import migrate_vocab_to_cards as mig

# Source file without definition_en / example / collocations / memory_hook keys.
_MD = """---
headword: "Cutting-edge"
slug: "cutting-edge"
category: "technology"
level: "B2"
synonyms: ["advanced", "pioneering"]
---

**Tiên tiến nhất** — ở vị trí tiền tiêu của sự phát triển.
"""

_NEW_MD = _MD.replace("cutting-edge", "obsolete").replace("Cutting-edge", "Obsolete")

_STAMP = "2026-10-28T07:42:00.123456+00:00"


def _enriched_row(**over):
    """A shared row enriched after its first import (V-FILL / CM PATCH)."""
    row = {
        "id": "row-1", "slug": "cutting-edge", "category": "technology",
        "headword": "Cutting-edge", "level": "B2", "part_of_speech": "adjective",
        "definition_en": "the most advanced stage of development",
        "example": "Universities invest in cutting-edge research.",
        "memory_hook": "the blade's edge leads",
        "collocations": ["cutting-edge technology"],
        "synonyms": ["advanced", "pioneering"],
        "source": "L03 Group A", "topic_id": "topic-tech",
        "updated_at": _STAMP,
    }
    row.update(over)
    return row


class _Query:
    def __init__(self, db, table):
        self.db, self.table, self.op, self.body, self.filters = db, table, "select", None, []

    def select(self, *_a, **_k):
        self.op = "select"
        return self

    def insert(self, body):
        self.op, self.body = "insert", body
        return self

    def update(self, body):
        self.op, self.body = "update", body
        return self

    def eq(self, col, val):
        self.filters.append((col, val))
        return self

    def limit(self, _n):
        return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        hit = [r for r in rows if all(r.get(c) == v for c, v in self.filters)]
        if self.op == "select":
            return _Result(copy.deepcopy(hit))
        self.db.writes.append((self.op, self.table, copy.deepcopy(self.body), list(self.filters)))
        if self.op == "insert":
            rows.append(dict(self.body))
            return _Result([dict(self.body)])
        for r in hit:
            r.update(self.body)
        return _Result(copy.deepcopy(hit))


class _Result:
    def __init__(self, data):
        self.data = data


class _FakeDb:
    def __init__(self, *rows):
        self.tables = {"vocab_cards": [dict(r) for r in rows]}
        self.writes: list = []

    def table(self, name):
        return _Query(self, name)


@pytest.fixture
def run(monkeypatch, tmp_path):
    """Point the script at a tmp content dir and a fake DB; returns a runner."""
    resolved: list[str] = []

    def _resolve(category):
        resolved.append(category)
        return f"topic-{category}"

    monkeypatch.setattr(mig, "resolve_topic_id_for_category", _resolve)
    monkeypatch.setattr(mig, "CONTENT_DIR", tmp_path)

    def _run(db, files, *argv):
        for name, text in files.items():
            (tmp_path / name).write_text(text, encoding="utf-8")
        monkeypatch.setattr(mig, "supabase_admin", db)
        return mig.main(list(argv)), resolved

    return _run


def test_default_is_dry_run_with_zero_writes(run):
    db = _FakeDb(_enriched_row(definition_en="", source=""))
    summary, resolved = run(db, {"a.md": _MD, "b.md": _NEW_MD})
    assert db.writes == []
    assert resolved == []          # resolving a topic may create one → commit only
    assert summary["actions"] == {"update": 1, "insert": 1}
    # Absent keys are reported as kept, never as columns to write.
    assert {"example", "memory_hook", "collocations", "part_of_speech"} <= set(summary["kept"])
    assert "definition_en" not in summary["kept"] and "definition_en" not in summary["fill"]


def test_dry_run_lists_fill_and_replace_per_row(monkeypatch):
    db = _FakeDb(_enriched_row(gloss_vi="", body_html="<p>old</p>", topic_id=None))
    monkeypatch.setattr(mig, "supabase_admin", db)
    res = mig.migrate_file(_MD, commit=False)
    assert res["action"] == "update"
    assert set(res["fill"]) == {"gloss_vi", "topic_id"}
    assert res["replace"] == ["body_html"]
    assert db.writes == []


def test_commit_keeps_enriched_columns_absent_from_the_file(run):
    db = _FakeDb(_enriched_row(gloss_vi="", body_html=""))
    run(db, {"a.md": _MD}, "--commit")

    assert len(db.writes) == 1
    op, _table, body, filters = db.writes[0]
    assert op == "update"
    assert set(body) == {"gloss_vi", "body_html"}         # only the empty columns
    assert ("id", "row-1") in filters and ("updated_at", _STAMP) in filters

    row = db.tables["vocab_cards"][0]
    assert row["definition_en"] == "the most advanced stage of development"
    assert row["example"] == "Universities invest in cutting-edge research."
    assert row["memory_hook"] == "the blade's edge leads"
    assert row["collocations"] == ["cutting-edge technology"]
    assert row["part_of_speech"] == "adjective"
    assert row["source"] == "L03 Group A"
    assert row["topic_id"] == "topic-tech"
    assert row["gloss_vi"].startswith("Tiên tiến nhất")


def test_commit_replaces_a_column_only_with_a_non_empty_new_value(run):
    md = _MD.replace('level: "B2"', 'level: "C1"\nexample: "A cutting-edge lab."')
    db = _FakeDb(_enriched_row())
    run(db, {"a.md": md}, "--commit")
    row = db.tables["vocab_cards"][0]
    assert row["level"] == "C1"
    assert row["example"] == "A cutting-edge lab."
    assert row["definition_en"] == "the most advanced stage of development"


def test_commit_keeps_lesson_source_against_non_lesson_value(run):
    md = _MD.replace('level: "B2"', 'level: "B2"\nsource: "AWL"')
    db = _FakeDb(_enriched_row())
    summary, _ = run(db, {"a.md": md}, "--commit")
    assert db.tables["vocab_cards"][0]["source"] == "L03 Group A"
    assert summary["kept"]["source"] == 1


def test_commit_inserts_new_rows_with_full_payload_and_topic(run):
    db = _FakeDb()
    summary, resolved = run(db, {"b.md": _NEW_MD}, "--commit")
    assert summary["actions"] == {"insert": 1}
    assert resolved == ["technology"]
    [(op, _t, body, _f)] = db.writes
    assert op == "insert"
    assert body["slug"] == "obsolete" and body["topic_id"] == "topic-technology"
    assert body["synonyms"] == ["advanced", "pioneering"]


def test_unchanged_row_is_not_written(run):
    db = _FakeDb()
    run(db, {"b.md": _NEW_MD}, "--commit")
    db.writes.clear()
    db.tables["vocab_cards"][0]["updated_at"] = _STAMP
    summary, _ = run(db, {"b.md": _NEW_MD}, "--commit")
    assert summary["actions"] == {"unchanged": 1}
    assert db.writes == []


def test_row_edited_after_the_read_is_a_conflict_not_an_overwrite(run, monkeypatch):
    db = _FakeDb(_enriched_row(gloss_vi=""))
    real_fetch = mig._fetch_row

    def _fetch_then_edit(category, slug):
        row = real_fetch(category, slug)
        db.tables["vocab_cards"][0].update(gloss_vi="CM gloss", updated_at="later")
        return row

    monkeypatch.setattr(mig, "_fetch_row", _fetch_then_edit)
    summary, _ = run(db, {"a.md": _MD}, "--commit")
    assert summary["actions"] == {"conflict": 1}
    assert db.tables["vocab_cards"][0]["gloss_vi"] == "CM gloss"


def test_invalid_file_is_skipped_and_counted(run):
    db = _FakeDb()
    summary, _ = run(db, {"bad.md": "no frontmatter", "b.md": _NEW_MD}, "--commit")
    assert summary["actions"] == {"error": 1, "insert": 1}


@pytest.mark.parametrize("value,empty", [
    (None, True), ("", True), ("  \n", True), ([], True), ({}, True),
    ("x", False), (["x"], False), (0, False),
])
def test_is_empty(value, empty):
    assert mig._is_empty(value) is empty
