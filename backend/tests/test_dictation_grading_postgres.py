"""Actual PostgreSQL policy, legacy compatibility, expiry and finalizer tests.

Only a configured task-owned loopback aver_ux_ database is accepted. Each test
loads the canonical grading migration into a fresh disposable schema; no real
account, source or historical report is read or written.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest
import pytest_asyncio
from sqlalchemy.engine import make_url

from services.dictation_grading_version import grade_frozen_sentence, reference_sha256
from services.listening_grader import aggregate_dictation_report
from services.dictation_unicode15 import LEXICAL_RANGES, is_lexical_alnum

pytestmark = pytest.mark.asyncio
MIGRATIONS = Path(__file__).parents[1] / 'migrations'
UNITS = [{'text': '— Hello there.', 'start': 0, 'end': 3, 'hints': []}]


def migration(name):
    return (MIGRATIONS / name).read_text()


def table_sql(source, table):
    found = re.search(r'CREATE TABLE IF NOT EXISTS (?:public\.)?' + table + r' \([\s\S]*?\n\);', source)
    assert found, f'canonical table missing: {table}'
    return found.group(0)


def function_sql(source, name):
    found = re.search(r'CREATE OR REPLACE FUNCTION public\.' + name + r'\([\s\S]*?\n\$\$;', source)
    assert found, f'canonical function missing: {name}'
    return found.group(0)


@pytest_asyncio.fixture
async def pg():
    configured = os.environ.get('DICTATION_POLICY_TEST_DATABASE_URL')
    if not configured:
        pytest.skip('explicit task-owned Dictation PostgreSQL database is not configured')
    url = make_url(configured)
    if (url.drivername != 'postgresql+asyncpg' or url.host not in ('127.0.0.1', 'localhost', '::1')
            or not (url.database or '').startswith('aver_ux_')):
        pytest.fail('Dictation integration requires an aver_ux_ loopback database')
    connection = await asyncpg.connect(user=url.username, password=url.password,
        host=url.host, port=url.port or 5432, database=url.database)
    schema = 'aver_dictation_policy_' + uuid4().hex
    local = lambda sql: sql.replace('public.', schema + '.').replace('public, pg_temp', schema + ', pg_temp')
    await connection.execute(f'CREATE SCHEMA {schema}')
    try:
        # Minimal FK identities only. All three business table definitions and
        # critical guards/finalizer below come from committed migrations.
        await connection.execute(f'SET search_path = {schema}')
        await connection.execute('CREATE TABLE users (id UUID PRIMARY KEY); CREATE TABLE listening_tests (id UUID PRIMARY KEY)')
        for role in ('anon', 'authenticated', 'service_role'):
            # Supabase's service role bypasses RLS. Roles are cluster-wide:
            # a bare role here would break the private INVOKER migration tests
            # that run later, even when they use another test database.
            options = ' BYPASSRLS' if role == 'service_role' else ''
            await connection.execute(f"DO $$ BEGIN CREATE ROLE {role}{options}; EXCEPTION WHEN duplicate_object THEN NULL; END $$")
        assert await connection.fetchval("SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role'"), (
            'The disposable test cluster requires service_role BYPASSRLS; use a fresh cluster. '
            'This fixture does not alter an existing role.'
        )
        original = migration('220_dictation_attempt_affinity.sql')
        expiry = migration('224_active_player_resume_ttl.sql')
        for table, source in [('dictation_sessions', migration('138_dictation_sessions.sql')),
                              ('dictation_attempts', original), ('dictation_attempt_answers', original)]:
            await connection.execute(local(table_sql(source, table)))
        await connection.execute(local(migration('210_dictation_session_idempotency.sql')))
        attempt_fk = re.search(r'ALTER TABLE public.dictation_sessions\s+ADD COLUMN IF NOT EXISTS attempt_id[\s\S]*?;', original)
        assert attempt_fk
        await connection.execute(local(attempt_fk.group(0)))
        for index in re.findall(r'CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]*?;', original):
            await connection.execute(local(index))
        await connection.execute('ALTER TABLE dictation_attempts ADD COLUMN resume_expires_at TIMESTAMPTZ')
        for name, source in [
            ('fn_guard_dictation_attempt_answer_mutation', expiry),
            ('fn_finalize_dictation_attempt_from_session', original),
            ('fn_set_active_player_resume_expiry', expiry),
            ('fn_guard_dictation_session_completion', expiry),
        ]:
            await connection.execute(local(function_sql(source, name)))
        for source in (original, expiry):
            for statement in re.findall(r'CREATE TRIGGER[\s\S]*?;', source):
                if re.search(r'ON public\.dictation_(?:attempts|attempt_answers|sessions)\s', statement):
                    await connection.execute(local(statement))
        lexical = local(migration('305_dictation_frozen_grading_policy.sql'))
        await connection.execute(lexical)
        # Applying the additive migration twice must preserve existing schema.
        await connection.execute(lexical)
        await connection.set_type_codec('jsonb', schema='pg_catalog', encoder=json.dumps, decoder=json.loads, format='text')
        yield connection, schema
    finally:
        await connection.execute(f'DROP SCHEMA {schema} CASCADE')
        await connection.close()


async def seed(pg, *, version='lexical-v2', units=None, expired=False):
    connection, _ = pg
    units = copy.deepcopy(UNITS if units is None else units)
    actor, test, attempt = uuid4(), uuid4(), uuid4()
    # Deliberately compute the protocol digest without the application's size
    # guard: invalid-source cases must reach the real PostgreSQL boundary.
    digest = hashlib.sha256(('dictation-texts-v1\n' + ''.join(
        hashlib.sha256(item['text'].encode('utf-8')).hexdigest() for item in units)).encode()).hexdigest() if version is not None else None
    now = datetime.now(timezone.utc)
    started = now - timedelta(days=2) if expired else now
    await connection.execute('INSERT INTO users VALUES ($1)', actor)
    await connection.execute('INSERT INTO listening_tests VALUES ($1)', test)
    await connection.execute('''INSERT INTO dictation_attempts
        (id,user_id,test_id,section_num,units_snapshot,started_at,grading_version,reference_sha256)
        VALUES ($1,$2,$3,1,$4,$5,$6,$7)''', attempt, actor, test, units, started, version, digest)
    return {'id': attempt, 'user_id': actor, 'test_id': test, 'section_num': 1,
            'units_snapshot': units, 'grading_version': version, 'reference_sha256': digest}


def grade(row, index=0, user='Hello there.'):
    return grade_frozen_sentence(row, index, user, grading_version=row['grading_version'],
                                acknowledged_reference_sha256=row['reference_sha256'])


async def save(pg, row, *, index=0, user='Hello there.', changes=None):
    connection, _ = pg
    result = grade(row, index, user)
    values = {'attempt_id': row['id'], 'sentence_idx': index, 'user_transcript': user,
        'score': result['score'], 'correct_words': result['correct_words'], 'total_words': result['total_words'],
        'diff': result['diff'], 'listen_count': 0, 'time_seconds': None,
        'grading_version': row['grading_version'], 'reference_sha256': row['reference_sha256'],
        'sentence_reference_sha256': result['sentence_reference_sha256'] if row['grading_version'] == 'lexical-v2' else None,
        'grading_evidence': result if row['grading_version'] == 'lexical-v2' else None}
    values.update(changes or {})
    columns = ','.join(values)
    placeholders = ','.join(f'${index + 1}' for index in range(len(values)))
    await connection.execute(f'INSERT INTO dictation_attempt_answers ({columns}) VALUES ({placeholders})', *values.values())
    return result


async def complete(pg, row, results, *, changes=None):
    connection, _ = pg
    report = aggregate_dictation_report(results)
    items = []
    for index, result in enumerate(results):
        item = {'sentence_idx': index, 'reference': row['units_snapshot'][index]['text'],
            'user_text': result.get('user_text', 'Hello there.'), 'score': result['score'],
            'correct_words': result['correct_words'], 'total_words': result['total_words'],
            'diff': result['diff'], 'listen_count': 0, 'time_seconds': None}
        if row['grading_version'] == 'lexical-v2':
            item.update(grading_version='lexical-v2', reference_sha256=row['reference_sha256'],
                sentence_reference_sha256=result['sentence_reference_sha256'], grading_evidence=result)
        items.append(item)
    values = {'id': uuid4(), 'attempt_id': row['id'], 'user_id': row['user_id'], 'test_id': row['test_id'],
        'section_num': 1, 'total_sentences': report['total_sentences'], 'correct_count': report['correct_count'],
        'accuracy': report['accuracy'], 'total_words': report['total_words'], 'correct_words': report['correct_words'],
        'results': items, 'error_trends': report['error_trends'], 'grading_version': row['grading_version'],
        'reference_sha256': row['reference_sha256']}
    values.update(changes or {})
    placeholders = ','.join(f'${index + 1}' for index in range(len(values)))
    await connection.execute(f'INSERT INTO dictation_sessions ({",".join(values)}) VALUES ({placeholders})', *values.values())
    return values


async def test_actual_legacy_and_v2_finalize_with_different_frozen_denominators(pg):
    connection, _ = pg
    rows = []
    for version in (None, 'legacy-whitespace-v1', 'lexical-v2'):
        row = await seed(pg, version=version)
        result = await save(pg, row)
        session = await complete(pg, row, [result])
        assert await connection.fetchval('SELECT status FROM dictation_attempts WHERE id=$1', row['id']) == 'completed'
        assert session['total_words'] == (2 if version == 'lexical-v2' else 3)
        rows.append(session)
    assert rows[0]['accuracy'] == rows[1]['accuracy'] == .6667
    assert rows[2]['accuracy'] == 1


async def test_actual_mean_keeps_deployed_python_rounding_at_a_decimal_tie(pg):
    row = await seed(pg, units=[{'text': 'one two three'}, {'text': 'other words'}])
    results = [await save(pg, row, index=0, user='one'), await save(pg, row, index=1, user='')]
    assert [result['score'] for result in results] == [.3333, 0]
    report = await complete(pg, row, results)
    assert report['accuracy'] == aggregate_dictation_report(results)['accuracy'] == .1666
    assert float(await pg[0].fetchval('SELECT accuracy FROM dictation_sessions WHERE id=$1', report['id'])) == .1666


@pytest.mark.parametrize('change', [
    {'grading_version': None, 'reference_sha256': None, 'sentence_reference_sha256': None, 'grading_evidence': None},
    {'grading_version': 'legacy-whitespace-v1'}, {'reference_sha256': 'a' * 64},
    {'sentence_reference_sha256': 'b' * 64}, {'grading_evidence': None},
    {'grading_evidence': {}}, {'score': .5}, {'total_words': 3},
    {'user_transcript': 'Edited outside the reviewed grade'}, {'diff': []},
])
async def test_actual_unsupported_or_unbound_sentence_write_is_rejected_without_partial_row(pg, change):
    row = await seed(pg)
    with pytest.raises(asyncpg.PostgresError):
        await save(pg, row, changes=change)
    assert await pg[0].fetchval('SELECT count(*) FROM dictation_attempt_answers') == 0
    assert await pg[0].fetchval('SELECT status FROM dictation_attempts WHERE id=$1', row['id']) == 'in_progress'


@pytest.mark.parametrize('field,value', [('grading_version', None), ('reference_sha256', 'a' * 64),
    ('units_snapshot', [{'text': 'Changed after start'}]), ('section_num', 2)])
async def test_actual_attempt_policy_and_source_cannot_change(pg, field, value):
    row = await seed(pg)
    with pytest.raises(asyncpg.PostgresError, match='dictation_frozen_policy_immutable'):
        await pg[0].execute(f'UPDATE dictation_attempts SET {field}=$1 WHERE id=$2', value, row['id'])
    persisted = await pg[0].fetchrow('SELECT units_snapshot,grading_version,reference_sha256 FROM dictation_attempts WHERE id=$1', row['id'])
    assert dict(persisted) == {key: row[key] for key in persisted.keys()}


@pytest.mark.parametrize('change', [{'grading_version': None, 'reference_sha256': None},
    {'grading_version': 'legacy-whitespace-v1'}, {'reference_sha256': 'a' * 64},
    {'results': []}, {'total_words': 999}, {'correct_words': 0}, {'accuracy': .25},
    {'correct_count': 0}, {'total_sentences': 99}])
async def test_actual_report_mismatch_cannot_close_parent_or_persist_report(pg, change):
    row = await seed(pg)
    result = await save(pg, row)
    with pytest.raises(asyncpg.PostgresError):
        await complete(pg, row, [result], changes=change)
    assert await pg[0].fetchval('SELECT count(*) FROM dictation_sessions') == 0
    assert await pg[0].fetchval('SELECT status FROM dictation_attempts WHERE id=$1', row['id']) == 'in_progress'
    assert await pg[0].fetchval('SELECT count(*) FROM dictation_attempt_answers') == 1


async def test_actual_raw_codepoint_segments_reject_corruption_and_accept_non_bmp(pg):
    row = await seed(pg, units=[{'text': '🙂 — café hello.'}])
    result = grade(row, user='🙂 café hello.')
    corrupt = copy.deepcopy(result)
    corrupt['reference_segments'][0]['end'] = 2  # emoji is one code point, two UTF-16 code units
    with pytest.raises(asyncpg.PostgresError, match='dictation_policy_evidence_mismatch'):
        await save(pg, row, user='🙂 café hello.', changes={'grading_evidence': corrupt})
    correct = await save(pg, row, user='🙂 café hello.')
    await complete(pg, row, [correct])


async def test_actual_expiry_still_blocks_both_policy_save_and_finalization(pg):
    row = await seed(pg, expired=True)
    with pytest.raises(asyncpg.PostgresError, match='active_player_expired'):
        await save(pg, row)
    with pytest.raises(asyncpg.PostgresError, match='active_player_expired'):
        await complete(pg, row, [grade(row)])
    assert await pg[0].fetchval('SELECT count(*) FROM dictation_sessions') == 0


async def test_actual_completed_report_is_frozen_but_existing_test_and_account_erasure_work(pg):
    row = await seed(pg)
    report = await complete(pg, row, [await save(pg, row)])
    with pytest.raises(asyncpg.PostgresError, match='dictation_report_evidence_immutable'):
        await pg[0].execute('UPDATE dictation_sessions SET accuracy=0 WHERE id=$1', report['id'])
    await pg[0].execute('DELETE FROM listening_tests WHERE id=$1', row['test_id'])
    retained = await pg[0].fetchrow('SELECT test_id,attempt_id,reference_sha256,results FROM dictation_sessions WHERE id=$1', report['id'])
    assert retained['test_id'] is None and retained['attempt_id'] is None
    assert retained['reference_sha256'] == row['reference_sha256']
    assert retained['results'] == report['results']
    await pg[0].execute('DELETE FROM users WHERE id=$1', row['user_id'])
    assert await pg[0].fetchval('SELECT count(*) FROM dictation_sessions') == 0


@pytest.mark.parametrize('version', [None, 'lexical-v2'])
@pytest.mark.parametrize('identity', ['attempt_id', 'sentence_idx'])
async def test_actual_answer_cannot_move_from_completed_parent_or_change_its_index(pg, version, identity):
    old = await seed(pg, version=version, units=[{'text': 'Hello there.'}] * 2)
    results = [await save(pg, old, index=index) for index in range(2)]
    report = await complete(pg, old, results)
    other = await seed(pg, version=version, units=old['units_snapshot'])
    value = other['id'] if identity == 'attempt_id' else 2
    with pytest.raises(asyncpg.PostgresError, match='dictation_answer_identity_immutable'):
        await pg[0].execute(f'UPDATE dictation_attempt_answers SET {identity}=$1 WHERE attempt_id=$2 AND sentence_idx=0', value, old['id'])
    assert await pg[0].fetchval('SELECT count(*) FROM dictation_attempt_answers WHERE attempt_id=$1', old['id']) == 2
    assert await pg[0].fetchval('SELECT count(*) FROM dictation_attempt_answers WHERE attempt_id=$1', other['id']) == 0
    assert await pg[0].fetchval('SELECT results FROM dictation_sessions WHERE id=$1', report['id']) == report['results']


@pytest.mark.parametrize('version', [None, 'lexical-v2'])
@pytest.mark.parametrize('field', ['id', 'user_id', 'test_id', 'attempt_id', 'test_id_null',
                                  'attempt_id_null', 'section_num', 'client_request_id',
                                  'submission_fingerprint', 'test_id_external', 'completed_at'])
async def test_actual_report_identity_cannot_be_reassigned_or_detached_from_a_live_parent(pg, version, field):
    row = await seed(pg, version=version)
    receipt = uuid4()
    report = await complete(pg, row, [await save(pg, row)],
                            changes={'client_request_id': receipt, 'submission_fingerprint': 'a' * 64})
    other = await seed(pg, version=version)
    column = field.removesuffix('_null')
    values = {'id': uuid4(), 'user_id': other['user_id'], 'test_id': other['test_id'],
              'attempt_id': other['id'], 'test_id_null': None, 'attempt_id_null': None,
              'section_num': 2, 'client_request_id': uuid4(), 'submission_fingerprint': 'b' * 64,
              'test_id_external': 'another-test', 'completed_at': datetime.now(timezone.utc) + timedelta(days=1)}
    with pytest.raises(asyncpg.PostgresError, match='dictation_report_(?:identity|evidence)_immutable'):
        await pg[0].execute(f'UPDATE dictation_sessions SET {column}=$1 WHERE id=$2', values[field], report['id'])
    persisted = await pg[0].fetchrow('SELECT user_id,test_id,attempt_id,section_num,client_request_id,submission_fingerprint,results FROM dictation_sessions WHERE id=$1', report['id'])
    assert persisted['user_id'] == row['user_id'] and persisted['test_id'] == row['test_id']
    assert persisted['attempt_id'] == row['id'] and persisted['section_num'] == 1
    assert persisted['client_request_id'] == receipt and persisted['submission_fingerprint'] == 'a' * 64
    assert persisted['results'] == report['results']


async def test_actual_attempt_erasure_detaches_only_its_link_and_preserves_the_report(pg):
    row = await seed(pg)
    report = await complete(pg, row, [await save(pg, row)])
    before = dict(await pg[0].fetchrow('SELECT * FROM dictation_sessions WHERE id=$1', report['id']))
    await pg[0].execute('DELETE FROM dictation_attempts WHERE id=$1', row['id'])
    after = dict(await pg[0].fetchrow('SELECT * FROM dictation_sessions WHERE id=$1', report['id']))
    assert after == {**before, 'attempt_id': None}
    assert after['test_id'] == row['test_id']


@pytest.mark.parametrize('units', [[{'text': '. — 🙂'}], [{'text': ''}], [{'text': 'hello'}] * 201])
async def test_actual_invalid_new_reference_does_not_start(pg, units):
    with pytest.raises(asyncpg.PostgresError, match='dictation_reference_(without_words|unavailable)'):
        await seed(pg, units=units)
    assert await pg[0].fetchval('SELECT count(*) FROM dictation_attempts') == 0


@pytest.mark.parametrize('text,lexical', [('²', True), ('½', True), ('Ⅳ', True),
    ('٤', True), ('中文', True), ('café', True), ('\U0001e4d0', True), ('\U0001d400', True),
    ('\u0345', False), ('\u0301', False), ('🙂', False), ('Ⓐ', False), ('—', False)])
async def test_actual_new_source_uses_pinned_unicode_class_instead_of_posix_locale(pg, text, lexical):
    assert await pg[0].fetchval('SELECT fn_dictation_has_lexical_words($1)', text) is lexical
    if not lexical:
        with pytest.raises(asyncpg.PostgresError, match='dictation_reference_without_words'):
            await seed(pg, units=[{'text': text}])
        assert await pg[0].fetchval('SELECT count(*) FROM dictation_attempts') == 0
    else:
        row = await seed(pg, units=[{'text': text}])
        result = await save(pg, row, user=text)
        report = await complete(pg, row, [result])
        assert report['accuracy'] == 1 and report['total_words'] == 1


async def test_actual_sql_and_python_agree_at_every_unicode15_range_boundary(pg):
    codepoints = sorted({point for start, end in LEXICAL_RANGES for point in (start-1,start,end-1,end)
                         if 0 < point < 0x110000 and not 0xD800 <= point <= 0xDFFF})
    rows = await pg[0].fetch('''SELECT point, fn_dictation_has_lexical_words(chr(point)) AS lexical
        FROM unnest($1::integer[]) AS inputs(point)''', codepoints)
    assert len(rows) == len(codepoints)
    assert all(row['lexical'] is is_lexical_alnum(chr(row['point'])) for row in rows)


async def test_actual_finalizer_blocks_duplicates_and_late_sentence_updates(pg):
    connection, _ = pg
    row = await seed(pg)
    result = await save(pg, row)
    report = await complete(pg, row, [result])
    with pytest.raises(asyncpg.UniqueViolationError):
        await complete(pg, row, [result])
    with pytest.raises(asyncpg.PostgresError, match='active_player_expired'):
        await connection.execute('UPDATE dictation_attempt_answers SET listen_count=1 WHERE attempt_id=$1', row['id'])
    assert await connection.fetchval('SELECT count(*) FROM dictation_sessions') == 1
    assert await connection.fetchval('SELECT id FROM dictation_sessions') == report['id']
