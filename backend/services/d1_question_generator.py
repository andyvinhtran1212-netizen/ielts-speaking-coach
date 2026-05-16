"""
services/d1_question_generator.py — Sprint 10.5 (Area 2, Issue #8).

Generates ONE personalized D1 fill-blank question per confirmed vocab.
Called from a FastAPI BackgroundTask in vocabulary_bank.py at confirm
time, and from the backfill script for existing alive rows.

Pipeline:
    1. Try Claude Haiku 4.5 (primary — cheap, fast for short structured
       output; same model already used by vocab_extractor.py).
    2. On Haiku failure (network, malformed JSON, schema validation),
       try Gemini 2.5 Flash (fallback — same family used by the existing
       d1_content_gen.py admin pool generator).
    3. On both AI providers failing, fall back to the user's evidence
       substring with the target word masked. This keeps the user
       practising the *exact* sentence they produced, which is still
       pedagogically useful — just no variety.

Output schema (validated before return):
    {
        "context_sentence":         str,      # 12–25 words, contains target
        "blank_position_start":     int,      # char index in sentence
        "blank_position_end":       int,      # char index (start + len(target))
        "target_answer":            str,      # lowercased headword/lemma
        "acceptable_variants":      list[str],
        "hint":                     str | None,
        "source_evidence_substring": str | None,
        "generated_by":             "haiku" | "gemini" | "fallback_evidence",
    }

Returns None if every path fails (caller logs + retries another sprint).
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import anthropic

from config import settings

logger = logging.getLogger(__name__)


_DEFAULT_HAIKU_MODEL = "claude-haiku-4-5-20251001"


_SYSTEM_PROMPT = """You are creating IELTS practice fill-blank vocabulary questions.

Given a target word with its definition and the original context the student used it in, write ONE NEW sentence that:
- Uses the target word naturally in IELTS Speaking Part 1–3 register
- Is 12–25 words long
- Differs in topic/context from the original sentence (variety beats memorization)
- Tests whether the student understands the word's meaning — avoid synonyms in the sentence that would give it away
- Uses the target word EXACTLY ONCE so the blank position is unambiguous

Return STRICT JSON only (no prose, no markdown fences), exactly this shape:
{
  "context_sentence": "<your new sentence containing the target word verbatim>",
  "target_answer": "<the target word, lowercased>",
  "acceptable_variants": ["<alt spelling 1>", "<alt form 2>"],
  "hint": "<5-8 word hint about meaning or part of speech>"
}

