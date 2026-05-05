"""writing_history.py — aggregate recurring error patterns from a
student's last N graded essays so the writing grader prompt can give
history-aware feedback (Phase 1.5a).

Design choice: pre-aggregate backend-side rather than dump raw essays
into the prompt.  Cheaper + reusable: counter-style summary fits in
~300 prompt tokens regardless of essay length, and the same aggregate
can later feed bandTrajectoryAnalysis (Phase 1.5b) without a re-query.

Threshold: <5 graded essays ⇒ no aggregation (return None). The
matching grader path then leaves `feedback_json.recurringPatterns`
null, which is the established Phase-1 behaviour.

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


def format_history_for_prompt(patterns: dict | None) -> str:
    """Format the aggregator output into a Vietnamese prompt section.

    Empty input ⇒ empty string (so the grader's `_build_user_prompt`
    can unconditionally include it; an empty string adds no tokens
    after the join).

    The block instructs Gemini to (a) check whether each recurring
    error still appears in the new essay, (b) call out improvements
    explicitly, and (c) populate `feedback_json.recurringPatterns`
    with `{summary, improvements, stillRecurring}`.
    """
    if not patterns or not patterns.get("patterns"):
        return ""

    top = patterns["patterns"][:TOP_PATTERNS_FOR_PROMPT]
    lines: list[str] = [
        "## Lịch sử lỗi của học viên này (5 bài gần nhất)",
        "",
        "Học viên này có những lỗi LẶP LẠI sau đây trong các bài trước:",
    ]
    for p in top:
        examples = p.get("examples") or []
        ex_str = ", ".join(f'"{e}"' for e in examples[:2]) or "(no examples)"
        lines.append(f'- **{p["mistakeType"]}** ({p["count"]}x): {ex_str}')

    lines.extend([
        "",
        "**Yêu cầu khi grade bài này:**",
        "1. Kiểm tra xem các lỗi LẶP LẠI trên có còn xuất hiện trong bài hiện tại không.",
        '2. Nếu có, ghi rõ trong feedback: "Lỗi X này đã xuất hiện trong các bài trước".',
        '3. Nếu học viên đã sửa được, ghi nhận: "Em đã sửa được lỗi X từ các bài trước, well done".',
        "",
        "Output JSON cần populate field `recurringPatterns` với cấu trúc:",
        "```json",
        '"recurringPatterns": {',
        '  "summary":        "Vietnamese 1-2 sentence overview",',
        '  "improvements":   ["lỗi đã sửa được"],',
        '  "stillRecurring": ["lỗi vẫn còn"]',
        "}",
        "```",
    ])
    return "\n".join(lines)
