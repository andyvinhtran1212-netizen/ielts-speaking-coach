"""Real source + actual transaction/CAS/receipt contracts, no live transport."""
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine

from models.grammar_quiz_revisions import GrammarRevisionPreviewRequest, GrammarRevisionCommitRequest
from services import grammar_quiz_revisions as service
from services.grammar_quiz_revision_source import parse_reviewed_source, REVIEWED_SOURCES
from test_grammar_quiz_revision_boundary import pg, encoded, CODE

SOURCE = (Path(__file__).parents[2] / 'docs/grammar-quiz-banks' / (CODE + '.md')).read_text()


def canonical_engine(pg, *, timezone=None):
    settings={'search_path':pg.schema+',public','statement_timeout':'5000'}
    if timezone is not None: settings['TimeZone']=timezone
    engine = create_async_engine(pg.dsn.replace('postgresql://','postgresql+asyncpg://',1),
        connect_args={'server_settings':settings})
    # Test-only schema adaptation: product SQL is fixed to canonical public;
    # only SQL identifiers/regclass parameters are mapped to the random fixture.
    @event.listens_for(engine.sync_engine,'before_cursor_execute',retval=True)
    def owned_schema(connection,cursor,statement,parameters,context,executemany):
        def parameter(value):
            if isinstance(value,str) and value in {'public.'+table for table in (
                'content_topics','quiz_banks','quiz_questions','quiz_sessions','quiz_attempts','quiz_word_stats','governance_audit')}:
                return pg.schema+'.'+value.split('.',1)[1]
            return value
        return statement.replace('public.',pg.schema+'.').replace('auth.users',pg.schema+'.users'),tuple(parameter(value) for value in parameters)
    return engine


@pytest_asyncio.fixture
async def canonical(pg):
    source = parse_reviewed_source(CODE,SOURCE)
    original = [{**question} for question in source.questions]
    next(question for question in original if question['qid']=='ps_vspc_a1')['answer'] = 0
    await pg.c.execute('SELECT quiz_replace_questions($1,$2::jsonb)',pg.old,encoded(original))
    await pg.c.execute('UPDATE quiz_banks SET meta=$2::jsonb,words_count=$3,title=$4,source=$5 WHERE id=$1',
        pg.old,encoded({k:v for k,v in source.metadata['meta'].items() if k!='text_match_by_qid'}),
        source.metadata['words_count'],source.metadata['title'],source.metadata['source'])
    engine=canonical_engine(pg)
    try:
        yield pg,engine
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_actual_cutover_learner_list_is_current_but_owned_legacy_url_still_works(canonical,monkeypatch):
    import json
    from routers import quiz as router
    from services import quiz_service
    from test_quiz_service import _FakeSupabase
    pg,engine=canonical
    result=await service.commit_revision(engine,CODE,pg.actor,await commit_request(canonical))
    rows=json.loads(await pg.c.fetchval('''SELECT jsonb_agg(to_jsonb(b) ORDER BY code)::text
        FROM quiz_banks b WHERE is_published AND skill_area='grammar' '''))
    assert len(rows)==2
    old=next(row for row in rows if row['id']==str(pg.old))
    questions=json.loads(await pg.c.fetchval('''SELECT jsonb_agg(to_jsonb(q) ORDER BY "order")::text
        FROM quiz_questions q WHERE bank_id=$1''',pg.old))
    legacy_state=await pg.rpc('grammar_quiz_state',pg.user,pg.old)
    assert legacy_state['can_continue_legacy'] is True
    fake=_FakeSupabase({('quiz_banks','select'):rows})
    monkeypatch.setattr(quiz_service,'supabase_admin',fake)
    async def signed_in(_authorization): return {'id':str(pg.user)}
    monkeypatch.setattr(router,'get_supabase_user',signed_in)
    listed=await router.list_banks(skill_area='grammar',topic_id=old['topic_id'],authorization='test')
    assert len(listed)==1
    assert listed[0]['id']==str(result.corrected_bank_id) and listed[0]['code']==CODE
    fake.responses={('quiz_banks','select'):[old],('quiz_questions','select'):questions,
        ('rpc','grammar_quiz_state'):legacy_state}
    legacy=await router.get_bank(pg.old,authorization='test')
    assert legacy['bank']['id']==str(pg.old) and legacy['questions']==questions
    assert legacy['grammar']['content_state']=='legacy' and legacy['grammar']['can_continue_legacy'] is True
    assert all(call['op'] in {'select','rpc'} for call in fake.calls)


