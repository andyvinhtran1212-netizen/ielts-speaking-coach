"""Offline academic deltas and SQL boundaries; fixtures are staging content only."""
from copy import deepcopy
import json
from pathlib import Path
import re
import subprocess
import sys
import uuid

import pytest

from content_mock_correction import cambridge_audit_20261116 as builder
from services.listening_test_grader import answer_matches

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/cambridge_audit_20261116.json').read_text())
STAMP = '2026-11-14T11:35:11+00:00'


def paper(group, environment='prod'):
    _, identity, code = builder.PAPERS[environment][group]
    return {'id': identity, 'test_id': code, 'status': 'published' if environment == 'prod' else 'draft',
            'is_public': False, 'exam_only': True, 'mock_content_revision': 53,
            'policy_revision': 2, 'updated_at': STAMP, 'preserve_policy': {'a': "don't change"}}


def object_row(group, number, payload, environment='prod'):
    p = paper(group, environment)
    book, test = (20, 4) if group == 'c03b' else (17, 2)
    oid = f'cambridge-{book}-test-{test}-listening-q{number:02d}'
    return {'id': str(uuid.uuid5(uuid.NAMESPACE_URL, group + environment)),
            'object_id': f"mock-{p['id']}-listening-q{number:02d}",
            'listening_test_id': p['id'], 'reading_test_id': None, 'skill': 'listening',
            'source_test_key': f'cambridge-{book}-test-{test}', 'book_number': book, 'test_number': test,
            'question_number': number, 'content_version': 'captured-version', 'is_current': True,
            'binding_status': 'BOUND', 'created_at': STAMP, 'source_hash': 'source-evidence-preserved',
            'rights_status': 'BLOCKED_PENDING_RIGHTS_REVIEW',
            'editorial_status': 'GENERATED_REQUIRES_EDITORIAL_REVIEW',
            'payload': {'object_id': oid, **deepcopy(payload), 'unknown_prod_field': {'retain': True}}}


def q8_entries(environment='prod', *, already_correct=False):
    obj = object_row('c03b', 8, FIXTURE['q8'], environment)
    obj['payload']['item']['answer']['accepted_forms'] = ['2.30', 'two thirty']
    # Runtime discovery supplies these unknown prod fields; they are targeted,
    # while trap and every other explanation field stay byte-for-byte unchanged.
    obj['payload']['explanation']['answer_summary'] = '2.30 / two thirty'
    obj['payload']['explanation']['marking_note'] = 'two thirty'
    key = {'id': builder.Q8_ROW, 'content_id': 'b22c7393-df83-535d-a3cb-3e27327a6f81',
           'updated_at': STAMP, 'payload': {'answers': [
               {'q_num': 7, 'answer': 'unchanged', 'alternatives': []},
               {'q_num': 8, 'answer': '2.30', 'alternatives': ['two thirty', '2:30']}],
               'instruction': 'Retain instruction', 'solutions': {'9': "don't touch"}}}
    if already_correct:
        key['payload']['answers'][1]['alternatives'] = ['2:30']
        obj['payload'] = builder.repair_q8_object(obj['payload'])
    return [{'target': target, 'paper': paper('c03b', environment), 'row': row}
            for target, row in [('c03b-key', key), ('c03b-object', obj)]]


def prod_snapshot():
    return {'environment': 'prod', 'entries': q8_entries() + [{
        'target': 'v2b-object', 'paper': paper('v2b'),
        'row': object_row('v2b', 31, FIXTURE['q31'])}]}


def staging_snapshot():
    p = deepcopy(FIXTURE['x1']['paper'])
    # Old export predates these revision columns; use explicit synthetic values.
    p.update(mock_content_revision=83, policy_revision=1,
             preserve_policy={'quote_probe': "don't change"})
    return {'environment': 'staging', 'entries': [
        {'target': f'x1-{kind}-{number}', 'paper': deepcopy(p), 'row': deepcopy(next(
            r for r in FIXTURE['x1'][source] if r[field] == number))}
        for kind, source, field in [('question', 'questions', 'q_num'),
                                    ('object', 'objects', 'question_number')]
        for number in (38, 39, 40)]}


