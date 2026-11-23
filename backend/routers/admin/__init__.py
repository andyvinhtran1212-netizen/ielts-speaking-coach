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


# ── GET /admin/topics ──────────────────────────────────────────────────────────

@router.get("/topics")
async def list_topics(authorization: str | None = Header(default=None)):
    await require_admin(authorization)

    try:
        res = (
            supabase_admin.table("topics")
            .select("*")
            .order("part")
            .order("title")
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] list topics failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải topics. Vui lòng thử lại.") from None

    return _serialize_topics_with_metadata(res.data or [])


# ── POST /admin/topics ─────────────────────────────────────────────────────────

@router.post("/topics", status_code=201)
async def create_topic(
    body: CreateTopicRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    title = body.title.strip()
    if not title:
        raise HTTPException(400, "Tên topic không được để trống")

    try:
        res = (
            supabase_admin.table("topics")
            .insert({
                "title":     title,
                "category":  (body.category or "").strip(),
                "part":      body.part,
                "is_active": body.is_active,
            })
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] create topic failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tạo topic. Vui lòng thử lại.") from None

    return _serialize_topics_with_metadata(res.data or [])[0]


# ── PATCH /admin/topics/{topic_id} ────────────────────────────────────────────

@router.patch("/topics/{topic_id}")
async def patch_topic(
    topic_id: str,
    body: PatchTopicRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)

    update: dict = {}
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(400, "Tên topic không được để trống")
        update["title"] = title
    if body.category  is not None: update["category"]  = body.category.strip()
    if body.part      is not None: update["part"]       = body.part
    if body.is_active is not None: update["is_active"]  = body.is_active

    if not update:
        raise HTTPException(400, "Không có trường nào để cập nhật")

    try:
        res = (
            supabase_admin.table("topics")
            .update(update)
            .eq("id", topic_id)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] update topic failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi cập nhật topic. Vui lòng thử lại.") from None

    if not res.data:
        raise HTTPException(404, "Topic không tồn tại")

    return _serialize_topics_with_metadata(res.data or [])[0]


# ── DELETE /admin/topics/{topic_id} ───────────────────────────────────────────

@router.delete("/topics/{topic_id}", status_code=204)
async def delete_topic(
    topic_id: str,
    authorization: str | None = Header(default=None),
):
    """Hard-delete a topic and its library questions (cascade via FK)."""
    await require_admin(authorization)
    try:
        supabase_admin.table("topics").delete().eq("id", topic_id).execute()
        remaining = (
            supabase_admin.table("topics")
            .select("id")
            .eq("id", topic_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] delete topic failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi xóa topic. Vui lòng thử lại.") from None
    if remaining.data:
        raise HTTPException(500, "Topic chưa được xóa hoàn tất")


@router.post("/topics/bulk-delete")
async def bulk_delete_topics(
    body: BulkTopicIdsRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)

    topic_ids = _uniq_topic_ids(body.topic_ids)
    if not topic_ids:
        raise HTTPException(400, "Không có topic IDs hợp lệ")

    try:
        existing = (
            supabase_admin.table("topics")
            .select("id, title")
            .in_("id", topic_ids)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] load topics for bulk delete failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải topics. Vui lòng thử lại.") from None

    existing_rows = existing.data or []
    title_by_id = {row["id"]: (row.get("title") or row["id"]) for row in existing_rows if row.get("id")}
    existing_ids = [row["id"] for row in existing_rows if row.get("id")]
    missing_ids = [topic_id for topic_id in topic_ids if topic_id not in existing_ids]
    errors = [
        {
            "topic_id": topic_id,
            "topic_title": None,
            "message": "Topic không tồn tại",
            "code": "not_found",
        }
        for topic_id in missing_ids
    ]

    deleted_ids: list[str] = []
    failed_ids = list(missing_ids)

    if existing_ids:
        try:
            supabase_admin.table("topics").delete().in_("id", existing_ids).execute()
            remaining = (
                supabase_admin.table("topics")
                .select("id")
                .in_("id", existing_ids)
                .execute()
            )
            remaining_ids = {row["id"] for row in (remaining.data or []) if row.get("id")}
            deleted_ids = [topic_id for topic_id in existing_ids if topic_id not in remaining_ids]
            undeleted_ids = [topic_id for topic_id in existing_ids if topic_id in remaining_ids]
            failed_ids.extend(undeleted_ids)
            errors.extend([
                {
                    "topic_id": topic_id,
                    "topic_title": title_by_id.get(topic_id),
                    "message": "Topic chưa được xóa hoàn tất",
                    "code": "delete_not_confirmed",
                }
                for topic_id in undeleted_ids
            ])
        except Exception:
            ref = new_ref()
            logger.error("[admin] bulk delete topics failed ref=%s", ref, exc_info=True)
            failed_ids.extend(existing_ids)
            errors.append({
                "topic_id": None,
                "topic_title": None,
                "message": "Không xóa được topics, vui lòng thử lại.",
                "code": "delete_failed",
                "ref": ref,
            })

    return {
        "processed_count": len(topic_ids),
        "deleted_count": len(deleted_ids),
        "deleted_ids": deleted_ids,
        "failed_ids": failed_ids,
        "errors": errors,
        "delete_semantics": "Deleting a topic hard-deletes the topic and cascades to all of its library questions.",
    }


# ── POST /admin/topics/bulk ────────────────────────────────────────────────────

@router.post("/topics/bulk", status_code=201)
async def bulk_add_topics(
    body: BulkAddTopicsRequest,
    authorization: str | None = Header(default=None),
):
    """
    Thêm hàng loạt topics cho một Part.
    Body: { part: 1|2|3, lines: "Topic A\\nTopic B\\nTopic C" }
    """
    await require_admin(authorization)

    titles = [l.strip() for l in body.lines.splitlines() if l.strip()]
    if not titles:
        raise HTTPException(400, "Không có dòng nào hợp lệ")

    rows = [{"title": t, "category": "", "part": body.part, "is_active": True} for t in titles]
    try:
        res = supabase_admin.table("topics").insert(rows).execute()
    except Exception as exc:
        logger.error("[admin] bulk add topics failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi thêm topics. Vui lòng thử lại.") from None

    topics = _serialize_topics_with_metadata(res.data or [])
    created_count = len(topics)
    return {
        "created": created_count,
        "created_count": created_count,
        "topics": topics,
    }


# ── GET /admin/topics/{topic_id}/questions ─────────────────────────────────────

@router.get("/topics/{topic_id}/questions")
async def list_topic_questions(
    topic_id: str,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    try:
        res = (
            supabase_admin.table("topic_questions")
            .select("*")
            .eq("topic_id", topic_id)
            .eq("is_active", True)
            .order("part")
            .order("order_num")
            .execute()
        )
        rows = res.data or []
        if not rows:
            return rows
        topic = (supabase_admin.table("topics")
                 .select("title").eq("id", topic_id).limit(1).execute()).data or []
        if not topic:
            raise HTTPException(404, "Topic không tồn tại")
        title = topic[0]["title"]
        return [{**row, "audio_ready": (
            speaking_audio.audio_matches_question(row, title)
            if row.get("part") in speaking_audio.AUDIO_PARTS else False)}
                for row in rows]
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[admin] list topic questions failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải questions. Vui lòng thử lại.") from None


# ── POST /admin/topics/{topic_id}/questions ────────────────────────────────────

@router.post("/topics/{topic_id}/questions", status_code=201)
async def create_topic_question(
    topic_id: str,
    body: CreateTopicQuestionRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    question_text = body.question_text.strip()
    if not question_text:
        raise HTTPException(400, "Câu hỏi không được để trống")

    # Auto order_num if not provided
    order = body.order_num
    if order == 0:
        try:
            cnt = (
                supabase_admin.table("topic_questions")
                .select("id", count="exact")
                .eq("topic_id", topic_id)
                .eq("part", body.part)
                .eq("is_active", True)
                .execute()
            )
            order = (cnt.count or 0) + 1
        except Exception as exc:
            logger.error("[admin] count topic questions for order failed: %s", exc, exc_info=True)
            raise HTTPException(500, "Không xác định được thứ tự câu hỏi. Vui lòng thử lại.") from None

    cue_card_bullets = [item.strip() for item in (body.cue_card_bullets or []) if item.strip()] or None
    cue_card_reflection = (body.cue_card_reflection or "").strip() or None
    if body.part != 2:
        cue_card_bullets = None
        cue_card_reflection = None

    row = {
        "topic_id":            topic_id,
        "part":                body.part,
        "order_num":           order,
        "question_text":       question_text,
        "question_type":       body.question_type.strip(),
        "cue_card_bullets":    cue_card_bullets,
        "cue_card_reflection": cue_card_reflection,
    }
    try:
        res = supabase_admin.table("topic_questions").insert(row).execute()
    except Exception as exc:
        logger.error("[admin] create topic question failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tạo question. Vui lòng thử lại.") from None
    _touch_topic(topic_id)
    return res.data[0]


# ── PATCH /admin/topics/{topic_id}/questions/{question_id} ────────────────────

@router.patch("/topics/{topic_id}/questions/{question_id}")
async def update_topic_question(
    topic_id: str,
    question_id: str,
    body: UpdateTopicQuestionRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)

    try:
        current_res = (
            supabase_admin.table("topic_questions")
            .select("id, part, question_text, cue_card_bullets, cue_card_reflection")
            .eq("id", question_id)
            .eq("topic_id", topic_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] load topic question failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải question hiện tại. Vui lòng thử lại.") from None
    if not current_res.data:
        raise HTTPException(404, "Question không tồn tại")
    current = current_res.data[0]

    if not body.model_fields_set:
        raise HTTPException(400, "Không có trường nào để cập nhật")

    update: dict = {}
    part_changed = body.part is not None and body.part != current.get("part")
    if body.part                is not None: update["part"]                = body.part
    if body.question_text is not None:
        question_text = body.question_text.strip()
        if not question_text:
            raise HTTPException(400, "Câu hỏi không được để trống")
        update["question_text"] = question_text
        # ĐỔI LỜI CÂU HỎI THÌ BẢN ĐỌC CŨ HẾT GIÁ TRỊ. Không xoá thì audio vẫn đọc
        # đề CŨ trong khi bộ chấm đọc đề MỚI: học viên trả lời cái mình nghe rồi
        # bị chấm theo một câu khác — nhận xét sai mà không ai truy ra được vì
        # hai bên đều "có dữ liệu".
        #
        # Xoá chứ không render lại tại đây: render mất vài giây và endpoint này
        # là một lần bấm Lưu của admin. Xoá làm câu đó lập tức KHÔNG giao được
        # (backend chặn), và mẻ render sau sẽ dựng lại.
        if question_text != (current.get("question_text") or "").strip():
            update["audio_url"] = None
            update["audio_path"] = None
    # Part là một phần của script TTS (lời dẫn/cấu trúc cue-card khác nhau), nên
    # giữ audio cũ sau khi chuyển Part cũng nguy hiểm như giữ audio của lời cũ.
    if part_changed:
        update["audio_url"] = None
        update["audio_path"] = None
    if body.question_type       is not None: update["question_type"]       = body.question_type.strip()
    if body.order_num           is not None: update["order_num"]           = body.order_num
    effective_part = body.part if body.part is not None else current.get("part")
    if effective_part != 2:
        update["cue_card_bullets"] = None
        update["cue_card_reflection"] = None
    else:
        if "cue_card_bullets" in body.model_fields_set:
            update["cue_card_bullets"] = [item.strip() for item in (body.cue_card_bullets or []) if item.strip()] or None
        if "cue_card_reflection" in body.model_fields_set:
            update["cue_card_reflection"] = (body.cue_card_reflection or "").strip() or None

    if not update:
        raise HTTPException(400, "Không có trường nào để cập nhật")

    try:
        res = (
            supabase_admin.table("topic_questions")
            .update(update)
            .eq("id", question_id)
            .eq("topic_id", topic_id)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] update topic question failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi cập nhật question. Vui lòng thử lại.") from None

    if not res.data:
        raise HTTPException(404, "Question không tồn tại")
    _touch_topic(topic_id)
    return res.data[0]


# ── DELETE /admin/topics/{topic_id}/questions/{question_id} ───────────────────

@router.post("/topics/{topic_id}/questions/{question_id}/render-audio")
async def render_topic_question_audio(
    topic_id: str,
    question_id: str,
    authorization: str | None = Header(default=None),
):
    """Make one Part 1/3 bank question assignable after an editorial review.

    Rendering runs off the event loop. Recheck the topic title and conditionally
    update the question so an edit during synthesis cannot attach stale audio.
    """
    await require_admin(authorization)
    try:
        topic_rows = (supabase_admin.table("topics").select("id, title")
                      .eq("id", topic_id).limit(1).execute().data or [])
        question_rows = (supabase_admin.table("topic_questions")
                         .select("id, topic_id, part, question_text, is_active")
                         .eq("id", question_id).eq("topic_id", topic_id)
                         .limit(1).execute().data or [])
    except Exception as exc:
        logger.error("[admin] render question audio lookup failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Không đọc được câu hỏi. Vui lòng thử lại.") from None
    if not topic_rows or not question_rows:
        raise HTTPException(404, "Topic hoặc câu hỏi không tồn tại")
    question = dict(question_rows[0])
    if question.get("is_active") is not True or question.get("part") not in (1, 3):
        raise HTTPException(400, "Chỉ tạo audio cho câu Part 1/3 đang bật")
    topic_title = topic_rows[0]["title"]
    try:
        audio = await run_in_threadpool(
            speaking_audio.render_question_audio, question, topic_title,
            engine=speaking_audio.ADMIN_ENGINE, voice=speaking_audio.ADMIN_VOICE,
        )
        current_topic_rows = (supabase_admin.table("topics").select("id, title")
                              .eq("id", topic_id).limit(1).execute().data or [])
    except Exception as exc:
        logger.error("[admin] render question audio failed: %s", exc, exc_info=True)
        raise HTTPException(502, "Không tạo được audio. Vui lòng thử lại.") from None
    if not current_topic_rows or current_topic_rows[0]["title"] != topic_title:
        raise HTTPException(409, "Tên topic đã đổi trong lúc tạo audio; tải lại rồi thử lại")
    try:
        updated = (supabase_admin.table("topic_questions")
                   .update({"audio_url": audio["audio_url"], "audio_path": audio["audio_path"]})
                   .eq("id", question_id).eq("topic_id", topic_id)
                   .eq("part", question["part"])
                   .eq("question_text", question["question_text"])
                   .eq("is_active", True).execute().data or [])
    except Exception as exc:
        logger.error("[admin] render question audio save failed: %s", exc, exc_info=True)
        raise HTTPException(502, "Không tạo được audio. Vui lòng thử lại.") from None
    if not updated:
        raise HTTPException(409, "Câu hỏi đã đổi trong lúc tạo audio; tải lại rồi thử lại")
    return {"id": question_id, "topic_id": topic_id,
            "audio_ready": True, "synthesized": audio["synthesized"]}


@router.delete("/topics/{topic_id}/questions/{question_id}", status_code=204)
async def delete_topic_question(
    topic_id: str,
    question_id: str,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    try:
        supabase_admin.table("topic_questions").delete().eq("id", question_id).eq("topic_id", topic_id).execute()
        remaining = (
            supabase_admin.table("topic_questions")
            .select("id")
            .eq("id", question_id)
            .eq("topic_id", topic_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] delete topic question failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi xóa question. Vui lòng thử lại.") from None
    if remaining.data:
        raise HTTPException(500, "Question chưa được xóa hoàn tất")
    _touch_topic(topic_id)


# ── POST /admin/topics/{topic_id}/generate-questions ──────────────────────────

@router.post("/topics/{topic_id}/generate-questions")
async def generate_topic_questions(
    topic_id: str,
    body: GenerateTopicQuestionsRequest | None = None,
    authorization: str | None = Header(default=None),
):
    """
    Generate questions for a topic.
    - mode=missing_only: only create when the topic has no questions yet.
    - mode=replace_all: delete current questions, then generate a fresh set.
    """
    auth_user = await require_admin(authorization)
    mode = (body.mode if body else "missing_only").strip().lower()
    if mode not in {"missing_only", "replace_all"}:
        raise HTTPException(400, "mode phải là missing_only hoặc replace_all")

    return await _generate_questions_for_topic(
        topic_id,
        auth_user["id"],
        replace_existing=(mode == "replace_all"),
    )


@router.post("/topics/{topic_id}/rotate-questions")
async def rotate_topic_questions(
    topic_id: str,
    authorization: str | None = Header(default=None),
):
    auth_user = await require_admin(authorization)
    return await _generate_questions_for_topic(
        topic_id,
        auth_user["id"],
        replace_existing=True,
    )


@router.post("/topics/bulk-generate-questions")
async def bulk_generate_topic_questions(
    body: BulkGenerateTopicsRequest,
    authorization: str | None = Header(default=None),
):
    auth_user = await require_admin(authorization)

    topic_ids = _uniq_topic_ids(body.topic_ids)
    if not topic_ids:
        raise HTTPException(400, "Không có topic IDs hợp lệ")

    mode = (body.mode or "missing_only").strip().lower()
    if mode not in {"missing_only", "replace_all"}:
        raise HTTPException(400, "mode phải là missing_only hoặc replace_all")

    title_by_id: dict[str, str | None] = {}
    try:
        t_res = (
            supabase_admin.table("topics")
            .select("id, title")
            .in_("id", topic_ids)
            .execute()
        )
        title_by_id = {
            row["id"]: row.get("title")
            for row in (t_res.data or [])
            if row.get("id")
        }
    except Exception:
        logger.warning("[admin.topics] failed to load topic titles for bulk action", exc_info=True)

    success_ids: list[str] = []
    failed_ids: list[str] = []
    errors: list[dict] = []

    for topic_id in topic_ids:
        try:
            await _generate_questions_for_topic(
                topic_id,
                auth_user["id"],
                replace_existing=(mode == "replace_all"),
            )
            success_ids.append(topic_id)
        except HTTPException as exc:
            failed_ids.append(topic_id)
            errors.append({
                "topic_id": topic_id,
                "topic_title": title_by_id.get(topic_id),
                "message": exc.detail,
                "code": "already_has_questions" if exc.status_code == 409 else "request_failed",
                "status_code": exc.status_code,
            })
        except Exception as exc:
            failed_ids.append(topic_id)
            errors.append({
                "topic_id": topic_id,
                "topic_title": title_by_id.get(topic_id),
                "message": str(exc),
                "code": "unexpected_error",
                "status_code": 500,
            })

    return {
        "processed_count": len(topic_ids),
        "success_count": len(success_ids),
        "success_ids": success_ids,
        "failed_ids": failed_ids,
        "errors": errors,
        "mode": mode,
        "semantics": (
            "Generate creates questions only for topics that do not already have any library questions."
            if mode == "missing_only"
            else "Rotate replaces the current library questions with a fresh generated set."
        ),
    }


@router.post("/topics/bulk-rotate-questions")
async def bulk_rotate_topic_questions(
    body: BulkTopicIdsRequest,
    authorization: str | None = Header(default=None),
):
    # ADMINAAL2-0032 — guard before building the delegated request.
    await require_admin(authorization)
    return await bulk_generate_topic_questions(
        BulkGenerateTopicsRequest(topic_ids=body.topic_ids, mode="replace_all"),
        authorization=authorization,
    )


# ── GET /admin/ai-usage ────────────────────────────────────────────────────────

@router.get("/ai-usage")
async def get_ai_usage(
    days: int | None = None,
    authorization: str | None = Header(default=None),
):
    """
    Per-account AI usage summary with cost estimates.

    Query param:
        days=N   — restrict to the last N days (default: all time)

    Returns:
        {
            "overall":  { calls, cost_usd, by_service: {service: {calls, cost_usd}} },
            "per_user": [ {user_id, email, display_name, calls, cost_usd, by_service} ]
        }
    """
    await require_admin(authorization)

    usage_columns = (
        "user_id, service, model, input_tokens, output_tokens, thinking_tokens, "
        "cache_read_tokens, cache_write_tokens, audio_seconds, text_chars, "
        "cost_usd_est, cost_source, status, error_code, feature, resource_type, resource_id, "
        "pricing_version, usage_event_id, created_at"
    )
    legacy_usage_columns = (
        "user_id, service, model, input_tokens, output_tokens, "
        "cache_read_tokens, cache_write_tokens, audio_seconds, text_chars, "
        "cost_usd_est, created_at"
    )
    cutoff = None

    def _usage_query(columns: str):
        built = (
            supabase_admin.table("ai_usage_logs")
            .select(columns, count="exact")
            .order("created_at", desc=True)
            .limit(10_000)
        )
        return built.gte("created_at", cutoff) if cutoff else built

    if days is not None:
        cutoff = (
            datetime.now(timezone.utc) - timedelta(days=days)
        ).isoformat()
    query = _usage_query(usage_columns)

    ledger_schema_legacy = False
    try:
        res = query.execute()
    except Exception as exc:
        if not ai_usage_logger.is_legacy_schema_error(exc):
            logger.error("[admin] AI usage load failed: %s", exc, exc_info=True)
            raise HTTPException(500, "Lỗi khi tải AI usage. Vui lòng thử lại.") from None
        try:
            res = _usage_query(legacy_usage_columns).execute()
            ledger_schema_legacy = True
        except Exception as fallback_exc:
            logger.error("[admin] AI usage load failed: %s", exc, exc_info=exc)
            logger.error("[admin] AI usage legacy fallback failed: %s", fallback_exc, exc_info=True)
            raise HTTPException(500, "Lỗi khi tải AI usage. Vui lòng thử lại.") from None

    logs = res.data or []
    total_matching = res.count if isinstance(res.count, int) else None
    capped_limit = 10_000
    ledger_returned_rows = len(logs)
    ledger_truncated = bool(
        total_matching is not None and total_matching > ledger_returned_rows
    )

    # Historical Writing usage lived only in writing_feedback. Merge it at read
    # time (no history mutation) unless the same essay already has canonical
    # ledger rows from the new per-call instrumentation.
    writing_lookup_failed = False
    supplemental_writing_rows = 0
    writing_source_returned_rows = 0
    writing_source_total_rows: int | None = None
    writing_source_truncated = False
    ledger_writing_first_seen: dict[str, str] = {}
    ledger_writing_cost_by_job: dict[str, float] = {}
    for row in logs:
        if row.get("feature") != "writing_grading" or not row.get("resource_id"):
            continue
        essay_id = str(row["resource_id"])
        created_at = row.get("created_at")
        current = ledger_writing_first_seen.get(essay_id)
        if created_at and (current is None or created_at < current):
            ledger_writing_first_seen[essay_id] = created_at
    try:
        wq = (
            # GV-1a SPEND-analytics exception: dashboard spend includes every
            # feedback version; current-only would understate provider cost.
            supabase_admin.table("writing_feedback")
            .select("id, essay_id, model_used, tokens_input, tokens_output, "
                    "cost_usd, grading_duration_ms, provenance, created_at", count="exact")
            .order("created_at", desc=True)
            .limit(capped_limit)
        )
        if days is not None:
            wq = wq.gte("created_at", cutoff)
        writing_res = wq.execute()
        writing_rows = writing_res.data or []
        writing_source_returned_rows = len(writing_rows)
        writing_source_total_rows = (
            writing_res.count if isinstance(writing_res.count, int) else None
        )
        writing_source_truncated = bool(
            writing_source_total_rows is not None
            and writing_source_total_rows > writing_source_returned_rows
        )
        # The dashboard list above is deliberately capped. Dedupe cannot use
        # that partial list: query canonical Writing ledger rows separately for
        # every candidate essay, with keyset pagination, so truncation cannot
        # turn overlapping feedback into double-counted spend.
        candidate_essay_ids = list({
            str(row["essay_id"]) for row in writing_rows if row.get("essay_id")
        })
        if not ledger_schema_legacy:
            for essay_chunk in _usage_id_chunks(candidate_essay_ids):
                ledger_rows = _usage_paged(
                    lambda essay_chunk=essay_chunk: supabase_admin.table("ai_usage_logs")
                    .select("id, service, model, input_tokens, output_tokens, "
                            "thinking_tokens, cache_read_tokens, cache_write_tokens, "
                            "audio_seconds, text_chars, cost_usd_est, pricing_version, "
                            "resource_id, usage_event_id, created_at")
                    .eq("feature", "writing_grading")
                    .in_("resource_id", essay_chunk)
                )
                for ledger_row in ledger_rows:
                    if job_id := _writing_job_id(ledger_row.get("usage_event_id")):
                        ledger_cost, _ = effective_logged_cost(ledger_row)
                        ledger_writing_cost_by_job[job_id] = (
                            ledger_writing_cost_by_job.get(job_id, 0.0)
                            + float(ledger_cost or 0)
                        )
                    essay_id = str(ledger_row.get("resource_id") or "")
                    created_at = ledger_row.get("created_at")
                    current = ledger_writing_first_seen.get(essay_id)
                    if essay_id and created_at and (current is None or created_at < current):
                        ledger_writing_first_seen[essay_id] = created_at
        reconciled_writing_rows: list[tuple[dict, float]] = []
        for row in writing_rows:
            essay_id = str(row.get("essay_id") or "")
            if (
                not str(row.get("model_used") or "").startswith("gemini-")
                or not ((row.get("tokens_input") or 0) > 0
                        or (row.get("tokens_output") or 0) > 0)
            ):
                continue
            supplemental_cost = _writing_feedback_supplemental_cost(
                row,
                ledger_cost_by_job=ledger_writing_cost_by_job,
                ledger_first_seen=ledger_writing_first_seen.get(essay_id),
            )
            if supplemental_cost > 0:
                reconciled_writing_rows.append((row, supplemental_cost))
        writing_rows = [row for row, _ in reconciled_writing_rows]
        essay_ids = list({str(row["essay_id"]) for row in writing_rows if row.get("essay_id")})
        essay_student_map: dict[str, str] = {}
        for essay_chunk in _usage_id_chunks(essay_ids):
            er = (
                supabase_admin.table("writing_essays")
                .select("id, student_id")
                .in_("id", essay_chunk)
                .execute()
            )
            essay_student_map.update({
                str(row["id"]): str(row["student_id"])
                for row in (er.data or []) if row.get("id") and row.get("student_id")
            })
        student_ids = list(set(essay_student_map.values()))
        student_user_map: dict[str, str | None] = {}
        for student_chunk in _usage_id_chunks(student_ids):
            sr = (
                supabase_admin.table("students")
                .select("id, user_id")
                .in_("id", student_chunk)
                .execute()
            )
            student_user_map.update({
                str(row["id"]): row.get("user_id") for row in (sr.data or [])
                if row.get("id")
            })
        for row, supplemental_cost in reconciled_writing_rows:
            essay_id = str(row.get("essay_id") or "")
            student_id = essay_student_map.get(essay_id)
            provenance = row.get("provenance")
            job_id = provenance.get("job_id") if isinstance(provenance, dict) else None
            logs.append({
                "user_id": student_user_map.get(student_id or ""),
                "service": "gemini",
                "model": row.get("model_used"),
                "input_tokens": row.get("tokens_input"),
                "output_tokens": row.get("tokens_output"),
                "thinking_tokens": None,
                "cost_usd_est": supplemental_cost,
                "cost_source": (
                    "writing_feedback_reconciliation"
                    if job_id and ledger_writing_cost_by_job.get(str(job_id), 0) > 0
                    else "writing_feedback_legacy"
                ),
                "pricing_version": (
                    "writing_feedback:legacy"
                    if row.get("cost_usd") is not None else None
                ),
                "status": "success",
                "feature": "writing_grading",
                "resource_type": "writing_essay",
                "resource_id": essay_id,
                "created_at": row.get("created_at"),
            })
        supplemental_writing_rows = len(reconciled_writing_rows)
    except Exception as exc:
        writing_lookup_failed = True
        logger.warning("[admin ai-usage] historical Writing merge failed: %s", exc)

    truncated = ledger_truncated or writing_source_truncated
    combined_total = (
        total_matching + supplemental_writing_rows
        if total_matching is not None and not writing_source_truncated
        else None
    )

    # Enrich with user info
    user_ids = list({l["user_id"] for l in logs if l.get("user_id")})
    user_map: dict[str, dict] = {}
    if user_ids:
        try:
            ur = (
                supabase_admin.table("users")
                .select("id, email, display_name")
                .in_("id", user_ids)
                .execute()
            )
            for u in (ur.data or []):
                user_map[u["id"]] = {
                    "email":        u.get("email", ""),
                    "display_name": u.get("display_name", ""),
                }
        except Exception:
            pass

    # Aggregate
    overall: dict = {
        "calls": 0,
        "priced_calls": 0,
        "unpriced_calls": 0,
        "failed_calls": 0,
        "legacy_repriced_calls": 0,
        "cost_usd": 0.0,
        "by_service": {},
    }
    per_user: dict[str, dict] = {}

    for log in logs:
        uid  = log.get("user_id") or "unknown"
        svc  = log.get("service", "unknown")
        effective_cost, effective_price_version = effective_logged_cost(log)
        cost = float(effective_cost or 0.0)
        is_priced = effective_cost is not None
        if effective_price_version and not log.get("pricing_version"):
            overall["legacy_repriced_calls"] += 1

        # Overall
        overall["calls"] += 1
        is_success = log.get("status") in (None, "success")
        if is_priced:
            overall["priced_calls"] += 1
        elif is_success:
            overall["unpriced_calls"] += 1
        if not is_success:
            overall["failed_calls"] += 1
        overall["cost_usd"] = round(overall["cost_usd"] + cost, 6)
        if svc not in overall["by_service"]:
            overall["by_service"][svc] = {
                "calls": 0, "priced_calls": 0, "unpriced_calls": 0,
                "cost_usd": 0.0,
            }
        overall["by_service"][svc]["calls"] += 1
        if is_priced:
            overall["by_service"][svc]["priced_calls"] += 1
        elif is_success:
            overall["by_service"][svc]["unpriced_calls"] += 1
        overall["by_service"][svc]["cost_usd"] = round(
            overall["by_service"][svc]["cost_usd"] + cost, 6
        )

        # Per user
        if uid not in per_user:
            info = user_map.get(uid, {})
            per_user[uid] = {
                "user_id":      uid,
                "email":        info.get("email", ""),
                "display_name": info.get("display_name", ""),
                "calls":        0,
                "cost_usd":     0.0,
                "by_service":   {},
            }
        per_user[uid]["calls"] += 1
        per_user[uid]["cost_usd"] = round(per_user[uid]["cost_usd"] + cost, 6)
        if svc not in per_user[uid]["by_service"]:
            per_user[uid]["by_service"][svc] = {"calls": 0, "cost_usd": 0.0}
        per_user[uid]["by_service"][svc]["calls"] += 1
        per_user[uid]["by_service"][svc]["cost_usd"] = round(
            per_user[uid]["by_service"][svc]["cost_usd"] + cost, 6
        )

    return {
        "overall":  overall,
        "per_user": sorted(per_user.values(), key=lambda x: x["cost_usd"], reverse=True),
        "meta": {
            "query_limit": capped_limit,
            "returned_rows": len(logs),
            "total_matching_rows": combined_total,
            "truncated": truncated,
            "ledger_returned_rows": ledger_returned_rows,
            "ledger_total_matching_rows": total_matching,
            "ledger_truncated": ledger_truncated,
            "ledger_schema_legacy": ledger_schema_legacy,
            "supplemental_writing_rows": supplemental_writing_rows,
            "writing_source_returned_rows": writing_source_returned_rows,
            "writing_source_total_rows": writing_source_total_rows,
            "writing_source_truncated": writing_source_truncated,
            "writing_lookup_failed": writing_lookup_failed,
        },
    }


# ── GET /admin/sessions ────────────────────────────────────────────────────────

@router.get("/sessions", response_model=list[AdminSpeakingSessionRow])
async def admin_list_sessions(
    authorization: str | None = Header(default=None),
    user_id:    str | None = None,
    user_email: str | None = None,
    mode:       str | None = None,
    status:     str | None = None,
    error_code: str | None = None,
    has_error:  bool | None = None,
    date_from:  str | None = None,  # ISO date string, e.g. "2024-01-01"
    date_to:    str | None = None,
    limit:      int = 50,
    offset:     int = 0,
):
    """
    List all sessions across users (admin only).
    Supports filtering by user_id or exact user_email, mode, status,
    error_code, has_error, date range.
    Returns sessions enriched with user email.
    """
    await require_admin(authorization)

    # Resolve an exact email on the server. Fetching the whole user directory in
    # the browser is incomplete once PostgREST applies its row cap. A lookup
    # outage must fail visibly instead of looking like zero matching sessions.
    if not user_id and user_email and user_email.strip():
        try:
            matches = (
                supabase_admin.table("users")
                .select("id")
                .eq("email", user_email.strip().lower())
                .limit(2)
                .execute()
            ).data or []
        except Exception as exc:
            logger.error("[admin] session email lookup failed: %s", exc, exc_info=True)
            raise HTTPException(500, "Lỗi khi tra email học viên. Vui lòng thử lại.") from None
        if len(matches) > 1:
            raise HTTPException(409, "Có nhiều tài khoản dùng email này; hãy lọc bằng User ID.")
        if not matches:
            return []
        user_id = matches[0].get("id")
        if not user_id:
            raise HTTPException(500, "Kết quả tra email học viên không có User ID.")

    q = (
        supabase_admin.table("sessions")
        .select(
            "id, user_id, mode, part, topic, status, started_at, completed_at, "
            "overall_band, band_fc, band_lr, band_gra, band_p, "
            "error_code, error_message, failed_step, last_error_at, pdf_status"
        )
        .order("started_at", desc=True)
        .order("id", desc=True)
        .range(offset, offset + limit - 1)
    )

    if user_id:    q = q.eq("user_id", user_id)
    if mode:       q = q.eq("mode", mode)
    if status:     q = q.eq("status", status)
    if error_code: q = q.eq("error_code", error_code)
    if has_error is True:
        q = q.filter("error_code", "not.is", "null")
    elif has_error is False:
        q = q.is_("error_code", "null")
    if date_from:  q = q.gte("started_at", date_from)
    if date_to:
        try:
            next_day = (datetime.strptime(date_to, "%Y-%m-%d") + timedelta(days=1)).date().isoformat()
        except ValueError:
            raise HTTPException(400, "date_to phải theo định dạng YYYY-MM-DD")
        # Exclusive next-day bound includes timestamps with fractional seconds.
        q = q.lt("started_at", next_day)

    try:
        res = q.execute()
    except Exception as exc:
        logger.error("[admin] list sessions failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải sessions. Vui lòng thử lại.") from None

    sessions = res.data or []

    # Enrich with user email
    uids = list({s["user_id"] for s in sessions if s.get("user_id")})
    email_map: dict[str, str] = {}
    user_lookup_failed = False
    if uids:
        try:
            ur = (
                supabase_admin.table("users")
                .select("id, email, display_name")
                .in_("id", uids)
                .execute()
            )
            for u in (ur.data or []):
                email_map[u["id"]] = u.get("email") or ""
        except Exception:
            user_lookup_failed = True

    for s in sessions:
        s["user_email"] = email_map.get(s.get("user_id") or "", "")
        # An empty email and a failed enrichment query are different truths.
        # The admin UI must not present an outage as "this user has no email".
        s["user_lookup_failed"] = user_lookup_failed

    return sessions


# ── GET /admin/sessions/{session_id} ──────────────────────────────────────────

@router.get("/sessions/{session_id}", response_model=AdminSpeakingSessionDetail)
async def admin_get_session(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Full session detail for admin: session row + questions + responses.
    Does NOT enforce user_id ownership — admin can see any session.
    """
    await require_admin(authorization)

    # Session row
    try:
        s_res = (
            supabase_admin.table("sessions")
            .select("*")
            .eq("id", session_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.error("[admin] get session failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải session. Vui lòng thử lại.") from None

    if not s_res.data:
        raise HTTPException(404, "Session không tồn tại")

    session = s_res.data[0]

    # A full-test session is only one part of the canonical attempt. Resolve the
    # other parts server-side instead of relying on non-existent p2/p3 columns
    # on the selected row. Keep the lookup scoped to the same user as a second
    # guard against ever exposing another learner's session ID.
    session["p1_session_id"] = None
    session["p2_session_id"] = None
    session["p3_session_id"] = None
    session["full_test_siblings_lookup_failed"] = False
    if session.get("mode") == "test_full" and session.get("full_test_attempt_id"):
        try:
            siblings_query = (
                supabase_admin.table("sessions")
                .select("id, user_id, mode, part, full_test_attempt_id")
                .eq("full_test_attempt_id", session["full_test_attempt_id"])
                .eq("mode", "test_full")
            )
            if not session.get("user_id"):
                raise ValueError("full-test session has no user_id")
            siblings_query = siblings_query.eq("user_id", session["user_id"])
            sibling_rows = siblings_query.execute().data or []
            ids_by_part: dict[int, str] = {}
            duplicate_part = False
            for sibling in sibling_rows:
                part = sibling.get("part")
                sibling_id = sibling.get("id")
                if part not in (1, 2, 3) or not sibling_id:
                    continue
                if part in ids_by_part and ids_by_part[part] != sibling_id:
                    duplicate_part = True
                    continue
                ids_by_part[part] = sibling_id
            if duplicate_part:
                session["full_test_siblings_lookup_failed"] = True
            else:
                session["p1_session_id"] = ids_by_part.get(1)
                session["p2_session_id"] = ids_by_part.get(2)
                session["p3_session_id"] = ids_by_part.get(3)
        except Exception:
            session["full_test_siblings_lookup_failed"] = True

    # Enrich with user email
    uid = session.get("user_id")
    session["user_email"] = ""
    session["user_lookup_failed"] = False
    if uid:
        try:
            ur = (
                supabase_admin.table("users")
                .select("email, display_name")
                .eq("id", uid)
                .limit(1)
                .execute()
            )
            if ur.data:
                session["user_email"]        = ur.data[0].get("email") or ""
                session["user_display_name"] = ur.data[0].get("display_name") or ""
        except Exception:
            session["user_lookup_failed"] = True

    # Questions
    try:
        q_res = (
            supabase_admin.table("questions")
            .select("*")
            .eq("session_id", session_id)
            .order("order_num")
            .execute()
        )
        questions = q_res.data or []
    except Exception:
        questions = []
        session["questions_lookup_failed"] = True
    else:
        session["questions_lookup_failed"] = False

    # Responses (includes transcript, feedback, band scores, status fields)
    try:
        r_res = (
            supabase_admin.table("responses")
            .select(
                "id, question_id, transcript, overall_band, feedback, "
                "audio_url, audio_storage_path, grading_status, stt_status"
            )
            .eq("session_id", session_id)
            .execute()
        )
        responses = r_res.data or []
    except Exception:
        responses = []
        session["responses_lookup_failed"] = True
    else:
        session["responses_lookup_failed"] = False

    await attach_playback_urls(supabase_admin, responses)

    return {
        **session,
        "session_id": session["id"],
        "questions":  questions,
        "responses":  responses,
    }


# ── GET /admin/alerts ──────────────────────────────────────────────────────────

@router.get("/alerts")
async def admin_get_alerts(
    authorization: str | None = Header(default=None),
    limit: int = 30,
):
    """
    Return recently failed sessions and responses for the admin alert panel.
    Groups into session-level errors (stt_failed, etc.) and response-level
    grading failures.
    """
    await require_admin(authorization)

    # Session-level errors (last `limit` sessions with error_code set)
    try:
        se_res = (
            supabase_admin.table("sessions")
            .select(
                "id, user_id, mode, part, topic, error_code, error_message, "
                "failed_step, last_error_at, started_at, status"
            )
            .or_("error_code.not.is.null,status.eq.grading_failed")
            .order("last_error_at", desc=True)
            .order("started_at", desc=True)
            .order("id", desc=True)
            .limit(limit)
            .execute()
        )
        session_errors = se_res.data or []
    except Exception as exc:
        logger.error("[admin] alerts session errors load failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải session errors. Vui lòng thử lại.") from None

    for session_error in session_errors:
        if not session_error.get("error_code") and session_error.get("status") == "grading_failed":
            session_error["error_code"] = "grading_failed"
            session_error["error_message"] = session_error.get("error_message") or "Session ở trạng thái degraded sau admin regrade."
            session_error["failed_step"] = session_error.get("failed_step") or "admin_regrade_session"

    # Response-level grading failures (last `limit` rows)
    try:
        re_res = (
            supabase_admin.table("responses")
            .select("id, session_id, question_id, grading_status, stt_status")
            .eq("grading_status", "failed")
            .limit(limit)
            .execute()
        )
        grading_failures = re_res.data or []
    except Exception as exc:
        logger.error("[admin] alerts grading failures load failed: %s", exc, exc_info=True)
        raise HTTPException(500, "Lỗi khi tải grading failures. Vui lòng thử lại.") from None

    # Enrich both lists with user email (collect all user_ids at once)
    session_error_ids = {s.get("user_id") for s in session_errors if s.get("user_id")}
    grading_session_ids = {r.get("session_id") for r in grading_failures if r.get("session_id")}

    # For grading failures we need to look up session → user_id
    user_id_for_session: dict[str, str] = {}
    if grading_session_ids:
        try:
            gs_res = (
                supabase_admin.table("sessions")
                .select("id, user_id")
                .in_("id", list(grading_session_ids))
                .execute()
            )
            for row in (gs_res.data or []):
                user_id_for_session[row["id"]] = row.get("user_id") or ""
        except Exception:
            pass

    all_user_ids = session_error_ids | set(user_id_for_session.values())
    email_map: dict[str, str] = {}
    if all_user_ids:
        try:
            ur = (
                supabase_admin.table("users")
                .select("id, email")
                .in_("id", list(all_user_ids))
                .execute()
            )
            for u in (ur.data or []):
                email_map[u["id"]] = u.get("email") or ""
        except Exception:
            pass

    for s in session_errors:
        s["user_email"] = email_map.get(s.get("user_id") or "", "")

    for r in grading_failures:
        uid = user_id_for_session.get(r.get("session_id") or "", "")
        r["user_email"] = email_map.get(uid, "")

    # Exclude sessions that are already in session_errors to avoid duplication
    session_error_ids_set = {s["id"] for s in session_errors}
    grading_failures = [r for r in grading_failures if r.get("session_id") not in session_error_ids_set]

    return {
        "session_errors":   session_errors,
        "grading_failures": grading_failures,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# REGRADE FLOW
# ═══════════════════════════════════════════════════════════════════════════════

_REGRADE_AUDIO_BUCKET = "audio-responses"


def _regrade_round_band(v: float) -> float:
    rounded = math.floor(v * 2 + 0.5) / 2
    return max(1.0, min(9.0, rounded))


def _reattach_pronunciation_for_regrade(grading: dict, response_id: str, mode: str) -> None:
    """Audit 2026-07-02 (P1) — re-attach the audio-measured pronunciation band to
    a regraded response, in place. The grader no longer scores pronunciation
    (Azure does, during the original grade); a regrade only re-scores FC/LR/GRA,
    but the audio is unchanged so the persisted Azure score is still valid. Best-
    effort; test mode only (practice has no P criterion). No-op when the response
    was never assessed (old rows) → band_p stays absent → honest "chưa đánh giá"."""
    if mode == "practice":
        return
    try:
        from routers.grading import _pron_band_from_scores
        row = (
            supabase_admin.table("responses")
            .select("pronunciation_score, pronunciation_fluency, feedback")
            .eq("id", response_id)
            .limit(1)
            .execute()
        )
        r = (row.data or [{}])[0]
        band_p = _pron_band_from_scores(r.get("pronunciation_score"), r.get("pronunciation_fluency"))
        if band_p is None:
            return
        grading["band_p"] = band_p
        grading["pronunciation_source"] = "azure"
        # Carry over the original Azure pronunciation feedback text if stored.
        old_fb = r.get("feedback")
        if old_fb:
            try:
                fb = json.loads(old_fb) if isinstance(old_fb, str) else old_fb
                if isinstance(fb, dict) and fb.get("p_feedback"):
                    grading["p_feedback"] = fb["p_feedback"]
            except (json.JSONDecodeError, TypeError):
                pass
    except Exception as ex:  # noqa: BLE001 — never block a regrade
        logger.warning("[regrade] pronunciation reattach failed (non-fatal): %s", ex)


def _regrade_apply_heuristic_caps(grading: dict, word_count: int, part: int) -> dict:
    """Mirror of grading.py _apply_heuristic_caps — keeps regrade calibration consistent."""
    grading = dict(grading)
    thresholds      = {1: (3, 5, 40), 2: (3, 5, 100), 3: (4, 5, 50)}
    very_short_lims = {1: 15, 2: 40, 3: 20}
    short_lims      = {1: 40, 2: 100, 3: 50}
    very_short_cap, short_cap, _ = thresholds.get(part, (3, 5, 40))
    vt = very_short_lims.get(part, 15)
    st = short_lims.get(part, 40)
    fc = grading.get("band_fc")
    if fc is not None:
        if word_count < vt and fc > very_short_cap:
            grading["band_fc"] = float(very_short_cap)
            for k in ("band_lr", "band_gra"):
                if grading.get(k) is not None and grading[k] > 5:
                    grading[k] = 5.0
        elif word_count < st and fc > short_cap:
            grading["band_fc"] = float(short_cap)
    crit = [float(grading[k]) for k in ("band_fc", "band_lr", "band_gra", "band_p") if grading.get(k) is not None]
    if crit:
        grading["overall_band"] = _regrade_round_band(sum(crit) / len(crit))
    return grading


def _regrade_compute_session_bands(session_id: str) -> dict:
    """
    Read all response feedback for a session, compute aggregate band scores.
    Returns dict with overall_band, band_fc/lr/gra/p (or None if missing data).

    Canonical P precedence: use final_band_p (pronunciation-adjusted) when set,
    fall back to feedback.band_p. After a regrade, final_band_p is cleared on the
    regraded response so the fresh AI grade is used directly.
    """
    r_res = (
        supabase_admin.table("responses")
        .select("overall_band, final_band_p, feedback")
        .eq("session_id", session_id)
        .execute()
    )
    responses = r_res.data or []
    fc_v, lr_v, gra_v, p_v, r_bands = [], [], [], [], []
    for r in responses:
        ob = r.get("overall_band")
        if ob is not None:
            r_bands.append(float(ob))
        raw = r.get("feedback")
        if not raw:
            continue
        try:
            fb = json.loads(raw) if isinstance(raw, str) else raw
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(fb, dict):
            continue
        for lst, key in ((fc_v, "band_fc"), (lr_v, "band_lr"), (gra_v, "band_gra")):
            v = fb.get(key)
            if v is not None:
                try:
                    lst.append(float(v))
                except (TypeError, ValueError):
                    pass
        # P criterion: pronunciation-adjusted when available, else raw AI grade
        final_p = r.get("final_band_p")
        if final_p is not None:
            p_v.append(float(final_p))
        else:
            v = fb.get("band_p")
            if v is not None:
                try:
                    p_v.append(float(v))
                except (TypeError, ValueError):
                    pass
    band_fc  = _regrade_round_band(sum(fc_v)  / len(fc_v))  if fc_v  else None
    band_lr  = _regrade_round_band(sum(lr_v)  / len(lr_v))  if lr_v  else None
    band_gra = _regrade_round_band(sum(gra_v) / len(gra_v)) if gra_v else None
    band_p   = _regrade_round_band(sum(p_v)   / len(p_v))   if p_v   else None
    crit = [b for b in [band_fc, band_lr, band_gra, band_p] if b is not None]
    overall = (
        _regrade_round_band(sum(crit) / len(crit)) if crit
        else (_regrade_round_band(sum(r_bands) / len(r_bands)) if r_bands else None)
    )
    return {"overall_band": overall, "band_fc": band_fc, "band_lr": band_lr, "band_gra": band_gra, "band_p": band_p}


def _regrade_incomplete_response_ids(session_id: str) -> list[str]:
    """Return persisted or missing responses that prevent canonical completion."""
    question_result = (
        supabase_admin.table("questions")
        .select("id")
        .eq("session_id", session_id)
        .execute()
    )
    response_result = (
        supabase_admin.table("responses")
        .select("id, question_id, grading_status, overall_band")
        .eq("session_id", session_id)
        .execute()
    )
    responses = response_result.data or []
    question_ids = {row.get("id") for row in (question_result.data or []) if row.get("id")}
    incomplete = [
        row.get("id") or "unknown"
        for row in responses
        if row.get("grading_status") == "failed" or row.get("overall_band") is None
    ]
    answered_question_ids = {row.get("question_id") for row in responses if row.get("question_id")}
    incomplete.extend(
        f"question:{question_id}:missing_response"
        for question_id in (row.get("id") for row in (question_result.data or []))
        if question_id and question_id not in answered_question_ids
    )
    incomplete.extend(
        f"response:{row.get('id') or 'unknown'}:unknown_question"
        for row in responses
        if not row.get("question_id") or row.get("question_id") not in question_ids
    )
    return list(dict.fromkeys(incomplete))


async def _run_regrade_response(
    resp: dict,
    session: dict,
    question_text: str,
    admin_email: str,
) -> dict:
    """
    Core regrade logic for one response dict already loaded from DB.
    Returns {overall_band, re_transcribed, error}.
    Raises HTTPException on non-recoverable errors.
    """
    part     = session["part"]
    mode     = session.get("mode", "practice") or "practice"
    user_id  = session["user_id"]
    response_id = resp["id"]

    transcript = (resp.get("transcript") or "").strip()
    word_count = len(transcript.split()) if transcript else 0
    re_transcribed = False

    if word_count < 3:
        # Try re-transcribing from stored audio
        audio_path = recording_path(resp)
        if not audio_path:
            raise HTTPException(422, f"Response {response_id}: không có transcript và không có audio path")
        try:
            audio_bytes = await asyncio.to_thread(
                supabase_admin.storage.from_(_REGRADE_AUDIO_BUCKET).download,
                audio_path,
            )
        except Exception as e:
            logger.error("[admin] regrade audio download failed response=%s: %s",
                         response_id, e, exc_info=True)
            raise HTTPException(502, f"Response {response_id}: không thể tải audio. Vui lòng thử lại.") from None

        ext = ("." + audio_path.rsplit(".", 1)[-1]) if "." in audio_path else ".webm"
        stt = await transcribe_from_bytes(audio_bytes, filename=f"audio{ext}")
        transcript = stt.get("transcript", "").strip()
        ai_usage_logger.schedule_usage_log(ai_usage_logger.log_whisper_async(
            user_id=user_id,
            session_id=resp["session_id"],
            model=stt.get("transcript_model", "whisper-1"),
            audio_seconds=stt.get("duration_seconds", 0.0),
            feature="speaking_stt",
            operation="admin_retranscribe_response",
            resource_type="response",
            resource_id=response_id,
        ))
        if not transcript:
            raise HTTPException(422, f"Response {response_id}: Whisper không nhận dạng được giọng nói")
        word_count = len(transcript.split())
        re_transcribed = True

    reliability = {"reliability_label": "high", "reliability_score": 0.9}
    # S3 — the same audit trail as live grading (routers/grading.py): every
    # provider attempt, success or failure, lands in grading_events with its
    # latency. Best-effort; log_fallback_events never raises.
    fallback_events: list = []
    started = time.monotonic()
    outcome = "error"
    try:
        grading = await _claude_grade(
            question=question_text,
            transcript=transcript,
            part=part,
            mode=mode,
            user_id=user_id,
            session_id=resp["session_id"],
            reliability=reliability,
            word_count=word_count,
            fallback_events=fallback_events,
        )
        outcome = "success"
    finally:
        log_fallback_events(
            session_id=resp["session_id"],
            question_id=resp.get("question_id"),
            response_id=response_id,
            events=fallback_events,
        )
        logger.info(
            "[admin/regrade-response] graded response=%s outcome=%s latency_ms=%d attempts=%d",
            response_id, outcome, int((time.monotonic() - started) * 1000), len(fallback_events),
        )
    # Audit 2026-07-02 (P1) — the grader no longer scores pronunciation (Azure
    # measures it server-side during the original grade). A regrade re-grades
    # FC/LR/GRA only; the audio is UNCHANGED, so re-attach the previously
    # audio-measured P band instead of dropping it — otherwise result/history
    # pages and _regrade_compute_session_bands lose pronunciation after a regrade.
    _reattach_pronunciation_for_regrade(grading, response_id, mode)
    grading = _regrade_apply_heuristic_caps(grading, word_count, part)  # recomputes overall incl. P

    now = datetime.now(timezone.utc).isoformat()
    old_count = resp.get("regrade_count") or 0

    # Persist the preserved P as the canonical final_band_p so the session
    # aggregator (final_band_p precedence) keeps pronunciation. None (test mode
    # with no stored Azure score, or practice mode) → cleared, honest "chưa đánh giá".
    _preserved_p = grading.get("band_p") if mode != "practice" else None
    update: dict = {
        "feedback":           json.dumps(grading, ensure_ascii=False),
        "overall_band":       grading["overall_band"],
        "grading_status":     "completed",
        "final_band_p":       _preserved_p,
        "final_overall_band": grading["overall_band"] if _preserved_p is not None else None,
    }
    if re_transcribed:
        update["transcript"] = transcript

    # Best-effort: save regrade metadata (columns may not exist on old deployments)
    try:
        full_update = {
            **update,
            "last_regraded_at": now,
            "last_regraded_by": admin_email,
            "regrade_count":    old_count + 1,
        }
        supabase_admin.table("responses").update(full_update).eq("id", response_id).execute()
    except Exception:
        supabase_admin.table("responses").update(update).eq("id", response_id).execute()

    return {"overall_band": grading["overall_band"], "re_transcribed": re_transcribed}


# ── POST /admin/responses/{response_id}/regrade ───────────────────────────────

@router.post("/responses/{response_id}/regrade", response_model=AdminResponseRegradeResponse)
@observe_operation("speaking", "grade")
async def admin_regrade_response(
    response_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Chấm lại một response cụ thể.
    Dùng transcript hiện có (nếu đủ dài), hoặc re-transcribe từ audio nếu cần.
    """
    admin = await require_admin(authorization)
    admin_email = admin.get("email", "admin")

    # Load response
    r_res = (
        supabase_admin.table("responses")
        .select("id, session_id, question_id, transcript, audio_storage_path, audio_url, grading_status, regrade_count")
        .eq("id", response_id)
        .limit(1)
        .execute()
    )
    if not r_res.data:
        raise HTTPException(404, "Response không tồn tại")
    resp = r_res.data[0]

    # Load session
    s_res = (
        supabase_admin.table("sessions")
        .select("id, part, mode, user_id, full_test_attempt_id, renderer_affinity")
        .eq("id", resp["session_id"])
        .limit(1)
        .execute()
    )
    if not s_res.data:
        raise HTTPException(404, "Session không tồn tại")
    session = s_res.data[0]

    # Load question
    q_res = (
        supabase_admin.table("questions")
        .select("question_text")
        .eq("id", resp["question_id"])
        .limit(1)
        .execute()
    )
    if not q_res.data:
        raise HTTPException(404, "Câu hỏi không tồn tại")
    question_text = q_res.data[0]["question_text"]
    bind_owned_attempt(session)

    session_id = resp["session_id"]
    logger.info("[admin/regrade-response] response=%s session=%s by=%s", response_id, session_id, admin_email)

    result = await _run_regrade_response(resp, session, question_text, admin_email)

    # Recompute and persist session-level bands so Session History reflects the update.
    # Use the same canonical gate as complete_session(): only block if ALL band values are None.
    bands = _regrade_compute_session_bands(session_id)
    session_updated = False
    incomplete_ids = _regrade_incomplete_response_ids(session_id)
    all_band_vals = [bands.get("overall_band")] + [
        bands.get(k) for k in ("band_fc", "band_lr", "band_gra", "band_p")
    ]
    if not all(v is None for v in all_band_vals):
        now = datetime.now(timezone.utc).isoformat()
        sess_update: dict = {**bands}
        if incomplete_ids:
            sess_update.update({
                "status": "grading_failed",
                "error_code": "grading_failed",
                "error_message": f"Admin regrade còn {len(incomplete_ids)} response lỗi hoặc thiếu band.",
                "failed_step": "admin_regrade_response",
                "last_error_at": now,
            })
        else:
            sess_update.update({
                "status": "completed",
                "error_code": None,
                "error_message": None,
                "failed_step": None,
                "last_error_at": None,
            })
        try:
            supabase_admin.table("sessions").update({
                **sess_update,
                "last_regraded_at": now,
                "last_regraded_by": admin_email,
            }).eq("id", session_id).execute()
        except Exception:
            supabase_admin.table("sessions").update(sess_update).eq("id", session_id).execute()
        session_updated = not incomplete_ids
        logger.info("[admin/regrade-response] session bands updated session=%s overall_band=%s", session_id, bands["overall_band"])
        # Only a canonical-complete result may replace the class ledger score.
        if session_updated:
            sync_class_item_score(supabase_admin, session_id)

    return {
        "ok":              True,
        "response_id":     response_id,
        "session_id":      session_id,
        "overall_band":    result["overall_band"],
        "re_transcribed":  result["re_transcribed"],
        "session_updated": session_updated,
        "remaining_failed": len(incomplete_ids),
        "session_band":    bands["overall_band"],
    }


# ── POST /admin/sessions/{session_id}/regrade ─────────────────────────────────

@router.post("/sessions/{session_id}/regrade", response_model=AdminSessionRegradeResponse)
@observe_operation("speaking", "grade")
async def admin_regrade_session(
    session_id: str,
    force: bool = Query(default=False, description="force=true: regrade ALL responses; force=false (default): repair only failed/missing responses"),
    authorization: str | None = Header(default=None),
):
    """
    Repair or fully regrade a session.

    force=False (default): partial repair — only regrade responses where
      grading_status == 'failed' OR overall_band is None.
      Use this to recover from grading failures without re-running good responses.

    force=True: full regrade — regrade ALL responses regardless of current status.
      Use this when you want to apply updated grading logic to an entire session.

    In both cases, session-level bands are recomputed from all responses afterward.
    """
    admin = await require_admin(authorization)
    admin_email = admin.get("email", "admin")

    # Load session
    s_res = (
        supabase_admin.table("sessions")
        .select("id, part, mode, user_id, status, full_test_attempt_id, renderer_affinity")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )
    if not s_res.data:
        raise HTTPException(404, "Session không tồn tại")
    session = s_res.data[0]
    bind_owned_attempt(session)

    # Load questions
    q_res = (
        supabase_admin.table("questions")
        .select("id, question_text")
        .eq("session_id", session_id)
        .execute()
    )
    question_map = {q["id"]: q["question_text"] for q in (q_res.data or [])}

    # Load all responses for this session
    r_res = (
        supabase_admin.table("responses")
        .select("id, session_id, question_id, transcript, audio_storage_path, audio_url, grading_status, overall_band, regrade_count")
        .eq("session_id", session_id)
        .execute()
    )
    all_responses = r_res.data or []

    # Determine which responses need regrading
    def _needs_regrade(r: dict) -> bool:
        if force:
            return True  # full regrade — include all responses
        if r.get("grading_status") == "failed":
            return True
        if r.get("overall_band") is None:
            return True
        return False

    to_regrade = [r for r in all_responses if _needs_regrade(r)]
    skip_count = len(all_responses) - len(to_regrade)

    logger.info("[admin/regrade-session] session=%s total=%d to_regrade=%d skip=%d by=%s",
                session_id, len(all_responses), len(to_regrade), skip_count, admin_email)

    regraded, failed_ids, failed_errors = 0, [], []
    if not all_responses:
        failed_ids.append("session:no_responses")
        failed_errors.append("Session không có response để chấm hoặc tổng hợp")
    for resp in to_regrade:
        qid = resp.get("question_id")
        question_text = question_map.get(qid)
        if not question_text:
            failed_ids.append(resp["id"])
            failed_errors.append(f"{resp['id']}: question_text not found")
            continue
        try:
            await _run_regrade_response(resp, session, question_text, admin_email)
            regraded += 1
        except HTTPException as exc:
            failed_ids.append(resp["id"])
            failed_errors.append(f"{resp['id']}: {exc.detail}")
        except Exception:
            ref = new_ref()
            logger.error("[admin/regrade-session] response=%s failed ref=%s",
                         resp["id"], ref, exc_info=True)
            failed_ids.append(resp["id"])
            failed_errors.append(f"{resp['id']}: Chấm lại thất bại, vui lòng thử lại. (ref={ref})")

    # Read persisted truth back after the loop. A grader call can return without
    # producing a usable row, and a response outside the immediate exception
    # list may still be failed/missing-band. Neither repair mode may finalize
    # the session while any such row remains.
    remaining_ids = _regrade_incomplete_response_ids(session_id)
    failed_ids = list(dict.fromkeys([*failed_ids, *remaining_ids]))
    partial_failure = len(failed_ids) > 0

    # Recompute session-level bands from all responses (including already-good ones)
    bands = _regrade_compute_session_bands(session_id)
    now = datetime.now(timezone.utc).isoformat()

    if partial_failure:
        # Mark session as degraded so the admin knows it needs attention.
        # Do NOT restore status="completed" — the band scores are untrustworthy
        # because some responses kept their old scores.
        session_update: dict = {
            **bands,
            "status": "grading_failed",
            "error_code": "grading_failed",
            "error_message": (
                f"Admin regrade chỉ hoàn tất một phần: {regraded} response thành công, "
                f"{len(failed_ids)} response lỗi."
            ),
            "failed_step": "admin_regrade_session",
            "last_error_at": now,
        }
    else:
        session_update = {
            **bands,
            "status": "completed",
            "error_code": None,
            "error_message": None,
            "failed_step": None,
            "last_error_at": None,
        }

    try:
        full_sess_update = {
            **session_update,
            "last_regraded_at": now,
            "last_regraded_by": admin_email,
            "regrade_count":    ((supabase_admin.table("sessions").select("regrade_count").eq("id", session_id).limit(1).execute().data or [{}])[0].get("regrade_count") or 0) + 1,
        }
        supabase_admin.table("sessions").update(full_sess_update).eq("id", session_id).execute()
        # Only a canonical-complete result may replace the class ledger score.
        if not partial_failure:
            sync_class_item_score(supabase_admin, session_id)
    except Exception:
        supabase_admin.table("sessions").update(session_update).eq("id", session_id).execute()

    if partial_failure:
        note_operation_failure()

    return {
        "ok":               not partial_failure,
        "partial_failure":  partial_failure,
        "session_id":       session_id,
        "regraded":         regraded,
        "skipped":          skip_count,
        "failed":           len(failed_ids),
        "failed_details":   failed_errors[:5],   # cap for response size
        "overall_band":     bands["overall_band"],
        "band_fc":          bands["band_fc"],
        "band_lr":          bands["band_lr"],
        "band_gra":         bands["band_gra"],
        "band_p":           bands["band_p"],
    }


# ── POST /admin/sessions/{session_id}/rebuild-summary ─────────────────────────

@router.post("/sessions/{session_id}/rebuild-summary", response_model=AdminSummaryRebuildResponse)
@observe_operation("speaking", "finalize")
async def admin_rebuild_summary(
    session_id: str,
    p2_id: str | None = Query(default=None, description="Part 2 session ID (for test_full)"),
    p3_id: str | None = Query(default=None, description="Part 3 session ID (for test_full)"),
    authorization: str | None = Header(default=None),
):
    """
    Tổng hợp lại kết quả từ response data hiện có mà không rerun grading.
    Dùng cho full test hoặc session bị fail ở bước aggregate.
    Cập nhật overall_band / band_fc/lr/gra/p cho tất cả sessions liên quan.
    """
    admin = await require_admin(authorization)
    admin_email = admin.get("email", "admin")

    all_ids = [sid for sid in [session_id, p2_id, p3_id] if sid]

    # Verify sessions exist
    s_res = (
        supabase_admin.table("sessions")
        .select("id, user_id, mode, part, status, full_test_attempt_id, renderer_affinity")
        .in_("id", all_ids)
        .execute()
    )
    found_rows = s_res.data or []
    found_ids = {s["id"] for s in found_rows}
    missing = [sid for sid in all_ids if sid not in found_ids]
    if missing:
        raise HTTPException(404, f"Session không tồn tại: {clip_user_values(missing)}")

    # A multi-part rebuild is allowed only for one canonical Full Test. Never
    # let caller-supplied IDs aggregate unrelated learners or attempts.
    if p2_id or p3_id:
        if not p2_id or not p3_id or len(set(all_ids)) != 3:
            raise HTTPException(400, "Full Test rebuild cần ba session P1/P2/P3 khác nhau")
        rows_by_id = {row.get("id"): row for row in found_rows}
        expected = ((session_id, 1), (p2_id, 2), (p3_id, 3))
        primary = rows_by_id.get(session_id) or {}
        attempt_id = primary.get("full_test_attempt_id")
        user_id = primary.get("user_id")
        valid = bool(attempt_id and user_id)
        for sid, part in expected:
            row = rows_by_id.get(sid) or {}
            valid = valid and (
                row.get("mode") == "test_full"
                and row.get("part") == part
                and row.get("full_test_attempt_id") == attempt_id
                and row.get("user_id") == user_id
            )
        if not valid:
            raise HTTPException(409, "Ba session không thuộc cùng một Full Test canonical")

    logger.info("[admin/rebuild-summary] sessions=%s by=%s", all_ids, admin_email)
    bind_owned_attempt(next(row for row in found_rows if row["id"] == session_id))

    now = datetime.now(timezone.utc).isoformat()
    results = []

    for sid in all_ids:
        bands = _regrade_compute_session_bands(sid)
        if bands["overall_band"] is None:
            results.append({"session_id": sid, "ok": False, "error": "Không có đủ dữ liệu response để tính band"})
            continue

        incomplete_ids = _regrade_incomplete_response_ids(sid)
        if incomplete_ids:
            # Rebuild does not call AI, so it cannot repair failed/missing rows.
            # Persist the recalculated partial bands but keep the session visibly
            # degraded instead of laundering it into a completed result.
            now = datetime.now(timezone.utc).isoformat()
            supabase_admin.table("sessions").update({
                **bands,
                "status": "grading_failed",
                "error_code": "grading_failed",
                "error_message": f"Tổng hợp còn {len(incomplete_ids)} response lỗi hoặc thiếu band.",
                "failed_step": "admin_rebuild_summary",
                "last_error_at": now,
            }).eq("id", sid).execute()
            results.append({
                "session_id": sid,
                "ok": False,
                "error": f"Còn {len(incomplete_ids)} response lỗi hoặc thiếu band",
                **bands,
            })
            continue

        sess_update: dict = {
            **bands,
            "status": "completed",
            "error_code": None,
            "error_message": None,
            "failed_step": None,
            "last_error_at": None,
        }
        try:
            full_update = {
                **sess_update,
                "last_regraded_at": now,
                "last_regraded_by": admin_email,
            }
            supabase_admin.table("sessions").update(full_update).eq("id", sid).execute()
        except Exception:
            supabase_admin.table("sessions").update(sess_update).eq("id", sid).execute()

        # Rebuild is another canonical score write-path. Keep a linked class
        # assignment in step just like response/session regrade does.
        sync_class_item_score(supabase_admin, sid)

        results.append({"session_id": sid, "ok": True, **bands})

    if any(not row["ok"] for row in results):
        note_operation_failure()
    return {"ok": True, "sessions": results}


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


_SUBMODULES = (_common, users_stats, access_codes, access_code_admin)


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
