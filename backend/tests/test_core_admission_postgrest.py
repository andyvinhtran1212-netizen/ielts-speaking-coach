"""Opt-in real LOCAL HTTP/PostgREST/PG integration; never downloads an image.

RUN_LOCAL_POSTGREST=1 REQUIRE_PG=1 TEST_PG_URL=postgresql://127.0.0.1:55480/postgres
requires an already running disposable PG and the pinned Docker image below.
Only an exact newly created container/role/schema is cleaned up. No live keys,
remote database, host mounts, privileged container or public listen port.
"""
import asyncio
import hashlib
import json
import os
import secrets
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from uuid import UUID, uuid4

import asyncpg
import httpx
import pytest
import jwt
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import core_admission as admission, core_writing_reports as reports
from routers import writing_student as writing
from test_migration_240_core_attempt_evidence import DB, probe, psql
from test_migration_247_core_admission import rotate
from test_migration_248_writing_admission import schema as writing_schema, snapshot
from test_migration_249_writing_provenance import schema as provenance_schema
from test_migration_250_writing_preparation import schema as preparation_schema, seed, capture_on
from test_migration_251_writing_reconciliation import schema as reconciliation_schema
from test_migration_252_writing_baseline import schema as baseline_schema
from test_migration_253_writing_nonce_lookup import schema as nonce_schema
from test_migration_254_writing_cohort import schema as cohort_schema
from test_migration_255_writing_reports import schema, enable

IMAGE = 'postgrest/postgrest@sha256:0a46780309a604cdc8b56c776c6e5e15788ce58174d709e40459ab5a2d44d228'
pytestmark = pytest.mark.skipif(os.environ.get('RUN_LOCAL_POSTGREST') != '1',
    reason='Opt in to disposable local Docker/PostgREST explicitly')


def docker(*args, env=None):
    result = subprocess.run(['docker', *args], capture_output=True, text=True,
                            env=env, timeout=30)
    if result.returncode:
        raise RuntimeError('Local PostgREST Docker operation failed: ' + args[0])
    return result.stdout.strip()


@pytest.fixture(scope='module')
def rest(schema):
    parsed = urlparse(DB)
    assert parsed.hostname == '127.0.0.1' and parsed.port == 55480 and parsed.path == '/postgres' and not parsed.query
    docker('image', 'inspect', IMAGE, '--format', '{{.Id}}')  # never implicit pull
    name = 'aver-admission-rest-' + uuid4().hex
    role = 'rest_probe_' + uuid4().hex
    secret, password = secrets.token_hex(32), secrets.token_hex(24)
    token = lambda role_name: jwt.encode({'role': role_name, 'exp': int(time.time()) + 3600}, secret, algorithm='HS256')
    psql(f"CREATE ROLE {role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '{password}'; "
         f"GRANT anon,authenticated,service_role TO {role}; "
         f"ALTER ROLE {role} SET statement_timeout='750ms'")
    container = None
    try:
        environment = dict(os.environ)
        configuration = {
            'PGRST_DB_URI': f'postgresql://{role}:{password}@host.docker.internal:55480/postgres',
            'PGRST_DB_SCHEMAS': schema, 'PGRST_DB_ANON_ROLE': 'anon',
            'PGRST_JWT_SECRET': secret, 'PGRST_DB_POOL': '2',
            'PGRST_DB_POOL_ACQUISITION_TIMEOUT': '2', 'PGRST_LOG_LEVEL': 'crit',
            'PGRST_DB_CONFIG': 'false', 'PGRST_DB_EXTRA_SEARCH_PATH': '',
        }
        environment.update(configuration)
        arguments = ['run', '-d', '--rm', '--pull=never', '--name', name,
            '--label', 'aver.test=core-admission-postgrest', '--read-only',
            '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=128m',
            '--cpus=1', '-p', '127.0.0.1::3000']
        for key in configuration: arguments.extend(['-e', key])
        container = docker(*arguments, IMAGE, env=environment)
        address = docker('port', container, '3000/tcp')
        assert address.startswith('127.0.0.1:') and '\n' not in address
        url = 'http://' + address
        headers = {'Authorization': 'Bearer ' + token('service_role')}
        deadline = time.monotonic() + 25
        with httpx.Client(trust_env=False, timeout=1) as client:
            while True:
                try:
                    response = client.get(url + '/', headers=headers)
                    if response.status_code == 200:
                        assert '/rpc/fn_capture_writing_cohort_report' in response.json()['paths']
                        assert '13.0.7' in response.headers.get('server', '')
                        break
                except (httpx.TransportError, KeyError):
                    pass
                if time.monotonic() >= deadline: raise RuntimeError('Local PostgREST readiness failed')
                time.sleep(.15)
        yield {'url': url, 'token': token, 'schema': schema, 'container': container, 'role': role}
    finally:
        if container is not None: docker('stop', '--time', '3', container)
        psql(f'DROP ROLE {role}')


