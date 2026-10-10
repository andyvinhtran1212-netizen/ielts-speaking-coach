"""GRAMMARAUDIT-0019: actual PostgreSQL edge/history preservation and source bounds."""
import json
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest

from models.grammar_quiz_revisions import GrammarRevisionCommitRequest, GrammarRevisionPreviewRequest
from services import grammar_quiz_revisions as owner
from services.grammar_quiz_revision_source import FOLLOWUP_CODE, REVIEWED_SOURCES, parse_reviewed_source
from test_grammar_quiz_revision_boundary import pg, encoded
from test_grammar_quiz_revisions import canonical_engine, canonical

ROOT = Path(__file__).parents[2]


async def command(engine, code, raw):
    read = await owner.read_revision(engine, code)
    preview = await owner.preview_revision(engine, code, GrammarRevisionPreviewRequest(source_markdown=raw, expected_revision=read.revision))
    return preview, GrammarRevisionCommitRequest(source_markdown=raw, expected_revision=read.revision,
        preview_fingerprint=preview.preview_fingerprint, operation_id=uuid4())


async def history(pg):
    return await pg.c.fetchval("""SELECT jsonb_build_object(
      'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM quiz_sessions s),
      'stats',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM quiz_word_stats s),
      'attempts',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM quiz_attempts s))::text""")


