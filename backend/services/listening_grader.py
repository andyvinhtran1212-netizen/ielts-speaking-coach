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


# Hesitation / filler interjections. Kept deliberately to PURE fillers
# (never content words like "well"/"like"/"so"/"right" which can carry
# meaning) so ignoring them can't forgive a real missed word. When
# ignore_fillers is on, a missed filler is not penalised and an extra
# filler the learner typed is not counted against them.
_FILLERS = {
    "um", "umm", "uhm", "uh", "uhh", "er", "err", "erm", "ah", "ahh",
    "oh", "ooh", "eh", "hmm", "hm", "mm", "mmm", "huh", "mhm",
}


def _is_filler(token: str | None) -> bool:
    return bool(token) and _normalise_word(token) in _FILLERS


def grade_dictation(
    *,
    reference_transcript: str,
    user_transcript: str,
    ignore_fillers: bool = False,
) -> dict[str, Any]:
    """Grade one dictation attempt.

    When ``ignore_fillers`` is set, hesitation markers (um / er / oh …)
    the learner didn't catch are neither penalised nor counted toward the
    total, and extra fillers they typed are flagged rather than marked
    wrong. The diff op carries ``"filler": True`` in those cases so the UI
    can render them softly.

    Returns a dict-shaped payload safe to JSON-serialise into the
    listening_attempts row + return verbatim to the client:

        {
          "score": Decimal-like float ∈ [0, 1] — correct_words / total_words,
          "correct_words": int,
          "total_words": int,
          "is_correct": bool — true only if score >= 1.0,
          "diff": [
            {"op": "match" | "miss" | "wrong" | "extra",
             "expected": str | None, "actual": str | None,
             "filler"?: True}
          ]
        }
    """
    expected_tokens = _tokenise(reference_transcript)
    actual_tokens = _tokenise(user_transcript)
    ops = _lcs_diff(expected_tokens, actual_tokens)

    diff = [{"op": o.op, "expected": o.expected, "actual": o.actual} for o in ops]
    correct = sum(1 for o in ops if o.op == "match")
    total = len(expected_tokens)

    if ignore_fillers:
        forgiven_expected = 0
        for d in diff:
            if d["op"] == "miss" and _is_filler(d["expected"]):
                d["filler"] = True
                forgiven_expected += 1
            elif d["op"] == "extra" and _is_filler(d["actual"]):
                d["filler"] = True
            elif (d["op"] == "wrong"
                    and _is_filler(d["expected"]) and _is_filler(d["actual"])):
                # One hesitation typed as another (Um → uh): both sides are
                # pure fillers, so forgive it too — don't count the expected
                # filler against the score.
                d["filler"] = True
                forgiven_expected += 1
        # Forgiven expected fillers drop out of the denominator so they
        # can't lower the score; matched fillers still count normally.
        total -= forgiven_expected

    denom = max(total, 1)  # avoid div-by-zero
    score = correct / denom

    return {
        "score": round(score, 4),
        "correct_words": correct,
        "total_words": total,
        "is_correct": score >= 1.0,
        "diff": diff,
    }


def aggregate_dictation_report(graded: list[dict]) -> dict:
    """Roll up a list of per-sentence grade_dictation() results into a
    dictation session report. ``graded`` items are the dicts grade_dictation
    returns (score/correct_words/total_words/diff). Returns the aggregate the
    completion report + admin analytics render (and that dictation_sessions
    persists as its summary columns + error_trends).

    Error trends count the diff ops (fillers excluded — they're forgiven) and
    surface the words most often missed / typed wrong, so both the learner and
    admin see *which words* are the problem, not just a percentage.
    """
    total_sentences = len(graded)
    correct_count = sum(1 for g in graded if (g.get("score") or 0) >= 1.0)
    total_words = sum(int(g.get("total_words") or 0) for g in graded)
    correct_words = sum(int(g.get("correct_words") or 0) for g in graded)
    scores = [float(g.get("score") or 0) for g in graded]
    accuracy = round(sum(scores) / len(scores), 4) if scores else 0.0

    op_counts = {"miss": 0, "wrong": 0, "extra": 0}
    missed: dict[str, int] = {}
    wronged: dict[str, int] = {}
    for g in graded:
        for op in (g.get("diff") or []):
            if op.get("filler"):
                continue   # forgiven hesitation — not an error
            kind = op.get("op")
            if kind not in op_counts:
                continue
            op_counts[kind] += 1
            if kind == "miss" and op.get("expected"):
                key = _normalise_word(op["expected"])
                if key:
                    missed[key] = missed.get(key, 0) + 1
            elif kind == "wrong" and op.get("expected"):
                key = _normalise_word(op["expected"])
                if key:
                    wronged[key] = wronged.get(key, 0) + 1

    def _top(counter: dict[str, int], label: str, n: int = 8) -> list[dict]:
        return [
            {label: w, "count": c}
            for w, c in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:n]
        ]

    return {
        "total_sentences": total_sentences,
        "correct_count": correct_count,
        "accuracy": accuracy,
        "total_words": total_words,
        "correct_words": correct_words,
        "error_trends": {
            "op_counts": op_counts,
            "top_missed": _top(missed, "word"),
            "top_wrong": _top(wronged, "expected"),
        },
    }


