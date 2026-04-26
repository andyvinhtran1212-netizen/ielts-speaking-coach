"""
services/d1_content_gen.py — Gemini-powered D1 fill-blank exercise generator.

Generates draft fill-blank exercises for a list of vocabulary words.  Output is
strict JSON validated against the D1 schema before being returned.  Caller
inserts rows into vocabulary_exercises with status='draft' — admin must review
each row in the admin tool before it can be served to users.

Chunking: Gemini consistently truncates JSON when asked for ~20+ items in a
single call, and Railway's gateway times out long single requests anyway.  We
split the input into chunks of CHUNK_SIZE words and call Gemini per chunk.
The on_chunk_validated callback lets the caller persist results incrementally
instead of risking 50 items lost when the last chunk fails.

Never auto-publish.  See PHASE_D_V3_PLAN.md §5 and §8.
"""

import json
import logging
import re
from typing import Any, Callable

import google.generativeai as genai

from config import settings

logger = logging.getLogger(__name__)

CHUNK_SIZE = 10  # Gemini reliably handles 10 fill-blank items without truncation.


# Uses the same google.generativeai package already configured in services/gemini.py.
# We don't reconfigure the API key here — it's a module-level configure() call there.
#
# Model name lives in settings (settings.D1_GENERATION_MODEL) so it can be
# rotated without a code change when Google deprecates a version.  The
# question-gen path in services/gemini.py uses the same family name.
_DEFAULT_MODEL = settings.D1_GENERATION_MODEL or "gemini-2.5-flash"


class GeminiBatchError(Exception):
    """
    Raised when the Gemini call itself fails (network, 404 model, auth, quota).
    Distinct from "Gemini OK but produced no validated items" — that case is a
    successful empty list and indicates a content-quality issue, not a service
    outage.  The admin endpoint catches this so the operator sees a clear
    failure instead of a silent empty-drafts result.
    """


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


def _generate_single_chunk(
    words: list[str],
    model_name: str | None = None,
) -> list[dict[str, Any]]:
    """
    One Gemini call for a small group of target words.  Returns a list of
    validated payloads (may be shorter than `len(words)` if some items fail
    the schema check).

    Raises GeminiBatchError when the Gemini call itself fails — caller
    decides whether to surface to user or move on to the next chunk.
    """
    if not words:
        return []

    user_prompt = (
        f"Generate exercises for these {len(words)} target words "
        f"(produce up to {len(words)} items):\n\n"
        + "\n".join(f"- {w}" for w in words)
    )

    chosen_model = model_name or _DEFAULT_MODEL
    try:
        model = genai.GenerativeModel(
            model_name=chosen_model,
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
        logger.error("[d1_content_gen] Gemini call failed (model=%s): %s", chosen_model, e)
        raise GeminiBatchError(f"Gemini call failed (model={chosen_model}): {e}") from e

    try:
        data = json.loads(_strip_markdown_fences(raw))
    except Exception as e:
        logger.error("[d1_content_gen] Gemini returned invalid JSON: %s — head=%r", e, raw[:200])
        raise GeminiBatchError(f"Gemini returned invalid JSON: {e}") from e

    items_raw = data.get("exercises") if isinstance(data, dict) else None
    if not isinstance(items_raw, list):
        logger.error("[d1_content_gen] Missing 'exercises' array in Gemini output")
        raise GeminiBatchError("Gemini response missing 'exercises' array")

    validated: list[dict[str, Any]] = []
    for item in items_raw:
        if not isinstance(item, dict):
            continue
        clean = _validate_d1_payload(item)
        if clean:
            validated.append(clean)

    logger.info(
        "[d1_content_gen] chunk: generated=%d validated=%d (input_words=%d)",
        len(items_raw), len(validated), len(words),
    )
    return validated


def generate_d1_exercises(
    vocab_words: list[str],
    count: int | None = None,
    model_name: str | None = None,
    on_chunk_validated: Callable[[list[dict[str, Any]]], None] | None = None,
) -> list[dict[str, Any]]:
    """
    Generate D1 fill-blank exercises in chunks of CHUNK_SIZE.

    Splits the input list into chunks (default 10 words each) and calls
    _generate_single_chunk per chunk.  Aggregates the validated payloads
    across all chunks and returns the combined list, truncated to `count`.

    `on_chunk_validated`, if provided, is called with the validated items
    from each successful chunk as they arrive.  The router uses this hook
    to insert drafts incrementally — so a chunk-3 failure on a 6-chunk
    batch still leaves chunks 1+2 persisted in the DB.

    Raises GeminiBatchError ONLY when EVERY chunk fails.  Partial success
    (some chunks ok, some fail) returns the items we got and logs the
    failed chunks at WARN.

    A successful Gemini call that simply produced 0 schema-valid items is
    NOT a failure — it returns an empty list for that chunk.
    """
    words = [w.strip() for w in vocab_words if w and w.strip()]
    if not words:
        return []

    target_count = count if count is not None else len(words)
    target_count = max(1, min(target_count, len(words), 100))
    words = words[:target_count]

    chunks = [words[i:i + CHUNK_SIZE] for i in range(0, len(words), CHUNK_SIZE)]
    total_chunks = len(chunks)

    all_results: list[dict[str, Any]] = []
    failed_chunks = 0
    last_error: str | None = None

    for idx, chunk in enumerate(chunks, start=1):
        try:
            chunk_items = _generate_single_chunk(chunk, model_name)
        except GeminiBatchError as e:
            failed_chunks += 1
            last_error = str(e)
            logger.warning(
                "[d1_content_gen] chunk %d/%d failed (continuing): %s",
                idx, total_chunks, e,
            )
            continue

        logger.info(
            "[d1_content_gen] chunk %d/%d: validated=%d",
            idx, total_chunks, len(chunk_items),
        )
        if chunk_items:
            all_results.extend(chunk_items)
            if on_chunk_validated is not None:
                # Caller-side persistence happens here so chunks land in the DB
                # incrementally instead of being lost when a later chunk fails.
                try:
                    on_chunk_validated(chunk_items)
                except Exception as cb_err:
                    # A persistence failure is the caller's problem, but we
                    # don't want it to abort remaining chunks — log and move on.
                    logger.error(
                        "[d1_content_gen] chunk %d/%d on_chunk_validated raised: %s",
                        idx, total_chunks, cb_err,
                    )

        # Early exit once we've already collected enough validated items.
        if len(all_results) >= target_count:
            break

    if failed_chunks == total_chunks:
        # Every chunk failed — surface to admin instead of silently returning [].
        raise GeminiBatchError(
            f"All {total_chunks} chunk(s) failed. Last error: {last_error}"
        )

    return all_results[:target_count]
