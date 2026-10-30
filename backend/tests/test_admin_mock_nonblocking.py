"""PC-J425: proctor polling and post-test capture must leave the loop free."""

import asyncio
import threading
import time
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, call

import httpx
import pytest
from fastapi import FastAPI
from postgrest.exceptions import APIError

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


@pytest.fixture
def assignment_refresh(monkeypatch):
    monkeypatch.setattr(proctor.assign_svc, "_assert_servable", MagicMock())
    refresh = MagicMock(return_value="refreshed")
    monkeypatch.setattr(proctor.assign_svc, "_refresh_open_sitting", refresh)
    return refresh


def test_concurrent_assign_requests_refresh_one_row(app, monkeypatch, assignment_refresh):
    rows, writes, conflicts = [], [], []
    reads = threading.Barrier(2)
    db_lock = threading.Lock()

    def table(name):
        assert name == "mock_exam_assignments"
        query = MagicMock()
        filters = {}
        query.select.return_value = query
        query.insert.return_value = query
        query.update.return_value = query

        def eq(column, value):
            filters[column] = value
            return query

        def execute():
            if query.select.called:
                with db_lock:
                    snapshot = deepcopy(rows)
                # Both workers read the missing row before either may insert.
                reads.wait(timeout=5)
                time.sleep(0.05)
                return SimpleNamespace(data=snapshot)
            with db_lock:
                if query.insert.called:
                    payload = deepcopy(query.insert.call_args.args[0])
                    if any((r["exam_id"], r["user_id"]) ==
                           (payload["exam_id"], payload["user_id"]) for r in rows):
                        conflicts.append(payload)
                        raise APIError({"code": "23505", "message": "duplicate key value violates unique constraint"})
                    rows.append({"id": "assignment-1", **payload})
                else:
                    payload = deepcopy(query.update.call_args.args[0])
                    assert filters == {"exam_id": "exam-1", "user_id": "learner-1"}
                    for row in rows:
                        if all(row.get(k) == v for k, v in filters.items()):
                            row.update(payload)
                writes.append(payload)
                return SimpleNamespace(data=deepcopy(rows))

        query.eq.side_effect = eq
        query.execute.side_effect = execute
        return query

    monkeypatch.setattr(proctor.assign_svc, "supabase_admin", SimpleNamespace(table=table))
    bodies = [{"source_exam_id": f"source-{i}", "assignments": [{
        "user_id": "learner-1", "skills": skills,
        "open_from": None, "open_until": f"2026-12-{i + 1:02d}T12:00:00+00:00",
    }]} for i, skills in enumerate((["writing"], ["reading", "writing"]))]

    async def scenario():
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await asyncio.gather(*[
                client.post("/admin/mock-exams/exam-1/assignments", json=body)
                for body in bodies
            ])

    responses = asyncio.run(scenario())
    assert [r.status_code for r in responses] == [200, 200]
    assert len(conflicts) == 1 and len(writes) == 2
    assert writes[-1] == conflicts[0]
    last_index = next(i for i, r in enumerate(responses)
                      if r.json()["group_id"] == writes[-1]["assignment_group_id"])
    expected = {
        **bodies[last_index]["assignments"][0], "exam_id": "exam-1",
        "source_exam_id": bodies[last_index]["source_exam_id"], "created_by": "admin-1",
        "assignment_group_id": responses[last_index].json()["group_id"],
    }
    assert rows == [{"id": "assignment-1", **expected}]
    for response in responses:
        assert response.json()["assigned"] == ["learner-1"]
        assert response.json()["refreshed"] == ["learner-1"]
    assert assignment_refresh.call_count == 2


