"""094 — missing FK/GIN indexes (P1-3 / C-2.1 audit).

Pins the file + its 5 idempotent CREATE INDEX statements (incl. the GIN on
analytics_events.event_data) + the rollback + that it is NOT concurrent / not
transaction-wrapped (applied by hand in the Supabase SQL editor).
"""
from __future__ import annotations

import re
from pathlib import Path

_BACKEND = Path(__file__).parent.parent
_MIG = _BACKEND / "migrations" / "094_add_missing_indexes.sql"

_EXPECTED = {
    "idx_grammar_rec_session":               r"grammar_recommendations\s*\(\s*session_id\s*\)",
    "idx_analytics_events_name_user_created": r"analytics_events\s*\(\s*event_name,\s*user_id,\s*created_at\s*\)",
    "idx_analytics_events_data_gin":          r"analytics_events\s+USING\s+GIN\s*\(\s*event_data\s*\)",
    "idx_writing_assignments_assigned_by":    r"writing_assignments\s*\(\s*assigned_by\s*\)",
    "idx_uca_assigned_by":                    r"user_code_assignments\s*\(\s*assigned_by\s*\)",
}


def test_migration_file_exists():
    assert _MIG.exists(), "094_add_missing_indexes.sql missing"


def test_creates_each_index_idempotently_on_the_right_column():
    sql = _MIG.read_text(encoding="utf-8")
    for name, target in _EXPECTED.items():
        assert re.search(
            rf"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+{name}\s+ON\s+{target}",
            sql, re.IGNORECASE), f"{name} missing or on the wrong column/type"


def test_gin_index_present_for_jsonb_payload():
    sql = _MIG.read_text(encoding="utf-8")
    assert re.search(r"USING\s+GIN\s*\(\s*event_data\s*\)", sql, re.IGNORECASE), \
        "GIN index on analytics_events.event_data missing"


def test_plain_not_concurrent_not_transaction_wrapped():
    # check only executable SQL, not the explanatory comments (which mention the word).
    code = "\n".join(ln for ln in _MIG.read_text(encoding="utf-8").splitlines()
                     if not ln.lstrip().startswith("--")).upper()
    assert "CONCURRENTLY" not in code, \
        "must be PLAIN CREATE INDEX — CONCURRENTLY errors inside the SQL-editor transaction"
    assert "BEGIN;" not in code and "COMMIT;" not in code


def test_has_rollback_for_each_index():
    sql = _MIG.read_text(encoding="utf-8")
    assert "ROLLBACK:" in sql
    for name in _EXPECTED:
        assert re.search(rf"DROP\s+INDEX\s+IF\s+EXISTS\s+{name}", sql, re.IGNORECASE), \
            f"rollback for {name} missing"