def test_prod_only_approved_fields_change_and_input_is_preserved():
    snapshot = prod_snapshot()
    original = deepcopy(snapshot)
    plan = builder.build_plan(snapshot)
    assert snapshot == original
    assert len(plan['changes']) == 3
    for c in plan['changes']:
        before, after = c['before'], c['after']
        assert c['before_sha256'] == builder.sha(before)
        assert c['after_sha256'] == builder.sha(after)
        assert c['changed']
        reverted = deepcopy(after)
        if c['target'] == 'c03b-key':
            answer = after['payload']['answers'][1]
            assert answer == {'q_num': 8, 'answer': '2.30', 'alternatives': ['2:30']}
            reverted['payload']['answers'][1]['alternatives'] = ['two thirty', '2:30']
        else:
            fields = (['item.answer.accepted_forms', 'explanation.answer_summary', 'explanation.marking_note']
                      if c['target'] == 'c03b-object' else list(builder.SPEC['q31']['fields']))
            for path in fields:
                builder.put(reverted['payload'], path, builder.at(before['payload'], path))
            if c['target'] == 'c03b-object':
                assert after['payload']['item']['answer']['accepted_forms'] == ['2.30', '2:30']
                assert 'Không viết **two thirty**' in after['payload']['explanation']['trap']
                assert after['payload']['explanation']['marking_note'] is None
                assert after['payload']['explanation']['answer_summary'] == 'Đáp án chuẩn: 2.30.'
            else:
                assert after['payload']['item']['answer']['canonical'] == '321,000'
                assert after['payload']['item']['answer']['accepted_forms'] == ['321,000', '321000']
                assert 'đều được chấp nhận' in after['payload']['explanation']['trap']
        assert reverted == before


def test_x1_source_options_and_keys_remain_aligned_without_touching_q37():
    snapshot = staging_snapshot()
    original = deepcopy(snapshot)
    plan = builder.build_plan(snapshot)
    assert snapshot == original
    assert len(plan['changes']) == 6
    for c in plan['changes']:
        number = int(c['target'].split('-')[-1])
        assert number in (38, 39, 40)
        expected = next(q for q in builder.SPEC['x1']['questions'] if q['q_num'] == number)
        before, after = c['before'], c['after']
        reverted = deepcopy(after)
        if c['table'] == 'reading_questions':
            assert after['answer'] == expected['answer']
            assert after['payload']['options'] == expected['options']
            reverted['payload']['options'] = before['payload']['options']
        else:
            assert after['payload']['item']['options'] == {o['label']: o['text'] for o in expected['options']}
            reverted['payload']['item']['options'] = before['payload']['item']['options']
        assert reverted == before
    # Academic source checks independent of the builder's transformations.
    by_q = {q['q_num']: q for q in builder.SPEC['x1']['questions']}
    assert by_q[38]['options'][2]['text'] == 'artificial intelligence developing independent thought'
    assert by_q[39]['options'][1]['text'] == 'how fundamental robots are to the science fiction genre'
    assert by_q[40]['options'][2]['text'] == 'recommending a change of approach in how people view them'
    assert FIXTURE['x1']['questions'][0]['answer']['answer'] == 'B'


@pytest.mark.parametrize('environment', ['prod', 'staging'])
def test_sql_guards_atomicity_and_write_allowlist(environment):
    snapshot = prod_snapshot() if environment == 'prod' else staging_snapshot()
    sql = builder.transaction_sql(snapshot)
    count = 3 if environment == 'prod' else 6
    assert sql.rstrip().endswith('ROLLBACK;')
    assert builder.transaction_sql(snapshot, rollback=False) == sql.removesuffix('ROLLBACK;\n') + 'COMMIT;\n'
    assert sql.count('GET DIAGNOSTICS touched = ROW_COUNT') == count
    assert sql.count('IF touched <> 1') == count
    assert sql.count('content readback mismatch') == count
    assert sql.index('fn_lock_mock_paper') < sql.index('UPDATE public.')
    assert sql.rindex('row pre-image or membership drift') < sql.index('UPDATE public.')
    assert 'to_jsonb(r)=' in sql and 'r.updated_at=' in sql
    assert 'paper identity/status/visibility/revision drift' in sql
    assert 'paper post-image drift' in sql
    assert 'public.listening_content WHERE test_id=' in sql if environment == 'prod' else 'public.reading_passages WHERE test_id=' in sql
    tables = re.findall(r'UPDATE public\.(\w+) r SET (\w+)=', sql)
    assert len(tables) == count
    assert set(tables) <= {('reading_questions', 'payload'), ('listening_exercises', 'payload'),
                           ('web_explanation_objects', 'payload')}
    assert not re.search(r'\b(CREATE|ALTER|DROP|DELETE|INSERT|TRUNCATE)\b', sql)
    assert not re.search(r'public\.\w*(attempt|score|snapshot|notification)\w*', sql)
    assert "don''t" in sql


