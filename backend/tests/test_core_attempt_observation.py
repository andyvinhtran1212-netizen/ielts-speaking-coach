import asyncio
import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from services import core_attempt_observation as obs
from services.core_attempt_evidence import ReceiptStatus


@pytest.fixture
def receipts(monkeypatch):
    writer = AsyncMock(return_value=ReceiptStatus.RECORDED)
    monkeypatch.setattr(obs.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", True)
    monkeypatch.setattr(obs, "try_record_event", writer)
    monkeypatch.setattr(obs, "observe_persisted_outcome", AsyncMock(return_value=ReceiptStatus.RECORDED))
    monkeypatch.setattr(obs, "record_exam_result_proof", AsyncMock(return_value=ReceiptStatus.RECORDED))
    monkeypatch.setattr(obs, "record_operation_correlation", AsyncMock(return_value=ReceiptStatus.RECORDED))
    return writer


def row(**changes):
    return {"id": str(uuid4()), "status": "in_progress", "renderer_affinity": "next"} | changes


def test_disabled_preserves_result_and_does_not_emit(receipts, monkeypatch):
    monkeypatch.setattr(obs.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", False)
    result = {"opaque": True}
    @obs.observe_operation("reading_exam", "start")
    async def endpoint():
        obs.bind_owned_attempt(row(), started=True)
        return result
    assert asyncio.run(endpoint()) is result
    receipts.assert_not_called()


def test_terminal_request_records_operation_and_reads_canonical_outcome(receipts):
    attempt = row()
    @obs.observe_operation("writing_assignment", "submit")
    async def endpoint():
        obs.bind_owned_attempt(attempt)
        return {"accepted": True}
    assert asyncio.run(endpoint()) == {"accepted": True}
    event = receipts.call_args.kwargs
    assert event["event_kind"] == "operation_succeeded" and event["outcome"] is None
    obs.observe_persisted_outcome.assert_awaited_once_with(
        "writing_assignment", UUID(attempt["id"]), "default", operation_id=event["operation_id"], operation="submit",
    )


def test_failed_request_does_not_replace_operation_error_with_prior_outcome(receipts):
    @obs.observe_operation("writing_assignment", "submit")
    async def endpoint():
        obs.bind_owned_attempt(row())
        raise HTTPException(409, "already submitted")
    with pytest.raises(HTTPException):
        asyncio.run(endpoint())
    assert receipts.call_args.kwargs["event_kind"] == "operation_failed"
    obs.observe_persisted_outcome.assert_not_called()


def test_soft_grading_failure_preserves_response_and_separates_current_outcome(receipts):
    attempt = row(mode="practice")
    payload = {"_stub": True, "transcript": "private text", "_reason": "private provider detail"}
    @obs.observe_operation("speaking", "grade")
    async def endpoint():
        obs.bind_owned_attempt(attempt)
        obs.note_operation_failure()
        return payload
    assert asyncio.run(endpoint()) is payload
    event = receipts.call_args.kwargs
    assert event["event_kind"] == "operation_failed"
    assert event["error_code"] == "server_error" and event["outcome"] is None
    assert "private" not in str(event)
    obs.observe_persisted_outcome.assert_awaited_once_with(
        "speaking", UUID(attempt["id"]), "speaking_session", operation_id=event["operation_id"], operation="grade",
    )


def test_nonallowlisted_soft_failure_cannot_enter_receipt(receipts):
    @obs.observe_operation("speaking", "grade")
    async def endpoint():
        obs.bind_owned_attempt(row(mode="practice"))
        obs.note_operation_failure("private provider exception")
        return {"_stub": True}
    assert asyncio.run(endpoint()) == {"_stub": True}
    receipts.assert_not_called()
    obs.observe_persisted_outcome.assert_not_called()


def test_soft_failure_after_committed_start_keeps_start_fact(receipts):
    @obs.observe_operation("reading_exam", "start")
    async def endpoint():
        obs.bind_owned_attempt(row(), started=True)
        obs.note_operation_failure()
    asyncio.run(endpoint())
    events = [call.kwargs for call in receipts.call_args_list]
    assert [event["event_kind"] for event in events] == ["started", "operation_failed"]
    assert [event["start_observed"] for event in events] == [True, False]


def test_soft_failure_does_not_emit_an_earlier_local_exam_verdict(receipts):
    @obs.observe_operation("reading_exam", "submit")
    async def endpoint():
        obs.bind_owned_attempt(row())
        obs._current.get().outcome = "success"
        obs.note_operation_failure()
    asyncio.run(endpoint())
    assert receipts.call_count == 1
    assert receipts.call_args.kwargs["event_kind"] == "operation_failed"


def test_canonical_outcome_observation_failure_cannot_break_submission(receipts):
    obs.observe_persisted_outcome.side_effect = RuntimeError("evidence unavailable")
    @obs.observe_operation("listening_dictation", "submit")
    async def endpoint():
        obs.bind_owned_attempt(row())
        return {"ok": True}
    assert asyncio.run(endpoint()) == {"ok": True}


def test_committed_start_then_endpoint_error_preserves_start_before_failure(receipts):
    @obs.observe_operation("reading_exam", "start")
    async def endpoint():
        obs.bind_owned_attempt(row(), started=True)
        raise HTTPException(500, "response assembly failed")
    with pytest.raises(HTTPException):
        asyncio.run(endpoint())
    events = [call.kwargs for call in receipts.call_args_list]
    assert [event["event_kind"] for event in events] == ["started", "operation_failed"]
    assert events[0]["start_observed"] is True and events[1]["start_observed"] is False
    assert events[0]["operation_id"] == events[1]["operation_id"]


def test_successful_submit_with_unknown_result_keeps_both_facts(receipts):
    @obs.observe_operation("reading_exam", "submit")
    async def endpoint():
        obs.bind_owned_attempt(row())
        obs.note_persisted_exam_result({}, expected_questions=[])
    asyncio.run(endpoint())
    events = [call.kwargs for call in receipts.call_args_list]
    assert [event["event_kind"] for event in events] == ["operation_succeeded", "outcome_observed"]
    assert events[0]["outcome"] is None and events[1]["outcome"] == "unknown"
    assert events[0]["operation_id"] == events[1]["operation_id"]


def test_terminal_receipt_and_read_run_concurrently_within_one_budget(receipts):
    finished = []
    async def operation(**kwargs):
        await asyncio.sleep(0.3)
        finished.append("operation")
    async def outcome(*args, **kwargs):
        await asyncio.sleep(0.3)
        finished.append("outcome")
    receipts.side_effect = operation
    obs.observe_persisted_outcome.side_effect = outcome
    @obs.observe_operation("writing_assignment", "submit")
    async def endpoint():
        obs.bind_owned_attempt(row())
        return "accepted"
    assert asyncio.run(endpoint()) == "accepted"
    assert set(finished) == {"operation", "outcome"}


def test_original_exception_survives_recorder_failure(receipts):
    receipts.side_effect = RuntimeError("recorder broke")
    original = HTTPException(409, "canonical conflict")
    @obs.observe_operation("reading_exam", "submit")
    async def endpoint():
        obs.bind_owned_attempt(row())
        raise original
    with pytest.raises(HTTPException) as raised:
        asyncio.run(endpoint())
    assert raised.value is original


def test_unauthorized_failure_has_no_bound_or_prestart_evidence(receipts):
    @obs.observe_operation("reading_exam", "start")
    async def endpoint():
        raise HTTPException(401, "unauthorized")
    with pytest.raises(HTTPException):
        asyncio.run(endpoint())
    receipts.assert_not_called()


def test_admitted_preinsert_failure_is_not_a_learner_attempt(receipts):
    @obs.observe_operation("reading_exam", "start")
    async def endpoint():
        obs.admit_start()
        raise TimeoutError()
    with pytest.raises(TimeoutError):
        asyncio.run(endpoint())
    event = receipts.call_args.kwargs
    assert event["canonical_attempt_id"] is None
    assert event["error_code"] == "timeout" and event["outcome"] is None


def test_context_isolated_for_concurrent_requests_and_cleared_afterwards(receipts):
    attempts = [row(), row()]
    @obs.observe_operation("reading_exam", "save")
    async def endpoint(attempt):
        obs.bind_owned_attempt(attempt)
        await asyncio.sleep(0)
    async def run():
        await asyncio.gather(*(endpoint(attempt) for attempt in attempts))
        assert obs._current.get() is None
    asyncio.run(run())
    assert {call.kwargs["canonical_attempt_id"] for call in receipts.call_args_list} == {UUID(a["id"]) for a in attempts}
    assert len({call.kwargs["operation_id"] for call in receipts.call_args_list}) == 2


@pytest.mark.parametrize("score,band,expected", [(0, None, "success"), (1, 4.0, "success"),
                                             (None, None, "unknown"), (float("nan"), 2, "unknown")])
def test_result_uses_persisted_fields_not_http_or_exam_pass_score(receipts, score, band, expected):
    attempt = row()
    @obs.observe_operation("listening_test", "submit")
    async def endpoint():
        obs.bind_owned_attempt(attempt)
        obs.note_persisted_exam_result(attempt | {
            "status": "submitted", "score": score, "band_estimate": band,
            "grading_details": [{"q_num": 1, "correct": score == 1}],
            "submitted_at": "2026-09-10T00:00:00Z",
        }, expected_questions=[{"q_num": 1}])
        return {"sealed": True}
    assert asyncio.run(endpoint()) == {"sealed": True}
    assert receipts.call_args.kwargs["outcome"] == expected
    assert "grading_details" not in receipts.call_args.kwargs


@pytest.mark.parametrize("details,score", [([], 0), ([{}], 0), ([{"q_num": 2, "correct": False}], 0),
    ([{"q_num": 1, "correct": True}], 0), ([{"q_num": 1, "correct": "false"}], 0),
    ([{"q_num": 1, "correct": True}, {"q_num": 1, "correct": True}], 2)])
def test_partial_or_inconsistent_grading_is_unknown(receipts, details, score):
    attempt = row()
    @obs.observe_operation("reading_exam", "submit")
    async def endpoint():
        obs.bind_owned_attempt(attempt)
        obs.note_persisted_exam_result(attempt | {
            "status": "submitted", "score": score, "band_estimate": None,
            "grading_details": details, "submitted_at": "2026-09-10T00:00:00Z",
        }, expected_questions=[{"q_num": 1}])
    asyncio.run(endpoint())
    assert receipts.call_args.kwargs["outcome"] == "unknown"


@pytest.mark.parametrize("surface", ["reading_exam", "listening_test"])
def test_actual_grader_payload_satisfies_persisted_result_contract(receipts, surface):
    from services import reading_test_grader, listening_test_grader
    grader = reading_test_grader if surface == "reading_exam" else listening_test_grader
    answer_key = [{"q_num": number, "answer": "library"} for number in range(1, 41)]
    graded = grader.grade_attempt([{ "q_num": 1, "user_answer": "library"}], answer_key)
    attempt = row()
    @obs.observe_operation(surface, "submit")
    async def endpoint():
        obs.bind_owned_attempt(attempt)
        obs.note_persisted_exam_result(attempt | {
            "status": "submitted", "score": graded["score"],
            "band_estimate": graded["band_estimate"], "grading_details": graded["per_question"],
            "submitted_at": "2026-09-10T00:00:00Z",
        }, expected_questions=answer_key)
    asyncio.run(endpoint())
    assert receipts.call_args.kwargs["outcome"] == "success"


@pytest.mark.parametrize("change", [{"mode": None}, {"mode": "full_test"},
                                     {"mode": "test_full", "part": None},
                                     {"mode": "test_full", "part": 1, "full_test_attempt_id": None}])
def test_speaking_missing_identity_never_falls_back_to_part_id(receipts, change):
    @obs.observe_operation("speaking", "submit")
    async def endpoint():
        obs.bind_owned_attempt(row(**change))
        return {"accepted": True}
    assert asyncio.run(endpoint()) == {"accepted": True}
    receipts.assert_not_called()


def test_retry_failure_and_success_share_attempt_but_never_invent_failed_outcome(receipts):
    attempt = row()
    @obs.observe_operation("reading_exam", "save")
    async def endpoint(fail):
        obs.bind_owned_attempt(attempt)
        if fail:
            raise HTTPException(500, "save failed")
        return {"saved": True}
    with pytest.raises(HTTPException):
        asyncio.run(endpoint(True))
    asyncio.run(endpoint(False))
    events = [call.kwargs for call in receipts.call_args_list]
    assert events[0]["canonical_attempt_id"] == events[1]["canonical_attempt_id"]
    assert [e["event_kind"] for e in events] == ["operation_failed", "operation_succeeded"]
    assert all(e["outcome"] is None for e in events)


def test_real_route_signature_is_preserved():
    from routers import reading_student, listening, sessions, writing_student
    endpoints = [endpoint for module in (reading_student, listening, sessions, writing_student)
                 for _, endpoint in inspect.getmembers(module, inspect.isfunction)
                 if endpoint.__code__.co_filename == obs.__file__ and hasattr(endpoint, "__wrapped__")]
    assert len(endpoints) == 17
    for endpoint in endpoints:
        assert inspect.signature(endpoint) == inspect.signature(endpoint.__wrapped__, eval_str=True)


@pytest.mark.parametrize("affinity_aware", [False, True])
@pytest.mark.parametrize("full", [False, True])
def test_real_speaking_create_uses_atomic_receipt_for_client_uuid(receipts, monkeypatch, affinity_aware, full):
    from routers import sessions
    from test_sessions_admin_quota import _patch
    client = _patch(monkeypatch)
    monkeypatch.setattr(obs.settings, "SPEAKING_CREATION_RECEIPT_ENABLED", True)
    canonical_id, full_id = uuid4(), uuid4()
    persisted = {}
    calls = []
    def rpc(name, params):
        calls.append((name, params))
        assert name == "fn_create_session_daily_capped_v4"
        existed = bool(persisted)
        if not existed:
            persisted.update(id=params["p_session_id"], mode=params["p_mode"], part=params["p_part"],
                             topic=params["p_topic"], status="in_progress", started_at="2026-09-10T00:00:00Z",
                             full_test_attempt_id=str(full_id) if full else None,
                             renderer_affinity=params["p_renderer_affinity"])
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=[{"session_data": dict(persisted), "created": not existed}]))
    monkeypatch.setattr(client, "rpc", rpc)
    body = sessions.CreateSessionBody(mode="test_full" if full else "practice", part=1, topic="Library",
        client_session_id=canonical_id, renderer_affinity_protocol="claim-v1" if affinity_aware else None)
    first = asyncio.run(sessions.create_session(body))
    second = asyncio.run(sessions.create_session(body))
    assert first == second and first["session_id"] == str(canonical_id)
    assert "created" not in first and "session_data" not in first
    assert all(params["p_renderer_affinity"] == (None if affinity_aware else "legacy") for _, params in calls)
    events = [call.kwargs for call in receipts.call_args_list]
    assert [event["event_kind"] for event in events] == ["started", "operation_succeeded"]
    assert {event["canonical_attempt_id"] for event in events} == {full_id if full else canonical_id}
    assert {event["attempt_kind"] for event in events} == {"speaking_full_test" if full else "speaking_session"}


