"""Schema contract tests for the Vocabulary tables (Sprint 6.0).

Background — anti-pattern #37 ("Schema-naive test fixtures") was logged
during Sprint 2.7d.1.1: production crashed because a service-layer
SELECT named a column that didn't exist. The hardening pattern that
followed (test_speaking_schema_contract.py) parses every ALTER TABLE
in `backend/migrations/*.sql` for a table and pins SELECT call sites
against the union of (curated baseline ∪ parsed columns).

Sprint 6.0 brings the same gate to the vocabulary stack:

    - user_vocabulary    (created in migration 019, columns added in
                          028 / 029 / 030)
    - flashcard_stacks   (migration 025 — full CREATE TABLE in one file)
    - flashcard_reviews  (migration 027 — full CREATE TABLE in one file)

For tables whose CREATE TABLE lives entirely in a versioned migration
(stacks + reviews), we parse the CREATE TABLE block and assert every
column the service layer reads is present. For user_vocabulary —
which has a CREATE TABLE in 019 plus columns added in 028/029/030 —
we parse both forms and union.

What this catches: a SELECT that names `is_skipped` but the column
hasn't been added (or was renamed) in a migration. What it doesn't
catch: a column renamed in production via a non-tracked DBA step —
out of band, rare, and the codebase contract is what matters for
ongoing development.
"""

from __future__ import annotations

import re
from pathlib import Path


# ── Service-layer SELECT call sites we want to pin ────────────────────


# Sources for these sets:
#   - routers/grading.py  _run_vocab_extraction_bg  (insert columns are
#     a superset of the SELECT, but the column names are the same)
#   - routers/vocabulary_bank.py  several SELECTs
#   - services/student_home_aggregator.py  _build_vocabulary
#
# Update in lockstep with the SELECT statement when adding/removing
# columns. Inserts also count — if you insert a column that doesn't
# exist, production crashes the same way.
USER_VOCABULARY_REFERENCED_COLUMNS: set[str] = {
    "id", "user_id", "session_id", "response_id",
    "headword", "context_sentence", "evidence_substring",
    "category", "source_type", "reason",
    "definition_en", "definition_vi",
    "original_word", "suggestion",
    "topic", "ipa", "example_sentence",
    "mastery_status", "is_archived", "is_skipped",
    "created_at",
}

FLASHCARD_STACKS_REFERENCED_COLUMNS: set[str] = {
    "id", "user_id", "name", "type", "filter_config", "created_at",
}

FLASHCARD_REVIEWS_REFERENCED_COLUMNS: set[str] = {
    "id", "user_id", "vocabulary_id",
    "last_reviewed_at", "next_review_at",
    "ease_factor", "interval_days",
    "review_count", "lapse_count",
    "created_at", "updated_at",
}


# ── Migration parser ──────────────────────────────────────────────────


_CREATE_TABLE_BLOCK = re.compile(
    r"CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:public\.)?{name}\s*\((.*?)\)\s*;",
    re.IGNORECASE | re.DOTALL,
)
_ALTER_ADD_COLUMN_RE = re.compile(
    r"ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)",
    re.IGNORECASE,
)


def _parse_create_table_columns(sql_text: str, table_name: str) -> set[str]:
    """Extract column names from `CREATE TABLE table_name (...)` blocks.

    Each comma-separated clause inside the parens that begins with an
    identifier (and isn't a CONSTRAINT / UNIQUE / PRIMARY KEY / FOREIGN
    KEY / CHECK clause) is a column definition; the first token is the
    column name. Multi-line tolerant — comments and complex CHECKs are
    handled by stripping line comments before splitting."""
    pattern = re.compile(
        _CREATE_TABLE_BLOCK.pattern.format(name=re.escape(table_name)),
        re.IGNORECASE | re.DOTALL,
    )
    columns: set[str] = set()
    for m in pattern.finditer(sql_text):
        body = m.group(1)
        # Drop line comments so a "-- column foo" comment doesn't sneak
        # in as a column.
        body = re.sub(r"--[^\n]*", "", body)
        depth = 0
        current = []
        clauses: list[str] = []
        # Simple paren-aware split so a multi-line CHECK with embedded
        # commas doesn't fragment the column list.
        for ch in body:
            if ch == "(":
                depth += 1
                current.append(ch)
            elif ch == ")":
                depth -= 1
                current.append(ch)
            elif ch == "," and depth == 0:
                clauses.append("".join(current).strip())
                current = []
            else:
                current.append(ch)
        if current:
            clauses.append("".join(current).strip())

        for clause in clauses:
            if not clause:
                continue
            head = clause.split(None, 1)[0].upper()
            if head in {"CONSTRAINT", "UNIQUE", "PRIMARY", "FOREIGN", "CHECK"}:
                continue
            # First token is the column name.
            name = clause.split(None, 1)[0]
            # Strip surrounding quotes if any.
            name = name.strip('"').lower()
            if name and re.match(r"^[a-z_][a-z0-9_]*$", name):
                columns.add(name)
    return columns


