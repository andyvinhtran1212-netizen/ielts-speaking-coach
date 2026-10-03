"""Native metadata at actual serialized submitted/revealed API boundaries."""
from __future__ import annotations
import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID
from fastapi import FastAPI, HTTPException
import httpx
import pytest
from models.listening_source_collection import SOURCE_CONTRACT, SOURCE_PROGRAMME
from routers import listening as router
from services.listening_test_grader import grade_report_only_attempt

NATIVE = json.loads((Path(__file__).parent / 'fixtures/listening_source_round1/native-multi-gap-excerpts.json').read_text())
ATTEMPT = UUID('00000000-0000-0000-0000-000000001234')


def native_payload():
    questions, protected, answers = [], {}, []
    for q_num, item in enumerate(NATIVE['items'], 1):
        response = item['response']
        questions.append({'q_num': q_num, 'source_item_id': item['item_id'],
            'source_display_number': item['source_display_number'], 'prompt': response['prompt'],
            'response_type': response['type'], 'fields': deepcopy(response['fields']), 'evaluation_mode': 'self_review'})
        explanation = deepcopy(item['explanation_vi'])
        protected[str(q_num)] = {'review_status': item['independent_review']['verdict'],
            'review_accepted': True, 'reviewer': item['independent_review']['reviewer'],
            'answer_provenance': 'editorial_verified', 'explanation': explanation, 'rationale': explanation['why_vi'],
            'reference_answers': [f'{key}: {value}' for key, value in explanation['answer'].items()]}
        answers.append({'q_num': q_num, 'user_answer': json.dumps(dict(reversed(list(explanation['answer'].items()))))})
    return {'variant': 'programme_form_v1', 'source_contract': SOURCE_CONTRACT, 'questions': questions,
            'answers': [], 'self_review': protected, 'audio_windows': {}, 'controlled_transcripts': {}}, answers