@pytest.mark.parametrize("created", [None, "true", 1])
def test_real_speaking_invalid_creation_receipt_does_not_guess_new_start(receipts, monkeypatch, created):
    from routers import sessions
    from test_sessions_admin_quota import _patch
    client = _patch(monkeypatch)
    monkeypatch.setattr(obs.settings, "SPEAKING_CREATION_RECEIPT_ENABLED", True)
    def rpc(name, params):
        assert name == "fn_create_session_daily_capped_v4"
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=[{"session_data": {"id": params["p_session_id"]}, "created": created}]))
    monkeypatch.setattr(client, "rpc", rpc)
    with pytest.raises(HTTPException) as error:
        asyncio.run(sessions.create_session(sessions.CreateSessionBody(mode="practice", part=1, topic="Library", client_session_id=uuid4())))
    assert error.value.status_code == 503
    assert receipts.call_args.kwargs["event_kind"] == "operation_failed"
    assert receipts.call_args.kwargs["start_observed"] is False


@pytest.mark.parametrize("protocol", [None, "claim-v1"])
def test_real_speaking_server_minted_ids_are_distinct_and_new(receipts, monkeypatch, protocol):
    from routers import sessions
    from test_sessions_admin_quota import _patch
    client = _patch(monkeypatch)
    monkeypatch.setattr(obs.settings, "SPEAKING_CREATION_RECEIPT_ENABLED", True)
    def rpc(name, params):
        assert name == "fn_create_session_daily_capped_v4"
        assert set(params) == {"p_session_id", "p_user_id", "p_mode", "p_part", "p_topic", "p_day_start", "p_max_daily", "p_renderer_affinity"}
        assert params["p_user_id"] == "user-uuid-test"
        UUID(params["p_session_id"])
        session = row(id=params["p_session_id"], mode=params["p_mode"], part=1, topic="Library", started_at="2026-09-10T00:00:00Z")
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=[{"session_data": session, "created": True}]))
    monkeypatch.setattr(client, "rpc", rpc)
    body = sessions.CreateSessionBody(mode="practice", part=1, topic="Library", renderer_affinity_protocol=protocol)
    first, second = asyncio.run(sessions.create_session(body)), asyncio.run(sessions.create_session(body))
    assert first["session_id"] != second["session_id"]
    assert all(call.kwargs["event_kind"] == "started" for call in receipts.call_args_list)