@pytest.fixture
def transport(rest, monkeypatch):
    """Real loopback prefix proxy, not a mocked response or mocked _rpc.

    Production uses /rest/v1 via its gateway; standalone PostgREST serves /rpc.
    This proxy changes only that prefix and can lose one *committed* response.
    It is not a simulation of Supabase's gateway JWT/API-key policies.
    """
    state = {'drop': None, 'calls': [], 'responses': []}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def do_POST(self):
            if not self.path.startswith('/rest/v1/rpc/'):
                self.send_error(404); return
            path = self.path[len('/rest/v1'):]
            state['calls'].append(path)
            with httpx.Client(trust_env=False, timeout=5) as client:
                response = client.post(rest['url'] + path,
                    headers={'Authorization': self.headers.get('Authorization', ''), 'Content-Type': 'application/json'},
                    content=self.rfile.read(int(self.headers.get('Content-Length', '0'))))
            state['responses'].append((path, response.status_code,
                response.json().get('code') if response.is_error else None))
            if state['drop'] == path:
                state['drop'] = None
                self.close_connection = True
                return  # upstream completed/committed; caller never gets its ACK
            self.send_response(response.status_code)
            self.send_header('Content-Type', response.headers.get('Content-Type', 'application/json'))
            self.send_header('Content-Length', str(len(response.content)))
            self.end_headers(); self.wfile.write(response.content)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    monkeypatch.setattr(admission.settings, 'SUPABASE_URL', f'http://127.0.0.1:{server.server_port}')
    monkeypatch.setattr(admission.settings, 'SUPABASE_SERVICE_KEY', rest['token']('service_role'))
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_LEDGER_ENABLED', True)
    monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_RECOVERY_ENABLED', False)
    try: yield state
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=3)


def identities(data): return data['user'], data['student'], data['assignment']


def test_real_transport_prepare_execute_replay_and_nonce_readback(schema, transport):
    data = seed(schema); nonce = uuid4()
    async def run():
        accepted = await admission.prepare_writing_admission(*identities(data), nonce)
        assert accepted.command.phase == 'accepted' and snapshot(schema, data)['started_at'] is None
        started = await admission.execute_writing_admission(*identities(data), accepted.command.command_id, 0)
        assert started.command.phase == 'bound'
        original = snapshot(schema, data)
        assert await admission.execute_writing_admission(*identities(data), accepted.command.command_id, 0) == started
        assert await admission.find_writing_admission(*identities(data), nonce) == started
        assert snapshot(schema, data) == original
    asyncio.run(run())


@pytest.mark.parametrize('lost', ['prepare', 'execute'])
def test_committed_ack_loss_recovers_without_new_episode_or_timer(schema, transport, lost):
    data = seed(schema); nonce = uuid4()
    async def run():
        if lost == 'prepare':
            transport['drop'] = '/rpc/fn_prepare_writing_admission'
            with pytest.raises(admission.AdmissionUncertain):
                await admission.prepare_writing_admission(*identities(data), nonce)
            accepted = await admission.find_writing_admission(*identities(data), nonce)
        else:
            accepted = await admission.prepare_writing_admission(*identities(data), nonce)
            transport['drop'] = '/rpc/fn_execute_writing_admission'
            with pytest.raises(admission.AdmissionUncertain):
                await admission.execute_writing_admission(*identities(data), accepted.command.command_id, 0)
        before = snapshot(schema, data)
        started = await admission.execute_writing_admission(*identities(data), accepted.command.command_id, 0)
        assert started.command.phase == 'bound'
        if lost == 'execute': assert snapshot(schema, data) == before
        assert psql(f"SELECT count(*) FROM {schema}.core_attempt_episodes WHERE principal_id='{data['user']}'") == '1'
    asyncio.run(run())


