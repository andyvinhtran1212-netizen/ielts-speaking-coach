"""
services/gemini.py — IELTS question generation via Gemini 2.0 Flash (gemini-2.0-flash)

Cache table required in Supabase (run once):

    CREATE TABLE IF NOT EXISTS question_cache (
        id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        part       smallint    NOT NULL,
        topic      text        NOT NULL,
        questions  jsonb       NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_qcache_part_topic_ts
        ON question_cache (part, lower(topic), created_at DESC);

Test:
    python3 -c "
    import asyncio
    from services.gemini import generate_part1_questions
    print(asyncio.run(generate_part1_questions('Technology')))
    "
"""

import json
import logging
import re
from datetime import datetime, timedelta, timezone

import google.generativeai as genai

from config import settings
from database import supabase_admin
from services import ai_usage_logger

logger = logging.getLogger(__name__)

# ── Gemini client ──────────────────────────────────────────────────────────────

genai.configure(api_key=settings.GEMINI_API_KEY)

_MODEL_NAME = "gemini-2.5-flash"

_model = genai.GenerativeModel(
    model_name=_MODEL_NAME,
    generation_config=genai.types.GenerationConfig(
        response_mime_type="application/json",
        temperature=0.7,        # lowered from 0.9 — reduces verbosity, less token pressure
        max_output_tokens=8192, # raised from 1024 — prevents truncation when thinking is active
    ),
)

# ── Cache ──────────────────────────────────────────────────────────────────────

_CACHE_TTL_HOURS = 24


