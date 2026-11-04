"""Sentry error reporting for the FastAPI backend (PC-J597).

Supersedes the 2026-05-18 "no Sentry" decision recorded in migration 061 (owner
approval t1358u, 2026-11-03). The ``error_logs`` table and its admin page stay
as they are; Sentry is an additional sink.

Off unless ``SENTRY_DSN`` is set: no SDK client, no transport thread, no log
line. When on, events are scrubbed before they leave the process:

* no request body, cookies, query string, client env or user context, and only
  an allowlist of request headers (never Authorization, Cookie, API keys or the
  Reading password header);
* every URL loses its query string and fragment, and Reading share-link paths
  lose their token (the same capability ``services/log_redaction.py`` hides
  from the access log);
* in every string: e-mail addresses and JWT/Bearer credentials are removed,
  UUIDs (user, session, attempt ids) become a stable ``uuid:<sha256 prefix>``
  pseudonym, and serialized pydantic validation errors (which quote the
  rejected input) are omitted, as in ``services/errors.py``;
* no local variables in stack frames.

Only the Starlette/FastAPI and logging integrations run (plus the SDK's
default stdlib ones): the auto-enabling integrations would patch the AI, HTTP
and database clients on the grading path. Events are sent by the SDK's own
background thread, so capture never blocks the event loop.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
from collections.abc import Mapping
from typing import Any

from services.cors_policy import resolve_tier
from services.errors import redact_validation_text
from services.log_redaction import _SHARE_PATH

logger = logging.getLogger(__name__)

TRACES_SAMPLE_RATE = 0.05

ALLOWED_REQUEST_HEADERS = frozenset({
    "accept", "accept-language", "content-length", "content-type", "host",
    "origin", "user-agent", "x-request-id",
})
# Span/breadcrumb data keys that carry a query string or fragment verbatim.
_QUERY_DATA_KEYS = frozenset({"http.query", "http.fragment", "url.query", "url.fragment"})

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*")
_BEARER = re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+")
_UUID = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")
_URL_QUERY = re.compile(r"(\b[a-zA-Z][a-zA-Z0-9+.-]*://[^\s?#'\"<>]*)[?#][^\s'\"<>]*")


def _pseudonym(match: re.Match) -> str:
    digest = hashlib.sha256(match.group(0).lower().encode()).hexdigest()
    return f"uuid:{digest[:12]}"


def scrub_text(text: str) -> str:
    text = redact_validation_text(text)
    text = _URL_QUERY.sub(r"\1", text)
    text = _SHARE_PATH.sub(r"\1[redacted]", text)
    text = _JWT.sub("[jwt]", text)
    text = _BEARER.sub("Bearer [redacted]", text)
    text = _EMAIL.sub("[email]", text)
    return _UUID.sub(_pseudonym, text)


def _scrub(value: Any) -> Any:
    if isinstance(value, str):
        return scrub_text(value)
    if isinstance(value, dict):
        return {key: _scrub(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_scrub(item) for item in value]
    return value


def _strip_query_data(data: Any) -> None:
    if isinstance(data, dict):
        for key in _QUERY_DATA_KEYS & data.keys():
            del data[key]


def _scrub_event(event: dict) -> dict:
    request = event.get("request")
    if isinstance(request, dict):
        for key in ("data", "cookies", "query_string", "env"):
            request.pop(key, None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {
                name: value for name, value in headers.items()
                if str(name).lower() in ALLOWED_REQUEST_HEADERS
            }
    event.pop("user", None)
    for span in event.get("spans") or ():
        if isinstance(span, dict):
            _strip_query_data(span.get("data"))
    breadcrumbs = event.get("breadcrumbs")
    for crumb in (breadcrumbs.get("values") if isinstance(breadcrumbs, dict) else breadcrumbs) or ():
        if isinstance(crumb, dict):
            _strip_query_data(crumb.get("data"))
    return _scrub(event)


def before_send(event: dict, hint: dict | None = None) -> dict | None:
    """Scrub an error/transaction event; drop it if scrubbing itself fails.

    A log record marked ``extra={"sentry_skip": True}`` is dropped: main.py's
    unhandled-exception handler logs an exception the SDK already reports.
    """
    if getattr((hint or {}).get("log_record"), "sentry_skip", False):
        return None
    try:
        return _scrub_event(event)
    except Exception:  # noqa: BLE001 — never ship an unscrubbed event
        return None


def resolve_environment(env: Mapping[str, str] | None = None) -> str:
    """``AVER_ENVIRONMENT`` when set, else the CORS deployment tier.

    Railway production sets no ``ENVIRONMENT`` (see services/cors_policy.py),
    so the tier also reads ``RAILWAY_ENVIRONMENT_NAME``.
    """
    env = os.environ if env is None else env
    explicit = (env.get("AVER_ENVIRONMENT") or "").strip()
    if explicit:
        return explicit
    return resolve_tier(env.get("ENVIRONMENT"), env.get("RAILWAY_ENVIRONMENT_NAME"))


def init_sentry(dsn: str | None, env: Mapping[str, str] | None = None) -> bool:
    """Initialise the SDK when ``dsn`` is non-empty. Returns whether it did."""
    dsn = (dsn or "").strip()
    if not dsn:
        return False
    env = os.environ if env is None else env
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration

        environment = resolve_environment(env)
        sentry_sdk.init(
            dsn=dsn,
            environment=environment,
            release=(env.get("RAILWAY_GIT_COMMIT_SHA") or "").strip() or None,
            send_default_pii=False,
            include_local_variables=False,
            max_request_body_size="never",
            traces_sample_rate=TRACES_SAMPLE_RATE,
            before_send=before_send,
            before_send_transaction=before_send,
            auto_enabling_integrations=False,
            integrations=[
                StarletteIntegration(),
                FastApiIntegration(),
                LoggingIntegration(level=logging.WARNING, event_level=logging.ERROR),
            ],
        )
    except Exception as exc:  # noqa: BLE001 — reporting must never stop startup
        logger.warning("[sentry] not initialised: %s", type(exc).__name__)
        return False
    logger.info("[sentry] enabled (environment=%s)", environment)
    return True
