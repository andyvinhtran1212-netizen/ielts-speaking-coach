"""GRAMMARAUDIT-0019 Revision 2 (T011): migration 339 and the two explain-only follow-ups.

Static checks bind the exact approved bytes, the reviewed bindings, the migration
lookup and the backend/admin code sets together. The PostgreSQL half applies the
real 309 -> 314 -> 339 chain (the boundary harness) and exercises the real admin
owner: a follow-up from v2, a first cutover straight to v3, history/receipt
preservation, and the bounds (no fourth bank, no second follow-up, every other
code one cutover). Set GRAMMAR_QUIZ_REVISION_TEST_DATABASE_URL and REQUIRE_PG=1.
"""
import hashlib
import json
import re
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest

from services import grammar_quiz_revisions as owner
from services.grammar_quiz_revision_source import (
    FOLLOWUP_CODES, REVIEWED_BINDINGS, REVIEWED_SOURCES, parse_reviewed_source)
from test_grammar_quiz_revision_boundary import MIGRATIONS, pg, encoded  # noqa: F401 (fixture)
from test_grammar_quiz_revisions import canonical_engine
from test_grammar_audit_publication import command, history

ROOT = MIGRATIONS.parents[1]
NAME = '339_grammar_quiz_followup_codes.sql'
SQL_339 = (MIGRATIONS / NAME).read_text(encoding='utf-8')
SQL_314 = (MIGRATIONS / '314_grammar_audit_reviewed_publication.sql').read_text(encoding='utf-8')
ROLLBACK = (MIGRATIONS / 'rollback' / NAME).read_text(encoding='utf-8')
LSU = 'G-grammar-for-reading-long-sentence-untangling'
TASK1 = 'G-grammar-for-writing-grammar-in-task1'
FEW = 'G-foundations-few-a-few-little-a-little'

# approval-decision.md "Revision 2 — Approved content change": (line, before, after).
APPROVED = {
    TASK1: [
        (129, "explain: \"Process diagram mô tả việc được làm, không nêu ai làm → bị động: is/are + V-ed. 'are transported' đúng vì chủ ngữ số nhiều.\"",
              "explain: \"Bước do người/máy thực hiện và không cần nêu ai làm → thường dùng bị động: is/are + V-ed. 'are transported' đúng vì chủ ngữ số nhiều.\""),
        (143, "explain: \"Bước trong quy trình luôn nêu KHÁCH QUAN, không nêu người thực hiện → bị động present simple: 'is heated'.\"",
              "explain: \"Đun nóng là bước có tác nhân tác động lên hỗn hợp → thường dùng bị động present simple: 'is heated'. Bước tự diễn ra (water evaporates) vẫn dùng chủ động.\""),
        (171, "explain: \"Task 1 process cần khách quan, tập trung vào bước xảy ra chứ không phải người làm → 'The beans are collected by hand' (bị động) phù hợp hơn câu chủ động.\"",
              "explain: \"Quy trình nhân tạo thường dùng bị động để tập trung vào bước làm, không phải người làm → 'The beans are collected by hand' phù hợp hơn. Chủ động vẫn tự nhiên với bước tự diễn ra (the beans dry in the sun).\""),
    ],
    FEW: [
        (90, '# ===== item_key 2 · A FEW / A LITTLE — sắc thái tích cực (đủ dùng) =====',
             '# ===== item_key 2 · A FEW / A LITTLE — sắc thái tích cực (một ít, vẫn có) ====='),
        (103, "explain: \"Ngữ cảnh 'plenty of time' cho thấy sắc thái tích cực (đủ dùng) → dùng 'a few', không phải 'few'.\"",
              "explain: \"Ngữ cảnh 'plenty of time' mang sắc thái tích cực: vẫn còn một ít thời gian → dùng 'a few'. 'Few' nghĩa là rất ít, gần như không có, trái với ý câu.\""),
        (132, "explain: \"Ngữ cảnh 'helped him during the trip' cho thấy đủ dùng (tích cực) → dùng 'a little', không phải 'little'.\"",
              "explain: \"Ngữ cảnh 'helped him during the trip' cho thấy anh ấy biết một ít tiếng Pháp và vốn đó có ích (tích cực) → dùng 'a little'. 'Little' nghĩa là gần như không biết.\""),
    ],
}
CHANGED = {TASK1: [('t1_pass_b1', ['explain']), ('t1_pass_b2', ['explain']), ('t1_pass_i2', ['explain'])],
           FEW: [('fal_pos_b1', ['explain']), ('fal_pos_i2', ['explain'])]}
