"""D1 real 306/311/316/376/377/378 contracts; disposable LOCAL PG only.

Uses real snapshot/admission machinery, permissive Supabase default ACLs, and
synthetic identities. No staging/production credentials or provider calls.
"""
import asyncio
import itertools
import json
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest

from test_mock_paper_policy_postgres import _policy_probe, activate, query, DB
from test_listening_blackeye import paper

M = Path(__file__).resolve().parents[1] / 'migrations'
RPCS = {
 'fn_record_cohort_grant': ('p_actor_id uuid, p_step_up_at timestamp with time zone, p_cohort_id uuid, p_programme_id text, p_grantee_id uuid, p_role text, p_action text, p_reason text, p_request_id uuid', 'TABLE(event_id uuid, seq bigint, occurred_at timestamp with time zone, replayed boolean)'),
 'fn_list_cohort_grants': ('p_actor_id uuid, p_cohort_id uuid, p_programme_id text', 'TABLE(grantee_id uuid, display_name text, role text, state text, last_event_seq bigint, last_event_at timestamp with time zone)'),
 'fn_read_cohort_grant_log': ('p_actor_id uuid, p_cohort_id uuid, p_programme_id text, p_limit integer, p_before_seq bigint', 'TABLE(event_id uuid, seq bigint, actor_id uuid, grantee_id uuid, role text, action text, occurred_at timestamp with time zone, reason text, request_id uuid)'),
 'fn_exercise_book_actor_access': ('p_actor_id uuid, p_cohort_id uuid, p_programme_id text', 'TABLE(is_owner boolean, roles text[])'),
 'fn_create_exercise_book_assignment': ('p_actor_id uuid, p_request_id uuid, p_cohort_id uuid, p_programme_id text, p_activities jsonb, p_recipient_ids uuid[], p_due_at timestamp with time zone, p_deadline_timezone text, p_replay_policy text, p_title text', 'jsonb'),
 'fn_close_exercise_book_assignment': ('p_actor_id uuid, p_cohort_id uuid, p_assignment_id uuid, p_reason text', 'jsonb'),
 'fn_list_exercise_book_assignments': ('p_actor_id uuid, p_cohort_id uuid, p_programme_id text, p_limit integer, p_before_created_at timestamp with time zone, p_before_id uuid', 'TABLE(assignment_id uuid, title text, status text, due_at timestamp with time zone, activity_count integer, recipient_count integer, created_at timestamp with time zone)'),
 'fn_read_exercise_book_progress': ('p_actor_id uuid, p_cohort_id uuid, p_assignment_id uuid', 'jsonb'),
 'fn_list_learner_exercise_book_assignments': ('p_user_id uuid, p_limit integer, p_before_due_at timestamp with time zone, p_before_id uuid', 'jsonb'),
 'fn_acquire_exercise_book_assigned_attempt': ('p_user_id uuid, p_item_id uuid, p_test_id uuid, p_binding jsonb, p_renderer_affinity_protocol text', 'jsonb'),
 'fn_save_exercise_book_answer': ('p_user_id uuid, p_attempt_id uuid, p_q_num integer, p_user_answer text, p_client_seq bigint', 'TABLE(attempt_id uuid, answer_count integer, client_seq bigint, applied boolean)'),
 'fn_submit_exercise_book_assigned_attempt': ('p_user_id uuid, p_attempt_id uuid, p_expected_answers jsonb, p_result_summary jsonb, p_confirm_blank boolean', 'jsonb'),
}
PROGRAMME = 'blackeye-v5-upper-listening'


def migrate(s, name, *, rollback=False):
    sql = (M / ('rollback' if rollback else '') / name).read_text()
    sql = sql.replace('public.', s+'.').replace('auth.role()', "current_setting('request.jwt.claim.role',true)")
    query(sql)


def value(sql, *args):
    row = query(sql, *args)[0]
    v = row[0]
    return json.loads(v) if isinstance(v, str) and v[:1] in '[{' else v


def rpc(s, name, *args):
    # Role is asserted on the same connection as the call. Values stay bound.
    async def call():
        c = await asyncpg.connect(DB)
        try:
            await c.execute("SET ROLE service_role; SET request.jwt.claim.role='service_role'")
            return await c.fetch(f'SELECT * FROM {s}.{name}('+','.join(f'${n+1}' for n in range(len(args)))+')', *args)
        finally:
            await c.close()
    rows = asyncio.run(call())
    if name in RPCS and RPCS[name][1]=='jsonb':
        return json.loads(rows[0][0])
    return [dict(x) for x in rows]


BASE_DEFS = {}

