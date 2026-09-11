"""Retry hints never replace authorization or expose learner input."""

import asyncio
import hashlib
import inspect
import json
import re
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from services import core_operation_correlation as corr, core_attempt_observation as obs
from services.core_attempt_evidence import ReceiptStatus


class Answer(BaseModel):
    q_num: int
    answer: str


@pytest.fixture
def world(monkeypatch):
    monkeypatch.setattr(obs.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", True)
    events = AsyncMock(return_value=ReceiptStatus.RECORDED)
    writer = AsyncMock(return_value=ReceiptStatus.RECORDED)
    monkeypatch.setattr(obs, "try_record_event", events)
    monkeypatch.setattr(obs, "record_operation_correlation", writer)
    return events, writer


def app_for(owner=None):
    from main import request_id_middleware
    app = FastAPI()
    app.middleware("http")(request_id_middleware)
    user_id = str(owner or uuid4())
    @app.patch("/answer/{attempt_id}")
    @obs.observe_operation("reading_exam", "save", correlate_by=("attempt_id", "body"))
    async def answer(attempt_id: UUID, body: Answer, authorization: str | None = Header(default=None)):
        if authorization != "Bearer fixture":
            raise HTTPException(403, "not allowed")
        obs.bind_owned_attempt({"id": str(attempt_id), "user_id": user_id, "renderer_affinity": "next"})
        await asyncio.sleep(0)
        return {"saved": True}
    return app


def test_same_hint_input_and_owner_correlate_distinct_server_operations(world):
    events, writer = world
    owner, attempt, hint = uuid4(), uuid4(), uuid4()
    with TestClient(app_for(owner)) as client:
        for body in ({"q_num": 1, "answer": "private answer"}, {"answer": "private answer", "q_num": 1}):
            result = client.patch(f"/answer/{attempt}", json=body, headers={"Authorization": "Bearer fixture", corr.HEADER_NAME: str(hint)})
            assert result.status_code == 200 and result.json() == {"saved": True}
    first, second = [call.kwargs for call in writer.call_args_list]
    assert first["input_digest"] == second["input_digest"]
    assert first["operation_id"] != second["operation_id"]
    assert first["client_operation_id"] == second["client_operation_id"] == hint
    assert all(c.kwargs["operation_id"] in {first["operation_id"], second["operation_id"]} for c in events.call_args_list)
    encoded = json.dumps([first, second], default=str)
    assert "private answer" not in encoded and str(owner) not in encoded
    assert corr.current_operation_hint() is None and obs._current.get() is None


def test_changed_input_or_owner_does_not_merge_by_browser_uuid(world):
    _, writer = world
    attempt, hint = uuid4(), str(uuid4())
    for owner in (uuid4(), uuid4()):
        with TestClient(app_for(owner)) as client:
            for value in ("one", "two"):
                response = client.patch(f"/answer/{attempt}", json={"q_num": 1, "answer": value},
                                        headers={"Authorization": "Bearer fixture", corr.HEADER_NAME: hint})
                assert response.status_code == 200
    assert len({call.kwargs["input_digest"] for call in writer.call_args_list}) == 4


@pytest.mark.parametrize("headers", [{}, {corr.HEADER_NAME: "bad"}, {corr.HEADER_NAME: "x" * 1000}])
def test_missing_or_invalid_hint_keeps_business_response_without_correlation(world, headers):
    events, writer = world
    with TestClient(app_for()) as client:
        result = client.patch(f"/answer/{uuid4()}", json={"q_num": 1, "answer": "value"}, headers=headers | {"Authorization": "Bearer fixture"})
    assert result.status_code == 200
    assert events.await_count == 1 and writer.await_count == 0


def test_duplicate_headers_and_unauthorized_requests_never_correlate(world):
    events, writer = world
    with TestClient(app_for()) as client:
        path = f"/answer/{uuid4()}"
        result = client.patch(path, json={"q_num": 1, "answer": "private"}, headers=[
            ("Authorization", "Bearer fixture"), (corr.HEADER_NAME, str(uuid4())), (corr.HEADER_NAME, str(uuid4()))])
        assert result.status_code == 200 and writer.await_count == 0
        events.reset_mock()
        result = client.patch(path, json={"q_num": 1, "answer": "private"}, headers={corr.HEADER_NAME: str(uuid4())})
        assert result.status_code == 403
    assert events.await_count == writer.await_count == 0


def test_failure_does_not_replace_original_result_or_exception(world):
    _, writer = world
    writer.side_effect = RuntimeError("correlation unavailable")
    with TestClient(app_for()) as client:
        result = client.patch(f"/answer/{uuid4()}", json={"q_num": 1, "answer": "private"},
                              headers={"Authorization": "Bearer fixture", corr.HEADER_NAME: str(uuid4())})
    assert result.status_code == 200 and result.json() == {"saved": True}
    @obs.observe_operation("reading_exam", "save", correlate_by=())
    async def failing():
        obs.bind_owned_attempt({"id": str(uuid4()), "user_id": str(uuid4())})
        raise RuntimeError("original failure")
    with corr.operation_hint_scope([str(uuid4())]):
        with pytest.raises(RuntimeError, match="original failure"):
            asyncio.run(failing())


def test_unbound_preinsert_failure_cannot_fabricate_owned_correlation(world):
    events, writer = world
    @obs.observe_operation("reading_exam", "start", correlate_by=())
    async def failing():
        obs.admit_start()
        raise RuntimeError("before create")
    with corr.operation_hint_scope([str(uuid4())]):
        with pytest.raises(RuntimeError, match="before create"):
            asyncio.run(failing())
    assert writer.await_count == 0
    assert events.call_args.kwargs["canonical_attempt_id"] is None


def test_concurrent_contexts_are_isolated_and_no_hint_carries_to_next_request(world):
    _, writer = world
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_for()), base_url="http://test") as client:
            pairs = [(uuid4(), uuid4()) for _ in range(3)]
            results = await asyncio.gather(*[client.patch(f"/answer/{attempt}", json={"q_num": 1, "answer": str(index)},
                headers={"Authorization": "Bearer fixture", corr.HEADER_NAME: str(hint)}) for index, (attempt, hint) in enumerate(pairs)])
            assert all(r.status_code == 200 for r in results)
            await client.patch(f"/answer/{uuid4()}", json={"q_num": 1, "answer": "no hint"}, headers={"Authorization": "Bearer fixture"})
            return pairs
    pairs = asyncio.run(run())
    assert {(c.kwargs["canonical_attempt_id"], c.kwargs["client_operation_id"]) for c in writer.call_args_list} == set(pairs)


