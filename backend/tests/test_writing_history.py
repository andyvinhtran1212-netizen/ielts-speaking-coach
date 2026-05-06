"""Tests for services.writing_history (Phase 1.5a Phase 1).

Pin the aggregator + prompt formatter against four shapes:

  1. Below threshold (< MIN_HISTORY_ESSAYS) → return None.
  2. ≥ threshold with repeated mistakeType → patterns dict, sorted desc.
  3. One-off mistakes (count == 1) → filtered out (must not pollute prompt).
  4. DB error → return None (degrade gracefully so grading still runs).

Plus two formatter tests:
  5. Empty / None input → "" (so unconditional join in grader is safe).
  6. Populated patterns → Vietnamese block with mistakeType + count
     + examples + the recurringPatterns output schema instruction.

The supabase_admin mock chains exactly the call the service makes:
.table().select().eq().order().limit().execute() — any deviation
should fail the test (real signal that the service started using a
different query shape).
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.writing_history import (
    MIN_HISTORY_ESSAYS,
    _classify_trend,
    format_history_for_prompt,
    get_band_trajectory,
    get_recurring_patterns,
    get_sentence_structure_history,
)


# ── Helpers ──────────────────────────────────────────────────────────


def _mock_db_returning(rows: list[dict] | None = None, *, raises: Exception | None = None):
    """Build a mock supabase_admin whose chained query returns `rows`
    (or raises on .execute() if `raises` is set)."""
    mock_db = MagicMock()
    chain = mock_db.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value
    if raises is not None:
        chain.execute.side_effect = raises
    else:
        chain.execute.return_value = MagicMock(data=rows or [])
    return mock_db


# ── Aggregator tests ─────────────────────────────────────────────────


def test_returns_none_when_history_below_threshold():
    """3 essays < MIN_HISTORY_ESSAYS (5) ⇒ None, no aggregation."""
    rows = [{"feedback_json": {"mistakeAnalysis": []}} for _ in range(3)]
    with patch("services.writing_history.supabase_admin", _mock_db_returning(rows)):
        assert get_recurring_patterns("student-uuid") is None


def test_aggregates_recurring_mistakes():
    """5 essays × 2 Article + 1 Word Choice each → Article wins by count."""
    sample = {
        "mistakeAnalysis": [
            {"mistakeType": "Grammar - Article",
             "original": "the others", "criterion": "GRA"},
            {"mistakeType": "Grammar - Article",
             "original": "the things", "criterion": "GRA"},
            {"mistakeType": "Word Choice",
             "original": "terrible", "criterion": "LR"},
        ]
    }
    rows = [{"feedback_json": sample} for _ in range(MIN_HISTORY_ESSAYS)]
    with patch("services.writing_history.supabase_admin", _mock_db_returning(rows)):
        result = get_recurring_patterns("student-uuid")

    assert result is not None
    assert result["essays_analyzed"] == MIN_HISTORY_ESSAYS
    assert len(result["patterns"]) >= 2

    top = result["patterns"][0]
    assert top["mistakeType"] == "Grammar - Article"
    assert top["count"] == 2 * MIN_HISTORY_ESSAYS  # 2 per essay × 5 = 10
    assert top["criterion"] == "GRA"
    # Examples deduplicate + cap at MAX_EXAMPLES_PER_TYPE (3) — only two
    # distinct originals exist in fixture so both should appear.
    assert set(top["examples"]) == {"the others", "the things"}


def test_filters_one_off_mistakes():
    """Count==1 must NOT appear in patterns — single-incident is noise."""
    one_off = {
        "mistakeAnalysis": [
            {"mistakeType": "OneOff", "original": "x", "criterion": "GRA"},
        ]
    }
    recurring = {
        "mistakeAnalysis": [
            {"mistakeType": "Recurring", "original": "y", "criterion": "GRA"},
        ]
    }
    rows = (
        [{"feedback_json": one_off}]
        + [{"feedback_json": recurring} for _ in range(MIN_HISTORY_ESSAYS - 1)]
    )
    with patch("services.writing_history.supabase_admin", _mock_db_returning(rows)):
        result = get_recurring_patterns("student-uuid")

    assert result is not None
    types = [p["mistakeType"] for p in result["patterns"]]
    assert "OneOff" not in types, "RECURRENCE_FLOOR should drop count==1 entries"
    assert "Recurring" in types


def test_db_failure_degrades_gracefully():
    """A raised exception inside .execute() must NOT propagate — the
    grader must keep working even when the history table is down."""
    with patch("services.writing_history.supabase_admin",
               _mock_db_returning(raises=RuntimeError("DB down"))):
        assert get_recurring_patterns("student-uuid") is None


# ── Formatter tests ──────────────────────────────────────────────────


def test_format_empty_patterns_returns_empty_string():
    """None / empty patterns ⇒ "" so callers can unconditionally inject
    the block without polluting the prompt."""
    assert format_history_for_prompt(None) == ""
    assert format_history_for_prompt({"patterns": []}) == ""
    assert format_history_for_prompt({}) == ""


def test_format_includes_top_patterns_and_schema():
    """Populated dict ⇒ Vietnamese section with mistake types, counts,
    examples, and the `recurringPatterns` output schema instruction.

    Phase 1.5b: heading renamed from "Lịch sử lỗi" to broader
    "Lịch sử của học viên" since the section now also carries band
    trajectory. Recurring-pattern content lives under the
    "### Lỗi LẶP LẠI" sub-heading.
    """
    patterns = {
        "essays_analyzed": 5,
        "patterns": [
            {"mistakeType": "Grammar - Article", "count": 8,
             "examples": ["the others", "the things"], "criterion": "GRA"},
            {"mistakeType": "Word Choice", "count": 4,
             "examples": ["terrible"], "criterion": "LR"},
        ],
    }
    out = format_history_for_prompt(patterns)

    assert "Lịch sử của học viên" in out
    assert "Lỗi LẶP LẠI" in out
    assert "Grammar - Article" in out
    assert "(8x)" in out
    assert "the others" in out
    # Output schema instruction so Gemini knows how to populate the
    # recurringPatterns field — without this, history is wasted.
    assert "recurringPatterns" in out
    assert "stillRecurring" in out
    assert "improvements" in out


# ── Phase 1.5b — band trajectory aggregator ──────────────────────────


def _row(overall, *, mc=None, cc=None, lr=None, gra=None):
    """Compact builder for writing_feedback rows used in the
    trajectory tests. Defaults each criterion to the same band as
    overall when omitted, so most tests can specify just `overall`."""
    return {
        "overall_band_score":      overall,
        "band_main_criterion":     overall if mc  is None else mc,
        "band_coherence_cohesion": overall if cc  is None else cc,
        "band_lexical_resource":   overall if lr  is None else lr,
        "band_grammatical_range":  overall if gra is None else gra,
    }


def test_classify_trend_thresholds():
    """±0.25 thresholds are symmetric. Test the boundary cases so a
    casual constant edit can't quietly drift the floor."""
    assert _classify_trend(0.30)  == "improving"
    assert _classify_trend(0.25)  == "improving"   # inclusive
    assert _classify_trend(0.24)  == "stable"
    assert _classify_trend(0.0)   == "stable"
    assert _classify_trend(-0.24) == "stable"
    assert _classify_trend(-0.25) == "declining"   # inclusive
    assert _classify_trend(-0.30) == "declining"


