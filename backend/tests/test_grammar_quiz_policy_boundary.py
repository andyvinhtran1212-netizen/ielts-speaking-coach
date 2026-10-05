"""Actual isolated PostgreSQL admission/reset controls, never live publication."""
import asyncio
import json
from uuid import UUID, uuid4

import asyncpg
import pytest

from services.grammar_quiz_policy import CANONICAL_CODES
from test_grammar_quiz_revision_boundary import pg, encoded, CODE


async def start_mapped(pg, *, kind=None, user=None):
    return await pg.rpc('grammar_quiz_start_service',user or pg.user,pg.new,pg.new_revision,kind,'qid-exact-v1')


async def pause(pg):
    async with pg.c.transaction():
        await pg.c.execute("SELECT set_config('aver.grammar_quiz_context',$1,true)",
            encoded({'action':'pause_starts','code':pg.code,'bank':str(pg.new)}))
        await pg.c.execute('UPDATE quiz_banks SET grammar_new_starts_enabled=false WHERE id=$1',pg.new)


@pytest.mark.asyncio
async def test_exact_twelve_code_allowlist_and_private_validation_grants(pg):
    for code in CANONICAL_CODES:
        assert await pg.c.fetchval('SELECT grammar_quiz_allowed_code($1)',code) is True
    assert await pg.c.fetchval("SELECT grammar_quiz_allowed_code('G-unapproved')") is False
    for role in pg.roles.values():
        assert not await pg.c.fetchval("SELECT has_function_privilege($1,$2,'EXECUTE')",role,
            pg.schema+'.grammar_quiz_text_policy(uuid)')
    service=pg.roles['service_role']
    for signature in ('uuid,uuid,text,text','uuid,uuid,text,text,text'):
        assert await pg.c.fetchval("SELECT has_function_privilege($1,$2,'EXECUTE')",service,
            pg.schema+'.grammar_quiz_start_service('+signature+')')


@pytest.mark.asyncio
@pytest.mark.parametrize('code',[CODE,'G-grammar-for-reading-participle-clauses'])
async def test_real_stored_map_requires_ack_in_both_arities_before_insert(pg,code):
    await pg.enroll(code=code)
    actual_policy=json.loads(await pg.c.fetchval("SELECT meta->'text_match_by_qid' FROM quiz_banks WHERE id=$1",pg.new))
    initial=await pg.c.fetchval('SELECT count(*) FROM quiz_sessions')
    for args in [(pg.user,pg.new,pg.new_revision,None),
                 (pg.user,pg.new), (pg.user,pg.new,pg.new_revision),
                 (pg.user,pg.new,pg.new_revision,None,None),
                 (pg.user,pg.new,pg.new_revision,'review',None)]:
        with pytest.raises(asyncpg.PostgresError,match='grammar_text_match_policy_required'):
            await pg.rpc('grammar_quiz_start_service',*args)
    with pytest.raises(asyncpg.PostgresError,match='grammar_text_match_policy_invalid'):
        await pg.rpc('grammar_quiz_start_service',pg.user,pg.new,pg.new_revision,None,'unknown')
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_sessions')==initial
    state=await start_mapped(pg)
    assert state['grammar']['bank_id']==str(pg.new)
    assert state['grammar']['text_match_policy']=='qid-exact-v1'
    assert await pg.c.fetchval("SELECT meta->'text_match_by_qid'=$2::jsonb FROM quiz_banks WHERE id=$1",
        pg.new,encoded(actual_policy))
    review=await start_mapped(pg,kind='review')
    with pytest.raises(asyncpg.PostgresError,match='grammar_review_read_only'):
        await pg.progress(review['session_id'])


@pytest.mark.asyncio
@pytest.mark.parametrize('policy',[None,{}])
async def test_absent_empty_map_preserves_four_arg_and_redundant_ack(pg,policy):
    await pg.enroll(code='G-grammar-for-reading-long-sentence-untangling',**({'policy':policy} if policy is not None else {}))
    legacy=await pg.start()
    current=await pg.start(current=True)
    redundant=await start_mapped(pg)
    for result in (legacy,current,redundant):
        assert 'text_match_policy' not in result['grammar']
    assert legacy['grammar']['bank_id']==str(pg.old)
    assert legacy['grammar']['current_bank_id']==str(pg.new)
    default=await pg.rpc('grammar_quiz_start_service',pg.user,pg.old)
    assert 'text_match_policy' not in default['grammar']
    assert default['grammar']['bank_id']==str(pg.old)


