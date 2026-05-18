"""
services/listening_gist_grader.py — Sprint 11.4 (DEBT-LISTENING-
MODULE 4/5).

Grades a user's free-text "main idea / gist" response against a
rubric containing the admin-authored model answer + rubric keywords.

Why Haiku (claude-haiku-4-5):
  Gist grading is semantic-equivalence judgement — \"did the user
  capture the main point?\" — which LLMs do well. Cost is low (model
  answers are short, prompts ≤ ~800 tokens, response ~150 tokens →
  pennies per grading). Sprint 10.x established the Haiku tier as
  the default for cheap-grading paths; we reuse the same client.

Fail-soft contract:
  If Haiku 3x retry fails OR returns un-parseable JSON, fall back to
  pure keyword-coverage scoring. Score = (matched_keywords /
  rubric_keywords). Feedback message degrades gracefully — \"AI
  scoring temporarily unavailable; keyword-based score shown.\" The
  user MUST get a score back regardless of API health.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import anthropic

from config import settings
from services.d1_question_generator import _call_with_retry

logger = logging.getLogger(__name__)


# Reuse the canonical Haiku tier from claude_grader.py.
_MODEL = "claude-haiku-4-5-20251001"
_MAX_TOKENS = 400
_TEMPERATURE = 0.3


_SYSTEM_PROMPT = """\
You are an IELTS Listening examiner grading a "main idea" / gist response.

The student has heard an audio clip and written what they think the speaker
is mainly discussing. Grade their response against:
  1. The model answer (ground truth)
  2. The rubric keywords (concepts that should appear)

Scoring:
  - 90-100: response captures the main idea + most rubric keywords
  - 70-89:  response captures the main idea, partial keyword coverage
  - 50-69:  partial main idea, weak keyword coverage
  - 30-49:  off-topic or near-miss
  - 0-29:   wrong topic or no content

Output JSON ONLY (no prose around it):
{
  "score": 0-100,
  "feedback": "1-2 sentence Vietnamese feedback for the student",
  "keyword_matches": ["matched_keyword_1", "matched_keyword_2"]
}
"""


def _build_user_message(
    *,
    user_response: str,
    model_answer: str,
    rubric_keywords: list[str],
) -> str:
    return (
        f"MODEL ANSWER:\n{model_answer}\n\n"
        f"RUBRIC KEYWORDS: {', '.join(rubric_keywords) if rubric_keywords else '(none)'}\n\n"
        f"STUDENT RESPONSE:\n{user_response}\n\n"
        "Grade and return JSON only."
    )


# ── Lazy sync client (BackgroundTask-safe — no asyncio loop needed) ──


_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        if not settings.ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY not configured")
        _client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


def _extract_json(text: str) -> dict:
    """Tolerant JSON extraction — Haiku sometimes wraps the JSON in a
    code fence or adds a leading sentence. Strip both before parsing."""
    fenced = re.search(r"\{[\s\S]*\}", text)
    if not fenced:
        raise ValueError("no JSON object found in model output")
    return json.loads(fenced.group(0))


# ── Keyword fallback ─────────────────────────────────────────────────


def _keyword_fallback_score(
    *,
    user_response: str,
    model_answer: str,
    rubric_keywords: list[str],
) -> dict[str, Any]:
    """Sprint 11.4 fail-soft — when Haiku is unreachable, score on
    keyword coverage alone. Conservative (no semantic credit), but
    guarantees the user gets a score back."""
    lowered = user_response.casefold()
    matches: list[str] = []
    for kw in rubric_keywords or []:
        if kw and kw.casefold() in lowered:
            matches.append(kw)
    rubric_n = max(1, len(rubric_keywords or []))
    pct = round(60 * (len(matches) / rubric_n))  # cap at 60 — semantic check skipped
    return {
        "score":           pct,
        "feedback":        (
            "AI chấm tự động tạm thời chưa khả dụng — điểm hiện tại dựa trên "
            f"khớp từ khóa ({len(matches)}/{rubric_n})."
        ),
        "keyword_matches": matches,
        "ai_used":         False,
    }


# ── Public grader ─────────────────────────────────────────────────────


def grade_gist_response(
    *,
    user_response: str,
    model_answer: str,
    rubric_keywords: list[str] | None = None,
) -> dict[str, Any]:
    """Grade one gist response. Returns dict ready for INSERT into
    listening_attempts.user_answer + verbatim return to the client.

    Shape:
        {
          "score":           0-100 int,
          "feedback":        VN string for student display,
          "keyword_matches": [matched keyword strings],
          "ai_used":         bool — true if Haiku produced the score
        }
    """
    rubric_keywords = rubric_keywords or []
    if not user_response.strip():
        return {
            "score":           0,
            "feedback":        "Bạn chưa viết câu trả lời nào.",
            "keyword_matches": [],
            "ai_used":         False,
        }
    if not settings.ANTHROPIC_API_KEY:
        # Test environments + dev without key → fallback path.
        return _keyword_fallback_score(
            user_response=user_response,
            model_answer=model_answer,
            rubric_keywords=rubric_keywords,
        )

    def _do_call() -> dict[str, Any]:
        client = _get_client()
        user_msg = _build_user_message(
            user_response=user_response,
            model_answer=model_answer,
            rubric_keywords=rubric_keywords,
        )
        resp = client.messages.create(
            model=_MODEL,
            max_tokens=_MAX_TOKENS,
            temperature=_TEMPERATURE,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
        )
        # Anthropic SDK returns a Message with .content[0].text
        text = resp.content[0].text if resp.content else ""
        parsed = _extract_json(text)
        # Coerce types defensively.
        score = int(parsed.get("score", 0))
        score = max(0, min(100, score))
        return {
            "score":           score,
            "feedback":        str(parsed.get("feedback") or "").strip()
                               or "Đã chấm xong.",
            "keyword_matches": list(parsed.get("keyword_matches") or []),
            "ai_used":         True,
        }

    try:
        return _call_with_retry(_do_call, provider="anthropic", vocab_id="gist")
    except Exception as e:
        logger.warning(
            "[listening_gist_grader] Haiku grading failed after retries; "
            "falling back to keyword score: %s", e,
        )
        return _keyword_fallback_score(
            user_response=user_response,
            model_answer=model_answer,
            rubric_keywords=rubric_keywords,
        )
