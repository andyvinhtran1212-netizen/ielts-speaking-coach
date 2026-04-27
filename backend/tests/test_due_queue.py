"""
Tests for the due-card queue helper used by GET /api/flashcards/due.

These exercise pure logic — no DB, no auth — by calling the helper in
routers/flashcards.py with synthetic review rows.  The live DB ordering is
verified indirectly via the index on (user_id, next_review_at) created in
migration 027.

Filled in step 4 of Phase D Wave 2 once routers/flashcards.py exists.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest


def _import_flashcards():
    try:
        from routers import flashcards as fc  # type: ignore
        return fc
    except Exception:
        pytest.skip("routers.flashcards not yet implemented (step 4)")


# Reference 'now' so test fixtures compute deterministic offsets.
from datetime import datetime, timedelta, timezone

NOW = datetime(2026, 4, 27, 12, 0, 0, tzinfo=timezone.utc)


def _row(vocab_id: str, next_review_at: datetime) -> dict:
    return {
        "vocabulary_id": vocab_id,
        "next_review_at": next_review_at.isoformat(),
        "ease_factor": 2.5,
        "interval_days": 1,
    }


# ── Filtering: only due cards surface ────────────────────────────────────────


def test_due_returns_only_due_cards():
    fc = _import_flashcards()
    if not hasattr(fc, "_filter_due_rows"):
        pytest.skip("_filter_due_rows helper not exported yet")

    rows = [
        _row("a", NOW - timedelta(days=2)),  # due
        _row("b", NOW - timedelta(hours=1)), # due
        _row("c", NOW + timedelta(days=1)),  # NOT due
        _row("d", NOW + timedelta(minutes=5)),  # NOT due
    ]
    out = fc._filter_due_rows(rows, now=NOW)
    assert {r["vocabulary_id"] for r in out} == {"a", "b"}


# ── Ordering: earliest-due first ─────────────────────────────────────────────


def test_due_orders_by_next_review_at():
    fc = _import_flashcards()
    if not hasattr(fc, "_filter_due_rows"):
        pytest.skip("_filter_due_rows helper not exported yet")

    rows = [
        _row("late",   NOW - timedelta(hours=1)),
        _row("early",  NOW - timedelta(days=3)),
        _row("middle", NOW - timedelta(days=1)),
    ]
    out = fc._filter_due_rows(rows, now=NOW)
    assert [r["vocabulary_id"] for r in out] == ["early", "middle", "late"]


# ── Pagination: limit honored ────────────────────────────────────────────────


def test_due_pagination():
    fc = _import_flashcards()
    if not hasattr(fc, "_filter_due_rows"):
        pytest.skip("_filter_due_rows helper not exported yet")

    rows = [_row(f"v{i}", NOW - timedelta(days=i + 1)) for i in range(50)]
    out = fc._filter_due_rows(rows, now=NOW, limit=20)
    assert len(out) == 20
    # Earliest-due first — v49 was the oldest (50 days back).
    assert out[0]["vocabulary_id"] == "v49"


# ── Empty state: brand-new user ──────────────────────────────────────────────


def test_due_empty_for_new_user():
    fc = _import_flashcards()
    if not hasattr(fc, "_filter_due_rows"):
        pytest.skip("_filter_due_rows helper not exported yet")
    assert fc._filter_due_rows([], now=NOW) == []