@pytest.fixture()
def boundary(monkeypatch):
    payload, answers = native_payload()
    report = grade_report_only_attempt(answers, [{'payload': payload}], source_required=True)
    assert all(item['state'] == 'unscored' for item in report['per_question'])
    db = SimpleNamespace(payload=payload, answers=answers, rpc_calls=[], policy_rpc_calls=[], queries=[],
        test={'id': 'test-id', 'test_id': 'native-source', 'programme_id': SOURCE_PROGRAMME,
              'status': 'published', 'is_public': True, 'content_package_id': 'source-package',
              'scoring_policy': 'report_only', 'replay_policy': 'allowed',
              'metadata': {'timing_granularity': 'whole_day', 'author_audit': 'HIDDEN_METADATA'}},
        package={'id': 'source-package', 'status': 'published'},
        section={'id': 'section', 'test_id': 'test-id', 'section_num': 1, 'status': 'published'},
        exercise_status='published',
        attempt={'id': str(ATTEMPT), 'user_id': 'owner', 'test_id': 'test-id', 'status': 'submitted',
                 'scoring_policy': 'report_only', 'grading_details': report['per_question']})
    db.active_attempt = {**deepcopy(db.attempt), 'status': 'in_progress',
                         'resume_expires_at': '2099-01-01T00:00:00Z'}
    db.selected_attempt = db.attempt
    class Query:
        def __init__(self, name):
            self.name = name; self.columns = None; self.filters = []; self.order_column = None; self.row_limit = None
        def select(self, columns):
            self.columns = columns; return self
        def eq(self, column, value):
            self.filters.append(('eq', column, value)); return self
        def in_(self, column, values):
            self.filters.append(('in', column, values)); return self
        def order(self, column):
            self.order_column = column; return self
        def limit(self, count):
            self.row_limit = count; return self
        def execute(self):
            assert self.columns is not None
            rows = {'listening_tests': [db.test], 'listening_content_packages': [db.package],
                    'listening_content': [db.section],
                    'listening_exercises': [{'content_id': 'section', 'status': db.exercise_status, 'payload': db.payload}],
                    'listening_programme_feedback_reveals': [{'attempt_id': str(ATTEMPT), 'q_num': 1, 'first_answer': db.answers[0]['user_answer'],
                        'revealed_at': '2026-10-01T01:00:00Z'}]}
            selected = deepcopy(rows[self.name])
            for kind, column, value in self.filters:
                selected = [row for row in selected if (row.get(column) == value if kind == 'eq' else row.get(column) in value)]
            if self.order_column: selected.sort(key=lambda row: row[self.order_column])
            if self.row_limit is not None: selected = selected[:self.row_limit]
            db.queries.append({'table': self.name, 'columns': self.columns, 'filters': deepcopy(self.filters)})
            # Model PostgREST projection, so an omitted authored column is not
            # silently returned by the fixture. No context helper is replaced.
            if self.columns != '*':
                selected = [{column: row.get(column) for column in self.columns.split(',')} for row in selected]
            return SimpleNamespace(data=selected)
    class Admin:
        def table(self, name): return Query(name)
        def rpc(self, name, args):
            if name == 'fn_guard_owned_mock_attempt':
                db.policy_rpc_calls.append((name, deepcopy(args)))
                attempt = args['p_attempt']
                assert args['p_skill'] == 'listening'
                identity = (attempt['id'] == str(ATTEMPT)
                            and attempt['user_id'] == 'owner'
                            and attempt['test_id'] == db.test['id'])
                submitted_read = (attempt['status'] == 'submitted'
                                  and args['p_purpose'] in {'review', 'flags_read'})
                active = (attempt['status'] == 'in_progress'
                          and datetime.fromisoformat(attempt['resume_expires_at'].replace('Z', '+00:00'))
                          > datetime.now(timezone.utc))
                return SimpleNamespace(execute=lambda: SimpleNamespace(data={
                    'allowed': identity and (submitted_read or active)
                    and not attempt.get('sitting_id')}))
            assert name == 'fn_record_listening_programme_feedback_reveal'
            db.rpc_calls.append((name, args))
            return SimpleNamespace(execute=lambda: SimpleNamespace(data=[{
                'first_answer': db.answers[args['p_q_num'] - 1]['user_answer'],
                'revealed_at': '2026-10-01T01:00:00Z', 'was_created': True}]))
    async def auth(_): return {'id': 'owner'}
    async def not_admin(_): return False
    def owned(_attempt, owner):
        assert _attempt == str(ATTEMPT) and owner == 'owner'
        if db.selected_attempt['user_id'] != owner: raise HTTPException(403, 'not owner')
        return deepcopy(db.selected_attempt)
    monkeypatch.setattr(router, '_require_auth', auth)
    monkeypatch.setattr(router, '_is_admin', not_admin)
    monkeypatch.setattr(router, '_fetch_attempt_or_404', owned)
    monkeypatch.setattr(router, 'supabase_admin', Admin())
    monkeypatch.setattr(router, '_student_audio_url_for_test', lambda _: ('/signed-covered-source.mp3', None, 123))
    from services import mock_correction_service
    monkeypatch.setattr(mock_correction_service, 'capture_required_envelope', lambda *_args, **_kwargs: None)
    app = FastAPI(); app.include_router(router.user_router)
    return app, db


def request(boundary, method, suffix):
    app, db = boundary
    db.selected_attempt = db.attempt if suffix == 'review' else db.active_attempt
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://fixture') as client:
            return await client.request(method, f'/api/listening/tests/attempts/{ATTEMPT}/{suffix}')
    return asyncio.run(run())