def _cache_get(part: int, topic: str):
    """Return cached questions (list or dict) if fresh, else None."""
    try:
        cutoff = (
            datetime.now(timezone.utc) - timedelta(hours=_CACHE_TTL_HOURS)
        ).isoformat()

        result = (
            supabase_admin.table("question_cache")
            .select("questions")
            .eq("part", part)
            .ilike("topic", topic.strip())
            .gte("created_at", cutoff)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

        if result.data:
            logger.debug("Cache hit: part=%d topic=%r", part, topic)
            return result.data[0]["questions"]

    except Exception as exc:
        logger.debug("Cache read skipped (table may not exist): %s", exc)

    return None


def _cache_set(part: int, topic: str, questions) -> None:
    """Write questions to cache, silently ignore failures."""
    try:
        supabase_admin.table("question_cache").insert({
            "part": part,
            "topic": topic.strip().lower(),
            "questions": questions,
        }).execute()
    except Exception as exc:
        logger.debug("Cache write skipped (table may not exist): %s", exc)


# ── Internal Gemini call ───────────────────────────────────────────────────────

_FENCE_RE = re.compile(r"^```[a-z]*\n?|\n?```$", re.MULTILINE)


async def _call_gemini(prompt: str, *, _retry: bool = True,
                       user_id: str | None = None, session_id: str | None = None):
    """Send prompt, return parsed JSON (list or dict). Raises ValueError on failure.

    Defensive measures applied in order:
      1. Strip optional markdown code fences (``` json ... ```)
      2. Retry once on JSONDecodeError before giving up
    """
    logger.debug("[gemini] calling model=%s retry_allowed=%s", _MODEL_NAME, _retry)

    response = await _model.generate_content_async(prompt)

    # Log token usage and persist to ai_usage_logs
    try:
        usage = response.usage_metadata
        in_tok  = getattr(usage, "prompt_token_count",     0) or 0
        out_tok = getattr(usage, "candidates_token_count", 0) or 0
        logger.debug(
            "[gemini] tokens — prompt=%s candidates=%s total=%s",
            in_tok, out_tok,
            getattr(usage, "total_token_count", "?"),
        )
        ai_usage_logger.log_gemini(
            user_id=user_id,
            session_id=session_id,
            model=_MODEL_NAME,
            input_tokens=in_tok,
            output_tokens=out_tok,
        )
    except Exception:
        pass  # usage_metadata not always present; never block on logging

    text = response.text.strip()

    # Strip markdown code fences the model occasionally wraps output in
    if text.startswith("```"):
        text = _FENCE_RE.sub("", text).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        preview = text[:200].replace("\n", " ")
        if _retry:
            logger.warning(
                "[gemini] JSON parse failed (will retry once) — preview: %r | error: %s",
                preview, exc,
            )
            return await _call_gemini(prompt, _retry=False, user_id=user_id, session_id=session_id)

        logger.error(
            "[gemini] JSON parse failed after retry — preview: %r | error: %s",
            preview, exc,
        )
        raise ValueError(f"Gemini response was not valid JSON: {exc}") from exc


# ── Public API ─────────────────────────────────────────────────────────────────

_PART1_FALLBACK_QUESTIONS = [
    {"question_text": "Do you enjoy spending time outdoors?",                "question_type": "personal"},
    {"question_text": "How often do you use public transportation?",         "question_type": "time"},
    {"question_text": "What kind of music do you like listening to?",        "question_type": "personal"},
    {"question_text": "Do you think technology has improved daily life?",    "question_type": "opinion"},
    {"question_text": "Where did you grow up, and do you still live there?", "question_type": "place"},
]


async def generate_part1_questions(topic: str, count: int = 3,
                                   user_id: str | None = None) -> list[dict]:
    """
    Tạo câu hỏi Part 1 IELTS Speaking về topic cho sẵn.

    Guarantees exactly `count` results — retries Gemini once if the first call
    yields fewer than needed, then pads with safe fallbacks.

    Returns list of:
        {
            "question_text":  str,
            "question_type":  "personal" | "opinion" | "comparison" | "time" | "place"
        }
    """
    cached = _cache_get(part=1, topic=topic)
    if cached is not None and len(cached) >= count:
        return cached[:count]

    def _validate(questions) -> list[dict]:
        return [
            q for q in (questions or [])
            if isinstance(q, dict)
            and isinstance(q.get("question_text"), str)
            and q["question_text"].strip()
            and isinstance(q.get("question_type"), str)
        ]

    def _build_prompt(n: int) -> str:
        return f"""You are an experienced IELTS Speaking examiner.

Create exactly {n} Part 1 questions about the topic: "{topic}".

Rules:
- Each question must be one sentence, natural and conversational.
- Suitable for IELTS Part 1: personal, everyday topics.
- Assign exactly one question_type from this list: personal, opinion, comparison, time, place.
  personal   = asks about the candidate's own habits/preferences/experiences
  opinion    = asks what the candidate thinks or feels
  comparison = asks to compare past vs present, or two things
  time       = asks about frequency, how long, when
  place      = asks about where

Return ONLY a valid JSON array — no markdown, no explanation, nothing else:
[
  {{"question_text": "...", "question_type": "personal"}},
  ...
]"""

    # First attempt
    valid = _validate(await _call_gemini(_build_prompt(count), user_id=user_id))

    # Retry if we got fewer than needed
    if len(valid) < count:
        deficit = count - len(valid)
        logger.warning(
            "[gemini] Part 1 topic=%r: got %d/%d valid questions — retrying for %d more",
            topic, len(valid), count, deficit,
        )
        try:
            extra = _validate(await _call_gemini(_build_prompt(deficit), user_id=user_id))
            valid = valid + extra
        except Exception as exc:
            logger.warning("[gemini] Part 1 retry failed for topic=%r: %s", topic, exc)

    # Pad with safe defaults if still short
    if len(valid) < count:
        pad_needed = count - len(valid)
        logger.warning(
            "[gemini] Part 1 topic=%r: still %d short after retry — padding with defaults",
            topic, pad_needed,
        )
        valid = valid + _PART1_FALLBACK_QUESTIONS[:pad_needed]

    result = valid[:count]
    _cache_set(part=1, topic=topic, questions=result)
    return result


async def generate_part2_cuecard(topic: str, user_id: str | None = None) -> dict:
    """
    Tạo cue card Part 2 IELTS Speaking.

    Returns:
        {
            "question_text":       str,   e.g. "Describe a memorable trip..."
            "cue_card_bullets":    [str, str, str],
            "cue_card_reflection": str    e.g. "and explain why this trip was memorable."
        }

    Example (topic="A memorable trip"):
        question_text:       "Describe a memorable trip you have taken."
        cue_card_bullets:    ["Where you went", "Who you went with", "What you did there"]
        cue_card_reflection: "and explain why this trip was so memorable to you."
    """
    cached = _cache_get(part=2, topic=topic)
    if cached is not None:
        return cached

    prompt = f"""You are an experienced IELTS Speaking examiner.

Create a Part 2 cue card for the topic: "{topic}".

Return ONLY a valid JSON object — no markdown, no explanation:
{{
  "question_text":       "Describe ...",
  "cue_card_bullets":    ["...", "...", "..."],
  "cue_card_reflection": "and explain ..."
}}

Rules:
- question_text: one sentence starting with "Describe"
- cue_card_bullets: exactly 3 strings; each starts with Who / What / Where / When / How
- cue_card_reflection: one clause starting with "and explain why/how/what"
"""

    cuecard: dict = await _call_gemini(prompt, user_id=user_id)

    # Ensure bullets is a list of exactly 3
    bullets = cuecard.get("cue_card_bullets", [])
    if not isinstance(bullets, list):
        bullets = []
    cuecard["cue_card_bullets"] = (bullets + ["", "", ""])[:3]

    _cache_set(part=2, topic=topic, questions=cuecard)
    return cuecard


async def generate_part3_questions(topic: str, count: int = 3,
                                   user_id: str | None = None) -> list[dict]:
    """
    Tạo câu hỏi Part 3 IELTS Speaking — abstract, analytical, discussion-based.

    Returns list of:
        {
            "question_text":  str,
            "question_type":  "opinion" | "comparison" | "prediction" | "cause_effect" | "solution"
        }
    """
    cached = _cache_get(part=3, topic=topic)
    if cached is not None:
        return cached[:count]

    prompt = f"""You are an experienced IELTS Speaking examiner.

Create exactly {count} Part 3 questions related to the topic: "{topic}".

Part 3 questions must be abstract and analytical — they discuss broader societal issues,
not personal experiences. They require the candidate to speculate, compare, or argue.

STRICT RULES FOR EACH QUESTION:
- Each question must be ONE single question — never combine two questions into one sentence.
- Maximum 15 words per question. Short, direct, clear.
- Do NOT use "and" to join two separate questions (e.g. "Why X and how does Y?" is WRONG).
- End with exactly one question mark.

Assign exactly one question_type from: opinion, comparison, prediction, cause_effect, solution.
  opinion      = "Do you think society should...?"
  comparison   = "How has X changed compared to...?"
  prediction   = "What do you think will happen to X in the future?"
  cause_effect = "Why do you think X leads to Y?"
  solution     = "What could governments/people do to address X?"

Return ONLY a valid JSON array — no markdown, no explanation:
[
  {{"question_text": "...", "question_type": "opinion"}},
  ...
]"""

    questions: list[dict] = await _call_gemini(prompt, user_id=user_id)

    valid = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        text = q.get("question_text", "")
        qtype = q.get("question_type", "")
        if not isinstance(text, str) or not isinstance(qtype, str):
            continue
        # Reject questions that are too long (likely compound/merged)
        word_count = len(text.split())
        if word_count > 20:
            logger.warning("[warn] Part 3 question too long (%d words), skipping: %r", word_count, text)
            continue
        valid.append(q)

    _cache_set(part=3, topic=topic, questions=valid)
    return valid[:count]
