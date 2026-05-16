"""Sprint 10.5 — pin the backfill_d1_questions contract.

Three contracts under test:

  1. **Generation happens.** For each alive confirmed vocab without an
     existing question row, the script calls generate_d1_question and
     INSERTs the result.
  2. **Idempotency.** Re-running after every vocab has a question
     reports `generated=0` and writes nothing. Operators rely on this
     to safely re-run after partial failures.
  3. **AI failure tolerance.** A vocab whose generate_d1_question
     returns None is counted as `errored`; the next vocab still gets
     processed (one bad row doesn't poison the run).

Same mock-admin-client + monkeypatch pattern as test_backfill_mastery.
The script imports `from database import supabase_admin` and
`from services.d1_question_generator import generate_d1_question` at
call time, so we patch both before invoking main().
"""

from __future__ import annotations

import logging
from unittest.mock import patch

import pytest


# ── Test doubles ─────────────────────────────────────────────────────


class _AdminBuilder:
    def __init__(self, parent, table_name: str):
        self._parent = parent
        self._table = table_name
        self._filters: list[tuple] = []

    def select(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def insert(self, row):
        self._parent.inserts.append((self._table, dict(row)))

        class _Exec:
            def execute(self_inner):
                class _R: data = [row]; count = None
                return _R()
        return _Exec()

    def execute(self):
        rows = list(self._parent.canned.get(self._table, []))
        for col, val in self._filters:
            rows = [r for r in rows if r.get(col) == val]
        class _R: pass
        r = _R()
        r.data = [dict(row) for row in rows]
        r.count = None
        return r


class _AdminClient:
    def __init__(self, canned: dict):
        self.canned = {k: [dict(r) for r in v] for k, v in canned.items()}
        self.inserts: list[tuple] = []

    def table(self, name=None, *_a, **_k):
        return _AdminBuilder(self, name)


# ── Helpers ──────────────────────────────────────────────────────────


def _alive_row(id_: str, headword: str = "wonder") -> dict:
    return {
        "id": id_, "user_id": "user-A",
        "headword": headword, "lemma": headword,
        "surface_form": headword,
        "definition_en": f"definition of {headword}",
        "definition_vi": "",
        "part_of_speech": "noun",
        "context_sentence": f"I feel {headword} every day.",
        "evidence_substring": f"I feel {headword} every day.",
        "is_archived": False, "is_pending": False,
    }


def _question_payload(headword: str = "wonder") -> dict:
    return {
        "context_sentence":      f"The {headword} of nature surprises me on quiet mornings every week.",
        "blank_position_start":  4,
        "blank_position_end":    4 + len(headword),
        "target_answer":         headword,
        "acceptable_variants":   [],
        "hint":                  "feeling",
        "source_evidence_substring": f"I feel {headword} every day.",
        "generated_by":          "haiku",
    }


# ── Tests ─────────────────────────────────────────────────────────────


def test_backfill_generates_one_question_per_alive_vocab(caplog):
    """Alive confirmed vocab with no existing question → one INSERT."""
    client = _AdminClient({
        "user_vocabulary": [
            _alive_row("v1", "wonder"),
            _alive_row("v2", "serendipity"),
        ],
        "user_d1_questions": [],
    })

    with patch("database.supabase_admin", client), \
         patch("services.d1_question_generator.generate_d1_question",
               side_effect=lambda row: _question_payload(row["headword"])), \
         patch("scripts.backfill_d1_questions._SLEEP_MS", 0):
        from scripts.backfill_d1_questions import main
        caplog.set_level(logging.INFO)
        rc = main()

    assert rc == 0
    inserted = [row for table, row in client.inserts if table == "user_d1_questions"]
    assert len(inserted) == 2
    inserted_vocab_ids = {row["vocabulary_id"] for row in inserted}
    assert inserted_vocab_ids == {"v1", "v2"}
    # Generator output flows through verbatim — pin one field that
    # would silently break if the script started dropping payload data.
    sample = next(row for row in inserted if row["vocabulary_id"] == "v1")
    assert sample["generated_by"] == "haiku"
    assert sample["target_answer"] == "wonder"


def test_backfill_idempotent_on_second_run(caplog):
    """Vocab that already has a question row in user_d1_questions is
    skipped. Re-running after a clean sweep generates 0."""
    client = _AdminClient({
        "user_vocabulary": [_alive_row("v1")],
        "user_d1_questions": [{
            "id": "q1", "vocabulary_id": "v1",
            "context_sentence": "existing question", "target_answer": "wonder",
        }],
    })

    call_count = {"n": 0}
    def _spy(_row):
        call_count["n"] += 1
        return _question_payload()

    with patch("database.supabase_admin", client), \
         patch("services.d1_question_generator.generate_d1_question", side_effect=_spy), \
         patch("scripts.backfill_d1_questions._SLEEP_MS", 0):
        from scripts.backfill_d1_questions import main
        caplog.set_level(logging.INFO)
        rc = main()

    assert rc == 0
    # Generator should NOT have been called (vocab already has a question).
    assert call_count["n"] == 0
    # No new inserts either.
    new_inserts = [row for table, row in client.inserts if table == "user_d1_questions"]
    assert new_inserts == []


def test_backfill_continues_after_generator_returns_none(caplog):
    """A failing vocab is logged + counted but doesn't stop the loop."""
    client = _AdminClient({
        "user_vocabulary": [
            _alive_row("v1", "wonder"),
            _alive_row("v2", "broken"),
            _alive_row("v3", "serendipity"),
        ],
        "user_d1_questions": [],
    })

    def _selective(row):
        # Middle vocab fails generation.
        if row["headword"] == "broken":
            return None
        return _question_payload(row["headword"])

    with patch("database.supabase_admin", client), \
         patch("services.d1_question_generator.generate_d1_question",
               side_effect=_selective), \
         patch("scripts.backfill_d1_questions._SLEEP_MS", 0):
        from scripts.backfill_d1_questions import main
        caplog.set_level(logging.INFO)
        rc = main()

    assert rc == 0
    inserted_vocab_ids = {
        row["vocabulary_id"] for table, row in client.inserts
        if table == "user_d1_questions"
    }
    # v1 and v3 generated; v2 failed but didn't block the others.
    assert inserted_vocab_ids == {"v1", "v3"}
