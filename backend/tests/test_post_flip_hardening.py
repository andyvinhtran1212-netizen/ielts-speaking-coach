"""Post-flip regressions: no live database, storage, uploads or AI requests."""
import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException, UploadFile, File, Request
from fastapi.testclient import TestClient
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers import vocab_units, health
from routers.error_logs import ErrorReportRequest
from services import curated_readiness
from services.request_safety import RequestSafetyMiddleware


@pytest.fixture(autouse=True)
def reset_readiness():
    curated_readiness.clear_cache()
    yield
    curated_readiness.clear_cache()


def test_error_extra_invalid_unicode_is_validation_error():
    with pytest.raises(ValidationError, match='invalid Unicode'):
        ErrorReportRequest(message='test', extra={'text': '\ud800'})


def test_curated_gate_requires_every_migration_and_fails_closed(monkeypatch):
    db = MagicMock()
    query = db.table.return_value.select.return_value.in_.return_value
    query.execute.return_value.data = [{'filename': name} for name in curated_readiness.REQUIRED_MIGRATIONS[:-1]]
    monkeypatch.setattr(curated_readiness, 'supabase_admin', db)
    assert curated_readiness.schema_available() is False
    curated_readiness.clear_cache()
    query.execute.return_value.data.append({'filename': curated_readiness.REQUIRED_MIGRATIONS[-1]})
    assert curated_readiness.schema_available() is True
    curated_readiness.clear_cache()
    query.execute.side_effect = RuntimeError('private database details')
    with pytest.raises(HTTPException) as caught:
        curated_readiness.require_schema()
    assert caught.value.status_code == 503
    assert 'private database details' not in str(caught.value.detail)


def test_admin_auth_happens_before_schema_lookup(monkeypatch):
    guard = AsyncMock(side_effect=HTTPException(403, 'Forbidden'))
    schema = MagicMock()
    monkeypatch.setattr(vocab_units, 'require_admin', guard)
    monkeypatch.setattr(vocab_units, 'require_schema', schema)
    with pytest.raises(HTTPException):
        asyncio.run(vocab_units._require_curated_admin('Bearer nonadmin'))
    schema.assert_not_called()


def test_missing_curated_schema_is_controlled_503_before_domain_service(monkeypatch):
    app = FastAPI(); app.include_router(vocab_units.router)
    monkeypatch.setattr(vocab_units, 'require_admin', AsyncMock(return_value={'id': 'admin'}))
    monkeypatch.setattr(curated_readiness, 'schema_available', lambda: False)
    service = MagicMock()
    monkeypatch.setattr(vocab_units.vocab_units, 'list_editorial_units', service)
    response = TestClient(app).get('/admin/vocabulary/editorial/units')
    assert response.status_code == 503
    assert response.json()['detail']['error_code'] == 'feature_unavailable'
    service.assert_not_called()


def test_all_curated_admin_routes_use_rollout_guard():
    import inspect
    for route in vocab_units.router.routes:
        if route.path.startswith('/admin/'):
            assert '_require_curated_admin(authorization)' in inspect.getsource(route.endpoint), route.path


def test_health_degrades_for_missing_core_column_and_redacts_details(monkeypatch):
    query = MagicMock()
    def select(columns, **_kwargs):
        if 'renderer_affinity' in columns:
            raise RuntimeError('private missing-column detail')
        return query
    query.select.side_effect = select
    query.limit.return_value = query
    query.execute.return_value.data = []
    db = MagicMock(); db.table.return_value = query
    monkeypatch.setattr(health, 'supabase_admin', db)
    monkeypatch.setattr(health.runtime_flags, 'is_enabled', lambda *a, **k: False)
    monkeypatch.setattr(health.settings, 'GEMINI_API_KEY', 'fake')
    result = asyncio.run(health.health_ready(None))
    assert result['status'] == 'degraded'
    assert 'sessions' in result['checks']['migrations']['missing']
    assert 'private missing-column detail' not in str(result)


@pytest.mark.parametrize('enabled,available,expected', [(False, False, 'disabled'), (True, False, 'fail'), (True, True, 'ok')])
def test_optional_curated_readiness_is_feature_aware(monkeypatch, enabled, available, expected):
    query = MagicMock(); query.select.return_value = query; query.limit.return_value = query
    db = MagicMock(); db.table.return_value = query
    monkeypatch.setattr(health, 'supabase_admin', db)
    monkeypatch.setattr(health.settings, 'GEMINI_API_KEY', 'fake')
    monkeypatch.setattr(health.runtime_flags, 'is_enabled', lambda *a, **k: enabled)
    monkeypatch.setattr(health.curated_readiness, 'schema_available', lambda: available)
    result = asyncio.run(health.health_ready(None))
    assert result['checks']['curated_schema']['status'] == expected
    assert result['status'] == ('degraded' if expected == 'fail' else 'ok')


