"""Bound untrusted request bodies before form/JSON parsing.

The error-ingress budget is per worker (not a distributed WAF replacement).
No forwarded IP headers are trusted and no user identifiers are retained.
"""
from collections import deque
import time

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse


class RequestSafetyMiddleware:
    def __init__(self, app, *, upload_limit=64 * 1024 * 1024,
                 log_limit=64 * 1024, log_per_minute=600,
                 fulltest_upload_limit=68 * 1024 * 1024):
        self.app = app
        self.upload_limit = upload_limit
        # Full-test commit accepts 60 MiB audio + three 2 MiB text files.
        # Reserve another 2 MiB for the multipart envelope without relaxing
        # every upload route's limit or its existing per-file validation.
        self.fulltest_upload_limit = fulltest_upload_limit
        self.log_limit = log_limit
        self.log_per_minute = log_per_minute
        self._log_times = deque()

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers = dict(scope.get('headers', []))
        is_log = scope.get('method') == 'POST' and scope.get('path', '').rstrip('/') == '/api/error-logs'
        multipart = headers.get(b'content-type', b'').lower().startswith(b'multipart/form-data')
        if not is_log and not multipart:
            return await self.app(scope, receive, send)
        if is_log:
            now = time.monotonic()
            while self._log_times and self._log_times[0] <= now - 60:
                self._log_times.popleft()
            if len(self._log_times) >= self.log_per_minute:
                return await JSONResponse({'detail': 'Logging rate limit reached'}, 429,
                                          headers={'Retry-After': '60'})(scope, receive, send)
            self._log_times.append(now)
        limit = self.log_limit if is_log else self.upload_limit
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