# Light proper-noun spelling hints. IELTS names (Pawsley, Meghan, Brighton)
# are the hardest thing to spell from audio for a learner, so the dictation
# UI surfaces them gently. Heuristic + deterministic: a capitalised word
# that is NOT sentence-initial and not "I…", with at least one lowercase
# letter (so real names, not acronyms or spelled-out letters).
def proper_noun_hints(text: str) -> list[str]:
    """Distinct proper-noun-ish tokens in ``text``, in order of appearance."""
    if not text:
        return []
    hints: list[str] = []
    seen: set[str] = set()
    prev_ends_sentence = True   # the very first token is sentence-initial
    for raw in text.split():
        core = raw.strip("\"'“”‘’.,!?;:()…-")
        is_initial = prev_ends_sentence
        prev_ends_sentence = raw.endswith((".", "!", "?", "…"))
        if not core or is_initial:
            continue
        if core == "I" or core.startswith("I'") or core.startswith("I’"):
            continue
        if core[0].isupper() and any(c.islower() for c in core[1:]):
            key = core.casefold()
            if key not in seen:
                seen.add(key)
                hints.append(core)
    return hints


# ── Sentence splitter (test-linked dictation) ────────────────────────
#
# Test-linked dictation ("chép chính tả" launched from a listening test)
# reuses the section's stored full transcript. There is NO per-sentence
# audio timing for tests (unlike listening_exercises.segments), so we do
# NOT fabricate timestamps — we only split the REAL transcript text into
# sentences the learner types one at a time, while the section audio
# plays with free scrub. This splitter is deterministic and must return
# the same sentence list on the boot endpoint (to render dots) and on
# the grade endpoint (to look up the reference sentence by index).
#
# CRITICAL: the stored transcript (listening_fulltest_import: the "bản
# đọc" display copy) is turn-structured — blank-line-separated speaker
# turns, each prefixed with a bold speaker label:
#
#     **Helen (Course coordinator):** Good afternoon. How may I help?
#
#     **Daniel (Customer):** I'd like to enrol in a beginner course.
#
# So we split by TURN first, strip the speaker label + production cues,
# THEN sentence-split within each turn. Splitting the raw blob on "."
# alone would (a) keep the "**Name (role):**" label in the reference —
# the learner ends up typing the label — and (b) run turns together.

# Common abbreviations whose trailing "." must NOT end a sentence.
_ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "prof", "st", "mt", "vs", "etc", "eg", "ie",
    "no", "vol", "fig", "approx", "dept", "univ", "inc", "ltd", "co",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct",
    "nov", "dec", "am", "pm", "a.m", "p.m",
}

# A sentence terminator (. ! ? plus Unicode …) followed by whitespace.
# The lookbehind-free approach: split on terminator+space, then re-attach
# the terminator, and merge fragments that end in a known abbreviation.
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?…])\s+")

# Turn boundary in the stored transcript = one or more blank lines.
_TURN_SPLIT_RE = re.compile(r"\n[ \t]*\n+")
# Leading bold speaker label, e.g. "**Helen (Course coordinator):**".
_SPEAKER_LABEL_RE = re.compile(r"^\s*\*\*[^*\n]+\*\*\s*")
# Production cues / bracket voice tags: "[pause]", "[F-BrE-30s]", …
_BRACKET_RE = re.compile(r"\[[^\]]*\]")
# Answer markers the fullscript/v1.1 copy carries. Mirror the permissive
# form the converter strips (listening_convert._QUESTION_MARKER_RE) so the
# spaced variant "( Q 33 )" is removed too, not just compact "(Q7)".
_QMARKER_RE = re.compile(r"\(\s*Q\s*\d+\s*\)", re.IGNORECASE)
# A markdown horizontal rule ("---", "***", "___") used as a separator in
# the transcript — NOT speech. Dropped so it isn't counted as a turn (which
# would misalign the transcript turns against timings.turns → no segments).
_HRULE_RE = re.compile(r"^[-*_ ]{3,}$")


