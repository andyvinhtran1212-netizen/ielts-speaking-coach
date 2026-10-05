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
        assert result["variants"][-1]["synthetic"] is True
        assert result["variants"][-1]["variant_id"] == "kokoro-v1"
        originals += len(result["variants"]) == 2
        assert len(paths) == len(result["variants"])
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


def test_audio_route_authenticates_before_reading_package(monkeypatch):
    from routers import listening_source_collection as router
    async def deny(_):
        raise HTTPException(401, "unauthorized")
    monkeypatch.setattr(router, "get_supabase_user", deny)
    monkeypatch.setattr(router, "_context", lambda _: pytest.fail("unauthenticated package lookup"))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(router.get_source_audio(1, None))
    assert exc.value.status_code == 401


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