@pytest.mark.asyncio
@pytest.mark.parametrize('policy',[None,[],True,1,'exact',{'production':None},{'production':True},
    {'production':'EXACT'},{'missing':'exact'},{'recognition':'exact'},{'__proto__':'exact'},
    {'production':{'nested':'exact'}}])
async def test_invalid_persisted_map_is_unavailable_and_creates_zero_sessions(pg,policy):
    # Synthetic invalid persisted data is inserted by the owned fixture only;
    # production APIs cannot edit the immutable managed bank.
    await pg.enroll(policy=policy)
    initial=await pg.c.fetchval('SELECT count(*) FROM quiz_sessions')
    with pytest.raises(asyncpg.PostgresError,match='grammar_text_policy_unavailable'):
        await pg.c.fetchval('SELECT grammar_quiz_text_policy($1)',pg.new)
    with pytest.raises(asyncpg.PostgresError,match='grammar_cutover_receipt_invalid'):
        await start_mapped(pg)
    with pytest.raises(asyncpg.PostgresError,match='grammar_cutover_receipt_invalid'):
        await pg.rpc('grammar_quiz_state',pg.user,pg.new)
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_sessions')==initial


@pytest.mark.asyncio
async def test_direct_old_server_context_cannot_bypass_mapped_ack(pg):
    await pg.enroll()
    async with pg.c.transaction():
        await pg.c.execute("SELECT set_config('aver.grammar_quiz_context',$1,true)",encoded({
            'action':'start','actor':str(pg.user),'bank':str(pg.new),'code':CODE,'admission_kind':'run'}))
        with pytest.raises(asyncpg.PostgresError,match='grammar_text_match_policy_required'):
            await pg.c.execute('''INSERT INTO quiz_sessions(user_id,bank_id,code,grammar_revision,grammar_admission_kind)
              SELECT $1,id,code,grammar_revision,'run' FROM quiz_banks WHERE id=$2''',pg.user,pg.new)


@pytest.mark.asyncio
@pytest.mark.parametrize('ending',[None,'paused','time_cap'])
async def test_paused_corrected_reload_derives_unmarked_run_not_newer_review(pg,ending):
    await pg.enroll()
    first=await start_mapped(pg)
    await pg.progress(first['session_id'])
    if ending:
        await pg.rpc('grammar_quiz_end_service',pg.user,UUID(first['session_id']),encoded({'ended_by':ending}))
    review=await start_mapped(pg,kind='review')
    await pause(pg)
    state=await pg.rpc('grammar_quiz_state',pg.user,pg.new)
    assert state['new_starts_enabled'] is False and state['can_continue_current'] is True
    continuation=await start_mapped(pg)
    row=await pg.c.fetchrow('SELECT grammar_admission_kind,grammar_predecessor_session_id FROM quiz_sessions WHERE id=$1',UUID(continuation['session_id']))
    assert tuple(row)==('continuation',UUID(first['session_id']))
    assert row['grammar_predecessor_session_id']!=UUID(review['session_id'])
    for user,kind,revision in [(pg.other,None,pg.new_revision),(pg.user,'review',pg.new_revision),(pg.user,None,'f'*64)]:
        with pytest.raises(asyncpg.PostgresError,match='grammar_(new_starts_paused|content_revised)'):
            await pg.rpc('grammar_quiz_start_service',user,pg.new,revision,kind,'qid-exact-v1')


