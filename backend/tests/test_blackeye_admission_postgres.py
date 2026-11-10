"""Migration 376 catalog and trigger contracts on an explicitly local test DB.

Not run by the rebuild job (no SQL is authorized). CI/local database owners may
run with TEST_PG_URL using the existing disposable PostgreSQL harness.
"""
import json
from pathlib import Path
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import psql, probe

MIGRATION = Path(__file__).resolve().parents[1] / "migrations/376_blackeye_admission.sql"


@pytest.fixture(scope="module")
def blackeye_schema(probe):
    schema = "blackeye_376_" + uuid4().hex
    try:
        psql(f"""
        DO $$ BEGIN
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
          IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
        END $$;
        CREATE SCHEMA {schema};
        CREATE TABLE {schema}.listening_content_packages(id uuid PRIMARY KEY, programme_id text,
          CONSTRAINT listening_content_packages_programme_id_check CHECK(programme_id IN ('general-listening-practice','ielts-listening-practice','ielts-80-days-listening')));
        CREATE TABLE {schema}.listening_lessons(id uuid PRIMARY KEY, programme_id text,
          CONSTRAINT listening_lessons_programme_id_check CHECK(programme_id IN ('general-listening-practice','ielts-listening-practice','ielts-80-days-listening')));
        CREATE TABLE {schema}.listening_tests(id uuid PRIMARY KEY,programme_id text,metadata jsonb DEFAULT '{{}}',
          CONSTRAINT listening_tests_programme_id_check CHECK(programme_id IN ('ielts','general-listening-practice','ielts-listening-practice','ielts-80-days-listening')));
        CREATE TABLE {schema}.listening_test_attempts(id uuid PRIMARY KEY,test_id uuid,user_id uuid,
          paper_revision bigint,policy_revision bigint,class_assignment_item_id uuid,sitting_id uuid,
          attempt_purpose text,scoring_policy text);
        CREATE FUNCTION {schema}.fn_lock_mock_paper(text,uuid) RETURNS void LANGUAGE plpgsql AS 'BEGIN RETURN; END;';
        CREATE FUNCTION {schema}.fn_mock_paper_row(text,uuid) RETURNS jsonb LANGUAGE sql
          AS 'SELECT to_jsonb(t) FROM {schema}.listening_tests t WHERE id=$2';
        CREATE FUNCTION {schema}.fn_mock_admission_contract_active() RETURNS boolean LANGUAGE sql AS 'SELECT false';
        """)
        source = MIGRATION.read_text().replace("public.", f"{schema}.")
        # Auth API is supplied by Supabase; the disposable schema uses a role
        # claim expression without installing/changing a shared auth schema.
        source = source.replace("auth.role()", "current_setting('request.jwt.claim.role',true)")
        psql(source)
        yield schema
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def test_376_definers_catalog_search_path_and_client_acl(blackeye_schema):
    schema = blackeye_schema
    rows = json.loads(psql(f"""SELECT json_agg(json_build_object('name',p.proname,'definer',p.prosecdef,
      'config',p.proconfig,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
      'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service',has_function_privilege('service_role',p.oid,'EXECUTE')))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='{schema}' AND p.proname IN ('fn_guard_blackeye_admission','fn_acquire_blackeye_attempt')"""))
    assert len(rows) == 2
    for row in rows:
        assert row['definer'] is True
        assert row['config'] == ['search_path=pg_catalog, pg_temp']
        assert row['anon'] is False and row['authenticated'] is False
        if row['name'] == 'fn_acquire_blackeye_attempt':
            assert row['service'] is True


def test_376_trigger_refuses_inactive_blackeye_but_preserves_generic(blackeye_schema):
    schema = blackeye_schema
    private, ordinary, user = uuid4(), uuid4(), uuid4()
    psql(f"INSERT INTO {schema}.listening_tests(id,programme_id) VALUES ('{private}','blackeye-v5-upper-listening'),('{ordinary}','ielts')")
    psql(f"INSERT INTO {schema}.listening_test_attempts(id,test_id,user_id) VALUES ('{uuid4()}','{ordinary}','{user}')")
    with pytest.raises(RuntimeError, match='blackeye_unavailable'):
        psql(f"INSERT INTO {schema}.listening_test_attempts(id,test_id,user_id) VALUES ('{uuid4()}','{private}','{user}')")
    assert psql(f"SELECT count(*) FROM {schema}.listening_test_attempts WHERE test_id='{private}'") == '0'
    assert psql(f"SELECT count(*) FROM {schema}.listening_test_attempts WHERE test_id='{ordinary}'") == '1'
    assert psql(f"SELECT count(*) FROM pg_trigger WHERE tgname='trg_zz_blackeye_admission' AND tgrelid='{schema}.listening_test_attempts'::regclass AND tgenabled='O'") == '1'
