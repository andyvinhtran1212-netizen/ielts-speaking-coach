"""Listening / vocab bank / D1 / feedback 5xx details stay safe without
main.py's HTTPException handler (PC-J250, same pattern as PC-J240)."""

import asyncio
import io
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient

from config import settings
from routers import exercises, feedback, listening, vocabulary_bank
from services import listening_audio
from services.d1_content_gen import GeminiBatchError
from services.errors import GENERIC_MESSAGE


_DB_ERROR = 'relation "users" column secret_col contains private-db-value'
_LEAKS = (_DB_ERROR, "relation", "secret_col", "private-db-value", "users",
          "listening_attempts", "listening_tests", "listening_content",
          "user_vocabulary", "flashcard_reviews", "user_feedback")
_ID = "00000000-0000-0000-0000-000000000001"
_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200


class _FakeDB:
    """PostgREST + Storage stand-in. Raises _DB_ERROR on the configured
    (table, op) execute or storage call; every other read returns `rows`."""

    def __init__(self, fail=(), rows=None):
        self.fail = set(fail)
        self.rows = rows or {}
        self.storage = self

    # storage
    def from_(self, _bucket):
        return self

    def upload(self, *_a, **_k):
        if "storage.upload" in self.fail:
            raise Exception(_DB_ERROR)

    def download(self, *_a, **_k):
        if "storage.download" in self.fail:
            raise Exception(_DB_ERROR)
        return b"audio"

    def remove(self, *_a, **_k):
        return None

    # postgrest
    def table(self, name):
        return _FakeQuery(self, name)


class _FakeQuery:
    def __init__(self, db, table):
        self.db, self.table, self.op = db, table, "select"

    def __getattr__(self, _name):
        return lambda *_a, **_k: self

    def _set(self, op):
        self.op = op
        return self

    def insert(self, *_a, **_k):
        return self._set("insert")

    def upsert(self, *_a, **_k):
        return self._set("upsert")

    def update(self, *_a, **_k):
        return self._set("update")

    def delete(self, *_a, **_k):
        return self._set("delete")

    def execute(self):
        if (self.table, self.op) in self.db.fail:
            raise Exception(_DB_ERROR)
        data = self.db.rows.get(self.table, []) if self.op == "select" else []
        return SimpleNamespace(data=data, count=len(data))


def _run(value):
    if not asyncio.iscoroutine(value):
        return value
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(value)
    finally:
        loop.close()


def _upload(name, data):
    return UploadFile(filename=name, file=io.BytesIO(data))


async def _admin(_authorization=None):
    return {"id": _ID, "role": "admin"}


# ── per-site setup: patch the module, return the call that hits the 5xx ──

def _listening_attempt(mp):
    mp.setattr(listening, "supabase_admin", _FakeDB({("listening_attempts", "insert")}))
    return lambda: listening._insert_attempt(
        user_id=_ID, exercise_id=_ID, segment_idx=None, user_answer={},
        score=0.0, is_correct=False, listen_count=1)


def _listening_fulltest_commit(mp):
    mp.setattr(listening, "require_admin", _admin)
    mp.setattr(listening, "supabase_admin", _FakeDB({("listening_tests", "insert")}))
    mp.setattr(listening, "_read_text_upload", lambda *_a, **_k: b"pack")
    mp.setattr(listening, "_read_json_upload", lambda *_a, **_k: {})
    mp.setattr(listening.listening_fulltest_import, "parse_fulltest",
               lambda *_a: SimpleNamespace(ok=True, metadata={"test_id": "T-1"},
                                           errors=[], warnings=[]))
    mp.setattr(listening_audio, "validate_full_audio",
               lambda b: {"duration_seconds": 1657, "size_bytes": len(b), "errors": []})
    return lambda: listening.admin_import_fulltest_commit(
        question_paper=_upload("qp.md", b"qp"), solution=_upload("sol.md", b"sol"),
        timings=_upload("t.json", b"{}"), audio=_upload("full.mp3", b"x" * 10),
        mini=False, authorization="x")


def _listening_drill_commit(mp):
    mp.setattr(listening, "require_admin", _admin)
    mp.setattr(listening, "supabase_admin", _FakeDB({("listening_tests", "insert")}))
    mp.setattr(listening, "_read_json_upload", lambda *_a, **_k: {})
    mp.setattr(listening.listening_drill_import, "parse_drill",
               lambda *_a: SimpleNamespace(errors=[], warnings=[], cue_points=[],
                                           test_metadata={"test_id": "D-1"}, content_row={}))
    return lambda: listening.admin_import_drill_commit(
        source_json=_upload("d.json", b"{}"), timings=None, solution=None, audio=None,
        authorization="x")


