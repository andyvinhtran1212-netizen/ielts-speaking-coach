"""
services/listening_grader.py — Sprint 11.2 (DEBT-LISTENING-MODULE 2/5).

Word-level dictation diff + score.

Sprint 11.0 §6 dictation requirement is "type the exact words you hear"
— so the grading model is per-word equality, not character-level edit
distance. A user who misspells a single word loses that word's point
but isn't punished extra for adjacent shifts. This matches every major
dictation-style learning app the user is likely to have seen (Lingq,
Yousician dictation, IELTS practice books).

Normalisation policy (kept conservative — punish nothing the IELTS
exam wouldn't):
  - Case-insensitive ("Hello" == "hello").
  - Trailing punctuation stripped (`.,!?;:` and Unicode equivalents),
    but interior punctuation kept ("don't" != "dont").
  - Whitespace collapsed.
  - Curly quotes normalised to straight (smart-quote MS Word paste
    is the #1 source of false misses in practice).

Diff algorithm: Wagner-Fischer LCS-style backtrace, O(n*m) but n+m
is tiny for dictation (≤ ~50 words per clip). Returns an ordered list
of `_DiffOp` tokens so the frontend can render colour-coded segments
in source order. The Sprint 10.x convention (return JSON-serialisable
shapes from services; routers wrap) is preserved — `_DiffOp` is a
plain dict in the public return.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any


# ── Normalisation ────────────────────────────────────────────────────


_TRAILING_PUNCT = ".,!?;:¿¡…"
_QUOTE_TRANSLATE = str.maketrans({
    "\u2018": "'",   # left single
    "\u2019": "'",   # right single (also apostrophe)
    "\u201C": '"',   # left double
    "\u201D": '"',   # right double
})


def _normalise_word(w: str) -> str:
    """Return the canonical comparable form of a single token."""
    w = unicodedata.normalize("NFKC", w)
    w = w.translate(_QUOTE_TRANSLATE)
    w = w.strip().strip(_TRAILING_PUNCT)
    return w.casefold()


def _tokenise(text: str) -> list[str]:
    """Split on whitespace. Returns RAW tokens (display form) — the
    normalised form is computed at compare time so the diff can show
    the user's actual capitalisation back to them on display."""
    if not text:
        return []
    # Collapse all unicode whitespace runs.
    text = re.sub(r"\s+", " ", text.strip())
    return [t for t in text.split(" ") if t]


# ── Diff ─────────────────────────────────────────────────────────────


@dataclass
class _DiffOp:
    op: str           # "match" | "miss" | "wrong" | "extra"
    expected: str | None
    actual: str | None


def _lcs_diff(expected: list[str], actual: list[str]) -> list[_DiffOp]:
    """LCS-style diff. Walks both sequences emitting ops in order.

    Semantics:
      match — both sides have the same normalised token at this slot.
      miss  — expected has a token the user omitted (skip in user input).
      extra — user typed a token not in the reference (insert).
      wrong — same slot, both sides have content, normalised tokens differ.
              This case is synthesised when a miss + extra collide at
              the same position (the more user-friendly view).
    """
    n_exp, n_act = len(expected), len(actual)

    # Build LCS table on normalised forms.
    exp_norm = [_normalise_word(w) for w in expected]
    act_norm = [_normalise_word(w) for w in actual]
    dp = [[0] * (n_act + 1) for _ in range(n_exp + 1)]
    for i in range(n_exp):
        for j in range(n_act):
            if exp_norm[i] and exp_norm[i] == act_norm[j]:
                dp[i + 1][j + 1] = dp[i][j] + 1
            else:
                dp[i + 1][j + 1] = max(dp[i + 1][j], dp[i][j + 1])

    # Backtrace into an ordered op list.
    ops: list[_DiffOp] = []
    i, j = n_exp, n_act
    while i > 0 and j > 0:
        if exp_norm[i - 1] and exp_norm[i - 1] == act_norm[j - 1]:
            ops.append(_DiffOp("match", expected[i - 1], actual[j - 1]))
            i -= 1
            j -= 1
        elif dp[i - 1][j] >= dp[i][j - 1]:
            ops.append(_DiffOp("miss", expected[i - 1], None))
            i -= 1
        else:
            ops.append(_DiffOp("extra", None, actual[j - 1]))
            j -= 1
    while i > 0:
        ops.append(_DiffOp("miss", expected[i - 1], None))
        i -= 1
    while j > 0:
        ops.append(_DiffOp("extra", None, actual[j - 1]))
        j -= 1
    ops.reverse()

    # Collapse adjacent miss+extra into a single "wrong" — friendlier
    # than two separate red blobs when the user just swapped a word.
    collapsed: list[_DiffOp] = []
    k = 0
    while k < len(ops):
        cur = ops[k]
        if (k + 1 < len(ops)
                and cur.op == "miss"
                and ops[k + 1].op == "extra"):
            collapsed.append(_DiffOp("wrong", cur.expected, ops[k + 1].actual))
            k += 2
            continue
        if (k + 1 < len(ops)
                and cur.op == "extra"
                and ops[k + 1].op == "miss"):
            collapsed.append(_DiffOp("wrong", ops[k + 1].expected, cur.actual))
            k += 2
            continue
        collapsed.append(cur)
        k += 1
    return collapsed