@pytest.mark.asyncio
async def test_reset_marks_open_lost_ack_all_admissions_and_stale_progress_zero_writes(pg):
    await pg.enroll()
    first,orphan,review=await start_mapped(pg),await start_mapped(pg),await start_mapped(pg,kind='review')
    other=await start_mapped(pg,user=pg.other)
    await pg.progress(first['session_id'],complete=True)
    before=await pg.c.fetchval('SELECT grammar_mastery_completed_at FROM quiz_sessions WHERE id=$1',UUID(first['session_id']))
    await pg.rpc('grammar_quiz_reset_service',pg.user,pg.new)
    marks=await pg.c.fetch('SELECT id,grammar_reset_at,ended_at FROM quiz_sessions WHERE user_id=$1 AND bank_id=$2',pg.user,pg.new)
    assert len(marks)==3 and all(row['grammar_reset_at'] is not None and row['ended_at'] is None for row in marks)
    assert len({row['grammar_reset_at'] for row in marks})==1
    assert await pg.c.fetchval('SELECT grammar_reset_at FROM quiz_sessions WHERE id=$1',UUID(other['session_id'])) is None
    assert await pg.c.fetchval('SELECT grammar_mastery_completed_at FROM quiz_sessions WHERE id=$1',UUID(first['session_id']))==before
    await pause(pg)
    with pytest.raises(asyncpg.PostgresError,match='grammar_new_starts_paused'):
        await start_mapped(pg)
    for s in (first,orphan,review):
        with pytest.raises(asyncpg.PostgresError,match='grammar_reset_stale'):
            await pg.progress(s['session_id'],attempts=[{'client_id':str(uuid4()),'qid':'recognition',
                'item_key':'item','skill':'recognition','type':'mcq','is_correct':True}])
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_attempts WHERE bank_id=$1',pg.new)==0
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_word_stats WHERE bank_id=$1',pg.new)==0
    final=await pg.rpc('grammar_quiz_end_service',pg.user,UUID(orphan['session_id']),encoded({'ended_by':'paused'}))
    retry=await pg.rpc('grammar_quiz_end_service',pg.user,UUID(orphan['session_id']),encoded({'ended_by':'completed','total_questions':9}))
    assert {k:v for k,v in final.items() if k!='grammar'}==retry
    assert retry['grammar_reset_at'] is not None and 'grammar' not in retry
    with pytest.raises(asyncpg.PostgresError,match='grammar_reset_stale'):
        await pg.progress(orphan['session_id'])
    assert (await pg.rpc('grammar_quiz_state',pg.user,pg.new))['can_continue_current'] is False


@pytest.mark.asyncio
async def test_new_post_reset_group_can_continue_without_old_completion_fence(pg):
    await pg.enroll()
    first=await pg.start(current=True)
    await pg.progress(first['session_id'],complete=True)
    await pg.rpc('grammar_quiz_reset_service',pg.user,pg.new)
    fresh=await pg.start(current=True)
    await pg.progress(fresh['session_id'])
    await pause(pg)
    continued=await pg.start(current=True)
    assert await pg.c.fetchval('SELECT grammar_predecessor_session_id FROM quiz_sessions WHERE id=$1',UUID(continued['session_id']))==UUID(fresh['session_id'])
    await pg.progress(continued['session_id'],complete=True)
    with pytest.raises(asyncpg.PostgresError,match='grammar_new_starts_paused'):
        await pg.start(current=True)


@pytest.mark.asyncio
async def test_reset_marker_direct_clear_change_and_wrong_owner_are_blocked(pg):
    await pg.enroll()
    first=await pg.start(current=True)
    await pg.rpc('grammar_quiz_reset_service',pg.user,pg.new)
    mark=await pg.c.fetchval('SELECT grammar_reset_at FROM quiz_sessions WHERE id=$1',UUID(first['session_id']))
    for actor,value in [(pg.user,'NULL'),(pg.user,"'2000-01-01'::timestamptz"),(pg.other,'transaction_timestamp()')]:
        async with pg.c.transaction():
            await pg.c.execute("SELECT set_config('aver.grammar_quiz_context',$1,true)",encoded({
                'action':'reset','actor':str(actor),'bank':str(pg.new),'code':CODE}))
            with pytest.raises(asyncpg.PostgresError,match='grammar_'):
                await pg.c.execute('UPDATE quiz_sessions SET grammar_reset_at='+value+' WHERE id=$1',UUID(first['session_id']))
    assert await pg.c.fetchval('SELECT grammar_reset_at FROM quiz_sessions WHERE id=$1',UUID(first['session_id']))==mark