def _listening_audio_upload(mp):
    mp.setattr(listening, "supabase_admin", _FakeDB({"storage.upload"}))
    return lambda: listening._upload_audio_to_bucket("tests/t/full.mp3", b"x")


def _assemble_setup(mp, fail):
    sections = [{"id": f"c{n}", "section_num": n, "audio_storage_path": f"s{n}.mp3",
                 "metadata": {}, "updated_at": "2026-01-01"} for n in (1, 2, 3, 4)]
    mp.setattr(listening, "require_admin", _admin)
    mp.setattr(settings, "ELEVENLABS_API_KEY", "test-key")
    mp.setattr(listening, "_fetch_test_or_404", lambda _id: {"id": _id})
    mp.setattr(listening, "supabase_admin",
               _FakeDB(fail, rows={"listening_content": sections}))
    return lambda: listening.admin_assemble_test_audio(
        test_id=_ID, body=listening.TestAudioAssembleRequest(), authorization="x")


def _listening_assemble_download(mp):
    return _assemble_setup(mp, {"storage.download"})


def _listening_assemble_render(mp):
    def _boom(*_a, **_k):
        raise Exception(_DB_ERROR)
    mp.setattr(listening_audio, "assemble_test_audio", _boom)
    return _assemble_setup(mp, ())


def _listening_map_upload(mp):
    mp.setattr(listening, "require_admin", _admin)
    mp.setattr(listening, "_fetch_exercise_or_404", lambda _id: {
        "id": _id, "content_id": "c1", "payload": {"variant": "mcq_letter_label"}})
    mp.setattr(listening, "supabase_admin", _FakeDB(
        {"storage.upload"}, rows={"listening_content": [{"test_id": "t1"}]}))
    return lambda: listening.admin_upload_map_image(
        exercise_id=_ID, image_file=_upload("map.png", _PNG), authorization="x")


def _vocab_setup(mp, fail, rows=None):
    async def _auth(_authorization):
        return {"id": _ID}
    mp.setattr(vocabulary_bank, "_require_auth", _auth)
    mp.setattr(vocabulary_bank, "_vocab_bank_enabled", lambda _uid: True)
    mp.setattr(vocabulary_bank, "_fire_event", lambda *_a, **_k: None)
    db = _FakeDB(fail, rows=rows)
    mp.setattr(vocabulary_bank, "_user_sb", lambda _token: db)


def _vocab_export(mp):
    _vocab_setup(mp, {("user_vocabulary", "select")})
    return lambda: vocabulary_bank.export_user_vocabulary(format="csv", authorization="Bearer t")


def _vocab_add(mp):
    _vocab_setup(mp, {("user_vocabulary", "insert")})
    return lambda: vocabulary_bank.add_vocab_manual(
        body=vocabulary_bank.VocabManualAddRequest(headword="resilient"),
        authorization="Bearer t")


def _vocab_review_state(mp):
    _vocab_setup(mp, {("flashcard_reviews", "upsert")},
                 rows={"user_vocabulary": [{"id": _ID}]})
    mp.setattr(vocabulary_bank, "_fetch_srs_lookup", lambda *_a: {})
    return lambda: vocabulary_bank.update_vocab_status(
        vocab_id=_ID, body=vocabulary_bank.VocabUpdateStatusRequest(mastered=True),
        authorization="Bearer t")


def _d1_batch_setup(mp, error):
    def _boom(*_a, **_k):
        raise error
    mp.setattr(exercises, "require_admin", _admin)
    mp.setattr(exercises, "_generate_and_insert_batch", _boom)
    return lambda: exercises.admin_generate_d1_batch(
        body=exercises.AdminGenerateBatchRequest(words=["resilient"], count=1),
        authorization="x")


def _d1_batch_generation(mp):
    return _d1_batch_setup(mp, GeminiBatchError(_DB_ERROR))


def _d1_batch_insert(mp):
    return _d1_batch_setup(mp, Exception(_DB_ERROR))


