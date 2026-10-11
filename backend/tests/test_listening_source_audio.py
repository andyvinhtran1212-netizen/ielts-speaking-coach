"""Separate reviewed audio preserves source truth and the authenticated boundary."""
import asyncio
import json
from copy import deepcopy
import pytest
from fastapi import HTTPException
from services import listening_source_audio as audio


def package():
    catalog = audio.audio_catalog()
    return {key: catalog[key] for key in ("package_id", "manifest_sha256")}


def lesson(day):
    return {"sequence_num": day, "source_lesson_id": f"80-days:day-{day:02d}"}


def test_all_days_have_new_audio_and_original_gaps_remain_truthful():
    originals = 0
    for day in range(1, 81):
        paths = []
        def signer(path):
            paths.append(path)
            return "https://private.example/signed"
        result = audio.audio_response(package(), lesson(day), signer)
        assert result["day"] == day
        assert result["variants"][-1]["label_vi"] == "Bản luyện nghe"
        assert "Kokoro" not in result["variants"][-1]["label_vi"]
        assert "tổng hợp" not in result["variants"][-1]["note_vi"]
        assert result["variants"][-1]["synthetic"] is True
        assert result["variants"][-1]["variant_id"] == "kokoro-v1"
        originals += len(result["variants"]) == 2
        from services.listening_source_question_audio import clip_catalog
        clip_paths = {row['storage_path'] for row in clip_catalog()['clips'] if row['day'] == day}
        assert len(paths) == len(result["variants"]) + len(clip_paths)
        assert all(path.startswith(f"source-collections/{package()['package_id']}/{package()['manifest_sha256']}/") for path in paths)
        text = json.dumps(result)
        assert all(f'"{secret}"' not in text for secret in ("storage_path", "source_sha256", "role_map", "transcript", "answer"))
    assert originals == 69
    assert len(audio.audio_response(package(), lesson(77), lambda _: None)["variants"]) == 1
    vocab = audio.audio_response(package(), lesson(61), lambda _: None)["variants"][0]
    assert "từ vựng tiếng Anh" in vocab["note_vi"] and "không phải hội thoại" in vocab["note_vi"]
    original76 = audio.audio_response(package(), lesson(76), lambda _: None)["variants"][0]
    assert "Section 1–2" in original76["note_vi"]


@pytest.mark.parametrize("mutation", [
    lambda p, l: p.update(manifest_sha256="another-revision"),
    lambda p, l: p.update(package_id="another-package"),
    lambda p, l: l.update(source_lesson_id="80-days:day-02"),
    lambda p, l: l.update(sequence_num=81),
])
def test_wrong_source_never_signs(mutation):
    p, l = package(), lesson(1)
    mutation(p, l)
    def signer(_):
        pytest.fail("must not sign unbound source")
    with pytest.raises(HTTPException):
        audio.audio_response(p, l, signer)


def test_unavailable_storage_is_not_reported_playable():
    result = audio.audio_response(package(), lesson(1), lambda _: None)
    assert all(row["url"] is None for row in result["variants"])


def test_original_playback_uses_edited_audio_without_rebinding_question_source():
    from services.listening_source_question_audio import clip_catalog
    for row in audio.audio_catalog()["days"]:
        if not (original := row["original"]):
            continue
        playback = original["practice"]
        paths = []
        result = audio.audio_response(package(), lesson(row["day"]), lambda path: paths.append(path))
        assert paths[0] == playback["storage_path"]
        assert result["variants"][0]["duration_seconds"] == playback["duration_seconds"]
        assert playback["duration_seconds"] < original["duration_seconds"]
        assert all(clip["source_sha256"] == original["sha256"] for clip in clip_catalog()["clips"] if clip["day"] == row["day"])


@pytest.mark.parametrize("field,value", [("storage_path", "unbound.mp3"), ("kept_intervals", [[0, 999999]]), ("duration_seconds", 1)])
def test_invalid_edited_original_binding_is_rejected(tmp_path, monkeypatch, field, value):
    catalog = deepcopy(audio.audio_catalog())
    catalog["days"][0]["original"]["practice"][field] = value
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(catalog))
    monkeypatch.setattr(audio, "CATALOG_PATH", path)
    audio.audio_catalog.cache_clear()
    try:
        with pytest.raises(ValueError, match="practice audio binding"):
            audio.audio_catalog()
    finally:
        audio.audio_catalog.cache_clear()


