"""backend/tests/test_grading_off_topic_penalty.py — audit 2026-07-02 (finding #3)

The off-topic judge used to only raise a banner; a fluent but clearly off-topic
answer still scored high. Now _apply_off_topic_penalty caps the band when the
(generous, high-confidence-only) judge says the answer is off-topic:
  * test mode: FC capped (topic development is part of Fluency & Coherence),
    criterion mean recomputed, then an overall ceiling;
  * practice mode: overall ceiling only (no criterion breakdown);
  * on-topic / no verdict: nothing changes.
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers.grading import (   # noqa: E402
    _OFF_TOPIC_FC_CAP,
    _OFF_TOPIC_OVERALL_CAP,
    _apply_off_topic_penalty,
)


def _verdict(is_on_topic: bool):
    return SimpleNamespace(is_on_topic=is_on_topic, reasoning="lý do")


# ── No penalty cases ────────────────────────────────────────────────────────

def test_none_verdict_no_change():
    g = {"band_fc": 7, "band_lr": 7, "band_gra": 7, "band_p": 7, "overall_band": 7.0}
    assert _apply_off_topic_penalty(g, None, is_practice=False) is False
    assert g["band_fc"] == 7 and g["overall_band"] == 7.0
    assert "off_topic_penalty_applied" not in g


def test_on_topic_no_change():
    g = {"band_fc": 7, "band_lr": 7, "band_gra": 7, "band_p": 7, "overall_band": 7.0}
    assert _apply_off_topic_penalty(g, _verdict(True), is_practice=False) is False
    assert g["band_fc"] == 7 and g["overall_band"] == 7.0


# ── Test mode: fluent but off-topic ─────────────────────────────────────────

def test_off_topic_test_mode_caps_fc_and_overall():
    # A fluent off-topic answer: high criteria that would otherwise average 7.75.
    g = {
        "band_fc": 8, "band_lr": 8, "band_gra": 8, "band_p": 7,
        "overall_band": 7.5, "fc_feedback": "Trôi chảy.",
    }
    applied = _apply_off_topic_penalty(g, _verdict(False), is_practice=False)
    assert applied is True
    assert g["band_fc"] == _OFF_TOPIC_FC_CAP            # 8 → 4
    # mean(4,8,8,7)=6.75 → 7.0, then ceiling 5.0
    assert g["overall_band"] == _OFF_TOPIC_OVERALL_CAP  # 5.0
    assert g["fc_feedback"].lstrip().startswith("⚠")
    assert g["off_topic_penalty_applied"] is True


def test_off_topic_test_mode_low_fc_still_notes_and_ceilings():
    g = {
        "band_fc": 3, "band_lr": 4, "band_gra": 4, "band_p": 4,
        "overall_band": 3.5, "fc_feedback": "Ngập ngừng.",
    }
    _apply_off_topic_penalty(g, _verdict(False), is_practice=False)
    assert g["band_fc"] == 3                            # already ≤ cap, unchanged
    assert g["fc_feedback"].lstrip().startswith("⚠")    # note still prepended
    # mean(3,4,4,4)=3.75 → 4.0, below the 5.0 ceiling → stays 4.0
    assert g["overall_band"] == 4.0


def test_off_topic_note_not_duplicated():
    g = {"band_fc": 8, "band_lr": 6, "band_gra": 6, "band_p": 6,
         "overall_band": 6.5, "fc_feedback": "⚠ đã có cảnh báo."}
    _apply_off_topic_penalty(g, _verdict(False), is_practice=False)
    assert g["fc_feedback"].count("⚠") == 1


# ── Practice mode: overall ceiling only ─────────────────────────────────────

def test_off_topic_practice_mode_caps_overall_only():
    g = {"overall_band": 7.0}   # practice payload — no criterion breakdown
    applied = _apply_off_topic_penalty(g, _verdict(False), is_practice=True)
    assert applied is True
    assert g["overall_band"] == _OFF_TOPIC_OVERALL_CAP  # 5.0
    assert "band_fc" not in g


def test_off_topic_practice_below_ceiling_unchanged():
    g = {"overall_band": 4.0}
    _apply_off_topic_penalty(g, _verdict(False), is_practice=True)
    assert g["overall_band"] == 4.0