@pytest.mark.parametrize("missing", [True, False])
def test_speaking_falls_back_only_on_proven_unexecuted_rpc_lookup(receipts, monkeypatch, missing):
    from routers import sessions
    from test_sessions_admin_quota import _patch
    client = _patch(monkeypatch)
    monkeypatch.setattr(obs.settings, "SPEAKING_CREATION_RECEIPT_ENABLED", True)
    calls = []
    class RPCError(Exception):
        code = "PGRST202" if missing else "42501"
        message = "Could not find fn_create_session_daily_capped_v4 in schema cache"
    def rpc(name, params):
        calls.append(name)
        def execute():
            if name.endswith("v4"):
                raise RPCError("private-sentinel")
            return SimpleNamespace(data=[row(id=params["p_session_id"], mode="practice", part=1, topic="Library", started_at="2026-09-10T00:00:00Z")])
        return SimpleNamespace(execute=execute)
    monkeypatch.setattr(client, "rpc", rpc)
    body = sessions.CreateSessionBody(mode="practice", part=1, topic="Library", client_session_id=uuid4(), renderer_affinity_protocol="claim-v1")
    if missing:
        asyncio.run(sessions.create_session(body))
        assert calls == ["fn_create_session_daily_capped_v4", "fn_create_session_daily_capped_v3"]
        assert receipts.call_args.kwargs["event_kind"] == "operation_succeeded"
        assert receipts.call_args.kwargs["start_observed"] is False
    else:
        with pytest.raises(HTTPException):
            asyncio.run(sessions.create_session(body))
        assert calls == ["fn_create_session_daily_capped_v4"]