def _book_schema():
    gen = _policy_probe(active=False)
    s = next(gen)
    try:
        query(f'''
          ALTER TABLE {s}.users ADD COLUMN display_name text DEFAULT 'Synthetic staff', ADD COLUMN email text DEFAULT 'synthetic@example.invalid',
            ADD COLUMN role text DEFAULT 'admin', ADD COLUMN is_active boolean DEFAULT true, ADD COLUMN suspended_at timestamptz;
          ALTER TABLE {s}.students ADD COLUMN full_name text DEFAULT 'Synthetic learner', ADD COLUMN is_active boolean DEFAULT true, ADD COLUMN archived_at timestamptz;
          CREATE TABLE {s}.courses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE,is_active boolean DEFAULT true);
          CREATE TABLE {s}.cohorts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),course_id uuid REFERENCES {s}.courses(id),is_active boolean DEFAULT true);
          CREATE TABLE {s}.student_cohort_memberships(student_id uuid REFERENCES {s}.students(id),cohort_id uuid REFERENCES {s}.cohorts(id),is_active boolean DEFAULT true,UNIQUE(student_id,cohort_id));
          ALTER TABLE {s}.listening_tests ADD PRIMARY KEY(id);
          ALTER TABLE {s}.listening_test_attempts ADD PRIMARY KEY(id);
          ALTER TABLE {s}.listening_test_attempts ADD COLUMN submitted_at timestamptz, ADD COLUMN band_estimate numeric, ADD COLUMN result_summary jsonb, ADD COLUMN trap_analytics jsonb;
          ALTER TABLE {s}.class_assignments ADD COLUMN cohort_id uuid REFERENCES {s}.cohorts(id), ADD COLUMN assigned_by uuid REFERENCES {s}.users(id), ADD COLUMN created_at timestamptz DEFAULT now();
          ALTER TABLE {s}.class_assignment_items ADD COLUMN state text DEFAULT 'assigned', ADD COLUMN artifact_id uuid, ADD COLUMN submitted_at timestamptz;
          ALTER TABLE {s}.class_assignment_items ADD UNIQUE(assignment_id,student_id);
          ALTER TABLE {s}.listening_test_attempts ADD CONSTRAINT fixture_item_fk FOREIGN KEY(class_assignment_item_id) REFERENCES {s}.class_assignment_items(id) ON DELETE SET NULL;
          ALTER TABLE {s}.listening_tests ADD COLUMN programme_id text DEFAULT 'ielts', ADD COLUMN content_package_id uuid,
            ADD CONSTRAINT listening_tests_programme_id_check CHECK(programme_id IN ('ielts','general-listening-practice','ielts-listening-practice','ielts-80-days-listening'));
          ALTER TABLE {s}.listening_content ADD COLUMN status text DEFAULT 'published';
          ALTER TABLE {s}.listening_exercises ADD COLUMN status text DEFAULT 'published';
          CREATE TABLE {s}.listening_content_packages(id uuid PRIMARY KEY,programme_id text,status text,
            CONSTRAINT listening_content_packages_programme_id_check CHECK(programme_id IN ('general-listening-practice','ielts-listening-practice','ielts-80-days-listening')));
          CREATE TABLE {s}.listening_lessons(id uuid PRIMARY KEY,programme_id text,status text,
            CONSTRAINT listening_lessons_programme_id_check CHECK(programme_id IN ('general-listening-practice','ielts-listening-practice','ielts-80-days-listening')));
        ''')
        source = (M/'198_class_action_log.sql').read_text()
        query(source[source.index('CREATE TABLE IF NOT EXISTS class_action_log'):source.index('-- Đọc theo LỚP')].replace('class_action_log',s+'.class_action_log'))
        staff = (M/'332_staff_security_audit.sql').read_text()
        tables = staff[staff.index('CREATE TABLE IF NOT EXISTS public.staff_security_audit'):staff.index('-- 3. Server-only MFA') if '-- 3. Server-only MFA' in staff else staff.index('CREATE TABLE IF NOT EXISTS public.staff_mfa_factor_snapshot')]
        query(tables.replace('public.',s+'.').replace('search_path = public,','search_path = '+s+','))
        fn = staff[staff.index('CREATE OR REPLACE FUNCTION public.fn_staff_security_record('):staff.index('-- The definer writes the audit')]
        query(fn.replace('public.',s+'.').replace('search_path = public,','search_path = '+s+','))
        # Exact old resolver body for differential comparisons and rollback.
        source=(M/'316_mock_draft_shared_resume_and_package_guard.sql').read_text()
        resolver=source[source.index('CREATE OR REPLACE FUNCTION public.fn_resolve_mock_paper_access('):source.index('\nREVOKE ALL ON FUNCTION')]
        query(resolver.replace('public.',s+'.').replace('fn_resolve_mock_paper_access','fn_resolve_old').replace('search_path=public,','search_path='+s+','))
        query(f'ALTER DEFAULT PRIVILEGES IN SCHEMA {s} GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA {s} GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role')
        migrate(s,'376_blackeye_admission.sql')
        query(resolver.replace('public.',s+'.'))
        BASE_DEFS[s]={name:value('SELECT pg_get_functiondef($1::regprocedure)',s+'.'+name) for name in (
          'fn_guard_blackeye_admission()','fn_acquire_blackeye_attempt(uuid,uuid,jsonb,text)',
          'fn_resolve_mock_paper_access(text,uuid,uuid,text,uuid,uuid,boolean)')}
        for name in ('377_exercise_book_cohort_grants.sql','378_exercise_book_assignments.sql'):
            migrate(s,name)
        yield s
    finally:
        gen.close()


@pytest.fixture(scope='module')
def book_schema():
    yield from _book_schema()