@pytest.mark.asyncio
async def test_repeat_reset_preserves_old_mark_and_marks_newly_prior_admission(pg):
    await pg.enroll()
    prior=await pg.start(current=True)
    await pg.rpc('grammar_quiz_reset_service',pg.user,pg.new)
    marked_before=await pg.c.fetchrow('SELECT * FROM quiz_sessions WHERE id=$1',UUID(prior['session_id']))
    fresh=await pg.start(current=True)
    await pg.progress(fresh['session_id'])
    await pg.rpc('grammar_quiz_reset_service',pg.user,pg.new)
    assert await pg.c.fetchrow('SELECT * FROM quiz_sessions WHERE id=$1',UUID(prior['session_id']))==marked_before
    mark=await pg.c.fetchval('SELECT grammar_reset_at FROM quiz_sessions WHERE id=$1',UUID(fresh['session_id']))
    assert mark is not None and mark>marked_before['grammar_reset_at']
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_word_stats WHERE bank_id=$1',pg.new)==0


@pytest.mark.asyncio
async def test_reset_marker_and_stats_delete_roll_back_together(pg):
    await pg.enroll()
    first=await pg.start(current=True)
    await pg.progress(first['session_id'])
    await pg.c.execute('''CREATE FUNCTION reject_reset_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic reset failure'; END $$;
      CREATE TRIGGER zzz_reject_reset_delete BEFORE DELETE ON quiz_word_stats FOR EACH ROW EXECUTE FUNCTION reject_reset_delete();''')
    with pytest.raises(asyncpg.PostgresError,match='synthetic reset failure'):
        await pg.rpc('grammar_quiz_reset_service',pg.user,pg.new)
    assert await pg.c.fetchval('SELECT grammar_reset_at FROM quiz_sessions WHERE id=$1',UUID(first['session_id'])) is None
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_word_stats WHERE bank_id=$1',pg.new)==len({q['item_key'] for q in pg.questions})


@pytest.mark.asyncio
async def test_python_29_whitespace_and_feff_accept_eligibility_parity(pg):
    whitespace=[chr(n) for n in range(0x110000) if chr(n).isspace()]
    assert len(whitespace)==29
    for ch in whitespace:
        assert await pg.c.fetchval('SELECT grammar_quiz_python_strip($1)',ch)==''
    assert await pg.c.fetchval('SELECT grammar_quiz_python_strip($1)','\ufeff')=='\ufeff'
    await pg.enroll()
    qid=next(q['qid'] for q in pg.questions if q['input']=='text')
    await pg.c.execute('ALTER TABLE quiz_questions DISABLE TRIGGER grammar_quiz_question_guard')
    try: await pg.c.execute('UPDATE quiz_questions SET accept=$2::jsonb WHERE bank_id=$1 AND qid=$3',pg.new,encoded(['x','\x85\x1c']),qid)
    finally: await pg.c.execute('ALTER TABLE quiz_questions ENABLE TRIGGER grammar_quiz_question_guard')
    with pytest.raises(asyncpg.PostgresError,match='grammar_text_policy_unavailable'):
        await pg.c.fetchval('SELECT grammar_quiz_text_policy($1)',pg.new)
    with pytest.raises(asyncpg.PostgresError,match='grammar_cutover_receipt_invalid'):
        await start_mapped(pg)


