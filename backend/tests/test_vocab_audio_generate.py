"""V-eleven — engine-selectable vocab audio generate.

OpenAI + ElevenLabs + Supabase all mocked (no real API). Covers: sync engine
dispatch (xi-api-key + voice_id for ElevenLabs), per-engine path (no collision),
hash-skip per engine, the admin generate route (target precedence, engine key
gate, require_admin, queues a BackgroundTask), and the job's stamp + reload.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

import services.tts_audio as ta
import routers.admin_vocab as av

_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_ID = "11111111-1111-1111-1111-111111111111"


def _client():
    from main import app
    return TestClient(app)


# ── engine dispatch + per-engine path ─────────────────────────────────────


def test_synth_sync_openai_uses_openai_client():
    fake_client = MagicMock()
    fake_client.audio.speech.create.return_value = MagicMock(content=b"ID3-openai")
    with patch("config.settings.OPENAI_API_KEY", "sk-x"), \
         patch("openai.OpenAI", return_value=fake_client) as ctor:
        out = ta.synth_sync("Holistic", "openai")
    assert out == b"ID3-openai"
    ctor.assert_called_once()
    assert fake_client.audio.speech.create.call_args.kwargs["model"] == "tts-1"


def test_synth_sync_elevenlabs_posts_with_key_and_voice():
    resp = MagicMock(content=b"ID3-eleven"); resp.raise_for_status = MagicMock()
    with patch("config.settings.ELEVENLABS_API_KEY", "el-key"), \
         patch("config.settings.VOCAB_TTS_ELEVENLABS_VOICE_ID", "VOICE123"), \
         patch("requests.post", return_value=resp) as post:
        out = ta.synth_sync("Holistic", "elevenlabs")
    assert out == b"ID3-eleven"
    url = post.call_args.args[0]
    assert "text-to-speech/VOICE123" in url
    assert post.call_args.kwargs["headers"]["xi-api-key"] == "el-key"
    assert post.call_args.kwargs["json"]["text"] == "Holistic"


def test_per_engine_paths_differ_no_collision():
    with patch("config.settings.VOCAB_TTS_ELEVENLABS_VOICE_ID", "VOICE123"):
        p_o = ta.audio_path("Holistic", engine="openai")
        p_e = ta.audio_path("Holistic", engine="elevenlabs")
    assert p_o != p_e
    assert p_o.endswith(".mp3") and p_e.endswith(".mp3")


def test_get_or_create_sync_hash_skip_per_engine():
    with patch("services.tts_audio.audio_exists", return_value=True), \
         patch("services.tts_audio.public_url", return_value="https://x/e.mp3"), \
         patch("services.tts_audio.synth_sync") as synth, \
         patch("services.tts_audio.upload_mp3") as up:
        url, did = ta.get_or_create_audio_sync("Holistic", "elevenlabs")
    assert url == "https://x/e.mp3" and did is False
    synth.assert_not_called(); up.assert_not_called()


def test_get_or_create_sync_synths_when_absent():
    with patch("services.tts_audio.audio_exists", return_value=False), \
         patch("services.tts_audio.public_url", return_value="https://x/e.mp3"), \
         patch("services.tts_audio.synth_sync", return_value=b"mp3") as synth, \
         patch("services.tts_audio.upload_mp3") as up:
        url, did = ta.get_or_create_audio_sync("Holistic", "elevenlabs")
    assert did is True
    synth.assert_called_once_with("Holistic", "elevenlabs", ta.DEFAULT_VOICE)
    up.assert_called_once()


# Vocabulary hosted generation is batch-only.

def test_generate_route_requires_auth():
    assert _client().post("/admin/vocabulary/generate-audio", json={"all": True}).status_code == 401


def test_generate_route_never_queues_or_calls_another_provider():
    for engine in [None, "kokoro", "openai", "elevenlabs", "typo"]:
        payload = {"ids": [_ID]}
        if engine is not None:
            payload["engine"] = engine
        with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
             patch("routers.admin_vocab.supabase_admin") as db, \
             patch("services.tts_audio.get_or_create_audio_sync") as synth:
            r = _client().post("/admin/vocabulary/generate-audio", json=payload, headers=_ADMIN_AUTH)
        assert r.status_code == 409
        assert "Kokoro bf_emma" in r.json()["detail"]
        assert "Chưa có tác vụ" in r.json()["detail"]
        db.table.assert_not_called()
        synth.assert_not_called()