def test_band_trajectory_returns_none_below_threshold():
    """3 rows < MIN_HISTORY_ESSAYS ⇒ None, no aggregation, no prompt."""
    rows = [_row(6.0)] * 3
    with patch("services.writing_history.supabase_admin", _mock_db_returning(rows)):
        assert get_band_trajectory("student-uuid") is None


def test_band_trajectory_calculates_average():
    """5 essays with varying overall bands → correct rounded mean."""
    bands = [6.5, 6.0, 6.0, 5.5, 5.5]
    rows = [_row(b) for b in bands]
    with patch("services.writing_history.supabase_admin", _mock_db_returning(rows)):
        result = get_band_trajectory("student-uuid")

    assert result is not None
    assert result["essays_analyzed"] == 5
    assert result["average_last_5"] == round(sum(bands) / len(bands), 2)


def test_band_trajectory_classifies_improving():
    """Newest 2 bands (DESC order, so first 2 in list) ABOVE oldest 2
    by ≥0.25 → "improving". Rows arrive newest-first from the
    .order("created_at", desc=True) query, so the trajectory's
    "improving" label means recent essays are stronger than older ones."""
    rows = [_row(b) for b in (7.0, 6.5, 6.0, 5.5, 5.0)]
    with patch("services.writing_history.supabase_admin", _mock_db_returning(rows)):
        result = get_band_trajectory("student-uuid")

    assert result["trend"] == "improving"
    assert result["trend_delta"] > 0


