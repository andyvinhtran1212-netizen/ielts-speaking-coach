"""Real PostgreSQL full original-bank and diagnostic exposure boundaries."""
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

import asyncpg
import pytest

DB = os.environ.get("TEST_PG_URL", "")
ROOT = Path(__file__).resolve().parents[1]

async def run(sql, *args):
    conn = await asyncpg.connect(DB)
    try:
        if not args and ";" in sql:
            await conn.execute(sql)
            return []
        return await conn.fetch(sql, *args)
    finally:
        await conn.close()

def query(sql, *args):
    return asyncio.run(run(sql, *args))

@pytest.fixture(scope="module")
def probe():
    parsed=urlparse(DB)
    if parsed.scheme not in {'postgres','postgresql'} or parsed.query or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        if os.environ.get("REQUIRE_PG") == "1": pytest.fail("Local disposable PG required")
        pytest.skip("Local PostgreSQL unavailable")
    s = "master30_full_" + uuid4().hex
    query("""DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
      END $$;""")
    try:
        query(f"""CREATE SCHEMA {s};
          SET search_path={s},public;
          GRANT USAGE ON SCHEMA {s} TO anon, authenticated, service_role;
          CREATE TABLE {s}.users(id uuid PRIMARY KEY);
          CREATE TABLE {s}.students(id uuid PRIMARY KEY, user_id uuid);
          CREATE TABLE {s}.student_cohort_memberships(student_id uuid, cohort_id uuid, is_active boolean);
          CREATE TABLE {s}.class_assignments(id uuid PRIMARY KEY, cohort_id uuid, skill text,
            status text, publish_at timestamptz, due_at timestamptz, content_config jsonb);
          CREATE TABLE {s}.class_assignment_items(id uuid PRIMARY KEY, assignment_id uuid,
            student_id uuid, state text, opened_at timestamptz, submitted_at timestamptz,
            updated_at timestamptz, score numeric, artifact_kind text, artifact_id uuid, mastery jsonb);
          CREATE TABLE {s}.runtime_flags(key text PRIMARY KEY, enabled boolean, note text);
        """)
        for name in ("283_master30_grammar_diagnostic.sql", "312_assigned_master30_grammar_lessons.sql", "313_master30_original_full_banks.sql"):
            sql = (ROOT / "migrations" / name).read_text()
            sql = sql.replace("public.", s + ".").replace("auth.users", s + ".users").replace("search_path = public,", "search_path = " + s + ",").replace("search_path=public,", "search_path=" + s + ",")
            query(f"SET search_path={s},public;" + sql)
        # Historical trigger functions use unqualified tables in public. Pin
        # their lookup to this disposable schema without changing production SQL.
        query(f"""DO $$ DECLARE f record; BEGIN
          FOR f IN SELECT p.oid::regprocedure AS identity FROM pg_proc p
            JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='{s}' AND p.proconfig IS NULL
          LOOP EXECUTE format('ALTER FUNCTION %s SET search_path={s},pg_temp',f.identity);
          END LOOP;
        END $$;""")
        yield s
    finally:
        query(f"DROP SCHEMA IF EXISTS {s} CASCADE;")


