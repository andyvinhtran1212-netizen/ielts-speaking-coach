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
