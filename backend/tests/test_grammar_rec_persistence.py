"""B9 (#45) — _save_grammar_recommendations (the grammar-rec persistence path)
was untested end-to-end. Pin: empty → no-op; the canonical row shape; pre-minted
rec_id is preserved AND shared between the DB row and the returned rec; a missing
rec_id is self-healed; and a DB failure is non-fatal (returns the original recs).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import grading


class _Cap:
    """Captures the inserted rows; optionally raises on execute."""
    def __init__(self, raises=None):
        self.rows = None
        self.raises = raises

    def table(self, _name): return self
    def insert(self, rows): self.rows = rows; return self

    def execute(self):
        if self.raises:
            raise self.raises
        return type("_R", (), {"data": self.rows})()


def _rec(**kw):
    base = {"issue": "missing article before noun", "slug": "articles",
            "category": "foundations", "title": "Articles", "score": 0.81}
    base.update(kw)
    return base


def test_empty_recs_is_noop(monkeypatch):
    monkeypatch.setattr(grading, "supabase_admin", _Cap())
    assert grading._save_grammar_recommendations(
        [], user_id="u", session_id="s", response_id="r") == []


def test_row_shape_and_preminted_id(monkeypatch):
    cap = _Cap()
    monkeypatch.setattr(grading, "supabase_admin", cap)
    out = grading._save_grammar_recommendations(
        [_rec(rec_id="fixed-id", anchor="articles.basics")],
        user_id="u9", session_id="s9", response_id="r9",
    )
    row = cap.rows[0]
    assert row["id"] == "fixed-id"                       # pre-minted id reused, no read-back
    assert row["user_id"] == "u9"
    assert row["session_id"] == "s9"
    assert row["response_id"] == "r9"
    assert row["grammar_issue"] == "missing article before noun"
    assert row["recommended_slug"] == "articles"
    assert row["recommended_category"] == "foundations"
    assert row["recommended_title"] == "Articles"
    assert row["similarity_score"] == 0.81
    assert row["recommended_anchor"] == "articles.basics"
    assert out[0]["rec_id"] == "fixed-id"                # response shares the same id


def test_self_heals_missing_rec_id_and_null_anchor(monkeypatch):
    cap = _Cap()
    monkeypatch.setattr(grading, "supabase_admin", cap)
    out = grading._save_grammar_recommendations(
        [_rec()], user_id="u", session_id="s", response_id="r")
    assert out[0]["rec_id"]                              # minted
    assert cap.rows[0]["id"] == out[0]["rec_id"]         # DB row + response share it
    assert cap.rows[0]["recommended_anchor"] is None     # no anchor → NULL


def test_db_failure_is_non_fatal(monkeypatch):
    monkeypatch.setattr(grading, "supabase_admin", _Cap(raises=RuntimeError("table missing")))
    recs = [_rec()]
    out = grading._save_grammar_recommendations(
        recs, user_id="u", session_id="s", response_id="r")
    assert out is recs                                   # original returned, no raise