def assigned(s, extras=0, version="v3"):
    user, student, cohort, assignment, item, release = [uuid4() for _ in range(6)]
    n = 100 + extras if version == "v3" else 12
    questions = [dict(id=f"B01-A1-{q:02d}",type="mcq",options=["correct","wrong"],correct_index=0) for q in range(90 if version=="v3" else 12)]
    if version == "v3": questions += [dict(id=f"B01-E1-{q:02d}",type="writing",options=[],supplementary=q>=10) for q in range(10+extras)]
    snapshot = dict(lesson_id="M30-B01",version=version,questions=questions,
       practice_exposure=dict(item_ids=[q["id"] for q in questions],stimulus_families=["source-family"],parallel_set_ids=["source-parallel"],mapping_sha256="f"*64))
    config = dict(assignment_type="grammar_lesson",release_id=str(release),lesson_id="M30-B01",content_version=version,content_sha256="a"*64,question_count=n)
    query(f"INSERT INTO {s}.users VALUES($1)",user)
    query(f"INSERT INTO {s}.students VALUES($1,$2)",student,user)
    query(f"INSERT INTO {s}.student_cohort_memberships VALUES($1,$2,true)",student,cohort)
    query(f"INSERT INTO {s}.grammar_content_releases(id,release_key,manifest_sha256,manifest) VALUES($1,$2,$3,'{{}}')",release,str(release),uuid4().hex+uuid4().hex)
    query(f"INSERT INTO {s}.class_assignments VALUES($1,$2,'grammar','published',NULL,NULL,$3::jsonb)",assignment,cohort,json.dumps(config))
    query(f"INSERT INTO {s}.class_assignment_items(id,assignment_id,student_id,state) VALUES($1,$2,$3,'assigned')",item,assignment,student)
    query(f"UPDATE {s}.runtime_flags SET enabled=true WHERE key='master30_original_full_banks'")
    return dict(user=user,student=student,cohort=cohort,assignment=assignment,item=item,release=release,snapshot=snapshot,version=version)


def start(s,a):
    return query(f"SELECT * FROM {s}.create_assigned_grammar_lesson_attempt($1,$2,$3,'M30-B01',$4,$5,$6::jsonb)",a['user'],a['item'],a['release'],a['version'],'a'*64,json.dumps(a['snapshot']))[0]


def answer(s,a,q,choice=0):
    return query(f"SELECT * FROM {s}.record_assigned_grammar_lesson_answer($1,$2,$3,$4)",a['user'],a['item'],q,choice)[0]


def write(s,a,q,text):
    return query(f"SELECT * FROM {s}.record_assigned_grammar_lesson_writing_answer($1,$2,$3,$4)",a['user'],a['item'],q,text)[0]


@pytest.mark.parametrize('extras',[0,20])
def test_complete_full_bank_uses_objective_denominator_and_retains_raw_E(probe,extras):
    s=probe; a=assigned(s,extras); first=start(s,a)
    for q in a['snapshot']['questions'][:90]: result=answer(s,a,q['id'],1 if q['id'].endswith('00') else 0)
    assert result['status']=='in_progress' and result['correct_count']==89
    raw='  A clean sentence that omits task meaning.\nLý do bị thiếu.  '
    for q in a['snapshot']['questions'][90:]: result=write(s,a,q['id'],raw)
    assert result['status']=='completed' and result['question_count']==100+extras
    saved=json.loads(result['answers']); assert saved['B01-E1-00']=={'answer_text':raw}
    ledger=query(f"SELECT * FROM {s}.class_assignment_items WHERE id=$1",a['item'])[0]
    mastery=json.loads(ledger['mastery']); assert mastery['percent']==98.9 and mastery['objective_count']==90
    assert mastery['writing_answered_count']==10+extras and mastery['writing_status']=='ungraded'
    assert ledger['state']=='submitted' and ledger['artifact_id']==first['id'] and ledger['score'] is None
    assert write(s,a,'B01-E1-00',saved['B01-E1-00']['answer_text'])['completed_at']==result['completed_at']
    with pytest.raises(asyncpg.UniqueViolationError,match='answer_conflict'): write(s,a,'B01-E1-00','Different answer')


def test_legacy_twelve_still_completes_without_recomputation(probe):
    a=assigned(probe,version='v2'); start(probe,a)
    for q in a['snapshot']['questions']: result=answer(probe,a,q['id'])
    assert result['question_count']==12 and result['correct_count']==12 and result['status']=='completed'