MANIFESTS = {TASK1: ('33dc3cdde9ad5e518694b0beec26aabc3bb9db4e98fb33cd7cc219996ff13d3f',
                     'b8041a19a25feda6410ca217633a3e0008d6ceb196aa9fb260237aebb450d914'),
             FEW: ('c89abcc9cd111e3e374449f7f439e5a648026250a71e2c9d8a07030f972141df',
                   'fa08f119defca13a4ee5c15e9c85b7922711731994a5899a25b79ce6eb10dd83')}


def v3_raw(code):
    return (ROOT / 'docs/grammar-quiz-banks' / f'{code}.md').read_text(encoding='utf-8')


def v2_raw(code):
    """The retained v2 source, rebuilt from v3 by reversing only the approved lines."""
    lines = v3_raw(code).split('\n')
    for number, before, after in APPROVED[code]:
        assert lines[number - 1] == after, (code, number)
        lines[number - 1] = before
    return '\n'.join(lines)


def _sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def _embedded_bindings(sql):
    return re.search(r"SELECT \$audit\$(.*)\$audit\$::JSONB", sql).group(1)


def _lookup_rows(sql):
    body = re.search(r'FUNCTION public\.grammar_quiz_followup_pair\(.*?\$\$(.*?)\$\$;', sql, re.S).group(1)
    return {code: (middle, final) for code, middle, final in re.findall(r"\('([^']+)','([0-9a-f]{64})','([0-9a-f]{64})'\)", body)}


# ── Static: approved bytes, bindings, lookup and code sets agree ─────────────

@pytest.mark.parametrize('code', [TASK1, FEW])
def test_v3_source_is_v2_plus_exactly_the_approved_lines(code):
    middle, final = FOLLOWUP_CODES[code]
    assert _sha(v3_raw(code)) == final
    assert _sha(v2_raw(code)) == middle
    assert REVIEWED_SOURCES[code][0] == final
    for source, (manifest, sha) in ((v2_raw(code), (MANIFESTS[code][0], middle)), (v3_raw(code), (MANIFESTS[code][1], final))):
        parsed = parse_reviewed_source(code, source)
        assert (parsed.raw_sha256, parsed.manifest_sha256) == (sha, manifest)
    old_questions = parse_reviewed_source(code, v2_raw(code)).questions
    new_questions = parse_reviewed_source(code, v3_raw(code)).questions
    changed = [(new['qid'], sorted(k for k in new if new[k] != old[k])) for old, new in zip(old_questions, new_questions)
               if new != old]
    assert changed == CHANGED[code]


def test_followup_codes_match_bindings_migration_lookup_and_admin_model():
    assert set(FOLLOWUP_CODES) == {LSU, TASK1, FEW}
    for code, (middle, final) in FOLLOWUP_CODES.items():
        bindings = REVIEWED_BINDINGS[code]['bindings']
        assert set(bindings) == {middle, final} and REVIEWED_BINDINGS[code]['active_source_sha256'] == final
        assert 'followup_fields' not in bindings[middle] and bindings[final]['followup_fields']
        assert bindings[final]['metadata'] == bindings[middle]['metadata']
        followup = {qid: set(fields) for qid, fields in bindings[final]['followup_fields'].items()}
        assert all(followup[qid] <= set(bindings[final]['allowed_fields'][qid]) for qid in followup)
    for code in (TASK1, FEW):
        final = REVIEWED_BINDINGS[code]['bindings'][FOLLOWUP_CODES[code][1]]
        assert {qid: sorted(fields) for qid, fields in final['followup_fields'].items()} == dict(CHANGED[code])
    assert _lookup_rows(SQL_339) == FOLLOWUP_CODES
    model = (ROOT / 'frontend/lib/admin-grammar-revision-model.ts').read_text(encoding='utf-8')
    block = re.search(r'GRAMMAR_FOLLOWUP_CODES: ReadonlySet<string> = new Set\(\[(.*?)\]\)', model, re.S).group(1)
    assert set(re.findall(r"'([^']+)'", block)) == set(FOLLOWUP_CODES)
    assert LSU not in model.split('GRAMMAR_FOLLOWUP_CODES', 2)[2], 'no hard-coded LSU check may remain'


