"""A1 (Plan-A) — grammar rec_id is PRE-MINTED before the feedback blob is
serialized, so the persisted responses.feedback blob and the
grammar_recommendations rows agree on rec_id.

Why this matters (the bug it fixes):
The feedback blob is serialized at db_save time, which runs BEFORE
_save_grammar_recommendations(). Previously rec_id was assigned only by a
read-back of the DB insert's returned id — so the blob persisted with NO
rec_id. On page reload result.html re-reads responses.feedback and its
render bails (`if (!rec || !rec.rec_id) return ''`), so the click-tracking
PATCH never wires up → was_clicked telemetry under-counts on every reload.

Pre-minting a client UUID before serialize makes the blob carry rec_id, and
INSERTing that same id into grammar_recommendations keeps blob ⇄ DB in sync.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers.grading import (
    _premint_grammar_rec_ids,
    _serialize_feedback,
    _save_grammar_recommendations,
)

UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"


def _grading_with_recs(n: int = 2) -> dict:
    return {
        "overall_band": 6.5,
        "grammar_recommendations": [
            {"issue": f"i{i}", "slug": f"s{i}", "category": "c",
             "title": "T", "score": 0.5, "anchor": None}
            for i in range(n)
        ],
    }


# ── pre-mint helper ──────────────────────────────────────────────────────

def test_premint_assigns_uuid_to_each_rec():
    import re
    grading = _grading_with_recs(3)
    _premint_grammar_rec_ids(grading)
    ids = [r["rec_id"] for r in grading["grammar_recommendations"]]
    assert all(re.match(UUID_RE, i) for i in ids), ids
    assert len(set(ids)) == 3, "rec_ids must be distinct"


def test_premint_is_idempotent():
    """Re-running pre-mint must not overwrite an existing rec_id."""
    grading = _grading_with_recs(2)
    _premint_grammar_rec_ids(grading)
    first = [r["rec_id"] for r in grading["grammar_recommendations"]]
    _premint_grammar_rec_ids(grading)
    second = [r["rec_id"] for r in grading["grammar_recommendations"]]
    assert first == second


def test_premint_no_recs_is_noop():
    _premint_grammar_rec_ids({"overall_band": 6.0})            # no key → no crash
    _premint_grammar_rec_ids({"grammar_recommendations": []})  # empty → no crash


# ── the persistence invariant: blob carries rec_id ───────────────────────

def test_serialized_feedback_blob_contains_rec_id_after_premint():
    """THE bug: serialize happens before the DB save. After pre-mint, the
    blob (what gets stored in responses.feedback) must carry rec_id on every
    grammar rec — otherwise the reload-path render bails."""
    grading = _grading_with_recs(2)
    _premint_grammar_rec_ids(grading)
    blob = _serialize_feedback(grading, {"length_warning": None})

    parsed = json.loads(blob)
    recs = parsed["grammar_recommendations"]
    assert len(recs) == 2
    for r in recs:
        assert r.get("rec_id"), "blob rec missing rec_id → reload-path would bail"
    # signals are merged in too (no key collision regression)
    assert "length_warning" in parsed


def test_blob_rec_id_matches_db_row_id():
    """blob ⇄ DB agreement: the rec_id in the serialized blob is the SAME id
    INSERTed into grammar_recommendations (so the reload-path click lands on a
    real row)."""
    captured: list = []
    fake_insert = MagicMock(execute=MagicMock(return_value=MagicMock(data=None)))

    def insert_side_effect(rows):
        captured.append(rows)
        return fake_insert
    fake_table = MagicMock()
    fake_table.insert.side_effect = insert_side_effect
    fake_admin = MagicMock()
    fake_admin.table.return_value = fake_table

    grading = _grading_with_recs(2)
    _premint_grammar_rec_ids(grading)
    blob_ids = [r["rec_id"] for r in json.loads(
        _serialize_feedback(grading, {})
    )["grammar_recommendations"]]

    with patch("routers.grading.supabase_admin", fake_admin):
        result = _save_grammar_recommendations(
            grading["grammar_recommendations"],
            user_id="u1", session_id="s1", response_id="r1",
        )

    inserted_ids = [row["id"] for row in captured[0]]
    assert inserted_ids == blob_ids, "DB row id must equal the pre-minted blob rec_id"
    # And the HTTP-response shape is unchanged: enriched recs still carry rec_id
    # (regression: click works when the result is viewed immediately).
    assert [r["rec_id"] for r in result] == blob_ids


def test_save_self_heals_when_premint_skipped():
    """If a rec reaches the save without a pre-minted id, the save still
    INSERTs an explicit id and returns it (no read-back dependency)."""
    captured: list = []
    fake_insert = MagicMock(execute=MagicMock(return_value=MagicMock(data=None)))
    fake_table = MagicMock()
    fake_table.insert.side_effect = lambda rows: (captured.append(rows), fake_insert)[1]
    fake_admin = MagicMock()
    fake_admin.table.return_value = fake_table

    recs = [{"issue": "i", "slug": "s", "category": "c", "title": "T", "score": 0.5}]
    with patch("routers.grading.supabase_admin", fake_admin):
        result = _save_grammar_recommendations(
            recs, user_id="u1", session_id="s1", response_id="r1",
        )
    assert captured[0][0]["id"], "self-healed id must be present"
    assert result[0]["rec_id"] == captured[0][0]["id"]
