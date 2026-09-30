"""Real PostgreSQL CAS/receipt/lock tests, only in a named local test database.

Set READING_GRAMMAR_FOCUS_TEST_DATABASE_URL to the task-owned loopback test
database. Each test creates/drops only its own random schema. No production or
paid provider access occurs. Tables/constraints/indexes are read from migrations.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine

from models.reading_grammar_focus import ReadingGrammarFocusEditRequest
from services import reading_grammar_focus as service


pytestmark = pytest.mark.asyncio
MIGRATIONS = Path(__file__).parents[1] / 'migrations'
FOCUS = [{'point': 'Complex sentence', 'example': 'Ostrom showed that communities had managed resources.',
          'analysis': 'The original explanation.', 'review': '', 'tip': 'Keep the source.'},
         {'point': 'Timeline', 'analysis': 'Another unchanged point.'}]


def json_text(value):
    return json.dumps(value, ensure_ascii=False)


def req(revision, focus=None, operation=None):
    replacement = focus if focus is not None else [
        {**FOCUS[0], 'analysis': 'showed is the main-clause verb; had managed belongs to the that-clause.'},
        FOCUS[1],
    ]
    return ReadingGrammarFocusEditRequest.model_validate({
        'expected_revision': revision, 'operation_id': str(operation or uuid4()),
        'grammar_focus': replacement,
    })


@pytest_asyncio.fixture
async def pg():
    raw_url = os.environ.get('READING_GRAMMAR_FOCUS_TEST_DATABASE_URL')
    if not raw_url:
        pytest.skip('explicit local Reading grammar-focus PostgreSQL test database is not configured')
    url = make_url(raw_url)
    if (url.drivername != 'postgresql+asyncpg' or url.host not in ('127.0.0.1', 'localhost', '::1')
            or not (url.database or '').startswith('aver_ux_')):
        pytest.fail('Reading integration database must be a named aver_ux_ loopback test database')
    schema = 'aver_reading_focus_' + uuid4().hex
    bootstrap = create_async_engine(url)
    async with bootstrap.begin() as connection:
        await connection.execute(text(f'CREATE SCHEMA {schema}'))
    engine = create_async_engine(url, connect_args={
        'server_settings': {'search_path': schema, 'application_name': schema}})
    try:
        foundation = (MIGRATIONS / '086_reading_module_foundation.sql').read_text()
        audit = (MIGRATIONS / '107_governance_audit.sql').read_text()
        async with engine.begin() as connection:
            await connection.execute(text('CREATE TABLE users (id UUID PRIMARY KEY)'))
            for table, source in [('reading_tests', foundation), ('reading_passages', foundation),
                                  ('reading_questions', foundation), ('governance_audit', audit)]:
                match = re.search(r'CREATE TABLE IF NOT EXISTS ' + table + r' \([\s\S]*?\n\);', source)
                assert match, f'canonical migration table {table} missing'
                await connection.execute(text(match.group(0)))
            for source in (foundation, audit):
                for statement in re.findall(r'CREATE INDEX IF NOT EXISTS[\s\S]*?;', source):
                    await connection.execute(text(statement))
        yield engine, schema
    finally:
        await engine.dispose()
        async with bootstrap.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA {schema} CASCADE'))
        await bootstrap.dispose()


async def seed(engine, *, metadata=None, slug='synthetic-reading', library='l1_vocab', status='published'):
    passage, first_question, second_question = uuid4(), uuid4(), uuid4()
    if metadata is None:
        metadata = {'grammar_focus': FOCUS, 'translation_vi': 'Bản dịch không được thay đổi',
                    'image_blocks': [{'id': 'image-1', 'caption': 'Giữ nguyên'}],
                    'unknown_nested': {'bool': True, 'numbers': [1, 2.5], 'null': None}}
    async with engine.begin() as connection:
        await connection.execute(text("""
            INSERT INTO reading_passages
            (id, slug, library, title, body_markdown, glossary, metadata, status,
             image_url, image_public_id, topic_tags, word_count, estimated_minutes)
            VALUES (:id, :slug, :library, 'Synthetic source',
              'Ostrom showed that communities had managed resources.',
              CAST(:glossary AS jsonb), CAST(:metadata AS jsonb), :status,
              'https://example.test/image', 'fixture-image', ARRAY['environment'], 300, 5)
        """), {'id': passage, 'slug': slug, 'library': library, 'status': status,
               'glossary': json_text([{'term': 'commons', 'definition': 'Shared resource'}]),
               'metadata': json_text(metadata)})
        for index, question in enumerate((first_question, second_question), 1):
            await connection.execute(text("""
                INSERT INTO reading_questions
                (id, passage_id, q_num, question_type, prompt, payload, answer,
                 skill_tag, sub_skill, explanation, order_num)
                VALUES (:id, :passage, :number, 'mcq_single', 'Synthetic question',
                  CAST(:payload AS jsonb), CAST(:answer AS jsonb), 'detail',
                  'source evidence', 'Preserve this explanation.', :number)
            """), {'id': question, 'passage': passage, 'number': index,
                   'payload': json_text({'options': [{'label': 'A', 'text': 'A resource'}],
                                         'solution': {'steps': ['Giữ nguyên']}}),
                   'answer': json_text({'answer': 'PRIVATE_ANSWER_' + str(index)})})
    return passage, (first_question, second_question)


async def snapshot(engine, passage):
    async with engine.connect() as connection:
        row = (await connection.execute(text('SELECT * FROM reading_passages WHERE id = :id'),
                                        {'id': passage})).mappings().one()
        questions = (await connection.execute(text(
            'SELECT * FROM reading_questions WHERE passage_id = :id ORDER BY id'),
            {'id': passage})).mappings().all()
        audits = (await connection.execute(text('SELECT * FROM governance_audit ORDER BY id'))).mappings().all()
        return dict(row), [dict(item) for item in questions], [dict(item) for item in audits]


async def wait_for_lock(engine, application_name):
    for _ in range(100):
        async with engine.connect() as connection:
            blocked = (await connection.execute(text(
                "SELECT count(*) FROM pg_stat_activity WHERE application_name = :name "
                "AND wait_event_type = 'Lock'"), {'name': application_name})).scalar_one()
        if blocked:
            return
        await asyncio.sleep(.01)
    pytest.fail('the concurrent connection did not reach the real PostgreSQL lock wait')


async def test_actual_one_analysis_edit_preserves_all_other_values_questions_and_private_projection(pg):
    engine, _ = pg
    passage, _ = await seed(engine)
    original, original_questions, _ = await snapshot(engine, passage)
    read = await service.read_focus(engine, 'synthetic-reading')
    assert 'PRIVATE_ANSWER' not in read.model_dump_json()
    result = await service.edit_focus(engine, 'synthetic-reading', uuid4(), req(read.revision))
    updated, questions, audits = await snapshot(engine, passage)
    assert result.outcome == 'updated' and result.current_matches_committed
    assert updated['metadata']['grammar_focus'][0]['analysis'] != original['metadata']['grammar_focus'][0]['analysis']
    expected_metadata = {**original['metadata'], 'grammar_focus': req(read.revision).model_dump()['grammar_focus']}
    assert updated['metadata'] == expected_metadata
    assert updated['updated_at'] != original['updated_at']
    assert {key: value for key, value in updated.items() if key not in ('metadata', 'updated_at')} == {
        key: value for key, value in original.items() if key not in ('metadata', 'updated_at')}
    assert questions == original_questions and len(audits) == 1
    receipt = json.loads(audits[0]['detail'])
    assert receipt['original_focus'] == FOCUS
    assert receipt['new_focus'] == expected_metadata['grammar_focus']
    assert 'PRIVATE_ANSWER' not in audits[0]['detail']
    assert 'translation_vi' not in audits[0]['detail']
    reloaded = await service.read_focus(engine, 'synthetic-reading')
    assert reloaded.grammar_focus == result.grammar_focus and reloaded.revision == result.current_revision
    assert (read.source_sha256, read.unrelated_metadata_sha256, read.questions_sha256) == (
        result.source_sha256, result.unrelated_metadata_sha256, result.questions_sha256)


@pytest.mark.parametrize('metadata', [{}, {'grammar_focus': None}, {'grammar_focus': []}])
async def test_empty_legacy_noop_records_one_receipt_without_timestamp_or_metadata_rewrite(pg, metadata):
    engine, _ = pg
    passage, _ = await seed(engine, metadata=metadata)
    before = await snapshot(engine, passage)
    read = await service.read_focus(engine, 'synthetic-reading')
    actor, operation = uuid4(), req(read.revision, [])
    first = await service.edit_focus(engine, 'synthetic-reading', actor, operation)
    second = await service.edit_focus(engine, 'synthetic-reading', actor, operation)
    after = await snapshot(engine, passage)
    assert first.outcome == 'unchanged' and second.outcome == 'already_applied'
    assert first.committed_revision == second.current_revision == read.revision
    assert before[:2] == after[:2] and len(after[2]) == 1


async def test_explicit_empty_focus_removes_points_and_preserves_other_metadata(pg):
    engine, _ = pg
    passage, _ = await seed(engine)
    before, questions, _ = await snapshot(engine, passage)
    read = await service.read_focus(engine, 'synthetic-reading')
    result = await service.edit_focus(engine, 'synthetic-reading', uuid4(), req(read.revision, []))
    after, current_questions, _ = await snapshot(engine, passage)
    assert result.outcome == 'updated' and result.grammar_focus == []
    assert after['metadata'] == {**before['metadata'], 'grammar_focus': []}
    assert current_questions == questions


@pytest.mark.parametrize('change', ['metadata', 'body', 'title', 'question_answer', 'question_payload'])
async def test_unchanged_timestamp_source_metadata_and_question_drifts_conflict(pg, change):
    engine, _ = pg
    passage, questions = await seed(engine)
    read = await service.read_focus(engine, 'synthetic-reading')
    async with engine.begin() as connection:
        statements = {
            'metadata': "UPDATE reading_passages SET metadata = metadata || '{\"translation_vi\":\"Competing translation\"}'::jsonb WHERE id = :id",
            'body': "UPDATE reading_passages SET body_markdown = 'Competing body' WHERE id = :id",
            'title': "UPDATE reading_passages SET title = 'Competing title' WHERE id = :id",
            'question_answer': "UPDATE reading_questions SET answer = '{\"answer\":\"Competing key\"}'::jsonb WHERE id = :id",
            'question_payload': "UPDATE reading_questions SET payload = CAST(:payload AS jsonb) WHERE id = :id",
        }
        await connection.execute(text(statements[change]), {'id': questions[0] if change.startswith('question_') else passage,
                                                           'payload': json_text({'new': True})})
    competing = await snapshot(engine, passage)
    assert competing[0]['updated_at'] == read.updated_at
    with pytest.raises(service.ReadingGrammarFocusError) as error:
        await service.edit_focus(engine, 'synthetic-reading', uuid4(), req(read.revision))
    assert error.value.status_code == 409 and error.value.current_revision != read.revision
    assert await snapshot(engine, passage) == competing


async def test_lost_ack_retry_after_source_and_question_import_uses_saved_component_fingerprints(pg):
    engine, _ = pg
    passage, _ = await seed(engine)
    actor = uuid4()
    read = await service.read_focus(engine, 'synthetic-reading')
    operation = req(read.revision)
    committed = await service.edit_focus(engine, 'synthetic-reading', actor, operation)
    async with engine.begin() as connection:
        await connection.execute(text("UPDATE reading_passages SET body_markdown = 'Later imported source', "
            "metadata = '{\"grammar_focus\":[{\"point\":\"Later import\"}],\"translation_vi\":\"Later translation\"}'::jsonb WHERE id = :id"), {'id': passage})
        await connection.execute(text("UPDATE reading_questions SET answer = '{\"answer\":\"Later key\"}'::jsonb WHERE passage_id = :id"), {'id': passage})
    later = await snapshot(engine, passage)
    retried = await service.edit_focus(engine, 'synthetic-reading', actor, operation)
    assert retried.outcome == 'already_applied' and retried.current_matches_committed is False
    assert retried.committed_revision == committed.committed_revision
    assert retried.current_revision != committed.committed_revision
    assert retried.source_sha256 == committed.source_sha256 != retried.current_source_sha256
    assert retried.unrelated_metadata_sha256 == committed.unrelated_metadata_sha256 != retried.current_unrelated_metadata_sha256
    assert retried.questions_sha256 == committed.questions_sha256 != retried.current_questions_sha256
    assert [item.model_dump() for item in retried.grammar_focus] == [{'point': 'Later import'}]
    assert await snapshot(engine, passage) == later


@pytest.mark.parametrize('reused', ['focus', 'revision'])
async def test_same_actor_passage_operation_id_reuse_rejects_changed_payload(pg, reused):
    engine, _ = pg
    passage, _ = await seed(engine)
    actor, read = uuid4(), await service.read_focus(engine, 'synthetic-reading')
    first = req(read.revision)
    await service.edit_focus(engine, 'synthetic-reading', actor, first)
    before = await snapshot(engine, passage)
    changed = first.model_dump(mode='json')
    if reused == 'revision':
        changed['expected_revision'] = 'f' * 64
    else:
        changed['grammar_focus'] = [{'point': 'Another payload'}]
    with pytest.raises(service.ReadingGrammarFocusError) as error:
        await service.edit_focus(engine, 'synthetic-reading', actor, ReadingGrammarFocusEditRequest.model_validate(changed))
    assert error.value.status_code == 409 and error.value.error_code.endswith('operation_conflict')
    assert await snapshot(engine, passage) == before


@pytest.mark.parametrize('noop', [False, True])
async def test_concurrent_identical_operations_serialize_to_one_audit_receipt(pg, monkeypatch, noop):
    engine, name = pg
    passage, _ = await seed(engine)
    read = await service.read_focus(engine, 'synthetic-reading')
    actor, operation = uuid4(), req(read.revision, FOCUS if noop else None)
    locked, release = asyncio.Event(), asyncio.Event()
    original = service._receipt
    calls = 0
    async def pause_first(*args):
        nonlocal calls
        calls += 1
        if calls == 1:
            locked.set()
            await release.wait()
        return await original(*args)
    monkeypatch.setattr(service, '_receipt', pause_first)
    first = asyncio.create_task(service.edit_focus(engine, 'synthetic-reading', actor, operation))
    await asyncio.wait_for(locked.wait(), 2)
    second = asyncio.create_task(service.edit_focus(engine, 'synthetic-reading', actor, operation))
    try:
        await wait_for_lock(engine, name)
    finally:
        release.set()
    results = await asyncio.gather(first, second)
    assert sorted(item.outcome for item in results) == ['already_applied', 'unchanged' if noop else 'updated']
    assert len((await snapshot(engine, passage))[2]) == 1


@pytest.mark.parametrize('mutation', ['question_update', 'question_delete', 'question_insert', 'parent_update'])
async def test_real_parent_question_and_immediate_fk_locks_fence_competing_writes(pg, monkeypatch, mutation):
    engine, _ = pg
    passage, questions = await seed(engine)
    read = await service.read_focus(engine, 'synthetic-reading')
    locked, release = asyncio.Event(), asyncio.Event()
    original = service._receipt
    async def pause(*args):
        locked.set()
        await release.wait()
        return await original(*args)
    monkeypatch.setattr(service, '_receipt', pause)
    task = asyncio.create_task(service.edit_focus(engine, 'synthetic-reading', uuid4(), req(read.revision)))
    await asyncio.wait_for(locked.wait(), 2)
    statements = {
        'question_update': "UPDATE reading_questions SET prompt = 'Competing' WHERE id = :question",
        'question_delete': 'DELETE FROM reading_questions WHERE id = :question',
        'parent_update': "UPDATE reading_passages SET title = 'Competing' WHERE id = :passage",
        'question_insert': "INSERT INTO reading_questions (passage_id,q_num,question_type,prompt,skill_tag) VALUES (:passage,3,'mcq_single','Competing','detail')",
    }
    try:
        with pytest.raises(DBAPIError) as error:
            async with engine.begin() as connection:
                await connection.execute(text("SET LOCAL lock_timeout = '150ms'"))
                await connection.execute(text(statements[mutation]), {'passage': passage, 'question': questions[0]})
        assert error.value.orig.sqlstate == '55P03'
    finally:
        release.set()
    assert (await task).outcome == 'updated'
    current, current_questions, _ = await snapshot(engine, passage)
    assert current['title'] == 'Synthetic source' and len(current_questions) == 2


async def test_import_paused_after_question_delete_conflicts_and_zero_question_scope_still_fences_insert(pg, monkeypatch):
    engine, _ = pg
    passage, _ = await seed(engine)
    initial = await service.read_focus(engine, 'synthetic-reading')
    # Existing importer uses separate requests: parent update, DELETE, INSERT.
    async with engine.begin() as connection:
        await connection.execute(text("UPDATE reading_passages SET body_markdown = 'Import source' WHERE id=:id"), {'id': passage})
    async with engine.begin() as connection:
        await connection.execute(text('DELETE FROM reading_questions WHERE passage_id=:id'), {'id': passage})
    with pytest.raises(service.ReadingGrammarFocusError) as error:
        await service.edit_focus(engine, 'synthetic-reading', uuid4(), req(initial.revision))
    assert error.value.status_code == 409
    assert not (await snapshot(engine, passage))[2]
    gap = await service.read_focus(engine, 'synthetic-reading')
    locked, release = asyncio.Event(), asyncio.Event()
    original = service._receipt
    async def pause(*args):
        locked.set()
        await release.wait()
        return await original(*args)
    monkeypatch.setattr(service, '_receipt', pause)
    task = asyncio.create_task(service.edit_focus(engine, 'synthetic-reading', uuid4(), req(gap.revision)))
    await asyncio.wait_for(locked.wait(), 2)
    try:
        with pytest.raises(DBAPIError) as insert_error:
            async with engine.begin() as connection:
                await connection.execute(text("SET LOCAL lock_timeout = '150ms'"))
                await connection.execute(text("INSERT INTO reading_questions (passage_id,q_num,question_type,prompt,skill_tag) VALUES (:id,1,'mcq_single','Later import','detail')"), {'id': passage})
        assert insert_error.value.orig.sqlstate == '55P03'
    finally:
        release.set()
    assert (await task).outcome == 'updated'
    # The narrow editor is not a permanent fence against the existing importer.
    async with engine.begin() as connection:
        await connection.execute(text("INSERT INTO reading_questions (passage_id,q_num,question_type,prompt,skill_tag) VALUES (:id,1,'mcq_single','Later import','detail')"), {'id': passage})
    assert (await service.read_focus(engine, 'synthetic-reading')).questions_sha256 != gap.questions_sha256


async def test_audit_failure_rolls_back_content_and_uses_safe_error(pg):
    engine, _ = pg
    passage, _ = await seed(engine)
    before = await snapshot(engine, passage)
    read = await service.read_focus(engine, 'synthetic-reading')
    async with engine.begin() as connection:
        await connection.execute(text("""CREATE FUNCTION fail_focus_audit() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'PRIVATE_TEST_SQL_DETAIL'; END; $$"""))
        await connection.execute(text('CREATE TRIGGER fail_focus_audit BEFORE INSERT ON governance_audit FOR EACH ROW EXECUTE FUNCTION fail_focus_audit()'))
    with pytest.raises(service.ReadingGrammarFocusError) as error:
        await service.edit_focus(engine, 'synthetic-reading', uuid4(), req(read.revision))
    assert error.value.status_code == 503 and 'PRIVATE_TEST_SQL_DETAIL' not in str(error.value.as_detail())
    assert await snapshot(engine, passage) == before


@pytest.mark.parametrize('corrupt', ['duplicate', 'invalid_json', 'hash', 'outcome', 'payload_fingerprint'])
async def test_duplicate_corrupt_matching_receipts_fail_closed_without_rewriting_content(pg, corrupt):
    engine, _ = pg
    passage, _ = await seed(engine)
    actor, read = uuid4(), await service.read_focus(engine, 'synthetic-reading')
    operation = req(read.revision)
    await service.edit_focus(engine, 'synthetic-reading', actor, operation)
    _, _, audits = await snapshot(engine, passage)
    detail = json.loads(audits[0]['detail'])
    async with engine.begin() as connection:
        if corrupt == 'duplicate':
            await connection.execute(text('INSERT INTO governance_audit(action,admin_id,detail) VALUES(:action,:actor,:detail)'), {'action': service.ACTION, 'actor': actor, 'detail': audits[0]['detail']})
        else:
            if corrupt == 'invalid_json':
                raw = '{"passage_id":"' + str(passage) + '","operation_id":"' + str(operation.operation_id) + '",INVALID'
            else:
                if corrupt == 'payload_fingerprint':
                    detail['new_focus'] = [{'point': 'Corrupted committed payload'}]
                    detail['after_focus_sha256'] = service._hash(detail['new_focus'])
                else:
                    detail['after_focus_sha256' if corrupt == 'hash' else 'outcome'] = '0' * 64 if corrupt == 'hash' else 'unknown'
                raw = json_text(detail)
            await connection.execute(text('UPDATE governance_audit SET detail=:detail WHERE id=:id'), {'id': audits[0]['id'], 'detail': raw})
    before = await snapshot(engine, passage)
    with pytest.raises(service.ReadingGrammarFocusError) as error:
        await service.edit_focus(engine, 'synthetic-reading', actor, operation)
    assert error.value.status_code == 503 and error.value.error_code.endswith('receipt_invalid')
    assert await snapshot(engine, passage) == before


async def test_other_action_non_json_logs_are_never_cast_or_misinterpreted(pg):
    engine, _ = pg
    passage, _ = await seed(engine)
    actor, read = uuid4(), await service.read_focus(engine, 'synthetic-reading')
    operation = req(read.revision)
    async with engine.begin() as connection:
        await connection.execute(text('INSERT INTO governance_audit(action,admin_id,detail) VALUES(:action,:actor,:detail)'),
            {'action': 'impersonate', 'actor': actor, 'detail': 'NOT JSON "passage_id":"' + str(passage) + '","operation_id":"' + str(operation.operation_id) + '"'})
    assert (await service.edit_focus(engine, 'synthetic-reading', actor, operation)).outcome == 'updated'
    assert (await service.edit_focus(engine, 'synthetic-reading', actor, operation)).outcome == 'already_applied'


async def test_large_metadata_survives_without_rest_transport_caps(pg):
    engine, _ = pg
    metadata = {'grammar_focus': FOCUS, 'translation_vi': 'Bản dịch🙂\n' * 30000,
                'deep': {'arrays': [{'preserve': index} for index in range(100)]}}
    passage, _ = await seed(engine, metadata=metadata)
    read = await service.read_focus(engine, 'synthetic-reading')
    await service.edit_focus(engine, 'synthetic-reading', uuid4(), req(read.revision))
    current = (await snapshot(engine, passage))[0]['metadata']
    assert current['translation_vi'] == metadata['translation_vi'] and current['deep'] == metadata['deep']


@pytest.mark.parametrize('metadata', [[], 'invalid', {'grammar_focus': 'invalid'}, {'grammar_focus': [{'point': 'x', 'analysis': None}]}])
async def test_malformed_stored_values_never_mutate(pg, metadata):
    engine, _ = pg
    passage, _ = await seed(engine, metadata=metadata)
    before = await snapshot(engine, passage)
    for operation in [service.read_focus(engine, 'synthetic-reading'),
                      service.edit_focus(engine, 'synthetic-reading', uuid4(), req('a' * 64))]:
        with pytest.raises(service.ReadingGrammarFocusError) as error:
            await operation
        assert error.value.status_code == 503
    assert await snapshot(engine, passage) == before


async def test_missing_and_other_library_records_remain404(pg):
    engine, _ = pg
    await seed(engine, library='l2_skill')
    for slug in ['missing', 'synthetic-reading']:
        with pytest.raises(service.ReadingGrammarFocusError) as error:
            await service.read_focus(engine, slug)
        assert error.value.status_code == 404


async def test_deferrable_fk_is_unavailable_before_any_edit(pg):
    engine, _ = pg
    passage, _ = await seed(engine)
    read = await service.read_focus(engine, 'synthetic-reading')
    async with engine.begin() as connection:
        name = (await connection.execute(text("SELECT conname FROM pg_constraint WHERE conrelid=to_regclass('reading_questions') AND contype='f'"))).scalar_one()
        assert re.fullmatch(r'[a-z_]+', name)
        await connection.execute(text(f'ALTER TABLE reading_questions DROP CONSTRAINT {name}'))
        await connection.execute(text('ALTER TABLE reading_questions ADD FOREIGN KEY (passage_id) REFERENCES reading_passages(id) DEFERRABLE INITIALLY IMMEDIATE'))
    before = await snapshot(engine, passage)
    with pytest.raises(service.ReadingGrammarFocusError) as error:
        await service.edit_focus(engine, 'synthetic-reading', uuid4(), req(read.revision))
    assert error.value.status_code == 503 and error.value.error_code.endswith('lock_unavailable')
    assert await snapshot(engine, passage) == before
