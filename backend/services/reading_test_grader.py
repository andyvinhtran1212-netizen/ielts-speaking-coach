"""services/reading_test_grader.py — Sprint 20.5 L3 Full Test grader.

Clone-grade of services/listening_test_grader.py (Sprint 13.5) — same
deterministic, no-AI pattern, same `answer_matches` helper, same per-question
+ rollup shape. Three deliberate divergences for reading:

  • Band table: IELTS **Academic Reading** raw→band (different boundaries
    from Listening; e.g. 30 raw = 7.0 for Academic Reading, 32 = 7.0 for
    Listening). General Training has its own table (Phase B per the 20.5
    commission "Academic only unless Andy specifies").
  • Rollup: listening uses `trap_analytics` keyed by trap_mechanism; reading
    uses `skill_breakdown` keyed by **skill_tag** (D2 enum from cluster
    20.0 Discovery) — the Sprint 20.7 diagnostic engine's primary input.
  • Section grouping: listening = 4 sections of 10 Qs each (s1..s4);
    reading = **3 passages** of ~13–14 Qs each (`by_part: {p1, p2, p3}`).
    The grouping uses each answer-key row's `passage_order` (stamped from
    reading_passages), so per-part rollups are robust to non-standard
    splits (e.g. 14/13/13 vs 13/13/14).

Used by routers/reading_student.py POST .../submit (Sprint 20.5). L3 attempts
persist to `reading_test_attempts` (mig 087, RLS user-scoped).
"""

from __future__ import annotations

from typing import Any

from services.listening_test_grader import answer_matches, normalize_answer


# ── IELTS Academic Reading band table ─────────────────────────────────


# Cambridge IELTS Official Guide — Academic Reading raw → band conversion.
# Sorted descending by threshold (highest first). For a given raw score, walk
# the list and return the first band whose threshold is ≤ raw. Raw < 4 has
# no published band (returned as None — frontend renders as "Below 2.5").
_BAND_MAP_ACADEMIC: list[tuple[int, float]] = [
    (39, 9.0),
    (37, 8.5),
    (35, 8.0),
    (33, 7.5),
    (30, 7.0),
    (27, 6.5),
    (23, 6.0),
    (19, 5.5),
    (15, 5.0),
    (13, 4.5),
    (10, 4.0),
    (8,  3.5),
    (6,  3.0),
    (4,  2.5),
]


def band_estimate(score: int, module: str = "academic") -> float | None:
    """Return the IELTS Reading band for a 0–40 raw score, or None when the
    score is below the published table (under 4). Academic only in Phase 1
    — General Training has a different (and stricter) table and is gated
    by the `module` arg for future extension.
    """
    if module != "academic":
        # General Training table is Phase B (per Sprint 20.5 commission).
        # Fall back to None so the API surfaces the gap explicitly rather
        # than silently mis-estimating with the Academic table.
        return None
    for threshold, band in _BAND_MAP_ACADEMIC:
        if score >= threshold:
            return band
    return None


# ── Diagnostic rollups ────────────────────────────────────────────────


def rollup_skill_breakdown(
    per_question_results: list[dict[str, Any]],
) -> dict[str, dict[str, int]]:
    """Aggregate per-question results by skill_tag (D2 enum). Output:

        {"skimming":  {"correct": 3, "total": 4},
         "inference": {"correct": 2, "total": 5}, ...}

    Questions without a skill_tag contribute nothing — the schema (mig 086)
    requires skill_tag NOT NULL, so this branch is a defensive guard.
    Consumed by the Sprint 20.7 diagnostic engine; emitted as a column on
    reading_test_attempts.skill_breakdown JSONB.
    """
    out: dict[str, dict[str, int]] = {}
    for row in per_question_results:
        tag = row.get("skill_tag")
        if not tag:
            continue
        slot = out.setdefault(tag, {"correct": 0, "total": 0})
        slot["total"] += 1
        if row.get("correct"):
            slot["correct"] += 1
    return out


def by_part_breakdown(
    per_question_results: list[dict[str, Any]],
) -> dict[str, dict[str, int]]:
    """Group per-question results by passage_order (1..3 = p1/p2/p3).

    Reading uses each answer-key row's stamped `passage_order` rather than
    a q_num range, so non-standard splits (e.g. a 14/13/13 distribution
    instead of the 13/13/14 Cambridge default) still roll up correctly.
    Returns ``{"p1": {"correct": N, "total": M}, ...}`` for whatever parts
    actually appear in the answer key.
    """
    out: dict[str, dict[str, int]] = {}
    for row in per_question_results:
        order = row.get("passage_order")
        if not isinstance(order, int) or order < 1:
            continue
        key = f"p{order}"
        slot = out.setdefault(key, {"correct": 0, "total": 0})
        slot["total"] += 1
        if row.get("correct"):
            slot["correct"] += 1
    return out


# ── Per-answer-key extraction (mirrors listening's collect_answer_key) ─


