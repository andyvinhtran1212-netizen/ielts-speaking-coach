"""services/errors.py — client-safe error helpers (P0-5 / C-1.3).

The codebase had ~131 `raise HTTPException(500, f"…{e}")` sites plus an unhandled
handler returning `f"Internal server error: {exc}"` — all leaking internal
exception text (stack-ish detail, library messages, sometimes data) to the
client. Rather than rewrite 131 call sites, the central exception layer in
main.py routes every 5xx through `safe_detail()`; this module owns the
sanitization + a `safe_error()` helper for sites that want an explicit
error_code.

Contract: a sanitized error's client detail is ALWAYS the dict
``{"error_code", "message", "ref"}`` — never raw exception text. The full
exception is logged server-side under `ref` so support can correlate. The
frontend reads `detail.message` (api.js already coerces a dict detail → message).
"""
from __future__ import annotations

import logging
import uuid

from fastapi import HTTPException

logger = logging.getLogger(__name__)

# Generic, non-revealing client message (Vietnamese — matches the app UI).
GENERIC_MESSAGE = "Đã xảy ra lỗi nội bộ, vui lòng thử lại."


def new_ref() -> str:
    """Short correlation id the client can quote and we can grep in the logs."""
    return uuid.uuid4().hex[:8]


def safe_error(
    exc: BaseException | None = None,
    *,
    status_code: int = 500,
    error_code: str = "internal_error",
    message: str | None = None,
    context: str = "",
    ref: str | None = None,
) -> HTTPException:
    """Build an HTTPException whose CLIENT-FACING detail is safe.

    The detail is ``{error_code, message, ref}`` (no raw exception text); the
    full exception is logged with `ref`. Use at a call site when you want a
    specific error_code; otherwise just `raise HTTPException(500, f"…{e}")` and
    the central handler will sanitize it.
    """
    ref = ref or new_ref()
    logger.error("[safe_error] ref=%s code=%s %s: %r",
                 ref, error_code, context, exc, exc_info=exc is not None)
    return HTTPException(
        status_code=status_code,
        detail={"error_code": error_code,
                "message": message or GENERIC_MESSAGE,
                "ref": ref},
    )


def safe_detail(status_code: int, detail, *, ref: str | None = None):
    """Sanitize a response detail for the central 5xx handler.

    - 4xx: pass through unchanged (intentional, user-facing client-error messages
      like "session không tồn tại" are safe and meaningful).
    - 5xx already-structured dict carrying an `error_code`: pass through (it was
      built deliberately, e.g. response_persist_failed).
    - any other 5xx (raw string, or dict without error_code): REPLACE with a safe
      dict + log the original under `ref` (this is the leak that P0-5 closes).
    """
    if status_code < 500:
        return detail
    if isinstance(detail, dict) and "error_code" in detail:
        return detail
    ref = ref or new_ref()
    logger.error("[safe_error] ref=%s status=%s sanitized leaked detail=%r",
                 ref, status_code, detail)
    return {"error_code": "internal_error", "message": GENERIC_MESSAGE, "ref": ref}


# ── PC-J225 — client values and validation errors in messages/logs ────────
# A 4xx message may name the value it refused so the user can fix it, but the
# value comes from the request: clip it so a large or multi-line payload is
# not reflected back (or into error_logs) verbatim. Validation errors are
# summarised by `type`/`loc` only — their `input`, `msg`, `ctx` and docs `url`
# can carry the rejected value (a password, a token) and the pydantic version.

USER_VALUE_LIMIT = 64
USER_VALUES_MAX_ITEMS = 10
_MAX_SUMMARY_ERRORS = 10
_VALIDATION_CHAIN_DEPTH = 5


def clip_user_value(value, limit: int = USER_VALUE_LIMIT) -> str:
    """``str(value)`` without control characters or line breaks, at most
    ``limit`` characters plus ``…`` when cut. Callers keep their own quoting
    (``{clip_user_value(x)!r}``)."""
    try:
        raw = value if isinstance(value, str) else str(value)
    except Exception:  # noqa: BLE001 — a broken __str__ must not mask the 4xx
        raw = f"<{type(value).__name__}>"
    kept: list[str] = []
    for ch in raw:
        if ch.isprintable():
            kept.append(ch)
            if len(kept) > limit:
                break
    text = "".join(kept)
    if len(text) > limit:
        text = text[:limit] + "…"
    return text


def clip_user_values(values, limit: int = USER_VALUE_LIMIT,
                     max_items: int = USER_VALUES_MAX_ITEMS) -> list[str]:
    """The first ``max_items`` values through `clip_user_value`, then one
    ``"+N more"`` entry for the rest."""
    items = list(values)
    shown = [clip_user_value(v, limit) for v in items[:max_items]]
    if len(items) > max_items:
        shown.append(f"+{len(items) - max_items} more")
    return shown


def _is_validation_error(exc: BaseException) -> bool:
    from fastapi.exceptions import ValidationException
    from pydantic import ValidationError as PydanticValidationError
    return isinstance(exc, (PydanticValidationError, ValidationException))


