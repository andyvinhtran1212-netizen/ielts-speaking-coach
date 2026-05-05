"""services/essay_service.py — Essay submission + async grading orchestration
(Sprint W2 Phase 2).

Responsibilities:
  • create_essay_with_job — insert writing_essays + writing_jobs rows and
    return enough info for the caller to schedule the BG task.
  • _bg_grade_essay — async BG task that runs the Gemini grader and writes
    writing_feedback. Failure modes mark essay+job as failed and store
    error_message; in-task retry is handled inside the grader (3 attempts
    with exponential backoff) per Sprint W2 Q1 (Option A).
  • list_essays / get_essay_with_feedback — read paths for admin UI.
  • estimate_eta_seconds — lookup table for level/model combos.

Phase 1 admin-only: callers come from /admin/writing/* routes which gate
with require_admin. Uses service-role `supabase_admin`.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from database import supabase_admin
from models.writing_feedback import GraderConfig, WritingFeedback
from services.gemini_writing_grader import (
    AISafetyBlockError,
    APIRetryFailedError,
    InvalidJSONError,
    get_grader,
)
from services.writing_history import get_recurring_patterns

logger = logging.getLogger(__name__)


# ── ETA lookup (Sprint W2 Q2) ────────────────────────────────────────
# Keys are (analysis_level, selected_model). Default 60s when not listed.

_ETA_TABLE: dict[tuple[int, str], int] = {
    (1, "gemini-2.5-flash"): 15,
    (3, "gemini-2.5-pro"):   45,
    (5, "gemini-2.5-pro"):   90,
}
_ETA_DEFAULT_SECONDS = 60


def estimate_eta_seconds(*, analysis_level: int, selected_model: str) -> int:
    """Lookup grading-time estimate for (level, model). Used for client
    polling UX — not authoritative."""
    return _ETA_TABLE.get((analysis_level, selected_model), _ETA_DEFAULT_SECONDS)


# ── Helpers ──────────────────────────────────────────────────────────

def _now() -> str:
    """ISO-8601 UTC timestamp, matching CLAUDE.md guidance."""
    return datetime.now(timezone.utc).isoformat()


def _word_count(text: str) -> int:
    return len(text.split())


def _ensure_student_exists(student_id: str) -> None:
    r = (
        supabase_admin.table("students")
        .select("id")
        .eq("id", student_id)
        .limit(1)
        .execute()
    )
    if not r.data:
        raise HTTPException(404, f"Student not found: {student_id}")


# ── Submission ───────────────────────────────────────────────────────

def create_essay_with_job(*, data: dict, admin_id: str) -> dict:
    """Insert writing_essays + writing_jobs rows for a new submission.

    Returns:
        {"essay_id": <uuid>, "job_id": <uuid>, "eta_seconds": <int>}
    """
    student_id      = data["student_id"]
    task_type       = data["task_type"]
    prompt_text     = data["prompt_text"]
    essay_text      = data["essay_text"]
    analysis_level  = data["analysis_level"]
    form_of_address = data.get("form_of_address", "em")
    selected_model  = data.get("selected_model", "gemini-2.5-pro")
    prompt_image_url = data.get("prompt_image_url")

    _ensure_student_exists(student_id)

    essay_payload = {
        "student_id":         student_id,
        "submitted_by_admin": admin_id,
        "task_type":          task_type,
        "prompt_text":        prompt_text,
        "prompt_image_url":   prompt_image_url,
        "essay_text":         essay_text,
        "word_count":         _word_count(essay_text),
        "analysis_level":     analysis_level,
        "form_of_address":    form_of_address,
        "selected_model":     selected_model,
        "status":             "pending",
    }

    try:
        er = supabase_admin.table("writing_essays").insert(essay_payload).execute()
    except Exception as exc:
        logger.error("[essays] insert failed: %s", exc)
        raise HTTPException(500, f"Database insert failed: {exc}")

    if not er.data:
        raise HTTPException(500, "writing_essays insert returned no rows")
    essay = er.data[0]

    try:
        jr = supabase_admin.table("writing_jobs").insert({
            "essay_id":  essay["id"],
            "job_type":  "analyze",
            "status":    "queued",
        }).execute()
    except Exception as exc:
        # Roll back the essay so we don't strand it without a job.
        supabase_admin.table("writing_essays").delete().eq("id", essay["id"]).execute()
        logger.error("[essays] job insert failed (essay rolled back): %s", exc)
        raise HTTPException(500, f"Database insert failed: {exc}")

    if not jr.data:
        supabase_admin.table("writing_essays").delete().eq("id", essay["id"]).execute()
        raise HTTPException(500, "writing_jobs insert returned no rows")
    job = jr.data[0]

    eta = estimate_eta_seconds(
        analysis_level=analysis_level,
        selected_model=selected_model,
    )
    return {"essay_id": essay["id"], "job_id": job["id"], "eta_seconds": eta}


# ── Async BG grader task ─────────────────────────────────────────────

async def _bg_grade_essay(essay_id: str, job_id: str) -> None:
    """FastAPI BackgroundTask: load essay, call Gemini grader, persist feedback.

    Terminal states only — in-task retry is the grader's 3 attempts. Failures
    mark essay.status='failed' + job.status='failed' and store an
    error_message so the admin UI can surface it.
    """
    logger.info("[grade %s] starting (job=%s)", essay_id, job_id)

    try:
        # Mark in-flight
        supabase_admin.table("writing_jobs").update({
            "status":     "running",
            "started_at": _now(),
        }).eq("id", job_id).execute()
        supabase_admin.table("writing_essays").update({
            "status": "grading",
        }).eq("id", essay_id).execute()

        # Load essay payload — student_id pulled in for Phase 1.5a so we
        # can fetch this student's recurring-patterns aggregate before
        # constructing GraderConfig.
        er = (
            supabase_admin.table("writing_essays")
            .select("task_type, prompt_text, essay_text, analysis_level, "
                    "form_of_address, selected_model, student_id")
            .eq("id", essay_id)
            .limit(1)
            .execute()
        )
        if not er.data:
            raise RuntimeError(f"essay {essay_id} disappeared mid-flight")
        essay = er.data[0]

        # Phase 1.5a — pre-aggregated recurring patterns from the
        # student's last 5 graded essays. Returns None when:
        #   • student has <5 graded essays (Phase-1 behaviour preserved)
        #   • the lookup itself raised (defensive — grading must not
        #     fail because history is unavailable)
        recurring_patterns = get_recurring_patterns(essay["student_id"])

        config = GraderConfig(
            task_type=essay["task_type"],
            prompt_text=essay["prompt_text"],
            essay_text=essay["essay_text"],
            analysis_level=essay["analysis_level"],
            form_of_address=essay["form_of_address"],
            selected_model=essay["selected_model"],
            history=recurring_patterns,
        )

        result = await get_grader().grade_essay(config)

        # Persist feedback (1:1 with essay)
        fb = result.feedback
        feedback_row = {
            "essay_id":                 essay_id,
            "overall_band_score":       float(fb.overallBandScore),
            "band_main_criterion":      float(fb.criteriaFeedback.mainCriterion.bandScore),
            "band_coherence_cohesion":  float(fb.criteriaFeedback.coherenceCohesion.bandScore),
            "band_lexical_resource":    float(fb.criteriaFeedback.lexicalResource.bandScore),
            "band_grammatical_range":   float(fb.criteriaFeedback.grammaticalRange.bandScore),
            "feedback_json":            fb.model_dump(mode="json"),
            "prompt_version":           result.prompt_version,
            "model_used":               result.model_used,
            "tokens_input":             result.tokens_input,
            "tokens_output":            result.tokens_output,
            "cost_usd":                 result.cost_usd,
            "grading_duration_ms":      result.grading_duration_ms,
        }
        supabase_admin.table("writing_feedback").insert(feedback_row).execute()
        supabase_admin.table("writing_essays").update({
            "status": "graded",
        }).eq("id", essay_id).execute()
        supabase_admin.table("writing_jobs").update({
            "status":       "completed",
            "completed_at": _now(),
        }).eq("id", job_id).execute()

        logger.info(
            "[grade %s] done band=%s tokens=%s/%s cost=%s",
            essay_id, fb.overallBandScore,
            result.tokens_input, result.tokens_output, result.cost_usd,
        )

    except (AISafetyBlockError, APIRetryFailedError, InvalidJSONError) as exc:
        _mark_failed(essay_id, job_id, exc, kind=type(exc).__name__)
    except Exception as exc:  # noqa: BLE001 — last-resort failure capture
        logger.exception("[grade %s] unexpected failure", essay_id)
        _mark_failed(essay_id, job_id, exc, kind="UnexpectedError")


def _mark_failed(essay_id: str, job_id: str, exc: Exception, *, kind: str) -> None:
    """Idempotent failure-state writer. Best-effort — never re-raises."""
    msg = f"{kind}: {exc}"[:1000]  # truncate to keep error_message bounded
    try:
        supabase_admin.table("writing_essays").update({
            "status":        "failed",
            "error_message": msg,
        }).eq("id", essay_id).execute()
        supabase_admin.table("writing_jobs").update({
            "status":       "failed",
            "completed_at": _now(),
            "error_log":    [{"kind": kind, "message": str(exc), "at": _now()}],
        }).eq("id", job_id).execute()
    except Exception as inner:
        logger.error("[grade %s] failure-state write also failed: %s", essay_id, inner)


# ── Read paths ───────────────────────────────────────────────────────

_ALLOWED_STATUSES = {"pending", "grading", "graded", "reviewed", "delivered", "failed"}


def list_essays(
    *,
    status: Optional[str] = None,
    student_id: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """List essays with optional status / student filters. Newest first."""
    if status and status not in _ALLOWED_STATUSES:
        raise HTTPException(400, f"Invalid status: {status!r}")

    q = (
        supabase_admin.table("writing_essays")
        .select(
            "id, student_id, task_type, status, analysis_level, "
            "selected_model, word_count, created_at, delivered_at, error_message"
        )
        .order("created_at", desc=True)
    )
    if status:
        q = q.eq("status", status)
    if student_id:
        q = q.eq("student_id", student_id)

    r = q.range(offset, offset + limit - 1).execute()
    return r.data or []


def get_essay_with_feedback(essay_id: str) -> dict:
    """Return one essay row + feedback (when graded) + student summary."""
    er = (
        supabase_admin.table("writing_essays")
        .select("*")
        .eq("id", essay_id)
        .limit(1)
        .execute()
    )
    if not er.data:
        raise HTTPException(404, "Essay not found")
    essay = dict(er.data[0])

    fr = (
        supabase_admin.table("writing_feedback")
        .select("*")
        .eq("essay_id", essay_id)
        .limit(1)
        .execute()
    )
    essay["feedback"] = fr.data[0] if fr.data else None

    sr = (
        supabase_admin.table("students")
        .select("id, student_code, full_name, target_band")
        .eq("id", essay["student_id"])
        .limit(1)
        .execute()
    )
    essay["student"] = sr.data[0] if sr.data else None

    return essay


def get_essay_render_context(essay_id: str) -> dict:
    """Build the data dict consumed by writing_render / writing_word_exporter.

    Layers admin_edits_json (when present) over the AI feedback_json — admin
    edits supersede the original grader output for render + delivery.

    Returns:
        {
          "feedback":      WritingFeedback,  # validated, edits-applied
          "essay_text":    str,
          "prompt_text":   str,
          "task_type":     str,
          "student_name":  str,
          "student_code":  str,
          "essay_id":      str,
        }
    Raises 404 when essay or feedback row is missing.
    """
    er = (
        supabase_admin.table("writing_essays")
        .select(
            "id, student_id, task_type, prompt_text, essay_text, "
            "admin_edits_json, status"
        )
        .eq("id", essay_id)
        .limit(1)
        .execute()
    )
    if not er.data:
        raise HTTPException(404, "Essay not found")
    essay = er.data[0]

    fr = (
        supabase_admin.table("writing_feedback")
        .select("feedback_json")
        .eq("essay_id", essay_id)
        .limit(1)
        .execute()
    )
    if not fr.data:
        raise HTTPException(404, "Feedback not yet available")

    feedback_json = essay.get("admin_edits_json") or fr.data[0]["feedback_json"]
    try:
        feedback = WritingFeedback(**feedback_json)
    except Exception as exc:
        raise HTTPException(500, f"Stored feedback fails schema: {exc}")

    sr = (
        supabase_admin.table("students")
        .select("student_code, full_name")
        .eq("id", essay["student_id"])
        .limit(1)
        .execute()
    )
    student = sr.data[0] if sr.data else {"student_code": "", "full_name": ""}

    return {
        "feedback":     feedback,
        "essay_text":   essay["essay_text"],
        "prompt_text":  essay["prompt_text"],
        "task_type":    essay["task_type"],
        "student_name": student.get("full_name") or "",
        "student_code": student.get("student_code") or "",
        "essay_id":     essay["id"],
    }


def get_essay_status(essay_id: str) -> dict:
    """Lightweight status payload for polling. Cheaper than full detail."""
    er = (
        supabase_admin.table("writing_essays")
        .select("id, status, error_message, analysis_level, selected_model, created_at")
        .eq("id", essay_id)
        .limit(1)
        .execute()
    )
    if not er.data:
        raise HTTPException(404, "Essay not found")
    essay = er.data[0]

    eta = estimate_eta_seconds(
        analysis_level=essay["analysis_level"],
        selected_model=essay["selected_model"],
    )
    return {
        "essay_id":      essay["id"],
        "status":        essay["status"],
        "error_message": essay.get("error_message"),
        "eta_seconds":   eta,
        "created_at":    essay["created_at"],
    }
