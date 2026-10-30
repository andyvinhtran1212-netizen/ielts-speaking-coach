"""PC-J428: real singleton/pinned builders, with no network I/O.

Independent builders may share the initialized service client. Changing client
auth/schema/default headers or closing it during requests is outside this
contract. Replace only PostgREST's transport, as init_supabase_http_client does.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor

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