def test_339_embeds_the_reviewed_json_and_keeps_every_314_binding_byte_identical():
    reviewed = json.loads((ROOT / 'backend/services/grammar_quiz_reviewed_sources.json').read_text(encoding='utf-8'))
    embedded = _embedded_bindings(SQL_339)
    assert embedded == json.dumps(reviewed, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    old = json.loads(_embedded_bindings(SQL_314))
    new = json.loads(embedded)
    dump = lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    for code, entry in old.items():
        for source, binding in entry['bindings'].items():
            assert dump(new[code]['bindings'][source]) == dump(binding), (code, source)
    added = {(code, source) for code, entry in new.items() for source in entry['bindings']} - \
        {(code, source) for code, entry in old.items() for source in entry['bindings']}
    assert added == {(TASK1, FOLLOWUP_CODES[TASK1][1]), (FEW, FOLLOWUP_CODES[FEW][1])}


def test_339_is_function_only_and_replaces_every_lsu_literal_with_the_lookup():
    code = re.sub(r'(?m)^\s*--.*$', '', SQL_339)
    code = code.replace(_embedded_bindings(SQL_339), '')
    assert not re.search(r'\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|TRIGGER|POLICY|SCHEMA)\b', code, re.I)
    assert not re.search(r'\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b', code, re.I)
    assert not re.search(r'\bGRANT\b[^;]*\bTO\s+(anon|authenticated|PUBLIC)\b', code, re.I)
    functions = re.findall(r'CREATE OR REPLACE FUNCTION public\.(\w+)\(', code)
    assert functions == ['grammar_quiz_followup_pair', 'grammar_quiz_audit_binding', 'grammar_quiz_audit_chain',
                         'grammar_quiz_guard_bank', 'grammar_quiz_validate_receipt_envelope', 'grammar_quiz_receipt_data']
    for name in functions[2:]:
        body = re.search(r'FUNCTION public\.' + name + r'\(.*?END \$\$;', code, re.S).group(0)
        assert 'SECURITY DEFINER SET search_path=public,pg_temp' in body
        two_bank = re.search(r"AND \(p_code='.*?\); END IF;", body)
        checked = body.replace(two_bank.group(0), '') if two_bank else body
        for literal in (LSU, 'f272f1d1', '436d207e'):
            assert literal not in checked, (name, literal)
        assert 'grammar_quiz_followup_pair(' in body, name
    # Same signatures as 314.
    for signature in re.findall(r'CREATE OR REPLACE FUNCTION (public\.\w+\([^)]*\))', SQL_314):
        if 'CREATE OR REPLACE FUNCTION ' + signature.split('(')[0] + '(' in code:
            assert 'CREATE OR REPLACE FUNCTION ' + signature in code
    grants = SQL_314[SQL_314.index('-- Trigger helpers/proof'):SQL_314.index('NOTIFY pgrst')]
    assert grants in SQL_339


def test_339_is_a_normal_forward_migration_and_rollback_restores_314_verbatim():
    policy = (MIGRATIONS / 'forward-policy.tsv').read_text(encoding='utf-8')
    assert NAME not in policy
    assert sorted(path.name for path in MIGRATIONS.glob('339_*.sql')) == [NAME]
    for name in ('grammar_quiz_audit_binding', 'grammar_quiz_audit_chain', 'grammar_quiz_guard_bank',
                 'grammar_quiz_validate_receipt_envelope', 'grammar_quiz_receipt_data'):
        start = SQL_314.index(f'CREATE OR REPLACE FUNCTION public.{name}(')
        end = SQL_314.index('$$;', start) + 3
        assert SQL_314[start:end] in ROLLBACK, name
    assert 'DROP FUNCTION IF EXISTS public.grammar_quiz_followup_pair(TEXT);' in ROLLBACK
    assert SQL_314[SQL_314.index('-- Trigger helpers/proof'):SQL_314.index('NOTIFY pgrst')] in ROLLBACK
    readme = (MIGRATIONS / 'README.md').read_text(encoding='utf-8')
    assert 'Migration `339`' in readme and 'rollback/' + NAME in readme


# ── Actual PostgreSQL ────────────────────────────────────────────────────────

async def _definitions(pg):
    return await pg.c.fetch("""SELECT p.oid::regprocedure::text AS signature,pg_get_functiondef(p.oid) AS body,
        p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=$1 AND p.proname LIKE 'grammar_quiz_%' ORDER BY 1""", pg.schema)


async def _seed_root(pg, code, source):
    await pg.c.execute('SELECT quiz_replace_questions($1,$2::jsonb)', pg.old, encoded(source.questions))
    await pg.c.execute('UPDATE quiz_banks SET code=$2,title=$3,source=$4,words_count=$5,meta=$6::jsonb WHERE id=$1',
        pg.old, code, source.metadata['title'], source.metadata['source'], source.metadata['words_count'],
        encoded(source.metadata['meta']))
    await pg.c.execute('UPDATE quiz_sessions SET code=$2 WHERE id=$1', pg.predecessor, code)


class _Accepted(Exception):
    """The forged writes passed every guard; raised to roll them back."""


async def _forged_child(pg, parent, code, source_sha256, *, retire=False):
    """Forge the guard-visible half of a cutover under a well-formed context, then roll back.

    Optionally retires `parent` first (the follow-up UPDATE path), then INSERTs a
    current child. Only the database guards decide; returns True if both writes
    were accepted (nothing is committed either way).
    """
    new_id = uuid4()
    context = {'action': 'cutover', 'actor': str(pg.actor), 'code': code, 'old_bank': str(parent),
               'bank': str(new_id), 'old_revision': await pg.c.fetchval('SELECT grammar_revision FROM quiz_banks WHERE id=$1', parent),
               'new_revision': 'e' * 64, 'source_sha256': source_sha256}
    try:
        async with pg.c.transaction():
            await pg.c.execute("SELECT set_config('aver.grammar_quiz_context',$1,true)", json.dumps(context))
            if retire:
                await pg.c.execute('UPDATE quiz_banks SET grammar_is_current=FALSE,grammar_retired_at=now() WHERE id=$1', parent)
            await pg.c.execute("""INSERT INTO quiz_banks SELECT (jsonb_populate_record(NULL::quiz_banks,
                to_jsonb(b)||jsonb_build_object('id',$2::uuid,'code',$3::text,'version',b.version+1,
                'grammar_revision',$4::text,'grammar_is_current',true,'grammar_predecessor_bank_id',b.id,
                'grammar_retired_at',NULL))).* FROM quiz_banks b WHERE b.id=$1""",
                parent, new_id, code + '~' + source_sha256[:16], 'e' * 64)
            raise _Accepted
    except _Accepted:
        return True


@pytest.mark.asyncio
@pytest.mark.parametrize('code', [TASK1, FEW])
async def test_followup_from_v2_preserves_history_receipts_and_refuses_fourth_bank(pg, monkeypatch, code):
    middle, final = FOLLOWUP_CODES[code]
    middle_raw, final_raw = v2_raw(code), v3_raw(code)
    middle_source = parse_reviewed_source(code, middle_raw)
    await _seed_root(pg, code, middle_source)
    engine = canonical_engine(pg)
    try:
        # The 2026-10-10 release: v2 was the active source. Restore v3 before the follow-up.
        with monkeypatch.context() as prior_release:
            prior_release.setitem(REVIEWED_SOURCES, code, (middle, frozenset()))
            _, first_request = await command(engine, code, middle_raw)
            first = await owner.commit_revision(engine, code, pg.actor, first_request)
        prior_id = first.corrected_bank_id
        assert await pg.c.fetchval('SELECT code FROM quiz_banks WHERE id=$1', prior_id) == code + '~' + middle[:16]
        unfinished = await pg.rpc('grammar_quiz_start_service', pg.user, prior_id, first.canonical.current_bank_revision, 'run')
        await pg.rpc('grammar_quiz_start_service', pg.other, prior_id, first.canonical.current_bank_revision, 'review')
        await pg.rpc('grammar_quiz_start_service', pg.actor, prior_id, first.canonical.current_bank_revision, 'run')
        await pg.rpc('grammar_quiz_reset_service', pg.actor, prior_id)
        complete_user = uuid4()
        await pg.c.execute('INSERT INTO users(id) VALUES($1)', complete_user)
        completed = await pg.rpc('grammar_quiz_start_service', complete_user, prior_id, first.canonical.current_bank_revision, 'run')
        groups = {}
        for q in middle_source.questions:
            groups.setdefault(q['item_key'], set()).add(q['skill'])
        stats = [{'item_key': k, 'correct_count': 2, 'wrong_count': 0, 'skills_passed': sorted(v), 'production_done': True,
                  'status': 'mastered', 'credit_count': 2} for k, v in groups.items()]
        await pg.rpc('grammar_quiz_progress_service', complete_user, UUID(completed['session_id']), encoded([]), encoded(stats))
        before_history = await history(pg)
        before_questions = await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(q) ORDER BY id)::text FROM quiz_questions q')
        before_banks = await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(b) ORDER BY id)::text FROM quiz_banks b')
        first_detail = await pg.c.fetchval('SELECT detail FROM governance_audit')

        # Positive control: under 339 the guards accept exactly this follow-up shape
        # (retire v2, insert the v3 child); a wrong source is refused. Rolled back.
        assert await _forged_child(pg, prior_id, code, final, retire=True)
        with pytest.raises(asyncpg.PostgresError, match='grammar_managed_bank_immutable'):
            await _forged_child(pg, prior_id, code, middle, retire=True)
        assert await history(pg) == before_history
        preview, request = await command(engine, code, final_raw)
        assert preview.canonical.publication_available and preview.canonical.original_bank_id == prior_id
        assert preview.canonical.canonical_root_bank_id == pg.old
        assert [(q.qid, q.fields) for q in preview.changed_questions] == CHANGED[code]
        assert preview.canonical.footprint.classifications == {
            'provably_unfinished_in_progress': 1, 'readonly_or_reset': 2, 'genuinely_mastered': 1}
        result = await owner.commit_revision(engine, code, pg.actor, request)
        assert result.original_bank_id == prior_id
        assert result.canonical.bank_ids == [pg.old, prior_id, result.corrected_bank_id]
        assert not result.canonical.publication_available and result.current_matches_committed
        assert await pg.c.fetchval('SELECT code FROM quiz_banks WHERE id=$1', result.corrected_bank_id) == code + '~' + final[:16]
        assert await pg.c.fetchval('SELECT grammar_quiz_audit_chain($1)', code)
        # v1/v2 rows, their questions, every learner row and the first receipt are unchanged.
        assert await history(pg) == before_history
        assert await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(q) ORDER BY id)::text FROM quiz_questions q WHERE bank_id<>$1',
                                   result.corrected_bank_id) == before_questions
        banks = json.loads(await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(b) ORDER BY id)::text FROM quiz_banks b WHERE id<>$1',
                                               result.corrected_bank_id))
        retired = {UUID(b['id']): b for b in banks}
        for row in json.loads(before_banks):
            after = retired[UUID(row['id'])]
            if UUID(row['id']) == prior_id:
                assert row['grammar_is_current'] and not after['grammar_is_current'] and after['grammar_retired_at']
                row = {**row, 'grammar_is_current': False, 'grammar_retired_at': after['grammar_retired_at']}
            assert after == row
        assert await pg.c.fetchval("SELECT detail FROM governance_audit WHERE detail::jsonb->>'operation_id'=$1",
                                   str(first_request.operation_id)) == first_detail
        # The new explains are served from the current bank; everything else matches v2.
        current = json.loads(await pg.c.fetchval('SELECT jsonb_agg(to_jsonb(q) ORDER BY "order")::text FROM quiz_questions q WHERE bank_id=$1',
                                                 result.corrected_bank_id))
        final_source = parse_reviewed_source(code, final_raw)
        assert [q['explain'] for q in current] == [q['explain'] for q in final_source.questions]

        # Owned unfinished v1/v2 work continues; reset/readonly/completed cannot.
        assert (await pg.rpc('grammar_quiz_state', pg.user, pg.old))['can_continue_legacy']
        assert (await pg.rpc('grammar_quiz_state', pg.user, prior_id))['can_continue_legacy']
        for user in (pg.other, pg.actor, complete_user):
            assert not (await pg.rpc('grammar_quiz_state', user, prior_id))['can_continue_legacy']
            with pytest.raises(asyncpg.PostgresError, match='grammar_content_revised'):
                await pg.rpc('grammar_quiz_start_service', user, prior_id, None, None)
        continuation = await pg.rpc('grammar_quiz_start_service', pg.user, prior_id, None, None)
        assert continuation['grammar']['bank_revision'] == first.canonical.current_bank_revision
        assert await pg.c.fetchval('SELECT grammar_predecessor_session_id FROM quiz_sessions WHERE id=$1',
                                   UUID(continuation['session_id'])) == UUID(unfinished['session_id'])

        # Receipts: both edges replay; a different payload under a used UUID fails before writes.
        replay_old = await owner.commit_revision(engine, code, pg.actor, first_request)
        assert replay_old.outcome == 'already_applied' and replay_old.corrected_bank_id == prior_id
        assert not replay_old.current_matches_committed and replay_old.canonical.current_bank_id == result.corrected_bank_id
        replay = await owner.commit_revision(engine, code, pg.actor, request)
        assert replay.outcome == 'already_applied' and replay.corrected_bank_id == result.corrected_bank_id
        receipts = await pg.c.fetchval('SELECT count(*) FROM governance_audit')
        for conflicting in (first_request.model_copy(update={'source_markdown': final_raw}),
                            request.model_copy(update={'source_markdown': middle_raw})):
            with pytest.raises(owner.GrammarRevisionError) as error:
                await owner.commit_revision(engine, code, pg.actor, conflicting)
            assert error.value.code == 'grammar_operation_conflict'
        # No second follow-up and no fourth bank: admin owner and database guard.
        _, third = await command(engine, code, final_raw)
        with pytest.raises(owner.GrammarRevisionError) as error:
            await owner.commit_revision(engine, code, pg.actor, third)
        assert error.value.code == 'grammar_already_revised'
        for source in (final, middle):
            with pytest.raises(asyncpg.PostgresError, match='grammar_managed_bank_immutable'):
                await _forged_child(pg, result.corrected_bank_id, code, source, retire=True)
            with pytest.raises(asyncpg.PostgresError, match='grammar_managed_bank_context_invalid'):
                await _forged_child(pg, result.corrected_bank_id, code, source)
        assert await pg.c.fetchval('SELECT count(*) FROM quiz_banks') == 3
        assert await pg.c.fetchval('SELECT count(*) FROM governance_audit') == receipts == 2
        assert await pg.c.fetchval('SELECT grammar_quiz_audit_chain($1)', code)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize('code', [TASK1, FEW])
