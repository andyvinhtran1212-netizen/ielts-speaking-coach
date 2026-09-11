"""Canonical Writing snapshots after an acknowledged write and later error.

Normal returns keep their existing hooks. This request-local scope only bridges
multi-write failures; it is not a durable outbox or coverage certificate.
"""

from __future__ import annotations

import inspect
import logging
from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import wraps
from uuid import UUID

from config import settings
from services.core_attempt_outcomes import observe_writing_batch

logger = logging.getLogger(__name__)


@dataclass
class _PartialWrites:
    ids: set[str] = field(default_factory=set)
    active: bool = True


_current: ContextVar[_PartialWrites | None] = ContextVar("core_writing_partial_writes", default=None)


def note_writing_mutation(essay_id: str) -> None:
    """Only after an authorized write ack (or authorized persisted replay).

    IDs are canonical-read candidates, never proof of which fields changed.
    Outside a scope no work is done and no identifier is retained.
    """
    current = _current.get()
    if current is None or not current.active:
        return
    try:
        normalized = str(UUID(str(essay_id)))
    except (ValueError, TypeError, AttributeError):
        logger.warning("core_writing_partial_identity_invalid")
        return
    if len(current.ids) >= 200 and normalized not in current.ids:
        logger.warning("core_writing_partial_identity_limit")
        return
    current.ids.add(normalized)


def observe_writing_partial_failure(endpoint):
    if not inspect.iscoroutinefunction(endpoint):
        raise TypeError("Writing partial observation requires an async endpoint")
    @wraps(endpoint)
    async def observed(*args, **kwargs):
        if not settings.CORE_ATTEMPT_EVIDENCE_ENABLED:
            return await endpoint(*args, **kwargs)
        current = _PartialWrites()
        token = _current.set(current)
        try:
            try:
                return await endpoint(*args, **kwargs)
            except Exception:
                current.active = False
                if current.ids:
                    try:
                        await observe_writing_batch(list(current.ids))
                    except Exception:
                        logger.warning("core_writing_partial_observation_unavailable")
                raise
        finally:
            # Detached tasks may inherit the object, but cannot append after
            # this request ends. Cancellation propagates without new reads.
            current.active = False
            _current.reset(token)
    # Resolve router-local postponed annotations for FastAPI's dependencies.
    observed.__signature__ = inspect.signature(endpoint, eval_str=True, follow_wrapped=False)
    return observed