def test_wrong_type_blank_deadline_owner_and_snapshot_guards(probe):
    s=probe; a=assigned(s); first=start(s,a)
    for fn in (lambda: write(s,a,'B01-A1-00','text'),lambda: answer(s,a,'B01-E1-00'),lambda: write(s,a,'B01-E1-00',' \n\t')):
        with pytest.raises(asyncpg.InvalidParameterValueError,match='invalid_answer'): fn()
    with pytest.raises(asyncpg.InsufficientPrivilegeError): write(s,dict(a,user=uuid4()),'B01-E1-00','text')
    query(f"UPDATE {s}.class_assignments SET due_at=now()-interval '1 minute' WHERE id=$1",a['assignment'])
    with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError,match='not_accepting'): write(s,a,'B01-E1-00','text')
    with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError,match='history_immutable'):
        query(f"UPDATE {s}.grammar_lesson_attempts SET content_snapshot='{{}}' WHERE id=$1",first['id'])


def test_concurrent_MCQs_and_E_never_lose_answers(probe):
    s=probe; a=assigned(s); start(s,a)
    async def concurrent():
        return await asyncio.gather(run(f"SELECT * FROM {s}.record_assigned_grammar_lesson_answer($1,$2,'B01-A1-00',0)",a['user'],a['item']),run(f"SELECT * FROM {s}.record_assigned_grammar_lesson_writing_answer($1,$2,'B01-E1-00','Saved text')",a['user'],a['item']))
    asyncio.run(concurrent())
    row=query(f"SELECT answers FROM {s}.grammar_lesson_attempts WHERE class_assignment_item_id=$1",a['item'])[0]
    assert len(json.loads(row['answers']))==2


@pytest.mark.parametrize('bad',[None,{'item_ids':[],'stimulus_families':[], 'parallel_set_ids':[], 'mapping_sha256':'a'*64},
                                {'item_ids':[], 'stimulus_families':[None], 'parallel_set_ids':[], 'mapping_sha256':'a'*64}])
def test_missing_or_malformed_closure_rolls_back_start_instead_of_erasing_history(probe,bad):
    s=probe; a=assigned(s); a['snapshot']['practice_exposure']=bad
    with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError,match='history_invalid'): start(s,a)
    assert query(f"SELECT id FROM {s}.grammar_lesson_attempts WHERE class_assignment_item_id=$1",a['item'])==[]


def test_new_privileged_routines_are_not_callable_by_browser_roles(probe):
    signatures=('master30_full_practice_exposure(uuid)',
                'record_assigned_grammar_lesson_writing_answer(uuid,uuid,text,text)',
                'record_assigned_grammar_lesson_response(uuid,uuid,text,integer,text)')
    for signature in signatures:
        for role in ('anon','authenticated'):
            assert not query('SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed',role,f'{probe}.{signature}')[0]['allowed']
        assert query('SELECT has_function_privilege(\'service_role\',$1,\'EXECUTE\') allowed',f'{probe}.{signature}')[0]['allowed']


def test_flag_pause_preserves_saved_answers_and_prevents_new_writes(probe):
    s=probe;a=assigned(s);start(s,a);saved=write(s,a,'B01-E1-00','Original text.')
    query(f"UPDATE {s}.runtime_flags SET enabled=false WHERE key='master30_original_full_banks'")
    with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError,match='not_accepting'):answer(s,a,'B01-A1-00')
    assert write(s,a,'B01-E1-00','Original text.')['answers']==saved['answers']
    history=query(f"SELECT {s}.master30_full_practice_exposure($1) exposure",a['user'])[0]
    assert len(json.loads(history['exposure'])['item_ids'])==100
    query(f"UPDATE {s}.runtime_flags SET enabled=true WHERE key='master30_original_full_banks'")
    assert answer(s,a,'B01-A1-00')['correct_count']==1


