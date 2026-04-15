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
import subprocess
from typing import Optional

import httpx

from config import settings

logger = logging.getLogger(__name__)

_API_TIMEOUT = 90  # generous — 2-3 min audio can take ~30 s to process


# ── Audio conversion ───────────────────────────────────────────────────────────

def _convert_to_wav(audio_bytes: bytes) -> bytes | None:
    """
    Convert any browser audio (WebM/Opus, OGG, MP4, etc.) to WAV PCM 16 kHz
    mono 16-bit using ffmpeg via stdin→stdout (no temp files).

    WAV PCM is the most reliably decoded format by the Azure Speech REST API;
    WebM containers can cause InitialSilenceTimeout even when the audio is valid.

    Returns converted WAV bytes, or None if ffmpeg is unavailable or fails.
    Callers should fall back to the original bytes when None is returned.
    """
    try:
        proc = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", "pipe:0",         # read from stdin
                "-ar", "16000",         # 16 kHz — Azure Speech optimal sample rate
                "-ac", "1",             # mono
                "-sample_fmt", "s16",   # 16-bit signed PCM
                "-f", "wav",
                "pipe:1",               # write to stdout
            ],
            input=audio_bytes,
            capture_output=True,
            timeout=30,
        )
        if proc.returncode == 0 and len(proc.stdout) > 44:   # 44 = WAV header size
            logger.info(
                "[azure_pron] ffmpeg WAV conversion OK: %d B → %d B",
                len(audio_bytes), len(proc.stdout),
            )
            return proc.stdout
        else:
            logger.warning(
                "[azure_pron] ffmpeg returned code %d  stderr=%s",
                proc.returncode,
                proc.stderr.decode(errors="replace")[:300],
            )
            return None
    except FileNotFoundError:
        logger.warning("[azure_pron] ffmpeg not found in PATH — skipping WAV conversion")
        return None
    except subprocess.TimeoutExpired:
        logger.warning("[azure_pron] ffmpeg conversion timed out (>30 s)")
        return None
    except Exception as exc:
        logger.warning("[azure_pron] ffmpeg conversion error: %s", exc)
        return None


# ── Assessment config ──────────────────────────────────────────────────────────