def _seed(book_schema,activities=('U1-A01','U1-A02')):
    s=book_schema
    owner,teacher,learner,student,cohort,course,pkg=[uuid4() for _ in range(7)]
    # Owner history cannot be cleared: retain all synthetic audit rows and
    # replace only the singleton config row, through its audit trigger.
    query(f'DELETE FROM {s}.exercise_book_grant_owners')
    query(f'INSERT INTO {s}.users(id) VALUES($1),($2),($3)',owner,teacher,learner)
    course=value(f"INSERT INTO {s}.courses(code) VALUES('C2') ON CONFLICT(code) DO UPDATE SET code=excluded.code RETURNING id")
    query(f'INSERT INTO {s}.cohorts(id,course_id) VALUES($1,$2)',cohort,course)
    query(f'INSERT INTO {s}.students(id,user_id) VALUES($1,$2)',student,learner)
    query(f'INSERT INTO {s}.student_cohort_memberships(student_id,cohort_id) VALUES($1,$2)',student,cohort)
    query(f'INSERT INTO {s}.exercise_book_grant_owners(user_id) VALUES($1)',owner)
    query(f"CREATE OR REPLACE FUNCTION {s}.fn_mock_admission_contract_active() RETURNS boolean LANGUAGE sql AS 'SELECT false'")
    query(f'INSERT INTO {s}.listening_content_packages VALUES($1,$2,\'published\')',pkg,PROGRAMME)
    tests=[];bindings=[]
    for activity in activities:
        p=paper(activity=activity); tid=uuid4();content=uuid4()
        metadata=p['metadata']; b=metadata['blackeye']['binding']
        metadata['blackeye_db_revisions']={'paper_revision':0,'policy_revision':0}
        query(f'''INSERT INTO {s}.listening_tests(id,test_id,title,programme_id,metadata,status,is_public,scoring_policy,content_package_id)
          VALUES($1,$2,'Synthetic activity',$3,$4,'published',true,'report_only',$5)''',tid,str(tid),PROGRAMME,json.dumps(metadata),pkg)
        query(f'INSERT INTO {s}.listening_content(id,test_id) VALUES($1,$2)',content,tid)
        review=dict(binding=b,items=[dict(q_num=i['q_num'],source_item_id=i['source_item_id'],scoring_mode='SELF-CHECK') for i in metadata['blackeye']['items']],transcript=[])
        query(f"INSERT INTO {s}.listening_exercises(content_id,payload) VALUES($1,$2)",content,json.dumps({'blackeye_review':review}))
        tests.append(tid);bindings.append(b)
    activate(s)
    return dict(s=s,owner=owner,teacher=teacher,user=learner,student=student,cohort=cohort,tests=tests,bindings=bindings,
                request=uuid4(),due=value("SELECT (now()+interval '2 days')::text"))


@pytest.fixture
def seed(book_schema):
    return _seed(book_schema)

def create(d, **overrides):
    from datetime import datetime
    x=dict(d);x.update(overrides)
    due=x['due'] if not isinstance(x['due'],str) else datetime.fromisoformat(x['due'])
    return rpc(x['s'],'fn_create_exercise_book_assignment',x['owner'],x['request'],x['cohort'],PROGRAMME,
               json.dumps(x['bindings']),[x['student']],due)


def acquire(d):
    item=value(f"SELECT id FROM {d['s']}.class_assignment_items WHERE assignment_id=$1 AND student_id=$2",d['request'],d['student'])
    binding={k:v for k,v in d['bindings'][0].items() if k!='answer_set_revision'}
    return rpc(d['s'],'fn_acquire_exercise_book_assigned_attempt',d['user'],item,d['tests'][0],json.dumps(binding))


def test_catalog_exact_signatures_defaults_acl_rls_publication(book_schema):
    s=book_schema
    rows=query(f"SELECT p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_function_result(p.oid) result,p.pronargdefaults defaults,p.prosecdef,p.proconfig,p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1",s)
    defaults={'fn_read_cohort_grant_log':2,'fn_create_exercise_book_assignment':3,'fn_list_exercise_book_assignments':3,'fn_list_learner_exercise_book_assignments':3,'fn_acquire_exercise_book_assigned_attempt':1,'fn_submit_exercise_book_assigned_attempt':1}
    assert {x['proname'] for x in rows if x['proname'] in RPCS}==RPCS.keys()
    for x in rows:
        name=x['proname']
        if name in RPCS:
            assert (x['args'],x['result'])==RPCS[name]
            assert x['defaults']==defaults.get(name,0)
        if name.startswith('fn_eb_') or name in RPCS:
            assert sum(r['proname']==name for r in rows)==1
            assert x['prosecdef'] and x['proconfig']==['search_path=pg_catalog, pg_temp']
            for role in ('anon','authenticated','service_role'):
                assert value('SELECT has_function_privilege($1,$2::oid,\'EXECUTE\')',role,x['oid']) is (role=='service_role' and name in RPCS)
    tables=('exercise_book_registry','exercise_book_grant_owners','exercise_book_cohort_grants','exercise_book_cohort_grant_log','class_assignment_activities','exercise_book_attempt_links')
    for t in tables:
        assert value('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',s+'.'+t)
        assert value('SELECT count(*) FROM pg_policies WHERE schemaname=$1 AND tablename=$2',s,t)==0
        assert value('SELECT count(*) FROM pg_publication_tables WHERE schemaname=$1 AND tablename=$2',s,t)==0
        for role,priv in itertools.product(('anon','authenticated','service_role'),('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')):
            assert value('SELECT has_table_privilege($1,$2,$3)',role,s+'.'+t,priv) is (role=='service_role' and priv=='SELECT')


def test_owner_fail_closed_suspension_direct_write_and_audit(seed):
    d=seed;s=d['s']
    assert rpc(s,'fn_exercise_book_actor_access',d['teacher'],d['cohort'],PROGRAMME)==[{'is_owner':False,'roles':[]}]
    assert rpc(s,'fn_exercise_book_actor_access',d['owner'],d['cohort'],PROGRAMME)[0]['roles']==['assigner','teacher']
    assert value(f"SELECT count(*) FROM {s}.staff_security_audit WHERE detail->>'scope'='exercise_book_grant_owner'")>0
    assert value(f"SELECT count(*) FROM {s}.owner_alert_outbox WHERE payload->'after' ? 'exercise_book_grant_owner'")>0
    for table,cols,vals in [('exercise_book_grant_owners','user_id',f"'{d['teacher']}'"),('exercise_book_cohort_grants','actor_id',f"'{d['owner']}'")]:
        with pytest.raises(asyncpg.InsufficientPrivilegeError):query(f'SET ROLE service_role; INSERT INTO {s}.{table}({cols}) VALUES({vals})')
    query(f'UPDATE {s}.users SET suspended_at=now() WHERE id=$1',d['owner'])
    assert rpc(s,'fn_exercise_book_actor_access',d['owner'],d['cohort'],PROGRAMME)[0]['roles']==[]
    with pytest.raises(asyncpg.PostgresError,match='not_owner'):rpc(s,'fn_list_cohort_grants',d['owner'],d['cohort'],PROGRAMME)
    query(f'DELETE FROM {s}.exercise_book_grant_owners')
    with pytest.raises(asyncpg.PostgresError,match='not_owner'):rpc(s,'fn_list_cohort_grants',d['owner'],d['cohort'],PROGRAMME)


