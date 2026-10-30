"""PC-J225 — validation errors and client values are not echoed verbatim.

(a) the unhandled-500 handler logs/persists a validation error's type/loc
    summary, never str() of it (which quotes `input_value=…` and the pydantic
    docs URL); (b) PATCH admin feedback edits returns {loc,msg,type} only;
(c) flashcards filter_config names no refused category; (d) the shared
clip/summary helpers and representative group-A routes; (e) a `password` /
`access_token` marker never reaches a response, the log or error_logs.
Each case has a negative control showing the old behaviour is kept where it
was not an echo.
"""
from __future__ import annotations

import io
import json
import logging
import time
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient
from pydantic import BaseModel, ValidationError

import main
from services.errors import (
    clip_user_value,
    clip_user_values,
    describe_parse_error,
    find_validation_error,
    redacted_traceback,
    summarize_validation_error,
)

MARKER = "pcj225-" + uuid.uuid4().hex  # random, not a real secret
PYDANTIC_LEAKS = ("input_value", "errors.pydantic.dev", "pydantic.dev")


def _assert_clean(text: str) -> None:
    assert MARKER not in text
    for leak in PYDANTIC_LEAKS:
        assert leak not in text, leak


# ── (d) helpers ─────────────────────────────────────────────────────────────


def test_clip_user_value_caps_and_strips_control_characters():
    assert clip_user_value("x" * 500) == "x" * 64 + "…"
    assert len(clip_user_value("x" * 500)) == 65
    assert clip_user_value("a\nb\r\tc\x00d\x1b[31m") == "abcd[31m"
    assert clip_user_value("x" * 10, limit=4) == "xxxx…"


def test_clip_user_value_keeps_short_values_unchanged():
    # Control: an ordinary value is shown exactly as before.
    assert clip_user_value("queued") == "queued"
    assert clip_user_value("Nguyễn Văn A") == "Nguyễn Văn A"
    assert clip_user_value("x" * 64) == "x" * 64
    assert clip_user_value(42) == "42"
    assert clip_user_value(None) == "None"


def test_clip_user_values_caps_items():
    values = [f"v{i}" for i in range(50)]
    out = clip_user_values(values)
    assert out == [f"v{i}" for i in range(10)] + ["+40 more"]
    assert clip_user_values(["a" * 100, "b"]) == ["a" * 64 + "…", "b"]
    # Control: ten or fewer items are all listed, no "+N more".
    assert clip_user_values(["a", "b"]) == ["a", "b"]
    assert clip_user_values([f"v{i}" for i in range(10)])[-1] == "v9"


class _Secretive(BaseModel):
    password: int
    access_token: list[int]


def _validation_error() -> ValidationError:
    with pytest.raises(ValidationError) as caught:
        _Secretive(password=MARKER, access_token=[MARKER])
    return caught.value


def test_summarize_validation_error_has_type_and_loc_only():
    exc = _validation_error()
    assert MARKER in str(exc)            # the leak this summary replaces
    summary = summarize_validation_error(exc)
    _assert_clean(summary)
    assert summary.startswith("ValidationError: 2 validation errors")
    assert "int_parsing at password" in summary
    assert "int_parsing at access_token.0" in summary
    assert "Input should" not in summary  # no msg


def test_summarize_fastapi_validation_errors_drop_input_msg_url():
    exc = RequestValidationError([{
        "loc": ("body", "password"), "msg": f"bad {MARKER}", "type": "string_type",
        "input": MARKER, "url": "https://errors.pydantic.dev/2/v/" + MARKER,
        "ctx": {"error": MARKER},
    }])
    summary = summarize_validation_error(exc)
    _assert_clean(summary)
    assert summary == "RequestValidationError: 1 validation error: string_type at body.password"


def test_find_validation_error_walks_cause_and_context_a_few_levels():
    ve = _validation_error()
    try:
        try:
            raise RuntimeError("outer") from ve
        except RuntimeError:
            raise KeyError("again")
    except KeyError as wrapped:
        assert find_validation_error(wrapped) is ve
    # Control: an unrelated chain yields nothing.
    try:
        raise RuntimeError("x") from ValueError("y")
    except RuntimeError as plain:
        assert find_validation_error(plain) is None
    # Deeper than the limit is not searched.
    exc: BaseException = ve
    for depth in range(8):
        nxt = RuntimeError(f"level {depth}")
        nxt.__cause__ = exc
        exc = nxt
    assert find_validation_error(exc) is None


