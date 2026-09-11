"""Actual practice check/reveal routes, with opt-in metadata-only evidence."""

import asyncio
import copy
import json
from dataclasses import asdict
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import test_student_listening_full_test as fixtures
from routers import listening
from services import core_attempt_observation as obs
from services import core_operation_correlation as correlation
from services import listening_test_grader as grader
from services.core_attempt_evidence import EvidenceEvent, ReceiptStatus


def setup(monkeypatch, *, enabled=True):
    user = str(uuid4())
    db, auth = fixtures._patch(monkeypatch, user_id=user)
    test, attempt_id = fixtures._seed_practice(db, user_id=user)
    attempt = db.tables["listening_test_attempts"][0]
    attempt["renderer_affinity"] = "next"
    events, correlations, states, calls = [], [], [], []
    monkeypatch.setattr(obs.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", enabled)
    read_outcome = AsyncMock()
    proof = AsyncMock(return_value=ReceiptStatus.RECORDED)
    monkeypatch.setattr(obs, "observe_persisted_outcome", read_outcome)
    monkeypatch.setattr(obs, "record_exam_result_proof", proof)

    async def record(**fields):
        events.append(EvidenceEvent(**fields))
        states.append(copy.deepcopy(attempt))
        return ReceiptStatus.RECORDED

    async def correlate(**fields):
        correlations.append(fields)
        return ReceiptStatus.RECORDED

    monkeypatch.setattr(obs, "try_record_event", record)
    monkeypatch.setattr(obs, "record_operation_correlation", correlate)
    execute = fixtures._Q.execute

    def snapshot(query):
        calls.append((query.name, query._mode))
        result = execute(query)
        return SimpleNamespace(data=copy.deepcopy(result.data), count=result.count)

    monkeypatch.setattr(fixtures._Q, "execute", snapshot)

    def invoke(**fields):
        return listening.check_listening_practice_answer(
            attempt_id, listening.PracticeCheckRequest(q_num=1, **fields), authorization=auth)

    return SimpleNamespace(db=db, auth=auth, user=user, test=test, attempt_id=attempt_id,
                           attempt=attempt, events=events, correlations=correlations,
                           states=states, calls=calls, invoke=invoke, read_outcome=read_outcome, proof=proof)


@pytest.mark.parametrize("enabled", [False, True])
def test_check_retry_reveal_submit_preserve_first_answer_without_extra_attempts(monkeypatch, enabled):
    world = setup(monkeypatch, enabled=enabled)
    first = asyncio.run(world.invoke(user_answer="ninety"))
    retry = asyncio.run(world.invoke(user_answer="nineteen"))
    reveal = asyncio.run(world.invoke(reveal=True))
    assert first["correct"] is False and first["recorded"] is True
    assert retry["correct"] is True and retry["canonical_correct"] is False and retry["recorded"] is False
    assert reveal["revealed"] is True and reveal["expected"] == "nineteen"
    assert len(world.attempt["answers"]) == 1 and world.attempt["answers"][0]["user_answer"] == "ninety"
    assert all("expected" not in reply for reply in (first, retry))
    assert len(world.events) == (2 if enabled else 0)
    for event in world.events:
        assert event.operation == "grade" and event.event_kind == "operation_succeeded"
        assert event.outcome is None and event.error_code is None and not event.start_observed
        assert event.canonical_attempt_id == UUID(world.attempt_id) and event.surface == "listening_test"
        assert event.attempt_kind == "default" and event.renderer == "next"
        assert event.traffic_class == "unknown" and event.release_id is None
    if enabled:
        assert world.events[0].operation_id != world.events[1].operation_id
        assert all(state["answers"][0]["user_answer"] == "ninety" for state in world.states)
    world.read_outcome.assert_not_awaited()
    world.proof.assert_not_awaited()
    result = asyncio.run(listening.submit_listening_test_attempt(world.attempt_id, authorization=world.auth))
    assert result["score"] == 0 and result["max_score"] == 2 and world.attempt["status"] == "submitted"
    assert len(world.events) == (4 if enabled else 0)
    if enabled:
        assert [event.operation for event in world.events] == ["grade", "grade", "submit", "submit"]
        assert [event.outcome for event in world.events].count("success") == 1
    metadata = str([asdict(event) for event in world.events]) + str(world.correlations)
    for private in (world.user, world.test["id"], "ninety", "nineteen", "Người nói", world.auth):
        assert private not in metadata
    assert all(mode == "select" for _, mode in world.calls[:-1])


@pytest.mark.parametrize("denial,expected_status", [("auth", 401), ("owner", 403), ("missing", 404)])
def test_unauthorized_or_missing_attempts_never_create_evidence(monkeypatch, denial, expected_status):
    world = setup(monkeypatch)
    if denial == "auth":
        monkeypatch.setattr(listening, "_require_auth", AsyncMock(side_effect=HTTPException(401)))
    elif denial == "owner":
        world.attempt["user_id"] = str(uuid4())
    else:
        world.db.tables["listening_test_attempts"].clear()
    with pytest.raises(HTTPException) as error:
        asyncio.run(world.invoke(user_answer="ninety"))
    assert error.value.status_code == expected_status
    assert world.events == world.correlations == [] and world.attempt["answers"] == []


@pytest.mark.parametrize("scenario,status", [("submitted", 422), ("abandoned", 422), ("expired", 410),
                                           ("missing_expiry", 410), ("full", 422), ("mini", 422),
                                           ("drill", 422), ("missing_test", 404), ("missing_question", 404)])
def test_owned_rejected_check_is_failed_operation_not_failed_attempt(monkeypatch, scenario, status):
    world = setup(monkeypatch)
    if scenario in {"submitted", "abandoned"}: world.attempt["status"] = scenario
    if scenario == "expired": world.attempt["resume_expires_at"] = "2000-01-01T00:00:00Z"
    if scenario == "missing_expiry": world.attempt["resume_expires_at"] = None
    if scenario in {"full", "mini", "drill"}: world.test["test_type"] = scenario
    if scenario == "missing_test": world.db.tables["listening_tests"].clear()
    if scenario == "missing_question": world.db.tables["listening_exercises"].clear()
    with pytest.raises(HTTPException) as error:
        asyncio.run(world.invoke(user_answer="ninety"))
    assert error.value.status_code == status
    assert len(world.events) == 1 and world.events[0].event_kind == "operation_failed"
    assert world.events[0].operation == "grade" and world.events[0].error_code == "rejected"
    assert world.events[0].outcome is None and world.attempt["answers"] == []
    world.read_outcome.assert_not_awaited()


@pytest.mark.parametrize("answer,status", [(None, 422), ("nineteen", 422), ("ninety", 200)])
def test_reveal_success_and_refusal_never_claim_mutation_or_record_correlation(monkeypatch, answer, status):
    world = setup(monkeypatch)
    if answer is not None: world.attempt["answers"] = [{"q_num": 1, "user_answer": answer}]
    before = copy.deepcopy(world.attempt)
    with correlation.operation_hint_scope([str(uuid4())]):
        if status == 200:
            assert asyncio.run(world.invoke(reveal=True))["revealed"] is True
        else:
            with pytest.raises(HTTPException) as error: asyncio.run(world.invoke(reveal=True))
            assert error.value.status_code == status
    assert world.events == world.correlations == [] and world.attempt == before
    assert all(mode == "select" for _, mode in world.calls)


@pytest.mark.parametrize("committed", [False, True])
def test_rpc_failure_and_lost_ack_preserve_work_and_original_error(monkeypatch, committed):
    world = setup(monkeypatch)
    rpc = world.db.rpc
    failure = RuntimeError("private synthetic RPC failure")

    def fail(name, params):
        if committed: rpc(name, params)
        raise failure

    world.db.rpc = fail
    with pytest.raises(RuntimeError) as error: asyncio.run(world.invoke(user_answer="ninety"))
    assert error.value is failure
    assert len(world.attempt["answers"]) == int(committed)
    assert len(world.events) == 1 and world.events[0].event_kind == "operation_failed"
    assert world.events[0].outcome is None and world.events[0].error_code == "server_error"
    world.db.rpc = rpc
    retry = asyncio.run(world.invoke(user_answer="nineteen"))
    assert retry["recorded"] is (not committed) and retry["canonical_correct"] is (not committed)
    assert len(world.attempt["answers"]) == 1 and len(world.events) == 2


def test_grading_failure_after_write_does_not_erase_first_answer(monkeypatch):
    world = setup(monkeypatch)
    grade = grader.grade_attempt
    failure = RuntimeError("private synthetic grading failure")
    monkeypatch.setattr(grader, "grade_attempt", lambda *_: (_ for _ in ()).throw(failure))
    with pytest.raises(RuntimeError) as error: asyncio.run(world.invoke(user_answer="ninety"))
    assert error.value is failure and world.attempt["answers"][0]["user_answer"] == "ninety"
    assert world.events[0].event_kind == "operation_failed" and world.events[0].outcome is None
    monkeypatch.setattr(grader, "grade_attempt", grade)
    assert asyncio.run(world.invoke(user_answer="nineteen"))["canonical_correct"] is False
    assert world.events[-1].event_kind == "operation_succeeded"


@pytest.mark.parametrize("winner", [True, False])
@pytest.mark.parametrize("enabled", [False, True])
def test_concurrent_write_requires_verified_first_answer_before_returning_success(monkeypatch, winner, enabled):
    world = setup(monkeypatch, enabled=enabled)

    def race(name, params):
        assert name == "fn_insert_listening_answer_once"
        if winner:
            world.attempt["answers"] = [{"q_num": 1, "user_answer": "nineteen"}]
        else:
            world.attempt["status"] = "submitted"
        return fixtures._RpcResult(False)

    world.db.rpc = race
    if winner:
        reply = asyncio.run(world.invoke(user_answer="ninety"))
        assert reply["canonical_correct"] is True and reply["recorded"] is False
    else:
        with pytest.raises(HTTPException) as error: asyncio.run(world.invoke(user_answer="ninety"))
        assert error.value.status_code == 409
    assert len(world.events) == int(enabled)
    if enabled:
        assert world.events[0].event_kind == ("operation_succeeded" if winner else "operation_failed")
        assert world.events[0].outcome is None


@pytest.mark.parametrize("invalid", ["false", 0, 1, [], {}, None])
@pytest.mark.parametrize("enabled", [False, True])
def test_unexpected_rpc_shape_or_rejected_write_never_claims_success(monkeypatch, invalid, enabled):
    world = setup(monkeypatch, enabled=enabled)
    world.db.rpc = lambda *_: fixtures._RpcResult(invalid)
    with pytest.raises(HTTPException) as error: asyncio.run(world.invoke(user_answer="ninety"))
    assert error.value.status_code == (422 if invalid is None else 503)
    assert len(world.events) == int(enabled) and world.attempt["answers"] == []
    if enabled:
        assert world.events[0].event_kind == "operation_failed" and world.events[0].outcome is None


def test_same_hint_same_owned_inputs_correlate_without_reusing_server_operation(monkeypatch):
    world = setup(monkeypatch)
    with correlation.operation_hint_scope([str(uuid4())]):
        asyncio.run(world.invoke(user_answer="ninety"))
        asyncio.run(world.invoke(user_answer="ninety"))
        asyncio.run(world.invoke(user_answer="nineteen"))
        asyncio.run(world.invoke(reveal=True))
    assert len(world.correlations) == len(world.events) == 3
    a, b, c = world.correlations
    assert a["input_digest"] == b["input_digest"] != c["input_digest"]
    assert a["client_operation_id"] == b["client_operation_id"] == c["client_operation_id"]
    assert len({item["operation_id"] for item in world.correlations}) == 3
    assert all(item["operation"] == "grade" and item["canonical_attempt_id"] == UUID(world.attempt_id)
               for item in world.correlations)
    assert obs._current.get() is None


def test_recorder_failure_is_isolated_from_grade_response_and_saved_work(monkeypatch, caplog):
    world = setup(monkeypatch)
    monkeypatch.setattr(obs, "try_record_event", AsyncMock(side_effect=RuntimeError("private recorder detail")))
    reply = asyncio.run(world.invoke(user_answer="nineteen"))
    assert reply["recorded"] is True and reply["canonical_correct"] is True
    assert len(world.attempt["answers"]) == 1
    assert "core_attempt_observation_unavailable" in caplog.text and "private recorder detail" not in caplog.text
    assert obs._current.get() is None


@pytest.mark.parametrize("value", [True, False, None])
def test_installed_postgrest_client_preserves_boolean_rpc_contract(value):
    from postgrest import SyncPostgrestClient
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, content=json.dumps(value),
                                                                                 headers={"Content-Type": "application/json"}))) as http:
        db = SyncPostgrestClient("https://practice.invalid/rest/v1", http_client=http)
        returned = db.rpc("fn_insert_listening_answer_once", {}).execute().data
    assert returned is value