@pytest.mark.parametrize('role', ['anon', 'authenticated', 'service_role'])
def test_no_direct_ledger_or_report_access(rest, role):
    with httpx.Client(trust_env=False) as client:
        for table in ['core_admission_commands', 'core_writing_cohort_reports']:
            response = client.get(rest['url'] + '/' + table, headers={'Authorization': 'Bearer ' + rest['token'](role)})
            assert response.status_code in {401,403,404}
        if role != 'service_role':
            response = client.post(rest['url'] + '/rpc/fn_get_writing_cohort_report',
                headers={'Authorization': 'Bearer ' + rest['token'](role)}, json={'p_report_id': str(uuid4())})
            assert response.status_code in {401,403,404}


def test_bad_jwt_and_cross_owner_are_not_successful_reads(schema, rest, transport):
    with httpx.Client(trust_env=False) as client:
        assert client.get(rest['url'] + '/', headers={'Authorization': 'Bearer invalid'}).status_code == 401
    data = seed(schema); nonce = uuid4()
    async def run():
        accepted = await admission.prepare_writing_admission(*identities(data), nonce)
        assert await admission.get_writing_admission(uuid4(), data['student'], data['assignment'], accepted.command.command_id) is None
        with pytest.raises(admission.AdmissionNotFound):
            await admission.prepare_writing_admission(uuid4(), data['student'], data['assignment'], nonce)
    asyncio.run(run())


def test_durable_report_lost_capture_and_finalization_responses(schema, transport):
    rotate(schema); data = seed(schema); enable(schema); nonce = uuid4()
    async def run():
        accepted = await admission.prepare_writing_admission(*identities(data), nonce)
        epoch = accepted.command.activity_epoch_id; rotate(schema); report = uuid4()
        transport['drop'] = '/rpc/fn_capture_writing_cohort_report'
        with pytest.raises(admission.AdmissionUncertain): await reports.create_or_resume_writing_report(report, epoch)
        await admission.execute_writing_admission(*identities(data), accepted.command.command_id, 0)
        transport['drop'] = '/rpc/fn_finalize_writing_cohort_report'
        with pytest.raises(admission.AdmissionUncertain): await reports.create_or_resume_writing_report(report, epoch)
        final = await reports.create_or_resume_writing_report(report, epoch)
        assert final['summary']['states']['unstarted'] == 1  # captured before B
        assert final['summary']['coverage'] == 'unknown' and 'source_snapshot' not in final
        assert transport['calls'].count('/rpc/fn_capture_writing_cohort_report') == 1
        assert transport['calls'].count('/rpc/fn_finalize_writing_cohort_report') == 1
    asyncio.run(run())


def test_real_statement_timeout_rolls_back_preparation_before_any_late_commit(schema, rest, transport):
    data = seed(schema); nonce = uuid4()
    async def run():
        blocker = await asyncpg.connect(DB)
        try:
            await blocker.execute('BEGIN')
            await blocker.fetchval(f'SELECT id FROM {schema}.writing_assignments WHERE id=$1 FOR UPDATE', data['assignment'])
            params = {'p_user_id': str(data['user']), 'p_student_id': str(data['student']),
                'p_assignment_id': str(data['assignment']),
                'p_nonce_digest': hashlib.sha256(('admission-v1:' + str(nonce)).encode()).hexdigest()}
            async with httpx.AsyncClient(trust_env=False, timeout=4) as client:
                task = asyncio.create_task(client.post(rest['url'] + '/rpc/fn_prepare_writing_admission',
                    headers={'Authorization': 'Bearer ' + rest['token']('service_role')}, json=params))
                async with asyncio.timeout(3):
                    while not await blocker.fetchval('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))', blocker.get_server_pid()):
                        assert not task.done(), 'request did not reach the held source lock'
                        await asyncio.sleep(.01)
                response = await task
                assert response.status_code == 500 and response.json()['code'] == '57014'
            # The source lock is STILL held: DB must have canceled the statement.
            assert not await blocker.fetchval('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))', blocker.get_server_pid())
            assert psql(f"SELECT count(*) FROM {schema}.core_admission_scopes WHERE principal_id='{data['user']}'") == '0'
            await blocker.execute('COMMIT')
            assert await admission.find_writing_admission(*identities(data), nonce) is None
            accepted = await admission.prepare_writing_admission(*identities(data), nonce)
            assert accepted.command.phase == 'accepted' and snapshot(schema, data)['started_at'] is None
        finally:
            await blocker.close()
    asyncio.run(run())


