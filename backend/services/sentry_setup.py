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
* in every string: the values of Postgres/PostgREST row dumps ("Failing row
  contains (...)", "Key (col)=(...)") are redacted, e-mail addresses and
  JWT/Bearer credentials are removed,
  UUIDs (user, session, attempt ids) become a stable ``uuid:<HMAC-SHA256
  prefix>`` pseudonym keyed by ``SENTRY_PSEUDONYM_KEY`` (plain ``[uuid]``
  without a key: an unkeyed hash is reversible by anyone holding the id
  list), and serialized pydantic validation errors (which quote the
  rejected input) are omitted, as in ``services/errors.py``;
* no local variables in stack frames;
* log records become events/breadcrumbs only from the audited loggers in
  ``LOG_CAPTURE_LOGGERS`` (PC-J601 C2): the ~1100 warning/error call sites
  elsewhere interpolate free text (exceptions, AI output, names) that the
  patterns above cannot recognise;
* exceptions the app already answers with a mapped status (``mark_handled``)
  are not reported.

Only the Starlette/FastAPI and logging integrations run (plus the SDK's
default stdlib ones): the auto-enabling integrations would patch the AI, HTTP
and database clients on the grading path. Events are sent by the SDK's own
background thread, so capture never blocks the event loop.
"""

from __future__ import annotations

import hashlib
import hmac
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
# Postgres DETAIL lines quote whole rows / key values (learner names, phones):
# "Failing row contains (...)." and "Key (cols)=(...) already exists." (also
# "is not present in table ...", "is still referenced from ...", "conflicts
# with existing key (...)=(...)."). A value may itself contain ")", ").",
# ") already exists" or a newline, and the message may be truncated, so no
# closing boundary can be trusted: redact from the dump to the END of the
# string. Over-redaction, never a partial leak (PR #2234 R1).
_FAILING_ROW = re.compile(r"(Failing row contains )\(.*", re.DOTALL)
_KEY_VALUE = re.compile(r"(Key \(.*?\)=)\(.*", re.DOTALL)

# Loggers whose WARNING+ records may become breadcrumbs/events. Each call site
# was checked to log only fixed text, ids, paths and exception text (which the
# patterns above scrub). Add a logger only after the same audit (PC-J601 C2).
LOG_CAPTURE_LOGGERS = frozenset({"main"})
_HANDLED_ATTR = "_aver_sentry_handled"
# Set by init_sentry from SENTRY_PSEUDONYM_KEY; None → UUIDs become "[uuid]".
_pseudonym_key: bytes | None = None


def _pseudonym(match: re.Match) -> str:
    if not _pseudonym_key:
        return "[uuid]"
    digest = hmac.new(_pseudonym_key, match.group(0).lower().encode(), hashlib.sha256).hexdigest()
    return f"uuid:{digest[:12]}"


def scrub_text(text: str) -> str:
    text = _FAILING_ROW.sub(r"\1[redacted]", text)
    text = _KEY_VALUE.sub(r"\1[redacted]", text)
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


def mark_handled(exc: BaseException) -> None:
    """Keep ``exc`` out of Sentry: the app answered it with a mapped status.

    Starlette's ServerErrorMiddleware re-raises after the ``Exception`` handler
    has responded, so the SDK would report it as unhandled (PC-J601 P3-2).
    """
    try:
        setattr(exc, _HANDLED_ATTR, True)
    except Exception:  # noqa: BLE001 — an exception type without __dict__
        pass


def _log_record_allowed(record: Any) -> bool:
    return (getattr(record, "name", None) in LOG_CAPTURE_LOGGERS
            and not getattr(record, "sentry_skip", False))


def before_breadcrumb(crumb: dict, hint: dict | None = None) -> dict | None:
    """Drop log breadcrumbs from loggers outside ``LOG_CAPTURE_LOGGERS`` (and
    ``sentry_skip`` records, whose text the reported exception already has)."""
    hint = hint or {}
    if "log_record" in hint:
        return crumb if _log_record_allowed(hint["log_record"]) else None
    if crumb.get("type") == "log":
        return crumb if crumb.get("category") in LOG_CAPTURE_LOGGERS else None
    return crumb


def before_send(event: dict, hint: dict | None = None) -> dict | None:
    """Scrub an error/transaction event; drop it if scrubbing itself fails.

    Also dropped: a log record from a logger outside ``LOG_CAPTURE_LOGGERS``;
    one marked ``extra={"sentry_skip": True}`` (main.py's unhandled-exception
    handler logs an exception the SDK already reports); and an exception
    passed to ``mark_handled``.
    """
    hint = hint or {}
    record = hint.get("log_record")
    if record is not None and not _log_record_allowed(record):
        return None
    exc_info = hint.get("exc_info")
    if exc_info and getattr(exc_info[1], _HANDLED_ATTR, False):
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


def init_sentry(dsn: str | None, env: Mapping[str, str] | None = None,
                pseudonym_key: str | None = None) -> bool:
    """Initialise the SDK when ``dsn`` is non-empty. Returns whether it did.

    ``pseudonym_key`` (``SENTRY_PSEUDONYM_KEY``) keys the UUID pseudonyms;
    without it no UUID, pseudonymised or not, is sent.
    """
    global _pseudonym_key
    dsn = (dsn or "").strip()
    if not dsn:
        return False
    env = os.environ if env is None else env
    _pseudonym_key = (pseudonym_key or "").strip().encode() or None
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
            before_breadcrumb=before_breadcrumb,
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
    logger.info("[sentry] enabled (environment=%s, uuid_pseudonyms=%s)",
                environment, "on" if _pseudonym_key else "off")
    return True