@pytest.mark.asyncio
@pytest.mark.parametrize('code',list(REVIEWED_SOURCES))
async def test_actual_twelve_sources_policy_copy_readback_and_synthetic_original_history(pg,code):
    """Actual final sources, synthetic predecessor/history; no production cohort proof."""
    import json
    raw=(Path(__file__).parents[2]/'docs/grammar-quiz-banks'/(code+'.md')).read_text()
    source=parse_reviewed_source(code,raw)
    await pg.c.execute('SELECT quiz_replace_questions($1,$2::jsonb)',pg.old,encoded(source.questions))
    meta={k:v for k,v in source.metadata['meta'].items() if k!='text_match_by_qid'}
    meta['retained_extra']={'label':'Synthetic extra','precision':123}
    await pg.c.execute('UPDATE quiz_banks SET code=$2,meta=$3::jsonb,words_count=$4,title=$5,source=$6 WHERE id=$1',
        pg.old,code,encoded(meta),source.metadata['words_count'],source.metadata['title'],source.metadata['source'])
    await pg.c.execute('UPDATE quiz_sessions SET code=$2 WHERE id=$1',pg.predecessor,code)
    await pg.c.execute('UPDATE quiz_questions SET why_wrong=$3::jsonb WHERE bank_id=$1 AND qid=$2',
        pg.old,source.questions[0]['qid'],encoded({'0':'Synthetic retained extra, not an academic source claim'}))
    originals=await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(q) ORDER BY "order")::text FROM quiz_questions q WHERE bank_id=$1',pg.old)
    history=await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(s) ORDER BY id)::text FROM quiz_sessions s WHERE bank_id=$1',pg.old)
    engine=canonical_engine(pg)
    try:
        read=await service.read_revision(engine,code)
        preview=await service.preview_revision(engine,code,GrammarRevisionPreviewRequest(source_markdown=raw,expected_revision=read.revision))
        assert preview.changed_questions==[]
        from uuid import uuid4
        request=GrammarRevisionCommitRequest(source_markdown=raw,expected_revision=read.revision,
            preview_fingerprint=preview.preview_fingerprint,operation_id=uuid4())
        result=await service.commit_revision(engine,code,pg.actor,request)
        actual=json.loads(await pg.c.fetchval('SELECT meta::text FROM quiz_banks WHERE id=$1',result.corrected_bank_id))
        assert {k:v for k,v in actual.items() if k!='text_match_by_qid'}==meta
        assert actual.get('text_match_by_qid')==source.metadata['meta'].get('text_match_by_qid')
        assert json.loads(await pg.c.fetchval('SELECT meta::text FROM quiz_banks WHERE id=$1',pg.old))==meta
        assert await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(q) ORDER BY "order")::text FROM quiz_questions q WHERE bank_id=$1',pg.old)==originals
        assert await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(s) ORDER BY id)::text FROM quiz_sessions s WHERE bank_id=$1',pg.old)==history
        copied=json.loads(await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(q) ORDER BY "order")::text FROM quiz_questions q WHERE bank_id=$1',result.corrected_bank_id))
        assert len(copied)==len(source.questions)
        for old,new in zip(json.loads(originals),copied):
            assert {k:v for k,v in old.items() if k not in ('id','bank_id','created_at')}== \
                {k:v for k,v in new.items() if k not in ('id','bank_id','created_at')}
        if source.metadata['meta'].get('text_match_by_qid'):
            import asyncpg
            with pytest.raises(asyncpg.PostgresError,match='grammar_text_match_policy_required'):
                await pg.rpc('grammar_quiz_start_service',pg.user,result.corrected_bank_id,preview.proposed_revision,None)
        admitted=await pg.rpc('grammar_quiz_start_service',pg.user,result.corrected_bank_id,preview.proposed_revision,None,'qid-exact-v1')
        assert admitted['grammar']['bank_id']==str(result.corrected_bank_id)
        assert ('text_match_policy' in admitted['grammar'])==bool(source.metadata['meta'].get('text_match_by_qid'))
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_read_preview_commit_and_exact_receipt_replay_preserve_original_source_history(canonical):
    pg,engine = canonical
    original_bank = await pg.c.fetchval('SELECT to_jsonb(b)::text FROM quiz_banks b WHERE id=$1',pg.old)
    original_questions = await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(q) ORDER BY "order")::text FROM quiz_questions q WHERE bank_id=$1',pg.old)
    original_sessions = await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(s) ORDER BY id)::text FROM quiz_sessions s WHERE bank_id=$1',pg.old)
    read = await service.read_revision(engine,CODE)
    assert read.is_managed is False and read.footprint.sessions==1
    assert read.footprint.classifications=={'provably_unfinished_in_progress':1}
    preview_request = GrammarRevisionPreviewRequest(source_markdown=SOURCE,expected_revision=read.revision)
    preview = await service.preview_revision(engine,CODE,preview_request)
    assert [(change.qid,change.fields) for change in preview.changed_questions]==[('ps_vspc_a1',['answer'])]
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_banks')==1
    request = GrammarRevisionCommitRequest(**preview_request.model_dump(),preview_fingerprint=preview.preview_fingerprint,operation_id='12345678-1234-5678-1234-567812345678')
    try:
        committed = await service.commit_revision(engine,CODE,pg.actor,request)
    except service.GrammarRevisionError as failure:
        cause = failure.__context__
        if cause is not None:
            pytest.fail('unexpected storage failure: '+str(getattr(cause,'orig',cause)).splitlines()[0])
        raise
    assert committed.outcome=='applied' and committed.current_matches_committed is True
    replay = await service.commit_revision(engine,CODE,pg.actor,request)
    assert replay.outcome=='already_applied' and replay.corrected_bank_id==committed.corrected_bank_id
    assert await pg.c.fetchval('SELECT count(*) FROM governance_audit')==1
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_banks')==2
    assert await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(q) ORDER BY "order")::text FROM quiz_questions q WHERE bank_id=$1',pg.old)==original_questions
    assert await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(s) ORDER BY id)::text FROM quiz_sessions s WHERE bank_id=$1',pg.old)==original_sessions
    import json
    old_bank_after = json.loads(await pg.c.fetchval('SELECT to_jsonb(b)::text FROM quiz_banks b WHERE id=$1',pg.old))
    old_bank_before = json.loads(original_bank)
    assert {key:value for key,value in old_bank_after.items() if not key.startswith('grammar_')}=={key:value for key,value in old_bank_before.items() if not key.startswith('grammar_')}
    state = await pg.start()
    assert state['grammar']['content_state']=='legacy'
    new_state = await pg.rpc('grammar_quiz_start_service',pg.user,committed.corrected_bank_id,preview.proposed_revision,None,'qid-exact-v1')
    assert new_state['grammar']['content_state']=='current'


@pytest.mark.asyncio
async def test_unavailable_engine_never_constructs_storage_or_reports_empty():
    with pytest.raises(service.GrammarRevisionError) as error:
        await service.read_revision(None,CODE)
    assert error.value.status_code==503 and error.value.code=='grammar_storage_unavailable'