def find_validation_error(exc: BaseException | None,
                          depth: int = _VALIDATION_CHAIN_DEPTH) -> BaseException | None:
    """`exc` itself or, at most ``depth`` levels down its ``__cause__`` /
    ``__context__`` chain, a pydantic ``ValidationError`` or a FastAPI
    ``RequestValidationError`` / ``ResponseValidationError``."""
    seen: set[int] = set()
    for _ in range(depth + 1):
        if exc is None or id(exc) in seen:
            return None
        if _is_validation_error(exc):
            return exc
        seen.add(id(exc))
        exc = exc.__cause__ or exc.__context__
    return None


def _validation_error_items(exc: BaseException) -> list[dict]:
    from pydantic import ValidationError as PydanticValidationError
    if isinstance(exc, PydanticValidationError):
        raw = exc.errors(include_input=False, include_url=False, include_context=False)
    else:
        try:
            raw = exc.errors()
        except Exception:  # noqa: BLE001
            raw = []
    items = []
    for err in raw or []:
        if not isinstance(err, dict):
            continue
        loc = err.get("loc") or ()
        if not isinstance(loc, (list, tuple)):
            loc = (loc,)
        items.append({
            "type": clip_user_value(err.get("type") or "unknown"),
            "loc": [part if isinstance(part, int) else clip_user_value(part) for part in loc],
        })
    return items


def summarize_validation_error(exc: BaseException) -> str:
    """Class name plus ``type`` at ``loc`` for each error — never the rejected
    ``input``, the ``msg``/``ctx`` (which can quote it) or the docs ``url``."""
    items = _validation_error_items(exc)
    parts = [
        f"{item['type']} at {'.'.join(str(p) for p in item['loc']) or '<root>'}"
        for item in items[:_MAX_SUMMARY_ERRORS]
    ]
    if len(items) > _MAX_SUMMARY_ERRORS:
        parts.append(f"+{len(items) - _MAX_SUMMARY_ERRORS} more")
    count = len(items)
    noun = "error" if count == 1 else "errors"
    return f"{type(exc).__name__}: {count} validation {noun}" + (
        f": {'; '.join(parts)}" if parts else "")


def validation_error_details(exc: BaseException) -> list[dict]:
    """``{loc, msg, type}`` per error for a 4xx body (same shape as the global
    422 handler) — no ``input``, ``ctx`` or ``url``."""
    from pydantic import ValidationError as PydanticValidationError
    if isinstance(exc, PydanticValidationError):
        raw = exc.errors(include_input=False, include_url=False, include_context=False)
    else:
        raw = exc.errors()
    return [
        {
            "loc": [p if isinstance(p, int) else clip_user_value(p) for p in (err.get("loc") or ())],
            "msg": str(err.get("msg") or ""),
            "type": str(err.get("type") or ""),
        }
        for err in raw or []
    ]


def describe_parse_error(exc: BaseException) -> str:
    """Where a parse of uploaded content failed, without its content: JSON
    line/column, the byte offset of a decode error, a validation summary, or
    just the exception class (``str()`` of a KeyError/ValueError raised while
    walking the upload can quote it)."""
    import json
    if isinstance(exc, json.JSONDecodeError):
        return f"JSONDecodeError (dòng {exc.lineno}, cột {exc.colno})"
    if isinstance(exc, UnicodeDecodeError):
        return f"UnicodeDecodeError (byte {exc.start})"
    if _is_validation_error(exc):
        return summarize_validation_error(exc)
    return type(exc).__name__


def _exception_chain(exc: BaseException) -> list[tuple[BaseException, str | None]]:
    """Oldest first: (exception, separator to print after it or None)."""
    chain: list[tuple[BaseException, str | None]] = []
    seen: set[int] = set()
    link: str | None = None
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        chain.append((exc, link))
        if exc.__cause__ is not None:
            link, exc = "cause", exc.__cause__
        elif exc.__context__ is not None and not exc.__suppress_context__:
            link, exc = "context", exc.__context__
        else:
            exc = None
    # Each entry's link is how it relates to the newer one, i.e. the separator
    # printed after it once the chain is oldest-first.
    chain.reverse()
    return chain


_CHAIN_SEPARATORS = {
    "cause": "\nThe above exception was the direct cause of the following exception:\n\n",
    "context": "\nDuring handling of the above exception, another exception occurred:\n\n",
}


def redacted_traceback(exc: BaseException) -> str:
    """A ``traceback.format_exception`` equivalent that keeps every frame but
    replaces every exception-only line: validation errors by
    `summarize_validation_error`, any other exception in the chain by its
    class name (a wrapper's message often embeds ``str()`` of the cause)."""
    import traceback
    out: list[str] = []
    for item, separator in _exception_chain(exc):
        if item.__traceback__ is not None:
            out.append("Traceback (most recent call last):\n")
            out.extend(traceback.format_tb(item.__traceback__))
        if _is_validation_error(item):
            out.append(summarize_validation_error(item) + "\n")
        else:
            out.append(f"{type(item).__name__}: [message omitted — validation error in chain]\n")
        if separator:
            out.append(_CHAIN_SEPARATORS[separator])
    return "".join(out)
