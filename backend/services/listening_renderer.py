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
# Sprint 11.4 bonus — same endpoint with `/with-timestamps` returns
# the audio_base64 + per-character alignment data so the segment
# editor can derive sentence boundaries exactly.
_ELEVENLABS_TTS_WITH_TIMESTAMPS_URL = (
    "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps"
)
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


def render_via_elevenlabs_with_timestamps(
    *,
    script_text: str,
    voice_id: str,
    model: str,
    timeout_seconds: int = 180,
) -> tuple[bytes, dict | None]:
    """Sprint 11.4 bonus — POST to /with-timestamps and return
    (mp3_bytes, alignment_dict). The alignment dict has the shape:

        {
          "characters":                    ["G", "o", "o", "d", ...],
          "character_start_times_seconds": [0.0, 0.046, ...],
          "character_end_times_seconds":   [0.046, 0.092, ...]
        }

    Returns (bytes, None) if the alignment field is absent on the
    response (older ElevenLabs API tier without alignment support);
    the caller falls back gracefully.

    Raises:
        requests.HTTPError on 4xx/5xx.
        requests.Timeout on socket timeout.
        RuntimeError if the API key is missing OR response is missing
            the audio_base64 field.
    """
    import base64

    if not settings.ELEVENLABS_API_KEY:
        raise RuntimeError("ELEVENLABS_API_KEY not configured")

    url = _ELEVENLABS_TTS_WITH_TIMESTAMPS_URL.format(voice_id=voice_id)
    headers = {
        "xi-api-key": settings.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    payload = {
        "text": script_text,
        "model_id": model,
        "voice_settings": dict(_DEFAULT_VOICE_SETTINGS),
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=timeout_seconds)
    resp.raise_for_status()

    data = resp.json()
    audio_b64 = data.get("audio_base64") or ""
    if not audio_b64:
        raise RuntimeError(
            "ElevenLabs /with-timestamps response missing audio_base64",
        )
    mp3_bytes = base64.b64decode(audio_b64)

    alignment = data.get("alignment")
    if isinstance(alignment, dict) and alignment.get("characters"):
        return mp3_bytes, alignment
    # Older API tier — no alignment.
    return mp3_bytes, None


def _estimate_credit_cost(script_text: str, model: str) -> int:
    """Sprint 11.0 §3C — char-count × per-model multiplier. Used when
    ElevenLabs response doesn't carry a precise credit-cost header."""
    per_char = _CREDITS_PER_CHAR_BY_MODEL.get(model, 2)
    return len(script_text) * per_char


# ── BackgroundTask entry point ────────────────────────────────────────────────


def _mark_render_failed(content_id: str, reason: str) -> None:
    """Sprint 13.3.1 — flip the placeholder row to status='archived'
    when the render pipeline fails. The frontend treats archived +
    NULL audio_storage_path + source_type='ai_elevenlabs' as the
    canonical "render failed" signal and surfaces a banner.

    Idempotent (an UPDATE on a missing row is a no-op result).
    """
    try:
        supabase_admin.table("listening_content").update({
            "status": "archived",
        }).eq("id", content_id).execute()
        logger.warning(
            "[listening_renderer] marked placeholder %s as archived (%s)",
            content_id, reason,
        )
    except Exception as e:
        logger.error(
            "[listening_renderer] failed to mark placeholder %s archived: %s",
            content_id, e,
        )


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
    """BackgroundTask entry. Renders → uploads → UPDATEs the placeholder
    row that the router INSERTed synchronously at POST /render time.

    Sprint 13.3.1: this used to INSERT a brand-new row at completion,
    which raced the frontend's redirect into content-detail.html?id=...
    The router now creates the row up-front (audio_storage_path=NULL,
    duration=0, size=0); this task UPDATEs the same row in place.

    Failure modes:
      - ElevenLabs call exhausts retries  → UPDATE status='archived'
      - Storage upload fails              → UPDATE status='archived'
      - DB UPDATE fails                   → log only (admin sees stuck row)

    Args mirror ListeningRenderRequest plus `created_by_user_id`. The
    `title`, `accent_tag`, `cefr_level`, `ielts_section`, `topic_tags`,
    `transcript`, `created_by_user_id` args are now redundant (the
    router persisted them on the placeholder row), but the signature
    stays stable for backward compat with any callers that still pass
    them positionally.
    """
    _ = (title, accent_tag, cefr_level, ielts_section, topic_tags,
         transcript, created_by_user_id)  # appease unused-var linters

    logger.info(
        "[listening_renderer] render job %s starting (voice=%s, model=%s, chars=%d)",
        job_id, voice_id, model, len(script_text),
    )

    # ── Step 1: render via ElevenLabs /with-timestamps (Sprint 11.4 bonus) ────
    def _do_render() -> tuple[bytes, dict | None]:
        return render_via_elevenlabs_with_timestamps(
            script_text=script_text, voice_id=voice_id, model=model,
        )

    alignment: dict | None = None
    try:
        mp3_bytes, alignment = _call_with_retry(
            _do_render,
            provider="elevenlabs",
            vocab_id=job_id,
        )
    except Exception as e:
        logger.error(
            "[listening_renderer] render job %s — ElevenLabs render failed "
            "after retries (script=%d chars): %s",
            job_id, len(script_text), e,
        )
        _mark_render_failed(job_id, f"elevenlabs_render_failed: {e}")
        return

    audio_size_bytes = len(mp3_bytes)
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
        _mark_render_failed(job_id, f"bucket_upload_failed: {e}")
        return

    # ── Step 3: UPDATE the placeholder row with the rendered payload ─────────
    update_payload: dict[str, Any] = {
        "audio_storage_path":       storage_path,
        "audio_duration_seconds":   audio_duration_seconds,
        "audio_size_bytes":         audio_size_bytes,
        "alignment_data":           alignment,
        "generation_cost_credits":  _estimate_credit_cost(script_text, model),
        # Re-assert status='draft' in case the placeholder got flipped
        # to 'archived' by a prior failed attempt that's now succeeded
        # on retry (idempotency hedge).
        "status":                   "draft",
    }

    try:
        supabase_admin.table("listening_content").update(update_payload).eq(
            "id", job_id,
        ).execute()
    except Exception as e:
        logger.error(
            "[listening_renderer] render job %s — DB UPDATE failed (audio in "
            "bucket but row not updated); manual reconciliation needed at "
            "path %s: %s",
            job_id, storage_path, e,
        )
        return

    logger.info(
        "[listening_renderer] render job %s complete — content_id=%s, "
        "duration=%ds, size=%d bytes, cost=%d credits",
        job_id, job_id, audio_duration_seconds, audio_size_bytes,
        update_payload["generation_cost_credits"],
    )
