"""Opt-in request observations, after existing route auth/ownership checks.

This is not durable coverage accounting. An unobserved process crash or a lost
receipt remains a gap. Optional client hints group matching observed inputs,
not certified logical intents; only canonical attempt IDs deduplicate attempts.
Only stripped result metadata is retained for the optional proof until request
completion. No answer text, auth tokens, request bodies or learner IDs enter it.
"""

from __future__ import annotations

import asyncio
import inspect
import hashlib
import json
import logging
import math
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime
from functools import wraps
from uuid import UUID, uuid4

from config import settings
from services.core_attempt_evidence import ERROR_CODES, try_record_event
from services.core_attempt_outcomes import observe_persisted_outcome
from services.core_exam_result_proofs import record_exam_result_proof
from services.core_operation_correlation import (
    FORBIDDEN_INPUT_NAMES, current_operation_hint, input_fingerprint, owner_fingerprint,
    record_operation_correlation, scoped_fingerprint,
)

logger = logging.getLogger(__name__)


@dataclass
class _Observation:
    surface: str
    operation: str
    attempt_kind: str = "default"
    operation_id: UUID = field(default_factory=uuid4)
    attempt_id: UUID | None = None
    renderer: str | None = None
    admitted: bool = False
    started: bool = False
    outcome: str | None = None
    reported_error: str | None = None
    invalid: bool = False
    exam_proof_metadata: dict | None = None
    exam_expected_qnums: list[int] | None = None
    client_operation_id: UUID | None = None
    input_digest: str | None = None
    actor_digest: str | None = None
    correlation_invalid: bool = False
    correlate_audio: bool = False
    abandoned_exams: dict[UUID, str | None] = field(default_factory=dict)
    abandoned_exams_incomplete: bool = False


_current: ContextVar[_Observation | None] = ContextVar("core_attempt_observation", default=None)


def note_abandoned_exam_attempts(result, *, test_id: str, user_id: str | None = None, anon_id: str | None = None) -> None:
    """Keep only metadata from the existing owned UPDATE's acknowledged rows.

    No pre-read, inferred expiry, extra learner write, or late canonical re-read.
    Missing/malformed RETURNING data is an evidence gap, never a business error.
    Raw owner/capability, answers and test identifiers do not enter the context.
    """
    current = _current.get()
    if (current is None or not current.admitted or current.operation != "start"
            or current.surface not in {"reading_exam", "listening_test"}):
        return
    try:
        if (user_id is None) == (anon_id is None) or (anon_id is not None and current.surface != "reading_exam"):
            raise ValueError("invalid owner scope")
        expected_test = UUID(test_id)
        expected_user = UUID(user_id) if user_id is not None else None
        if anon_id is not None and (not isinstance(anon_id, str) or not anon_id):
            raise ValueError("invalid capability")
        rows = result.data
        if not isinstance(rows, list) or len(rows) > 100:
            raise ValueError("unavailable return set")
        pending = dict(current.abandoned_exams)
        for row in rows:
            if not isinstance(row, dict) or row.get("status") != "abandoned" or UUID(row["test_id"]) != expected_test:
                raise ValueError("unverified abandoned row")
            if expected_user is not None:
                if UUID(row["user_id"]) != expected_user:
                    raise ValueError("owner mismatch")
            elif row.get("user_id") is not None or row.get("anon_id") != anon_id:
                raise ValueError("capability mismatch")
            attempt_id = UUID(row["id"])
            renderer = row.get("renderer_affinity")
            if renderer not in {None, "legacy", "next"}:
                raise ValueError("invalid renderer")
            if attempt_id in pending and pending[attempt_id] != renderer:
                raise ValueError("conflicting return set")
            pending[attempt_id] = renderer
        if len(pending) > 100:
            raise ValueError("return set exceeds observation bound")
        current.abandoned_exams = pending
    except Exception:
        # A later retry with unavailable RETURNING data cannot erase an earlier
        # confirmed update. Ignore this whole batch, preserving known receipts.
        current.abandoned_exams_incomplete = True


async def _emit_abandoned_exams(current: _Observation) -> None:
    remaining = iter(current.abandoned_exams.items())

    async def worker():
        for attempt_id, renderer in remaining:
            try:
                await try_record_event(
                    event_id=uuid4(), operation_id=current.operation_id,
                    surface=current.surface, attempt_kind="default", canonical_attempt_id=attempt_id,
                    operation="start", event_kind="outcome_observed", outcome="abandoned", renderer=renderer,
                )
            except Exception:
                logger.warning("core_exam_abandonment_receipt_unavailable")

    async with asyncio.TaskGroup() as group:
        for _ in range(min(4, len(current.abandoned_exams))):
            group.create_task(worker())