def test_band_trajectory_classifies_declining():
    """Reverse of improving — newest essays are weaker."""
    rows = [_row(b) for b in (5.0, 5.5, 6.0, 6.5, 7.0)]
    with patch("services.writing_history.supabase_admin", _mock_db_returning(rows)):
        result = get_band_trajectory("student-uuid")

    assert result["trend"] == "declining"
    assert result["trend_delta"] < 0


def test_band_trajectory_classifies_stable():
    """Identical bands ⇒ delta == 0 ⇒ stable. Guards against the
    threshold being mis-applied (e.g. > vs >=)."""
    rows = [_row(6.0)] * 5
    with patch("services.writing_history.supabase_admin", _mock_db_returning(rows)):
        result = get_band_trajectory("student-uuid")

    assert result["trend"] == "stable"
    assert result["trend_delta"] == 0.0


def test_band_trajectory_per_criterion_breakdown():
    """Each of the 4 criteria gets its own avg + trend, in canonical
    order. Tests use distinct per-criterion bands to confirm no
    cross-pollination — the breakdown for Lexical must reflect ONLY
    Lexical column values, not the overall."""
    rows = [
        _row(6.0, mc=7.0, cc=6.0, lr=5.0, gra=6.0),
        _row(6.0, mc=7.0, cc=6.0, lr=5.0, gra=6.0),
        _row(6.0, mc=7.0, cc=6.0, lr=5.0, gra=6.0),
        _row(6.0, mc=7.0, cc=6.0, lr=5.0, gra=6.0),
        _row(6.0, mc=7.0, cc=6.0, lr=5.0, gra=6.0),
    ]
    with patch("services.writing_history.supabase_admin", _mock_db_returning(rows)):
        result = get_band_trajectory("student-uuid")

    breakdown = {c["criterion"]: c for c in result["criteria_breakdown"]}
    assert breakdown["Task Response"]["average"]                   == 7.0
    assert breakdown["Coherence and Cohesion"]["average"]          == 6.0
    assert breakdown["Lexical Resource"]["average"]                == 5.0
    assert breakdown["Grammatical Range and Accuracy"]["average"]  == 6.0
    # Order matches _CRITERION_COLUMNS — frontend depends on this.
    assert [c["criterion"] for c in result["criteria_breakdown"]] == [
        "Task Response",
        "Coherence and Cohesion",
        "Lexical Resource",
        "Grammatical Range and Accuracy",
    ]


def test_band_trajectory_db_failure():
    """Trajectory failure must NOT propagate — same defensive contract
    as get_recurring_patterns. A DB blip during history lookup must
    not block grading the current essay."""
    with patch("services.writing_history.supabase_admin",
               _mock_db_returning(raises=RuntimeError("DB down"))):
        assert get_band_trajectory("student-uuid") is None


# ── Phase 1.5b — formatter integration ───────────────────────────────


def test_format_history_includes_trajectory_section():
    """trajectory dict only (no patterns) ⇒ block carries "Diễn biến
    band điểm" + the bandTrajectoryAnalysis output schema instruction."""
    trajectory = {
        "essays_analyzed":    5,
        "average_last_5":     6.0,
        "trend":              "improving",
        "trend_delta":        0.5,
        "criteria_breakdown": [
            {"criterion": "Task Response",            "average": 6.5, "trend": "improving"},
            {"criterion": "Coherence and Cohesion",   "average": 5.5, "trend": "stable"},
        ],
    }
    out = format_history_for_prompt(None, trajectory)

    assert "Lịch sử của học viên" in out
    assert "Diễn biến band điểm" in out
    assert "6.0" in out                    # average rendered
    assert "improving" in out              # trend rendered
    assert "Task Response" in out          # breakdown surfaced
    assert "bandTrajectoryAnalysis" in out  # schema instruction
    assert "current_band"      in out
    assert "trend_explanation" in out
    assert "next_target"       in out
    # Recurring-patterns block must be ABSENT when only trajectory
    # is provided — no empty "Lỗi LẶP LẠI" heading.
    assert "Lỗi LẶP LẠI" not in out