@pytest.mark.parametrize("evidence_on,receipt_on", [(False, True), (True, False)])
@pytest.mark.parametrize("protocol", [None, "claim-v1"])
@pytest.mark.parametrize("client_uuid", [False, True])
def test_speaking_write_path_stays_legacy_unless_both_flags_are_on(receipts, monkeypatch, evidence_on, receipt_on, protocol, client_uuid):
    from routers import sessions
    from test_sessions_admin_quota import _patch
    client = _patch(monkeypatch)
    monkeypatch.setattr(obs.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", evidence_on)
    monkeypatch.setattr(obs.settings, "SPEAKING_CREATION_RECEIPT_ENABLED", receipt_on)
    expected_rpc = "fn_create_session_daily_capped_v3" if protocol else "fn_create_session_daily_capped_v2" if client_uuid else "fn_create_session_daily_capped"
    calls = []
    def rpc(name, params):
        calls.append(name)
        assert name == expected_rpc
        if protocol:
            assert params["p_renderer_affinity"] is None
        else:
            assert "p_renderer_affinity" not in params
        session = row(id=params.get("p_session_id") or str(uuid4()), mode="practice", part=1, topic="Library", started_at="2026-09-10T00:00:00Z")
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=[session]))
    monkeypatch.setattr(client, "rpc", rpc)
    body = sessions.CreateSessionBody(mode="practice", part=1, topic="Library", client_session_id=uuid4() if client_uuid else None, renderer_affinity_protocol=protocol)
    result = asyncio.run(sessions.create_session(body))
    assert result["session_id"] and calls == [expected_rpc]