async def test_unrevised_predecessor_publishes_final_source_once_without_followup(pg, code):
    middle, final = FOLLOWUP_CODES[code]
    await _seed_root(pg, code, parse_reviewed_source(code, v2_raw(code)))
    engine = canonical_engine(pg)
    try:
        preview, request = await command(engine, code, v3_raw(code))
        assert [(q.qid, q.fields) for q in preview.changed_questions] == CHANGED[code]
        result = await owner.commit_revision(engine, code, pg.actor, request)
        assert result.canonical.bank_ids == [pg.old, result.corrected_bank_id]
        assert await pg.c.fetchval('SELECT code FROM quiz_banks WHERE id=$1', result.corrected_bank_id) == code + '~' + final[:16]
        read = await owner.read_revision(engine, code)
        assert not read.publication_available
        assert await pg.c.fetchval('SELECT grammar_quiz_audit_chain($1)', code)
        assert (await pg.rpc('grammar_quiz_state', pg.user, pg.old))['can_continue_legacy'] is not None
        _, again = await command(engine, code, v3_raw(code))
        with pytest.raises(owner.GrammarRevisionError) as error:
            await owner.commit_revision(engine, code, pg.actor, again)
        assert error.value.code == 'grammar_already_revised'
        # A v3 current bank is not a middle bank: no follow-up from it, by any source.
        for source in (final, middle):
            with pytest.raises(asyncpg.PostgresError, match='grammar_managed_bank_immutable'):
                await _forged_child(pg, result.corrected_bank_id, code, source, retire=True)
            with pytest.raises(asyncpg.PostgresError, match='grammar_managed_bank_context_invalid'):
                await _forged_child(pg, result.corrected_bank_id, code, source)
        assert await pg.c.fetchval('SELECT count(*) FROM quiz_banks') == 2
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_every_other_code_keeps_exactly_one_cutover(pg):
    others = sorted(set(REVIEWED_SOURCES) - set(FOLLOWUP_CODES))
    assert len(others) == 87
    rows = await pg.c.fetch('SELECT code,(grammar_quiz_followup_pair(code)).* FROM unnest($1::text[]) code',
                            sorted(REVIEWED_SOURCES))
    assert {row['code']: (row['middle_source'], row['final_source']) for row in rows if row['final_source']} == FOLLOWUP_CODES
    assert all(row['middle_source'] is None and row['final_source'] is None for row in rows if row['code'] in others)
    await pg.enroll()  # The real first cutover of the default, non-follow-up code.
    assert await pg.c.fetchval('SELECT grammar_quiz_audit_chain($1)', pg.code)
    engine = canonical_engine(pg)
    try:
        assert not (await owner.read_revision(engine, pg.code)).publication_available
    finally:
        await engine.dispose()
    source = REVIEWED_SOURCES[pg.code][0]
    for forged in (source, 'f' * 64):
        with pytest.raises(asyncpg.PostgresError, match='grammar_managed_bank_immutable'):
            await _forged_child(pg, pg.new, pg.code, forged, retire=True)
        with pytest.raises(asyncpg.PostgresError, match='grammar_managed_bank_context_invalid'):
            await _forged_child(pg, pg.new, pg.code, forged)
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_banks') == 2


