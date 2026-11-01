"""PC-J234: unhandled error-log inserts retain tasks and bound concurrency."""
from __future__ import annotations

import asyncio
import gc
import json
import logging
import threading

import pytest
from starlette.requests import Request

import main
from services.errors import GENERIC_MESSAGE


@pytest.fixture(autouse=True)
def capture_state(monkeypatch):
    # Defaults also let the storm test run against the pre-fix handler: it
    # must fail on the actual number of scheduled inserts, not missing names.
    monkeypatch.setattr(main, "_unhandled_error_log_tasks", set(), raising=False)
    monkeypatch.setattr(main, "_unhandled_error_log_dropped", {"in_flight": 0}, raising=False)
    monkeypatch.setattr(main, "_unhandled_error_log_window", [float("-inf"), False], raising=False)
    now = [1000.0]
    monkeypatch.setattr(main, "_unhandled_error_log_clock", lambda: now[0], raising=False)
    return now


def _request(index=0):
    return Request({
        "type": "http", "method": "POST", "path": f"/things/{index}",
        "query_string": b"token=private-token&view=compact", "headers": [],
        "state": {"request_id": f"pc-j234-{index}"},
        "route": type("Route", (), {"path": "/things/{thing_id}"})(),
    })


async def _handle(index=0):
    try:
        raise RuntimeError("diagnostic failure")
    except RuntimeError as exc:
        return await main.unhandled_exception_handler(_request(index), exc)


def _assert_response(response, index):
    assert response.status_code == 500
    assert response.headers["X-Request-ID"] == f"pc-j234-{index}"
    assert json.loads(response.body) == {
        "detail": {"error_code": "internal_error", "message": GENERIC_MESSAGE,
                   "ref": f"pc-j234-{index}"},
        "request_id": f"pc-j234-{index}",
    }


def test_exception_storm_bounds_and_retains_tasks_then_recovers(
        capture_state, monkeypatch, caplog):
    limit = getattr(main, "_UNHANDLED_ERROR_LOG_MAX_IN_FLIGHT", 4)
    window_s = getattr(main, "_UNHANDLED_ERROR_LOG_WINDOW_S", 60.0)
    release = threading.Event()
    rows = []

    def blocked_insert(payload):
        rows.append(payload)
        assert release.wait(10), "test did not release the blocked insert"

    monkeypatch.setattr(main, "_insert_error_log_safely", blocked_insert)

    async def run():
        before = asyncio.all_tasks()
        try:
            responses = await asyncio.wait_for(
                asyncio.gather(*(_handle(i) for i in range(limit + 6))), timeout=5)
            for i, response in enumerate(responses):
                _assert_response(response, i)
            scheduled = asyncio.all_tasks() - before
            assert len(scheduled) == limit, "unhandled inserts exceeded the in-flight cap"
            assert main._unhandled_error_log_tasks == scheduled
            gc.collect()
            assert all(not task.done() for task in main._unhandled_error_log_tasks)
            assert main._unhandled_error_log_dropped == {"in_flight": 6}
            assert caplog.text.count("unhandled capture saturated (in_flight)") == 1

            # A second storm in the same window counts every drop, warns once.
            await asyncio.gather(*(_handle(i) for i in range(3)))
            assert main._unhandled_error_log_dropped == {"in_flight": 9}
            assert len(main._unhandled_error_log_tasks) == limit
            assert caplog.text.count("unhandled capture saturated (in_flight)") == 1

            capture_state[0] += window_s
            await asyncio.gather(*(_handle(i) for i in range(2)))
            assert main._unhandled_error_log_dropped == {"in_flight": 11}
            assert caplog.text.count("unhandled capture saturated (in_flight)") == 2
        finally:
            # Always release actual tasks, including on the pre-fix negative
            # control where the handler's reference set remains empty.
            release.set()
            await asyncio.gather(*(asyncio.all_tasks() - before))
            await asyncio.sleep(0)

        assert main._unhandled_error_log_tasks == set()
        assert len(rows) == limit
        _assert_response(await _handle(99), 99)
        await asyncio.gather(*main._unhandled_error_log_tasks)
        await asyncio.sleep(0)
        assert main._unhandled_error_log_tasks == set()
        assert len(rows) == limit + 1
        assert main._unhandled_error_log_dropped == {"in_flight": 11}

    with caplog.at_level(logging.WARNING, logger="main"):
        asyncio.run(run())


def test_insert_payload_and_response_are_unchanged(monkeypatch):
    rows = []
    monkeypatch.setattr(main, "_insert_error_log_safely", rows.append)

    async def run():
        response = await _handle()
        await asyncio.gather(*main._unhandled_error_log_tasks)
        await asyncio.sleep(0)
        return response

    _assert_response(asyncio.run(run()), 0)
    row, = rows
    assert row == {
        "level": "error", "source": "backend", "message": "diagnostic failure",
        "stack": row["stack"], "url": "/things/{thing_id}",
        "request_id": "pc-j234-0",
        "extra": {"method": "POST", "query": {"token": "[redacted]", "view": "compact"}},
    }
    assert "RuntimeError: diagnostic failure" in row["stack"]


def test_unhandled_capture_has_no_per_key_or_window_row_limit(monkeypatch):
    rows = []
    monkeypatch.setattr(main, "_insert_error_log_safely", rows.append)

    async def run():
        # Same route and exception, all within one clock window. Only active
        # inserts are bounded; completed inserts must release capacity.
        for _ in range(main._HANDLED_5XX_LOG_GLOBAL_LIMIT + 1):
            _assert_response(await _handle(), 0)
            await asyncio.gather(*main._unhandled_error_log_tasks)
            await asyncio.sleep(0)

    asyncio.run(run())
    assert len(rows) == main._HANDLED_5XX_LOG_GLOBAL_LIMIT + 1
    assert main._unhandled_error_log_dropped == {"in_flight": 0}
