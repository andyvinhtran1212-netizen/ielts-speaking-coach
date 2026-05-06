"""writing_history.py — aggregate recurring error patterns + band
trajectory from a student's last N graded essays so the writing
grader prompt can give history-aware feedback.

Two aggregators, one threshold:

  Phase 1.5a — get_recurring_patterns(student_id)
      Counter over mistakeAnalysis[].mistakeType across last 5 essays.

  Phase 1.5b — get_band_trajectory(student_id)
      Numeric trends over overall_band_score + per-criterion bands
      across last 5 essays. Backend computes deterministic averages
      and ±0.25-band trend classification; Gemini wraps the data in
      Vietnamese narrative (current_band / trend_explanation /
      next_target) at grade time.

Design choice: pre-aggregate backend-side rather than dump raw essays
into the prompt.  Cheaper + reusable — counter-style summary +
trajectory dict fit in ~500 prompt tokens regardless of essay length.

Threshold: <5 graded essays ⇒ no aggregation (return None). The
matching grader path then leaves `feedback_json.recurringPatterns`
+ `feedback_json.bandTrajectoryAnalysis` both null, preserving
Phase-1 baseline behaviour for new students.

Defensive: any DB error returns None so a transient blip degrades
to plain grading rather than failing the whole grade.
"""

from __future__ import annotations

import logging
from collections import Counter

from database import supabase_admin

logger = logging.getLogger(__name__)

# Minimum graded essays required before history-aware analysis activates.
MIN_HISTORY_ESSAYS = 5
# Rolling window — last N essays only. Larger windows risk surfacing
# already-fixed mistakes; smaller windows are too noisy.
HISTORY_WINDOW = 5
# A mistakeType must repeat at least this many times across the window
# to count as "recurring".  Single-incident errors are noise.
RECURRENCE_FLOOR = 2
# Cap how many examples we keep per mistake type — three is enough for
# Gemini to recognise the shape without bloating the prompt.
MAX_EXAMPLES_PER_TYPE = 3
# Prompt-side cap — only the top N recurring patterns reach Gemini.
TOP_PATTERNS_FOR_PROMPT = 5

# Phase 1.5b — band trajectory thresholds (IELTS 0-9 band scale).
# A ±0.25-band swing is the smallest meaningful change — half-band
# steps (0.5) are the IELTS reporting unit, so 0.25 catches early
# directional movement before it crystallises into a half-band shift.
_TREND_IMPROVE_THRESHOLD =  0.25
_TREND_DECLINE_THRESHOLD = -0.25

# (writing_feedback column → display name) pairs for the per-criterion
# breakdown. Ordering here drives the order Gemini sees in the prompt
# AND the order the frontend renders, so keep it canonical (Task
# Response → Coherence → Lexical → Grammar).
_CRITERION_COLUMNS: list[tuple[str, str]] = [
    ("band_main_criterion",      "Task Response"),
    ("band_coherence_cohesion",  "Coherence and Cohesion"),
    ("band_lexical_resource",    "Lexical Resource"),
    ("band_grammatical_range",   "Grammatical Range and Accuracy"),
]


def _classify_trend(delta: float) -> str:
    """Classify a band delta as improving / stable / declining.

    The thresholds are symmetric (±0.25). Anything inside the band
    is "stable" — small fluctuations between essays are noise, not
    direction, and labelling them as direction would mislead.
    """
    if delta >=  _TREND_IMPROVE_THRESHOLD:
        return "improving"
    if delta <=  _TREND_DECLINE_THRESHOLD:
        return "declining"
    return "stable"