@pytest.mark.asyncio
@pytest.mark.parametrize('extra',[False,True])
async def test_compact_utf8_map_bytes_exact_boundary_without_label_space_stripping(pg,extra):
    await pg.enroll()
    qid='界'*((16384-12)//3)+' '*((16384-12)%3)
    if extra: qid+='界'
    original=pg.production['qid']
    await pg.c.execute('ALTER TABLE quiz_questions DISABLE TRIGGER grammar_quiz_question_guard')
    try: await pg.c.execute('UPDATE quiz_questions SET qid=$2 WHERE bank_id=$1 AND qid=$3',pg.new,qid,original)
    finally: await pg.c.execute('ALTER TABLE quiz_questions ENABLE TRIGGER grammar_quiz_question_guard')
    await pg.corrupt_policy({qid:'exact'})
    if extra:
        with pytest.raises(asyncpg.PostgresError,match='grammar_text_policy_unavailable'):
            await pg.c.fetchval('SELECT grammar_quiz_text_policy($1)',pg.new)
    else: assert json.loads(await pg.c.fetchval('SELECT grammar_quiz_text_policy($1)',pg.new))=={qid:'exact'}
    # Valid policy alone never substitutes for approved source/receipt binding.
    with pytest.raises(asyncpg.PostgresError,match='grammar_cutover_receipt_invalid'):
        await start_mapped(pg)


@pytest.mark.asyncio
@pytest.mark.parametrize('entries',[200,201])
async def test_persisted_entry_count_limit_is_actual_question_owned(pg,entries):
    await pg.enroll()
    await pg.c.execute('ALTER TABLE quiz_questions DISABLE TRIGGER grammar_quiz_question_guard')
    try:
        await pg.c.execute('DELETE FROM quiz_questions WHERE bank_id=$1',pg.new)
        await pg.c.executemany('''INSERT INTO quiz_questions(bank_id,qid,item_key,type,input,skill,prompt,accept)
          VALUES($1,$2,'item','gap_text','text','production','Synthetic','["x"]')''',[(pg.new,'q'+str(i)) for i in range(entries)])
    finally: await pg.c.execute('ALTER TABLE quiz_questions ENABLE TRIGGER grammar_quiz_question_guard')
    await pg.corrupt_policy({'q'+str(i):'exact' for i in range(entries)})
    if entries>200:
        with pytest.raises(asyncpg.PostgresError,match='grammar_text_policy_unavailable'):
            await pg.c.fetchval('SELECT grammar_quiz_text_policy($1)',pg.new)
    else: assert json.loads(await pg.c.fetchval('SELECT grammar_quiz_text_policy($1)',pg.new))=={'q'+str(i):'exact' for i in range(entries)}
    with pytest.raises(asyncpg.PostgresError,match='grammar_cutover_receipt_invalid'):
        await start_mapped(pg)


@pytest.mark.asyncio
async def test_raw_generic_import_cannot_retrofit_map_or_replace_original_questions(pg):
    before=await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(q) ORDER BY id)::text FROM quiz_questions q')
    bank={'topic_id':str(pg.topic),'code':CODE,'skill_area':'grammar',
        'meta':{'text_match_by_qid':{'production':'exact'}}}
    with pytest.raises(asyncpg.PostgresError,match='grammar_mapped_import_requires_cutover'):
        await pg.rpc('import_quiz_bank_atomic',encoded(bank),encoded([]),'preserve')
    assert await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(q) ORDER BY id)::text FROM quiz_questions q')==before


@pytest.mark.asyncio
async def test_direct_unmanaged_mapped_session_never_uses_legacy_fallback(pg):
    await pg.c.execute("UPDATE quiz_banks SET meta=meta||$2::jsonb WHERE id=$1",pg.old,
        encoded({'text_match_by_qid':{'production':'exact'}}))
    before=await pg.c.fetchval('SELECT count(*) FROM quiz_sessions')
    with pytest.raises(asyncpg.PostgresError,match='grammar_text_policy_unavailable'):
        await pg.c.execute('INSERT INTO quiz_sessions(user_id,bank_id,code) VALUES($1,$2,$3)',pg.user,pg.old,CODE)
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_sessions')==before


async def wait_code_lock(pg, connection, task):
    """Observe the real second transaction's code gate, not elapsed timing."""
    for _ in range(100):
        blocked=await pg.c.fetchval('''SELECT EXISTS(SELECT 1 FROM pg_locks
          WHERE pid=$1 AND locktype='advisory' AND classid=306 AND objsubid=2 AND NOT granted)''',
          connection.get_server_pid())
        if blocked:
            assert not task.done()
            return
        await asyncio.sleep(.01)
    raise AssertionError('second lifecycle transaction did not wait at managed code gate')


async def finish_race(task, *connections):
    if task is not None:
        if not task.done(): task.cancel()
        try: await task
        except BaseException: pass
    for connection in connections:
        await connection.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('reset_first',[False,True])