# ── Public API ───────────────────────────────────────────────────────


def grade_dictation(
    *,
    reference_transcript: str,
    user_transcript: str,
) -> dict[str, Any]:
    """Grade one dictation attempt.

    Returns a dict-shaped payload safe to JSON-serialise into the
    listening_attempts row + return verbatim to the client:

        {
          "score": Decimal-like float ∈ [0, 1] — correct_words / total_words,
          "correct_words": int,
          "total_words": int,
          "is_correct": bool — true only if score >= 1.0,
          "diff": [
            {"op": "match" | "miss" | "wrong" | "extra",
             "expected": str | None,
             "actual": str | None}
          ]
        }
    """
    expected_tokens = _tokenise(reference_transcript)
    actual_tokens = _tokenise(user_transcript)
    ops = _lcs_diff(expected_tokens, actual_tokens)

    correct = sum(1 for o in ops if o.op == "match")
    total = max(len(expected_tokens), 1)  # avoid div-by-zero
    score = correct / total

    return {
        "score": round(score, 4),
        "correct_words": correct,
        "total_words": len(expected_tokens),
        "is_correct": score >= 1.0,
        "diff": [{"op": o.op, "expected": o.expected, "actual": o.actual} for o in ops],
    }


# ── True / False / Not-Given grader (Sprint 11.4) ────────────────────


_TF_VALUES = {"T", "F", "NG"}


def grade_true_false(
    *,
    statements: list[dict],
    user_answers: list[str],
) -> dict[str, Any]:
    """Grade one True/False/Not-Given attempt.

    Args:
      statements:   admin-curated list of {idx, text, answer} where
                    answer is "T" | "F" | "NG".
      user_answers: list of "T" | "F" | "NG" strings in the same order
                    as statements. Length may differ — extra answers
                    discarded, missing answers count as 0 (wrong).

    Returns:
      {
        "score":        0-1 float (correct / total),
        "correct":      int,
        "total":        int,
        "is_correct":   bool (score == 1.0),
        "details": [
          {"idx": int, "expected": "T", "actual": "F", "is_correct": false}
        ]
      }
    """
    total = len(statements)
    if total == 0:
        return {"score": 0.0, "correct": 0, "total": 0, "is_correct": False, "details": []}

    details: list[dict[str, Any]] = []
    correct_n = 0
    for i, stmt in enumerate(statements):
        expected = str(stmt.get("answer", "")).upper().strip()
        actual_raw = user_answers[i] if i < len(user_answers) else ""
        actual = str(actual_raw or "").upper().strip()
        # Normalise common synonyms.
        if actual in {"TRUE"}:        actual = "T"
        elif actual in {"FALSE"}:     actual = "F"
        elif actual in {"NOT GIVEN", "NOTGIVEN", "NG", "N/G"}:
                                       actual = "NG"
        is_corr = (expected in _TF_VALUES) and (expected == actual)
        if is_corr:
            correct_n += 1
        details.append({
            "idx":        i,
            "expected":   expected,
            "actual":     actual,
            "is_correct": is_corr,
        })
    score = correct_n / total
    return {
        "score":      round(score, 4),
        "correct":    correct_n,
        "total":      total,
        "is_correct": score >= 1.0,
        "details":    details,
    }


# ── MCQ grader (Sprint 11.5) ─────────────────────────────────────────


def grade_mcq(
    *,
    questions: list[dict],
    user_answers: list[int],
) -> dict[str, Any]:
    """Grade one MCQ attempt (4 options per question, single-select).

    Args:
      questions:    admin-curated list of {idx, stem, options[4], answer_idx}.
                    answer_idx is the 0-based index of the correct option.
      user_answers: list of 0-based int indices in question order. Length
                    may differ — extras discarded, missing count as wrong.

    Returns:
      {
        "score":      0-1 float (correct / total),
        "correct":    int,
        "total":      int,
        "is_correct": bool (score == 1.0),
        "details": [
          {"idx": int, "expected_idx": int, "actual_idx": int|null,
           "is_correct": bool}
        ]
      }
    """
    total = len(questions)
    if total == 0:
        return {"score": 0.0, "correct": 0, "total": 0, "is_correct": False, "details": []}

    details: list[dict[str, Any]] = []
    correct_n = 0
    for i, q in enumerate(questions):
        try:
            expected = int(q.get("answer_idx"))
        except (TypeError, ValueError):
            expected = -1
        actual_raw = user_answers[i] if i < len(user_answers) else None
        try:
            actual = int(actual_raw) if actual_raw is not None else None
        except (TypeError, ValueError):
            actual = None
        is_corr = (actual is not None) and (expected == actual)
        if is_corr:
            correct_n += 1
        details.append({
            "idx":          i,
            "expected_idx": expected,
            "actual_idx":   actual,
            "is_correct":   is_corr,
        })
    score = correct_n / total
    return {
        "score":      round(score, 4),
        "correct":    correct_n,
        "total":      total,
        "is_correct": score >= 1.0,
        "details":    details,
    }