@pytest.mark.parametrize("code,message", [
    ("23505", "constraint conflict"),
    ("", "duplicate key value violates unique constraint"),
])
def test_assign_unique_insert_conflict_continues_batch(monkeypatch, assignment_refresh, code, message):
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
    db.table.return_value.insert.return_value.execute.side_effect = [
        APIError({"code": code, "message": message}), SimpleNamespace(data=[]),
    ]
    update = db.table.return_value.update.return_value
    update.eq.return_value = update
    monkeypatch.setattr(proctor.assign_svc, "supabase_admin", db)
    row = {"user_id": "learner-1", "skills": ["writing"], "open_until": "2026-12-01T12:00:00Z"}

    result = proctor.assign_svc.assign("exam-1", [row, {**row, "user_id": "learner-2"}],
                                      created_by="admin-1", source_exam_id="source-1")

    payload = db.table.return_value.insert.call_args_list[0].args[0]
    assert db.table.return_value.insert.call_count == 2
    db.table.return_value.update.assert_called_once_with(payload)
    assert update.eq.call_args_list == [call("exam_id", "exam-1"), call("user_id", "learner-1")]
    update.execute.assert_called_once_with()
    assert result["assigned"] == ["learner-1", "learner-2"]
    assert result["refreshed"] == ["learner-1", "learner-2"]
    assert assignment_refresh.call_args_list == [
        call("exam-1", uid, ["writing"], None, row["open_until"])
        for uid in ("learner-1", "learner-2")
    ]


def test_assign_conflict_update_matching_no_row_is_not_assigned(monkeypatch, assignment_refresh):
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
    error = APIError({"code": "23505", "message": "duplicate key value violates unique constraint"})
    db.table.return_value.insert.return_value.execute.side_effect = error
    update = db.table.return_value.update.return_value
    update.eq.return_value = update
    update.execute.return_value = SimpleNamespace(data=[])  # the winner row was deleted meanwhile
    monkeypatch.setattr(proctor.assign_svc, "supabase_admin", db)

    with pytest.raises(APIError) as caught:
        proctor.assign_svc.assign("exam-1", [{
            "user_id": "learner-1", "skills": ["writing"], "open_until": "2026-12-01T12:00:00Z",
        }], created_by="admin-1")

    assert caught.value is error
    update.execute.assert_called_once_with()
    assignment_refresh.assert_not_called()


def test_assign_other_insert_errors_propagate(monkeypatch, assignment_refresh):
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
    error = APIError({"code": "23503", "message": "foreign key violation"})
    db.table.return_value.insert.return_value.execute.side_effect = error
    monkeypatch.setattr(proctor.assign_svc, "supabase_admin", db)

    with pytest.raises(APIError) as caught:
        proctor.assign_svc.assign("exam-1", [{
            "user_id": "learner-1", "skills": ["writing"], "open_until": "2026-12-01T12:00:00Z",
        }], created_by="admin-1")

    assert caught.value is error
    db.table.return_value.update.assert_not_called()
    assignment_refresh.assert_not_called()


class _CaptureDB:
    """In-memory mock_item_attempts + mock_post_test_captures with the UNIQUE
    (reading_attempt_id) constraint, slow enough per write to expose a race."""

    def __init__(self):
        self.items, self.captures, self.conflicts = {}, [], []
        self.lock = threading.Lock()

    def table(self, name):
        db, query = self, MagicMock()
        state = {"filters": {}, "op": None, "payload": None}

        def chain(op=None):
            def method(*args, **_kwargs):
                if op:
                    state["op"], state["payload"] = op, deepcopy(args[0]) if args else None
                return query
            return method

        query.select.side_effect = chain("select")
        query.upsert.side_effect = chain("upsert")
        query.insert.side_effect = chain("insert")
        query.limit.side_effect = chain()
        query.eq.side_effect = lambda column, value: state["filters"].update({column: value}) or query

        def execute():
            op, payload = state["op"], state["payload"]
            if name == "mock_item_attempts" and op == "upsert":
                time.sleep(0.02)
                with db.lock:
                    db.items[payload["question_number"]] = payload
                return SimpleNamespace(data=[payload])
            assert name == "mock_post_test_captures", name
            with db.lock:
                if op == "select":
                    return SimpleNamespace(data=[deepcopy(r) for r in db.captures if all(
                        r.get(k) == v for k, v in state["filters"].items())])
                if any(r["reading_attempt_id"] == payload["reading_attempt_id"] for r in db.captures):
                    db.conflicts.append(payload)
                    raise APIError({"code": "23505", "message": "duplicate key value violates unique constraint"})
                row = {"id": f"capture-{len(db.captures) + 1}", **payload}
                db.captures.append(row)
                return SimpleNamespace(data=[deepcopy(row)])

        query.execute.side_effect = execute
        return query


