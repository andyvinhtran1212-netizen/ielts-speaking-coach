"""services/listening_test_grader.py — Sprint 13.5.

Pure functions for grading a Cambridge IELTS full-test attempt
(40 questions across 4 sections). The grader is exercise-type-aware:

  * ``dictation_gap_fill`` / ``dictation_short_answer`` — string match
    against the canonical answer + Andy's marking-guide alternatives.
    Case-insensitive, trim, collapse internal whitespace. UK and US
    spelling variants are accepted via the variant map. Contractions
    are NOT accepted (matching Andy's marking guide rule).
  * ``mcq_3option`` / ``mcq_letter_label`` — single-letter match
    (case-insensitive, trimmed).

All matching is per-question (one user answer per q_num). Trap
mechanism analytics are rolled up to ``{mechanism: {caught, missed}}``
counts across the whole attempt.

The band-estimate map is the publicly published IELTS Listening
score → band conversion (Cambridge IELTS Official Guide). Scores
below 10 are reported qualitatively ("Below band 4.0") because the
official map only covers 10+.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any


# ── Answer normalisation ───────────────────────────────────────────────────


# Contractions Andy's marking guide explicitly REJECTS even when the
# expanded form would match. Stripping them at compare time keeps
# false-positives at zero.
_CONTRACTION_PATTERNS = [
    re.compile(r"\bdon't\b", re.IGNORECASE),
    re.compile(r"\bdoesn't\b", re.IGNORECASE),
    re.compile(r"\bdidn't\b", re.IGNORECASE),
    re.compile(r"\bcan't\b", re.IGNORECASE),
    re.compile(r"\bcouldn't\b", re.IGNORECASE),
    re.compile(r"\bwon't\b", re.IGNORECASE),
    re.compile(r"\bwouldn't\b", re.IGNORECASE),
    re.compile(r"\bisn't\b", re.IGNORECASE),
    re.compile(r"\baren't\b", re.IGNORECASE),
    re.compile(r"\bI'm\b", re.IGNORECASE),
    re.compile(r"\b(you|we|they)'re\b", re.IGNORECASE),
    re.compile(r"\b(it|he|she)'s\b", re.IGNORECASE),
]


# UK ↔ US spelling pairs from Andy's marking guide. Both members of the
# pair are accepted on either side of the comparison. Extend as Andy
# adds tests.
_SPELLING_PAIRS: list[tuple[str, str]] = [
    ("colour", "color"),
    ("colours", "colors"),
    ("favourite", "favorite"),
    ("favour", "favor"),
    ("centre", "center"),
    ("theatre", "theater"),
    ("metre", "meter"),
    ("travelling", "traveling"),
    ("recognise", "recognize"),
    ("organise", "organize"),
    ("organisation", "organization"),
    ("realise", "realize"),
    ("analyse", "analyze"),
    ("practise", "practice"),
    ("defence", "defense"),
    ("licence", "license"),
    ("grey", "gray"),
    ("aluminium", "aluminum"),
]
_SPELLING_NORMAL: dict[str, str] = {}
for uk, us in _SPELLING_PAIRS:
    _SPELLING_NORMAL[uk.lower()] = uk.lower()
    _SPELLING_NORMAL[us.lower()] = uk.lower()                                # canonicalise to UK


def _strip_contractions(text: str) -> str:
    for pat in _CONTRACTION_PATTERNS:
        if pat.search(text):
            # Sentinel — return an obviously-non-matching string so
            # the contraction always fails the equality test.
            return "__contraction_present__"
    return text


def _canonical_spelling(token: str) -> str:
    return _SPELLING_NORMAL.get(token.lower(), token.lower())


def _strip_diacritics(s: str) -> str:
    # NFD decomposes "é" → "e" + U+0301; the comprehension drops the
    # combining marks (U+0300–U+036F), leaving the base letters.
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


def normalize_answer(raw: str | None) -> str:
    """Normalise a user-typed answer for comparison.

    Steps: trim → strip diacritics → drop surrounding punctuation → collapse
    internal whitespace → lowercase → canonicalise UK/US spelling per token.
    Returns ``""`` for empty/None input.

    Diacritic strip (Sprint 20.13c, Interactive HTML Standards §5.3): the
    NFD pass lets "El Niño" match "El Nino" and "café" match "cafe". The
    existing IELTS Reading/Listening seeds carry zero non-ASCII characters
    in their answer keys (verified at sprint time), so this change is a
    forward-compatible improvement rather than a behavioural shift.
    """
    if raw is None:
        return ""
    s = str(raw).strip()
    if not s:
        return ""
    s = _strip_contractions(s)
    if s == "__contraction_present__":
        return s
    s = _strip_diacritics(s)
    # Strip surrounding punctuation but preserve hyphens inside words.
    s = re.sub(r"^[^\w]+|[^\w]+$", "", s)
    s = re.sub(r"\s+", " ", s).lower()
    tokens = [_canonical_spelling(t) for t in s.split(" ")]
    return " ".join(tokens)


def answer_matches(user: str | None, expected: str, alternatives: list[str]) -> bool:
    """Compare a user answer against the canonical answer + its
    alternatives. Hyphenated forms count as single words (no special
    handling required — normalisation keeps the hyphen).
    """
    norm_user = normalize_answer(user)
    if not norm_user:
        return False
    candidates = [expected, *alternatives]
    for cand in candidates:
        if not cand:
            continue
        if normalize_answer(cand) == norm_user:
            return True
    return False


# ── Band-estimate map (Cambridge IELTS Listening official) ─────────────────


_BAND_MAP: list[tuple[int, float]] = [
    (39, 9.0),
    (37, 8.5),
    (35, 8.0),
    (32, 7.5),
    (30, 7.0),
    (26, 6.5),
    (23, 6.0),
    (18, 5.5),
    (16, 5.0),
    (13, 4.5),
    (10, 4.0),
]


def band_estimate(score: int) -> float | None:
    """Return the IELTS Listening band for a 0-40 raw score, or None
    when the score is below the published table (under 10).
    """
    for threshold, band in _BAND_MAP:
        if score >= threshold:
            return band
    return None


# ── Trap analytics ─────────────────────────────────────────────────────────


def rollup_trap_analytics(
    per_question_results: list[dict[str, Any]],
) -> dict[str, dict[str, int]]:
    """Aggregate per-question results into a trap-mechanism rollup.

    Input rows look like ``{q_num, correct, trap_mechanisms}`` (each
    mechanism counted separately). Output:

        {"paraphrase_t0": {"caught": 3, "missed": 1}, ...}

    "caught" = student answered correctly on a trap-bearing question.
    "missed" = student answered incorrectly on a trap-bearing question.
    Questions without trap_mechanisms contribute nothing.
    """
    out: dict[str, dict[str, int]] = {}
    for row in per_question_results:
        mechanisms = row.get("trap_mechanisms") or []
        if not mechanisms:
            continue
        bucket = "caught" if row.get("correct") else "missed"
        for m in mechanisms:
            if not m:
                continue
            slot = out.setdefault(m, {"caught": 0, "missed": 0})
            slot[bucket] += 1
    return out


# ── Section breakdown ─────────────────────────────────────────────────────


def section_breakdown(
    per_question_results: list[dict[str, Any]],
) -> dict[str, dict[str, int]]:
    """Group per-question results by Cambridge section convention
    (Q1-10 → s1, Q11-20 → s2, Q21-30 → s3, Q31-40 → s4).

    Returns ``{"s1": {"correct": N, "total": M}, ...}``.
    """
    out: dict[str, dict[str, int]] = {
        f"s{n}": {"correct": 0, "total": 0} for n in (1, 2, 3, 4)
    }
    for row in per_question_results:
        q_num = row.get("q_num")
        if not isinstance(q_num, int):
            continue
        section_num = ((q_num - 1) // 10) + 1
        if 1 <= section_num <= 4:
            key = f"s{section_num}"
            out[key]["total"] += 1
            if row.get("correct"):
                out[key]["correct"] += 1
    return out


# ── Top-level grading ──────────────────────────────────────────────────────


def grade_attempt(
    user_answers:    list[dict[str, Any]],
    answer_key:      list[dict[str, Any]],
) -> dict[str, Any]:
    """Grade a complete attempt.

    Args:
        user_answers: list of ``{q_num, user_answer, ...}`` (extras ignored).
        answer_key:   list of ``{q_num, answer, alternatives,
                       trap_mechanisms}`` (the canonical answer-key
                       rows assembled from the test's exercises).

    Returns:
        ``{score, max_score, band_estimate, per_question,
        trap_analytics, section_breakdown}``.

    ``per_question`` is sorted by ``q_num`` ascending, one row per
    answer-key entry. Missing user answers count as incorrect.
    """
    user_by_q = {ua.get("q_num"): ua for ua in user_answers if ua.get("q_num")}
    per_question: list[dict[str, Any]] = []

    # A2 (P4) — pre-group mcq_multi answer-key rows by their shared group_key so
    # a "Choose TWO" pair is graded as a set (any-order), not slot-by-slot.
    mm_groups: dict[str, list] = {}
    for ak in answer_key:
        gk = ak.get("group_key")
        if gk and ak.get("template_kind") == "mcq_multi":
            mm_groups.setdefault(gk, []).append(ak)
    graded_mm: set[str] = set()

    for ak in sorted(answer_key, key=lambda r: r.get("q_num") or 0):
        q_num = ak.get("q_num")
        if not isinstance(q_num, int):
            continue
        gk = ak.get("group_key")
        if gk and ak.get("template_kind") == "mcq_multi":
            # Score the whole group once (per-letter 1pt, any-order): a slot is
            # correct iff its pick is in the group's expected set, consuming each
            # expected letter at most once (handles duplicate picks).
            if gk in graded_mm:
                continue
            graded_mm.add(gk)
            grp = sorted(mm_groups[gk], key=lambda r: r.get("q_num") or 0)
            remaining = [normalize_answer(g.get("answer") or "") for g in grp]
            for g in grp:
                gq = g.get("q_num")
                pick = normalize_answer((user_by_q.get(gq) or {}).get("user_answer"))
                ok = bool(pick) and pick in remaining
                if ok:
                    remaining.remove(pick)
                per_question.append({
                    "q_num":            gq,
                    "correct":          ok,
                    "user_answer":      (user_by_q.get(gq) or {}).get("user_answer") or "",
                    "expected":         g.get("answer") or "",
                    "alternatives":     g.get("alternatives") or [],
                    "trap_mechanisms":  g.get("trap_mechanisms") or [],
                    "group":            "mcq_multi",
                })
            continue

        expected = ak.get("answer") or ""
        alternatives = ak.get("alternatives") or []
        trap_mechanisms = ak.get("trap_mechanisms") or []

        ua_row = user_by_q.get(q_num) or {}
        user_answer = ua_row.get("user_answer")
        is_correct = answer_matches(user_answer, expected, alternatives)

        per_question.append({
            "q_num":            q_num,
            "correct":          is_correct,
            "user_answer":      user_answer or "",
            "expected":         expected,
            "alternatives":     alternatives,
            "trap_mechanisms":  trap_mechanisms,
        })

    per_question.sort(key=lambda r: r.get("q_num") or 0)
    score = sum(1 for r in per_question if r["correct"])
    return {
        "score":             score,
        "max_score":         len(per_question),
        "band_estimate":     band_estimate(score),
        "per_question":      per_question,
        "trap_analytics":    rollup_trap_analytics(per_question),
        "section_breakdown": section_breakdown(per_question),
    }


# ── Helpers — extract answer key from exercise rows ────────────────────────


def collect_answer_key(exercise_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Walk a test's exercise rows and flatten the per-question
    answer entries into a single list, ready for ``grade_attempt``.

    ``exercise_rows`` is the raw ``listening_exercises`` DB shape:
    each row has a ``payload`` dict carrying ``answers`` (the
    Sprint 13.4.2 parser output).
    """
    out: list[dict[str, Any]] = []
    for row in exercise_rows:
        payload = row.get("payload") or {}
        tk = payload.get("template_kind")
        answers = payload.get("answers") or []
        # A2 (P4) — a "Choose TWO" pair is ONE exercise spanning N q-slots,
        # graded any-order. Tag every entry of an mcq_multi exercise with a
        # shared group_key so grade_attempt can score the set, not slot-by-slot.
        group_key = (
            f"mm-{answers[0].get('q_num')}"
            if tk == "mcq_multi" and answers else None
        )
        for ans in answers:
            out.append({
                "q_num":           ans.get("q_num"),
                "answer":          ans.get("answer") or "",
                "alternatives":    ans.get("alternatives") or [],
                "notes":           ans.get("notes") or "",
                "trap_mechanisms": ans.get("trap_mechanisms") or [],
                "template_kind":   tk,
                "group_key":       group_key,
            })
    return out


def strip_answer_keys(exercise_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sprint 13.5 security guard — return exercise rows with the
    ``payload.answers`` field removed so the student-facing endpoint
    never leaks the answer key.

    Mutates a shallow copy; original rows untouched.
    """
    safe: list[dict[str, Any]] = []
    for row in exercise_rows:
        copy = dict(row)
        payload = dict(copy.get("payload") or {})
        if "answers" in payload:
            payload.pop("answers", None)
        copy["payload"] = payload
        safe.append(copy)
    return safe