def test_grant_step_up_replay_sequence_revoke_append_only(seed):
    from datetime import datetime,timezone,timedelta
    d=seed;s=d['s'];request=uuid4();now=datetime.now(timezone.utc)
    args=[d['owner'],now,d['cohort'],PROGRAMME,d['teacher'],'assigner','grant','synthetic purpose',request]
    for step in (None,now-timedelta(seconds=601),now+timedelta(seconds=31)):
        bad=args.copy();bad[1]=step
        with pytest.raises(asyncpg.PostgresError,match='step_up_required'):rpc(s,'fn_record_cohort_grant',*bad)
    first=rpc(s,'fn_record_cohort_grant',*args)[0]
    second=rpc(s,'fn_record_cohort_grant',*args)[0]
    assert first|{'replayed':True}==second
    bad=args.copy();bad[7]='different'
    with pytest.raises(asyncpg.PostgresError,match='idempotency_conflict'):rpc(s,'fn_record_cohort_grant',*bad)
    bad=args.copy();bad[8]=uuid4()
    with pytest.raises(asyncpg.PostgresError,match='grant_state_unchanged'):rpc(s,'fn_record_cohort_grant',*bad)
    assert rpc(s,'fn_exercise_book_actor_access',d['teacher'],d['cohort'],PROGRAMME)[0]['roles']==['assigner']
    bad=args.copy();bad[6]='revoke';bad[8]=uuid4()
    last=rpc(s,'fn_record_cohort_grant',*bad)[0]
    assert last['seq']>first['seq']
    assert rpc(s,'fn_exercise_book_actor_access',d['teacher'],d['cohort'],PROGRAMME)[0]['roles']==[]
    query(f'UPDATE {s}.users SET display_name=NULL WHERE id=$1',d['teacher'])
    grant=rpc(s,'fn_list_cohort_grants',d['owner'],d['cohort'],PROGRAMME)[0]
    assert grant['state']=='revoked' and grant['display_name']=='synthetic@example.invalid'
    logs=rpc(s,'fn_read_cohort_grant_log',d['owner'],d['cohort'],PROGRAMME)
    assert [x['seq'] for x in logs]==[last['seq'],first['seq']]
    for t in ('exercise_book_cohort_grants','exercise_book_cohort_grant_log'):
        for command in (f"UPDATE {s}.{t} SET reason='changed'",f'DELETE FROM {s}.{t}',f'TRUNCATE {s}.{t} CASCADE'):
            with pytest.raises(asyncpg.PostgresError,match='append_only'):query(command)


@pytest.mark.parametrize('state',["is_active=false","suspended_at=now()","role='user'"])
def test_revoke_ineligible_grantee_survives_reactivation(seed,state):
    from datetime import datetime,timezone
    d=seed;s=d['s'];now=datetime.now(timezone.utc)
    args=[d['owner'],now,d['cohort'],PROGRAMME,d['teacher'],'assigner']
    rpc(s,'fn_record_cohort_grant',*args,'grant','synthetic lifecycle',uuid4())
    query(f'UPDATE {s}.users SET {state} WHERE id=$1',d['teacher'])
    with pytest.raises(asyncpg.PostgresError,match='validation'):
        rpc(s,'fn_record_cohort_grant',*args,'grant','synthetic lifecycle',uuid4())
    revoked=rpc(s,'fn_record_cohort_grant',*args,'revoke','synthetic lifecycle',uuid4())[0]
    query(f"UPDATE {s}.users SET is_active=true,suspended_at=NULL,role='admin' WHERE id=$1",d['teacher'])
    assert rpc(s,'fn_exercise_book_actor_access',d['teacher'],d['cohort'],PROGRAMME)[0]['roles']==[]
    latest=rpc(s,'fn_list_cohort_grants',d['owner'],d['cohort'],PROGRAMME)[0]
    assert latest['state']=='revoked' and latest['last_event_seq']==revoked['seq']


def test_create_replay_conflict_atomic_fanout_progress_and_owner_log(seed):
    d=seed;s=d['s'];first=create(d);second=create(d)
    assert first|{'replayed':True}==second
    assert first['completion_denominator']==2
    assert value(f'SELECT count(*) FROM {s}.class_assignment_items WHERE assignment_id=$1',d['request'])==1
    assert value(f'SELECT count(*) FROM {s}.class_assignment_activities WHERE assignment_id=$1',d['request'])==2
    assert value(f"SELECT actor_user_id FROM {s}.class_action_log WHERE assignment_id=$1",d['request'])==d['owner']
    with pytest.raises(asyncpg.PostgresError,match='idempotency_conflict'):create(d,bindings=d['bindings'][:1])
    with pytest.raises(asyncpg.PostgresError,match='validation'):create(d,request=uuid4(),bindings=[d['bindings'][0]]*2)
    stale=json.loads(json.dumps(d['bindings']));stale[1]['content_revision']='stale'
    request=uuid4()
    with pytest.raises(asyncpg.PostgresError,match='stale_revision'):create(d,request=request,bindings=stale)
    assert value(f'SELECT count(*) FROM {s}.class_assignments WHERE id=$1',request)==0
    progress=rpc(s,'fn_read_exercise_book_progress',d['owner'],d['cohort'],d['request'])
    assert len(progress['cells'])==2 and progress['completion']['denominator']==2
    assert 'answer_set_revision' not in json.dumps(progress) and 'score' not in json.dumps(progress)
    own=rpc(s,'fn_list_learner_exercise_book_assignments',d['user'])
    assert len(own['items'])==1 and len(own['items'][0]['activities'])==2
    assert own['items'][0]['activities'][0]['title']=='Synthetic activity'
    assert 'answer_set_revision' not in json.dumps(own)
    assert len(rpc(s,'fn_list_exercise_book_assignments',d['owner'],d['cohort'],PROGRAMME))==1


