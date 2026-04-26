"""
services/d1_content_gen.py — Gemini-powered D1 fill-blank exercise generator.

Generates draft fill-blank exercises for a list of vocabulary words.  Output is
strict JSON validated against the D1 schema before being returned.  Caller
inserts rows into vocabulary_exercises with status='draft' — admin must review
each row in the admin tool before it can be served to users.

Never auto-publish.  See PHASE_D_V3_PLAN.md §5 and §8.
"""

import json
import logging
import re
from typing import Any

import google.generativeai as genai

from config import settings

logger = logging.getLogger(__name__)


# Uses the same google.generativeai package already configured in services/gemini.py.
# We don't reconfigure the API key here — it's a module-level configure() call there.
_DEFAULT_MODEL = settings.D1_GENERATION_MODEL or "gemini-1.5-flash"


_SYSTEM_PROMPT = """You are an IELTS Speaking content writer creating fill-in-the-blank vocabulary exercises.

For each target word, write ONE sentence that:
- Is 15–25 words, natural conversational English appropriate for IELTS Speaking.
- Uses the target word exactly once.
- Has clear context so an intermediate learner can guess the word from meaning.
- Does NOT mention the word being a vocabulary item, IELTS, or grammar.

Then provide 3 distractors — words from a similar register (same part of speech)
but with clearly different meaning so the answer is unambiguous.

Output strict JSON, no prose, exactly this shape:
{
  "exercises": [
    {
      "word": "<target word, lowercased>",
      "sentence": "<the sentence with the word REPLACED by ___>",
      "answer": "<target word, lowercased — must equal `word`>",
      "distractors": ["<word1>", "<word2>", "<word3>"]
    }
  ]
}

Rules:
- The sentence MUST contain `___` (three underscores) where the target word goes.
- `answer` MUST equal `word` (lowercased).
- Distractors MUST NOT include the answer.
- If you cannot write a clean exercise for a word, OMIT it from the output.
- Return ONLY the JSON object."""


def _strip_markdown_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        # ```json\n...\n```  or  ```\n...\n```
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    return raw.strip()


def _validate_d1_payload(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Return the payload if it matches the D1 schema, else None."""
    word = (payload.get("word") or "").strip().lower()
    answer = (payload.get("answer") or "").strip().lower()
    sentence = (payload.get("sentence") or "").strip()
    distractors = payload.get("distractors") or []

    if not word or not answer or not sentence:
        return None
    if word != answer:
        return None
    if "___" not in sentence:
        return None
    if not isinstance(distractors, list) or len(distractors) != 3:
        return None
    distractors_clean = [str(d).strip().lower() for d in distractors if str(d).strip()]
    if len(distractors_clean) != 3:
        return None
    if answer in distractors_clean:
        return None
    # Reject duplicate distractors
    if len(set(distractors_clean)) != 3:
        return None

    word_count = len(sentence.split())
    if word_count < 12 or word_count > 30:
        return None

    return {
        "word": word,
        "answer": answer,
        "sentence": sentence,
        "distractors": distractors_clean,
    }


def generate_d1_exercises(
    vocab_words: list[str],
    count: int | None = None,
    model_name: str | None = None,
) -> list[dict[str, Any]]:
    """
    Call Gemini to generate D1 fill-blank exercises for the given words.
    Returns a list of validated dicts ready for insert as draft rows.

    `count`, when given, caps the number of returned items.  We never raise on
    Gemini errors — this is a background-job-friendly function; failures simply
    return an empty list and are logged.
    """
    words = [w.strip() for w in vocab_words if w and w.strip()]
    if not words:
        return []

    target_count = count if count is not None else len(words)
    target_count = max(1, min(target_count, len(words), 100))

    user_prompt = (
        f"Generate exercises for these {len(words)} target words "
        f"(produce up to {target_count} items):\n\n"
        + "\n".join(f"- {w}" for w in words[:target_count])
    )

    try:
        model = genai.GenerativeModel(
            model_name=(model_name or _DEFAULT_MODEL),
            generation_config=genai.types.GenerationConfig(
                response_mime_type="application/json",
                temperature=0.6,
                max_output_tokens=4096,
            ),
            system_instruction=_SYSTEM_PROMPT,
        )
        resp = model.generate_content(user_prompt)
        raw = resp.text or ""
    except Exception as e:
        logger.error("[d1_content_gen] Gemini call failed: %s", e)
        return []

    try:
        data = json.loads(_strip_markdown_fences(raw))
    except Exception as e:
        logger.error("[d1_content_gen] Gemini returned invalid JSON: %s — head=%r", e, raw[:200])
        return []

    items_raw = data.get("exercises") if isinstance(data, dict) else None
    if not isinstance(items_raw, list):
        logger.error("[d1_content_gen] Missing 'exercises' array in Gemini output")
        return []

    validated: list[dict[str, Any]] = []
    for item in items_raw:
        if not isinstance(item, dict):
            continue
        clean = _validate_d1_payload(item)
        if clean:
            validated.append(clean)

    logger.info(
        "[d1_content_gen] generated=%d validated=%d (requested=%d, words=%d)",
        len(items_raw), len(validated), target_count, len(words),
    )
    return validated[:target_count]