def test_speaking_full_test_parts_share_identity_and_only_part_one_starts(receipts):
    full_id = str(uuid4())
    @obs.observe_operation("speaking", "start")
    async def endpoint(part):
        obs.bind_owned_attempt(row(mode="test_full", part=part, full_test_attempt_id=full_id), started=True)
    for part in (1, 2, 3):
        asyncio.run(endpoint(part))
    events = [call.kwargs for call in receipts.call_args_list]
    assert {event["canonical_attempt_id"] for event in events} == {UUID(full_id)}
    assert [event["start_observed"] for event in events] == [True, False, False]
    assert {event["attempt_kind"] for event in events} == {"speaking_full_test"}


def test_plain_speaking_identity_has_a_different_namespace(receipts):
    shared_id = str(uuid4())
    @obs.observe_operation("speaking", "start")
    async def endpoint(full):
        obs.bind_owned_attempt(row(id=shared_id, mode="test_full" if full else "practice",
                                   part=1, full_test_attempt_id=shared_id), started=True)
    asyncio.run(endpoint(False))
    asyncio.run(endpoint(True))
    events = [call.kwargs for call in receipts.call_args_list]
    assert events[0]["canonical_attempt_id"] == events[1]["canonical_attempt_id"]
    assert events[0]["attempt_kind"] != events[1]["attempt_kind"]


