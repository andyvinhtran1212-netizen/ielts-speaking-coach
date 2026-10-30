"""PC-J425: proctor polling and post-test capture must leave the loop free."""

import asyncio
import threading
import time
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from routers import admin_exams, admin_mock_exams as proctor, mock_corrections


@pytest.fixture
def app(monkeypatch):
    app = FastAPI()
    for module in (admin_exams, proctor, mock_corrections):
        monkeypatch.setattr(module, "require_admin", AsyncMock(return_value={"id": "admin-1"}))
        app.include_router(module.router)
    app.include_router(mock_corrections.admin_router)
    monkeypatch.setattr(mock_corrections, "get_supabase_user", AsyncMock(return_value={"id": "learner-1"}))

    @app.get("/ping")
    async def ping():
        return {"ok": True}

    return app


def _request_with_ping(app, method, path, **kwargs):
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            start = time.perf_counter()
            request = asyncio.create_task(client.request(method, path, **kwargs))
            await asyncio.sleep(0.05)
            ping = await client.get("/ping")
            elapsed = time.perf_counter() - start
            in_flight = not request.done()
            return await request, ping, elapsed, in_flight

    response, ping, elapsed, in_flight = asyncio.run(scenario())
    assert ping.json() == {"ok": True}
    assert elapsed < 0.2, f"/ping waited {elapsed:.3f}s behind {path}"
    assert in_flight, "the lightweight request must finish while sync I/O is still running"
    return response


@pytest.mark.parametrize("path,module,name,payload", [
    ("/admin/mock-exams/exam-1/live", proctor.svc, "admin_live_monitor", {"students": []}),
    ("/admin/mock-exams/exam-1/section-progress", proctor.svc, "admin_section_progress", {"total": 2}),
    ("/admin/mock-exams", proctor.svc, "admin_list_exams", []),
    ("/admin/exams", admin_exams.exam_service, "admin_list_all", []),
])
def test_slow_console_read_does_not_block(app, monkeypatch, path, module, name, payload):
    calls = []

    def slow(*args, **kwargs):
        calls.append((args, threading.get_ident()))
        time.sleep(0.5)
        return payload

    monkeypatch.setattr(module, name, slow)
    response = _request_with_ping(app, "GET", path)
    assert response.status_code == 200
    assert response.json() == ({"exams": payload} if name in {"admin_list_all", "admin_list_exams"} else payload)
    assert len(calls) == 1 and calls[0][1] != threading.get_ident()


def test_slow_exam_import_does_not_block(app, monkeypatch):
    def slow(text, *, dry_run):
        assert text == "# QA exam" and dry_run is True
        time.sleep(0.5)
        return {"ok": True}

    monkeypatch.setattr(admin_exams.exam_service, "import_exam", slow)
    response = _request_with_ping(app, "POST", "/admin/exams/import", files={"file": ("qa.md", b"# QA exam")})
    assert response.status_code == 200 and response.json() == {"ok": True}


@pytest.mark.parametrize("slow_step", ["preflight", "mark"])
def test_collect_keeps_preflight_marker_and_background_order_without_blocking(app, monkeypatch, slow_step):
    calls = []

    def step(name):
        calls.append((name, threading.get_ident()))
        if name == slow_step:
            time.sleep(0.5)

    def preflight(exam_id, section, from_section):
        assert (exam_id, section, from_section) == ("exam-1", None, "reading")
        step("preflight")
        return {"section": "reading", "pending": 3}

    def mark(exam_id, section):
        assert (exam_id, section) == ("exam-1", "reading")
        step("mark")
        return True

    def sweep(exam_id, admin_id, section):
        assert (exam_id, admin_id, section) == ("exam-1", "admin-1", "reading")
        step("sweep")

    monkeypatch.setattr(proctor.svc, "collect_preflight", preflight)
    monkeypatch.setattr(proctor.svc, "mark_section_collected", mark)
    monkeypatch.setattr(proctor.svc, "collect_section_after_flush_grace", sweep)
    response = _request_with_ping(app, "POST", "/admin/mock-exams/exam-1/collect?from_section=reading")
    assert response.status_code == 202
    assert response.json() == {"section": "reading", "pending": 3, "queued": True}
    assert [name for name, _ in calls] == ["preflight", "mark", "sweep"]
    assert calls[0][1] == calls[1][1] != threading.get_ident()


@pytest.mark.parametrize("slow_step", ["record", "access", "result"])
def test_capture_preserves_release_boundary_and_order_without_blocking(app, monkeypatch, slow_step):
    calls = []
    attempt = {"id": "attempt-1"}

    def step(name):
        calls.append((name, threading.get_ident()))
        if name == slow_step:
            time.sleep(0.5)

    def record(skill, attempt_id, user_id, items):
        assert (skill, attempt_id, user_id) == ("reading", "attempt-1", "learner-1")
        assert items == [{"question_number": 1, "confidence": 3, "self_attribution": []}]
        step("record")
        return {"attempt": attempt, "capture": {"id": "capture-1"}, "replayed": False}

    def access(skill, row):
        assert skill == "reading" and row is attempt
        step("access")
        return {"allowed": False}

    def result(skill, row):
        assert skill == "reading" and row is attempt
        step("result")
        return None  # A sealed mock result stays sealed after capture.

    monkeypatch.setattr(mock_corrections.svc, "record_post_test_capture", record)
    monkeypatch.setattr(mock_corrections.svc, "explanation_access", access)
    monkeypatch.setattr(mock_corrections.svc, "learner_result_payload", result)
    response = _request_with_ping(app, "POST", "/api/mock-corrections/reading/attempts/attempt-1/post-test-capture",
                                  json={"items": [{"question_number": 1, "confidence": 3}]})
    assert response.status_code == 200
    assert response.json() == {"capture": {"id": "capture-1"}, "replayed": False,
                               "result": None, "web_explanation_access": {
                                   "has_content": False, "allowed": False,
                                   "reason": None, "content_version": None,
                               }}
    assert [name for name, _ in calls] == ["record", "access", "result"]
    assert len({ident for _, ident in calls}) == 1 and calls[0][1] != threading.get_ident()