def test_migration_replay_retains_history_and_failure_rolls_back_atomically(probe):
    s=probe;a=assigned(s);start(s,a);write(s,a,'B01-E1-00','Frozen text.')
    before=query(f"SELECT * FROM {s}.grammar_lesson_attempts WHERE class_assignment_item_id=$1",a['item'])[0]
    sql=(ROOT/'migrations/313_master30_original_full_banks.sql').read_text()
    sql=sql.replace('public.',s+'.').replace('auth.users',s+'.users').replace('search_path = public,','search_path = '+s+',')
    query(f'SET search_path={s},public;'+sql)
    assert query(f"SELECT * FROM {s}.grammar_lesson_attempts WHERE id=$1",before['id'])[0]==before
    assert query(f"SELECT enabled FROM {s}.runtime_flags WHERE key='master30_original_full_banks'")[0]['enabled']
    failing=sql.replace('COMMIT;',f"UPDATE {s}.runtime_flags SET enabled=false WHERE key='master30_original_full_banks';SELECT 1/0;COMMIT;")
    with pytest.raises(asyncpg.DivisionByZeroError):query(f'SET search_path={s},public;'+failing)
    assert query(f"SELECT enabled FROM {s}.runtime_flags WHERE key='master30_original_full_banks'")[0]['enabled']
    assert query(f"SELECT * FROM {s}.grammar_lesson_attempts WHERE id=$1",before['id'])[0]==before


def diagnostic(s,a,qid='new-item',family='source-family',parallel=None):
    query(f"INSERT INTO {s}.grammar_lessons(release_id,lesson_id,lesson_no,title) VALUES($1,'M30-B01',1,'Lesson') ON CONFLICT DO NOTHING",a['release'])
    query(f"INSERT INTO {s}.grammar_items(release_id,item_id,lesson_id,prompt,options,correct_index,attribute_id,process_facet,subdomain,module,diagnostic_status,stimulus_family,parallel_set_id) VALUES($1,$2,'M30-B01','Prompt','[\"A\",\"B\"]',0,'M01','P1','roles','ALL','DIAGNOSTIC_APPROVED',$3,$4) ON CONFLICT DO NOTHING",a['release'],qid,family,parallel)
    session=uuid4()
    query(f"INSERT INTO {s}.grammar_diagnostic_sessions(id,user_id,release_id,mode,module,test_length,objective_limit) VALUES($1,$2,$3,'REVIEW','GENERAL','QUICK',28)",session,a['user'],a['release'])
    return dict(session=session,item=qid,family=family,parallel=parallel)


def exposure_sql(s):
    return f"INSERT INTO {s}.grammar_exposure_events(user_id,session_id,release_id,item_id,stimulus_family,parallel_set_id,phase) VALUES($1,$2,$3,$4,$5,$6,'BASELINE') RETURNING id"


def expose(s,a,d):
    return query(exposure_sql(s),a['user'],d['session'],a['release'],d['item'],d['family'],d['parallel'])


@pytest.mark.parametrize('mechanism',['id','family','parallel'])
def test_started_practice_blocks_all_exposure_links_even_after_flag_off_archive(probe,mechanism):
    s=probe; a=assigned(s)
    d=diagnostic(s,a,qid='B01-A1-00' if mechanism=='id' else 'new-item',
                 family='source-family' if mechanism=='family' else 'unrelated-family',
                 parallel='source-parallel' if mechanism=='parallel' else None)
    start(s,a)
    query(f"UPDATE {s}.runtime_flags SET enabled=false WHERE key='master30_original_full_banks'")
    query(f"UPDATE {s}.class_assignments SET status='archived' WHERE id=$1",a['assignment'])
    with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError,match='practice_exposed'): expose(s,a,d)
    assert query(f"SELECT * FROM {s}.grammar_exposure_events WHERE session_id=$1",d['session'])==[]
    history=query(f"SELECT {s}.master30_full_practice_exposure($1) AS exposure",a['user'])[0]
    assert 'B01-A1-00' in json.loads(history['exposure'])['item_ids']


