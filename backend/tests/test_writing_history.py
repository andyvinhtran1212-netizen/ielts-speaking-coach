"""Tests for services.writing_history (Phase 1.5a Phase 1).

Pin the aggregator + prompt formatter against four shapes:

  1. Below threshold (< MIN_HISTORY_ESSAYS) → return None.
  2. ≥ threshold with repeated mistakeType → patterns dict, sorted desc.
  3. One-off mistakes (count == 1) → filtered out (must not pollute prompt).
  4. DB error → return None (degrade gracefully so grading still runs).

Plus two formatter tests:
  5. Empty / None input → "" (so unconditional join in grader is safe).
  6. Populated patterns → Vietnamese block with mistakeType + count
     + examples + the recurringPatterns output schema instruction.

The supabase_admin mock chains exactly the call the service makes:
.table().select().eq().order().limit().execute() — any deviation
should fail the test (real signal that the service started using a
different query shape).
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.writing_history import (
    MIN_HISTORY_ESSAYS,
    format_history_for_prompt,
    get_recurring_patterns,
)


# ── Helpers ──────────────────────────────────────────────────────────


def _mock_db_returning(rows: list[dict] | None = None, *, raises: Exception | None = None):
    """Build a mock supabase_admin whose chained query returns `rows`
    (or raises on .execute() if `raises` is set)."""
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value
    if raises is not None:
        chain.execute.side_effect = raises
    else:
        chain.execute.return_value = MagicMock(data=rows or [])
    return mock_db


# ── Aggregator tests ─────────────────────────────────────────────────


def test_returns_none_when_history_below_threshold():
    """3 essays < MIN_HISTORY_ESSAYS (5) ⇒ None, no aggregation."""
    rows = [{"feedback_json": {"mistakeAnalysis": []}} for _ in range(3)]
    with patch("services.writing_history.supabase_admin", _mock_db_returning(rows)):
        assert get_recurring_patterns("student-uuid") is None


def test_aggregates_recurring_mistakes():
    """5 essays × 2 Article + 1 Word Choice each → Article wins by count."""
    sample = {
        "mistakeAnalysis": [
            {"mistakeType": "Grammar - Article",
             "original": "the others", "criterion": "GRA"},
            {"mistakeType": "Grammar - Article",
             "original": "the things", "criterion": "GRA"},
            {"mistakeType": "Word Choice",
             "original": "terrible", "criterion": "LR"},
        ]
    }
    rows = [{"feedback_json": sample} for _ in range(MIN_HISTORY_ESSAYS)]
    with patch("services.writing_history.supabase_admin", _mock_db_returning(rows)):
        result = get_recurring_patterns("student-uuid")

    assert result is not None
    assert result["essays_analyzed"] == MIN_HISTORY_ESSAYS
    assert len(result["patterns"]) >= 2

    top = result["patterns"][0]
    assert top["mistakeType"] == "Grammar - Article"
    assert top["count"] == 2 * MIN_HISTORY_ESSAYS  # 2 per essay × 5 = 10
    assert top["criterion"] == "GRA"
    # Examples deduplicate + cap at MAX_EXAMPLES_PER_TYPE (3) — only two
    # distinct originals exist in fixture so both should appear.
    assert set(top["examples"]) == {"the others", "the things"}


def test_filters_one_off_mistakes():
    """Count==1 must NOT appear in patterns — single-incident is noise."""
    one_off = {
        "mistakeAnalysis": [
            {"mistakeType": "OneOff", "original": "x", "criterion": "GRA"},
        ]
    }
    recurring = {
        "mistakeAnalysis": [
            {"mistakeType": "Recurring", "original": "y", "criterion": "GRA"},
        ]
    }
    rows = (
        [{"feedback_json": one_off}]
        + [{"feedback_json": recurring} for _ in range(MIN_HISTORY_ESSAYS - 1)]
    )
    with patch("services.writing_history.supabase_admin", _mock_db_returning(rows)):
        result = get_recurring_patterns("student-uuid")

    assert result is not None
    types = [p["mistakeType"] for p in result["patterns"]]
    assert "OneOff" not in types, "RECURRENCE_FLOOR should drop count==1 entries"
    assert "Recurring" in types


def test_db_failure_degrades_gracefully():
    """A raised exception inside .execute() must NOT propagate — the
    grader must keep working even when the history table is down."""
    with patch("services.writing_history.supabase_admin",
               _mock_db_returning(raises=RuntimeError("DB down"))):
        assert get_recurring_patterns("student-uuid") is None


# ── Formatter tests ──────────────────────────────────────────────────


def test_format_empty_patterns_returns_empty_string():
    """None / empty patterns ⇒ "" so callers can unconditionally inject
    the block without polluting the prompt."""
    assert format_history_for_prompt(None) == ""
    assert format_history_for_prompt({"patterns": []}) == ""
    assert format_history_for_prompt({}) == ""


def test_format_includes_top_patterns_and_schema():
    """Populated dict ⇒ Vietnamese section with mistake types, counts,
    examples, and the `recurringPatterns` output schema instruction."""
    patterns = {
        "essays_analyzed": 5,
        "patterns": [
            {"mistakeType": "Grammar - Article", "count": 8,
             "examples": ["the others", "the things"], "criterion": "GRA"},
            {"mistakeType": "Word Choice", "count": 4,
             "examples": ["terrible"], "criterion": "LR"},
        ],
    }
    out = format_history_for_prompt(patterns)

    assert "Lịch sử lỗi" in out
    assert "Grammar - Article" in out
    assert "(8x)" in out
    assert "the others" in out
    # Output schema instruction so Gemini knows how to populate the
    # recurringPatterns field — without this, history is wasted.
    assert "recurringPatterns" in out
    assert "stillRecurring" in out
    assert "improvements" in out
