"""d1_quality — stricter quality gate for D1 fill-in-the-blank exercises
(audit Giai đoạn 3, #7 vocab).

`d1_content_gen._validate_d1_payload` only checks FORM (word==answer, one `___`,
3 distinct distractors, 12–30 words). The audit flags that this lets bad
distractors through — ones that leak the answer, appear in the sentence, or are
multi-word — and never measures whether an item actually teaches.

This module adds the pure, deterministic quality checks the form gate misses:
  * exactly ONE blank;
  * the answer does not appear elsewhere in the sentence (a leak — the learner
    can copy it);
  * no distractor appears in the sentence (a giveaway / confusion);
  * each distractor is a single token (a fill-blank distractor must be one word);
  * distractors differ from the answer and from each other.

Semantic plausibility ("is this distractor the same part of speech but clearly
wrong?") is NOT decidable in pure code — that's the LLM-judge pass in
scripts/gen_d1_distractor_review.py. Item difficulty/discrimination lives in
d1_item_stats.py.
"""

from __future__ import annotations

import re


def _norm(s) -> str:
    return str(s or "").strip().lower()


def _has_word(sentence: str, word: str) -> bool:
    """True if `word` appears as a standalone token in `sentence` (case-insensitive),
    ignoring the blank marker."""
    if not word:
        return False
    return re.search(rf"\b{re.escape(word)}\b", sentence, flags=re.IGNORECASE) is not None


def validate_d1_quality(payload: dict, label: str = "") -> list[str]:
    """Return quality-gap messages (empty = passes the stricter bar). Works on a
    raw or form-validated D1 payload."""
    tag = f"[{label}] " if label else ""
    errs: list[str] = []

    answer = _norm(payload.get("answer") or payload.get("word"))
    sentence = str(payload.get("sentence") or "")
    distractors = [_norm(d) for d in (payload.get("distractors") or [])]
    # strip ANY run of underscores for leak-detection (not just exactly "___")
    sentence_no_blank = re.sub(r"_+", " ", sentence)

    # Codex F1 — validate the blank as an exact token, not a substring: count("___")
    # returns 1 for "____" (4 underscores), which the UI then only half-replaces
    # (d1-exercise.js swaps the first "___"), leaving a stray "_". Require EXACTLY
    # one underscore run AND that run be exactly "___".
    runs = re.findall(r"_+", sentence)
    if len(runs) != 1:
        errs.append(f"{tag}câu phải có ĐÚNG một chỗ trống (đang có {len(runs)} cụm gạch dưới).")
    elif runs[0] != "___":
        errs.append(f"{tag}chỗ trống phải đúng 3 gạch dưới '___' (đang là '{runs[0]}').")

    if not answer:
        errs.append(f"{tag}thiếu answer/word.")
        return errs

    # answer leak: the target word appears somewhere else in the sentence
    if _has_word(sentence_no_blank, answer):
        errs.append(f"{tag}đáp án '{answer}' xuất hiện trong câu (lộ đáp án).")

    seen: set[str] = set()
    for i, d in enumerate(distractors):
        dtag = f"{tag}distractor[{i}]"
        if not d:
            errs.append(f"{dtag} trống.")
            continue
        if " " in d:
            errs.append(f"{dtag} '{d}' gồm nhiều từ — distractor phải là MỘT từ.")
        if d == answer:
            errs.append(f"{dtag} '{d}' trùng đáp án.")
        if d in seen:
            errs.append(f"{dtag} '{d}' trùng một distractor khác.")
        seen.add(d)
        if _has_word(sentence_no_blank, d):
            errs.append(f"{dtag} '{d}' xuất hiện trong câu (gây nhiễu/lộ).")

    if len(distractors) != 3:
        errs.append(f"{tag}cần đúng 3 distractor (đang có {len(distractors)}).")

    return errs


def is_quality(payload: dict) -> bool:
    return not validate_d1_quality(payload)
