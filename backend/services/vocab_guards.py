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

# Semantic clusters: groups of words that are interchangeable enough that only one
# should appear in a user's vocab bank at a time. Prevents saving near-synonyms that
# differ linguistically but not meaningfully (e.g. rejuvenate vs reinvigorate).
_SEMANTIC_CLUSTERS: list[frozenset[str]] = [
    frozenset({"rejuvenate", "reinvigorate", "revitalize", "invigorate"}),
    frozenset({"mitigate", "alleviate", "ameliorate", "relieve"}),
    frozenset({"exacerbate", "aggravate", "worsen", "intensify"}),
    frozenset({"demonstrate", "illustrate", "exemplify", "showcase"}),
    frozenset({"emphasize", "highlight", "underscore", "accentuate"}),
    frozenset({"implement", "execute", "carry out", "put into practice"}),
    frozenset({"significant", "substantial", "considerable", "notable"}),
    frozenset({"consequently", "therefore", "hence", "thus"}),
    frozenset({"additionally", "furthermore", "moreover", "in addition"}),
]


def _in_same_cluster(word_a: str, word_b: str) -> bool:
    """Return True if both words belong to the same semantic cluster."""
    a, b = word_a.lower(), word_b.lower()
    return any(a in cluster and b in cluster for cluster in _SEMANTIC_CLUSTERS)

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


def _is_injection_artifact(item: dict) -> bool:
    """
    Guard 7: reject items that look like prompt-injection artifacts rather than
    natural vocab.  Checks headword chars, length, instruction-like phrases in
    context_sentence, and JSON/code-shaped sentences.
    Returns True  → item is suspicious (should be SKIPPED).
    Returns False → item looks clean (allow through).
    """
    sentence = (item.get("context_sentence") or "").lower()
    headword = (item.get("headword") or "")

    # Instruction-like keywords that no genuine IELTS sentence would contain
    _INJECTION_PHRASES = (
        "ignore previous",
        "ignore the instructions",
        "disregard",
        "system prompt",
        "new instructions",
        "mark as",
        "return fake",
    )
    if any(p in sentence for p in _INJECTION_PHRASES):
        return True

    # JSON/code-shaped context — not a natural sentence
    stripped = sentence.strip()
    if stripped.startswith(("{", "[", "<")) and stripped.endswith(("}", "]", ">")):
        return True
    if '":"' in sentence or '":{' in sentence:
        return True

    # Headword must be composed of only alphabetic chars, spaces, hyphens, apostrophes
    if not all(c.isalpha() or c in " -'" for c in headword):
        return True

    # Headword longer than 50 chars is not a real vocab item
    if len(headword) > 50:
        return True

    return False


def run_all_guards(
    item: dict,
    raw_transcript: str,
    source_type: str,
    existing_headwords: list[str],
    used_well_headwords: set[str] | None = None,
) -> tuple[bool, str | None]:
    """
    Run all guards on a single vocab item.

    Args:
        item: dict with keys headword, context_sentence, evidence_substring (required), original_word (optional)
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

    evidence_substring: str = (item.get("evidence_substring") or "").strip()

    if not headword or not context_sentence:
        return False, "guard_0_empty_fields"

    # Guard 0b: headword must not be a coordinating phrase (contains " and ")
    if " and " in headword.lower():
        logger.debug("[guard0b] SKIP '%s' — coordinating 'and' phrase", headword)
        return False, "guard_0_and_phrase"

    hw_lower = headword.lower()

    # Guard 7: injection artifact check — runs first to gate all downstream guards
    if _is_injection_artifact(item):
        logger.debug("[guard7] SKIP '%s' — injection artifact", headword)
        return False, "guard_7_injection_artifact"

    # Guard 8: evidence_substring is required for all AI-extracted items.
    # Empty/missing evidence is rejected outright; legacy DB rows never pass through guards.
    if not evidence_substring:
        logger.debug("[guard8] SKIP '%s' — evidence_substring missing or empty", headword)
        return False, "guard_8_evidence_required"
    if hw_lower not in evidence_substring.lower():
        logger.debug("[guard8] SKIP '%s' — not in evidence_substring", headword)
        return False, "guard_8_evidence_mismatch"
    if evidence_substring.lower() not in raw_transcript.lower():
        logger.debug("[guard8] SKIP '%s' — evidence_substring not in transcript", headword)
        return False, "guard_8_evidence_mismatch"

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

    # Guard 6: same-root prefix check, Levenshtein ≤ 2, OR semantic cluster match
    for existing in existing_headwords:
        ex_lower = existing.lower()
        if (
            _shares_root(hw_lower, ex_lower)
            or _levenshtein(hw_lower, ex_lower) <= 2
            or _in_same_cluster(hw_lower, ex_lower)
        ):
            logger.debug(
                "[guard6] SKIP '%s' — same-root/near-duplicate/same-cluster of existing '%s'",
                headword, existing,
            )
            return False, "guard_6_levenshtein_duplicate"

    return True, None
