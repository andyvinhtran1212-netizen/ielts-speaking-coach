"""RLSCLEANUP-0039: exact 29+3 policy replay, no client access to 21 tables.

Runs against a disposable LOCAL PostgreSQL database (TEST_PG_URL), with a
NOSUPERUSER table owner and the non-uniform service_role baseline from T001.
REQUIRE_PG=1 forbids skipped execution; the same tests run on PG16 and PG17.
No staging/production connection or real account is used.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from uuid import uuid4

import pytest

import test_migration_334_activate_attempt_rate_limit as m334
from test_migration_320_client_write_lockdown import _strip_sql_comments

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
NAME = "344_rls_admin_policy_cleanup.sql"
SQL = (MIGRATIONS / NAME).read_text(encoding="utf-8")
DOWN = (MIGRATIONS / "rollback" / NAME).read_text(encoding="utf-8")
CODE = _strip_sql_comments(SQL)
RUNNER = "rls344_runner"
LEARNER = "00000000-0000-0000-0000-000000000344"
INSTRUCTOR = "00000000-0000-0000-0000-000000000345"
BL11 = {"Authenticated users can report own errors", "regrade_requests_student_insert",
        "writing_drafts_student_own"}
DROPPED = {
    ('access_codes', 'access_codes_admin_all'): '106_instructor_role_foundation.sql',
    ('access_codes', 'access_codes_instructor_own'): '106_instructor_role_foundation.sql',
    ('class_action_log', 'cal_admin_append'): '198_class_action_log.sql',
    ('class_action_log', 'cal_admin_read'): '198_class_action_log.sql',
    ('class_assignment_items', 'class_assignment_items_admin_all'): '177_class_assignments.sql',
    ('class_assignments', 'class_assignments_admin_all'): '177_class_assignments.sql',
    ('class_lessons', 'class_lessons_admin_all'): '176_class_lessons.sql',
    ('cohorts', 'Admins manage cohorts'): '060_cohorts_table.sql',
    ('cohorts', 'Admins read all cohorts'): '060_cohorts_table.sql',
    ('cohorts', 'cohorts_instructor_own'): '106_instructor_role_foundation.sql',
    ('courses', 'courses_admin_all'): '175_courses.sql',
    ('error_logs', 'Admins dismiss error logs'): '061_error_logs.sql',
    ('error_logs', 'Admins read all error logs'): '061_error_logs.sql',
    ('error_logs', 'Authenticated users can report own errors'): '061_error_logs.sql',
    ('essay_regrade_requests', 'regrade_requests_admin_all'): '084_essay_regrade_requests.sql',
    ('essay_regrade_requests', 'regrade_requests_student_insert'): '084_essay_regrade_requests.sql',
    ('mock_exam_assignments', 'mock_exam_assignments_admin_all'): '154_mock_exam_retake_mode.sql',
    ('speaking_lesson_set_questions', 'slsq_admin_all'): '183_speaking_lesson_sets.sql',
    ('speaking_lesson_sets', 'speaking_lesson_sets_admin_all'): '183_speaking_lesson_sets.sql',
    ('speaking_progress_marks', 'spm_admin_all'): '185_speaking_progress_marks.sql',
    ('students', 'students_admin_all'): '033_writing_coach_tables.sql',
    ('students', 'students_instructor_own'): '106_instructor_role_foundation.sql',
    ('writing_assignment_requests', 'writing_assignment_requests_admin_all'): '206_writing_assignment_idempotency.sql',
    ('writing_assignments', 'writing_assignments_admin_all'): '036_writing_assignments.sql',
    ('writing_assignments', 'writing_assignments_instructor_own'): '106_instructor_role_foundation.sql',
    ('writing_drafts', 'writing_drafts_admin_all'): '037_writing_drafts.sql',
    ('writing_drafts', 'writing_drafts_student_own'): '037_writing_drafts.sql',
    ('writing_essays', 'writing_essays_admin_all'): '033_writing_coach_tables.sql',
    ('writing_feedback', 'writing_feedback_admin_all'): '033_writing_coach_tables.sql',
    ('writing_prompts', 'writing_prompts_admin_all'): '035_writing_prompts_library.sql',
    ('writing_prompts', 'writing_prompts_instructor_own'): '106_instructor_role_foundation.sql',
    ('writing_tips', 'writing_tips_admin_all'): '082_writing_tips.sql',
}
KEPT = {
    ('essay_regrade_requests', 'regrade_requests_student_own'): '084_essay_regrade_requests.sql',
    ('mock_exam_assignments', 'mock_exam_assignments_student_read'): '154_mock_exam_retake_mode.sql',
    ('students', 'students_self_read'): '034_writing_student_access.sql',
    ('writing_assignments', 'writing_assignments_student_read'): '036_writing_assignments.sql',
    ('writing_essays', 'writing_essays_student_read'): '034_writing_student_access.sql',
    ('writing_feedback', 'writing_feedback_student_read'): '034_writing_student_access.sql',
    ('writing_tips', 'writing_tips_read_published'): '082_writing_tips.sql',
}
TABLES = sorted({t for t, _ in DROPPED})
PRIVILEGES = ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
sql = m334.sql


def _policies(path: str) -> dict[tuple[str, str], str]:
    code = _strip_sql_comments((MIGRATIONS / path).read_text(encoding='utf-8'))
    return {(m[2], m[1].strip('"')): m[0] for m in re.finditer(
        r'CREATE POLICY\s+("[^"]+"|\w+)\s+ON\s+(?:public\.)?(\w+)\b.*?;', code, re.S | re.I)}


def _array(name: str) -> list[str]:
    match = re.search(rf'{name}\s+CONSTANT TEXT\[\] := ARRAY\[(.*?)\];', CODE, re.S)
    assert match, name
    return re.findall(r"'([^']+)'", match[1])


def _normalize(statement: str) -> str:
    return re.sub(r'\s+', ' ', statement.replace('public.', '')).strip()


def test_exact_t001_scope_and_original_policy_definitions_in_down():
    assert len(TABLES) == 21 and len(DROPPED) == 32
    assert sum(name not in BL11 for _, name in DROPPED) == 29
    assert _array('target_tables') == TABLES
    assert set(_array('target_policies')) == {f'{t}.{p}' for t, p in DROPPED}
    restored = {(m[2], m[1].strip('"')): m[0] for m in re.finditer(
        r'CREATE POLICY\s+("[^"]+"|\w+)\s+ON\s+public\.(\w+)\b.*?;',
        _strip_sql_comments(DOWN), re.S | re.I)}
    assert set(restored) == set(DROPPED)
    for key, path in DROPPED.items():
        assert _normalize(restored[key]) == _normalize(_policies(path)[key]), key
    assert all(name != 'Admin only' for _, name in restored)


def test_one_transaction_no_grant_no_dml_and_no_application_schema_change():
    for text in (CODE, _strip_sql_comments(DOWN)):
        assert text.strip().startswith('BEGIN;') and text.strip().endswith('COMMIT;')
        assert "SET LOCAL lock_timeout = '5s';" in text
        for pattern in (r'\bGRANT\b', r'INSERT\s+INTO', r'DELETE\s+FROM', r'^\s*UPDATE\s',
                        r'\bTRUNCATE\s+(?:TABLE\s+)?public\.', r'ALTER\s+(?:TABLE|FUNCTION)',
                        r'DROP\s+(?:TABLE|FUNCTION)', r'CREATE\s+(?:TABLE|FUNCTION)'):
            assert not re.search(pattern, text, re.I | re.M), pattern
    assert 'CREATE POLICY' not in CODE
    assert "FROM anon, authenticated'" in CODE
    assert "REVOKE MAINTAIN ON public.%I FROM anon, authenticated" in CODE
    assert 'information_schema' not in CODE
    rows = [line.split('\t') for line in (MIGRATIONS / 'forward-policy.tsv').read_text().splitlines()
            if line.startswith(NAME + '\t')]
    assert len(rows) == 1 and rows[0][1:3] == ['pending_feature', 'rls_admin_cleanup']
    assert 'Migration `344` (PC-J131R' in (MIGRATIONS / 'README.md').read_text()


def _run(database: str, script: str, *, role: str | None = RUNNER) -> str:
    prefix = f'SET ROLE {role};\n' if role else ''
    result = subprocess.run([*m334._psql_args(database, app='rls344'), '-f', '-'],
                            input=prefix + script, capture_output=True, text=True,
                            timeout=120, env=m334._env())
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def _maintain(database: str) -> tuple[str, ...]:
    return ('MAINTAIN',) if int(sql(database, 'SHOW server_version_num')) >= 170000 else ()


def _snapshot(database: str) -> dict:
    return json.loads(sql(database, """
        SELECT jsonb_build_object(
          'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname, tablename, policyname)
                         FROM pg_policies p),
          'tables', (SELECT jsonb_agg(jsonb_build_array(c.relname, c.relrowsecurity, c.relacl::text)
                                      ORDER BY c.relname)
                       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                      WHERE n.nspname='public' AND c.relkind IN ('r','p')),
          'helpers', (SELECT jsonb_agg(jsonb_build_array(p.oid, p.proacl::text, p.prosrc)
                                       ORDER BY p.oid)
                        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                       WHERE n.nspname='public'
                         AND p.proname IN ('is_current_user_admin','is_current_user_instructor')))
    """))


def _service(snapshot: dict) -> dict:
    return {t: [a for a in (acl or '{}').strip('{}').split(',') if a.startswith('service_role=')]
            for t, _, acl in snapshot['tables']}


def _assert_closed(database: str) -> None:
    privileges = PRIVILEGES + _maintain(database)
    table_list = ','.join(f"'{t}'" for t in TABLES)
    priv_list = ','.join(f"'{p}'" for p in privileges)
    assert sql(database, f"""
        SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        CROSS JOIN (VALUES ('anon'),('authenticated')) r(name)
        CROSS JOIN unnest(ARRAY[{priv_list}]) p(name)
        WHERE n.nspname='public' AND c.relname IN ({table_list})
          AND (has_table_privilege(r.name,c.oid,p.name)
               OR CASE WHEN p.name IN ('SELECT','INSERT','UPDATE','REFERENCES')
                       THEN has_any_column_privilege(r.name,c.oid,p.name) ELSE false END)
    """) == '0'
    # Check raw catalog too: do not infer ACL truth from information_schema.
    assert sql(database, f"""
        SELECT count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE c.relnamespace='public'::regnamespace AND c.relname IN ({table_list})
          AND (a.grantee=0 OR pg_get_userbyid(a.grantee) IN ('anon','authenticated'))
    """) == '0'


@pytest.fixture
def db():
    try:
        available = shutil.which('psql') and sql('postgres', 'SELECT 1') == '1'
    except Exception:
        available = False
    if not available:
        if os.environ.get('REQUIRE_PG') == '1':
            pytest.fail('A disposable local PostgreSQL cluster is required')
        pytest.skip('Local PostgreSQL unavailable; set TEST_PG_URL and REQUIRE_PG=1')
    assert sql('postgres', 'SELECT usesuper FROM pg_user WHERE usename=current_user') == 't'
    sql('postgres', f"""DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
            CREATE ROLE service_role BYPASSRLS; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{RUNNER}') THEN
            CREATE ROLE {RUNNER} NOSUPERUSER NOBYPASSRLS NOLOGIN; END IF;
    END $$;""")
    database = 'rls344_' + uuid4().hex[:12]
    sql('postgres', f'CREATE DATABASE {database}')
    try:
        sql(database, f"""
            GRANT CREATE ON DATABASE {database} TO {RUNNER};
            GRANT USAGE, CREATE ON SCHEMA public TO {RUNNER};
            GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
            CREATE SCHEMA auth;
            CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
              SELECT (NULLIF(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid $$;
            GRANT USAGE ON SCHEMA auth TO {RUNNER}, anon, authenticated, service_role;
        """)
        tables = '\n'.join(f"""
            CREATE TABLE {t} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
                student_id uuid, essay_id uuid, assigned_by uuid, created_by uuid, instructor_id uuid,
                issued_by uuid, source text DEFAULT 'frontend', published boolean DEFAULT true,
                note text DEFAULT 'sentinel');
            ALTER TABLE {t} ENABLE ROW LEVEL SECURITY;
            GRANT SELECT ON {t} TO anon, authenticated;
            GRANT ALL ON {t} TO service_role;
            INSERT INTO {t} (user_id) VALUES ('{LEARNER}'), ('{INSTRUCTOR}');
        """ for t in TABLES)
        functions = []
        for name, path in [('is_current_user_admin','033_writing_coach_tables.sql'),
                           ('is_current_user_instructor','106_instructor_role_foundation.sql')]:
            source = _strip_sql_comments((MIGRATIONS / path).read_text())
            functions.append(re.search(rf'CREATE OR REPLACE FUNCTION public\.{name}\(\).*?\$\$.*?\$\$[^;]*;',
                                       source, re.S)[0])
        policies = '\n'.join(_policies(path)[key] for key, path in {**DROPPED, **KEPT}.items())
        _run(database, f"""
            CREATE TABLE _schema_migrations (filename text PRIMARY KEY);
            INSERT INTO _schema_migrations VALUES ('320_client_write_privilege_lockdown.sql');
            CREATE TABLE users (id uuid PRIMARY KEY, role text);
            INSERT INTO users VALUES ('{LEARNER}','student'), ('{INSTRUCTOR}','instructor');
            {tables}
            REVOKE TRUNCATE ON class_action_log FROM service_role;
            {' '.join(functions)}
            REVOKE ALL ON FUNCTION is_current_user_admin(), is_current_user_instructor()
                FROM PUBLIC, anon, authenticated;
            GRANT EXECUTE ON FUNCTION is_current_user_admin(), is_current_user_instructor() TO service_role;
            {policies}
            -- Sentinels for the explicitly excluded 342 / 332 tables.
            CREATE TABLE regrade_requests (id int);
            CREATE TABLE staff_security_audit (id int);
            CREATE POLICY sentinel ON regrade_requests USING (true);
            CREATE POLICY sentinel ON staff_security_audit USING (true);
        """)
        yield database
    finally:
        sql('postgres', f'DROP DATABASE {database} WITH (FORCE)')


@pytest.mark.parametrize('prior', ['post320', 'old_write_grants', 'after345'])
def test_double_apply_keeps_rows_service_acl_helpers_and_other_policies(db, prior):
    if prior == 'after345':
        _run(db, '''CREATE POLICY "Admin only" ON access_codes FOR ALL USING
                   (EXISTS (SELECT 1 FROM users WHERE id=auth.uid() AND role='admin'));''')
        _run(db, (MIGRATIONS / '345_admin_inline_policies_strict.sql').read_text())
        assert sql(db, "SELECT has_table_privilege('authenticated','access_codes','SELECT')") == 'f'
    elif prior == 'old_write_grants':
        _run(db, '\n'.join(f'GRANT ALL ON {t} TO anon, authenticated;' for t in TABLES))
    before = _snapshot(db)
    expected_policies = [p for p in before['policies'] if (p['tablename'],p['policyname']) not in DROPPED]
    before_rows = {t: sql(db, f'SELECT jsonb_agg(t ORDER BY id) FROM {t} t') for t in TABLES}
    assert len([p for p in before['policies'] if (p['tablename'],p['policyname']) in DROPPED]) == 32
    _run(db, SQL)
    after = _snapshot(db)
    assert after['policies'] == expected_policies
    assert _service(before) == _service(after)
    assert after['helpers'] == before['helpers']
    assert all(rls for table, rls, _ in after['tables'] if table in TABLES)
    _assert_closed(db)
    assert {t: sql(db, f'SELECT jsonb_agg(t ORDER BY id) FROM {t} t') for t in TABLES} == before_rows
    _run(db, SQL)
    assert _snapshot(db) == after
    for t in TABLES:
        assert _run(db, f'SELECT count(*) FROM {t};', role='service_role') == '2'


@pytest.mark.parametrize('identity', [LEARNER, INSTRUCTOR])
def test_authenticated_jwt_reads_and_writes_fail_at_table_acl(db, identity):
    # Reproduce the old policy-internal helper permission error first.
    with pytest.raises(RuntimeError, match='permission denied for function is_current_user_admin'):
        _run(db, f"SET request.jwt.claims='{{\"sub\":\"{identity}\",\"role\":\"authenticated\"}}';"
                 'SELECT * FROM courses;', role='authenticated')
    _run(db, SQL)
    for role in ('authenticated', 'anon'):
        for table in TABLES:
            for statement in (f'SELECT * FROM {table}', f'INSERT INTO {table} DEFAULT VALUES'):
                with pytest.raises(RuntimeError, match=f'permission denied for table {table}') as error:
                    _run(db, f"SET request.jwt.claims='{{\"sub\":\"{identity}\",\"role\":\"{role}\"}}';"
                             + statement + ';', role=role)
                assert 'permission denied for function' not in str(error.value)


@pytest.mark.parametrize(('setup','marker'), [
    ('DELETE FROM _schema_migrations;', 'requires_migration_320'),
    ('DROP TABLE class_lessons;', 'missing_table'),
    ('ALTER TABLE courses DISABLE ROW LEVEL SECURITY;', 'rls_disabled'),
    ('DROP FUNCTION is_current_user_instructor() CASCADE;', 'missing_helper'),
    ('CREATE SCHEMA other; CREATE TABLE other.unexpected (id int); '
     'CREATE POLICY unexpected ON other.unexpected USING (public.is_current_user_admin());',
     'helper_policy_remains'),
    ('GRANT SELECT ON courses TO PUBLIC;', 'client_privilege_remains'),
    ('GRANT SELECT ON courses TO service_role WITH GRANT OPTION; '
     'SET ROLE service_role; GRANT SELECT (note) ON courses TO authenticated;',
     'client_privilege_remains'),
])
def test_preconditions_and_unexpected_privilege_or_policy_abort_atomically(db, setup, marker):
    _run(db, setup)
    before = _snapshot(db)
    with pytest.raises(RuntimeError, match='rls344_' + marker):
        _run(db, SQL)
    assert _snapshot(db) == before


def test_pg17_maintain_is_revoked(db):
    if not _maintain(db):
        # PG16 cannot parse MAINTAIN; the normal double-apply covers that branch.
        assert int(sql(db, 'SHOW server_version_num')) < 170000
        return
    _run(db, 'GRANT MAINTAIN ON courses TO authenticated;')
    _run(db, SQL)
    _assert_closed(db)


def test_guarded_down_restores_exact_policies_without_any_acl_or_helper_change(db):
    original = _snapshot(db)
    _run(db, SQL)
    closed = _snapshot(db)
    with pytest.raises(RuntimeError, match='rollback_requires_explicit_opt_in'):
        _run(db, DOWN)
    assert _snapshot(db) == closed
    _run(db, "SET aver.allow_rls_admin_policy_rollback='on';\n" + DOWN)
    restored = _snapshot(db)
    assert restored['policies'] == original['policies']
    assert restored['tables'] == closed['tables']
    assert restored['helpers'] == closed['helpers']
    _assert_closed(db)
    _run(db, "SET aver.allow_rls_admin_policy_rollback='on';\n" + DOWN)
    assert _snapshot(db) == restored
    _run(db, SQL)
    assert _snapshot(db) == closed


@pytest.mark.parametrize(('setup','marker'), [
    ('GRANT SELECT ON courses TO authenticated;', 'client_privilege_remains'),
    ('GRANT EXECUTE ON FUNCTION is_current_user_admin() TO authenticated;',
     'rollback_helper_executable_by_client'),
])
def test_down_refuses_to_restore_policies_if_access_would_reopen(db, setup, marker):
    _run(db, SQL)
    _run(db, setup)
    before = _snapshot(db)
    with pytest.raises(RuntimeError, match='rls344_' + marker):
        _run(db, "SET aver.allow_rls_admin_policy_rollback='on';\n" + DOWN)
    assert _snapshot(db) == before


@pytest.mark.parametrize(('change','marker'), [
    ('REVOKE SELECT ON courses FROM service_role;', 'service_role_acl_changed'),
    ('REVOKE EXECUTE ON FUNCTION is_current_user_admin() FROM service_role;', 'helper_acl_changed'),
    ('DROP POLICY students_self_read ON students;', 'non_target_policy_changed'),
    ('ALTER TABLE courses DISABLE ROW LEVEL SECURITY;', 'rls_disabled'),
    ('GRANT SELECT ON courses TO authenticated;', 'client_privilege_remains'),
])
def test_postconditions_catch_regression_and_roll_back_every_change(db, change, marker):
    before = _snapshot(db)
    anchor = '    -- All schemas, including unexpected policies outside the reviewed 21.'
    assert SQL.count(anchor) == 1
    mutated = SQL.replace(anchor, change + '\n' + anchor)
    with pytest.raises(RuntimeError, match='rls344_' + marker):
        _run(db, mutated)
    assert _snapshot(db) == before
