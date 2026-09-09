"""Private-bucket compatibility, fail-closed playback and ownership regressions."""
import asyncio
import ast
import inspect
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent))
from config import settings
from routers import admin, grading, pronunciation, sessions
from services import recording_audio as audio

PATH = "user/session/question.webm"


def legacy(path=PATH, access="public"):
    return f"{settings.SUPABASE_URL}/storage/v1/object/{access}/audio-responses/{path}"


@pytest.mark.parametrize("access", ["public", "sign", "authenticated"])
def test_current_origin_legacy_paths(access):
    assert audio.recording_path({"audio_url": legacy(access=access) + "?token=old"}) == PATH


@pytest.mark.parametrize("path", ["../other", "/absolute", "x/../y", "x//y", "x/./y",
                                     "x/%2e%2e/y", "x\\y", "x?token=a", "x#fragment", "x\ny"])
def test_invalid_canonical_path_does_not_fall_back(path):
    assert audio.recording_path({"audio_storage_path": path, "audio_url": legacy()}) is None


@pytest.mark.parametrize("url", [
    "https://foreign.example/storage/v1/object/public/audio-responses/x",
    "http://127.0.0.1/internal", "file:///private", "//example.supabase.co/x",
    "https://example.supabase.co@foreign.example/storage/v1/object/public/audio-responses/x",
])
def test_untrusted_legacy_urls_are_not_download_targets(url):
    assert audio.recording_path({"audio_url": url}) is None


@pytest.mark.parametrize("path", ["%2e%2e/secret", "%252e%252e/secret", "x%5cy", "x%00y"])
def test_encoded_legacy_traversal_is_rejected(path):
    assert audio.recording_path({"audio_url": legacy(path)}) is None


def test_wrong_bucket_rejected_and_canonical_path_wins():
    assert audio.recording_path({"audio_url": legacy().replace("audio-responses", "other")}) is None
    assert audio.recording_path({"audio_storage_path": PATH, "audio_url": "https://evil.test"}) == PATH


class Storage:
    def __init__(self, fail=False, missing=()):
        self.calls = []
        self.fail = fail
        self.missing = missing

    def from_(self, bucket):
        assert bucket == "audio-responses"
        return self

    def create_signed_urls(self, paths, ttl):
        self.calls.append((paths, ttl))
        if self.fail:
            raise RuntimeError("private object name and signed token must not be logged")
        return [{"path": p, "signedUrl": f"https://signed.test/{p}", "error": None}
                for p in paths if p not in self.missing]

    def download(self, path):
        self.calls.append(path)
        if self.fail:
            raise RuntimeError("storage offline")
        return b"synthetic audio bytes"


def test_batch_signs_both_shapes_without_persisting_or_public_fallback():
    store = Storage()
    rows = [{"audio_storage_path": PATH}, {"audio_url": legacy()}, {}]
    assert asyncio.run(audio.attach_playback_urls(SimpleNamespace(storage=store), rows))
    assert store.calls == [([PATH], 3600)]
    assert rows[0]["audio_url"] == rows[1]["audio_url"] == f"https://signed.test/{PATH}"
    assert rows[1]["audio_available"] and not rows[2]["audio_available"]
    assert not rows[2]["audio_lookup_failed"]


@pytest.mark.parametrize("fail,missing", [(True, ()), (False, (PATH,))])
def test_signing_failure_masks_every_persisted_url(fail, missing, caplog):
    rows = [{"audio_url": legacy(), "audio_storage_path": PATH}]
    assert not asyncio.run(audio.attach_playback_urls(SimpleNamespace(storage=Storage(fail, missing)), rows))
    assert rows[0]["audio_url"] is None
    assert rows[0]["audio_playback_url"] is None
    assert rows[0]["audio_lookup_failed"] is True
    assert "signed token" not in caplog.text


def test_batch_limit():
    store = Storage()
    rows = [{"audio_storage_path": f"u/s/{i}.webm"} for i in range(205)]
    assert asyncio.run(audio.attach_playback_urls(SimpleNamespace(storage=store), rows))
    assert [len(paths) for paths, _ttl in store.calls] == [100, 100, 5]


class Query:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *args): return self
    def limit(self, *args): return self
    def order(self, *args): return self

    def eq(self, field, value):
        self.rows = [r for r in self.rows if r.get(field) == value]
        return self

    def execute(self):
        return SimpleNamespace(data=[dict(r) for r in self.rows])


class DB:
    def __init__(self, owner="owner", fail=False, sealed=False):
        self.storage = Storage(fail)
        self.rows = {
            "sessions": [{"id": "s", "user_id": owner, "mode": "practice",
                          "status": "completed", "sitting_id": "sitting" if sealed else None}],
            "responses": [{"id": "r", "session_id": "s", "question_id": "q", "audio_url": legacy()}],
            "questions": [],
        }

    def table(self, name): return Query(self.rows.get(name, []))


@pytest.fixture
def authenticated(monkeypatch):
    async def user(_authorization): return {"id": "owner"}
    monkeypatch.setattr(sessions, "get_supabase_user", user)
    monkeypatch.setattr(admin, "require_admin", user)
    monkeypatch.setattr(sessions, "compute_expiry", lambda _session: {})


def test_owner_audio_endpoint_signs_legacy_recording(monkeypatch, authenticated):
    db = DB()
    monkeypatch.setattr(sessions, "supabase_admin", db)
    result = asyncio.run(sessions.get_session_audio_urls("s", "token"))
    assert result == [{"response_id": "r", "question_id": "q", "url": f"https://signed.test/{PATH}", "expires_in": 3600}]
    assert db.rows["responses"][0]["audio_url"] == legacy()  # no persistence writes


