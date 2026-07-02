"""backend/tests/test_grading_pronunciation_merge.py — audit 2026-07-02

Azure is now the SOLE, audio-measured source of the Speaking P band. The grader
(text-only) can't hear audio, so its band_p is a provisional placeholder that
the server overwrites with the Azure-derived value — or nulls with an honest
"chưa đánh giá" when Azure is unavailable. These tests pin that contract:

  * a fabricated P band is NEVER shown when audio wasn't assessed
  * band_p is audio-derived when Azure succeeds
  * overall_band recomputes from the criteria that actually have a value
  * practice mode (no P criterion) leaves band_p absent but still surfaces the card
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers.grading import (   # noqa: E402
    _PRON_UNAVAILABLE_FEEDBACK,
    _compute_score_confidence,
    _merge_pronunciation_into_grading,
    _pron_band_from_scores,
)


# ── score_confidence folds in the Azure pronunciation score (P2) ────────────

def _rel(label):
    return {"reliability_label": label}


def test_score_confidence_low_when_pron_very_poor():
    # Clear audio (high reliability, normal duration) but very poor pronunciation
    # → confidence must drop to low (restores the removed on-demand signal).
    assert _compute_score_confidence(_rel("high"), 40.0, 20.0) == "low"


def test_score_confidence_high_needs_decent_pron():
    assert _compute_score_confidence(_rel("high"), 40.0, 80.0) == "high"
    # good transcript but mediocre pronunciation → not high
    assert _compute_score_confidence(_rel("high"), 40.0, 50.0) == "medium"


def test_score_confidence_none_pron_preserves_old_behavior():
    assert _compute_score_confidence(_rel("high"), 40.0, None) == "high"
    assert _compute_score_confidence(_rel("low"), 40.0, None) == "low"
    assert _compute_score_confidence(_rel("medium"), 40.0, None) == "medium"


def test_score_confidence_unknown_duration_not_forced_low_or_high():
    # P2: duration None (unknown, non-verbose STT w/o ffprobe) is neither too
    # short (→ low) nor evidence of a normal-length answer (→ high) — medium.
    assert _compute_score_confidence(_rel("high"), None, 80.0) == "medium"
    assert _compute_score_confidence(_rel("high"), None, None) == "medium"
    # reliability / pron signals still dominate when duration is unknown
    assert _compute_score_confidence(_rel("low"), None, None) == "low"
    assert _compute_score_confidence(_rel("high"), None, 20.0) == "low"  # pron < 35


# ── _pron_band_from_scores: Azure 0–100 → IELTS 1–9 integer ─────────────────

def test_band_none_when_no_score():
    assert _pron_band_from_scores(None, None) is None


def test_band_full_score_maps_to_9():
    assert _pron_band_from_scores(100.0, None) == 9.0


def test_band_zero_score_maps_to_1():
    assert _pron_band_from_scores(0.0, None) == 1.0


def test_band_is_whole_integer():
    b = _pron_band_from_scores(72.0, None)
    assert b == float(int(b))          # criterion bands are integers
    assert 1 <= b <= 9


def test_band_blends_fluency_when_present():
    # pron 100 (→9) blended equally with fluency 0 (→1) → mean 5
    assert _pron_band_from_scores(100.0, 0.0) == 5.0


# ── test mode: Azure available → band_p is audio-measured ───────────────────

def test_test_mode_uses_azure_band_and_summary():
    grading = {
        "band_fc": 6, "band_lr": 6, "band_gra": 6, "band_p": 8,  # 8 = fabricated
        "overall_band": 6.5, "p_feedback": "fabricated text",
    }
    pron = {
        "pronunciation_score": 50.0, "fluency_score": 50.0,
        "short_summary": ["Phát âm rõ ràng."],
    }
    detail = _merge_pronunciation_into_grading(grading, pron, is_practice=False)
    # 50 → band 5; overwrites the fabricated 8
    assert grading["band_p"] == 5.0
    assert grading["pronunciation_source"] == "azure"
    assert grading["p_feedback"] == "Phát âm rõ ràng."
    # overall recomputed from 6,6,6,5 = 5.75 → 6.0 (nearest 0.5, half-up)
    assert grading["overall_band"] == 6.0
    assert detail is not None and detail["status"] == "completed"


# ── test mode: Azure unavailable → honest null, NEVER a fabricated number ───

def test_test_mode_unavailable_nulls_band_and_is_honest():
    grading = {
        "band_fc": 7, "band_lr": 6, "band_gra": 5, "band_p": 6,  # fabricated 6
        "overall_band": 6.0, "p_feedback": "as if I heard you",
    }
    detail = _merge_pronunciation_into_grading(grading, None, is_practice=False)
    assert grading["band_p"] is None                       # no fabricated number
    assert grading["pronunciation_source"] == "unavailable"
    assert grading["p_feedback"] == _PRON_UNAVAILABLE_FEEDBACK
    # overall from FC/LR/GRA only: (7+6+5)/3 = 6.0
    assert grading["overall_band"] == 6.0
    assert detail is None


# ── practice mode: no P criterion, but the card is still surfaced ───────────

def test_practice_mode_leaves_band_absent_but_returns_detail():
    grading = {"overall_band": 6.0}   # practice payload has no band_p
    pron = {"pronunciation_score": 80.0, "fluency_score": 75.0,
            "short_summary": ["Tốt."]}
    detail = _merge_pronunciation_into_grading(grading, pron, is_practice=True)
    assert "band_p" not in grading                 # untouched
    assert grading["overall_band"] == 6.0          # Claude holistic band kept
    assert detail is not None and detail["status"] == "completed"


def test_practice_mode_no_azure_returns_none_detail():
    grading = {"overall_band": 5.5}
    detail = _merge_pronunciation_into_grading(grading, None, is_practice=True)
    assert detail is None
    assert "band_p" not in grading
