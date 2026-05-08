"""Schema contract tests for Speaking tables (Sprint 5.0 + anti-pattern #37).

Sprint 2.7d.1.1 hotfix logged anti-pattern #37 (schema-naive test fixtures):
production crashed because a service-layer SELECT referenced a column name
that didn't exist in the DB. The fix is a contract test that pins every
SELECTed column against the schema.

But here's the wrinkle: the `sessions` and `responses` tables are NOT in
backend/migrations/. They predate the project's versioned-migration system
and live as bare CREATE TABLEs in the production Supabase project. So we
can't simply parse `migrations/0XX_create_sessions.sql` and call it
authoritative — that file doesn't exist.

The honest approach here:
  1. Curate a baseline of foundational columns from documentation
     (CLAUDE.md, the Sprint 5.0 spec, and live-query inspection at
     audit time, 2026-05-08). These are the columns that exist in
     production but predate migrations.
  2. PARSE the ALTER TABLE ADD COLUMN statements from
     `backend/migrations/*.sql` to capture every column added since.
     This part IS authoritative against the codebase.
  3. Pin the per-service SELECTed columns set against
     (baseline ∪ parsed ALTER columns).

This catches the 2.7d.1.1 typo class of bug — a SELECT that names a column
that's neither in the baseline nor in any ALTER fails the test. It does
NOT catch a column genuinely renamed in production via a non-tracked DBA
operation, but those are out-of-band and rare; the codebase contract is
what matters for ongoing development.

When the foundational tables eventually migrate into versioned files
(future sprint), drop the BASELINE_* sets here and let the parser cover
everything.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest


# ── Baseline column sets (curated 2026-05-08) ─────────────────────────
#
# These columns exist in production but are NOT created by any migration
# file in `backend/migrations/`. Sources:
#   - CLAUDE.md schema reference block
#   - Sprint 5.0 spec schema reference (verified 2026-05-08)
#   - Live SELECTs in routers/sessions.py + routers/grading.py +
#     routers/responses.py
#
# Update these sets ONLY if you've verified the column exists in the
# live Supabase project. Do not add speculative columns — the whole
# point of this test is to surface drift between code and reality.

BASELINE_SESSIONS_COLUMNS: set[str] = {
    "id", "user_id",
    "mode", "part", "topic", "status",
    "overall_band", "band_fc", "band_lr", "band_gra", "band_p",
    "audio_url", "pdf_url", "tokens_used",
    "started_at", "completed_at",
    # error tracking added by migration 003 — also captured below from
    # the parser, but listing here for clarity.
}

BASELINE_RESPONSES_COLUMNS: set[str] = {
    "id", "session_id", "question_id",
    "audio_url", "transcript", "feedback",
    "overall_band",
    "recorded_at",
    # The `improved_response` column referenced in some specs does NOT
    # actually exist on responses (per 2026-05-08 audit). The "improved
    # answer" lives inside the `feedback` JSON as `sample_answer`.
    # Not adding it here.
    # The `feedback_json` JSONB column referenced in some specs as a
    # future home for parsed feedback also does NOT exist yet — adding
    # it would let typos slip through. Out of scope.
}


# ── Migration parser ──────────────────────────────────────────────────


_ALTER_ADD_COLUMN_RE = re.compile(
    r"ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)",
    re.IGNORECASE,
)


def _parse_alter_table_columns(sql_text: str, table_name: str) -> set[str]:
    """Find every column added to `table_name` via ALTER TABLE ADD COLUMN.

    Handles two real-world syntaxes seen in this repo's migrations:

      ALTER TABLE responses
        ADD COLUMN IF NOT EXISTS pronunciation_score FLOAT,
        ADD COLUMN IF NOT EXISTS pronunciation_status TEXT;

      ALTER TABLE sessions ADD COLUMN error_code TEXT;

    Approach: locate every "ALTER TABLE <table>" block and scan its body
    until the next semicolon for ADD COLUMN tokens. Robust to multi-line
    statements + IF NOT EXISTS variations.
    """
    found: set[str] = set()

    # Find every ALTER TABLE <table> block (DOTALL so the body can
    # span multiple lines).
    block_pattern = re.compile(
        rf"ALTER\s+TABLE\s+(?:public\.)?{re.escape(table_name)}\b(.*?);",
        re.IGNORECASE | re.DOTALL,
    )
    for block_match in block_pattern.finditer(sql_text):
        body = block_match.group(1)
        # Strip line comments so commented-out columns aren't picked up.
        body = re.sub(r"--[^\n]*", "", body)
        for col_match in _ALTER_ADD_COLUMN_RE.finditer(body):
            found.add(col_match.group(1).lower())

    return found


def _gather_alter_columns(table_name: str) -> set[str]:
    """Aggregate ALTER TABLE columns across every migration file."""
    migrations_dir = Path(__file__).parent.parent / "migrations"
    columns: set[str] = set()
    for sql_file in sorted(migrations_dir.glob("*.sql")):
        text = sql_file.read_text(encoding="utf-8")
        columns |= _parse_alter_table_columns(text, table_name)
    return columns


def _table_columns(table_name: str, baseline: set[str]) -> set[str]:
    """Authoritative-against-the-codebase column set for a table."""
    return baseline | _gather_alter_columns(table_name)


# ── Per-service SELECTed columns (Sprint 5.0) ─────────────────────────
#
# UPDATE THESE SETS in lockstep with the SELECT statements in the
# corresponding service files. The test below asserts every column
# named here is reachable through baseline ∪ migrations. If you add
# a typo'd column to a service SELECT, this test catches it before
# production does (anti-pattern #37 prevention).

SESSION_AGGREGATOR_SESSIONS_SELECT: set[str] = {
    "overall_band", "band_fc", "band_lr", "band_gra", "band_p",
}

SESSION_AGGREGATOR_RESPONSES_SELECT: set[str] = {
    "overall_band", "pronunciation_score", "grading_status",
}


# ── Tests ─────────────────────────────────────────────────────────────


def test_alter_table_parser_picks_up_known_pronunciation_columns():
    """Sanity-check the parser against a known migration. Migration 004
    adds 8 pronunciation_* columns to responses; the parser must find
    all of them. Failures here mean the regex broke, not the schema."""
    cols = _gather_alter_columns("responses")
    # Pronunciation columns from migration 004.
    expected_pronunciation = {
        "pronunciation_score",
        "pronunciation_fluency",
        "pronunciation_accuracy",
        "pronunciation_completeness",
        "pronunciation_status",
        "pronunciation_payload",
        "pronunciation_provider",
        "pronunciation_locale",
    }
    missing = expected_pronunciation - cols
    assert not missing, (
        f"ALTER TABLE parser missed known pronunciation columns: {missing}. "
        f"Either the parser regex broke or migration 004 was renamed."
    )


def test_alter_table_parser_picks_up_known_session_error_columns():
    """Migration 003 adds error_code/error_message/etc to sessions."""
    cols = _gather_alter_columns("sessions")
    expected_error = {"error_code", "error_message"}
    missing = expected_error - cols
    assert not missing, f"Parser missed migration 003's error columns: {missing}"


def test_session_aggregator_sessions_select_columns_in_schema():
    """Pin the columns `compute_session_band_aggregate` SELECTs from
    the sessions table. Any future SELECT that names a non-existent
    column (e.g., the 2.7d.1.1-style `level` vs `analysis_level`
    typo) fails here — surface the bug locally, not in production."""
    sessions_columns = _table_columns("sessions", BASELINE_SESSIONS_COLUMNS)
    missing = SESSION_AGGREGATOR_SESSIONS_SELECT - sessions_columns
    assert not missing, (
        f"speaking_session_aggregator.compute_session_band_aggregate "
        f"SELECTs columns from `sessions` that aren't in the schema "
        f"baseline + parsed ALTERs: {missing}. Either:\n"
        f"  - the column was renamed → update both the SELECT and "
        f"    SESSION_AGGREGATOR_SESSIONS_SELECT in lockstep;\n"
        f"  - the column is genuinely new → add it to the right "
        f"    migration file, then this test will pass.\n"
        f"Anti-pattern #37 prevention; see TECH_DEBT.md."
    )


def test_session_aggregator_responses_select_columns_in_schema():
    """Same pin for the responses SELECT inside compute_session_band_aggregate."""
    responses_columns = _table_columns("responses", BASELINE_RESPONSES_COLUMNS)
    missing = SESSION_AGGREGATOR_RESPONSES_SELECT - responses_columns
    assert not missing, (
        f"speaking_session_aggregator.compute_session_band_aggregate "
        f"SELECTs columns from `responses` that aren't in the schema: "
        f"{missing}"
    )


def test_baseline_does_not_overlap_alter_columns():
    """Hygiene check: a column either lives in the baseline OR was added
    via ALTER TABLE — not both. Overlap means the baseline drifted; the
    column should be removed from BASELINE_* and rely on the parser.

    Allow-list: error_code/error_message DO appear in both because the
    spec lists them as the current shape AND they were added in
    migration 003. Either source is legitimate. Empty allowlist for
    now — populate if real overlap surfaces."""
    sessions_alters = _gather_alter_columns("sessions")
    responses_alters = _gather_alter_columns("responses")

    sessions_overlap = BASELINE_SESSIONS_COLUMNS & sessions_alters
    responses_overlap = BASELINE_RESPONSES_COLUMNS & responses_alters

    # Allow-list known-OK overlaps. Right now the baselines were curated
    # to NOT include columns that are also in ALTERs, so this should be
    # empty — but recording the intent so a future curator knows what
    # to do.
    allowed_sessions_overlap: set[str] = set()
    allowed_responses_overlap: set[str] = set()

    unexpected_sessions = sessions_overlap - allowed_sessions_overlap
    unexpected_responses = responses_overlap - allowed_responses_overlap

    assert not unexpected_sessions, (
        f"BASELINE_SESSIONS_COLUMNS shadow ALTER-added columns: "
        f"{unexpected_sessions}. Remove from baseline — the parser "
        f"already covers them."
    )
    assert not unexpected_responses, (
        f"BASELINE_RESPONSES_COLUMNS shadow ALTER-added columns: "
        f"{unexpected_responses}. Remove from baseline."
    )
