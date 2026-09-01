"""Canonical maximum lifetime for resumable stateful players.

The legacy/Next renderer claim is sticky only while the underlying attempt can
still accept learner mutations.  A row may remain in ``in_progress`` forever
for audit/history purposes, but once ``resume_expires_at`` passes it is no
longer a live renderer dependency: clients must start a new attempt and every
mutation path must fail closed.

No helper in this module deletes, scrubs or rewrites learner work.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException


ACTIVE_PLAYER_TTL = timedelta(hours=24)
ACTIVE_PLAYER_EXPIRED_DETAIL = (
    "Phiên làm bài đã hết thời gian tiếp tục. Dữ liệu cũ vẫn được lưu; "
    "hãy bắt đầu một phiên mới."
)
ACTIVE_PLAYER_EXPIRED_MARKER = "active_player_expired"


def _parse_utc(value: object) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(timezone.utc)


def resume_expires_at(started_at: object | None = None, *, now: datetime | None = None) -> str:
    """Return the canonical 24-hour hard expiry as an aware ISO timestamp."""
    anchor = _parse_utc(started_at) if started_at is not None else None
    anchor = anchor or (now or datetime.now(timezone.utc))
    return (anchor + ACTIVE_PLAYER_TTL).astimezone(timezone.utc).isoformat()


def is_resume_active(row: dict, *, now: datetime | None = None) -> bool:
    """True only for a well-formed, unexpired ``in_progress`` resource.

    Missing/malformed expiry fails closed.  That makes a partial rollout or a
    schema-contract regression visible instead of silently turning an ancient
    row into a resumable Legacy dependency again.
    """
    if row.get("status") != "in_progress":
        return False
    expiry = _parse_utc(row.get("resume_expires_at"))
    if expiry is None:
        return False
    observed = now or datetime.now(timezone.utc)
    if observed.tzinfo is None or observed.utcoffset() is None:
        observed = observed.replace(tzinfo=timezone.utc)
    return expiry > observed.astimezone(timezone.utc)


def require_resume_active(row: dict, *, now: datetime | None = None) -> None:
    """Raise HTTP 410 when a player resource can no longer be resumed."""
    if not is_resume_active(row, now=now):
        raise HTTPException(status_code=410, detail=ACTIVE_PLAYER_EXPIRED_DETAIL)


def is_active_player_expired_error(exc: BaseException) -> bool:
    """Recognize the canonical PostgreSQL guard error across PostgREST wrappers."""
    return ACTIVE_PLAYER_EXPIRED_MARKER in str(exc).lower()