def test_acquire_save_sequences_submit_computes_summary_retry_immutability(seed):
    d=seed;s=d['s'];create(d);first=acquire(d);again=acquire(d)
    assert first['id']==again['id'] and first['created'] and not again['created']
    aid=first['id']
    save=lambda seq,answer:rpc(s,'fn_save_exercise_book_answer',d['user'],aid,1,answer,seq)[0]
    assert save(2,'AB')['applied']
    assert not save(1,'A')['applied']
    assert save(3,'A')['applied']
    assert not save(2,'AB')['applied']
    answers=value(f'SELECT answers FROM {s}.listening_test_attempts WHERE id=$1',aid)
    assert answers==[{'q_num':1,'user_answer':'A'}]
    with pytest.raises(asyncpg.PostgresError,match='validation'):rpc(s,'fn_submit_exercise_book_assigned_attempt',d['user'],aid,json.dumps(answers),'{}')
    result=rpc(s,'fn_submit_exercise_book_assigned_attempt',d['user'],aid,json.dumps(answers),'{"score":99,"blank_count":0}',True)
    assert result['status']=='submitted' and result['result_summary']['score'] is None and result['result_summary']['blank_count']>0
    assert rpc(s,'fn_submit_exercise_book_assigned_attempt',d['user'],aid,json.dumps(answers),'{}',True)['replayed']
    with pytest.raises(asyncpg.PostgresError,match='attempt_changed'):rpc(s,'fn_submit_exercise_book_assigned_attempt',d['user'],aid,'[]','{}',True)
    retry=acquire(d)
    assert retry['id']!=aid
    listed=rpc(s,'fn_list_learner_exercise_book_assignments',d['user'])['items'][0]['activities'][0]
    assert listed['latest_attempt_id']==retry['id'] and listed['my_status']=='in_progress'
    progress=rpc(s,'fn_read_exercise_book_progress',d['owner'],d['cohort'],d['request'])
    assert progress['completion']['submitted_by_student'][str(d['student'])]==1
    for update in ("class_assignment_item_id=NULL","answers='[]'","user_id=gen_random_uuid()"):
        with pytest.raises(asyncpg.PostgresError,match='attempt_changed|immutable_admission'):query(f'UPDATE {s}.listening_test_attempts SET {update} WHERE id=$1',aid)
    with pytest.raises(asyncpg.PostgresError):query(f'DELETE FROM {s}.class_assignment_items WHERE id=$1',first['class_assignment_item_id'])
    assert value(f"SELECT bool_and(state='assigned' AND artifact_id IS NULL AND submitted_at IS NULL) FROM {s}.class_assignment_items WHERE assignment_id=$1",d['request'])


def test_idor_uniform_missing_wrong_cohort_other_user_and_self_study(seed):
    d=seed;s=d['s'];create(d);a=acquire(d)
    for assignment,cohort in ((uuid4(),d['cohort']),(d['request'],uuid4())):
        for fn,args in [('fn_read_exercise_book_progress',[d['owner'],cohort,assignment]),('fn_close_exercise_book_assignment',[d['owner'],cohort,assignment,'synthetic'])]:
            with pytest.raises(asyncpg.PostgresError,match='not_found') as e:rpc(s,fn,*args)
            assert e.value.sqlstate=='EB404'
    binding={k:v for k,v in d['bindings'][0].items() if k!='answer_set_revision'}
    standalone=rpc(s,'fn_acquire_blackeye_attempt',d['tests'][0],d['user'],json.dumps(binding))[0]
    # Existing self-study RPC returns a single jsonb column.
    standalone=json.loads(next(iter(standalone.values())))
    for owner,attempt in ((uuid4(),a['id']),(d['user'],uuid4()),(d['user'],standalone['id'])):
        for fn,args in [('fn_save_exercise_book_answer',[owner,attempt,1,'synthetic',1]),('fn_submit_exercise_book_assigned_attempt',[owner,attempt,'[]','{}',True])]:
            with pytest.raises(asyncpg.PostgresError,match='not_found') as e:rpc(s,fn,*args)
            assert e.value.sqlstate=='EB404'


@pytest.mark.parametrize('operation',['acquire','save','submit'])
def test_deadline_on_every_write(seed,operation):
    d=seed;s=d['s'];create(d);a=acquire(d)
    query(f'UPDATE {s}.class_assignments SET due_at=now()-interval \'1 second\' WHERE id=$1',d['request'])
    with pytest.raises(asyncpg.PostgresError,match='past_due'):
        if operation=='acquire':acquire(d)
        elif operation=='save':rpc(s,'fn_save_exercise_book_answer',d['user'],a['id'],1,'synthetic',1)
        else:rpc(s,'fn_submit_exercise_book_assigned_attempt',d['user'],a['id'],'[]','{}',True)


