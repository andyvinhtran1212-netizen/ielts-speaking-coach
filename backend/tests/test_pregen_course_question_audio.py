"""Kokoro batch for full-English multiple-choice stems."""

from __future__ import annotations

import json
import sys
import zipfile
from unittest.mock import patch

import pytest

from scripts import pregen_course_question_audio as mod


def test_plan_uses_only_questions_marked_by_the_importer():
    questions = [
        {"id": "q1", "qid": "Q1", "segments": {
            "question_audio_text": "Read this sentence."}, "audio_url": None},
        {"id": "q2", "qid": "Q2", "segments": None, "audio_url": None},
        {"id": "q3", "qid": "Q3", "segments": {
            "question_audio_text": "Another sentence.", "voice": "bf_emma"},
         "audio_url": "https://cdn/q3.mp3"},
    ]
    assert mod._plan(questions) == [
        {"id": "q1", "qid": "Q1", "text": "Read this sentence.",
         "voice": "bf_emma", "audio_url": None},
        {"id": "q3", "qid": "Q3", "text": "Another sentence.",
         "voice": "bf_emma", "audio_url": "https://cdn/q3.mp3"},
    ]


def test_pack_must_match_the_exact_text_and_voice(tmp_path):
    planned = [{"id": "q1", "qid": "Q1", "text": "Read me.",
                "voice": "bf_emma", "audio_url": None}]
    storage_path = mod.tts_audio.audio_path("Read me.", "bf_emma", mod.ENGINE)
    pack = tmp_path / "tts.zip"
    with zipfile.ZipFile(pack, "w") as archive:
        archive.writestr(storage_path, b"ID3audio")
        archive.writestr("manifest.json", json.dumps({
            "engine": "kokoro",
            "items": [{"storage_path": storage_path, "text": "Read me.",
                       "voice": "bf_emma"}],
        }))
    with patch.object(mod, "_validate_mp3") as validate:
        archive, _manifest = mod._read_pack(pack, planned)
    archive.close()
    validate.assert_called_once_with(b"ID3audio", "Q1")


def test_a_malformed_pack_fails_before_any_upload_or_url_stamp(tmp_path):
    questions = [{"id": "q1", "qid": "Q1", "segments": {
        "question_audio_text": "Read me."}, "audio_url": None}]
    storage_path = mod.tts_audio.audio_path("Read me.", "bf_emma", mod.ENGINE)
    pack = tmp_path / "broken.zip"
    with zipfile.ZipFile(pack, "w") as archive:
        archive.writestr(storage_path, b"")
        archive.writestr("manifest.json", json.dumps({
            "engine": "kokoro",
            "items": [{"storage_path": storage_path, "text": "Read me.",
                       "voice": "bf_emma"}],
        }))

    with patch.object(mod, "_bank", return_value={"id": "b1", "code": "C1-B06"}), \
         patch.object(mod, "_question_rows", return_value=questions), \
         patch.object(mod.tts_audio, "upload_mp3") as upload, \
         patch.object(mod.supabase_admin, "table") as table, \
         patch.object(sys, "argv", [
             "prog", "--bank", "C1-B06", "--tts-pack", str(pack), "--commit",
         ]):
        with pytest.raises(SystemExit):
            mod.main()
    upload.assert_not_called()
    table.assert_not_called()


def test_dry_run_never_calls_kokoro_or_writes():
    questions = [{"id": "q1", "qid": "Q1", "segments": {
        "question_audio_text": "Read me."}, "audio_url": None}]
    with patch.object(mod, "_bank", return_value={"id": "b1", "code": "C1-B06"}), \
         patch.object(mod, "_question_rows", return_value=questions), \
         patch.object(mod.tts_audio, "synth_sync") as synth, \
         patch.object(mod.supabase_admin, "table") as table, \
         patch.object(sys, "argv", ["prog", "--bank", "C1-B06"]):
        assert mod.main() == 0
    synth.assert_not_called()
    table.assert_not_called()


def test_commit_reuses_cached_clip_and_stamps_the_question_url():
    questions = [{"id": "q1", "qid": "Q1", "segments": {
        "question_audio_text": "Read me."}, "audio_url": None}]
    updates = []

    class Query:
        def update(self, payload):
            self.payload = payload
            return self

        def eq(self, field, value):
            updates.append((field, value, self.payload))
            return self

        def execute(self):
            return type("Response", (), {"data": []})()

    with patch.object(mod, "_bank", return_value={"id": "b1", "code": "C1-B06"}), \
         patch.object(mod, "_question_rows", return_value=questions), \
         patch.object(mod.tts_audio, "audio_exists", return_value=True), \
         patch.object(mod.tts_audio, "public_url", return_value="https://cdn/read.mp3"), \
         patch.object(mod.tts_audio, "synth_sync") as synth, \
         patch.object(mod.supabase_admin, "table", return_value=Query()), \
         patch.object(sys, "argv", ["prog", "--bank", "C1-B06", "--commit"]):
        assert mod.main() == 0
    synth.assert_not_called()
    assert updates == [("id", "q1", {"audio_url": "https://cdn/read.mp3"})]
