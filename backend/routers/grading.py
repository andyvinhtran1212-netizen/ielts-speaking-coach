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

import asyncio
import json
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Form, Header, HTTPException, UploadFile, File

from config import settings
from database import supabase_admin
from routers.auth import get_supabase_user
from services.whisper import transcribe_from_bytes
from services import claude_grader
from services import ai_usage_logger
from services.transcript_reliability import classify_reliability
from services.audio_validation import AudioTooShortError, validate_audio_duration
from services.grading_telemetry import log_fallback_events
from services.grading_providers.errors import FallbackEvent
from services.length_warning import (
    LENGTH_SOFT_WARNING_THRESHOLDS_SECONDS,
    get_length_warning_context,
)
from services.off_topic_judge import OffTopicVerdict, get_judge
from services.grammar_check import (
    GrammarCheckResult,
    get_grammar_check_service,
)
from dataclasses import asdict

logger = logging.getLogger(__name__)

router = APIRouter(tags=["grading"])


# Sprint 6.0 archived `needs_review` (error phrases) from persistence
# because surfacing them in the main vocab bank encouraged learners to
# memorise the wrong form. Sprint 10.1.5 reverses that archival — the
# items ARE useful as a "learning from mistakes" surface, just not
# in the same bucket as the items the learner used correctly. So:
#   - Re-enable persistence of needs_review here (this constant).
#   - The list endpoint in routers/vocabulary_bank.py default-excludes
#     needs_review so the main bank stays "ổn items only".
#   - A dedicated GET /api/vocabulary/needs-review endpoint surfaces
#     the items on a separate "Needs Review" tab in vocabulary.html.
_PERSISTED_SOURCE_TYPES: frozenset[str] = frozenset({
    "used_well",
    "upgrade_suggested",
    "needs_review",
})

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
    background_tasks: BackgroundTasks = BackgroundTasks(),
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
        # Sprint 14.2 — Andy 2026-05-22 — added too-SHORT gate alongside the
        # existing too-long gate. Whisper duration is authoritative; the
        # frontend's MediaRecorder clock is unreliable on Chrome < 115.
        # AudioTooShortError carries a structured detail body so the UI can
        # render an actionable re-record prompt with the exact threshold.
        step = "duration_check"
        max_dur = settings.MAX_AUDIO_DURATION_SECONDS
        if duration_sec > max_dur:
            raise HTTPException(
                422,
                f"Audio quá dài ({duration_sec:.0f}s). Giới hạn là {max_dur}s."
            )

        try:
            validate_audio_duration(duration_sec, part)
        except AudioTooShortError as too_short:
            logger.info(
                "[grading] audio rejected — too short: part=%d duration=%.2fs min=%ds",
                too_short.part, too_short.duration_seconds, too_short.min_seconds,
            )
            raise HTTPException(status_code=422, detail=too_short.to_detail())

        if not transcript:
            raise HTTPException(
                422,
                "Không nhận dạng được giọng nói. Hãy kiểm tra microphone và thử lại."
            )

        # ── Sprint 14.7 — length soft-warning context (L7, L8) ───────────────
        # Computed before grading so the context can be injected into
        # the grader prompt. The hard reject (Sprint 14.2) already ran
        # above; this only fires for durations above the floor but
        # below the soft cap (2× hard reject per L7).
        length_warning_fires, length_context = get_length_warning_context(
            part, duration_sec,
        )

        # ── STEP 6: Claude grading + off-topic judge (parallel — L2) ─────────
        step = "claude_grade"
        logger.info("[grading] gọi Claude grader (part=%d)...", part)

        grading: dict | None = None
        grading_error: str | None = None
        off_topic_verdict: OffTopicVerdict | None = None

        word_count = len(transcript.split()) if transcript else 0

        # Sprint 14.3 — collect orchestrator telemetry for the
        # `grading_events` audit table. The list is populated by
        # claude_grader regardless of whether grading ultimately
        # succeeds or fails (L7).
        fallback_events: list[FallbackEvent] = []

        # Sprint 14.7 L2 — fire grader + judge concurrently so total
        # latency is max(grader, judge), not sum. The judge is
        # *non-blocking*: any failure (timeout, all-providers-fail,
        # parse error) returns None and grading proceeds normally
        # (L11). The judge's own telemetry is persisted via its own
        # log_fallback_events call inside OffTopicJudge.judge, so we
        # don't need to plumb its events through fallback_events.
        grading_task = asyncio.create_task(
            claude_grader.grade_response(
                question=question_text,
                transcript=transcript,
                part=part,
                mode=session_mode,
                user_id=user_id,
                session_id=session_id,
                reliability=reliability,
                duration_seconds=duration_sec,
                word_count=word_count,
                fallback_events=fallback_events,
                length_context=length_context,
            )
        )
        judge_task = asyncio.create_task(
            get_judge().judge(
                question=question_text,
                transcript=transcript,
                part_num=part,
                user_id=user_id,
                session_id=session_id,
                question_id=question_id,
            )
        )
        # Sprint 14.8 L2 — third parallel task: grammar checker. The
        # service has its own 15s timeout + silent-skip contract, so
        # any failure mode here returns None and grading carries on.
        grammar_task = asyncio.create_task(
            get_grammar_check_service().check(
                transcript,
                question_id=question_id,
                session_id=session_id,
            )
        )

        try:
            grading = await grading_task
            logger.info("[grading] Claude OK — overall_band=%.1f (pre-cap)", grading["overall_band"])
            grading = _apply_heuristic_caps(grading, word_count, part)
            logger.info("[grading] post-cap overall_band=%.1f", grading["overall_band"])
        except Exception as e:
            grading_error = str(e)
            logger.error("[grading] Claude grader thất bại (non-fatal): %s", e)

        # Judge runs to completion regardless of grader outcome — its
        # signal is independent. Wrap in try because asyncio.create_task
        # propagation semantics surface awaited exceptions even though
        # OffTopicJudge.judge is designed never to raise.
        try:
            off_topic_verdict = await judge_task
        except Exception as judge_exc:
            logger.warning(
                "[grading] off-topic judge unexpected error (silent skip): %s",
                judge_exc,
            )
            off_topic_verdict = None

        # Sprint 14.8 — third await, completing the parallel triple.
        # The grammar service is designed never to raise (silent skip
        # on every failure path), but wrap in try just like the judge
        # to keep grading robust to an asyncio cancellation edge case.
        grammar_result: GrammarCheckResult | None = None
        try:
            grammar_result = await grammar_task
        except Exception as grammar_exc:
            logger.warning(
                "[grading] grammar check unexpected error (silent skip): %s",
                grammar_exc,
            )
            grammar_result = None

        # ── Score confidence (multi-signal) ───────────────────────────────────
        score_confidence = _compute_score_confidence(reliability, duration_sec)
        logger.info("[grading] score_confidence: %s", score_confidence)

        # ── Signal block (Sprint 14.7 / 14.8) ─────────────────────────────────
        # off-topic + length + grammar signals. Built HERE (before the DB save)
        # as of Sprint 14.8.1 (Codex F1) so they can be persisted into
        # responses.feedback — previously this dict was built after the save and
        # the signals were returned to the caller only, so they vanished when
        # result.html re-read responses.feedback on reload. Surfaced in every
        # return branch (stub, practice, test) via `**signals`.
        signals: dict = {
            "off_topic_verdict": (
                {
                    "is_on_topic": off_topic_verdict.is_on_topic,
                    "reasoning":   off_topic_verdict.reasoning,
                }
                if off_topic_verdict is not None
                else None
            ),
            "length_warning":         length_warning_fires,
            "audio_duration_seconds": round(duration_sec, 2),
            "length_soft_threshold":  LENGTH_SOFT_WARNING_THRESHOLDS_SECONDS.get(part),
            # Structured grammar errors from services.grammar_check (Sprint 14.8;
            # named `grammar_check` to avoid collision with Sprint 14.5's
            # qualitative `grammar_issues` coaching text — both coexist).
            "grammar_check": (
                {
                    "errors":          [asdict(e) for e in grammar_result.errors],
                    "total_count":     grammar_result.total_count,
                    "displayed_count": grammar_result.displayed_count,
                    "cached":          grammar_result.cached,
                }
                if grammar_result is not None
                else None
            ),
        }

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
            # Sprint 14.8.1 (Codex F1) — persist the signals alongside the grade
            # so off-topic / length / grammar survive a page reload (result.html
            # re-reads responses.feedback). Additive: all grading keys preserved;
            # signals add off_topic_verdict / length_warning / audio_duration_seconds
            # / length_soft_threshold / grammar_check (no key collisions).
            db_row["feedback"]     = json.dumps({**grading, **signals}, ensure_ascii=False)

        # Columns guaranteed to exist in the base schema (no migrations needed).
        # duration_seconds is intentionally excluded: the column may be INTEGER on
        # some deployments (pre-migration-011), and sending a float would fail the
        # core-row retry that is the last line of defence for saving the response.
        _CORE_COLUMNS = {"session_id", "question_id", "audio_url", "transcript",
                         "feedback", "overall_band", "stt_status", "grading_status"}

        def _upsert_response(row: dict) -> str | None:
            # Sprint 14.8.2 (Codex F3) — atomic upsert. A single round-trip
            # INSERT ... ON CONFLICT (session_id, question_id) DO UPDATE, which is
            # race-safe across concurrent submits / double-clicks. Replaces the
            # prior select-then-update/insert, whose read and write could interleave
            # under concurrency and create duplicate rows.
            #   - Requires the partial UNIQUE index uq_responses_session_question
            #     (migration 077, applied to prod 2026-05-24 before this swap).
            #   - created_at / regrade_metadata are NOT in `row`, so on insert the DB
            #     default applies and on update they are left untouched (preserved).
            #   - Returns the upserted row's id (insert or update) for the downstream
            #     grammar_recommendations / pronunciation steps.
            res = (
                supabase_admin.table("responses")
                .upsert(row, on_conflict="session_id,question_id")
                .execute()
            )
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

        # ── Sprint 14.3 — orchestrator audit trail ───────────────────────────
        # Best-effort. Captures every provider attempt (success, retry,
        # fallback) so we can answer "how often does Haiku fail?" without
        # adding a new metrics backend. Failure here NEVER blocks grading.
        if fallback_events:
            log_fallback_events(
                session_id=session_id,
                question_id=question_id,
                response_id=response_id,
                events=fallback_events,
            )

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

        # ── STEP 8c: Schedule vocab extraction (background, failure-isolated) ──
        vocab_analysis_enabled = os.environ.get("VOCAB_ANALYSIS_ENABLED", "false").lower() == "true"
        if vocab_analysis_enabled and transcript and response_id:
            background_tasks.add_task(
                _run_vocab_extraction,
                transcript=transcript,
                response_id=response_id,
                user_id=user_id,
                session_id=session_id,
            )

        # ── STEP 9: Return result ─────────────────────────────────────────────
        logger.info("[grading] pipeline hoàn thành — session=%s question=%s", session_id, question_id)

        assessment_confidence = reliability["reliability_label"]

        # Sprint 14.8.1 (Codex F1) — `signals` is built earlier now (before the
        # DB save) so off-topic / length / grammar persist into
        # responses.feedback rather than being returned-only. See the block above.

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
                **signals,
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
                **signals,
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
            **signals,
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
                # Sprint 4 Phase 6: persist deep-link anchor (migration 032).
                # Falls back to NULL when matcher couldn't resolve a specific
                # anchor — frontend then renders the article-level URL.
                "recommended_anchor":   r.get("anchor"),
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