@pytest.mark.parametrize('already_correct', [False, True])
def test_optional_staging_q8_is_guarded_and_does_not_rewrite_target_state(already_correct):
    snapshot = staging_snapshot()
    snapshot['entries'] += q8_entries('staging', already_correct=already_correct)
    plan = builder.build_plan(snapshot)
    q8 = [c for c in plan['changes'] if c['target'].startswith('c03b')]
    assert [c['changed'] for c in q8] == [not already_correct] * 2
    sql = builder.transaction_sql(snapshot)
    assert sql.count('GET DIAGNOSTICS touched = ROW_COUNT') == (6 if already_correct else 8)
    assert builder.Q8_PAPER in sql



def test_staging_historical_q8_two_thirty_only_before_image():
    snapshot = staging_snapshot()
    snapshot['entries'] += q8_entries('staging')
    snapshot['entries'][-2]['row']['payload']['answers'][1]['alternatives'] = ['two thirty']
    plan = builder.build_plan(snapshot)
    key = next(c for c in plan['changes'] if c['target'] == 'c03b-key')
    assert key['after']['payload']['answers'][1] == {
        'q_num': 8, 'answer': '2.30', 'alternatives': ['2:30']}


@pytest.mark.parametrize('value,expected', [
    ('2.30', True), ('2:30', True), (' 2.30 ', True), ('2.30.', True), ('(2:30)', True),
    ('two thirty', False), ('Two Thirty', False), ('two-thirty', False), ('half past two', False),
    ('14:30', False), ('14.30', False), ('02:30', False), ('2.3', False), ('2 30', False),
    ('230', False), ('2,30', False), ('2-30', False), ('2.30pm', False), ('2.30 pm', False),
    ('2:30 p.m.', False), ('2.30 p.m', False), ('1.30', False), ('12.30', False),
])
def test_real_grader_q8_regression(value, expected):
    key = builder.repair_q8(prod_snapshot()['entries'][0]['row']['payload'], 'prod')['answers'][1]
    assert answer_matches(value, key['answer'], key['alternatives']) is expected
    if value in ('two thirty', 'Two Thirty'):
        assert answer_matches(value, '2.30', ['two thirty', '2:30'])


@pytest.mark.parametrize('target,path,value', [
    ('c03b-key', 'id', '00000000-0000-0000-0000-000000000001'),
    ('c03b-key', 'updated_at', None),
    ('c03b-key', 'payload.answers', [{'q_num': 8, 'answer': '2.30', 'alternatives': ['two thirty']}]),
    ('c03b-key', 'payload.answers', [{'q_num': 8, 'answer': '2.30', 'alternatives': ['2:30']}]),
    ('c03b-key', 'payload.answers', [{'q_num': 8, 'answer': '2.30', 'alternatives': ['two thirty', '2:30'], 'response_policy': {}}]),
    ('c03b-object', 'payload.item.answer.accepted_forms', ['2.30', 'half past two']),
    ('c03b-object', 'payload.explanation.trap', 'Warning removed'),
    ('c03b-object', 'object_id', 'cambridge-20-test-4-listening-q08'),
    ('c03b-object', 'listening_test_id', builder.Q31_PAPER),
    ('c03b-object', 'is_current', False),
    ('c03b-object', 'book_number', 17),
    ('c03b-object', 'content_version', ''),
    ('v2b-object', 'payload.explanation.trap', 'Unknown CM text'),
    ('v2b-object', 'payload.explanation.marking_note', 'Unexpected existing note'),
    ('v2b-object', 'payload.item.answer.canonical', '321000'),
])
def test_prod_mismatches_refuse_before_sql(target, path, value):
    snapshot = prod_snapshot()
    entry = next(e for e in snapshot['entries'] if e['target'] == target)
    if '.' in path:
        builder.put(entry['row'], path, value)
    else:
        entry['row'][path] = value
    with pytest.raises((ValueError, KeyError)):
        builder.transaction_sql(snapshot)