@pytest.mark.asyncio
async def test_rerun_rollback_and_reapply_restore_exact_function_definitions_and_grants(pg):
    applied = await _definitions(pg)
    assert any(row['signature'].endswith('grammar_quiz_followup_pair(text)') for row in applied)
    executable = await pg.c.fetch("""SELECT p.proname,r.role FROM pg_proc p
        CROSS JOIN unnest($2::text[]) r(role)
        WHERE p.pronamespace=$1::regnamespace AND p.proname LIKE 'grammar_quiz_%'
          AND has_function_privilege(r.role,p.oid,'EXECUTE')""",
        pg.schema, [pg.roles['anon'], pg.roles['authenticated'], pg.roles['service_role']])
    assert {(row['proname'], row['role']) for row in executable} == {
        (name, pg.roles['service_role']) for name in ('grammar_quiz_start_service', 'grammar_quiz_progress_service',
            'grammar_quiz_end_service', 'grammar_quiz_reset_service', 'grammar_quiz_state')}
    await pg.c.execute(pg.adapted(SQL_339))
    assert await _definitions(pg) == applied
    await pg.c.execute(pg.adapted(ROLLBACK))
    rolled_back = await _definitions(pg)
    assert not any('followup_pair' in row['signature'] for row in rolled_back)
    await pg.c.execute(pg.adapted(SQL_314))
    assert await _definitions(pg) == rolled_back, 'rollback must leave exactly the 314 state'
    await pg.c.execute(pg.adapted(SQL_339))
    assert await _definitions(pg) == applied