def test_resolver_all_courses_differential_and_book_fail_closed(seed):
    d=seed;s=d['s'];create(d,bindings=d['bindings'][:1]);a=acquire(d)
    # Every current course, every registered legacy programme, both skills,
    # purposes/admission flags and parent visibility/deadline states.
    programmes={'reading':['ielts'], 'listening':['ielts','general-listening-practice','ielts-listening-practice','ielts-80-days-listening']}
    cases=[]
    for code,skill in itertools.product(('C1','C2','C3','C4','C5'),('reading','listening')):
        course=value(f'INSERT INTO {s}.courses(code) VALUES($1) ON CONFLICT(code) DO UPDATE SET code=excluded.code RETURNING id',code)
        cohort=value(f'INSERT INTO {s}.cohorts(course_id) VALUES($1) RETURNING id',course)
        for programme,state in itertools.product(programmes[skill],('public','hidden','expired','future','archived','mock')):
            tid,assignment,item=uuid4(),uuid4(),uuid4()
            if skill=='listening':query(f'INSERT INTO {s}.listening_tests(id,programme_id,is_public) VALUES($1,$2,$3)',tid,programme,state=='public')
            else:query(f'INSERT INTO {s}.reading_tests(id,is_public) VALUES($1,$2)',tid,state=='public')
            query(f"INSERT INTO {s}.class_assignments(id,cohort_id,skill,content_id,content_config,status,due_at,publish_at) VALUES($1,$2,$3,$4,'{{\"delivery_mode\":\"assigned_practice\"}}',$5,now()+make_interval(days=>$6),now()+make_interval(days=>$7))",
                  assignment,cohort,skill,tid,'archived' if state=='archived' else 'published',-1 if state=='expired' else 1,1 if state=='future' else -1)
            query(f'INSERT INTO {s}.class_assignment_items(id,assignment_id,student_id) VALUES($1,$2,$3)',item,assignment,d['student'])
            sitting=None
            if state=='mock':
                exam=value(f"INSERT INTO {s}.mock_exams({skill}_test_id,status,active_section,exam_mode,{skill}_started_at) VALUES($1,'published',$2,'sequential',now()) RETURNING id",tid,skill)
                sitting=value(f'INSERT INTO {s}.mock_exam_sittings(mock_exam_id,user_id) VALUES($1,$2) RETURNING id',exam,d['user'])
            cases.append((skill,tid,item,sitting))
    # Run the Cartesian comparison in SQL; no N+1 per matrix member.
    for skill,tid,item,sitting in cases:
        mismatches=value(f'''SELECT count(*) FROM unnest(ARRAY['delivery','practice','assigned_practice','mock_delivery','dictation']) p
          CROSS JOIN unnest(ARRAY[true,false]) admit CROSS JOIN unnest(ARRAY[$4::uuid,NULL::uuid]) ci
          WHERE {s}.fn_resolve_old($1,$2,$3,p,ci,$5,admit) IS DISTINCT FROM
                {s}.fn_resolve_mock_paper_access($1,$2,$3,p,ci,$5,admit)''',skill,tid,d['user'],item,sitting)
        assert mismatches==0,(skill,tid,item)
    item=a['class_assignment_item_id']
    assert value(f"SELECT {s}.fn_resolve_mock_paper_access('listening',$1,$2,'assigned_practice',$3)",d['tests'][0],d['user'],item)['allowed']
    for tid,user,ci in ((d['tests'][1],d['user'],item),(d['tests'][0],uuid4(),item),(d['tests'][0],d['user'],uuid4())):
        assert not value(f"SELECT {s}.fn_resolve_mock_paper_access('listening',$1,$2,'assigned_practice',$3)",tid,user,ci)['allowed']
    for setting in ("status='archived'","status='published',due_at=now()-interval '1 second'","due_at=now()+interval '1 day',publish_at=now()+interval '1 hour'"):
        query(f'UPDATE {s}.class_assignments SET {setting} WHERE id=$1',d['request'])
        assert not value(f"SELECT {s}.fn_resolve_mock_paper_access('listening',$1,$2,'delivery',$3)",d['tests'][0],d['user'],item)['allowed']
    query(f"UPDATE {s}.class_assignments SET status='published',due_at=now()+interval '1 day',publish_at=NULL WHERE id=$1",d['request'])
    query(f"UPDATE {s}.listening_tests SET programme_id='ielts' WHERE id=$1",d['tests'][0])
    assert not value(f"SELECT {s}.fn_resolve_mock_paper_access('listening',$1,$2,'assigned_practice',$3)",d['tests'][0],d['user'],item)['allowed']


def test_full_private_binding_freeze_and_close(seed):
    d=seed;s=d['s'];create(d);a=acquire(d)
    # Edit the published paper in this disposable fixture to model key-only
    # publication; admission must compare the FULL binding, not just public 7.
    changed=json.loads(json.dumps(d['bindings'][0]));changed['answer_set_revision']=str(uuid4())
    query(f"UPDATE {s}.listening_tests SET metadata=jsonb_set(metadata,'{{blackeye,binding}}',$2) WHERE id=$1",d['tests'][0],json.dumps(changed))
    with pytest.raises(asyncpg.PostgresError,match='stale_revision'):acquire(d)
    closed=rpc(s,'fn_close_exercise_book_assignment',d['owner'],d['cohort'],d['request'],'Synthetic non-PII purpose')
    assert closed['status']=='archived' and 'replayed' not in closed
    with pytest.raises(asyncpg.PostgresError,match='activity_locked'):acquire(d)
    with pytest.raises(asyncpg.PostgresError,match='activity_locked'):rpc(s,'fn_save_exercise_book_answer',d['user'],a['id'],1,'synthetic',1)
    with pytest.raises(asyncpg.PostgresError,match='already_archived'):rpc(s,'fn_close_exercise_book_assignment',d['owner'],d['cohort'],d['request'],'Synthetic')


