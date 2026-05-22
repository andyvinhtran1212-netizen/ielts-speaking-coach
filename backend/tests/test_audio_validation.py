"""
backend/tests/test_audio_validation.py — Sprint 14.2

Source-level pins for the per-question minimum-duration gate. The gate
keeps users from submitting toy clips (silence, single words, accidental
clicks) that would otherwise consume a Whisper transcription + Claude
grading round-trip and surface a misleading "Band 3" output.

The frontend dispatches on the *structured* HTTP 422 detail body so
any rename of a key here is a breaking change (sentinel `to_detail`
shape covers that).
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.audio_validation import (  # noqa: E402
    MIN_DURATION_BY_PART,
    AudioTooShortError,
    validate_audio_duration,
)


# ── Cap table — pinned to commission ────────────────────────────────────────


def test_cap_table_matches_commission():
    """Andy's commission specifies P1=15 / P2=80 / P3=25 — a future
    rubric tweak (Sprint 14.4) is the only legitimate reason to change
    these. Anyone touching this dict must explicitly bump the test too."""
    assert MIN_DURATION_BY_PART == {1: 15, 2: 80, 3: 25}


# ── Pass paths (no exception) ───────────────────────────────────────────────


@pytest.mark.parametrize(
    "part,duration",
    [
        (1, 15.0),    # exactly at min — must NOT raise
        (1, 22.5),    # comfortably above
        (2, 80.0),    # exactly at min
        (2, 120.0),
        (3, 25.0),    # exactly at min
        (3, 47.3),
    ],
)
def test_validate_passes_at_or_above_min(part, duration):
    assert validate_audio_duration(duration, part) is None


# ── Reject paths (AudioTooShortError raised, detail well-formed) ─────────────


@pytest.mark.parametrize(
    "part,duration,expected_min",
    [
        (1, 14.99, 15),   # just below — must reject (no 1s slack)
        (1, 2.0,   15),
        (1, 0.0,   15),   # pathological — empty file should also reject here
        (2, 79.5,  80),
        (2, 30.0,  80),
        (3, 24.0,  25),
        (3, 10.0,  25),
    ],
)
def test_validate_rejects_below_min(part, duration, expected_min):
    with pytest.raises(AudioTooShortError) as excinfo:
        validate_audio_duration(duration, part)
    err = excinfo.value
    assert err.part == part
    assert err.min_seconds == expected_min
    assert err.duration_seconds == pytest.approx(duration, abs=1e-6)


def test_to_detail_shape_pinned():
    """The frontend dispatches on `code == 'audio_too_short'` and reads
    `part`, `duration_seconds`, `min_seconds`, `message`. Any rename
    breaks the UI; the sentinel in
    frontend/tests/speaking-results-length-gate.test.mjs pins the
    consuming side."""
    err = AudioTooShortError(duration_seconds=3.7, part=2, min_seconds=80)
    detail = err.to_detail()
    assert detail == {
        "code":             "audio_too_short",
        "part":             2,
        "duration_seconds": 3.7,
        "min_seconds":      80,
        "message":          str(err),
    }
    # Order-independent key set assertion — guards against accidental key drop
    assert set(detail.keys()) == {
        "code", "part", "duration_seconds", "min_seconds", "message",
    }


def test_to_detail_rounds_duration_to_two_decimals():
    """Whisper returns floats with many decimals — pin that the detail
    body rounds them so the UI message stays compact."""
    err = AudioTooShortError(duration_seconds=12.34567, part=1, min_seconds=15)
    assert err.to_detail()["duration_seconds"] == 12.35


# ── Defensive paths ──────────────────────────────────────────────────────────


def test_validate_no_op_for_unknown_part():
    """Schema drift (sessions.part = 4 etc.) must not crash the gate.
    The caller's heuristic caps still apply downstream; only the hard
    floor is skipped."""
    assert validate_audio_duration(1.0, 99) is None
    assert validate_audio_duration(0.0, 0) is None


def test_validate_accepts_int_part_and_float_duration():
    """Whisper returns float; sessions.part is int. Pin that both flow
    through unchanged."""
    with pytest.raises(AudioTooShortError):
        validate_audio_duration(5.0, 1)   # int part
    with pytest.raises(AudioTooShortError):
        validate_audio_duration(5, 1)     # int duration also valid


# ── Wire-in: grading.py must import + invoke the validator ──────────────────


def test_grading_router_imports_validator():
    """Sprint 14.2 wire-in — pin that routers/grading.py actually uses
    the module. Without this, a future cleanup could remove the import
    while leaving an unused alias to AudioTooShortError elsewhere."""
    grading_path = Path(__file__).parent.parent / "routers" / "grading.py"
    src = grading_path.read_text(encoding="utf-8")
    # Single import line covering both symbols
    assert "from services.audio_validation import" in src
    assert "validate_audio_duration" in src
    assert "AudioTooShortError" in src
    # Actually invoked (not just imported)
    assert "validate_audio_duration(duration_sec, part)" in src
    # 422 surface — structured detail body, not free-form message
    assert "to_detail()" in src
    assert "status_code=422" in src