@pytest.mark.asyncio
async def test_stale_revision_and_unknown_legacy_cohort_fail_before_publication(canonical):
    pg,engine = canonical
    read = await service.read_revision(engine,CODE)
    request = GrammarRevisionPreviewRequest(source_markdown=SOURCE,expected_revision='f'*64)
    with pytest.raises(service.GrammarRevisionError) as error:
        await service.preview_revision(engine,CODE,request)
    assert error.value.status_code==409 and error.value.current_revision==read.revision
    # Accepted historical attempt without canonical word stats is genuinely
    # unknown; absence is not guessed into an eligible cohort.
    await pg.c.execute("INSERT INTO quiz_attempts(user_id,session_id,bank_id,qid,item_key,is_correct) VALUES($1,$2,$3,'ps_vspc_a1','ps-vs-present-continuous',false)",pg.user,pg.predecessor,pg.old)
    read = await service.read_revision(engine,CODE)
    assert read.footprint.authoritative_review_required is True
    preview = await service.preview_revision(engine,CODE,GrammarRevisionPreviewRequest(source_markdown=SOURCE,expected_revision=read.revision))
    request = GrammarRevisionCommitRequest(source_markdown=SOURCE,expected_revision=read.revision,preview_fingerprint=preview.preview_fingerprint,operation_id='22345678-1234-5678-1234-567812345678')
    with pytest.raises(service.GrammarRevisionError) as error:
        await service.commit_revision(engine,CODE,pg.actor,request)
    assert error.value.status_code==503 and error.value.code=='grammar_authoritative_review_required'
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_banks')==1
    assert await pg.c.fetchval('SELECT count(*) FROM governance_audit')==0


async def commit_request(canonical):
    from uuid import uuid4
    pg,engine=canonical
    read=await service.read_revision(engine,CODE)
    preview=await service.preview_revision(engine,CODE,GrammarRevisionPreviewRequest(source_markdown=SOURCE,expected_revision=read.revision))
    return GrammarRevisionCommitRequest(source_markdown=SOURCE,expected_revision=read.revision,
        preview_fingerprint=preview.preview_fingerprint,operation_id=uuid4())


@pytest.mark.asyncio
async def test_concurrent_receipt_retry_is_single_atomic_publication(canonical):
    import asyncio
    pg,engine=canonical
    request=await commit_request(canonical)
    first,second=await asyncio.gather(service.commit_revision(engine,CODE,pg.actor,request),service.commit_revision(engine,CODE,pg.actor,request))
    assert {first.outcome,second.outcome}=={'applied','already_applied'}
    assert first.corrected_bank_id==second.corrected_bank_id
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_banks')==2
    assert await pg.c.fetchval('SELECT count(*) FROM governance_audit')==1
    changed=request.model_copy(update={'preview_fingerprint':'f'*64})
    with pytest.raises(service.GrammarRevisionError) as error:
        await service.commit_revision(engine,CODE,pg.actor,changed)
    assert error.value.status_code==409 and error.value.code=='grammar_operation_conflict'
    # UUID alone has no global meaning. A different actor has its own scoped
    # operation, subject to the already-revised bank gate rather than actor1's ACK.
    with pytest.raises(service.GrammarRevisionError) as error:
        await service.commit_revision(engine,CODE,pg.other,request)
    assert error.value.status_code==409 and error.value.code=='grammar_already_revised'


@pytest.mark.asyncio
async def test_audit_insert_failure_rolls_back_every_question_and_mapping(canonical):
    pg,engine=canonical
    request=await commit_request(canonical)
    before=await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(b))::text FROM quiz_banks b')
    await pg.c.execute('''CREATE FUNCTION reject_test_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$;
      CREATE TRIGGER zzz_reject_test_receipt BEFORE INSERT ON governance_audit FOR EACH ROW EXECUTE FUNCTION reject_test_receipt();''')
    with pytest.raises(service.GrammarRevisionError) as error:
        await service.commit_revision(engine,CODE,pg.actor,request)
    assert error.value.status_code==503
    assert await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(b))::text FROM quiz_banks b')==before
    assert await pg.c.fetchval('SELECT count(*) FROM governance_audit')==0
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_questions')==31


@pytest.mark.asyncio
async def test_exact_decimal_extra_metadata_survives_clone_and_changes_cas(canonical):
    pg,engine=canonical
    await pg.c.execute('''UPDATE quiz_banks SET meta=meta||'{"preserved":{"fraction":0.123456789012345678901234567890,"large":9007199254740993.01,"truth":true,"null":null}}'::jsonb WHERE id=$1''',pg.old)
    before=await service.read_revision(engine,CODE)
    await pg.c.execute('''UPDATE quiz_banks SET meta=jsonb_set(meta,'{preserved,large}','9007199254740993.02') WHERE id=$1''',pg.old)
    changed=await service.read_revision(engine,CODE)
    assert changed.revision!=before.revision
    await pg.c.execute('''UPDATE quiz_banks SET meta=jsonb_set(meta,'{preserved,large}','9007199254740993.01') WHERE id=$1''',pg.old)
    request=await commit_request(canonical)
    committed=await service.commit_revision(engine,CODE,pg.actor,request)
    original=await pg.c.fetchval("SELECT meta->'preserved' FROM quiz_banks WHERE id=$1",pg.old)
    corrected=await pg.c.fetchval("SELECT meta->'preserved' FROM quiz_banks WHERE id=$1",committed.corrected_bank_id)
    assert corrected==original
    assert await pg.c.fetchval("SELECT (meta->'preserved'->>'large')::numeric=9007199254740993.01 FROM quiz_banks WHERE id=$1",committed.corrected_bank_id)
    # A one-unit change beyond float precision cannot masquerade as the same CAS.
    await pg.c.execute('ALTER TABLE quiz_banks DISABLE TRIGGER zz_grammar_quiz_bank_guard')
    try:
        await pg.c.execute('''UPDATE quiz_banks SET meta=jsonb_set(meta,'{preserved,large}','9007199254740993.02') WHERE id=$1''',committed.corrected_bank_id)
    finally:
        await pg.c.execute('ALTER TABLE quiz_banks ENABLE TRIGGER zz_grammar_quiz_bank_guard')
    # A post-publication immutable META change is corrupt proof, not the
    # legitimate mutable new-start flag drift exercised separately below.
    for call in [lambda:service.read_revision(engine,CODE),lambda:service.commit_revision(engine,CODE,pg.actor,request)]:
        with pytest.raises(service.GrammarRevisionError) as error: await call()
        assert error.value.status_code==503 and error.value.code=='grammar_receipt_unavailable'


