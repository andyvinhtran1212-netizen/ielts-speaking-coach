"""INACTIVEWRITE-0035 follow-up — the admin IPA/enrichment backfill
(`routers.admin._backfill_run`) enriches at most 50 rows per owner per run and
never enriches rows of an inactive owner (is_active false, NULL or no users
row). A failed owner lookup aborts the run before any Gemini call."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters, self.window, self.order_col = [], None, None
        self.payload = None

    def select(self, _cols):
        return self

    def eq(self, col, val):
        self.filters.append(lambda r: r.get(col) == val)
        return self

    def in_(self, col, vals):
        vals = set(vals)
        self.filters.append(lambda r: r.get(col) in vals)
        return self

    def or_(self, expr):
        cols = [part.split(".")[0] for part in expr.split(",") if part]
        self.filters.append(lambda r: any(r.get(c) is None for c in cols))
        return self

    def order(self, col):
        self.order_col = col
        return self

    def range(self, start, end):
        self.window = (start, end)
        return self

    def update(self, payload):
        self.payload = payload
        return self

    def execute(self):
        self.db.calls.append(self.table)
        if self.table in self.db.fail_tables:
            raise RuntimeError(f"{self.table} unavailable")
        rows = [r for r in self.db.tables[self.table] if all(f(r) for f in self.filters)]
        if self.payload is not None:
            for r in rows:
                r.update(self.payload)
                self.db.updated_ids.append(r["id"])
            return _Result(rows)
        if self.order_col:
            rows.sort(key=lambda r: r[self.order_col])
        if self.window:
            rows = rows[self.window[0]:self.window[1] + 1]
        return _Result([dict(r) for r in rows])


class _FakeDb:
    def __init__(self, vocab, users):
        self.tables = {"user_vocabulary": vocab, "users": users}
        self.calls: list[str] = []
        self.updated_ids: list[str] = []
        self.fail_tables: set[str] = set()

    def table(self, name):
        return _Query(self, name)


def _vocab(owner, n, prefix=None):
    prefix = prefix or owner
    return [
        {"id": f"{prefix}-{i:04d}", "user_id": owner, "headword": f"{prefix}word{i}",
         "is_archived": False, "ipa": None, "example_sentence": None,
         "definition_vi": None, "definition_en": None}
        for i in range(n)
    ]


@pytest.fixture
def backfill(monkeypatch):
    from routers import admin
    from services import vocab_enrichment

    asked: list[list[str]] = []

    def _fake_enrich(words):
        asked.append(list(words))
        return [{"headword": w, "ipa": "/x/", "example_sentence": f"{w} ex."} for w in words]

    monkeypatch.setattr(vocab_enrichment, "enrich_vocabulary_batch", _fake_enrich)

    def _run(db, limit=500):
        monkeypatch.setattr(admin, "supabase_admin", db)
        admin._backfill_run("job-test", limit)
        return asked

    return _run


def _owners(db):
    by_id = {r["id"]: r["user_id"] for r in db.tables["user_vocabulary"]}
    counts: dict[str, int] = {}
    for rid in db.updated_ids:
        counts[by_id[rid]] = counts.get(by_id[rid], 0) + 1
    return counts


def test_one_owner_gets_at_most_50_rows_per_run_and_others_still_get_theirs(backfill):
    # The spammer's ids sort first, so without the cap they would fill the batch.
    db = _FakeDb(
        _vocab("a-spam", 400) + _vocab("b-learner", 30) + _vocab("c-learner", 70),
        [{"id": "a-spam", "is_active": True}, {"id": "b-learner", "is_active": True},
         {"id": "c-learner", "is_active": True}],
    )
    backfill(db, limit=500)
    assert _owners(db) == {"a-spam": 50, "b-learner": 30, "c-learner": 50}


def test_inactive_null_and_missing_owners_are_never_enriched(backfill):
    db = _FakeDb(
        _vocab("a-inactive", 5) + _vocab("b-null", 5) + _vocab("c-missing", 5)
        + _vocab("d-active", 5),
        [{"id": "a-inactive", "is_active": False}, {"id": "b-null", "is_active": None},
         {"id": "d-active", "is_active": True}],
    )
    asked = backfill(db)
    assert _owners(db) == {"d-active": 5}
    assert asked == [[f"d-activeword{i}" for i in range(5)]]


def test_limit_still_bounds_the_run_after_the_owner_cap(backfill):
    db = _FakeDb(
        _vocab("a", 60) + _vocab("b", 60),
        [{"id": "a", "is_active": True}, {"id": "b", "is_active": True}],
    )
    backfill(db, limit=70)
    assert _owners(db) == {"a": 50, "b": 20}


def test_scan_pages_past_skipped_rows(backfill, monkeypatch):
    from routers import admin

    monkeypatch.setattr(admin, "_BACKFILL_SCAN_PAGE_SIZE", 10)
    db = _FakeDb(
        _vocab("a-inactive", 25) + _vocab("b-active", 3),
        [{"id": "a-inactive", "is_active": False}, {"id": "b-active", "is_active": True}],
    )
    backfill(db)
    assert _owners(db) == {"b-active": 3}


def test_owner_lookup_failure_aborts_before_any_gemini_call(backfill):
    db = _FakeDb(_vocab("a", 5), [{"id": "a", "is_active": True}])
    db.fail_tables.add("users")
    asked = backfill(db)
    assert asked == []
    assert db.updated_ids == []
