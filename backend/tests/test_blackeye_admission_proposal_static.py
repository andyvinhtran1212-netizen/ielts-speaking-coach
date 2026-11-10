"""Source-only, unnumbered SQL proposal checks; never PostgreSQL execution."""
from pathlib import Path
import re

import pytest

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
PROPOSAL = Path(__file__).resolve().parents[2] / "docs/proposals/blackeye-u1/admission.sql"
SQL = PROPOSAL.read_text()
LEGACY = (MIGRATIONS / "304_listening_80_days_source_collection.sql").read_text()
TABLES = ("listening_content_packages", "listening_lessons", "listening_tests")


def uncomment(sql):
    return re.sub(r"/\*.*?\*/|--[^\n]*", "", sql, flags=re.S)


def assert_narrow_sql(sql):
    sql = uncomment(sql)
    remaining = sql
    for table in TABLES:
        exact = rf"ALTER\s+TABLE\s+public\.{table}\s+DROP\s+CONSTRAINT\s+{table}_programme_id_check\s*;"
        assert len(re.findall(exact, remaining, re.I)) == 1
        remaining = re.sub(exact, "", remaining, flags=re.I)
    assert not re.search(r"\bDROP\b", remaining, re.I), "non-whitelisted DROP"
    # No authoring of row DML/history/flag mutation. INSERT is only a trigger
    # event declaration; the existing acquire/capture functions own admission.
    without_row_locks = re.sub(r"\bFOR\s+UPDATE\b", "", remaining, flags=re.I)
    assert not re.search(r"\b(?:UPDATE|DELETE|TRUNCATE|MERGE|INSERT\s+INTO)\b", without_row_locks, re.I)
    assert not re.search(r"\bCREATE\s+(?:UNLOGGED\s+)?TABLE\b", remaining, re.I)
    assert not re.search(r"\bALTER\s+(?:ROLE|SYSTEM|DATABASE)\b|DISABLE\s+(?:TRIGGER|ROW)", remaining, re.I)
    without_grant = remaining.replace("GRANT EXECUTE ON FUNCTION public.fn_acquire_blackeye_attempt(UUID,UUID,JSONB,TEXT) TO service_role;", "")
    assert not re.search(r"\b(?:COPY|EXECUTE)\s+(?!FUNCTION\b)", without_grant, re.I)
    assert "set_config(" not in remaining.lower()
    assert not re.search(r"GRANT\s+.*?\bTO\s+(?:PUBLIC|anon|authenticated)\b", remaining, re.I|re.S)


def check_values(sql, table):
    pattern = rf"ADD\s+CONSTRAINT\s+{table}_programme_id_check\s+CHECK\s*\(programme_id\s+IN\s*\((.*?)\)\)"
    matches = re.findall(pattern, uncomment(sql), re.I|re.S)
    assert len(matches) == 1
    return re.findall(r"'([^']*)'", matches[0])


def test_sql_only_three_approved_drops_and_no_destructive_statement():
    assert_narrow_sql(SQL)


@pytest.mark.parametrize("table", TABLES)
def test_each_legacy_value_preserved_byte_exact_only_blackeye_added(table):
    legacy = check_values(LEGACY, table)
    proposed = check_values(SQL, table)
    for value in legacy:
        assert proposed.count(value) == 1, value
    assert proposed == legacy + ["blackeye-v5-upper-listening"]


@pytest.mark.parametrize("bad", ["DROP TABLE public.listening_tests;", "ALTER TABLE public.listening_tests DROP COLUMN metadata;",
    "ALTER TABLE public.listening_tests DROP CONSTRAINT another_check;", "DELETE FROM public.listening_test_attempts;",
    "UPDATE public.listening_tests SET status='published';", "CREATE TABLE public.unapproved(id int);",
    "TRUNCATE public.listening_test_attempts;", "GRANT EXECUTE ON FUNCTION public.fn_acquire_blackeye_attempt(UUID,UUID,JSONB,TEXT) TO authenticated;"])
def test_sql_safety_assertion_rejects_mutated_unapproved_operation(bad):
    with pytest.raises(AssertionError): assert_narrow_sql(SQL + "\n" + bad)