def _assessment_header(reference_text: str = "") -> str:
    """Build the base64-encoded Pronunciation-Assessment header value."""
    config = {
        "ReferenceText":          reference_text,
        "GradingSystem":          "HundredMark",
        "Granularity":            "Word",          # Word-level accuracy per token
        "Dimension":              "Comprehensive", # Returns all 4 sub-scores (PronScore, Fluency, Accuracy, Completeness)
        "EnableMiscue":           False,           # True only for strict reading assessment
        "EnableProsodyAssessment": True,           # Required for FluencyScore via REST API
    }
    encoded = base64.b64encode(json.dumps(config, separators=(",", ":")).encode()).decode()
    print(f"[PRON] assessment_header config={json.dumps(config)}  encoded_len={len(encoded)}", flush=True)
    return encoded


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
                "Lần này chưa thu được đủ dữ liệu để nhận xét phát âm — bạn thử nói to và rõ hơn một chút nhé."
            ],
            "raw_payload": azure_response,
        }

    best = nbest[0]

    # Scores are flat on NBest[0] (not nested under PronunciationAssessment)
    pron_score   = best.get("PronScore")
    fluency      = best.get("FluencyScore")
    accuracy     = best.get("AccuracyScore")
    completeness = best.get("CompletenessScore")
    prosody      = best.get("ProsodyScore")   # present when EnableProsodyAssessment=True

    print(
        f"[PRON] scores: PronScore={pron_score}  Fluency={fluency}  "
        f"Accuracy={accuracy}  Completeness={completeness}  Prosody={prosody}",
        flush=True,
    )

    # Word-level: fields are flat on each word object (not nested under PronunciationAssessment)
    raw_words     = best.get("Words", [])
    words         = []
    mispronounced = []

    for w in raw_words:
        acc      = w.get("AccuracyScore")
        err      = w.get("ErrorType", "None")
        feedback = w.get("Feedback")          # present when EnableProsodyAssessment=True
        word_str = w.get("Word", "")

        words.append({
            "word":           word_str,
            "accuracy_score": acc,
            "error_type":     err,
            "feedback":       feedback,
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
        "prosody_score":        _r(prosody),
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
            lines.append("Phát âm của bạn khá tốt — người nghe hoàn toàn có thể hiểu rõ ý bạn muốn truyền đạt.")
        elif pron >= 65:
            lines.append("Bạn đã truyền đạt khá rõ ý, tuy nhiên sẽ tốt hơn nếu chú ý thêm đến độ rõ của từng từ.")
        else:
            lines.append("Hãy chú ý làm rõ từng âm khi nói — luyện chậm trước, sau đó tăng tốc dần sẽ giúp ích nhiều.")

    if fluency is not None and fluency < 65:
        lines.append("Bạn có thể luyện thêm cách nói liên tục, tránh dừng lại giữa chừng để câu nói nghe tự nhiên hơn.")
    elif fluency is not None and fluency >= 80 and pron is not None and pron >= 80:
        lines.append("Tốc độ và nhịp nói khá tự nhiên — đây là điểm cộng lớn trong IELTS Speaking.")

    if mispronounced:
        sample = mispronounced[:4]
        joined = ", ".join(f'"{w}"' for w in sample)
        lines.append(f"Bạn nên dành thêm thời gian luyện phát âm các từ: {joined}.")

    if not lines:
        lines.append("Nhìn chung phần trả lời khá ổn — hãy tiếp tục duy trì phong cách nói tự nhiên này.")

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

    # Convert to WAV PCM before sending — WAV is universally decoded by Azure
    # without container-parsing issues that cause InitialSilenceTimeout on WebM.
    wav_bytes = _convert_to_wav(audio_bytes)
    if wav_bytes:
        send_bytes        = wav_bytes
        send_content_type = "audio/wav"
        print(f"[PRON] WAV conversion OK: {content_type} {len(audio_bytes)}B → WAV {len(wav_bytes)}B", flush=True)
    else:
        # ffmpeg unavailable or failed — fall back to original bytes
        send_bytes        = audio_bytes
        send_content_type = content_type
        print(f"[PRON] WAV conversion SKIPPED — sending original {content_type} {len(audio_bytes)}B", flush=True)

    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type":              send_content_type,
        "Pronunciation-Assessment":  _assessment_header(reference_text),
        # NOTE: No Transfer-Encoding header — httpx sets Content-Length automatically
        # for pre-buffered bytes. Adding chunked here conflicted with Content-Length
        # and caused Azure to misparse the audio container start.
    }

    print(f"[PRON] → Azure POST {len(send_bytes)}B  content_type={send_content_type}  locale={locale}", flush=True)

    async with httpx.AsyncClient(timeout=_API_TIMEOUT) as client:
        resp = await client.post(url, headers=headers, content=send_bytes)

    print(f"[PRON] ← Azure HTTP {resp.status_code}  response_size={len(resp.content)}B", flush=True)

    if resp.status_code != 200:
        print(f"[PRON] Azure API error {resp.status_code}: {resp.text[:300]}", flush=True)
        raise RuntimeError(
            f"Azure trả về lỗi {resp.status_code}: {resp.text[:200]}"
        )

    try:
        data = resp.json()
    except Exception as exc:
        print(f"[PRON] Non-JSON response: {resp.text[:200]}", flush=True)
        raise RuntimeError(f"Azure response không phải JSON hợp lệ: {exc}") from exc

    recognition_status = data.get("RecognitionStatus", "MISSING")
    nbest = data.get("NBest", [])
    display_text = data.get("DisplayText", "")

    print(f"[PRON] RecognitionStatus={recognition_status}  NBest={len(nbest)}  DisplayText={display_text[:60]!r}", flush=True)

    if nbest:
        best = nbest[0]
        # Scores are flat on NBest[0] (confirmed from actual Azure response shape)
        print(
            f"[PRON] NBest[0] PronScore={best.get('PronScore')}  Fluency={best.get('FluencyScore')}  "
            f"Accuracy={best.get('AccuracyScore')}  Completeness={best.get('CompletenessScore')}  "
            f"Prosody={best.get('ProsodyScore')}  Words={len(best.get('Words', []))}",
            flush=True,
        )
    else:
        safe_keys = {k: (v if not isinstance(v, (dict, list)) else type(v).__name__) for k, v in data.items()}
        print(f"[PRON] NBest EMPTY — full response shape: {safe_keys}", flush=True)
        logger.warning("[azure_pron] NBest is empty. Full response shape: %s", safe_keys)

    return _normalize(data)
