from unittest.mock import MagicMock

import pytest

from scripts import backfill_personal_vocabulary_audio as repair


def fixture(monkeypatch, rows):
    db = MagicMock()
    select = db.table.return_value.select.return_value
    select.eq.return_value = select
    select.order.return_value = select
    select.range.return_value = select
    select.execute.return_value.data = rows
    update = db.table.return_value.update.return_value
    update.eq.return_value = update
    monkeypatch.setattr(repair, "validate_vocab_audio", lambda data: None)
    return db, update


def test_dry_run_checks_all_recordings_without_writing(monkeypatch):
    db, _ = fixture(monkeypatch, [{"id": "owned", "headword": "Keyboard", "audio_headword": ""}])
    read = MagicMock(return_value=b"prepared")
    result = repair.backfill(db, "https://target.supabase.co", read_audio=read)
    assert result == {"active_rows": 1, "verified_clips": 1, "updated": 0, "applied": False}
    assert "bf_emma" not in read.call_args.args[0]  # Content addressed, no word in public path.
    db.table.return_value.update.assert_not_called()


def test_missing_recording_blocks_all_updates(monkeypatch):
    rows = [{"id": str(i), "headword": text, "audio_headword": ""} for i, text in enumerate(["Keyboard", "Scenario"])]
    db, _ = fixture(monkeypatch, rows)
    with pytest.raises(FileNotFoundError):
        repair.backfill(db, "https://target.supabase.co", apply=True, read_audio=MagicMock(side_effect=[b"prepared", FileNotFoundError()]))
    db.table.return_value.update.assert_not_called()


def test_apply_stamps_only_audio_and_repeat_is_idempotent(monkeypatch):
    row = {"id": "owned", "headword": "Keyboard", "audio_headword": ""}
    db, update = fixture(monkeypatch, [row])
    target = "https://target.supabase.co/storage/v1/object/public/vocab-audio/" + repair.audio_path("Keyboard", "bf_emma", "kokoro")
    update.execute.return_value.data = [{**row, "audio_headword": target}]
    assert repair.backfill(db, "https://target.supabase.co", apply=True, read_audio=lambda _: b"prepared")["updated"] == 1
    db.table.return_value.update.assert_called_once_with({"audio_headword": target})
    assert ("headword", "Keyboard") in [c.args for c in update.eq.call_args_list]
    row["audio_headword"] = target
    db.table.return_value.update.reset_mock()
    assert repair.backfill(db, "https://target.supabase.co", apply=True, read_audio=lambda _: b"prepared")["updated"] == 0
    db.table.return_value.update.assert_not_called()


def test_concurrent_edit_cannot_receive_stale_audio(monkeypatch):
    db, update = fixture(monkeypatch, [{"id": "owned", "headword": "Keyboard", "audio_headword": ""}])
    update.execute.return_value.data = []
    with pytest.raises(RuntimeError, match="changed during repair"):
        repair.backfill(db, "https://target.supabase.co", apply=True, read_audio=lambda _: b"prepared")


def test_count_change_stops_before_audio_or_mutation(monkeypatch):
    db, _ = fixture(monkeypatch, [])
    read = MagicMock()
    with pytest.raises(ValueError, match="count changed"):
        repair.backfill(db, "https://target.supabase.co", expect_count=1, read_audio=read)
    read.assert_not_called()
    db.table.return_value.update.assert_not_called()