def test_editing_announcements_preserves_complete_numbered_sentences():
    from services.listening_source_question_audio import clip_catalog
    clips = {row["item_id"]: row for row in clip_catalog()["clips"]}
    # The false trailing '2.' in Day 20 ASR must not replace the actual Q2.
    q2 = clips["80-days:day-20:main:q-02"]
    q3 = clips["80-days:day-20:main:q-03"]
    assert q2["start"] == 14.22 and q2["end"] == 19.24
    assert q2["end"] < q3["start"] and q2["duration_seconds"] > 4.5
    # Day 33 Q1 continues after the first ASR segment, through 'review the
    # previous lesson'; cutting at the first segment would omit that sentence.
    assert clips["80-days:day-33:main:q-01"]["end"] >= 42.26
    # Day 2's previously omitted first five numbers must precede Q6.
    first = [clips[f"80-days:day-02:main:q-{number:02d}"] for number in range(1, 7)]
    assert all(left["start"] < right["start"] for left, right in zip(first, first[1:]))


def test_audio_route_authenticates_before_reading_package(monkeypatch):
    from routers import listening_source_collection as router
    async def deny(_):
        raise HTTPException(401, "unauthorized")
    monkeypatch.setattr(router, "get_supabase_user", deny)
    monkeypatch.setattr(router, "_context", lambda _: pytest.fail("unauthenticated package lookup"))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(router.get_source_audio(1, None))
    assert exc.value.status_code == 401


def test_audio_route_batch_signs_only_bound_paths_and_preserves_partial_failure(monkeypatch):
    from types import SimpleNamespace
    from routers import listening_source_collection as router
    calls = []
    async def allow(_): return {'id': 'learner'}
    def sign(paths, expiry):
        calls.append((paths, expiry))
        assert len(paths) == len(set(paths))
        return [{'path': path, 'signedURL': 'https://private.example/' + str(i)}
                if i else {'path': path, 'error': 'unavailable'} for i, path in enumerate(paths)] + [
                    {'path': 'unrequested.mp3', 'signedURL': 'https://unbound.example'}]
    monkeypatch.setattr(router, 'get_supabase_user', allow)
    monkeypatch.setattr(router, '_context', lambda _: (package(), [lesson(1)]))
    monkeypatch.setattr(router, 'supabase_admin', SimpleNamespace(storage=SimpleNamespace(from_=lambda _: SimpleNamespace(create_signed_urls=sign))))
    result = asyncio.run(router.get_source_audio(1, 'Bearer learner'))
    assert len(calls) == 1 and calls[0][1] == 7200
    assert result['variants'][0]['url'] is None
    assert result['question_clips'] and all(row['url'] for row in result['question_clips'])
    assert 'unbound.example' not in json.dumps(result)


def test_upload_preflight_rejects_tampering_before_upload(tmp_path, monkeypatch):
    import hashlib
    from scripts import upload_listening_source_audio as uploader
    from services.listening_package_import import PackageValidationError
    catalog = deepcopy(audio.audio_catalog())
    data = b"reviewed audio fixture"
    digest = hashlib.sha256(data).hexdigest()
    for row in catalog["days"]:
        (tmp_path / f"day-{row['day']:02d}.mp3").write_bytes(data)
        row["kokoro"]["sha256"] = digest
        row["kokoro"]["storage_path"] = f"source-collections/{catalog['package_id']}/{catalog['manifest_sha256']}/variants/kokoro-v1/{digest}.mp3"
    monkeypatch.setattr(uploader, "audio_catalog", lambda: catalog)
    assert len(uploader.validated_assets(tmp_path)) == 80
    (tmp_path / 'day-80.mp3').write_bytes(b"tampered")
    with pytest.raises(PackageValidationError, match="hash mismatch Day 80"):
        uploader.validated_assets(tmp_path)
