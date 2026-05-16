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
import random
import re
from typing import Any

import anthropic

from config import settings

logger = logging.getLogger(__name__)


_DEFAULT_HAIKU_MODEL = "claude-haiku-4-5-20251001"


# Sprint 10.5 Phase 2 — MCQ format. The system prompt now asks for 3
# distractors alongside the sentence so each question lands ready to
# render as a 4-option multiple-choice card. Phase 1 free-text mode
# was retired after quality inspection revealed grammar + variant
# coverage issues that MCQ sidesteps.
_SYSTEM_PROMPT = """You are creating IELTS practice multiple-choice vocabulary questions.

Given a target word with its definition and the original context the student used it in:

STEP 1 — Write ONE new sentence that:
- Uses the target word naturally in IELTS Speaking Part 1–3 register
- Is 12–25 words long
- Differs in topic/context from the original sentence (variety beats memorization)
- Avoids synonyms in the sentence that would give the answer away
- Uses the target word EXACTLY ONCE so the blank position is unambiguous

STEP 2 — Generate 3 DISTRACTOR options that:
- Are the same part of speech as the target word
- Would fit grammatically in the blank
- Are clearly WRONG semantically (do NOT mean the same thing as the target)
- Are NOT synonyms or near-synonyms of the target
- Are common IELTS-level vocabulary (no obscure words)

Return STRICT JSON only (no prose, no markdown fences), exactly this shape:
{
  "context_sentence": "<sentence containing the target word verbatim>",
  "target_answer": "<the target word, lowercased>",
  "distractors": ["<distractor1>", "<distractor2>", "<distractor3>"],
  "acceptable_variants": ["<alt spelling 1>"],
  "hint": "<5-8 word hint about meaning or part of speech>"
}

Rules:
- context_sentence MUST contain target_answer (case-insensitive match).
- distractors MUST have exactly 3 entries, all distinct, none equal to target_answer.
- acceptable_variants may be an empty array if none apply (Phase 2 keeps the field for forwards-compat with future recall mode).
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

    Sprint 10.5 Phase 2 — also validates the 3-distractor MCQ payload
    and builds a pre-shuffled options array (target + distractors,
    seeded by the headword for deterministic order across runs).

    Returns the enriched payload (with blank_position_start/_end and
    options[]) on success, or None if any required field is missing
    or invalid.
    """
    sentence = (raw_payload.get("context_sentence") or "").strip()
    target = (raw_payload.get("target_answer") or "").strip().lower()
    distractors_raw = raw_payload.get("distractors") or []
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

    # Sprint 10.5 Phase 2 — validate distractors. Reject if not exactly
    # 3 entries, if any is empty, or if any equals the target word
    # (case-insensitive). Dedup case-insensitively. If distractors are
    # missing or invalid, return None so the caller can fall back to
    # Gemini or evidence-substring path (which carries its own
    # distractor heuristic).
    distractors = _normalize_distractors(distractors_raw, target)
    if distractors is None:
        return None

    options = _shuffled_options(target, distractors, seed=target_headword.lower())

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
        "options":              options,
        "acceptable_variants":  variants,
        "hint":                 hint or None,
    }


def _normalize_distractors(raw: Any, target: str) -> list[str] | None:
    """Validate the 3-distractor array. Returns the cleaned list on
    success, or None if the payload doesn't meet the contract."""
    if not isinstance(raw, list) or len(raw) != 3:
        return None
    seen: set[str] = set()
    cleaned: list[str] = []
    for d in raw:
        if not isinstance(d, str):
            return None
        d_clean = d.strip()
        d_lower = d_clean.lower()
        if not d_clean or d_lower == target.lower() or d_lower in seen:
            return None
        seen.add(d_lower)
        cleaned.append(d_clean)
    if len(cleaned) != 3:
        return None
    return cleaned


def _shuffled_options(target: str, distractors: list[str], *, seed: str) -> list[str]:
    """Build a 4-element MCQ options array, shuffled deterministically
    via a Random(seed) instance. Seeding on the headword keeps the
    option order stable across reruns of the same question (useful for
    snapshot tests and for future client-side caching) without making
    the order obvious to learners."""
    options = [target] + list(distractors)
    random.Random(seed).shuffle(options)
    return options


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

    Sprint 10.5 Phase 2 — the evidence fallback intentionally leaves
    `options` empty. Producing 3 plausible distractors requires either
    an AI call (which already failed in this path) or a peer-word pool
    not available at row-generation time. The Phase 2 backfill script
    (scripts/backfill_d1_questions_mcq.py) walks rows with options=[]
    and fills them via a cheaper distractor-only AI call, so the row
    eventually becomes MCQ-ready without blocking the confirm path.
    Session endpoint treats rows with len(options) != 4 as "not MCQ-
    ready yet" and skips them in favour of admin fallback.
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
        "options":              [],   # Phase 2 backfill fills these.
        "acceptable_variants":  [],
        "hint":                 None,
    }
