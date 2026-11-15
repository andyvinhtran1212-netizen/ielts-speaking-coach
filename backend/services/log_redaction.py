"""Remove URL credentials before Uvicorn access handlers format a record."""

import logging
import re
from urllib.parse import unquote_plus


_REDACTED = "<redacted>"
_ACCESS_MESSAGE = '%s - "%s %s HTTP/%s" %d'
# Router audit: reading_student.py's /api/reading/test/share/{share_token}
# boot and attempts endpoints are the only token-bearing router paths.
_SHARE_PATH = re.compile(r"(/test/share/)[^/?#\s]+")
_SECRET_QUERY_NAMES = frozenset({
    "token", "access_token", "refresh_token", "share", "code", "key",
    "signature", "sig", "otp",
})


def _redact_target(target: str) -> str:
    path, separator, query = target.partition("?")
    # Listening request targets can carry learner text in arbitrary query keys.
    # Log a fixed surface, never a client-controlled path/query (FR-026).
    if "/listening" in unquote_plus(path).lower():
        return "/listening/[private]"
    path = _SHARE_PATH.sub(r"\1<redacted>", path)
    if not separator:
        return path

    # Work on raw fields so ordinary query values, ordering, repeated keys and
    # percent escapes remain unchanged. Decode names to catch e.g. %74oken.
    fields = []
    for field in query.split("&"):
        name, equals, value = field.partition("=")
        if equals and unquote_plus(name).lower() in _SECRET_QUERY_NAMES:
            value = _REDACTED
            field = f"{name}={value}"
        fields.append(field)
    return f"{path}?{'&'.join(fields)}"


class AccessLogRedactionFilter(logging.Filter):
    """Keep Uvicorn's five arguments intact for its native AccessFormatter."""

    def filter(self, record: logging.LogRecord) -> bool:
        safe_args = (_REDACTED, _REDACTED, _REDACTED, "1.1", 0)
        try:
            client, method, target, version, status = record.args
            if not all(isinstance(item, str) for item in (client, method, target, version)):
                raise TypeError("Unexpected access log argument type")
            if not isinstance(status, int):
                raise TypeError("Unexpected access log status type")
            safe_args = (client, method, _REDACTED, version, status)
            record.args = (client, method, _redact_target(target), version, status)
        except Exception:
            # Never pass the original message/arguments to logging's error
            # handler: it can print both to stderr. Keep a formatter-safe shape.
            record.msg = _ACCESS_MESSAGE
            record.args = safe_args
            record.exc_info = None
            record.exc_text = None
            record.stack_info = None
        return True