@pytest.mark.asyncio
async def test_lsu_followup_preserves_both_edges_history_and_old_receipt_retry(pg, monkeypatch):
    frozen = json.loads((ROOT/'frontend/tests/fixtures/grammar-exact-form-banks.json').read_text())
    old_raw = next(b['raw_source'] for b in frozen['banks'] if b['code']==FOLLOWUP_CODE)
    old_source = parse_reviewed_source(FOLLOWUP_CODE, old_raw)
    final_raw = (ROOT/'docs/grammar-quiz-banks'/f'{FOLLOWUP_CODE}.md').read_text()
    await pg.c.execute('SELECT quiz_replace_questions($1,$2::jsonb)',pg.old,encoded(old_source.questions))
    await pg.c.execute('UPDATE quiz_banks SET code=$2,title=$3,source=$4,words_count=$5,meta=$6::jsonb WHERE id=$1',
        pg.old,FOLLOWUP_CODE,old_source.metadata['title'],old_source.metadata['source'],old_source.metadata['words_count'],encoded(old_source.metadata['meta']))
    await pg.c.execute('UPDATE quiz_sessions SET code=$2 WHERE id=$1',pg.predecessor,FOLLOWUP_CODE)
    engine = canonical_engine(pg)
    try:
        # Simulate the previously approved release's active source. Restore the
        # new binding before testing the follow-up; no production owner bypass.
        with monkeypatch.context() as prior_release:
            prior_release.setitem(REVIEWED_SOURCES,FOLLOWUP_CODE,(old_source.raw_sha256,frozenset()))
            _, first_request = await command(engine,FOLLOWUP_CODE,old_raw)
            first = await owner.commit_revision(engine,FOLLOWUP_CODE,pg.actor,first_request)
        prior_id = first.corrected_bank_id
        unfinished = await pg.rpc('grammar_quiz_start_service',pg.user,prior_id,first.canonical.current_bank_revision,'run')
        await pg.rpc('grammar_quiz_start_service',pg.other,prior_id,first.canonical.current_bank_revision,'review')
        await pg.rpc('grammar_quiz_start_service',pg.actor,prior_id,first.canonical.current_bank_revision,'run')
        await pg.rpc('grammar_quiz_reset_service',pg.actor,prior_id)
        complete_user = uuid4()
        await pg.c.execute('INSERT INTO users(id) VALUES($1)',complete_user)
        completed = await pg.rpc('grammar_quiz_start_service',complete_user,prior_id,first.canonical.current_bank_revision,'run')
        groups={}
        for q in old_source.questions:groups.setdefault(q['item_key'],set()).add(q['skill'])
        stats=[{'item_key':k,'correct_count':2,'wrong_count':0,'skills_passed':sorted(v),'production_done':True,'status':'mastered','credit_count':2} for k,v in groups.items()]
        await pg.rpc('grammar_quiz_progress_service',complete_user,UUID(completed['session_id']),encoded([]),encoded(stats))
        before_history=await history(pg)
        before_questions=await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(q) ORDER BY id)::text FROM quiz_questions q')
        first_detail=await pg.c.fetchval('SELECT detail FROM governance_audit')
        preview, request=await command(engine,FOLLOWUP_CODE,final_raw)
        assert preview.canonical.publication_available and preview.canonical.original_bank_id==prior_id
        assert preview.canonical.canonical_root_bank_id==pg.old
        assert [(q.qid,q.fields) for q in preview.changed_questions]==[('lsu_strip_i2',['accept','explain','prompt'])]
        assert preview.canonical.footprint.classifications=={'provably_unfinished_in_progress':1,'readonly_or_reset':2,'genuinely_mastered':1}
        result=await owner.commit_revision(engine,FOLLOWUP_CODE,pg.actor,request)
        assert result.original_bank_id==prior_id and result.canonical.bank_ids==[pg.old,prior_id,result.corrected_bank_id]
        assert not result.canonical.publication_available and result.current_matches_committed
        assert await history(pg)==before_history
        assert await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(q) ORDER BY id)::text FROM quiz_questions q WHERE bank_id<>$1',result.corrected_bank_id)==before_questions
        assert await pg.c.fetchval("SELECT detail FROM governance_audit WHERE detail::jsonb->>'operation_id'=$1",str(first_request.operation_id))==first_detail
        assert (await pg.rpc('grammar_quiz_state',pg.user,pg.old))['can_continue_legacy']
        assert (await pg.rpc('grammar_quiz_state',pg.user,prior_id))['can_continue_legacy']
        for user in (pg.other,pg.actor,complete_user):
            assert not (await pg.rpc('grammar_quiz_state',user,prior_id))['can_continue_legacy']
            with pytest.raises(asyncpg.PostgresError,match='grammar_content_revised'):
                await pg.rpc('grammar_quiz_start_service',user,prior_id,None,None)
        replay_old=await owner.commit_revision(engine,FOLLOWUP_CODE,pg.actor,first_request)
        assert replay_old.outcome=='already_applied' and replay_old.corrected_bank_id==prior_id
        assert not replay_old.current_matches_committed and replay_old.canonical.current_bank_id==result.corrected_bank_id
        assert (await owner.commit_revision(engine,FOLLOWUP_CODE,pg.actor,request)).outcome=='already_applied'
        conflicting=first_request.model_copy(update={'source_markdown':final_raw})
        with pytest.raises(owner.GrammarRevisionError) as error:
            await owner.commit_revision(engine,FOLLOWUP_CODE,pg.actor,conflicting)
        assert error.value.code=='grammar_operation_conflict'
        _, third=await command(engine,FOLLOWUP_CODE,final_raw)
        with pytest.raises(owner.GrammarRevisionError) as error:
            await owner.commit_revision(engine,FOLLOWUP_CODE,pg.actor,third)
        assert error.value.code=='grammar_already_revised'
        assert await pg.c.fetchval('SELECT count(*) FROM quiz_banks')==3
        continuation=await pg.rpc('grammar_quiz_start_service',pg.user,prior_id,None,None)
        assert continuation['grammar']['bank_revision']==first.canonical.current_bank_revision
        assert await pg.c.fetchval('SELECT grammar_predecessor_session_id FROM quiz_sessions WHERE id=$1',UUID(continuation['session_id']))==UUID(unfinished['session_id'])
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_only_named_words_count_fix_keeps_old_metadata_and_question_ids(pg):
    code='G-foundations-singular-vs-plural'
    raw=(ROOT/'docs/grammar-quiz-banks'/f'{code}.md').read_text()
    source=parse_reviewed_source(code,raw)
    await pg.c.execute('SELECT quiz_replace_questions($1,$2::jsonb)',pg.old,encoded(source.questions))
    await pg.c.execute('UPDATE quiz_banks SET code=$2,title=$3,source=$4,words_count=5,meta=$5::jsonb WHERE id=$1',
        pg.old,code,source.metadata['title'],source.metadata['source'],encoded({**source.metadata['meta'],'preserved_extra':{'keep':True}}))
    await pg.c.execute('UPDATE quiz_sessions SET code=$2 WHERE id=$1',pg.predecessor,code)
    questions=await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(q) ORDER BY id)::text FROM quiz_questions q')
    before=await history(pg)
    engine=canonical_engine(pg)
    try:
        _, request=await command(engine,code,raw)
        result=await owner.commit_revision(engine,code,pg.actor,request)
        assert await pg.c.fetchval('SELECT words_count FROM quiz_banks WHERE id=$1',pg.old)==5
        assert await pg.c.fetchval('SELECT words_count FROM quiz_banks WHERE id=$1',result.corrected_bank_id)==4
        assert await pg.c.fetchval("SELECT meta->'preserved_extra' FROM quiz_banks WHERE id=$1",result.corrected_bank_id)==encoded({'keep':True})
        assert await history(pg)==before
        assert await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(q) ORDER BY id)::text FROM quiz_questions q WHERE bank_id=$1',pg.old)==questions
    finally:
        await engine.dispose()

