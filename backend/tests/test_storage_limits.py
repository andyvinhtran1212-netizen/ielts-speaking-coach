"""STORAGELIMITS-0038: offline upload boundaries and real route error transport."""
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
import asyncio
import hashlib
import threading

import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.testclient import TestClient
from starlette.datastructures import Headers
from storage3.exceptions import StorageApiError

from services import storage_limits as limits

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 300
GIF = b"GIF89a" + b"\0" * 300
EXPECTED = {
    "audio-responses": (52428800, ("audio/*", "video/webm", "video/mp4", "application/octet-stream")),
    "listening-audio": (134217728, ("audio/*", "image/png", "image/jpeg", "image/webp", "image/svg+xml", "application/json")),
    "listening-images": (10485760, ("image/png", "image/jpeg", "image/webp")),
    "reading-images": (5242880, ("image/png", "image/jpeg", "image/webp")),
    "writing-images": (5242880, ("image/png", "image/jpeg", "image/webp")),
    "vocab-audio": (5242880, ("audio/mpeg",)),
}


def assert_refusal(exc, status, bucket, maximum=None):
    assert exc.status_code == status
    detail = exc.detail
    assert detail["error_code"] == ("file_too_large" if status == 413 else "unsupported_media_type")
    assert isinstance(detail["message"], str) and any(ord(c) > 127 for c in detail["message"])
    if status == 413:
        assert detail["max_bytes"] == (maximum or EXPECTED[bucket][0])
    else:
        assert detail["allowed"] == list(EXPECTED[bucket][1])


def refusal(status):
    return StorageApiError("The object exceeded the maximum allowed size" if status == 413
                           else "mime type image/gif is not supported", "PayloadTooLarge" if status == 413
                           else "InvalidMimeType", status if status == 413 else 400)


def upload_file(data, filename="image.png", content_type="image/png"):
    return UploadFile(BytesIO(data), filename=filename, headers=Headers({"content-type": content_type}))


@pytest.mark.parametrize("bucket", EXPECTED)
def test_policy_boundaries_and_wrong_types(bucket):
    assert limits.BUCKET_LIMITS == EXPECTED
    maximum, types = EXPECTED[bucket]
    for content_type in types:
        limits.check_upload(bucket, maximum, content_type.replace("*", "x-custom") + ";codecs=opus")
    with pytest.raises(HTTPException) as exc:
        limits.check_upload(bucket, maximum + 1, types[0].replace("*", "mpeg"))
    assert_refusal(exc.value, 413, bucket)
    with pytest.raises(HTTPException) as exc:
        limits.check_upload(bucket, 300, "text/plain")
    assert_refusal(exc.value, 415, bucket)


@pytest.mark.parametrize("bucket,size,mime", [
    ("audio-responses", 2944342, "audio/webm"), ("listening-audio", 31138002, "audio/mpeg"),
    ("listening-images", 332088, "image/png"), ("reading-images", 739379, "image/png"),
    ("writing-images", 98403, "image/png"), ("vocab-audio", 51404, "audio/mpeg"),
])
def test_t001_census_maxima_remain_valid(bucket, size, mime):
    limits.check_upload(bucket, size, mime)


@pytest.mark.parametrize("status", [413, 415])
@pytest.mark.parametrize("bucket", EXPECTED)
def test_storage_sdk_refusals_have_same_public_contract(bucket, status):
    mapped = limits.map_storage_error(bucket, refusal(status))
    assert_refusal(mapped, status, bucket)
    assert bucket in str(mapped) and "max_bytes" in str(mapped)


def test_http_refusals_and_unrelated_storage_errors():
    for status in (413, 415):
        exc = RuntimeError("Storage refused")
        exc.response = SimpleNamespace(status_code=status)
        assert_refusal(limits.map_storage_error("writing-images", exc), status, "writing-images")
    assert limits.map_storage_error("writing-images", RuntimeError("bucket not found")) is None
    assert limits.map_storage_error("writing-images", RuntimeError("permission denied")) is None
    upload = MagicMock(side_effect=refusal(413))
    with pytest.raises(HTTPException) as exc:
        limits.upload_with_error_mapping("writing-images", upload, "x", PNG, {})
    assert_refusal(exc.value, 413, "writing-images")
    upload.assert_called_once_with("x", PNG, {})


