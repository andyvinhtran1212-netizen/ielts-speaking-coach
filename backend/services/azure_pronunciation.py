"""
services/azure_pronunciation.py — Azure Cognitive Services Pronunciation Assessment

Uses the Azure Speech REST API with a Pronunciation-Assessment header.
No Azure SDK required — just httpx (already in the project).

Supported audio content-types (pass as content_type):
  audio/webm; codecs=opus   — browser MediaRecorder default
  audio/ogg; codecs=opus
  audio/wav                 — PCM WAV
  audio/mpeg                — MP3

IELTS context:
  reference_text is optional. When omitted, Azure runs in free-speech mode —
  it transcribes what it hears and then assesses pronunciation against that
  transcription. This is more appropriate for IELTS speaking (open answers)
  than strict reading-aloud comparison.

Required env vars:
  AZURE_SPEECH_KEY     — Azure Cognitive Services subscription key
  AZURE_SPEECH_REGION  — region slug, e.g. "eastus", "southeastasia"

Azure docs:
  https://learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text-short
  https://learn.microsoft.com/azure/ai-services/speech-service/pronunciation-assessment-tool
"""

import base64
import json
import logging
from typing import Optional

import httpx

from config import settings

logger = logging.getLogger(__name__)

_API_TIMEOUT = 90  # generous — 2-3 min audio can take ~30 s to process


# ── Assessment config ──────────────────────────────────────────────────────────

def _assessment_header(reference_text: str = "") -> str:
    """Build the base64-encoded Pronunciation-Assessment header value."""
    config = {
        "ReferenceText":  reference_text,
        "GradingSystem":  "HundredMark",
        "Granularity":    "Word",          # Word-level accuracy per token
        "Dimension":      "Comprehensive", # Returns all 4 sub-scores
        "EnableMiscue":   False,           # True only for strict reading assessment
    }
    return base64.b64encode(json.dumps(config).encode()).decode()


# ── Normalizer ─────────────────────────────────────────────────────────────────

def _normalize(azure_response: dict) -> dict:
    """
    Flatten Azure's nested JSON into a clean app-friendly structure.

    Returns:
    {
        "pronunciation_score":     float | None,  # PronScore 0–100
        "fluency_score":           float | None,
        "accuracy_score":          float | None,
        "completeness_score":      float | None,
        "words":                   list[dict],    # word-level results
        "short_summary":           list[str],     # 2–3 human-readable comments
        "raw_payload":             dict,          # stored verbatim in DB
    }
    """
    nbest = azure_response.get("NBest", [])
    if not nbest:
        return {
            "pronunciation_score":  None,
            "fluency_score":        None,
            "accuracy_score":       None,
            "completeness_score":   None,
            "words":                [],
            "short_summary":        [
                "Không đánh giá được phát âm. Kiểm tra chất lượng âm thanh và thử lại."
            ],
            "raw_payload": azure_response,
        }

    best = nbest[0]
    pa   = best.get("PronunciationAssessment", {})

    pron_score   = pa.get("PronScore")
    fluency      = pa.get("FluencyScore")
    accuracy     = pa.get("AccuracyScore")
    completeness = pa.get("CompletenessScore")

    # Word-level: collect all words, flag mispronounced ones
    raw_words     = best.get("Words", [])
    words         = []
    mispronounced = []

    for w in raw_words:
        word_pa  = w.get("PronunciationAssessment", {})
        acc      = word_pa.get("AccuracyScore")
        err      = word_pa.get("ErrorType", "None")
        word_str = w.get("Word", "")

        words.append({
            "word":           word_str,
            "accuracy_score": acc,
            "error_type":     err,
        })

        if (err and err != "None") or (acc is not None and acc < 60):
            mispronounced.append(word_str)

    summary = _build_summary(pron_score, fluency, accuracy, completeness, mispronounced)

    def _r(v):
        return round(v, 1) if v is not None else None

    return {
        "pronunciation_score":  _r(pron_score),
        "fluency_score":        _r(fluency),
        "accuracy_score":       _r(accuracy),
        "completeness_score":   _r(completeness),
        "words":                words,
        "short_summary":        summary,
        "raw_payload":          azure_response,
    }