@pytest.mark.parametrize('mutator', [
    lambda s: s['entries'].pop(),
    lambda s: s['entries'].append(deepcopy(s['entries'][0])),
    lambda s: s.update(environment='unknown'),
    lambda s: s['entries'][0]['paper'].update(status='published'),
    lambda s: s['entries'][0]['paper'].update(is_public=True),
    lambda s: s['entries'][0]['paper'].update(mock_content_revision=None),
    lambda s: s['entries'][0]['row'].update(prompt='Unexpected stem'),
    lambda s: s['entries'][0]['row'].update(answer={'answer': 'B', 'alternatives': []}),
    lambda s: s['entries'][0]['row']['payload'].update(options=[]),
    lambda s: s['entries'][-1]['row']['payload']['item'].update(options={}),
])
def test_staging_mismatch_and_incomplete_snapshots_refuse(mutator):
    snapshot = staging_snapshot()
    mutator(snapshot)
    with pytest.raises(ValueError):
        builder.transaction_sql(snapshot)


def test_pending_cm_text_and_reserved_delimiter_fail_closed(monkeypatch):
    snapshot = prod_snapshot()
    pending = deepcopy(builder.SPEC)
    pending['q31']['fields']['explanation.trap']['after'] = '__CM_TEXT_PENDING__'
    with monkeypatch.context() as m:
        m.setattr(builder, 'SPEC', pending)
        with pytest.raises(ValueError, match='CM text pending'):
            builder.transaction_sql(snapshot)
    snapshot['entries'][0]['row']['payload']['unrelated'] = '__CM_TEXT_PENDING__'
    with pytest.raises(ValueError, match='CM text pending'):
        builder.transaction_sql(snapshot)
    snapshot['entries'][0]['row']['payload']['unrelated'] = builder.TAG
    with pytest.raises(ValueError, match='reserved SQL delimiter'):
        builder.transaction_sql(snapshot)


def test_cli_writes_complete_hashed_artifacts_and_nothing_on_refusal(tmp_path):
    preimage = tmp_path / 'pre.json'
    preimage.write_text(json.dumps(staging_snapshot()))
    prefix = tmp_path / 'batch'
    command = [sys.executable, '-m', 'content_mock_correction.cambridge_audit_20261116',
               str(preimage), '--out-prefix', str(prefix)]
    result = subprocess.run(command, capture_output=True, text=True, check=True)
    assert '6 changes; files only; no DB write' in result.stdout
    hashes = json.loads((tmp_path / 'batch.sha256.json').read_text())
    import hashlib
    assert len(hashes) == 3
    for name, expected in hashes.items():
        assert hashlib.sha256((tmp_path / name).read_bytes()).hexdigest() == expected
    bad = staging_snapshot()
    bad['entries'].pop()
    preimage.write_text(json.dumps(bad))
    bad_prefix = tmp_path / 'refused'
    result = subprocess.run(command[:-1] + [str(bad_prefix)], capture_output=True, text=True)
    assert result.returncode != 0
    assert not list(tmp_path.glob('refused*'))


def test_q8_runtime_explanation_override_cannot_restore_written_answer():
    from services.mock_correction_service import apply_scoring_overrides
    before = prod_snapshot()
    row = next(e['row'] for e in before['entries'] if e['target'] == 'c03b-object')
    row['payload']['audit'] = {'release_adjudication': {
        'override_version': 'cambridge-release-overrides/1.0'}}
    key = [{'q_num': 8, 'answer': '2.30', 'alternatives': ['2:30']}]
    old_overlay = apply_scoring_overrides('listening', builder.Q8_PAPER, key, frozen_rows=[row])[0]
    assert answer_matches('two thirty', old_overlay['answer'], old_overlay['alternatives'])
    plan = builder.build_plan(before)
    after = next(c['after'] for c in plan['changes'] if c['target'] == 'c03b-object')
    overlay = apply_scoring_overrides('listening', builder.Q8_PAPER, key, frozen_rows=[after])[0]
    assert not answer_matches('two thirty', overlay['answer'], overlay['alternatives'])
    assert answer_matches('2.30', overlay['answer'], overlay['alternatives'])
    assert answer_matches('2:30', overlay['answer'], overlay['alternatives'])
