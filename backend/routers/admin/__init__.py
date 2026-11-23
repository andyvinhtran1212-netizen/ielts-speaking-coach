"""
routers/admin.py — Admin-only management endpoints

All routes under /admin/ require role = "admin" in the users table.

Required Supabase tables (run migration 002 if not yet applied):
    See backend/migrations/002_topic_question_library.sql
"""

import asyncio
import json
import logging
import math
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlparse

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
import uuid as _uuid
from typing import Any, Literal
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from config import settings
from models.admin_speaking import (
    AdminResponseRegradeResponse,
    AdminSessionRegradeResponse,
    AdminSpeakingSessionDetail,
    AdminSpeakingSessionRow,
    AdminSummaryRebuildResponse,
)
from models.admin_overview import DashboardOverviewOut, DashboardTrendsOut
from models.admin_users import AdminTestDataVisibilityOut, AdminUserDirectoryRowOut
from models.staff_security import UserRoleChangeOut
from models.grammar_content import GrammarArticleDocument
from database import supabase_admin
from services.async_pg_engine import create_asyncpg_engine
from services.class_assignment_service import sync_class_item_score
from services.errors import clip_user_value, clip_user_values, new_ref, safe_error
from services.core_attempt_observation import bind_owned_attempt, note_operation_failure, observe_operation
from services.class_membership_service import active_memberships_for_students, add_student
from services import admin_dashboard, ai_usage_logger, class_archive_service, test_data_visibility
from services.student_service import student_archived_error
from services.access_code_gen import (
    generate_access_code, insert_one_with_unique_code, insert_with_unique_codes,
)
from services import staff_guard, staff_security
from services.request_context import current_request_id
from services.db_async import aexecute
from services import speaking_question_audio as speaking_audio
from services.recording_audio import attach_playback_urls, recording_path
from services import admin_reading_dashboard
from services.access_code_permissions import (
    get_completed_session_counts,
    get_users_code_summary,
    validate_permissions_or_raise,
)
from routers.auth import get_supabase_user
from services.gemini import (
    generate_part1_questions,
    generate_part2_cuecard,
    generate_part3_questions,
)
from services.claude_grader import grade_response as _claude_grade
from services.grading_telemetry import log_fallback_events
from services.whisper import transcribe_from_bytes
from services.ai_pricing import effective_logged_cost

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])
_STAGING_E2E_SUPABASE_HOST = "zjphffoujxkpltixsbzj.supabase.co"
_STAGING_E2E_EMAIL_SUFFIX = "@staging-e2e.averlearning.com"
_STAGING_E2E_AUDIO_BUCKET = "audio-responses"
_STAGING_E2E_TOPICS = frozenset({
    "Staging live failure injection",
    "Gate E live failure injection",
    "Work and career",
})
_db_engine: AsyncEngine | None = (
    create_asyncpg_engine(settings.ASYNC_DATABASE_URL)
    if settings.ASYNC_DATABASE_URL
    else None
)


# ── Auth guard ─────────────────────────────────────────────────────────────────

async def _staff_role_row(user_id: str):
    """``users.role`` for the staff guards — runs on every staff request, so it
    goes through the async-DB facade (PC-J05 D1a). With USE_ASYNC_DB off it is
    the same sync query on this module's ``supabase_admin`` as before."""
    return await aexecute(
        lambda db: db.table("users").select("role").eq("id", user_id).limit(1),
        sync_client=supabase_admin,
    )


async def require_admin(authorization: str | None, *, allow_aal1: bool = False) -> dict:
    """Verify Bearer token and assert an active admin with a satisfied second
    factor (ADMINAAL2-0032, services/staff_guard.py). Returns the Supabase auth
    dict. ``allow_aal1`` is honoured only on staff_guard.AAL1_ALLOWED_ADMIN_ROUTES."""
    return await staff_guard.resolve_staff(
        authorization, need="admin", get_user=get_supabase_user, db=supabase_admin,
        allow_aal1=allow_aal1, read_role=_staff_role_row,
    )


async def require_instructor(authorization: str | None) -> dict:
    """Verify Bearer token and assert role ∈ {instructor, admin} (admin ⊃
    instructor) and an active account. A caller whose role is admin must also
    satisfy the admin second-factor rule (FR-005) — the instructor USER-ROLE
    guard for the W-2 multi-tenancy surface.

    NOTE: distinct from routers/admin_instructor_queue.py's 'instructor review queue'
    (an admin-only GRADING tier that just shares the word). Do NOT retrofit this
    guard onto those endpoints — different meaning of 'instructor'.
    """
    return await staff_guard.resolve_staff(
        authorization, need="instructor", get_user=get_supabase_user, db=supabase_admin,
        read_role=_staff_role_row,
    )


# ── Helpers ────────────────────────────────────────────────────────────────────

def _actor_id(admin) -> str | None:
    """The admin's user id from the auth context (require_admin's return) — NEVER
    from the request body, so the actor can't be spoofed."""
    return admin.get("id") if isinstance(admin, dict) else None


def _audit_entitlement(
    actor_user_id: str | None,
    action: str,
    code_id: str | None,
    *,
    target_user_id: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
) -> None:
    """Append one row to access_code_audit. BEST-EFFORT: never raises — a logging
    failure must not break the entitlement action it records (the action has
    already happened by the time this is called)."""
    try:
        supabase_admin.table("access_code_audit").insert({
            "actor_user_id":  actor_user_id,
            "action":         action,
            "code_id":        code_id,
            "target_user_id": target_user_id,
            "before":         before,
            "after":          after,
        }).execute()
    except Exception as exc:
        logger.warning(
            "access_code_audit insert failed (action=%s code=%s): %s",
            action, code_id, exc,
        )


def _gen_code() -> str:
    """Generate a CSPRNG access code in the format XXXX-XXXX-XXXX (F07).
    Kept as a shim for existing importers; inserts go through access_code_gen."""
    return generate_access_code()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uniq_topic_ids(topic_ids: list[str]) -> list[str]:
    seen: set[str] = set()
    cleaned: list[str] = []
    for raw in topic_ids or []:
        topic_id = (raw or "").strip()
        if not topic_id or topic_id in seen:
            continue
        seen.add(topic_id)
        cleaned.append(topic_id)
    return cleaned


def _parse_iso(dt_str: str | None) -> datetime | None:
    if not dt_str:
        return None
    try:
        return datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    except ValueError:
        return None


def _max_iso(*values: str | None) -> str | None:
    parsed = [_parse_iso(v) for v in values if v]
    parsed = [v for v in parsed if v is not None]
    if not parsed:
        return None
    return max(parsed).isoformat()


def _topic_status(topic: dict, question_count: int | None) -> tuple[str, str]:
    if not topic.get("is_active", True):
        return "inactive", "Inactive"
    if question_count is None:
        return "metadata_unavailable", "Question status unavailable"
    if question_count <= 0:
        return "no_questions", "No questions"
    if topic.get("last_rotated_at"):
        return "generated", "Generated"
    return "has_questions", "Has questions"


