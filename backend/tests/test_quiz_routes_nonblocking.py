"""PC-J428: HTTP concurrency, serialization threads and wire parity."""
import asyncio
import json
import threading
import time
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace

import httpx
import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.routing import APIRoute, serialize_response
from starlette.responses import JSONResponse

import database
from config import settings
from routers import auth, quiz
from services import access_code_permissions as permissions
from services.activation_gate import require_active_learner

BANK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
SESSION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
HOT = [
    ('GET', f'/api/quiz/banks/{BANK}', 'get_bank_for_play', None, 200),
    ('GET', f'/api/quiz/banks/{BANK}/course-resume', 'get_course_resume', None, 200),
    ('POST', '/api/quiz/sessions', 'start_session', {'bank_id': BANK}, 201),
    ('POST', f'/api/quiz/sessions/{SESSION}/progress', 'log_progress', {}, 200),
    ('PATCH', f'/api/quiz/sessions/{SESSION}', 'end_session', {}, 200),
]
OTHER = [
    ('GET', '/api/quiz/banks', 'list_published_banks', None),
    ('GET', '/api/quiz/progress', 'student_progress', None),
    ('GET', '/api/quiz/mistakes', 'student_mistakes', None),
    ('GET', f'/api/quiz/banks/{BANK}/resume', 'get_resume', None),
    ('GET', f'/api/quiz/banks/{BANK}/course-timer', 'get_course_timer', None),
    ('POST', '/api/quiz/course/full-retry', 'begin_course_full_retry', {'bank_id': BANK}),
    ('POST', f'/api/quiz/banks/{BANK}/reset', 'reset_progress', {}),
    ('GET', f'/api/quiz/course/writing?bank_id={BANK}', 'course_writing_state', None),
    ('POST', '/api/quiz/course/writing/draft', 'save_course_writing_draft', {'bank_id': BANK}),
    ('POST', '/api/quiz/course/reading-solution', 'course_reading_solution', {'bank_id': BANK}),
    ('POST', '/api/quiz/course/listening-solution', 'course_listening_solution', {'bank_id': BANK}),
    ('POST', '/api/quiz/course/listening-audio', 'course_listening_audio', {'bank_id': BANK}),
    ('GET', f'/api/quiz/course/report?bank_id={BANK}', 'course_answer_report', None),
    ('POST', '/api/quiz/course/verdict', 'course_verdict', {'bank_id': BANK, 'session_ids': []}),
]


@pytest.fixture
def payloads():
    return {
        'get_bank_for_play': {
            'bank': {'id': BANK, 'title': 'Đề kiểm tra 300 câu'},
            'questions': [{'qid': f'q-{i}', 'type': 'mcq',
                           'prompt': 'Chọn câu phù hợp với ngữ cảnh. ' * 28,
                           'options': ['One', 'Two', 'Three', 'Four']} for i in range(300)],
            'word_cards': {},
        },
        'get_course_resume': {
            'session_id': SESSION, 'answered': [
                {'qid': f'q-{i}', 'is_correct': bool(i % 2)} for i in range(300)],
            'completed': [SESSION], 'stage': 9, 'item_id': None,
            'last_stage': {'right': 25, 'graded': 30}, 'retake': None,
            'timer': None, 'answers_sealed': False,
        },
        'start_session': {'session_id': SESSION, 'resume': [
            {'item_key': f'word-{i}', 'mastered': False, 'correct_count': 1,
             'wrong_count': 0, 'streak': 1} for i in range(300)]},
        'log_progress': {'ok': True, 'attempts': 1, 'word_stats': 1},
        'end_session': {'id': SESSION, 'bank_id': BANK},
    }


@pytest.fixture
def app(monkeypatch):
    async def user(_authorization):
        return {'id': USER, 'email': 'j428@example.test', 'user_metadata': {}}
    async def active(): pass  # Q5 owns this remaining blocking query
    monkeypatch.setattr(quiz, 'get_supabase_user', user)
    monkeypatch.setattr(auth, 'get_supabase_user', user)
    app = FastAPI()
    app.include_router(quiz.router, dependencies=[Depends(require_active_learner)])
    app.include_router(auth.router)
    app.dependency_overrides[require_active_learner] = active
    return app


async def request(app, method, path, body=None):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
        return await client.request(method, path, json=body)


async def concurrent_requests(app, method, path, body=None):
    ticks, done = [time.perf_counter()], asyncio.Event()
    async def heartbeat():
        while not done.is_set():
            await asyncio.sleep(.01)
            ticks.append(time.perf_counter())
    beat = asyncio.create_task(heartbeat())
    await asyncio.sleep(0)
    start = time.perf_counter()
    try:
        responses = await asyncio.gather(request(app, method, path, body), request(app, method, path, body))
    finally:
        elapsed = time.perf_counter() - start
        done.set()
        await beat
    return responses, elapsed, max(b - a for a, b in zip(ticks, ticks[1:]))