def test_twelve_native_positions_twenty_five_fields_in_serialized_review_and_reveal(boundary):
    assert NATIVE['source_manifest_sha256'] == '29819c11a65c71762d7912c919c459df306ed61209a36311a8e23c0d21f83841'
    assert len(NATIVE['items']) == 12 and sum(len(i['response']['fields']) for i in NATIVE['items']) == 25
    _app, db = boundary
    response = request(boundary, 'GET', 'review')
    assert response.status_code == 200
    body = response.json()
    assert body['audio_granularity'] == 'whole_day'
    assert body['replay_policy'] == 'allowed' and body['audio_url'] == '/signed-covered-source.mp3'
    assert len(body['review']) == 12
    for q_num, (item, row) in enumerate(zip(NATIVE['items'], body['review']), 1):
        fields = item['response']['fields']
        assert row['fields'] == fields and row['source_item_id'] == item['item_id']
        assert row['audio_window'] is None
        assert row['user_answer'] == db.answers[q_num - 1]['user_answer']
        reveal = request(boundary, 'POST', f'questions/{q_num}/reveal')
        assert reveal.status_code == 200
        rows = reveal.json()['items']
        assert len(rows) == 1 and rows[0]['q_num'] == q_num and rows[0]['fields'] == fields
        assert rows[0]['first_answer'] == db.answers[q_num - 1]['user_answer'] and rows[0]['audio_window'] is None
        assert rows[0]['audio_granularity'] == 'whole_day'
    guided = request(boundary, 'GET', 'guided-state')
    assert guided.status_code == 200
    assert [r['q_num'] for r in guided.json()['items']] == [1]
    assert guided.json()['items'][0]['fields'] == NATIVE['items'][0]['response']['fields']
    assert guided.json()['items'][0]['audio_granularity'] == 'whole_day'
    for table in ['listening_content', 'listening_exercises']:
        assert any(query['table'] == table and ('eq', 'status', 'published') in query['filters'] for query in db.queries)


def test_nested_field_authoring_never_crosses_either_api_allowlist(boundary):
    _app, db = boundary
    db.payload['questions'][0]['fields'][0].update(answer='HIDDEN_ANSWER', explanation={'quote': 'HIDDEN_ANSWER'}, audit='HIDDEN_AUDIT', expected=['HIDDEN_EXPECTED'])
    for method, endpoint in [('GET', 'review'), ('GET', 'guided-state'), ('POST', 'questions/1/reveal')]:
        response = request(boundary, method, endpoint)
        assert response.status_code == 200 and 'HIDDEN_' not in response.text
        items = response.json().get('review', response.json().get('items'))
        assert set(items[0]['fields'][0]) == {'field_id', 'prompt', 'word_limit'}


@pytest.mark.parametrize('defect', ['missing', 'empty', 'duplicate', 'changed_id', 'removed_field', 'whitespace_id', 'blank_label', 'numeric_label', 'string_limit', 'bool_limit', 'zero_limit', 'negative_limit', 'wrong_container'])
def test_invalid_definition_fails_before_reveal_persistence_and_on_review_reload(boundary, defect):
    _app, db = boundary
    question = db.payload['questions'][0]; fields = question['fields']
    if defect == 'missing': question.pop('fields')
    elif defect == 'empty': question['fields'] = []
    elif defect == 'duplicate': fields[1]['field_id'] = fields[0]['field_id']
    elif defect == 'changed_id': fields[0]['field_id'] = 'other_valid_but_unbound_id'
    elif defect == 'removed_field': fields.pop()
    elif defect == 'whitespace_id': fields[0]['field_id'] = ' country '
    elif defect == 'blank_label': fields[0]['prompt'] = '  '
    elif defect == 'numeric_label': fields[0]['prompt'] = 12
    elif defect == 'string_limit': fields[0]['word_limit'] = '2'
    elif defect == 'bool_limit': fields[0]['word_limit'] = True
    elif defect == 'zero_limit': fields[0]['word_limit'] = 0
    elif defect == 'negative_limit': fields[0]['word_limit'] = -2
    else: question['fields'] = {'country': 'Country'}
    for method, endpoint in [('POST', 'questions/1/reveal'), ('GET', 'guided-state'), ('GET', 'review')]:
        response = request(boundary, method, endpoint)
        assert response.status_code == 503 and 'other_valid_but_unbound_id' not in response.text
    assert db.rpc_calls == []


