"""Original clips cover source practice without publishing answer/timing evidence."""
from copy import deepcopy
import json
import pytest
from fastapi import HTTPException
from services import listening_source_question_audio as clips
from services.listening_source_audio import audio_catalog
from services.listening_source_native import revision
from services.listening_source_supplements import catalog as supplements


def test_all_original_covered_questions_have_clips_and_missing_audio_stays_explicit():
    content, audio = clips.clip_catalog(), audio_catalog()
    source_ids = {q['item_id'] for block in revision()['blocks'].values() for q in block['presentation']['questions']}
    missing = {q['item_id'] for q in supplements()['questions'] if q['day'] == 77 or (q['day'] == 76 and q['part_id'] not in {'80-days:day-76:part-1', '80-days:day-76:part-2'})}
    assert len(missing) == 61
    assert len(content['clips']) == 1615
    assert {row['item_id'] for row in content['clips']} == source_ids - missing
    for day in range(1, 81):
        package = {key: audio[key] for key in ('package_id', 'manifest_sha256')}
        projected = clips.question_clips(package, day, audio['days'][day-1]['original'], lambda _: None)
        assert len(projected) == len([row for row in content['clips'] if row['day'] == day])
        assert all(row['url'] is None and row['variant_id'] == 'original' for row in projected)
        assert not {'start', 'end', 'storage_path', 'source_sha256', 'local_file', 'answer', 'transcript'} & set().union(*(set(row) for row in projected))


@pytest.mark.parametrize('field,value', [('source_sha256', 'wrong'), ('storage_path', 'other.mp3'), ('start', -1), ('end', 999999), ('part_id', '80-days:day-02:part-1')])
def test_rejects_wrong_original_binding_before_signing(monkeypatch, field, value):
    content = deepcopy(clips.clip_catalog())
    content['clips'][0][field] = value
    monkeypatch.setattr(clips, 'clip_catalog', lambda: content)
    audio = audio_catalog()
    with pytest.raises(HTTPException) as error:
        clips.question_clips({key: audio[key] for key in ('package_id', 'manifest_sha256')}, 1, audio['days'][0]['original'], lambda _: pytest.fail('unbound clip signed'))
    assert error.value.status_code == 503


def test_upload_preflight_rejects_incomplete_inventory_before_files_or_writes(tmp_path, monkeypatch):
    from scripts import upload_listening_source_audio as uploader
    from services.listening_package_import import PackageValidationError
    content = deepcopy(clips.clip_catalog())
    content['clips'].pop()
    monkeypatch.setattr(clips, 'clip_catalog', lambda: content)
    with pytest.raises(PackageValidationError, match='Incomplete original question clip coverage'):
        uploader.validated_original_clips(tmp_path)


@pytest.mark.parametrize("item_id,first_word_start,last_word_end", [
    ("80-days:day-03:main:q-19", 143.4, 186.4),
    ("80-days:day-03:main:q-20", 155.1, 190.8),
    ("80-days:day-18:main:q-18", 130.0, 137.14),
    ("80-days:day-78:main:q-21", 572.4, 580.02),
])
def test_shared_context_retains_complete_spoken_turns(item_id, first_word_start, last_word_end):
    # These original-source landmarks were corroborated by independent raw-track
    # and actual-clip decoding; the previous crop lost a turn or ended mid-sentence.
    row = next(row for row in clips.clip_catalog()["clips"] if row["item_id"] == item_id)
    intervals = row.get("kept_intervals", [[row["start"], row["end"]]])
    assert intervals[0][0] <= first_word_start
    assert intervals[-1][1] >= last_word_end


def test_numbered_clip_excludes_next_question_after_removed_part_announcement():
    row = next(row for row in clips.clip_catalog()["clips"] if row["item_id"] == "80-days:day-01:main:q-15")
    assert len(row["kept_intervals"]) == 1
    assert row["end"] >= 90.94  # The final word 'shine' remains complete.
    assert row["end"] < 98.0  # Q16 belongs to the next source context.


def test_intrinsic_original_short_phrase_has_truthful_non_answer_note():
    row = next(row for row in clips.clip_catalog()["clips"] if row["item_id"] == "80-days:day-01:main:q-11")
    assert "chưa có trọn câu" in row["note_vi"]
    assert "English" not in row["note_vi"] and "Kokoro" not in row["note_vi"]


@pytest.mark.parametrize("item_id,announcement_end", [
    ("80-days:day-11:main:q-01", 8.6),
    ("80-days:day-15:main:q-01", 9.2),
])
def test_part_number_is_not_used_as_a_question_number(item_id, announcement_end):
    # Independent clip decoding found 'Part 1' where Q1 should start; the
    # spoken Part header must remain outside the question's playback window.
    row = next(row for row in clips.clip_catalog()["clips"] if row["item_id"] == item_id)
    assert row["kept_intervals"][0][0] >= announcement_end


def test_whole_original_retains_every_question_playback_interval():
    audio = audio_catalog()
    for row in clips.clip_catalog()['clips']:
        practice = audio['days'][row['day']-1]['original']['practice']['kept_intervals']
        for start, end in row.get('kept_intervals', [[row['start'], row['end']]]):
            assert any(whole_start <= start < end <= whole_end for whole_start, whole_end in practice), row['item_id']
