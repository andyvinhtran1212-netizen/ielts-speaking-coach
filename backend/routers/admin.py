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
import random
import string
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Query
from fastapi.responses import JSONResponse
import uuid as _uuid
from typing import Any
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from config import settings
from database import supabase_admin
from services import admin_dashboard
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
from services.whisper import transcribe_from_bytes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])
_db_engine: AsyncEngine | None = (
    create_async_engine(settings.ASYNC_DATABASE_URL)
    if settings.ASYNC_DATABASE_URL
    else None
)


# ── Auth guard ─────────────────────────────────────────────────────────────────

async def require_admin(authorization: str | None) -> dict:
    """Verify Bearer token and assert role=admin. Returns the Supabase auth dict."""
    auth_user = await get_supabase_user(authorization)
    user_id   = auth_user["id"]

    try:
        r = (
            supabase_admin.table("users")
            .select("role")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi kiểm tra quyền: {exc}")

    if not r.data or r.data[0].get("role") != "admin":
        raise HTTPException(403, "Bạn không có quyền truy cập trang này")

    return auth_user


async def require_instructor(authorization: str | None) -> dict:
    """Verify Bearer token and assert role ∈ {instructor, admin} (admin ⊃
    instructor). Mirrors require_admin — the instructor USER-ROLE guard for the
    W-2 multi-tenancy surface.

    NOTE: distinct from routers/admin_instructor.py's 'instructor review queue'
    (an admin-only GRADING tier that just shares the word). Do NOT retrofit this
    guard onto those endpoints — different meaning of 'instructor'.
    """
    auth_user = await get_supabase_user(authorization)
    user_id   = auth_user["id"]

    try:
        r = (
            supabase_admin.table("users")
            .select("role")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi kiểm tra quyền: {exc}")

    if not r.data or r.data[0].get("role") not in ("instructor", "admin"):
        raise HTTPException(403, "Bạn không có quyền truy cập trang giảng viên")

    return auth_user


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
    """Generate a random access code in the format XXXX-XXXX."""
    chars = string.ascii_uppercase + string.digits
    return (
        "".join(random.choices(chars, k=4))
        + "-"
        + "".join(random.choices(chars, k=4))
    )


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


def _topic_status(topic: dict, question_count: int) -> tuple[str, str]:
    if not topic.get("is_active", True):
        return "inactive", "Inactive"
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


async def _replace_topic_questions_transactionally(topic_id: str, rows: list[dict]) -> list[dict]:
    if not rows:
        raise HTTPException(500, "Không tạo được bộ câu hỏi mới để thay thế bộ hiện tại.")

    engine = _require_db_engine()
    inserted_rows: list[dict] = []
    insert_sql = text(
        """
        INSERT INTO topic_questions (
            topic_id,
            part,
            order_num,
            question_text,
            question_type,
            cue_card_bullets,
            cue_card_reflection,
            is_active
        ) VALUES (
            :topic_id,
            :part,
            :order_num,
            :question_text,
            :question_type,
            CAST(:cue_card_bullets AS jsonb),
            :cue_card_reflection,
            TRUE
        )
        RETURNING
            id,
            topic_id,
            part,
            order_num,
            question_text,
            question_type,
            cue_card_bullets,
            cue_card_reflection,
            is_active,
            created_at
        """
    )

    try:
        async with engine.begin() as conn:
            await conn.execute(
                text("DELETE FROM topic_questions WHERE topic_id = :topic_id"),
                {"topic_id": topic_id},
            )
            for row in rows:
                params = {
                    "topic_id": row.get("topic_id"),
                    "part": row.get("part"),
                    "order_num": row.get("order_num", 0),
                    "question_text": row.get("question_text", ""),
                    "question_type": row.get("question_type", ""),
                    "cue_card_bullets": (
                        json.dumps(row.get("cue_card_bullets"))
                        if row.get("cue_card_bullets") is not None
                        else None
                    ),
                    "cue_card_reflection": row.get("cue_card_reflection"),
                }
                result = await conn.execute(insert_sql, params)
                inserted_rows.extend([dict(record._mapping) for record in result.fetchall()])
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "[admin.topics] transactional rotate failed topic=%s",
            topic_id,
            exc_info=True,
        )
        raise HTTPException(
            500,
            "Lỗi khi thay thế bộ câu hỏi. Hệ thống đã giữ nguyên bộ câu hỏi trước đó.",
        ) from exc

    return inserted_rows


async def _replace_topic_questions_with_visibility_swap(
    topic_id: str,
    rows: list[dict],
    existing_rows: list[dict],
) -> list[dict]:
    if not rows:
        raise HTTPException(500, "Không tạo được bộ câu hỏi mới để thay thế bộ hiện tại.")

    staged_rows = []
    for row in rows:
        staged_row = dict(row)
        staged_row["is_active"] = False
        staged_rows.append(staged_row)

    try:
        inserted_res = supabase_admin.table("topic_questions").insert(staged_rows).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi lưu questions mới: {exc}")

    inserted_rows = inserted_res.data or []
    inserted_ids = [row["id"] for row in inserted_rows if row.get("id")]
    old_ids = [row["id"] for row in (existing_rows or []) if row.get("id")]

    try:
        if old_ids:
            supabase_admin.table("topic_questions").update({"is_active": False}).in_("id", old_ids).execute()
    except Exception as exc:
        try:
            if inserted_ids:
                supabase_admin.table("topic_questions").delete().in_("id", inserted_ids).execute()
        except Exception:
            logger.warning("[admin.topics] failed to remove staged rotate rows topic=%s", topic_id, exc_info=True)
        raise HTTPException(
            500,
            "Lỗi khi thay thế bộ câu hỏi. Hệ thống đã giữ nguyên bộ câu hỏi trước đó.",
        ) from exc

    try:
        if inserted_ids:
            supabase_admin.table("topic_questions").update({"is_active": True}).in_("id", inserted_ids).execute()
    except Exception as exc:
        try:
            if old_ids:
                supabase_admin.table("topic_questions").update({"is_active": True}).in_("id", old_ids).execute()
        except Exception:
            logger.error("[admin.topics] failed to reactivate old questions topic=%s", topic_id, exc_info=True)
        try:
            if inserted_ids:
                supabase_admin.table("topic_questions").delete().in_("id", inserted_ids).execute()
        except Exception:
            logger.warning("[admin.topics] failed to clean staged rotate rows topic=%s", topic_id, exc_info=True)
        raise HTTPException(
            500,
            "Lỗi khi thay thế bộ câu hỏi. Hệ thống đã giữ nguyên bộ câu hỏi trước đó.",
        ) from exc

    try:
        supabase_admin.table("topic_questions").delete().eq("topic_id", topic_id).eq("is_active", False).execute()
    except Exception:
        logger.warning("[admin.topics] failed to clean inactive rotate rows topic=%s", topic_id, exc_info=True)

    return [{**row, "is_active": True} for row in inserted_rows]


async def _replace_topic_questions_failure_safe(
    topic_id: str,
    rows: list[dict],
    existing_rows: list[dict],
) -> list[dict]:
    if _db_engine is not None:
        return await _replace_topic_questions_transactionally(topic_id, rows)
    return await _replace_topic_questions_with_visibility_swap(topic_id, rows, existing_rows)


def _sign_storage_url(bucket: str, storage_path: str | None) -> str | None:
    if not storage_path:
        return None
    try:
        resp = supabase_admin.storage.from_(bucket).create_signed_url(storage_path, 3600)
        if hasattr(resp, "data") and resp.data:
            return resp.data.get("signedUrl") or resp.data.get("signedURL")
        if isinstance(resp, dict):
            return resp.get("signedUrl") or resp.get("signedURL")
    except Exception:
        logger.warning("[admin.audio] failed to sign storage path=%s", storage_path, exc_info=True)
    return None


# ── Request models ─────────────────────────────────────────────────────────────

class GenerateCodesRequest(BaseModel):
    count:         int              = Field(ge=1, le=100, description="Số mã cần tạo (1–100)")
    permissions:   list[str]        = Field(default=["all"], description='Danh sách quyền, ví dụ ["all"] hoặc ["practice","test_part"]')
    session_limit: int | None       = Field(default=None, ge=1, description="Giới hạn số sessions (null = không giới hạn)")
    expires_at:    str | None       = Field(default=None, description="Ngày hết hạn ISO 8601 (null = không hết hạn)")
    # Sprint 12.2 — code_type discriminator + cohort link + admin notes.
    code_type:     str              = Field(default="mass", description='"mass" | "direct" | "staff"')
    cohort_id:     str | None       = Field(default=None, description="UUID của lớp (bắt buộc khi code_type='direct')")
    notes:         str | None       = None
    # W-2 (Option B) — mint an email-bound instructor-promote code. grants_role
    # 'instructor' + intended_email auto-promotes the matching user at activation
    # (email verified against the token, not the body). NULL = ordinary code.
    grants_role:    str | None      = Field(default=None, description="null | 'instructor' (mã promote vai trò)")
    intended_email: str | None      = Field(default=None, description="email ràng buộc (BẮT BUỘC khi grants_role='instructor')")


class PatchCodeRequest(BaseModel):
    permissions:   list[str] | None = None
    session_limit: int | None       = None
    expires_at:    str | None       = None
    is_active:     bool | None      = None
    # Sprint 12.2 — admins can flip these post-create.
    code_type:     str | None       = None
    cohort_id:     str | None       = None
    notes:         str | None       = None


_VALID_CODE_TYPES = ("mass", "direct", "staff")


def _validate_code_type_combo(code_type: str, cohort_id: str | None) -> None:
    """Sprint 12.2 — direct codes MUST have a cohort; mass/staff MUST NOT.

    Raises HTTPException(422) on mismatch. Server-side belt to the
    frontend's client-side guard; the DB also has a CHECK on code_type
    domain but doesn't enforce the cross-column rule.
    """
    if code_type not in _VALID_CODE_TYPES:
        raise HTTPException(422, f"code_type phải là một trong {_VALID_CODE_TYPES}, got {code_type!r}")
    if code_type == "direct" and not cohort_id:
        raise HTTPException(422, "code_type='direct' bắt buộc phải có cohort_id")
    if code_type in ("mass", "staff") and cohort_id:
        raise HTTPException(422, f"code_type={code_type!r} không được gắn cohort_id")


class CreateTopicRequest(BaseModel):
    title:    str
    category: str = ""   # kept for DB compat, not shown in UI
    part:     int = Field(ge=1, le=3)


class PatchTopicRequest(BaseModel):
    title:     str | None = None
    part:      int | None = Field(default=None, ge=1, le=3)
    is_active: bool | None = None
    category:  str | None = None


class BulkAddTopicsRequest(BaseModel):
    part:  int = Field(ge=1, le=3)
    lines: str  # newline-separated topic titles


class GenerateTopicQuestionsRequest(BaseModel):
    mode: str = Field(default="replace_all", description="missing_only | replace_all")


class BulkTopicIdsRequest(BaseModel):
    topic_ids: list[str]


class BulkGenerateTopicsRequest(BaseModel):
    topic_ids: list[str]
    mode: str = Field(default="missing_only", description="missing_only | replace_all")


class CreateTopicQuestionRequest(BaseModel):
    part:                int   = Field(ge=1, le=3)
    question_text:       str
    question_type:       str   = ""
    order_num:           int   = 0
    cue_card_bullets:    list[str] | None = None
    cue_card_reflection: str | None       = None


class UpdateTopicQuestionRequest(BaseModel):
    question_text:       str | None       = None
    question_type:       str | None       = None
    order_num:           int | None       = None
    cue_card_bullets:    list[str] | None = None
    cue_card_reflection: str | None       = None


def _serialize_topics_with_metadata(topics: list[dict]) -> list[dict]:
    rows = topics or []
    if not rows:
        return []

    topic_ids = [t["id"] for t in rows if t.get("id")]
    question_counts: dict[str, int] = {}
    latest_question_at: dict[str, str] = {}

    if topic_ids:
        try:
            q_res = (
                supabase_admin.table("topic_questions")
                .select("topic_id, created_at")
                .in_("topic_id", topic_ids)
                .eq("is_active", True)
                .execute()
            )
            for q in (q_res.data or []):
                topic_id = q.get("topic_id")
                if not topic_id:
                    continue
                question_counts[topic_id] = question_counts.get(topic_id, 0) + 1
                latest_question_at[topic_id] = _max_iso(
                    latest_question_at.get(topic_id),
                    q.get("created_at"),
                ) or latest_question_at.get(topic_id)
        except Exception:
            logger.warning("[admin.topics] failed to aggregate question metadata", exc_info=True)

    enriched: list[dict] = []
    for topic in rows:
        item = dict(topic)
        topic_id = item.get("id")
        count = question_counts.get(topic_id, 0)
        status_code, status_label = _topic_status(item, count)
        item["question_count"] = count
        item["status"] = status_code
        item["status_label"] = status_label
        item["last_question_created_at"] = latest_question_at.get(topic_id)
        item["last_updated_at"] = _max_iso(
            item.get("updated_at"),
            item.get("last_rotated_at"),
            latest_question_at.get(topic_id),
        )
        enriched.append(item)

    return enriched


async def _generate_questions_for_topic(
    topic_id: str,
    user_id: str,
    *,
    replace_existing: bool,
) -> dict:
    try:
        t_res = (
            supabase_admin.table("topics")
            .select("id, title, part")
            .eq("id", topic_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải topic: {exc}")

    if not t_res.data:
        raise HTTPException(404, "Topic không tồn tại")

    topic = t_res.data[0]
    title = topic["title"]
    part = topic["part"]

    try:
        existing_res = (
            supabase_admin.table("topic_questions")
            .select("*", count="exact")
            .eq("topic_id", topic_id)
            .eq("is_active", True)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi kiểm tra questions hiện tại: {exc}")

    existing_count = existing_res.count or len(existing_res.data or [])
    existing_rows = existing_res.data or []
    if existing_count > 0 and not replace_existing:
        raise HTTPException(409, "Topic đã có câu hỏi. Dùng Rotate để thay thế bộ câu hỏi hiện tại.")

    rows: list[dict] = []

    if part == 1:
        qs = await generate_part1_questions(title, count=7, user_id=user_id)
        for i, q in enumerate(qs):
            rows.append({
                "topic_id": topic_id,
                "part": 1,
                "order_num": i + 1,
                "question_text": q["question_text"],
                "question_type": q.get("question_type", "personal"),
            })
    elif part == 2:
        cuecard = await generate_part2_cuecard(title, user_id=user_id)
        rows.append({
            "topic_id": topic_id,
            "part": 2,
            "order_num": 1,
            "question_text": cuecard["question_text"],
            "question_type": "cuecard",
            "cue_card_bullets": cuecard.get("cue_card_bullets"),
            "cue_card_reflection": cuecard.get("cue_card_reflection"),
        })
        p3qs = await generate_part3_questions(title, count=5, user_id=user_id)
        for i, q in enumerate(p3qs):
            rows.append({
                "topic_id": topic_id,
                "part": 3,
                "order_num": i + 1,
                "question_text": q["question_text"],
                "question_type": q.get("question_type", "opinion"),
            })
    elif part == 3:
        qs = await generate_part3_questions(title, count=5, user_id=user_id)
        for i, q in enumerate(qs):
            rows.append({
                "topic_id": topic_id,
                "part": 3,
                "order_num": i + 1,
                "question_text": q["question_text"],
                "question_type": q.get("question_type", "opinion"),
            })

    if rows:
        if replace_existing:
            saved_rows = await _replace_topic_questions_failure_safe(topic_id, rows, existing_rows)
        else:
            try:
                supabase_admin.table("topic_questions").insert(rows).execute()
            except Exception as exc:
                raise HTTPException(500, f"Lỗi khi lưu questions: {exc}")
            saved_rows = None
    else:
        saved_rows = None

    if replace_existing:
        try:
            supabase_admin.table("topics").update({"last_rotated_at": _utc_now_iso()}).eq("id", topic_id).execute()
        except Exception:
            logger.warning("[admin.topics] failed to update last_rotated_at topic=%s", topic_id, exc_info=True)
    _touch_topic(topic_id)

    if saved_rows is None:
        try:
            saved = (
                supabase_admin.table("topic_questions")
                .select("*")
                .eq("topic_id", topic_id)
                .eq("is_active", True)
                .order("part")
                .order("order_num")
                .execute()
            )
            saved_rows = saved.data or []
        except Exception as exc:
            raise HTTPException(500, f"Lỗi khi tải questions đã lưu: {exc}")

    saved_rows = sorted(
        saved_rows or [],
        key=lambda row: (row.get("part") or 0, row.get("order_num") or 0, row.get("created_at") or ""),
    )

    return {
        "topic_id": topic_id,
        "topic_title": title,
        "mode": "replace_all" if replace_existing else "missing_only",
        "replaced_existing": replace_existing,
        "question_count": len(saved_rows),
        "questions": saved_rows,
    }


# ── GET /admin/users ───────────────────────────────────────────────────────────


_VALID_ROLES = {"admin", "instructor", "student"}


class UserRolePayload(BaseModel):
    role: str = Field(..., description=f"new role (one of {sorted(_VALID_ROLES)})")


@router.patch("/users/{user_id}/role")
async def admin_set_user_role(
    user_id: str,
    payload: UserRolePayload,
    authorization: str | None = Header(default=None),
):
    """Sprint 12.8 — change a user's role.

    Admin-only. Self-demotion is blocked so an admin can't accidentally
    lock themselves out of the panel. Role values are constrained to a
    small allow-list so a typo doesn't quietly write garbage.
    """
    admin_user = await require_admin(authorization)
    role = (payload.role or "").strip().lower()
    if role not in _VALID_ROLES:
        raise HTTPException(
            400,
            f"Invalid role '{payload.role}'. Allowed: {sorted(_VALID_ROLES)}",
        )

    admin_id = admin_user.get("id") if isinstance(admin_user, dict) else None
    if admin_id and admin_id == user_id and role != "admin":
        raise HTTPException(400, "Không thể tự hạ quyền admin của chính mình.")

    try:
        res = (
            supabase_admin.table("users")
            .update({"role": role})
            .eq("id", user_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Role update failed: {exc}")

    if not res.data:
        raise HTTPException(404, "User not found")
    return {"ok": True, "id": user_id, "role": role}


@router.get("/users")
async def list_users(authorization: str | None = Header(default=None)):
    """List all users with today's session count appended."""
    await require_admin(authorization)

    try:
        users_res = (
            supabase_admin.table("users")
            .select("id, email, display_name, created_at, is_active, role")
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải danh sách users: {exc}")

    users = users_res.data or []

    # Count today's sessions per user (UTC)
    today_start = (
        datetime.now(timezone.utc)
        .replace(hour=0, minute=0, second=0, microsecond=0)
        .isoformat()
    )
    try:
        sessions_today_res = (
            supabase_admin.table("sessions")
            .select("user_id")
            .gte("started_at", today_start)
            .execute()
        )
        today_counts: dict[str, int] = {}
        for s in (sessions_today_res.data or []):
            uid = s["user_id"]
            today_counts[uid] = today_counts.get(uid, 0) + 1
    except Exception:
        today_counts = {}

    for u in users:
        u["sessions_today"] = today_counts.get(u["id"], 0)

    # WF-1 — class label per user: user → students.user_id → students.cohort_id
    # → cohorts.name. TWO batched queries (students-by-user + cohorts), no N+1.
    # Users without a linked student or unassigned class → cohort_name None
    # (UI shows "—"). Lookup failure is non-fatal (the list still renders).
    cohort_name_by_user: dict[str, str] = {}
    user_ids = [u["id"] for u in users]
    if user_ids:
        try:
            srows = (
                supabase_admin.table("students")
                .select("user_id, cohort_id")
                .in_("user_id", user_ids)
                .execute()
            ).data or []
            cohort_ids = list({s["cohort_id"] for s in srows if s.get("cohort_id")})
            names: dict[str, str] = {}
            if cohort_ids:
                cr = (
                    supabase_admin.table("cohorts")
                    .select("id, name")
                    .in_("id", cohort_ids)
                    .execute()
                ).data or []
                names = {c["id"]: (c.get("name") or "") for c in cr}
            for s in srows:
                if s.get("user_id") and s.get("cohort_id"):
                    cohort_name_by_user[s["user_id"]] = names.get(s["cohort_id"])
        except Exception as exc:
            logger.warning("list_users: cohort lookup failed: %s", exc)

    for u in users:
        u["cohort_name"] = cohort_name_by_user.get(u["id"])

    # Merge access-codes (the merged "Người dùng" tab): each user's LIVE
    # code(s) — code/type/permissions-union/status — via a BATCHED summary
    # (no N+1; honors the #442 used_by fallback + excludes revoked codes).
    # READ-ONLY here: code-wide mutations stay on the "Mã kích hoạt" tab.
    code_summary = get_users_code_summary(user_ids)
    for u in users:
        u["code_summary"] = code_summary.get(
            u["id"],
            {"codes": [], "code_count": 0, "code_type": None,
             "permissions": [], "has_active_code": False},
        )

    return users


# ── GET /admin/stats ───────────────────────────────────────────────────────────

@router.get("/stats")
async def get_stats(authorization: str | None = Header(default=None)):
    """Return aggregated platform usage statistics."""
    await require_admin(authorization)

    now   = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week  = today - timedelta(days=today.weekday())   # Monday of current week
    month = today.replace(day=1)

    try:
        all_sessions = (
            supabase_admin.table("sessions")
            .select("started_at, tokens_used, status")
            .execute()
        ).data or []
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải stats: {exc}")

    today_iso = today.isoformat()
    week_iso  = week.isoformat()
    month_iso = month.isoformat()

    def _started_after(s: dict, cutoff: str) -> bool:
        return bool(s.get("started_at") and s["started_at"] >= cutoff)

    sessions_today  = sum(1 for s in all_sessions if _started_after(s, today_iso))
    sessions_week   = sum(1 for s in all_sessions if _started_after(s, week_iso))
    sessions_month  = sum(1 for s in all_sessions if _started_after(s, month_iso))
    sessions_total  = len(all_sessions)
    sessions_done   = sum(1 for s in all_sessions if s.get("status") == "completed")

    tokens_total = sum(
        int(s["tokens_used"])
        for s in all_sessions
        if s.get("tokens_used") is not None
    )

    # Cost estimate: blended ~$8 / 1 M tokens (Claude Sonnet)
    cost_usd = round(tokens_total / 1_000_000 * 8, 4)

    try:
        users_res  = supabase_admin.table("users").select("id").execute()
        total_users = len(users_res.data or [])
    except Exception:
        total_users = 0

    try:
        active_users_res = (
            supabase_admin.table("users")
            .select("id")
            .eq("is_active", True)
            .execute()
        )
        active_users = len(active_users_res.data or [])
    except Exception:
        active_users = 0

    return {
        "sessions_today":     sessions_today,
        "sessions_week":      sessions_week,
        "sessions_month":     sessions_month,
        "sessions_total":     sessions_total,
        "sessions_completed": sessions_done,
        "tokens_total":       tokens_total,
        "cost_usd_estimate":  cost_usd,
        "total_users":        total_users,
        "active_users":       active_users,
    }


# ── POST /admin/access-codes/generate ─────────────────────────────────────────

@router.post("/access-codes/generate")
async def generate_access_codes(
    body: GenerateCodesRequest,
    authorization: str | None = Header(default=None),
):
    """Generate N new unused access codes and persist them."""
    admin = await require_admin(authorization)

    # Sprint 5.2 — fail loudly on typo'd permission strings instead of
    # silently inserting a code that grants nothing-and-no-one. Allowed
    # values live in services.access_code_permissions.ALLOWED_PERMISSIONS.
    try:
        validate_permissions_or_raise(body.permissions)
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Sprint 12.2 — validate code_type ↔ cohort_id combo before insert.
    _validate_code_type_combo(body.code_type, body.cohort_id)

    # W-2 (Option B) — instructor-promote codes MUST be email-bound (fail-closed
    # at mint time so an unbound instructor code can never auto-promote anyone).
    grants_role = (body.grants_role or "").strip().lower() or None
    if grants_role is not None and grants_role != "instructor":
        raise HTTPException(400, "grants_role chỉ nhận null hoặc 'instructor'.")
    intended_email = (body.intended_email or "").strip() or None
    if grants_role == "instructor" and not intended_email:
        raise HTTPException(400, "Mã instructor bắt buộc có intended_email (ràng buộc theo email).")

    codes = [_gen_code() for _ in range(body.count)]
    row_base: dict = {
        "is_used": False,
        "is_active": True,
        "permissions": body.permissions,
        "code_type": body.code_type,
        "issued_by": _actor_id(admin),          # provenance (mig 106)
    }
    if body.session_limit is not None:
        row_base["session_limit"] = body.session_limit
    if body.expires_at is not None:
        row_base["expires_at"] = body.expires_at
    if body.cohort_id is not None:
        row_base["cohort_id"] = body.cohort_id
    if body.notes is not None:
        row_base["notes"] = body.notes
    if grants_role is not None:
        row_base["grants_role"] = grants_role
    if intended_email is not None:
        row_base["intended_email"] = intended_email
    rows = [{**row_base, "code": c} for c in codes]

    try:
        result = supabase_admin.table("access_codes").insert(rows).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tạo access codes: {exc}")

    actor = _actor_id(admin)
    for row in (result.data or []):
        _audit_entitlement(actor, "create", row.get("id"), after={
            "code":          row.get("code"),
            "permissions":   row.get("permissions"),
            "session_limit": row.get("session_limit"),
            "expires_at":    row.get("expires_at"),
            "code_type":     row.get("code_type"),
            "cohort_id":     row.get("cohort_id"),
            "grants_role":   row.get("grants_role"),
        })

    return {"created": len(result.data or rows), "codes": codes}


# ── GET /admin/access-codes ────────────────────────────────────────────────────

# ── Typecheck pilot (Step A) — response_model for GET /admin/access-codes ──────
# A concrete output schema so the FE can generate a TypeScript type (via
# openapi-typescript) and tsc catches a BE field rename at the call site. The
# field set MUST be a SUPERSET of every key list_access_codes assembles, or
# response_model SILENTLY STRIPS the missing field from the response (breaking the
# admin page). test_access_codes_response_model.py enforces that superset rule —
# the strip-footgun guard (mirrors the writing_feedback NOT-NULL schema test).
# Appended fields are conditional per branch (assigned_users on the happy/empty
# path, association_lookup_failed only on the lookup-failure early return), so
# EVERY appended field is Optional+default — else FastAPI 500s on the branch that
# omits it.

class AccessCodeQuota(BaseModel):
    used: int
    limit: int | None = None
    remaining: int | None = None
    limit_type: str


class AccessCodeAssignedUser(BaseModel):
    user_id: str
    name: str
    email: str
    is_fallback_used_by: bool
    removable: bool
    quota: AccessCodeQuota


class AccessCodeOut(BaseModel):
    # Base columns (the .select() list).
    id: str
    code: str
    is_used: bool | None = None
    is_revoked: bool | None = None
    is_active: bool | None = None
    used_by: str | None = None
    used_at: str | None = None
    created_at: str | None = None
    permissions: Any = None          # JSONB — dict/list/null; intentionally loose
    session_limit: int | None = None
    expires_at: str | None = None
    code_type: str | None = None
    cohort_id: str | None = None
    notes: str | None = None
    # Appended in the route (conditional per branch → all Optional+default).
    assigned_user_count: int | None = None
    assigned_users: list[AccessCodeAssignedUser] = Field(default_factory=list)
    cohort_name: str | None = None
    association_lookup_failed: bool | None = None


@router.get("/access-codes", response_model=list[AccessCodeOut])
async def list_access_codes(authorization: str | None = Header(default=None)):
    """List all access codes, enriched with assigned user count."""
    await require_admin(authorization)

    try:
        codes_res = (
            supabase_admin.table("access_codes")
            .select(
                "id, code, is_used, is_revoked, is_active, used_by, used_at, "
                "created_at, permissions, session_limit, expires_at, "
                "code_type, cohort_id, notes"
            )
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải access codes: {exc}")

    codes = codes_res.data or []

    if not codes:
        return codes

    code_ids = [c["id"] for c in codes]

    # Fetch ALL assignments (active + inactive) in one query; derive count +
    # identity from the active ones, and record every (code_id, user_id) pair so
    # the legacy used_by fallback below can tell a deliberately-removed user
    # (inactive row) apart from a true legacy redeemer (no row at all).
    code_user_ids: dict[str, list[str]] = {}      # code_id → [active user_id, ...]
    code_any_assignment: dict[str, set] = {}      # code_id → {user_id with ANY row}
    try:
        asgn_res = (
            supabase_admin.table("user_code_assignments")
            .select("code_id, user_id, is_active")
            .in_("code_id", code_ids)
            .execute()
        )
        for row in (asgn_res.data or []):
            cid = row["code_id"]
            code_any_assignment.setdefault(cid, set()).add(row["user_id"])
            if row.get("is_active"):
                code_user_ids.setdefault(cid, []).append(row["user_id"])
    except Exception as exc:
        logger.warning("list_access_codes: assignment lookup failed: %s", exc)
        for c in codes:
            c["association_lookup_failed"] = True
        return codes

    # Fallback: a TRUE legacy code — used_by set but the redeemer has NO
    # assignment row at all. We must NOT synthesize the redeemer when an INACTIVE
    # row exists: that means the admin deliberately removed them (per-user
    # revoke), and post read-path fix #442 they no longer have access. Re-showing
    # them as the "owner" made remove-user look like a no-op (they reappeared as
    # a non-removable redeemer). Mirrors #442: an assignment row, even inactive,
    # is authoritative over the immutable used_by marker.
    fallback_uid: dict[str, str] = {}  # code_id → used_by user_id
    for c in codes:
        ub = c.get("used_by")
        if (
            not code_user_ids.get(c["id"])
            and c.get("is_used")
            and ub
            and ub not in code_any_assignment.get(c["id"], set())
        ):
            fallback_uid[c["id"]] = ub

    # Single users lookup covering both assignment UIDs and fallback UIDs.
    user_info: dict[str, dict] = {}
    all_uids = list(
        {uid for uids in code_user_ids.values() for uid in uids}
        | set(fallback_uid.values())
    )
    if all_uids:
        try:
            ur = (
                supabase_admin.table("users")
                .select("id, email, display_name")
                .in_("id", all_uids)
                .execute()
            )
            for u in (ur.data or []):
                user_info[u["id"]] = {
                    "user_id": u["id"],
                    "name":    u.get("display_name") or "",
                    "email":   u.get("email") or "",
                }
        except Exception as exc:
            logger.warning("list_access_codes: user lookup failed: %s", exc)

    # Per-user quota "used" — the CANONICAL count: COMPLETED sessions only (an
    # abandoned in_progress does not consume a lượt) via the
    # fn_completed_session_counts GROUP BY RPC (one query, no N+1, no 1000-row
    # cap). This is the SAME semantic create_session enforces (get_user_session_
    # quota), so the admin display can no longer disagree with enforcement — the
    # old batched `.in_()` count was truncated at db-max-rows (1000) and counted
    # all statuses, showing inflated "remaining" while students were blocked.
    # Graceful: a failed count omits quota rather than failing the whole list.
    session_counts: dict[str, int] = {}
    if all_uids:
        try:
            session_counts = get_completed_session_counts(all_uids)
        except Exception as exc:
            logger.warning("list_access_codes: session count lookup failed: %s", exc)

    def _quota_for(uid: str, code: dict) -> dict:
        used = session_counts.get(uid, 0)
        limit = code.get("session_limit")
        if limit is None:
            return {"used": used, "limit": None, "remaining": None, "limit_type": "unlimited"}
        return {"used": used, "limit": limit, "remaining": max(0, limit - used),
                "limit_type": "per_user_via_code"}

    for c in codes:
        uids = code_user_ids.get(c["id"], [])
        if uids:
            c["assigned_user_count"] = len(uids)
            c["assigned_users"] = [
                dict(user_info.get(uid, {"user_id": uid, "name": "", "email": ""}),
                     is_fallback_used_by=False, removable=True, quota=_quota_for(uid, c))
                for uid in uids
            ]
        elif c["id"] in fallback_uid:
            # Legacy: code was redeemed but no assignment row exists.
            # Show the redeemer but do not offer a remove action — there is no row to deactivate.
            uid = fallback_uid[c["id"]]
            c["assigned_user_count"] = 1
            c["assigned_users"] = [
                dict(user_info.get(uid, {"user_id": uid, "name": "", "email": ""}),
                     is_fallback_used_by=True, removable=False, quota=_quota_for(uid, c))
            ]
        else:
            c["assigned_user_count"] = 0
            c["assigned_users"] = []

    # Sprint 12.2 — enrich rows with cohort_name for the UI (direct codes
    # display the cohort label in the table without a second round trip).
    cohort_ids = list({c.get("cohort_id") for c in codes if c.get("cohort_id")})
    cohort_name_by_id: dict[str, str] = {}
    if cohort_ids:
        try:
            cr = (
                supabase_admin.table("cohorts")
                .select("id, name")
                .in_("id", cohort_ids)
                .execute()
            )
            for row in (cr.data or []):
                cohort_name_by_id[row["id"]] = row.get("name") or ""
        except Exception as exc:
            logger.warning("list_access_codes: cohort lookup failed: %s", exc)
    for c in codes:
        if c.get("cohort_id"):
            c["cohort_name"] = cohort_name_by_id.get(c["cohort_id"], "")
        else:
            c["cohort_name"] = None

    return codes


# Declared BEFORE GET /access-codes/{code_id} so the matcher doesn't read
# "pool" as a code_id (mirrors the prompts/upload-image + fan-out ordering).
@router.get("/access-codes/pool")
async def list_unassigned_codes(authorization: str | None = Header(default=None)):
    """The 'sẵn-sàng-gán' pool for the Mã-kích-hoạt tab: codes never redeemed
    AND not revoked (is_used=false AND is_revoked=false) — the canonical flags
    for 'ready to issue'. Re-issuable (used-but-no-active-assignment) is
    intentionally excluded to keep the pool unambiguous."""
    await require_admin(authorization)
    try:
        r = (
            supabase_admin.table("access_codes")
            .select("id, code, code_type, permissions, session_limit, expires_at, cohort_id, created_at")
            .eq("is_used", False)
            .eq("is_revoked", False)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải pool mã: {exc}")
    return r.data or []


# ── Sprint 17.2 — usage log (per-user + per-code activity rollups) ────────────────

def _aggregate_usage_for_users(
    user_ids: list[str], date_from: str | None = None, date_to: str | None = None
) -> dict[str, dict]:
    """Per-user {sessions, last_active, ai_cost_usd} for the given users.

    Batched: ONE sessions query + ONE ai_usage_logs query regardless of user count
    (no N+1). Pattern #29: a failed sub-query degrades THAT metric to None rather
    than failing the whole rollup. ISO-UTC timestamps compare lexicographically.
    """
    out = {uid: {"sessions": 0, "last_active": None, "ai_cost_usd": 0.0} for uid in user_ids}
    if not user_ids:
        return out

    try:
        sq = supabase_admin.table("sessions").select("user_id, started_at").in_("user_id", user_ids)
        if date_from:
            sq = sq.gte("started_at", date_from)
        if date_to:
            sq = sq.lte("started_at", date_to)
        for row in (sq.execute().data or []):
            uid, ts = row.get("user_id"), row.get("started_at")
            if uid not in out:
                continue
            out[uid]["sessions"] += 1
            if ts and (out[uid]["last_active"] is None or ts > out[uid]["last_active"]):
                out[uid]["last_active"] = ts
    except Exception as exc:
        logger.warning("usage: sessions aggregate failed: %s", exc)
        for uid in out:
            out[uid]["sessions"] = None
            out[uid]["last_active"] = None

    try:
        cq = supabase_admin.table("ai_usage_logs").select("user_id, cost_usd_est").in_("user_id", user_ids)
        if date_from:
            cq = cq.gte("created_at", date_from)
        if date_to:
            cq = cq.lte("created_at", date_to)
        for row in (cq.execute().data or []):
            uid = row.get("user_id")
            if uid in out and out[uid]["ai_cost_usd"] is not None:
                out[uid]["ai_cost_usd"] += float(row.get("cost_usd_est") or 0)
    except Exception as exc:
        logger.warning("usage: ai cost aggregate failed: %s", exc)
        for uid in out:
            out[uid]["ai_cost_usd"] = None

    for uid in out:
        if isinstance(out[uid]["ai_cost_usd"], float):
            out[uid]["ai_cost_usd"] = round(out[uid]["ai_cost_usd"], 4)
    return out


@router.get("/usage/users")
async def usage_by_user(
    authorization: str | None = Header(default=None),
    date_from: str | None = None,
    date_to: str | None = None,
):
    """Per-user activity rollup (the usage-log landing): every user with their
    session count, last activity, and AI cost. Batched (no N+1)."""
    await require_admin(authorization)
    try:
        users = (
            supabase_admin.table("users")
            .select("id, email, display_name, role")
            .execute()
            .data
        ) or []
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải users: {exc}")

    agg = _aggregate_usage_for_users([u["id"] for u in users], date_from, date_to)
    return [
        {
            "user_id": u["id"],
            "email": u.get("email") or "",
            "name": u.get("display_name") or "",
            "role": u.get("role"),
            **agg.get(u["id"], {"sessions": 0, "last_active": None, "ai_cost_usd": 0.0}),
        }
        for u in users
    ]


@router.get("/access-codes/{code_id}/usage")
async def code_usage(code_id: str, authorization: str | None = Header(default=None)):
    """Per-code usage rollup: the code's ACTIVE assigned users with per-user stats
    + aggregate totals. Drilled from the Sprint 17.1 codes UI."""
    await require_admin(authorization)
    code_rows = (
        supabase_admin.table("access_codes")
        .select("id, code, session_limit, code_type, cohort_id")
        .eq("id", code_id)
        .limit(1)
        .execute()
        .data
    ) or []
    if not code_rows:
        raise HTTPException(404, "Mã không tồn tại")
    code = code_rows[0]

    asgn = (
        supabase_admin.table("user_code_assignments")
        .select("user_id, assigned_at")
        .eq("code_id", code_id)
        .eq("is_active", True)   # only active assignments count toward the rollup
        .execute()
        .data
    ) or []
    uids = [a["user_id"] for a in asgn]

    users: dict[str, dict] = {}
    if uids:
        for u in (
            supabase_admin.table("users").select("id, email, display_name").in_("id", uids).execute().data or []
        ):
            users[u["id"]] = u

    agg = _aggregate_usage_for_users(uids)
    per_user = [
        {
            "user_id": uid,
            "email": (users.get(uid) or {}).get("email") or "",
            "name": (users.get(uid) or {}).get("display_name") or "",
            **agg.get(uid, {"sessions": 0, "last_active": None, "ai_cost_usd": 0.0}),
        }
        for uid in uids
    ]
    total_sessions = sum((p["sessions"] or 0) for p in per_user)
    total_cost = round(sum((p["ai_cost_usd"] or 0) for p in per_user), 4)
    return {
        "code": code,
        "assigned_users": per_user,
        "aggregate": {
            "assigned_user_count": len(uids),
            "total_sessions": total_sessions,
            "total_ai_cost_usd": total_cost,
        },
    }


# ── Sprint 17.4 — foot-traffic dashboard aggregation ─────────────────────────────

@router.get("/analytics/foot-traffic")
async def foot_traffic(
    authorization: str | None = Header(default=None),
    date_from: str | None = None,
    date_to: str | None = None,
):
    """Aggregated page-view foot traffic for the admin dashboard. Default window:
    last 30 days. ONE query over page_view events + a Python rollup (no N+1).
    Pattern #29: a query failure returns zeroed metrics, never a 500."""
    await require_admin(authorization)
    if not date_from:
        date_from = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")

    rows = []
    try:
        q = (
            supabase_admin.table("analytics_events")
            .select("user_id, event_data, created_at")
            .eq("event_name", "page_view")
            .gte("created_at", date_from)
        )
        if date_to:
            q = q.lte("created_at", date_to)
        rows = q.execute().data or []
    except Exception as exc:
        logger.warning("foot_traffic: query failed: %s", exc)

    unique_users: set = set()
    anonymous_hits = 0
    page_counts: dict[str, int] = {}
    daily: dict[str, int] = {}
    for r in rows:
        uid = r.get("user_id")
        if uid:
            unique_users.add(uid)
        else:
            anonymous_hits += 1
        ed = r.get("event_data") or {}
        path = ed.get("path") if isinstance(ed, dict) else None
        if path:
            page_counts[path] = page_counts.get(path, 0) + 1
        ts = r.get("created_at")
        if ts:
            day = str(ts)[:10]
            daily[day] = daily.get(day, 0) + 1

    top_pages = sorted(
        [{"path": p, "views": c} for p, c in page_counts.items()],
        key=lambda x: x["views"], reverse=True,
    )[:10]
    daily_series = [{"date": d, "views": daily[d]} for d in sorted(daily)]

    return {
        "date_from": date_from,
        "date_to": date_to,
        "total_views": len(rows),
        "unique_visitors": len(unique_users),
        "anonymous_hits": anonymous_hits,
        "top_pages": top_pages,
        "daily": daily_series,
    }


# ── Sprint 18.2 — GET /admin/dashboard/overview (ops metrics) ────────────────────

@router.get("/dashboard/overview")
async def dashboard_overview(
    authorization: str | None = Header(default=None),
    visitors_window: int = 30,
):
    """6-metric operational overview for the admin Dashboard. `visitors_window`
    (days) drives the distinct-visitors metric (7/30/90; defaults to 30 on any
    other value). One query per metric; Pattern #29 — a partial outage yields a
    NULL metric, never a 500."""
    await require_admin(authorization)
    return admin_dashboard.compute_dashboard_overview(visitors_window_days=visitors_window)


# ── admin-dashboard-redesign — GET /admin/dashboard/trends (daily series) ─────

@router.get("/dashboard/trends")
async def dashboard_trends(
    authorization: str | None = Header(default=None),
    days: int = 30,
):
    """Daily ops trend series (visitors / completed practices / cost) over the
    last `days` (7/30/90; other values clamp to 30). Windowed + bucketed —
    bounded fetch, no migration. Cache-Control: 300s (admin has manual refresh);
    Pattern #29 — a per-series outage yields a zero-filled series, never a 500."""
    await require_admin(authorization)
    body = admin_dashboard.compute_dashboard_trends(days=days)
    return JSONResponse(content=body, headers={"Cache-Control": "max-age=300"})


# ── reading-access-tracking C — GET /admin/dashboard/reading-attempts ─────────

@router.get("/dashboard/reading-attempts")
async def dashboard_reading_attempts(
    authorization: str | None = Header(default=None),
    days: int = 30,
):
    """Reading-attempt aggregates for the admin dashboard — authenticated +
    anonymous (share-link) takers: counts, per-test usage, band distribution,
    skill performance (weakest first), and time-taken stats over the last
    `days` (7/30/90; other values clamp to 30). Anonymous distinct counts are
    APPROXIMATE (salted-IP-hash dedupe limit) and the raw hash is never
    returned. Aggregated in Python over a bounded fetch (no RPC); Pattern #29 —
    a query outage yields ok=false, never a 500. Cache-Control: 300s."""
    await require_admin(authorization)
    body = admin_reading_dashboard.compute_reading_attempts_dashboard(days=days)
    return JSONResponse(content=body, headers={"Cache-Control": "max-age=300"})


# ── PATCH /admin/access-codes/{code_id} ───────────────────────────────────────

@router.patch("/access-codes/{code_id}")
async def patch_access_code(
    code_id: str,
    body: PatchCodeRequest,
    authorization: str | None = Header(default=None),
):
    """Update permissions on an existing access code."""
    admin = await require_admin(authorization)

    # Sprint 5.2 — same allowlist guard as the generate endpoint.
    if "permissions" in body.model_fields_set and body.permissions is not None:
        try:
            validate_permissions_or_raise(body.permissions)
        except ValueError as e:
            raise HTTPException(400, str(e))

    # Use model_fields_set to distinguish "field omitted" vs "field set to null"
    set_fields = body.model_fields_set
    update: dict = {}
    if "permissions"   in set_fields: update["permissions"]   = body.permissions
    if "session_limit" in set_fields: update["session_limit"] = body.session_limit
    if "expires_at"    in set_fields: update["expires_at"]    = body.expires_at
    if "is_active"     in set_fields: update["is_active"]     = body.is_active
    # Sprint 12.2 — extend PATCH to allow editing code_type + cohort_id + notes.
    if "code_type" in set_fields: update["code_type"] = body.code_type
    if "cohort_id" in set_fields: update["cohort_id"] = body.cohort_id
    if "notes"     in set_fields: update["notes"]     = body.notes

    # If either code_type or cohort_id was touched, re-validate the combo.
    # We need the effective post-update values, so fall back to current row
    # values for whichever side wasn't sent.
    if "code_type" in set_fields or "cohort_id" in set_fields:
        existing = (
            supabase_admin.table("access_codes")
            .select("code_type, cohort_id")
            .eq("id", code_id)
            .limit(1)
            .execute()
        )
        if not existing.data:
            raise HTTPException(404, "Access code không tồn tại")
        eff_type   = update.get("code_type", existing.data[0].get("code_type") or "mass")
        eff_cohort = update.get("cohort_id", existing.data[0].get("cohort_id"))
        _validate_code_type_combo(eff_type, eff_cohort)

    if not update:
        raise HTTPException(400, "Không có trường nào để cập nhật")

    # Snapshot the BEFORE-state of ONLY the fields being changed (for the audit
    # diff) — fetched before the write, best-effort.
    before: dict = {}
    try:
        cur = (
            supabase_admin.table("access_codes")
            .select(", ".join(update.keys()))
            .eq("id", code_id)
            .limit(1)
            .execute()
        )
        if cur.data:
            before = {k: cur.data[0].get(k) for k in update}
    except Exception:
        before = {}

    try:
        res = (
            supabase_admin.table("access_codes")
            .update(update)
            .eq("id", code_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi cập nhật access code: {exc}")

    if not res.data:
        raise HTTPException(404, "Access code không tồn tại")

    _audit_entitlement(_actor_id(admin), "edit", code_id, before=before, after=update)
    return res.data[0]


# ── DELETE /admin/access-codes/{code_id} (soft revoke) ────────────────────────

@router.delete("/access-codes/{code_id}", status_code=204)
async def delete_access_code(
    code_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Soft-revoke an access code.

    Blocked if any active user assignments exist — admin must remove all users first.
    Sets is_revoked=true on the code (preserving audit trail).
    """
    admin = await require_admin(authorization)

    # Fetch the code first
    try:
        code_res = (
            supabase_admin.table("access_codes")
            .select("id, code, is_revoked")
            .eq("id", code_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải access code: {exc}")

    if not code_res.data:
        raise HTTPException(404, "Access code không tồn tại")

    row = code_res.data[0]
    if row.get("is_revoked"):
        return  # already revoked — idempotent

    # Block if active user assignments exist
    try:
        active_res = (
            supabase_admin.table("user_code_assignments")
            .select("id", count="exact")
            .eq("code_id", code_id)
            .eq("is_active", True)
            .execute()
        )
        active_count = active_res.count or 0
    except Exception:
        active_count = 0

    if active_count > 0:
        raise HTTPException(
            400,
            f"Không thể thu hồi: còn {active_count} user đang dùng mã này. "
            "Hãy gỡ tất cả user khỏi mã trước."
        )

    # Mark code as revoked
    try:
        supabase_admin.table("access_codes").update({"is_revoked": True, "is_active": False}).eq("id", code_id).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi thu hồi access code: {exc}")

    _audit_entitlement(
        _actor_id(admin), "revoke", code_id,
        before={"is_revoked": bool(row.get("is_revoked"))},
        after={"is_revoked": True, "is_active": False},
    )


# ── GET /admin/access-codes/{code_id} ─────────────────────────────────────────

@router.get("/access-codes/{code_id}")
async def get_access_code_detail(
    code_id: str,
    authorization: str | None = Header(default=None),
):
    """Return code metadata + list of assigned users."""
    await require_admin(authorization)

    try:
        code_res = (
            supabase_admin.table("access_codes")
            .select("id, code, is_used, is_revoked, is_active, used_by, used_at, created_at, permissions, session_limit, expires_at")
            .eq("id", code_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải access code: {exc}")

    if not code_res.data:
        raise HTTPException(404, "Access code không tồn tại")

    code = code_res.data[0]

    # Fetch assignments
    try:
        asgn_res = (
            supabase_admin.table("user_code_assignments")
            .select("id, user_id, assigned_at, is_active")
            .eq("code_id", code_id)
            .order("assigned_at", desc=True)
            .execute()
        )
        assignments = asgn_res.data or []
    except Exception:
        assignments = []

    # Fallback: if no ACTIVE assignment rows exist but access_codes.used_by is set,
    # synthesize a read-only entry — covers both legacy codes (no rows ever) and codes
    # where the only assignment was deactivated by remove-user.
    has_active = any(a.get("is_active") for a in assignments)
    if not has_active and code.get("used_by"):
        assignments = [{
            "id":                  None,
            "user_id":             code["used_by"],
            "assigned_at":         code.get("used_at"),
            "is_active":           True,
            "is_fallback_used_by": True,
            "removable":           False,
        }]
    else:
        # Real rows: mark as removable when active, not a fallback.
        for a in assignments:
            a.setdefault("is_fallback_used_by", False)
            a.setdefault("removable", bool(a.get("is_active")))

    # Enrich assignments with user name/email in a single lookup.
    user_ids = list({a["user_id"] for a in assignments})
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
                    "email":        u.get("email") or "",
                    "display_name": u.get("display_name") or "",
                }
        except Exception as exc:
            logger.warning("get_access_code_detail: user lookup failed: %s", exc)

    for a in assignments:
        info = user_map.get(a["user_id"], {})
        a["email"]        = info.get("email", "")
        a["display_name"] = info.get("display_name", "")

    code["assignments"] = assignments
    return code


# ── DELETE /admin/access-codes/{code_id}/users/{user_id} ──────────────────────

@router.delete("/access-codes/{code_id}/users/{user_id}", status_code=204)
async def remove_user_from_code(
    code_id: str,
    user_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Deactivate a user's assignment to a code.
    Never deletes session history. Does NOT deactivate the user account.
    """
    admin = await require_admin(authorization)

    try:
        res = (
            supabase_admin.table("user_code_assignments")
            .update({"is_active": False})
            .eq("code_id", code_id)
            .eq("user_id", user_id)
            .eq("is_active", True)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi gỡ user khỏi code: {exc}")

    if not res.data:
        raise HTTPException(404, "Không tìm thấy assignment này")
    # access_codes.used_by / used_at / is_used are intentionally NOT cleared here.
    # Redemption history must remain immutable so the code cannot be reused.
    _audit_entitlement(
        _actor_id(admin), "remove_user", code_id,
        target_user_id=user_id,
        before={"is_active": True}, after={"is_active": False},
    )


# ── Sprint 17.5 — reassignment / refill (Direction E) ────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _assign_user_to_code(code_id: str, user_id: str, admin_id: str | None, reason: str | None) -> None:
    """Upsert an ACTIVE user_code_assignment with audit. Mirrors the activation
    upsert (on_conflict user_id,code_id) so re-activating a prior inactive row works."""
    supabase_admin.table("user_code_assignments").upsert({
        "user_id":     user_id,
        "code_id":     code_id,
        "is_active":   True,
        "assigned_at": _now_iso(),
        "assigned_by": admin_id,
        "reason":      reason,
        "revoked_at":  None,
    }, on_conflict="user_id,code_id").execute()


def _issue_code_and_assign(*, user_id: str, admin_id: str | None, reason: str | None,
                           code_type: str = "direct", cohort_id: str | None = None,
                           permissions: list | None = None, session_limit=None,
                           expires_at=None) -> dict:
    """Create a fresh access code (claimed by user_id) + an active assignment with
    audit. Returns the new code row. Sets is_used/used_by/used_at AT ISSUANCE (the
    code's initial state) — this is the first write, not a mutation of a used code."""
    row = {
        "code":        _gen_code(),
        "is_used":     True,
        "used_by":     user_id,
        "used_at":     _now_iso(),
        "is_active":   True,
        "permissions": permissions or ["all"],
        "code_type":   code_type,
        "cohort_id":   cohort_id,
    }
    if session_limit is not None:
        row["session_limit"] = session_limit
    if expires_at is not None:
        row["expires_at"] = expires_at
    res = supabase_admin.table("access_codes").insert(row).execute()
    new_code = (res.data or [row])[0]
    _assign_user_to_code(new_code["id"], user_id, admin_id, reason)
    return new_code


class ReassignRequest(BaseModel):
    from_user_id: str
    to_user_id: str
    reason: str | None = None


class RefillRequest(BaseModel):
    to_user_id: str | None = None   # default: the code's current redeemer (used_by)
    reason: str | None = None


@router.post("/access-codes/{code_id}/reassign")
async def reassign_code(code_id: str, body: ReassignRequest,
                        authorization: str | None = Header(default=None)):
    """Transfer a code from one user to another. Activates the target FIRST, then
    deactivates the source (the SDK has no multi-statement transaction, so this
    ordering means the target never loses access on a partial failure). NEVER
    touches is_used/used_by/used_at (immutability)."""
    admin = await require_admin(authorization)
    admin_id = admin.get("id") if isinstance(admin, dict) else None
    if body.from_user_id == body.to_user_id:
        raise HTTPException(400, "Người nhận trùng với người hiện tại.")

    code = (
        supabase_admin.table("access_codes").select("id, is_revoked").eq("id", code_id).limit(1).execute().data
    ) or []
    if not code:
        raise HTTPException(404, "Mã không tồn tại")
    if code[0].get("is_revoked"):
        raise HTTPException(400, "Mã đã bị thu hồi")

    existing = (
        supabase_admin.table("user_code_assignments").select("id")
        .eq("code_id", code_id).eq("user_id", body.from_user_id).eq("is_active", True).execute().data
    ) or []
    if not existing:
        raise HTTPException(404, "Người dùng nguồn không có assignment đang hoạt động cho mã này")

    _assign_user_to_code(code_id, body.to_user_id, admin_id, body.reason)   # activate target first
    supabase_admin.table("user_code_assignments").update({
        "is_active": False, "revoked_at": _now_iso(), "assigned_by": admin_id, "reason": body.reason,
    }).eq("code_id", code_id).eq("user_id", body.from_user_id).eq("is_active", True).execute()

    _audit_entitlement(
        admin_id, "reassign", code_id,
        target_user_id=body.to_user_id,
        before={"assigned_user": body.from_user_id},
        after={"assigned_user": body.to_user_id},
    )
    return {"ok": True, "code_id": code_id,
            "from_user_id": body.from_user_id, "to_user_id": body.to_user_id}


@router.post("/access-codes/{code_id}/refill")
async def refill_code(code_id: str, body: RefillRequest,
                      authorization: str | None = Header(default=None)):
    """Refill (e-new): issue a NEW code mirroring the source (type/perms/cohort/
    limit) and assign it to the user — the source's redeemer by default. The old
    code is left untouched (history preserved). Refill-as-quota-bump is the
    existing PATCH /admin/access-codes/{id} instead (no new code)."""
    admin = await require_admin(authorization)
    admin_id = admin.get("id") if isinstance(admin, dict) else None

    src = (supabase_admin.table("access_codes").select("*").eq("id", code_id).limit(1).execute().data) or []
    if not src:
        raise HTTPException(404, "Mã không tồn tại")
    src = src[0]
    target = body.to_user_id or src.get("used_by")
    if not target:
        raise HTTPException(400, "Không xác định được người dùng để cấp mã mới.")

    new_code = _issue_code_and_assign(
        user_id=target, admin_id=admin_id, reason=body.reason,
        code_type=src.get("code_type") or "direct", cohort_id=src.get("cohort_id"),
        permissions=src.get("permissions"), session_limit=src.get("session_limit"),
        expires_at=src.get("expires_at"),
    )
    # Audit both the refill on the source code and the creation of the new code.
    _audit_entitlement(
        admin_id, "refill", code_id, target_user_id=target,
        after={"new_code_id": new_code.get("id"), "new_code": new_code.get("code")},
    )
    _audit_entitlement(
        admin_id, "create", new_code.get("id"), target_user_id=target,
        after={"permissions": new_code.get("permissions"),
               "session_limit": new_code.get("session_limit"),
               "via": "refill", "source_code_id": code_id},
    )
    return {"ok": True, "user_id": target,
            "new_code": new_code.get("code"), "new_code_id": new_code.get("id")}


class GenerateAndAssignRequest(BaseModel):
    user_id:       str
    permissions:   list[str]  = Field(default=["all"], description="Quyền cấp cho mã")
    session_limit: int | None = Field(default=None, ge=1, description="Giới hạn sessions (null = không giới hạn)")
    expires_at:    str | None = Field(default=None, description="Ngày hết hạn ISO 8601 (null = không hết hạn)")
    code_type:     str        = Field(default="mass", description='"mass" | "direct" | "staff"')
    cohort_id:     str | None = Field(default=None, description="UUID lớp (bắt buộc khi code_type='direct')")


@router.post("/access-codes/generate-and-assign")
async def generate_and_assign_code(
    body: GenerateAndAssignRequest,
    authorization: str | None = Header(default=None),
):
    """Admin-side activation: create ONE fresh code dedicated to a single user and
    immediately assign it — onboards an existing account that has no active code
    WITHOUT the student having to enter a code. Reuses `_issue_code_and_assign`
    (the same activation core as /refill): it sets is_used/used_by/used_at AT
    ISSUANCE (first write on a brand-new code, NOT a mutation of a used code) and
    upserts an active user_code_assignment, so the immutability invariant and the
    code-derived entitlement both stay canonical."""
    admin = await require_admin(authorization)
    actor = _actor_id(admin)

    # Same validation as POST /generate so the combos can't drift.
    try:
        validate_permissions_or_raise(body.permissions)
    except ValueError as e:
        raise HTTPException(400, str(e))
    _validate_code_type_combo(body.code_type, body.cohort_id)

    # Target must be a real user row.
    target = (
        supabase_admin.table("users").select("id").eq("id", body.user_id).limit(1).execute().data
    ) or []
    if not target:
        raise HTTPException(404, "Không tìm thấy người dùng")

    new_code = _issue_code_and_assign(
        user_id=body.user_id, admin_id=actor, reason="admin tạo + gán trực tiếp",
        code_type=body.code_type, cohort_id=body.cohort_id,
        permissions=body.permissions, session_limit=body.session_limit,
        expires_at=body.expires_at,
    )

    # WF-1 class-roster bridge: a direct (cohort-linked) code enrolls the user
    # into that class via students.cohort_id — the SAME column the roster /
    # writing fan-out / grade-matrix read, mirroring /auth/activate. Defensive:
    # a failure (or a user with no students row) never blocks the assignment.
    if body.cohort_id:
        try:
            srow = (
                supabase_admin.table("students").select("id")
                .eq("user_id", body.user_id).limit(1).execute().data
            ) or []
            if srow:
                supabase_admin.table("students").update(
                    {"cohort_id": body.cohort_id}
                ).eq("id", srow[0]["id"]).execute()
        except Exception as e:
            logger.warning(
                "[admin] cohort bridge failed for user=%s code=%s: %s",
                body.user_id, new_code.get("id"), e,
            )

    _audit_entitlement(
        actor, "create", new_code.get("id"), target_user_id=body.user_id,
        after={"code":          new_code.get("code"),
               "permissions":   new_code.get("permissions"),
               "session_limit": new_code.get("session_limit"),
               "code_type":     body.code_type,
               "cohort_id":     body.cohort_id,
               "via":           "generate-and-assign"},
    )
    return {"ok": True, "user_id": body.user_id,
            "code": new_code.get("code"), "code_id": new_code.get("id")}


# ── DELETE /admin/access-codes/{code_id}/remove (hard delete) ─────────────────

@router.delete("/access-codes/{code_id}/remove", status_code=204)
async def hard_delete_access_code(
    code_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Hard-delete an access code from the database.
    Blocked if any active user assignments exist.
    Cascades to delete all assignments for this code first (since no active ones exist).
    """
    admin = await require_admin(authorization)

    # Verify code exists (and snapshot a little config for the audit before-state)
    try:
        code_res = (
            supabase_admin.table("access_codes")
            .select("id, code, permissions, session_limit")
            .eq("id", code_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải access code: {exc}")

    if not code_res.data:
        raise HTTPException(404, "Access code không tồn tại")

    # Block if active assignments exist
    try:
        active_res = (
            supabase_admin.table("user_code_assignments")
            .select("id", count="exact")
            .eq("code_id", code_id)
            .eq("is_active", True)
            .execute()
        )
        active_count = active_res.count or 0
    except Exception:
        active_count = 0

    if active_count > 0:
        raise HTTPException(
            400,
            f"Không thể xóa: còn {active_count} user đang dùng mã này. "
            "Hãy gỡ tất cả user khỏi mã trước (trong Chi tiết → Gỡ khỏi code)."
        )

    # Delete all (inactive) assignments first
    try:
        supabase_admin.table("user_code_assignments").delete().eq("code_id", code_id).execute()
    except Exception:
        pass

    # Hard-delete the code
    try:
        supabase_admin.table("access_codes").delete().eq("id", code_id).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi xóa access code: {exc}")

    # The audit row OUTLIVES the code (code_id has no FK), so the deletion is
    # recorded with what was removed.
    _snap = code_res.data[0]
    _audit_entitlement(
        _actor_id(admin), "hard_delete", code_id,
        before={"code": _snap.get("code"), "permissions": _snap.get("permissions"),
                "session_limit": _snap.get("session_limit")},
        after=None,
    )


# ── GET /admin/access-codes/{code_id}/audit ──────────────────────────────────

@router.get("/access-codes/{code_id}/audit")
async def get_access_code_audit(
    code_id: str,
    authorization: str | None = Header(default=None),
):
    """Read-only entitlement-edit history for one code (admin), newest first.
    Records who changed what and when: create / edit / revoke / remove_user /
    reassign / refill / hard_delete."""
    await require_admin(authorization)
    try:
        res = (
            supabase_admin.table("access_code_audit")
            .select("id, actor_user_id, action, code_id, target_user_id, before, after, created_at")
            .eq("code_id", code_id)
            .order("created_at", desc=True)
            .limit(200)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải lịch sử chỉnh sửa: {exc}")
    return res.data or []


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
        raise HTTPException(500, f"Lỗi khi tải topics: {exc}")

    return _serialize_topics_with_metadata(res.data or [])


# ── POST /admin/topics ─────────────────────────────────────────────────────────

@router.post("/topics", status_code=201)
async def create_topic(
    body: CreateTopicRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)

    try:
        res = (
            supabase_admin.table("topics")
            .insert({
                "title":     body.title.strip(),
                "category":  body.category.strip(),
                "part":      body.part,
                "is_active": True,
            })
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tạo topic: {exc}")

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
    if body.title     is not None: update["title"]     = body.title.strip()
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
        raise HTTPException(500, f"Lỗi khi cập nhật topic: {exc}")

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
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi xóa topic: {exc}")


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
        raise HTTPException(500, f"Lỗi khi tải topics: {exc}")

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
        except Exception as exc:
            failed_ids.extend(existing_ids)
            errors.append({
                "topic_id": None,
                "topic_title": None,
                "message": f"Lỗi khi xóa topics: {exc}",
                "code": "delete_failed",
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
        raise HTTPException(500, f"Lỗi khi thêm topics: {exc}")

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
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải questions: {exc}")
    return res.data or []


# ── POST /admin/topics/{topic_id}/questions ────────────────────────────────────

@router.post("/topics/{topic_id}/questions", status_code=201)
async def create_topic_question(
    topic_id: str,
    body: CreateTopicQuestionRequest,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)

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
        except Exception:
            order = 1

    row = {
        "topic_id":            topic_id,
        "part":                body.part,
        "order_num":           order,
        "question_text":       body.question_text.strip(),
        "question_type":       body.question_type,
        "cue_card_bullets":    body.cue_card_bullets,
        "cue_card_reflection": body.cue_card_reflection,
    }
    try:
        res = supabase_admin.table("topic_questions").insert(row).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tạo question: {exc}")
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

    update: dict = {}
    if body.question_text       is not None: update["question_text"]       = body.question_text.strip()
    if body.question_type       is not None: update["question_type"]       = body.question_type
    if body.order_num           is not None: update["order_num"]           = body.order_num
    if body.cue_card_bullets    is not None: update["cue_card_bullets"]    = body.cue_card_bullets
    if body.cue_card_reflection is not None: update["cue_card_reflection"] = body.cue_card_reflection

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
        raise HTTPException(500, f"Lỗi khi cập nhật question: {exc}")

    if not res.data:
        raise HTTPException(404, "Question không tồn tại")
    _touch_topic(topic_id)
    return res.data[0]


# ── DELETE /admin/topics/{topic_id}/questions/{question_id} ───────────────────

@router.delete("/topics/{topic_id}/questions/{question_id}", status_code=204)
async def delete_topic_question(
    topic_id: str,
    question_id: str,
    authorization: str | None = Header(default=None),
):
    await require_admin(authorization)
    try:
        supabase_admin.table("topic_questions").delete().eq("id", question_id).eq("topic_id", topic_id).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi xóa question: {exc}")
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
    mode = (body.mode if body else "replace_all").strip().lower()
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

    query = (
        supabase_admin.table("ai_usage_logs")
        .select("user_id, service, model, input_tokens, output_tokens, audio_seconds, text_chars, cost_usd_est, created_at", count="exact")
        .order("created_at", desc=True)
        .limit(10_000)   # safety cap; enough for an MVP
    )

    if days is not None:
        cutoff = (
            datetime.now(timezone.utc) - timedelta(days=days)
        ).isoformat()
        query = query.gte("created_at", cutoff)

    try:
        res = query.execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải AI usage: {exc}")

    logs = res.data or []
    total_matching = res.count if isinstance(res.count, int) else None
    capped_limit = 10_000
    truncated = bool(total_matching is not None and total_matching > len(logs))

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
    overall: dict = {"calls": 0, "cost_usd": 0.0, "by_service": {}}
    per_user: dict[str, dict] = {}

    for log in logs:
        uid  = log.get("user_id") or "unknown"
        svc  = log.get("service", "unknown")
        cost = float(log.get("cost_usd_est") or 0.0)

        # Overall
        overall["calls"] += 1
        overall["cost_usd"] = round(overall["cost_usd"] + cost, 6)
        if svc not in overall["by_service"]:
            overall["by_service"][svc] = {"calls": 0, "cost_usd": 0.0}
        overall["by_service"][svc]["calls"] += 1
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
            "total_matching_rows": total_matching,
            "truncated": truncated,
        },
    }


# ── GET /admin/sessions ────────────────────────────────────────────────────────

@router.get("/sessions")
async def admin_list_sessions(
    authorization: str | None = Header(default=None),
    user_id:    str | None = None,
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
    Supports filtering by user_id, mode, status, error_code, has_error, date range.
    Returns sessions enriched with user email.
    """
    await require_admin(authorization)

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
    if date_to:    q = q.lte("started_at", date_to + "T23:59:59Z")

    try:
        res = q.execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải sessions: {exc}")

    sessions = res.data or []

    # Enrich with user email
    uids = list({s["user_id"] for s in sessions if s.get("user_id")})
    email_map: dict[str, str] = {}
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
            pass

    for s in sessions:
        s["user_email"] = email_map.get(s.get("user_id") or "", "")

    return sessions


# ── GET /admin/sessions/{session_id} ──────────────────────────────────────────

@router.get("/sessions/{session_id}")
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
        raise HTTPException(500, f"Lỗi khi tải session: {exc}")

    if not s_res.data:
        raise HTTPException(404, "Session không tồn tại")

    session = s_res.data[0]

    # Enrich with user email
    uid = session.get("user_id")
    session["user_email"] = ""
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
            pass

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

    for response in responses:
        playback_url = _sign_storage_url(_REGRADE_AUDIO_BUCKET, response.get("audio_storage_path"))
        response["audio_playback_url"] = playback_url
        response["audio_available"] = bool(response.get("audio_playback_url"))

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
        raise HTTPException(500, f"Lỗi khi tải session errors: {exc}")

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
        raise HTTPException(500, f"Lỗi khi tải grading failures: {exc}")

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
        audio_path = resp.get("audio_storage_path")
        if not audio_path:
            raise HTTPException(422, f"Response {response_id}: không có transcript và không có audio path")
        try:
            audio_bytes = await asyncio.to_thread(
                supabase_admin.storage.from_(_REGRADE_AUDIO_BUCKET).download,
                audio_path,
            )
        except Exception as e:
            raise HTTPException(502, f"Response {response_id}: không thể tải audio — {e}")

        ext = ("." + audio_path.rsplit(".", 1)[-1]) if "." in audio_path else ".webm"
        stt = await transcribe_from_bytes(audio_bytes, filename=f"audio{ext}")
        transcript = stt.get("transcript", "").strip()
        if not transcript:
            raise HTTPException(422, f"Response {response_id}: Whisper không nhận dạng được giọng nói")
        word_count = len(transcript.split())
        re_transcribed = True

    reliability = {"reliability_label": "high", "reliability_score": 0.9}
    grading = await _claude_grade(
        question=question_text,
        transcript=transcript,
        part=part,
        mode=mode,
        user_id=user_id,
        session_id=resp["session_id"],
        reliability=reliability,
        word_count=word_count,
    )
    grading = _regrade_apply_heuristic_caps(grading, word_count, part)

    now = datetime.now(timezone.utc).isoformat()
    old_count = resp.get("regrade_count") or 0

    update: dict = {
        "feedback":           json.dumps(grading, ensure_ascii=False),
        "overall_band":       grading["overall_band"],
        "grading_status":     "completed",
        # Clear stale pronunciation-adjusted fields — the new AI grade supersedes them.
        # User must re-run pronunciation assessment to get updated adjusted scores.
        "final_band_p":       None,
        "final_overall_band": None,
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

@router.post("/responses/{response_id}/regrade")
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
        .select("id, session_id, question_id, transcript, audio_storage_path, grading_status, regrade_count")
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
        .select("id, part, mode, user_id")
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

    session_id = resp["session_id"]
    logger.info("[admin/regrade-response] response=%s session=%s by=%s", response_id, session_id, admin_email)

    result = await _run_regrade_response(resp, session, question_text, admin_email)

    # Recompute and persist session-level bands so Session History reflects the update.
    # Use the same canonical gate as complete_session(): only block if ALL band values are None.
    bands = _regrade_compute_session_bands(session_id)
    session_updated = False
    all_band_vals = [bands.get("overall_band")] + [
        bands.get(k) for k in ("band_fc", "band_lr", "band_gra", "band_p")
    ]
    if not all(v is None for v in all_band_vals):
        now = datetime.now(timezone.utc).isoformat()
        sess_update: dict = {
            **bands,
            "status": "completed",
            "error_code": None,
            "error_message": None,
            "failed_step": None,
            "last_error_at": None,
        }
        try:
            supabase_admin.table("sessions").update({
                **sess_update,
                "last_regraded_at": now,
                "last_regraded_by": admin_email,
            }).eq("id", session_id).execute()
        except Exception:
            supabase_admin.table("sessions").update(sess_update).eq("id", session_id).execute()
        session_updated = True
        logger.info("[admin/regrade-response] session bands updated session=%s overall_band=%s", session_id, bands["overall_band"])

    return {
        "ok":              True,
        "response_id":     response_id,
        "session_id":      session_id,
        "overall_band":    result["overall_band"],
        "re_transcribed":  result["re_transcribed"],
        "session_updated": session_updated,
        "session_band":    bands["overall_band"],
    }


# ── POST /admin/sessions/{session_id}/regrade ─────────────────────────────────

@router.post("/sessions/{session_id}/regrade")
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
        .select("id, part, mode, user_id, status")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )
    if not s_res.data:
        raise HTTPException(404, "Session không tồn tại")
    session = s_res.data[0]

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
        .select("id, session_id, question_id, transcript, audio_storage_path, grading_status, overall_band, regrade_count")
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
        except Exception as exc:
            failed_ids.append(resp["id"])
            failed_errors.append(f"{resp['id']}: {exc}")

    # force=True with any failures: the session contains a mix of fresh and stale
    # scores — do NOT finalize it as a clean completed session.
    force_partial_failure = force and len(failed_ids) > 0

    # Recompute session-level bands from all responses (including already-good ones)
    bands = _regrade_compute_session_bands(session_id)
    now = datetime.now(timezone.utc).isoformat()

    if force_partial_failure:
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
    except Exception:
        supabase_admin.table("sessions").update(session_update).eq("id", session_id).execute()

    return {
        "ok":               not force_partial_failure,
        "partial_failure":  force_partial_failure,
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

@router.post("/sessions/{session_id}/rebuild-summary")
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
        .select("id, mode, status")
        .in_("id", all_ids)
        .execute()
    )
    found_ids = {s["id"] for s in (s_res.data or [])}
    missing = [sid for sid in all_ids if sid not in found_ids]
    if missing:
        raise HTTPException(404, f"Session không tồn tại: {missing}")

    logger.info("[admin/rebuild-summary] sessions=%s by=%s", all_ids, admin_email)

    now = datetime.now(timezone.utc).isoformat()
    results = []

    for sid in all_ids:
        bands = _regrade_compute_session_bands(sid)
        if bands["overall_band"] is None:
            results.append({"session_id": sid, "ok": False, "error": "Không có đủ dữ liệu response để tính band"})
            continue

        sess_update: dict = {
            **bands,
            "status": "completed",
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

        results.append({"session_id": sid, "ok": True, **bands})

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
        raise HTTPException(404, f"User not found: {exc}")

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
# Phase D Wave 2 rich-content backfill.  Fills user_vocabulary.ipa and
# user_vocabulary.example_sentence for rows where either is NULL.  Uses the
# same Gemini batch service that the inline Phase B extractor uses, so the
# prompt + validation stays in one place.
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


def _backfill_run(job_id: str, limit: int) -> None:
    """
    Background task: enrich up to `limit` user_vocabulary rows missing IPA
    or example_sentence.  Runs synchronously inside FastAPI's BG worker —
    no asyncio dependencies, all Supabase calls are blocking.
    """
    from services.vocab_enrichment import enrich_vocabulary_batch, VocabEnrichmentError

    try:
        # Day 1 dogfood: idioms + multi-word phrases were arriving with
        # NULL definition_vi from the extractor.  Widen the candidate query
        # so we re-enrich rows whose definitions are missing too — Gemini
        # now generates Vietnamese + English glosses alongside IPA/example.
        rows_res = (
            supabase_admin.table("user_vocabulary")
            .select("id, headword")
            .eq("is_archived", False)
            .or_(
                "ipa.is.null,"
                "example_sentence.is.null,"
                "definition_vi.is.null,"
                "definition_en.is.null"
            )
            .limit(limit)
            .execute()
        )
    except Exception as e:
        logger.error("[backfill %s] candidate query failed: %s", job_id, e)
        return

    rows = rows_res.data or []
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
        # Build the UPDATE payload from whichever fields the enricher returned.
        # Required fields (ipa, example_sentence) are guaranteed by the
        # validator; optional fields (definition_vi, definition_en) are only
        # included when Gemini supplied them, so we never blank an existing
        # row's definition by writing NULL over it.
        payload: dict = {
            "ipa": e["ipa"],
            "example_sentence": e["example_sentence"],
        }
        if e.get("definition_vi"):
            payload["definition_vi"] = e["definition_vi"]
        if e.get("definition_en"):
            payload["definition_en"] = e["definition_en"]
        for row in group_rows:
            try:
                supabase_admin.table("user_vocabulary").update(payload) \
                    .eq("id", row["id"]).execute()
                updated += 1
            except Exception as upd_err:
                logger.warning(
                    "[backfill %s] update failed for row=%s: %s",
                    job_id, row["id"], upd_err,
                )

    logger.info(
        "[backfill %s] done: enriched %d unique words → updated %d/%d rows",
        job_id, len(enrich_map), updated, len(rows),
    )


@router.post("/vocab/backfill-enrichment")
async def backfill_vocab_enrichment(
    background_tasks: BackgroundTasks,
    limit: int = Query(default=100, ge=1, le=500),
    authorization: str | None = Header(default=None),
):
    """
    Trigger a background job that enriches user_vocabulary rows missing
    `ipa` or `example_sentence` (i.e. rows that pre-date migration 029
    or whose Gemini call failed during Phase B extraction).

    Caps at 500/call so an admin can't accidentally fan out across the
    whole bank in one click.  Re-run the endpoint to process the next
    batch — the WHERE clause naturally moves forward as rows get filled.

    Cost estimate is best-effort: Gemini Flash batch is ~$0.0005 per
    chunk of 10 unique words.
    """
    await require_admin(authorization)
    job_id = _uuid.uuid4().hex[:12]
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
        raise HTTPException(500, f"Update failed: {exc}")

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
        raise HTTPException(500, f"Soft delete failed: {exc}")
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
            raise HTTPException(409, f"Override for '{insert['original_word']}' already exists.")
        raise HTTPException(500, f"Create failed: {exc}")

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
        raise HTTPException(500, f"Delete failed: {exc}")

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
        raise HTTPException(500, f"grammar service unavailable: {exc}")

    articles = list((grammar_service.articles_by_slug or {}).values())

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
    if slugs:
        try:
            v_res = (
                supabase_admin.table("article_views")
                .select("article_slug, view_count")
                .in_("article_slug", slugs)
                .execute()
            )
            for row in (v_res.data or []):
                s = row.get("article_slug")
                if not s:
                    continue
                view_count[s] = view_count.get(s, 0) + int(row.get("view_count") or 0)
        except Exception as exc:
            logger.warning("[admin] grammar view aggregate failed: %s", exc)
        try:
            s_res = (
                supabase_admin.table("saved_articles")
                .select("article_slug")
                .in_("article_slug", slugs)
                .execute()
            )
            for row in (s_res.data or []):
                s = row.get("article_slug")
                if not s:
                    continue
                save_count[s] = save_count.get(s, 0) + 1
        except Exception as exc:
            logger.warning("[admin] grammar save aggregate failed: %s", exc)

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
            "view_count":    view_count.get(slug, 0),
            "save_count":    save_count.get(slug, 0),
            "source_path":   f"backend/content/{a.get('category', '')}/{slug}.md",
        })

    items.sort(key=lambda r: (r.get("category") or "", r.get("order") or 999, r.get("title") or ""))

    categories = sorted({a.get("category") for a in articles if a.get("category")})

    return {
        "items":      items,
        "total":      len(items),
        "categories": categories,
    }


@router.get("/grammar/articles/{slug}/preview")
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
        raise HTTPException(500, f"grammar service unavailable: {exc}")

    article = grammar_service.get_article_by_slug(slug)
    if not article:
        raise HTTPException(404, f"Article '{slug}' not found")
    return article


@router.get("/grammar/analytics")
async def admin_grammar_analytics(
    days: int = Query(default=7, ge=1, le=90),
    authorization: str | None = Header(default=None),
):
    """Aggregate views + saves for the admin grammar analytics page.

    Returns:
      - views_total              (sum of view_count across article_views)
      - views_recent             (sum where last_viewed_at >= now-days)
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
        raise HTTPException(500, f"grammar service unavailable: {exc}")

    all_slugs = set((grammar_service.articles_by_slug or {}).keys())
    title_by_slug = {
        s: (a.get("title") or s)
        for s, a in (grammar_service.articles_by_slug or {}).items()
    }
    cat_by_slug = {
        s: (a.get("category") or "")
        for s, a in (grammar_service.articles_by_slug or {}).items()
    }

    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    views_per_slug: dict[str, int] = {}
    views_recent_per_slug: dict[str, int] = {}
    try:
        # Pull all view rows. Set is small (~thousands at most for current scale)
        # so a single fetch + Python aggregation is cheaper than a SQL view.
        v_res = (
            supabase_admin.table("article_views")
            .select("article_slug, view_count, last_viewed_at")
            .execute()
        )
        for row in (v_res.data or []):
            s = row.get("article_slug")
            if not s:
                continue
            n = int(row.get("view_count") or 0)
            views_per_slug[s] = views_per_slug.get(s, 0) + n
            last = row.get("last_viewed_at") or ""
            if last >= cutoff:
                views_recent_per_slug[s] = views_recent_per_slug.get(s, 0) + n
    except Exception as exc:
        logger.warning("[admin] grammar views fetch failed: %s", exc)

    saves_per_slug: dict[str, int] = {}
    try:
        s_res = (
            supabase_admin.table("saved_articles")
            .select("article_slug")
            .execute()
        )
        for row in (s_res.data or []):
            s = row.get("article_slug")
            if not s:
                continue
            saves_per_slug[s] = saves_per_slug.get(s, 0) + 1
    except Exception as exc:
        logger.warning("[admin] grammar saves fetch failed: %s", exc)

    def _decorate(slug: str, count: int) -> dict:
        return {
            "slug":     slug,
            "title":    title_by_slug.get(slug, slug),
            "category": cat_by_slug.get(slug, ""),
            "count":    count,
        }

    top_viewed = sorted(views_per_slug.items(), key=lambda kv: kv[1], reverse=True)[:20]
    top_saved  = sorted(saves_per_slug.items(), key=lambda kv: kv[1], reverse=True)[:5]

    seen_slugs = set(views_per_slug.keys())
    zero_view_slugs = sorted(all_slugs - seen_slugs)[:30]

    return {
        "views_total":      sum(views_per_slug.values()),
        "views_recent":     sum(views_recent_per_slug.values()),
        "saves_total":      sum(saves_per_slug.values()),
        "articles_total":   len(all_slugs),
        "top_viewed":       [_decorate(s, c) for s, c in top_viewed],
        "top_saved":        [_decorate(s, c) for s, c in top_saved],
        "zero_view_slugs":  [_decorate(s, 0) for s in zero_view_slugs],
        "zero_view_total":  len(all_slugs - seen_slugs),
        "days":             days,
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
        raise HTTPException(500, f"grammar service unavailable: {exc}")

    issue = payload.issue.strip()
    if not issue:
        raise HTTPException(400, "issue must be non-empty")

    match = grammar_service.find_best_match(issue)
    if not match:
        return {"issue": issue, "match": None}

    full = grammar_service.get_article_by_slug(match.get("slug") or "")
    return {
        "issue": issue,
        "match": {
            "slug":     match.get("slug"),
            "category": match.get("category"),
            "title":    match.get("title"),
            "score":    match.get("score"),
            "summary":  (full or {}).get("summary"),
            "url":      f"/pages/grammar-article.html?slug={match.get('slug')}",
        },
    }

