"""
services/vocab_extractor.py — Phase B vocab extraction via Claude Haiku

Calls Claude to identify 3 vocab categories from a transcript:
  used_well, needs_review, upgrade_suggested (max 3 items each)

Designed to run inside FastAPI BackgroundTasks — never raises to caller.
"""

import json
import logging
import os
from typing import Any

import anthropic
from pydantic import BaseModel, ConfigDict

from config import settings

logger = logging.getLogger(__name__)

_DEFAULT_MODEL = "claude-haiku-4-5-20251001"

_SYSTEM_PROMPT = """You are an IELTS Speaking vocabulary analyst. Your job is to identify vocabulary items from a learner's spoken transcript that are worth saving for study.

Return ONLY valid JSON with exactly these three keys: "used_well", "needs_review", "upgrade_suggested".

Each key maps to an array of at most 3 items. Each item has:
- "headword": the exact word or phrase as it appears (verbatim) in the transcript
- "context_sentence": the exact sentence from the transcript containing the headword (copy verbatim)
- "reason": why this word was selected, max 12 words
- "category": one of "topic", "idiom", "phrasal_verb", "collocation"

For "upgrade_suggested" items also include:
- "original_word": the simpler word the learner used that could be upgraded

Rules:
- used_well: vocabulary the learner used correctly and impressively (B2–C2 level)
- needs_review: vocabulary the learner misused, confused, or used awkwardly
- upgrade_suggested: common/simple words (A1–B1) the learner used where a better alternative exists
- headword and context_sentence MUST be verbatim text from the transcript — never invent
- Skip proper nouns, names, places
- If fewer than 3 good candidates exist for a category, return fewer items (can be empty array)
- Return ONLY the JSON object, no explanation"""


class VocabItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    headword: str
    context_sentence: str
    reason: str
    category: str
    original_word: str | None = None


class VocabExtractionResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    used_well: list[VocabItem] = []
    needs_review: list[VocabItem] = []
    upgrade_suggested: list[VocabItem] = []


async def extract_vocab(
    transcript: str,
    response_id: str,
    user_id: str,
    session_id: str,
) -> VocabExtractionResult | None:
    """
    Extract vocabulary from transcript using Claude Haiku.
    Returns None on any failure — caller must handle gracefully.
    """
    min_words = int(os.environ.get("VOCAB_MIN_TRANSCRIPT_WORDS", "15"))
    word_count = len(transcript.split())

    if word_count < min_words:
        logger.debug(
            "[vocab_extractor] skip — transcript too short (%d < %d words)",
            word_count, min_words,
        )
        return None

    model = os.environ.get("VOCAB_ANALYSIS_MODEL", _DEFAULT_MODEL)

    try:
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

        user_message = (
            f"Transcript to analyse:\n\n{transcript}\n\n"
            "Return the JSON object now."
        )

        msg = client.messages.create(
            model=model,
            max_tokens=1024,
            system=[
                {
                    "type": "text",
                    "text": _SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_message}],
        )

        raw = msg.content[0].text.strip()

        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        data = json.loads(raw)

        result = VocabExtractionResult(
            used_well=[VocabItem(**i) for i in (data.get("used_well") or [])[:3]],
            needs_review=[VocabItem(**i) for i in (data.get("needs_review") or [])[:3]],
            upgrade_suggested=[VocabItem(**i) for i in (data.get("upgrade_suggested") or [])[:3]],
        )

        # Log usage (best-effort)
        try:
            from services import ai_usage_logger
            ai_usage_logger.log_claude(
                user_id=user_id,
                session_id=session_id,
                model=model,
                input_tokens=msg.usage.input_tokens,
                output_tokens=msg.usage.output_tokens,
                cache_read_tokens=getattr(msg.usage, "cache_read_input_tokens", 0) or 0,
                cache_write_tokens=getattr(msg.usage, "cache_creation_input_tokens", 0) or 0,
            )
        except Exception as log_err:
            logger.debug("[vocab_extractor] usage log failed (non-fatal): %s", log_err)

        total = len(result.used_well) + len(result.needs_review) + len(result.upgrade_suggested)
        logger.info(
            "[vocab_extractor] extracted %d items for response=%s", total, response_id
        )
        return result

    except Exception as e:
        logger.error("[vocab_extractor] extraction failed (non-fatal): %s", e)
        return None
