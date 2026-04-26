"""
routers/exercises.py — Phase D Wave 1: D1 fill-blank user + admin endpoints.

User endpoints (prefix /api/exercises) are auth-required AND feature-flag-gated.
Admin endpoints (prefix /admin/exercises) require role='admin' and never
auto-publish — every exercise must be reviewed manually before going public.

D3 endpoints land in Wave 2 — this file deliberately scopes itself to D1.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from supabase import create_client

from config import settings
from database import supabase_admin
from routers.admin import require_admin
from routers.auth import get_supabase_user
from services.analytics import fire_event
from services.d1_content_gen import GeminiBatchError, generate_d1_exercises
from services.feature_flags import is_d1_enabled
from services.rate_limit import rate_limit_exercise

logger = logging.getLogger(__name__)


user_router = APIRouter(prefix="/api/exercises", tags=["exercises"])
admin_router = APIRouter(prefix="/admin/exercises", tags=["exercises-admin"])


# ── Helpers ───────────────────────────────────────────────────────────────────


def _require_d1_enabled(user_id: str) -> None:
    if not is_d1_enabled(user_id, settings.D1_ENABLED):
        raise HTTPException(403, "D1 exercises are not enabled for your account.")


def _bearer_token(authorization: str | None) -> str:
    """Strip 'Bearer ' from the Authorization header, raising 401 on a bad header."""
    if not authorization:
        raise HTTPException(401, "Missing Authorization header")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(401, "Invalid Authorization header")
    return parts[1]


def _user_sb(token: str):
    """
    Return a Supabase client bound to the caller's JWT so RLS is enforced.
    Same pattern as routers/vocabulary_bank._user_sb — service-role MUST NOT
    be used on user-facing exercise routes.
    """
    client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
    client.postgrest.auth(token)
    return client


def _safe_event(event_name: str, payload: dict, user_id: str) -> None:
    try:
        fire_event(event_name, payload, user_id)
    except Exception as e:
        logger.debug("[exercises] analytics fire failed (non-fatal): %s", e)


def _grade_d1(user_answer: str, correct_answer: str) -> bool:
    return (user_answer or "").strip().lower() == (correct_answer or "").strip().lower()


def _public_view(row: dict) -> dict:
    """
    User-facing view of an exercise.  Removes the `answer`/`word` fields and
    instead returns a deterministically shuffled `options` array containing the
    answer mixed in with the distractors — so the UI has 4 choices to render
    without ever knowing which one is correct.
    """
    import random
    payload = dict(row.get("content_payload") or {})
    answer = payload.pop("answer", None)
    payload.pop("word", None)
    distractors = list(payload.pop("distractors", []) or [])

    options = list(distractors)
    if answer:
        options.append(answer)
    # Per-row deterministic shuffle keyed on the row id keeps the option order
    # stable across the GET-list and the GET-by-id calls (same id → same order).
    rng = random.Random(str(row.get("id")))
    rng.shuffle(options)
    payload["options"] = options

    return {
        "id": row["id"],
        "exercise_type": row["exercise_type"],
        "content": payload,
    }


# ── Pydantic schemas ──────────────────────────────────────────────────────────


class D1AttemptRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_answer: str = Field(min_length=1, max_length=80)


class AdminGenerateBatchRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    words: list[str] = Field(default_factory=list, max_length=100)
    count: int = Field(default=10, ge=1, le=100)


class AdminPatchExerciseRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    content_payload: dict[str, Any] | None = None


# ── User: D1 list ─────────────────────────────────────────────────────────────


@user_router.get("/d1")
async def list_d1_exercises(
    limit: int = 5,
    authorization: str | None = Header(default=None),
):
    """
    Return up to `limit` published D1 exercises the user has NOT attempted yet.

    Production smoke surfaced an infinite-loop bug: the queue handed back the
    same exercises a user had already submitted, so 'Next exercise' never ran
    out.  Fix is server-side (audit's anti-pattern: never put gating logic
    only in the frontend) — pull the user's attempted exercise_ids first,
    then exclude them from the published-D1 list.

    When the user has finished every published exercise the response is an
    empty array; the frontend translates that into the 'all done' empty
    state instead of looping.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]
    _require_d1_enabled(user_id)
    sb = _user_sb(_bearer_token(authorization))

    limit = max(1, min(int(limit or 5), 20))

    # Step 1: gather every D1 exercise this user has already attempted.
    # RLS on vocabulary_exercise_attempts (SELECT USING auth.uid()=user_id)
    # means we never leak another user's attempts here.
    try:
        attempted_res = (
            sb.table("vocabulary_exercise_attempts")
            .select("exercise_id")
            .eq("exercise_type", "D1")
            .execute()
        )
        attempted_ids = list({
            row["exercise_id"] for row in (attempted_res.data or [])
            if row.get("exercise_id")
        })
    except Exception as e:
        logger.warning(
            "[exercises] list_d1 attempts lookup failed (falling back to no-exclude): %s", e,
        )
        attempted_ids = []

    # Step 2: published D1 exercises NOT in the attempted set.  Pull more than
    # `limit` and shuffle in memory so the user gets a fresh random ordering
    # each call — Supabase REST doesn't expose ORDER BY random().
    try:
        builder = (
            sb.table("vocabulary_exercises")
            .select("id, exercise_type, content_payload, created_at")
            .eq("exercise_type", "D1")
            .eq("status", "published")
        )
        if attempted_ids:
            # PostgREST's not.in.() needs a non-empty list — branch when empty
            # to avoid a 400 from the API.
            builder = builder.not_.in_("id", attempted_ids)
        res = (
            builder
            .order("created_at", desc=True)
            .limit(limit * 4)
            .execute()
        )
    except Exception as e:
        logger.error("[exercises] list_d1 failed: %s", e)
        raise HTTPException(500, "Could not load exercises.")

    import random
    rows = list(res.data or [])
    random.shuffle(rows)
    return [_public_view(r) for r in rows[:limit]]