def test_redacted_traceback_keeps_frames_and_replaces_exception_lines():
    def inner():
        _Secretive(password=MARKER, access_token=[])

    def outer():
        try:
            inner()
        except ValidationError as ve:
            raise RuntimeError(f"wrapped {ve}") from ve

    try:
        outer()
    except RuntimeError as exc:
        trace = redacted_traceback(exc)
    _assert_clean(trace)
    assert "in inner" in trace and "in outer" in trace          # frames kept
    assert "ValidationError: 1 validation error: int_parsing at password" in trace
    assert "RuntimeError: [message omitted" in trace
    assert "The above exception was the direct cause" in trace
    assert trace.index("in inner") < trace.index("direct cause") < trace.index("RuntimeError:")


def test_describe_parse_error_gives_position_not_content():
    with pytest.raises(json.JSONDecodeError) as bad_json:
        json.loads('{"a": 1,\n "' + MARKER + '" }x')
    assert describe_parse_error(bad_json.value).startswith("JSONDecodeError (dòng ")
    _assert_clean(describe_parse_error(bad_json.value))
    assert describe_parse_error(KeyError(MARKER)) == "KeyError"
    assert describe_parse_error(_validation_error()).startswith("ValidationError: 2")
    with pytest.raises(UnicodeDecodeError) as bad_utf8:
        (MARKER.encode() + b"\xff").decode("utf-8")
    assert describe_parse_error(bad_utf8.value) == f"UnicodeDecodeError (byte {len(MARKER)})"


# ── (a)/(e) unhandled 500 handler ─────────────────────────────────────────────


class _Typed(BaseModel):
    n: int


class Login(BaseModel):
    password: int
    access_token: int


@pytest.fixture
def error_app(monkeypatch):
    rows: list[dict] = []
    monkeypatch.setattr(main, "_insert_error_log_safely", rows.append)
    app = FastAPI()
    app.add_exception_handler(Exception, main.unhandled_exception_handler)
    app.add_exception_handler(RequestValidationError, main.request_validation_handler)

    @app.post("/login")
    async def login(body: Login):                 # → global 422 handler
        return {"ok": True}

    @app.post("/escape")
    async def escape(body: dict):                 # ValidationError escapes → 500
        _Secretive(**body)

    @app.get("/response-model", response_model=_Typed)
    async def bad_response():                     # ResponseValidationError → 500
        return {"n": MARKER}

    @app.get("/wrapped")
    async def wrapped():
        try:
            _Secretive(password=MARKER, access_token=[MARKER])
        except ValidationError as ve:
            raise RuntimeError(f"could not build: {ve}") from ve

    @app.get("/plain")
    async def plain():
        raise RuntimeError("boom-" + MARKER)

    return app, rows


def _call(app, rows, method, path, **kwargs):
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.request(method, path, **kwargs)
        deadline = time.monotonic() + 5
        while response.status_code >= 500 and not rows and time.monotonic() < deadline:
            time.sleep(0.01)
    return response


def _main_log(caplog) -> str:
    return "\n".join(r.getMessage() for r in caplog.records if r.name == "main")


@pytest.mark.parametrize("path, method, kwargs, expected", [
    ("/escape", "POST", {"json": {"password": MARKER, "access_token": [MARKER]}},
     "ValidationError: 2 validation errors: int_parsing at password; int_parsing at access_token.0"),
    ("/response-model", "GET", {}, "ResponseValidationError: 1 validation error: int_parsing at response.n"),
    ("/wrapped", "GET", {}, "RuntimeError <- ValidationError: 2 validation errors"),
])
def test_validation_error_500_logs_and_persists_only_a_summary(
        error_app, caplog, path, method, kwargs, expected):
    app, rows = error_app
    caplog.set_level(logging.ERROR, logger="main")

    response = _call(app, rows, method, path, **kwargs)

    assert response.status_code == 500
    assert response.json()["detail"]["error_code"] == "internal_error"  # unchanged
    _assert_clean(response.text)
    log = _main_log(caplog)
    assert "Unhandled exception" in log and expected in log
    _assert_clean(log)
    row, = rows
    assert row["message"].startswith(expected)
    _assert_clean(row["message"])
    _assert_clean(row["stack"])
    _assert_clean(json.dumps(row))
    assert "Traceback (most recent call last):" in row["stack"]
    assert "validation error" in row["stack"]


