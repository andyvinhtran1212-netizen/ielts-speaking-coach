"""Migration 376 catalog and trigger contracts on an explicitly local test DB.

Runs only with TEST_PG_URL pointing to disposable local PostgreSQL. It is not
authorization or evidence for a staging/production migration run.
"""
import json
from pathlib import Path
from uuid import uuid4

import pytest

from test_migration_240_core_attempt_evidence import psql, probe

MIGRATION = Path(__file__).resolve().parents[1] / "migrations/376_blackeye_admission.sql"
ROLLBACK = MIGRATION.parent / "rollback/376_blackeye_admission.sql"


def migration_source(schema):
    return MIGRATION.read_text().replace("public.", f"{schema}.").replace(
        "auth.role()", "current_setting('request.jwt.claim.role',true)")


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
        GRANT USAGE ON SCHEMA {schema} TO anon,authenticated,service_role;
        CREATE TABLE {schema}.listening_content_packages(id uuid PRIMARY KEY, programme_id text,status text DEFAULT 'draft',
          CONSTRAINT listening_content_packages_programme_id_check CHECK(programme_id IN ('general-listening-practice','ielts-listening-practice','ielts-80-days-listening')));
        CREATE TABLE {schema}.listening_lessons(id uuid PRIMARY KEY, programme_id text,status text DEFAULT 'draft',
          CONSTRAINT listening_lessons_programme_id_check CHECK(programme_id IN ('general-listening-practice','ielts-listening-practice','ielts-80-days-listening')));
        CREATE TABLE {schema}.listening_tests(id uuid PRIMARY KEY,programme_id text,metadata jsonb DEFAULT '{{}}',status text DEFAULT 'draft',is_public boolean DEFAULT false,
          CONSTRAINT listening_tests_programme_id_check CHECK(programme_id IN ('ielts','general-listening-practice','ielts-listening-practice','ielts-80-days-listening')));
        CREATE TABLE {schema}.listening_test_attempts(id uuid PRIMARY KEY,test_id uuid,user_id uuid,
          paper_revision bigint,policy_revision bigint,class_assignment_item_id uuid,sitting_id uuid,
          attempt_purpose text,scoring_policy text,status text,answers jsonb DEFAULT '[]',
          resume_expires_at timestamptz,submitted_at timestamptz,result_summary jsonb,
          score integer,band_estimate numeric,grading_details jsonb,trap_analytics jsonb);
        CREATE TABLE {schema}.mock_paper_attempt_snapshots(skill text,attempt_id uuid,paper_id uuid,
          paper_revision bigint,policy_revision bigint,paper_row jsonb);
        CREATE FUNCTION {schema}.fn_lock_mock_paper(text,uuid) RETURNS void LANGUAGE plpgsql AS 'BEGIN RETURN; END;';
        CREATE FUNCTION {schema}.fn_mock_paper_row(text,uuid) RETURNS jsonb LANGUAGE sql
          AS 'SELECT to_jsonb(t) FROM {schema}.listening_tests t WHERE id=$2';
        CREATE FUNCTION {schema}.fn_mock_admission_contract_active() RETURNS boolean LANGUAGE sql AS 'SELECT false';
        """)
        # Auth API is supplied by Supabase; the disposable schema uses a role
        # claim expression without installing/changing a shared auth schema.
        psql(migration_source(schema))
        yield schema
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def test_376_definers_catalog_search_path_and_client_acl(blackeye_schema):
    schema = blackeye_schema
    rows = json.loads(psql(f"""SELECT json_agg(json_build_object('name',p.proname,'definer',p.prosecdef,
      'config',p.proconfig,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
      'public',EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE'),
      'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service',has_function_privilege('service_role',p.oid,'EXECUTE')))
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='{schema}' AND p.proname IN ('fn_guard_blackeye_admission','fn_acquire_blackeye_attempt','fn_submit_blackeye_attempt')"""))
    assert len(rows) == 3
    for row in rows:
        assert row['definer'] is True
        assert row['config'] == ['search_path=pg_catalog, pg_temp']
        assert row['anon'] is False and row['authenticated'] is False and row['public'] is False
        if row['name'] in {'fn_acquire_blackeye_attempt', 'fn_submit_blackeye_attempt'}:
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


def seed_submit(schema):
    attempt, paper, user = uuid4(), uuid4(), uuid4()
    # Generic insert passes the admission trigger; the synthetic frozen identity
    # then exercises submit independently of the pre-existing 306 capture chain.
    psql(f"INSERT INTO {schema}.listening_tests(id,programme_id) VALUES ('{paper}','ielts')")
    psql(f"""INSERT INTO {schema}.listening_test_attempts
      (id,test_id,user_id,paper_revision,policy_revision,attempt_purpose,scoring_policy,status,resume_expires_at)
      VALUES ('{attempt}','{paper}','{user}',1,1,'practice','report_only','in_progress',now()+interval '1 hour');
      INSERT INTO {schema}.mock_paper_attempt_snapshots VALUES
      ('listening','{attempt}','{paper}',1,1,'{{"programme_id":"blackeye-v5-upper-listening"}}');""")
    return attempt, user


def submit_sql(schema, attempt, user, answers='[]'):
    report = json.dumps(dict(submitted=True, item_count=2, blank_count=2, unscored_count=2,
                             objective_denominator=0, score=None, band_estimate=None))
    return f"SELECT {schema}.fn_submit_blackeye_attempt('{attempt}','{user}','{answers}','{report}')"


def install_current_save(schema):
    # 224 replaced 161 with the active-player TTL guard. Load that exact
    # function, without applying unrelated 224 tables/triggers to this fixture.
    source = (MIGRATION.parent / '224_active_player_resume_ttl.sql').read_text()
    source = source[source.index('CREATE OR REPLACE FUNCTION public.fn_upsert_listening_answer('):]
    source = source[:source.index('$$;') + 3]
    source = source.replace('public.', schema + '.').replace('search_path = public,', 'search_path = ' + schema + ',')
    psql(source)


def test_submit_owner_role_expiry_answers_and_idempotency(blackeye_schema):
    schema = blackeye_schema
    attempt, user = seed_submit(schema)
    query = submit_sql(schema, attempt, user)
    for role in ('anon', 'authenticated'):
        with pytest.raises(RuntimeError, match='permission denied'):
            psql(f'SET ROLE {role}; {query}')
    with pytest.raises(RuntimeError, match='blackeye_forbidden'):
        psql(query)
    prefix = "SET ROLE service_role; SET request.jwt.claim.role='service_role'; "
    with pytest.raises(RuntimeError, match='blackeye_forbidden'):
        psql(prefix + submit_sql(schema, attempt, uuid4()))
    psql(f"UPDATE {schema}.listening_test_attempts SET resume_expires_at=now()-interval '1 second' WHERE id='{attempt}'")
    with pytest.raises(RuntimeError, match='blackeye_changed'):
        psql(prefix + query)
    psql(f"UPDATE {schema}.listening_test_attempts SET resume_expires_at=now()+interval '1 hour' WHERE id='{attempt}'")
    with pytest.raises(RuntimeError, match='blackeye_changed'):
        psql(prefix + submit_sql(schema, attempt, user, '[{"q_num":1,"user_answer":"new"}]'))
    first = json.loads(psql(prefix + query))
    assert first['status'] == 'submitted' and first['result_summary']['score'] is None
    assert json.loads(psql(prefix + query)) == first


@pytest.mark.parametrize('save_first', [True, False])
def test_submit_save_race_serializes_on_attempt_row(blackeye_schema, save_first):
    import asyncio
    import asyncpg
    from test_migration_240_core_attempt_evidence import DB
    schema = blackeye_schema
    # Real existing save RPC, scoped to this disposable schema only.
    install_current_save(schema)
    attempt, user = seed_submit(schema)
    async def overlap():
        first, second = await asyncpg.connect(DB), await asyncpg.connect(DB)
        pending = None
        try:
            for conn in (first, second):
                await conn.execute("SET request.jwt.claim.role='service_role'")
            txn = first.transaction()
            await txn.start()
            save = f"SELECT {schema}.fn_upsert_listening_answer('{attempt}',1,'synthetic')"
            submit = submit_sql(schema, attempt, user)
            await first.fetchval(save if save_first else submit)
            pending = asyncio.create_task(second.fetchval(submit if save_first else save))
            blocked = False
            for _ in range(100):
                await first.execute('SELECT pg_stat_clear_snapshot()')
                blocked = await first.fetchval("SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE pid=$1", second.get_server_pid())
                if blocked:
                    break
                await asyncio.sleep(0.01)
            assert blocked, 'competing save/submit must overlap the held attempt lock'
            await txn.commit()
            if save_first:
                with pytest.raises(asyncpg.PostgresError, match='blackeye_changed'):
                    await pending
            else:
                assert await pending is None  # existing save rejects submitted work
        finally:
            if pending is not None and not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
            await first.close()
            await second.close()
    asyncio.run(overlap())
    row = json.loads(psql(f"SELECT to_jsonb(a) FROM {schema}.listening_test_attempts a WHERE id='{attempt}'"))
    assert row['status'] == ('in_progress' if save_first else 'submitted')
    assert len(row['answers']) == (1 if save_first else 0)
    assert (row['result_summary'] is None) is save_first


def test_current_save_and_submit_refuse_expired_resume(blackeye_schema):
    schema = blackeye_schema
    install_current_save(schema)
    attempt, user = seed_submit(schema)
    psql(f"UPDATE {schema}.listening_test_attempts SET resume_expires_at=now()-interval '1 second' WHERE id='{attempt}'")
    assert psql(f"SELECT {schema}.fn_upsert_listening_answer('{attempt}',1,'synthetic') IS NULL") == 't'
    with pytest.raises(RuntimeError, match='blackeye_changed'):
        psql("SET ROLE service_role; SET request.jwt.claim.role='service_role'; " + submit_sql(schema, attempt, user))
    assert psql(f"SELECT answers='[]'::jsonb AND status='in_progress' FROM {schema}.listening_test_attempts WHERE id='{attempt}'") == 't'


@pytest.mark.parametrize('table,visibility,retire', [
    ('listening_content_packages', "status='published'", 'archive'),
    ('listening_lessons', "status='published'", 'remove'),
    ('listening_tests', "status='published'", 'archive'),
    ('listening_tests', "is_public=true", 'remove'),
])
def test_rollback_refuses_published_content_then_succeeds(blackeye_schema, table, visibility, retire):
    schema, row_id = blackeye_schema, uuid4()
    psql(f"INSERT INTO {schema}.{table}(id,programme_id) VALUES ('{row_id}','blackeye-v5-upper-listening'); UPDATE {schema}.{table} SET {visibility} WHERE id='{row_id}'")
    rollback = ROLLBACK.read_text().replace('public.', schema + '.')
    trigger = f"SELECT count(*) FROM pg_trigger WHERE tgname='trg_zz_blackeye_admission' AND tgrelid='{schema}.listening_test_attempts'::regclass AND tgenabled='O'"
    with pytest.raises(RuntimeError, match='blackeye_rollback_published_content'):
        psql(rollback)
    assert psql(trigger) == '1'
    assert psql(f"SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='{schema}' AND p.proname IN ('fn_submit_blackeye_attempt','fn_acquire_blackeye_attempt','fn_guard_blackeye_admission')") == '3'
    if retire == 'archive':
        psql(f"UPDATE {schema}.{table} SET status='archived' WHERE id='{row_id}'")
    else:
        psql(f"DELETE FROM {schema}.{table} WHERE id='{row_id}'")
    try:
        psql(rollback)
        assert psql(trigger) == '1'
        assert psql(f"SELECT to_regprocedure('{schema}.fn_acquire_blackeye_attempt(uuid,uuid,jsonb,text)') IS NULL AND to_regprocedure('{schema}.fn_submit_blackeye_attempt(uuid,uuid,jsonb,jsonb)') IS NULL") == 't'
    finally:
        # Restore only this disposable schema for other module tests.
        psql(migration_source(schema))


def admission_catalog(schema):
    return json.loads(psql(f"""SELECT json_build_object(
      'functions',(SELECT json_agg(json_build_object('name',p.proname,'definer',p.prosecdef,
        'config',p.proconfig,'acl',p.proacl::text) ORDER BY p.proname)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='{schema}' AND p.proname IN
          ('fn_guard_blackeye_admission','fn_acquire_blackeye_attempt','fn_submit_blackeye_attempt')),
      'trigger',(SELECT json_build_object('enabled',t.tgenabled,'function',t.tgfoid::regprocedure::text,
        'type',t.tgtype) FROM pg_trigger t WHERE t.tgrelid='{schema}.listening_test_attempts'::regclass
        AND t.tgname='trg_zz_blackeye_admission'))"""))


def test_apply_rollback_deny_all_then_reapply_preserves_catalog(blackeye_schema):
    schema = blackeye_schema
    before = admission_catalog(schema)
    psql(migration_source(schema))  # Re-apply even without rollback.
    assert admission_catalog(schema) == before
    rollback = ROLLBACK.read_text().replace('public.', schema + '.')
    try:
        psql(rollback)
        psql(rollback)  # The deny-all rollback is also repeatable.
        remaining = admission_catalog(schema)
        assert [row['name'] for row in remaining['functions']] == ['fn_guard_blackeye_admission']
        assert remaining['functions'][0] == next(row for row in before['functions'] if row['name'] == 'fn_guard_blackeye_admission')
        assert remaining['trigger'] == before['trigger']
        # The guard must deny both recognition paths even after later publication,
        # regardless of the original admission machinery being active.
        psql(f"CREATE OR REPLACE FUNCTION {schema}.fn_mock_admission_contract_active() RETURNS boolean LANGUAGE sql AS 'SELECT true'")
        for programme, metadata in [('blackeye-v5-upper-listening', '{}'), ('ielts', '{"blackeye":{}}')]:
            paper = uuid4()
            psql(f"INSERT INTO {schema}.listening_tests(id,programme_id,metadata,status,is_public) VALUES ('{paper}','{programme}','{metadata}','published',true)")
            with pytest.raises(RuntimeError, match='blackeye_unavailable'):
                psql(f"INSERT INTO {schema}.listening_test_attempts(id,test_id) VALUES ('{uuid4()}','{paper}')")
            assert psql(f"SELECT count(*) FROM {schema}.listening_test_attempts WHERE test_id='{paper}'") == '0'
            psql(f"DELETE FROM {schema}.listening_tests WHERE id='{paper}'")
        ordinary = uuid4()
        psql(f"INSERT INTO {schema}.listening_tests(id,programme_id) VALUES ('{ordinary}','ielts')")
        psql(f"INSERT INTO {schema}.listening_test_attempts(id,test_id) VALUES ('{uuid4()}','{ordinary}')")
        assert psql(f"SELECT count(*) FROM {schema}.listening_test_attempts WHERE test_id='{ordinary}'") == '1'
    finally:
        psql(f"CREATE OR REPLACE FUNCTION {schema}.fn_mock_admission_contract_active() RETURNS boolean LANGUAGE sql AS 'SELECT false'")
        # No migration-ledger writes: this test exercises the SQL body only.
        psql(migration_source(schema))
    assert admission_catalog(schema) == before
    test_376_definers_catalog_search_path_and_client_acl(schema)


@pytest.mark.parametrize('mutation', [
    'DROP TRIGGER trg_zz_blackeye_admission ON {schema}.listening_test_attempts',
    'ALTER TABLE {schema}.listening_test_attempts DISABLE TRIGGER trg_zz_blackeye_admission',
    """CREATE FUNCTION {schema}.wrong_guard() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END;';
       DROP TRIGGER trg_zz_blackeye_admission ON {schema}.listening_test_attempts;
       CREATE TRIGGER trg_zz_blackeye_admission BEFORE INSERT ON {schema}.listening_test_attempts
       FOR EACH ROW EXECUTE FUNCTION {schema}.wrong_guard()""",
])
def test_trigger_postcondition_rejects_missing_disabled_or_wrong_function(blackeye_schema, mutation):
    postcondition = migration_source(blackeye_schema).rsplit('DO $$', 1)[1].split('COMMIT;', 1)[0]
    with pytest.raises(RuntimeError, match='blackeye_admission_trigger_postcondition_failed'):
        psql('BEGIN; ' + mutation.format(schema=blackeye_schema) + '; DO $$' + postcondition + 'COMMIT;')


@pytest.mark.parametrize('signature', [
    'fn_guard_blackeye_admission()',
    'fn_acquire_blackeye_attempt(uuid,uuid,jsonb,text)',
    'fn_submit_blackeye_attempt(uuid,uuid,jsonb,jsonb)',
])
@pytest.mark.parametrize('mutation', [
    'ALTER FUNCTION {function} SECURITY INVOKER',
    'ALTER FUNCTION {function} SET search_path=public',
    'GRANT EXECUTE ON FUNCTION {function} TO PUBLIC',
    'GRANT EXECUTE ON FUNCTION {function} TO anon',
    'GRANT EXECUTE ON FUNCTION {function} TO authenticated',
])
def test_function_postcondition_rejects_unsafe_definer_path_or_acl(blackeye_schema, signature, mutation):
    postcondition = migration_source(blackeye_schema).rsplit('DO $$', 1)[1].split('COMMIT;', 1)[0]
    with pytest.raises(RuntimeError, match='blackeye_admission_function_postcondition_failed'):
        psql('BEGIN; ' + mutation.format(function=blackeye_schema + '.' + signature) + '; DO $$' + postcondition + 'COMMIT;')


def test_function_postcondition_rejects_missing_rpc(blackeye_schema):
    postcondition = migration_source(blackeye_schema).rsplit('DO $$', 1)[1].split('COMMIT;', 1)[0]
    with pytest.raises(RuntimeError, match='blackeye_admission_function_postcondition_failed'):
        psql(f'BEGIN; DROP FUNCTION {blackeye_schema}.fn_submit_blackeye_attempt(uuid,uuid,jsonb,jsonb); DO $$' + postcondition + 'COMMIT;')
