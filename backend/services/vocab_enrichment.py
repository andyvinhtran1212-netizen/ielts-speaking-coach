"""
services/vocab_enrichment.py — Gemini-powered IPA + example-sentence
generator for user_vocabulary entries.

Output shape (one entry per word):
    {"headword": "mitigate",
     "ipa": "/ˈmɪtɪɡeɪt/",
     "example_sentence": "Governments must implement policies to mitigate ..."}

Why a separate service:
- The Phase B vocab extractor (services/vocab_extractor.py) already calls
  Claude for category/definition.  We could ask Claude for IPA + example in
  the same call, but Gemini Flash is ~10× cheaper for this kind of
  deterministic enrichment, and migration 029 explicitly carves IPA +
  example as standalone fields.  Keeping the call separate lets us batch
  across users in the admin backfill job too.

Chunking mirrors d1_content_gen.py: Gemini truncates JSON around 20+
items per call, so we ship CHUNK_SIZE=10 and let partial-success bubble
up.  No on_chunk_validated callback here — vocab inserts batch by user
session, so the caller already controls persistence boundaries.
"""

import json
import logging
import re
from typing import Any

import google.generativeai as genai

from config import settings

logger = logging.getLogger(__name__)

CHUNK_SIZE = 10  # Gemini truncates JSON output around ~20 items reliably.

# Reuse the same Gemini model knob as D1 generation; vocab enrichment is the
# same family of "generate short structured English" task, and we don't want
# two different model rotation cadences.
_DEFAULT_MODEL = settings.D1_GENERATION_MODEL or "gemini-2.5-flash"


class VocabEnrichmentError(Exception):
    """
    Raised only when EVERY chunk fails (network, auth, quota, all-JSON-broken).
    Partial success — some chunks return items, others fail — returns the
    successful items and logs the failures.  The caller decides what to do
    when this is raised (admin backfill endpoint surfaces it as a 502; the
    inline Phase B path swallows it so vocab still saves with NULL IPA).
    """


_SYSTEM_PROMPT = """You are an IELTS vocabulary writer producing reference material for flashcards.

For each English headword (single word or 2-3 word collocation), output:
- "ipa": British English IPA enclosed in slashes, e.g. "/ˈmɪtɪɡeɪt/".  Use the
  standard /ɪ ə ɔː ʊ æ ʌ ɜː ɑː iː uː eɪ aɪ ɔɪ aʊ əʊ ɪə eə ʊə/ symbol set.
  No stress numbers; use the ˈ primary-stress mark.  No region tags.
- "example": ONE natural English sentence that uses the headword exactly once,
  15-20 words, IELTS Band 7+ vocabulary and grammar, blank-free.  Must NOT
  contain "___", "[blank]", or any placeholder.  Topic should be neutral and
  appropriate for IELTS Speaking (work, study, environment, technology,
  health, travel — NOT politics or controversial issues).

Output strict JSON, no prose, exactly this shape:
{
  "items": [
    {"headword": "<verbatim input>", "ipa": "<ipa>", "example": "<sentence>"}
  ]
}

Rules:
- Preserve the headword exactly as given (don't lowercase, don't trim) so the
  caller can match against its own list.
- If you cannot produce a valid IPA OR example for a word, OMIT it from the
  output rather than guessing.
- Return ONLY the JSON object."""


_IPA_RE = re.compile(r"^/.+/$")  # Must be wrapped in slashes.


def _strip_markdown_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    return raw.strip()


def _validate_item(payload: Any, valid_headwords: set[str]) -> dict[str, str] | None:
    """
    Return a normalized {headword, ipa, example_sentence} dict if `payload`
    matches the schema AND the headword was in the original input set.
    Anything else returns None — the caller drops it silently.
    """
    if not isinstance(payload, dict):
        return None
    headword = (payload.get("headword") or "").strip()
    ipa = (payload.get("ipa") or "").strip()
    example = (payload.get("example") or "").strip()

    if not headword or not ipa or not example:
        return None
    if headword.lower() not in valid_headwords:
        # Gemini occasionally hallucinates extra words; reject anything
        # the caller didn't ask for so we never UPDATE a row by accident.
        return None
    if not _IPA_RE.match(ipa):
        return None
    # Example must use the headword (case-insensitive), be sentence-shaped,
    # and free of fill-blank tokens.
    if "___" in example or "[blank]" in example.lower():
        return None
    word_count = len(example.split())
    if word_count < 8 or word_count > 30:
        return None
    if headword.lower() not in example.lower():
        return None

    return {
        "headword": headword,
        "ipa": ipa,
        "example_sentence": example,
    }


