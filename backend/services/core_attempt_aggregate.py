"""Receipt-cohort diagnostics, never a substitute for all-eligible attempts."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Literal

import httpx
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from config import settings
from database import get_supabase_async
from services.core_attempt_inspection import AttemptKind, Count, Surface

logger = logging.getLogger(__name__)
READ_BUDGET_SECONDS = 2.0
STREAMS = {("speaking", "speaking_session"), ("speaking", "speaking_full_test"),
           ("reading_exam", "default"), ("listening_test", "default"),
           ("listening_dictation", "default"), ("writing_assignment", "default")}


def validate_window(start: datetime, end: datetime | None) -> None:
    """Check shape/duration locally; only the DB clock decides future cutoffs."""
    try:
        if start.utcoffset() is None or (end is not None and end.utcoffset() is None):
            raise ValueError("invalid observation window")
        start = start.astimezone(timezone.utc)
        if end is not None:
            end = end.astimezone(timezone.utc)
            if start >= end or end - start > timedelta(days=31):
                raise ValueError("invalid observation window")
    except OverflowError:
        raise ValueError("invalid observation window") from None


UnavailableReason = Literal[
    "timeout", "transport_error", "permission_denied", "window_rejected",
    "schema_unavailable", "query_cancelled", "window_too_large", "contract_mismatch", "unavailable",
]


def unavailable_reason(exc: Exception) -> UnavailableReason:
    # Never return/log exception text, hints, details or an untrusted SQL code.
    if isinstance(exc, (TimeoutError, httpx.TimeoutException)):
        return "timeout"
    if isinstance(exc, APIError):
        return {
            "42501": "permission_denied", "ZC003": "window_rejected",
            "PGRST202": "schema_unavailable", "42P01": "schema_unavailable",
            "42703": "schema_unavailable", "42883": "schema_unavailable",
            "57014": "query_cancelled", "ZC001": "window_too_large",
            "ZC002": "contract_mismatch",
        }.get(exc.code, "unavailable")
    if isinstance(exc, httpx.RequestError):
        return "transport_error"
    return "unavailable"


class ObservationCounts(BaseModel):
    model_config = ConfigDict(extra="forbid")
    surface: Surface
    attempt_kind: AttemptKind
    canonical_attempts: Count
    start_known_at_registration: Count
    start_unknown_at_registration: Count
    without_outcome_attempts: Count
    mixed_outcome_attempts: Count
    attempts_with_pending: Count
    attempts_with_success: Count
    attempts_with_failed: Count
    attempts_with_abandoned: Count
    attempts_with_unknown: Count
    receipts: Count
    bound_attempt_operations: Count
    unbound_start_failure_operations: Count
    server_observation_operations: Count
    renderer_next_receipts: Count
    renderer_legacy_receipts: Count
    renderer_unknown_receipts: Count
    organic_receipts: Count
    synthetic_receipts: Count
    traffic_unknown_receipts: Count
    release_known_receipts: Count
    release_unknown_receipts: Count

    @model_validator(mode="after")
    def consistent_counts(self):
        n, r = self.canonical_attempts, self.receipts
        states = [self.attempts_with_pending, self.attempts_with_success, self.attempts_with_failed,
                  self.attempts_with_abandoned, self.attempts_with_unknown]
        with_outcome = n - self.without_outcome_attempts
        scoped_ops = self.bound_attempt_operations + self.unbound_start_failure_operations
        if ((self.surface, self.attempt_kind) not in STREAMS
                or self.start_known_at_registration + self.start_unknown_at_registration != n
                or not 0 <= with_outcome <= n
                or any(value > with_outcome for value in states)
                or not 0 <= self.mixed_outcome_attempts <= with_outcome
                or not with_outcome + self.mixed_outcome_attempts <= sum(states) <= with_outcome + 4 * self.mixed_outcome_attempts
                or sum(states) + self.without_outcome_attempts + self.unbound_start_failure_operations > r
                or not n <= self.bound_attempt_operations <= r
                or not self.unbound_start_failure_operations <= self.server_observation_operations <= scoped_ops <= r
                or (r > 0 and self.server_observation_operations == 0)
                or self.renderer_next_receipts + self.renderer_legacy_receipts + self.renderer_unknown_receipts != r
                or self.organic_receipts + self.synthetic_receipts + self.traffic_unknown_receipts != r
                or self.release_known_receipts + self.release_unknown_receipts != r):
            raise ValueError("inconsistent observation counts")
        return self


class ObservationSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contract: Literal["core-attempt-observations-v1"]
    window_start: datetime
    window_end: datetime
    snapshot_scope: Literal["single_receipt_snapshot"]
    rows: list[ObservationCounts] = Field(min_length=6, max_length=6)

    @model_validator(mode="after")
    def complete_streams(self):
        validate_window(self.window_start, self.window_end)
        if {(row.surface, row.attempt_kind) for row in self.rows} != STREAMS:
            raise ValueError("missing or duplicate observation stream")
        return self


class ObservationReport(BaseModel):
    # FastAPI additional status-code schemas otherwise use validation mode,
    # omitting the computed coverage caveats from documented 422/503 responses.
    model_config = ConfigDict(extra="forbid", json_schema_mode_override="serialization")
    status: Literal["available", "unavailable"]
    summary: ObservationSnapshot | None = None
    unavailable_reason: UnavailableReason | None = None
    requested_window_start: datetime
    requested_window_end: datetime | None
    read_started_at: datetime
    read_finished_at: datetime
    capture_enabled_on_this_instance: bool
    eligible_attempt_denominator: None = None
    coverage: Literal["unknown"] = "unknown"
    eligibility: Literal["not_assessed"] = "not_assessed"
    gate_f: Literal["not_assessed"] = "not_assessed"

    @computed_field
    @property
    def missing_evidence(self) -> tuple[str, ...]:
        reasons = (
            "receipt_cohort_not_all_admissions", "trusted_traffic_attribution_missing",
            "immutable_release_attribution_missing", "coverage_not_reconciled",
            "coherent_current_outcomes_not_read", "receipt_window_not_commit_watermarked",
        )
        return reasons if self.capture_enabled_on_this_instance else reasons + ("capture_disabled_on_this_instance",)

    @model_validator(mode="after")
    def available_has_snapshot(self):
        if (self.status == "available") != (self.summary is not None):
            raise ValueError("observation availability mismatch")
        if (self.status == "unavailable") != (self.unavailable_reason is not None):
            raise ValueError("observation failure reason mismatch")
        return self


async def get_observation_aggregate(start: datetime, end: datetime | None) -> ObservationReport:
    validate_window(start, end)
    began = datetime.now(timezone.utc)
    summary = None
    reason = None
    try:
        async with asyncio.timeout(READ_BUDGET_SECONDS):
            db = await get_supabase_async()
            result = await db.rpc("fn_core_attempt_observation_aggregate", {
                "p_window_start": start.isoformat(), "p_window_end": end.isoformat() if end is not None else None,
            }).execute()
            try:
                parsed = ObservationSnapshot.model_validate(result.data)
                if parsed.window_start != start or (end is not None and parsed.window_end != end):
                    raise ValueError("observation window mismatch")
                summary = parsed
            except (ValueError, AttributeError):
                reason = "contract_mismatch"
    except Exception as exc:
        summary = None
        reason = unavailable_reason(exc)
    if reason is not None:
        logger.warning("core_attempt_aggregate_unavailable reason=%s", reason)
    return ObservationReport(
        status="available" if summary is not None else "unavailable", summary=summary,
        unavailable_reason=reason, requested_window_start=start, requested_window_end=end,
        read_started_at=began, read_finished_at=datetime.now(timezone.utc),
        capture_enabled_on_this_instance=settings.CORE_ATTEMPT_EVIDENCE_ENABLED,
    )