def test_cors_allows_hint_without_replacing_existing_headers():
    from main import app, origins
    response = TestClient(app).options("/api/reading/test/attempts/example/answers", headers={
        "Origin": origins[0], "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "authorization,content-type,x-reading-anon,x-core-operation-id",
    })
    assert response.status_code == 200
    assert "x-core-operation-id" in response.headers["access-control-allow-headers"].lower()


@pytest.mark.parametrize("names", [("authorization",), ("request",), ("missing",)])
def test_bad_input_declaration_fails_before_route_installation(names):
    async def endpoint(body=None, authorization=None, request=None): pass
    with pytest.raises(ValueError, match="unsafe"):
        obs.observe_operation("reading_exam", "save", correlate_by=names)(endpoint)


def test_body_fingerprinting_does_not_consume_streams_or_stringify_objects(caplog):
    class Stream:
        def read(self): raise AssertionError("must not read")
        def __str__(self): raise AssertionError("must not stringify")
    async def endpoint(body): pass
    assert corr.input_fingerprint("endpoint", inspect.signature(endpoint), ("body",), (Stream(),), {}) is None
    assert "Stream" not in caplog.text


def test_configured_real_json_routes_preserve_signatures_and_exclude_binary_admin_paths():
    from routers import reading_student, listening, sessions, writing_student, grading, admin
    endpoints = [endpoint for module in (reading_student, listening, sessions, writing_student)
                 for _, endpoint in inspect.getmembers(module, inspect.isfunction)
                 if getattr(endpoint, "__core_correlation_fields__", None) is not None]
    assert len(endpoints) == 17
    for endpoint in endpoints:
        assert inspect.signature(endpoint) == inspect.signature(endpoint.__wrapped__, eval_str=True)
        assert not set(endpoint.__core_correlation_fields__) & corr.FORBIDDEN_INPUT_NAMES
    assert grading.grade_response_endpoint.__core_correlation_fields__ is None
    assert grading.grade_response_endpoint.__core_audio_correlation__ is True
    for _, endpoint in inspect.getmembers(admin, inspect.isfunction):
        assert getattr(endpoint, "__core_correlation_fields__", None) is None


