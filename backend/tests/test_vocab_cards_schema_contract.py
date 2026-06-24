"""Schema contract for the M3 vocab_cards table (migration 110) + the importer
payload col-match (the compose-500 #538 mock-vs-DB lesson).

No live DB in tests (FakeSupabase / MagicMock don't enforce NOT-NULL or unknown
columns), so a migration sentinel parses 110_vocab_cards.sql and pins the
table shape, AND a col-match test asserts every key services.vocab_import writes
is a real column — and every NOT-NULL-without-default column is in the payload.
This catches the #538 failure mode statically: a writer key the table lacks (→
insert error) or a required column the writer omits (→ 23502 at runtime).
"""

from __future__ import annotations

import re
from pathlib import Path

_MIGDIR = Path(__file__).parent.parent / "migrations"
_MIG = _MIGDIR / "110_vocab_cards.sql"


def _sql() -> str:
    return _MIG.read_text(encoding="utf-8")


def _all_vocab_cols() -> set[str]:
    """Full vocab_cards column set = mig 110 CREATE TABLE ∪ later additive
    ALTER TABLE … ADD COLUMN <name> (e.g. 111 syllables). Keeps the col-match
    guard correct as additive migrations land."""
    cols = _column_names(_create_table_block(_sql(), "vocab_cards"))
    for p in sorted(_MIGDIR.glob("*.sql")):
        for m in re.finditer(
            r'ALTER\s+TABLE\s+vocab_cards\s+ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([a-z_]+)"?',
            p.read_text(encoding="utf-8"), re.IGNORECASE):
            cols.add(m.group(1))
    return cols


def _create_table_block(sql: str, table: str) -> str:
    m = re.search(
        rf"CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+{re.escape(table)}\s*\((.*?)\n\);",
        sql, re.IGNORECASE | re.DOTALL,
    )
    assert m, f"CREATE TABLE for `{table}` not found"
    return m.group(1)


def _column_lines(block: str) -> list[str]:
    """Definition lines only (skip table-level constraints / blank / comment lines)."""
    out = []
    for raw in block.splitlines():
        line = raw.strip()
        if not line or line.startswith("--"):
            continue
        # column lines start with an identifier (bare or "quoted"); constraints
        # we don't define inline here, so every real line is a column.
        if re.match(r'^("?[a-z_]+"?)\s', line):
            out.append(line)
    return out


def _column_names(block: str) -> set[str]:
    names = set()
    for line in _column_lines(block):
        m = re.match(r'^"?([a-z_]+)"?\s', line)
        if m:
            names.add(m.group(1))
    return names


def _not_null_without_default(block: str) -> set[str]:
    cols = set()
    for line in _column_lines(block):
        m = re.match(r'^"?([a-z_]+)"?\s', line)
        if not m:
            continue
        name = m.group(1)
        is_nn = re.search(r"\bNOT\s+NULL\b", line, re.IGNORECASE)
        has_default = re.search(r"\bDEFAULT\b", line, re.IGNORECASE)
        is_pk = re.search(r"\bPRIMARY\s+KEY\b", line, re.IGNORECASE)
        if is_nn and not has_default and not is_pk:
            cols.add(name)
    return cols


# ── Migration sentinel ────────────────────────────────────────────────


def test_migration_exists_and_idempotent():
    assert _MIG.exists(), "110_vocab_cards.sql missing"
    assert re.search(r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+vocab_cards\b",
                     _sql(), re.IGNORECASE), "vocab_cards not created IF NOT EXISTS"


def test_vocab_cards_has_expected_columns():
    cols = _column_names(_create_table_block(_sql(), "vocab_cards"))
    expected = {
        "id", "slug", "headword", "category", "level", "part_of_speech",
        "pronunciation", "definition_en", "gloss_vi", "example", "register",
        "common_error", "memory_hook", "source", "group", "synonyms",
        "antonyms", "collocations", "related_words", "body_html",
        "audio_headword", "audio_example", "audio_status", "import_batch_id",
        "created_at", "updated_at",
    }
    missing = expected - cols
    assert not missing, f"vocab_cards missing columns: {missing}"


