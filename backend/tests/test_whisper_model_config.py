"""backend/tests/test_whisper_model_config.py — audit 2026-07-02 (finding #5)

The STT model is configurable (settings.WHISPER_STT_MODEL, default whisper-1).
whisper.py picks verbose_json for whisper-* (segments + duration the reliability
classifier needs) and plain json for newer models, with an ffprobe duration
fallback so the pipeline degrades gracefully. These tests pin the routing +
graceful ffprobe failure (no API calls).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.whisper import (   # noqa: E402
    _probe_duration_seconds,
    _response_format_for,
    _stt_model,
)


def test_default_model_is_whisper_1():
    # Default (no env override) keeps whisper-1 → zero behavior change.
    assert _stt_model() == "whisper-1"


def test_whisper_uses_verbose_json():
    assert _response_format_for("whisper-1") == "verbose_json"


def test_gpt4o_transcribe_uses_plain_json():
    assert _response_format_for("gpt-4o-transcribe") == "json"
    assert _response_format_for("gpt-4o-mini-transcribe") == "json"


def test_probe_duration_graceful_on_garbage_bytes():
    # ffprobe on non-audio bytes returns nonzero → 0.0 (unknown), never raises.
    assert _probe_duration_seconds(audio_bytes=b"this is not audio") == 0.0


def test_probe_duration_graceful_on_missing_path():
    assert _probe_duration_seconds(path="/nonexistent/file.wav") == 0.0