def get_recurring_patterns(student_id: str) -> dict | None:
    """Aggregate recurring grammar/lexical errors from a student's last
    `HISTORY_WINDOW` graded essays.

    Returns:
        None when the student has fewer than `MIN_HISTORY_ESSAYS`
        graded essays (or any DB error).

        Otherwise a dict::

            {
                "essays_analyzed": int,
                "patterns": [
                    {
                        "mistakeType": str,
                        "count":       int,
                        "examples":    [str],   # ≤ MAX_EXAMPLES_PER_TYPE
                        "criterion":   str,
                    },
                    ...
                ]
            }

        `patterns` is sorted by count DESC and filtered to entries with
        count ≥ `RECURRENCE_FLOOR`.
    """
    try:
        result = (
            supabase_admin.table("writing_feedback")
            .select(
                "feedback_json, essay_id, "
                "writing_essays!inner(student_id)"
            )
            .eq("writing_essays.student_id", student_id)
            .order("created_at", desc=True)
            .limit(HISTORY_WINDOW)
            .execute()
        )
        rows = result.data or []
    except Exception as e:
        # Any DB error: degrade to None so grading still proceeds.
        logger.warning(
            "writing_history db_error student=%s: %s — degrading to None",
            student_id, e,
        )
        return None

    if len(rows) < MIN_HISTORY_ESSAYS:
        logger.info(
            "writing_history skip student=%s essays=%d min=%d",
            student_id, len(rows), MIN_HISTORY_ESSAYS,
        )
        return None

    # Counter aggregates by mistakeType across the window. We track the
    # first-seen criterion + up to MAX_EXAMPLES_PER_TYPE distinct
    # `original` strings per type so the prompt can show concrete shapes.
    mistake_counter: Counter[str] = Counter()
    examples_by_type: dict[str, list[str]] = {}
    criterion_by_type: dict[str, str] = {}

    for row in rows:
        feedback = row.get("feedback_json") or {}
        if not isinstance(feedback, dict):
            continue
        for m in feedback.get("mistakeAnalysis") or []:
            if not isinstance(m, dict):
                continue
            mtype = (m.get("mistakeType") or "Unknown").strip() or "Unknown"
            mistake_counter[mtype] += 1

            original = (m.get("original") or "").strip()
            if original:
                bucket = examples_by_type.setdefault(mtype, [])
                if (
                    original not in bucket
                    and len(bucket) < MAX_EXAMPLES_PER_TYPE
                ):
                    bucket.append(original)

            if mtype not in criterion_by_type:
                criterion_by_type[mtype] = (m.get("criterion") or "").strip()

    recurring = [
        {
            "mistakeType": mtype,
            "count":       count,
            "examples":    examples_by_type.get(mtype, []),
            "criterion":   criterion_by_type.get(mtype, ""),
        }
        for mtype, count in mistake_counter.most_common()
        if count >= RECURRENCE_FLOOR
    ]

    return {
        "essays_analyzed": len(rows),
        "patterns":        recurring,
    }