@pytest.fixture
def images(monkeypatch):
    from routers import admin_reading, admin_writing_prompts, listening
    import database
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [{"test_id": "test"}]
    db.storage.from_.return_value.create_signed_urls.side_effect = lambda paths, ttl: [{"path": path, "signedURL": "https://storage.test/signed"} for path in paths]
    db.storage.from_.return_value.create_signed_url.return_value = {"signedURL": "https://storage.test/signed"}
    for module in (admin_reading, admin_writing_prompts, listening):
        monkeypatch.setattr(module, "require_admin", AsyncMock(return_value={"id": "admin"}))
        monkeypatch.setattr(module, "supabase_admin", db)
    monkeypatch.setattr(database, "supabase_admin", db)
    monkeypatch.setattr(admin_reading, "_fetch_question_or_404", lambda _: {"id": "question", "passage_id": "passage", "payload": {}})
    monkeypatch.setattr(admin_reading, "_resolve_test_id_for_question", lambda _: "test")
    monkeypatch.setattr(listening, "_fetch_exercise_or_404", lambda _: {"content_id": "content", "payload": {"variant": "mcq_letter_label"}})
    app = FastAPI()
    app.include_router(admin_reading.questions_router)
    app.include_router(admin_writing_prompts.router)
    app.include_router(listening.admin_router)
    return TestClient(app), db


@pytest.mark.parametrize("bucket,path,field", [
    ("writing-images", "/admin/writing/prompts/upload-image", "file"),
    ("reading-images", "/admin/reading/questions/question/upload-diagram-image", "image_file"),
    ("listening-images", "/admin/listening/exercises/exercise/upload-map-image", "image_file"),
])
@pytest.mark.parametrize("case", ["oversize", "wrong_magic", "storage_size", "storage_mime", "boundary"])
def test_image_routes_reject_before_upload_or_map_storage_refusal(images, bucket, path, field, case):
    client, db = images
    upload = db.storage.from_.return_value.upload
    maximum = 5 * 1024 * 1024
    data = PNG.ljust(maximum + 1, b"\0") if case == "oversize" else GIF if case == "wrong_magic" else PNG
    if case == "boundary":
        data = PNG.ljust(maximum, b"\0")
    if case.startswith("storage_"):
        upload.side_effect = refusal(413 if case == "storage_size" else 415)
    response = client.post(path, files={field: ("image.png", data, "image/png")}, headers={"Authorization": "Bearer test"})
    if case == "boundary":
        assert response.status_code in (200, 201), response.text
        upload.assert_called_once()
        assert upload.call_args.args[2]["content-type"] == "image/png"
    else:
        status = 413 if case in ("oversize", "storage_size") else 415
        assert_refusal(SimpleNamespace(status_code=response.status_code, detail=response.json()["detail"]), status, bucket,
                       maximum if case == "oversize" else None)
        if case in ("oversize", "wrong_magic"):
            upload.assert_not_called()
        else:
            upload.assert_called_once()
        db.table.return_value.update.assert_not_called()


