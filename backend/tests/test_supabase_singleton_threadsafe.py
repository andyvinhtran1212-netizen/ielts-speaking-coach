"""PC-J428: real singleton/pinned builders, with no network I/O.

Independent builders may share the initialized service client. Changing client
auth/schema/default headers or closing it during requests is outside this
contract. Replace only PostgREST's transport, as init_supabase_http_client does.

ASYNCAUTH-0036 FR-009 (PC-J444): the flag-off auth reads rest on this file at
httpx 0.27.2 / httpcore 1.0.9 / postgrest 2.28.3 / supabase 2.28.3, all pinned
in requirements.txt. Re-run it before merging any change to those versions.
The second test drives the production transport (httpx -> httpcore pool,
HTTP/1.1, real loopback sockets) against a local server.
"""

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import httpx

import database


def test_singleton_independent_builders_keep_headers_params_and_responses_isolated(monkeypatch):
    client = database.supabase_admin
    barrier = threading.Barrier(32)
    seen = set()
    lock = threading.Lock()

    def handle(request):
        time.sleep(0.001)  # overlap sends; never echo service credentials
        marker = request.url.params['marker'].removeprefix('eq.')
        table = request.url.path.rsplit('/', 1)[-1]
        prefer = request.headers['prefer']
        assert f'request={marker}' in prefer
        with lock:
            assert marker not in seen
            seen.add(marker)
        return httpx.Response(200, json=[{
            'marker': marker, 'table': table, 'prefer': prefer,
            'method': request.method,
        }])

    with httpx.Client(transport=httpx.MockTransport(handle), http1=True, http2=False) as transport:
        monkeypatch.setattr(client, '_postgrest', client._init_postgrest_client(
            rest_url=str(client.rest_url), headers=client.options.headers,
            schema=client.options.schema,
            timeout=client.options.postgrest_client_timeout, http_client=transport,
        ))
        original_headers = dict(client.postgrest.headers)

        def query(worker):
            barrier.wait(timeout=10)
            for index in range(60):
                marker = f'{worker}-{index}'
                table = f'j428_mock_{worker}'
                builder = client.table(table)
                operation = index % 4
                if operation == 0:
                    builder = builder.select('marker', count='exact')
                elif operation == 1:
                    builder = builder.update({'marker': marker}, count='planned')
                elif operation == 2:
                    builder = builder.upsert({'marker': marker}, on_conflict='marker', ignore_duplicates=True)
                else:
                    builder = builder.insert({'marker': marker}, default_to_null=False)
                if operation < 2:
                    builder = builder.eq('marker', marker)
                else:
                    # INSERT builders expose params rather than filter methods.
                    builder.request.params = builder.request.params.set('marker', f'eq.{marker}')
                builder.request.headers['Prefer'] = f"{builder.request.headers.get('Prefer', '')},request={marker}"
                expected = {
                    'marker': marker, 'table': table,
                    'prefer': builder.request.headers['Prefer'],
                    'method': ('GET', 'PATCH', 'POST', 'POST')[operation],
                }
                assert builder.execute().data == [expected]

        with ThreadPoolExecutor(max_workers=32) as pool:
            list(pool.map(query, range(32)))
        assert len(seen) == 32 * 60
        assert dict(client.postgrest.headers) == original_headers


class _EchoHandler(BaseHTTPRequestHandler):
    """Answers like PostgREST with the request's own marker; never echoes headers
    other than Prefer (the service key stays out of responses and logs)."""

    protocol_version = 'HTTP/1.1'  # keep-alive, so the httpcore pool reuses sockets

    def _answer(self):
        server = self.server
        url = urlsplit(self.path)
        marker = parse_qs(url.query)['marker'][0].removeprefix('eq.')
        length = int(self.headers.get('Content-Length') or 0)
        payload = json.loads(self.rfile.read(length)) if length else None
        time.sleep(0.001)  # overlap requests across threads
        with server.lock:
            server.connections.add(self.client_address)
            if marker in server.seen or (payload is not None and payload.get('marker') != marker):
                server.mismatches.append(marker)
            server.seen.add(marker)
        body = json.dumps([{
            'marker': marker, 'table': url.path.rsplit('/', 1)[-1],
            'prefer': self.headers['Prefer'], 'method': self.command,
        }]).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = do_PATCH = _answer

    def log_message(self, *_args):
        pass


def test_singleton_shared_by_threads_over_the_real_http11_pool(monkeypatch):
    server = ThreadingHTTPServer(('127.0.0.1', 0), _EchoHandler)
    server.daemon_threads = True
    server.lock, server.seen, server.mismatches, server.connections = threading.Lock(), set(), [], set()
    serving = threading.Thread(target=server.serve_forever, daemon=True)
    serving.start()
    client = database.supabase_admin
    transport = database._build_supabase_http_client()  # the production pool
    try:
        monkeypatch.setattr(client, '_postgrest', client._init_postgrest_client(
            rest_url=f'http://127.0.0.1:{server.server_port}/rest/v1',
            headers=client.options.headers, schema=client.options.schema,
            timeout=client.options.postgrest_client_timeout, http_client=transport,
        ))
        original_headers = dict(client.postgrest.headers)
        barrier = threading.Barrier(32)

        def query(worker):
            barrier.wait(timeout=10)
            for index in range(60):
                marker = f'{worker}-{index}'
                table = f'j444_real_{worker}'
                builder = client.table(table)
                operation = index % 3
                if operation == 0:
                    builder = builder.select('marker').eq('marker', marker)
                elif operation == 1:
                    builder = builder.update({'marker': marker}).eq('marker', marker)
                else:
                    builder = builder.insert({'marker': marker})
                    builder.request.params = builder.request.params.set('marker', f'eq.{marker}')
                builder.request.headers['Prefer'] = f"{builder.request.headers.get('Prefer', '')},request={marker}"
                expected = {
                    'marker': marker, 'table': table,
                    'prefer': builder.request.headers['Prefer'],
                    'method': ('GET', 'PATCH', 'POST')[operation],
                }
                assert builder.execute().data == [expected]

        with ThreadPoolExecutor(max_workers=32) as pool:
            list(pool.map(query, range(32)))
    finally:
        transport.close()
        server.shutdown()
        server.server_close()
    assert server.mismatches == []
    assert len(server.seen) == 32 * 60
    # Concurrent checkouts opened several sockets, and keep-alive reused them.
    assert 1 < len(server.connections) < 32 * 60
    assert dict(client.postgrest.headers) == original_headers