@pytest.fixture
def capture_db(monkeypatch):
    db = _CaptureDB()
    attempt = {"id": "attempt-1", "user_id": "learner-1",
               "grading_details": [{"q_num": q} for q in (1, 2, 3)]}
    monkeypatch.setattr(mock_corrections.svc, "supabase_admin", db)
    monkeypatch.setattr(mock_corrections.svc, "fetch_owned_submitted_attempt", lambda *_: attempt)
    monkeypatch.setattr(mock_corrections.svc, "explanation_access", lambda *_: None)
    monkeypatch.setattr(mock_corrections.svc, "learner_result_payload", lambda *_: None)
    return db


def _capture_body(confidence):
    return {"items": [{"question_number": q, "confidence": confidence} for q in (1, 2, 3)]}


@pytest.mark.parametrize("confidences,statuses", [
    ((3, 5), [200, 409]),  # second tab sent different ratings → 409, not 500
    ((4, 4), [200, 200]),  # double-submit of the same ratings → replay
])
def test_concurrent_capture_same_attempt_one_wins(app, capture_db, confidences, statuses):
    async def scenario():
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return await asyncio.gather(*[
                client.post("/api/mock-corrections/reading/attempts/attempt-1/post-test-capture",
                            json=_capture_body(c))
                for c in confidences
            ])

    responses = asyncio.run(scenario())
    assert sorted(r.status_code for r in responses) == statuses
    assert len(capture_db.captures) == 1
    winner = next(r.json() for r in responses if r.status_code == 200 and not r.json()["replayed"])
    assert winner["capture"] == capture_db.captures[0]
    # The persisted ratings all come from the request that owns the capture.
    won = confidences[[r.status_code == 200 and not r.json()["replayed"] for r in responses].index(True)]
    assert {row["post_test_confidence"] for row in capture_db.items.values()} == {won}
    if statuses == [200, 200]:
        assert sorted(r.json()["replayed"] for r in responses) == [False, True]
    else:
        loser = next(r for r in responses if r.status_code == 409)
        assert loser.json() == {"detail": "Post-test capture đã chốt với nội dung khác."}
    assert mock_corrections._capture_locks == {}


@pytest.mark.parametrize("confidence,conflict", [(4, False), (5, True)])
def test_capture_unique_violation_from_another_replica(capture_db, monkeypatch, confidence, conflict):
    svc = mock_corrections.svc
    winner = svc.record_post_test_capture("reading", "attempt-1", "learner-1",
                                          _capture_body(4)["items"])["capture"]
    # Another process committed its capture after our pre-check read nothing,
    # so only the UNIQUE constraint sees the race.
    real_row, first = svc._capture_row, [True]

    def capture_row(*args):
        if first.pop() if first else False:
            return None
        return real_row(*args)

    monkeypatch.setattr(svc, "_capture_row", capture_row)
    items = _capture_body(confidence)["items"]
    if conflict:
        with pytest.raises(svc.CaptureConflictError):
            svc.record_post_test_capture("reading", "attempt-1", "learner-1", items)
    else:
        result = svc.record_post_test_capture("reading", "attempt-1", "learner-1", items)
        assert result["replayed"] is True and result["capture"] == winner
    assert len(capture_db.conflicts) == 1 and capture_db.captures == [winner]


def test_capture_other_insert_errors_propagate(capture_db, monkeypatch):
    svc = mock_corrections.svc
    error = APIError({"code": "23503", "message": "foreign key violation"})
    real_table = capture_db.table

    def table(name):
        query = real_table(name)
        if name == "mock_post_test_captures":
            query.insert.side_effect = lambda *_: SimpleNamespace(
                execute=MagicMock(side_effect=error))
        return query

    monkeypatch.setattr(capture_db, "table", table)
    with pytest.raises(APIError) as caught:
        svc.record_post_test_capture("reading", "attempt-1", "learner-1", _capture_body(3)["items"])
    assert caught.value is error
