"""services/tts_audio.py — Slice-2 vocab audio: TTS synth + bucket store.

Shared by the live /tts endpoint (routers/tts.py) and the offline pregen script
(scripts/pregen_vocab_audio.py). The OpenAI call is extracted here so both reuse
exactly one synth path (no behaviour change to /tts).

Pregen flow: text → synth mp3 → upload to the `vocab-audio` bucket at a
content-addressed path (sha256 of text+voice+accent) → return its public URL.
The hash path makes it idempotent + de-duped: identical text+voice is generated
once (get_or_create_audio skips the TTS call when the object already exists), and
a future engine swap (different accent tag) lands at clean new paths.

NOTE: OpenAI tts-1 accent is voice-determined (American-leaning), NOT guaranteed
RP British — acceptable for accent-neutral IELTS practice; a true en-GB engine is
a later swap (the accent tag in the hash keeps that swap clean).
"""

from __future__ import annotations

import hashlib
import logging

from config import settings
from database import supabase_admin

logger = logging.getLogger(__name__)

VOCAB_AUDIO_BUCKET = "vocab-audio"
DEFAULT_VOICE = "nova"            # matches the /tts default (IELTS examiner-ish)
_MODEL = "tts-1"
# Cache-bust tag baked into the path hash. Bump (or make voice-derived) when the
# engine/accent changes so old + new audio don't collide at the same object key.
_ACCENT_TAG = "openai-tts-1"
_ALLOWED_VOICES = {"alloy", "echo", "fable", "onyx", "nova", "shimmer"}


async def synthesize_mp3(text: str, voice: str = DEFAULT_VOICE) -> bytes:
    """Text → mp3 bytes via OpenAI TTS. Raises RuntimeError if no key configured.
    This is the SINGLE synth path — /tts awaits it too (no behaviour change)."""
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY not configured — TTS unavailable")
    safe_voice = voice if voice in _ALLOWED_VOICES else DEFAULT_VOICE
    import openai
    client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=30.0)  # Mục 12 (B4): bound a hung TTS call
    response = await client.audio.speech.create(
        model=_MODEL,
        voice=safe_voice,        # type: ignore[arg-type]
        input=text,
        response_format="mp3",
    )
    return response.content


def _engine_tag(engine: str) -> str:
    """Per-engine cache-bust tag baked into the path hash so OpenAI + ElevenLabs
    audio for the SAME text land at DIFFERENT object keys (switching engine never
    overwrites the other; audio_url just points at whichever was generated last)."""
    if engine == "elevenlabs":
        return f"elevenlabs-{settings.VOCAB_TTS_ELEVENLABS_VOICE_ID}"
    return _ACCENT_TAG          # "openai-tts-1" (unchanged → existing paths stable)


def audio_path(text: str, voice: str = DEFAULT_VOICE, engine: str = "openai") -> str:
    """Content-addressed object key: sha256(text|voice|engineTag).mp3. Same text +
    voice + engine → same path → generate-once / de-dup; different engine → new path."""
    key = f"{text}|{voice}|{_engine_tag(engine)}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest() + ".mp3"


def audio_exists(path: str) -> bool:
    """True if the object is already in the bucket (hash-skip). Best-effort:
    any storage error (incl. a missing bucket) → False so the caller proceeds to
    synth/upload, where a real error surfaces clearly."""
    try:
        res = supabase_admin.storage.from_(VOCAB_AUDIO_BUCKET).list(
            "", {"search": path})
        return any((o or {}).get("name") == path for o in (res or []))
    except Exception as exc:  # noqa: BLE001
        logger.debug("[tts_audio] exists-check failed for %s: %s", path, exc)
        return False


def public_url(path: str) -> str:
    return supabase_admin.storage.from_(VOCAB_AUDIO_BUCKET).get_public_url(path)


def upload_mp3(path: str, data: bytes) -> None:
    supabase_admin.storage.from_(VOCAB_AUDIO_BUCKET).upload(
        path=path,
        file=data,
        file_options={"content-type": "audio/mpeg", "upsert": "true"},
    )


async def get_or_create_audio(text: str, voice: str = DEFAULT_VOICE) -> tuple[str, bool]:
    """Async OpenAI path (used by /tts-adjacent flows + the #551 pregen script).
    Hash-skip: existing object → URL without calling TTS (did_synthesize=False)."""
    path = audio_path(text, voice, "openai")
    if audio_exists(path):
        return public_url(path), False
    data = await synthesize_mp3(text, voice)
    upload_mp3(path, data)
    return public_url(path), True


# ── Engine-selectable SYNC path (V-eleven; used by the admin BackgroundTask) ───
# The admin "Generate voice" job runs as a FastAPI BackgroundTask (sync → thread
# pool), so both engines use blocking calls here — no event-loop blocking.

ELEVENLABS_MODEL_DEFAULT = "eleven_multilingual_v2"
VALID_ENGINES = ("openai", "elevenlabs")


def _synth_openai_sync(text: str, voice: str = DEFAULT_VOICE) -> bytes:
    if not settings.OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY not configured")
    import openai
    client = openai.OpenAI(api_key=settings.OPENAI_API_KEY, timeout=30.0)  # Mục 12 (B4): bound a hung TTS call
    resp = client.audio.speech.create(
        model=_MODEL,
        voice=(voice if voice in _ALLOWED_VOICES else DEFAULT_VOICE),  # type: ignore[arg-type]
        input=text,
        response_format="mp3",
    )
    return resp.content


def _synth_elevenlabs_sync(text: str) -> bytes:
    """ElevenLabs TTS (en-GB voice from config). Mirrors listening_renderer's REST
    call: POST /v1/text-to-speech/{voice_id} with xi-api-key → mp3 bytes."""
    if not settings.ELEVENLABS_API_KEY:
        raise RuntimeError("ELEVENLABS_API_KEY not configured")
    import requests
    voice_id = settings.VOCAB_TTS_ELEVENLABS_VOICE_ID
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": settings.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    payload = {
        "text": text,
        "model_id": settings.VOCAB_TTS_ELEVENLABS_MODEL or ELEVENLABS_MODEL_DEFAULT,
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.5},
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=120)
    resp.raise_for_status()
    return resp.content


def synth_sync(text: str, engine: str = "openai", voice: str = DEFAULT_VOICE) -> bytes:
    """Engine-dispatch (sync). engine='openai' (default) | 'elevenlabs'."""
    if engine == "elevenlabs":
        return _synth_elevenlabs_sync(text)
    return _synth_openai_sync(text, voice)


def get_or_create_audio_sync(
    text: str, engine: str = "openai", voice: str = DEFAULT_VOICE,
) -> tuple[str, bool]:
    """Sync (public_url, did_synthesize) for the chosen engine. Hash-skip per
    (text, voice, engine): same engine re-run → skip; different engine → new path."""
    path = audio_path(text, voice, engine)
    if audio_exists(path):
        return public_url(path), False
    data = synth_sync(text, engine, voice)
    upload_mp3(path, data)
    return public_url(path), True