@pytest.mark.parametrize('granularity', [None, 'whole_day', 'whole_part', 'none'])
def test_source_audio_granularity_is_metadata_not_a_window_fallback(boundary, granularity):
    _app, db = boundary
    db.test['metadata'] = {} if granularity is None else {'timing_granularity': granularity}
    response = request(boundary, 'GET', 'review')
    assert response.status_code == 200 and response.json()['audio_granularity'] == granularity
    assert all(row['audio_window'] is None for row in response.json()['review'])
    for method, suffix in [('GET', 'guided-state'), ('POST', 'questions/1/reveal')]:
        guided = request(boundary, method, suffix)
        assert guided.status_code == 200
        assert guided.json()['items'][0]['audio_granularity'] == granularity


def test_generic_submitted_review_and_guided_keep_exact_window_and_empty_fields(boundary):
    _app, db = boundary
    db.test['programme_id'] = 'ielts-listening-practice'
    db.payload.clear()
    db.payload.update({'variant': 'programme_form_v1',
        'questions': [{'q_num': 1, 'response_type': 'single_choice', 'source_item_id': 'generic-one'}],
        'answers': [{'q_num': 1, 'answers': ['B']}],
        'solutions': {'1': {'rationale': 'The speaker says B.'}},
        'audio_windows': {'1': {'start': 2, 'end': 5}}})
    db.answers[0]['user_answer'] = 'A'
    db.attempt['grading_details'] = grade_report_only_attempt(
        [db.answers[0]], [{'payload': db.payload}], source_required=False)['per_question']
    response = request(boundary, 'GET', 'review')
    assert response.status_code == 200 and response.json()['audio_granularity'] is None
    assert response.json()['review'][0]['audio_window'] == {'start': 2, 'end': 5}
    assert response.json()['review'][0]['fields'] == []
    for method, suffix in [('GET', 'guided-state'), ('POST', 'questions/1/reveal')]:
        guided = request(boundary, method, suffix)
        assert guided.status_code == 200
        assert guided.json()['items'][0]['audio_window'] == {'start': 2, 'end': 5}
        assert guided.json()['items'][0]['fields'] == []
        assert guided.json()['items'][0]['audio_granularity'] is None


@pytest.mark.parametrize('defect', ['unpublished_test', 'private_test', 'unpublished_package', 'unpublished_exercise'])
def test_real_guided_context_publication_guards_run_before_reveal_rpc(boundary, defect):
    _app, db = boundary
    if defect == 'unpublished_test': db.test['status'] = 'draft'
    elif defect == 'private_test': db.test['is_public'] = False
    elif defect == 'unpublished_package': db.package['status'] = 'draft'
    else: db.exercise_status = 'draft'
    for method, suffix in [('GET', 'guided-state'), ('POST', 'questions/1/reveal')]:
        assert request(boundary, method, suffix).status_code == (503 if defect == 'unpublished_exercise' else 422)
    assert db.rpc_calls == []


@pytest.mark.parametrize('defect', ['submitted', 'expired', 'foreign_owner'])
def test_real_guided_context_active_owner_guards_run_before_reveal_rpc(boundary, defect):
    _app, db = boundary
    if defect == 'submitted': db.active_attempt['status'] = 'submitted'
    elif defect == 'expired': db.active_attempt['resume_expires_at'] = '2000-01-01T00:00:00Z'
    else: db.active_attempt['user_id'] = 'foreign-owner'
    for method, suffix in [('GET', 'guided-state'), ('POST', 'questions/1/reveal')]:
        assert request(boundary, method, suffix).status_code == {'submitted': 409, 'expired': 410, 'foreign_owner': 403}[defect]
    assert db.rpc_calls == []


def test_review_requires_submitted_owner_and_available_audio(boundary, monkeypatch):
    _app, db = boundary
    db.attempt['status'] = 'in_progress'
    assert request(boundary, 'GET', 'review').status_code == 409
    db.attempt['status'] = 'submitted'
    monkeypatch.setattr(router, '_student_audio_url_for_test', lambda _: (None, None, None))
    assert request(boundary, 'GET', 'review').status_code == 503
    def foreign(*_): raise HTTPException(403, 'not owner')
    monkeypatch.setattr(router, '_fetch_attempt_or_404', foreign)
    assert request(boundary, 'GET', 'review').status_code == 403