def _parse_alter_add_columns(sql_text: str, table_name: str) -> set[str]:
    """Find every column added to `table_name` via ALTER TABLE ADD COLUMN."""
    block_pattern = re.compile(
        rf"ALTER\s+TABLE\s+(?:public\.)?{re.escape(table_name)}\b(.*?);",
        re.IGNORECASE | re.DOTALL,
    )
    found: set[str] = set()
    for m in block_pattern.finditer(sql_text):
        body = re.sub(r"--[^\n]*", "", m.group(1))
        for col_match in _ALTER_ADD_COLUMN_RE.finditer(body):
            found.add(col_match.group(1).lower())
    return found


def _gather_columns(table_name: str) -> set[str]:
    """Walk every migration file and union CREATE TABLE + ALTER TABLE
    columns for the given table."""
    migrations_dir = Path(__file__).parent.parent / "migrations"
    columns: set[str] = set()
    for sql_file in sorted(migrations_dir.glob("*.sql")):
        text = sql_file.read_text(encoding="utf-8")
        columns |= _parse_create_table_columns(text, table_name)
        columns |= _parse_alter_add_columns(text, table_name)
    return columns


# ── Tests ─────────────────────────────────────────────────────────────


def test_parser_picks_up_known_user_vocabulary_columns():
    """Sanity-check the parser against a known migration. Migration 019
    creates the table; the parser must surface the foundational columns.
    A failure here means the parser regex broke, not the schema."""
    cols = _gather_columns("user_vocabulary")
    expected_foundational = {
        "id", "user_id", "headword", "source_type",
        "category", "is_archived", "created_at",
    }
    missing = expected_foundational - cols
    assert not missing, (
        f"Parser missed foundational user_vocabulary columns: {missing}. "
        f"Either the parser regex broke or migration 019 was renamed. "
        f"Saw: {sorted(cols)}"
    )


def test_parser_picks_up_alter_added_user_vocabulary_columns():
    """Migrations 028 (topic) / 029 (ipa, example_sentence) / 030
    (is_skipped) added columns post-019. The parser must find them via
    ALTER TABLE."""
    cols = _gather_columns("user_vocabulary")
    expected_alters = {"topic", "ipa", "example_sentence", "is_skipped"}
    missing = expected_alters - cols
    assert not missing, (
        f"Parser missed ALTER-added columns: {missing}. "
        f"Saw: {sorted(cols)}"
    )


def test_user_vocabulary_referenced_columns_in_schema():
    """Pin the columns service code SELECTs / INSERTs from
    user_vocabulary against the union of CREATE + ALTER. A future
    typo (`is_skiped`, `evidance_substring`) fails here before
    production."""
    cols = _gather_columns("user_vocabulary")
    missing = USER_VOCABULARY_REFERENCED_COLUMNS - cols
    assert not missing, (
        f"Service code references columns not in schema: {missing}. "
        f"If you renamed a column, update USER_VOCABULARY_REFERENCED_"
        f"COLUMNS and the SELECT/INSERT call sites in lockstep. "
        f"Anti-pattern #37."
    )


def test_flashcard_stacks_referenced_columns_in_schema():
    cols = _gather_columns("flashcard_stacks")
    missing = FLASHCARD_STACKS_REFERENCED_COLUMNS - cols
    assert not missing, (
        f"Service code references flashcard_stacks columns not in schema: {missing}"
    )


def test_flashcard_reviews_referenced_columns_in_schema():
    cols = _gather_columns("flashcard_reviews")
    missing = FLASHCARD_REVIEWS_REFERENCED_COLUMNS - cols
    assert not missing, (
        f"Service code references flashcard_reviews columns not in schema: {missing}"
    )


def test_migration_048_archives_needs_review_targets_correct_columns():
    """The Sprint 6.0 archive migration touches `is_archived` (filter +
    set) and `reason` (audit-trail append). Both must exist on
    user_vocabulary or the migration silently no-ops in production."""
    cols = _gather_columns("user_vocabulary")
    assert "is_archived" in cols, (
        "Migration 048 sets is_archived=true but the column isn't in "
        "the parsed schema."
    )
    assert "reason" in cols, (
        "Migration 048 appends to the `reason` column for the audit "
        "trail; column missing from parsed schema."
    )


def test_migration_048_file_is_idempotent_form():
    """The file must use a WHERE clause that makes a re-run a no-op.
    Without this guard, re-applying the migration would double-stamp
    the audit-trail string in `reason` for already-archived rows."""
    mig = (
        Path(__file__).parent.parent
        / "migrations"
        / "048_archive_needs_review_vocab.sql"
    )
    text = mig.read_text(encoding="utf-8")
    assert "is_archived = false" in text.lower(), (
        "Migration 048 must filter on is_archived = false to be "
        "idempotent. Without the guard, re-running re-stamps the "
        "audit string and bloats the `reason` column."
    )
    assert "needs_review" in text, "Migration must target the deprecated source_type"
