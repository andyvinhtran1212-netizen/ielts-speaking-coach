"""
services/gemini.py — IELTS question generation via Gemini 2.0 Flash

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
from datetime import datetime, timedelta, timezone

import google.generativeai as genai

from config import settings
from database import supabase_admin

logger = logging.getLogger(__name__)

# ── Gemini client ──────────────────────────────────────────────────────────────

genai.configure(api_key=settings.GEMINI_API_KEY)

_model = genai.GenerativeModel(
    model_name="gemini-2.0-flash-exp",
    generation_config=genai.types.GenerationConfig(
        response_mime_type="application/json",
        temperature=0.9,        # enough variation across requests
        max_output_tokens=1024,
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
        logger.warning("Cache read error (will regenerate): %s", exc)

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
        logger.warning("Cache write error (non-fatal): %s", exc)


# ── Internal Gemini call ───────────────────────────────────────────────────────

async def _call_gemini(prompt: str):
    """Send prompt, return parsed JSON (list or dict). Raises on failure."""
    response = await _model.generate_content_async(prompt)

    try:
        return json.loads(response.text)
    except json.JSONDecodeError as exc:
        logger.error("Gemini returned non-JSON:\n%s", response.text)
        raise ValueError(f"Gemini response was not valid JSON: {exc}") from exc


# ── Public API ─────────────────────────────────────────────────────────────────

async def generate_part1_questions(topic: str, count: int = 5) -> list[dict]:
    """
    Tạo câu hỏi Part 1 IELTS Speaking về topic cho sẵn.

    Returns list of:
        {
            "question_text":  str,
            "question_type":  "personal" | "opinion" | "comparison" | "time" | "place"
        }

    Example (topic="Technology"):
        - "Do you use social media every day?"        → personal
        - "Has technology changed how people communicate?" → opinion
    """
    cached = _cache_get(part=1, topic=topic)
    if cached is not None:
        return cached[:count]

    prompt = f"""You are an experienced IELTS Speaking examiner.

Create exactly {count} Part 1 questions about the topic: "{topic}".

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

    questions: list[dict] = await _call_gemini(prompt)

    # Validate shape — keep only well-formed items
    valid = [
        q for q in questions
        if isinstance(q, dict)
        and isinstance(q.get("question_text"), str)
        and isinstance(q.get("question_type"), str)
    ]

    _cache_set(part=1, topic=topic, questions=valid)
    return valid[:count]


async def generate_part2_cuecard(topic: str) -> dict:
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

    cuecard: dict = await _call_gemini(prompt)

    # Ensure bullets is a list of exactly 3
    bullets = cuecard.get("cue_card_bullets", [])
    if not isinstance(bullets, list):
        bullets = []
    cuecard["cue_card_bullets"] = (bullets + ["", "", ""])[:3]

    _cache_set(part=2, topic=topic, questions=cuecard)
    return cuecard


async def generate_part3_questions(topic: str, count: int = 3) -> list[dict]:
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

    questions: list[dict] = await _call_gemini(prompt)

    valid = [
        q for q in questions
        if isinstance(q, dict)
        and isinstance(q.get("question_text"), str)
        and isinstance(q.get("question_type"), str)
    ]

    _cache_set(part=3, topic=topic, questions=valid)
    return valid[:count]
