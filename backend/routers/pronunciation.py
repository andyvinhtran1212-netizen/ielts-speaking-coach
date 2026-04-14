"""
routers/pronunciation.py — On-demand Azure Pronunciation Assessment

POST /sessions/{session_id}/responses/{response_id}/pronunciation

Pipeline:
  1. Auth + session ownership validation
  2. Load response → audio_storage_path (preferred) or audio_url (fallback)
  3. Download audio bytes (signed URL → public URL → error)
  4. Call azure_pronunciation.assess_pronunciation()
  5. Upsert pronunciation columns on responses row
  6. Return normalized result
"""

import logging

import httpx
from fastapi import APIRouter, Header, HTTPException

from database import supabase_admin
from routers.auth import get_supabase_user
from services import azure_pronunciation

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pronunciation"])

_AUDIO_BUCKET   = "audio-responses"
_SIGNED_URL_TTL = 120   # 2 minutes — just long enough for download + assessment


# ── POST /sessions/{session_id}/responses/{response_id}/pronunciation ──────────

@router.post("/sessions/{session_id}/responses/{response_id}/pronunciation")
async def assess_response_pronunciation(
    session_id:  str,
    response_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Trigger Azure Pronunciation Assessment for a previously recorded response.
    Safe to call multiple times — result is upserted, not duplicated.

    Returns:
        pronunciation_score, fluency_score, accuracy_score, completeness_score,
        short_summary, words (word-level), provider, locale
    """
    # ── 1. Auth + session ownership ──────────────────────────────────────────
    auth_user = await get_supabase_user(authorization)
    user_id   = auth_user["id"]

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

    # ── 2. Load response ─────────────────────────────────────────────────────
    try:
        r_res = (
            supabase_admin.table("responses")
            .select("id, audio_storage_path, audio_url, pronunciation_status")
            .eq("id", response_id)
            .eq("session_id", session_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(500, f"Lỗi khi tải response: {e}")

    if not r_res.data:
        raise HTTPException(404, "Response không tồn tại trong session này")

    response = r_res.data[0]
    storage_path: str | None = response.get("audio_storage_path")
    public_url:   str | None = response.get("audio_url")

    print(
        f"[PRON] response={response_id}  storage_path={storage_path!r}  "
        f"public_url={bool(public_url)}  existing_status={response.get('pronunciation_status')!r}",
        flush=True,
    )
    logger.info(
        "[pronunciation] response=%s  storage_path=%r  public_url=%r  existing_status=%r",
        response_id, storage_path, public_url, response.get("pronunciation_status"),
    )

    if not storage_path and not public_url:
        raise HTTPException(422, "Response này chưa có file audio. Hãy ghi âm trước.")

    # ── 3. Download audio bytes ───────────────────────────────────────────────
    audio_bytes: bytes | None = None
    content_type = "audio/webm"   # default; refined from storage path below

    audio_source = "storage_path" if storage_path else "public_url"
    logger.info("[pronunciation] audio_source=%s  content_type_before_inference=%s", audio_source, content_type)

    # Infer content-type from storage path extension
    if storage_path:
        ext_map = {
            ".mp3": "audio/mpeg",
            ".wav": "audio/wav",
            ".webm": "audio/webm; codecs=opus",
            ".ogg": "audio/ogg; codecs=opus",
            ".m4a": "audio/mp4",
            ".flac": "audio/flac",
        }
        for ext, mime in ext_map.items():
            if storage_path.lower().endswith(ext):
                content_type = mime
                break

        # Try signed URL first
        try:
            signed_resp = supabase_admin.storage.from_(_AUDIO_BUCKET).create_signed_url(
                storage_path, _SIGNED_URL_TTL
            )
            if hasattr(signed_resp, "data") and signed_resp.data:
                signed_url = signed_resp.data.get("signedUrl") or signed_resp.data.get("signedURL")
            elif isinstance(signed_resp, dict):
                signed_url = signed_resp.get("signedUrl") or signed_resp.get("signedURL")
            else:
                signed_url = None

            if signed_url:
                async with httpx.AsyncClient(timeout=60) as client:
                    dl = await client.get(signed_url)
                if dl.status_code == 200:
                    audio_bytes = dl.content
                    logger.info(
                        "[pronunciation] downloaded %d B via signed URL for response=%s  content_type=%s",
                        len(audio_bytes), response_id, content_type,
                    )
                else:
                    logger.warning("[pronunciation] signed URL download returned HTTP %d", dl.status_code)
        except Exception as e:
            logger.warning("[pronunciation] signed URL download failed: %s", e)

    # Fallback to public URL
    if audio_bytes is None and public_url:
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                dl = await client.get(public_url)
            if dl.status_code == 200:
                audio_bytes = dl.content
                logger.info(
                    "[pronunciation] downloaded %d B via public URL for response=%s  content_type=%s",
                    len(audio_bytes), response_id, content_type,
                )
        except Exception as e:
            logger.warning("[pronunciation] public URL download failed: %s", e)

    if not audio_bytes:
        raise HTTPException(502, "Không thể tải file audio để đánh giá phát âm.")

    # ── 4. Azure Pronunciation Assessment ────────────────────────────────────
    print(f"[PRON] audio downloaded: {len(audio_bytes)}B  inferred_type={content_type}  source={audio_source}", flush=True)
    logger.info(
        "[pronunciation] sending to Azure: %d bytes  content_type=%s  source=%s",
        len(audio_bytes), content_type, audio_source,
    )
    try:
        result = await azure_pronunciation.assess_pronunciation(
            audio_bytes=audio_bytes,
            content_type=content_type,
            locale="en-US",
            reference_text="",   # free-speech mode for IELTS open answers
        )
    except ValueError as e:
        # Missing env vars — config problem, not user error
        logger.error("[pronunciation] Azure config error: %s", e)
        raise HTTPException(503, f"Dịch vụ đánh giá phát âm chưa được cấu hình: {e}")
    except RuntimeError as e:
        logger.error("[pronunciation] Azure API error: %s", e)
        raise HTTPException(502, f"Lỗi Azure Speech API: {e}")

    # ── 5. Persist to DB (upsert pronunciation columns) ──────────────────────
    import json as _json

    update_payload = {
        "pronunciation_score":        result.get("pronunciation_score"),
        "pronunciation_fluency":      result.get("fluency_score"),
        "pronunciation_accuracy":     result.get("accuracy_score"),
        "pronunciation_completeness": result.get("completeness_score"),
        "pronunciation_status":       "completed",
        "pronunciation_provider":     "azure",
        "pronunciation_locale":       "en-US",
        "pronunciation_payload":      _json.dumps(result.get("raw_payload", {}), ensure_ascii=False),
    }

    try:
        supabase_admin.table("responses").update(update_payload).eq("id", response_id).execute()
        logger.info("[pronunciation] DB updated for response=%s", response_id)
    except Exception as e:
        # Non-fatal — return result even if DB write fails
        logger.warning("[pronunciation] DB update failed (non-fatal): %s", e)

    # ── 6. Return normalized result ──────────────────────────────────────────
    return {
        "response_id":           response_id,
        "pronunciation_score":   result.get("pronunciation_score"),
        "fluency_score":         result.get("fluency_score"),
        "accuracy_score":        result.get("accuracy_score"),
        "completeness_score":    result.get("completeness_score"),
        "prosody_score":         result.get("prosody_score"),
        "short_summary":         result.get("short_summary", []),
        "words":                 result.get("words", []),
        "provider":              "azure",
        "locale":                "en-US",
    }