def note_abandoned_dictation_attempt(result, *, attempt_id: str, test_id: str, user_id: str, section_num: int) -> None:
    """Observe only the acknowledged retirement of one owned section parent.

    A pre-read, expired clock or new-attempt failure is not proof of this write.
    Reuse the bounded, isolated old-attempt emitter without rebinding the new
    attempt. Retain no section content, answer, owner or test metadata.
    """
    current = _current.get()
    if (current is None or not current.admitted or current.operation != "start"
            or current.surface != "listening_dictation"):
        return
    try:
        expected_id, expected_test, expected_user = UUID(attempt_id), UUID(test_id), UUID(user_id)
        if type(section_num) is not int or section_num < 1:
            raise ValueError("invalid section scope")
        rows = result.data
        if not isinstance(rows, list) or len(rows) > 1:
            raise ValueError("unavailable return set")
        if not rows:
            return  # Conditional UPDATE lost a race; do not use the pre-read.
        row = rows[0]
        if (not isinstance(row, dict) or row.get("status") != "abandoned"
                or UUID(row["id"]) != expected_id or UUID(row["test_id"]) != expected_test
                or UUID(row["user_id"]) != expected_user
                or type(row.get("section_num")) is not int or row["section_num"] != section_num):
            raise ValueError("unverified abandoned parent")
        renderer = row.get("renderer_affinity")
        if renderer not in {None, "legacy", "next"}:
            raise ValueError("invalid renderer")
        if current.abandoned_exams and current.abandoned_exams != {expected_id: renderer}:
            raise ValueError("conflicting parent return")
        current.abandoned_exams[expected_id] = renderer
    except Exception:
        current.abandoned_exams_incomplete = True


def admit_start(*, attempt_kind: str = "default") -> None:
    """Call only AFTER auth, entitlement and resource eligibility checks."""
    current = _current.get()
    if current is not None and current.operation == "start":
        current.admitted = True
        current.attempt_kind = attempt_kind


def bind_owned_attempt(row: dict, *, started: bool = False) -> None:
    """Accept only an authorized source row (owner/admin) or committed new row."""
    current = _current.get()
    if current is None:
        return
    try:
        canonical = row.get("id")
        attempt_kind = "default"
        if current.surface == "speaking":
            if row.get("mode") not in {"practice", "test_part", "test_full"}:
                raise ValueError("speaking mode is required for canonical identity")
            if row.get("mode") == "test_full":
                attempt_kind = "speaking_full_test"
                if type(row.get("part")) is not int or row["part"] not in {1, 2, 3}:
                    raise ValueError("full-test part is required")
                canonical = row.get("full_test_attempt_id")
                started = started and row["part"] == 1
            else:
                attempt_kind = "speaking_session"
        attempt_id = UUID(str(canonical))
        if current.attempt_id is not None and (current.attempt_id != attempt_id or current.attempt_kind != attempt_kind):
            raise ValueError("binding cannot change within an operation")
        renderer = row.get("renderer_affinity")
        if renderer not in {None, "legacy", "next"}:
            raise ValueError("invalid renderer")
        if started and (current.operation != "start" or row.get("status") != "in_progress"):
            raise ValueError("start must be a committed active attempt")
        current.attempt_id = attempt_id
        current.attempt_kind = attempt_kind
        current.renderer = renderer
        current.started = started
        current.admitted = True
        actor = owner_fingerprint(row) if current.client_operation_id is not None else None
        if actor is not None:
            if current.actor_digest is not None and current.actor_digest != actor:
                current.correlation_invalid = True
            current.actor_digest = actor
    except (TypeError, ValueError, AttributeError):
        current.invalid = True


def note_operation_failure(error_code: str = "server_error") -> None:
    """Explicit domain failure returned as HTTP 2xx, never an attempt verdict.

    Callers pass a static allowlisted code, not provider messages or payloads.
    A canonical read can still describe the current attempt independently.
    """
    current = _current.get()
    if current is None:
        return
    if error_code not in ERROR_CODES:
        current.invalid = True
        return
    current.reported_error = error_code


