"""Completeness without renumbering or disclosing protected feedback."""
import json
from copy import deepcopy
import pytest
from fastapi import HTTPException
from services.listening_source_supplements import catalog, supplemental_questions
from services.listening_source_native import revision


def display_fixture(day):
    rows = [row for row in catalog()['questions'] if row['day'] == day]
    blocks = [{'block_id': bid, 'native': value['presentation']} for bid, value in revision()['blocks'].items() if bid.startswith(f'80-days:day-{day:02d}:')]
    positions = [{**row, 'reason_vi': 'Thiếu audio hoặc chưa có đáp án tin cậy.', 'answer': 'PROTECTED', 'explanation': {'answer':'SECRET'}} for row in rows]
    return blocks, positions


def test_all_80_day_counts_and_104_previously_excluded_questions_have_native_controls():
    data = catalog()
    assert sum(day['source_position_count'] for day in data['days']) == 1676
    assert sum(day['response_field_count'] for day in data['days']) == 1689
    assert len(data['questions']) == len({row['item_id'] for row in data['questions']}) == 104
    total = 0
    for day in range(1,81):
        blocks, positions = display_fixture(day)
        questions, count = supplemental_questions(data['source_manifest_sha256'], day, blocks, positions)
        assert count == data['days'][day-1]['response_field_count']
        assert all(question['prompt'] for question in questions)
        wire = json.dumps(questions)
        assert all(secret not in wire for secret in ['PROTECTED','SECRET','"explanation"','"answer"','"q_num"'])
        total += len(questions)
    assert total == 104


def test_missing_or_changed_native_or_position_binding_fails_closed():
    blocks, positions = display_fixture(1)
    with pytest.raises(HTTPException): supplemental_questions(catalog()['source_manifest_sha256'],1,[],positions)
    changed=deepcopy(positions);changed[0]['block_id']='another-block'
    with pytest.raises(HTTPException): supplemental_questions(catalog()['source_manifest_sha256'],1,blocks,changed)
    assert supplemental_questions('another-revision',1,blocks,positions) == ([],None)