def test_other_owner_rejected_before_storage(monkeypatch, authenticated):
    db = DB(owner="someone-else")
    monkeypatch.setattr(sessions, "supabase_admin", db)
    for request in (sessions.get_session_audio_urls("s", "token"),
                    sessions.get_session("s", BackgroundTasks(), "token")):
        with pytest.raises(HTTPException) as error:
            asyncio.run(request)
        assert error.value.status_code == 404
    assert db.storage.calls == []


def test_no_auth_rejected_before_storage(monkeypatch):
    async def deny(_authorization): raise HTTPException(401, "no auth")
    db = DB()
    monkeypatch.setattr(sessions, "get_supabase_user", deny)
    monkeypatch.setattr(admin, "require_admin", deny)
    monkeypatch.setattr(sessions, "supabase_admin", db)
    monkeypatch.setattr(admin, "supabase_admin", db)
    for request in (sessions.get_session_audio_urls("s", None), admin.admin_get_session("s", None)):
        with pytest.raises(HTTPException) as error:
            asyncio.run(request)
        assert error.value.status_code == 401
    assert db.storage.calls == []


def test_sign_failure_returns_503_not_public_url(monkeypatch, authenticated):
    monkeypatch.setattr(sessions, "supabase_admin", DB(fail=True))
    with pytest.raises(HTTPException) as error:
        asyncio.run(sessions.get_session_audio_urls("s", "token"))
    assert error.value.status_code == 503


def test_one_bad_reference_does_not_hide_other_recordings(monkeypatch, authenticated):
    db = DB()
    db.rows["responses"].append({"id": "bad", "session_id": "s", "question_id": "q2",
                                  "audio_storage_path": "../not-a-path"})
    monkeypatch.setattr(sessions, "supabase_admin", db)
    items = asyncio.run(sessions.get_session_audio_urls("s", "token"))
    assert len(items) == 1 and items[0]["response_id"] == "r"


def test_sdk_null_signed_url_does_not_poison_the_batch():
    class OlderStorage(Storage):
        def create_signed_urls(self, paths, ttl):
            raise TypeError("signedURL None is not subscriptable")

        def create_signed_url(self, path, ttl):
            self.calls.append(path)
            if path == "missing.webm": raise RuntimeError("not found")
            return {"signedURL": "https://signed.test/good"}

    store = OlderStorage()
    rows = [{"audio_storage_path": PATH}, {"audio_storage_path": "missing.webm"}]
    assert not asyncio.run(audio.attach_playback_urls(SimpleNamespace(storage=store), rows))
    assert rows[0]["audio_url"] == "https://signed.test/good"
    assert rows[1]["audio_url"] is None and rows[1]["audio_lookup_failed"]
    assert set(store.calls) == {PATH, "missing.webm"}


@pytest.mark.parametrize("fail", [False, True])
def test_student_and_admin_detail_do_not_leak_persisted_url(monkeypatch, authenticated, fail):
    db = DB(fail=fail)
    monkeypatch.setattr(sessions, "supabase_admin", db)
    monkeypatch.setattr(admin, "supabase_admin", db)
    student = asyncio.run(sessions.get_session("s", BackgroundTasks(), "token"))
    staff = asyncio.run(admin.admin_get_session("s", "token"))
    for result in (student, staff):
        row = result["responses"][0]
        assert row["audio_url"] == (None if fail else f"https://signed.test/{PATH}")
        assert row["audio_lookup_failed"] == fail


def test_sealed_detail_does_not_sign_hidden_responses(monkeypatch, authenticated):
    db = DB(sealed=True)
    monkeypatch.setattr(sessions, "supabase_admin", db)
    monkeypatch.setattr("services.mock_exam_service.is_sealed", lambda _id: True)
    result = asyncio.run(sessions.get_session("s", BackgroundTasks(), "token"))
    assert result["responses"] == []
    assert db.storage.calls == []


def test_pronunciation_legacy_uses_authenticated_storage(monkeypatch):
    store = Storage()
    monkeypatch.setattr(pronunciation, "supabase_admin", SimpleNamespace(storage=store))
    data, mime = asyncio.run(pronunciation._download_audio_bytes(None, legacy(), "r"))
    assert data == b"synthetic audio bytes" and mime == "audio/webm; codecs=opus"
    assert store.calls == [PATH]


def test_pronunciation_does_not_fetch_untrusted_url(monkeypatch):
    store = Storage()
    monkeypatch.setattr(pronunciation, "supabase_admin", SimpleNamespace(storage=store))
    with pytest.raises(HTTPException) as error:
        asyncio.run(pronunciation._download_audio_bytes(None, "http://127.0.0.1/private", "r"))
    assert error.value.status_code == 502
    assert store.calls == []


def test_grading_core_fallback_keeps_canonical_path():
    tree = ast.parse(inspect.getsource(grading))
    core_assignment = next(n for n in ast.walk(tree) if isinstance(n, ast.Assign)
                           and any(isinstance(t, ast.Name) and t.id == "_CORE_COLUMNS" for t in n.targets))
    core = ast.literal_eval(core_assignment.value)
    saved = []
    def upsert(row):
        saved.append(row)
        if len(saved) == 1: raise RuntimeError("metadata unavailable")
        return "r"
    grading._persist_response_with_fallback(
        {"session_id": "s", "question_id": "q", "audio_url": None,
         "audio_storage_path": PATH, "transcript_model": "whisper"},
        core, upsert, session_id="s", question_id="q")
    assert saved[1]["audio_storage_path"] == PATH and saved[1]["audio_url"] is None
    assert "get_public_url" not in inspect.getsource(grading)