def get_band_trajectory(student_id: str) -> dict | None:
    """Aggregate band trends across a student's last `HISTORY_WINDOW`
    graded essays.

    Returns:
        None when the student has fewer than `MIN_HISTORY_ESSAYS`
        graded essays (or any DB error).

        Otherwise a dict::

            {
                "essays_analyzed": int,
                "average_last_5":  float,    # mean overall_band_score
                "trend":           str,      # improving / stable / declining
                "trend_delta":     float,    # newest_two_avg - oldest_two_avg
                "criteria_breakdown": [
                    {"criterion": str, "average": float, "trend": str},
                    ...
                ]
            }

    Note on shape: this dict is the deterministic numeric ground
    truth. The Vietnamese narrative fields (`current_band`,
    `trend_explanation`, `next_target`) are NOT populated here —
    Gemini emits them in `feedback_json.bandTrajectoryAnalysis`
    using the prompt's instructions (see `format_history_for_prompt`).
    Keeping numeric and narrative concerns split lets us re-aggregate
    without retouching prompts and re-prompt without retouching SQL.
    """
    try:
        result = (
            supabase_admin.table("writing_feedback")
            .select(
                "overall_band_score, "
                "band_main_criterion, band_coherence_cohesion, "
                "band_lexical_resource, band_grammatical_range, "
                "created_at, "
                "writing_essays!inner(student_id)"
            )
            .eq("writing_essays.student_id", student_id)
            .order("created_at", desc=True)
            .limit(HISTORY_WINDOW)
            .execute()
        )
        rows = result.data or []
    except Exception as e:
        logger.warning(
            "writing_history band_trajectory db_error student=%s: %s — "
            "degrading to None",
            student_id, e,
        )
        return None

    if len(rows) < MIN_HISTORY_ESSAYS:
        logger.info(
            "writing_history band_trajectory skip student=%s essays=%d min=%d",
            student_id, len(rows), MIN_HISTORY_ESSAYS,
        )
        return None

    # Rows arrive sorted DESC (newest first). Pull overall bands as
    # floats — defensively skip rows where overall_band_score is
    # missing (shouldn't happen for graded rows but a stale partial
    # write must not crash the aggregator).
    overall_bands: list[float] = []
    for r in rows:
        v = r.get("overall_band_score")
        if v is None:
            continue
        try:
            overall_bands.append(float(v))
        except (TypeError, ValueError):
            continue
    if not overall_bands:
        # Pathological: 5+ rows but every overall_band_score is NULL.
        # Treat as no-trajectory rather than divide-by-zero.
        return None

    avg_overall = round(sum(overall_bands) / len(overall_bands), 2)

    # Trend = newest-2 mean − oldest-2 mean. Two-point smoothing on each
    # end damps the noise of any single anomalous essay; with only 5
    # rows we'd otherwise be one bad essay away from a misleading label.
    newest = overall_bands[: min(2, len(overall_bands))]
    oldest = overall_bands[-min(2, len(overall_bands)):]
    trend_delta = round(
        (sum(newest) / len(newest)) - (sum(oldest) / len(oldest)),
        2,
    )
    trend = _classify_trend(trend_delta)

    # Per-criterion breakdown using the same two-point smoothing. Each
    # criterion is independent so a student can be improving overall
    # but flat on Lexical, etc. — that's signal, surface it.
    criteria_breakdown: list[dict] = []
    for col, display_name in _CRITERION_COLUMNS:
        values: list[float] = []
        for r in rows:
            v = r.get(col)
            if v is None:
                continue
            try:
                values.append(float(v))
            except (TypeError, ValueError):
                continue
        if not values:
            continue

        crit_avg = round(sum(values) / len(values), 2)
        crit_newest = values[: min(2, len(values))]
        crit_oldest = values[-min(2, len(values)):]
        crit_delta = (
            sum(crit_newest) / len(crit_newest)
        ) - (
            sum(crit_oldest) / len(crit_oldest)
        )
        criteria_breakdown.append({
            "criterion": display_name,
            "average":   crit_avg,
            "trend":     _classify_trend(crit_delta),
        })

    return {
        "essays_analyzed":    len(rows),
        "average_last_5":     avg_overall,
        "trend":              trend,
        "trend_delta":        trend_delta,
        "criteria_breakdown": criteria_breakdown,
    }


