"""Explicitly gated actual PostgreSQL checks; every schema/role is task-owned.

Canonical quiz columns, immediate FKs, indexes, and update triggers come from
the existing migrations. Auth/courses/assignment dependencies are synthetic;
these tests establish write boundaries, not Supabase Auth/RLS policy parity.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio
from sqlalchemy.engine import make_url

MIGRATIONS = Path(__file__).resolve().parents[1] / 'migrations'
CODE = 'G-tenses-present-simple'
OLD_REVISION, NEW_REVISION, SOURCE = 'a' * 64, 'b' * 64, 'c' * 64
_ABSENT_POLICY = object()


def encoded(value):
    return json.dumps(value, ensure_ascii=False)


class GrammarPg:
    def __init__(self, connection, dsn, schema, roles):
        self.c, self.dsn, self.schema, self.roles = connection, dsn, schema, roles
        self.user, self.other, self.actor, self.topic, self.old, self.new, self.predecessor = [uuid4() for _ in range(7)]

    async def connection(self):
        return await asyncpg.connect(self.dsn, server_settings={'search_path': self.schema + ',public',
            'application_name': self.schema, 'statement_timeout': '5000'})

    def adapted(self, source):
        source = source.replace('public.', self.schema + '.')
        source = source.replace('auth.users', self.schema + '.users')
        source = re.sub(r"\bpublic\b(?=\s*,\s*pg_temp)", self.schema, source)
        source = source.replace("'public', 'pg_temp'", "'" + self.schema + "', 'pg_temp'")
        source = source.replace("n.nspname='public'", "n.nspname='" + self.schema + "'")
        for original, replacement in self.roles.items():
            source = re.sub(r'\b' + original + r'\b', replacement, source)
        return source

    async def foundation(self):
        for dependency in ('users', 'courses', 'class_assignment_items'):
            await self.c.execute(f'CREATE TABLE {dependency}(id UUID PRIMARY KEY)')
        # The existing 294 importer plans its advanced-course branch even in
        # a Grammar import. This synthetic unrelated dependency stays empty.
        await self.c.execute('CREATE TABLE class_assignments(id UUID PRIMARY KEY,content_id UUID)')
        for table, filename in [('content_topics', '117_content_topics.sql'),
                ('quiz_banks', '118_quiz_banks.sql'), ('quiz_questions', '118_quiz_banks.sql'),
                ('quiz_sessions', '119_quiz_progress.sql'), ('quiz_attempts', '119_quiz_progress.sql'),
                ('quiz_word_stats', '119_quiz_progress.sql'), ('governance_audit', '107_governance_audit.sql')]:
            sql = (MIGRATIONS / filename).read_text()
            found = re.search(r'CREATE TABLE IF NOT EXISTS ' + table + r' \([\s\S]*?\n\);', sql)
            assert found, table
            await self.c.execute(found.group().replace('auth.users', 'users'))
        for filename, table in [('159_quiz_questions_hint.sql', 'quiz_questions'),
                ('186_quiz_why_wrong_and_lesson.sql', 'quiz_questions'),
                ('186_quiz_why_wrong_and_lesson.sql', 'quiz_banks'),
                ('188_quiz_session_class_link.sql', 'quiz_sessions'),
                ('189_course_mastery_gate.sql', 'quiz_sessions')]:
            for statement in re.findall(r'^ALTER TABLE ' + table + r'\b[\s\S]*?;', (MIGRATIONS / filename).read_text(), re.M):
                await self.c.execute(statement)
        await self.c.execute('''CREATE FUNCTION update_updated_at_column() RETURNS trigger
          LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=now(); RETURN NEW; END $$''')
        for filename in ('117_content_topics.sql', '118_quiz_banks.sql', '119_quiz_progress.sql'):
            sql = (MIGRATIONS / filename).read_text()
            for statement in re.findall(r'^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS[\s\S]*?;', sql, re.M):
                if re.search(r'\bON\s+(content_topics|quiz_banks|quiz_questions|quiz_sessions|quiz_attempts|quiz_word_stats)\s*\(', statement):
                    await self.c.execute(statement)
            for statement in re.findall(r'^CREATE TRIGGER [\s\S]*?;', sql, re.M):
                if 'update_updated_at_column()' in statement and 'vocab_cards' not in statement:
                    await self.c.execute(statement)
        sql = (MIGRATIONS / '186_quiz_why_wrong_and_lesson.sql').read_text()
        function = re.search(r'CREATE OR REPLACE FUNCTION public.quiz_replace_questions[\s\S]*?END; \$function\$;', sql).group()
        await self.c.execute(self.adapted(function))
        await self.c.execute(self.adapted((MIGRATIONS / '294_atomic_quiz_import_publish_state.sql').read_text()))
        await self.c.execute(self.adapted((MIGRATIONS / '309_grammar_quiz_revision_cutover.sql').read_text()))
        await self.c.execute(self.adapted((MIGRATIONS / '314_grammar_audit_reviewed_publication.sql').read_text()))
        for role in self.roles.values():
            await self.c.execute(f'GRANT USAGE ON SCHEMA {self.schema} TO {role}')
            await self.c.execute(f'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA {self.schema} TO {role}')

    async def seed(self):
        await self.c.executemany('INSERT INTO users(id) VALUES($1)', [(self.user,), (self.other,), (self.actor,)])
        await self.c.execute("INSERT INTO content_topics(id,slug,title,skill_area) VALUES($1,'synthetic','Synthetic','grammar')", self.topic)
        meta = {'correct_to_master': 2, 'require_distinct_skill': True, 'require_production_to_master': True}
        await self.c.execute("INSERT INTO quiz_banks(id,topic_id,code,skill_area,meta) VALUES($1,$2,$3,'grammar',$4::jsonb)", self.old, self.topic, CODE, encoded(meta))
        for qid, skill, inp in [('recognition', 'recognition', 'choice'), ('production', 'production', 'text')]:
            await self.c.execute('''INSERT INTO quiz_questions(bank_id,qid,item_key,type,input,skill,prompt,options,answer,accept)
              VALUES($1,$2,'item',$5,$3,$4,'Synthetic', '["Yes","No"]',0,'["synthetic"]')''',
                self.old, qid, inp, skill, 'gap_text' if inp=='text' else 'mcq')
        await self.c.execute('INSERT INTO quiz_sessions(id,user_id,bank_id,code) VALUES($1,$2,$3,$4)', self.predecessor, self.user, self.old, CODE)

    async def enroll(self, *, receipt=True, policy=_ABSENT_POLICY, code=CODE):
        """Actual complete receipt producer; no minimal-envelope exception.

        Runtime fixtures use the reviewed source and real commit owner. Explicit
        policy corruption is injected AFTER publication only in this random test
        schema, to exercise private validator versus full receipt refusal.
        """
        from services.grammar_quiz_revision_source import parse_reviewed_source
        from services import grammar_quiz_revisions as owner
        from models.grammar_quiz_revisions import GrammarRevisionPreviewRequest, GrammarRevisionCommitRequest
        from test_grammar_quiz_revisions import canonical_engine
        raw=(MIGRATIONS.parents[1]/'docs/grammar-quiz-banks'/(code+'.md')).read_text()
        source=parse_reviewed_source(code,raw)
        await self.c.execute('SELECT quiz_replace_questions($1,$2::jsonb)',self.old,encoded(source.questions))
        original_meta={k:v for k,v in source.metadata['meta'].items() if k!='text_match_by_qid'}
        original_empty=policy=={} and not source.metadata['meta'].get('text_match_by_qid')
        if original_empty: original_meta['text_match_by_qid']={}
        await self.c.execute('UPDATE quiz_banks SET code=$2,title=$3,source=$4,words_count=$5,meta=$6::jsonb WHERE id=$1',
            self.old,code,source.metadata['title'],source.metadata['source'],source.metadata['words_count'],encoded(original_meta))
        await self.c.execute('UPDATE quiz_sessions SET code=$2 WHERE id=$1',self.predecessor,code)
        self.code,self.questions=code,source.questions
        engine=canonical_engine(self)
        try:
            read=await owner.read_revision(engine,code)
            preview=await owner.preview_revision(engine,code,GrammarRevisionPreviewRequest(source_markdown=raw,expected_revision=read.revision))
            result=await owner.commit_revision(engine,code,self.actor,GrammarRevisionCommitRequest(source_markdown=raw,
                expected_revision=read.revision,preview_fingerprint=preview.preview_fingerprint,operation_id=uuid4()))
            self.new,self.old_revision,self.new_revision=result.corrected_bank_id,preview.canonical.current_bank_revision,preview.proposed_revision
        finally:
            await engine.dispose()
        self.primary=next(q for q in self.questions if q['input']=='choice')
        self.production=next((q for q in self.questions if q['input']=='text'),self.primary)
        if policy is not _ABSENT_POLICY and not original_empty:
            await self.corrupt_policy(policy)
        if not receipt:
            await self.c.execute('ALTER TABLE governance_audit DISABLE TRIGGER grammar_quiz_receipt_guard')
            try: await self.c.execute('DELETE FROM governance_audit')
            finally: await self.c.execute('ALTER TABLE governance_audit ENABLE TRIGGER grammar_quiz_receipt_guard')

    async def corrupt_policy(self, policy):
        await self.c.execute('ALTER TABLE quiz_banks DISABLE TRIGGER zz_grammar_quiz_bank_guard')
        try:
            await self.c.execute('UPDATE quiz_banks SET meta=meta||$2::jsonb WHERE id=$1',self.new,
                encoded({'text_match_by_qid':policy}))
        finally:
            await self.c.execute('ALTER TABLE quiz_banks ENABLE TRIGGER zz_grammar_quiz_bank_guard')

    async def rpc(self, name, *args, connection=None):
        # Semantic test aliases expand to ACTUAL authored questions before SQL.
        # Unknown/malformed values remain untouched; no result/grading mock.
        if name=='grammar_quiz_progress_service' and hasattr(self,'questions'):
            args=list(args)
            attempts=json.loads(args[2])
            for row in attempts:
                if row.get('qid') in ('recognition','production'):
                    question=self.primary if row['qid']=='recognition' else self.production
                    row.update(qid=question['qid'],item_key=question['item_key'],skill=question['skill'],type=question['type'])
            stats=json.loads(args[3])
            for row in stats:
                if row.get('item_key')=='item': row['item_key']=self.primary['item_key']
                if isinstance(row.get('skills_passed'),list):
                    row['skills_passed']=[self.primary['skill'] if skill=='recognition' else skill for skill in row['skills_passed']]
            args[2],args[3]=encoded(attempts),encoded(stats)
        c = connection or self.c
        placeholders = ','.join('$' + str(i + 1) for i in range(len(args)))
        result = await c.fetchval(f'SELECT {name}({placeholders})', *args)
        return json.loads(result) if isinstance(result, str) else result

    async def start(self, *, current=False, user=None, kind=None):
        args=[user or self.user,self.new if current else self.old,self.new_revision if current else None,kind]
        if current and hasattr(self,'questions'):
            policy=await self.c.fetchval("SELECT meta->'text_match_by_qid' FROM quiz_banks WHERE id=$1",self.new)
            if policy and json.loads(policy):args.append('qid-exact-v1')
        return await self.rpc('grammar_quiz_start_service',*args)

    async def progress(self, session, *, complete=False, attempts=None):
        groups={}
        for question in self.questions: groups.setdefault(question['item_key'],set()).add(question['skill'])
        stats = [{'item_key':key,'correct_count':2 if complete else 0,'wrong_count':0,
            'skills_passed':sorted(skills) if complete else [],'production_done':complete,
            'status':'mastered' if complete else 'testing','credit_count':2 if complete else 0} for key,skills in groups.items()]
        return await self.rpc('grammar_quiz_progress_service', self.user, session,encoded(attempts or []),encoded(stats))


@pytest_asyncio.fixture
async def pg():
    raw = os.environ.get('GRAMMAR_QUIZ_REVISION_TEST_DATABASE_URL')
    if not raw:
        if os.environ.get('REQUIRE_PG') == '1':
            pytest.fail('REQUIRE_PG=1 requires explicit local Grammar revision PostgreSQL URL')
        pytest.skip('explicit local Grammar revision PostgreSQL URL required')
    url = make_url(raw)
    if url.drivername != 'postgresql+asyncpg' or url.host not in ('127.0.0.1','localhost','::1') or not (url.database or '').startswith('aver_ux_'):
        raise RuntimeError('Only named loopback aver_ux_ database is authorized')
    dsn = url.set(drivername='postgresql').render_as_string(hide_password=False)
    fixture_id = uuid4().hex
    schema = 'aver_grammar_boundary_' + fixture_id
    # PostgreSQL truncates identifiers at 63 bytes; role names must remain
    # exact because the context guard checks the actual SQL role name.
    roles = {name: 'aver_gqr_' + fixture_id + '_' + name for name in ('anon','authenticated','service_role')}
    c = await asyncpg.connect(dsn, server_settings={'statement_timeout': '5000'})
    try:
        await c.execute(f'CREATE SCHEMA {schema}')
        for role in roles.values():
            await c.execute(f'CREATE ROLE {role}')
        await c.execute(f'SET search_path={schema},public')
        fixture = GrammarPg(c, dsn, schema, roles)
        await fixture.foundation()
        await fixture.seed()
        yield fixture
    finally:
        # A failing migration can leave its explicit BEGIN aborted. Roll back
        # before removing only this fixture's random owned schema and roles.
        await c.execute('ROLLBACK')
        await c.execute('RESET ROLE')
        await c.execute(f'DROP SCHEMA IF EXISTS {schema} CASCADE')
        for role in roles.values():
            await c.execute(f'DROP ROLE IF EXISTS {role}')
        await c.close()


@pytest.mark.asyncio
async def test_additive_migration_and_rerun_preserve_unmanaged_rows(pg):
    before = await pg.c.fetchval('SELECT to_jsonb(b)::text FROM quiz_banks b WHERE id=$1', pg.old)
    await pg.c.execute(pg.adapted((MIGRATIONS / '309_grammar_quiz_revision_cutover.sql').read_text()))
    assert await pg.c.fetchval('SELECT to_jsonb(b)::text FROM quiz_banks b WHERE id=$1', pg.old) == before
    assert await pg.c.fetchval('SELECT count(*) FROM governance_audit') == 0
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_sessions WHERE grammar_revision IS NOT NULL') == 0


@pytest.mark.asyncio
async def test_eligible_n_minus_one_start_and_corrected_explicit_ack(pg):
    await pg.enroll()
    legacy = await pg.start()
    row = await pg.c.fetchrow('SELECT grammar_revision,grammar_admission_kind,grammar_predecessor_session_id FROM quiz_sessions WHERE id=$1', legacy['session_id'])
    assert tuple(row) == (pg.old_revision, 'continuation', pg.predecessor)
    assert legacy['grammar']['content_state'] == 'legacy'
    with pytest.raises(asyncpg.PostgresError, match='grammar_content_revised'):
        await pg.rpc('grammar_quiz_start_service', pg.user, pg.new, None, None,'qid-exact-v1')
    current = await pg.start(current=True)
    assert current['grammar']['bank_revision'] == pg.new_revision
    with pytest.raises(asyncpg.PostgresError, match='grammar_content_revised'):
        await pg.start(user=pg.other)


@pytest.mark.asyncio
async def test_completed_mastery_fence_precedes_end_and_retains_stale_parallel_snapshot(pg):
    await pg.enroll()
    first, parallel = await pg.start(), await pg.start()
    await pg.progress(first['session_id'], complete=True)
    completion = await pg.c.fetchval('SELECT grammar_mastery_completed_at FROM quiz_sessions WHERE id=$1', first['session_id'])
    assert completion is not None
    before = await pg.c.fetchval('SELECT to_jsonb(w)::text FROM quiz_word_stats w WHERE user_id=$1 AND bank_id=$2', pg.user, pg.old)
    attempt = {'client_id': str(uuid4()), 'qid': 'recognition', 'item_key': 'item', 'skill': 'recognition', 'type': 'mcq', 'is_correct': False}
    response = await pg.progress(parallel['session_id'], attempts=[attempt])
    assert response['attempts'] == 1 and response['grammar']['mastery_retained'] is True
    assert await pg.c.fetchval('SELECT to_jsonb(w)::text FROM quiz_word_stats w WHERE user_id=$1 AND bank_id=$2', pg.user, pg.old) == before
    with pytest.raises(asyncpg.PostgresError, match='grammar_content_revised'):
        await pg.start()
    with pytest.raises(asyncpg.PostgresError, match='grammar_legacy_reset_forbidden'):
        await pg.rpc('grammar_quiz_reset_service', pg.user, pg.old)
    assert await pg.c.fetchval('SELECT grammar_mastery_completed_at FROM quiz_sessions WHERE id=$1', first['session_id']) == completion


@pytest.mark.asyncio
@pytest.mark.parametrize('statement', [
    "UPDATE quiz_banks SET is_published=false WHERE id=$1",
    "DELETE FROM quiz_banks WHERE id=$1",
    "UPDATE quiz_questions SET prompt='changed' WHERE bank_id=$1",
    "DELETE FROM quiz_questions WHERE bank_id=$1",
    "DELETE FROM quiz_sessions WHERE bank_id=$1",
])
async def test_direct_managed_writes_reject_without_rpc(pg, statement):
    await pg.enroll()
    with pytest.raises(asyncpg.PostgresError, match='grammar_'):
        await pg.c.execute(statement, pg.old)


@pytest.mark.asyncio
async def test_forged_authenticated_context_cannot_create_managed_session(pg):
    await pg.enroll()
    await pg.c.execute('SET ROLE ' + pg.roles['authenticated'])
    async with pg.c.transaction():
        await pg.c.execute("SELECT set_config('aver.grammar_quiz_context',$1,true)", encoded({'action':'start',
            'actor': str(pg.user), 'code': CODE, 'bank': str(pg.old), 'admission_kind':'continuation'}))
        with pytest.raises(asyncpg.PostgresError, match='grammar_managed_write_required'):
            await pg.c.execute('''INSERT INTO quiz_sessions(user_id,bank_id,code,grammar_revision,grammar_admission_kind)
              VALUES($1,$2,$3,$4,'continuation')''', pg.user, pg.old, pg.code, pg.old_revision)


@pytest.mark.asyncio
async def test_private_proof_helpers_unavailable_to_service_rpc_role(pg):
    await pg.enroll()
    await pg.c.execute('SET ROLE ' + pg.roles['service_role'])
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await pg.c.fetchval('SELECT grammar_quiz_receipt_data($1)', pg.old)
    current = await pg.start(current=True)
    assert current['grammar']['content_state'] == 'current'


@pytest.mark.asyncio
async def test_topic_cascade_and_receipt_retention_are_actual_db_boundaries(pg):
    await pg.enroll()
    for statement, args in [
        ('DELETE FROM content_topics WHERE id=$1', (pg.topic,)),
        ('DELETE FROM governance_audit', ()), ('UPDATE governance_audit SET detail=detail', ()),
        ('TRUNCATE quiz_sessions CASCADE', ()),
    ]:
        with pytest.raises(asyncpg.PostgresError, match='grammar_'):
            await pg.c.execute(statement, *args)
    assert await pg.c.fetchval('SELECT count(*) FROM governance_audit') == 1


@pytest.mark.asyncio
async def test_review_records_no_graded_progress(pg):
    await pg.enroll()
    review = await pg.start(current=True, kind='review')
    with pytest.raises(asyncpg.PostgresError, match='grammar_review_read_only'):
        await pg.progress(review['session_id'], complete=True)
    with pytest.raises(asyncpg.PostgresError, match='grammar_review_read_only'):
        await pg.rpc('grammar_quiz_end_service', pg.user, review['session_id'], encoded({'ended_by':'completed','total_questions':1}))
    result = await pg.rpc('grammar_quiz_end_service', pg.user, review['session_id'], encoded({'ended_by':'completed'}))
    assert result['total_questions'] == 0 and result['accuracy'] is None


@pytest.mark.asyncio
async def test_global_statement_gate_precedes_tuple_and_topic_cascade_locks(pg):
    await pg.enroll()
    c = await pg.connection()
    try:
        async with pg.c.transaction():
            await pg.c.execute('SELECT pg_advisory_xact_lock(306,1)')
            pending = asyncio.create_task(c.execute('UPDATE quiz_questions SET prompt=prompt WHERE bank_id=$1', pg.old))
            await asyncio.sleep(0.1)
            assert not pending.done()
            # This would deadlock if the waiting statement had its child tuple lock.
            await pg.c.fetch('SELECT id FROM quiz_questions WHERE bank_id=$1 FOR UPDATE', pg.old)
        with pytest.raises(asyncpg.PostgresError, match='grammar_managed_questions_immutable'):
            await asyncio.wait_for(pending, 3)
    finally:
        await c.close()


@pytest.mark.asyncio
async def test_atomic_import_unmanaged_behavior_and_entry_gate_before_topic_lock(pg):
    payload = {'topic_id': str(pg.topic), 'code': 'unmanaged-control', 'skill_area': 'grammar',
        'meta': {}, 'title': 'Synthetic import'}
    rows = [{'qid': 'control', 'item_key': 'control', 'type': 'mcq', 'input': 'choice',
        'skill': 'recognition', 'prompt': 'Synthetic', 'options': ['Yes','No'], 'answer': 0}]
    inserted = await pg.c.fetchrow('SELECT * FROM import_quiz_bank_atomic($1::jsonb,$2::jsonb,$3)', encoded(payload), encoded(rows), 'unpublished')
    assert inserted['written'] == 1 and inserted['is_published'] is False
    await pg.enroll()
    c = await pg.connection()
    try:
        async with pg.c.transaction():
            await pg.c.execute('SELECT pg_advisory_xact_lock(306,1)')
            pending = asyncio.create_task(c.fetchrow('SELECT * FROM import_quiz_bank_atomic($1::jsonb,$2::jsonb,$3)', encoded(payload), encoded(rows), 'published'))
            await asyncio.sleep(0.1)
            assert not pending.done()
            # The 294 implementation locks its topic first. The 306 facade must
            # wait at the gate before entering it, so this cannot deadlock.
            await pg.c.fetchval('SELECT id FROM content_topics WHERE id=$1 FOR UPDATE', pg.topic)
        updated = await asyncio.wait_for(pending, 3)
        assert updated['action'] == 'updated' and updated['is_published'] is True
        payload['code'] = CODE
        with pytest.raises(asyncpg.PostgresError, match='grammar_managed_bank_immutable'):
            await c.fetch('SELECT * FROM import_quiz_bank_atomic($1::jsonb,$2::jsonb,$3)', encoded(payload), encoded(rows), 'preserve')
    finally:
        await c.close()


@pytest.mark.asyncio
async def test_direct_progress_waits_at_statement_gate_then_rejects_new_managed_scope(pg):
    # Real producer owns publication; hold its transaction at corrected INSERT.
    from services import grammar_quiz_revisions as owner
    from test_grammar_quiz_revisions import canonical_engine,canonical,commit_request
    gen=canonical.__wrapped__(pg);_,engine=await anext(gen)
    request=await commit_request((pg,engine))
    c=await pg.connection(); latch=int.from_bytes(uuid4().bytes[:7],'big');tasks=[]
    try:
        await pg.c.execute(f'''CREATE FUNCTION hold_corrected_insert() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.grammar_is_current THEN PERFORM pg_advisory_xact_lock({latch}); END IF; RETURN NEW; END $$;
          CREATE TRIGGER zzz_hold_corrected_insert BEFORE INSERT ON quiz_banks FOR EACH ROW EXECUTE FUNCTION hold_corrected_insert();''')
        await pg.c.execute('SELECT pg_advisory_lock($1::bigint)',latch)
        committing=asyncio.create_task(owner.commit_revision(engine,CODE,pg.actor,request));tasks.append(committing)
        for _ in range(100):
            waiting=await pg.c.fetchval('SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype=\'advisory\' AND NOT granted AND pid<>pg_backend_pid())')
            if waiting:break
            await asyncio.sleep(.01)
        assert waiting and not committing.done()
        pending=asyncio.create_task(c.execute('''INSERT INTO quiz_attempts(user_id,session_id,bank_id,item_key,qid,is_correct)
          VALUES($1,$2,$3,'item','recognition',false)''',pg.user,pg.predecessor,pg.old));tasks.append(pending)
        for _ in range(100):
            waiting=await pg.c.fetchval('SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype=\'advisory\' AND NOT granted)',c.get_server_pid())
            if waiting:break
            await asyncio.sleep(.01)
        assert waiting and not pending.done()
        await pg.c.execute('SELECT pg_advisory_unlock($1::bigint)',latch)
        assert (await asyncio.wait_for(committing,3)).outcome=='applied'
        with pytest.raises(asyncpg.PostgresError,match='grammar_managed_progress_not_admitted'):
            await asyncio.wait_for(pending,3)
        assert await pg.c.fetchval('SELECT count(*) FROM quiz_attempts')==0
    finally:
        await pg.c.execute('SELECT pg_advisory_unlock($1::bigint)',latch)
        for task in tasks:
            if not task.done():task.cancel()
            try:await task
            except BaseException:pass
        await c.close();await gen.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize('corruption', ['duplicate_top', 'duplicate_same_value', 'duplicate_nested', 'checksum', 'scalar_cohort'])
async def test_corrupt_retained_receipt_never_admits_legacy_work(pg, corruption):
    await pg.enroll()
    raw = await pg.c.fetchval('SELECT detail FROM governance_audit')
    proof = json.loads(raw)
    if corruption == 'duplicate_top':
        raw = '{"original_revision":"' + 'd' * 64 + '",' + raw[1:]
    elif corruption == 'duplicate_same_value':
        raw = '{"original_revision":"' + pg.old_revision + '",' + raw[1:]
    elif corruption == 'duplicate_nested':
        raw = raw.replace('"eligible":true', '"eligible":false,"eligible":true')
        assert raw != await pg.c.fetchval('SELECT detail FROM governance_audit')
    elif corruption == 'checksum':
        proof['cohort'][0]['eligible'] = False
        raw = encoded(proof)
    elif corruption == 'scalar_cohort':
        proof['cohort'] = 7
        raw = encoded(proof)
    await pg.c.execute('ALTER TABLE governance_audit DISABLE TRIGGER grammar_quiz_receipt_guard')
    await pg.c.execute('UPDATE governance_audit SET detail=$1', raw)
    await pg.c.execute('ALTER TABLE governance_audit ENABLE TRIGGER grammar_quiz_receipt_guard')
    with pytest.raises(asyncpg.PostgresError, match='grammar_cutover_receipt_invalid'):
        await pg.start()
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_sessions') == 1


@pytest.mark.asyncio
async def test_missing_receipt_is_unavailable_and_does_not_create_session(pg):
    await pg.enroll(receipt=False)
    with pytest.raises(asyncpg.PostgresError, match='grammar_cutover_proof_unavailable'):
        await pg.start()
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_sessions') == 1


@pytest.mark.asyncio
async def test_parallel_mastery_and_stale_progress_serialized_with_idempotent_attempt(pg):
    await pg.enroll()
    first, second = await pg.start(), await pg.start()
    c = await pg.connection()
    attempt = {'client_id': str(uuid4()), 'qid': 'recognition', 'item_key': 'item', 'skill': 'recognition', 'type': 'mcq', 'is_correct': False}
    stale_stats = [{'item_key':'item','skills_passed':[],'production_done':False,'wrong_count':1}]
    try:
        async with pg.c.transaction():
            await pg.progress(first['session_id'], complete=True)
            pending = asyncio.create_task(pg.rpc('grammar_quiz_progress_service', pg.user, second['session_id'],
                encoded([attempt]), encoded(stale_stats), connection=c))
            await asyncio.sleep(0.1)
            assert not pending.done()
        result = await asyncio.wait_for(pending, 3)
        assert result['attempts'] == 1 and result['grammar']['mastery_retained'] is True
        repeated = await pg.rpc('grammar_quiz_progress_service', pg.user, second['session_id'], encoded([attempt]), encoded(stale_stats))
        assert repeated['attempts'] == 0
        assert await pg.c.fetchval('SELECT production_done FROM quiz_word_stats WHERE user_id=$1 AND bank_id=$2', pg.user, pg.old) is True
        assert await pg.c.fetchval('SELECT count(*) FROM quiz_attempts') == 1
    finally:
        await c.close()


@pytest.mark.asyncio
async def test_corrected_reset_marks_open_session_and_retains_history_completion(pg):
    await pg.enroll()
    session = await pg.start(current=True)
    await pg.progress(session['session_id'], complete=True)
    await pg.rpc('grammar_quiz_reset_service', pg.user, pg.new)
    with pytest.raises(asyncpg.PostgresError, match='grammar_reset_stale'):
        await pg.progress(session['session_id'])
    await pg.rpc('grammar_quiz_end_service', pg.user, session['session_id'], encoded({'ended_by':'completed'}))
    await pg.rpc('grammar_quiz_reset_service', pg.user, pg.new)
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_word_stats WHERE bank_id=$1', pg.new) == 0
    assert await pg.c.fetchval('SELECT grammar_mastery_completed_at IS NOT NULL FROM quiz_sessions WHERE id=$1', session['session_id']) is True
    fresh = await pg.start(current=True)
    await pg.progress(fresh['session_id'])
    assert await pg.c.fetchval('SELECT production_done FROM quiz_word_stats WHERE bank_id=$1', pg.new) is False


@pytest.mark.asyncio
async def test_pause_new_starts_preserves_already_admitted_progress_and_finalization(pg):
    await pg.enroll()
    session = await pg.start(current=True)
    async with pg.c.transaction():
        await pg.c.execute("SELECT set_config('aver.grammar_quiz_context',$1,true)", encoded({'action':'pause_starts','code':CODE,'bank':str(pg.new)}))
        await pg.c.execute('UPDATE quiz_banks SET grammar_new_starts_enabled=false WHERE id=$1', pg.new)
    continuation = await pg.start(current=True)
    assert continuation['grammar']['can_continue_current'] is True
    with pytest.raises(asyncpg.PostgresError, match='grammar_new_starts_paused'):
        await pg.start(current=True,user=pg.other)
    await pg.progress(session['session_id'], complete=True)
    final = await pg.rpc('grammar_quiz_end_service', pg.user, session['session_id'], encoded({'ended_by':'completed','total_questions':2,'total_correct':2}))
    retry = await pg.rpc('grammar_quiz_end_service', pg.user, session['session_id'], encoded({'ended_by':'paused','total_questions':0}))
    assert {k:v for k,v in final.items() if k!='grammar'} == retry and final['accuracy'] == 1.0


@pytest.mark.asyncio
async def test_user_delete_cascade_only_erases_that_owners_history_and_retains_private_bank_proof(pg):
    await pg.enroll()
    receipt_before = await pg.c.fetchval('SELECT detail FROM governance_audit')
    bank_before = await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(b) ORDER BY id)::text FROM quiz_banks b')
    questions_before = await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(q) ORDER BY id)::text FROM quiz_questions q')
    first,second = await pg.start(),await pg.start()
    await pg.progress(first['session_id'])
    other = await pg.start(current=True,user=pg.other)
    other_before = await pg.c.fetchval('SELECT to_jsonb(s)::text FROM quiz_sessions s WHERE id=$1',other['session_id'])
    notices = []
    def collect_notice(connection, message):
        if message.message.startswith('grammar_erasure_probe:'):
            notices.append(json.loads(message.message.split(':',1)[1]))
    pg.c.add_log_listener(collect_notice)
    await pg.c.execute('''CREATE FUNCTION observe_erasure_parent() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE NOTICE 'grammar_erasure_probe:%', jsonb_build_object('owner_absent',
        NOT EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id),'trigger_depth',pg_trigger_depth());
      RETURN OLD; END $$;
      CREATE TRIGGER aaa_observe_erasure BEFORE DELETE ON quiz_sessions
      FOR EACH ROW EXECUTE FUNCTION observe_erasure_parent()''')
    with pytest.raises(asyncpg.PostgresError, match='grammar_managed_history_retained'):
        await pg.c.execute('DELETE FROM quiz_sessions WHERE id=$1', pg.predecessor)
    await asyncio.sleep(0)
    assert notices[-1]['owner_absent'] is False
    await pg.c.execute('DELETE FROM users WHERE id=$1', pg.user)
    await asyncio.sleep(0)
    assert notices[-1]['owner_absent'] is True
    assert await pg.c.fetchval('SELECT count(*) FROM users WHERE id=$1', pg.user) == 0
    for table in ('quiz_sessions','quiz_attempts','quiz_word_stats'):
        assert await pg.c.fetchval(f'SELECT count(*) FROM {table} WHERE user_id=$1',pg.user)==0
    assert await pg.c.fetchval('SELECT detail FROM governance_audit')==receipt_before
    assert await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(b) ORDER BY id)::text FROM quiz_banks b')==bank_before
    assert await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(q) ORDER BY id)::text FROM quiz_questions q')==questions_before
    assert await pg.c.fetchval('SELECT to_jsonb(s)::text FROM quiz_sessions s WHERE id=$1',other['session_id'])==other_before
    with pytest.raises(asyncpg.PostgresError,match='grammar_session_not_owned'):
        await pg.start()
    surviving=await pg.rpc('grammar_quiz_state',pg.other,pg.new)
    assert surviving['bank_id']==str(pg.new) and surviving['can_continue_current'] is True
    continued=await pg.start(current=True,user=pg.other)
    assert continued['grammar']['bank_id']==str(pg.new)
    assert await pg.c.fetchval('SELECT detail FROM governance_audit')==receipt_before


@pytest.mark.asyncio
@pytest.mark.parametrize('code',[CODE,'G-grammar-for-reading-reduced-relative-clauses'])
async def test_account_erasure_waits_real_progress_before_owner_fk_and_preserves_other_owner(pg,code):
    """Pause the real RPC before INSERT FK checks, after its session lock."""
    await pg.c.execute('UPDATE quiz_banks SET code=$2 WHERE id=$1',pg.old,code)
    await pg.c.execute('UPDATE quiz_sessions SET code=$2 WHERE id=$1',pg.predecessor,code)
    await pg.enroll(code=code)
    session = await pg.start()
    other = await pg.start(current=True,user=pg.other)
    worker, eraser = await pg.connection(), await pg.connection()
    latch = int.from_bytes(uuid4().bytes[:7],'big')
    tasks = []
    try:
        await pg.c.execute(f'''CREATE FUNCTION pause_owned_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN PERFORM pg_advisory_xact_lock({latch}); RETURN NEW; END $$;
          CREATE TRIGGER zzz_pause_owned_attempt BEFORE INSERT ON quiz_attempts
          FOR EACH ROW EXECUTE FUNCTION pause_owned_attempt();''')
        await pg.c.execute('SELECT pg_advisory_lock($1::bigint)',latch)
        attempt = {'client_id':str(uuid4()),'qid':'recognition','item_key':'item',
          'skill':'recognition','type':'mcq','is_correct':False}
        progress = asyncio.create_task(pg.rpc('grammar_quiz_progress_service',pg.user,session['session_id'],
            encoded([attempt]),encoded([]),connection=worker))
        tasks.append(progress)
        for _ in range(100):
            waiting = await pg.c.fetchval('''SELECT EXISTS(SELECT 1 FROM pg_locks
              WHERE pid=$1 AND locktype='advisory' AND NOT granted)''',worker.get_server_pid())
            if waiting: break
            await asyncio.sleep(.01)
        assert waiting and not progress.done()
        deleting = asyncio.create_task(eraser.execute('DELETE FROM users WHERE id=$1',pg.user))
        tasks.append(deleting)
        for _ in range(100):
            waiting = await pg.c.fetchval('''SELECT EXISTS(SELECT 1 FROM pg_locks
              WHERE pid=$1 AND locktype='advisory' AND NOT granted)''',eraser.get_server_pid())
            if waiting: break
            await asyncio.sleep(.01)
        assert waiting and not deleting.done()
        assert await pg.c.fetchval('SELECT id FROM users WHERE id=$1 FOR KEY SHARE NOWAIT',pg.user)==pg.user
        await pg.c.execute('SELECT pg_advisory_unlock($1::bigint)',latch)
        assert (await asyncio.wait_for(progress,3))['attempts']==1
        await asyncio.wait_for(deleting,3)
        assert await pg.c.fetchval('SELECT count(*) FROM quiz_sessions WHERE user_id=$1',pg.user)==0
        assert await pg.c.fetchval('SELECT count(*) FROM quiz_attempts WHERE user_id=$1',pg.user)==0
        assert str(await pg.c.fetchval('SELECT id FROM quiz_sessions WHERE id=$1',other['session_id']))==other['session_id']
        assert await pg.c.fetchval('SELECT count(*) FROM governance_audit')==1
        assert await pg.c.fetchval('SELECT count(*) FROM quiz_banks')==2
    finally:
        await pg.c.execute('SELECT pg_advisory_unlock($1::bigint)',latch)
        for task in tasks:
            if not task.done(): task.cancel()
            try: await task
            except BaseException: pass
        await worker.close(); await eraser.close()


@pytest.mark.asyncio
async def test_live_owner_cannot_clear_progress_session_link_or_delete_history(pg):
    await pg.enroll()
    session=await pg.start()
    await pg.progress(session['session_id'])
    for statement in ["UPDATE quiz_word_stats SET last_session_id=NULL WHERE user_id=$1",
                      "DELETE FROM quiz_word_stats WHERE user_id=$1",
                      "DELETE FROM quiz_sessions WHERE user_id=$1"]:
        with pytest.raises(asyncpg.PostgresError):
            await pg.c.execute(statement,pg.user)
    assert str(await pg.c.fetchval('SELECT last_session_id FROM quiz_word_stats WHERE user_id=$1',pg.user))==session['session_id']
