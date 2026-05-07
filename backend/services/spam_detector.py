"""services/spam_detector.py — Phase 2.6 spam / quality detector.

Replaces the previous hard 400 "essay too short" reject with an
accept-and-flag flow.  The detector returns a list of triggered
reason codes so the submit endpoint can:

  1. Write `writing_essays.flag_reasons[]` (immutable audit trail).
  2. Surface a Vietnamese explanation to the student.
  3. Increment the student rollup counters.

Five reason codes:

  • too_short_chars  — text shorter than MIN_CHARS bytes after strip.
  • too_short_words  — fewer than MIN_WORDS whitespace-separated words.
  • repeated_phrase  — the same 5–30 char chunk appears 3+ times back
                       to back (covers `hello hello hello hello…`).
  • keyboard_mash    — a token of 5+ consecutive consonants with no
                       vowel (covers `qwerty`, `asdfg`, `bcdfgh`).
  • toxic_language   — a word from the seed list (Vietnamese or
                       English) appears anywhere in the text.

Order of checks matters for cost: length first (cheap), then the
two regex sweeps (only if the text is long enough to be plausible),
then the toxic check (always run because a 3-word slur should still
be caught).

The seed toxic word lists are intentionally short.  The goal is
catching obvious abuse, not a comprehensive moderation system; Andy
extends the lists as moderation policy evolves.  The current set
sanitises the obvious common offenders only.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)


# ── Thresholds ───────────────────────────────────────────────────────

MIN_CHARS = 50
MIN_WORDS = 100


# ── Pattern rules ────────────────────────────────────────────────────

# Same 5-to-30 char chunk repeated 3+ times back-to-back. The {2,}
# back-reference plus the captured group means we need three total
# occurrences (the original + two copies).
_REPEATED_PHRASE_RE = re.compile(r"(.{5,30})\1{2,}", re.IGNORECASE)

# Word boundary + 5+ consecutive Latin consonants only. \b matches
# transition between word and non-word, so this fires on any token
# that's 5+ consonants surrounded by punctuation/whitespace.
_KEYBOARD_MASH_RE = re.compile(
    r"\b[bcdfghjklmnpqrstvwxz]{5,}\b",
    re.IGNORECASE,
)

# Vietnamese profanity seed (sanitised). Andy extends per moderation
# policy. Listed without diacritic variants because Python's `re`
# without `re.UNICODE` won't match across Unicode equivalent forms —
# the patterns below cover the common ASCII transliterations too.
_TOXIC_VI = {
    "địt", "đụ", "đéo", "lồn", "cặc", "buồi", "đĩ",
    "dit", "du",  "deo", "lon", "cac",
}

# English profanity seed.
_TOXIC_EN = {
    "fuck", "shit", "bitch", "cunt", "asshole",
}

# Compiled once. `\b` is fine for the English words; the Vietnamese
# words contain no word-boundary-breaking chars so `\b` works there
# too.
_TOXIC_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in (_TOXIC_VI | _TOXIC_EN)) + r")\b",
    re.IGNORECASE,
)


# ── Public API ───────────────────────────────────────────────────────


def detect_flags(text: Optional[str]) -> list[str]:
    """Run every check and return the triggered flag codes.

    An empty list means the essay is clean and the caller should
    proceed to grading.  A non-empty list means the caller should
    skip grading and stamp the essay row with these reasons.

    The order in the returned list matches the order checks ran in,
    which is also the order most useful for the UI explanation
    (length first → student understands the obvious problem, then
    the more nuanced pattern flags).
    """
    flags: list[str] = []

    # An empty / None essay always trips the short-chars guard.
    if not text:
        return ["too_short_chars"]

    text_stripped = text.strip()
    char_count = len(text_stripped)
    word_count = len(text_stripped.split())

    if char_count < MIN_CHARS:
        flags.append("too_short_chars")
    if word_count < MIN_WORDS:
        flags.append("too_short_words")

    # Skip the regex sweeps on a too-short essay — pattern matches
    # there are noise (every 1-word essay is technically a "repeated
    # phrase" of itself if the test happens to repeat).
    if char_count >= MIN_CHARS:
        if _REPEATED_PHRASE_RE.search(text_stripped):
            flags.append("repeated_phrase")
        if _KEYBOARD_MASH_RE.search(text_stripped):
            flags.append("keyboard_mash")

    # Toxic check runs regardless of length — a 3-word slur is still
    # something we want to flag rather than silently grade.
    if _TOXIC_PATTERN.search(text_stripped):
        flags.append("toxic_language")

    return flags


# Vietnamese phrasing for each flag code.  Combined with semicolons
# when multiple flags fire, then dropped into the student-facing
# alert + the `error_message` column on the essay row.
_FLAG_LABELS_VI = {
    "too_short_chars":  "bài viết quá ngắn (chưa đạt độ dài tối thiểu)",
    "too_short_words":  "bài viết quá ngắn (chưa đạt số từ tối thiểu)",
    "repeated_phrase":  "nội dung lặp lại nhiều lần",
    "keyboard_mash":    "nội dung không phải tiếng Anh hợp lệ",
    "toxic_language":   "nội dung không phù hợp",
}


def format_flag_explanation_vi(flags: list[str]) -> str:
    """Build the Vietnamese explanation surfaced to the student.

    De-duplicates because too_short_chars + too_short_words map to
    near-identical labels — the student doesn't need to read the
    same sentence twice.
    """
    if not flags:
        return "bài viết không đạt yêu cầu chấm bài"

    seen: set[str] = set()
    parts: list[str] = []
    for code in flags:
        label = _FLAG_LABELS_VI.get(code)
        if label and label not in seen:
            seen.add(label)
            parts.append(label)

    if not parts:
        return "bài viết không đạt yêu cầu chấm bài"

    return "; ".join(parts)
