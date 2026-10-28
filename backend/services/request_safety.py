"""Bound untrusted request bodies before form/JSON parsing.

POST /api/error-logs and POST /api/analytics/events stay anonymous on purpose:
the landing page, web-vitals beacon and the exam "nothing saved" alarm post
without a session (F10). They are bounded instead by body size, a per-client
budget and a per-worker ceiling. Budgets are per worker (not a distributed
WAF replacement); only the client address is retained, never user identifiers.

The client key is X-Real-IP, which Railway's edge sets to the client's remote
IP (https://docs.railway.com/networking/public-networking/specs-and-limits).
Without it (local/dev, other proxies) the LAST X-Forwarded-For hop is used:
earlier hops are caller-supplied. Without either header the socket peer is
used. If the key is ever forged or collapses to one proxy address, the
per-worker ceiling still holds.
"""
from collections import deque
import time

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse


def client_address(real_ip, forwarded_for, peer):
    """X-Real-IP, else the last X-Forwarded-For hop, else the socket peer."""
    for value in (real_ip, forwarded_for):
        hops = [hop.strip() for hop in (value or '').split(',') if hop.strip()]
        if hops:
            return hops[-1][:64]
    return peer


def request_client_ip(request):
    """client_address() for a Starlette request; shared by routers that key
    per-IP state on the caller (TTS throttle, Reading anon_src hash)."""
    if request is None:
        return None
    return client_address(request.headers.get('x-real-ip'),
                          request.headers.get('x-forwarded-for'),
                          request.client.host if request.client else None)


class RequestSafetyMiddleware:
    def __init__(self, app, *, upload_limit=64 * 1024 * 1024,
                 log_limit=64 * 1024, log_per_minute=600,
                 analytics_limit=16 * 1024, analytics_per_minute=300,
                 log_per_client_per_minute=60, analytics_per_client_per_minute=120,
                 max_tracked_clients=10_000,
                 fulltest_upload_limit=68 * 1024 * 1024):
        self.app = app
        self.upload_limit = upload_limit
        # Full-test commit accepts 60 MiB audio + three 2 MiB text files.
        # Reserve another 2 MiB for the multipart envelope without relaxing
        # every upload route's limit or its existing per-file validation.
        self.fulltest_upload_limit = fulltest_upload_limit
        self.log_limit = log_limit
        self.log_per_minute = log_per_minute
        self.analytics_limit = analytics_limit
        self.analytics_per_minute = analytics_per_minute
        self.log_per_client_per_minute = log_per_client_per_minute
        self.analytics_per_client_per_minute = analytics_per_client_per_minute
        self.max_tracked_clients = max_tracked_clients
        self._log_times = deque()
        self._analytics_times = deque()
        self._log_clients = {}
        self._analytics_clients = {}

    @staticmethod
    def _client_key(scope, headers):
        client = scope.get('client')
        return client_address(headers.get(b'x-real-ip', b'').decode('latin-1'),
                              headers.get(b'x-forwarded-for', b'').decode('latin-1'),
                              client[0] if client else 'unknown')

    def _client_times(self, clients, key, now):
        if key not in clients and len(clients) >= self.max_tracked_clients:
            for stale in [k for k, times in clients.items() if not times or times[-1] <= now - 60]:
                del clients[stale]
            if len(clients) >= self.max_tracked_clients:
                # Spread across too many addresses: share one overflow bucket
                # rather than grow without bound (the worker ceiling still holds).
                key = '\0overflow'
        return clients.setdefault(key, deque())

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers = dict(scope.get('headers', []))
        is_log = scope.get('method') == 'POST' and scope.get('path', '').rstrip('/') == '/api/error-logs'
        is_analytics = (scope.get('method') == 'POST'
                        and scope.get('path', '').rstrip('/') == '/api/analytics/events')
        multipart = headers.get(b'content-type', b'').lower().startswith(b'multipart/form-data')
        if not is_log and not is_analytics and not multipart:
            return await self.app(scope, receive, send)

        now = time.monotonic()

        def rate_limited(times, budget):
            while times and times[0] <= now - 60:
                times.popleft()
            if len(times) >= budget:
                return True
            times.append(now)
            return False

        if is_log or is_analytics:
            key = self._client_key(scope, headers)
            if is_log:
                clients, client_budget = self._log_clients, self.log_per_client_per_minute
                worker, worker_budget = self._log_times, self.log_per_minute
                detail = 'Logging rate limit reached'
            else:
                clients, client_budget = self._analytics_clients, self.analytics_per_client_per_minute
                worker, worker_budget = self._analytics_times, self.analytics_per_minute
                detail = 'Analytics rate limit reached'
            # Per-client first, so one flooding address cannot spend the
            # shared worker budget that every other visitor relies on.
            if (rate_limited(self._client_times(clients, key, now), client_budget)
                    or rate_limited(worker, worker_budget)):
                return await JSONResponse({'detail': detail}, 429,
                                          headers={'Retry-After': '60'})(scope, receive, send)
        limit = self.log_limit if is_log else self.analytics_limit if is_analytics else self.upload_limit
        if (multipart and scope.get('method') == 'POST'
                and scope.get('path', '').rstrip('/') == '/admin/listening/import-fulltest/commit'):
            limit = self.fulltest_upload_limit
        try:
            length = int(headers.get(b'content-length', b'0'))
            if length < 0:
                raise ValueError
        except ValueError:
            return await JSONResponse({'detail': 'Invalid Content-Length'}, 400)(scope, receive, send)
        if length > limit:
            return await JSONResponse({'detail': 'Request body too large'}, 413)(scope, receive, send)
        size = 0

        async def bounded_receive():
            nonlocal size
            message = await receive()
            if message['type'] == 'http.request':
                size += len(message.get('body', b''))
                if size > limit:
                    # FastAPI preserves HTTPException raised while parsing the
                    # body; its normal handler also adds the CORS/error contract.
                    raise HTTPException(413, 'Request body too large')
            return message

        return await self.app(scope, bounded_receive, send)