@pytest.mark.parametrize("action,service,result_key", [
    ("bulk-claim", "bulk_claim_sittings", "claimed"),
    ("bulk-final-bands", "bulk_save_final_bands", "saved"),
    ("bulk-release", "bulk_release_sittings", "released"),
])
@pytest.mark.parametrize("slow_step", ["scope", "write"])
def test_bulk_review_scopes_before_writing_without_blocking(app, monkeypatch, action, service, result_key, slow_step):
    calls = []

    def step(name):
        calls.append((name, threading.get_ident()))
        if name == slow_step:
            time.sleep(0.5)

    def scope(exam_id, ids):
        assert (exam_id, ids) == ("exam-1", ["mine", "foreign"])
        step("scope")
        return {"mine"}

    def write(ids, admin_id):
        assert ids == ["mine"] and admin_id == "admin-1"
        step("write")
        return {result_key: ids, "skipped": []}

    monkeypatch.setattr(proctor.svc, "sittings_in_exam", scope)
    monkeypatch.setattr(proctor.wf, service, write)
    response = _request_with_ping(app, "POST", f"/admin/mock-exams/exam-1/{action}",
                                  json={"sitting_ids": ["mine", "foreign"]})
    assert response.status_code == 200
    assert response.json() == {result_key: ["mine"], "skipped": [{"sitting_id": "foreign", "reason": "Không thuộc đề này."}]}
    assert [name for name, _ in calls] == ["scope", "write"]
    assert calls[0][1] == calls[1][1] != threading.get_ident()


@pytest.mark.parametrize("slow_step", ["get", "claim"])
def test_bulk_grade_claims_in_order_and_runs_background_without_blocking(app, monkeypatch, slow_step):
    calls = []

    def step(name, value):
        calls.append((name, value, threading.get_ident()))
        if name == slow_step and sum(item[0] == name for item in calls) == 1:
            time.sleep(0.5)

    def get(sitting_id):
        step("get", sitting_id)
        return {"mock_exam_id": "exam-1", "essay_task1_id": "essay-" + sitting_id[-1]}

    def claim(ids, **kwargs):
        assert ids in (["essay-1", None], ["essay-2", None])
        assert kwargs == {"grading_tier": "instructor", "analysis_level": 3, "selected_model": "gemini-2.5-pro"}
        step("claim", ids)
        return {"queued": [(ids[0], "job-" + ids[0][-1])], "short": [], "skipped": []}

    def grade(essay_id, job_id):
        assert job_id == "job-" + essay_id[-1]
        step("grade", essay_id)

    monkeypatch.setattr(proctor.svc, "get_sitting", get)
    monkeypatch.setattr(proctor.svc, "claim_mock_writing_grading", claim)
    monkeypatch.setattr(proctor.essay_service, "_bg_grade_essay", grade)
    response = _request_with_ping(app, "POST", "/admin/mock-exams/exam-1/writing/bulk-grade",
                                  json={"sitting_ids": ["sitting-1", "sitting-2"], "grading_tier": "instructor"})
    assert response.status_code == 202
    assert response.json() == {"queued": ["essay-1", "essay-2"], "skipped": [], "short": [],
                               "retest_skipped": [], "grading_tier": "instructor"}
    assert [(name, value) for name, value, _ in calls] == [
        ("get", "sitting-1"), ("claim", ["essay-1", None]),
        ("get", "sitting-2"), ("claim", ["essay-2", None]),
        ("grade", "essay-1"), ("grade", "essay-2"),
    ]
    assert len({ident for _, _, ident in calls[:4]}) == 1 and calls[0][2] != threading.get_ident()


@pytest.mark.parametrize("error,status", [
    (mock_corrections.svc.NotFoundError, 404),
    (mock_corrections.svc.CaptureConflictError, 409),
    (mock_corrections.svc.PolicyError, 422),
])
@pytest.mark.parametrize("step", ["record_post_test_capture", "explanation_access", "learner_result_payload"])
def test_capture_worker_errors_keep_the_http_contract(app, monkeypatch, error, status, step):
    monkeypatch.setattr(mock_corrections.svc, "record_post_test_capture", lambda *_: {
        "attempt": {}, "capture": {}, "replayed": False,
    })
    monkeypatch.setattr(mock_corrections.svc, "explanation_access", lambda *_: None)
    monkeypatch.setattr(mock_corrections.svc, "learner_result_payload", lambda *_: None)

    def fail(*_):
        raise error("QA failure")

    monkeypatch.setattr(mock_corrections.svc, step, fail)

    async def post():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.post("/api/mock-corrections/reading/attempts/attempt-1/post-test-capture", json={"items": []})

    response = asyncio.run(post())
    assert response.status_code == status and response.json() == {"detail": "QA failure"}