def _enrich_single_chunk(
    words: list[str],
    model_name: str | None = None,
) -> list[dict[str, str]]:
    """
    One Gemini call.  Returns validated items — may be shorter than `words`
    when some entries fail the schema check.

    Raises VocabEnrichmentError on Gemini failure (network, JSON broken,
    missing 'items' key); caller decides whether to continue with the
    remaining chunks.
    """
    if not words:
        return []

    valid_lower = {w.strip().lower() for w in words if w and w.strip()}
    user_prompt = (
        f"Enrich these {len(words)} headwords:\n\n"
        + "\n".join(f"- {w}" for w in words)
    )

    chosen_model = model_name or _DEFAULT_MODEL
    try:
        model = genai.GenerativeModel(
            model_name=chosen_model,
            generation_config=genai.types.GenerationConfig(
                response_mime_type="application/json",
                temperature=0.4,
                max_output_tokens=4096,
            ),
            system_instruction=_SYSTEM_PROMPT,
        )
        resp = model.generate_content(user_prompt)
        raw = resp.text or ""
    except Exception as e:
        logger.error("[vocab_enrich] Gemini call failed (model=%s): %s", chosen_model, e)
        raise VocabEnrichmentError(f"Gemini call failed (model={chosen_model}): {e}") from e

    try:
        data = json.loads(_strip_markdown_fences(raw))
    except Exception as e:
        logger.error("[vocab_enrich] invalid JSON: %s — head=%r", e, raw[:200])
        raise VocabEnrichmentError(f"Gemini returned invalid JSON: {e}") from e

    items_raw = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items_raw, list):
        logger.error("[vocab_enrich] missing 'items' array in Gemini output")
        raise VocabEnrichmentError("Gemini response missing 'items' array")

    validated: list[dict[str, str]] = []
    for item in items_raw:
        clean = _validate_item(item, valid_lower)
        if clean:
            validated.append(clean)

    logger.info(
        "[vocab_enrich] chunk: input=%d returned=%d validated=%d",
        len(words), len(items_raw), len(validated),
    )
    return validated


def enrich_vocabulary_batch(
    words: list[str],
    model_name: str | None = None,
) -> list[dict[str, str]]:
    """
    Enrich a list of headwords with IPA + example sentences via Gemini.

    Splits into CHUNK_SIZE chunks and aggregates validated items.  Partial
    success is OK — failed chunks are logged at WARN and skipped.

    Returns:
        list of {"headword", "ipa", "example_sentence"}.  May be shorter
        than the input list when items failed validation OR when some
        chunks failed entirely.

    Raises:
        VocabEnrichmentError when EVERY chunk fails.  Partial success
        does NOT raise — the caller is expected to look at how many
        items came back vs how many it asked for.
    """
    cleaned = [w.strip() for w in (words or []) if w and w.strip()]
    if not cleaned:
        return []

    # Dedup case-insensitively before chunking; we hit Gemini once per word.
    seen: set[str] = set()
    deduped: list[str] = []
    for w in cleaned:
        low = w.lower()
        if low not in seen:
            seen.add(low)
            deduped.append(w)

    chunks = [deduped[i:i + CHUNK_SIZE] for i in range(0, len(deduped), CHUNK_SIZE)]
    total_chunks = len(chunks)

    all_results: list[dict[str, str]] = []
    failed_chunks = 0
    last_error: str | None = None

    for idx, chunk in enumerate(chunks, start=1):
        try:
            items = _enrich_single_chunk(chunk, model_name)
        except VocabEnrichmentError as e:
            failed_chunks += 1
            last_error = str(e)
            logger.warning(
                "[vocab_enrich] chunk %d/%d failed (continuing): %s",
                idx, total_chunks, e,
            )
            continue
        all_results.extend(items)

    if failed_chunks == total_chunks:
        raise VocabEnrichmentError(
            f"All {total_chunks} chunk(s) failed. Last error: {last_error}"
        )

    return all_results
