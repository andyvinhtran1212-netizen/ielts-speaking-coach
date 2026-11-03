"""PC-J540: cancelled prompt writes retain worker diagnostics and dispatch once."""

import asyncio
import gc
import logging
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import BackgroundTasks
from fastapi.exceptions import RequestValidationError, ResponseValidationError
from pydantic import BaseModel, ValidationError

from routers import admin_writing_prompts as prompts
from tests.loop_gate import LoopGate, WAIT, until


@pytest.mark.parametrize("cancels", [1, 2])
@pytest.mark.parametrize("fails", [False, True], ids=["success", "worker-error"])
@pytest.mark.parametrize("pending_count", [0, 2], ids=["no-pending", "two-tokens"])
def test_cancelled_write_logs_worker_failure_and_dispatches_each_token_once(
    monkeypatch, caplog, cancels, fails, pending_count,
):
    gate = LoopGate()
    worker_error = RuntimeError("private worker failure detail")
    pending = [
        ("prompt-id", f"pending-token-{index}", "admin-id", "update")
        for index in range(pending_count)
    ]
    dispatched = AsyncMock()
    make_ref = Mock(return_value="a1b2c3d4")
    monkeypatch.setattr(prompts, "new_ref", make_ref)
    monkeypatch.setattr(prompts.writing_prompt_analysis, "run_and_store_analysis", dispatched)
    caplog.set_level(logging.ERROR, logger=prompts.__name__)

    def write(dispatches):
        dispatches.extend(pending)
        gate.park()
        if fails:
            raise worker_error
        return {"id": "prompt-id"}

    async def scenario():
        loop = asyncio.get_running_loop()
        previous_handler = loop.get_exception_handler()
        unhandled = []
        loop.set_exception_handler(lambda _loop, context: unhandled.append(context))
        background = BackgroundTasks()
        request = asyncio.create_task(prompts._run_prompt_write(background, write))
        try:
            try:
                assert await until(lambda: gate.inside == 1, stop=request)
                for _ in range(cancels):
                    request.cancel()
                    await asyncio.sleep(0)
                    assert not request.done()
            finally:
                gate.release()

            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(request, WAIT)
            assert request.cancelled()
            assert not gate.timed_out
            await asyncio.wait_for(
                asyncio.gather(*prompts._owned_analysis_runs), WAIT,
            )
            # Cancelled requests never execute Starlette BackgroundTasks. Even
            # running the empty container must not dispatch a token a second time.
            assert not background.tasks
            await background()
            assert dispatched.await_count == pending_count
            assert [
                (call.args, call.kwargs) for call in dispatched.await_args_list
            ] == [
                ((pid, token), {"requested_by": admin, "trigger": trigger})
                for pid, token, admin, trigger in pending
            ]

            records = [record for record in caplog.records if record.name == prompts.__name__]
            assert len(records) == int(fails)
            if fails:
                make_ref.assert_called_once_with()
                record = records[0]
                assert record.levelno == logging.ERROR
                assert "ref=a1b2c3d4" in record.getMessage()
                assert str(worker_error) not in record.getMessage()
                assert record.exc_info == (RuntimeError, worker_error, worker_error.__traceback__)
                del record
            else:
                make_ref.assert_not_called()

            # Release captured tracebacks before GC, so they cannot keep the
            # completed worker alive and hide an unretrieved task exception.
            records.clear()
            caplog.clear()
            worker_error.__traceback__ = None
            del request
            gc.collect()
            await asyncio.sleep(0)
            assert unhandled == []
        finally:
            loop.set_exception_handler(previous_handler)

    asyncio.run(scenario())


@pytest.mark.parametrize("cancels", [1, 2])
@pytest.mark.parametrize("kind", ["pydantic", "request", "response", "wrapped", "group"])
def test_cancelled_write_redacts_validation_input(monkeypatch, caplog, cancels, kind):
    gate = LoopGate()
    sensitive = "private-prompt-input-7c91"

    class Payload(BaseModel):
        count: int

    try:
        Payload(count=sensitive)
    except ValidationError as exc:
        validation_error = exc
    if kind in {"request", "response"}:
        error_class = RequestValidationError if kind == "request" else ResponseValidationError
        validation_error = error_class([{
            "type": "int_parsing", "loc": ("body", "count"), "input": sensitive,
            "msg": f"Invalid value: {sensitive}", "ctx": {"value": sensitive},
        }])
    # Prove the fixture would leak when rendered as a normal exception.
    assert sensitive in str(validation_error)
    pending = ("prompt-id", "pending-token", "admin-id", "update")
    dispatch = Mock()
    monkeypatch.setattr(prompts, "new_ref", Mock(return_value="a1b2c3d4"))
    monkeypatch.setattr(prompts, "_dispatch_owned_analysis", dispatch)
    caplog.set_level(logging.ERROR, logger=prompts.__name__)

    def write(dispatches):
        dispatches.append(pending)
        gate.park()
        if kind == "wrapped":
            raise RuntimeError(str(validation_error)) from validation_error
        if kind == "group":
            raise ExceptionGroup("write failed", [validation_error, ValueError(sensitive)])
        raise validation_error

    async def scenario():
        background = BackgroundTasks()
        request = asyncio.create_task(prompts._run_prompt_write(background, write))
        try:
            assert await until(lambda: gate.inside == 1, stop=request)
            for _ in range(cancels):
                request.cancel()
                await asyncio.sleep(0)
                assert not request.done()
        finally:
            gate.release()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(request, WAIT)
        assert request.cancelled()
        assert not gate.timed_out
        assert not background.tasks
        dispatch.assert_called_once_with(*pending)

    asyncio.run(scenario())
    records = [record for record in caplog.records if record.name == prompts.__name__]
    assert len(records) == 1
    record = records[0]
    assert record.levelno == logging.ERROR
    assert "ref=a1b2c3d4" in record.getMessage()
    assert sensitive not in caplog.text
    expected_type = {"wrapped": "RuntimeError", "group": "ExceptionGroup"}.get(
        kind, type(validation_error).__name__,
    )
    assert expected_type in record.getMessage()
    assert "int_parsing at" in caplog.text
    assert "count" in caplog.text
    assert "Traceback (most recent call last):" in caplog.text
    assert "test_admin_writing_prompt_cancel_log.py" in caplog.text
    assert "in write\n" in caplog.text
    assert record.exc_info is None
