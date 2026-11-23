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


from . import vocab  # noqa: E402 — BACKENDSPLIT-0076: vocab monitor, enrichment backfill, flashcards, D1 curation and lemma overrides
_reexport(vocab)


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


_SUBMODULES = (_common, users_stats, access_codes, access_code_admin, topics, ai_usage, sessions, vocab)


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
