"""
routers/tts.py — Text-to-speech endpoint using OpenAI TTS API

POST /tts
  JSON body: { "text": "...", "voice": "nova", "session_id": "<uuid>"? }
  Returns:   audio/mpeg bytes

Voice options (OpenAI): alloy, echo, fable, onyx, nova, shimmer
  nova    — bright, clear, female  (recommended for IELTS examiner)
  shimmer — warm, female
  onyx    — deep, male

Cost: tts-1 = $0.015 / 1K chars  (~1–2 cents per question read-aloud)

Guards (F05): per-IP minute throttle, Speaking entitlement, then a per-user
daily quota — all before the OpenAI call. Signup is open, so an account that
never redeemed a code must not be able to spend TTS budget. An optional owned
session_id lets a class-assignment session pass the guard without a Speaking
access-code scope, as it does for the other Speaking steps.
"""

import logging
import time
from collections import deque
from uuid import UUID

from fastapi import APIRouter, HTTPException, Header, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from config import settings
from database import supabase_admin
from routers.auth import get_supabase_user
from routers.sessions import require_speaking_entitlement
from services import activation_gate, ai_usage_logger
from services.rate_limit import _utc_today_start, _utc_tomorrow_start
from services.tts_audio import synthesize_mp3

logger = logging.getLogger(__name__)

router = APIRouter(tags=["tts"])

_MAX_TEXT_LEN = 4096   # OpenAI TTS hard limit is 4096 chars


class TTSRequest(BaseModel):
    text:  str         = Field(..., min_length=1, max_length=_MAX_TEXT_LEN)
    voice: str         = Field(default="nova")
    session_id: UUID | None = None


# ── Per-IP throttle ───────────────────────────────────────────────────────────
# In-memory sliding window, per worker (same posture as RequestSafetyMiddleware
# and /auth/activate): N workers/instances allow N× the budget. The per-user
# daily quota below is the durable cap; this only blunts bursts from one IP.
_IP_WINDOW_SECONDS = 60
_IP_SWEEP_THRESHOLD = 10_000
_ip_hits: dict[str, deque] = {}


def _client_ip(request: Request | None) -> str | None:
    # Same convention as routers/reading_student.py: first X-Forwarded-For hop.
    if request is None:
        return None
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def _throttle_ip(request: Request | None) -> None:
    budget = settings.TTS_IP_MAX_PER_MINUTE
    ip = _client_ip(request)
    if budget <= 0 or not ip:
        return
    now = time.monotonic()
    cutoff = now - _IP_WINDOW_SECONDS
    if len(_ip_hits) > _IP_SWEEP_THRESHOLD:
        for key in [k for k, q in _ip_hits.items() if not q or q[-1] <= cutoff]:
            del _ip_hits[key]
    hits = _ip_hits.setdefault(ip, deque())
    while hits and hits[0] <= cutoff:
        hits.popleft()
    if len(hits) >= budget:
        retry_after = max(1, int(hits[0] - cutoff) + 1)
        logger.info("[tts] BLOCK ip budget=%d/min", budget)
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": "Quá nhiều yêu cầu đọc câu hỏi. Vui lòng thử lại sau.",
                "exercise_type": "TTS_IP",
                "limit": budget,
                "retry_after": retry_after,
            },
            headers={"Retry-After": str(retry_after)},
        )
    hits.append(now)


# ── Per-user daily quota ──────────────────────────────────────────────────────
# Counts this endpoint's own ledger rows (ai_usage_logs, feature="question_tts",
# written only after a successful synth) since UTC midnight. Fail-OPEN on a
# lookup error, like services/rate_limit.py: the entitlement guard has already
# run, and a ledger outage must not silence read-aloud for entitled students.
# The ledger write is scheduled in the background, so concurrent requests can
# overshoot by the number in flight.

def _count_tts_today(user_id: str) -> int:
    try:
        res = (
            supabase_admin.table("ai_usage_logs")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .eq("feature", "question_tts")
            .gte("created_at", _utc_today_start().isoformat())
            .execute()
        )
        return int(res.count or 0)
    except Exception as e:
        logger.warning("[tts] quota lookup failed user=%s: %s", user_id, e)
        return 0


def _enforce_daily_quota(user_id: str) -> None:
    daily_limit = settings.TTS_DAILY_LIMIT_PER_USER
    if daily_limit <= 0:
        return
    used = _count_tts_today(user_id)
    if used >= daily_limit:
        reset_at = _utc_tomorrow_start().isoformat()
        logger.info(
            "[tts] BLOCK user=%s used=%d limit=%d reset_at=%s",
            user_id, used, daily_limit, reset_at,
        )
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limit_exceeded",
                "message": f"Đã đạt giới hạn {daily_limit} lượt đọc câu hỏi trong ngày. Vui lòng thử lại sau.",
                "exercise_type": "TTS",
                "limit": daily_limit,
                "used": used,
                "reset_at": reset_at,
            },
        )


def _load_owned_session(user_id: str, session_id: UUID | None) -> dict | None:
    # No resume-window check (require_resume_active): reading an already-loaded
    # question aloud writes nothing to the session, and a review or resumed
    # player must keep its voice. Spend stays bounded by entitlement + quotas.
    if session_id is None:
        return None
    try:
        result = (
            supabase_admin.table("sessions")
            .select("id, mode, status, class_assignment_item_id")
            .eq("id", str(session_id))
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi tải session: {e}")
    if not result.data:
        raise HTTPException(status_code=404, detail="Session không tồn tại")
    return result.data[0]


@router.post("/tts")
async def text_to_speech(
    body: TTSRequest,
    authorization: str | None = Header(default=None),
    request: Request = None,
) -> Response:
    """
    Convert text to speech via OpenAI TTS. Returns audio/mpeg bytes.
    Used by the practice page to read questions aloud with a natural voice.
    """
    _throttle_ip(request)
    auth_user = await get_supabase_user(authorization)
    user_id = auth_user["id"]

    # W-03 — activation before any lookup: an inactive account gets the
    # activation 403 whether or not session_id exists (the router gate already
    # confirmed this request, so this costs no query).
    activation_gate.ensure_account_active(user_id)
    require_speaking_entitlement(user_id, _load_owned_session(user_id, body.session_id))

    if not settings.OPENAI_API_KEY:
        raise HTTPException(503, "OpenAI API key not configured — TTS unavailable")

    # Validate voice
    _ALLOWED_VOICES = {"alloy", "echo", "fable", "onyx", "nova", "shimmer"}
    voice = body.voice if body.voice in _ALLOWED_VOICES else "nova"

    _enforce_daily_quota(user_id)

    try:
        # Single synth path, shared with the vocab audio pregen (Slice-2).
        audio_bytes = await synthesize_mp3(body.text, voice)
        logger.info("[tts] generated %d bytes for %d chars (voice=%s)", len(audio_bytes), len(body.text), voice)

        ai_usage_logger.schedule_usage_log(ai_usage_logger.log_tts_async(
            user_id=user_id,
            session_id=None,
            model="tts-1",
            text_chars=len(body.text),
            feature="question_tts",
            operation="synthesize",
        ))

        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-store"},
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("[tts] OpenAI TTS failed: %s", e)
        raise HTTPException(502, f"TTS service error: {e}")
