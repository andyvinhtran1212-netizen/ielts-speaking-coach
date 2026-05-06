"""writing_history.py — aggregate recurring error patterns, band
trajectory, and sentence-structure history from a student's last N
graded essays so the writing grader prompt can give history-aware
feedback.

Three aggregators, one threshold:

  Phase 1.5a — get_recurring_patterns(student_id)
      Counter over mistakeAnalysis[].mistakeType across last 5 essays.

  Phase 1.5b — get_band_trajectory(student_id)
      Numeric trends over overall_band_score + per-criterion bands
      across last 5 essays. Backend computes deterministic averages
      and ±0.25-band trend classification; Gemini wraps the data in
      Vietnamese narrative (current_band / trend_explanation /
      next_target) at grade time.

  Phase 1.5c — get_sentence_structure_history(student_id)
      Mines mistakeAnalysis[] for sentence-structure-flavoured
      mistakes across last 5 essays. Returns top recurring SS
      patterns + a heuristic complexity indicator. Gemini then
      emits `sentenceStructureFocus` — Vietnamese summary +
      current-essay observation + ONE focus theme for the week.
      Uses a NEW top-level field (not overloading the existing
      level-4/5 `sentenceStructureAnalysis` shape) so the L4/L5
      system prompts and Word exporter keep working unchanged.

Design choice: pre-aggregate backend-side rather than dump raw essays
into the prompt.  Cheaper + reusable — counter-style summary +
trajectory dict fit in ~500 prompt tokens regardless of essay length.

Threshold: <5 graded essays ⇒ no aggregation (return None). The
matching grader path then leaves `feedback_json.recurringPatterns`,
`feedback_json.bandTrajectoryAnalysis`, and
`feedback_json.sentenceStructureFocus` all null, preserving
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


# ── Phase 1.5c: sentence-structure aggregator + focus theme ───────────
#
# We mine `mistakeAnalysis[]` for sentence-structure-flavoured mistakes
# rather than introducing a new column. Gemini emits varied criterion
# strings — "Coherence and Cohesion", "Grammatical Range and Accuracy",
# even "Sentence Structure" directly — so the heuristic checks both
# `mistakeType` and `criterion` against keyword sets in EN + VI.

# Substring matches (case-insensitive) on `mistakeType`. Vietnamese
# triggers are included because Gemini occasionally labels mistakeType
# with VN phrasing on Vietnamese-essay grading runs.
_SENTENCE_STRUCTURE_MISTAKE_KEYWORDS: tuple[str, ...] = (
    "sentence structure", "run-on", "run on", "comma splice", "fragment",
    "subordination", "complex sentence", "compound sentence",
    "main verb", "missing verb", "missing subject", "sentence boundary",
    "câu", "cấu trúc câu", "câu phức", "câu đơn", "câu ghép",
    "thiếu động từ", "không có động từ", "thiếu chủ ngữ",
)

# Substring matches on `criterion`. Used as a fallback when mistakeType
# doesn't include any of the structural keywords above. We deliberately
# don't fire on bare "Grammatical Range and Accuracy" — that criterion
# also covers tense, articles, agreement, etc. — but if the criterion
# is literally "Sentence Structure" we treat it as a SS mistake.
_SENTENCE_STRUCTURE_CRITERION_KEYWORDS: tuple[str, ...] = (
    "sentence structure",
)

# How many SS issues per sentence indicate "needs simpler structures
# first" vs "ready for more complex structures". Tuned conservatively:
# 0.30 SS-mistakes / sentence is roughly "every third sentence has a
# structural problem" — a strong signal to slow down and fix
# fundamentals; 0.10 ("every tenth sentence") means structure is solid
# and we can push toward variety.
_COMPLEXITY_HIGH_DENSITY = 0.30
_COMPLEXITY_LOW_DENSITY  = 0.10

# Top-N issues we surface to Gemini. Three is enough to anchor the
# focus theme without bloating the prompt.
_TOP_SS_ISSUES_FOR_PROMPT = 3

# Cap example length so a runaway long sentence can't blow up the
# prompt. 80 chars matches the recurring-patterns examples cap.
_MAX_SS_EXAMPLE_CHARS = 80


def _is_sentence_structure_mistake(mistake: dict) -> bool:
    """True if the mistake looks structural (run-on / fragment / missing
    subject-or-verb / SS-criterion-tagged). Heuristic — Gemini's labels
    are inconsistent so we check both mistakeType and criterion."""
    if not isinstance(mistake, dict):
        return False
    m_type = (mistake.get("mistakeType") or "").lower()
    for kw in _SENTENCE_STRUCTURE_MISTAKE_KEYWORDS:
        if kw in m_type:
            return True
    criterion = (mistake.get("criterion") or "").lower()
    for kw in _SENTENCE_STRUCTURE_CRITERION_KEYWORDS:
        if kw in criterion:
            return True
    return False


def _truncate_example(text: str) -> str:
    """Trim a quoted example to `_MAX_SS_EXAMPLE_CHARS` chars with an
    ellipsis. Keeps prompt token budget predictable."""
    text = text.strip()
    if len(text) <= _MAX_SS_EXAMPLE_CHARS:
        return text
    return text[: _MAX_SS_EXAMPLE_CHARS - 3] + "..."


def _classify_complexity(ss_density_per_essay: list[float]) -> str:
    """Map per-essay SS-density numbers to a Vietnamese-tier indicator.

    Returns one of:
      • "needs_more_simple"  — high SS density; fix run-ons/fragments first
      • "needs_more_complex" — low SS density; ready to push for variety
      • "balanced"           — middle ground (or no signal)
    """
    if not ss_density_per_essay:
        return "balanced"
    avg = sum(ss_density_per_essay) / len(ss_density_per_essay)
    if avg >= _COMPLEXITY_HIGH_DENSITY:
        return "needs_more_simple"
    if avg <= _COMPLEXITY_LOW_DENSITY:
        return "needs_more_complex"
    return "balanced"


def get_sentence_structure_history(student_id: str) -> dict | None:
    """Aggregate sentence-structure mistakes from a student's last
    `HISTORY_WINDOW` graded essays.

    Returns:
        None when the student has fewer than `MIN_HISTORY_ESSAYS`
        graded essays (or any DB error).

        Otherwise a dict::

            {
                "common_issues": [
                    {"pattern": str, "count": int, "examples": [str]}
                ],   # sorted by count DESC, count ≥ RECURRENCE_FLOOR,
                     # capped at _TOP_SS_ISSUES_FOR_PROMPT
                "complexity_indicator":
                    "needs_more_simple" | "balanced" | "needs_more_complex",
                "essays_analyzed": int,
            }

    Note on shape: this dict is the deterministic numeric-ish ground
    truth (counts + heuristic complexity). The Vietnamese narrative
    fields (`summary`, `current_essay_observation`, `focus_theme`)
    are NOT populated here — Gemini emits them in
    `feedback_json.sentenceStructureFocus` using the prompt's
    instructions (see `format_history_for_prompt`).
    """
    try:
        result = (
            supabase_admin.table("writing_feedback")
            .select(
                "feedback_json, "
                "writing_essays!inner(student_id, essay_text)"
            )
            .eq("writing_essays.student_id", student_id)
            .order("created_at", desc=True)
            .limit(HISTORY_WINDOW)
            .execute()
        )
        rows = result.data or []
    except Exception as e:
        logger.warning(
            "writing_history sentence_structure db_error student=%s: %s "
            "— degrading to None",
            student_id, e,
        )
        return None

    if len(rows) < MIN_HISTORY_ESSAYS:
        logger.info(
            "writing_history sentence_structure skip student=%s "
            "essays=%d min=%d",
            student_id, len(rows), MIN_HISTORY_ESSAYS,
        )
        return None

    pattern_counts:   dict[str, int]       = {}
    pattern_examples: dict[str, list[str]] = {}
    ss_density_per_essay: list[float]      = []

    for row in rows:
        fj = row.get("feedback_json") or {}
        if not isinstance(fj, dict):
            continue
        mistakes = fj.get("mistakeAnalysis") or []
        ss_mistakes = [m for m in mistakes if _is_sentence_structure_mistake(m)]

        for m in ss_mistakes:
            pattern = (m.get("mistakeType") or "Sentence structure issue").strip()
            if not pattern:
                pattern = "Sentence structure issue"
            pattern_counts[pattern] = pattern_counts.get(pattern, 0) + 1

            original = (m.get("original") or "").strip()
            if original:
                bucket = pattern_examples.setdefault(pattern, [])
                truncated = _truncate_example(original)
                if truncated not in bucket and len(bucket) < 2:
                    bucket.append(truncated)

        # Density per essay = SS-mistake-count / sentence-count, where
        # sentence-count comes from the essay text terminator characters.
        # Pulled from writing_essays via the inner join above (not from
        # feedback_json — Gemini doesn't always echo the original essay
        # back).
        essay_join = row.get("writing_essays") or {}
        if isinstance(essay_join, list):
            essay_join = essay_join[0] if essay_join else {}
        essay_text = (essay_join.get("essay_text") or "") if isinstance(essay_join, dict) else ""
        sentence_count = max(
            1,
            essay_text.count(".") + essay_text.count("!") + essay_text.count("?"),
        )
        ss_density_per_essay.append(len(ss_mistakes) / sentence_count)

    common_issues: list[dict] = []
    for pattern, count in sorted(pattern_counts.items(), key=lambda x: -x[1]):
        if count < RECURRENCE_FLOOR:
            continue
        common_issues.append({
            "pattern":  pattern,
            "count":    count,
            "examples": pattern_examples.get(pattern, []),
        })
        if len(common_issues) >= _TOP_SS_ISSUES_FOR_PROMPT:
            break

    return {
        "common_issues":        common_issues,
        "complexity_indicator": _classify_complexity(ss_density_per_essay),
        "essays_analyzed":      len(rows),
    }


def format_history_for_prompt(
    patterns: dict | None,
    trajectory: dict | None = None,
    sentence_structure: dict | None = None,
) -> str:
    """Format Phase 1.5a recurring-patterns, Phase 1.5b
    band-trajectory, and Phase 1.5c sentence-structure-history
    aggregates into a single Vietnamese prompt section.

    Empty inputs (all three None or empty) ⇒ empty string, so the
    grader's `_build_user_prompt` can unconditionally include the
    return value without polluting the prompt for new students.

    The composed block instructs Gemini to populate up to three
    output fields:

      • `recurringPatterns` ({summary, improvements, stillRecurring})
        — the Phase 1.5a contract.

      • `bandTrajectoryAnalysis` ({current_band, average_last_5,
        trend, trend_explanation, criteria_breakdown, next_target})
        — Phase 1.5b. `average_last_5`, `trend`, and
        `criteria_breakdown` are copy-from-data; `current_band`,
        `trend_explanation`, `next_target` are Gemini-authored
        Vietnamese narrative.

      • `sentenceStructureFocus` ({summary, common_issues,
        complexity_indicator, current_essay_observation,
        focus_theme}) — Phase 1.5c. `common_issues` and
        `complexity_indicator` are copy-from-data; `summary`,
        `current_essay_observation`, and `focus_theme`
        ({title, why, this_week_practice}) are Gemini-authored
        Vietnamese narrative.
    """
    has_patterns   = bool(patterns   and patterns.get("patterns"))
    has_trajectory = bool(trajectory)
    has_ss         = bool(sentence_structure)
    if not has_patterns and not has_trajectory and not has_ss:
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

    if has_ss:
        lines.extend([
            "### Phân tích cấu trúc câu (lịch sử)",
            "",
            f"- Mức độ phức tạp hiện tại: **{sentence_structure['complexity_indicator']}**",
        ])
        ss_issues = sentence_structure.get("common_issues") or []
        if ss_issues:
            lines.append("- Lỗi cấu trúc câu LẶP LẠI:")
            for issue in ss_issues:
                examples = issue.get("examples") or []
                ex_str = "; ".join(f'"{e}"' for e in examples[:2]) or "(no examples)"
                lines.append(
                    f"  - **{issue['pattern']}** ({issue['count']}x): {ex_str}"
                )
        else:
            lines.append("- Chưa có pattern cấu trúc câu nào lặp lại đáng kể.")
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

    if has_ss:
        lines.extend([
            "Output `sentenceStructureFocus` — copy `common_issues` "
            "và `complexity_indicator` từ data ở trên; tự sinh "
            "`summary` (Vietnamese 1-2 câu overview cấu trúc câu của "
            "em qua 5 bài), `current_essay_observation` (Vietnamese "
            "1-2 câu nhận xét cấu trúc câu BÀI NÀY cụ thể), và "
            "`focus_theme` (đúng MỘT theme cho học viên luyện tuần "
            "này — chọn dựa trên common_issues + complexity_indicator "
            "+ bài hiện tại):",
            "```json",
            '"sentenceStructureFocus": {',
            '  "summary":                   "Vietnamese 1-2 câu overview",',
            '  "common_issues":             [<copy array — pattern, count, examples>],',
            '  "complexity_indicator":      "<copy: needs_more_simple | balanced | needs_more_complex>",',
            '  "current_essay_observation": "Vietnamese nhận xét bài này",',
            '  "focus_theme": {',
            '    "title":              "Tên focus theme tuần này (vd \\"Mệnh đề quan hệ với which/who\\")",',
            '    "why":                "Vietnamese: tại sao chọn theme này dựa trên history",',
            '    "this_week_practice": "Vietnamese: 1-2 câu hoạt động luyện tập cụ thể"',
            '  }',
            "}",
            "```",
            "Hướng dẫn chọn focus_theme:",
            "- ĐÚNG MỘT theme — không list nhiều.",
            "- Nếu `complexity_indicator = needs_more_simple`, ưu tiên "
            "fix run-on / fragment / missing-verb trước khi push complex structures.",
            "- Nếu `needs_more_complex`, suggest cấu trúc nâng cao "
            "(relative clauses, conditionals, inversion, cleft, …).",
            "- `this_week_practice` phải CỤ THỂ + actionable — vd "
            '"Viết 5 câu dùng \\"which/who\\" để mô tả ý kiến trong '
            'bài Task 2 tiếp theo", không phải "luyện tập câu phức".',
            "",
        ])

    return "\n".join(lines)