def _clean_turn(paragraph: str) -> str:
    """Strip the speaker label + production cues + answer markers + stray
    markdown from one turn paragraph, and collapse whitespace to spaces.
    A separator-only paragraph (markdown horizontal rule) → ``""``."""
    # Check the raw paragraph first: "***" would otherwise become "*" once
    # bold markers are stripped and slip past the rule test.
    if _HRULE_RE.match(paragraph.strip()):
        return ""
    text = _SPEAKER_LABEL_RE.sub("", paragraph)
    text = text.replace("**", "")          # any remaining bold markers
    text = _BRACKET_RE.sub(" ", text)      # [cue] / [voice-code]
    text = _QMARKER_RE.sub(" ", text)      # (Qn)
    text = re.sub(r"\s+", " ", text).strip()
    return "" if _HRULE_RE.match(text) else text


def _sentences_in(text: str) -> list[str]:
    """Sentence-split one already-cleaned turn on . ! ? … with an
    abbreviation guard (keeps "Mr." / "e.g." intact)."""
    out: list[str] = []
    buffer = ""
    for part in _SENTENCE_SPLIT_RE.split(text):
        part = part.strip()
        if not part:
            continue
        buffer = f"{buffer} {part}".strip() if buffer else part
        last = buffer.rstrip(".!?…").split()
        tail = last[-1].casefold() if last else ""
        if not (buffer.endswith(".") and tail in _ABBREVIATIONS):
            out.append(buffer)
            buffer = ""
    if buffer:
        out.append(buffer)
    return out


def split_sentences(transcript: str) -> list[str]:
    """Split a stored test transcript into display-ready dictation units.

    Turn-aware: splits on blank-line turn boundaries, strips the
    "**Name (role):**" speaker label + production cues, then sentence-
    splits within each turn so one unit = one spoken sentence (never the
    whole multi-turn blob, never the label). Deterministic — the boot and
    grade endpoints must agree on indices.

    Empty / whitespace-only input → ``[]`` (the UI then shows a
    "chưa có lời" empty state rather than a broken dictation loop).
    """
    if not transcript or not transcript.strip():
        return []

    # Normalise line endings first: a Solution.md uploaded with Windows
    # CRLF stores "\r\n\r\n" between turns, which the LF-only turn regex
    # would miss — merging turns so later "**Name:**" labels leak into the
    # reference. Fold CRLF + lone CR to LF so the turn split is reliable.
    transcript = transcript.replace("\r\n", "\n").replace("\r", "\n")

    sentences: list[str] = []
    for paragraph in _TURN_SPLIT_RE.split(transcript):
        cleaned = _clean_turn(paragraph)
        if cleaned:
            sentences.extend(_sentences_in(cleaned))
    return sentences


def split_turns(transcript: str) -> list[str]:
    """Split into cleaned TURN units — one per speaker turn, NOT sentence-
    split within a turn. This is the audio-aligned granularity for timed
    dictation: each turn pairs 1:1 with a timings.json ``turns[]`` entry
    (same dialogue, same order), so a per-turn audio window can be attached.
    Cleaning (label + cue strip, CRLF fold) matches split_sentences.
    """
    if not transcript or not transcript.strip():
        return []
    transcript = transcript.replace("\r\n", "\n").replace("\r", "\n")
    out: list[str] = []
    for paragraph in _TURN_SPLIT_RE.split(transcript):
        cleaned = _clean_turn(paragraph)
        if cleaned:
            out.append(cleaned)
    return out


def build_turn_segments(
    transcript: str,
    turns: list[dict] | None,
    offset: float = 0.0,
) -> list[dict]:
    """Pair a section's transcript turns with its timings ``turns[]`` →
    per-turn dictation segments ``[{idx, start, end, text}]`` for auto-clip.

    ``turns`` is a list of ``{"start", "end"}`` (section-relative). ``offset``
    is added to every window — 0 for a section-file audio (drill / mini),
    the section start for a full-premixed test. Returns ``[]`` when the two
    lists don't align 1:1 (the caller then falls back to free scrub) so no
    guessed timing is ever stored. Shared by both import paths + the backfill
    so the persisted shape is identical everywhere.
    """
    texts = split_turns(transcript or "")
    if not texts or not turns or len(texts) != len(turns):
        return []
    segments: list[dict] = []
    for i, (text, turn) in enumerate(zip(texts, turns)):
        try:
            start = round(float(turn["start"]) + float(offset), 2)
            end = round(float(turn["end"]) + float(offset), 2)
        except (KeyError, TypeError, ValueError):
            return []   # malformed timing → free scrub, never a bad clip
        # Reject a window the player can't clip (negative start, or
        # end <= start) — one bad turn falls the whole section back to free
        # scrub rather than persisting an unplayable segment.
        if start < 0 or end <= start:
            return []
        segments.append({"idx": i, "start": start, "end": end, "text": text})
    return segments


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