def test_format_history_with_both_patterns_and_trajectory():
    """Both inputs ⇒ both blocks rendered, plus both schema
    instructions emitted so Gemini knows to populate both fields."""
    patterns = {
        "patterns": [
            {"mistakeType": "Grammar - Article", "count": 5,
             "examples": ["the others"], "criterion": "GRA"},
        ],
    }
    trajectory = {
        "essays_analyzed":    5,
        "average_last_5":     6.0,
        "trend":              "stable",
        "trend_delta":        0.1,
        "criteria_breakdown": [],
    }
    out = format_history_for_prompt(patterns, trajectory)

    assert "Lỗi LẶP LẠI"          in out
    assert "Diễn biến band điểm"  in out
    assert "recurringPatterns"    in out
    assert "bandTrajectoryAnalysis" in out


def test_format_history_empty_when_both_none():
    """Both None ⇒ "" so caller can unconditionally inject without
    polluting the prompt for new students (<5 essays)."""
    assert format_history_for_prompt(None, None) == ""
    assert format_history_for_prompt({"patterns": []}, None) == ""


# ── Sprint 1.5b.1 — avg vs average key regression ────────────────────


def test_format_history_uses_canonical_average_key_in_narrative():
    """Sprint 1.5b.1 regression guard: the per-criterion line in the
    Vietnamese narrative MUST spell the field as "average" rather than
    the readability shorthand "avg".

    Phase 1.5b's first prompt printed `f"avg {c['average']}, trend ..."`
    which primed Gemini to emit `{"avg": N.N}` in the JSON output —
    front-end reads `c.average` so the criteria_breakdown rows showed
    "avg —" in production. Pinning the substring here means a future
    edit that re-introduces the shorthand fails this test before it
    ships."""
    trajectory = {
        "essays_analyzed":    5,
        "average_last_5":     6.0,
        "trend":              "stable",
        "trend_delta":        0.0,
        "criteria_breakdown": [
            {"criterion": "Task Response", "average": 6.5, "trend": "improving"},
        ],
    }
    out = format_history_for_prompt(None, trajectory)

    # Canonical key appears in the narrative and the JSON example.
    assert "Task Response: average 6.5" in out, (
        "Narrative must spell the criterion field as `average`, not `avg`."
    )
    # Explicit reminder line we added so Gemini doesn't shorten the key.
    assert '"average"' in out and "không phải" in out and '"avg"' in out, (
        "JSON example must call out the canonical key explicitly."
    )


# ── Phase 1.5c — sentence-structure aggregator + focus theme ─────────


def _ss_row(mistakes, essay_text="One. Two. Three. Four. Five."):
    """Compact builder for a writing_feedback row joined to its essay
    via the inner-join alias used by `get_sentence_structure_history`.

    The aggregator pulls `essay_text` off the joined writing_essays
    dict to compute SS-mistake density per sentence — keeping the
    default text at 5 sentences makes the density math predictable.
    """
    return {
        "feedback_json":  {"mistakeAnalysis": mistakes},
        "writing_essays": {"essay_text": essay_text},
    }


def test_sentence_structure_returns_none_below_threshold():
    """3 essays < MIN_HISTORY_ESSAYS ⇒ None — same threshold as the
    other two aggregators so SS history activates on the same trigger
    as recurring patterns + band trajectory."""
    rows = [_ss_row([])] * 3
    with patch("services.writing_history.supabase_admin", _mock_db_returning(rows)):
        assert get_sentence_structure_history("student-uuid") is None