async def test_actual_reset_progress_serialization_retains_answers_and_never_resurrects_stats(pg,reset_first):
    await pg.enroll()
    admission=await pg.start(current=True)
    await pg.progress(admission['session_id'])
    other=await pg.start(current=True,user=pg.other)
    other_before=await pg.c.fetchval('SELECT to_jsonb(s)::text FROM quiz_sessions s WHERE id=$1',UUID(other['session_id']))
    attempt={'client_id':str(uuid4()),'qid':'recognition','item_key':'item',
        'skill':'recognition','type':'mcq','is_correct':False}
    first,second=await pg.connection(),await pg.connection()
    pending=None
    async def write_progress(connection):
        return await pg.rpc('grammar_quiz_progress_service',pg.user,admission['session_id'],
            encoded([attempt]),encoded([]),connection=connection)
    async def reset(connection):
        return await pg.rpc('grammar_quiz_reset_service',pg.user,pg.new,connection=connection)
    try:
        async with first.transaction():
            await (reset(first) if reset_first else write_progress(first))
            pending=asyncio.create_task(write_progress(second) if reset_first else reset(second))
            await wait_code_lock(pg,second,pending)
        if reset_first:
            with pytest.raises(asyncpg.PostgresError,match='grammar_reset_stale'):
                await asyncio.wait_for(pending,3)
        else:
            assert (await asyncio.wait_for(pending,3))['ok'] is True
        assert await pg.c.fetchval('SELECT count(*) FROM quiz_attempts WHERE bank_id=$1',pg.new)==int(not reset_first)
        assert await pg.c.fetchval('SELECT count(*) FROM quiz_word_stats WHERE bank_id=$1 AND user_id=$2',pg.new,pg.user)==0
        assert await pg.c.fetchval('SELECT grammar_reset_at IS NOT NULL FROM quiz_sessions WHERE id=$1',UUID(admission['session_id']))
        assert await pg.c.fetchval('SELECT to_jsonb(s)::text FROM quiz_sessions s WHERE id=$1',UUID(other['session_id']))==other_before
    finally:
        await finish_race(pending,first,second)


@pytest.mark.asyncio
@pytest.mark.parametrize('reset_first',[False,True])
async def test_actual_reset_start_serialization_marks_only_prior_admissions(pg,reset_first):
    await pg.enroll()
    prior=await pg.start(current=True)
    first,second=await pg.connection(),await pg.connection()
    pending=None
    async def start(connection):
        return await pg.rpc('grammar_quiz_start_service',pg.user,pg.new,pg.new_revision,None,'qid-exact-v1',connection=connection)
    async def reset(connection):
        return await pg.rpc('grammar_quiz_reset_service',pg.user,pg.new,connection=connection)
    try:
        async with first.transaction():
            outcome=await (reset(first) if reset_first else start(first))
            pending=asyncio.create_task(start(second) if reset_first else reset(second))
            await wait_code_lock(pg,second,pending)
        later=await asyncio.wait_for(pending,3)
        created=later if reset_first else outcome
        row=await pg.c.fetchrow('SELECT grammar_reset_at,grammar_admission_kind,grammar_predecessor_session_id FROM quiz_sessions WHERE id=$1',UUID(created['session_id']))
        assert (row['grammar_reset_at'] is None)==reset_first
        assert row['grammar_admission_kind']==('run' if reset_first else 'continuation')
        assert row['grammar_predecessor_session_id']==(None if reset_first else UUID(prior['session_id']))
        assert await pg.c.fetchval('SELECT grammar_reset_at IS NOT NULL FROM quiz_sessions WHERE id=$1',UUID(prior['session_id']))
    finally:
        await finish_race(pending,first,second)


@pytest.mark.asyncio
@pytest.mark.parametrize('reset_first',[False,True])
async def test_actual_reset_end_serialization_terminalizes_only_frozen_history(pg,reset_first):
    await pg.enroll()
    admission=await pg.start(current=True)
    before=await pg.c.fetchrow('SELECT * FROM quiz_sessions WHERE id=$1',UUID(admission['session_id']))
    first,second=await pg.connection(),await pg.connection()
    pending=None
    async def end(connection):
        return await pg.rpc('grammar_quiz_end_service',pg.user,admission['session_id'],
            encoded({'ended_by':'paused','total_questions':1}),connection=connection)
    async def reset(connection):
        return await pg.rpc('grammar_quiz_reset_service',pg.user,pg.new,connection=connection)
    try:
        async with first.transaction():
            await (reset(first) if reset_first else end(first))
            pending=asyncio.create_task(end(second) if reset_first else reset(second))
            await wait_code_lock(pg,second,pending)
        await asyncio.wait_for(pending,3)
        after=await pg.c.fetchrow('SELECT * FROM quiz_sessions WHERE id=$1',UUID(admission['session_id']))
        for field in ('id','user_id','bank_id','grammar_revision','grammar_admission_kind','grammar_predecessor_session_id','grammar_mastery_completed_at'):
            assert after[field]==before[field]
        assert after['ended_by']=='paused' and after['grammar_reset_at'] is not None
        assert await pg.c.fetchval('SELECT count(*) FROM quiz_attempts')==0
        assert await pg.c.fetchval('SELECT count(*) FROM quiz_word_stats')==0
        repeated=await end(pg.c)
        assert repeated['grammar_reset_at'] is not None and 'grammar' not in repeated
        assert await pg.c.fetchrow('SELECT * FROM quiz_sessions WHERE id=$1',UUID(admission['session_id']))==after
    finally:
        await finish_race(pending,first,second)