@pytest.mark.parametrize("service,bucket", [("listening", "listening-audio"), ("tts", "vocab-audio"), ("package", "listening-audio")])
@pytest.mark.parametrize("case", ["oversize", "storage_size", "storage_mime", "boundary"])
def test_audio_upload_services(monkeypatch, service, bucket, case):
    from routers import listening
    from services import tts_audio, listening_package_import
    db = MagicMock()
    storage = db.storage.from_.return_value
    storage.download.side_effect = RuntimeError("not found")
    monkeypatch.setattr(listening, "supabase_admin", db)
    monkeypatch.setattr(tts_audio, "supabase_admin", db)
    monkeypatch.setattr(tts_audio, "validate_vocab_audio", lambda _: None)
    if case.startswith("storage_"):
        storage.upload.side_effect = refusal(413 if case == "storage_size" else 415)
    size = EXPECTED[bucket][0] + (case == "oversize") if case in ("oversize", "boundary") else 300
    data = b"x" * size
    if service == "package" and case == "boundary":
        storage.download.side_effect = [RuntimeError("not found"), data]
    def run():
        if service == "listening":
            return listening._upload_audio_to_bucket("audio.mp3", data)
        if service == "tts":
            return tts_audio.upload_mp3("audio.mp3", data)
        return listening_package_import._ensure_immutable_object(storage, "audio.mp3", data, "audio/mpeg")
    if case == "boundary":
        run()
        storage.upload.assert_called_once()
    else:
        with pytest.raises(HTTPException) as exc:
            run()
        assert_refusal(exc.value, 415 if case == "storage_mime" else 413, bucket)
        assert storage.upload.call_count == (0 if case == "oversize" else 1)


@pytest.mark.parametrize("status", [413, 415])
def test_source_import_refusal_stops_before_database_commit(monkeypatch, tmp_path, status):
    from services import listening_source_package_import as source
    path = tmp_path / "audio.mp3"
    path.write_bytes(b"audio")
    db = MagicMock()
    db.storage.from_.return_value.download.side_effect = RuntimeError("not found")
    db.storage.from_.return_value.upload.side_effect = refusal(status)
    plan = source.SourceImportPlan({}, [], [], [], [{"local_path": str(path), "sha256": hashlib.sha256(b"audio").hexdigest(),
        "size_bytes": 5, "storage_path": "audio.mp3", "content_type": "audio/mpeg"}], {})
    with pytest.raises(HTTPException) as exc:
        source.commit_source_import_plan(plan, db, bucket_name="listening-audio")
    assert_refusal(exc.value, status, "listening-audio")
    db.rpc.assert_not_called()


def test_package_unknown_mime_stops_before_storage():
    from services.listening_package_import import _ensure_immutable_object
    bucket = MagicMock()
    with pytest.raises(HTTPException) as exc:
        _ensure_immutable_object(bucket, "asset.mp3", b"audio", "application/octet-stream")
    assert_refusal(exc.value, 415, "listening-audio")
    bucket.upload.assert_not_called()
    bucket.download.assert_not_called()


@pytest.fixture
def speaking(monkeypatch):
    from routers import grading
    from test_admin_speaking_sessions import _DB
    session = {"id": "session", "user_id": "user", "part": 1, "status": "in_progress", "mode": "practice",
               "resume_expires_at": "2099-01-01T00:00:00Z", "renderer_affinity": "next"}
    question = {"id": "question", "session_id": "session", "question_text": "Synthetic question"}
    db = _DB(sessions=[session], questions=[question], responses=[])
    db.storage = MagicMock()
    async def execute(builder):
        return builder(db).execute()
    monkeypatch.setattr(grading, "supabase_admin", db)
    monkeypatch.setattr(grading, "get_supabase_user", AsyncMock(return_value={"id": "user"}))
    monkeypatch.setattr(grading, "aexecute", execute)
    monkeypatch.setattr(grading, "require_speaking_entitlement", lambda *_: None)
    monkeypatch.setattr(grading, "enforce_grading_rate_limit", lambda *_: None)
    monkeypatch.setattr(grading, "record_grading_attempt", lambda *_: None)
    monkeypatch.setattr(grading, "note_owned_speaking_audio", AsyncMock())
    stt = AsyncMock(return_value={"transcript": "Synthetic recording", "duration_seconds": 10})
    monkeypatch.setattr(grading, "transcribe_from_bytes", stt)
    monkeypatch.setattr(grading.claude_grader, "grade_response", AsyncMock())
    whisper_usage = MagicMock(return_value="whisper-usage")
    monkeypatch.setattr(grading.ai_usage_logger, "log_whisper_async", whisper_usage)
    monkeypatch.setattr(grading.ai_usage_logger, "schedule_usage_log", MagicMock())
    def run(data, mime="audio/webm", name="recording.webm"):
        return asyncio.run(grading.grade_response_endpoint("session", "question", upload_file(data, name, mime),
                                                          submission_id=None, expected_revision=None))
    return SimpleNamespace(run=run, db=db, stt=stt, grader=grading.claude_grader.grade_response,
                           whisper_usage=whisper_usage, schedule=grading.ai_usage_logger.schedule_usage_log)


