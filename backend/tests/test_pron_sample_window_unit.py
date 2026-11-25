"""COURSEACCESS-0055 FR-035 (G04-T13): services.pronunciation_sampling.sample_window.

A pure function: the middle ``sample_seconds`` of a recording longer than
``sample_seconds + 5``; otherwise (or unknown length) the whole recording.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.pronunciation_sampling import PronSample, sample_window  # noqa: E402


@pytest.mark.parametrize("duration, expected", [
    (112.0, (41.0, 71.0)),   # PhieuKetQua example: 1:52 → 0:41–1:11
    (120.0, (45.0, 75.0)),
    (50.0, (10.0, 40.0)),
    (36.0, (3.0, 33.0)),     # just over the 30 + 5 threshold
])
def test_middle_window_of_a_long_recording(duration, expected):
    assert sample_window(duration, 30) == expected


@pytest.mark.parametrize("duration", [35.0, 20.0, 0, 0.0, -3.0, None])
def test_short_or_unknown_recording_is_sent_whole(duration):
    assert sample_window(duration, 30) == (None, None)


def test_window_follows_the_configured_length():
    assert sample_window(100.0, 10) == (45.0, 55.0)
    assert sample_window(100.0, 60) == (20.0, 80.0)


def test_pron_sample_dict_shape():
    assert PronSample("segment", 45.0, 75.0).as_dict() == {"scope": "segment", "start_s": 45.0, "end_s": 75.0}
    assert PronSample("not_sampled").as_dict() == {"scope": "not_sampled", "start_s": None, "end_s": None}