@pytest.mark.asyncio
@pytest.mark.parametrize('table',['quiz_attempts','quiz_word_stats'])
async def test_actual_direct_marked_progress_rejects_even_with_old_owned_context(pg,table):
    await pg.enroll()
    admission=await pg.start(current=True)
    await pg.rpc('grammar_quiz_reset_service',pg.user,pg.new)
    async with pg.c.transaction():
        await pg.c.execute("SELECT set_config('aver.grammar_quiz_context',$1,true)",encoded({
            'action':'progress','actor':str(pg.user),'bank':str(pg.new),'code':CODE,'session':admission['session_id']}))
        statement=('''INSERT INTO quiz_attempts(user_id,bank_id,session_id,item_key,qid,skill,type,is_correct)
          VALUES($1,$2,$3,'item','recognition','recognition','mcq',false)''' if table=='quiz_attempts' else
          '''INSERT INTO quiz_word_stats(user_id,bank_id,last_session_id,item_key,skills_passed)
          VALUES($1,$2,$3,'item','[]')''')
        with pytest.raises(asyncpg.PostgresError,match='grammar_reset_stale'):
            async with pg.c.transaction():
                await pg.c.execute(statement,pg.user,pg.new,UUID(admission['session_id']))
    assert await pg.c.fetchval('SELECT count(*) FROM '+table)==0


@pytest.mark.asyncio
@pytest.mark.parametrize('reset_first',[False,True])
async def test_actual_reset_account_erasure_scope_serializes_before_owner_fk(pg,reset_first):
    await pg.enroll()
    admission=await pg.start(current=True)
    await pg.progress(admission['session_id'])
    other=await pg.start(current=True,user=pg.other)
    other_before=await pg.c.fetchrow('SELECT * FROM quiz_sessions WHERE id=$1',UUID(other['session_id']))
    proof=await pg.c.fetchval('SELECT detail FROM governance_audit')
    banks=await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(b) ORDER BY id)::text FROM quiz_banks b')
    first,second=await pg.connection(),await pg.connection()
    pending=None
    async def reset(connection):
        return await pg.rpc('grammar_quiz_reset_service',pg.user,pg.new,connection=connection)
    async def erase(connection):
        return await connection.execute('DELETE FROM users WHERE id=$1',pg.user)
    try:
        async with first.transaction():
            await (reset(first) if reset_first else erase(first))
            pending=asyncio.create_task(erase(second) if reset_first else reset(second))
            await wait_code_lock(pg,second,pending)
        if reset_first:
            await asyncio.wait_for(pending,3)
        else:
            with pytest.raises(asyncpg.PostgresError,match='grammar_session_not_owned'):
                await asyncio.wait_for(pending,3)
        assert await pg.c.fetchval('SELECT count(*) FROM users WHERE id=$1',pg.user)==0
        for table in ('quiz_sessions','quiz_attempts','quiz_word_stats'):
            assert await pg.c.fetchval('SELECT count(*) FROM '+table+' WHERE user_id=$1',pg.user)==0
        assert await pg.c.fetchrow('SELECT * FROM quiz_sessions WHERE id=$1',UUID(other['session_id']))==other_before
        assert await pg.c.fetchval('SELECT detail FROM governance_audit')==proof
        assert await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(b) ORDER BY id)::text FROM quiz_banks b')==banks
    finally:
        await finish_race(pending,first,second)