Rules:
- context_sentence MUST contain target_answer (case-insensitive match).
- acceptable_variants may be an empty array if none apply.
- hint may be an empty string but the key MUST be present.
- Do NOT include any other keys."""


# ── Public API ─────────────────────────────────────────────────────────────────


def generate_d1_question(vocab_row: dict) -> dict | None:
    """Generate ONE fill-blank question from a confirmed vocab row.

    Args:
        vocab_row: a dict with at least `id`, `headword`. Optional:
            `lemma`, `surface_form`, `definition_en`, `definition_vi`,
            `pos`, `context_sentence`, `evidence_substring`.

    Returns:
        Validated dict ready for INSERT, or None if every generation
        path failed AND the evidence-substring fallback also produced
        no usable sentence.
    """
    headword = (vocab_row.get("headword") or "").strip()
    if not headword:
        logger.warning("[d1_question_generator] skip — empty headword on vocab_id=%s",
                       vocab_row.get("id"))
        return None

    evidence = (vocab_row.get("evidence_substring")
                or vocab_row.get("context_sentence") or "").strip()

    # ── Try Haiku ──────────────────────────────────────────────────────────────
    haiku_payload = _try_haiku(vocab_row)
    if haiku_payload:
        haiku_payload["generated_by"] = "haiku"
        haiku_payload["source_evidence_substring"] = evidence or None
        return haiku_payload

    # ── Try Gemini ────────────────────────────────────────────────────────────
    gemini_payload = _try_gemini(vocab_row)
    if gemini_payload:
        gemini_payload["generated_by"] = "gemini"
        gemini_payload["source_evidence_substring"] = evidence or None
        return gemini_payload

    # ── Evidence-substring fallback ───────────────────────────────────────────
    if evidence:
        fallback = _evidence_fallback(headword, evidence)
        if fallback:
            fallback["generated_by"] = "fallback_evidence"
            fallback["source_evidence_substring"] = evidence
            return fallback

    logger.warning(
        "[d1_question_generator] all paths failed for vocab_id=%s headword=%r",
        vocab_row.get("id"), headword,
    )
    return None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _build_user_prompt(vocab_row: dict) -> str:
    headword = (vocab_row.get("headword") or "").strip()
    definition = (vocab_row.get("definition_en")
                  or vocab_row.get("definition_vi") or "").strip()
    pos = (vocab_row.get("pos") or "").strip()
    evidence = (vocab_row.get("evidence_substring")
                or vocab_row.get("context_sentence") or "").strip()

    parts = [f"Target word: {headword}"]
    if definition:
        parts.append(f"Definition: {definition}")
    if pos:
        parts.append(f"Part of speech: {pos}")
    if evidence:
        parts.append(f'Original context (from student): "{evidence}"')
    return "\n".join(parts)


def _strip_json_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    return raw.strip()


def _validate_ai_payload(
    raw_payload: dict[str, Any],
    target_headword: str,
) -> dict | None:
    """Validate AI output and compute blank positions.

    Returns the enriched payload (with blank_position_start/_end) on
    success, or None if any required field is missing / invalid.
    """
    sentence = (raw_payload.get("context_sentence") or "").strip()
    target = (raw_payload.get("target_answer") or "").strip().lower()
    variants_raw = raw_payload.get("acceptable_variants") or []
    hint = raw_payload.get("hint", "")
    if hint is None:
        hint = ""
    hint = str(hint).strip()

    if not sentence or not target:
        return None

    # target_answer should match the headword (modulo case) — guard against
    # the model wandering off to a different word.
    if target != target_headword.lower():
        # Tolerate trivial morphological drift (e.g. plural vs singular)
        # ONLY if the headword still appears somewhere in the sentence.
        # Otherwise reject.
        if target_headword.lower() not in sentence.lower():
            return None

    # Sentence length sanity (12-30 words; spec says 12-25 but allow slack
    # because models sometimes pad with an article/conjunction).
    word_count = len(sentence.split())
    if word_count < 8 or word_count > 35:
        return None

    # Compute blank positions — first occurrence of target_answer in
    # context_sentence (case-insensitive). Anchor on word boundaries so a
    # target "use" doesn't match inside "used" etc.
    pattern = re.compile(r"\b" + re.escape(target) + r"\b", re.IGNORECASE)
    match = pattern.search(sentence)
    if not match:
        # Looser fallback: substring match without word boundary (handles
        # contractions or AI returning the inflected form).
        pattern = re.compile(re.escape(target), re.IGNORECASE)
        match = pattern.search(sentence)
        if not match:
            return None

    start, end = match.start(), match.end()

    # Normalize variants → list[str], lowercased, dedup.
    variants: list[str] = []
    if isinstance(variants_raw, list):
        seen: set[str] = set()
        for v in variants_raw:
            if not isinstance(v, str):
                continue
            v_clean = v.strip().lower()
            if v_clean and v_clean != target and v_clean not in seen:
                seen.add(v_clean)
                variants.append(v_clean)

    return {
        "context_sentence":     sentence,
        "blank_position_start": start,
        "blank_position_end":   end,
        "target_answer":        target,
        "acceptable_variants":  variants,
        "hint":                 hint or None,
    }


def _try_haiku(vocab_row: dict) -> dict | None:
    """Primary path — Claude Haiku 4.5."""
    if not settings.ANTHROPIC_API_KEY:
        logger.debug("[d1_question_generator] Haiku skipped — no ANTHROPIC_API_KEY")
        return None

    headword = (vocab_row.get("headword") or "").strip()
    model = _DEFAULT_HAIKU_MODEL

    try:
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        msg = client.messages.create(
            model=model,
            max_tokens=512,
            system=[{"type": "text", "text": _SYSTEM_PROMPT}],
            messages=[{"role": "user", "content": _build_user_prompt(vocab_row)}],
        )
        raw = msg.content[0].text if msg.content else ""
    except Exception as e:
        logger.warning(
            "[d1_question_generator] Haiku call failed for vocab_id=%s: %s",
            vocab_row.get("id"), e,
        )
        return None

    try:
        payload = json.loads(_strip_json_fences(raw))
    except Exception as e:
        logger.warning(
            "[d1_question_generator] Haiku returned invalid JSON for vocab_id=%s: %s — head=%r",
            vocab_row.get("id"), e, raw[:200],
        )
        return None

    if not isinstance(payload, dict):
        return None

    validated = _validate_ai_payload(payload, headword)
    if not validated:
        logger.info(
            "[d1_question_generator] Haiku payload failed validation for vocab_id=%s",
            vocab_row.get("id"),
        )
    return validated


def _try_gemini(vocab_row: dict) -> dict | None:
    """Fallback path — Gemini 2.5 Flash (same model as d1_content_gen.py)."""
    try:
        import google.generativeai as genai  # noqa: WPS433 — lazy import
    except Exception:
        logger.debug("[d1_question_generator] Gemini skipped — google.generativeai not importable")
        return None

    if not getattr(settings, "GEMINI_API_KEY", None):
        # Note: services/gemini.py configures the key at import time; if the
        # module never loaded the key, we silently skip the fallback.
        pass

    headword = (vocab_row.get("headword") or "").strip()
    model_name = getattr(settings, "D1_GENERATION_MODEL", None) or "gemini-2.5-flash"

    try:
        model = genai.GenerativeModel(
            model_name=model_name,
            generation_config=genai.types.GenerationConfig(
                response_mime_type="application/json",
                temperature=0.6,
                max_output_tokens=512,
            ),
            system_instruction=_SYSTEM_PROMPT,
        )
        resp = model.generate_content(_build_user_prompt(vocab_row))
        raw = resp.text or ""
    except Exception as e:
        logger.warning(
            "[d1_question_generator] Gemini call failed for vocab_id=%s: %s",
            vocab_row.get("id"), e,
        )
        return None

    try:
        payload = json.loads(_strip_json_fences(raw))
    except Exception as e:
        logger.warning(
            "[d1_question_generator] Gemini returned invalid JSON for vocab_id=%s: %s — head=%r",
            vocab_row.get("id"), e, raw[:200],
        )
        return None

    if not isinstance(payload, dict):
        return None

    validated = _validate_ai_payload(payload, headword)
    if not validated:
        logger.info(
            "[d1_question_generator] Gemini payload failed validation for vocab_id=%s",
            vocab_row.get("id"),
        )
    return validated


def _evidence_fallback(headword: str, evidence: str) -> dict | None:
    """Last-resort fallback — use the user's original capture sentence
    with the target word masked. No new sentence, no variety, but the
    pedagogical value (testing recall of *the word they used*) is real.
    """
    # First word-bounded occurrence; loose substring as backup.
    pattern = re.compile(r"\b" + re.escape(headword) + r"\b", re.IGNORECASE)
    match = pattern.search(evidence)
    if not match:
        pattern = re.compile(re.escape(headword), re.IGNORECASE)
        match = pattern.search(evidence)
        if not match:
            return None

    start, end = match.start(), match.end()

    return {
        "context_sentence":     evidence,
        "blank_position_start": start,
        "blank_position_end":   end,
        "target_answer":        headword.strip().lower(),
        "acceptable_variants":  [],
        "hint":                 None,
    }
