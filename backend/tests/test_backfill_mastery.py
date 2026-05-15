"""Sprint 10.2 — pin the backfill_mastery contract.

The script is a deprecation-window helper: the bank GET endpoint
already derives mastery on-the-fly from flashcard_reviews, but the
deprecated `user_vocabulary.mastery_status` column stays physically
present until Sprint 10.6. Direct Supabase Table Editor reads and
admin tools that hit the column directly need it kept in sync — that's
what this script does, by walking every alive vocab row and writing
the derived value back to the column.

Two contracts under test:

  1. **Correctness.** A row whose column says 'mastered' but whose
     SRS state has lapse_count>0 must be updated to 'learning'.
     Mirror cases for the inverse (column says learning, SRS qualifies
     as mastered).

  2. **Idempotency.** A second run after a clean sweep reports
     `updated=0` and writes nothing. The operator playbook lists
     idempotent re-run as the success signal.

We exercise `scripts.backfill_mastery.main()` against a fully mocked
Supabase admin client, so the test is fast (no live DB) and pins the
exact write payload shape.
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

    def select(self, *_a, **_k): return self
    def eq(self, *_a, **_k): return self

    def update(self, row):
        # The script calls .update(...).eq("id", vocab_id).execute().
        # We grab the row payload here and let .eq() forward.
        self._parent.updates.append((self._table, row, self))

        outer = self

        class _Exec:
            def eq(self_inner, col, val):
                # Record the id filter alongside the update row so
                # tests can assert correctness per vocab_id.
                outer._parent.updates[-1] = (outer._table, row, (col, val))
                return self_inner

            def execute(self_inner):
                class _R: data = [row]; count = None
                return _R()
        return _Exec()

    def execute(self):
        return _Resp(self._parent.canned.get(self._table, []))


class _Resp:
    def __init__(self, data):
        self.data = data
        self.count = None


class _AdminClient:
    def __init__(self, canned: dict):
        self.canned = canned
        self.updates: list[tuple] = []  # [(table, row, (eq_col, eq_val))]

    def table(self, name=None, *_a, **_k):
        return _AdminBuilder(self, name)


@pytest.fixture
def patched_admin():
    """Yield a fresh `_AdminClient` patched into the `database` module
    so `from database import supabase_admin` inside main() picks it
    up. The script imports database lazily at call time."""

    def _make(canned):
        client = _AdminClient(canned)
        return client

    yield _make


# ── Correctness ──────────────────────────────────────────────────────


def test_backfill_flips_stale_mastered_to_learning(patched_admin, caplog):
    """Column says 'mastered', SRS has lapse_count=3 → derive
    'learning' → update writes 'learning'."""
    client = patched_admin({
        "user_vocabulary": [{
            "id": "v_stale", "user_id": "user-A",
            "mastery_status": "mastered", "is_archived": False,
        }],
        "flashcard_reviews": [{
            "vocabulary_id": "v_stale",
            "interval_days": 50, "lapse_count": 3, "review_count": 10,
        }],
    })

    with patch("database.supabase_admin", client):
        from scripts.backfill_mastery import main
        caplog.set_level(logging.INFO)
        rc = main()

    assert rc == 0
    assert len(client.updates) == 1
    table, row, (eq_col, eq_val) = client.updates[0]
    assert table == "user_vocabulary"
    assert row == {"mastery_status": "learning"}
    assert (eq_col, eq_val) == ("id", "v_stale")


def test_backfill_flips_stale_learning_to_mastered(patched_admin):
    """Column says 'learning' but SRS meets the threshold → update
    to 'mastered'."""
    client = patched_admin({
        "user_vocabulary": [{
            "id": "v_real_mastered", "user_id": "user-A",
            "mastery_status": "learning", "is_archived": False,
        }],
        "flashcard_reviews": [{
            "vocabulary_id": "v_real_mastered",
            "interval_days": 30, "lapse_count": 0, "review_count": 5,
        }],
    })
    with patch("database.supabase_admin", client):
        from scripts.backfill_mastery import main
        main()

    assert len(client.updates) == 1
    _, row, _ = client.updates[0]
    assert row == {"mastery_status": "mastered"}


def test_backfill_skips_rows_already_in_sync(patched_admin, caplog):
    """A row whose column matches the derived value must NOT be
    written to. Idempotency depends on this."""
    client = patched_admin({
        "user_vocabulary": [
            {"id": "v_ok_learning", "user_id": "user-A",
             "mastery_status": "learning", "is_archived": False},
            {"id": "v_ok_mastered", "user_id": "user-A",
             "mastery_status": "mastered", "is_archived": False},
        ],
        "flashcard_reviews": [
            {"vocabulary_id": "v_ok_mastered",
             "interval_days": 30, "lapse_count": 0, "review_count": 5},
            # v_ok_learning has no SRS row → derives 'learning' → matches column → no update
        ],
    })
    with patch("database.supabase_admin", client):
        from scripts.backfill_mastery import main
        caplog.set_level(logging.INFO)
        main()

    assert client.updates == [], (
        f"Expected zero writes when both rows are in sync, got {client.updates}"
    )
    log_text = "\n".join(r.message for r in caplog.records)
    assert "unchanged=2" in log_text
    assert "updated=0" in log_text


# ── Idempotency ──────────────────────────────────────────────────────


def test_backfill_second_run_writes_nothing(patched_admin):
    """Simulate the operator playbook: run once, then re-run after a
    clean sweep. Second run sees the now-synced column and must
    report updated=0 (no writes)."""
    canned = {
        "user_vocabulary": [{
            "id": "v_stale", "user_id": "user-A",
            "mastery_status": "mastered",  # stale on first read
            "is_archived": False,
        }],
        "flashcard_reviews": [{
            "vocabulary_id": "v_stale",
            "interval_days": 50, "lapse_count": 3, "review_count": 10,
        }],
    }
    client = patched_admin(canned)
    with patch("database.supabase_admin", client):
        from scripts.backfill_mastery import main
        main()

    # Simulate the sync: flip the column to match what the script
    # just wrote, then re-run.
    canned["user_vocabulary"][0]["mastery_status"] = "learning"
    client.updates.clear()
    with patch("database.supabase_admin", client):
        main()

    assert client.updates == [], (
        "Second run must be a no-op. Idempotency is part of the "
        "operator contract."
    )


# ── Edge cases ───────────────────────────────────────────────────────


def test_backfill_empty_table_is_noop(patched_admin, caplog):
    """No alive rows → log 'no rows to backfill' + exit 0."""
    client = patched_admin({"user_vocabulary": [], "flashcard_reviews": []})
    with patch("database.supabase_admin", client):
        from scripts.backfill_mastery import main
        caplog.set_level(logging.INFO)
        rc = main()
    assert rc == 0
    log_text = "\n".join(r.message for r in caplog.records)
    assert "no rows to backfill" in log_text