async def _run_vocab_extraction(
    transcript: str,
    response_id: str,
    user_id: str,
    session_id: str,
) -> None:
    """
    Background task: extract vocab from transcript and persist to user_vocabulary.
    Entirely failure-isolated — any exception is logged and swallowed.
    """
    try:
        from services.vocab_extractor import extract_vocab
        from services.vocab_guards import run_all_guards

        # Per-user feature flag check
        flag_row = (
            supabase_admin.table("users")
            .select("feature_flags")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        feature_flags = (flag_row.data or [{}])[0].get("feature_flags") or {}
        if feature_flags.get("vocab_enabled") is not True:
            logger.debug("[vocab_bg] user %s vocab_enabled not set — skip", user_id)
            return

        result = await extract_vocab(transcript, response_id, user_id, session_id)
        if result is None:
            return

        # Fetch the session's topic once — every row inserted below is tagged
        # with it so Phase D Wave 2's flashcard "Manual Stack" filter can group
        # cards by topic without a JOIN at query time.  Migration 028 added
        # the column and backfilled historical rows; this keeps new rows
        # populated going forward.  Failure is non-fatal — leave topic NULL.
        session_topic: str | None = None
        try:
            sess_row = (
                supabase_admin.table("sessions")
                .select("topic")
                .eq("id", session_id)
                .limit(1)
                .execute()
            )
            session_topic = (sess_row.data or [{}])[0].get("topic")
        except Exception as topic_err:
            logger.debug("[vocab_bg] session topic lookup failed (non-fatal): %s", topic_err)

        # Fetch existing headwords + lemmas for guard 6 (Sprint 10.1).
        # Selecting both columns is one round-trip; the lemma column
        # backfills to non-NULL after the Sprint 10.1 backfill script
        # runs, but pre-backfill rows still have lemma IS NULL so we
        # tolerate that gracefully — Guard 6 falls back to the legacy
        # heuristic checks when `existing_lemmas` doesn't contain a
        # matching entry.
        existing_rows = (
            supabase_admin.table("user_vocabulary")
            .select("headword, lemma")
            .eq("user_id", user_id)
            .eq("is_archived", False)
            .execute()
        )
        existing_headwords = [r["headword"].lower() for r in (existing_rows.data or [])]
        existing_lemmas = [
            (r.get("lemma") or "").lower()
            for r in (existing_rows.data or [])
            if r.get("lemma")
        ]

        rows_to_insert = []
        max_per_category = settings.VOCAB_MAX_PER_CATEGORY

        used_well_headwords = {item.headword.lower() for item in result.used_well}

        category_map = [
            ("used_well", result.used_well),
            ("needs_review", result.needs_review),
            ("upgrade_suggested", result.upgrade_suggested),
        ]

        # Sprint 6.0 — Speaking grading no longer persists `needs_review`
        # as vocabulary. Error phrases are not vocabulary; they belong
        # in a future error-tracking surface (Sprint 6.1+). The AI
        # extraction layer (result.needs_review above) is preserved on
        # purpose so the classification stays addressable; we just stop
        # writing those rows. Migration 048 archives the 24 legacy ones.
        # Allowlist lives at module level — see _PERSISTED_SOURCE_TYPES.

        for source_type, items in category_map:
            if source_type not in _PERSISTED_SOURCE_TYPES:
                if items:
                    logger.info(
                        "[vocab_bg] Sprint 6.0 — skipping persist of %d "
                        "%s items (extraction kept for future surfacing)",
                        len(items), source_type,
                    )
                continue
            count = 0
            for item in items:
                if count >= max_per_category:
                    break
                item_dict = item.model_dump()

                # Sprint 10.1 — compute lemma + POS BEFORE Guard 6 fires
                # so lemma-equality dedup catches ran/run, went/go, etc.
                # Failure mode is fail-soft: if spaCy can't load, log
                # once and proceed with NULL lemma columns — Guard 6
                # then falls back to its legacy heuristics. Capture
                # pipeline must not break on spaCy install issues.
                try:
                    from services.lemmatizer import lemmatize, lemma_version
                    new_lemma, new_pos = lemmatize(item.headword)
                    new_lemma_version = lemma_version()
                except Exception as lem_err:
                    logger.warning(
                        "[vocab_bg] lemmatize failed for '%s' (%s) — "
                        "proceeding with NULL lemma; backfill will retry",
                        item.headword, lem_err,
                    )
                    new_lemma, new_pos, new_lemma_version = None, None, None

                passed, failed_guard = run_all_guards(
                    item_dict, transcript, source_type, existing_headwords,
                    used_well_headwords=used_well_headwords,
                    existing_lemmas=existing_lemmas,
                    new_lemma=new_lemma,
                )
                if not passed:
                    logger.debug("[vocab_bg] guard rejected '%s': %s", item.headword, failed_guard)
                    continue

                rows_to_insert.append({
                    "user_id":           user_id,
                    "session_id":        session_id,
                    "response_id":       response_id,
                    "headword":          item.headword,
                    # Sprint 10.1 dual-write: surface_form mirrors the
                    # verbatim headword the learner produced; lemma is
                    # the dictionary form for dedup; pos is spaCy's
                    # universal tag; lemma_version is the rule-set
                    # pointer the backfill compares against.
                    "surface_form":      item.headword,
                    "lemma":             new_lemma,
                    "pos":               new_pos,
                    "lemma_version":     new_lemma_version,
                    "context_sentence":  item.context_sentence,
                    "evidence_substring": item.evidence_substring or None,
                    "category":          item.category,
                    "source_type":       source_type,
                    "reason":            item.reason[:200] if item.reason else None,
                    "definition_en":     item.definition_en,
                    "definition_vi":     item.definition_vi,
                    "original_word":     item.original_word if source_type == "upgrade_suggested" else None,
                    "suggestion":        item.suggestion if source_type == "needs_review" else None,
                    "topic":             session_topic,
                    # Sprint 10.6 (migration 055) — mastery_status column
                    # dropped. derive_mastery_status() returns 'learning'
                    # for rows without a flashcard_reviews entry (the
                    # default state for fresh captures).
                    "is_archived":       False,
                    # Sprint 10.4 — capture rows land pending. The user
                    # confirms via the result.html pending panel
                    # (GET/POST /api/vocabulary/pending); the bank-read
                    # paths filter is_pending=false so these stay
                    # hidden from My Vocab Bank, flashcards, D1 target
                    # resolution, etc. until confirmed. pending_created_at
                    # anchors the 24h auto-commit lazy cleanup.
                    "is_pending":         True,
                    "pending_created_at": datetime.now(timezone.utc).isoformat(),
                })
                existing_headwords.append(item.headword.lower())
                if new_lemma:
                    existing_lemmas.append(new_lemma.lower())
                count += 1

        if not rows_to_insert:
            logger.info("[vocab_bg] no items passed guards for response=%s", response_id)
            return

        # Phase D Wave 2 rich-content: enrich each headword with IPA + a clean
        # standalone example sentence so the flashcard back face can show
        # vetted reference material instead of recycling the learner's own
        # transcript.  Fail-soft — if Gemini errors, vocab still saves with
        # ipa/example_sentence NULL and the admin backfill job can fill them
        # in later.  Migration 029 added the columns; absence of either
        # field is the universal "not yet enriched" sentinel.
        try:
            from services.vocab_enrichment import enrich_vocabulary_batch
            unique_headwords = list({r["headword"] for r in rows_to_insert})
            enrichments = enrich_vocabulary_batch(unique_headwords)
            enrich_map = {e["headword"].lower(): e for e in enrichments}
            for row in rows_to_insert:
                e = enrich_map.get(row["headword"].lower())
                if e:
                    row["ipa"] = e["ipa"]
                    row["example_sentence"] = e["example_sentence"]
            logger.info(
                "[vocab_bg] enriched %d/%d headwords with IPA+example",
                sum(1 for r in rows_to_insert if r.get("ipa")), len(rows_to_insert),
            )
        except Exception as enrich_err:
            # NEVER block the insert — vocab still saves; backfill will fill
            # ipa/example_sentence later.  Phase B integration anti-pattern:
            # treat enrichment as best-effort, the vocab itself is the value.
            logger.warning("[vocab_bg] enrichment failed (continuing without): %s", enrich_err)

        inserted = 0
        for row in rows_to_insert:
            try:
                supabase_admin.table("user_vocabulary").insert(row).execute()
                inserted += 1
            except Exception as insert_err:
                err_str = str(insert_err).lower()
                if any(k in err_str for k in ("unique", "duplicate", "23505")):
                    logger.info(
                        "[vocab_bg] duplicate skip '%s' for user=%s", row["headword"], user_id
                    )
                else:
                    # Non-duplicate error (network, schema, permission): re-raise so
                    # the outer handler logs one proper failure instead of silently continuing.
                    raise

        logger.info(
            "[vocab_bg] persisted %d/%d vocab items for user=%s response=%s",
            inserted, len(rows_to_insert), user_id, response_id,
        )

    except Exception as e:
        logger.error("[vocab_bg] extraction failed (non-fatal): %s", e)
