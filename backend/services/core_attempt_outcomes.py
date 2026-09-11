"""Canonical outcome observations, not a coverage or organic-volume certificate.

Embedded metadata is read in a single PostgREST statement per attempt, avoiding
an application-side join of different snapshots. Never select learner content.
Later regrades append another observation; no outcome is permanently frozen.
"""

from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID, uuid4

from config import settings
from database import get_supabase_async
from services.core_attempt_evidence import ReceiptStatus, try_record_event

logger = logging.getLogger(__name__)
OUTCOME_BUDGET_SECONDS = 0.5
WRITING_BATCH_BUDGET_SECONDS = 2.0

SPEAKING_COLUMNS = (
    "id,user_id,mode,part,full_test_attempt_id,status,overall_band,completed_at,renderer_affinity,sitting_id,"
    "questions(id),responses(question_id,grading_status,overall_band)"
)
DICTATION_COLUMNS = (
    "id,user_id,status,completed_at,renderer_affinity,core_evidence_unit_count,"
    "reports:dictation_sessions(id,user_id,attempt_id,total_sentences,completed_at),"
    "answers:dictation_attempt_answers(sentence_idx,score)"
)
WRITING_COLUMNS = (
    "id,student_id,status,essay_id,renderer_affinity,"
    "essay:writing_essays(id,student_id,status,is_flagged,current_version,deleted_at,"
    "feedback:writing_feedback_current(version,overall_band_score),"
    "jobs:writing_jobs(job_type,status,created_at,completed_at))"
)


@dataclass(frozen=True)
class Outcome:
    state: str
    reason: str
    renderer: str | None = None


