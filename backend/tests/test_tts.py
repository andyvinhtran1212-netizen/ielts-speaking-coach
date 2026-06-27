"""B9 (#43) — POST /tts endpoint had no test. Pin auth, the 503-when-unconfigured
guard, voice validation/default, the audio/mpeg success shape, and the 502 on a
provider failure. The OpenAI call (synthesize_mp3) is mocked — no network."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from routers import tts as tts_module


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _body(text="Hello world", voice="nova"):
    return tts_module.TTSRequest(text=text, voice=voice)


def _patch(monkeypatch, *, key="sk-test", synth=b"MP3", raises=None):
    async def _user(_a):
        return {"id": "u1"}

    async def _synth(text, voice):
        if raises:
            raise raises
        _synth.calls.append((text, voice))
        return synth
    _synth.calls = []

    monkeypatch.setattr(tts_module, "get_supabase_user", _user)
    monkeypatch.setattr(tts_module.settings, "OPENAI_API_KEY", key)
    monkeypatch.setattr(tts_module, "synthesize_mp3", _synth)
    logged = {}
    monkeypatch.setattr(tts_module.ai_usage_logger, "log_tts", lambda **k: logged.update(k))
    return _synth, logged


def test_503_when_openai_key_missing(monkeypatch):
    _patch(monkeypatch, key="")
    with pytest.raises(HTTPException) as ei:
        _run(tts_module.text_to_speech(_body(), authorization="Bearer x"))
    assert ei.value.status_code == 503


def test_success_returns_audio_mpeg_no_store(monkeypatch):
    _synth, logged = _patch(monkeypatch, synth=b"AUDIOBYTES")
    resp = _run(tts_module.text_to_speech(_body("Read this aloud"), authorization="Bearer x"))
    assert resp.media_type == "audio/mpeg"
    assert resp.body == b"AUDIOBYTES"
    assert resp.headers["Cache-Control"] == "no-store"
    assert logged["user_id"] == "u1"
    assert logged["text_chars"] == len("Read this aloud")


def test_invalid_voice_falls_back_to_nova(monkeypatch):
    _synth, _ = _patch(monkeypatch)
    _run(tts_module.text_to_speech(_body(voice="not-a-voice"), authorization="Bearer x"))
    assert _synth.calls[0][1] == "nova"


def test_502_on_provider_failure(monkeypatch):
    _patch(monkeypatch, raises=RuntimeError("openai down"))
    with pytest.raises(HTTPException) as ei:
        _run(tts_module.text_to_speech(_body(), authorization="Bearer x"))
    assert ei.value.status_code == 502
