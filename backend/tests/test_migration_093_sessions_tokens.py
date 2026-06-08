"""091 — sessions.tokens_used / estimated_cost_usd column migration (P2 audit).

Guards the fix: routers/grading.py WRITES sessions.tokens_used and routers/admin.py
READS it, but no migration ever created the column → every write silently failed.
091 adds it. These pin the file + its two idempotent ADD COLUMN statements so a
regression (file deleted, or a column dropped from the migration) is caught.
"""
from __future__ import annotations

import re
from pathlib import Path

_BACKEND = Path(__file__).parent.parent
_MIG = _BACKEND / "migrations" / "091_add_sessions_tokens_used.sql"


def test_migration_file_exists():
    assert _MIG.exists(), "091_add_sessions_tokens_used.sql missing"


def test_adds_tokens_used_idempotently():
    sql = _MIG.read_text(encoding="utf-8")
    assert re.search(
        r"ALTER\s+TABLE\s+sessions\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"
        r"tokens_used\s+INTEGER\s+DEFAULT\s+0", sql, re.IGNORECASE
    ), "tokens_used INTEGER DEFAULT 0 not added idempotently"


def test_adds_estimated_cost_usd_idempotently():
    sql = _MIG.read_text(encoding="utf-8")
    assert re.search(
        r"ALTER\s+TABLE\s+sessions\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"
        r"estimated_cost_usd\s+NUMERIC\(10,\s*4\)\s+DEFAULT\s+0", sql, re.IGNORECASE
    ), "estimated_cost_usd NUMERIC(10,4) DEFAULT 0 not added idempotently"


def test_no_explicit_transaction_and_has_rollback():
    sql = _MIG.read_text(encoding="utf-8").upper()
    assert "BEGIN;" not in sql and "COMMIT;" not in sql, \
        "must NOT wrap in an explicit transaction (ADD COLUMN is safe standalone)"
    assert "ROLLBACK:" in sql, "rollback recipe comment missing"


def test_column_is_actually_used_by_the_pipeline():
    # not decorative — these are the write/read paths the migration unblocks.
    grading = (_BACKEND / "routers" / "grading.py").read_text(encoding="utf-8")
    admin = (_BACKEND / "routers" / "admin.py").read_text(encoding="utf-8")
    assert '{"tokens_used": total}' in grading, "grading.py no longer writes tokens_used"
    assert "tokens_used" in admin, "admin.py no longer reads tokens_used"