@pytest.mark.parametrize("scenario,status", [("success", 200), ("conflict", 409),
                                           ("malformed", 503), ("owner", 403)])
@pytest.mark.parametrize("enabled", [False, True])
def test_http_practice_route_preserves_body_auth_and_truthful_error_status(monkeypatch, scenario, status, enabled):
    from main import request_id_middleware
    world = setup(monkeypatch, enabled=enabled)
    if scenario == "conflict": world.db.rpc = lambda *_: fixtures._RpcResult(False)
    if scenario == "malformed": world.db.rpc = lambda *_: fixtures._RpcResult("private bad shape")
    if scenario == "owner": world.attempt["user_id"] = str(uuid4())
    app = FastAPI()
    app.middleware("http")(request_id_middleware)
    app.include_router(listening.user_router)
    hint = uuid4()
    with TestClient(app) as client:
        response = client.post(f"/api/listening/tests/attempts/{world.attempt_id}/check",
                               json={"q_num": 1, "user_answer": "nineteen"},
                               headers={"Authorization": world.auth, correlation.HEADER_NAME: str(hint)})
    assert response.status_code == status and "private bad shape" not in response.text
    if status == 200:
        assert response.json()["recorded"] is True and response.json()["canonical_correct"] is True
    if scenario == "owner" or not enabled:
        assert world.events == world.correlations == []
    else:
        assert len(world.events) == 1 and world.events[0].operation == "grade"
        assert world.events[0].outcome is None
        assert world.events[0].event_kind == ("operation_succeeded" if status == 200 else "operation_failed")
        assert len(world.correlations) == 1
        observed = world.correlations[0]
        assert observed["client_operation_id"] == hint
        assert observed["canonical_attempt_id"] == UUID(world.attempt_id)
        assert observed["operation_id"] == world.events[0].operation_id
        assert observed["operation"] == "grade"
    assert correlation.current_operation_hint() is None and obs._current.get() is None