async def race(s,sql1,args1,sql2,args2):
    first,second=await asyncpg.connect(DB),await asyncpg.connect(DB)
    observer=await asyncpg.connect(DB)
    pending=None;tx=first.transaction()
    try:
        for c in (first,second):await c.execute("SET ROLE service_role; SET request.jwt.claim.role='service_role'; SET statement_timeout='5s'")
        await tx.start()
        result=await first.fetchval(sql1,*args1)
        pending=asyncio.create_task(second.fetchval(sql2,*args2))
        for _ in range(100):
            await observer.execute('SELECT pg_stat_clear_snapshot()')
            if await observer.fetchval("SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE pid=$1",second.get_server_pid()):break
            await asyncio.sleep(.01)
        else:pytest.fail('second transaction must overlap the first lock')
        await tx.commit()
        try:other=await pending
        except asyncpg.PostgresError as e:other=e
        return json.loads(result) if isinstance(result,str) and result.startswith('{') else result, json.loads(other) if isinstance(other,str) and other.startswith('{') else other
    finally:
        if pending is not None and not pending.done():pending.cancel();await asyncio.gather(pending,return_exceptions=True)
        await first.close();await second.close();await observer.close()


def test_two_create_and_two_acquire_races(seed):
    from datetime import datetime
    d=seed;s=d['s']
    sql=f'SELECT {s}.fn_create_exercise_book_assignment($1,$2,$3,$4,$5,$6,$7)'
    args=[d['owner'],d['request'],d['cohort'],PROGRAMME,json.dumps(d['bindings']),[d['student']],datetime.fromisoformat(d['due'])]
    first,second=asyncio.run(race(s,sql,args,sql,args))
    assert first|{'replayed':True}==second
    item=value(f'SELECT id FROM {s}.class_assignment_items WHERE assignment_id=$1',d['request'])
    sql=f'SELECT {s}.fn_acquire_exercise_book_assigned_attempt($1,$2,$3,$4)'
    args=[d['user'],item,d['tests'][0],json.dumps({k:v for k,v in d['bindings'][0].items() if k!='answer_set_revision'})]
    first,second=asyncio.run(race(s,sql,args,sql,args))
    assert first['id']==second['id'] and first['created'] and not second['created']


@pytest.mark.parametrize('revoke_first',[True,False])
def test_create_revoke_race(seed,revoke_first):
    from datetime import datetime,timezone
    d=seed;s=d['s'];now=datetime.now(timezone.utc)
    rpc(s,'fn_record_cohort_grant',d['owner'],now,d['cohort'],PROGRAMME,d['teacher'],'assigner','grant','synthetic',uuid4())
    create_sql=f'SELECT {s}.fn_create_exercise_book_assignment($1,$2,$3,$4,$5,$6,$7)'
    create_args=[d['teacher'],d['request'],d['cohort'],PROGRAMME,json.dumps(d['bindings']),[d['student']],datetime.fromisoformat(d['due'])]
    revoke_sql=f'SELECT to_jsonb(g) FROM {s}.fn_record_cohort_grant($1,$2,$3,$4,$5,$6,$7,$8,$9) g'
    revoke_args=[d['owner'],now,d['cohort'],PROGRAMME,d['teacher'],'assigner','revoke','synthetic',uuid4()]
    first,second=asyncio.run(race(s,*( (revoke_sql,revoke_args,create_sql,create_args) if revoke_first else (create_sql,create_args,revoke_sql,revoke_args))))
    if revoke_first:assert isinstance(second,asyncpg.PostgresError) and second.sqlstate=='EB403'
    else:assert first['assignment_id']==str(d['request']) and not isinstance(second,Exception)
    assert value(f'SELECT count(*) FROM {s}.class_assignments WHERE id=$1',d['request'])==(0 if revoke_first else 1)


@pytest.mark.parametrize('close_first',[True,False])
def test_acquire_close_race(seed,close_first):
    d=seed;s=d['s'];create(d)
    item=value(f'SELECT id FROM {s}.class_assignment_items WHERE assignment_id=$1',d['request'])
    start=f'SELECT {s}.fn_acquire_exercise_book_assigned_attempt($1,$2,$3,$4)'
    args=[d['user'],item,d['tests'][0],json.dumps({k:v for k,v in d['bindings'][0].items() if k!='answer_set_revision'})]
    close=f'SELECT {s}.fn_close_exercise_book_assignment($1,$2,$3,$4)';close_args=[d['owner'],d['cohort'],d['request'],'synthetic']
    first,second=asyncio.run(race(s,*( (close,close_args,start,args) if close_first else (start,args,close,close_args))))
    if close_first:assert isinstance(second,asyncpg.PostgresError) and second.sqlstate=='EB422'
    else:assert first['class_assignment_item_id']==str(item) and second['status']=='archived'
    assert value(f'SELECT count(*) FROM {s}.listening_test_attempts WHERE class_assignment_item_id=$1',item)==(0 if close_first else 1)