def test_practice_invalidates_pending_and_prevents_response_or_report(probe):
    s=probe; a=assigned(s); d=diagnostic(s,a); expose(s,a,d); start(s,a)
    assert query(f"SELECT status FROM {s}.grammar_diagnostic_sessions WHERE id=$1",d['session'])[0]['status']=='exhausted'
    with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError,match='practice_exposed'):
        query(f"INSERT INTO {s}.grammar_diagnostic_responses(session_id,user_id,release_id,item_id,attribute_id,process_facet,subdomain,phase,selected_option,is_correct) VALUES($1,$2,$3,$4,'M01','P1','roles','BASELINE',0,true)",d['session'],a['user'],a['release'],d['item'])
    with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError,match='practice_exposed'):
        query(f"INSERT INTO {s}.grammar_diagnostic_reports(session_id,user_id,release_id,evidence_sha256,learner_report,educator_report) VALUES($1,$2,$3,$4,'{{}}','{{}}')",d['session'],a['user'],a['release'],'e'*64)


def test_invalidation_and_report_guard_use_canonical_item_links(probe):
    s=probe;a=assigned(s);d=diagnostic(s,a)
    # A historical denormalized event may contain stale links. The immutable
    # grammar item remains canonical for exclusion and report certification.
    expose(s,a,dict(d,family='stale-family',parallel='stale-parallel'))
    start(s,a)
    assert query(f"SELECT status FROM {s}.grammar_diagnostic_sessions WHERE id=$1",d['session'])[0]['status']=='exhausted'
    with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError,match='practice_exposed'):
        query(f"INSERT INTO {s}.grammar_diagnostic_reports(session_id,user_id,release_id,evidence_sha256,learner_report,educator_report) VALUES($1,$2,$3,$4,'{{}}','{{}}')",d['session'],a['user'],a['release'],'e'*64)


def test_practice_history_cannot_be_erased_by_assignment_delete(probe):
    s=probe; a=assigned(s); first=start(s,a)
    with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError,match='history_immutable'):
        query(f"DELETE FROM {s}.grammar_lesson_attempts WHERE id=$1",first['id'])
    # Owner erasure remains supported; this learner has no diagnostic evidence.
    query(f"DELETE FROM {s}.users WHERE id=$1",a['user'])
    assert query(f"SELECT id FROM {s}.grammar_lesson_attempts WHERE id=$1",first['id'])==[]


@pytest.mark.parametrize('first',['practice','diagnostic'])
def test_both_race_orders_share_user_lock_and_refresh_snapshot(probe,first):
    s=probe; a=assigned(s); d=diagnostic(s,a)
    async def race():
        winner=await asyncpg.connect(DB); transaction=winner.transaction(); await transaction.start()
        start_sql=f"SELECT * FROM {s}.create_assigned_grammar_lesson_attempt($1,$2,$3,'M30-B01','v3',$4,$5::jsonb)"
        start_args=(a['user'],a['item'],a['release'],'a'*64,json.dumps(a['snapshot']))
        exposure_args=(a['user'],d['session'],a['release'],d['item'],d['family'],d['parallel'])
        try:
            if first=='practice':
                await winner.fetch(start_sql,*start_args)
                waiter=asyncio.create_task(run(exposure_sql(s),*exposure_args))
            else:
                await winner.fetch(exposure_sql(s),*exposure_args)
                waiter=asyncio.create_task(run(start_sql,*start_args))
            # Wait for the actual lock wait, not a guessed scheduling interval.
            for _ in range(100):
                blocked=await winner.fetchval("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted")
                if blocked: break
                await asyncio.sleep(.01)
            assert blocked and not waiter.done()
            await transaction.commit()
            if first=='practice':
                with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError,match='practice_exposed'):
                    await asyncio.wait_for(waiter,3)
            else:
                await asyncio.wait_for(waiter,3)
        finally:
            if winner.is_in_transaction(): await transaction.rollback()
            await winner.close()
    asyncio.run(race())
    assert query(f"SELECT status FROM {s}.grammar_diagnostic_sessions WHERE id=$1",d['session'])[0]['status']==('in_progress' if first=='practice' else 'exhausted')
    assert len(query(f"SELECT id FROM {s}.grammar_lesson_attempts WHERE class_assignment_item_id=$1",a['item']))==1