@pytest.mark.parametrize('method,path,service,body,status', HOT)
def test_hot_routes_overlap_without_blocking_heartbeat(app, monkeypatch, payloads, method, path, service, body, status):
    threads, loop_thread = [], threading.get_ident()
    def slow(*args, **kwargs):
        threads.append(threading.get_ident())
        time.sleep(.5)
        return deepcopy(payloads[service])
    monkeypatch.setattr(quiz.quiz_service, service, slow)
    responses, elapsed, gap = asyncio.run(concurrent_requests(app, method, path, body))
    assert [r.status_code for r in responses] == [status, status]
    assert gap < .1, f'heartbeat gap {gap:.3f}s'
    assert .5 <= elapsed < .8, f'two 500ms requests took {elapsed:.3f}s'
    assert len(threads) == 2 and all(t != loop_thread for t in threads)


@pytest.mark.parametrize('method,path,service,body', OTHER)
def test_remaining_quiz_calls_use_workers(app, monkeypatch, method, path, service, body):
    calls, loop_thread = [], threading.get_ident()
    def service_call(*args, **kwargs):
        calls.append((threading.get_ident(), args, kwargs))
        return {'ok': True}
    monkeypatch.setattr(quiz.quiz_service, service, service_call)
    response = asyncio.run(request(app, method, path, body))
    assert response.status_code == 200 and response.json() == {'ok': True}
    assert len(calls) == 1 and calls[0][0] != loop_thread


def test_bank_validation_and_json_dump_run_in_worker(app, monkeypatch, payloads):
    data = payloads['get_bank_for_play']
    assert len(JSONResponse(jsonable_encoder(data)).body) >= 250_000
    monkeypatch.setattr(quiz.quiz_service, 'get_bank_for_play', lambda *a, **k: data)
    model = quiz.QuizBankPlayResponse
    validate, dump = model.model_validate, model.model_dump_json
    validated, dumped, loop_thread = [], [], threading.get_ident()
    def validating(cls, *args, **kwargs):
        validated.append(threading.get_ident())
        return validate(*args, **kwargs)
    def dumping(self, *args, **kwargs):
        dumped.append(threading.get_ident())
        return dump(self, *args, **kwargs)
    monkeypatch.setattr(model, 'model_validate', classmethod(validating))
    monkeypatch.setattr(model, 'model_dump_json', dumping)
    response = asyncio.run(request(app, 'GET', f'/api/quiz/banks/{BANK}'))
    assert response.status_code == 200
    assert validated and dumped
    assert all(t != loop_thread for t in validated + dumped)


@pytest.mark.parametrize('method,path,service,body,status', [h for h in HOT if h[2] != 'get_course_resume'])
def test_response_models_match_original_fastapi_serialization(app, monkeypatch, payloads, method, path, service, body, status):
    data = payloads[service]
    monkeypatch.setattr(quiz.quiz_service, service, lambda *a, **k: deepcopy(data))
    route = next(r for r in app.routes if isinstance(r, APIRoute) and r.endpoint.__name__ == {
        'get_bank_for_play': 'get_bank', 'start_session': 'start_session',
        'log_progress': 'log_progress', 'end_session': 'end_session',
    }[service])
    async def compare():
        old = await serialize_response(field=route.response_field, response_content=deepcopy(data),
                                       by_alias=True, exclude_unset=True, is_coroutine=True)
        return JSONResponse(old), await request(app, method, path, body)
    old, new = asyncio.run(compare())
    assert new.status_code == status  # start_session has always been 201
    assert new.headers['content-type'] == 'application/json'
    assert new.json() == json.loads(old.body)


@pytest.mark.parametrize('method,path,service,body,status', HOT)
@pytest.mark.parametrize('error_status', [404, 403, 409])
def test_service_http_errors_keep_status_and_detail(app, monkeypatch, method, path, service, body, status, error_status):
    detail = {'message': 'Không thể mở bài này.', 'code': 'unchanged'}
    def fail(*args, **kwargs): raise HTTPException(error_status, detail=detail)
    monkeypatch.setattr(quiz.quiz_service, service, fail)
    response = asyncio.run(request(app, method, path, body))
    assert response.status_code == error_status and response.json() == {'detail': detail}


class MeDB:
    def __init__(self, row):
        self.row, self.delay, self.first_visit, self.async_mode = row, 0, False, False
        self.calls = []
    def table(self, name):
        assert name == 'users'
        owner = self
        class Builder:
            operation, payload, kwargs = 'select', None, None
            def select(self, *args): return self
            def eq(self, *args): return self
            def limit(self, *args): return self
            def update(self, payload):
                self.operation, self.payload = 'update', payload
                return self
            def upsert(self, payload, **kwargs):
                self.operation, self.payload, self.kwargs = 'upsert', payload, kwargs
                return self
            def finish(self):
                owner.calls.append((self.operation, threading.get_ident(), self.payload, self.kwargs))
                if self.operation == 'select' and owner.first_visit:
                    return SimpleNamespace(data=[])
                if self.operation == 'upsert': owner.first_visit = False
                return SimpleNamespace(data=[deepcopy(owner.row)])
            def execute(self):
                if owner.async_mode:
                    async def run():
                        await asyncio.sleep(owner.delay)
                        return self.finish()
                    return run()
                time.sleep(owner.delay)
                return self.finish()
        return Builder()