@pytest.mark.asyncio
async def test_fractional_timestamp_canonicalization_keeps_full_corrected_readback(canonical):
    pg,engine=canonical
    @event.listens_for(engine.sync_engine,'before_cursor_execute',retval=True)
    def fixed_fraction(connection,cursor,statement,parameters,context,executemany):
        if statement=='SELECT clock_timestamp()':
            statement="SELECT '2030-01-01T00:00:00.123450+00:00'::timestamptz"
        return statement,parameters
    result=await service.commit_revision(engine,CODE,pg.actor,await commit_request(canonical))
    assert result.outcome=='applied'
    assert await pg.c.fetchval("SELECT created_at='2030-01-01T00:00:00.123450+00:00'::timestamptz FROM quiz_banks WHERE id=$1",result.corrected_bank_id)


@pytest.mark.asyncio
async def test_changed_key_with_retained_why_wrong_requires_separate_review(canonical):
    pg,engine=canonical
    await pg.c.execute("UPDATE quiz_questions SET why_wrong=$2::jsonb WHERE bank_id=$1 AND qid='ps_vspc_a1'",
        pg.old,encoded({'1':'Historical explanation for the formerly wrong option'}))
    read=await service.read_revision(engine,CODE)
    with pytest.raises(service.GrammarRevisionError) as error:
        await service.preview_revision(engine,CODE,GrammarRevisionPreviewRequest(source_markdown=SOURCE,expected_revision=read.revision))
    assert error.value.code=='grammar_question_extras_conflict' and error.value.status_code==409
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_banks')==1


@pytest.mark.asyncio
@pytest.mark.parametrize('tamper',['map','question_extra'])
async def test_corrected_readback_refuses_trigger_map_or_extra_loss_and_rolls_back(canonical,tamper):
    pg,engine=canonical
    await pg.c.execute("UPDATE quiz_questions SET why_wrong=$2::jsonb WHERE bank_id=$1 AND qid='ps_3s_b2'",
        pg.old,encoded({'0':'Preserved distractor explanation'}))
    request=await commit_request(canonical)
    if tamper=='map':
        await pg.c.execute('''CREATE FUNCTION lose_new_map() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.grammar_is_current THEN NEW.meta:=NEW.meta-'text_match_by_qid'; END IF; RETURN NEW; END $$;
          CREATE TRIGGER zzz_lose_map BEFORE INSERT ON quiz_banks FOR EACH ROW EXECUTE FUNCTION lose_new_map();''')
    else:
        await pg.c.execute('''CREATE FUNCTION lose_new_extra() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN NEW.why_wrong:=NULL; RETURN NEW; END $$;
          CREATE TRIGGER zzz_lose_extra BEFORE INSERT ON quiz_questions FOR EACH ROW EXECUTE FUNCTION lose_new_extra();''')
    with pytest.raises(service.GrammarRevisionError) as error:
        await service.commit_revision(engine,CODE,pg.actor,request)
    assert error.value.code=='grammar_corrected_readback_mismatch'
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_banks')==1
    assert await pg.c.fetchval('SELECT count(*) FROM governance_audit')==0


@pytest.mark.asyncio
@pytest.mark.parametrize('corruption',['checksum','duplicate_same','duplicate_conflicting','nested_duplicate','extra_field','missing_field','eligible_type'])
async def test_matching_corrupt_receipt_is_unavailable_never_rewritten(canonical,corruption):
    import json
    pg,engine=canonical
    request=await commit_request(canonical)
    await service.commit_revision(engine,CODE,pg.actor,request)
    raw=await pg.c.fetchval('SELECT detail FROM governance_audit')
    data=json.loads(raw)
    if corruption=='checksum': data['original_history_sha256']='f'*64
    elif corruption=='extra_field': data['unreviewed']='anything'
    elif corruption=='missing_field': del data['created_at']
    elif corruption=='eligible_type': data['cohort'][0]['eligible']=1
    if corruption.startswith('duplicate_'):
        val=data['source_sha256'] if corruption=='duplicate_same' else 'f'*64
        raw=raw[:-1]+',"source_sha256":"'+val+'"}'
    elif corruption=='nested_duplicate':
        raw=raw.replace('"eligible":true','"eligible":true,"eligible":true',1)
        assert raw!=service._json(data)
    else: raw=service._json(data)
    await pg.c.execute('ALTER TABLE governance_audit DISABLE TRIGGER grammar_quiz_receipt_guard')
    try: await pg.c.execute('UPDATE governance_audit SET detail=$1',raw)
    finally: await pg.c.execute('ALTER TABLE governance_audit ENABLE TRIGGER grammar_quiz_receipt_guard')
    for action in (lambda:service.read_revision(engine,CODE),lambda:service.commit_revision(engine,CODE,pg.actor,request)):
        with pytest.raises(service.GrammarRevisionError) as error: await action()
        assert error.value.status_code==503 and error.value.code=='grammar_receipt_unavailable'
    assert await pg.c.fetchval('SELECT detail FROM governance_audit')==raw
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_banks')==2


@pytest.mark.asyncio
async def test_reordered_pretty_receipt_replays_without_write(canonical):
    import json
    pg,engine=canonical
    request=await commit_request(canonical)
    original=await service.commit_revision(engine,CODE,pg.actor,request)
    data=json.loads(await pg.c.fetchval('SELECT detail FROM governance_audit'))
    raw=json.dumps(dict(reversed(list(data.items()))),ensure_ascii=False,indent=2)
    await pg.c.execute('ALTER TABLE governance_audit DISABLE TRIGGER grammar_quiz_receipt_guard')
    try: await pg.c.execute('UPDATE governance_audit SET detail=$1',raw)
    finally: await pg.c.execute('ALTER TABLE governance_audit ENABLE TRIGGER grammar_quiz_receipt_guard')
    replay=await service.commit_revision(engine,CODE,pg.actor,request)
    assert replay.outcome=='already_applied' and replay.corrected_bank_id==original.corrected_bank_id
    assert await pg.c.fetchval('SELECT detail FROM governance_audit')==raw


