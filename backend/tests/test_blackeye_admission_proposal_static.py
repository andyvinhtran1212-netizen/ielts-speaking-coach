"""Source-only gated SQL checks; PostgreSQL execution has a separate suite."""
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
    trigger_drop = 'DROP TRIGGER IF EXISTS trg_zz_blackeye_admission ON public.listening_test_attempts;'
    assert remaining.count(trigger_drop) == 1
    remaining = remaining.replace(trigger_drop, '', 1)
    assert not re.search(r"\bDROP\b", remaining, re.I), "non-whitelisted DROP"
    approved_insert = """INSERT INTO public.listening_test_attempts
            (test_id,user_id,status,answers,scoring_policy,started_at,resume_expires_at,
             renderer_affinity,attempt_purpose)
        VALUES (p_test_id,p_user_id,'in_progress','[]'::jsonb,'report_only',clock_timestamp(),
                clock_timestamp()+interval '24 hours',
                CASE WHEN p_renderer_affinity_protocol='claim-v1' THEN NULL ELSE 'legacy' END,'practice')
        RETURNING to_jsonb(listening_test_attempts.*) INTO attempt;"""
    assert remaining.count(approved_insert) == 1
    acquire = remaining[remaining.index("CREATE OR REPLACE FUNCTION public.fn_acquire_blackeye_attempt("):]
    assert approved_insert in acquire[:acquire.index("END $$;")]
    remaining = remaining.replace(approved_insert, "", 1)

    # Permit exactly the authorized submit UPDATE, inside its sole function.
    # Keep the destructive-statement scan over every other function and SQL.
    approved_update = """UPDATE public.listening_test_attempts SET status='submitted',submitted_at=clock_timestamp(),
        result_summary=p_result_summary,score=NULL,band_estimate=NULL,
        grading_details='[]'::jsonb,trap_analytics='{}'::jsonb
        WHERE id=attempt.id RETURNING * INTO attempt;"""
    assert remaining.count(approved_update) == 1
    submit = remaining[remaining.index("CREATE OR REPLACE FUNCTION public.fn_submit_blackeye_attempt("):]
    assert approved_update in submit[:submit.index("END $$;")]
    remaining = remaining.replace(approved_update, "", 1)
    without_row_locks = re.sub(r"\bFOR\s+UPDATE\b", "", remaining, flags=re.I)
    assert not re.search(r"\b(?:UPDATE|DELETE|TRUNCATE|MERGE|INSERT\s+INTO)\b", without_row_locks, re.I)
    assert not re.search(r"\bCREATE\s+(?:UNLOGGED\s+)?TABLE\b", remaining, re.I)
    assert not re.search(r"\bALTER\s+(?:ROLE|SYSTEM|DATABASE)\b|DISABLE\s+(?:TRIGGER|ROW)", remaining, re.I)
    remaining = remaining.replace("GRANT EXECUTE ON FUNCTION public.fn_submit_blackeye_attempt(UUID,UUID,JSONB,JSONB) TO service_role;", "")
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
    assert {name for name,_ in functions} == {"fn_guard_blackeye_admission", "fn_acquire_blackeye_attempt", "fn_submit_blackeye_attempt"}
    assert len(re.findall(r"SECURITY DEFINER SET search_path = pg_catalog, pg_temp", clean)) == 3
    assert "auth.role() IS DISTINCT FROM 'service_role'" in clean
    assert "REVOKE ALL ON FUNCTION public.fn_guard_blackeye_admission() FROM PUBLIC,anon,authenticated;" in clean
    assert "REVOKE ALL ON FUNCTION public.fn_acquire_blackeye_attempt(UUID,UUID,JSONB,TEXT) FROM PUBLIC,anon,authenticated;" in clean
    assert "GRANT EXECUTE ON FUNCTION public.fn_acquire_blackeye_attempt(UUID,UUID,JSONB,TEXT) TO service_role;" in clean
    acquire = dict(functions)["fn_acquire_blackeye_attempt"]
    assert acquire.index("fn_lock_mock_paper") < acquire.index("full_binding:=") < acquire.index("INSERT INTO public.listening_test_attempts")
    assert "pg_advisory_xact_lock" in acquire and "FOR UPDATE" in acquire
    assert "p_binding ? 'answer_set_revision'" in acquire
    assert "full_binding-'answer_set_revision'" in acquire
    assert "(snapshot#>'{paper_row,metadata,blackeye,binding}')-'answer_set_revision'" in acquire
    assert "mock_paper_attempt_snapshots" in acquire
    assert "fn_mock_admission_contract_active()" in acquire
    guard = dict(functions)["fn_guard_blackeye_admission"]
    for clause in ("NEW.class_assignment_item_id IS NOT NULL", "NEW.sitting_id IS NOT NULL", "NEW.attempt_purpose IS DISTINCT FROM 'practice'", "n NOT BETWEEN 1 AND 48", "n<>48", "'U1-A08','U1-A14','U1-A19'", "blackeye_db_revisions", "blackeye_context"):
        assert clause in guard
    assert clean.strip().startswith("BEGIN;") and clean.strip().endswith("COMMIT;")


def assert_no_proposal_script_input(path, text):
    assert "docs/proposals/blackeye-u1" not in text, path
    assert "fn_acquire_blackeye_attempt" not in text, path


