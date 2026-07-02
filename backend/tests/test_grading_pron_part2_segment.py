"""backend/tests/test_grading_pron_part2_segment.py — audit 2026-07-02 (F1)

Azure pronunciation runs INLINE with grading now, so a full 2-min Part 2
monologue would slow the grade / risk the timeout. _assess_pronunciation_safe
bounds Part 2 to a representative window (same as /pronunciation/full); Parts
1/3 send the full clip; a segment-extraction failure falls back to full audio.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import grading   # noqa: E402


def _fake_assess_recorder(calls):
    async def _fake(*, audio_bytes, content_type, locale, reference_text):
        calls["assess"] = (audio_bytes, content_type)
        return {"pronunciation_score": 70.0}
    return _fake


def test_part2_extracts_representative_segment(monkeypatch):
    calls = {}

    def fake_extract(audio, start, end):
        calls["extract"] = (start, end)
        return b"WAVDATA"

    monkeypatch.setattr(grading, "extract_audio_segment", fake_extract)
    monkeypatch.setattr(grading.azure_pronunciation, "assess_pronunciation",
                        _fake_assess_recorder(calls))

    res = asyncio.run(grading._assess_pronunciation_safe(
        b"AUDIO", "audio/webm", part=2, duration_sec=60.0))

    assert res == {"pronunciation_score": 70.0}
    assert calls["extract"] == (10.0, 45.0)          # bounded window (>=45s branch)
    assert calls["assess"][0] == b"WAVDATA"          # Azure got the segment, not the full clip
    assert calls["assess"][1] == "audio/wav"


def test_part1_sends_full_audio(monkeypatch):
    calls = {}

    def fake_extract(*_a, **_k):
        calls["extract"] = True
        return b"X"

    monkeypatch.setattr(grading, "extract_audio_segment", fake_extract)
    monkeypatch.setattr(grading.azure_pronunciation, "assess_pronunciation",
                        _fake_assess_recorder(calls))

    asyncio.run(grading._assess_pronunciation_safe(
        b"AUDIO", "audio/webm", part=1, duration_sec=30.0))

    assert "extract" not in calls                    # no extraction for Part 1
    assert calls["assess"][0] == b"AUDIO"


def test_short_part2_sends_full_audio(monkeypatch):
    calls = {}

    def fake_extract(*_a, **_k):
        calls["extract"] = True
        return b"X"

    monkeypatch.setattr(grading, "extract_audio_segment", fake_extract)
    monkeypatch.setattr(grading.azure_pronunciation, "assess_pronunciation",
                        _fake_assess_recorder(calls))

    # < 25s Part 2 → no windowing
    asyncio.run(grading._assess_pronunciation_safe(
        b"AUDIO", "audio/webm", part=2, duration_sec=18.0))

    assert "extract" not in calls
    assert calls["assess"][0] == b"AUDIO"


def test_part2_extract_failure_falls_back_to_full(monkeypatch):
    calls = {}

    def fake_extract(*_a, **_k):
        raise RuntimeError("ffmpeg boom")

    monkeypatch.setattr(grading, "extract_audio_segment", fake_extract)
    monkeypatch.setattr(grading.azure_pronunciation, "assess_pronunciation",
                        _fake_assess_recorder(calls))

    res = asyncio.run(grading._assess_pronunciation_safe(
        b"AUDIO", "audio/webm", part=2, duration_sec=60.0))

    assert calls["assess"][0] == b"AUDIO"            # fell back to the full clip
    assert res == {"pronunciation_score": 70.0}


def test_part2_extract_identity_fallback_keeps_original_mime(monkeypatch):
    """extract_audio_segment returns the SAME bytes object on ffmpeg failure (no
    raise). Relabeling that as audio/wav would feed Azure mislabeled audio, so we
    must keep the original content_type when the return is the input unchanged."""
    calls = {}

    def fake_extract(audio, start, end):
        return audio   # ffmpeg-failure behavior: original bytes, unchanged

    monkeypatch.setattr(grading, "extract_audio_segment", fake_extract)
    monkeypatch.setattr(grading.azure_pronunciation, "assess_pronunciation",
                        _fake_assess_recorder(calls))

    asyncio.run(grading._assess_pronunciation_safe(
        b"AUDIO", "audio/webm; codecs=opus", part=2, duration_sec=60.0))

    assert calls["assess"][0] == b"AUDIO"                       # full original bytes
    assert calls["assess"][1] == "audio/webm; codecs=opus"     # NOT mislabeled audio/wav


def test_empty_audio_returns_none():
    assert asyncio.run(grading._assess_pronunciation_safe(
        b"", "audio/webm", part=1, duration_sec=30.0)) is None
