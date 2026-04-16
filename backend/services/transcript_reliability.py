"""
services/transcript_reliability.py — Classify STT transcript reliability.

Input: transcript text, segment-level metadata from Whisper verbose_json,
       and audio duration in seconds.

Output:
    {
        "reliability_label": "high" | "medium" | "low",
        "reliability_score": float,   # 0–1 (higher = more reliable)
        "reasons": list[str],         # human-readable reasons (Vietnamese) for non-high labels
    }

Called in grading.py immediately after Whisper STT and before Claude grading.
The result is stored in the DB and passed to the grader so it can hedge
GRA / LR scores when the transcript may be inaccurate.
"""

import logging
import math

logger = logging.getLogger(__name__)


def classify_reliability(
    transcript: str,
    segments: list[dict],       # from whisper._extract_segments()
    duration_sec: float,
) -> dict:
    """
    Classify the reliability of a Whisper transcript.

    Args:
        transcript:   The raw transcript string.
        segments:     List of segment dicts: {start, end, text, avg_logprob, no_speech_prob}.
        duration_sec: Audio duration in seconds.

    Returns:
        {"reliability_label": "high"|"medium"|"low",
         "reliability_score": float,
         "reasons": list[str]}
    """
    reasons: list[str] = []
    score_components: list[tuple[float, float]] = []   # (score, weight)

    # ── 1. Logprob confidence (weight 0.60) ───────────────────────────────────
    logprob_score = _logprob_confidence(segments)
    score_components.append((logprob_score, 0.60))
    if logprob_score < 0.50:
        reasons.append(
            f"Độ tin cậy nhận dạng giọng nói thấp (logprob confidence: {logprob_score:.2f})"
        )
    elif logprob_score < 0.70:
        reasons.append(
            f"Độ tin cậy nhận dạng giọng nói ở mức trung bình ({logprob_score:.2f})"
        )

    # ── 2. Word/duration ratio (weight 0.25) ─────────────────────────────────
    word_rate_score = _word_rate_score(transcript, duration_sec, reasons)
    score_components.append((word_rate_score, 0.25))

    # ── 3. No-speech segment proportion (weight 0.15) ─────────────────────────
    no_speech_score = _no_speech_score(segments, reasons)
    score_components.append((no_speech_score, 0.15))

    # ── Weighted average ───────────────────────────────────────────────────────
    total_weight = sum(w for _, w in score_components)
    reliability_score = sum(s * w for s, w in score_components) / total_weight
    reliability_score = round(max(0.0, min(1.0, reliability_score)), 4)

    # ── Label ─────────────────────────────────────────────────────────────────
    if reliability_score >= 0.75:
        label = "high"
    elif reliability_score >= 0.50:
        label = "medium"
    else:
        label = "low"

    logger.debug(
        "transcript_reliability: label=%s score=%.3f logprob=%.3f word_rate=%.3f no_speech=%.3f",
        label, reliability_score, logprob_score, word_rate_score, no_speech_score,
    )

    return {
        "reliability_label": label,
        "reliability_score": reliability_score,
        "reasons": reasons,
    }


# ── Internal helpers ───────────────────────────────────────────────────────────

def _logprob_confidence(segments: list[dict]) -> float:
    """
    Compute mean per-segment confidence from avg_logprob values.
    avg_logprob ∈ (−∞, 0] → confidence = exp(avg_logprob) ∈ [0, 1].
    Returns 0.5 if no segments (neutral / unknown).
    """
    if not segments:
        return 0.5

    probs = []
    for seg in segments:
        lp = seg.get("avg_logprob")
        if lp is not None and isinstance(lp, (int, float)) and not math.isnan(lp):
            probs.append(max(0.0, min(1.0, math.exp(float(lp)))))

    if not probs:
        return 0.5

    return sum(probs) / len(probs)


def _word_rate_score(transcript: str, duration_sec: float, reasons: list[str]) -> float:
    """
    Score based on words-per-second ratio.
    Normal IELTS speaking: ~1.5–3.5 words/sec.
    Very low rate → likely silence/noise transcribed as nothing or very sparse words.
    Very high rate → Whisper may have hallucinated content (compression artifact).
    """
    if duration_sec < 5.0:
        return 1.0   # too short to judge rate meaningfully

    word_count = len(transcript.split()) if transcript else 0
    wps = word_count / duration_sec

    if wps < 0.5:
        reasons.append(
            f"Tỷ lệ từ/giây rất thấp ({wps:.1f}w/s) — có thể audio có nhiều khoảng im lặng "
            "hoặc chất lượng ghi âm kém"
        )
        return 0.2
    elif wps < 1.0:
        reasons.append(
            f"Tỷ lệ từ/giây thấp ({wps:.1f}w/s) — bài nói có thể chậm hoặc bị nhận dạng thiếu"
        )
        return 0.55
    elif wps > 5.5:
        reasons.append(
            f"Tỷ lệ từ/giây rất cao ({wps:.1f}w/s) — Whisper có thể nhận dạng nhầm hoặc ảo giác"
        )
        return 0.55
    else:
        return 1.0


def _no_speech_score(segments: list[dict], reasons: list[str]) -> float:
    """
    Score based on proportion of segments with high no_speech_prob.
    If >30% of segments are likely silence, confidence is reduced.
    """
    if not segments:
        return 1.0

    high_ns = [s for s in segments if (s.get("no_speech_prob") or 0) > 0.7]
    proportion = len(high_ns) / len(segments)

    if proportion > 0.5:
        reasons.append(
            f"{len(high_ns)}/{len(segments)} phân đoạn có xác suất im lặng cao — "
            "một phần audio có thể không chứa lời nói rõ ràng"
        )
        return 0.2
    elif proportion > 0.3:
        reasons.append(
            f"{len(high_ns)}/{len(segments)} phân đoạn có xác suất im lặng cao"
        )
        return 0.55
    else:
        return 1.0
