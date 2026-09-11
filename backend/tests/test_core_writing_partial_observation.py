"""Request-local partial-write candidates are not operation-success receipts."""

import asyncio
import inspect
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from services import core_writing_observation as partial


@pytest.fixture
def capture(monkeypatch):
    monkeypatch.setattr(partial.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", True)
    capture = AsyncMock()
    monkeypatch.setattr(partial, "observe_writing_batch", capture)
    return capture


@pytest.mark.asyncio
@pytest.mark.parametrize("fail", [False, True])
async def test_only_partial_failure_emits_and_preserves_original_result(capture, fail):
    essay = uuid4()
    failure = RuntimeError("product failure")
    result = object()
    @partial.observe_writing_partial_failure
    async def endpoint(essay_id: UUID):
        partial.note_writing_mutation(str(essay_id))
        partial.note_writing_mutation(str(essay_id).upper())
        if fail:
            raise failure
        return result
    assert inspect.signature(endpoint).parameters["essay_id"].annotation is UUID
    if fail:
        with pytest.raises(RuntimeError) as exc:
            await endpoint(essay)
        assert exc.value is failure
        capture.assert_awaited_once_with([str(essay)])
    else:
        assert await endpoint(essay) is result
        capture.assert_not_awaited()
    assert partial._current.get() is None


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["disabled", "no_write", "cancelled"])
async def test_disabled_no_ack_or_cancellation_do_not_emit(capture, monkeypatch, mode):
    monkeypatch.setattr(partial.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", mode != "disabled")
    @partial.observe_writing_partial_failure
    async def endpoint():
        if mode != "no_write":
            partial.note_writing_mutation(str(uuid4()))
        if mode == "cancelled":
            raise asyncio.CancelledError()
        raise RuntimeError("failed")
    with pytest.raises(asyncio.CancelledError if mode == "cancelled" else RuntimeError):
        await endpoint()
    capture.assert_not_awaited()
    assert partial._current.get() is None


@pytest.mark.asyncio
async def test_observer_error_cannot_replace_product_error(capture, caplog):
    failure = ValueError("product failure")
    capture.side_effect = RuntimeError("PRIVATE_OBSERVER_PAYLOAD")
    @partial.observe_writing_partial_failure
    async def endpoint():
        partial.note_writing_mutation(str(uuid4()))
        raise failure
    with pytest.raises(ValueError) as exc:
        await endpoint()
    assert exc.value is failure
    assert "PRIVATE_OBSERVER_PAYLOAD" not in caplog.text
    assert "core_writing_partial_observation_unavailable" in caplog.text


@pytest.mark.asyncio
async def test_concurrent_requests_do_not_mix_candidates(capture):
    first, second = uuid4(), uuid4()
    ready = asyncio.Event()
    @partial.observe_writing_partial_failure
    async def endpoint(essay):
        partial.note_writing_mutation(str(essay))
        if essay == second:
            ready.set()
        await ready.wait()
        raise RuntimeError("failed")
    results = await asyncio.gather(endpoint(first), endpoint(second), return_exceptions=True)
    assert all(isinstance(result, RuntimeError) for result in results)
    assert {tuple(call.args[0]) for call in capture.await_args_list} == {(str(first),), (str(second),)}
    assert partial._current.get() is None


@pytest.mark.asyncio
async def test_inherited_context_cannot_add_after_scope_closes(capture):
    ready = asyncio.Event()
    tasks = []
    contexts = []
    essay = str(uuid4())
    @partial.observe_writing_partial_failure
    async def endpoint():
        partial.note_writing_mutation(essay)
        contexts.append(partial._current.get())
        async def late():
            await ready.wait()
            partial.note_writing_mutation(str(uuid4()))
        tasks.append(asyncio.create_task(late()))
        raise RuntimeError("failed")
    with pytest.raises(RuntimeError):
        await endpoint()
    ready.set()
    await asyncio.gather(*tasks)
    assert contexts[0].ids == {essay}
    assert contexts[0].active is False
    capture.assert_awaited_once_with([essay])


@pytest.mark.asyncio
async def test_invalid_id_and_limit_are_static_warnings(capture, caplog):
    @partial.observe_writing_partial_failure
    async def endpoint():
        partial.note_writing_mutation("PRIVATE_INVALID_ID")
        for _ in range(201):
            partial.note_writing_mutation(str(uuid4()))
        raise RuntimeError("failed")
    with pytest.raises(RuntimeError):
        await endpoint()
    assert len(capture.call_args.args[0]) == 200
    assert "PRIVATE_INVALID_ID" not in caplog.text
    assert "core_writing_partial_identity_invalid" in caplog.text
    assert "core_writing_partial_identity_limit" in caplog.text


@pytest.mark.asyncio
async def test_nested_scopes_restore_parent_without_merging(capture):
    first, second = str(uuid4()), str(uuid4())
    @partial.observe_writing_partial_failure
    async def inner():
        partial.note_writing_mutation(second)
        raise RuntimeError("inner failure")
    @partial.observe_writing_partial_failure
    async def outer():
        partial.note_writing_mutation(first)
        parent = partial._current.get()
        with pytest.raises(RuntimeError):
            await inner()
        assert partial._current.get() is parent
        raise RuntimeError("outer failure")
    with pytest.raises(RuntimeError, match="outer failure"):
        await outer()
    assert capture.await_args_list[0].args == ([second],)
    assert capture.await_args_list[1].args == ([first],)
    assert partial._current.get() is None


def test_sync_endpoint_rejected_at_decoration():
    with pytest.raises(TypeError, match="requires an async endpoint"):
        partial.observe_writing_partial_failure(lambda: {})


@pytest.mark.asyncio
async def test_cancellation_during_observation_keeps_product_error_as_context(capture):
    ready = asyncio.Event()
    failure = RuntimeError("product failure")
    async def observe(ids):
        ready.set()
        await asyncio.Event().wait()
    capture.side_effect = observe
    @partial.observe_writing_partial_failure
    async def endpoint():
        partial.note_writing_mutation(str(uuid4()))
        raise failure
    task = asyncio.create_task(endpoint())
    await asyncio.wait_for(ready.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError) as exc:
        await asyncio.wait_for(task, 1)
    assert exc.value.__context__ is failure
    assert partial._current.get() is None
