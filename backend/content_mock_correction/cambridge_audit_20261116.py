"""Offline Batch A builder. Consumes RM's current pre-image; never opens a DB.

Reuses #2311/#2308's locked, full-pre-image CAS and rollback-by-default pattern.
See the adjacent JSON for academic deltas and Markdown for the capture contract.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import uuid

from scripts.sync_web_explanation_item_text import _options, _set_item_text

SPEC = json.loads(Path(__file__).with_suffix('.json').read_text(encoding='utf-8'))
TAG = '$cambridge_batch_a$'
Q8_PAPER = 'aa667c6d-1b95-5079-a38e-5dcd88a39f0d'
Q31_PAPER = '995b0273-8854-57a6-9065-450c3c13465e'
Q8_ROW = '64a259ec-eb66-5b69-ad4f-08d755d50405'
PAPERS = {
    'prod': {
        'c03b': ('listening', Q8_PAPER, 'MOCK0016-PROD-20261006-ILR-LIS-CAM-B20-T4-REV02'),
        'v2b': ('listening', Q31_PAPER, 'MOCK0016-PROD-20261006-ILR-LIS-CAM-B17-T2-REV01'),
        'q40': ('listening', Q31_PAPER, 'MOCK0016-PROD-20261006-ILR-LIS-CAM-B17-T2-REV01'),
    },
    'staging': {
        'c03b': ('listening', Q8_PAPER, 'MOCK0016-20261005-C20L4-REV02'),
        'x1': ('reading', SPEC['x1']['paper_id'], SPEC['x1']['test_id']),
        'q40': ('listening', SPEC['q40']['staging_paper_id'], SPEC['q40']['staging_test_id']),
    },
}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def sha(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def literal(value):
    text = canonical(value)
    if TAG in text:
        raise ValueError('Pre-image contains reserved SQL delimiter')
    return "'" + text.replace("'", "''") + "'::jsonb"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def at(value, path):
    for key in path.split('.'):
        value = value[key]
    return value


def put(value, path, after):
    parent, _, key = path.rpartition('.')
    at(value, parent)[key] = deepcopy(after)


def validate_paper(paper, expected, environment):
    skill, identity, code = expected
    require(paper.get('id') == identity and paper.get('test_id') == code,
            'Paper identity drift')
    require(paper.get('status') == ('published' if environment == 'prod' else 'draft')
            and paper.get('is_public') is False, 'Paper status/visibility drift')
    for key in ('mock_content_revision', 'policy_revision'):
        require(type(paper.get(key)) is int and paper[key] >= 0, 'Missing paper revision guard')
    require(bool(paper.get('updated_at')), 'Missing paper timestamp')
    return skill


def validate_object(row, paper, skill, source_id, number):
    source_key, _, _ = source_id.rpartition('-' + skill + '-q')
    book, test = int(source_key.split('-')[1]), int(source_key.split('-')[3])
    require(row.get('source_test_key') == source_key and row.get('book_number') == book
            and row.get('test_number') == test, 'Explanation academic identity drift')
    outer_id = (f"mock-{paper['id']}-{skill}-q{number:02d}"
                if paper['test_id'].startswith('MOCK') else source_id)
    require(row.get('object_id') == outer_id and row.get('payload', {}).get('object_id') == source_id,
            'Explanation source/bound identity drift')
    require(row.get(f'{skill}_test_id') == paper['id']
            and row.get('listening_test_id' if skill == 'reading' else 'reading_test_id') is None
            and row.get('skill') == skill and row.get('question_number') == number
            and row.get('binding_status') == 'BOUND' and row.get('is_current') is True,
            'Explanation membership/current-state drift')
    require(bool(row.get('content_version')) and bool(row.get('created_at')),
            'Missing explanation version/timestamp')


def repair_q8(payload, environment):
    result = deepcopy(payload)
    matches = [a for a in result.get('answers', []) if a.get('q_num') == 8]
    require(len(matches) == 1, 'Expected exactly one Q8 answer')
    answer = matches[0]
    expected = [SPEC['q8']['prod_before']]
    if environment == 'staging':
        expected.extend([['two thirty'], SPEC['q8']['after']])
    require(answer == {'q_num': 8, 'answer': '2.30', 'alternatives': answer.get('alternatives')}
            and answer['alternatives'] in expected, 'Q8 answer before-value drift')
    answer['alternatives'] = deepcopy(SPEC['q8']['after'])
    solution = result.get('solutions', {}).get('8')
    require(isinstance(solution, dict)
            and all(field in solution for field in SPEC['q8']['solution_fields']),
            'Missing Q8 solution field')
    for field, value in SPEC['q8']['solution_fields'].items():
        solution[field] = value
    return result


def repair_q8_object(payload):
    result = deepcopy(payload)
    answer = at(result, 'item.answer')
    require(answer.get('canonical') == '2.30' and answer.get('comparison_mode') == 'single_value'
            and answer.get('accepted_forms') in SPEC['q8']['accepted_before']
            and 'response_policy' not in answer, 'Q8 explanation answer drift')
    # Copy source-authored text, never generate replacement prose. Prod's other
    # explanation fields can differ; every non-target byte is preserved.
    require(at(result, 'explanation.trap') == SPEC['q8']['warning'], 'Q8 warning drift')
    answer['accepted_forms'] = deepcopy(SPEC['q8']['accepted_after'])
    for field in ('answer_summary', 'marking_note'):
        require(field in result['explanation'], 'Missing Q8 explanation field')
        result['explanation'][field] = SPEC['q8'][field]
    return result


def repair_q31_object(payload):
    result = deepcopy(payload)
    require(at(result, 'item.answer.canonical') == SPEC['q31']['canonical']
            and at(result, 'item.answer.comparison_mode') == 'single_value', 'Q31 answer drift')
    for path, delta in SPEC['q31']['fields'].items():
        require(at(result, path) == delta['before'], f'Q31 before-value drift: {path}')
        put(result, path, delta['after'])
    return result


def repair_q40_object(payload):
    result = deepcopy(payload)
    for path in SPEC['q40']['fields']:
        text = at(result, path)
        require(isinstance(text, str) and text.count(SPEC['q40']['before']) == 1,
                f'Q40 expected exactly one old substring: {path}')
        put(result, path, text.replace(SPEC['q40']['before'], SPEC['q40']['after'], 1))
    return result


def build_plan(snapshot):
    """Validate complete scoped sets, preserving unknown non-target payload fields."""
    require('__CM_TEXT_PENDING__' not in canonical(SPEC)
            and '__CM_TEXT_PENDING__' not in canonical(snapshot), 'CM text pending')
    environment = snapshot.get('environment')
    require(environment in PAPERS, 'Unknown environment')
    entries = snapshot.get('entries')
    require(isinstance(entries, list) and bool(entries), 'Missing entries')
    required = ({'c03b-key', 'c03b-object', 'v2b-object'} if environment == 'prod' else
                {f'x1-{kind}-{n}' for kind in ('question', 'object') for n in (38, 39, 40)})
    allowed = required | {'q40-object'} | (
        {'c03b-key', 'c03b-object', 'q40-key'} if environment == 'staging' else set())
    names = [entry.get('target') for entry in entries]
    require(len(names) == len(set(names)) and required <= set(names) <= allowed,
            'Incomplete, duplicate or out-of-scope target set')
    require('c03b-object' not in names or 'c03b-key' in names, 'Q8 object requires key capture')
    if environment == 'staging':
        for expected in SPEC['x1']['questions']:
            object_id = f"cambridge-20-test-3-reading-q{expected['q_num']}"
            current = [e['row'] for e in entries if e['row'].get('object_id') == object_id
                       and e['row'].get('is_current') is True]
            require(len(current) == 1, f'X1 expected exactly one current row: {object_id}')
            require(current[0]['id'].startswith(expected['object_row_id_prefix']),
                    f'X1 unexpected current row prefix: {object_id}')
        require(('q40-key' in names) == ('q40-object' in names),
                'Staging Q40 requires its Q31 key capture')
    q40_enabled = 'q40-object' in names
    skipped = []
    if not q40_enabled:
        skipped.append({'target': 'q40-object', 'reason': 'Q40 object absent from capture'})
    elif environment == 'staging':
        key = next(e['row'] for e in entries if e['target'] == 'q40-key')
        answers = [a for a in key.get('payload', {}).get('answers', []) if a.get('q_num') == 31]
        require(len(answers) == 1 and answers[0].get('answer') == '321,000'
                and isinstance(answers[0].get('alternatives'), list), 'Q31 staging key drift')
        q40_enabled = '321000' in answers[0]['alternatives']
        if not q40_enabled:
            skipped.append({'target': 'q40-object', 'reason': 'Staging Q31 key does not accept 321000'})
    changes, guards, papers, seen = [], [], {}, set()
    for entry in sorted(entries, key=lambda x: x['target']):
        target, paper, row = entry['target'], entry['paper'], entry['row']
        group = target.split('-')[0]
        skill = validate_paper(paper, PAPERS[environment][group], environment)
        paper_key = (skill, paper['id'])
        require(paper_key not in papers or papers[paper_key] == paper, 'Inconsistent paper snapshots')
        papers[paper_key] = deepcopy(paper)
        require(str(uuid.UUID(row['id'])) == row['id'], 'Invalid row UUID')
        table = ('web_explanation_objects' if '-object' in target else
                 'reading_questions' if group == 'x1' else 'listening_exercises')
        require((table, row['id']) not in seen, 'Duplicate physical row')
        seen.add((table, row['id']))
        after = deepcopy(row)
        if table != 'web_explanation_objects':
            require(bool(row.get('updated_at')), 'Missing content timestamp')
        if target == 'c03b-key':
            require(row['id'] == Q8_ROW, 'Q8 row identity drift')
            require(bool(row.get('content_id')), 'Missing listening content membership')
            uuid.UUID(row['content_id'])
            after['payload'] = repair_q8(row['payload'], environment)
        elif target == 'c03b-object':
            validate_object(row, paper, skill, 'cambridge-20-test-4-listening-q08', 8)
            after['payload'] = repair_q8_object(row['payload'])
        elif target == 'v2b-object':
            validate_object(row, paper, skill, 'cambridge-17-test-2-listening-q31', 31)
            after['payload'] = repair_q31_object(row['payload'])
        elif target == 'q40-key':
            require(row['id'] == SPEC['q40']['staging_key_id']
                    and row.get('content_id') == SPEC['q40']['staging_content_id'],
                    'Q31 staging key identity drift')
        elif target == 'q40-object':
            validate_object(row, paper, skill, 'cambridge-17-test-2-listening-q40', 40)
            if q40_enabled:
                after['payload'] = repair_q40_object(row['payload'])
        else:
            number = int(target.rsplit('-', 1)[1])
            expected = next(q for q in SPEC['x1']['questions'] if q['q_num'] == number)
            if table == 'reading_questions':
                require(all(row.get(k) == expected[k] for k in ('id', 'q_num', 'prompt', 'answer'))
                        and row.get('passage_id') == SPEC['x1']['passage_id']
                        and row.get('question_type') == 'mcq_single', 'X1 question identity/key drift')
                require(row['payload'].get('options') == SPEC['x1']['options_before'], 'X1 options drift')
                after['payload']['options'] = deepcopy(expected['options'])
            else:
                validate_object(row, paper, skill, f'cambridge-20-test-3-reading-q{number}', number)
                require(row['id'].startswith(expected['object_row_id_prefix']),
                        'X1 object row identity drift')
                # Same authored {label: text} representation used by existing
                # sync_web_explanation_item_text._options; no version rollover.
                before_options = _options(SPEC['x1']['options_before'])
                answer = row['payload']['item']['answer']
                require(row['payload']['item'].get('options') == before_options
                        and answer.get('canonical') == expected['answer']['answer']
                        and answer.get('accepted_forms') == [expected['answer']['answer']],
                        'X1 explanation options/key drift')
                _set_item_text(after['payload']['item'], 'options', _options(expected['options']))
        destination = guards if target == 'q40-key' or (target == 'q40-object' and not q40_enabled) else changes
        destination.append({'target': target, 'skill': skill, 'paper_id': paper['id'], 'table': table,
                        'before': deepcopy(row), 'after': after, 'before_sha256': sha(row),
                        'after_sha256': sha(after), 'changed': row != after})
    # Never silently repair drift between the two canonical Q8 representations.
    if 'c03b-object' in names:
        obj = next(c for c in changes if c['target'] == 'c03b-object')
        require(obj['after']['payload']['item']['answer']['accepted_forms'] == ['2.30', '2:30'],
                'Q8 post-image mismatch')
    return {'package': SPEC['package'], 'environment': environment,
            'papers': [{'skill': skill, 'before': paper} for (skill, _), paper in sorted(papers.items())],
            'changes': changes, 'guards': guards, 'skipped': skipped,
            'q8_key_only': 'c03b-key' in names and 'c03b-object' not in names}


def transaction_sql(snapshot, *, rollback=True):
    """Rebuild/validate before rendering; arbitrary prepared changes are not accepted."""
    plan = build_plan(snapshot)
    statements = ['-- Offline builder only; execution requires separate approval.',
                  f"-- {SPEC['package']} environment={plan['environment']} pre_image_sha256={sha(snapshot)}",
                  'BEGIN;',
                  "SET LOCAL lock_timeout = '5s';", "SET LOCAL statement_timeout = '30s';",
                  'SET LOCAL standard_conforming_strings = on;',
                  f'DO {TAG} DECLARE actual jsonb; touched integer; BEGIN']
    for p in plan['papers']:
        skill, paper = p['skill'], p['before']
        statements += [
            f"PERFORM public.fn_lock_mock_paper('{skill}', '{paper['id']}'::uuid);",
            f"SELECT to_jsonb(t) INTO actual FROM public.{skill}_tests t WHERE id='{paper['id']}'::uuid FOR UPDATE;",
            f"IF actual IS DISTINCT FROM {literal(paper)} THEN RAISE EXCEPTION 'paper identity/status/visibility/revision drift'; END IF;",
        ]
    if plan['q8_key_only']:
        # With no captured object pre-image, refuse if any bound Q8 version exists.
        # RM must re-capture the key+object pair before using the paired path.
        statements.append(
            "IF (SELECT count(*) FROM public.web_explanation_objects "
            f"WHERE listening_test_id='{Q8_PAPER}'::uuid AND skill='listening' "
            "AND question_number=8 AND binding_status='BOUND') <> 0 THEN "
            "RAISE EXCEPTION 'Q8 bound object appeared; capture key/object pair'; END IF;")
    if plan['environment'] == 'staging':
        for q in SPEC['x1']['questions']:
            statements.append(
                "IF (SELECT count(*) FROM public.web_explanation_objects "
                f"WHERE object_id='cambridge-20-test-3-reading-q{q['q_num']}' "
                "AND is_current IS TRUE) <> 1 THEN "
                "RAISE EXCEPTION 'X1 current object cardinality drift'; END IF;")
    # Assert every captured row (including no-ops and skipped Q40 guards) before any update.
    for c in plan['changes'] + plan['guards']:
        row, table, paper_id = c['before'], c['table'], c['paper_id']
        row_id = str(uuid.UUID(row['id']))
        if table == 'web_explanation_objects':
            membership = f"r.{c['skill']}_test_id='{paper_id}'::uuid"
        else:
            child, fk = (('reading_passages', 'passage_id') if table == 'reading_questions'
                         else ('listening_content', 'content_id'))
            membership = f"r.{fk} IN (SELECT id FROM public.{child} WHERE test_id='{paper_id}'::uuid)"
        c['where'] = f"r.id='{row_id}'::uuid AND to_jsonb(r)={literal(row)} AND {membership}"
        if table != 'web_explanation_objects':
            timestamp = "'" + row['updated_at'].replace("'", "''") + "'::timestamptz"
            c['where'] += f' AND r.updated_at={timestamp}'
        statements += [
            f"SELECT to_jsonb(r) INTO actual FROM public.{table} r WHERE {c['where']} FOR UPDATE;",
            "IF actual IS NULL THEN RAISE EXCEPTION 'row pre-image or membership drift'; END IF;",
        ]
    for c in plan['changes']:
        if not c['changed']:
            continue
        table, row = c['table'], c['after']
        statements += [
            f"UPDATE public.{table} r SET payload={literal(row['payload'])} WHERE {c['where']};",
            "GET DIAGNOSTICS touched = ROW_COUNT; IF touched <> 1 THEN RAISE EXCEPTION 'expected one updated row'; END IF;",
            f"SELECT to_jsonb(r) - 'updated_at' INTO actual FROM public.{table} r WHERE id='{row['id']}'::uuid;",
            f"IF actual IS DISTINCT FROM ({literal(row)} - 'updated_at') THEN RAISE EXCEPTION 'content readback mismatch'; END IF;",
        ]
    # Existing source triggers bump once per changed content/explanation row.
    for p in plan['papers']:
        skill, before = p['skill'], p['before']
        bumps = sum(c['changed'] for c in plan['changes'] if c['paper_id'] == before['id'])
        expected = {**before, 'mock_content_revision': before['mock_content_revision'] + bumps}
        statements += [
            f"SELECT to_jsonb(t) - 'updated_at' INTO actual FROM public.{skill}_tests t WHERE id='{before['id']}'::uuid;",
            f"IF actual IS DISTINCT FROM ({literal(expected)} - 'updated_at') THEN RAISE EXCEPTION 'paper post-image drift'; END IF;",
        ]
    statements += [f'END {TAG};', 'ROLLBACK;' if rollback else 'COMMIT;']
    return '\n'.join(statements) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pre_image', type=Path)
    parser.add_argument('--out-prefix', type=Path, required=True)
    args = parser.parse_args()
    snapshot = json.loads(args.pre_image.read_text(encoding='utf-8'))
    plan = build_plan(snapshot)
    artifacts = {'.changes.json': json.dumps(plan, ensure_ascii=False, indent=2) + '\n',
                 '.rollback.sql': transaction_sql(snapshot),
                 '.commit.sql': transaction_sql(snapshot, rollback=False)}
    # Render every artifact successfully before writing the first one.
    hashes = {}
    for suffix, body in artifacts.items():
        path = Path(str(args.out_prefix) + suffix)
        path.write_text(body, encoding='utf-8')
        hashes[path.name] = hashlib.sha256(body.encode()).hexdigest()
    Path(str(args.out_prefix) + '.sha256.json').write_text(json.dumps(hashes, indent=2) + '\n')
    print(f"{plan['environment']}: {sum(c['changed'] for c in plan['changes'])} changes; files only; no DB write")


if __name__ == '__main__':
    main()
