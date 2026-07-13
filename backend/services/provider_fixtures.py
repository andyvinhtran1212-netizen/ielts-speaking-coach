"""Deterministic provider fixtures for the SPEAKING pipeline (plan Phase 0 / B2).

When ``GRADING_PROVIDER_MODE=fixture`` the three provider seams — Whisper STT
(services/whisper.py), the speaking grader (services/claude_grader.py) and
Azure pronunciation (services/azure_pronunciation.py) — return the
deterministic, production-shaped payloads below instead of calling the real
APIs. Everything downstream (validation, persistence, band aggregation,
grammar recommendations) runs exactly as in production, which is the point:
staging E2E exercises the REAL persistence path with zero AI cost and zero
flakiness.

Scope v1 (documented in ADR/plan): speaking pipeline only. The writing grader
keeps calling real providers; a writing fixture lands with the writing E2E
slice. Fault injection (``GRADING_FIXTURE_FAULT``) targets the grader seam:
  timeout    -> asyncio.TimeoutError  (transient-style failure)
  429 / 5xx  -> AllProvidersFailedError (terminal orchestrator outcome)
  malformed  -> payload missing required fields (validator/handling path)

SAFETY: ``assert_fixture_mode_safe()`` is called from main.py startup and
ABORTS the process if fixture mode is combined with the production
environment or the production Supabase project. Clients can never select the
provider mode — it is a server-side env var read at process start.
"""

from __future__ import annotations

import asyncio

from config import settings

_PROD_SUPABASE_REF = "huwsmtubwulikhlmcirx"


def fixture_mode_enabled() -> bool:
    return (settings.GRADING_PROVIDER_MODE or "real").lower() == "fixture"


def assert_fixture_mode_safe() -> None:
    """Abort startup when fixture mode points at production (fail-closed)."""
    if not fixture_mode_enabled():
        return
    env = (settings.ENVIRONMENT or "").lower()
    if env == "production" or _PROD_SUPABASE_REF in (settings.SUPABASE_URL or ""):
        raise RuntimeError(
            "GRADING_PROVIDER_MODE=fixture is FORBIDDEN with the production "
            "environment/project (plan §Phase 0: fixture must fail closed). "
            f"ENVIRONMENT={settings.ENVIRONMENT!r}, SUPABASE_URL points at "
            "the production project."
        )


def _maybe_raise_grader_fault() -> None:
    fault = (settings.GRADING_FIXTURE_FAULT or "").lower()
    if not fault:
        return
    if fault == "timeout":
        raise asyncio.TimeoutError("fixture fault: grader timeout")
    if fault in ("429", "5xx"):
        from services.grading_providers.errors import AllProvidersFailedError, FallbackEvent
        raise AllProvidersFailedError(events=[FallbackEvent(
            provider="fixture", attempt=1,
            outcome="retryable_error", latency_ms=1,
            error_status=fault, error_type="fixture_fault",
        )])


_TRANSCRIPT = (
    "Well, I think learning English is really important for my future career. "
    "I practice speaking every day with my friends, and sometimes I record "
    "myself to check my pronunciation. In my opinion, the most difficult part "
    "is remembering new vocabulary, but I try to use flashcards and I review "
    "them before I go to bed. Last month I joined an online speaking club and "
    "it helped me become more confident when I talk with foreigners."
)


