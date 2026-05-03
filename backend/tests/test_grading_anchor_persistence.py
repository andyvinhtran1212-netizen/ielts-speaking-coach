"""Pin: _save_grammar_recommendations writes recommended_anchor column.

Sprint 4 Phase 6 added `recommended_anchor` to the row dict that gets
inserted into the grammar_recommendations table (migration 032). The
column is nullable — when the matcher couldn't resolve a specific
anchor, we write NULL and the frontend renders article-level URL.

If this regresses, recs persist without their anchor and the Result
page falls back silently to article-level URLs even when the matcher
DID identify a specific section.
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers.grading import _save_grammar_recommendations


def _capture_inserted_rows() -> tuple[MagicMock, list]:
    """Patch supabase_admin.table().insert().execute() to capture
    the rows passed in, returning the patcher + captured list."""
    captured: list = []
    fake_result = MagicMock(data=[{"id": "fake-id-1"}, {"id": "fake-id-2"}])
    fake_insert = MagicMock(execute=MagicMock(return_value=fake_result))
    fake_table = MagicMock(insert=MagicMock(return_value=fake_insert))

    def insert_side_effect(rows):
        captured.append(rows)
        return fake_insert
    fake_table.insert.side_effect = insert_side_effect

    fake_admin = MagicMock()
    fake_admin.table.return_value = fake_table
    return patch("routers.grading.supabase_admin", fake_admin), captured


def test_persists_anchor_when_present():
    recs = [
        {
            "issue":    "Thiếu mạo từ 'a'",
            "slug":     "articles",
            "category": "foundations",
            "title":    "Articles",
            "score":    0.78,
            "anchor":   "articles.indefinite.missing-with-singular-count-noun",
        },
        {
            "issue":    "Sai thì quá khứ đơn",
            "slug":     "tense-consistency",
            "category": "error-clinic",
            "title":    "Tense Consistency",
            "score":    0.65,
            "anchor":   None,
        },
    ]
    patcher, captured = _capture_inserted_rows()
    with patcher:
        result = _save_grammar_recommendations(
            recs, user_id="u1", session_id="s1", response_id="r1",
        )

    assert len(captured) == 1, "expected one insert call"
    rows = captured[0]
    assert len(rows) == 2

    assert rows[0]["recommended_anchor"] == "articles.indefinite.missing-with-singular-count-noun"
    assert rows[1]["recommended_anchor"] is None  # NULL → frontend article-level fallback

    # And the function returns the recs enriched with rec_id (existing behavior)
    assert result[0].get("rec_id") == "fake-id-1"
    assert result[0]["anchor"] == "articles.indefinite.missing-with-singular-count-noun"


def test_persists_when_anchor_field_missing_entirely():
    """Pre-Sprint-4 callers may omit the anchor field — write NULL,
    don't crash."""
    recs = [
        {
            "issue":    "x",
            "slug":     "y",
            "category": "z",
            "title":    "T",
            "score":    0.5,
            # no `anchor` key
        },
    ]
    patcher, captured = _capture_inserted_rows()
    with patcher:
        _save_grammar_recommendations(
            recs, user_id="u1", session_id="s1", response_id="r1",
        )
    assert captured[0][0]["recommended_anchor"] is None