def test_speaking_size_rejected_before_transcription(speaking):
    with pytest.raises(HTTPException) as exc:
        speaking.run(b"x" * (52428800 + 1))
    assert_refusal(exc.value, 413, "audio-responses")
    assert exc.value.detail["message"] == "File quá lớn (50.0 MB). Giới hạn là 50 MB."
    speaking.stt.assert_not_called()
    speaking.db.storage.from_.return_value.upload.assert_not_called()


@pytest.mark.parametrize("status", [413, 415])
def test_speaking_storage_refusal_returns_error_without_grading(speaking, status):
    speaking.db.storage.from_.return_value.upload.side_effect = refusal(status)
    with pytest.raises(HTTPException) as exc:
        speaking.run(b"audio")
    assert_refusal(exc.value, status, "audio-responses")
    speaking.stt.assert_awaited_once()
    # The paid Whisper call is still recorded (AI-0004) although grading stops.
    speaking.whisper_usage.assert_called_once()
    assert speaking.whisper_usage.call_args.kwargs["feature"] == "speaking_stt"
    assert speaking.whisper_usage.call_args.kwargs["audio_seconds"] == 10
    speaking.schedule.assert_called_once_with("whisper-usage")
    speaking.grader.assert_not_called()
    assert speaking.db.responses == []


@pytest.mark.parametrize("mime,name,expected", [
    ("audio/webm;codecs=opus", "take.webm", "audio/webm"), ("audio/x-custom", "take.webm", "audio/x-custom"),
    ("video/mp4", "take.mp4", "video/mp4"), ("application/octet-stream", "take.webm", "application/octet-stream"),
    ("text/plain", "take.wav", "audio/wav"), ("", "take.mp3", "audio/mpeg"),
    ("unknown/type", "take.unknown", "audio/webm"),
])
def test_speaking_normalises_without_losing_accepted_recordings(speaking, mime, name, expected):
    class UploadReached(BaseException):
        pass
    main_thread = threading.get_ident()
    upload_threads = []
    def stop(**kwargs):
        assert kwargs["file_options"]["content-type"] == expected
        upload_threads.append(threading.get_ident())
        raise UploadReached()
    speaking.db.storage.from_.return_value.upload.side_effect = stop
    with pytest.raises(UploadReached):
        speaking.run(b"x" * 52428800, mime, name)
    assert upload_threads and upload_threads[0] != main_thread


@pytest.mark.parametrize("kind,maximum", [("full", 100 * 1024 * 1024), ("section", 30 * 1024 * 1024)])
@pytest.mark.parametrize("case", ["oversize", "wrong_type", "storage_size", "storage_mime", "boundary"])
def test_listening_audio_routes(monkeypatch, kind, maximum, case):
    from routers import listening
    from services import listening_audio
    monkeypatch.setattr(listening, "require_admin", AsyncMock(return_value={"id": "admin"}))
    monkeypatch.setattr(listening, "_fetch_test_or_404", lambda _: {"audio_assembly_mode": "full_premixed"})
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [{"id": "section"}]
    monkeypatch.setattr(listening, "supabase_admin", db)
    validator = MagicMock(return_value={"errors": [], "duration_seconds": 500, "size_bytes": maximum, "warnings": []})
    monkeypatch.setattr(listening_audio, f"validate_{kind}_audio", validator)
    upload = db.storage.from_.return_value.upload
    if case.startswith("storage_"):
        upload.side_effect = refusal(413 if case == "storage_size" else 415)
    data = b"x" * (maximum + 1) if case == "oversize" else b"x" * maximum if case == "boundary" else b"audio"
    audio = upload_file(data, "bad.txt" if case == "wrong_type" else "audio.mp3", "text/plain" if case == "wrong_type" else "audio/mpeg")
    async def run():
        if kind == "full":
            return await listening.admin_upload_test_full_audio("test", audio)
        return await listening.admin_upload_test_section_audio("test", 1, audio)
    if case == "boundary":
        asyncio.run(run())
        upload.assert_called_once()
    else:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(run())
        status = 415 if case in ("wrong_type", "storage_mime") else 413
        assert_refusal(exc.value, status, "listening-audio", maximum if case == "oversize" else None)
        assert upload.call_count == (0 if case in ("oversize", "wrong_type") else 1)
        db.table.return_value.update.assert_not_called()