@pytest.fixture
def me_setup(app, monkeypatch):
    db = MeDB({'id': USER, 'email': 'j428@example.test', 'role': 'user', 'is_active': True,
               'last_seen_at': datetime.now(timezone.utc).isoformat(),
               'feature_flags': {'vocab_curated_enabled': True}})
    monkeypatch.setattr(settings, 'USE_ASYNC_DB', False)
    monkeypatch.setattr(auth, 'supabase_admin', db)
    monkeypatch.setattr(permissions, 'get_user_access_code_permissions', lambda uid: ['practice_single'])
    monkeypatch.setattr(auth, 'is_flashcard_enabled', lambda *a: True)
    monkeypatch.setattr(auth.runtime_flags, 'is_enabled', lambda *a, **k: True)
    return db


@pytest.mark.parametrize('slow_layer', ['db', 'permissions', 'flashcard', 'runtime'])
def test_me_sync_reads_overlap_without_blocking_heartbeat(app, me_setup, monkeypatch, slow_layer):
    if slow_layer == 'db': me_setup.delay = .5
    else:
        def slow(*args, **kwargs):
            time.sleep(.5)
            return ['practice_single'] if slow_layer == 'permissions' else True
        if slow_layer == 'permissions': monkeypatch.setattr(permissions, 'get_user_access_code_permissions', slow)
        elif slow_layer == 'flashcard': monkeypatch.setattr(auth, 'is_flashcard_enabled', slow)
        else: monkeypatch.setattr(auth.runtime_flags, 'is_enabled', slow)
    responses, elapsed, gap = asyncio.run(concurrent_requests(app, 'GET', '/auth/me'))
    assert [r.status_code for r in responses] == [200, 200]
    assert gap < .1, f'heartbeat gap {gap:.3f}s'
    assert .5 <= elapsed < .8


@pytest.mark.parametrize('async_mode', [False, True])
def test_me_flag_parity_query_order_request_memo_and_private_cache(app, me_setup, monkeypatch, async_mode):
    monkeypatch.setattr(settings, 'USE_ASYNC_DB', async_mode)
    me_setup.row['last_seen_at'], me_setup.first_visit, me_setup.async_mode = None, True, async_mode
    loop_thread, permission_threads, flag_threads = threading.get_ident(), [], []
    def sync_permissions(uid):
        permission_threads.append(threading.get_ident())
        return ['practice_single']
    async def async_permissions(uid): return sync_permissions(uid)
    def flashcard(*args, **kwargs):
        flag_threads.append(threading.get_ident())
        return True
    async def async_flashcard(*args, **kwargs): return flashcard()
    async def async_runtime(*args, **kwargs): return True
    monkeypatch.setattr(permissions, 'get_user_access_code_permissions', sync_permissions)
    monkeypatch.setattr(permissions, 'aget_user_access_code_permissions', async_permissions)
    monkeypatch.setattr(auth, 'is_flashcard_enabled', flashcard)
    monkeypatch.setattr(auth, 'ais_flashcard_enabled', async_flashcard)
    monkeypatch.setattr(auth.runtime_flags, 'ais_enabled', async_runtime)
    if async_mode:
        async def get_async(): return me_setup
        monkeypatch.setattr(database, 'get_supabase_async', get_async)
        class Forbidden:
            def table(self, *args): raise AssertionError('sync DB touched in flag-on mode')
        monkeypatch.setattr(auth, 'supabase_admin', Forbidden())
    else:
        async def forbidden(): raise AssertionError('async DB initialized in flag-off mode')
        monkeypatch.setattr(database, 'get_supabase_async', forbidden)
    @app.middleware('http')
    async def memo(request_, call_next):
        token = permissions.begin_request_permission_memo()
        try:
            response = await call_next(request_)
            # The worker populated this request's shared ContextVar dict.
            assert await permissions.aget_user_access_code_permissions_cached(USER) == ['practice_single']
            return response
        finally: permissions.reset_request_permission_memo(token)
    response = asyncio.run(request(app, 'GET', '/auth/me'))
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'private, no-store'
    assert response.json() == {
        'id': USER, 'email': 'j428@example.test', 'display_name': None,
        'avatar_url': None, 'role': 'user', 'is_active': True, 'suspended': False,
        'permissions': ['practice_single'], 'onboarding_completed': False,
        'target_band': None, 'exam_date': None, 'self_level': None,
        'preferred_topics': [], 'vocab_bank_enabled': False, 'd1_enabled': False,
        'd3_enabled': False, 'flashcard_enabled': True, 'vocab_curated_enabled': True,
    }
    assert [c[0] for c in me_setup.calls] == ['select', 'upsert', 'select', 'update']
    assert me_setup.calls[1][3] == {'on_conflict': 'id', 'ignore_duplicates': True}
    assert len(permission_threads) == 1 and len(flag_threads) == 1
    assert all((t == loop_thread) == async_mode for t in
               [c[1] for c in me_setup.calls] + permission_threads + flag_threads)
