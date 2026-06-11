"""096 — drop the 5 unused indexes migration 094 added (revert of #417).

Pins the file + that it drops the LIVE index names (verified from
pg_stat_user_indexes; the 094 SOURCE FILE used two different analytics names,
so dropping the file's names would be a silent no-op). Plain DROP (no
CONCURRENTLY -> safe in the Supabase SQL-editor transaction). The 094 file
itself is immutable and untouched; this is a forward-only revert.
"""
from __future__ import annotations

import re
from pathlib import Path

_BACKEND = Path(__file__).parent.parent
_MIG = _BACKEND / "migrations" / "096_drop_unused_094_indexes.sql"

# LIVE names (from prod pg_stat_user_indexes, all idx_scan=0), NOT the 094 file names.
_DROP = [
    "idx_analytics_event_data_gin",
    "idx_analytics_event_user_time",
    "idx_grammar_rec_session",
    "idx_uca_assigned_by",
    "idx_writing_assignments_assigned_by",
]


def test_migration_file_exists():
    assert _MIG.exists(), "096_drop_unused_094_indexes.sql missing"


def test_drops_each_live_index_idempotently():
    sql = _MIG.read_text(encoding="utf-8")
    code = "\n".join(ln for ln in sql.splitlines() if not ln.lstrip().startswith("--"))
    for name in _DROP:
        assert re.search(rf"DROP\s+INDEX\s+IF\s+EXISTS\s+{name}\s*;", code, re.IGNORECASE), \
            f"{name} not dropped (executable SQL)"


def test_does_not_drop_the_indexes_that_are_in_use():
    # idx_analytics_events_created_at (scan=93) and _event_name (scan=18) are used.
    code = "\n".join(ln for ln in _MIG.read_text(encoding="utf-8").splitlines()
                     if not ln.lstrip().startswith("--")).lower()
    assert "idx_analytics_events_created_at" not in code
    assert "idx_analytics_events_event_name" not in code


def test_plain_drop_not_concurrent_not_transaction_wrapped():
    code = "\n".join(ln for ln in _MIG.read_text(encoding="utf-8").splitlines()
                     if not ln.lstrip().startswith("--")).upper()
    assert "CONCURRENTLY" not in code, \
        "executable SQL must be PLAIN DROP -- CONCURRENTLY errors inside the SQL-editor transaction"
    assert "BEGIN;" not in code and "COMMIT;" not in code


def test_documents_the_file_vs_live_name_divergence():
    # The migration must flag that the live names differ from the 094 file names,
    # so a future reader does not "fix" them back to the no-op file names.
    sql = _MIG.read_text(encoding="utf-8").lower()
    assert "idx_analytics_events_data_gin" in sql, "must reference the 094 FILE name in the note"
    assert "live" in sql and "pg_stat_user_indexes" in sql


def test_ascii_only():
    raw = _MIG.read_bytes()
    assert all(b < 128 for b in raw), "migration must be ASCII-only"
