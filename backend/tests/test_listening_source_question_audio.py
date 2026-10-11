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