@pytest.mark.asyncio
async def test_actor_bound_and_disabled_canonical_fk_gate_fail_before_mutation(canonical):
    from uuid import uuid4
    pg,engine=canonical
    # Cap+1 actor admissions must not be truncated into a publishable cohort.
    for _ in range(129):
        actor=uuid4()
        await pg.c.execute('INSERT INTO users VALUES($1)',actor)
        await pg.c.execute('INSERT INTO quiz_sessions(user_id,bank_id,code) VALUES($1,$2,$3)',actor,pg.old,CODE)
    with pytest.raises(service.GrammarRevisionError) as error: await service.read_revision(engine,CODE)
    assert error.value.code=='grammar_footprint_limit_exceeded'
    await pg.c.execute('ALTER TABLE users DISABLE TRIGGER grammar_quiz_account_erasure_gate')
    with pytest.raises(service.GrammarRevisionError) as error: await service.read_revision(engine,CODE)
    assert error.value.code=='grammar_storage_guard_unavailable'
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_banks')==1
    assert await pg.c.fetchval('SELECT count(*) FROM governance_audit')==0


@pytest.mark.asyncio
@pytest.mark.parametrize('operation',['account_erasure','old_direct_start','old_direct_reset','mapped_start_without_ack','mapped_start_with_ack'])
async def test_actual_cutover_serializes_owner_erasure_and_old_direct_start(canonical,operation,monkeypatch):
    """Pause the real publication after its exclusive gate, before new-bank INSERT."""
    import asyncio
    import asyncpg
    from uuid import uuid4
    pg,engine=canonical
    if operation=='old_direct_reset':
        item_key=await pg.c.fetchval('SELECT item_key FROM quiz_questions WHERE bank_id=$1 ORDER BY "order" LIMIT 1',pg.old)
        await pg.c.execute('''INSERT INTO quiz_word_stats(user_id,bank_id,last_session_id,item_key,skills_passed)
          VALUES($1,$2,$3,$4,'[]')''',pg.user,pg.old,pg.predecessor,item_key)
    request=await commit_request(canonical)
    preview=await service.preview_revision(engine,CODE,GrammarRevisionPreviewRequest(
        source_markdown=request.source_markdown,expected_revision=request.expected_revision))
    known_new=uuid4()
    allocated=False
    def owned_uuid():
        nonlocal allocated
        if not allocated:
            allocated=True
            return known_new
        return uuid4()
    monkeypatch.setattr(service,'uuid4',owned_uuid)
    worker=await pg.connection()
    latch=int.from_bytes(uuid4().bytes[:7],'big')
    label=pg.schema+'_publish'
    tasks=[]
    try:
        await pg.c.execute(f'''CREATE FUNCTION pause_reviewed_cutover() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.grammar_canonical_code IS NOT NULL THEN
            PERFORM set_config('application_name','{label}',true);
            PERFORM pg_advisory_xact_lock({latch}); END IF; RETURN NEW; END $$;
          CREATE TRIGGER zzz_pause_reviewed_cutover BEFORE INSERT ON quiz_banks
          FOR EACH ROW EXECUTE FUNCTION pause_reviewed_cutover();''')
        await pg.c.execute('SELECT pg_advisory_lock($1::bigint)',latch)
        publishing=asyncio.create_task(service.commit_revision(engine,CODE,pg.actor,request))
        tasks.append(publishing)
        for _ in range(100):
            paused=await pg.c.fetchval('''SELECT EXISTS(SELECT 1 FROM pg_locks l
              JOIN pg_stat_activity a USING(pid) WHERE a.application_name=$1
              AND l.locktype='advisory' AND NOT l.granted)''',label)
            if paused: break
            await asyncio.sleep(.01)
        assert paused and not publishing.done()
        if operation=='account_erasure':
            waiting=asyncio.create_task(worker.execute('DELETE FROM users WHERE id=$1',pg.user))
        elif operation=='old_direct_start':
            waiting=asyncio.create_task(worker.execute('''INSERT INTO quiz_sessions(user_id,bank_id,code)
              VALUES($1,$2,$3)''',pg.user,pg.old,CODE))
        elif operation=='old_direct_reset':
            waiting=asyncio.create_task(worker.execute('DELETE FROM quiz_word_stats WHERE user_id=$1 AND bank_id=$2',pg.user,pg.old))
        else:
            args=[pg.user,known_new,preview.proposed_revision,None]
            if operation=='mapped_start_with_ack': args.append('qid-exact-v1')
            waiting=asyncio.create_task(pg.rpc('grammar_quiz_start_service',*args,connection=worker))
        tasks.append(waiting)
        for _ in range(100):
            blocked=await pg.c.fetchval('''SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1
              AND locktype='advisory' AND NOT granted)''',worker.get_server_pid())
            if blocked: break
            await asyncio.sleep(.01)
        assert blocked and not waiting.done()
        # The account-delete statement gate is before its parent tuple lock.
        assert await pg.c.fetchval('SELECT id FROM users WHERE id=$1 FOR KEY SHARE NOWAIT',pg.user)==pg.user
        await pg.c.execute('SELECT pg_advisory_unlock($1::bigint)',latch)
        committed=await asyncio.wait_for(publishing,3)
        assert committed.outcome=='applied'
        if operation=='account_erasure':
            await asyncio.wait_for(waiting,3)
            assert await pg.c.fetchval('SELECT count(*) FROM quiz_sessions WHERE user_id=$1',pg.user)==0
            # Erasure must not recreate or edit the receipt/cohort proof.
            receipt=await pg.c.fetchval('SELECT detail FROM governance_audit')
            assert str(pg.user) in receipt
        elif operation=='old_direct_start':
            with pytest.raises(asyncpg.PostgresError,match='grammar_managed_write_required'):
                await asyncio.wait_for(waiting,3)
            assert await pg.c.fetchval('SELECT count(*) FROM quiz_sessions')==1
        elif operation=='old_direct_reset':
            with pytest.raises(asyncpg.PostgresError,match='grammar_managed_progress_retained'):
                await asyncio.wait_for(waiting,3)
            assert await pg.c.fetchval('SELECT count(*) FROM quiz_word_stats')==1
        elif operation=='mapped_start_without_ack':
            with pytest.raises(asyncpg.PostgresError,match='grammar_text_match_policy_required'):
                await asyncio.wait_for(waiting,3)
            assert await pg.c.fetchval('SELECT count(*) FROM quiz_sessions')==1
        else:
            admitted=await asyncio.wait_for(waiting,3)
            assert admitted['grammar']['bank_id']==str(known_new)
            assert admitted['grammar']['text_match_policy']=='qid-exact-v1'
            assert await pg.c.fetchval('SELECT count(*) FROM quiz_sessions')==2
        assert await pg.c.fetchval('SELECT count(*) FROM quiz_banks')==2
        assert await pg.c.fetchval('SELECT count(*) FROM governance_audit')==1
        assert await pg.c.fetchval('SELECT count(*) FROM quiz_questions')==62
    finally:
        await pg.c.execute('SELECT pg_advisory_unlock($1::bigint)',latch)
        for task in tasks:
            if not task.done(): task.cancel()
            try: await task
            except BaseException: pass
        await worker.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('corruption',['duplicate_refs','ref_not_uuid','ref_cap','foreign_owner_duplicate',
    'foreign_owner_scalar','classification_mismatch','unknown_owner_field','wrong_live_owner',
    'missing_live_reference','predecessor_not_declared','owner_cap','cumulative_ref_cap','cross_owner_ref_duplicate'])