async def note_owned_speaking_audio(*, session_id: str, question_id: str, audio_bytes: bytes, extension: str, content_type: str | None = None) -> None:
    """Hash the existing authorized read, never consume an UploadFile again.

    The upload-size guard precedes this call. No audio, filename, question text
    or raw actor enters observer state. Hashing runs off-loop with a bounded
    wait; timeout/cancellation cannot later mutate this request's observation.
    """
    current = _current.get()
    if (current is None or not current.correlate_audio or current.client_operation_id is None
            or not current.admitted or current.invalid or current.attempt_id is None
            or current.actor_digest is None):
        return
    current.input_digest = None
    try:
        if type(audio_bytes) is not bytes or not 0 < len(audio_bytes) <= 50 * 1024 * 1024:
            return
        if extension not in {".webm", ".mp3", ".mp4", ".m4a", ".wav", ".ogg", ".flac"}:
            return
        if content_type is not None and (not isinstance(content_type, str) or len(content_type) > 256):
            return
        sid, qid = str(UUID(session_id)), str(UUID(question_id))
        async with asyncio.timeout(0.5):
            audio_hash = await asyncio.to_thread(lambda: hashlib.sha256(audio_bytes).hexdigest())
        metadata = {"contract": "core-speaking-audio-v1", "session_id": sid, "question_id": qid,
                    "audio_sha256": audio_hash, "extension": extension, "content_type": content_type}
        current.input_digest = hashlib.sha256(json.dumps(metadata, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    except Exception:
        logger.warning("core_speaking_audio_correlation_unavailable")


def note_persisted_exam_result(row: dict, *, expected_questions: list[dict]) -> None:
    """Reading/Listening result from UPDATE ... RETURNING, not local grading.

    Success here means a persisted result, NOT an IELTS pass or Gate F pass.
    Missing/malformed fields remain unknown and require canonical inspection.
    """
    current = _current.get()
    if current is None or current.surface not in {"reading_exam", "listening_test"}:
        return
    current.outcome = "unknown"
    current.exam_proof_metadata = None
    current.exam_expected_qnums = None
    try:
        if UUID(str(row.get("id"))) != current.attempt_id or row.get("status") != "submitted":
            return
        score, band = row.get("score"), row.get("band_estimate")
        details = row.get("grading_details")
        submitted = datetime.fromisoformat(row["submitted_at"].replace("Z", "+00:00"))
        if submitted.utcoffset() is None or not isinstance(details, list) or not details:
            return
        expected = [question.get("q_num") for question in expected_questions]
        actual = [question.get("q_num") for question in details]
        if (not expected or any(type(number) is not int or number < 1 for number in expected + actual)
                or len(set(expected)) != len(expected) or len(actual) != len(expected)
                or set(actual) != set(expected) or any(type(question.get("correct")) is not bool for question in details)):
            return
        if not isinstance(score, (int, float)) or isinstance(score, bool) or not math.isfinite(score):
            return
        # Listening legitimately has no band estimate below its mapped score
        # floor. Low achievement is not an operational failure/missing result.
        if band is not None and (not isinstance(band, (int, float)) or isinstance(band, bool)
                                 or not math.isfinite(band) or not 0 <= band <= 9):
            return
        if 0 <= score <= len(details) and score == sum(question["correct"] for question in details):
            current.outcome = "success"
            current.exam_proof_metadata = {
                "status": "submitted", "submitted_at": row["submitted_at"],
                "score": score, "band_estimate": band,
                "grading_details": [{"q_num": q["q_num"], "correct": q["correct"]} for q in details],
            }
            current.exam_expected_qnums = list(expected)
    except (KeyError, TypeError, ValueError, AttributeError):
        return


def _error_code(error: Exception) -> str:
    if isinstance(error, TimeoutError):
        return "timeout"
    status = getattr(error, "status_code", None)
    if status == 409:
        return "conflict"
    if isinstance(status, int) and 400 <= status < 500:
        return "rejected"
    return "server_error"


async def _emit(current: _Observation, error: Exception | None) -> None:
    if current.invalid:
        logger.error("core_attempt_observation_invalid surface=%s operation=%s", current.surface, current.operation)
        return
    if not current.admitted:
        return  # authentication/ownership failures never fabricate attempt evidence
    if current.attempt_id is None and not (current.operation == "start" and error is not None):
        logger.error("core_attempt_observation_missing_binding surface=%s", current.surface)
        return
    fields = dict(
        operation_id=current.operation_id, surface=current.surface,
        canonical_attempt_id=current.attempt_id, operation=current.operation,
        attempt_kind=current.attempt_kind, renderer=current.renderer,
    )
    error_code = _error_code(error) if error is not None else current.reported_error
    if error_code is not None and current.started:
        # The canonical start committed before later response/serialization
        # work failed. Persist that known start BEFORE the failed operation can
        # create a permanently start-unobserved registry row.
        await try_record_event(event_id=uuid4(), **fields, event_kind="started", start_observed=True)
    kind = "operation_failed" if error_code else "started" if current.started else "operation_succeeded"
    receipts = [try_record_event(
        event_id=uuid4(), **fields,
        event_kind=kind, start_observed=current.started and error_code is None,
        outcome=None, error_code=error_code,
    )]
    if error_code is None and current.outcome is not None:
        receipts.append(try_record_event(
            event_id=uuid4(), **fields, event_kind="outcome_observed", outcome=current.outcome,
        ))
        if current.exam_proof_metadata is not None and current.exam_expected_qnums is not None:
            receipts.append(record_exam_result_proof(current.surface, current.attempt_id,
                                                     current.exam_proof_metadata, current.exam_expected_qnums))
    if (error is None and current.attempt_id is not None
            and current.operation in {"submit", "finalize", "grade"}
            and current.surface in {"speaking", "listening_dictation", "writing_assignment"}):
        receipts.append(observe_persisted_outcome(
            current.surface, current.attempt_id, current.attempt_kind,
            operation_id=current.operation_id, operation=current.operation,
        ))
    digest = scoped_fingerprint(current.input_digest, current.actor_digest)
    if (not current.correlation_invalid and current.client_operation_id is not None
            and current.attempt_id is not None and digest is not None):
        receipts.append(record_operation_correlation(
            operation_id=current.operation_id, surface=current.surface,
            attempt_kind=current.attempt_kind, canonical_attempt_id=current.attempt_id,
            operation=current.operation, client_operation_id=current.client_operation_id,
            input_digest=digest,
        ))
    # Independent operation/outcome receipts may arrive in either order. Run
    # both within one request budget; do not spend it all before reading state.
    async with asyncio.TaskGroup() as group:
        for receipt in receipts:
            group.create_task(receipt)


def observe_operation(surface: str, operation: str, *, correlate_by: tuple[str, ...] | None = None, correlate_audio: bool = False):
    """Preserve endpoint signature/response and propagate its original exception."""
    def decorate(endpoint):
        if correlate_audio and (surface != "speaking" or operation != "grade" or correlate_by is not None):
            raise ValueError("audio correlation requires an owned Speaking grade boundary")
        signature = inspect.signature(endpoint, eval_str=True, follow_wrapped=False)
        if correlate_by is not None and (set(correlate_by) - set(signature.parameters) or set(correlate_by) & FORBIDDEN_INPUT_NAMES):
            raise ValueError("unsafe correlation input declaration")
        @wraps(endpoint)
        async def observed(*args, **kwargs):
            if not settings.CORE_ATTEMPT_EVIDENCE_ENABLED:
                return await endpoint(*args, **kwargs)
            current = _Observation(surface, operation)
            current.correlate_audio = correlate_audio
            if correlate_by is not None or correlate_audio:
                current.client_operation_id = current_operation_hint()
                if current.client_operation_id is not None and correlate_by is not None:
                    current.input_digest = input_fingerprint(
                        endpoint.__module__ + "." + endpoint.__name__, signature, correlate_by, args, kwargs,
                    )
            token = _current.set(current)
            try:
                try:
                    result = await endpoint(*args, **kwargs)
                except Exception as error:
                    await _emit_safely(current, error)
                    raise
                await _emit_safely(current, None)
                return result
            finally:
                _current.reset(token)
        # FastAPI otherwise resolves string annotations in this module rather
        # than the original router, losing UUID/Pydantic/body/Depends types.
        observed.__signature__ = signature
        observed.__core_correlation_fields__ = correlate_by
        observed.__core_audio_correlation__ = correlate_audio
        return observed
    return decorate


async def _emit_safely(current: _Observation, error: Exception | None) -> None:
    budget = asyncio.timeout(0.5)

    async def emit_independently(component, emitter, *args):
        try:
            await emitter(*args)
        except Exception:
            # Do not cancel the sibling's pending receipt on a recorder error.
            # CancelledError still propagates, so timeout/request cancellation
            # drains both branches through TaskGroup without orphaned tasks.
            logger.error("core_attempt_observation_unavailable surface=%s operation=%s component=%s", current.surface, current.operation, component)

    try:
        if current.abandoned_exams_incomplete:
            # One coarse diagnostic per request. No raw row, owner, capability
            # or exception; this warning is not durable coverage accounting.
            logger.warning("core_exam_abandonment_unverified surface=%s operation_id=%s", current.surface, current.operation_id)
        # One combined budget, including canonical reads and all receipts.
        # Exhaustion is a coverage gap, never a learner-operation failure.
        async with budget:
            if current.abandoned_exams:
                # A later insert/binding failure must not erase a confirmed
                # prior abandonment. Both receipts share the existing budget.
                async with asyncio.TaskGroup() as group:
                    group.create_task(emit_independently("operation", _emit, current, error))
                    group.create_task(emit_independently("abandonment", _emit_abandoned_exams, current))
            else:
                await _emit(current, error)
    except TimeoutError:
        component = "deadline" if budget.expired() else "boundary"
        logger.error("core_attempt_observation_unavailable surface=%s operation=%s component=%s", current.surface, current.operation, component)
    except Exception:
        logger.error("core_attempt_observation_unavailable surface=%s operation=%s component=boundary", current.surface, current.operation)