def test_slug_unique_not_null_and_identity_required():
    block = _create_table_block(_sql(), "vocab_cards")
    assert re.search(r"slug\s+TEXT\s+NOT\s+NULL\s+UNIQUE", block, re.IGNORECASE)
    # Identity trio is required (the importer upserts by slug).
    assert _not_null_without_default(block) == {"slug", "headword", "category"}


def test_audio_columns_nullable_for_slice2():
    """Slice-2 (TTS) must need 0 migration → audio_* exist + are nullable now."""
    block = _create_table_block(_sql(), "vocab_cards")
    for col in ("audio_headword", "audio_example"):
        line = next(l for l in _column_lines(block) if l.startswith(col))
        assert not re.search(r"\bNOT\s+NULL\b", line, re.IGNORECASE), f"{col} must be nullable"
    # audio_status is NOT NULL but DEFAULT 'pending' (so inserts omitting it are safe).
    status = next(l for l in _column_lines(block) if l.startswith("audio_status"))
    assert "DEFAULT 'pending'" in status


def test_list_columns_default_empty_jsonb():
    block = _create_table_block(_sql(), "vocab_cards")
    for col in ("synonyms", "antonyms", "collocations", "related_words"):
        line = next(l for l in _column_lines(block) if l.startswith(col))
        assert "JSONB" in line and "DEFAULT '[]'" in line, f"{col} must default to '[]' jsonb"


def test_rls_public_read_only():
    sql = _sql()
    assert "ENABLE ROW LEVEL SECURITY" in sql
    assert re.search(r"CREATE\s+POLICY\s+vocab_cards_public_read", sql, re.IGNORECASE)
    assert "FOR SELECT USING (true)" in sql
    # No write policy → only the service-role key (bypasses RLS) can write.
    assert not re.search(r"FOR\s+(INSERT|UPDATE|DELETE)", sql, re.IGNORECASE)


def test_updated_at_trigger_present():
    sql = _sql()
    assert "trg_vocab_cards_updated_at" in sql
    assert "update_updated_at_column()" in sql


# ── MANDATORY col-match: importer payload ⊆ migration columns ──────────


def test_build_payload_keys_are_all_real_columns():
    """Every key build_vocab_payload writes MUST be a vocab_cards column — else
    the insert/update would fail against the real DB (FakeSupabase wouldn't catch
    it). This is the #538 compose-500 guard, made schema-aware."""
    from services.vocab_import import (
        VocabParsed, build_vocab_payload, _SCALAR_FIELDS, _LIST_FIELDS)

    # Build from the REAL field tuples (drift-proof: a new scalar like `syllables`
    # is automatically exercised here).
    p = VocabParsed(
        headword="X", slug="x", category="technology", gloss_vi="g", body_html="<p>g</p>",
        scalars={k: "" for k in _SCALAR_FIELDS},
        lists={k: [] for k in _LIST_FIELDS},
    )
    payload = build_vocab_payload(p, import_batch_id="batch-1")
    cols = _all_vocab_cols()                      # mig 110 + additive ALTERs (111 syllables)
    unknown = set(payload.keys()) - cols
    assert not unknown, f"build_vocab_payload writes columns vocab_cards lacks: {unknown}"


def test_required_columns_are_covered_by_payload():
    """Every NOT-NULL-without-default column must appear in the payload, or a real
    insert 23502s (the #538 failure)."""
    from services.vocab_import import VocabParsed, build_vocab_payload

    p = VocabParsed(
        headword="X", slug="x", category="technology", gloss_vi="", body_html="",
        scalars={k: "" for k in (
            "level", "part_of_speech", "pronunciation", "definition_en", "example",
            "register", "common_error", "memory_hook", "source", "group")},
        lists={k: [] for k in ("synonyms", "antonyms", "collocations", "related_words")},
    )
    payload = build_vocab_payload(p)
    required = _not_null_without_default(_create_table_block(_sql(), "vocab_cards"))
    missing = required - set(payload.keys())
    assert not missing, f"payload omits NOT-NULL columns (would 23502): {missing}"
