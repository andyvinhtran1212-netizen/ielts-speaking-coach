"""
services/listening_renderer.py — Sprint 11.1 (DEBT-LISTENING-MODULE 1/5).

Renders a script into MP3 audio via the ElevenLabs HTTP API, uploads
the result to the `listening-audio` Supabase Storage bucket, and
INSERTs a `listening_content` row with status='draft'. Fires as a
FastAPI BackgroundTask scheduled by routers/listening.py
admin_render_listening.

Why the HTTP API directly + no SDK (Sprint 11.1 spec falsification):
  The full ElevenLabs Python SDK pulls ~12 deps + opinionated client
  state. Our use is a single POST per render — `requests.post(...)`
  is 5 lines. Dependency surface stays minimal; if/when we need
  voice cloning or webhook subscriptions, revisit.

Retry strategy:
  Reuses services.d1_question_generator._call_with_retry (Sprint 10.7
  pattern — 3 attempts, exponential backoff, longer delays for 429
  rate limits). The helper is generic — only its log line mentions
  `vocab_id` which we co-opt as the render job_id for tracing. When
  a third consumer of the retry helper lands (Sprint 11.5+ analytics
  AI?), extract _call_with_retry into services/_retry.py per Gate 3.

Fail-soft contract:
  The BackgroundTask path is fire-and-forget — exceptions inside the
  job MUST NOT propagate (FastAPI would just swallow them anyway).
  The job logs WARN/ERROR and exits; the admin polls the content
  list to see whether the row landed. A future sprint can add a
  `listening_render_jobs` audit table if Andy wants per-job status.
"""

from __future__ import annotations

import logging
from typing import Any

import requests

from config import settings
from database import supabase_admin
from services.d1_question_generator import _call_with_retry

logger = logging.getLogger(__name__)


_ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
_DEFAULT_VOICE_SETTINGS = {
    "stability": 0.5,
    "similarity_boost": 0.5,
}
# Sprint 11.0 §3C — credit cost model: 1 char ≈ 2 credits for
# Multilingual v2, ≈ 1 credit for Flash v2.5. Used for the
# generation_cost_credits column estimate (true cost lands when
# ElevenLabs returns it in response headers; this is the fallback
# when the header is absent).
_CREDITS_PER_CHAR_BY_MODEL = {
    "eleven_multilingual_v2": 2,
    "eleven_flash_v2_5": 1,
}


# ── ElevenLabs HTTP wrapper ────────────────────────────────────────────────────


