import asyncio
import json
import logging
import math
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Header, Query
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


def _compute_session_bands(session_id: str) -> dict:
    """
    Canonical aggregate: fetch all responses for session and compute band scores.

    Canonical field precedence (P criterion):
      - Use ``responses.final_band_p`` (pronunciation-adjusted) when set.
      - Fall back to ``responses.feedback.band_p`` (raw AI grade) otherwise.

    Canonical overall per response:
      - ``responses.final_overall_band``: pronunciation-adjusted overall for this response.
        Set by the pronunciation service ONLY — admin regrade clears it.
        Meaning:
          • Practice mode: pronunciation-tweaked overall (P-weighted delta applied to overall_band).
          • Test mode: avg(FC, LR, GRA, final_band_p) recomputed after pronunciation.
        This value is an intermediate artifact; it feeds _compute_session_bands but is
        never exposed as the session-level truth.  ``sessions.overall_band`` is the truth
        after finalization.
      - Falls back to ``responses.overall_band`` (raw AI overall) when not set.

    Session-level truth (written by update_session_bands / complete_session):
      - ``sessions.overall_band``  — canonical session overall (the authoritative value).
      - ``sessions.band_fc/lr/gra/p`` — canonical per-criterion averages.

    FC / LR / GRA always come from ``feedback.*`` (pronunciation does not adjust them).
    """
    r_res = (
        supabase_admin.table("responses")
        .select("overall_band, final_band_p, final_overall_band, feedback")
        .eq("session_id", session_id)
        .execute()
    )
    responses = r_res.data or []

    fc_vals, lr_vals, gra_vals, p_vals, r_bands = [], [], [], [], []
    for r in responses:
        # Overall-band fallback (practice mode — no criterion bands in feedback)
        final_ob = r.get("final_overall_band")
        ob = final_ob if final_ob is not None else r.get("overall_band")
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

        for vals, key in ((fc_vals, "band_fc"), (lr_vals, "band_lr"), (gra_vals, "band_gra")):
            v = fb.get(key)
            if v is not None:
                try:
                    vals.append(float(v))
                except (TypeError, ValueError):
                    pass

        # P criterion: pronunciation-adjusted when available, else raw AI grade
        final_p = r.get("final_band_p")
        if final_p is not None:
            p_vals.append(float(final_p))
        else:
            v = fb.get("band_p")
            if v is not None:
                try:
                    p_vals.append(float(v))
                except (TypeError, ValueError):
                    pass

    criteria_bands: dict = {
        "band_fc":  _round_band(sum(fc_vals)  / len(fc_vals))  if fc_vals  else None,
        "band_lr":  _round_band(sum(lr_vals)  / len(lr_vals))  if lr_vals  else None,
        "band_gra": _round_band(sum(gra_vals) / len(gra_vals)) if gra_vals else None,
        "band_p":   _round_band(sum(p_vals)   / len(p_vals))   if p_vals   else None,
    }
    scored = [v for v in criteria_bands.values() if v is not None]
    overall_band = (
        _round_band(sum(scored) / len(scored)) if scored
        else (_round_band(sum(r_bands) / len(r_bands)) if r_bands else None)
    )
    return {"overall_band": overall_band, **criteria_bands}


def update_session_bands(session_id: str) -> None:
    """
    Re-aggregate band scores for a session and persist them (no status change).
    Called by the pronunciation endpoint after writing final_band_p so that the
    session aggregate immediately reflects pronunciation-adjusted scores.
    Safe to call on completed or in-progress sessions.
    """
    try:
        bands = _compute_session_bands(session_id)
    except Exception as e:
        logger.warning("[update_session_bands] compute failed session=%s: %s", session_id, e)
        return

    payload = {k: v for k, v in bands.items() if v is not None}
    if not payload:
        return
    try:
        supabase_admin.table("sessions").update(payload).eq("id", session_id).execute()
        logger.info("[update_session_bands] session=%s bands=%s", session_id, payload)
    except Exception as e:
        logger.warning("[update_session_bands] write failed session=%s: %s", session_id, e)


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


class FinalizeFullTestBody(BaseModel):
    p1_id: str
    p2_id: Optional[str] = None
    p3_id: Optional[str] = None


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


# ── GET /sessions/stats ────────────────────────────────────────────────────────

