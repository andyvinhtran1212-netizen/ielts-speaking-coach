"""Request id for telemetry written below the router (BL-09).

`main.request_id_middleware` already resolves the X-Request-ID that the
response echoes and error_logs carry. AI providers run several layers below
any route, so the id travels in a ContextVar (copied into the grading tasks the
request spawns) instead of being threaded through every signature. Background
work outside a request reads ``None``.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar

# The header is client-supplied; a ledger column is no place for a payload.
_MAX_LEN = 128

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)


@contextmanager
def request_id_scope(request_id: str | None):
    token = _request_id.set(request_id[:_MAX_LEN] if request_id else None)
    try:
        yield
    finally:
        _request_id.reset(token)


def current_request_id() -> str | None:
    return _request_id.get()
