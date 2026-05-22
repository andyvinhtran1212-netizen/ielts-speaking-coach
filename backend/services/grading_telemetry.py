"""
services.grading_telemetry — Sprint 14.3

Best-effort writer for the `grading_events` audit table (migration 073).
Receives the orchestrator's :class:`FallbackEvent` list and persists
one row per attempt per provider so we can answer:

  * How often does Haiku fail in production?
  * What's the per-provider success rate + latency distribution?
  * When the chain falls through to Sonnet, what was the trigger?

Telemetry **never** blocks grading. All failures here log a warning
and return — the grading result is the contract; the audit row is a
nice-to-have. Sprint 14.7+ may add metrics + alerting on top.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Iterable

from database import supabase_admin

from .grading_providers.errors import FallbackEvent

logger = logging.getLogger(__name__)


_TABLE = "grading_events"


def log_fallback_events(
    *,
    session_id: str | None,
    question_id: str | None,
    response_id: str | None,
    events: Iterable[FallbackEvent],
    event_kind: str = "grading",
) -> None:
    """Insert one row per :class:`FallbackEvent`. Never raises.

    ``response_id`` may be ``None`` when grading failed entirely (no
    response row was persisted); the audit trail still records what
    happened. Likewise the row schema treats `response_id` /
    `question_id` / `session_id` as optional fkeys.

    Sprint 14.7 — ``event_kind`` discriminates the workflow that
    produced the events. Defaults to ``'grading'`` so existing callers
    don't need to update. The off-topic judge passes
    ``'off_topic_judge'``; future kinds extend the table CHECK.
    """
    rows = [_event_to_row(e, session_id, question_id, response_id, event_kind)
            for e in events]
    if not rows:
        return

    try:
        supabase_admin.table(_TABLE).insert(rows).execute()
        logger.debug(
            "[telemetry] inserted %d grading_events rows (kind=%s session=%s response=%s)",
            len(rows), event_kind, session_id, response_id,
        )
    except Exception as exc:
        # Best-effort: never block grading on a telemetry write.
        logger.warning(
            "[telemetry] insert into %s failed (non-fatal): %s",
            _TABLE, exc,
        )


def _event_to_row(
    event: FallbackEvent,
    session_id: str | None,
    question_id: str | None,
    response_id: str | None,
    event_kind: str,
) -> dict:
    return {
        "session_id":   session_id,
        "question_id":  question_id,
        "response_id":  response_id,
        "timestamp":    datetime.now(timezone.utc).isoformat(),
        "provider":     event.provider,
        "attempt":      event.attempt,
        "outcome":      event.outcome,
        "error_status": event.error_status,
        "error_type":   event.error_type,
        "latency_ms":   event.latency_ms,
        "event_kind":   event_kind,
    }
