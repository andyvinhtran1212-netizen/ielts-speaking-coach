"""Private, opt-in evidence receipts; never a grading or Gate F decision engine.

Callers must supply server-verified canonical IDs. Speaking full-test parts use
their shared full_test_attempt_id, not the session/part UUID. Writing assignment
creation is not a learner start. Browser claims are not evidence of organic use.
No caller integration is enabled by this foundation alone. UUID join keys are
pseudonymous, not anonymous: retention/erasure must be approved before capture.
Always use a separate RPC transaction AFTER a committed learner operation;
never invoke the SQL function inside the learner's write transaction.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from enum import Enum
from uuid import UUID

import httpx

from config import settings

logger = logging.getLogger(__name__)
RECEIPT_TIMEOUT_SECONDS = 0.5

SURFACES = frozenset({
    "speaking", "reading_exam", "listening_test", "listening_dictation", "writing_assignment",
})
OPERATIONS = frozenset({"start", "save", "submit", "grade", "finalize"})
EVENT_KINDS = frozenset({"started", "operation_succeeded", "operation_failed", "outcome_observed"})
OUTCOMES = frozenset({"pending", "success", "failed", "abandoned", "unknown"})
ERROR_CODES = frozenset({"timeout", "transport", "conflict", "rejected", "server_error", "unknown"})


class ReceiptStatus(str, Enum):
    DISABLED = "disabled"
    RECORDED = "recorded"
    UNAVAILABLE = "unavailable"
    CONFLICT = "conflict"
    INVALID = "invalid"


@dataclass(frozen=True)
class EvidenceEvent:
    # Keep this event_id across transport retries; allocate another event_id
    # for another observation of the SAME operation_id/canonical_attempt_id.
    event_id: UUID
    operation_id: UUID
    surface: str
    canonical_attempt_id: UUID | None
    operation: str
    event_kind: str
    attempt_kind: str = "default"
    start_observed: bool = False
    outcome: str | None = None
    renderer: str | None = None
    traffic_class: str = "unknown"
    release_id: str | None = None
    error_code: str | None = None

    def __post_init__(self) -> None:
        allowed_kinds = {"speaking_session", "speaking_full_test"} if self.surface == "speaking" else {"default"}
        if self.attempt_kind not in allowed_kinds:
            raise ValueError("attempt kind must match its surface")
        if not isinstance(self.event_id, UUID) or not isinstance(self.operation_id, UUID):
            raise ValueError("evidence IDs must be UUIDs")
        if self.canonical_attempt_id is not None and not isinstance(self.canonical_attempt_id, UUID):
            raise ValueError("canonical attempt ID must be a UUID")
        for value, choices in (
            (self.surface, SURFACES), (self.operation, OPERATIONS),
            (self.event_kind, EVENT_KINDS), (self.outcome, OUTCOMES | {None}),
            (self.renderer, {None, "legacy", "next"}),
            (self.traffic_class, {"unknown", "organic", "synthetic"}),
            (self.error_code, ERROR_CODES | {None}),
        ):
            if value not in choices:
                raise ValueError("unsupported evidence field")
        if type(self.start_observed) is not bool:
            raise ValueError("start_observed must be boolean")
        if self.release_id is not None and not re.fullmatch(r"[a-f0-9]{40}", self.release_id):
            raise ValueError("release must be a full commit SHA")
        if (self.event_kind == "outcome_observed") != (self.outcome is not None):
            raise ValueError("only outcome observations have an outcome")
        if (self.event_kind == "operation_failed") != (self.error_code is not None):
            raise ValueError("only operation failures have an error code")
        if self.canonical_attempt_id is None and not (
            self.operation == "start" and self.event_kind == "operation_failed"
        ):
            raise ValueError("only pre-start failure can lack a canonical attempt")
        if self.event_kind == "started" and self.operation != "start":
            raise ValueError("started requires start operation")
        if self.event_kind == "started" and not self.start_observed:
            raise ValueError("use operation_succeeded, not started, for a resumed attempt")
        if self.start_observed and (self.event_kind != "started" or self.canonical_attempt_id is None):
            raise ValueError("start evidence requires an observed start")

    def rpc_params(self) -> dict:
        return {
            "p_event_id": str(self.event_id),
            "p_operation_id": str(self.operation_id),
            "p_surface": self.surface,
            "p_canonical_attempt_id": str(self.canonical_attempt_id) if self.canonical_attempt_id else None,
            "p_start_observed": self.start_observed,
            "p_operation": self.operation,
            "p_event_kind": self.event_kind,
            "p_outcome": self.outcome,
            "p_renderer": self.renderer,
            "p_traffic_class": self.traffic_class,
            "p_release_id": self.release_id,
            "p_error_code": self.error_code,
            "p_attempt_kind": self.attempt_kind,
        }


async def try_record_event(**fields) -> ReceiptStatus:
    """Total, bounded entry point for future ASGI callers; accepts event fields.

    Disabled/unavailable is NOT a successful observation and must invalidate
    coverage in any future evidence report. Do not background this call and
    then claim its receipt was persisted. Transport retries reuse ALL fields,
    including event_id. INVALID and CONFLICT are non-retryable integration
    defects, not transport failures. The strict value object is constructed
    inside this boundary so malformed metadata cannot break learner requests.
    """
    if not settings.CORE_ATTEMPT_EVIDENCE_ENABLED:
        return ReceiptStatus.DISABLED
    try:
        event = EvidenceEvent(**fields)
    except (TypeError, ValueError):
        logger.error("core_attempt_evidence_invalid")
        return ReceiptStatus.INVALID
    try:
        # A dedicated async client avoids blocking the event loop, changing the
        # shared Supabase client's 120s timeout, or sharing that sync transport
        # across threads. Outer deadline also bounds pool/connect/response work.
        async with asyncio.timeout(RECEIPT_TIMEOUT_SECONDS):
            async with httpx.AsyncClient(timeout=RECEIPT_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    settings.SUPABASE_URL.rstrip("/") + "/rest/v1/rpc/fn_record_core_attempt_evidence",
                    headers={
                        "apikey": settings.SUPABASE_SERVICE_KEY,
                        "Authorization": "Bearer " + settings.SUPABASE_SERVICE_KEY,
                    },
                    json=event.rpc_params(),
                )
                if 400 <= response.status_code < 500 and response.status_code not in {408, 429}:
                    try:
                        error = response.json()
                    except ValueError:
                        error = None
                    if isinstance(error, dict) and error.get("code") == "23505" and error.get("message") == "evidence_event_conflict":
                        logger.error("core_attempt_evidence_conflict surface=%s operation=%s", event.surface, event.operation)
                        return ReceiptStatus.CONFLICT
                    logger.error("core_attempt_evidence_rejected surface=%s operation=%s status=%s",
                                 event.surface, event.operation, response.status_code)
                    return ReceiptStatus.INVALID
                response.raise_for_status()
                if response.json() != str(event.event_id):
                    raise ValueError("unexpected evidence receipt")
    except Exception:
        # Exception text can contain credentials or request data. Neither it,
        # learner identifiers, nor the RPC payload belongs in this log.
        logger.warning("core_attempt_evidence_unavailable surface=%s operation=%s", event.surface, event.operation)
        return ReceiptStatus.UNAVAILABLE
    return ReceiptStatus.RECORDED
