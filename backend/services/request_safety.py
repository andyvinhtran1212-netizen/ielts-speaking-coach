"""Bound untrusted request bodies before form/JSON parsing.

POST /api/error-logs and POST /api/analytics/events stay anonymous on purpose:
the landing page, web-vitals beacon and the exam "nothing saved" alarm post
without a session (F10). They are bounded instead by body size, a per-client
budget and a per-worker ceiling. Budgets are per worker (not a distributed
WAF replacement); only the client address is retained, never user identifiers.

Client key (client_address(); the same rule keys RequestSafetyMiddleware, the
/tts burst throttle and the Reading anon_src hash):

1. the RIGHTMOST globally routable X-Forwarded-For hop. Proxies append, so the
   hop our edge adds is on the right; every hop to its left is whatever the
   caller sent. Non-global hops after it (private, CGNAT 100.64/10, loopback,
   link-local: proxy infrastructure) are skipped, so an internal hop appended
   behind the edge does not fold every visitor into one key;
2. else X-Real-IP;
3. else the rightmost X-Forwarded-For hop (a local proxy with private
   addresses only);
4. else the socket peer.

X-Real-IP is not trusted when X-Forwarded-For carries a public hop: SA-1029-XFF1
measured on staging that, for a caller whose egress is Cloudflare's (WARP,
AS13335), Railway's edge sets X-Real-IP from the caller's LEFTMOST XFF hop, so
"X-Forwarded-For: <random>, ..." minted a fresh budget per request. Only valid
IP addresses count ("unknown", ports, brackets and oversize values are skipped
or stripped), and IPv6 is keyed per /64, the block one subscriber controls.
If the key is ever forged or collapses to one proxy address, the per-worker
ceiling still holds.
"""
from collections import deque
import ipaddress
import logging
import time

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

from config import settings


# Enough for the edge hop plus a few internal proxies; hops further left are
# caller-supplied anyway, and a huge header must not cost a huge parse.
_MAX_INSPECTED_HOPS = 8
_MAX_HOP_LENGTH = 64


def _parse_ip(value):
    """One header entry as an IP address, or None. Accepts "a.b.c.d:port",
    "[v6]" and "[v6]:port"; unwraps IPv4-mapped IPv6."""
    value = (value or '').strip()
    if not value or len(value) > _MAX_HOP_LENGTH:
        return None
    if value.startswith('['):
        host, sep, rest = value[1:].partition(']')
        if not sep or (rest and not (rest[:1] == ':' and rest[1:].isdigit())):
            return None
        value = host
    elif value.count(':') == 1:
        value, _, port = value.partition(':')
        if not port.isdigit():
            return None
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return None
    if ip.version == 6 and ip.ipv4_mapped:
        return ip.ipv4_mapped
    return ip


def _key(ip):
    if ip.version == 6:
        return str(ipaddress.IPv6Network((int(ip) >> 64 << 64, 64)))
    return str(ip)


def client_address(real_ip, forwarded_for, peer):
    """Rate-limit key: rightmost public X-Forwarded-For hop, else X-Real-IP,
    else rightmost X-Forwarded-For hop, else the socket peer (module doc)."""
    entries = (forwarded_for or '').rsplit(',', _MAX_INSPECTED_HOPS)[-_MAX_INSPECTED_HOPS:]
    hops = [ip for ip in map(_parse_ip, entries) if ip is not None]
    for ip in reversed(hops):
        if ip.is_global:
            return _key(ip)
    for ip in (_parse_ip(real_ip), hops[-1] if hops else None, _parse_ip(peer)):
        if ip is not None:
            return _key(ip)
    return peer


def request_client_ip(request):
    """client_address() for a Starlette request; shared by routers that key
    per-IP state on the caller (TTS throttle, Reading anon_src hash)."""
    if request is None:
        return None
    headers = request.headers
    getlist = getattr(headers, 'getlist', None)

    def values(name):
        return getlist(name) if getlist else [v for v in (headers.get(name),) if v]

    real_ip = values('x-real-ip')
    return client_address(real_ip[-1] if real_ip else None,
                          ', '.join(values('x-forwarded-for')),
                          request.client.host if request.client else None)


# TEMPORARY (PC-J142 Bước 0, SA-1029-XFF1) — REMOVE BEFORE PROMOTE. Records
# what Railway's edge forwards for a request that opts in with
# "X-Aver-IP-Probe: 1", on staging only: no path, user or token is logged.
# The logger has its own DEBUG level because the app logs at INFO.
_ip_probe_logger = logging.getLogger(__name__ + '.ip_probe')
_ip_probe_logger.setLevel(logging.DEBUG)


def _log_ip_probe(scope, headers):
    if headers.get(b'x-aver-ip-probe') != b'1' or settings.ENVIRONMENT != 'staging':
        return
    raw = scope.get('headers', [])
    client = scope.get('client')
    # Every line of each header, in arrival order: repeated lines are evidence.
    _ip_probe_logger.debug(
        '[ip-probe] x-real-ip=%r x-forwarded-for=%r client.host=%r',
        [v.decode('latin-1')[:256] for k, v in raw if k == b'x-real-ip'][:4],
        [v.decode('latin-1')[:512] for k, v in raw if k == b'x-forwarded-for'][:4],
        client[0] if client else None)


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
    def _client_key(scope):
        # Repeated header lines: XFF lines join in order (the edge's hop stays
        # rightmost); the last X-Real-IP line wins, as in request_client_ip().
        raw = scope.get('headers', [])
        real_ip = [v for k, v in raw if k == b'x-real-ip']
        client = scope.get('client')
        return client_address(real_ip[-1].decode('latin-1') if real_ip else None,
                              ', '.join(v.decode('latin-1') for k, v in raw
                                        if k == b'x-forwarded-for'),
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
        _log_ip_probe(scope, headers)
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
            key = self._client_key(scope)
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