async def test_actual_full_retained_cohort_structural_corruption_unavailable_even_with_valid_checksum(canonical,corruption):
    import json
    pg,engine=canonical
    request=await commit_request(canonical)
    await service.commit_revision(engine,CODE,pg.actor,request)
    proof=json.loads(await pg.c.fetchval('SELECT detail FROM governance_audit'))
    owner=proof['cohort'][0]
    if corruption=='duplicate_refs': owner['session_ids'].append(owner['session_ids'][0])
    elif corruption=='ref_not_uuid': owner['attempt_ids']=['not-an-owned-id']
    elif corruption=='ref_cap': owner['session_ids']=[owner['session_ids'][0]]*2049
    elif corruption=='foreign_owner_duplicate':
        from uuid import uuid4
        other={**owner,'user_id':str(uuid4())}
        proof['cohort'] += [other,other]
    elif corruption=='foreign_owner_scalar': proof['cohort'].append('unknown')
    elif corruption=='classification_mismatch': owner['eligible']=False
    elif corruption=='unknown_owner_field': owner['unknown']='unapproved proof field'
    elif corruption=='wrong_live_owner': owner['user_id']=str(pg.other)
    elif corruption=='missing_live_reference':
        from uuid import uuid4
        owner['attempt_ids']=[str(uuid4())]
    elif corruption=='predecessor_not_declared': owner['session_ids']=[]
    else:
        from uuid import uuid4
        def erased_owner(stat_count=0):
            predecessor=str(uuid4())
            return {'user_id':str(uuid4()),'eligible':True,'classification':'provably_unfinished_paused',
                'predecessor_session_id':predecessor,'session_ids':[predecessor],
                'stat_ids':[str(uuid4()) for _ in range(stat_count)],'attempt_ids':[]}
        if corruption=='owner_cap': proof['cohort'] += [erased_owner() for _ in range(128)]
        elif corruption=='cumulative_ref_cap': proof['cohort'] += [erased_owner(4096),erased_owner(4097)]
        else:
            first,second=erased_owner(1),erased_owner(1)
            second['stat_ids']=first['stat_ids'][:]
            proof['cohort'] += [first,second]
    proof['integrity_sha256']=await pg.c.fetchval("SELECT encode(sha256(convert_to(($1::jsonb-'integrity_sha256')::text,'UTF8')),'hex')",encoded(proof))
    await pg.c.execute('ALTER TABLE governance_audit DISABLE TRIGGER grammar_quiz_receipt_guard')
    await pg.c.execute('UPDATE governance_audit SET detail=$1',encoded(proof))
    await pg.c.execute('ALTER TABLE governance_audit ENABLE TRIGGER grammar_quiz_receipt_guard')
    before=await pg.c.fetchval('SELECT count(*) FROM quiz_sessions')
    import asyncpg
    with pytest.raises(asyncpg.PostgresError,match='grammar_cutover_receipt_invalid'):
        await pg.start()
    current=await pg.c.fetchval('SELECT id FROM quiz_banks WHERE grammar_is_current')
    revision=await pg.c.fetchval('SELECT grammar_revision FROM quiz_banks WHERE id=$1',current)
    for operation,args in [('grammar_quiz_state',[pg.user,current]),
        ('grammar_quiz_start_service',[pg.user,current,revision,None,'qid-exact-v1'])]:
        with pytest.raises(asyncpg.PostgresError,match='grammar_cutover_receipt_invalid'):
            await pg.rpc(operation,*args)
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_sessions')==before
    with pytest.raises(service.GrammarRevisionError) as error:
        await service.read_revision(engine,CODE)
    assert error.value.status_code==503


@pytest.mark.asyncio
async def test_current_missing_receipt_blocks_state_and_start_before_insertion(pg):
    import asyncpg
    await pg.enroll(receipt=False)
    before=await pg.c.fetchval('SELECT count(*) FROM quiz_sessions')
    for operation,args in [('grammar_quiz_state',[pg.user,pg.new]),
        ('grammar_quiz_start_service',[pg.user,pg.new,pg.new_revision,None])]:
        with pytest.raises(asyncpg.PostgresError,match='grammar_cutover_proof_unavailable'):
            await pg.rpc(operation,*args)
        assert await pg.c.fetchval('SELECT count(*) FROM quiz_sessions')==before


