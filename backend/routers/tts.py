"""
routers/tts.py — Text-to-speech endpoint using OpenAI TTS API

POST /tts
  JSON body: { "text": "...", "voice": "nova" }
  Returns:   audio/mpeg bytes

Voice options (OpenAI): alloy, echo, fable, onyx, nova, shimmer
  nova    — bright, clear, female  (recommended for IELTS examiner)
  shimmer — warm, female
  onyx    — deep, male

Cost: tts-1 = $0.015 / 1K chars  (~1–2 cents per question read-aloud)
"""

import logging

from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import Response
from pydantic import BaseModel, Field

from config import settings
from routers.auth import get_supabase_user
from services import ai_usage_logger

logger = logging.getLogger(__name__)

router = APIRouter(tags=["tts"])

_MAX_TEXT_LEN = 4096   # OpenAI TTS hard limit is 4096 chars


class TTSRequest(BaseModel):
    text:  str         = Field(..., min_length=1, max_length=_MAX_TEXT_LEN)
    voice: str         = Field(default="nova")


@router.post("/tts")
async def text_to_speech(
    body: TTSRequest,
    authorization: str | None = Header(default=None),
) -> Response:
    """
    Convert text to speech via OpenAI TTS. Returns audio/mpeg bytes.
    Used by the practice page to read questions aloud with a natural voice.
    """
    auth_user = await get_supabase_user(authorization)

    if not settings.OPENAI_API_KEY:
        raise HTTPException(503, "OpenAI API key not configured — TTS unavailable")

    # Validate voice
    _ALLOWED_VOICES = {"alloy", "echo", "fable", "onyx", "nova", "shimmer"}
    voice = body.voice if body.voice in _ALLOWED_VOICES else "nova"

    try:
        import openai
        client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

        response = await client.audio.speech.create(
            model="tts-1",
            voice=voice,         # type: ignore[arg-type]
            input=body.text,
            response_format="mp3",
        )

        audio_bytes = response.content
        logger.info("[tts] generated %d bytes for %d chars (voice=%s)", len(audio_bytes), len(body.text), voice)

        ai_usage_logger.log_tts(
            user_id=auth_user["id"],
            session_id=None,
            model="tts-1",
            text_chars=len(body.text),
        )

        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-store"},
        )

    except Exception as e:
        logger.error("[tts] OpenAI TTS failed: %s", e)
        raise HTTPException(502, f"TTS service error: {e}")