def test_sentence_structure_aggregates_by_pattern():
    """5 essays each containing two "Run-on sentence" mistakes ⇒ the
    aggregator collapses them into a single common_issue with count
    == 10, plus distinct examples (deduplicated, capped at 2)."""
    mistakes = [
        {"mistakeType": "Run-on sentence",
         "original": "I went home it was late.", "criterion": "Grammatical Range"},
        {"mistakeType": "Run-on sentence",
         "original": "She arrived we left.", "criterion": "Grammatical Range"},
    ]
    rows = [_ss_row(mistakes) for _ in range(MIN_HISTORY_ESSAYS)]
    with patch("services.writing_history.supabase_admin", _mock_db_returning(rows)):
        result = get_sentence_structure_history("student-uuid")

    assert result is not None
    assert result["essays_analyzed"] == MIN_HISTORY_ESSAYS
    assert len(result["common_issues"]) == 1

    top = result["common_issues"][0]
    assert top["pattern"] == "Run-on sentence"
    assert top["count"] == 2 * MIN_HISTORY_ESSAYS
    assert set(top["examples"]) == {
        "I went home it was late.",
        "She arrived we left.",
    }


def test_sentence_structure_filters_non_ss_mistakes():
    """Non-SS mistakes (Article, Spelling, Word Choice…) MUST be
    excluded from common_issues. The heuristic only fires when
    mistakeType OR criterion contains an SS-flavoured keyword.

    This test pins the boundary: a vanilla Grammar mistake (no SS
    keyword anywhere) should produce zero common_issues, even at
    high count."""
    non_ss = [
        {"mistakeType": "Grammar - Article",
         "original": "the others", "criterion": "Grammatical Range and Accuracy"},
        {"mistakeType": "Word Choice",
         "original": "terrible", "criterion": "Lexical Resource"},
    ]
    rows = [_ss_row(non_ss) for _ in range(MIN_HISTORY_ESSAYS)]
    with patch("services.writing_history.supabase_admin", _mock_db_returning(rows)):
        result = get_sentence_structure_history("student-uuid")

    assert result is not None
    assert result["common_issues"] == []
    # Density signal still computed even when zero SS mistakes — five
    # essays, zero SS mistakes ⇒ low density ⇒ "needs_more_complex".
    assert result["complexity_indicator"] == "needs_more_complex"


def test_sentence_structure_db_failure_returns_none():
    """DB error inside .execute() must NOT propagate — same defensive
    contract as the other aggregators."""
    with patch("services.writing_history.supabase_admin",
               _mock_db_returning(raises=RuntimeError("DB down"))):
        assert get_sentence_structure_history("student-uuid") is None


def test_format_history_with_all_three_aggregators():
    """patterns + trajectory + sentence_structure ⇒ the prompt block
    includes all three Vietnamese sub-sections AND all three output
    schema instructions (recurringPatterns, bandTrajectoryAnalysis,
    sentenceStructureFocus). Pinning all three together protects the
    single-call interface — a regression that drops any one of the
    schemas mid-prompt would have Gemini silently emit null for the
    affected field."""
    patterns = {
        "patterns": [
            {"mistakeType": "Grammar - Article", "count": 5,
             "examples": ["the others"], "criterion": "GRA"},
        ],
    }
    trajectory = {
        "essays_analyzed":    5,
        "average_last_5":     6.5,
        "trend":              "improving",
        "trend_delta":        0.4,
        "criteria_breakdown": [
            {"criterion": "Task Response", "average": 7.0, "trend": "improving"},
        ],
    }
    sentence_structure = {
        "common_issues": [
            {"pattern": "Run-on sentence", "count": 6,
             "examples": ["I went home it was late."]},
        ],
        "complexity_indicator": "needs_more_simple",
        "essays_analyzed":      5,
    }
    out = format_history_for_prompt(patterns, trajectory, sentence_structure)

    # All three Vietnamese sub-section headings.
    assert "Lỗi LẶP LẠI"                        in out
    assert "Diễn biến band điểm"                in out
    assert "Phân tích cấu trúc câu (lịch sử)"   in out

    # SS-specific data surfaced.
    assert "needs_more_simple"  in out
    assert "Run-on sentence"    in out
    assert "(6x)"               in out

    # All three output schema instructions.
    assert "recurringPatterns"        in out
    assert "bandTrajectoryAnalysis"   in out
    assert "sentenceStructureFocus"   in out
    assert "focus_theme"              in out
    assert "this_week_practice"       in out