def test_real_dictation_resume_is_not_a_new_start(receipts, monkeypatch):
    from routers import listening
    attempt = row(resume_expires_at="2099-01-01T00:00:00Z")
    monkeypatch.setattr(listening, "_require_auth", AsyncMock(return_value={"id": "owner"}))
    monkeypatch.setattr(listening, "_published_test_for_dictation", lambda *a: {})
    monkeypatch.setattr(listening, "_find_latest_in_progress_dictation_attempt", lambda *a: attempt)
    monkeypatch.setattr(listening, "_dictation_attempt_response", lambda value: {"attempt_id": value["id"]})
    result = asyncio.run(listening.start_dictation_attempt("test", section_num=1))
    assert result == {"attempt_id": attempt["id"], "created": False}
    assert receipts.call_args.kwargs["event_kind"] == "operation_succeeded"
    assert receipts.call_args.kwargs["start_observed"] is False


@pytest.mark.parametrize("hint_enabled", [False, True])
def test_real_writing_start_and_lease_refresh_are_one_attempt(receipts, monkeypatch, hint_enabled):
    from routers import writing_student as writing
    from services.core_operation_correlation import operation_hint_scope
    attempt_id = uuid4()
    owner_id, hint = str(uuid4()), str(uuid4())
    state = row(id=str(attempt_id), status="pending", started_at=None, is_timed=False,
                time_limit_minutes=None, renderer_affinity_expires_at="2099-01-01T00:00:00Z")
    class DB:
        def __init__(self):
            self.payload = None
            self.null_filter = None
        def table(self, name):
            self.payload = None
            self.null_filter = None
            return self
        def select(self, *a, **kw): return self
        def eq(self, *a, **kw): return self
        def in_(self, *a, **kw): return self
        def gt(self, *a, **kw): return self
        def limit(self, *a, **kw): return self
        def is_(self, column, value):
            assert (column, value) == ("started_at", "null")
            self.null_filter = column
            return self
        def update(self, payload):
            self.payload = payload
            return self
        def execute(self):
            if self.payload:
                if "started_at" in self.payload:
                    assert self.null_filter == "started_at"
                if self.null_filter and state.get(self.null_filter) is not None:
                    return SimpleNamespace(data=[])
                state.update(self.payload)
            return SimpleNamespace(data=[dict(state)])
    monkeypatch.setattr(writing, "supabase_admin", DB())
    monkeypatch.setattr(writing, "_refresh_writing_renderer_lease", lambda *a: None)
    # Assignment existence alone has emitted nothing.
    receipts.assert_not_called()
    with operation_hint_scope([hint] if hint_enabled else []):
        for _ in range(2):
            result = asyncio.run(writing.start_assignment(attempt_id, student={"id": owner_id}))
            assert result["started"] is True
    events = [call.kwargs for call in receipts.call_args_list]
    assert [e["start_observed"] for e in events] == [True, False]
    assert {e["canonical_attempt_id"] for e in events} == {attempt_id}
    correlations = obs.record_operation_correlation.call_args_list
    assert len(correlations) == (2 if hint_enabled else 0)
    if hint_enabled:
        assert len({c.kwargs["input_digest"] for c in correlations}) == 1