def test_unnumbered_proposal_is_not_a_forward_migration_or_ci_script_input():
    # Read the real discovery function; never invoke its DB/apply helpers.
    from test_client_write_invariant_postgres import _forward_migrations
    repo = MIGRATIONS.parent.parent
    assert PROPOSAL not in _forward_migrations()
    assert PROPOSAL.parent != MIGRATIONS and not re.match(r"\d+_", PROPOSAL.name)
    migration = MIGRATIONS / "376_blackeye_admission.sql"
    policy = [line.split("\t") for line in (MIGRATIONS / "forward-policy.tsv").read_text().splitlines() if line.startswith(migration.name + "\t")]
    assert len(policy) == 1 and policy[0][1:3] == ["pending_feature", "blackeye_admission"]
    assert uncomment(migration.read_text()).strip() == uncomment(SQL).strip()
    rollback = (MIGRATIONS / "rollback/376_blackeye_admission.sql").read_text()
    assert rollback.index("RAISE EXCEPTION 'blackeye_rollback_published_content'") < rollback.index("DROP FUNCTION")
    assert "IN SHARE MODE" in rollback
    for table in TABLES:
        assert f"SELECT 1 FROM public.{table}" in rollback
    assert "status='published'" in rollback and "is_public IS TRUE" in rollback
    assert "DROP TRIGGER IF EXISTS trg_zz_blackeye_admission" in rollback
    assert not re.search(r"\b(?:DELETE|TRUNCATE|UPDATE)\b", uncomment(rollback), re.I)
    # No workflow or runnable script references the proposal. Its only reader is
    # this source-only test; selecting it in regular CI cannot execute the SQL.
    for root in (repo / ".github/workflows", repo / "scripts", MIGRATIONS.parent / "scripts"):
        for path in root.rglob("*"):
            if path.is_file() and path.suffix in {".py", ".sh", ".sql", ".yml", ".yaml"}:
                assert_no_proposal_script_input(path, path.read_text())


@pytest.mark.parametrize("bad", [
    "SELECT public.fn_acquire_blackeye_attempt(",
    "PERFORM public.fn_acquire_blackeye_attempt(",
    "-- fn_acquire_blackeye_attempt",
    "-- docs/proposals/blackeye-u1",
])
def test_proposal_script_isolation_rejects_calls_and_extra_mentions(bad):
    postconditions = MIGRATIONS.parent / "scripts/sql/staging_clone_postconditions.sql"
    with pytest.raises(AssertionError):
        assert_no_proposal_script_input(postconditions, postconditions.read_text() + "\n" + bad)


def test_server_revision_context_errors_are_separate_from_learner_binding():
    guard = SQL[SQL.index("CREATE OR REPLACE FUNCTION public.fn_guard_blackeye_admission"):SQL.index("CREATE TRIGGER")]
    for name, error in (("blackeye_db_revisions", "blackeye_unavailable_revision"),
                        ("blackeye_context", "blackeye_unavailable_context")):
        block = guard[guard.index(f"IF paper#>'{{metadata,{name}}}'"):]
        block = block[:block.index("END IF;")]
        assert error in block and "blackeye_invalid_binding" not in block


def test_submit_lock_owner_status_expiry_and_service_acl_source_invariants():
    body = SQL[SQL.index("CREATE OR REPLACE FUNCTION public.fn_submit_blackeye_attempt("):]
    assert body.index("auth.role() IS DISTINCT FROM 'service_role'") < body.index("FOR UPDATE")
    assert body.index("FOR UPDATE") < body.index("attempt.status='submitted'") < body.index("UPDATE public.listening_test_attempts")
    for clause in ("a.id=p_attempt_id AND a.user_id=p_user_id", "attempt.resume_expires_at<=clock_timestamp()",
                   "attempt.answers IS DISTINCT FROM p_expected_answers", "attempt.class_assignment_item_id IS NOT NULL",
                   "attempt.sitting_id IS NOT NULL", "mock_paper_attempt_snapshots"):
        assert clause in body
    signature = "public.fn_submit_blackeye_attempt(UUID,UUID,JSONB,JSONB)"
    assert f"REVOKE ALL ON FUNCTION {signature} FROM PUBLIC,anon,authenticated;" in body
    assert f"GRANT EXECUTE ON FUNCTION {signature} TO service_role;" in body


@pytest.mark.parametrize("mutation", ["DELETE FROM public.listening_test_attempts;",
                                     "UPDATE public.listening_tests SET status='published';"])
def test_submit_function_cannot_hide_unapproved_dml(mutation):
    with pytest.raises(AssertionError):
        assert_narrow_sql(SQL.replace("WHERE id=attempt.id RETURNING * INTO attempt;",
                                     "WHERE id=attempt.id RETURNING * INTO attempt;\n" + mutation))


def test_strict_proposal_isolation_applies_to_every_script_path():
    for name in ("staging_clone_postconditions.sql", "other.sql"):
        path = MIGRATIONS.parent / "scripts/sql" / name
        for text in ("-- fn_acquire_blackeye_attempt", "SELECT public.fn_acquire_blackeye_attempt("):
            with pytest.raises(AssertionError):
                assert_no_proposal_script_input(path, text)


def test_q16_new_attempt_preserves_expired_and_submitted_work():
    acquire = SQL[SQL.index('CREATE OR REPLACE FUNCTION public.fn_acquire_blackeye_attempt('):SQL.index('-- A service-only submit boundary;')]
    assert "a.status='in_progress' AND a.resume_expires_at>clock_timestamp()" in acquire
    assert "fn_acquire_listening_programme_attempt_v2" not in acquire
    assert not re.search(r"\b(?:UPDATE|DELETE)\s+public\.", acquire, re.I)
    assert "INSERT INTO public.listening_test_attempts" in acquire