def format_history_for_prompt(
    patterns: dict | None,
    trajectory: dict | None = None,
) -> str:
    """Format both Phase 1.5a recurring-patterns and Phase 1.5b
    band-trajectory aggregates into a single Vietnamese prompt
    section.

    Empty inputs (both None or both empty) ⇒ empty string, so the
    grader's `_build_user_prompt` can unconditionally include the
    return value without polluting the prompt for new students.

    The composed block instructs Gemini to populate two output
    fields:

      • `recurringPatterns` ({summary, improvements, stillRecurring})
        — the Phase 1.5a contract.

      • `bandTrajectoryAnalysis` ({current_band, average_last_5,
        trend, trend_explanation, criteria_breakdown, next_target})
        — Phase 1.5b. `average_last_5`, `trend`, and
        `criteria_breakdown` are copy-from-data; `current_band`,
        `trend_explanation`, `next_target` are Gemini-authored
        Vietnamese narrative.
    """
    has_patterns   = bool(patterns   and patterns.get("patterns"))
    has_trajectory = bool(trajectory)
    if not has_patterns and not has_trajectory:
        return ""

    lines: list[str] = [
        "## Lịch sử của học viên này (5 bài gần nhất)",
        "",
    ]

    if has_patterns:
        top = patterns["patterns"][:TOP_PATTERNS_FOR_PROMPT]
        lines.extend([
            "### Lỗi LẶP LẠI",
            "",
        ])
        for p in top:
            examples = p.get("examples") or []
            ex_str = ", ".join(f'"{e}"' for e in examples[:2]) or "(no examples)"
            lines.append(f'- **{p["mistakeType"]}** ({p["count"]}x): {ex_str}')
        lines.append("")

    if has_trajectory:
        lines.extend([
            "### Diễn biến band điểm",
            "",
            f"- Band trung bình 5 bài gần nhất: **{trajectory['average_last_5']}**",
            f"- Xu hướng: **{trajectory['trend']}** "
            f"(delta: {trajectory['trend_delta']:+.2f})",
        ])
        breakdown = trajectory.get("criteria_breakdown") or []
        if breakdown:
            lines.append("- Chi tiết theo tiêu chí:")
            for c in breakdown:
                # Sprint 1.5b.1 — use the canonical key name "average" in
                # the narrative line. Phase 1.5b shipped with "avg" here as
                # a readability shorthand; Gemini saw the visible label and
                # emitted `{"avg": N.N}` instead of `{"average": N.N}` per
                # the schema's contract. The frontend renderer reads
                # `c.average`, so the cell rendered as "avg —". Aligning
                # the narrative to the canonical key removes the prime.
                lines.append(
                    f"  - {c['criterion']}: average {c['average']}, trend {c['trend']}"
                )
        lines.append("")

    # ── Output schema instructions ────────────────────────────────
    # We list only the fields Gemini is responsible for emitting; the
    # full WritingFeedback schema lives in
    # backend/prompts/writing/v1/shared/output_schema_instructions.md
    # which the system prompt already pins.
    lines.extend([
        "**Yêu cầu khi grade bài này:**",
        "",
    ])

    if has_patterns:
        lines.extend([
            "1. Kiểm tra xem các lỗi LẶP LẠI trên có còn xuất hiện trong bài này không.",
            '2. Nếu cải thiện, ghi nhận trong `recurringPatterns.improvements`.',
            '3. Nếu vẫn còn, ghi vào `recurringPatterns.stillRecurring`.',
            "",
            "Output `recurringPatterns`:",
            "```json",
            '"recurringPatterns": {',
            '  "summary":        "Vietnamese 1-2 sentence overview",',
            '  "improvements":   ["lỗi đã sửa được"],',
            '  "stillRecurring": ["lỗi vẫn còn"]',
            "}",
            "```",
            "",
        ])

    if has_trajectory:
        lines.extend([
            "Output `bandTrajectoryAnalysis` — copy `average_last_5`, "
            "`trend`, và `criteria_breakdown` từ data ở trên; tự sinh "
            "`current_band` (= band của bài này), `trend_explanation` "
            "(Vietnamese 1-2 câu mang tính encouraging + cụ thể số "
            'liệu, vd "Em đã tiến từ band 6.0 lên band 6.5..."), và '
            "`next_target` (Vietnamese, thực tế — không quá tham vọng):",
            "```json",
            '"bandTrajectoryAnalysis": {',
            '  "current_band":         <band của bài này>,',
            '  "average_last_5":       <copy from data>,',
            '  "trend":                "<copy: improving / stable / declining>",',
            '  "trend_explanation":    "Vietnamese narrative",',
            '  "criteria_breakdown":   [',
            '    {"criterion": "<name>", "average": <number>, "trend": "<improving/stable/declining>"}',
            '  ],',
            '  "next_target":          "Vietnamese gợi ý mục tiêu band tiếp theo"',
            "}",
            "```",
            'Lưu ý: trong `criteria_breakdown`, dùng key `"average"` '
            '(không phải `"avg"`).',
            "",
        ])

    return "\n".join(lines)