def test_execution_timeout_after_timer_write_rolls_back_product_and_binding(schema, transport):
    data = seed(schema); original = snapshot(schema, data)
    accepted = asyncio.run(admission.prepare_writing_admission(*identities(data), uuid4()))
    # Test-only fault after the real product UPDATE, not a mocked RPC result.
    psql(f"""CREATE FUNCTION {schema}.slow_execution_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_sleep(2); RETURN NEW; END $$;
        CREATE TRIGGER slow_execution_fixture AFTER UPDATE OF started_at ON {schema}.writing_assignments
        FOR EACH ROW WHEN (NEW.id='{data['assignment']}'::uuid)
        EXECUTE FUNCTION {schema}.slow_execution_fixture();""")
    try:
        with pytest.raises(admission.AdmissionUncertain):
            asyncio.run(admission.execute_writing_admission(*identities(data), accepted.command.command_id, 0))
        assert transport['responses'][-1] == ('/rpc/fn_execute_writing_admission', 500, '57014')
        assert snapshot(schema, data) == original
        assert psql(f"SELECT phase FROM {schema}.core_admission_commands WHERE id='{accepted.command.command_id}'") == 'accepted'
        assert psql(f"SELECT count(*) FROM {schema}.core_admission_bindings WHERE principal_id='{data['user']}'") == '0'
        assert psql(f"SELECT count(*) FROM {schema}.core_admission_journal WHERE command_id='{accepted.command.command_id}'") == '1'
    finally:
        psql(f'DROP TRIGGER slow_execution_fixture ON {schema}.writing_assignments; DROP FUNCTION {schema}.slow_execution_fixture()')
    started = asyncio.run(admission.execute_writing_admission(*identities(data), accepted.command.command_id, 0))
    assert started.command.phase == 'bound'
    assert psql(f"SELECT count(*) FROM {schema}.core_admission_journal WHERE command_id='{accepted.command.command_id}'") == '2'


def test_private_report_default_off_rejects_capture_through_real_transport(schema, transport):
    rotate(schema); data = seed(schema); report = uuid4()
    accepted = asyncio.run(admission.prepare_writing_admission(*identities(data), uuid4()))
    rotate(schema)
    psql(f'UPDATE {schema}.core_writing_report_control SET enabled=false')
    with pytest.raises(admission.AdmissionEpochUnavailable):
        asyncio.run(reports.create_or_resume_writing_report(report, accepted.command.activity_epoch_id))
    assert psql(f"SELECT count(*) FROM {schema}.core_writing_cohort_reports WHERE id='{report}'") == '0'


def test_fastapi_route_to_real_rest_recovery_and_reload_keep_canonical_timer(schema, transport, monkeypatch):
    """Only identity/entitlement is fixture-owned; route/service/REST/SQL are real."""
    data = seed(schema); nonce = uuid4(); app = FastAPI(); app.include_router(writing.router)
    app.dependency_overrides[writing.get_current_student] = lambda: {
        'id': str(data['student']), 'user_id': str(data['user'])}
    root = f"/api/writing/my-assignments/{data['assignment']}"
    with TestClient(app) as client:
        response = client.post(root + '/admissions', json={'protocol': 'admission-v1', 'launch_nonce': str(nonce)})
        assert response.status_code == 200 and response.headers['cache-control'] == 'private, no-store'
        command = response.json()['command']['command_id']
        path = root + '/admissions/' + command
        monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_LEDGER_ENABLED', False)
        monkeypatch.setattr(admission.settings, 'CORE_ADMISSION_RECOVERY_ENABLED', True)
        before = len(transport['calls'])
        assert client.post(root + '/admissions', json={'protocol': 'admission-v1', 'launch_nonce': str(uuid4())}).status_code == 404
        assert len(transport['calls']) == before  # recovery-only cannot create A
        transport['drop'] = '/rpc/fn_execute_writing_admission'
        failed_ack = client.post(path + '/execute', json={'protocol': 'admission-v1', 'generation': 0})
        assert failed_ack.status_code == 503 and failed_ack.headers['cache-control'] == 'private, no-store'
        assert 'SQL' not in failed_ack.text and 'postgres' not in failed_ack.text.lower()
        canonical = snapshot(schema, data)
        recovered = client.get(root + '/admission-intents/' + str(nonce))
        assert recovered.status_code == 200 and recovered.json()['found'] is True
        assert recovered.json()['admission']['command']['phase'] == 'bound'
        replay = client.post(path + '/execute', json={'protocol': 'admission-v1', 'generation': 0})
        reloaded = client.get(path)
        assert replay.status_code == reloaded.status_code == 200
        assert replay.json()['timer'] == reloaded.json()['timer']
        assert snapshot(schema, data) == canonical and canonical['started_at'] is not None
