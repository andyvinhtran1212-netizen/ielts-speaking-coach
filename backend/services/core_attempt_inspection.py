"""Read-only admin diagnostics, deliberately not a Gate F pass/fail metric.

History and canonical readback are separate snapshots. Never infer the current
outcome from the last receipt, infer causal regressions from their difference,
or turn an unavailable history query into zero failed attempts.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator

from config import settings
from database import get_supabase_async
from services.core_attempt_outcomes import (
    DICTATION_COLUMNS, SPEAKING_COLUMNS, Outcome,
    dictation_outcome, speaking_outcome, writing_outcome,
)

logger = logging.getLogger(__name__)
READ_BUDGET_SECONDS = 1.0
WRITING_INSPECTION_COLUMNS = (
    "id,student_id,status,essay_id,renderer_affinity,"
    "essay:writing_essays(id,student_id,status,is_flagged,current_version,deleted_at,"
    "core_evidence_job_summary,"
    "feedback:writing_feedback_current(version,overall_band_score),"
    "jobs:writing_jobs(job_type,status,created_at,completed_at))"
)
Surface = Literal["speaking", "reading_exam", "listening_test", "listening_dictation", "writing_assignment"]
AttemptKind = Literal["default", "speaking_session", "speaking_full_test"]
State = Literal["pending", "success", "failed", "abandoned", "unknown"]
Count = Annotated[int, Field(strict=True, ge=0)]


class OperationCorrelationSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    observed_operations: Count = Field(description="Distinct server observation IDs/operations in stored receipts, including background observations; not all HTTP requests.")
    correlated_operations: Count
    uncorrelated_operations: Count
    client_input_groups: Count = Field(description="Groups by operation, client hint and server fingerprint; not learner attempts or certified logical-intent volume.")
    client_ids_with_multiple_fingerprints: Count

    @model_validator(mode="after")
    def consistent_groups(self):
        if (self.correlated_operations + self.uncorrelated_operations != self.observed_operations
                or self.client_input_groups > self.correlated_operations
                or self.client_ids_with_multiple_fingerprints * 2 > self.client_input_groups):
            raise ValueError("invalid correlation groups")
        return self


class HistorySummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_observed: StrictBool
    first_registered_at: datetime
    receipts: Count = Field(description="Stored event receipts, not learner attempts or logical operations.")
    first_receipt_at: datetime | None
    last_receipt_at: datetime | None
    started: Count
    operation_succeeded: Count
    operation_failed: Count
    outcome_observed: Count
    pending: Count
    success: Count
    failed: Count
    abandoned: Count
    unknown: Count
    renderer_next: Count
    renderer_legacy: Count
    renderer_unknown: Count
    traffic_organic: Count
    traffic_synthetic: Count
    traffic_unknown: Count
    release_unknown: Count
    distinct_known_releases: Count
    operation_correlation: OperationCorrelationSummary | None = None

    @model_validator(mode="after")
    def consistent_partitions(self):
        if self.operation_correlation and self.operation_correlation.observed_operations > self.receipts:
            raise ValueError("operations exceed receipts")
        if (self.started + self.operation_succeeded + self.operation_failed + self.outcome_observed != self.receipts
                or self.pending + self.success + self.failed + self.abandoned + self.unknown != self.outcome_observed
                or self.renderer_next + self.renderer_legacy + self.renderer_unknown != self.receipts
                or self.traffic_organic + self.traffic_synthetic + self.traffic_unknown != self.receipts
                or self.release_unknown + self.distinct_known_releases > self.receipts):
            raise ValueError("invalid history partitions")
        for value in (self.first_registered_at, self.first_receipt_at, self.last_receipt_at):
            if value is not None and value.utcoffset() is None:
                raise ValueError("history timestamp must include timezone")
        if self.receipts:
            if self.first_receipt_at is None or self.last_receipt_at is None or self.first_receipt_at > self.last_receipt_at:
                raise ValueError("invalid receipt timestamps")
        elif self.first_receipt_at is not None or self.last_receipt_at is not None:
            raise ValueError("empty history has receipt timestamps")
        return self


class HistoryRead(BaseModel):
    status: Literal["observed", "not_observed", "unavailable"]
    summary: HistorySummary | None = None


class CanonicalRead(BaseModel):
    status: Literal["read", "not_found", "unavailable"]
    outcome: State = "unknown"
    reason: str
    renderer: Literal["legacy", "next"] | None = None
    flags: list[Literal["writing_grading_without_active_job"]] = Field(default_factory=list)


class AttemptInspection(BaseModel):
    contract: Literal["core-attempt-inspection-v1"] = "core-attempt-inspection-v1"
    surface: Surface
    attempt_kind: AttemptKind
    canonical_attempt_id: UUID
    read_started_at: datetime
    read_finished_at: datetime
    history: HistoryRead
    canonical: CanonicalRead
    capture_enabled_on_this_instance: bool
    coverage: Literal["unknown"] = "unknown"
    eligibility: Literal["not_assessed"] = "not_assessed"
    gate_f: Literal["not_assessed"] = "not_assessed"
    snapshot_scope: Literal["history_and_canonical_separate"] = "history_and_canonical_separate"


async def _history(surface: str, kind: str, canonical_id: UUID) -> HistoryRead:
    try:
        async with asyncio.timeout(READ_BUDGET_SECONDS):
            db = await get_supabase_async()
            result = await db.rpc("fn_inspect_core_attempt_evidence_v2", {
                "p_surface": surface, "p_attempt_kind": kind,
                "p_canonical_attempt_id": str(canonical_id),
            }).execute()
            if result.data is None:
                return HistoryRead(status="not_observed")
            return HistoryRead(status="observed", summary=HistorySummary.model_validate(result.data))
    except Exception:
        logger.warning("core_attempt_inspection_history_unavailable")
        return HistoryRead(status="unavailable")


async def _canonical(surface: str, kind: str, canonical_id: UUID) -> CanonicalRead:
    try:
        async with asyncio.timeout(READ_BUDGET_SECONDS):
            db = await get_supabase_async()
            table, column, columns = {
                "speaking": ("sessions", "id" if kind == "speaking_session" else "full_test_attempt_id", SPEAKING_COLUMNS),
                "listening_dictation": ("dictation_attempts", "id", DICTATION_COLUMNS),
                "writing_assignment": ("writing_assignments", "id", WRITING_INSPECTION_COLUMNS),
                "reading_exam": ("reading_test_attempts", "id", "id,status,renderer_affinity,core_evidence_result_check"),
                "listening_test": ("listening_test_attempts", "id", "id,status,renderer_affinity,core_evidence_result_check"),
            }[surface]
            result = await db.table(table).select(columns).eq(column, str(canonical_id)).limit(4 if surface == "speaking" else 2).execute()
            rows = result.data
            if rows == []:
                return CanonicalRead(status="not_found", reason="canonical_not_found")
            if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                raise ValueError("invalid canonical response")
            flags = []
            if surface == "speaking":
                outcome = speaking_outcome(rows, canonical_id, kind)
            else:
                row = rows[0] if len(rows) == 1 else None
                if surface == "listening_dictation":
                    outcome = dictation_outcome(row, canonical_id)
                elif surface == "writing_assignment":
                    outcome = writing_outcome(row, canonical_id)
                    essay = row.get("essay") if row else None
                    if isinstance(essay, list):
                        essay = essay[0] if len(essay) == 1 else None
                    job_summary = essay.get("core_evidence_job_summary") if isinstance(essay, dict) else None
                    active_jobs = job_summary.get("active_analyze") if isinstance(job_summary, dict) else None
                    total_jobs = job_summary.get("total") if isinstance(job_summary, dict) else None
                    known_counts = (type(active_jobs) is int and type(total_jobs) is int
                                    and 0 <= active_jobs <= total_jobs)
                    if outcome.reason in {"writing_grading_failed", "writing_retry_pending"}:
                        if known_counts and active_jobs > 0:
                            outcome = Outcome("pending", "writing_retry_pending", outcome.renderer)
                        elif not known_counts or total_jobs != len(essay.get("jobs") or []):
                            outcome = Outcome("unknown", "writing_job_history_incomplete", outcome.renderer)
                    # Snapshot warning only: a later job insert may close this
                    # gap. Do not label a queued-but-stalled job without a policy.
                    if outcome.reason == "writing_grading_pending" and isinstance(essay, dict) and essay.get("status") == "grading":
                        if known_counts and active_jobs == 0:
                            flags.append("writing_grading_without_active_job")
                else:
                    renderer = row.get("renderer_affinity") if row else None
                    renderer = renderer if renderer in {"next", "legacy"} else None
                    outcome = Outcome("unknown", "exam_state_incomplete", renderer)
                    if row and UUID(row["id"]) == canonical_id:
                        if row.get("status") == "in_progress":
                            outcome = Outcome("pending", "exam_not_submitted", renderer)
                        elif row.get("status") == "abandoned":
                            outcome = Outcome("abandoned", "exam_abandoned", renderer)
                        elif row.get("status") == "submitted":
                            check = row.get("core_evidence_result_check")
                            if check == "verified":
                                outcome = Outcome("success", "exam_result_persisted", renderer)
                            elif check == "invalid":
                                outcome = Outcome("unknown", "exam_state_incomplete", renderer)
                            else:
                                outcome = Outcome("unknown", "exam_result_readback_not_verified", renderer)
            return CanonicalRead(status="read", outcome=outcome.state, reason=outcome.reason,
                                 renderer=outcome.renderer, flags=flags)
    except Exception:
        logger.warning("core_attempt_inspection_canonical_unavailable")
        return CanonicalRead(status="unavailable", reason="canonical_read_unavailable")


async def inspect_attempt(surface: Surface, kind: AttemptKind, canonical_id: UUID) -> AttemptInspection:
    started = datetime.now(timezone.utc)
    history = await _history(surface, kind, canonical_id)
    canonical = await _canonical(surface, kind, canonical_id)
    return AttemptInspection(surface=surface, attempt_kind=kind, canonical_attempt_id=canonical_id,
                             read_started_at=started, read_finished_at=datetime.now(timezone.utc),
                             history=history, canonical=canonical,
                             capture_enabled_on_this_instance=settings.CORE_ATTEMPT_EVIDENCE_ENABLED)
