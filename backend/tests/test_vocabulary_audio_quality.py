"""A decodable MP3 is insufficient when its actual pronunciation is inaudible."""
import io
from unittest.mock import patch

import pytest
from pydub import AudioSegment
from pydub.generators import Sine
from services import tts_audio
from routers import flashcards


def mp3(segment):
    out = io.BytesIO()
    segment.export(out, format="mp3")
    return out.getvalue()


@pytest.mark.parametrize("clip", [AudioSegment.silent(duration=1000), Sine(440).to_audio_segment(duration=500).apply_gain(-65)])
def test_storage_rejects_silent_or_inaudible_recordings(clip):
    with patch.object(tts_audio, "supabase_admin") as db, pytest.raises(ValueError, match="im lặng hoặc quá nhỏ"):
        tts_audio.upload_mp3("clip.mp3", mp3(clip))
    db.storage.from_.assert_not_called()


def test_storage_accepts_audible_pronunciation_with_edge_padding():
    sound = AudioSegment.silent(duration=180) + Sine(440).to_audio_segment(duration=400).apply_gain(-12) + AudioSegment.silent(duration=320)
    with patch.object(tts_audio, "supabase_admin") as db:
        tts_audio.upload_mp3("clip.mp3", mp3(sound))
    db.storage.from_.return_value.upload.assert_called_once()


def test_storage_rejects_invalid_mp3_without_publishing_it():
    with patch.object(tts_audio, "supabase_admin") as db, pytest.raises(ValueError, match="không giải mã"):
        tts_audio.upload_mp3("clip.mp3", b"not an audio file")
    db.storage.from_.assert_not_called()


def test_prepared_personal_audio_survives_view_projection_and_bank_lookup():
    text = "a useful expression"
    url = flashcards.settings.SUPABASE_URL.rstrip("/") + "/storage/v1/object/public/vocab-audio/" + tts_audio.audio_path(text, "bf_emma", "kokoro")
    card = flashcards._vocab_card_view({"headword": text, "audio_headword": url}, None)
    with patch.object(flashcards, "_audio_by_headword", return_value={}) as lookup:
        assert flashcards._with_audio([card])[0]["audio_headword"] == url
    lookup.assert_called_once_with([])


def test_editing_personal_headword_discards_previous_pronunciation():
    url = flashcards.settings.SUPABASE_URL.rstrip("/") + "/storage/v1/object/public/vocab-audio/" + tts_audio.audio_path("old term", "bf_emma", "kokoro")
    assert flashcards._vocab_card_view({"headword": "new term", "audio_headword": url}, None)["audio_headword"] == ""


def test_personal_audio_rejects_unrelated_urls():
    assert flashcards._vocab_card_view({"headword": "term", "audio_headword": "https://unrelated.example/audio.mp3"}, None)["audio_headword"] == ""