def final_diagnostic(s, a):
    d=diagnostic(s,a,qid='last-item')
    expose(s,a,d)
    for index in range(27):
        qid=f'previous-{index}'
        query(f"INSERT INTO {s}.grammar_items(release_id,item_id,lesson_id,prompt,options,correct_index,attribute_id,process_facet,subdomain,module,diagnostic_status,stimulus_family) VALUES($1,$2,'M30-B01','Prompt','[\"A\",\"B\"]',0,'M01','P1','roles','ALL','DIAGNOSTIC_APPROVED',$2)",a['release'],qid)
        expose(s,a,dict(d,item=qid,family=qid,parallel=None))
        query(f"INSERT INTO {s}.grammar_diagnostic_responses(session_id,user_id,release_id,item_id,attribute_id,process_facet,subdomain,phase,selected_option,is_correct) VALUES($1,$2,$3,$4,'M01','P1','roles','BASELINE',0,true)",d['session'],a['user'],a['release'],qid)
    return d


@pytest.mark.parametrize('first',['practice','finalize'])
def test_last_answer_and_report_race_is_atomic_and_preserves_prior_completed_history(probe,first):
    s=probe; a=assigned(s); d=final_diagnostic(s,a)
    async def race():
        winner=await asyncpg.connect(DB); transaction=winner.transaction(); await transaction.start()
        start_sql=f"SELECT * FROM {s}.create_assigned_grammar_lesson_attempt($1,$2,$3,'M30-B01','v3',$4,$5::jsonb)"
        start_args=(a['user'],a['item'],a['release'],'a'*64,json.dumps(a['snapshot']))
        final_sql=f"SELECT * FROM {s}.record_and_finalize_grammar_diagnostic_session($1,$2,$3,0,false,1000,$4,'{{}}','{{}}')"
        final_args=(d['session'],a['user'],d['item'],'e'*64)
        try:
            if first=='practice':
                await winner.fetch(start_sql,*start_args)
                waiter=asyncio.create_task(run(final_sql,*final_args))
            else:
                await winner.fetch(final_sql,*final_args)
                waiter=asyncio.create_task(run(start_sql,*start_args))
            for _ in range(100):
                blocked=await winner.fetchval("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted")
                if blocked: break
                await asyncio.sleep(.01)
            assert blocked and not waiter.done()
            await transaction.commit()
            if first=='practice':
                with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError,match='not_accepting'):
                    await asyncio.wait_for(waiter,3)
            else: await asyncio.wait_for(waiter,3)
        finally:
            if winner.is_in_transaction(): await transaction.rollback()
            await winner.close()
    asyncio.run(race())
    reports=query(f"SELECT * FROM {s}.grammar_diagnostic_reports WHERE session_id=$1",d['session'])
    count=query(f"SELECT count(*) AS n FROM {s}.grammar_diagnostic_responses WHERE session_id=$1",d['session'])[0]['n']
    assert count==(27 if first=='practice' else 28)
    assert len(reports)==(0 if first=='practice' else 1)
    assert query(f"SELECT status FROM {s}.grammar_diagnostic_sessions WHERE id=$1",d['session'])[0]['status']==('exhausted' if first=='practice' else 'completed')
    if first=='finalize':
        replay=query(f"SELECT * FROM {s}.finalize_grammar_diagnostic_session($1,$2,$3,'{{}}','{{}}')",d['session'],a['user'],'e'*64)[0]
        assert replay['status']=='completed'
        assert query(f"SELECT * FROM {s}.grammar_diagnostic_reports WHERE session_id=$1",d['session'])==reports
