"""
routers/grading.py — Full grading pipeline for one IELTS response

POST /sessions/{session_id}/responses
  Multipart form: question_id (str) + audio_file (UploadFile)

Pipeline (sequential, ~15–30 s):
  1. Auth + session/question ownership validation
  2. File size guard (< 50 MB)
  3. Upload audio to Supabase Storage
  4. Whisper STT  → transcript + duration
  5. Duration guard (< MAX_AUDIO_DURATION_SECONDS)
  6. Claude grader → band scores + feedback
  7. Upsert response row in DB
  8. Increment sessions.tokens_used (best-effort)
  9. Return grading result
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Form, Header, HTTPException, UploadFile, File

from config import settings
from database import supabase_admin
from routers.auth import get_supabase_user
from services import whisper as whisper_svc
from services import claude_grader

logger = logging.getLogger(__name__)

router = APIRouter(tags=["grading"])

_AUDIO_BUCKET  = "audio-responses"
_MAX_BYTES     = 50 * 1024 * 1024   # 50 MB hard limit before upload


# ── POST /sessions/{session_id}/responses ─────────────────────────────────────

@router.post("/sessions/{session_id}/responses")
async def grade_response_endpoint(
    session_id:  str,
    question_id: str       = Form(..., description="UUID of the question being answered"),
    audio_file:  UploadFile = File(..., description="Audio recording (MP3 / WAV / WebM / OGG)"),
    authorization: str | None = Header(default=None),
):
    """
    Nhận file ghi âm, chạy pipeline Whisper → Claude, trả kết quả chấm điểm đầy đủ.
    Thời gian xử lý ước tính: 15–30 giây.
    """
    step = "auth"
    try:
        # ── STEP 1: Auth + session + question ownership ───────────────────────
        auth_user = await get_supabase_user(authorization)
        user_id   = auth_user["id"]
        logger.info("[grading] session=%s question=%s user=%s — bắt đầu", session_id, question_id, user_id)

        step = "load_session"
        try:
            s_res = (
                supabase_admin.table("sessions")
                .select("id, part, topic, status")
                .eq("id", session_id)
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
        except Exception as e:
            raise HTTPException(500, f"Lỗi khi tải session: {e}")

        if not s_res.data:
            raise HTTPException(404, "Session không tồn tại hoặc không có quyền truy cập")

        session = s_res.data[0]
        part: int = session["part"]

        step = "load_question"
        try:
            q_res = (
                supabase_admin.table("questions")
                .select("id, question_text")
                .eq("id", question_id)
                .eq("session_id", session_id)
                .limit(1)
                .execute()
            )
        except Exception as e:
            raise HTTPException(500, f"Lỗi khi tải câu hỏi: {e}")

        if not q_res.data:
            raise HTTPException(404, "Câu hỏi không tồn tại trong session này")

        question_text: str = q_res.data[0]["question_text"]

        # ── STEP 2: File size guard ───────────────────────────────────────────
        step = "read_file"
        audio_bytes = await audio_file.read()
        file_size   = len(audio_bytes)

        logger.info("[grading] file size: %.2f MB", file_size / (1024 * 1024))

        if file_size == 0:
            raise HTTPException(422, "File âm thanh trống")
        if file_size > _MAX_BYTES:
            raise HTTPException(
                413,
                f"File quá lớn ({file_size / (1024*1024):.1f} MB). Giới hạn là 50 MB."
            )

        # ── STEP 3: Upload to Supabase Storage ────────────────────────────────
        step = "storage_upload"
        ext          = _guess_ext(audio_file.filename, audio_file.content_type)
        storage_path = f"{user_id}/{session_id}/{question_id}{ext}"
        audio_url: str | None = None

        try:
            supabase_admin.storage.from_(_AUDIO_BUCKET).upload(
                path=storage_path,
                file=audio_bytes,
                file_options={
                    "content-type": audio_file.content_type or "audio/webm",
                    "upsert": "true",
                },
            )
            audio_url = supabase_admin.storage.from_(_AUDIO_BUCKET).get_public_url(storage_path)
            logger.info("[grading] storage upload OK → %s", storage_path)
        except Exception as e:
            logger.error("[grading] storage upload FAILED: %s", e)
            raise HTTPException(502, f"Không thể lưu file audio: {e}")

        # ── STEP 4: Whisper STT ───────────────────────────────────────────────
        step = "whisper"
        logger.info("[grading] gọi Whisper STT...")

        try:
            stt = await whisper_svc.transcribe_from_url(audio_url)
        except Exception as e:
            logger.error("[grading] Whisper thất bại: %s", e)
            raise HTTPException(502, f"Lỗi nhận dạng giọng nói (Whisper): {e}")

        transcript: str   = stt.get("transcript", "").strip()
        duration_sec: float = stt.get("duration_seconds", 0.0)
        confidence: float   = stt.get("confidence", 0.0)

        logger.info(
            "[grading] Whisper OK — %d ký tự, %.1fs, conf=%.2f",
            len(transcript), duration_sec, confidence,
        )

        # ── STEP 5: Duration guard (post-STT so we have the real value) ───────
        step = "duration_check"
        max_dur = settings.MAX_AUDIO_DURATION_SECONDS
        if duration_sec > max_dur:
            raise HTTPException(
                422,
                f"Audio quá dài ({duration_sec:.0f}s). Giới hạn là {max_dur}s."
            )

        if not transcript:
            raise HTTPException(
                422,
                "Không nhận dạng được giọng nói. Hãy kiểm tra microphone và thử lại."
            )

        # ── STEP 6: Claude grading ────────────────────────────────────────────
        step = "claude_grade"
        logger.info("[grading] gọi Claude grader (part=%d)...", part)

        try:
            grading = await claude_grader.grade_response(
                question=question_text,
                transcript=transcript,
                part=part,
            )
        except Exception as e:
            logger.error("[grading] Claude grader thất bại: %s", e)
            raise HTTPException(502, f"Lỗi chấm điểm AI (Claude): {e}")

        logger.info("[grading] Claude OK — overall_band=%.1f", grading["overall_band"])

        # ── STEP 7: Upsert response row ───────────────────────────────────────
        step = "db_save"
        response_id: str | None = None

        db_row = {
            "session_id":        session_id,
            "question_id":       question_id,
            "user_id":           user_id,
            "audio_url":         audio_url,
            "transcript":        transcript,
            "stt_confidence":    round(confidence, 4),
            "duration_seconds":  round(duration_sec, 2),
            # individual band scores
            "band_fc":           grading["band_fc"],
            "band_lr":           grading["band_lr"],
            "band_gra":          grading["band_gra"],
            "band_p":            grading["band_p"],
            "overall_band":      grading["overall_band"],
            # feedback fields
            "fc_feedback":       grading["fc_feedback"],
            "lr_feedback":       grading["lr_feedback"],
            "gra_feedback":      grading["gra_feedback"],
            "p_feedback":        grading["p_feedback"],
            "strengths":         grading["strengths"],
            "improvements":      grading["improvements"],
            "improved_response": grading["improved_response"],
            # full Claude JSON for future use / debugging
            "feedback_json":     grading,
            "graded_at":         datetime.now(timezone.utc).isoformat(),
        }

        try:
            # Check if a response already exists for this question (idempotent upsert)
            existing = (
                supabase_admin.table("responses")
                .select("id")
                .eq("session_id",  session_id)
                .eq("question_id", question_id)
                .limit(1)
                .execute()
            )

            if existing.data:
                response_id = existing.data[0]["id"]
                res = (
                    supabase_admin.table("responses")
                    .update(db_row)
                    .eq("id", response_id)
                    .execute()
                )
            else:
                res = (
                    supabase_admin.table("responses")
                    .insert(db_row)
                    .execute()
                )
                response_id = res.data[0]["id"] if res.data else None

            logger.info("[grading] DB save OK — response_id=%s", response_id)

        except Exception as e:
            # Non-fatal: grading succeeded, just couldn't persist
            logger.error("[grading] DB save FAILED (non-fatal): %s", e)

        # ── STEP 8: Increment sessions.tokens_used (best-effort) ──────────────
        step = "update_tokens"
        _increment_tokens(session_id, question_text, transcript, grading)

        # ── STEP 9: Return result ─────────────────────────────────────────────
        logger.info("[grading] pipeline hoàn thành — session=%s question=%s", session_id, question_id)

        return {
            "response_id":       response_id,
            "transcript":        transcript,
            "duration_seconds":  round(duration_sec, 2),
            "stt_confidence":    round(confidence, 4),
            # Band scores
            "band_fc":           grading["band_fc"],
            "band_lr":           grading["band_lr"],
            "band_gra":          grading["band_gra"],
            "band_p":            grading["band_p"],
            "overall_band":      grading["overall_band"],
            # Per-criterion feedback
            "fc_feedback":       grading["fc_feedback"],
            "lr_feedback":       grading["lr_feedback"],
            "gra_feedback":      grading["gra_feedback"],
            "p_feedback":        grading["p_feedback"],
            # Summary
            "strengths":         grading["strengths"],
            "improvements":      grading["improvements"],
            "improved_response": grading["improved_response"],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[grading] lỗi không mong đợi tại step=%s: %s", step, e)
        raise HTTPException(500, f"Lỗi xử lý tại bước '{step}': {e}")


# ── Helpers ────────────────────────────────────────────────────────────────────

def _guess_ext(filename: str | None, content_type: str | None) -> str:
    """Trả extension phù hợp để lưu trên Storage."""
    if filename:
        for ext in (".mp3", ".wav", ".webm", ".ogg", ".m4a", ".flac"):
            if filename.lower().endswith(ext):
                return ext
    _mime_map = {
        "audio/mpeg":         ".mp3",
        "audio/mp3":          ".mp3",
        "audio/wav":          ".wav",
        "audio/wave":         ".wav",
        "audio/webm":         ".webm",
        "audio/ogg":          ".ogg",
        "audio/mp4":          ".m4a",
        "audio/x-m4a":        ".m4a",
        "audio/flac":         ".flac",
    }
    if content_type:
        # strip codec suffix e.g. "audio/webm;codecs=opus" → "audio/webm"
        mime_base = content_type.split(";")[0].strip().lower()
        if mime_base in _mime_map:
            return _mime_map[mime_base]
    return ".webm"   # safe default


def _increment_tokens(
    session_id: str,
    question_text: str,
    transcript: str,
    grading: dict,
) -> None:
    """
    Ước tính số tokens đã dùng và cộng vào sessions.tokens_used.
    Hoàn toàn best-effort — không raise nếu cột chưa tồn tại.

    Ước tính:
        input  = system_prompt (~1 300) + question + transcript
        output = grading JSON
        total  ≈ input + output  (rough: 4 chars ≈ 1 token)
    """
    try:
        import json as _json
        system_tokens  = 1_300   # SYSTEM_PROMPT ≈ 1 241 tokens (measured)
        input_tokens   = system_tokens + (len(question_text) + len(transcript)) // 4
        output_tokens  = len(_json.dumps(grading, ensure_ascii=False)) // 4
        tokens_used    = input_tokens + output_tokens

        supabase_admin.table("sessions").update(
            {"tokens_used": tokens_used}
        ).eq("id", session_id).execute()

        logger.debug("[grading] tokens_used est. %d → session %s", tokens_used, session_id)

    except Exception as e:
        logger.debug("[grading] tokens_used update skipped (non-fatal): %s", e)