def _feedback_submit(mp):
    mp.setattr(feedback, "_resolve_vocabulary_ref", lambda *_a: "vocab:cat/slug")
    mp.setattr(feedback, "supabase_admin", _FakeDB({("user_feedback", "insert")}))
    return lambda: feedback.submit_feedback(
        body=feedback.FeedbackIn(type="report", skill="vocabulary",
                                 vocab_category="cat", vocab_slug="slug", category="other"),
        authorization=None, x_reading_anon=None)


@pytest.mark.parametrize("module,setup,status", [
    pytest.param(listening, _listening_attempt, 500, id="listening-attempt-insert"),
    pytest.param(listening, _listening_fulltest_commit, 500, id="listening-fulltest-commit"),
    pytest.param(listening, _listening_drill_commit, 500, id="listening-drill-commit"),
    pytest.param(listening, _listening_audio_upload, 500, id="listening-audio-upload"),
    pytest.param(listening, _listening_assemble_download, 500, id="listening-assemble-download"),
    pytest.param(listening, _listening_assemble_render, 500, id="listening-assemble-render"),
    pytest.param(listening, _listening_map_upload, 500, id="listening-map-image-upload"),
    pytest.param(vocabulary_bank, _vocab_export, 500, id="vocab-export"),
    pytest.param(vocabulary_bank, _vocab_add, 500, id="vocab-manual-add"),
    pytest.param(vocabulary_bank, _vocab_review_state, 500, id="vocab-review-state"),
    pytest.param(exercises, _d1_batch_generation, 502, id="d1-batch-generation"),
    pytest.param(exercises, _d1_batch_insert, 500, id="d1-batch-insert"),
    pytest.param(feedback, _feedback_submit, 500, id="feedback-submit"),
])
def test_direct_router_5xx_detail_is_clean(monkeypatch, caplog, module, setup, status):
    call = setup(monkeypatch)

    with caplog.at_level(logging.ERROR, logger=module.logger.name):
        with pytest.raises(HTTPException) as exc_info:
            _run(call())

    error = exc_info.value
    assert error.status_code == status
    assert isinstance(error.detail, str)
    for internal in _LEAKS:
        assert internal not in error.detail
    assert error.__cause__ is None
    assert error.__suppress_context__ is True
    assert any(record.name == module.logger.name
               and record.levelno == logging.ERROR
               and record.exc_info is not None
               for record in caplog.records)


def _patch_auth_gate(monkeypatch):
    from routers import auth
    monkeypatch.setattr(auth, "get_supabase_user", AsyncMock(return_value={"id": _ID}))


@pytest.mark.parametrize("module,setup,method,path,request_kwargs", [
    pytest.param(listening, _listening_map_upload, "post", f"/admin/listening/exercises/{_ID}/upload-map-image",
                 {"files": {"image_file": ("map.png", _PNG, "image/png")}}, id="listening-main-app"),
    pytest.param(vocabulary_bank, _vocab_export, "get", "/api/vocabulary/bank/export?format=csv",
                 {}, id="vocab-main-app"),
    pytest.param(exercises, _d1_batch_insert, "post", "/admin/exercises/d1/generate-batch",
                 {"json": {"words": ["resilient"], "count": 1}}, id="exercises-main-app"),
    pytest.param(feedback, _feedback_submit, "post", "/api/feedback",
                 {"json": {"type": "report", "skill": "vocabulary", "vocab_category": "cat",
                           "vocab_slug": "slug", "category": "other"}}, id="feedback-main-app"),
])
def test_main_app_preserves_safe_500_shape(
    monkeypatch, caplog, module, setup, method, path, request_kwargs,
):
    import main

    setup(monkeypatch)
    _patch_auth_gate(monkeypatch)
    headers = {} if path == "/api/feedback" else {"Authorization": "Bearer t"}

    client = TestClient(main.app)
    try:
        with caplog.at_level(logging.ERROR, logger=module.logger.name):
            response = getattr(client, method)(path, headers=headers, **request_kwargs)
    finally:
        client.close()

    # The patched router branch (not some unrelated 500) produced the response.
    assert any(record.name == module.logger.name and record.exc_info is not None
               for record in caplog.records)

    assert response.status_code == 500
    assert response.json() == {"detail": {
        "error_code": "internal_error",
        "message": GENERIC_MESSAGE,
        "ref": response.headers["X-Request-ID"],
    }}
    assert response.json()["detail"]["ref"]
    for internal in (_DB_ERROR, "relation", "secret_col", "private-db-value"):
        assert internal not in response.text