def collect_answer_key(
    question_rows: list[dict[str, Any]],
    passage_order_by_id: dict[str, int] | None = None,
) -> list[dict[str, Any]]:
    """Project reading_questions rows into the flat answer-key shape the
    grader consumes: ``{q_num, question_type, answer, alternatives,
    skill_tag, explanation, passage_order}``.

    The `passage_order_by_id` map lets the router stamp each question with
    its passage's `passage_order` so by_part_breakdown groups correctly
    (reading_questions rows don't carry passage_order themselves — only a
    passage_id FK). When the map is omitted, passage_order is left None
    and per-part rollup is skipped for that row.

    Sprint 20.14b — `question_type` is now propagated so grade_attempt
    can branch on it for type-specific semantics. mcq_multi requires
    set-equality (all-or-nothing, no extras), distinct from the default
    candidate-set "any match wins" used for other types whose answer
    happens to be a list. Other Phase B types reuse the existing letter/
    text matching paths.
    """
    out: list[dict[str, Any]] = []
    for row in question_rows:
        q_num = row.get("q_num")
        if not isinstance(q_num, int):
            continue
        answer_blob = row.get("answer") or {}
        out.append({
            "q_num":         q_num,
            "question_type": row.get("question_type"),
            "answer":        answer_blob.get("answer"),
            "alternatives": list(answer_blob.get("alternatives") or []),
            "skill_tag":     row.get("skill_tag"),
            "explanation":   row.get("explanation"),
            "passage_order": (passage_order_by_id or {}).get(row.get("passage_id")),
        })
    return out


# ── Top-level grading ─────────────────────────────────────────────────


def grade_attempt(
    user_answers: list[dict[str, Any]],
    answer_key:   list[dict[str, Any]],
    module:       str = "academic",
) -> dict[str, Any]:
    """Grade a complete L3 attempt.

    Args:
        user_answers: list of ``{q_num, user_answer, ...}`` (extras ignored).
        answer_key:   list of ``{q_num, answer, alternatives, skill_tag,
                       explanation, passage_order}`` rows assembled from the
                       test's reading_questions (use ``collect_answer_key``).
        module:       'academic' (default) — General Training is Phase B.

    Returns:
        ``{score, max_score, band_estimate, per_question, skill_breakdown,
        by_part}``. ``per_question`` is sorted by q_num ascending, one row
        per answer-key entry. Missing user answers count as incorrect.

    Answer matching reuses listening's `answer_matches` (case-insensitive,
    trim, whitespace-collapse, UK/US spelling pair normalisation, no
    contractions). The schema stores answer as a JSONB blob — `answer.answer`
    may be a string OR a string list (for `mcq_multi` Phase B), which this
    function tolerates by treating list answers as candidate sets.
    """
    user_by_q = {ua.get("q_num"): ua for ua in user_answers if isinstance(ua.get("q_num"), int)}
    per_question: list[dict[str, Any]] = []

    for ak in sorted(answer_key, key=lambda r: r.get("q_num") or 0):
        q_num = ak.get("q_num")
        if not isinstance(q_num, int):
            continue
        primary = ak.get("answer")
        alternatives = ak.get("alternatives") or []
        candidates = primary if isinstance(primary, list) else [primary]
        candidates = [c for c in candidates if c is not None]

        ua_row = user_by_q.get(q_num) or {}
        user_answer = ua_row.get("user_answer")
        qtype = ak.get("question_type")

        # Sprint 20.14b — mcq_multi uses set-equality, not the default
        # "any candidate matches" semantics. The user picks N checkboxes;
        # all N must be in the answer set, no extras (IELTS marking guide
        # default — partial credit is not a recognised IELTS variant for
        # this format). The frontend serialises the chosen labels as a
        # comma-separated string (e.g. "A,C" or "A, C"), which we split
        # and trim before comparing.
        if qtype == "mcq_multi" and isinstance(primary, list):
            # Build the canonical expected set (normalised single letters
            # or labels). Use the listening grader's normalize_answer so
            # the comparison is case/whitespace-insensitive and respects
            # the existing diacritic + UK/US rules. (Mục 33/B7: import hoisted
            # to module top — no circular dep; answer_matches already imported there.)
            expected_norm = {normalize_answer(str(c)) for c in candidates}
            expected_norm.discard("")
            user_str = str(user_answer or "")
            user_parts = [p for p in user_str.replace(";", ",").split(",")]
            user_norm = {normalize_answer(p) for p in user_parts}
            user_norm.discard("")
            is_correct = bool(expected_norm) and user_norm == expected_norm
        else:
            is_correct = any(
                answer_matches(user_answer, str(c), alternatives) for c in candidates
            )

        expected_display = ", ".join(str(c) for c in candidates) if candidates else ""
        per_question.append({
            "q_num":         q_num,
            "correct":       is_correct,
            "user_answer":   user_answer or "",
            "expected":      expected_display,
            "alternatives":  alternatives,
            "skill_tag":     ak.get("skill_tag"),
            "explanation":   ak.get("explanation"),
            "passage_order": ak.get("passage_order"),
        })

    score = sum(1 for r in per_question if r["correct"])
    return {
        "score":           score,
        "max_score":       len(per_question),
        "band_estimate":   band_estimate(score, module=module),
        "per_question":    per_question,
        "skill_breakdown": rollup_skill_breakdown(per_question),
        "by_part":         by_part_breakdown(per_question),
    }
