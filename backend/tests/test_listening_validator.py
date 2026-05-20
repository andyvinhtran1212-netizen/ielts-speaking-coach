"""Tests for Sprint 13.2 — listening_validator service.

Pure-function tests: no Supabase, no FastAPI. Each helper is exercised
for its success path + every named error/warning code in the validator
module.
"""

from __future__ import annotations

from services import listening_validator as v


# ── Audio validation ─────────────────────────────────────────────────────────


def _good_audio(size: int = 60_000) -> bytes:
    """A byte string that passes the audio checks: ID3 magic + ≥50 KB."""
    return b"ID3" + b"\x00" * size


class TestValidateAudioMetadata:
    def test_happy_path_no_issues(self):
        r = v.validate_audio_metadata(_good_audio(), declared_duration_seconds=4)
        assert r["errors"] == []
        assert r["warnings"] == []

    def test_empty_file_errors(self):
        r = v.validate_audio_metadata(b"", declared_duration_seconds=None)
        codes = [e["code"] for e in r["errors"]]
        assert "audio_empty" in codes

    def test_too_small_errors(self):
        r = v.validate_audio_metadata(b"ID3" + b"\x00" * 10)
        codes = [e["code"] for e in r["errors"]]
        assert "audio_too_small" in codes

    def test_too_large_errors(self):
        big = b"ID3" + b"\x00" * (51 * 1024 * 1024)  # 51 MB
        r = v.validate_audio_metadata(big)
        codes = [e["code"] for e in r["errors"]]
        assert "audio_too_large" in codes

    def test_missing_magic_warns(self):
        body = b"random-garbage-prefix" + b"\x00" * 60_000
        r = v.validate_audio_metadata(body)
        codes = [w["code"] for w in r["warnings"]]
        assert "audio_not_mp3_signature" in codes
        # But no errors — warning shouldn't escalate.
        assert all(e["code"] != "audio_not_mp3_signature" for e in r["errors"])

    def test_duration_drift_warns(self):
        # 60 KB → infer ≈4s. Declare 60s → drift 56s, well past tolerance.
        r = v.validate_audio_metadata(_good_audio(60_000), declared_duration_seconds=60)
        codes = [w["code"] for w in r["warnings"]]
        assert "duration_drift" in codes

    def test_duration_within_tolerance_no_warn(self):
        # 60 KB → infer ≈4s. Declare 4s → no drift.
        r = v.validate_audio_metadata(_good_audio(60_000), declared_duration_seconds=4)
        assert all(w["code"] != "duration_drift" for w in r["warnings"])


# ── Transcript validation ────────────────────────────────────────────────────


class TestValidateTranscriptQuality:
    def test_happy_path_no_issues(self):
        text = "This is a long enough transcript for a thirty-second audio."
        r = v.validate_transcript_quality(text, declared_duration_seconds=30)
        assert r["errors"] == []
        # Word count 11 → ~22 wpm at 30s, will warn low_wpm — that's OK.

    def test_empty_transcript_errors(self):
        r = v.validate_transcript_quality("", declared_duration_seconds=None)
        codes = [e["code"] for e in r["errors"]]
        assert "transcript_empty" in codes

    def test_too_short_errors(self):
        r = v.validate_transcript_quality("Short.", declared_duration_seconds=None)
        codes = [e["code"] for e in r["errors"]]
        assert "transcript_too_short" in codes

    def test_too_long_errors(self):
        text = "word " * 12_000  # ≈60k chars
        r = v.validate_transcript_quality(text, declared_duration_seconds=600)
        codes = [e["code"] for e in r["errors"]]
        assert "transcript_too_long" in codes

    def test_low_wpm_warns(self):
        # 1 word / 60s = 1 wpm — far below the 60-220 band.
        text = "hello hello hello hello"  # 4 words
        r = v.validate_transcript_quality(text, declared_duration_seconds=120)
        codes = [w["code"] for w in r["warnings"]]
        assert "transcript_low_wpm" in codes

    def test_high_wpm_warns(self):
        # 600 words / 60s = 600 wpm — way above the 220 ceiling.
        text = "word " * 600
        r = v.validate_transcript_quality(text, declared_duration_seconds=60)
        codes = [w["code"] for w in r["warnings"]]
        assert "transcript_high_wpm" in codes

    def test_skips_wpm_when_no_duration(self):
        # Only the short-text error path fires.
        text = "hello hello"
        r = v.validate_transcript_quality(text, declared_duration_seconds=None)
        assert all(w["code"] != "transcript_low_wpm" for w in r["warnings"])


# ── Combined validate_upload + helpers ───────────────────────────────────────


class TestValidateUpload:
    def test_combines_audio_and_transcript_issues(self):
        bad_audio = b""
        bad_text  = ""
        r = v.validate_upload(
            file_bytes=bad_audio, transcript=bad_text, declared_duration_seconds=10,
        )
        codes = {e["code"] for e in r["errors"]}
        assert "audio_empty" in codes
        assert "transcript_empty" in codes

    def test_has_errors_helper(self):
        assert v.has_errors({"errors": [{"code": "x"}], "warnings": []})
        assert not v.has_errors({"errors": [], "warnings": [{"code": "x"}]})

    def test_infer_duration_seconds(self):
        # 60 KB → 60000/16000 = 3.75 → rounded → 4
        assert v.infer_duration_seconds(b"\x00" * 60_000) == 4
        # Empty → 0
        assert v.infer_duration_seconds(b"") == 0
        # 1 KB → max(1, 0) → 1
        assert v.infer_duration_seconds(b"\x00" * 1024) == 1