# ── User: D1 fetch one ────────────────────────────────────────────────────────


@user_router.get("/d1/{exercise_id}")
async def get_d1_exercise(
    exercise_id: str,
    authorization: str | None = Header(default=None),
):
    auth_user = await get_supabase_user(authorization)
    _require_d1_enabled(auth_user["id"])
    sb = _user_sb(_bearer_token(authorization))

    try:
        # RLS only returns the row when it is published OR the caller is admin
        # (per migration 021 vocab_exercises_select).  Non-admins requesting a
        # draft therefore get an empty result, which we surface as 404 below.
        res = (
            sb.table("vocabulary_exercises")
            .select("id, exercise_type, content_payload, status")
            .eq("id", exercise_id)
            .eq("exercise_type", "D1")
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error("[exercises] get_d1 failed: %s", e)
        raise HTTPException(500, "Could not load exercise.")

    if not res.data or res.data[0].get("status") != "published":
        raise HTTPException(404, "Exercise not found.")
    return _public_view(res.data[0])


# ── User: D1 attempt ──────────────────────────────────────────────────────────


@user_router.post("/d1/{exercise_id}/attempt")
@rate_limit_exercise(exercise_type="D1", daily_limit=50)
async def submit_d1_attempt(
    exercise_id: str,
    body: D1AttemptRequest,
    authorization: str | None = Header(default=None),
):
    """
    D1 free tier: 50 attempts/day to prevent abuse.

    The decorator above runs BEFORE this handler and raises HTTP 429 with a
    machine-readable detail (error, limit, used, reset_at) once the user has
    submitted 50 D1 attempts in the current UTC day.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]
    _require_d1_enabled(user_id)
    sb = _user_sb(_bearer_token(authorization))

    try:
        # RLS already prevents non-admins from reading drafts; we still filter
        # by status so the explicit "Exercise not found" branch is unambiguous
        # for admins inadvertently submitting against an unpublished id.
        res = (
            sb.table("vocabulary_exercises")
            .select("id, exercise_type, content_payload, status")
            .eq("id", exercise_id)
            .eq("exercise_type", "D1")
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.error("[exercises] attempt fetch failed: %s", e)
        raise HTTPException(500, "Could not load exercise.")

    if not res.data or res.data[0].get("status") != "published":
        raise HTTPException(404, "Exercise not found.")

    row = res.data[0]
    payload = row.get("content_payload") or {}
    correct_answer = payload.get("answer") or ""

    is_correct = _grade_d1(body.user_answer, correct_answer)
    score = 1.0 if is_correct else 0.0

    feedback = {
        "is_correct": is_correct,
        "correct_answer": correct_answer,
        "your_answer": body.user_answer.strip(),
    }

    try:
        # User-scoped client so the WITH CHECK on user_id is enforced — a
        # caller cannot insert an attempt that claims another user's id.
        sb.table("vocabulary_exercise_attempts").insert({
            "user_id":       user_id,
            "exercise_id":   row["id"],
            "exercise_type": "D1",
            "user_answer":   body.user_answer.strip(),
            "is_correct":    is_correct,
            "score":         score,
            "feedback":      feedback,
        }).execute()
    except Exception as e:
        logger.warning("[exercises] attempt insert failed (non-fatal): %s", e)

    _safe_event(
        "exercise_completed",
        {"type": "D1", "exercise_id": row["id"], "is_correct": is_correct, "score": score},
        user_id,
    )

    return {
        "is_correct": is_correct,
        "correct_answer": correct_answer,
        "score": score,
    }


# ── Admin: list ───────────────────────────────────────────────────────────────


@admin_router.get("")
async def admin_list_exercises(
    status: str = "draft",
    exercise_type: str = "D1",
    limit: int = 50,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)

    if status not in ("draft", "published", "rejected"):
        raise HTTPException(400, "Invalid status filter.")
    if exercise_type not in ("D1", "D3"):
        raise HTTPException(400, "Invalid exercise_type.")
    limit = max(1, min(int(limit or 50), 200))

    try:
        res = (
            supabase_admin.table("vocabulary_exercises")
            .select("id, exercise_type, content_payload, status, created_at, reviewed_at")
            .eq("status", status)
            .eq("exercise_type", exercise_type)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as e:
        logger.error("[admin/exercises] list failed: %s", e)
        raise HTTPException(500, "Could not load exercises.")

    return res.data or []


# ── Admin: status transitions ─────────────────────────────────────────────────


def _admin_set_status(exercise_id: str, new_status: str, reviewer_id: str) -> dict:
    update = {
        "status":       new_status,
        "reviewed_at":  datetime.now(timezone.utc).isoformat(),
        "reviewed_by":  reviewer_id,
    }
    try:
        res = (
            supabase_admin.table("vocabulary_exercises")
            .update(update)
            .eq("id", exercise_id)
            .execute()
        )
    except Exception as e:
        logger.error("[admin/exercises] status update failed: %s", e)
        raise HTTPException(500, "Status update failed.")

    if not res.data:
        raise HTTPException(404, "Exercise not found.")
    return res.data[0]


@admin_router.patch("/{exercise_id}/publish")
async def admin_publish_exercise(
    exercise_id: str,
    authorization: str | None = Header(default=None),
):
    auth_user = await require_admin(authorization)
    row = _admin_set_status(exercise_id, "published", auth_user["id"])
    _safe_event("admin_exercise_reviewed", {"action": "publish", "exercise_id": exercise_id}, auth_user["id"])
    return row


@admin_router.patch("/{exercise_id}/reject")
async def admin_reject_exercise(
    exercise_id: str,
    authorization: str | None = Header(default=None),
):
    auth_user = await require_admin(authorization)
    row = _admin_set_status(exercise_id, "rejected", auth_user["id"])
    _safe_event("admin_exercise_reviewed", {"action": "reject", "exercise_id": exercise_id}, auth_user["id"])
    return row


@admin_router.patch("/{exercise_id}")
async def admin_edit_exercise(
    exercise_id: str,
    body: AdminPatchExerciseRequest,
    authorization: str | None = Header(default=None),
):
    """Edit content_payload while still in 'draft' / 'rejected' state."""
    await require_admin(authorization)
    if body.content_payload is None:
        raise HTTPException(400, "content_payload is required.")
    try:
        res = (
            supabase_admin.table("vocabulary_exercises")
            .update({"content_payload": body.content_payload})
            .eq("id", exercise_id)
            .execute()
        )
    except Exception as e:
        logger.error("[admin/exercises] edit failed: %s", e)
        raise HTTPException(500, "Edit failed.")
    if not res.data:
        raise HTTPException(404, "Exercise not found.")
    return res.data[0]


# ── Admin: bulk transitions ───────────────────────────────────────────────────


class AdminBulkActionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    ids: list[str] = Field(min_length=1, max_length=200)
    action: str  # 'publish' | 'reject'


@admin_router.post("/bulk")
async def admin_bulk_action(
    body: AdminBulkActionRequest,
    authorization: str | None = Header(default=None),
):
    auth_user = await require_admin(authorization)
    if body.action not in ("publish", "reject"):
        raise HTTPException(400, "Invalid bulk action.")

    new_status = "published" if body.action == "publish" else "rejected"
    update = {
        "status":      new_status,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
        "reviewed_by": auth_user["id"],
    }

    try:
        res = (
            supabase_admin.table("vocabulary_exercises")
            .update(update)
            .in_("id", body.ids)
            .execute()
        )
    except Exception as e:
        logger.error("[admin/exercises] bulk action failed: %s", e)
        raise HTTPException(500, "Bulk action failed.")

    affected = len(res.data or [])
    _safe_event(
        "admin_exercise_reviewed",
        {"action": body.action, "bulk": True, "count": affected},
        auth_user["id"],
    )
    return {"action": body.action, "affected": affected, "ids": [r["id"] for r in (res.data or [])]}


# ── Admin: generate batch via Gemini ──────────────────────────────────────────


import math


def _insert_chunk_as_drafts(items: list[dict], admin_id: str) -> int:
    """Insert one chunk's worth of validated items as drafts.  Returns the
    number of rows actually written.  A DB error is logged and re-raised so
    the surrounding generate_d1_exercises loop can move on to the next chunk."""
    if not items:
        return 0
    rows = [
        {
            "exercise_type":   "D1",
            "status":          "draft",
            "content_payload": item,
            "created_by":      admin_id,
        }
        for item in items
    ]
    supabase_admin.table("vocabulary_exercises").insert(rows).execute()
    logger.info(
        "[admin/exercises] chunk insert: +%d drafts (admin=%s)", len(rows), admin_id,
    )
    return len(rows)


def _generate_and_insert_batch(words: list[str], count: int, admin_id: str) -> dict:
    """
    Drive chunked generation and incremental insert.  Returns a stats dict
    used by the endpoint's response body:

        {
          "inserted_count":  total rows actually written,
          "total_chunks":    chunks attempted,
          "successful_chunks": chunks that returned ≥1 validated item,
          "failed_chunks":   chunks that raised GeminiBatchError,
        }

    Propagates GeminiBatchError ONLY when every chunk fails (the
    "all chunks failed" case from generate_d1_exercises).
    """
    inserted_count = 0
    successful_chunks = 0

    def _on_chunk(items: list[dict]) -> None:
        nonlocal inserted_count, successful_chunks
        n = _insert_chunk_as_drafts(items, admin_id)
        inserted_count += n
        if n > 0:
            successful_chunks += 1

    # generate_d1_exercises does the chunking; the callback persists per chunk.
    # Its return value is the aggregated list, but we don't need it here —
    # the callback already inserted every successful chunk.
    items = generate_d1_exercises(words, count=count, on_chunk_validated=_on_chunk)

    # Compute total/failed chunks from the same shape generate_d1_exercises uses.
    word_count_clamped = max(1, min(count, len(words), 100))
    total_chunks = max(1, math.ceil(word_count_clamped / 10))  # CHUNK_SIZE=10
    failed_chunks = total_chunks - successful_chunks

    logger.info(
        "[admin/exercises] batch summary: inserted=%d, chunks ok=%d/%d, items_returned=%d (admin=%s)",
        inserted_count, successful_chunks, total_chunks, len(items), admin_id,
    )
    return {
        "inserted_count":    inserted_count,
        "total_chunks":      total_chunks,
        "successful_chunks": successful_chunks,
        "failed_chunks":     failed_chunks,
    }


@admin_router.post("/d1/generate-batch", status_code=202)
async def admin_generate_d1_batch(
    body: AdminGenerateBatchRequest,
    authorization: str | None = Header(default=None),
):
    """
    Synchronous + chunked.  Generate in groups of 10 (services.d1_content_gen
    .CHUNK_SIZE) so each Gemini call stays well under its truncation limit,
    and persist drafts incrementally so a failure in chunk N doesn't lose
    chunks 1..N-1.  100 words → 10 chunks → ~120s max, well within Railway's
    response timeout.

    Response shape:
      All chunks ok      → 202, status='completed',  total_chunks==successful_chunks
      Some chunks fail   → 202, status='partial',    failed_chunks > 0
      Every chunk fails  → 502, GeminiBatchError detail (existing api.js path)
    """
    auth_user = await require_admin(authorization)
    if not body.words:
        raise HTTPException(400, "Provide at least one word.")

    # Cost estimate per PHASE_D_V3_PLAN §19: ~$0.0005 / item for Gemini Flash.
    estimated_cost_usd = round(0.0005 * body.count, 4)
    job_id = str(uuid.uuid4())

    logger.info(
        "[admin/exercises] start batch job=%s admin=%s words=%d count=%d",
        job_id, auth_user["id"], len(body.words), body.count,
    )

    try:
        stats = _generate_and_insert_batch(body.words, body.count, auth_user["id"])
    except GeminiBatchError as e:
        logger.error("[admin/exercises] batch job=%s FAILED: %s", job_id, e)
        raise HTTPException(
            status_code=502,
            detail=f"Generation failed: {e}",
        )
    except Exception as e:
        logger.error("[admin/exercises] batch job=%s unexpected error: %s", job_id, e)
        raise HTTPException(
            status_code=500,
            detail=f"Batch insert failed: {e}",
        )

    inserted = stats["inserted_count"]
    failed_chunks = stats["failed_chunks"]
    total_chunks = stats["total_chunks"]
    successful_chunks = stats["successful_chunks"]

    if failed_chunks == 0:
        status = "completed"
        message = f"{inserted} draft(s) inserted across {total_chunks} chunk(s)."
    else:
        status = "partial"
        message = (
            f"{inserted} draft(s) inserted across {successful_chunks}/{total_chunks} "
            f"chunk(s); {failed_chunks} chunk(s) failed (see server logs)."
        )

    return {
        "job_id":             job_id,
        "status":             status,
        "inserted_count":     inserted,
        "requested_count":    body.count,
        "word_count":         len(body.words),
        "total_chunks":       total_chunks,
        "successful_chunks":  successful_chunks,
        "failed_chunks":      failed_chunks,
        "estimated_cost_usd": estimated_cost_usd,
        "message":            message,
    }