def _touch_topic(topic_id: str) -> None:
    try:
        supabase_admin.table("topics").update({"updated_at": _utc_now_iso()}).eq("id", topic_id).execute()
    except Exception:
        logger.warning("[admin.topics] failed to update updated_at for topic=%s", topic_id, exc_info=True)


def _topic_question_insert_rows(rows: list[dict]) -> list[dict]:
    restore_rows: list[dict] = []
    for row in rows or []:
        restore = {
            "topic_id": row.get("topic_id"),
            "part": row.get("part"),
            "order_num": row.get("order_num", 0),
            "question_text": row.get("question_text", ""),
            "question_type": row.get("question_type", ""),
            "cue_card_bullets": row.get("cue_card_bullets"),
            "cue_card_reflection": row.get("cue_card_reflection"),
            "is_active": row.get("is_active", True),
        }
        restore_rows.append(restore)
    return restore_rows


def _require_db_engine() -> AsyncEngine:
    if _db_engine is None:
        raise HTTPException(500, "DATABASE_URL is not configured.")
    return _db_engine


import sys as _sys
import types as _types


def _reexport(sub):
    g = globals()
    for name, value in vars(sub).items():
        if name.startswith("__"):
            continue
        if name in g and g[name] is not value:
            raise ImportError(f"routers.admin: {sub.__name__}.{name} shadows a different object")
        g[name] = value


from . import _common  # noqa: E402 — BACKENDSPLIT-0076: lines 245–710 live there
_reexport(_common)


from . import users_stats  # noqa: E402 — BACKENDSPLIT-0076: users list, user admin actions, e2e cleanup and /admin/stats
_reexport(users_stats)


from . import access_codes  # noqa: E402 — BACKENDSPLIT-0076: access-code generate/list, usage log, foot-traffic and dashboard reads
_reexport(access_codes)


from . import access_code_admin  # noqa: E402 — BACKENDSPLIT-0076: access-code patch, revoke, detail, user removal, reassignment, hard delete and audit
_reexport(access_code_admin)


from . import topics  # noqa: E402 — BACKENDSPLIT-0076: topic and topic-question CRUD and generation
_reexport(topics)


from . import ai_usage  # noqa: E402 — BACKENDSPLIT-0076: AI usage ledger
_reexport(ai_usage)


from . import sessions  # noqa: E402 — BACKENDSPLIT-0076: speaking sessions, alerts, regrade and summary rebuild
_reexport(sessions)


# ── VOCAB MONITOR ─────────────────────────────────────────────────────────────

@router.get("/vocab/stats")
async def admin_vocab_stats(authorization: str | None = Header(default=None)):
    """Return vocab bank aggregate stats for admin monitoring."""
    await require_admin(authorization)

    try:
        fp_res = (
            supabase_admin.table("analytics_events")
            .select("id", count="exact")
            .eq("event_name", "vocab_fp_reported")
            .execute()
        )
        fp_total = fp_res.count or 0
    except Exception:
        fp_total = 0

    try:
        bank_res = (
            supabase_admin.table("user_vocabulary")
            .select("id", count="exact")
            .eq("is_archived", False)
            .execute()
        )
        bank_total = bank_res.count or 0
    except Exception:
        bank_total = 0

    fp_rate = round(fp_total / bank_total * 100, 1) if bank_total > 0 else 0.0

    try:
        flag_res = supabase_admin.table("users").select("feature_flags").execute()
        enabled_count = sum(
            1 for u in (flag_res.data or [])
            if isinstance(u.get("feature_flags"), dict) and u["feature_flags"].get("vocab_enabled") is True
        )
    except Exception:
        enabled_count = 0

    return {
        "fp_reports_total": fp_total,
        "vocab_bank_total": bank_total,
        "fp_rate_percent": fp_rate,
        "users_with_vocab_enabled": enabled_count,
    }


class VocabFlagPayload(BaseModel):
    enabled: bool


@router.post("/users/{user_id}/vocab-flag")
async def admin_set_vocab_flag(
    user_id: str,
    payload: VocabFlagPayload,
    authorization: str | None = Header(default=None),
):
    """Toggle vocab_enabled feature flag for a specific user."""
    await require_admin(authorization)

    try:
        user_res = (
            supabase_admin.table("users")
            .select("id, feature_flags")
            .eq("id", user_id)
            .single()
            .execute()
        )
    except Exception as exc:
        # PC-J225: the driver text is not a user-facing message.
        logger.warning("[admin] feature-flag user lookup failed: %s", exc.__class__.__name__)
        raise HTTPException(404, "User not found")

    user_row = user_res.data
    if not user_row:
        raise HTTPException(404, "User not found")

    flags = user_row.get("feature_flags") or {}
    flags["vocab_enabled"] = payload.enabled

    supabase_admin.table("users").update({"feature_flags": flags}).eq("id", user_id).execute()

    action = "enabled" if payload.enabled else "disabled"
    logger.info("[admin] vocab flag %s for user %s", action, user_id)
    return {"ok": True, "message": f"Vocab bank {action} for user {user_id}."}


# ── POST /admin/vocab/backfill-enrichment ─────────────────────────────────────
#
# Phase D Wave 2 rich-content backfill.  Fills user_vocabulary.ipa,
# example_sentence, definition_vi and definition_en for rows where any of
# them is empty.  Uses the same Gemini batch service that the inline Phase B
# extractor uses, so the prompt + validation stays in one place.
#
# Implementation notes:
# - BackgroundTasks because the job can take 10-30s for ~100 cards (one
#   Gemini call per chunk of 10) and we don't want to block the admin's
#   browser.
# - Dedup by lower(headword) before calling Gemini — multiple users share
#   the same word frequently and we don't want to pay per duplicate.
# - service-role admin client is required: we UPDATE across many user_ids
#   in one job, so an RLS-scoped client wouldn't work.  This is the same
#   posture as the existing admin endpoints.
# - Cost estimate is conservative — Gemini Flash list pricing puts a chunk
#   of 10 enrichments around $0.0005, so 100 cards (10 chunks) ≈ $0.005;
#   the prompt's $0.10-0.15 figure is for cards-with-duplicates pre-dedup.
# - INACTIVEWRITE-0035 follow-up (owner decision 2026-10-28): one owner can
#   contribute at most _BACKFILL_MAX_ROWS_PER_OWNER rows per run, and rows of
#   owners whose users.is_active is false, NULL or missing are skipped, so
#   neither a single account's headwords nor an inactive account's can fill
#   the paid Gemini batch. The candidate scan pages past skipped rows; it is
#   bounded by _BACKFILL_SCAN_MAX_PAGES.
# - Fill-empty-only (owner decision 2026-10-28 15:07): a column is written
#   only when it is NULL, empty or whitespace; an existing value is never
#   overwritten.  Each write is a separate UPDATE guarded by the same
#   emptiness filter, so a value the learner saves between the scan and the
#   write is not overwritten either.  `dry_run=true` lists, per row, the
#   columns that would be filled, without calling Gemini or writing.

