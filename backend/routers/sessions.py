import json
import logging
import math
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Query
from pydantic import BaseModel, field_validator

from config import settings
from database import supabase_admin
from routers.auth import get_supabase_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sessions", tags=["sessions"])

_VALID_MODES   = {"practice", "test_part", "test_full"}
_AUDIO_BUCKET  = "audio-responses"
_SIGNED_URL_TTL = 3600   # 1 hour


def _round_band(value: float) -> float:
    """Round to nearest 0.5 — IELTS display convention. Clamps to [1.0, 9.0]."""
    rounded = math.floor(value * 2 + 0.5) / 2
    return max(1.0, min(9.0, rounded))

# Maps session mode → required permission scope
_MODE_SCOPE: dict[str, str] = {
    "practice":  "practice_single",
    "test_part": "practice_part",
    "test_full": "practice_full",
}


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


# ── Shared guards ─────────────────────────────────────────────────────────────

def _require_permission(user_id: str, mode: str) -> None:
    """Assert user holds the scope required for the requested session mode."""
    required = _MODE_SCOPE.get(mode)
    if not required:
        return  # unknown mode — field_validator above will reject it first

    try:
        r = (
            supabase_admin.table("users")
            .select("permissions")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi kiểm tra quyền: {e}")

    perms: list = (r.data[0].get("permissions") or []) if r.data else []

    if "all" in perms or required in perms:
        return

    raise HTTPException(
        status_code=403,
        detail=f"Tài khoản không có quyền sử dụng chế độ này (cần: {required})",
    )


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
    _require_permission(user_id, body.mode)

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
    limit: int = Query(default=20, ge=1, le=200, description="Số lượng sessions tối đa trả về"),
):
    """Trả sessions gần nhất của user, tùy chọn lọc theo status và part."""
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    try:
        q = (
            supabase_admin.table("sessions")
            .select("*")
            .eq("user_id", user_id)
            .order("started_at", desc=True)
            .limit(limit)
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


# ── GET /sessions/{session_id}/audio-urls ─────────────────────────────────────

@router.get("/{session_id}/audio-urls")
async def get_session_audio_urls(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Trả signed URL (1 giờ) cho tất cả audio recordings trong session.
    Chỉ user sở hữu session (hoặc admin) mới truy cập được.

    Strategy:
    - Bucket "audio-responses" là public (Supabase default, paths gồm UUIDs khó đoán).
    - Endpoint này generate signed URL qua backend đã xác thực, thêm lớp expiry-based
      access control trên đầu. Old sessions không có audio_storage_path sẽ trả về
      public URL thẳng (backwards-compatible fallback).
    - Frontend dùng URL này để phát và tải audio; không expose public URL trực tiếp.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    # Ownership check
    try:
        s_res = (
            supabase_admin.table("sessions")
            .select("id")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi tải session: {e}")

    if not s_res.data:
        raise HTTPException(404, "Session không tồn tại hoặc không có quyền truy cập")

    # Fetch responses — select only what we need (no full feedback blob)
    try:
        r_res = (
            supabase_admin.table("responses")
            .select("id, question_id, audio_storage_path, audio_url")
            .eq("session_id", session_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi tải responses: {e}")

    result = []
    for r in (r_res.data or []):
        path = r.get("audio_storage_path")
        signed_url: str | None = None

        if path:
            try:
                resp = supabase_admin.storage.from_(_AUDIO_BUCKET).create_signed_url(
                    path, _SIGNED_URL_TTL
                )
                # supabase-py v2 returns an object with .data dict
                if hasattr(resp, "data") and resp.data:
                    signed_url = resp.data.get("signedUrl") or resp.data.get("signedURL")
                elif isinstance(resp, dict):
                    signed_url = resp.get("signedUrl") or resp.get("signedURL")
            except Exception as e:
                logger.warning("[audio-urls] Signed URL failed for path=%s: %s", path, e)

        if not signed_url:
            # Fallback: use stored public URL (old sessions or signed URL error)
            signed_url = r.get("audio_url")

        if signed_url:
            result.append({
                "response_id": r["id"],
                "question_id": r["question_id"],
                "url":         signed_url,
                "expires_in":  _SIGNED_URL_TTL if path else None,
            })

    return result


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

    # overall_band = mean of whichever criterion bands are not null (test mode)
    raw_bands = [session.get(k) for k in ("band_fc", "band_lr", "band_gra", "band_p")]
    scored = [b for b in raw_bands if b is not None]
    overall_band = _round_band(sum(scored) / len(scored)) if scored else None

    # Criterion bands are never written by the grading route — compute them from responses.feedback
    criteria_bands: dict[str, float | None] = {
        "band_fc": None, "band_lr": None, "band_gra": None, "band_p": None
    }
    try:
        r_res = (
            supabase_admin.table("responses")
            .select("overall_band, feedback")
            .eq("session_id", session_id)
            .execute()
        )
        responses = r_res.data or []

        # overall_band fallback (practice mode has no criterion bands)
        if overall_band is None:
            r_bands = [
                r["overall_band"] for r in responses
                if r.get("overall_band") is not None
            ]
            if r_bands:
                overall_band = _round_band(sum(r_bands) / len(r_bands))

        # Parse feedback JSON to aggregate criterion bands (test mode)
        fc_vals, lr_vals, gra_vals, p_vals = [], [], [], []
        for r in responses:
            raw = r.get("feedback")
            if not raw:
                continue
            try:
                fb = json.loads(raw) if isinstance(raw, str) else raw
            except (json.JSONDecodeError, TypeError):
                continue
            if isinstance(fb, dict):
                for vals, key in (
                    (fc_vals,  "band_fc"),
                    (lr_vals,  "band_lr"),
                    (gra_vals, "band_gra"),
                    (p_vals,   "band_p"),
                ):
                    v = fb.get(key)
                    if v is not None:
                        try:
                            vals.append(float(v))
                        except (TypeError, ValueError):
                            pass

        if fc_vals:  criteria_bands["band_fc"]  = _round_band(sum(fc_vals)  / len(fc_vals))
        if lr_vals:  criteria_bands["band_lr"]  = _round_band(sum(lr_vals)  / len(lr_vals))
        if gra_vals: criteria_bands["band_gra"] = _round_band(sum(gra_vals) / len(gra_vals))
        if p_vals:   criteria_bands["band_p"]   = _round_band(sum(p_vals)   / len(p_vals))

    except Exception:
        pass  # best-effort — leave all bands as None

    try:
        result = (
            supabase_admin.table("sessions")
            .update({
                "status":       "completed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "overall_band": overall_band,
                **{k: v for k, v in criteria_bands.items() if v is not None},
            })
            .eq("id", session_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không thể hoàn thành session: {e}")

    completed = result.data[0]
    return {**completed, "session_id": completed["id"]}