def render_via_elevenlabs(
    *,
    script_text: str,
    voice_id: str,
    model: str,
    timeout_seconds: int = 120,
) -> bytes:
    """Sync. POST to ElevenLabs TTS endpoint and return the MP3 bytes.

    Raises:
        requests.HTTPError on 4xx/5xx (the caller's retry wrapper
            classifies — 5xx + 429 retried, 4xx propagates).
        requests.Timeout on socket / network timeout.
    """
    if not settings.ELEVENLABS_API_KEY:
        # Defensive — the router gates this already with a 503, but if a
        # backfill script or test calls the function directly we still
        # want a clear failure mode.
        raise RuntimeError("ELEVENLABS_API_KEY not configured")

    url = _ELEVENLABS_TTS_URL.format(voice_id=voice_id)
    headers = {
        "xi-api-key": settings.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    payload = {
        "text": script_text,
        "model_id": model,
        "voice_settings": dict(_DEFAULT_VOICE_SETTINGS),
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=timeout_seconds)
    resp.raise_for_status()
    return resp.content


def _estimate_credit_cost(script_text: str, model: str) -> int:
    """Sprint 11.0 §3C — char-count × per-model multiplier. Used when
    ElevenLabs response doesn't carry a precise credit-cost header."""
    per_char = _CREDITS_PER_CHAR_BY_MODEL.get(model, 2)
    return len(script_text) * per_char


# ── BackgroundTask entry point ────────────────────────────────────────────────


def run_elevenlabs_render_job(
    *,
    job_id: str,
    script_text: str,
    voice_id: str,
    model: str,
    title: str,
    accent_tag: str,
    cefr_level: str | None,
    ielts_section: int | None,
    topic_tags: list[str] | None,
    transcript: str | None,
    created_by_user_id: str,
) -> None:
    """BackgroundTask entry. Renders → uploads → INSERTs the draft row.

    Fail-soft: any failure logs ERROR and returns. The admin polls the
    content list to see whether a draft landed.

    Args mirror the ListeningRenderRequest body fields from
    routers/listening.py plus `created_by_user_id` (the admin who
    initiated the render).
    """
    logger.info(
        "[listening_renderer] render job %s starting (voice=%s, model=%s, chars=%d)",
        job_id, voice_id, model, len(script_text),
    )

    # ── Step 1: render via ElevenLabs (with retry) ────────────────────────────
    def _do_render() -> bytes:
        return render_via_elevenlabs(
            script_text=script_text, voice_id=voice_id, model=model,
        )

    try:
        mp3_bytes = _call_with_retry(
            _do_render,
            provider="elevenlabs",
            vocab_id=job_id,  # repurposed as job_id for log traceability
        )
    except Exception as e:
        logger.error(
            "[listening_renderer] render job %s — ElevenLabs render failed "
            "after retries (script=%d chars): %s",
            job_id, len(script_text), e,
        )
        return

    audio_size_bytes = len(mp3_bytes)
    # ElevenLabs MP3 is 128 kbps mono → ~16 KB/sec. Coarse but adequate
    # for the schema's `audio_duration_seconds NOT NULL` requirement at
    # render time; precise duration would require mutagen / ffprobe and
    # we don't need that precision for the UI (the audio player gets the
    # real duration from the <audio> element on load).
    audio_duration_seconds = max(1, round(audio_size_bytes / 16_000))

    # ── Step 2: upload to bucket ──────────────────────────────────────────────
    storage_path = f"ai/{job_id}.mp3"
    try:
        supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET).upload(
            storage_path,
            mp3_bytes,
            {"content-type": "audio/mpeg"},
        )
    except Exception as e:
        # Mirror grading.py:240-250 pattern — likely cause is bucket not
        # provisioned (operator step from migration 056).
        msg = str(e).lower()
        if "not found" in msg or "bucket" in msg:
            logger.error(
                "[listening_renderer] Supabase Storage bucket '%s' not found. "
                "Create it in the Supabase dashboard (Storage → New bucket, "
                "Private) and add a SELECT policy for authenticated users. "
                "Job %s — audio NOT saved.",
                settings.LISTENING_AUDIO_BUCKET, job_id,
            )
        else:
            logger.error(
                "[listening_renderer] render job %s — bucket upload failed: %s",
                job_id, e,
            )
        return

    # ── Step 3: INSERT the draft row ──────────────────────────────────────────
    insert_payload: dict[str, Any] = {
        "id":                       job_id,
        "source_type":              "ai_elevenlabs",
        "elevenlabs_voice_id":      voice_id,
        "elevenlabs_model":         model,
        "generation_cost_credits":  _estimate_credit_cost(script_text, model),
        "audio_storage_path":       storage_path,
        "audio_duration_seconds":   audio_duration_seconds,
        "audio_size_bytes":         audio_size_bytes,
        "accent_tag":               accent_tag,
        "topic_tags":               topic_tags or [],
        "cefr_level":               cefr_level,
        "ielts_section":            ielts_section,
        # If the operator hasn't supplied a transcript yet (common — the
        # rendered audio IS the script_text), default to the script.
        "transcript":               transcript or script_text,
        "transcript_segments":      [],   # Sprint 11.2 audio player adds
                                          # segment-level granularity later.
        "status":                   "draft",
        "is_premium":               False,
        "title":                    title,
        "created_by":               created_by_user_id,
    }

    try:
        supabase_admin.table("listening_content").insert(insert_payload).execute()
    except Exception as e:
        logger.error(
            "[listening_renderer] render job %s — DB INSERT failed (audio in "
            "bucket but no row); manual reconciliation needed at path %s: %s",
            job_id, storage_path, e,
        )
        return

    logger.info(
        "[listening_renderer] render job %s complete — content_id=%s, "
        "duration=%ds, size=%d bytes, cost=%d credits",
        job_id, job_id, audio_duration_seconds, audio_size_bytes,
        insert_payload["generation_cost_credits"],
    )