def test_other_exceptions_keep_their_message_in_logs_and_error_logs(error_app, caplog):
    # Control: only validation errors are summarised; a plain exception's text
    # is still what support needs to diagnose it.
    app, rows = error_app
    caplog.set_level(logging.ERROR, logger="main")

    response = _call(app, rows, "GET", "/plain")

    assert response.status_code == 500
    assert MARKER not in response.text                     # response stays generic
    assert f"boom-{MARKER}" in _main_log(caplog)
    row, = rows
    assert row["message"] == f"boom-{MARKER}"
    assert f"RuntimeError: boom-{MARKER}" in row["stack"]


def test_secret_fields_in_a_global_422_reach_nothing(error_app, caplog):
    app, rows = error_app
    caplog.set_level(logging.DEBUG)

    response = _call(app, rows, "POST", "/login",
                     json={"password": MARKER, "access_token": MARKER})

    assert response.status_code == 422
    assert [e["loc"] for e in response.json()["detail"]] == [
        ["body", "password"], ["body", "access_token"]]
    _assert_clean(response.text)
    assert MARKER not in caplog.text
    assert rows == []


# ── (b) admin_writing PATCH feedback ──────────────────────────────────────────


def _feedback_client():
    from tests.test_admin_writing import _ADMIN_USER
    return patch("routers.admin_writing.require_admin", new=AsyncMock(return_value=_ADMIN_USER))


def test_feedback_edits_schema_error_returns_loc_msg_type_only(caplog):
    from tests.test_admin_writing import _ADMIN_AUTH, _ESSAY_ID, _valid_feedback_edits
    bad = _valid_feedback_edits()
    bad["overallBandScore"] = MARKER
    bad["password"] = MARKER
    caplog.set_level(logging.DEBUG)
    with _feedback_client():
        r = TestClient(main.app).patch(
            f"/admin/writing/essays/{_ESSAY_ID}/feedback", json=bad, headers=_ADMIN_AUTH)

    assert r.status_code == 422
    _assert_clean(r.text)
    detail = r.json()["detail"]
    assert detail["error_code"] == "edits_invalid"
    assert detail["message"] == "Edits không đúng schema"
    assert detail["errors"] and all(set(e) == {"loc", "msg", "type"} for e in detail["errors"])
    assert ["overallBandScore"] in [e["loc"] for e in detail["errors"]]
    assert MARKER not in caplog.text


def test_feedback_edits_non_validation_failure_is_generic():
    from tests.test_admin_writing import _ADMIN_AUTH, _ESSAY_ID, _valid_feedback_edits
    with _feedback_client(), \
         patch("routers.admin_writing.WritingFeedback", side_effect=TypeError("kw " + MARKER)):
        r = TestClient(main.app).patch(
            f"/admin/writing/essays/{_ESSAY_ID}/feedback",
            json=_valid_feedback_edits(), headers=_ADMIN_AUTH)
    assert r.status_code == 422
    assert r.json()["detail"] == {"error_code": "edits_invalid", "message": "Edits không đúng schema"}


def test_feedback_valid_edits_still_save():
    # Control: a valid body is unaffected (same contract as test_admin_writing).
    from tests.test_admin_writing import _ADMIN_AUTH, _ESSAY_ID, _fake_supabase, _valid_feedback_edits
    fake = _fake_supabase(status="graded")
    with _feedback_client(), patch("routers.admin_writing.supabase_admin", fake), \
         patch("services.essay_service.upsert_composed_version", return_value=2), \
         patch("services.mock_review_workflow.sync_writing_band_for_essay"):
        r = TestClient(main.app).patch(
            f"/admin/writing/essays/{_ESSAY_ID}/feedback",
            json=_valid_feedback_edits(), headers=_ADMIN_AUTH)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "reviewed"


