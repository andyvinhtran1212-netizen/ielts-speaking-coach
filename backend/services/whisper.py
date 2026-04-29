"""
services/whisper.py — Speech-to-text via OpenAI Whisper API

Usage:
    from services.whisper import transcribe_audio, transcribe_from_url

    # From a local file:
    result = await transcribe_audio("path/to/recording.mp3")

    # From a Supabase Storage public URL:
    result = await transcribe_from_url("https://...supabase.co/storage/v1/object/public/...")

    Returns:
        {
            "transcript":        "The candidate's spoken text",
            "duration_seconds":  42.1,
            "language":          "en",
            "confidence":        0.95,   # estimated from avg_logprob of segments
            "transcript_model":  "whisper-1",
            "segments":          [{"start":0.0,"end":3.2,"text":"...","avg_logprob":-0.18,"no_speech_prob":0.01}],
        }

Test:
    python -c "
    import asyncio
    from services.whisper import transcribe_audio
    print(asyncio.run(transcribe_audio('test.mp3')))
    "
"""

import io
import logging
import math
import os
import tempfile
import uuid

import httpx
from openai import AsyncOpenAI

from config import settings

logger = logging.getLogger(__name__)

# Lazy client — instantiated on first call so import never raises even if key is missing.
_client: AsyncOpenAI | None = None

# Verbatim transcription prompt: biases Whisper to preserve speech disfluencies,
# fillers (uh, um, er), hesitations, and repetitions as-is.
#
# IMPORTANT — examples-only, NO instruction sentences.  whisper-1 treats the
# `prompt` arg as STYLE CONTEXT, not as a system instruction; instruction-style
# phrasing ("Transcribe every word…", "Do not fix grammar") leaks into the
# transcript output verbatim.  Phase 2.5 dogfood Day 2 caught one transcript
# echoing the old instruction sentence three times at the head of the output.
# Disfluency examples alone are enough to bias the model toward preserving
# speech artifacts.
_VERBATIM_PROMPT = (
    "Uh, um, er, I mean, you know, like, well, so..."
)


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        if not settings.OPENAI_API_KEY:
            raise RuntimeError(
                "OPENAI_API_KEY chưa được cấu hình. "
                "Thêm OPENAI_API_KEY=sk-... vào file .env."
            )
        _client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    return _client


# ── Public functions ───────────────────────────────────────────────────────────

async def transcribe_audio(audio_file_path: str) -> dict:
    """
    Gọi OpenAI Whisper API để transcribe audio file local.

    Args:
        audio_file_path: Đường dẫn tới file MP3 / WAV / WebM / M4A / OGG.
                         File phải tồn tại và nhỏ hơn 25 MB (giới hạn Whisper API).

    Returns:
        {
            "transcript":        str,    # văn bản đã nhận dạng
            "duration_seconds":  float,  # độ dài audio (giây)
            "language":          str,    # ngôn ngữ phát hiện, e.g. "en"
            "confidence":        float,  # 0–1, ước tính từ avg_logprob
        }

    Raises:
        FileNotFoundError: Nếu file không tồn tại.
        RuntimeError: Nếu OPENAI_API_KEY chưa cấu hình.
        openai.OpenAIError: Nếu API trả lỗi.
    """
    if not os.path.isfile(audio_file_path):
        raise FileNotFoundError(f"File không tồn tại: {audio_file_path}")

    client = _get_client()

    logger.info("Whisper: bắt đầu transcribe %s", audio_file_path)

    with open(audio_file_path, "rb") as f:
        response = await client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            response_format="verbose_json",   # trả thêm metadata: segments, duration, language
            language="en",                    # chỉ định tiếng Anh để tăng độ chính xác IELTS
            prompt=_VERBATIM_PROMPT,          # bias toward preserving fillers/disfluencies
        )

    # ── Extract transcript ─────────────────────────────────────────────────────
    transcript = response.text.strip() if response.text else ""

    # ── Extract duration ───────────────────────────────────────────────────────
    duration_seconds: float = getattr(response, "duration", 0.0) or 0.0

    # ── Extract language ───────────────────────────────────────────────────────
    language: str = getattr(response, "language", "en") or "en"

    raw_segments = getattr(response, "segments", None)

    # ── Estimate confidence from segments' avg_logprob ─────────────────────────
    # avg_logprob is in range (−∞, 0]; −0.2 is good, −1.0+ is low confidence.
    # Map to [0, 1]: confidence = exp(avg_logprob), clamped to [0, 1].
    confidence: float = _estimate_confidence(raw_segments)
    segments: list[dict] = _extract_segments(raw_segments)

    result = {
        "transcript":        transcript,
        "duration_seconds":  round(duration_seconds, 2),
        "language":          language,
        "confidence":        round(confidence, 4),
        "transcript_model":  "whisper-1",
        "segments":          segments,
    }

    logger.info(
        "Whisper: xong — %d ký tự, %.1fs, lang=%s, conf=%.2f, segments=%d",
        len(transcript), duration_seconds, language, confidence, len(segments),
    )

    return result


