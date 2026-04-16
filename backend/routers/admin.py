"""
routers/admin.py — Admin-only management endpoints

All routes under /admin/ require role = "admin" in the users table.

Required Supabase tables (run migration 002 if not yet applied):
    See backend/migrations/002_topic_question_library.sql
"""

import logging
import random
import string
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from database import supabase_admin
from routers.auth import get_supabase_user
from services.gemini import (
    generate_part1_questions,
    generate_part2_cuecard,
    generate_part3_questions,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


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


class CreateTopicRequest(BaseModel):
    title:    str
    category: str = ""   # kept for DB compat, not shown in UI
    part:     int = Field(ge=1, le=3)


class PatchTopicRequest(BaseModel):
    title:     str | None = None
    part:      int | None = Field(default=None, ge=1, le=3)
    is_active: bool | None = None


class BulkAddTopicsRequest(BaseModel):
    part:  int = Field(ge=1, le=3)
    lines: str  # newline-separated topic titles


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

    # Count active assignments per code
    assigned_counts: dict[str, int] = {}
    try:
        asgn_res = (
            supabase_admin.table("user_code_assignments")
            .select("code_id")
            .in_("code_id", code_ids)
            .eq("is_active", True)
            .execute()
        )
        for row in (asgn_res.data or []):
            cid = row["code_id"]
            assigned_counts[cid] = assigned_counts.get(cid, 0) + 1
    except Exception:
        pass

    for c in codes:
        c["assigned_user_count"] = assigned_counts.get(c["id"], 0)

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

    # Enrich with user emails
    user_ids = [a["user_id"] for a in assignments]
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
                user_map[u["id"]] = {"email": u.get("email", ""), "display_name": u.get("display_name", "")}
        except Exception:
            pass

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

    return res.data or []


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

    return res.data[0]


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

    return res.data[0]


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

    return {"created": len(res.data or []), "topics": res.data or []}


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


# ── POST /admin/topics/{topic_id}/generate-questions ──────────────────────────

@router.post("/topics/{topic_id}/generate-questions")
async def generate_topic_questions(
    topic_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Gọi Gemini để tạo câu hỏi cho topic và lưu vào library.
    - Part 1 topic → tạo 7 câu hỏi Part 1
    - Part 2 topic → tạo 1 cue card (Part 2) + 5 câu hỏi Part 3 liên quan
    Xóa questions cũ trước khi lưu mới (regenerate).
    """
    auth_user = await require_admin(authorization)

    try:
        t_res = supabase_admin.table("topics").select("id, title, part").eq("id", topic_id).limit(1).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải topic: {exc}")

    if not t_res.data:
        raise HTTPException(404, "Topic không tồn tại")

    topic = t_res.data[0]
    title = topic["title"]
    part  = topic["part"]
    user_id = auth_user["id"]

    # Delete existing library questions for this topic
    try:
        supabase_admin.table("topic_questions").delete().eq("topic_id", topic_id).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi xóa questions cũ: {exc}")

    rows: list[dict] = []

    if part == 1:
        qs = await generate_part1_questions(title, count=7, user_id=user_id)
        for i, q in enumerate(qs):
            rows.append({
                "topic_id":     topic_id,
                "part":         1,
                "order_num":    i + 1,
                "question_text":  q["question_text"],
                "question_type":  q.get("question_type", "personal"),
            })

    elif part == 2:
        # Cue card
        cuecard = await generate_part2_cuecard(title, user_id=user_id)
        rows.append({
            "topic_id":            topic_id,
            "part":                2,
            "order_num":           1,
            "question_text":       cuecard["question_text"],
            "question_type":       "cuecard",
            "cue_card_bullets":    cuecard.get("cue_card_bullets"),
            "cue_card_reflection": cuecard.get("cue_card_reflection"),
        })
        # Part 3 linked questions
        p3qs = await generate_part3_questions(title, count=5, user_id=user_id)
        for i, q in enumerate(p3qs):
            rows.append({
                "topic_id":     topic_id,
                "part":         3,
                "order_num":    i + 1,
                "question_text":  q["question_text"],
                "question_type":  q.get("question_type", "opinion"),
            })

    elif part == 3:
        qs = await generate_part3_questions(title, count=5, user_id=user_id)
        for i, q in enumerate(qs):
            rows.append({
                "topic_id":     topic_id,
                "part":         3,
                "order_num":    i + 1,
                "question_text":  q["question_text"],
                "question_type":  q.get("question_type", "opinion"),
            })

    if rows:
        try:
            supabase_admin.table("topic_questions").insert(rows).execute()
        except Exception as exc:
            raise HTTPException(500, f"Lỗi khi lưu questions: {exc}")

    # Update last_rotated_at
    try:
        supabase_admin.table("topics").update(
            {"last_rotated_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", topic_id).execute()
    except Exception:
        pass

    # Return all saved questions
    try:
        saved = (
            supabase_admin.table("topic_questions")
            .select("*")
            .eq("topic_id", topic_id)
            .order("part")
            .order("order_num")
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải questions đã lưu: {exc}")

    return {"topic_id": topic_id, "questions": saved.data or []}


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
        .select("user_id, service, model, input_tokens, output_tokens, "
                "audio_seconds, text_chars, cost_usd_est, created_at")
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
            .filter("error_code", "not.is", "null")
            .order("last_error_at", desc=True)
            .limit(limit)
            .execute()
        )
        session_errors = se_res.data or []
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải session errors: {exc}")

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