def _build_summary(
    pron:          Optional[float],
    fluency:       Optional[float],
    accuracy:      Optional[float],
    completeness:  Optional[float],
    mispronounced: list[str],
) -> list[str]:
    lines: list[str] = []

    if pron is not None:
        if pron >= 80:
            lines.append(f"Phát âm tổng quan tốt (điểm: {pron:.0f}/100).")
        elif pron >= 65:
            lines.append(
                f"Phát âm ở mức trung bình ({pron:.0f}/100) — còn nhiều cơ hội cải thiện."
            )
        else:
            lines.append(f"Phát âm cần cải thiện đáng kể ({pron:.0f}/100).")

    if fluency is not None and fluency < 65:
        lines.append("Độ lưu loát còn hạn chế — thử nói rõ ràng, đừng ngập ngừng.")
    elif fluency is not None and fluency >= 80 and pron is not None and pron >= 80:
        lines.append("Nói trôi chảy, ít bị ngắt quãng.")

    if mispronounced:
        sample = mispronounced[:4]
        joined = ", ".join(f'"{w}"' for w in sample)
        lines.append(f"Chú ý phát âm các từ: {joined}.")

    if not lines:
        lines.append("Chưa đủ dữ liệu để đưa ra nhận xét cụ thể.")

    return lines[:3]


# ── Public API ─────────────────────────────────────────────────────────────────

async def assess_pronunciation(
    audio_bytes:    bytes,
    content_type:   str = "audio/webm; codecs=opus",
    locale:         str = "en-US",
    reference_text: str = "",
) -> dict:
    """
    Call Azure Pronunciation Assessment REST API.

    Args:
        audio_bytes:    Raw audio bytes from Supabase Storage.
        content_type:   MIME type passed verbatim as Content-Type to Azure.
        locale:         BCP-47 locale, default "en-US".
        reference_text: Optional transcript for comparison (free-speech if empty).

    Returns: Normalized dict from _normalize().
    Raises:
        ValueError:   AZURE_SPEECH_KEY or AZURE_SPEECH_REGION not set.
        RuntimeError: Azure returned a non-200 or non-JSON response.
    """
    key    = getattr(settings, "AZURE_SPEECH_KEY",    "") or ""
    region = getattr(settings, "AZURE_SPEECH_REGION", "") or ""

    if not key or not region:
        raise ValueError(
            "AZURE_SPEECH_KEY và AZURE_SPEECH_REGION phải được khai báo trong .env"
        )

    url = (
        f"https://{region}.stt.speech.microsoft.com"
        f"/speech/recognition/conversation/cognitiveservices/v1"
        f"?language={locale}&format=detailed"
    )

    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type":              content_type,
        "Pronunciation-Assessment":  _assessment_header(reference_text),
        "Transfer-Encoding":         "chunked",
    }

    logger.info(
        "[azure_pron] POST %d bytes  locale=%s  ref_text_len=%d",
        len(audio_bytes), locale, len(reference_text),
    )

    async with httpx.AsyncClient(timeout=_API_TIMEOUT) as client:
        resp = await client.post(url, headers=headers, content=audio_bytes)

    if resp.status_code != 200:
        logger.error("[azure_pron] API error %d: %s", resp.status_code, resp.text[:300])
        raise RuntimeError(
            f"Azure trả về lỗi {resp.status_code}: {resp.text[:200]}"
        )

    try:
        data = resp.json()
    except Exception as exc:
        raise RuntimeError(f"Azure response không phải JSON hợp lệ: {exc}") from exc

    logger.info("[azure_pron] OK  RecognitionStatus=%s", data.get("RecognitionStatus", "?"))
    return _normalize(data)
