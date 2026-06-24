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


# ── background job: stamp + reload ────────────────────────────────────────


def test_generate_job_stamps_both_and_finalizes():
    rows = [{"id": _ID, "slug": "holistic", "headword": "Holistic", "example": "A holistic approach."}]
    db = MagicMock()
    with patch("routers.admin_vocab.tts_audio.get_or_create_audio_sync",
               return_value=("https://x/clip.mp3", True)), \
         patch("routers.admin_vocab.supabase_admin", db), \
         patch("routers.admin_vocab._reload_safe") as reload:
        av._generate_audio_job(rows, "elevenlabs", "both")
    payload = db.table.return_value.update.call_args[0][0]
    assert payload["audio_headword"] and payload["audio_example"]
    assert payload["audio_status"] == "final"
    reload.assert_called_once()


def test_generate_job_headword_only_scope():
    rows = [{"id": _ID, "slug": "h", "headword": "Holistic", "example": "x."}]
    db = MagicMock()
    goc = MagicMock(return_value=("https://x/clip.mp3", True))
    with patch("routers.admin_vocab.tts_audio.get_or_create_audio_sync", goc), \
         patch("routers.admin_vocab.supabase_admin", db), \
         patch("routers.admin_vocab._reload_safe"):
        av._generate_audio_job(rows, "openai", "headword")
    assert goc.call_count == 1                       # example skipped
    payload = db.table.return_value.update.call_args[0][0]
    assert "audio_headword" in payload and "audio_example" not in payload


def test_generate_job_one_bad_word_does_not_abort():
    rows = [{"id": "a", "slug": "a", "headword": "A", "example": ""},
            {"id": "b", "slug": "b", "headword": "B", "example": ""}]
    db = MagicMock()
    with patch("routers.admin_vocab.tts_audio.get_or_create_audio_sync",
               side_effect=[RuntimeError("boom"), ("https://x/b.mp3", True)]), \
         patch("routers.admin_vocab.supabase_admin", db), \
         patch("routers.admin_vocab._reload_safe"):
        av._generate_audio_job(rows, "openai", "headword")
    # 'b' still stamped despite 'a' failing
    assert db.table.return_value.update.call_count == 1


# ── route: target precedence + gates + queue ──────────────────────────────


def test_generate_route_requires_auth():
    assert _client().post("/admin/vocabulary/generate-audio", json={"all": True}).status_code == 401


def test_generate_route_elevenlabs_needs_key_503():
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("config.settings.ELEVENLABS_API_KEY", ""):
        r = _client().post("/admin/vocabulary/generate-audio",
                           json={"ids": [_ID], "engine": "elevenlabs"}, headers=_ADMIN_AUTH)
    assert r.status_code == 503


def test_generate_route_queues_and_returns_count():
    db = MagicMock()
    db.table.return_value.select.return_value.in_.return_value.execute.return_value = \
        MagicMock(data=[{"id": _ID, "slug": "h", "headword": "H", "example": ""}])
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("config.settings.ELEVENLABS_API_KEY", "el-key"), \
         patch("routers.admin_vocab.supabase_admin", db), \
         patch("routers.admin_vocab.tts_audio.get_or_create_audio_sync", return_value=("u", True)), \
         patch("routers.admin_vocab._reload_safe"):
        r = _client().post("/admin/vocabulary/generate-audio",
                           json={"ids": [_ID], "engine": "elevenlabs", "scope": "headword"}, headers=_ADMIN_AUTH)
    assert r.status_code == 200, r.text
    assert r.json() == {"queued_count": 1, "engine": "elevenlabs", "scope": "headword"}


def test_generate_route_no_target_400():
    with patch("routers.admin_vocab.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("config.settings.OPENAI_API_KEY", "sk-x"):
        r = _client().post("/admin/vocabulary/generate-audio",
                           json={"engine": "openai"}, headers=_ADMIN_AUTH)
    assert r.status_code == 400
