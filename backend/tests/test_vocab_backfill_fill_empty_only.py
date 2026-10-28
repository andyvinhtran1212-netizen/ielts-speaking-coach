"""Owner decision 2026-10-28 15:07 — the admin vocab enrichment backfill
(`routers.admin._backfill_run`) fills a column only when it is NULL, empty or
whitespace, and never overwrites an existing value. This holds for every
enriched column (ipa, example_sentence, definition_vi, definition_en).
`dry_run=true` lists, per row, the columns that would be filled, without a
Gemini call or a write."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from test_vocab_backfill_owner_cap import _FakeDb  # noqa: E402

_ENRICHED = {
    "ipa": "/new/",
    "example_sentence": "NEW example.",
    "definition_vi": "NEW vi",
    "definition_en": "NEW en",
}
_FIELDS = tuple(_ENRICHED)


def _row(rid, **cols):
    base = {"id": rid, "user_id": "owner", "headword": f"{rid}word", "is_archived": False}
    base.update({c: cols.get(c) for c in _FIELDS})
    return base


def _db(*rows):
    return _FakeDb(list(rows), [{"id": "owner", "is_active": True}])


def _by_id(db):
    return {r["id"]: r for r in db.tables["user_vocabulary"]}


@pytest.fixture
def backfill(monkeypatch):
    from routers import admin
    from services import vocab_enrichment

    asked: list[list[str]] = []

    def _fake_enrich(words):
        asked.append(list(words))
        return [{"headword": w, **_ENRICHED} for w in words]

    monkeypatch.setattr(vocab_enrichment, "enrich_vocabulary_batch", _fake_enrich)

    def _run(db, limit=500):
        monkeypatch.setattr(admin, "supabase_admin", db)
        admin._backfill_run("job-test", limit)
        return asked

    return _run


def test_existing_definition_stays_and_empty_definition_is_filled(backfill):
    db = _db(_row("r1", ipa="/old/", example_sentence="Old example.",
                  definition_vi="nghĩa cũ", definition_en=None))
    backfill(db)
    assert _by_id(db)["r1"] == _row(
        "r1", ipa="/old/", example_sentence="Old example.",
        definition_vi="nghĩa cũ", definition_en="NEW en",
    )


def test_empty_and_whitespace_values_count_as_empty_in_every_column(backfill):
    db = _db(
        _row("r1", ipa="", example_sentence="  \t", definition_vi="\n", definition_en=" "),
        _row("r2", ipa="/old/", example_sentence=" ", definition_vi="cũ", definition_en=""),
    )
    backfill(db)
    rows = _by_id(db)
    assert rows["r1"] == _row("r1", **_ENRICHED)
    assert rows["r2"] == _row("r2", ipa="/old/", example_sentence="NEW example.",
                              definition_vi="cũ", definition_en="NEW en")


def test_no_enriched_column_is_overwritten_when_all_have_values(backfill):
    full = dict(ipa="/old/", example_sentence="Old.", definition_vi="cũ", definition_en="old")
    db = _db(_row("full", **full), _row("gap", **{**full, "ipa": None}))
    asked = backfill(db)
    # The complete row is not even sent to Gemini.
    assert asked == [["gapword"]]
    rows = _by_id(db)
    assert rows["full"] == _row("full", **full)
    assert rows["gap"] == _row("gap", **{**full, "ipa": "/new/"})
    assert db.updated_ids == ["gap"]


def test_value_saved_after_the_scan_is_not_overwritten(backfill, monkeypatch):
    """The UPDATE itself is guarded by the emptiness filter."""
    from routers import admin

    db = _db(_row("r1"))
    real_select = admin._backfill_select_candidates

    def _select_then_learner_saves(job_id, limit):
        rows = real_select(job_id, limit)
        db.tables["user_vocabulary"][0]["definition_vi"] = "learner's own"
        return rows

    monkeypatch.setattr(admin, "_backfill_select_candidates", _select_then_learner_saves)
    backfill(db)
    assert _by_id(db)["r1"] == _row(
        "r1", ipa="/new/", example_sentence="NEW example.",
        definition_vi="learner's own", definition_en="NEW en",
    )


def test_dry_run_lists_columns_per_row_without_gemini_or_writes(monkeypatch):
    from routers import admin
    from services import vocab_enrichment

    def _no_gemini(_words):
        raise AssertionError("dry run must not call Gemini")

    async def _admin(_authorization):
        return {"id": "admin"}

    monkeypatch.setattr(vocab_enrichment, "enrich_vocabulary_batch", _no_gemini)
    monkeypatch.setattr(admin, "require_admin", _admin)
    db = _db(
        _row("r1", ipa="/old/", example_sentence="Old.", definition_vi="cũ", definition_en=" "),
        _row("r2"),
        _row("r3", ipa="/old/", example_sentence="Old.", definition_vi="cũ", definition_en="old"),
    )
    monkeypatch.setattr(admin, "supabase_admin", db)

    class _Tasks:
        def add_task(self, *_a, **_k):
            raise AssertionError("dry run must not queue the backfill")

    out = asyncio.run(admin.backfill_vocab_enrichment(
        background_tasks=_Tasks(), limit=10, dry_run=True, authorization="Bearer x",
    ))
    assert out["status"] == "dry_run"
    assert out["rows"] == [
        {"id": "r1", "user_id": "owner", "headword": "r1word", "would_fill": ["definition_en"]},
        {"id": "r2", "user_id": "owner", "headword": "r2word", "would_fill": list(_FIELDS)},
    ]
    assert out["row_count"] == 2
    assert out["column_counts"] == {
        "ipa": 1, "example_sentence": 1, "definition_vi": 1, "definition_en": 2,
    }
    assert db.updated_ids == []


def test_dry_run_candidate_failure_is_visible(monkeypatch):
    from fastapi import HTTPException
    from routers import admin

    async def _admin(_authorization):
        return {"id": "admin"}

    monkeypatch.setattr(admin, "require_admin", _admin)
    db = _db(_row("r1"))
    db.fail_tables.add("users")
    monkeypatch.setattr(admin, "supabase_admin", db)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(admin.backfill_vocab_enrichment(
            background_tasks=None, limit=10, dry_run=True, authorization="Bearer x",
        ))
    assert exc.value.status_code == 503