def _time(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.utcoffset() is not None else None
    except (TypeError, ValueError, AttributeError):
        return None


def _score(value, upper=9):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= upper


def _one(value):
    if isinstance(value, dict):
        return value
    return value[0] if isinstance(value, list) and len(value) == 1 and isinstance(value[0], dict) else None


def _renderer(rows):
    if not isinstance(rows, list) or not rows or any(not isinstance(row, dict) for row in rows):
        return None
    values = [row.get("renderer_affinity") for row in rows]
    return values[0] if values[0] in ("next", "legacy") and all(value == values[0] for value in values) else None


def speaking_outcome(rows: list[dict], canonical_id: UUID, kind: str) -> Outcome:
    renderer = _renderer(rows)
    unknown = Outcome("unknown", "speaking_state_incomplete", renderer)
    if not rows or kind not in {"speaking_session", "speaking_full_test"}:
        return unknown
    try:
        full = kind == "speaking_full_test"
        if len(rows) != (3 if full else 1) or len({UUID(row["id"]) for row in rows}) != len(rows):
            return unknown
        owners = {UUID(row["user_id"]) for row in rows}
        if len(owners) != 1 or (full and (any(type(row.get("part")) is not int for row in rows)
                                        or {row.get("part") for row in rows} != {1, 2, 3})):
            return unknown
        if full:
            if any(row.get("mode") != "test_full" or UUID(row["full_test_attempt_id"]) != canonical_id for row in rows):
                return unknown
            if len({row.get("sitting_id") for row in rows}) != 1:
                return unknown
        elif rows[0].get("mode") not in {"practice", "test_part"} or UUID(rows[0]["id"]) != canonical_id:
            return unknown
        states = {row.get("status") for row in rows}
        if not states <= {"in_progress", "submitted", "completed", "analysis_failed", "grading_failed", "abandoned"}:
            return unknown
        if "analysis_failed" in states:
            return Outcome("failed", "speaking_analysis_failed", renderer)
        if "grading_failed" in states:
            return Outcome("failed", "speaking_grading_failed", renderer)
        if states == {"abandoned"}:
            return Outcome("abandoned", "speaking_abandoned", renderer)
        if "abandoned" in states:
            return unknown
        if states & {"in_progress", "submitted"}:
            return Outcome("pending", "speaking_not_finalized", renderer)
        for row in rows:
            if not _score(row.get("overall_band")) or not _time(row.get("completed_at")):
                return unknown
            questions, responses = row.get("questions"), row.get("responses")
            if not isinstance(questions, list) or not questions or not isinstance(responses, list) or not responses:
                return unknown
            question_ids = {UUID(q["id"]) for q in questions}
            response_ids = {UUID(r["question_id"]) for r in responses}
            if len(question_ids) != len(questions) or len(response_ids) != len(responses) or not response_ids <= question_ids:
                return unknown
            if full and (len(questions) != {1: 9, 2: 1, 3: 5}[row["part"]] or response_ids != question_ids):
                return unknown
            if any(r.get("grading_status") != "completed" or not _score(r.get("overall_band")) for r in responses):
                return unknown
        return Outcome("success", "speaking_result_persisted", renderer)
    except (KeyError, TypeError, ValueError, AttributeError):
        return unknown


def dictation_outcome(row: dict | None, canonical_id: UUID) -> Outcome:
    renderer = _renderer([row]) if row else None
    unknown = Outcome("unknown", "dictation_state_incomplete", renderer)
    try:
        if not row or UUID(row["id"]) != canonical_id:
            return unknown
        if row.get("status") == "in_progress":
            return Outcome("pending", "dictation_not_finalized", renderer)
        if row.get("status") == "abandoned":
            return Outcome("abandoned", "dictation_abandoned", renderer)
        if row.get("status") != "completed" or not _time(row.get("completed_at")):
            return unknown
        report = _one(row.get("reports"))
        answers = row.get("answers")
        if not report or UUID(report["attempt_id"]) != canonical_id or report.get("user_id") != row.get("user_id"):
            return unknown
        UUID(row["user_id"])
        total = report.get("total_sentences")
        if type(total) is not int or total < 1 or not _time(report.get("completed_at")) or not isinstance(answers, list):
            return unknown
        expected = row.get("core_evidence_unit_count")
        if type(expected) is not int or expected != total:
            return unknown
        if len(answers) != total or {a.get("sentence_idx") for a in answers} != set(range(total)):
            return unknown
        if any(type(a.get("sentence_idx")) is not int or not _score(a.get("score"), 1) for a in answers):
            return unknown
        return Outcome("success", "dictation_result_persisted", renderer)
    except (KeyError, TypeError, ValueError, AttributeError):
        return unknown


def writing_outcome(row: dict | None, canonical_id: UUID) -> Outcome:
    renderer = _renderer([row]) if row else None
    unknown = Outcome("unknown", "writing_state_incomplete", renderer)
    try:
        if not row or UUID(row["id"]) != canonical_id:
            return unknown
        essay = _one(row.get("essay"))
        if not row.get("essay_id") and row.get("status") in {"pending", "in_progress"}:
            return Outcome("pending", "writing_not_submitted", renderer)
        if row.get("status") not in {"submitted", "graded", "delivered"}:
            return unknown
        if not essay or UUID(row["essay_id"]) != UUID(essay["id"]) or essay.get("student_id") != row.get("student_id"):
            return unknown
        UUID(row["student_id"])
        if essay.get("deleted_at") or essay.get("is_flagged") is not False:
            return unknown
        if essay.get("status") in {"graded", "reviewed", "delivered"}:
            feedback = _one(essay.get("feedback"))
            version = essay.get("current_version")
            if (type(version) is int and version > 0 and feedback
                    and type(feedback.get("version")) is int and feedback["version"] == version
                    and _score(feedback.get("overall_band_score"))):
                # Failed regrades may restore the prior good status/version.
                # A failed job must NOT erase the learner's valid prior result.
                return Outcome("success", "writing_current_feedback_persisted", renderer)
            return unknown
        if essay.get("status") in {"pending", "grading"}:
            return Outcome("pending", "writing_grading_pending", renderer)
        jobs = [job for job in (essay.get("jobs") or []) if job.get("job_type") == "analyze"]
        if essay.get("status") == "failed" and jobs:
            if any(job.get("status") in {"queued", "running"} for job in jobs):
                return Outcome("pending", "writing_retry_pending", renderer)
            if any(not _time(job.get("created_at")) for job in jobs):
                return unknown
            latest = max(jobs, key=lambda job: _time(job["created_at"]))
            # Timestamp ties cannot establish which job is authoritative.
            if sum(_time(job["created_at"]) == _time(latest["created_at"]) for job in jobs) != 1:
                return unknown
            completed = _time(latest.get("completed_at"))
            if latest.get("status") == "failed" and completed and completed >= _time(latest["created_at"]):
                return Outcome("failed", "writing_grading_failed", renderer)
        return unknown
    except (KeyError, TypeError, ValueError, AttributeError):
        return unknown


async def observe_persisted_outcome(surface: str, canonical_id: UUID, kind: str = "default", *, operation_id: UUID | None = None, operation: str = "finalize") -> ReceiptStatus:
    """Bounded read+receipt after canonical commit, never in a learner transaction."""
    if not settings.CORE_ATTEMPT_EVIDENCE_ENABLED:
        return ReceiptStatus.DISABLED
    if operation not in {"grade", "submit", "finalize"}:
        return ReceiptStatus.INVALID
    try:
        canonical_id = UUID(str(canonical_id))
        async with asyncio.timeout(OUTCOME_BUDGET_SECONDS):
            db = await get_supabase_async()
            if surface == "speaking" and kind in {"speaking_session", "speaking_full_test"}:
                column = "id" if kind == "speaking_session" else "full_test_attempt_id"
                result = await db.table("sessions").select(SPEAKING_COLUMNS).eq(column, str(canonical_id)).limit(4).execute()
                outcome = speaking_outcome(result.data or [], canonical_id, kind)
            elif surface == "listening_dictation" and kind == "default":
                result = await db.table("dictation_attempts").select(DICTATION_COLUMNS).eq("id", str(canonical_id)).limit(2).execute()
                outcome = dictation_outcome(_one(result.data), canonical_id)
            elif surface == "writing_assignment" and kind == "default":
                result = await db.table("writing_assignments").select(WRITING_COLUMNS).eq("id", str(canonical_id)).limit(2).execute()
                outcome = writing_outcome(_one(result.data), canonical_id)
            else:
                return ReceiptStatus.INVALID
            return await try_record_event(
                event_id=uuid4(), operation_id=operation_id or uuid4(), surface=surface,
                canonical_attempt_id=canonical_id, attempt_kind=kind, operation=operation,
                event_kind="outcome_observed", outcome=outcome.state, renderer=outcome.renderer,
            )
    except Exception:
        logger.warning("core_attempt_outcome_unavailable surface=%s", surface)
        return ReceiptStatus.UNAVAILABLE


async def observe_speaking_background(session_ids: list[str]) -> None:
    if not settings.CORE_ATTEMPT_EVIDENCE_ENABLED:
        return
    try:
        async with asyncio.timeout(OUTCOME_BUDGET_SECONDS):
            ids = [str(UUID(value)) for value in session_ids]
            if len(ids) != 3 or len(set(ids)) != 3:
                raise ValueError("full test requires three distinct sessions")
            db = await get_supabase_async()
            result = await db.table("sessions").select("id,full_test_attempt_id").in_("id", ids).limit(4).execute()
            rows = result.data or []
            attempts = {UUID(row["full_test_attempt_id"]) for row in rows}
            if len(rows) != 3 or {row["id"] for row in rows} != set(ids) or len(attempts) != 1:
                raise ValueError("full test identity unavailable")
            await observe_persisted_outcome("speaking", attempts.pop(), "speaking_full_test")
    except Exception:
        logger.warning("core_speaking_background_outcome_unavailable")


async def observe_writing_background(essay_id: str) -> None:
    if not settings.CORE_ATTEMPT_EVIDENCE_ENABLED:
        return
    try:
        async with asyncio.timeout(OUTCOME_BUDGET_SECONDS):
            db = await get_supabase_async()
            result = await db.table("writing_assignments").select("id").eq("essay_id", str(UUID(essay_id))).limit(101).execute()
            rows = result.data or []
            if len(rows) > 100:
                raise ValueError("assignment fanout exceeds evidence bound")
        ids = [UUID(row["id"]) for row in rows]
        limiter = asyncio.Semaphore(4)
        async def observe_one(attempt_id):
            async with limiter:
                await observe_persisted_outcome("writing_assignment", attempt_id)
        # Per-essay fanout: each read+receipt keeps its 500ms budget;
        # bounded parallelism avoids silently dropping all but the first row.
        async with asyncio.timeout(OUTCOME_BUDGET_SECONDS * (1 + math.ceil(len(ids) / 4))):
            tasks = [asyncio.create_task(observe_one(attempt_id)) for attempt_id in ids]
            try:
                await asyncio.gather(*tasks)
            finally:
                # A child cancellation makes gather raise without cancelling
                # its siblings. Drain this level too, not just essay workers.
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
    except Exception:
        logger.warning("core_writing_background_outcome_unavailable")


async def observe_writing_batch(essay_ids: list[str]) -> None:
    """Post-sweep snapshots, not a record of reaper success or continuous coverage.

    Four workers, one total budget, no task per candidate. Finish recovery writes
    BEFORE calling this. Deadline/invalid IDs are evidence gaps, not job failures.
    A snapshot may see a newer worker's result; it makes no causal claim.
    """
    if not settings.CORE_ATTEMPT_EVIDENCE_ENABLED:
        return
    ids = set()
    for value in essay_ids:
        try:
            ids.add(str(UUID(str(value))))
        except (TypeError, ValueError, AttributeError):
            logger.warning("core_writing_batch_invalid_identity")
    remaining = iter(sorted(ids))

    async def worker():
        for essay_id in remaining:
            try:
                await observe_writing_background(essay_id)
            except Exception:
                # Protect other essays if a future observer implementation fails.
                # Never log exception text or IDs, and never absorb cancellation.
                logger.warning("core_writing_batch_item_unavailable")

    tasks = []
    try:
        async with asyncio.timeout(WRITING_BATCH_BUDGET_SECONDS):
            tasks = [asyncio.create_task(worker()) for _ in range(min(4, len(ids)))]
            await asyncio.gather(*tasks)
    except Exception:
        logger.warning("core_writing_batch_outcome_incomplete")
    finally:
        # gather propagates a child cancellation without cancelling siblings.
        # Do not leave snapshot tasks running after the sweep has returned.
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
