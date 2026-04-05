from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel, field_validator

from config import settings
from database import supabase_admin
from routers.auth import get_supabase_user

router = APIRouter(prefix="/sessions", tags=["sessions"])

_VALID_MODES = {"practice", "test_part", "test_full"}


# ── Request models ─────────────────────────────────────────────────────────────

class CreateSessionBody(BaseModel):
    mode: str
    part: int
    topic: str

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v):
        if v not in _VALID_MODES:
            raise ValueError(f"mode phải là một trong: {sorted(_VALID_MODES)}")
        return v

    @field_validator("part")
    @classmethod
    def validate_part(cls, v):
        if v not in (1, 2, 3):
            raise ValueError("part phải là 1, 2, hoặc 3")
        return v

    @field_validator("topic")
    @classmethod
    def validate_topic(cls, v):
        if not v.strip():
            raise ValueError("topic không được để trống")
        return v.strip()


# ── Shared guard: user must be active ─────────────────────────────────────────

def _require_active(user_id: str) -> None:
    try:
        r = (
            supabase_admin.table("users")
            .select("is_active")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi kiểm tra tài khoản: {e}")

    if not r.data or not r.data[0].get("is_active"):
        raise HTTPException(status_code=403, detail="Tài khoản chưa được kích hoạt")


# ── POST /sessions ─────────────────────────────────────────────────────────────

@router.post("")
async def create_session(
    body: CreateSessionBody,
    authorization: str | None = Header(default=None),
):
    """
    Tạo session mới. Yêu cầu tài khoản đã được kích hoạt (is_active=true).
    Giới hạn MAX_SESSIONS_PER_USER_PER_DAY session mỗi ngày.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    _require_active(user_id)

    # Daily quota check — count sessions started today (UTC)
    today_start = (
        datetime.combine(date.today(), datetime.min.time())
        .replace(tzinfo=timezone.utc)
        .isoformat()
    )
    try:
        daily = (
            supabase_admin.table("sessions")
            .select("id")
            .eq("user_id", user_id)
            .gte("started_at", today_start)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi kiểm tra quota: {e}")

    if len(daily.data) >= settings.MAX_SESSIONS_PER_USER_PER_DAY:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Bạn đã đạt giới hạn {settings.MAX_SESSIONS_PER_USER_PER_DAY} "
                f"sessions hôm nay. Hãy thử lại vào ngày mai."
            ),
        )

    # Create session
    try:
        result = (
            supabase_admin.table("sessions")
            .insert({
                "user_id": user_id,
                "mode": body.mode,
                "part": body.part,
                "topic": body.topic,
                "status": "in_progress",
            })
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không thể tạo session: {e}")

    s = result.data[0]
    return {
        "session_id": s["id"],
        "mode":       s["mode"],
        "part":       s["part"],
        "topic":      s["topic"],
        "started_at": s["started_at"],
        "status":     s["status"],
    }


# ── GET /sessions ──────────────────────────────────────────────────────────────

@router.get("")
async def list_sessions(
    authorization: str | None = Header(default=None),
    status: Optional[str] = Query(default=None, description="Lọc theo status: in_progress | completed"),
    part: Optional[int] = Query(default=None, description="Lọc theo part: 1 | 2 | 3"),
):
    """Trả 20 sessions gần nhất của user, tùy chọn lọc theo status và part."""
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    try:
        q = (
            supabase_admin.table("sessions")
            .select("*")
            .eq("user_id", user_id)
            .order("started_at", desc=True)
            .limit(20)
        )
        if status is not None:
            q = q.eq("status", status)
        if part is not None:
            q = q.eq("part", part)

        result = q.execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không thể tải sessions: {e}")

    return result.data


# ── GET /sessions/{session_id} ─────────────────────────────────────────────────

@router.get("/{session_id}")
async def get_session(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """Trả chi tiết session kèm danh sách questions và responses."""
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    # Fetch session (ownership enforced by eq user_id)
    try:
        s_result = (
            supabase_admin.table("sessions")
            .select("*")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi tải session: {e}")

    if not s_result.data:
        raise HTTPException(status_code=404, detail="Session không tồn tại")

    session = s_result.data[0]

    # Questions for this session
    try:
        q_result = (
            supabase_admin.table("questions")
            .select("*")
            .eq("session_id", session_id)
            .order("order_num")
            .execute()
        )
        questions = q_result.data
    except Exception:
        questions = []

    # Responses for this session
    try:
        r_result = (
            supabase_admin.table("responses")
            .select("*")
            .eq("session_id", session_id)
            .execute()
        )
        responses = r_result.data
    except Exception:
        responses = []

    return {
        **session,
        "session_id": session["id"],   # alias so frontend can use either field
        "questions":  questions,
        "responses":  responses,
    }


# ── PATCH /sessions/{session_id}/complete ──────────────────────────────────────

@router.patch("/{session_id}/complete")
async def complete_session(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Đánh dấu session hoàn thành.
    Tự động tính overall_band = trung bình của các band score != null
    (band_fc, band_lr, band_gra, band_p đã được cập nhật bởi scoring endpoint trước đó).
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    try:
        s_result = (
            supabase_admin.table("sessions")
            .select("*")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi tải session: {e}")

    if not s_result.data:
        raise HTTPException(status_code=404, detail="Session không tồn tại")

    session = s_result.data[0]

    if session["status"] == "completed":
        # Idempotent: already done — return current state so the frontend can continue safely.
        return {**session, "session_id": session["id"]}

    # overall_band = mean of whichever band scores are not null
    raw_bands = [session.get(k) for k in ("band_fc", "band_lr", "band_gra", "band_p")]
    scored = [b for b in raw_bands if b is not None]
    overall_band = round(sum(scored) / len(scored), 1) if scored else None

    try:
        result = (
            supabase_admin.table("sessions")
            .update({
                "status": "completed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "overall_band": overall_band,
            })
            .eq("id", session_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không thể hoàn thành session: {e}")

    completed = result.data[0]
    return {**completed, "session_id": completed["id"]}
