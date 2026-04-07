"""
routers/admin.py — Admin-only management endpoints

All routes under /admin/ require role = "admin" in the users table.

Required Supabase table (run once if not yet created):

    CREATE TABLE IF NOT EXISTS topics (
        id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        title       text        NOT NULL,
        category    text        NOT NULL DEFAULT '',
        part        smallint    NOT NULL CHECK (part IN (1, 2, 3)),
        is_active   boolean     NOT NULL DEFAULT true,
        created_at  timestamptz NOT NULL DEFAULT now()
    );
"""

import logging
import random
import string
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from database import supabase_admin
from routers.auth import get_supabase_user

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
    count: int = Field(ge=1, le=100, description="Số mã cần tạo (1–100)")


class CreateTopicRequest(BaseModel):
    title:    str
    category: str = ""
    part:     int = Field(ge=1, le=3)


class PatchTopicRequest(BaseModel):
    title:     str | None = None
    category:  str | None = None
    part:      int | None = Field(default=None, ge=1, le=3)
    is_active: bool | None = None


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
    rows  = [{"code": c, "is_used": False} for c in codes]

    try:
        result = supabase_admin.table("access_codes").insert(rows).execute()
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tạo access codes: {exc}")

    return {"created": len(result.data or rows), "codes": codes}


# ── GET /admin/access-codes ────────────────────────────────────────────────────

@router.get("/access-codes")
async def list_access_codes(authorization: str | None = Header(default=None)):
    """List all access codes, enriched with the email of the user who used each one."""
    await require_admin(authorization)

    try:
        codes_res = (
            supabase_admin.table("access_codes")
            .select("id, code, is_used, used_by, used_at, created_at")
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi tải access codes: {exc}")

    codes = codes_res.data or []

    # Enrich: look up email for each used_by user_id
    user_ids = list({c["used_by"] for c in codes if c.get("used_by")})
    email_map: dict[str, str] = {}
    if user_ids:
        try:
            users_res = (
                supabase_admin.table("users")
                .select("id, email")
                .in_("id", user_ids)
                .execute()
            )
            for u in (users_res.data or []):
                email_map[u["id"]] = u.get("email") or ""
        except Exception:
            pass

    for c in codes:
        c["used_by_email"] = email_map.get(c.get("used_by") or "", None)

    return codes


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