@pytest.mark.asyncio
async def test_current_admin_asgi_capture_uses_real_pg_and_public_models(canonical, monkeypatch):
    """Optional fixture export contains only public responses from synthetic PG."""
    import os
    from hashlib import sha256
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from routers import admin, admin_quiz
    from test_grammar_quiz_revisions import SOURCE
    pg, engine=canonical
    async def admin_gate(_):return {'id':str(pg.actor)}
    monkeypatch.setattr(admin_quiz,'require_admin',admin_gate)
    monkeypatch.setattr(admin,'_db_engine',engine)
    app=FastAPI();app.include_router(admin_quiz.router)
    path='/admin/quiz/grammar-revisions/G-tenses-present-simple'
    captured=[]
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://fixture.local') as client:
        read=await client.get(path)
        assert read.status_code==200
        captured.append({'method':'GET','path':path,'status':read.status_code,'response':read.json()})
        payload={'source_markdown':SOURCE,'expected_revision':read.json()['revision']}
        preview=await client.post(path+'/preview',json=payload)
        assert preview.status_code==200
        captured.append({'method':'POST','path':path+'/preview','status':preview.status_code,'request_without_source':{'expected_revision':payload['expected_revision']},'response':preview.json()})
        payload.update(preview_fingerprint=preview.json()['preview_fingerprint'],operation_id=str(uuid4()))
        for _ in range(2):
            result=await client.post(path+'/commit',json=payload)
            assert result.status_code==200
            captured.append({'method':'POST','path':path+'/commit','status':result.status_code,'request_without_source':{k:v for k,v in payload.items() if k!='source_markdown'},'response':result.json()})
        current=await client.get(path)
        assert current.status_code==200
        captured.append({'method':'GET','path':path,'status':current.status_code,'response':current.json()})
    target=os.environ.get('GRAMMAR_AUDIT_CAPTURE_PATH')
    if target:
        public={'provenance':{'artifact':Path(target).name,'boundary':'actual local PostgreSQL + ASGI; synthetic Auth, users and history; no production or RLS acceptance',
            'source_sha256':sha256(SOURCE.encode()).hexdigest(),'extraction':'Exact public read/preview/applied/replayed/current wire; no private receipt or learner rows.'},
            'actor_id':str(pg.actor),'canonical_code':'G-tenses-present-simple','requests':captured}
        Path(target).write_text(json.dumps(public,ensure_ascii=False,indent=2)+'\n')