def test_hint_scope_restores_parent_on_cancellation():
    outer, inner = uuid4(), uuid4()
    with corr.operation_hint_scope([str(outer)]):
        with pytest.raises(asyncio.CancelledError):
            with corr.operation_hint_scope([str(inner)]):
                assert corr.current_operation_hint() == inner
                raise asyncio.CancelledError()
        assert corr.current_operation_hint() == outer
    assert corr.current_operation_hint() is None


def test_anonymous_owner_is_scoped_without_retaining_capability():
    from routers.reading_student import _gen_anon_id
    # Exercise the real capability mint, not only fixed synthetic strings.
    # This is also the shape admitted by anonymousReadingScope in the browser.
    capability, other_capability = _gen_anon_id(), _gen_anon_id()
    assert re.fullmatch(r"[A-Za-z0-9_-]{32}", capability)
    assert re.fullmatch(r"[A-Za-z0-9_-]{32}", other_capability)
    first = corr.owner_fingerprint({"anon_id": capability})
    second = corr.owner_fingerprint({"anon_id": other_capability})
    assert len(first) == 64 and first != second and capability not in first
    for value in [capability, other_capability, "a" * 32, "A" * 30 + "-_", "0" * 32]:
        assert corr.owner_fingerprint({"anon_id": value}) == hashlib.sha256(("anonymous:" + value).encode()).hexdigest()
    assert corr.owner_fingerprint({"anon_id": "not a canonical capability"}) is None
    assert corr.owner_fingerprint({}) is None


@pytest.mark.parametrize("enabled,mode,expected", [(False, "ok", "disabled"), (True, "ok", "recorded"),
    (True, "error", "unavailable"), (True, "conflict", "conflict"), (True, "bad", "unavailable"), (True, "timeout", "unavailable")])
def test_actual_recorder_is_bounded_and_fail_open(monkeypatch, enabled, mode, expected, caplog):
    operation = uuid4()
    calls = []
    class DB:
        def rpc(self, name, payload):
            assert name == "fn_record_core_operation_correlation"
            calls.append(payload)
            return self
        async def execute(self):
            if mode == "timeout": await asyncio.Event().wait()
            if mode in {"error", "conflict"}:
                error = RuntimeError("private raw exception")
                error.code = "23505" if mode == "conflict" else "PGRST202"
                raise error
            return SimpleNamespace(data=str(operation) if mode == "ok" else "bad")
    monkeypatch.setattr(corr.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", enabled)
    monkeypatch.setattr(corr, "get_supabase_async", AsyncMock(return_value=DB()))
    monkeypatch.setattr(corr, "CORRELATION_BUDGET_SECONDS", 0.01)
    result = asyncio.run(corr.record_operation_correlation(operation_id=operation, surface="reading_exam", attempt_kind="default",
        canonical_attempt_id=uuid4(), operation="save", client_operation_id=uuid4(), input_digest="a" * 64))
    assert result.value == expected and len(calls) == int(enabled)
    assert "private raw exception" not in caplog.text
