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

from config import settings
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
    assert result['checks']['migrations'] == {'status': 'fail'}
    assert 'sessions' not in str(result)
    assert 'private missing-column detail' not in str(result)

    async def _admin(_authorization):
        return True
    monkeypatch.setattr(health, '_is_admin', _admin)
    admin = asyncio.run(health.health_ready('Bearer admin'))
    assert any(m.startswith('sessions:') for m in admin['checks']['migrations']['missing'])


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
    @app.post('/api/analytics/events')
    async def analytics(request: Request):
        await request.json()
        return {'received': True}
    return app


def test_upload_size_rejected_and_normal_form_survives_new_parser():
    client = TestClient(safety_app(upload_limit=1024))
    assert client.post('/upload', files={'file': ('sample.webm', b'abc', 'audio/webm')}).json() == {'bytes': 3}
    assert client.post('/upload', files={'file': ('sample.webm', b'x' * 1025)}).status_code == 413


def test_anonymous_analytics_has_body_and_worker_rate_limits():
    client = TestClient(safety_app(analytics_limit=32, analytics_per_minute=2))
    assert client.post('/api/analytics/events', json={'x': 1}).status_code == 200
    assert client.post('/api/analytics/events', json={'x': 2}).status_code == 200
    limited = client.post('/api/analytics/events', json={'x': 3})
    assert limited.status_code == 429
    assert limited.headers['retry-after'] == '60'

    oversized = TestClient(safety_app(analytics_limit=8)).post(
        '/api/analytics/events', content=b'{"value":12345}',
        headers={'content-type': 'application/json'},
    )
    assert oversized.status_code == 413


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


# ── F10: anonymous telemetry ingress is throttled per client ─────────────


def _xff(*hops):
    return {'x-forwarded-for': ', '.join(hops)}


@pytest.mark.parametrize('path,limits', [
    ('/api/error-logs', {'log_per_client_per_minute': 2, 'log_per_minute': 100}),
    ('/api/analytics/events', {'analytics_per_client_per_minute': 2, 'analytics_per_minute': 100}),
])
def test_anonymous_ingress_is_rate_limited_per_client(path, limits):
    client = TestClient(safety_app(**limits))
    flood = _xff('203.0.113.7')
    assert client.post(path, json={'message': 'a'}, headers=flood).status_code == 200
    assert client.post(path, json={'message': 'b'}, headers=flood).status_code == 200
    limited = client.post(path, json={'message': 'c'}, headers=flood)
    assert limited.status_code == 429
    assert limited.headers['retry-after'] == '60'
    # A different visitor keeps reporting while the flooding address is held.
    assert client.post(path, json={'message': 'd'}, headers=_xff('198.51.100.9')).status_code == 200


def test_caller_supplied_forwarded_hops_do_not_mint_fresh_budgets():
    client = TestClient(safety_app(log_per_client_per_minute=2, log_per_minute=100))
    # The rightmost untrusted hop (appended by our edge proxy) identifies
    # the client, regardless of whether the address is global.
    for spoof in ('8.8.8.8', '10.0.0.2'):
        assert client.post('/api/error-logs', json={'message': 'x'},
                           headers=_xff(spoof, '52.95.110.1')).status_code == 200
    assert client.post('/api/error-logs', json={'message': 'x'},
                       headers=_xff('1.1.1.1', '52.95.110.1')).status_code == 429


def test_real_ip_separates_clients_behind_an_explicitly_trusted_proxy(monkeypatch):
    # PC-J202: only configured proxy hops may be skipped, including private
    # ones. An all-trusted chain falls back to X-Real-IP.
    monkeypatch.setattr(settings, "TRUSTED_PROXY_CIDRS", "10.0.0.0/8")
    client = TestClient(safety_app(log_per_client_per_minute=1, log_per_minute=100))
    proxy = _xff('10.0.0.1')
    first = {**proxy, 'x-real-ip': '203.0.113.7'}
    assert client.post('/api/error-logs', json={'message': 'x'}, headers=first).status_code == 200
    assert client.post('/api/error-logs', json={'message': 'x'}, headers=first).status_code == 429
    assert client.post('/api/error-logs', json={'message': 'x'},
                       headers={**proxy, 'x-real-ip': '198.51.100.9'}).status_code == 200


def test_spoofed_real_ip_cannot_move_an_untrusted_forwarded_hop_off_its_bucket(monkeypatch):
    # SA-1029-XFF1: Railway's edge can copy X-Real-IP from the caller's first
    # XFF hop, so an untrusted forwarded hop outranks X-Real-IP.
    monkeypatch.setattr(settings, "TRUSTED_PROXY_CIDRS", "10.0.0.0/8")
    client = TestClient(safety_app(log_per_client_per_minute=1, log_per_minute=100))
    edge = _xff('52.95.110.1')
    assert client.post('/api/error-logs', json={'message': 'x'}, headers=edge).status_code == 200
    for spoof in ({**edge, 'x-real-ip': '8.8.8.8'}, {**_xff('8.8.8.8', '52.95.110.1'), 'x-real-ip': '8.8.8.8'},
                  {**_xff('52.95.110.1', '10.0.0.3'), 'x-real-ip': '1.1.1.1'}):
        assert client.post('/api/error-logs', json={'message': 'x'},
                           headers=spoof).status_code == 429


@pytest.mark.parametrize('hops', [('10.0.0.2', '10.0.0.3'), ('10.0.0.4',),
                                  ('192.168.1.9', '100.64.0.6')])