async def transcribe_from_bytes(audio_bytes: bytes, filename: str = "audio.webm") -> dict:
    """
    Transcribe audio directly from in-memory bytes — no temp file, no download.

    Preferred over transcribe_from_url when the bytes are already in memory
    (e.g. freshly uploaded via multipart form). Avoids CDN caching issues that
    arise when re-uploading to the same Supabase Storage path and then downloading
    back via the public URL.

    Args:
        audio_bytes: Raw audio bytes (WebM / MP3 / WAV / OGG / M4A).
        filename:    Logical filename including extension; passed to the API so
                     Whisper knows the container format.

    Returns:
        Same schema as :func:`transcribe_audio`.
    """
    client = _get_client()

    size_mb = len(audio_bytes) / (1024 * 1024)
    logger.info("Whisper: transcribe_from_bytes — %.2f MB, filename=%s", size_mb, filename)

    if size_mb > 24.5:
        raise ValueError(
            f"File audio quá lớn ({size_mb:.1f} MB). "
            "Whisper API giới hạn 25 MB mỗi request."
        )

    buffer = io.BytesIO(audio_bytes)

    response = await client.audio.transcriptions.create(
        model="whisper-1",
        file=(filename, buffer),        # tuple form: (name, file-like) — SDK uses name for Content-Disposition
        response_format="verbose_json",
        language="en",
        prompt=_VERBATIM_PROMPT,        # bias toward preserving fillers/disfluencies
    )

    transcript = response.text.strip() if response.text else ""
    duration_seconds: float = getattr(response, "duration", 0.0) or 0.0
    language: str = getattr(response, "language", "en") or "en"
    raw_segments = getattr(response, "segments", None)
    confidence: float = _estimate_confidence(raw_segments)
    segments: list[dict] = _extract_segments(raw_segments)

    result = {
        "transcript":        transcript,
        "duration_seconds":  round(duration_seconds, 2),
        "language":          language,
        "confidence":        round(confidence, 4),
        "transcript_model":  "whisper-1",
        "segments":          segments,
    }

    logger.info(
        "Whisper: xong — %d ký tự, %.1fs, lang=%s, conf=%.2f, segments=%d",
        len(transcript), duration_seconds, language, confidence, len(segments),
    )

    return result


async def transcribe_from_url(audio_url: str) -> dict:
    """
    Download audio từ Supabase Storage URL, transcribe, rồi xóa file tạm.

    Args:
        audio_url: URL công khai của file audio trên Supabase Storage.

    Returns:
        Cùng schema với :func:`transcribe_audio`.

    Raises:
        httpx.HTTPError: Nếu download thất bại.
        RuntimeError: Nếu OPENAI_API_KEY chưa cấu hình.
    """
    logger.info("Whisper: download audio từ URL: %s", audio_url[:80])

    # Đoán extension từ URL (giúp Whisper nhận đúng format)
    url_path = audio_url.split("?")[0]
    ext      = os.path.splitext(url_path)[1].lower() or ".webm"

    tmp_path = os.path.join(tempfile.gettempdir(), f"whisper_{uuid.uuid4().hex}{ext}")

    try:
        # Download với timeout rộng để xử lý file lớn
        async with httpx.AsyncClient(timeout=60.0) as http:
            async with http.stream("GET", audio_url) as resp:
                resp.raise_for_status()
                with open(tmp_path, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=65_536):
                        f.write(chunk)

        file_size_mb = os.path.getsize(tmp_path) / (1024 * 1024)
        logger.info("Whisper: đã download %.2f MB → %s", file_size_mb, tmp_path)

        if file_size_mb > 24.5:
            raise ValueError(
                f"File audio quá lớn ({file_size_mb:.1f} MB). "
                "Whisper API giới hạn 25 MB mỗi request."
            )

        return await transcribe_audio(tmp_path)

    finally:
        # Luôn xóa file tạm dù có lỗi hay không
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
                logger.debug("Whisper: đã xóa file tạm %s", tmp_path)
            except OSError as e:
                logger.warning("Whisper: không xóa được file tạm %s: %s", tmp_path, e)


# ── Internal helpers ───────────────────────────────────────────────────────────

def _extract_segments(segments) -> list[dict]:
    """
    Extract per-segment metadata from verbose_json response into a serialisable list.

    Each item: {"start": float, "end": float, "text": str,
                 "avg_logprob": float, "no_speech_prob": float}
    Used downstream by transcript_reliability.classify_reliability().
    """
    if not segments:
        return []

    result = []
    for seg in segments:
        if isinstance(seg, dict):
            result.append({
                "start":          float(seg.get("start") or 0),
                "end":            float(seg.get("end") or 0),
                "text":           str(seg.get("text") or "").strip(),
                "avg_logprob":    float(seg.get("avg_logprob") or 0),
                "no_speech_prob": float(seg.get("no_speech_prob") or 0),
            })
        else:
            result.append({
                "start":          float(getattr(seg, "start", 0) or 0),
                "end":            float(getattr(seg, "end", 0) or 0),
                "text":           str(getattr(seg, "text", "") or "").strip(),
                "avg_logprob":    float(getattr(seg, "avg_logprob", 0) or 0),
                "no_speech_prob": float(getattr(seg, "no_speech_prob", 0) or 0),
            })
    return result


def _estimate_confidence(segments) -> float:
    """
    Tính confidence trung bình từ danh sách segments của verbose_json response.

    avg_logprob ∈ (−∞, 0]. Công thức: confidence = exp(avg_logprob), clamp [0, 1].
    Nếu không có segments (e.g. audio im lặng), trả 0.0.
    """
    if not segments:
        return 0.0

    log_probs = []
    for seg in segments:
        lp = None
        # verbose_json segments là object với thuộc tính hoặc dict tùy phiên bản SDK
        if isinstance(seg, dict):
            lp = seg.get("avg_logprob")
        else:
            lp = getattr(seg, "avg_logprob", None)

        if lp is not None and isinstance(lp, (int, float)) and not math.isnan(lp):
            log_probs.append(float(lp))

    if not log_probs:
        return 0.0

    avg = sum(log_probs) / len(log_probs)
    return max(0.0, min(1.0, math.exp(avg)))