def test_rollback_refuses_history_and_restores_exact_bodies_retains_grant_audit(seed):
    d=seed;create(d)
    with pytest.raises(asyncpg.PostgresError,match='exercise_book_history_exists'):
        migrate(d['s'],'378_exercise_book_assignments.sql',rollback=True)
    gen=_book_schema();s=next(gen)
    try:
        from datetime import datetime,timezone
        clean=globals()['seed'].__wrapped__(s)  # isolated DB schema, synthetic data, no assignment
        rpc(s,'fn_record_cohort_grant',clean['owner'],datetime.now(timezone.utc),clean['cohort'],PROGRAMME,clean['teacher'],'assigner','grant','synthetic',uuid4())
        before=value(f'SELECT count(*) FROM {s}.staff_security_audit')
        migrate(s,'378_exercise_book_assignments.sql',rollback=True)
        for name,definition in BASE_DEFS[s].items():
            assert value('SELECT pg_get_functiondef($1::regprocedure)',s+'.'+name)==definition
        migrate(s,'377_exercise_book_cohort_grants.sql',rollback=True)
        assert value(f'SELECT count(*) FROM {s}.exercise_book_cohort_grants')==1
        assert value(f'SELECT count(*) FROM {s}.exercise_book_cohort_grant_log')==1
        assert value(f'SELECT count(*) FROM {s}.staff_security_audit')==before
        assert value(f'SELECT count(*) FROM {s}.owner_alert_outbox')>0
    finally:gen.close()


def test_role_assertion_precedes_all_twelve_rpc_bodies(book_schema):
    from datetime import datetime, timezone
    for name,(signature,_) in RPCS.items():
        args=[]
        for arg in signature.split(', '):
            kind=arg.split(' ',1)[1]
            args.append({'uuid':uuid4(),'timestamp with time zone':datetime.now(timezone.utc),'text':'synthetic',
                         'jsonb':'{}','uuid[]':[],'boolean':False,'integer':1,'bigint':1}[kind])
        with pytest.raises(asyncpg.InsufficientPrivilegeError) as e:
            query(f'SELECT * FROM {book_schema}.{name}('+','.join(f'${n+1}' for n in range(len(args)))+')',*args)
        assert e.value.sqlstate=='42501'


def test_assignment_cross_actor_generic_collision_and_invalid_recipient(seed):
    from datetime import datetime,timezone
    d=seed;s=d['s'];create(d)
    rpc(s,'fn_record_cohort_grant',d['owner'],datetime.now(timezone.utc),d['cohort'],PROGRAMME,d['teacher'],'assigner','grant','synthetic',uuid4())
    with pytest.raises(asyncpg.PostgresError,match='idempotency_conflict'):create(d,owner=d['teacher'])
    generic=uuid4()
    query(f"INSERT INTO {s}.class_assignments(id,cohort_id,skill,title) VALUES($1,$2,'writing','Synthetic unrelated')",generic,d['cohort'])
    with pytest.raises(asyncpg.PostgresError,match='idempotency_conflict'):create(d,request=generic)
    with pytest.raises(asyncpg.PostgresError,match='validation'):create(d,request=uuid4(),student=uuid4())
    query(f'UPDATE {s}.students SET archived_at=now() WHERE id=$1',d['student'])
    with pytest.raises(asyncpg.PostgresError,match='validation'):create(d,request=uuid4())


def test_singleton_and_trigger_owner_recheck_even_for_db_owner(seed):
    d=seed;s=d['s']
    with pytest.raises(asyncpg.UniqueViolationError):query(f'INSERT INTO {s}.exercise_book_grant_owners(user_id) VALUES($1)',d['teacher'])
    # DB owner can write a table, but the grant INSERT trigger still refuses
    # a non-owner actor. No service-role direct write path exists at all.
    with pytest.raises(asyncpg.PostgresError,match='not_owner'):
        query(f"SET request.jwt.claim.role='service_role'; INSERT INTO {s}.exercise_book_cohort_grants(cohort_id,programme_id,actor_id,grantee_id,role,action,reason,request_id,step_up_at) VALUES('{d['cohort']}','{PROGRAMME}','{d['teacher']}','{d['user']}','teacher','grant','synthetic',gen_random_uuid(),now())")
    assert value(f'SELECT count(*) FROM {s}.exercise_book_cohort_grants WHERE cohort_id=$1',d['cohort'])==0


def test_keep_change_validation_and_summary_matches_backend(book_schema):
    d=_seed(book_schema,('U1-A03',));s=d['s'];create(d);a=acquire(d)
    for seq,text in enumerate(('not JSON','[]','{"version":"blackeye_keep_change_v1","action":"KEEP","action":"CHANGE","correction_text":"x"}'),1):
        with pytest.raises(asyncpg.PostgresError,match='validation'):
            rpc(s,'fn_save_exercise_book_answer',d['user'],a['id'],1,text,seq)
    assert value(f'SELECT answers FROM {s}.listening_test_attempts WHERE id=$1',a['id'])==[]
    text=json.dumps(dict(version='blackeye_keep_change_v1',action='CHANGE',correction_text='\t\n \u00a0\u2007'))
    rpc(s,'fn_save_exercise_book_answer',d['user'],a['id'],1,text,4)
    answers=value(f'SELECT answers FROM {s}.listening_test_attempts WHERE id=$1',a['id'])
    with pytest.raises(asyncpg.PostgresError,match='validation'):
        rpc(s,'fn_submit_exercise_book_assigned_attempt',d['user'],a['id'],json.dumps(answers),'{}',False)
    result=rpc(s,'fn_submit_exercise_book_assigned_attempt',d['user'],a['id'],json.dumps(answers),'{}',True)
    from services.listening_blackeye import decode_answer
    items=paper(activity='U1-A03')['metadata']['blackeye']['items']
    # Match the actual Python decoder used by PR1/D2's response mapper.
    from types import SimpleNamespace
    expected=sum(decode_answer(SimpleNamespace(interaction=i['interaction']),text if i['q_num']==1 else '') for i in items)
    assert result['result_summary']['blank_count']==expected==2
