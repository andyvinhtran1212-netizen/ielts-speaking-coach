"""Full Test question sets must be complete before they become canonical."""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import questions as questions_module


def test_full_test_fallback_has_canonical_count_for_every_part():
    expected = {1: 9, 2: 1, 3: 5}
    for part, count in expected.items():
        rows = questions_module._make_fallback_rows("session", part, is_full_test=True)
        assert len(rows) == count
        assert [row["order_num"] for row in rows] == list(range(1, count + 1))

    part1 = questions_module._make_fallback_rows("session", 1, is_full_test=True)
    assert set(Counter(row["subtopic"] for row in part1).values()) == {3}


def test_partial_full_test_generation_is_replaced_not_persisted():
    partial = [{"order_num": index + 1} for index in range(3)]
    rows, used_fallback = questions_module._normalize_full_test_rows("session", 3, partial)
    assert used_fallback is True
    assert len(rows) == 5
    assert all(row["session_id"] == "session" for row in rows)


def test_overcomplete_full_test_generation_is_trimmed_to_contract():
    generated = [{"order_num": index + 1} for index in range(8)]
    rows, used_fallback = questions_module._normalize_full_test_rows("session", 3, generated)
    assert used_fallback is False
    assert rows == generated[:5]