def test_explicitly_trusted_hops_fall_back_to_one_real_ip_budget(hops, monkeypatch):
    # PC-J202 replaces the implicit trust from PC-J176/CR F4 with an explicit
    # allowlist. Preserve budget and independent-client controls.
    monkeypatch.setattr(settings, "TRUSTED_PROXY_CIDRS",
                        "10.0.0.0/8,192.168.0.0/16,100.64.0.0/10")
    client = TestClient(safety_app(log_per_client_per_minute=2, log_per_minute=100))
    real = {'x-real-ip': '52.95.110.7'}
    for spoof, status in ((real, 200), ({**_xff(*hops), **real}, 200),
                          ({**_xff(*hops), **real}, 429), ({**_xff(*reversed(hops)), **real}, 429),
                          ({**_xff(hops[0], '10.9.9.9'), **real}, 429)):
        assert client.post('/api/error-logs', json={'message': 'x'},
                           headers=spoof).status_code == status
    # Control: another X-Real-IP behind the same hops keeps its own budget.
    assert client.post('/api/error-logs', json={'message': 'x'},
                       headers={**_xff(*hops), 'x-real-ip': '52.95.110.8'}).status_code == 200


def test_blank_real_ip_falls_back_to_last_forwarded_hop():
    client = TestClient(safety_app(log_per_client_per_minute=1, log_per_minute=100))
    blank = {'x-real-ip': ' '}
    assert client.post('/api/error-logs', json={'message': 'x'},
                       headers={**_xff('10.0.0.1', '203.0.113.7'), **blank}).status_code == 200
    assert client.post('/api/error-logs', json={'message': 'x'},
                       headers=_xff('10.0.0.2', '203.0.113.7')).status_code == 429
    assert client.post('/api/error-logs', json={'message': 'x'},
                       headers={**_xff('198.51.100.9'), **blank}).status_code == 200


@pytest.mark.parametrize('path,budget', [
    ('/api/error-logs', 60),
    ('/api/analytics/events', 120),
])
def test_default_per_client_budgets(path, budget):
    # The shipped F10 thresholds, not test-sized ones: 60/min error logs and
    # 120/min analytics per client, each below its per-worker ceiling.
    client = TestClient(safety_app())
    real = {'x-real-ip': '203.0.113.7'}
    for _ in range(budget):
        assert client.post(path, json={'message': 'x'}, headers=real).status_code == 200
    limited = client.post(path, json={'message': 'x'}, headers=real)
    assert limited.status_code == 429
    assert limited.headers['retry-after'] == '60'
    assert client.post(path, json={'message': 'x'},
                       headers={'x-real-ip': '198.51.100.9'}).status_code == 200


def test_socket_peer_is_the_key_without_forwarded_header():
    client = TestClient(safety_app(analytics_per_client_per_minute=1, analytics_per_minute=100))
    assert client.post('/api/analytics/events', json={'x': 1}).status_code == 200
    assert client.post('/api/analytics/events', json={'x': 2}).status_code == 429


def test_per_client_rejections_do_not_spend_the_worker_budget():
    client = TestClient(safety_app(log_per_client_per_minute=1, log_per_minute=3))
    flood = _xff('203.0.113.7')
    assert client.post('/api/error-logs', json={'message': 'x'}, headers=flood).status_code == 200
    for _ in range(5):
        assert client.post('/api/error-logs', json={'message': 'x'}, headers=flood).status_code == 429
    # Worker budget 3: only the one accepted flood request counted against it.
    assert client.post('/api/error-logs', json={'message': 'x'}, headers=_xff('198.51.100.1')).status_code == 200
    assert client.post('/api/error-logs', json={'message': 'x'}, headers=_xff('198.51.100.2')).status_code == 200
    assert client.post('/api/error-logs', json={'message': 'x'}, headers=_xff('198.51.100.3')).status_code == 429


def test_tracked_client_table_is_bounded():
    app = safety_app(log_per_client_per_minute=1, log_per_minute=100, max_tracked_clients=2)
    client = TestClient(app)
    for ip in ('192.0.2.1', '192.0.2.2', '192.0.2.3', '192.0.2.4'):
        client.post('/api/error-logs', json={'message': 'x'}, headers=_xff(ip))
    middleware = app.middleware_stack
    while not isinstance(middleware, RequestSafetyMiddleware):
        middleware = middleware.app
    # Two real addresses plus one shared overflow bucket — never unbounded.
    assert len(middleware._log_clients) == 3
    assert '\0overflow' in middleware._log_clients


def test_error_report_rejects_unknown_fields_and_unsafe_request_id():
    with pytest.raises(ValidationError):
        ErrorReportRequest(message='failed', user_id='someone-else')
    with pytest.raises(ValidationError):
        ErrorReportRequest(message='failed', request_id='abc def<script>')
    with pytest.raises(ValidationError, match='key is too long'):
        ErrorReportRequest(message='failed', extra={'k' * 65: 1})
    with pytest.raises(ValidationError, match='finite'):
        ErrorReportRequest(message='failed', extra={'ms': float('nan')})


def test_error_report_accepts_every_shipped_reporter_envelope():
    # frontend/public/js/error-reporter.js (randomUUID + fallback id) and the
    # reading/listening "nothing saved" alarms (no request_id).
    for request_id in ('3f2b8c1e-9a0d-4e5f-8a7b-1c2d3e4f5a6b', 'fb-1730000000000-abc123de', None):
        ErrorReportRequest(
            level='error', source='frontend', message='TypeError: x', stack='at f (a.js:1:1)',
            url='/reading/exam?attempt=1', user_agent='Mozilla/5.0', request_id=request_id,
            extra={'filename': 'https://x/a.js', 'line': 1, 'col': 2, 'digest': '123',
                   'implementation': 'next', 'attempt_id': 'a1', 'answers_held_locally': 3},
        )