@pytest.mark.parametrize("status", [413, 415])
def test_legacy_sdk_payload_and_http_exception_are_structured(status):
    old_sdk = RuntimeError({"statusCode": status, "error": "PayloadTooLarge" if status == 413 else "InvalidMimeType", "message": "Storage refused"})
    for exc in (old_sdk, HTTPException(status, "Storage refused")):
        assert_refusal(limits.map_storage_error("writing-images", exc), status, "writing-images")


@pytest.mark.parametrize("case", ["oversize", "storage_size", "storage_mime", "boundary"])
def test_background_renderer_records_refusal_without_success(monkeypatch, case):
    from services import listening_renderer as renderer
    size = 134217728 + (case == "oversize") if case in ("oversize", "boundary") else 300
    data = b"x" * size
    monkeypatch.setattr(renderer, "_call_with_retry", lambda *args, **kwargs: (data, None))
    db = MagicMock()
    monkeypatch.setattr(renderer, "supabase_admin", db)
    failed = MagicMock()
    monkeypatch.setattr(renderer, "_mark_render_failed", failed)
    if case.startswith("storage_"):
        db.storage.from_.return_value.upload.side_effect = refusal(413 if case == "storage_size" else 415)
    renderer.run_elevenlabs_render_job(job_id="job", script_text="Synthetic", voice_id="voice", model="model", title="title",
        accent_tag="other", cefr_level=None, ielts_section=None, topic_tags=None, transcript=None, created_by_user_id="admin")
    if case == "boundary":
        failed.assert_not_called()
        db.storage.from_.return_value.upload.assert_called_once()
        db.table.return_value.update.assert_called_once()
    else:
        failed.assert_called_once()
        reason = failed.call_args.args[1]
        assert "listening-audio" in reason and "max_bytes" in reason
        assert ("unsupported_media_type" if case == "storage_mime" else "file_too_large") in reason
        assert db.storage.from_.return_value.upload.call_count == (0 if case == "oversize" else 1)
        db.table.return_value.update.assert_not_called()


@pytest.mark.parametrize("route,maximum", [("fulltest", 60 * 1024 * 1024), ("drill", 30 * 1024 * 1024), ("sync", 30 * 1024 * 1024)])
@pytest.mark.parametrize("case", ["oversize", "wrong_type"])
def test_listening_import_upload_guards(monkeypatch, route, maximum, case):
    from routers import listening
    monkeypatch.setattr(listening, "require_admin", AsyncMock(return_value={"id": "admin"}))
    monkeypatch.setattr(listening, "_read_text_upload", lambda *a, **kw: b"synthetic")
    monkeypatch.setattr(listening, "_read_json_upload", lambda *a, **kw: {})
    db = MagicMock()
    monkeypatch.setattr(listening, "supabase_admin", db)
    audio = upload_file(b"x" * (maximum + 1) if case == "oversize" else b"audio",
                        "bad.txt" if case == "wrong_type" else "audio.mp3")
    text = upload_file(b"synthetic")
    async def run():
        if route == "fulltest":
            return await listening.admin_import_fulltest_commit(text, text, text, audio, mini=False)
        if route == "drill":
            return await listening.admin_import_drill_commit(text, text, text, audio)
        return await listening.admin_sync_drill("drill", text, text, text, audio)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(run())
    assert_refusal(exc.value, 413 if case == "oversize" else 415, "listening-audio", maximum)
    db.storage.from_.return_value.upload.assert_not_called()
    db.table.return_value.insert.assert_not_called()