_BACKFILL_MAX_ROWS_PER_OWNER = 50
_BACKFILL_SCAN_PAGE_SIZE = 500
_BACKFILL_SCAN_MAX_PAGES = 20
_BACKFILL_OWNER_LOOKUP_CHUNK = 100
# Every column the enricher fills; the enricher's keys use the same names.
_BACKFILL_FIELDS = ("ipa", "example_sentence", "definition_vi", "definition_en")


def _backfill_empty_filter(col: str) -> str:
    """PostgREST or-filter for "NULL, empty or whitespace-only"."""
    return f"{col}.is.null,{col}.match.^\\s*$"


def _backfill_is_empty(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _backfill_empty_fields(row: dict) -> list[str]:
    """The enriched columns this row may receive, in _BACKFILL_FIELDS order."""
    return [c for c in _BACKFILL_FIELDS if _backfill_is_empty(row.get(c))]


def _backfill_select_candidates(job_id: str, limit: int) -> list[dict]:
    """Pick up to `limit` enrichment candidates, at most
    _BACKFILL_MAX_ROWS_PER_OWNER per owner, active owners only.

    Raises on any query failure: the caller then aborts the run before any
    Gemini call (an unverified owner must not be enriched).
    """
    selected: list[dict] = []
    per_owner: dict[str, int] = {}
    owner_active: dict[str, bool] = {}
    skipped_inactive = 0
    skipped_over_cap = 0

    for page in range(_BACKFILL_SCAN_MAX_PAGES):
        start = page * _BACKFILL_SCAN_PAGE_SIZE
        # Day 1 dogfood: idioms + multi-word phrases were arriving with
        # NULL definition_vi from the extractor.  Widen the candidate query
        # so we re-enrich rows whose definitions are missing too — Gemini
        # now generates Vietnamese + English glosses alongside IPA/example.
        batch = (
            supabase_admin.table("user_vocabulary")
            .select("id, headword, user_id, " + ", ".join(_BACKFILL_FIELDS))
            .eq("is_archived", False)
            .or_(",".join(_backfill_empty_filter(c) for c in _BACKFILL_FIELDS))
            .order("id")
            .range(start, start + _BACKFILL_SCAN_PAGE_SIZE - 1)
            .execute()
        ).data or []

        unknown = sorted({
            str(r["user_id"]) for r in batch
            if r.get("user_id") and str(r["user_id"]) not in owner_active
        })
        for i in range(0, len(unknown), _BACKFILL_OWNER_LOOKUP_CHUNK):
            chunk = unknown[i:i + _BACKFILL_OWNER_LOOKUP_CHUNK]
            users = (
                supabase_admin.table("users")
                .select("id, is_active")
                .in_("id", chunk)
                .execute()
            ).data or []
            found = {str(u["id"]): u.get("is_active") is True for u in users}
            for uid in chunk:
                # Missing row or NULL is inactive (activation_gate.lookup_is_active).
                owner_active[uid] = found.get(uid, False)

        for r in batch:
            if not _backfill_empty_fields(r):
                continue  # Nothing to fill; never re-enrich a complete row.
            uid = str(r.get("user_id") or "")
            if not owner_active.get(uid, False):
                skipped_inactive += 1
                continue
            if per_owner.get(uid, 0) >= _BACKFILL_MAX_ROWS_PER_OWNER:
                skipped_over_cap += 1
                continue
            per_owner[uid] = per_owner.get(uid, 0) + 1
            selected.append(r)
            if len(selected) >= limit:
                break

        if len(selected) >= limit or len(batch) < _BACKFILL_SCAN_PAGE_SIZE:
            break

    logger.info(
        "[backfill %s] selected %d rows from %d owners "
        "(skipped %d inactive-owner rows, %d over the %d-per-owner cap)",
        job_id, len(selected), len(per_owner),
        skipped_inactive, skipped_over_cap, _BACKFILL_MAX_ROWS_PER_OWNER,
    )
    return selected


def _backfill_dry_run(job_id: str, limit: int) -> dict:
    """Report the rows a real run would pick and, per row, the columns it
    would fill.  No Gemini call and no write.  Raises when the candidate
    query fails, so the caller can fail visibly.

    A listed column is filled only if Gemini returns a valid value for it
    (definitions are best-effort), so a real run can fill fewer.
    """
    rows = _backfill_select_candidates(job_id, limit)
    out = []
    for r in rows:
        would_fill = _backfill_empty_fields(r)
        logger.info(
            "[backfill %s] dry-run row=%s headword=%r would fill: %s",
            job_id, r["id"], r.get("headword"), ", ".join(would_fill),
        )
        out.append({
            "id":         r["id"],
            "user_id":    r.get("user_id"),
            "headword":   r.get("headword"),
            "would_fill": would_fill,
        })
    column_counts = {
        c: sum(c in row["would_fill"] for row in out) for c in _BACKFILL_FIELDS
    }
    logger.info(
        "[backfill %s] dry-run: %d rows, columns that would be filled: %s",
        job_id, len(out), column_counts,
    )
    return {"rows": out, "column_counts": column_counts}


def _backfill_run(job_id: str, limit: int) -> None:
    """
    Background task: enrich up to `limit` user_vocabulary rows with an empty
    IPA, example_sentence, definition_vi or definition_en, filling only the
    empty columns.  Runs synchronously inside FastAPI's BG worker — no
    asyncio dependencies, all Supabase calls are blocking.
    """
    from services.vocab_enrichment import enrich_vocabulary_batch, VocabEnrichmentError

    try:
        rows = _backfill_select_candidates(job_id, limit)
    except Exception as e:
        logger.error("[backfill %s] candidate query failed: %s", job_id, e)
        return

    if not rows:
        logger.info("[backfill %s] no rows to enrich", job_id)
        return

    # Group rows by lower(headword) so one Gemini call per unique word
    # back-fills every row that shares it (across users).
    by_word: dict[str, list[dict]] = {}
    for r in rows:
        key = (r.get("headword") or "").strip().lower()
        if not key:
            continue
        by_word.setdefault(key, []).append(r)

    unique_words = list(by_word.keys())
    logger.info(
        "[backfill %s] enriching %d unique headwords across %d rows",
        job_id, len(unique_words), len(rows),
    )

    try:
        enrichments = enrich_vocabulary_batch(unique_words)
    except VocabEnrichmentError as e:
        logger.error("[backfill %s] all chunks failed: %s", job_id, e)
        return

    enrich_map = {e["headword"].lower(): e for e in enrichments}

    updated = 0
    for low, group_rows in by_word.items():
        e = enrich_map.get(low)
        if not e:
            continue  # Word didn't make it through Gemini's validation.
        for row in group_rows:
            filled: list[str] = []
            kept: list[str] = []
            for col in _backfill_empty_fields(row):
                value = e.get(col)
                if _backfill_is_empty(value):
                    continue  # Gemini gave nothing usable; leave it empty.
                try:
                    res = (
                        supabase_admin.table("user_vocabulary")
                        .update({col: value})
                        .eq("id", row["id"])
                        .or_(_backfill_empty_filter(col))
                        .execute()
                    )
                except Exception as upd_err:
                    logger.warning(
                        "[backfill %s] update failed for row=%s column=%s: %s",
                        job_id, row["id"], col, upd_err,
                    )
                    continue
                # No row back = the column got a value after the scan; kept.
                (filled if res.data else kept).append(col)
            if kept:
                logger.info(
                    "[backfill %s] row=%s kept values written since the scan: %s",
                    job_id, row["id"], ", ".join(kept),
                )
            if filled:
                logger.info(
                    "[backfill %s] row=%s filled: %s",
                    job_id, row["id"], ", ".join(filled),
                )
                updated += 1

    logger.info(
        "[backfill %s] done: enriched %d unique words → updated %d/%d rows",
        job_id, len(enrich_map), updated, len(rows),
    )


@router.post("/vocab/backfill-enrichment")
async def backfill_vocab_enrichment(
    background_tasks: BackgroundTasks,
    limit: int = Query(default=100, ge=1, le=500),
    dry_run: bool = Query(default=False),
    authorization: str | None = Header(default=None),
):
    """
    Trigger a background job that enriches user_vocabulary rows with an
    empty `ipa`, `example_sentence`, `definition_vi` or `definition_en`
    (i.e. rows that pre-date migration 029 or whose Gemini call failed
    during Phase B extraction).  Only columns that are NULL, empty or
    whitespace are filled; existing values are never overwritten.

    `dry_run=true` runs the same row selection synchronously and returns,
    per row, the columns that would be filled.  It calls no model and
    writes nothing.

    Caps at 500/call so an admin can't accidentally fan out across the
    whole bank in one click.  Within a call, one owner contributes at most
    50 rows and inactive owners are skipped (INACTIVEWRITE-0035 follow-up).  Re-run the endpoint to process the next
    batch — the WHERE clause naturally moves forward as rows get filled.

    Cost estimate is best-effort: Gemini Flash batch is ~$0.0005 per
    chunk of 10 unique words.
    """
    await require_admin(authorization)
    job_id = _uuid.uuid4().hex[:12]
    if dry_run:
        try:
            plan = await run_in_threadpool(_backfill_dry_run, job_id, limit)
        except Exception as e:
            logger.error("[backfill %s] dry-run candidate query failed: %s", job_id, e)
            raise HTTPException(status_code=503, detail="Backfill dry-run could not read candidates.")
        return {
            "job_id":        job_id,
            "status":        "dry_run",
            "limit":         limit,
            "row_count":     len(plan["rows"]),
            "column_counts": plan["column_counts"],
            "rows":          plan["rows"],
            "note": "No model call and no write. A listed column is filled only if Gemini returns a valid value for it.",
        }
    background_tasks.add_task(_backfill_run, job_id, limit)
    estimated_cost_usd = round((max(1, limit) / 10) * 0.0005, 4)
    return {
        "job_id":             job_id,
        "status":             "queued",
        "limit":              limit,
        "estimated_cost_usd": estimated_cost_usd,
        "note": "Tail Railway logs for '[backfill <job_id>]' to track progress.",
    }


# ── GET /admin/flashcards/stats ────────────────────────────────────────────────
#
# Phase 2.5 dogfood support: aggregate flashcard usage metrics for SRS
# validation.  Read-only; uses service-role supabase_admin so no per-user
# RLS scoping (admin-only endpoint anyway).
#
# Schema notes (verified against migrations 025/026/027):
# - flashcard_review_log: per-review audit row, columns
#   (user_id, vocabulary_id, rating, reviewed_at).  NOT created_at — the
#   column name is reviewed_at; using the wrong name would 400 silently
#   under PostgREST.
# - flashcard_reviews: latest SRS state per (user_id, vocabulary_id) pair
#   — ease_factor REAL [1.3..3.0], interval_days INT, lapse_count INT.
# - Auto-stacks (All / Recent / Needs review) are virtual; total stack
#   count comes from flashcard_stacks (manual stacks only).


def _fc_compute_activity_stats() -> dict:
    """Total counts: manual stacks, cards in stacks, active reviewers, lifetime reviews."""
    stacks_res = (
        supabase_admin.table("flashcard_stacks")
        .select("id", count="exact")
        .limit(0)
        .execute()
    )
    cards_res = (
        supabase_admin.table("flashcard_cards")
        .select("id", count="exact")
        .limit(0)
        .execute()
    )

    # Unique reviewers + lifetime review count come from the same select so
    # we don't double-pull the table.
    reviews_res = (
        supabase_admin.table("flashcard_reviews")
        .select("user_id, review_count")
        .execute()
    )
    rows = reviews_res.data or []
    unique_users = len({r["user_id"] for r in rows if r.get("user_id")})
    total_reviews = sum(int(r.get("review_count") or 0) for r in rows)

    return {
        "total_manual_stacks":            int(stacks_res.count or 0),
        "total_cards_in_manual_stacks":   int(cards_res.count or 0),
        "total_active_users":             unique_users,
        "total_reviews_all_time":         total_reviews,
    }


def _fc_compute_srs_health(cutoff_iso: str) -> dict:
    """Rating distribution (last `days`), avg ease factor, mastery counts."""
    log_res = (
        supabase_admin.table("flashcard_review_log")
        .select("rating")
        .gte("reviewed_at", cutoff_iso)
        .execute()
    )
    ratings = [r["rating"] for r in (log_res.data or []) if r.get("rating")]
    total = len(ratings)

    if total == 0:
        rating_dist = {"again": 0.0, "hard": 0.0, "good": 0.0, "easy": 0.0}
    else:
        from collections import Counter as _Counter
        c = _Counter(ratings)
        # Round each separately, then absorb rounding drift in the largest
        # bucket so the four percentages always sum to exactly 100.0.
        raw = {k: (c.get(k, 0) / total) * 100 for k in ("again", "hard", "good", "easy")}
        rating_dist = {k: round(v, 1) for k, v in raw.items()}
        drift = round(100.0 - sum(rating_dist.values()), 1)
        if drift:
            biggest = max(rating_dist, key=rating_dist.get)
            rating_dist[biggest] = round(rating_dist[biggest] + drift, 1)

    reviews_res = (
        supabase_admin.table("flashcard_reviews")
        .select("ease_factor, interval_days, lapse_count")
        .execute()
    )
    reviews_data = reviews_res.data or []
    if reviews_data:
        avg_ease = round(
            sum(float(r.get("ease_factor") or 0) for r in reviews_data) / len(reviews_data),
            2,
        )
        cards_mastered = sum(1 for r in reviews_data if (r.get("interval_days") or 0) > 30)
        cards_lapsed = sum(1 for r in reviews_data if (r.get("lapse_count") or 0) > 0)
    else:
        avg_ease = 0.0
        cards_mastered = 0
        cards_lapsed = 0

    return {
        "rating_distribution_percent":  rating_dist,
        "rating_total_count":           total,
        "avg_ease_factor":              avg_ease,
        "cards_mastered_30plus_days":   cards_mastered,
        "cards_with_lapses":            cards_lapsed,
    }


def _fc_compute_engagement_stats(cutoff_iso: str) -> dict:
    """Avg reviews/user (last 7d), avg DAU (over period), top-10 reviewed words."""
    from collections import Counter as _Counter, defaultdict as _defaultdict

    log_res = (
        supabase_admin.table("flashcard_review_log")
        .select("user_id, vocabulary_id, reviewed_at")
        .gte("reviewed_at", cutoff_iso)
        .execute()
    )
    log_data = log_res.data or []

    week_ago_iso = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    week_logs = [l for l in log_data if (l.get("reviewed_at") or "") >= week_ago_iso]
    week_users = {l["user_id"] for l in week_logs if l.get("user_id")}
    avg_reviews_per_user = (
        round(len(week_logs) / len(week_users), 1) if week_users else 0.0
    )

    # Daily Active Users averaged across the period.  defaultdict(set) so
    # one user reviewing twice on the same day still counts as 1 DAU that day.
    dau_map: dict[str, set[str]] = _defaultdict(set)
    for log in log_data:
        ts = log.get("reviewed_at") or ""
        uid = log.get("user_id")
        if ts and uid:
            dau_map[ts[:10]].add(uid)
    avg_dau = (
        round(sum(len(u) for u in dau_map.values()) / len(dau_map), 1) if dau_map else 0.0
    )

    # Top 10 most-reviewed vocab in the period.
    word_counts = _Counter(l["vocabulary_id"] for l in log_data if l.get("vocabulary_id"))
    top_pairs = word_counts.most_common(10)
    top_vocab_ids = [vid for vid, _ in top_pairs]

    if top_vocab_ids:
        try:
            vocab_res = (
                supabase_admin.table("user_vocabulary")
                .select("id, headword")
                .in_("id", top_vocab_ids)
                .execute()
            )
            vocab_map = {v["id"]: v.get("headword") for v in (vocab_res.data or [])}
        except Exception as exc:
            logger.warning("[admin/flashcards/stats] top-words headword lookup failed: %s", exc)
            vocab_map = {}
        top_words = [
            {"headword": vocab_map.get(vid) or "(unknown)", "review_count": cnt}
            for vid, cnt in top_pairs
        ]
    else:
        top_words = []

    return {
        "avg_reviews_per_user_last_7_days":  avg_reviews_per_user,
        "avg_dau_last_30_days":              avg_dau,
        "top_reviewed_words":                top_words,
    }


def _fc_compute_reviews_timeseries(days: int) -> list[dict]:
    """Daily review counts over the last `days` days, including 0-count days."""
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    log_res = (
        supabase_admin.table("flashcard_review_log")
        .select("reviewed_at")
        .gte("reviewed_at", cutoff_iso)
        .execute()
    )
    from collections import defaultdict as _defaultdict
    daily_counts: dict[str, int] = _defaultdict(int)
    for log in (log_res.data or []):
        ts = log.get("reviewed_at") or ""
        if ts:
            daily_counts[ts[:10]] += 1

    today = datetime.now(timezone.utc).date()
    series: list[dict] = []
    for i in range(days, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        series.append({"date": d, "reviews": int(daily_counts.get(d, 0))})
    return series


@router.get("/flashcards/stats")
async def admin_flashcard_stats(
    days: int = Query(default=30, ge=1, le=90),
    authorization: str | None = Header(default=None),
):
    """Aggregate flashcard usage metrics for the admin dashboard."""
    await require_admin(authorization)

    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    return {
        "stats": {
            "activity":   _fc_compute_activity_stats(),
            "srs_health": _fc_compute_srs_health(cutoff_iso),
            "engagement": _fc_compute_engagement_stats(cutoff_iso),
            "timeseries": _fc_compute_reviews_timeseries(days),
        },
        "period_days":  days,
        "computed_at":  datetime.now(timezone.utc).isoformat(),
    }


# ── Sprint 12.6 — admin curation for user_d1_questions ─────────────────────────
#
# Sprint 10.5 introduced `user_d1_questions` (personalized D1 fill-blank
# pre-generated from each user's vocab bank via Claude Haiku). Until now
# there was no admin tool to inspect, edit, or soft-delete these — only
# the user's own RLS-scoped queries reached them. Sprint 12.6 ships read /
# patch / soft-delete using the service-role admin client.
#
# Generated_by enum (from migration 052):
#   'haiku' | 'gemini' | 'fallback_evidence'
# `fallback_evidence` rows are the highest-priority for review — they mean
# the AI call failed and the generator reused the user's original evidence
# substring with the target word masked.


@router.get("/vocab/d1-questions")
async def admin_list_d1_questions(
    source: str | None = Query(default=None, description="filter by generated_by (haiku|gemini|fallback_evidence)"),
    active: str | None = Query(default=None, description="filter by is_active ('true'|'false'); default = all"),
    user_id: str | None = Query(default=None, description="restrict to one user's bank"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    authorization: str | None = Header(default=None),
):
    """List personalized D1 questions with filters + pagination.

    `total` is the server-side count for the active filter so the
    frontend can render "Tải thêm" when more pages remain. `items`
    carries the question payload joined against the source vocab row so
    admins can see which headword each question targets.
    """
    await require_admin(authorization)

    try:
        q = (
            supabase_admin.table("user_d1_questions")
            .select(
                "id, user_id, vocabulary_id, context_sentence, "
                "target_answer, acceptable_variants, hint, "
                "source_evidence_substring, generated_by, generated_at, "
                "is_active, attempt_count, last_used_at, created_at",
                count="exact",
            )
        )
        if source:
            q = q.eq("generated_by", source)
        if active == "true":
            q = q.eq("is_active", True)
        elif active == "false":
            q = q.eq("is_active", False)
        if user_id:
            q = q.eq("user_id", user_id)
        q = q.order("created_at", desc=True).range(offset, offset + limit - 1)
        res = q.execute()
    except Exception as exc:
        logger.error("[admin] d1 list failed: %s", exc)
        raise HTTPException(500, "Could not load D1 questions.")

    items = res.data or []

    # Hydrate with the vocab headword in one extra query — cheaper than
    # a polymorphic JOIN and the result set is bounded by `limit`.
    vocab_ids = list({i["vocabulary_id"] for i in items if i.get("vocabulary_id")})
    headword_map: dict[str, str] = {}
    if vocab_ids:
        try:
            vres = (
                supabase_admin.table("user_vocabulary")
                .select("id, headword")
                .in_("id", vocab_ids)
                .execute()
            )
            for row in vres.data or []:
                headword_map[row["id"]] = row.get("headword") or ""
        except Exception as exc:
            logger.warning("[admin] headword hydrate failed: %s", exc)

    for i in items:
        i["headword"] = headword_map.get(i.get("vocabulary_id"), "")

    return {
        "items":  items,
        "total":  res.count or 0,
        "offset": offset,
        "limit":  limit,
    }


class D1QuestionPatchPayload(BaseModel):
    context_sentence: str | None = None
    target_answer:    str | None = None
    hint:             str | None = None
    is_active:        bool | None = None


@router.patch("/vocab/d1-questions/{question_id}")
async def admin_patch_d1_question(
    question_id: str,
    payload: D1QuestionPatchPayload,
    authorization: str | None = Header(default=None),
):
    """Edit question text / answer / hint or toggle is_active.

    All fields are optional — only sent keys are written so the admin
    can flip is_active without re-sending the whole row.
    """
    await require_admin(authorization)

    update: dict = {}
    if payload.context_sentence is not None:
        update["context_sentence"] = payload.context_sentence
    if payload.target_answer is not None:
        update["target_answer"] = payload.target_answer
    if payload.hint is not None:
        update["hint"] = payload.hint
    if payload.is_active is not None:
        update["is_active"] = payload.is_active

    if not update:
        raise HTTPException(400, "No fields to update.")

    try:
        res = (
            supabase_admin.table("user_d1_questions")
            .update(update)
            .eq("id", question_id)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] D1 question update failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Không cập nhật được câu hỏi D1. Vui lòng thử lại.") from None

    if not res.data:
        raise HTTPException(404, "D1 question not found.")
    return {"ok": True, "id": question_id, "updated_fields": list(update.keys())}


@router.delete("/vocab/d1-questions/{question_id}", status_code=204)
async def admin_delete_d1_question(
    question_id: str,
    authorization: str | None = Header(default=None),
):
    """Soft-delete: flip is_active=False (Sprint 10.6 archive pattern).

    Hard deletes are intentionally not supported — the row tracks
    attempt_count + last_used_at, which is useful audit data even after
    an admin retires the question.
    """
    await require_admin(authorization)
    try:
        res = (
            supabase_admin.table("user_d1_questions")
            .update({"is_active": False})
            .eq("id", question_id)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] D1 question soft delete failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Không xoá được câu hỏi D1. Vui lòng thử lại.") from None
    if not res.data:
        raise HTTPException(404, "D1 question not found.")
    return None


# ── Sprint 12.6 — lemma override CRUD ──────────────────────────────────────────
#
# Backed by migration 063 (lemma_overrides table) + the lemmatizer hook
# in services/lemmatizer.py. After every mutation we call
# reload_overrides() so the running worker picks up the change without
# a restart.


@router.get("/vocab/lemmas/overrides")
async def admin_list_lemma_overrides(
    search: str | None = Query(default=None, description="prefix-match on original_word"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    authorization: str | None = Header(default=None),
):
    """List manual lemma overrides with optional search."""
    await require_admin(authorization)

    try:
        q = (
            supabase_admin.table("lemma_overrides")
            .select("id, original_word, lemma, pos_tag, notes, created_at",
                    count="exact")
        )
        if search:
            q = q.ilike("original_word", f"{search.strip().lower()}%")
        q = q.order("created_at", desc=True).range(offset, offset + limit - 1)
        res = q.execute()
    except Exception as exc:
        logger.error("[admin] lemma overrides list failed: %s", exc)
        raise HTTPException(500, "Could not load overrides.")

    return {
        "items":  res.data or [],
        "total":  res.count or 0,
        "offset": offset,
        "limit":  limit,
    }


class LemmaOverridePayload(BaseModel):
    original_word: str = Field(..., min_length=1, max_length=200)
    lemma:         str = Field(..., min_length=1, max_length=200)
    pos_tag:       str | None = None
    notes:         str | None = None


@router.post("/vocab/lemmas/overrides", status_code=201)
async def admin_create_lemma_override(
    payload: LemmaOverridePayload,
    authorization: str | None = Header(default=None),
):
    """Create a new lemma override. Lowercases the original_word so
    the lemmatize() lookup (which also lowercases) always hits."""
    user = await require_admin(authorization)

    insert = {
        "original_word": payload.original_word.strip().lower(),
        "lemma":         payload.lemma.strip(),
        "pos_tag":       (payload.pos_tag or "").strip() or None,
        "notes":         (payload.notes or "").strip() or None,
        "created_by":    user.get("id") if isinstance(user, dict) else None,
    }

    try:
        res = (
            supabase_admin.table("lemma_overrides")
            .insert(insert)
            .execute()
        )
    except Exception as exc:
        msg = str(exc)
        if "duplicate" in msg.lower() or "unique" in msg.lower():
            raise HTTPException(409, f"Override for '{clip_user_value(insert['original_word'])}' already exists.")
        logger.error("[admin] lemma override create failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Không tạo được lemma override. Vui lòng thử lại.") from None

    try:
        from services.lemmatizer import reload_overrides
        reload_overrides()
    except Exception as exc:
        logger.warning("[admin] reload_overrides failed: %s", exc)

    row = (res.data or [None])[0]
    return {"ok": True, "item": row}


@router.delete("/vocab/lemmas/overrides/{override_id}", status_code=204)
async def admin_delete_lemma_override(
    override_id: str,
    authorization: str | None = Header(default=None),
):
    """Hard-delete an override. The lemmatizer falls back to spaCy on
    the next capture for that word, which is the desired behaviour
    when an admin retracts a manual mapping."""
    await require_admin(authorization)

    try:
        res = (
            supabase_admin.table("lemma_overrides")
            .delete()
            .eq("id", override_id)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] lemma override delete failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Không xoá được lemma override. Vui lòng thử lại.") from None

    if not res.data:
        raise HTTPException(404, "Override not found.")

    try:
        from services.lemmatizer import reload_overrides
        reload_overrides()
    except Exception as exc:
        logger.warning("[admin] reload_overrides failed: %s", exc)
    return None


# ── Sprint 12.7 — Grammar admin (hybrid file-based pattern) ────────────────────
#
# Grammar articles live as Markdown files under
# `backend/content/<category>/<slug>.md` (Discovery #73 inventory). They are
# loaded into memory at startup via services.grammar_content.GrammarContentService
# and served read-only via /api/grammar/*. Andy authors articles in repo + git
# (NOT via admin form), so this surface is intentionally read-only:
#
#   - GET /admin/grammar/articles   — list with file metadata + DB analytics
#   - GET /admin/grammar/analytics  — aggregate views/saves + zero-view list
#   - POST /admin/grammar/recommend-test — preview find_best_match() on a
#     synthetic issue string (dogfood the recommendation router before users
#     see it).
#
# No write endpoints. No `.md` upload. No DB-backed article CRUD. The
# commit-triggers-Vercel-deploy workflow already gives Andy a "publish"
# pipeline.


GRAMMAR_ARTICLE_METRIC_PAGE = 1000


def _grammar_article_metric_rows(table: str, columns: str, slugs: list[str]) -> list[dict]:
    """Read every metric row for the requested slugs.

    PostgREST caps bare selects, so a single response cannot prove a metric is
    complete. Keyset paging on the immutable primary key avoids offset drift
    while rows are inserted or saves are removed. Any page failure aborts the
    source instead of returning a partial total labelled complete.
    """
    if not slugs:
        return []

    rows: list[dict] = []
    cursor_id: str | None = None
    while True:
        query = (
            supabase_admin.table(table)
            .select(f"id,{columns}")
            .in_("article_slug", slugs)
            .order("id")
            .limit(GRAMMAR_ARTICLE_METRIC_PAGE)
        )
        if cursor_id is not None:
            query = query.gt("id", cursor_id)
        batch = (
            query
            .execute()
            .data
            or []
        )
        rows.extend(batch)
        if len(batch) < GRAMMAR_ARTICLE_METRIC_PAGE:
            return rows
        next_id = batch[-1].get("id")
        if not next_id or next_id == cursor_id:
            raise RuntimeError(f"{table} pagination cursor did not advance")
        cursor_id = str(next_id)


@router.get("/grammar/articles")
async def admin_list_grammar_articles(
    category: str | None = Query(default=None, description="filter to a single category slug"),
    search: str | None = Query(default=None, description="case-insensitive substring on title"),
    authorization: str | None = Header(default=None),
):
    """List all grammar articles with view + save counts.

    Source-of-truth: the in-memory `grammar_service.articles_by_slug`
    (loaded from `backend/content/<category>/<slug>.md`). View/save
    counts come from `article_views` and `saved_articles` aggregated
    per slug.

    Filtering happens client-side over the small (<200 row) result set
    so we don't have to thread a SQL WHERE clause through the
    grammar_service in-memory layout.
    """
    await require_admin(authorization)

    try:
        from services.grammar_content import grammar_service
    except Exception as exc:
        logger.error("[admin] grammar service import failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Dịch vụ ngữ pháp tạm thời không khả dụng. Vui lòng thử lại.") from None

    all_articles = list((grammar_service.articles_by_slug or {}).values())
    categories = sorted({a.get("category") for a in all_articles if a.get("category")})
    articles = all_articles

    if category:
        articles = [a for a in articles if a.get("category") == category]
    if search:
        needle = search.strip().lower()
        articles = [a for a in articles
                    if needle in (a.get("title") or "").lower()
                    or needle in (a.get("slug") or "").lower()]

    # Collect slugs we need to hydrate with analytics counts.
    slugs = [a["slug"] for a in articles if a.get("slug")]

    view_count: dict[str, int] = {}
    save_count: dict[str, int] = {}
    analytics_status = {"views": "complete", "saves": "complete"}
    if slugs:
        try:
            for row in _grammar_article_metric_rows(
                "article_views", "article_slug,view_count", slugs
            ):
                s = row.get("article_slug")
                if not s:
                    continue
                view_count[s] = view_count.get(s, 0) + int(row.get("view_count") or 0)
        except Exception as exc:
            logger.warning("[admin] grammar view aggregate failed: %s", exc)
            analytics_status["views"] = "unavailable"
        try:
            for row in _grammar_article_metric_rows(
                "saved_articles", "article_slug", slugs
            ):
                s = row.get("article_slug")
                if not s:
                    continue
                save_count[s] = save_count.get(s, 0) + 1
        except Exception as exc:
            logger.warning("[admin] grammar save aggregate failed: %s", exc)
            analytics_status["saves"] = "unavailable"

    items = []
    for a in articles:
        slug = a.get("slug") or ""
        items.append({
            "slug":          slug,
            "title":         a.get("title"),
            "category":      a.get("category"),
            "summary":       a.get("summary"),
            "band":          a.get("band"),
            "order":         a.get("order"),
            "tags":          a.get("tags") or [],
            "view_count":    view_count.get(slug, 0) if analytics_status["views"] == "complete" else None,
            "save_count":    save_count.get(slug, 0) if analytics_status["saves"] == "complete" else None,
            "source_path":   f"backend/content/{a.get('category', '')}/{slug}.md",
        })

    items.sort(key=lambda r: (r.get("category") or "", r.get("order") or 999, r.get("title") or ""))

    return {
        "items":      items,
        "total":      len(items),
        "available_total": len(all_articles),
        "categories": categories,
        "analytics_status": analytics_status,
    }


@router.get("/grammar/articles/{slug}/preview", response_model=GrammarArticleDocument)
async def admin_preview_grammar_article(
    slug: str,
    authorization: str | None = Header(default=None),
):
    """Return the full rendered article (HTML body + TOC + frontmatter)
    so the admin browser can show an inline preview without leaving
    /pages/admin/grammar/articles.html."""
    await require_admin(authorization)

    try:
        from services.grammar_content import grammar_service
    except Exception as exc:
        logger.error("[admin] grammar service import failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Dịch vụ ngữ pháp tạm thời không khả dụng. Vui lòng thử lại.") from None

    summary = grammar_service.get_article_by_slug(slug)
    if not summary:
        raise HTTPException(404, f"Article '{clip_user_value(slug)}' not found")
    article = grammar_service.get_article(summary["category"], slug)
    if not article:
        raise HTTPException(404, f"Article '{clip_user_value(slug)}' not found")
    return article


@router.get("/grammar/analytics")
async def admin_grammar_analytics(
    days: int = Query(default=7, ge=1, le=90),
    authorization: str | None = Header(default=None),
):
    """Aggregate views + saves for the admin grammar analytics page.

    Returns:
      - views_total              (sum of view_count across article_views)
      - active_view_records_recent (user/article records active in the window)
      - saves_total              (count of saved_articles rows)
      - top_viewed[]             (top 20 by total views)
      - top_saved[]              (top 5 by save count)
      - zero_view_slugs[]        (article slugs with NO view rows — content gap)
      - articles_total           (total .md files loaded)
      - days                     (window used for views_recent)
    """
    await require_admin(authorization)

    try:
        from services.grammar_content import grammar_service
    except Exception as exc:
        logger.error("[admin] grammar service import failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Dịch vụ ngữ pháp tạm thời không khả dụng. Vui lòng thử lại.") from None

    all_slugs = set((grammar_service.articles_by_slug or {}).keys())
    title_by_slug = {
        s: (a.get("title") or s)
        for s, a in (grammar_service.articles_by_slug or {}).items()
    }
    cat_by_slug = {
        s: (a.get("category") or "")
        for s, a in (grammar_service.articles_by_slug or {}).items()
    }

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    views_per_slug: dict[str, int] = {}
    active_view_records_recent = 0
    analytics_status = {
        "views": "complete",
        "recent_activity": "complete",
        "saves": "complete",
    }
    try:
        view_rows = _grammar_article_metric_rows(
            "article_views", "article_slug,view_count,last_viewed_at", list(all_slugs)
        )
        for row in view_rows:
            s = row.get("article_slug")
            if not s:
                continue
            raw_count = row.get("view_count")
            if raw_count is None:
                raise ValueError("article_views.view_count is null")
            n = int(raw_count)
            if n < 0:
                raise ValueError("article_views.view_count is negative")
            views_per_slug[s] = views_per_slug.get(s, 0) + n
            last = row.get("last_viewed_at")
            if not last:
                analytics_status["recent_activity"] = "unavailable"
                continue
            try:
                viewed_at = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
                if viewed_at.tzinfo is None:
                    viewed_at = viewed_at.replace(tzinfo=timezone.utc)
                if viewed_at >= cutoff:
                    active_view_records_recent += 1
            except (TypeError, ValueError):
                analytics_status["recent_activity"] = "unavailable"
    except Exception as exc:
        logger.warning("[admin] grammar views fetch failed: %s", exc)
        analytics_status["views"] = "unavailable"
        analytics_status["recent_activity"] = "unavailable"

    saves_per_slug: dict[str, int] = {}
    try:
        for row in _grammar_article_metric_rows(
            "saved_articles", "article_slug", list(all_slugs)
        ):
            s = row.get("article_slug")
            if not s:
                continue
            saves_per_slug[s] = saves_per_slug.get(s, 0) + 1
    except Exception as exc:
        logger.warning("[admin] grammar saves fetch failed: %s", exc)
        analytics_status["saves"] = "unavailable"

    def _decorate(slug: str, count: int) -> dict:
        return {
            "slug":     slug,
            "title":    title_by_slug.get(slug, slug),
            "category": cat_by_slug.get(slug, ""),
            "count":    count,
        }

    top_viewed = sorted(views_per_slug.items(), key=lambda kv: (-kv[1], kv[0]))[:20]
    top_saved = sorted(saves_per_slug.items(), key=lambda kv: (-kv[1], kv[0]))[:5]

    seen_slugs = set(views_per_slug.keys())
    zero_view_slugs = sorted(all_slugs - seen_slugs)[:30]
    views_available = analytics_status["views"] == "complete"
    saves_available = analytics_status["saves"] == "complete"
    recent_available = analytics_status["recent_activity"] == "complete"

    return {
        "views_total":      sum(views_per_slug.values()) if views_available else None,
        "active_view_records_recent": active_view_records_recent if recent_available else None,
        "saves_total":      sum(saves_per_slug.values()) if saves_available else None,
        "articles_total":   len(all_slugs),
        "top_viewed":       [_decorate(s, c) for s, c in top_viewed] if views_available else None,
        "top_saved":        [_decorate(s, c) for s, c in top_saved] if saves_available else None,
        "zero_view_slugs":  [_decorate(s, 0) for s in zero_view_slugs] if views_available else None,
        "zero_view_total":  len(all_slugs - seen_slugs) if views_available else None,
        "days":             days,
        "analytics_status": analytics_status,
        "recent_activity_basis": "user_article_records_with_last_viewed_at_in_window",
    }


class GrammarRecommendPayload(BaseModel):
    issue: str = Field(..., min_length=1, max_length=2000)


@router.post("/grammar/recommend-test")
async def admin_grammar_recommend_test(
    payload: GrammarRecommendPayload,
    authorization: str | None = Header(default=None),
):
    """Dogfood tool — run the live grammar recommendation matcher
    against a synthetic issue string.

    Wraps `services.grammar_content.grammar_service.find_best_match()` —
    the same function that powers the post-grading recommendation
    surface. Returns the matched article + the matcher's score so Andy
    can preview quality before users see it.
    """
    await require_admin(authorization)

    try:
        from services.grammar_content import grammar_service
    except Exception as exc:
        logger.error("[admin] grammar service import failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Dịch vụ ngữ pháp tạm thời không khả dụng. Vui lòng thử lại.") from None

    issue = payload.issue.strip()
    if not issue:
        raise HTTPException(400, "issue must be non-empty")

    match = grammar_service.find_best_match(issue)
    if not match:
        return {"issue": issue, "outcome": "below_threshold", "match": None, "candidate": None}

    slug = match.get("slug")
    full = grammar_service.get_article_by_slug(slug or "")
    if not slug or not full:
        raise HTTPException(500, "matcher returned an article that is not in the canonical content index")
    category = full.get("category") or match.get("category")
    title = full.get("title") or match.get("title")
    score = match.get("score")
    if (
        not category
        or not title
        or isinstance(score, bool)
        or not isinstance(score, (int, float))
        or not math.isfinite(score)
        or score < 0
        or score > 1
    ):
        raise HTTPException(500, "matcher returned an incomplete recommendation contract")
    anchor = grammar_service.find_best_anchor(issue, slug)
    url = f"/grammar/{quote(str(category), safe='')}/{quote(str(slug), safe='')}"
    if anchor:
        url += f"#{quote(str(anchor), safe='')}"
    candidate = {
        "slug": slug,
        "category": category,
        "title": title,
        "score": score,
        "summary": full.get("summary"),
        "anchor": anchor,
        "status": full.get("status") or "complete",
        "url": url,
    }
    if candidate["status"] == "draft":
        return {
            "issue": issue,
            "outcome": "draft_suppressed",
            "match": None,
            "candidate": candidate,
        }
    return {
        "issue": issue,
        "outcome": "matched",
        "match": candidate,
        "candidate": candidate,
    }


_SUBMODULES = (_common, users_stats, access_codes, access_code_admin, topics, ai_usage, sessions)


class _SeamModule(_types.ModuleType):
    """Patch trên routers.admin lan xuống mọi module con đang giữ cùng tên,
    để monkeypatch/mock.patch tiếp tục tác dụng lên mã đã dời (BACKENDSPLIT-0076 FR-002/FR-005).
    Không đổi hành vi chạy thật: mã sản phẩm không setattr lên package."""

    def __setattr__(self, name, value):
        holders = [sub for sub in _SUBMODULES if name in vars(sub)]
        if holders and name not in vars(self):
            raise AttributeError(
                f"routers.admin.{name} is defined in {holders[0].__name__} but not re-exported")
        super().__setattr__(name, value)
        for sub in holders:
            vars(sub)[name] = value

    def __delattr__(self, name):
        holders = [sub.__name__ for sub in _SUBMODULES if name in vars(sub)]
        if holders:
            raise TypeError("cannot delete a routers.admin name that a submodule also binds; "
                            "patch the value instead", name, holders)
        super().__delattr__(name)


_sys.modules[__name__].__class__ = _SeamModule