# ── (c) flashcards filter_config ──────────────────────────────────────────────


class _Chain:
    """Supabase query-builder stand-in: every call returns itself."""

    def __getattr__(self, name):
        if name == "execute":
            return lambda: SimpleNamespace(data=[{"headword": "implement"}], count=1)
        return lambda *a, **k: self


def _preview(filter_config):
    from routers import flashcards
    with patch.object(flashcards, "get_supabase_user",
                      new=AsyncMock(return_value={"id": "00000000-0000-0000-0000-0000000000c5"})), \
         patch.object(flashcards, "_require_flashcards_enabled"), \
         patch.object(flashcards, "_user_sb", return_value=_Chain()):
        return TestClient(main.app).post(
            "/api/flashcards/stacks/preview", json={"filter_config": filter_config},
            headers={"Authorization": "Bearer fake.jwt"})


def test_flashcards_unknown_category_is_not_echoed():
    r = _preview({"categories": [MARKER, "x" * 500]})
    assert r.status_code == 422
    assert MARKER not in r.text and "x" * 65 not in r.text
    assert r.json()["detail"] == "filter_config.categories chứa 2 giá trị không hợp lệ"


def test_flashcards_valid_category_still_previews():
    r = _preview({"categories": ["needs_review"]})
    assert r.status_code == 200, r.text
    assert r.json() == {"card_count": 1, "preview_headwords": ["implement"]}


def test_flashcards_filter_key_message_and_unknown_keys():
    # `key` at :140 only ever comes from the allowlist; an unknown (long) key
    # is dropped before it, so it is never echoed.
    r = _preview({"k" * 500: MARKER, "topics": "not-a-list"})
    assert r.status_code == 422
    assert r.json()["detail"] == "filter_config.topics must be a list"
    assert MARKER not in r.text and "k" * 65 not in r.text
    assert _preview({"k" * 500: MARKER}).status_code == 200


# ── (d) representative group-A routes ─────────────────────────────────────────


def test_instructor_queue_unknown_status_is_clipped():
    from routers import admin_instructor_queue as q
    with patch.object(q, "require_admin", new=AsyncMock(return_value={"id": str(uuid.uuid4())})), \
         patch.object(q.instructor_workflow, "get_queue", return_value=[]) as get_queue:
        bad = TestClient(main.app).get(
            "/admin/instructor/queue", params={"status": MARKER + "y" * 500},
            headers={"Authorization": "Bearer x"})
        good = TestClient(main.app).get(
            "/admin/instructor/queue", params={"status": "queued"},
            headers={"Authorization": "Bearer x"})
    assert bad.status_code == 400
    detail = bad.json()["detail"]
    assert detail.startswith("Invalid status value: '") and detail.endswith("…'")
    assert "y" * 65 not in detail
    assert "is not a valid" not in detail                   # enum message gone
    # Control: a valid status still filters.
    assert good.status_code == 200 and good.json() == []
    assert get_queue.call_count == 1


def _upload(filename: str, data: bytes):
    return SimpleNamespace(filename=filename, file=io.BytesIO(data))


def test_listening_json_upload_parse_error_names_position_not_content():
    from routers import listening
    with pytest.raises(HTTPException) as bad:
        listening._read_json_upload(_upload("t.json", b'{"' + MARKER.encode() + b'": }'), "timings.json")
    assert bad.value.status_code == 422
    _assert_clean(bad.value.detail)
    assert bad.value.detail.startswith("timings.json không phải JSON hợp lệ: JSONDecodeError (dòng 1, cột ")
    # Control: valid JSON still parses.
    assert listening._read_json_upload(_upload("t.json", b'{"a": 1}'), "timings.json") == {"a": 1}