def test_error_extra_is_bounded_and_sensitive_values_redacted():
    value = ErrorReportRequest(message='failed', extra={'attempt_id': 'fixture', 'nested': {'access_token': 'secret'}})
    assert value.extra == {'attempt_id': 'fixture', 'nested': {'access_token': '[redacted]'}}
    deep = {}
    for _ in range(8):
        deep = {'child': deep}
    for extra in [{'text': 'x' * 8193}, {'items': list(range(300))}, deep]:
        with pytest.raises(ValidationError):
            ErrorReportRequest(message='failed', extra=extra)


def safety_app(**limits):
    app = FastAPI()
    app.add_middleware(RequestSafetyMiddleware, **limits)
    @app.post('/upload')
    async def upload(file: UploadFile = File(...)):
        return {'bytes': len(await file.read())}
    @app.post('/api/error-logs')
    async def log(request: Request):
        await request.json()
        return {'received': True}
    return app


def test_upload_size_rejected_and_normal_form_survives_new_parser():
    client = TestClient(safety_app(upload_limit=1024))
    assert client.post('/upload', files={'file': ('sample.webm', b'abc', 'audio/webm')}).json() == {'bytes': 3}
    assert client.post('/upload', files={'file': ('sample.webm', b'x' * 1025)}).status_code == 413


def test_fulltest_aggregate_accepts_all_four_files_at_route_limits():
    from routers import listening
    audio_size = listening._FULLTEST_MAX_AUDIO_BYTES
    text_size = listening._FULLTEST_MAX_TEXT_BYTES
    path = '/admin/listening/import-fulltest/commit'
    assert any(route.path == path for route in listening.admin_router.routes)
    app = FastAPI()
    app.add_middleware(RequestSafetyMiddleware)

    @app.post(path)
    async def pack(question_paper: UploadFile = File(...), solution: UploadFile = File(...),
                   timings: UploadFile = File(...), audio: UploadFile = File(...)):
        # Actual multipart parser, no import/DB/audio service side effects.
        return {'sizes': [item.size for item in (question_paper, solution, timings, audio)]}

    client = TestClient(app)
    response = client.post(path + '?mini=false', files={
        'question_paper': ('questions.md', b'q' * text_size, 'text/markdown'),
        'solution': ('solution.md', b's' * text_size, 'text/markdown'),
        'timings': ('timings.json', b' ' * (text_size - 2) + b'{}', 'application/json'),
        'audio': ('audio.mp3', b'a' * audio_size, 'audio/mpeg'),
    })
    assert response.status_code == 200
    assert response.json()['sizes'] == [text_size, text_size, text_size, audio_size]
    # Header rejection requires no allocation of an oversized real body.
    for url, size in [(path, 68 * 1024 * 1024 + 1), ('/upload', 64 * 1024 * 1024 + 1)]:
        rejected = client.post(url, content=b'', headers={
            'content-type': 'multipart/form-data; boundary=test', 'content-length': str(size),
        })
        assert rejected.status_code == 413


def test_fulltest_chunked_aggregate_still_has_a_hard_limit():
    app = safety_app(fulltest_upload_limit=100)
    @app.post('/admin/listening/import-fulltest/commit')
    async def pack(request: Request):
        await request.body()
        return {'ok': True}
    messages = []
    chunks = iter([{'type': 'http.request', 'body': b'x' * 101, 'more_body': False}])
    async def receive():
        return next(chunks)
    async def send(message):
        messages.append(message)
    scope = {'type': 'http', 'method': 'POST', 'path': '/admin/listening/import-fulltest/commit',
             'raw_path': b'/admin/listening/import-fulltest/commit', 'query_string': b'',
             'headers': [(b'content-type', b'multipart/form-data; boundary=test')],
             'server': ('test', 80), 'client': ('test', 1), 'scheme': 'http', 'http_version': '1.1'}
    asyncio.run(app(scope, receive, send))
    assert messages[0]['status'] == 413


def test_chunked_upload_cannot_bypass_size_limit():
    app = safety_app(upload_limit=100)
    messages = []
    chunks = iter([{'type': 'http.request', 'body': b'x' * 101, 'more_body': False}])
    async def receive():
        return next(chunks)
    async def send(message):
        messages.append(message)
    scope = {'type': 'http', 'method': 'POST', 'path': '/upload', 'raw_path': b'/upload',
             'query_string': b'', 'headers': [(b'content-type', b'multipart/form-data; boundary=test')],
             'server': ('test', 80), 'client': ('test', 1), 'scheme': 'http', 'http_version': '1.1'}
    asyncio.run(app(scope, receive, send))
    assert messages[0]['status'] == 413


def test_logging_body_and_burst_are_bounded_before_handler():
    client = TestClient(safety_app(log_limit=100, log_per_minute=2))
    assert client.post('/api/error-logs', json={'message': 'x' * 101}).status_code == 413
    assert client.post('/api/error-logs', json={'message': 'ok'}).status_code == 200
    limited = client.post('/api/error-logs', json={'message': 'ok'})
    assert limited.status_code == 429
    assert limited.headers['retry-after'] == '60'
