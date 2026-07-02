"""backend/tests/test_grading_reliability_caps.py — audit 2026-07-02 (finding #8)

Low transcript reliability used to only nudge the grader via the prompt. Now
_apply_reliability_caps enforces a Band-6 ceiling on LR/GRA in CODE when
reliability is 'low' (a noisy/garbled transcript can't justify a confident high
lexical/grammar band), recomputes the criterion mean, and notes the limitation.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers.grading import (   # noqa: E402
    _RELIABILITY_LR_GRA_CAP,
    _apply_reliability_caps,
)


def test_low_reliability_caps_lr_gra_and_recomputes():
    g = {
        "band_fc": 7, "band_lr": 8, "band_gra": 8, "band_p": 7,
        "overall_band": 7.5, "lr_feedback": "Từ vựng phong phú.",
        "gra_feedback": "Ngữ pháp tốt.",
    }
    assert _apply_reliability_caps(g, "low") is True
    assert g["band_lr"] == _RELIABILITY_LR_GRA_CAP   # 8 → 6
    assert g["band_gra"] == _RELIABILITY_LR_GRA_CAP
    assert g["lr_feedback"].lstrip().startswith("⚠")
    assert g["gra_feedback"].lstrip().startswith("⚠")
    # mean(7,6,6,7)=6.5
    assert g["overall_band"] == 6.5


def test_medium_reliability_no_op():
    g = {"band_fc": 7, "band_lr": 8, "band_gra": 8, "band_p": 7, "overall_band": 7.5}
    assert _apply_reliability_caps(g, "medium") is False
    assert g["band_lr"] == 8 and g["overall_band"] == 7.5


def test_high_reliability_no_op():
    g = {"band_fc": 7, "band_lr": 8, "band_gra": 8, "overall_band": 7.5}
    assert _apply_reliability_caps(g, "high") is False
    assert g["band_lr"] == 8


def test_low_but_already_below_cap_only_adds_note():
    g = {"band_fc": 5, "band_lr": 5, "band_gra": 5, "band_p": 5,
         "overall_band": 5.0, "lr_feedback": "Ổn.", "gra_feedback": "Ổn."}
    # No band lowered (both already ≤ 6) → returns False, but the caution note
    # is still surfaced and the bands are untouched.
    assert _apply_reliability_caps(g, "low") is False
    assert g["band_lr"] == 5 and g["band_gra"] == 5
    assert g["lr_feedback"].lstrip().startswith("⚠")


def test_practice_mode_no_criterion_bands_no_crash():
    g = {"overall_band": 6.0}   # practice payload — no band_lr/band_gra
    assert _apply_reliability_caps(g, "low") is False
    assert g["overall_band"] == 6.0


def test_note_not_duplicated():
    g = {"band_fc": 7, "band_lr": 8, "band_gra": 8, "band_p": 7, "overall_band": 7.5,
         "lr_feedback": "⚠ đã cảnh báo.", "gra_feedback": "Ngữ pháp tốt."}
    _apply_reliability_caps(g, "low")
    assert g["lr_feedback"].count("⚠") == 1
