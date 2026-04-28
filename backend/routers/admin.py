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
import uuid as _uuid
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from config import settings
from database import supabase_admin
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


# ── Helpers ────────────────────────────────────────────────────────────────────

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


class PatchCodeRequest(BaseModel):
    permissions:   list[str] | None = None
    session_limit: int | None       = None
    expires_at:    str | None       = None
    is_active:     bool | None      = None


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
    await require_admin(authorization)

    codes = [_gen_code() for _ in range(body.count)]
    row_base: dict = {"is_used": False, "is_active": True, "permissions": body.permissions}
    if body.session_limit is not None:
        row_base["session_limit"] = body.session_limit
    if body.expires_at is not None:
        row_base["expires_at"] = body.expires_at
    rows = [{**row_base, "code": c} for c in codes]

    try:
        result = supabase_admin.table("access_codes").insert(rows).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tạo access codes: {exc}")

    return {"created": len(result.data or rows), "codes": codes}


# ── GET /admin/access-codes ────────────────────────────────────────────────────

@router.get("/access-codes")
async def list_access_codes(authorization: str | None = Header(default=None)):
    """List all access codes, enriched with assigned user count."""
    await require_admin(authorization)

    try:
        codes_res = (
            supabase_admin.table("access_codes")
            .select("id, code, is_used, is_revoked, is_active, used_by, used_at, created_at, permissions, session_limit, expires_at")
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải access codes: {exc}")

    codes = codes_res.data or []

    if not codes:
        return codes

    code_ids = [c["id"] for c in codes]

    # Fetch active assignments (user_id + code_id) in one query; derive count + identity.
    code_user_ids: dict[str, list[str]] = {}  # code_id → [user_id, ...]
    try:
        asgn_res = (
            supabase_admin.table("user_code_assignments")
            .select("code_id, user_id")
            .in_("code_id", code_ids)
            .eq("is_active", True)
            .execute()
        )
        for row in (asgn_res.data or []):
            cid = row["code_id"]
            code_user_ids.setdefault(cid, []).append(row["user_id"])
    except Exception as exc:
        logger.warning("list_access_codes: assignment lookup failed: %s", exc)
        for c in codes:
            c["association_lookup_failed"] = True
        return codes

    # Fallback: codes with used_by set but no active assignment rows (pre-migration data).
    fallback_uid: dict[str, str] = {}  # code_id → used_by user_id
    for c in codes:
        if not code_user_ids.get(c["id"]) and c.get("is_used") and c.get("used_by"):
            fallback_uid[c["id"]] = c["used_by"]

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

    for c in codes:
        uids = code_user_ids.get(c["id"], [])
        if uids:
            c["assigned_user_count"] = len(uids)
            c["assigned_users"] = [
                dict(user_info.get(uid, {"user_id": uid, "name": "", "email": ""}),
                     is_fallback_used_by=False, removable=True)
                for uid in uids
            ]
        elif c["id"] in fallback_uid:
            # Legacy: code was redeemed but no assignment row exists.
            # Show the redeemer but do not offer a remove action — there is no row to deactivate.
            uid = fallback_uid[c["id"]]
            c["assigned_user_count"] = 1
            c["assigned_users"] = [
                dict(user_info.get(uid, {"user_id": uid, "name": "", "email": ""}),
                     is_fallback_used_by=True, removable=False)
            ]
        else:
            c["assigned_user_count"] = 0
            c["assigned_users"] = []

    return codes


# ── PATCH /admin/access-codes/{code_id} ───────────────────────────────────────

@router.patch("/access-codes/{code_id}")
async def patch_access_code(
    code_id: str,
    body: PatchCodeRequest,
    authorization: str | None = Header(default=None),
):
    """Update permissions on an existing access code."""
    await require_admin(authorization)

    # Use model_fields_set to distinguish "field omitted" vs "field set to null"
    set_fields = body.model_fields_set
    update: dict = {}
    if "permissions"   in set_fields: update["permissions"]   = body.permissions
    if "session_limit" in set_fields: update["session_limit"] = body.session_limit
    if "expires_at"    in set_fields: update["expires_at"]    = body.expires_at
    if "is_active"     in set_fields: update["is_active"]     = body.is_active

    if not update:
        raise HTTPException(400, "Không có trường nào để cập nhật")

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
    await require_admin(authorization)

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
    await require_admin(authorization)

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
    await require_admin(authorization)

    # Verify code exists
    try:
        code_res = (
            supabase_admin.table("access_codes")
            .select("id")
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
        rows_res = (
            supabase_admin.table("user_vocabulary")
            .select("id, headword")
            .eq("is_archived", False)
            .or_("ipa.is.null,example_sentence.is.null")
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
        for row in group_rows:
            try:
                supabase_admin.table("user_vocabulary").update({
                    "ipa": e["ipa"],
                    "example_sentence": e["example_sentence"],
                }).eq("id", row["id"]).execute()
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