def test_real_http_retry_and_reveal_keep_canonical_grade_and_isolated_hint_context(monkeypatch):
    from main import request_id_middleware
    world = setup(monkeypatch)
    app = FastAPI()
    app.middleware("http")(request_id_middleware)
    app.include_router(listening.user_router)
    hint = str(uuid4())
    headers = {"Authorization": world.auth, correlation.HEADER_NAME: hint}
    path = f"/api/listening/tests/attempts/{world.attempt_id}/check"
    first_answers = None
    with TestClient(app) as client:
        for answer in ("ninety", "ninety", "nineteen"):
            reply = client.post(path, json={"q_num": 1, "user_answer": answer}, headers=headers)
            assert reply.status_code == 200 and reply.json()["canonical_correct"] is False
            if first_answers is None:
                first_answers = copy.deepcopy(world.attempt["answers"])
        reveal = client.post(path, json={"q_num": 1, "reveal": True}, headers=headers)
        assert reveal.status_code == 200 and reveal.json()["revealed"] is True
        # A later request without a header must not inherit the previous hint.
        reply = client.post(path, json={"q_num": 1, "user_answer": "nineteen"},
                            headers={"Authorization": world.auth})
        assert reply.status_code == 200
    assert world.attempt["answers"] == first_answers
    assert [(row["q_num"], row["user_answer"]) for row in world.attempt["answers"]] == [(1, "ninety")]
    assert len(world.events) == 4 and len(world.correlations) == 3
    a, b, c = world.correlations
    assert a["input_digest"] == b["input_digest"] != c["input_digest"]
    assert all(row["client_operation_id"] == UUID(hint) for row in world.correlations)
    assert len({row["operation_id"] for row in world.correlations}) == 3
    assert all(event.outcome is None for event in world.events)
    assert not any(private in str(world.correlations) for private in ("ninety", "nineteen", world.auth, world.user))
    assert correlation.current_operation_hint() is None and obs._current.get() is None
