"""Sprint 10.5 Phase 2 — pin the MCQ backfill contract.

Three contracts under test:

  1. **Augmentation.** Rows with options=[] get the distractor-only
     AI call, then UPDATE options with the shuffled 4-element array.
  2. **Idempotency.** Re-running after a clean sweep skips rows that
     already have len(options)==4.
  3. **AI failure tolerance.** A row whose distractor generation
     fails is counted as `errored`; the next row still runs.

Same mock-admin-client + monkeypatch pattern as test_backfill_d1_questions.
The script imports `from database import supabase_admin` at call time,
and calls _generate_distractors_for_row internally which uses anthropic.
We patch _generate_distractors_for_row directly to dodge the anthropic
client construction.
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

    def update(self, row_patch):
        outer = self
        parent = self._parent
        table = self._table

        class _Updater:
            def __init__(self_inner):
                self_inner._filters: list[tuple] = list(outer._filters)
                self_inner._patch = row_patch

            def eq(self_inner, col, val):
                self_inner._filters.append((col, val))
                return self_inner

            def execute(self_inner):
                # Apply WHERE filters then patch.
                rows = parent.canned.get(table, [])
                matched = list(rows)
                for col, val in self_inner._filters:
                    matched = [r for r in matched if r.get(col) == val]
                for row in matched:
                    row.update(self_inner._patch)
                parent.updates.append((table, dict(self_inner._patch), list(self_inner._filters)))

                class _R: data = [dict(r) for r in matched]; count = None
                return _R()
        return _Updater()

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
        self.updates: list[tuple] = []

    def table(self, name=None, *_a, **_k):
        return _AdminBuilder(self, name)


# ── Helpers ──────────────────────────────────────────────────────────


def _question_row(id_: str, target: str = "wonder", options: list | None = None) -> dict:
    return {
        "id": id_, "user_id": "user-A",
        "vocabulary_id": f"vocab-{id_}",
        "context_sentence": f"The {target} of nature surprises me every day.",
        "target_answer": target,
        "options": list(options) if options is not None else [],
        "is_active": True,
    }


# ── Tests ─────────────────────────────────────────────────────────────


def test_backfill_mcq_augments_rows_with_empty_options(caplog):
    """Rows with options=[] → UPDATE with 4-element shuffled array."""
    client = _AdminClient({
        "user_d1_questions": [
            _question_row("q1", target="wonder"),
            _question_row("q2", target="serendipity"),
        ],
    })

    def _fake_distractors(row):
        return ["x", "y", "z"]

    with patch("database.supabase_admin", client), \
         patch("scripts.backfill_d1_questions_mcq._generate_distractors_for_row",
               side_effect=_fake_distractors), \
         patch("scripts.backfill_d1_questions_mcq._SLEEP_MS", 0):
        from scripts.backfill_d1_questions_mcq import main
        caplog.set_level(logging.INFO)
        rc = main()

    assert rc == 0
    options_updates = [u for u in client.updates if u[0] == "user_d1_questions"]
    assert len(options_updates) == 2
    # Each update sets options to a 4-element list including target_answer.
    for _table, patch_row, filters in options_updates:
        opts = patch_row["options"]
        assert isinstance(opts, list) and len(opts) == 4
        assert len(set(opts)) == 4  # all distinct
        # Filter targeted the right row id.
        id_filter = next(v for k, v in filters if k == "id")
        assert id_filter in {"q1", "q2"}


def test_backfill_mcq_idempotent_on_second_run(caplog):
    """Rows already with len(options)==4 are skipped."""
    client = _AdminClient({
        "user_d1_questions": [
            _question_row("q1", target="wonder",
                          options=["wonder", "a", "b", "c"]),
        ],
    })

    call_count = {"n": 0}
    def _spy(_row):
        call_count["n"] += 1
        return ["x", "y", "z"]

    with patch("database.supabase_admin", client), \
         patch("scripts.backfill_d1_questions_mcq._generate_distractors_for_row",
               side_effect=_spy), \
         patch("scripts.backfill_d1_questions_mcq._SLEEP_MS", 0):
        from scripts.backfill_d1_questions_mcq import main
        caplog.set_level(logging.INFO)
        rc = main()

    assert rc == 0
    # Distractor generation should NOT have been called.
    assert call_count["n"] == 0
    # And no UPDATEs landed.
    options_updates = [u for u in client.updates if u[0] == "user_d1_questions"]
    assert options_updates == []


def test_backfill_mcq_continues_after_distractor_failure(caplog):
    """Distractor generation returning None counts as errored; next
    row still gets processed."""
    client = _AdminClient({
        "user_d1_questions": [
            _question_row("q1", target="wonder"),
            _question_row("q2", target="broken"),
            _question_row("q3", target="serendipity"),
        ],
    })

    def _selective(row):
        if row["target_answer"] == "broken":
            return None
        return ["x", "y", "z"]

    with patch("database.supabase_admin", client), \
         patch("scripts.backfill_d1_questions_mcq._generate_distractors_for_row",
               side_effect=_selective), \
         patch("scripts.backfill_d1_questions_mcq._SLEEP_MS", 0):
        from scripts.backfill_d1_questions_mcq import main
        caplog.set_level(logging.INFO)
        rc = main()

    assert rc == 0
    options_updates = [u for u in client.updates if u[0] == "user_d1_questions"]
    augmented_ids = {
        next(v for k, v in filters if k == "id")
        for _t, _p, filters in options_updates
    }
    # q1 and q3 augmented; q2 errored but didn't block them.
    assert augmented_ids == {"q1", "q3"}