def test_real_reading_foreign_attempt_never_emits_evidence(receipts, monkeypatch):
    from routers import reading_student as reading
    monkeypatch.setattr(reading, "_optional_auth", AsyncMock(return_value={"id": "owner"}))
    def reject(*args):
        raise HTTPException(403, "foreign attempt")
    monkeypatch.setattr(reading, "_fetch_attempt_owned", reject)
    with pytest.raises(HTTPException):
        asyncio.run(reading.submit_reading_test_attempt(str(uuid4()), reading._SubmitRequest(answers=[])))
    receipts.assert_not_called()


def test_real_reading_start_records_only_after_insert(receipts, monkeypatch):
    from routers import reading_student as reading
    committed = []
    class DB:
        def table(self, name): return self
        def insert(self, payload):
            self.payload = payload
            return self
        def execute(self):
            committed.append(dict(self.payload))
            return SimpleNamespace(data=[self.payload])
    monkeypatch.setattr(reading, "_require_auth", AsyncMock(return_value={"id": str(uuid4())}))
    monkeypatch.setattr(reading, "_fetch_published_test", lambda *a: {"id": str(uuid4()), "time_limit_minutes": 60})
    monkeypatch.setattr(reading, "_assert_exam_content_allowed", lambda *a: None)
    monkeypatch.setattr(reading, "_require_test_unlocked", lambda *a: None)
    monkeypatch.setattr(reading, "_abandon_open_attempts", lambda *a: None)
    monkeypatch.setattr(reading, "supabase_admin", DB())
    result = asyncio.run(reading.start_reading_test_attempt("READ-1", body=None))
    assert receipts.call_count == 1 and len(committed) == 1
    event = receipts.call_args.kwargs
    assert event["canonical_attempt_id"] == UUID(result["attempt_id"])
    assert event["event_kind"] == "started" and event["start_observed"]


@pytest.mark.parametrize("surface", ["reading_exam", "listening_test"])
def test_real_sealed_submit_replay_never_exposes_grade(receipts, monkeypatch, surface):
    from routers import reading_student, listening
    attempt = row(status="submitted", sitting_id=str(uuid4()))
    if surface == "reading_exam":
        from services import mock_exam_service
        monkeypatch.setattr(reading_student, "_optional_auth", AsyncMock(return_value={"id": "owner"}))
        monkeypatch.setattr(reading_student, "_fetch_attempt_owned", lambda *a: attempt)
        monkeypatch.setattr(mock_exam_service, "is_sealed", lambda *a: True)
        result = asyncio.run(reading_student.submit_reading_test_attempt(attempt["id"], reading_student._SubmitRequest(answers=[])))
    else:
        monkeypatch.setattr(listening, "_require_auth", AsyncMock(return_value={"id": "owner"}))
        monkeypatch.setattr(listening, "_fetch_attempt_or_404", lambda *a: attempt)
        monkeypatch.setattr(listening, "_mock_sealed", lambda *a: True)
        result = asyncio.run(listening.submit_listening_test_attempt(attempt["id"]))
    assert result == {"received": True, "sitting_id": attempt["sitting_id"], "sealed": True}
    assert receipts.call_args.kwargs["canonical_attempt_id"] == UUID(attempt["id"])
    assert receipts.call_args.kwargs["outcome"] is None  # opaque ACK alone is not outcome evidence
