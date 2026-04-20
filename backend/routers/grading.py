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

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Form, Header, HTTPException, UploadFile, File

from config import settings
from database import supabase_admin
from routers.auth import get_supabase_user
from services.whisper import transcribe_from_bytes
from services import claude_grader
from services import ai_usage_logger
from services.transcript_reliability import classify_reliability

logger = logging.getLogger(__name__)

router = APIRouter(tags=["grading"])

_AUDIO_BUCKET  = "audio-responses"
_MAX_BYTES     = 50 * 1024 * 1024   # 50 MB hard limit before upload


def _mark_session_error(
    session_id: str,
    error_code: str,
    failed_step: str,
    error_message: str,
) -> None:
    """Best-effort: record error state on the session row for admin monitoring."""
    try:
        supabase_admin.table("sessions").update({
            "error_code":    error_code,
            "error_message": error_message[:500],
            "failed_step":   failed_step,
            "last_error_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", session_id).execute()
    except Exception as ex:
        logger.warning("[grading] _mark_session_error failed (non-fatal): %s", ex)


def _round_band(v: float) -> float:
    """Round to nearest 0.5."""
    return round(v * 2) / 2


def _apply_heuristic_caps(grading: dict, word_count: int, part: int) -> dict:
    """
    Post-Claude heuristic adjustments.
    Caps FC (and sometimes LR/GRA) for short responses, then recomputes overall_band.
    Claude has strict calibration rules in the prompt, but this acts as a safety net.
    """
    grading = dict(grading)  # don't mutate the original

    # Thresholds: (very_short_cap, min_words_cap, min_words)
    thresholds = {
        1: (3, 5, 40),   # Part 1: <15w→cap3, 15-39w→cap5
        2: (3, 5, 100),  # Part 2: <40w→cap3, 40-99w→cap5
        3: (4, 5, 50),   # Part 3: <20w→cap4, 20-49w→cap5
    }
    very_short_limits = {1: 15, 2: 40, 3: 20}
    short_limits      = {1: 40, 2: 100, 3: 50}

    very_short_cap, short_cap, _ = thresholds.get(part, (3, 5, 40))
    very_short_threshold = very_short_limits.get(part, 15)
    short_threshold      = short_limits.get(part, 40)

    fc = grading.get("band_fc")
    if fc is not None:
        if word_count < very_short_threshold and fc > very_short_cap:
            logger.info(
                "[grading] heuristic cap: word_count=%d < %d → band_fc %s→%s",
                word_count, very_short_threshold, fc, very_short_cap,
            )
            grading["band_fc"] = float(very_short_cap)
            # Also cap LR and GRA for very short responses — insufficient sample
            for k in ("band_lr", "band_gra"):
                if grading.get(k) is not None and grading[k] > 5:
                    grading[k] = 5.0
        elif word_count < short_threshold and fc > short_cap:
            logger.info(
                "[grading] heuristic cap: word_count=%d < %d → band_fc %s→%s",
                word_count, short_threshold, fc, short_cap,
            )
            grading["band_fc"] = float(short_cap)

    # Recompute overall_band from (possibly capped) criterion bands
    crit_vals = [
        float(grading[k])
        for k in ("band_fc", "band_lr", "band_gra", "band_p")
        if grading.get(k) is not None
    ]
    if crit_vals:
        grading["overall_band"] = _round_band(sum(crit_vals) / len(crit_vals))

    return grading


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
                .select("id, part, topic, status, mode")
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
        session_mode: str = session.get("mode", "practice") or "practice"

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

        # ── STEP 3: Whisper STT (directly from in-memory bytes) ──────────────
        # Transcribe BEFORE uploading to storage so we never hit CDN caching:
        # if the same path is upserted and Whisper downloaded via the public URL,
        # the CDN could serve the old file for up to an hour.
        step = "whisper"
        ext      = _guess_ext(audio_file.filename, audio_file.content_type)
        filename = f"audio{ext}"
        logger.info("[grading] gọi Whisper STT (from bytes, %d B)...", file_size)

        try:
            stt = await transcribe_from_bytes(audio_bytes, filename=filename)
        except Exception as e:
            logger.error("[grading] Whisper thất bại: %s", e)
            _mark_session_error(session_id, "stt_failed", "whisper", str(e))
            raise HTTPException(502, f"Lỗi nhận dạng giọng nói (Whisper): {e}")

        # ── STEP 4: Upload to Supabase Storage (archival — non-blocking) ─────
        step = "storage_upload"
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
            err_str = str(e)
            logger.warning("[grading] storage upload FAILED (non-fatal — transcript already done): %s", e)
            if "Bucket not found" in err_str:
                logger.error(
                    "[grading] Supabase Storage bucket '%s' not found. "
                    "Create it in the Supabase dashboard (Storage → New bucket) and set it to Public.",
                    _AUDIO_BUCKET,
                )

        transcript: str       = stt.get("transcript", "").strip()
        duration_sec: float   = stt.get("duration_seconds", 0.0)
        confidence: float     = stt.get("confidence", 0.0)
        transcript_model: str = stt.get("transcript_model", "whisper-1")
        stt_segments: list    = stt.get("segments", [])

        logger.info(
            "[grading] Whisper OK — %d ký tự, %.1fs, conf=%.2f, segments=%d",
            len(transcript), duration_sec, confidence, len(stt_segments),
        )

        # Log Whisper usage (best-effort)
        ai_usage_logger.log_whisper(
            user_id=user_id,
            session_id=session_id,
            model=transcript_model,
            audio_seconds=duration_sec,
        )

        # ── Reliability classification ─────────────────────────────────────────
        reliability = classify_reliability(transcript, stt_segments, duration_sec)
        logger.info(
            "[grading] transcript reliability: %s (score=%.3f)",
            reliability["reliability_label"], reliability["reliability_score"],
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

        # ── STEP 6: Claude grading (non-fatal — degrades gracefully) ─────────
        step = "claude_grade"
        logger.info("[grading] gọi Claude grader (part=%d)...", part)

        grading: dict | None = None
        grading_error: str | None = None

        word_count = len(transcript.split()) if transcript else 0

        try:
            grading = await claude_grader.grade_response(
                question=question_text,
                transcript=transcript,
                part=part,
                mode=session_mode,
                user_id=user_id,
                session_id=session_id,
                reliability=reliability,
                duration_seconds=duration_sec,
                word_count=word_count,
            )
            logger.info("[grading] Claude OK — overall_band=%.1f (pre-cap)", grading["overall_band"])
            grading = _apply_heuristic_caps(grading, word_count, part)
            logger.info("[grading] post-cap overall_band=%.1f", grading["overall_band"])
        except Exception as e:
            grading_error = str(e)
            logger.error("[grading] Claude grader thất bại (non-fatal): %s", e)

        # ── Score confidence (multi-signal) ───────────────────────────────────
        score_confidence = _compute_score_confidence(reliability, duration_sec)
        logger.info("[grading] score_confidence: %s", score_confidence)

        # ── STEP 7: Upsert response row ───────────────────────────────────────
        # Only write columns that exist in the current responses schema:
        #   id, session_id, question_id, user_id, audio_url, transcript,
        #   feedback (TEXT/JSON), overall_band (FLOAT)
        # Full grading dict is serialised into the 'feedback' column.
        step = "db_save"
        response_id: str | None = None

        db_row: dict = {
            "session_id":                  session_id,
            "question_id":                 question_id,
            # user_id intentionally omitted — not a column in the responses table
            "audio_url":                   audio_url,
            # storage_path is the bucket-relative path; used by /audio-urls to generate signed URLs.
            # Only set when upload succeeded (audio_url is not None).
            "audio_storage_path":          storage_path if audio_url else None,
            "transcript":                  transcript,
            "raw_transcript_text":         transcript,     # verbatim copy; reserved for future cleaning pass
            "transcript_model":            transcript_model,
            "transcript_reliability":      reliability["reliability_label"],
            "transcript_reliability_score": reliability["reliability_score"],
            "transcript_logprobs":         json.dumps(stt_segments, ensure_ascii=False) if stt_segments else None,
            "assessment_confidence":       reliability["reliability_label"],
            "score_confidence":            score_confidence,
            "duration_seconds":            round(duration_sec, 2) if duration_sec else None,
            "stt_status":                  "completed",
            "grading_status":              "completed" if grading else "failed",
        }

        if grading:
            db_row["overall_band"] = grading["overall_band"]
            db_row["feedback"]     = json.dumps(grading, ensure_ascii=False)

        # Columns guaranteed to exist in the base schema (no migrations needed).
        # duration_seconds is intentionally excluded: the column may be INTEGER on
        # some deployments (pre-migration-011), and sending a float would fail the
        # core-row retry that is the last line of defence for saving the response.
        _CORE_COLUMNS = {"session_id", "question_id", "audio_url", "transcript",
                         "feedback", "overall_band", "stt_status", "grading_status"}

        def _upsert_response(row: dict) -> str | None:
            existing = (
                supabase_admin.table("responses")
                .select("id")
                .eq("session_id",  session_id)
                .eq("question_id", question_id)
                .limit(1)
                .execute()
            )
            if existing.data:
                rid = existing.data[0]["id"]
                supabase_admin.table("responses").update(row).eq("id", rid).execute()
                return rid
            else:
                res = supabase_admin.table("responses").insert(row).execute()
                return res.data[0]["id"] if res.data else None

        try:
            response_id = _upsert_response(db_row)
            logger.info("[grading] DB save OK (full row) — response_id=%s", response_id)
        except Exception as e:
            logger.warning("[grading] DB save failed with full row (%s) — retrying with core columns only", e)
            # Retry with only the guaranteed base-schema columns so the response is still
            # persisted even if optional migration columns (006/007/008) are not yet applied.
            core_row = {k: v for k, v in db_row.items() if k in _CORE_COLUMNS}
            try:
                response_id = _upsert_response(core_row)
                logger.info("[grading] DB save OK (core row) — response_id=%s — run migrations 006/007/008 to persist full metadata", response_id)
            except Exception as e2:
                logger.error("[grading] DB save FAILED even with core row: %s", e2)

        # ── STEP 8: Token tracking (only when grading succeeded) ──────────────
        if grading:
            step = "update_tokens"
            _increment_tokens(session_id, question_text, transcript, grading)

        # Practice mode returns a different schema than test mode
        is_practice = (session_mode == "practice")

        # ── STEP 8b: Save grammar recommendations (practice mode only) ────────
        if grading and is_practice and response_id:
            saved_recs = _save_grammar_recommendations(
                grading.get("grammar_recommendations") or [],
                user_id=user_id,
                session_id=session_id,
                response_id=response_id,
            )
            grading["grammar_recommendations"] = saved_recs

        # ── STEP 9: Return result ─────────────────────────────────────────────
        logger.info("[grading] pipeline hoàn thành — session=%s question=%s", session_id, question_id)

        assessment_confidence = reliability["reliability_label"]

        if not grading:
            # Audio + transcript saved; AI grading unavailable — tell the frontend
            return {
                "_stub":               True,
                "_error":              "AI grading is temporarily unavailable. Your recording and transcript were saved.",
                "response_id":         response_id,
                "transcript":          transcript,
                "duration_seconds":    round(duration_sec, 2),
                "stt_confidence":      round(confidence, 4),
                "assessment_confidence": assessment_confidence,
                "score_confidence":    score_confidence,
            }

        if is_practice:
            return {
                "response_id":              response_id,
                "transcript":               transcript,
                "duration_seconds":         round(duration_sec, 2),
                "stt_confidence":           round(confidence, 4),
                "assessment_confidence":    assessment_confidence,
                "score_confidence":         score_confidence,
                "overall_band":             grading["overall_band"],
                "grammar_issues":           grading["grammar_issues"],
                "vocabulary_issues":        grading["vocabulary_issues"],
                "pronunciation_issues":     grading.get("pronunciation_issues", []),
                "corrections":              grading["corrections"],
                "strengths":               grading["strengths"],
                "sample_answer":            grading["sample_answer"],
                "grammar_recommendations":  grading.get("grammar_recommendations") or [],
            }

        return {
            "response_id":           response_id,
            "transcript":            transcript,
            "duration_seconds":      round(duration_sec, 2),
            "stt_confidence":        round(confidence, 4),
            "assessment_confidence": assessment_confidence,
            "score_confidence":      score_confidence,
            "band_fc":               grading["band_fc"],
            "band_lr":               grading["band_lr"],
            "band_gra":              grading["band_gra"],
            "band_p":                grading["band_p"],
            "overall_band":          grading["overall_band"],
            "fc_feedback":           grading["fc_feedback"],
            "lr_feedback":           grading["lr_feedback"],
            "gra_feedback":          grading["gra_feedback"],
            "p_feedback":            grading["p_feedback"],
            "strengths":             grading["strengths"],
            "improvements":          grading["improvements"],
            "improved_response":     grading["improved_response"],
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("[grading] lỗi không mong đợi tại step=%s: %s", step, e)
        raise HTTPException(500, f"Lỗi xử lý tại bước '{step}': {e}")


# ── Helpers ────────────────────────────────────────────────────────────────────

def _compute_score_confidence(reliability: dict, duration_sec: float) -> str:
    """
    Compute overall score_confidence from transcript reliability + duration signal.

    Rules (most restrictive wins):
      low  → reliability_label == "low"
           OR duration < 10s (too short to assess meaningfully)
      high → reliability_label == "high" AND 20 <= duration <= 180
      medium → everything else
    """
    label = reliability.get("reliability_label", "high")
    if label == "low" or duration_sec < 10.0:
        return "low"
    if label == "high" and 20.0 <= duration_sec <= 180.0:
        return "high"
    return "medium"


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


def _save_grammar_recommendations(
    recs: list[dict],
    *,
    user_id: str,
    session_id: str,
    response_id: str,
) -> list[dict]:
    """
    Persist grammar_recommendations rows for a graded practice response.
    Best-effort — returns enriched recs with `rec_id` on success, original list on failure.
    Non-fatal if the table doesn't exist yet (pre-migration).
    """
    if not recs:
        return recs
    try:
        rows = [
            {
                "user_id":              user_id,
                "session_id":           session_id,
                "response_id":          response_id,
                "grammar_issue":        r["issue"],
                "recommended_slug":     r["slug"],
                "recommended_category": r["category"],
                "recommended_title":    r["title"],
                "similarity_score":     r["score"],
            }
            for r in recs
        ]
        result = supabase_admin.table("grammar_recommendations").insert(rows).execute()
        logger.info("[grading] saved %d grammar_recommendations for response=%s", len(rows), response_id)
        # Merge saved IDs back into recs so they can be sent to the frontend
        saved = result.data or []
        enriched = []
        for orig, saved_row in zip(recs, saved):
            enriched.append({**orig, "rec_id": saved_row.get("id")})
        return enriched
    except Exception as e:
        logger.debug("[grading] grammar_recommendations save skipped (non-fatal): %s", e)
        return recs


def _increment_tokens(
    session_id: str,
    question_text: str,
    transcript: str,
    grading: dict,
) -> None:
    """
    Ước tính số tokens đã dùng và CỘNG DỒN vào sessions.tokens_used.
    Hoàn toàn best-effort — không raise nếu cột chưa tồn tại.

    Ước tính:
        input  = system_prompt (~1 300) + question + transcript
        output = grading JSON
        total  ≈ input + output  (rough: 4 chars ≈ 1 token)

    Uses read-then-write to accumulate across multiple responses in one session.
    A small race window exists for concurrent submissions but is acceptable given
    this is best-effort tracking.
    """
    try:
        system_tokens  = 1_300   # SYSTEM_PROMPT ≈ 1 241 tokens (measured)
        input_tokens   = system_tokens + (len(question_text) + len(transcript)) // 4
        output_tokens  = len(json.dumps(grading, ensure_ascii=False)) // 4
        new_tokens     = input_tokens + output_tokens

        # Read current accumulated value before adding
        sess_row = (
            supabase_admin.table("sessions")
            .select("tokens_used")
            .eq("id", session_id)
            .limit(1)
            .execute()
        )
        current = (sess_row.data or [{}])[0].get("tokens_used") or 0
        total   = int(current) + new_tokens

        supabase_admin.table("sessions").update(
            {"tokens_used": total}
        ).eq("id", session_id).execute()

        logger.debug("[grading] tokens_used +%d → %d total for session %s", new_tokens, total, session_id)

    except Exception as e:
        logger.debug("[grading] tokens_used update skipped (non-fatal): %s", e)