def test_definer_search_path_grants_and_atomic_admission_source_invariants():
    clean = uncomment(SQL)
    functions = re.findall(r"CREATE OR REPLACE FUNCTION\s+public\.(\w+)\(.*?\)\s*RETURNS\s+.*?\$\$(.*?)\$\$;", clean, re.S|re.I)
    assert {name for name,_ in functions} == {"fn_guard_blackeye_admission", "fn_acquire_blackeye_attempt"}
    assert len(re.findall(r"SECURITY DEFINER SET search_path = pg_catalog, pg_temp", clean)) == 2
    assert "auth.role() IS DISTINCT FROM 'service_role'" in clean
    assert "REVOKE ALL ON FUNCTION public.fn_guard_blackeye_admission() FROM PUBLIC,anon,authenticated;" in clean
    assert "REVOKE ALL ON FUNCTION public.fn_acquire_blackeye_attempt(UUID,UUID,JSONB,TEXT) FROM PUBLIC,anon,authenticated;" in clean
    assert "GRANT EXECUTE ON FUNCTION public.fn_acquire_blackeye_attempt(UUID,UUID,JSONB,TEXT) TO service_role;" in clean
    acquire = dict(functions)["fn_acquire_blackeye_attempt"]
    assert acquire.index("fn_lock_mock_paper") < acquire.index("full_binding:=") < acquire.index("fn_acquire_listening_programme_attempt_v2")
    assert "pg_advisory_xact_lock" in acquire and "FOR UPDATE" in acquire
    assert "p_binding ? 'answer_set_revision'" in acquire
    assert "full_binding-'answer_set_revision'" in acquire
    assert "snapshot#>'{paper_row,metadata,blackeye,binding}'-'answer_set_revision'" in acquire
    assert "mock_paper_attempt_snapshots" in acquire
    assert "fn_mock_admission_contract_active()" in acquire
    guard = dict(functions)["fn_guard_blackeye_admission"]
    for clause in ("NEW.class_assignment_item_id IS NOT NULL", "NEW.sitting_id IS NOT NULL", "NEW.attempt_purpose IS DISTINCT FROM 'practice'", "n NOT BETWEEN 1 AND 48", "n<>48", "'U1-A08','U1-A14','U1-A19'", "blackeye_db_revisions", "blackeye_context"):
        assert clause in guard
    assert clean.strip().startswith("BEGIN;") and clean.strip().endswith("COMMIT;")


def test_unnumbered_proposal_is_not_a_forward_migration_or_ci_script_input():
    # Read the real discovery function; never invoke its DB/apply helpers.
    from test_client_write_invariant_postgres import _forward_migrations
    repo = MIGRATIONS.parent.parent
    assert PROPOSAL not in _forward_migrations()
    assert PROPOSAL.parent != MIGRATIONS and not re.match(r"\d+_", PROPOSAL.name)
    migration = MIGRATIONS / "376_blackeye_admission.sql"
    assert migration in _forward_migrations()
    assert uncomment(migration.read_text()).strip() == uncomment(SQL).strip()
    rollback = (MIGRATIONS / "rollback/376_blackeye_admission.sql").read_text()
    assert "DROP TRIGGER IF EXISTS trg_zz_blackeye_admission" in rollback
    assert not re.search(r"\b(?:DELETE|TRUNCATE|UPDATE)\b", uncomment(rollback), re.I)
    # No workflow or runnable script references the proposal. Its only reader is
    # this source-only test; selecting it in regular CI cannot execute the SQL.
    for root in (repo / ".github/workflows", repo / "scripts", MIGRATIONS.parent / "scripts"):
        for path in root.rglob("*"):
            if path.is_file() and path.suffix in {".py", ".sh", ".sql", ".yml", ".yaml"}:
                text = path.read_text()
                assert "docs/proposals/blackeye-u1" not in text, path
                assert "fn_acquire_blackeye_attempt" not in text, path


def test_server_revision_context_errors_are_separate_from_learner_binding():
    guard = SQL[SQL.index("CREATE OR REPLACE FUNCTION public.fn_guard_blackeye_admission"):SQL.index("CREATE TRIGGER")]
    for name, error in (("blackeye_db_revisions", "blackeye_unavailable_revision"),
                        ("blackeye_context", "blackeye_unavailable_context")):
        block = guard[guard.index(f"IF paper#>'{{metadata,{name}}}'"):]
        block = block[:block.index("END IF;")]
        assert error in block and "blackeye_invalid_binding" not in block
