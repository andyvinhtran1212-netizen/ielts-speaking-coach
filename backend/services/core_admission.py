"""Private admission RPC transport; not a public auth boundary or Gate F certificate.

Domain callers must authenticate and validate ownership, enrollment and baseline
provenance before prepare. A prepared command never authorizes old-path fallback.
The opt-in Writing routes use the domain-validated preparation RPC, not generic
prepare. Enabling the flag does not replace existing learner starts.
Provider/content calls do not belong here.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator

from config import settings

TIMEOUT_SECONDS = 3.0
DOMAINS = frozenset({"speaking_session", "speaking_full_test", "reading_exam",
    "listening_test", "listening_dictation", "writing_assignment", "mock_writing"})


class AdmissionDisabled(RuntimeError):
    pass


class AdmissionInvalid(ValueError):
    pass


class AdmissionConflict(RuntimeError):
    pass


class AdmissionUncertain(RuntimeError):
    """Transport/unknown response; retry the SAME identity or read owned status."""


class AdmissionEpochUnavailable(RuntimeError):
    """A rolled back; retry SAME nonce after enrollment availability is known."""


class AdmissionNotFound(RuntimeError):
    pass


class AdmissionExpired(RuntimeError):
    pass


class AdmissionBaselineConflict(RuntimeError):
    pass


class AdmissionStartRequired(RuntimeError):
    pass


class CommandStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID
    episode_id: UUID
    activity_epoch_id: UUID
    phase: Literal["accepted", "bound", "unstarted_expired"]
    generation: int = Field(strict=True, ge=0)
    execute_before: datetime

    @model_validator(mode="after")
    def validate_state(self):
        if self.execute_before.tzinfo is None or self.execute_before.utcoffset() is None:
            raise ValueError("admission deadline requires timezone")
        if (self.phase == "unstarted_expired") != (self.generation > 0):
            raise ValueError("admission phase/generation mismatch")
        return self


class ReconcileStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fenced_commands: int = Field(strict=True, ge=0, le=100)
    coverage: Literal["unknown"]
    gate_f: Literal["not_assessed"]


@dataclass(frozen=True)
class PrepareAdmission:
    # All except launch_nonce are server-derived/verified, never blindly copied
    # from a browser payload. scope_key represents the agreed domain generation.
    principal_id: UUID
    launch_nonce: UUID
    domain: str
    scope_key: UUID
    resource_id: UUID
    action: str
    execute_before: datetime

    def __post_init__(self):
        if any(not isinstance(value, UUID) for value in (
            self.principal_id, self.launch_nonce, self.scope_key, self.resource_id
        )) or self.domain not in DOMAINS or self.action not in {"start", "resume"}:
            raise AdmissionInvalid("invalid admission identity")
        if not isinstance(self.execute_before, datetime) or self.execute_before.tzinfo is None \
                or self.execute_before.utcoffset() is None:
            raise AdmissionInvalid("invalid admission deadline")

    def rpc_params(self):
        # Versioned, bounded canonical metadata only; no answers or capability.
        # Deadline is execution policy, not semantic intent: a delayed exact
        # replay returns its ORIGINAL persisted deadline rather than extending it.
        semantic = json.dumps({"v": 1, "domain": self.domain, "action": self.action,
            "scope": str(self.scope_key), "resource": str(self.resource_id)},
            sort_keys=True, separators=(",", ":"))
        return {"p_principal_id": str(self.principal_id),
            "p_nonce_digest": hashlib.sha256(("admission-v1:" + str(self.launch_nonce)).encode()).hexdigest(),
            "p_semantic_digest": hashlib.sha256(semantic.encode()).hexdigest(),
            "p_domain": self.domain, "p_scope_key": str(self.scope_key),
            "p_resource_id": str(self.resource_id), "p_action": self.action,
            "p_execute_before": self.execute_before.isoformat()}


_RECOVERY_RPCS = frozenset({"fn_get_core_admission", "fn_reconcile_core_admission",
    "fn_read_writing_admission_cohort",
    "fn_get_writing_cohort_report", "fn_finalize_writing_cohort_report",
    "fn_get_writing_admission", "fn_find_writing_admission", "fn_get_writing_entry",
    "fn_execute_writing_admission", "fn_reconcile_writing_admission", "fn_enter_writing_baseline"})


def require_admission_access(name: str, params: dict | None = None):
    """Server-owned allowlist: recovery-only never admits a new command/clock."""
    if settings.CORE_ADMISSION_LEDGER_ENABLED:
        return
    if settings.CORE_ADMISSION_RECOVERY_ENABLED and name in _RECOVERY_RPCS:
        if name != "fn_enter_writing_baseline" or (params or {}).get("p_allow_start") is False:
            return
    raise AdmissionDisabled("admission disabled")


async def _rpc(name: str, params: dict):
    require_admission_access(name, params)
    try:
        async with asyncio.timeout(TIMEOUT_SECONDS):
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                response = await client.post(
                    settings.SUPABASE_URL.rstrip("/") + "/rest/v1/rpc/" + name,
                    headers={"apikey": settings.SUPABASE_SERVICE_KEY,
                        "Authorization": "Bearer " + settings.SUPABASE_SERVICE_KEY},
                    json=params)
                if response.is_error:
                    try:
                        error = response.json()
                    except ValueError:
                        error = None
                    code = error.get("code") if isinstance(error, dict) else None
                    # Only our structured SQL failures assert transaction rejection.
                    # No exception body/details or credential-bearing request is exposed.
                    known = {"ZA001": AdmissionInvalid, "ZA002": AdmissionConflict,
                        "ZA003": AdmissionEpochUnavailable, "ZA005": AdmissionNotFound,
                        "ZA006": AdmissionExpired, "ZA007": AdmissionBaselineConflict,
                        "ZA008": AdmissionStartRequired}
                    if 400 <= response.status_code < 500 and code in known:
                        raise known[code]("admission request rejected")
                    raise AdmissionUncertain("admission outcome unknown")
                return response.json()
    except (AdmissionInvalid, AdmissionConflict, AdmissionEpochUnavailable, AdmissionUncertain,
            AdmissionNotFound, AdmissionExpired, AdmissionBaselineConflict, AdmissionStartRequired):
        raise
    except Exception:
        raise AdmissionUncertain("admission outcome unknown") from None


async def prepare_admission(request: PrepareAdmission) -> CommandStatus:
    raw = await _rpc("fn_prepare_core_admission", request.rpc_params())
    try:
        return CommandStatus.model_validate(raw)
    except (TypeError, ValueError):
        raise AdmissionUncertain("invalid admission acknowledgment") from None


async def get_admission(principal_id: UUID, command_id: UUID) -> CommandStatus | None:
    if not isinstance(principal_id, UUID) or not isinstance(command_id, UUID):
        raise AdmissionInvalid("invalid admission identity")
    raw = await _rpc("fn_get_core_admission", {"p_principal_id": str(principal_id),
        "p_command_id": str(command_id)})
    if raw is None:
        return None  # Missing and cross-owner are indistinguishable.
    try:
        status = CommandStatus.model_validate(raw)
        if status.command_id != command_id:
            raise ValueError("unexpected command")
        return status
    except (TypeError, ValueError):
        raise AdmissionUncertain("invalid admission status") from None


async def reconcile_admissions(limit: int = 100) -> ReconcileStatus:
    if type(limit) is not int or not 1 <= limit <= 100:
        raise AdmissionInvalid("invalid admission batch size")
    raw = await _rpc("fn_reconcile_core_admission", {"p_limit": limit})
    try:
        status = ReconcileStatus.model_validate(raw)
        if status.fenced_commands > limit:
            raise ValueError("unexpected batch count")
        return status
    except (TypeError, ValueError):
        raise AdmissionUncertain("invalid reconciliation acknowledgment") from None


class WritingAssignmentSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    status: Literal["pending", "in_progress", "submitted", "graded", "delivered"]
    is_timed: bool = Field(strict=True)
    time_limit_minutes: int | None = Field(strict=True, ge=1, le=180)
    started_at: datetime | None
    auto_submitted: bool = Field(strict=True)

    @model_validator(mode="after")
    def validate_timer(self):
        if self.is_timed != (self.time_limit_minutes is not None):
            raise ValueError("invalid writing timer policy")
        if self.started_at is not None and (self.started_at.tzinfo is None or self.started_at.utcoffset() is None):
            raise ValueError("writing start requires timezone")
        return self


class WritingAdmissionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command: CommandStatus
    assignment: WritingAssignmentSnapshot

    @model_validator(mode="after")
    def validate_binding(self):
        if self.command.phase == "bound" and self.assignment.started_at is None:
            raise ValueError("bound writing admission requires persisted start")
        return self


def _writing_identity(user_id, student_id, assignment_id, command_id):
    values = {"p_user_id": user_id, "p_student_id": student_id,
        "p_assignment_id": assignment_id, "p_command_id": command_id}
    if any(not isinstance(value, UUID) for value in values.values()):
        raise AdmissionInvalid("invalid writing admission identity")
    return {key: str(value) for key, value in values.items()}


def _writing_result(raw, assignment_id, command_id, *, executed=False):
    try:
        result = WritingAdmissionResult.model_validate(raw)
        if result.assignment.id != assignment_id or result.command.command_id != command_id \
                or (executed and result.command.phase != "bound"):
            raise ValueError("unexpected writing admission result")
        return result
    except (TypeError, ValueError):
        raise AdmissionUncertain("invalid writing admission acknowledgment") from None


async def execute_writing_admission(user_id: UUID, student_id: UUID, assignment_id: UUID,
                                    command_id: UUID, generation: int) -> WritingAdmissionResult:
    params = _writing_identity(user_id, student_id, assignment_id, command_id)
    if type(generation) is not int or generation < 0:
        raise AdmissionInvalid("invalid writing execution generation")
    raw = await _rpc("fn_execute_writing_admission", {**params, "p_generation": generation})
    return _writing_result(raw, assignment_id, command_id, executed=True)


async def prepare_writing_admission(user_id: UUID, student_id: UUID, assignment_id: UUID,
                                    launch_nonce: UUID) -> WritingAdmissionResult:
    if any(not isinstance(value, UUID) for value in (user_id, student_id, assignment_id, launch_nonce)):
        raise AdmissionInvalid("invalid writing admission identity")
    # The DB derives resource semantics and execution deadline itself, validates
    # prospective provenance under the source lock, then performs A atomically.
    raw = await _rpc("fn_prepare_writing_admission", {
        "p_user_id": str(user_id), "p_student_id": str(student_id),
        "p_assignment_id": str(assignment_id),
        "p_nonce_digest": hashlib.sha256(("admission-v1:" + str(launch_nonce)).encode()).hexdigest()})
    try:
        result = WritingAdmissionResult.model_validate(raw)
        if result.assignment.id != assignment_id:
            raise ValueError("unexpected assignment")
        return result  # Exact replay may already be bound or fenced.
    except (TypeError, ValueError):
        raise AdmissionUncertain("invalid writing admission acknowledgment") from None


async def get_writing_admission(user_id: UUID, student_id: UUID, assignment_id: UUID,
                                command_id: UUID) -> WritingAdmissionResult | None:
    raw = await _rpc("fn_get_writing_admission",
        _writing_identity(user_id, student_id, assignment_id, command_id))
    if raw is None:
        return None
    return _writing_result(raw, assignment_id, command_id)


async def reconcile_writing_admission(user_id: UUID, student_id: UUID, assignment_id: UUID,
                                      command_id: UUID) -> WritingAdmissionResult:
    """Fence only this owned expired command using DB time; never start work."""
    raw = await _rpc("fn_reconcile_writing_admission",
        _writing_identity(user_id, student_id, assignment_id, command_id))
    return _writing_result(raw, assignment_id, command_id)


async def find_writing_admission(user_id: UUID, student_id: UUID, assignment_id: UUID,
                                  launch_nonce: UUID) -> WritingAdmissionResult | None:
    """Read-only nonce recovery; absence is not permission to bypass validation."""
    params = _writing_entry_identity(user_id, student_id, assignment_id)
    if not isinstance(launch_nonce, UUID):
        raise AdmissionInvalid("invalid writing admission nonce")
    raw = await _rpc("fn_find_writing_admission", {**params,
        "p_nonce_digest": hashlib.sha256(("admission-v1:" + str(launch_nonce)).encode()).hexdigest()})
    if raw is None:
        return None
    try:
        result = WritingAdmissionResult.model_validate(raw)
        if result.assignment.id != assignment_id:
            raise ValueError("unexpected writing assignment")
        return result
    except (TypeError, ValueError):
        raise AdmissionUncertain("invalid writing nonce lookup acknowledgment") from None


class WritingEntryResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["eligible", "admitted", "baseline_untracked", "baseline_unclaimed", "terminal", "blocked"]
    assignment: WritingAssignmentSnapshot

    @model_validator(mode="after")
    def validate_classification(self):
        terminal = self.assignment.status in {"submitted", "graded", "delivered"}
        if (self.kind == "terminal") != terminal:
            raise ValueError("writing entry terminal mismatch")
        if self.kind == "eligible" and (self.assignment.status != "pending" or self.assignment.started_at is not None):
            raise ValueError("writing entry eligibility mismatch")
        if self.kind == "admitted" and self.assignment.started_at is None:
            raise ValueError("writing admitted entry missing start")
        return self


def _writing_entry_identity(user_id, student_id, assignment_id):
    if any(not isinstance(value, UUID) for value in (user_id, student_id, assignment_id)):
        raise AdmissionInvalid("invalid writing entry identity")
    return {"p_user_id": str(user_id), "p_student_id": str(student_id), "p_assignment_id": str(assignment_id)}


def _writing_entry_result(raw, assignment_id, *, entered=False):
    try:
        result = WritingEntryResult.model_validate(raw)
        if result.assignment.id != assignment_id:
            raise ValueError("writing entry assignment mismatch")
        if entered and (result.kind not in {"baseline_untracked", "baseline_unclaimed", "terminal"}
                        or (result.kind != "terminal" and result.assignment.started_at is None)):
            raise ValueError("writing baseline entry unconfirmed")
        return result
    except (TypeError, ValueError):
        raise AdmissionUncertain("invalid writing entry acknowledgment") from None


async def get_writing_entry(user_id: UUID, student_id: UUID, assignment_id: UUID) -> WritingEntryResult | None:
    raw = await _rpc("fn_get_writing_entry", _writing_entry_identity(user_id, student_id, assignment_id))
    if raw is None:
        return None
    return _writing_entry_result(raw, assignment_id)


async def enter_writing_baseline(user_id: UUID, student_id: UUID, assignment_id: UUID,
                                 launch_nonce: UUID, allow_start: bool) -> WritingEntryResult:
    params = _writing_entry_identity(user_id, student_id, assignment_id)
    if not isinstance(launch_nonce, UUID) or type(allow_start) is not bool:
        raise AdmissionInvalid("invalid writing baseline intent")
    raw = await _rpc("fn_enter_writing_baseline", {**params,
        # Share A's nonce lock/digest namespace to reject an ambiguous old A.
        "p_nonce_digest": hashlib.sha256(("admission-v1:" + str(launch_nonce)).encode()).hexdigest(),
        "p_allow_start": allow_start})
    return _writing_entry_result(raw, assignment_id, entered=True)