def fixture_transcription(filename: str = "audio.webm") -> dict:
    """Production-shaped Whisper result (services/whisper.transcribe_*)."""
    words = _TRANSCRIPT.split()
    return {
        "transcript": _TRANSCRIPT,
        "duration_seconds": 45.0,
        "language": "en",
        "confidence": 0.92,
        "transcript_model": "fixture",
        "segments": [
            {"start": 0.0, "end": 22.5, "text": " ".join(words[: len(words) // 2]),
             "avg_logprob": -0.18, "no_speech_prob": 0.01},
            {"start": 22.5, "end": 45.0, "text": " ".join(words[len(words) // 2:]),
             "avg_logprob": -0.22, "no_speech_prob": 0.02},
        ],
    }


def fixture_speaking_grade(mode: str = "test") -> dict:
    """Production-shaped grader payload (claude_grader._REQUIRED_FIELDS*)."""
    _maybe_raise_grader_fault()
    if (settings.GRADING_FIXTURE_FAULT or "").lower() == "malformed":
        return {"band_fc": 6, "note": "fixture fault: malformed — required fields missing"}

    if mode == "practice":
        return {
            "grammar_issues": ["Thì hiện tại đơn dùng chưa nhất quán ở ngôi thứ ba."],
            "vocabulary_issues": ["Lặp lại 'important' — thử 'essential', 'crucial'."],
            "pronunciation_issues": ["Chú ý âm cuối /s/ và /t/ khi nói nhanh."],
            "corrections": [
                {
                    "original": "I practice speaking every day with my friends",
                    "corrected": "I practise speaking with my friends every day",
                    "explanation": "Trạng ngữ tần suất đặt sau tân ngữ nghe tự nhiên hơn.",
                },
                {
                    "original": "it helped me become more confident",
                    "corrected": "it has helped me become more confident",
                    "explanation": "Hiện tại hoàn thành cho kết quả còn kéo dài tới hiện tại.",
                },
            ],
            "strengths": ["Ý tưởng rõ ràng, có ví dụ cụ thể.", "Độ trôi chảy ổn định."],
            "sample_answer": (
                "Learning English plays a central role in my career plans. I set aside "
                "time every day to speak with friends, and I often record myself so I "
                "can spot pronunciation slips. The hardest part, in my experience, is "
                "retaining new vocabulary, so I rely on spaced-repetition flashcards "
                "that I review each night. Recently I joined an online speaking club, "
                "which has made me noticeably more confident with strangers."
            ),
            "overall_band": 6.0,
            "rubric_version": "fixture-v1",
        }

    return {
        "band_fc": 6,
        "band_lr": 6,
        "band_gra": 6,
        "overall_band": 6.0,
        "fc_feedback": "Trả lời mạch lạc, có mở rộng ý; đôi chỗ ngập ngừng khi chuyển ý.",
        "lr_feedback": "Từ vựng đủ dùng, có một số cụm tốt; còn lặp từ cơ bản.",
        "gra_feedback": "Câu ghép dùng được; lỗi nhỏ ở mạo từ và thì hoàn thành.",
        "strengths": ["Ý tưởng rõ ràng, ví dụ cụ thể.", "Tốc độ nói ổn định."],
        "improvements": ["Đa dạng hóa từ nối.", "Kiểm soát thì hiện tại hoàn thành."],
        "improved_response": (
            "Learning English is central to my career ambitions. I practise daily "
            "with friends and record myself to catch pronunciation slips. The "
            "toughest challenge is retaining vocabulary, so I use spaced-repetition "
            "flashcards every night, and an online speaking club I joined recently "
            "has made me far more confident with strangers."
        ),
        "rubric_version": "fixture-v1",
    }


def fixture_speaking_grade_raw(mode: str = "test") -> str:
    """The grader fixture as the RAW JSON text the orchestrator would return —
    injected pre-validator so validation + post-processing run for real."""
    import json
    return json.dumps(fixture_speaking_grade(mode), ensure_ascii=False)


def fixture_pronunciation() -> dict:
    """Production-shaped Azure result (azure_pronunciation.assess_pronunciation)."""
    return {
        "pronunciation_score": 78.0,
        "fluency_score": 80.0,
        "accuracy_score": 76.0,
        "completeness_score": 95.0,
        "prosody_score": 72.0,
        "words": [
            {"word": "important", "accuracy_score": 88.0, "error_type": "None",
             "feedback": None,
             "phonemes": [{"symbol": "ɪ", "score": 90.0}, {"symbol": "m", "score": 92.0}]},
            {"word": "vocabulary", "accuracy_score": 61.0, "error_type": "Mispronunciation",
             "feedback": None,
             "phonemes": [{"symbol": "v", "score": 70.0}, {"symbol": "æ", "score": 52.0}]},
        ],
        "weak_phonemes": [
            {"symbol": "æ", "score": 52.0, "word": "vocabulary", "word_index": 1},
        ],
        "short_summary": [
            "Phát âm tổng thể rõ, người nghe hiểu dễ dàng.",
            "Chú ý nguyên âm /æ/ trong các từ đa âm tiết.",
        ],
        "raw_payload": {"fixture": True},
    }