@pytest.mark.asyncio
async def test_full_real_receipt_envelope_all_consumers_no_writes_and_owned_terminal_null(canonical):
    """The independent 31-case matrix plus recomputed/raw siblings, actual PG."""
    import copy
    import json
    from uuid import UUID
    pg,engine=canonical
    request=await commit_request(canonical)
    result=await service.commit_revision(engine,CODE,pg.actor,request)
    current=result.corrected_bank_id
    revision=await pg.c.fetchval('SELECT grammar_revision FROM quiz_banks WHERE id=$1',current)
    old=await pg.rpc('grammar_quiz_start_service',pg.user,pg.old,None,None)
    new=await pg.rpc('grammar_quiz_start_service',pg.user,current,revision,None,'qid-exact-v1')
    await pg.rpc('grammar_quiz_end_service',pg.user,pg.predecessor,encoded({'ended_by':'paused'}))
    full=json.loads(await pg.c.fetchval('SELECT detail FROM governance_audit'))
    assert len(full)==21 and set(full)==set(service._Receipt.model_fields)
    calls=[('grammar_quiz_state',(pg.user,pg.old)),('grammar_quiz_state',(pg.user,current)),
        ('grammar_quiz_start_service',(pg.user,pg.old,None,None)),
        ('grammar_quiz_start_service',(pg.user,current,revision,None,'qid-exact-v1')),
        ('grammar_quiz_progress_service',(pg.user,UUID(old['session_id']),'[]','[]')),
        ('grammar_quiz_progress_service',(pg.user,UUID(new['session_id']),'[]','[]')),
        ('grammar_quiz_reset_service',(pg.user,current)),
        ('grammar_quiz_end_service',(pg.user,UUID(old['session_id']),encoded({'ended_by':'paused'}))),
        ('grammar_quiz_end_service',(pg.user,UUID(new['session_id']),encoded({'ended_by':'paused'})))]
    async def snapshot():
        return {table:await pg.c.fetchval(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text FROM {table} t")
            for table in ('quiz_banks','quiz_questions','quiz_sessions','quiz_attempts','quiz_word_stats','governance_audit')}
    mutations=[]
    for key in ('operation_id','created_at','source_sha256','manifest_sha256','payload_sha256','expected_revision',
        'preview_fingerprint','committed_revision','topic_id','original_questions_sha256','original_metadata_sha256','original_history_sha256'):
        data=copy.deepcopy(full);del data[key];mutations.append(('missing_'+key,data))
    for key,value in [('schema_version',1.0),('operation_id','invalid'),('operation_id',17),('created_at',{}),
        ('created_at','2026-02-31T12:00:00+00:00'),('created_at','2026-10-01T12:00:00+99:00'),
        ('source_sha256','f'*64),('source_sha256',17),('manifest_sha256','f'*64),('payload_sha256','f'*64),
        ('expected_revision','f'*64),('preview_fingerprint','f'*64),('topic_id',str(pg.other)),
        ('original_questions_sha256','f'*64),('original_metadata_sha256','f'*64),('original_history_sha256',True),
        ('committed_revision',False),('committed_revision','f'*64)]:
        data=copy.deepcopy(full);data[key]=value;mutations.append(('changed_'+key,data))
    extra=copy.deepcopy(full);extra['unapproved_field']='must refuse';mutations.append(('extra',extra))
    mutations.append(('missing_receipt',None))
    for key in ('expected_revision','preview_fingerprint','committed_revision'):
        data=copy.deepcopy(full);data[key]='f'*64
        data['payload_sha256']=service._payload_hash(CODE,data['source_sha256'],data['expected_revision'],data['preview_fingerprint'],data['operation_id'])
        mutations.append(('recomputed_'+key,data))
    for label in ('raw_schema_exponent','raw_duplicate_top','raw_duplicate_nested'):
        mutations.append((label,copy.deepcopy(full)))
    for label,data in mutations:
        if data is None: raw=None
        else:
            data['integrity_sha256']=await pg.c.fetchval("SELECT encode(sha256(convert_to(($1::jsonb-'integrity_sha256')::text,'UTF8')),'hex')",encoded(data))
            raw=encoded(data)
            if label=='raw_schema_exponent':
                rewritten=raw.replace('"schema_version": 1','"schema_version": 1e0');assert raw!=rewritten;raw=rewritten
            elif label=='raw_duplicate_top':
                raw='{"operation_id": "'+str(full['operation_id'])+'",'+raw[1:]
            elif label=='raw_duplicate_nested':
                rewritten=raw.replace('"eligible": true','"eligible": true,"eligible": true',1);assert raw!=rewritten;raw=rewritten
        await pg.c.execute('ALTER TABLE governance_audit DISABLE TRIGGER grammar_quiz_receipt_guard')
        try:
            if raw is None: await pg.c.execute('DELETE FROM governance_audit')
            elif await pg.c.fetchval('SELECT count(*) FROM governance_audit'): await pg.c.execute('UPDATE governance_audit SET detail=$1',raw)
            else: await pg.c.execute("INSERT INTO governance_audit(action,admin_id,detail) VALUES('grammar_quiz_revision_cutover',$1,$2)",pg.actor,raw)
        finally: await pg.c.execute('ALTER TABLE governance_audit ENABLE TRIGGER grammar_quiz_receipt_guard')
        before=await snapshot()
        for name,args in calls:
            transaction=pg.c.transaction();await transaction.start()
            try:
                with pytest.raises(Exception,match='grammar_cutover_(receipt_invalid|proof_unavailable)'):
                    await pg.rpc(name,*args)
            finally: await transaction.rollback()
            assert await snapshot()==before,(label,name)
        for action in [lambda:service.read_revision(engine,CODE),
            lambda:service.preview_revision(engine,CODE,GrammarRevisionPreviewRequest(source_markdown=SOURCE,expected_revision=result.current_revision)),
            lambda:service.commit_revision(engine,CODE,pg.actor,request)]:
            with pytest.raises(service.GrammarRevisionError) as error: await action()
            assert error.value.status_code==503 and error.value.code=='grammar_receipt_unavailable',label
        terminal=await pg.rpc('grammar_quiz_end_service',pg.user,pg.predecessor,encoded({'ended_by':'completed'}))
        assert terminal['grammar_revision'] is None and 'grammar' not in terminal
        assert await snapshot()==before,label


@pytest.mark.asyncio
@pytest.mark.parametrize('initial',[False,True])
@pytest.mark.parametrize('zone',['UTC','America/New_York'])
async def test_full_receipt_utc_evidence_two_preimages_pause_erasure_and_pretty_replay(canonical,initial,zone):
    import json
    pg,engine=canonical
    await pg.c.execute("SELECT set_config('TimeZone',$1,false)",zone)
    # Startup parameter changes only this engine/session; no implicit connect
    # transaction before the real owner's SET TRANSACTION isolation boundary.
    zoned_engine=canonical_engine(pg,timezone=zone)
    try:
        await _receipt_timezone_controls(pg,zoned_engine,initial)
    finally: await zoned_engine.dispose()


async def _receipt_timezone_controls(pg,engine,initial):
    import json
    canonical=(pg,engine)
    await pg.c.execute('UPDATE quiz_banks SET grammar_new_starts_enabled=$2 WHERE id=$1',pg.old,initial)
    await pg.c.execute('INSERT INTO quiz_sessions(user_id,bank_id,code) VALUES($1,$2,$3)',pg.other,pg.old,CODE)
    request=await commit_request(canonical)
    result=await service.commit_revision(engine,CODE,pg.actor,request)
    raw=await pg.c.fetchval('SELECT detail FROM governance_audit');full=json.loads(raw)
    assert len(full)==21
    for target in (pg.old,result.corrected_bank_id):
        async with pg.c.transaction():
            await pg.c.execute("SELECT set_config('aver.grammar_quiz_context',$1,true)",encoded({'action':'pause_starts','code':CODE,'bank':str(target)}))
            await pg.c.execute('UPDATE quiz_banks SET grammar_new_starts_enabled=false WHERE id=$1',target)
    await pg.c.execute('DELETE FROM users WHERE id=$1',pg.other)
    # Audit107's actor has no FK and remains valid after canonical actor erasure.
    await pg.c.execute('DELETE FROM users WHERE id=$1',pg.actor)
    await pg.rpc('grammar_quiz_state',pg.user,pg.old)
    await pg.rpc('grammar_quiz_state',pg.user,result.corrected_bank_id)
    with pytest.raises(Exception,match='grammar_session_not_owned'):
        await pg.rpc('grammar_quiz_start_service',pg.other,pg.old,None,None)
    pretty=json.dumps(dict(reversed(list(full.items()))),ensure_ascii=False,indent=2)
    await pg.c.execute('ALTER TABLE governance_audit DISABLE TRIGGER grammar_quiz_receipt_guard')
    try:await pg.c.execute('UPDATE governance_audit SET detail=$1',pretty)
    finally:await pg.c.execute('ALTER TABLE governance_audit ENABLE TRIGGER grammar_quiz_receipt_guard')
    # The private producer projection stays UTC even when the engine and RPC
    # session have different non-UTC representations of the same instants.
    for tz in ('Asia/Ho_Chi_Minh','UTC'):
        await pg.c.execute("SELECT set_config('TimeZone',$1,false)",tz)
        await pg.rpc('grammar_quiz_state',pg.user,result.corrected_bank_id)
        replay=await service.commit_revision(engine,CODE,pg.actor,request)
        assert replay.outcome=='already_applied' and replay.committed_revision==full['committed_revision']
        assert replay.current_matches_committed is False
        assert await pg.c.fetchval('SELECT detail FROM governance_audit')==pretty


@pytest.mark.asyncio
async def test_private_evidence_json_exact_decimal_key_order_unicode_and_grants(pg):
    from decimal import Decimal
    import json
    value={'z':'quote" slash\\ controls\b\f\n\r\t\x01\x1f','aa':Decimal('0.123456789012345678901234567890'),
        'a':Decimal('9007199254740993.01'),'é':{'界':'😃\u2028\u2029','A':[True,None,Decimal('1.000'),Decimal('0.0000000000000001')]}}
    expected=service._json(value)
    actual=await pg.c.fetchval('SELECT grammar_quiz_evidence_json($1::jsonb)',expected)
    assert actual==expected
    assert await pg.c.fetchval('SELECT grammar_quiz_evidence_hash($1::jsonb)',expected)==service._hash(value)
    for code in REVIEWED_SOURCES:
        raw=(Path(__file__).parents[2]/'docs/grammar-quiz-banks'/(code+'.md')).read_text()
        source=parse_reviewed_source(code,raw)
        binding=json.loads(await pg.c.fetchval('SELECT grammar_quiz_audit_binding($1,$2)',code,source.raw_sha256))
        assert binding['metadata']==source.metadata and binding['manifest_sha256']==source.manifest_sha256
        assert binding['source_sha256']==source.raw_sha256
    for role in pg.roles.values():
        for signature in ('grammar_quiz_evidence_json(jsonb)','grammar_quiz_evidence_hash(jsonb)',
            'grammar_quiz_reviewed_binding(text)','grammar_quiz_validate_receipt_envelope(jsonb,uuid,uuid)'):
            assert not await pg.c.fetchval('SELECT has_function_privilege($1,$2,\'EXECUTE\')',role,pg.schema+'.'+signature)


@pytest.mark.asyncio
@pytest.mark.parametrize('managed',[False,True])
async def test_stale_private_validator_schema_blocks_admin_read_preview_commit_before_write(canonical,managed):
    pg,engine=canonical
    request=await commit_request(canonical)
    if managed: await service.commit_revision(engine,CODE,pg.actor,request)
    before=await pg.c.fetchval("SELECT jsonb_build_object('banks',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM quiz_banks b),'questions',(SELECT jsonb_agg(to_jsonb(q) ORDER BY id) FROM quiz_questions q),'receipt',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM governance_audit a))::text")
    await pg.c.execute('ALTER FUNCTION grammar_quiz_validate_receipt_envelope(jsonb,uuid,uuid) RENAME TO unavailable_receipt_validator')
    try:
        for call in [lambda:service.read_revision(engine,CODE),
            lambda:service.preview_revision(engine,CODE,GrammarRevisionPreviewRequest(source_markdown=SOURCE,expected_revision=request.expected_revision)),
            lambda:service.commit_revision(engine,CODE,pg.actor,request)]:
            with pytest.raises(service.GrammarRevisionError) as error: await call()
            assert error.value.status_code==503 and error.value.code=='grammar_storage_guard_unavailable'
        assert await pg.c.fetchval("SELECT jsonb_build_object('banks',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM quiz_banks b),'questions',(SELECT jsonb_agg(to_jsonb(q) ORDER BY id) FROM quiz_questions q),'receipt',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM governance_audit a))::text")==before
    finally:
        await pg.c.execute('ALTER FUNCTION unavailable_receipt_validator(jsonb,uuid,uuid) RENAME TO grammar_quiz_validate_receipt_envelope')
