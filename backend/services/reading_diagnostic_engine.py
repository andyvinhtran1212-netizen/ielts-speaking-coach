"""Rule-based Reading diagnostic engine (Sprint 20.7).

Consumes submitted L3 attempts (with skill_breakdown JSON) and published L2
skill exercises to produce a learner-facing diagnostic summary:
  • current per-skill accuracy from a selected/latest attempt
  • aggregate accuracy across recent attempts
  • simple trend signal per skill (improving / declining / stable)
  • exact-match L2 recommendations by skill_tag/skill_focus

No AI or fuzzy matching is used here — the Reading module already has a closed
skill_tag taxonomy, so exact-match recommendations are the canonical truth.
"""

from __future__ import annotations

from typing import Any

SKILL_LABELS = {
    "skimming": "Skimming",
    "scanning": "Scanning",
    "detail": "Detail",
    "main_idea": "Main idea",
    "inference": "Inference",
    "vocabulary_in_context": "Vocab in context",
    "reference_cohesion": "Reference / cohesion",
    "writer_view_TFNG": "Writer's view (T/F/NG)",
}

WEAK_THRESHOLD_PCT = 60
WATCH_THRESHOLD_PCT = 75
TREND_DELTA_PCT = 10
MAX_RECOMMENDATIONS_PER_SKILL = 3


def _safe_int(value: Any) -> int:
    try:
        return max(0, int(value))
    except Exception:
        return 0


def _accuracy_pct(correct: int, total: int) -> int:
    if total <= 0:
        return 0
    return round((correct / total) * 100)


def _normalize_skill_breakdown(raw: Any) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    if not isinstance(raw, dict):
        return out
    for skill_tag, row in raw.items():
        if skill_tag not in SKILL_LABELS or not isinstance(row, dict):
            continue
        total = _safe_int(row.get("total"))
        if total <= 0:
            continue
        out[skill_tag] = {
            "correct": min(_safe_int(row.get("correct")), total),
            "total": total,
        }
    return out


def _trend_for(skill_tag: str, attempts: list[dict[str, Any]]) -> dict[str, Any]:
    series: list[dict[str, Any]] = []
    for attempt in attempts:
        row = _normalize_skill_breakdown(attempt.get("skill_breakdown")).get(skill_tag)
        if not row:
            continue
        series.append({
            "attempt_id": attempt.get("id"),
            "submitted_at": attempt.get("submitted_at"),
            "accuracy_pct": _accuracy_pct(row["correct"], row["total"]),
        })

    if len(series) < 2:
        return {
            "direction": "first_attempt",
            "delta_pct": 0,
            "previous_accuracy_pct": None,
            "attempts_seen": len(series),
        }

    current = series[0]["accuracy_pct"]
    previous = series[1]["accuracy_pct"]
    delta = current - previous
    if delta >= TREND_DELTA_PCT:
        direction = "improving"
    elif delta <= -TREND_DELTA_PCT:
        direction = "declining"
    else:
        direction = "stable"
    return {
        "direction": direction,
        "delta_pct": delta,
        "previous_accuracy_pct": previous,
        "attempts_seen": len(series),
    }


def _diagnostic_level(accuracy_pct: int) -> str:
    if accuracy_pct < WEAK_THRESHOLD_PCT:
        return "weak"
    if accuracy_pct < WATCH_THRESHOLD_PCT:
        return "watch"
    return "strong"


def _format_recommendation(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "slug": row.get("slug"),
        "title": row.get("title"),
        "skill_focus": row.get("skill_focus"),
        "difficulty_level": row.get("difficulty_level"),
        "estimated_minutes": row.get("estimated_minutes"),
        "topic_tags": row.get("topic_tags") or [],
    }


def build_reading_diagnostic(
    attempts: list[dict[str, Any]],
    l2_exercises: list[dict[str, Any]],
    *,
    selected_attempt_id: str | None = None,
) -> dict[str, Any]:
    submitted_attempts = [
        a for a in attempts
        if a.get("status") == "submitted" and _normalize_skill_breakdown(a.get("skill_breakdown"))
    ]
    if not submitted_attempts:
        return {
            "selected_attempt_id": selected_attempt_id,
            "attempts_considered": 0,
            "latest_attempt": None,
            "skills": [],
            "focus_skills": [],
            "weak_skill_tags": [],
            "watch_skill_tags": [],
        }

    selected = None
    if selected_attempt_id:
        for attempt in submitted_attempts:
            if attempt.get("id") == selected_attempt_id:
                selected = attempt
                break
    if selected is None:
        selected = submitted_attempts[0]

    selected_breakdown = _normalize_skill_breakdown(selected.get("skill_breakdown"))
    exercise_groups: dict[str, list[dict[str, Any]]] = {}
    for row in l2_exercises:
        skill = row.get("skill_focus")
        if skill not in SKILL_LABELS:
            continue
        exercise_groups.setdefault(skill, []).append(row)

    aggregate: dict[str, dict[str, int]] = {}
    for attempt in submitted_attempts:
        for skill_tag, row in _normalize_skill_breakdown(attempt.get("skill_breakdown")).items():
            bucket = aggregate.setdefault(skill_tag, {"correct": 0, "total": 0})
            bucket["correct"] += row["correct"]
            bucket["total"] += row["total"]

    skills: list[dict[str, Any]] = []
    for skill_tag, current in selected_breakdown.items():
        agg = aggregate.get(skill_tag, {"correct": 0, "total": 0})
        current_pct = _accuracy_pct(current["correct"], current["total"])
        aggregate_pct = _accuracy_pct(agg["correct"], agg["total"])
        level = _diagnostic_level(current_pct)
        recs = exercise_groups.get(skill_tag, [])[:MAX_RECOMMENDATIONS_PER_SKILL]
        skills.append({
            "skill_tag": skill_tag,
            "label": SKILL_LABELS[skill_tag],
            "diagnostic_level": level,
            "current": {
                "correct": current["correct"],
                "total": current["total"],
                "accuracy_pct": current_pct,
            },
            "aggregate": {
                "correct": agg["correct"],
                "total": agg["total"],
                "accuracy_pct": aggregate_pct,
            },
            "trend": _trend_for(skill_tag, submitted_attempts),
            "recommendations": [_format_recommendation(row) for row in recs],
            "recommendation_count": len(recs),
        })

    level_order = {"weak": 0, "watch": 1, "strong": 2}
    skills.sort(key=lambda item: (
        level_order.get(item["diagnostic_level"], 99),
        item["current"]["accuracy_pct"],
        -item["current"]["total"],
        item["label"],
    ))

    focus_skills = [s for s in skills if s["diagnostic_level"] != "strong"][:3]
    weak_skill_tags = [s["skill_tag"] for s in skills if s["diagnostic_level"] == "weak"]
    watch_skill_tags = [s["skill_tag"] for s in skills if s["diagnostic_level"] == "watch"]

    return {
        "selected_attempt_id": selected.get("id"),
        "attempts_considered": len(submitted_attempts),
        "latest_attempt": {
            "attempt_id": selected.get("id"),
            "submitted_at": selected.get("submitted_at"),
            "score": selected.get("score"),
            "band_estimate": selected.get("band_estimate"),
        },
        "skills": skills,
        "focus_skills": focus_skills,
        "weak_skill_tags": weak_skill_tags,
        "watch_skill_tags": watch_skill_tags,
    }