@router.get("/stats")
async def get_session_stats(
    limit: int = Query(default=10, ge=1, le=100),
    authorization: str | None = Header(default=None),
):
    """
    Trả thống kê tổng hợp và danh sách sessions gần nhất (completed).
    Dùng cho dashboard: stat cards + chart data.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    # Recent completed sessions for chart / last_topic
    try:
        s_res = (
            supabase_admin.table("sessions")
            .select("id, started_at, mode, part, topic, band_fc, band_lr, band_gra, band_p, overall_band, status")
            .eq("user_id", user_id)
            .eq("status", "completed")
            .order("started_at", desc=True)
            .limit(limit)
            .execute()
        )
        sessions = s_res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi tải sessions: {e}")

    # total_sessions (all statuses)
    try:
        total_res = (
            supabase_admin.table("sessions")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .execute()
        )
        total_sessions = total_res.count if total_res.count is not None else len(total_res.data or [])
    except Exception:
        total_sessions = 0

    # avg_band_30d — average overall_band for completed sessions in last 30 days
    try:
        thirty_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        band_res = (
            supabase_admin.table("sessions")
            .select("overall_band")
            .eq("user_id", user_id)
            .eq("status", "completed")
            .gte("started_at", thirty_ago)
            .execute()
        )
        bands = [
            r["overall_band"]
            for r in (band_res.data or [])
            if r.get("overall_band") is not None
        ]
        avg_band_30d = round(sum(bands) / len(bands), 1) if bands else None
    except Exception:
        avg_band_30d = None

    # current_streak — consecutive days with at least one session (any status)
    current_streak = 0
    try:
        streak_res = (
            supabase_admin.table("sessions")
            .select("started_at")
            .eq("user_id", user_id)
            .order("started_at", desc=True)
            .limit(365)
            .execute()
        )
        day_set = {
            r["started_at"][:10]
            for r in (streak_res.data or [])
            if r.get("started_at")
        }
        cursor = date.today()
        while cursor.isoformat() in day_set:
            current_streak += 1
            cursor -= timedelta(days=1)
    except Exception:
        pass

    last_session = sessions[0] if sessions else None

    return {
        "sessions": sessions,
        "summary": {
            "total_sessions": total_sessions,
            "avg_band_30d":   avg_band_30d,
            "current_streak": current_streak,
            "last_topic":     last_session.get("topic") if last_session else None,
            "last_part":      last_session.get("part") if last_session else None,
            "last_mode":      last_session.get("mode") if last_session else None,
            "last_session_at": last_session.get("started_at") if last_session else None,
        },
    }


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
        responses = r_result.data or []
        logger.info("[get_session] %s responses loaded for session=%s", len(responses), session_id)
    except Exception as exc:
        logger.error("[get_session] responses query FAILED for session=%s: %s", session_id, exc)
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


# ── GET /sessions/{session_id}/full-test-summary ───────────────────────────────

@router.get("/{session_id}/full-test-summary")
async def get_full_test_summary(
    session_id: str,
    p2_id: Optional[str] = Query(default=None, description="Part 2 session ID"),
    p3_id: Optional[str] = Query(default=None, description="Part 3 session ID"),
    authorization: str | None = Header(default=None),
):
    """
    Tổng hợp kết quả Full Test từ tối đa 3 part sessions.
    session_id = Part 1 session ID (bắt buộc).
    p2_id, p3_id = Part 2 & 3 session IDs (tuỳ chọn, truyền qua query params).

    Tính toán từ responses.feedback JSON:
      - Criterion bands (band_fc/lr/gra/p) → trung bình toàn bộ responses
      - Strengths / improvements → gộp + đếm tần suất
      - Grammar issues → gộp + đếm tần suất (top 5)
      - Per-part summary: band_avg, key_feedback (strength + improvement đầu tiên)
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    all_ids = [sid for sid in [session_id, p2_id, p3_id] if sid]

    # Ownership check — load all sessions at once
    try:
        s_res = (
            supabase_admin.table("sessions")
            .select("id, part, topic, started_at, band_fc, band_lr, band_gra, band_p, overall_band, status")
            .in_("id", all_ids)
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi tải sessions: {e}")

    sessions_by_id = {s["id"]: s for s in (s_res.data or [])}
    if session_id not in sessions_by_id:
        raise HTTPException(404, "Session không tồn tại hoặc không có quyền truy cập")

    # Question counts per session
    try:
        q_res = (
            supabase_admin.table("questions")
            .select("id, session_id")
            .in_("session_id", all_ids)
            .execute()
        )
        qcount = Counter(q["session_id"] for q in (q_res.data or []))
    except Exception:
        qcount = Counter()

    # Responses for all sessions
    try:
        resp_res = (
            supabase_admin.table("responses")
            .select("id, session_id, question_id, overall_band, feedback")
            .in_("session_id", all_ids)
            .execute()
        )
        all_responses = resp_res.data or []
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi tải responses: {e}")

    # ── Canonical band fast-path ──────────────────────────────────────────────
    # When ALL requested sessions are completed with a non-null overall_band,
    # use the persisted session-level canonical bands (which reflect any
    # pronunciation adjustments written by update_session_bands).  This avoids
    # re-reading raw responses.feedback which would ignore final_band_p/final_overall_band.
    completed_sessions = [
        s for s in sessions_by_id.values()
        if s.get("status") == "completed" and s.get("overall_band") is not None
    ]
    use_persisted_bands = len(completed_sessions) == len(all_ids)

    if use_persisted_bands:
        # Aggregate criterion bands from persisted session rows (already canonical).
        fc_vals_s  = [float(s["band_fc"])  for s in completed_sessions if s.get("band_fc")  is not None]
        lr_vals_s  = [float(s["band_lr"])  for s in completed_sessions if s.get("band_lr")  is not None]
        gra_vals_s = [float(s["band_gra"]) for s in completed_sessions if s.get("band_gra") is not None]
        p_vals_s   = [float(s["band_p"])   for s in completed_sessions if s.get("band_p")   is not None]

        band_fc  = _round_band(sum(fc_vals_s)  / len(fc_vals_s))  if fc_vals_s  else None
        band_lr  = _round_band(sum(lr_vals_s)  / len(lr_vals_s))  if lr_vals_s  else None
        band_gra = _round_band(sum(gra_vals_s) / len(gra_vals_s)) if gra_vals_s else None
        band_p   = _round_band(sum(p_vals_s)   / len(p_vals_s))   if p_vals_s   else None

        scored = [b for b in [band_fc, band_lr, band_gra, band_p] if b is not None]
        overall_band = _round_band(sum(scored) / len(scored)) if scored else None

    # Always compute qualitative data (strengths/improvements/grammar) from responses,
    # and per-part band_avg using the canonical per-session overall_band when available.
    all_strengths: list[str] = []
    all_improvements: list[str] = []
    all_grammar: list[str] = []
    per_session_first_feedback: dict[str, dict] = {}

    # For criterion-band computation when NOT using persisted path
    fc_vals: list[float] = []
    lr_vals: list[float] = []
    gra_vals: list[float] = []
    p_vals: list[float] = []

    for r in all_responses:
        sid = r.get("session_id")

        raw_fb = r.get("feedback")
        fb: dict = {}
        if raw_fb:
            try:
                fb = json.loads(raw_fb) if isinstance(raw_fb, str) else raw_fb
                if not isinstance(fb, dict):
                    fb = {}
            except (json.JSONDecodeError, TypeError):
                fb = {}

        if not use_persisted_bands:
            # Criterion bands from raw feedback (pre-pronunciation values)
            for vals, key in [
                (fc_vals,  "band_fc"),
                (lr_vals,  "band_lr"),
                (gra_vals, "band_gra"),
                (p_vals,   "band_p"),
            ]:
                v = fb.get(key)
                if v is not None:
                    try:
                        vals.append(float(v))
                    except (TypeError, ValueError):
                        pass

        all_strengths.extend(fb.get("strengths") or [])
        all_improvements.extend(fb.get("improvements") or [])
        all_grammar.extend(fb.get("grammar_issues") or [])

        # Keep first response-with-feedback per session for key_feedback
        if sid and sid not in per_session_first_feedback and fb:
            strs = fb.get("strengths") or []
            imps = fb.get("improvements") or []
            if strs or imps:
                per_session_first_feedback[sid] = {
                    "strength":    strs[0] if strs else None,
                    "improvement": imps[0] if imps else None,
                }

    if not use_persisted_bands:
        # Compute criterion bands from raw feedback fallback
        band_fc  = _round_band(sum(fc_vals)  / len(fc_vals))  if fc_vals  else None
        band_lr  = _round_band(sum(lr_vals)  / len(lr_vals))  if lr_vals  else None
        band_gra = _round_band(sum(gra_vals) / len(gra_vals)) if gra_vals else None
        band_p   = _round_band(sum(p_vals)   / len(p_vals))   if p_vals   else None

        scored = [b for b in [band_fc, band_lr, band_gra, band_p] if b is not None]
        overall_band = _round_band(sum(scored) / len(scored)) if scored else None

    # Top strengths / improvements (most frequent, max 3 each)
    top_strengths    = [s for s, _ in Counter(all_strengths).most_common(3)]
    top_improvements = [s for s, _ in Counter(all_improvements).most_common(3)]
    top_grammar      = [s for s, _ in Counter(all_grammar).most_common(5)]

    # Per-part breakdown
    part_map = {1: session_id, 2: p2_id, 3: p3_id}
    parts = []
    for part_num in (1, 2, 3):
        sid = part_map[part_num]
        if not sid or sid not in sessions_by_id:
            continue
        sess = sessions_by_id[sid]
        # Use persisted session overall_band for per-part avg when available (canonical truth),
        # otherwise fall back to the mean of raw response overall_band values.
        if use_persisted_bands and sess.get("overall_band") is not None:
            band_avg = float(sess["overall_band"])
        else:
            resp_bands = [
                float(r["overall_band"])
                for r in all_responses
                if r.get("session_id") == sid and r.get("overall_band") is not None
            ]
            band_avg = round(sum(resp_bands) / len(resp_bands), 1) if resp_bands else None
        parts.append({
            "part":            part_num,
            "session_id":      sid,
            "topic":           sess.get("topic"),
            "questions_count": qcount.get(sid, 0),
            "band_avg":        band_avg,
            "key_feedback":    per_session_first_feedback.get(sid),
        })

    # started_at from Part 1 session
    started_at = sessions_by_id.get(session_id, {}).get("started_at")

    return {
        "overall_band":       overall_band,
        "band_fc":            band_fc,
        "band_lr":            band_lr,
        "band_gra":           band_gra,
        "band_p":             band_p,
        "parts":              parts,
        "top_strengths":      top_strengths,
        "top_improvements":   top_improvements,
        "top_grammar_issues": top_grammar,
        "pron_overall":       None,   # fetch separately via POST /pronunciation/full
        "pron_breakdown":     None,
        "started_at":         started_at,
    }


# ── Internal helpers for backend-driven finalization ──────────────────────────

def _complete_session_internal(session_id: str) -> None:
    """
    Compute and persist band scores for one session without requiring an HTTP auth context.
    Used by the background task that finalizes a full test after all grading is done.
    Mirrors the logic in complete_session() but is synchronous and auth-free.
    """
    s_res = (
        supabase_admin.table("sessions")
        .select("*")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )
    if not s_res.data:
        raise ValueError(f"Session {session_id} not found")
    session = s_res.data[0]

    if session.get("status") == "completed" and session.get("overall_band") is not None:
        return  # already fully computed — nothing to do

    try:
        bands = _compute_session_bands(session_id)
    except Exception as e:
        raise ValueError(f"Could not compute bands for session {session_id}: {e}")

    overall_band = bands["overall_band"]
    criteria_bands = {k: v for k, v in bands.items() if k != "overall_band"}

    update_payload: dict = {
        "status": "completed",
        "overall_band": overall_band,
        **{k: v for k, v in criteria_bands.items() if v is not None},
    }
    if not session.get("completed_at"):
        update_payload["completed_at"] = datetime.now(timezone.utc).isoformat()

    supabase_admin.table("sessions").update(update_payload).eq("id", session_id).execute()
    logger.info("[finalize_ft] session=%s completed — overall_band=%s", session_id, overall_band)


def _check_all_responses_graded(session_ids: list) -> bool:
    """
    Return True when every question in each session has a *graded* response row.
    A response is considered graded when grading_status='completed' OR overall_band IS NOT NULL.
    Existence of a response row alone is not sufficient — audio may have been uploaded
    but the AI grading pipeline may not have finished yet.
    """
    for sid in session_ids:
        try:
            q_res = (
                supabase_admin.table("questions")
                .select("id", count="exact")
                .eq("session_id", sid)
                .execute()
            )
            r_res = (
                supabase_admin.table("responses")
                .select("id, grading_status, overall_band")
                .eq("session_id", sid)
                .execute()
            )
            n_q = q_res.count or 0
            responses = r_res.data or []
            graded = [
                r for r in responses
                if r.get("grading_status") == "completed" or r.get("overall_band") is not None
            ]
            n_graded = len(graded)
            if n_graded < n_q:
                logger.info(
                    "[finalize_ft] session=%s: %d/%d responses graded", sid, n_graded, n_q
                )
                return False
        except Exception as e:
            logger.warning("[finalize_ft] poll error for session=%s: %s", sid, e)
            return False
    return True


async def _bg_finalize_full_test(session_ids: list) -> None:
    """
    Background task: poll DB every 8 s until all responses are saved (max 90 s),
    then aggregate band scores and mark each session 'completed'.
    Runs entirely on the server — browser tab can close safely after calling the endpoint.
    """
    max_wait  = 90
    poll_sec  = 8
    elapsed   = 0

    logger.info("[finalize_ft] background task started for sessions=%s", session_ids)

    while elapsed < max_wait:
        await asyncio.sleep(poll_sec)
        elapsed += poll_sec
        all_ready = await asyncio.to_thread(_check_all_responses_graded, session_ids)
        if all_ready:
            logger.info("[finalize_ft] all responses saved after %ds — completing sessions", elapsed)
            break
    else:
        logger.warning(
            "[finalize_ft] timeout after %ds — completing with whatever responses exist", max_wait
        )

    for sid in session_ids:
        try:
            await asyncio.to_thread(_complete_session_internal, sid)
        except Exception as e:
            logger.error("[finalize_ft] complete failed for session=%s: %s", sid, e)
            try:
                await asyncio.to_thread(
                    lambda s=sid: supabase_admin.table("sessions")
                    .update({"status": "analysis_failed"})
                    .eq("id", s)
                    .execute()
                )
            except Exception:
                pass


# ── POST /sessions/finalize-full-test ─────────────────────────────────────────
# NOTE: This route MUST be declared before /{session_id} routes so FastAPI does
# not treat the literal "finalize-full-test" as a session_id path parameter.

@router.post("/finalize-full-test")
async def finalize_full_test(
    body: FinalizeFullTestBody,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    """
    Trigger backend-driven finalization of a Full Test.

    1. Verifies the caller owns all provided session IDs.
    2. Marks every session as 'submitted' immediately (visible in history as "Đang phân tích").
    3. Returns {accepted: true} right away — the browser is done.
    4. A background task polls until all eager-upload grading requests complete in the DB,
       then calls the complete logic for each session (aggregates band scores, sets 'completed').

    The browser tab can close at any point after calling this endpoint — the server
    handles everything from here.
    """
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    all_ids = [sid for sid in [body.p1_id, body.p2_id, body.p3_id] if sid]
    if not all_ids:
        raise HTTPException(400, "Cần ít nhất một session ID (p1_id)")

    # Ownership check — all sessions must belong to this user
    try:
        s_res = (
            supabase_admin.table("sessions")
            .select("id, mode")
            .in_("id", all_ids)
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi kiểm tra sessions: {e}")

    found_ids = {s["id"] for s in (s_res.data or [])}
    missing = [sid for sid in all_ids if sid not in found_ids]
    if missing:
        raise HTTPException(404, f"Session(s) không tồn tại hoặc không có quyền: {missing}")

    # Mark all sessions 'submitted' immediately — history shows "Đang phân tích"
    try:
        supabase_admin.table("sessions").update({"status": "submitted"}).in_("id", all_ids).execute()
    except Exception as e:
        logger.warning("[finalize_ft] failed to mark submitted (non-fatal): %s", e)

    # Schedule the background aggregation — browser can safely close after this returns
    background_tasks.add_task(_bg_finalize_full_test, all_ids)

    logger.info("[finalize_ft] accepted for sessions=%s user=%s", all_ids, user_id)
    return {"accepted": True, "session_ids": all_ids}


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

    if session["status"] == "completed" and session.get("overall_band") is not None:
        # Idempotent: already done with a valid band — return current state.
        return {**session, "session_id": session["id"]}
    if session["status"] == "completed":
        # Already completed but band is null (e.g. prior DB save failure) — fall through to recompute.
        logger.info("[complete_session] re-computing band for already-completed session=%s (overall_band was null)", session_id)

    # Compute canonical bands from responses (prefers final_band_p when available)
    try:
        bands = _compute_session_bands(session_id)
    except Exception as e:
        logger.warning("[complete_session] band compute failed session=%s: %s", session_id, e)
        raise HTTPException(
            status_code=422,
            detail=f"Cannot complete session — band computation failed: {e}",
        )

    overall_band   = bands["overall_band"]
    criteria_bands = {k: v for k, v in bands.items() if k != "overall_band"}

    # Gate: do not mark completed if no usable canonical bands exist.
    all_band_vals = [overall_band] + list(criteria_bands.values())
    if all(v is None for v in all_band_vals):
        raise HTTPException(
            status_code=422,
            detail="Cannot complete session — no usable band scores found in responses. "
                   "Ensure all responses have been graded before calling this endpoint.",
        )

    update_payload: dict = {
        "status":       "completed",
        "overall_band": overall_band,
        **{k: v for k, v in criteria_bands.items() if v is not None},
    }
    # Only set completed_at if not already set (avoid overwriting original completion time)
    if not session.get("completed_at"):
        update_payload["completed_at"] = datetime.now(timezone.utc).isoformat()

    try:
        result = (
            supabase_admin.table("sessions")
            .update(update_payload)
            .eq("id", session_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không thể hoàn thành session: {e}")

    completed = result.data[0]
    return {**completed, "session_id": completed["id"]}