@pytest.mark.asyncio
@pytest.mark.parametrize('code', [TASK1, FEW])
async def test_rollback_refuses_after_a_v3_publication(pg, code):
    await _seed_root(pg, code, parse_reviewed_source(code, v2_raw(code)))
    engine = canonical_engine(pg)
    try:
        _, request = await command(engine, code, v3_raw(code))
        await owner.commit_revision(engine, code, pg.actor, request)
    finally:
        await engine.dispose()
    before = await _definitions(pg)
    with pytest.raises(asyncpg.PostgresError, match='rollback_339_refused'):
        await pg.c.execute(pg.adapted(ROLLBACK))
    await pg.c.execute('ROLLBACK')
    assert await _definitions(pg) == before


@pytest.mark.asyncio
async def test_339_aborts_without_314(pg):
    schema = pg.schema + '_no314'
    await pg.c.execute(f'CREATE SCHEMA {schema}')
    try:
        sql = SQL_339.replace('public.', schema + '.')
        with pytest.raises(asyncpg.PostgresError, match='migration_339_requires_314'):
            await pg.c.execute(sql)
        await pg.c.execute('ROLLBACK')
        assert await pg.c.fetchval('SELECT count(*) FROM pg_proc WHERE pronamespace=$1::regnamespace', schema) == 0
    finally:
        await pg.c.execute(f'DROP SCHEMA {schema} CASCADE')


