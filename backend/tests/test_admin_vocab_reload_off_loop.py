"""PC-J665 — admin vocab writes rebuild the vocab index off the event loop.

vocab_service.reload() reads vocab_cards synchronously. Every admin_vocab write
(import commit / patch / delete / bulk-delete) used to call it on the loop, so
an import stalled every other request on the worker. These tests park the
reload in a LoopGate (no wall-clock bounds) and pin that:
  • other coroutines run while the reload is parked (the loop is free);
  • the response is only produced after the reload finished, and the Next
    invalidation is queued only after it;
  • a failed reload still answers 200 for the committed write, logs the error
    and queues no invalidation.

Run: pytest backend/tests/test_admin_vocab_reload_off_loop.py -v
"""

import asyncio
import logging
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from fastapi import BackgroundTasks
from fastapi.testclient import TestClient

from routers import admin_vocab
from tests.loop_gate import WAIT, LoopGate, until

_ID = "11111111-1111-1111-1111-111111111111"
_AUTH = {"Authorization": "Bearer fake.admin.jwt"}


class _RecordingTasks(BackgroundTasks):
    def __init__(self, events):
        super().__init__()
        self.events = events

    def add_task(self, func, *args, **kwargs):
        self.events.append("invalidate-queued")
        super().add_task(func, *args, **kwargs)


class _Upload:
    async def read(self):
        return b"---\nheadword: Holistic\n---\n"


WRITES = {
    "import": lambda tasks: admin_vocab.import_vocab_word(tasks, _Upload(), False, "token"),
    "patch": lambda tasks: admin_vocab.update_vocab(
        UUID(_ID), admin_vocab.VocabUpdate(gloss_vi="Toàn diện"), tasks, "token"),
    "delete": lambda tasks: admin_vocab.delete_vocab(UUID(_ID), tasks, "token"),
    "bulk-delete": lambda tasks: admin_vocab.bulk_delete_vocab(
        admin_vocab.BulkDeleteRequest(ids=[UUID(_ID)]), tasks, "token"),
}

HTTP_WRITES = {
    "import": lambda client: client.post(
        "/admin/vocabulary/import?dry_run=false", headers=_AUTH,
        files={"file": ("holistic.md", b"---\nheadword: Holistic\n---\n", "text/markdown")}),
    "patch": lambda client: client.patch(
        f"/admin/vocabulary/{_ID}", json={"gloss_vi": "Toàn diện"}, headers=_AUTH),
    "delete": lambda client: client.delete(f"/admin/vocabulary/{_ID}", headers=_AUTH),
    "bulk-delete": lambda client: client.post(
        "/admin/vocabulary/bulk-delete", json={"ids": [_ID]}, headers=_AUTH),
}


@pytest.fixture()
def committed_write(monkeypatch):
    """Every write route commits one row; no real DB, auth or Next call."""
    async def admin(_authorization):
        return {"id": "admin"}

    query = MagicMock()
    for method in ("update", "delete", "eq", "in_"):
        getattr(query, method).return_value = query
    query.execute.return_value = SimpleNamespace(data=[{"id": _ID}])
    monkeypatch.setattr(admin_vocab, "require_admin", admin)
    monkeypatch.setattr(admin_vocab, "supabase_admin", SimpleNamespace(table=lambda _name: query))
    monkeypatch.setattr(admin_vocab, "import_vocab_file",
                        lambda _text, dry_run: {"dry_run": dry_run, "committed_ids": [_ID]})
    invalidate = MagicMock()
    monkeypatch.setattr(admin_vocab, "invalidate_vocabulary_cache", invalidate)
    return invalidate


@pytest.mark.parametrize("route", sorted(WRITES))
def test_write_reloads_off_the_loop_and_responds_after_the_reload(committed_write, monkeypatch, route):
    gate, events, threads = LoopGate(), [], {}

    def reload():
        threads["reload"] = threading.get_ident()
        gate.park()
        events.append("reload-done")

    monkeypatch.setattr(admin_vocab.vocab_service, "reload", reload)

    async def scenario():
        threads["loop"] = threading.get_ident()
        tasks = _RecordingTasks(events)
        request = asyncio.create_task(WRITES[route](tasks))
        try:
            # until() polls on the loop; it only sees the parked reload if the
            # reload is not holding the loop thread.
            entered = await until(lambda: gate.inside >= 1, stop=request)
            other = await asyncio.wait_for(asyncio.create_task(asyncio.sleep(0, result="ran")), WAIT)
            during = (entered, other, request.done(), list(events))
        finally:
            gate.release()
        return await asyncio.wait_for(request, WAIT), during, tasks

    _result, during, tasks = asyncio.run(scenario())
    assert not gate.timed_out, "vocab_service.reload() ran on the event loop"
    entered, other, done_during_reload, events_during_reload = during
    assert entered and other == "ran", "another coroutine must run while the reload is parked"
    assert not done_during_reload, "the response must wait for the reload"
    assert events_during_reload == [], "Next invalidation queued before the reload finished"
    assert threads["reload"] != threads["loop"]
    assert events == ["reload-done", "invalidate-queued"]
    assert [task.func for task in tasks.tasks] == [committed_write]


@pytest.mark.parametrize("route", sorted(HTTP_WRITES))
def test_failed_reload_keeps_the_write_200_logs_and_skips_invalidation(committed_write, monkeypatch, caplog, route):
    threads = {}

    def broken_reload():
        threads["reload"] = threading.get_ident()
        raise RuntimeError("vocab loader exploded")

    monkeypatch.setattr(admin_vocab.vocab_service, "reload", broken_reload)
    from main import app

    with caplog.at_level(logging.ERROR, logger="routers.admin_vocab"):
        response = HTTP_WRITES[route](TestClient(app))

    assert response.status_code == 200, response.text
    assert "reload" in threads
    assert any("reload after write failed" in r.getMessage() and "vocab loader exploded" in r.getMessage()
               for r in caplog.records)
    committed_write.assert_not_called()
