"""
services/vocab_guards.py — Phase B: 6-guard system for vocab quality

Principle: Precision > Recall. Hard-skip on any guard failure.
Returns (passed: bool, failed_guard: str | None).
"""

import json
import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

_BAND_PAIRS_PATH = Path(__file__).parent.parent / "data" / "band_upgrade_pairs.json"

# Loaded once at module import
_UPGRADE_PAIRS: set[tuple[str, str]] = set()

try:
    raw = json.loads(_BAND_PAIRS_PATH.read_text(encoding="utf-8"))
    _UPGRADE_PAIRS = {(p["from"].lower(), p["to"].lower()) for p in raw}
except Exception as _e:
    logger.warning("[vocab_guards] failed to load band_upgrade_pairs.json: %s", _e)


def _levenshtein(a: str, b: str) -> int:
    """Standard DP Levenshtein distance."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i]
        for j, cb in enumerate(b, 1):
            curr.append(min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = curr
    return prev[-1]


def _shares_root(word_a: str, word_b: str, min_prefix: int = 6) -> bool:
    """
    Conservative same-root check: if two words share >= min_prefix chars prefix → same root.
    sustain (7) vs sustainability (13) → share "sustain" (7) → True → SKIP.
    No NLP, no dependencies.
    """
    a, b = word_a.lower(), word_b.lower()
    shorter = min(len(a), len(b))
    if shorter < min_prefix:
        return False
    return a[:min_prefix] == b[:min_prefix]


def _is_start_of_sentence(word: str, sentence: str) -> bool:
    """Return True if word appears as the first token of any sentence."""
    stripped = sentence.strip()
    # matches beginning of string or after . ! ?
    pattern = r'(?:^|(?<=[.!?])\s+)' + re.escape(word)
    return bool(re.search(pattern, stripped, re.IGNORECASE))


def _normalize_tokens(text: str) -> list[str]:
    """Strip punctuation, lowercase, split to token list for guard 2 comparison."""
    return re.sub(r'[^\w\s]', '', text).lower().split()


def _sentence_in_transcript(context_sentence: str, raw_transcript: str) -> bool:
    """
    Guard 2 check: context_sentence tokens must appear as a contiguous subsequence
    in transcript tokens. Tolerates punctuation variants (. vs ! vs ,) from Claude.
    """
    s_tokens = _normalize_tokens(context_sentence)
    t_tokens = _normalize_tokens(raw_transcript)
    n = len(s_tokens)
    if n == 0:
        return False
    return any(t_tokens[i:i + n] == s_tokens for i in range(len(t_tokens) - n + 1))


def run_all_guards(
    item: dict,
    raw_transcript: str,
    source_type: str,
    existing_headwords: list[str],
    used_well_headwords: set[str] | None = None,
) -> tuple[bool, str | None]:
    """
    Run all 6 guards on a single vocab item.

    Args:
        item: dict with keys headword, context_sentence, original_word (optional)
        raw_transcript: the full transcript string
        source_type: 'used_well' | 'needs_review' | 'upgrade_suggested' | 'manual'
        existing_headwords: lowercased headwords already in the user's bank
        used_well_headwords: lowercased headwords from the used_well category of this
            extraction result — used by guard 4 contradiction check

    Returns:
        (True, None) if all guards pass
        (False, "guard_N_name") on first failure
    """
    headword: str = (item.get("headword") or "").strip()
    context_sentence: str = (item.get("context_sentence") or "").strip()
    original_word: str = (item.get("original_word") or "").strip()

    if not headword or not context_sentence:
        return False, "guard_0_empty_fields"

    hw_lower = headword.lower()

    # Guard 1: headword must appear in context_sentence
    if hw_lower not in context_sentence.lower():
        logger.debug("[guard1] SKIP '%s' — not in context_sentence", headword)
        return False, "guard_1_word_not_in_sentence"

    # Guard 2: context_sentence tokens must appear contiguously in transcript
    # (token-based, tolerates Claude punctuation noise)
    if not _sentence_in_transcript(context_sentence, raw_transcript):
        logger.debug("[guard2] SKIP '%s' — context_sentence tokens not in transcript", headword)
        return False, "guard_2_sentence_not_in_transcript"

    # Guard 3: proper noun check — first-char uppercase but not at sentence start
    if headword[0].isupper() and not _is_start_of_sentence(headword, context_sentence):
        logger.debug("[guard3] SKIP '%s' — proper noun", headword)
        return False, "guard_3_proper_noun"

    # Guard 4: contradiction check for upgrade_suggested
    # If original_word is already in used_well, the upgrade is contradictory — skip.
    if source_type == "upgrade_suggested" and used_well_headwords:
        original_lower = original_word.lower() if original_word else ""
        if original_lower and original_lower in used_well_headwords:
            logger.debug(
                "[guard4] SKIP '%s' — original_word '%s' already in used_well",
                headword, original_word,
            )
            return False, "guard_4_contradiction"

    # Guard 5: upgrade whitelist check (only for upgrade_suggested)
    if source_type == "upgrade_suggested":
        if not original_word:
            logger.debug("[guard5] SKIP '%s' — upgrade_suggested missing original_word", headword)
            return False, "guard_5_missing_original_word"
        pair = (original_word.lower(), hw_lower)
        if pair not in _UPGRADE_PAIRS:
            logger.debug("[guard5] SKIP '%s' — upgrade pair (%s→%s) not in whitelist", headword, original_word, headword)
            return False, "guard_5_not_in_whitelist"

    # Guard 6: same-root prefix check OR Levenshtein ≤ 2 vs existing bank headwords
    for existing in existing_headwords:
        ex_lower = existing.lower()
        if _shares_root(hw_lower, ex_lower) or _levenshtein(hw_lower, ex_lower) <= 2:
            logger.debug(
                "[guard6] SKIP '%s' — same-root or near-duplicate of existing '%s'",
                headword, existing,
            )
            return False, "guard_6_levenshtein_duplicate"

    return True, None