def test_listening_upload_filename_is_clipped_and_single_line():
    from routers import listening
    name = "evil\nname\r" + "M" * 500 + ".txt"
    with pytest.raises(HTTPException) as bad:
        listening._read_json_upload(_upload(name, b"{}"), "timings.json")
    detail = bad.value.detail
    assert bad.value.status_code == 422
    assert "\n" not in detail and "\r" not in detail
    assert "M" * 65 not in detail and "…" in detail
    assert detail.startswith("timings.json phải là file .json (nhận: 'evilname")
    with pytest.raises(HTTPException) as short:
        listening._read_text_upload(_upload("notes.pdf", b"x"), "Solution.md", exts=(".md",))
    # Control: an ordinary filename reads exactly as before.
    assert short.value.detail == "Solution.md phải là file .md (nhận: 'notes.pdf')"


def test_listening_drill_import_parse_crash_names_only_the_class():
    from routers import listening
    files = {"source_json": ("drill.json", b'{"test_id": "T"}', "application/json")}
    with patch.object(listening, "require_admin", new=AsyncMock(return_value={"id": "a"})), \
         patch.object(listening.listening_drill_import, "parse_drill", side_effect=KeyError(MARKER)):
        r = TestClient(main.app).post("/admin/listening/drills/import", files=files,
                                      headers={"Authorization": "Bearer x"})
    assert r.status_code == 422
    assert r.json()["detail"] == "Lỗi khi phân tích drill JSON: KeyError"
    # Control: the real parser on a parseable body still answers a preview.
    with patch.object(listening, "require_admin", new=AsyncMock(return_value={"id": "a"})):
        ok = TestClient(main.app).post(
            "/admin/listening/drills/import",
            files={"source_json": ("drill.json", b"{}", "application/json")},
            headers={"Authorization": "Bearer x"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["ok"] is False and ok.json()["errors"]


def test_student_mock_exam_unexpected_error_is_not_echoed():
    from routers import mock_exams
    user = AsyncMock(return_value={"id": str(uuid.uuid4())})
    driver_error = RuntimeError(f'invalid input syntax for type uuid: "{MARKER}"')
    with patch.object(mock_exams, "get_supabase_user", new=user), \
         patch.object(mock_exams.svc, "create_sitting", side_effect=driver_error):
        r = TestClient(main.app).post("/api/mock-exams/CODE/sittings",
                                      headers={"Authorization": "Bearer x"})
    assert r.status_code == 400                                   # status unchanged
    assert MARKER not in r.text
    # Control: an app-authored service message is still shown verbatim.
    with patch.object(mock_exams, "get_supabase_user", new=user), \
         patch.object(mock_exams.svc, "create_sitting",
                      side_effect=mock_exams.svc.MockExamError("Không tạo được sitting.")):
        r = TestClient(main.app).post("/api/mock-exams/CODE/sittings",
                                      headers={"Authorization": "Bearer x"})
    assert r.status_code == 400 and r.json()["detail"] == "Không tạo được sitting."


def test_service_messages_clip_client_values():
    from services import class_assignment_service, exam_content_service, mock_exam_assignment_service
    from services.access_code_permissions import validate_permissions_or_raise

    with pytest.raises(ValueError) as due:
        class_assignment_service.parse_due_time("9\n" + "9" * 500)
    assert "\n" not in str(due.value) and "9" * 65 not in str(due.value)
    with pytest.raises(exam_content_service.UnknownKindError) as kind:
        exam_content_service._assert_kind("k" * 500)
    assert "k" * 65 not in str(kind.value)
    with pytest.raises(mock_exam_assignment_service.InvalidWindowError) as window:
        mock_exam_assignment_service._parse_ts("t" * 500)
    assert "t" * 65 not in str(window.value)
    with pytest.raises(ValueError) as perms:
        validate_permissions_or_raise([f"p{i:03d}" + "z" * 100 for i in range(30)])
    assert "z" * 65 not in str(perms.value) and "+20 more" in str(perms.value)
    # Control: ordinary refused values read as before.
    with pytest.raises(ValueError) as short:
        class_assignment_service.parse_due_time("25h")
    assert str(short.value) == "Giờ hạn không hợp lệ: '25h' (cần dạng HH:MM)"