def _split_at_pre_image(pg):
    """339 up to and including the _m339_before pre-image, and the rest."""
    end = re.search(r'CREATE TEMP TABLE _m339_before[\s\S]*?;\n', SQL_339).end()
    return pg.adapted(SQL_339[:end]), pg.adapted(SQL_339[end:])


def test_339_reads_one_repeatable_read_snapshot():
    # The runner \i's the file in autocommit, so this is the first statement
    # of 339's own transaction; the pre-image and postcondition share it.
    assert re.search(r"^BEGIN;\nSET TRANSACTION ISOLATION LEVEL REPEATABLE READ;\n", SQL_339, re.M)
    assert SQL_339.count('BEGIN;') == 1


@pytest.mark.asyncio
async def test_concurrent_learner_quiz_traffic_does_not_abort_339(pg):
    # PC-J189: a learner (here a non-Grammar vocab quiz) commits a bank and a
    # session between 339's pre-image and its postcondition.
    applied = await _definitions(pg)
    head, tail = _split_at_pre_image(pg)
    await pg.c.execute(head)
    other = await pg.connection()
    vocab_bank, session = uuid4(), uuid4()
    try:
        async with other.transaction():
            await other.execute("INSERT INTO quiz_banks(id,code,skill_area) VALUES($1,'L14','vocab')", vocab_bank)
            await other.execute('INSERT INTO quiz_sessions(id,user_id,bank_id,code) VALUES($1,$2,$3,$4)',
                                session, pg.other, vocab_bank, 'L14')
        assert await other.fetchval('SELECT count(*) FROM quiz_sessions WHERE id=$1', session) == 1
    finally:
        await other.close()
    await pg.c.execute(tail)
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_sessions WHERE id=$1', session) == 1
    assert await _definitions(pg) == applied


@pytest.mark.asyncio
@pytest.mark.parametrize('statement', [
    'INSERT INTO quiz_sessions(user_id,bank_id,code) VALUES($1,$2,$3)',
    "INSERT INTO quiz_banks(code,skill_area) VALUES($3,'vocab') RETURNING $1::uuid,$2::uuid",
])
async def test_postcondition_still_catches_a_row_change_made_inside_339(pg, statement):
    # Negative control for the snapshot: a write in 339's own transaction is
    # visible to the postcondition and aborts the migration.
    applied = await _definitions(pg)
    sessions = await pg.c.fetchval('SELECT count(*) FROM quiz_sessions')
    banks = await pg.c.fetchval('SELECT count(*) FROM quiz_banks')
    head, tail = _split_at_pre_image(pg)
    await pg.c.execute(head)
    await pg.c.execute(statement, pg.other, pg.old, 'L14')
    with pytest.raises(asyncpg.PostgresError, match='migration_339_postcondition: a row count changed'):
        await pg.c.execute(tail)
    await pg.c.execute('ROLLBACK')
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_sessions') == sessions
    assert await pg.c.fetchval('SELECT count(*) FROM quiz_banks') == banks
    assert await _definitions(pg) == applied
