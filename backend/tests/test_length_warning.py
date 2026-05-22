"""
backend/tests/test_length_warning.py — Sprint 14.7

Pin the soft-warning threshold table (L7) and the prompt-context
output contract (L8). The function is pure — no I/O — so these are
classic table-driven sentinels.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.length_warning import (                                # noqa: E402
    LENGTH_SOFT_WARNING_THRESHOLDS_SECONDS,
    get_length_warning_context,
)


# ── L7: thresholds are exactly 2× Sprint 14.2 hard reject ────────────────────


def test_soft_threshold_table_is_exactly_two_times_hard_reject():
    """L7 lock — soft thresholds = 2× hard reject thresholds. Pin so a
    future tweak can't silently widen the gap (or close it, which
    would make the soft warning indistinguishable from the hard
    reject)."""
    # Sprint 14.2 hard reject: P1=15s, P2=80s, P3=25s.
    assert LENGTH_SOFT_WARNING_THRESHOLDS_SECONDS == {
        1: 30.0,
        2: 160.0,
        3: 50.0,
    }


# ── Below soft threshold → warning fires + context emitted ────────────────────


@pytest.mark.parametrize("part_num,duration", [
    (1, 18.0),   # above 15s hard, below 30s soft
    (1, 29.9),
    (2, 100.0),  # above 80s hard, below 160s soft
    (3, 30.0),   # above 25s hard, below 50s soft
])
def test_warning_fires_when_below_soft_threshold(part_num, duration):
    fires, context = get_length_warning_context(part_num, duration)
    assert fires is True
    # Context tells the grader the duration is short + names the part
    # so the grader can frame feedback if relevant (L8).
    assert f"Part {part_num}" in context
    assert f"{duration:.1f}s" in context
    assert "Limited content" in context


def test_warning_context_below_soft_is_informational_not_penalty():
    """L4 + L8 — the context must steer the grader away from
    auto-penalising short audio. Sprint 14.5 anti-inflation discipline
    still applies to the transcript itself; duration is one signal."""
    _, context = get_length_warning_context(1, 16.0)
    assert "informational" in context.lower() or "do not penalise" in context.lower()


# ── At/above soft threshold → no warning, adequate context ────────────────────


@pytest.mark.parametrize("part_num,duration", [
    (1, 30.0),    # exactly at threshold (>= cuts off)
    (1, 60.0),
    (2, 160.0),
    (2, 200.0),
    (3, 50.0),
    (3, 90.0),
])
def test_no_warning_when_at_or_above_soft_threshold(part_num, duration):
    fires, context = get_length_warning_context(part_num, duration)
    assert fires is False
    assert "Adequate length" in context
    assert f"Part {part_num}" in context


# ── Defensive: unknown part doesn't crash ────────────────────────────────────


def test_unknown_part_returns_no_warning_and_empty_context():
    """If a malformed `part` field reaches the function, we must return
    a sane no-op tuple rather than raising — grading must never fail
    because the length-warning helper got confused."""
    fires, context = get_length_warning_context(99, 10.0)
    assert fires is False
    assert context == ""
