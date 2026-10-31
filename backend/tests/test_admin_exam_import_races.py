"""Committed exam imports must retain a single revision through cancellation."""

import asyncio
import threading
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
import yaml
from fastapi import FastAPI

from routers import admin_exams


class ImportDB:
    """Atomic individual statements, with a pause AFTER the first upsert."""

    def __init__(self, after_upsert):
        self.tables = {"exam_tests": [], "exam_questions": []}
        self.lock = threading.Lock()
        self.after_upsert = after_upsert
        self.upserts = []

    def table(self, name):
        return ImportQuery(self, name)


class ImportQuery:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters = {}
        self.payload = None

    def upsert(self, payload, *, on_conflict):
        assert on_conflict == "code"
        self.op, self.payload = "upsert", deepcopy(payload)
        return self

    def select(self, *_args):
        self.op = "select"
        return self

    def eq(self, key, value):
        self.filters[key] = value
        return self

    def limit(self, _n):
        return self

    def delete(self):
        self.op = "delete"
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", deepcopy(payload)
        return self

    def execute(self):
        with self.db.lock:
            rows = self.db.tables[self.name]
            matched = [r for r in rows if all(r.get(k) == v for k, v in self.filters.items())]
            if self.op == "upsert":
                row = next((r for r in rows if r["code"] == self.payload["code"]), None)
                if row is None:
                    row = {"id": f"exam-{len(rows) + 1}"}
                    rows.append(row)
                row.update(self.payload)
                self.db.upserts.append(row["title"])
                result = [row]
            elif self.op == "select":
                result = matched
            elif self.op == "delete":
                result = matched
                self.db.tables[self.name] = [r for r in rows if r not in matched]
            elif self.op == "insert":
                rows.extend(self.payload)
                result = self.payload
            else:
                raise AssertionError(self.op)
            result = deepcopy(result)
        # No fake DB lock is held while waiting: other statements can proceed.
        if self.op == "upsert":
            self.db.after_upsert(self.payload)
        return SimpleNamespace(data=result)


def exam_file(revision):
    return "---\n" + yaml.safe_dump({
        "exam_source": "toeic_rc", "code": "IMPORT-RACE", "title": revision,
        "meta": {"revision": revision},
        "questions": [{
            "q_num": 1, "prompt": f"Question from {revision}", "answer": revision,
            "options": [{"label": "A", "text": "one"}, {"label": "B", "text": "two"}],
        }],
    }) + "---\n"


@pytest.fixture
def app(monkeypatch):
    app = FastAPI()
    monkeypatch.setattr(admin_exams, "require_admin", AsyncMock(return_value={"id": "admin-1"}))
    app.include_router(admin_exams.router)

    @app.get("/ping")
    async def ping():
        return {"ok": True}

    return app


@pytest.mark.parametrize("cancel_first", [False, True])
def test_concurrent_exam_imports_keep_metadata_and_questions_consistent(app, monkeypatch, cancel_first):
    release = threading.Event()
    service = admin_exams.exam_service.import_exam

    async def scenario():
        loop = asyncio.get_running_loop()
        entered, finished = asyncio.Event(), asyncio.Event()

        def after_upsert(row):
            if row["title"] == "A":
                loop.call_soon_threadsafe(entered.set)
                assert release.wait(5), "test did not release import worker"

        db = ImportDB(after_upsert)
        monkeypatch.setattr(admin_exams.exam_service, "supabase_admin", db)

        def import_exam(text, *, dry_run):
            try:
                return service(text, dry_run=dry_run)
            finally:
                if "title: A\n" in text:
                    loop.call_soon_threadsafe(finished.set)

        monkeypatch.setattr(admin_exams.exam_service, "import_exam", import_exam)
        path = "/admin/exams/import?dry_run=false"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            first = asyncio.create_task(client.post(path, files={"file": ("a.md", exam_file("A"))}))
            second = None
            try:
                await asyncio.wait_for(entered.wait(), 5)
                if cancel_first:
                    first.cancel()
                    await asyncio.sleep(0)
                    first.cancel()
                second = asyncio.create_task(client.post(path, files={"file": ("b.md", exam_file("B"))}))
                # Old code lets B finish while A is paused after its upsert.
                await asyncio.wait({second}, timeout=0.1)
                upserts_before_release = list(db.upserts)
                assert (await client.get("/ping")).json() == {"ok": True}
            finally:
                release.set()
                results = await asyncio.gather(first, *([second] if second else []), return_exceptions=True)
                # Cancellation must not let us inspect before A's thread ends.
                await asyncio.wait_for(finished.wait(), 5)

        if cancel_first:
            assert isinstance(results[0], asyncio.CancelledError)
        else:
            assert results[0].status_code == 200
            assert results[0].json()["committed"] is True
        assert results[1].status_code == 200
        assert results[1].json()["committed"] is True
        test, = db.tables["exam_tests"]
        question, = db.tables["exam_questions"]
        assert test["title"] == test["meta"]["revision"] == question["answer"]["answer"] == "B"
        assert question["prompt"] == "Question from B"
        assert question["test_id"] == test["id"] == results[1].json()["test_id"]
        assert upserts_before_release == ["A"], "second import entered before the first worker finished"

    asyncio.run(scenario())


@pytest.mark.parametrize("late_error", [False, True])
def test_cancelled_import_waiter_and_dry_run_do_not_release_holder(app, monkeypatch, late_error):
    release = threading.Event()
    service = admin_exams.exam_service.import_exam

    async def scenario():
        loop = asyncio.get_running_loop()
        entered, finished = asyncio.Event(), asyncio.Event()
        unhandled = []
        loop.set_exception_handler(lambda _loop, context: unhandled.append(context))

        def after_upsert(row):
            if row["title"] == "A":
                loop.call_soon_threadsafe(entered.set)
                assert release.wait(5), "test did not release import worker"
                if late_error:
                    raise RuntimeError("late import failure")

        db = ImportDB(after_upsert)
        monkeypatch.setattr(admin_exams.exam_service, "supabase_admin", db)

        def import_exam(text, *, dry_run):
            try:
                return service(text, dry_run=dry_run)
            finally:
                if "title: A\n" in text:
                    loop.call_soon_threadsafe(finished.set)

        monkeypatch.setattr(admin_exams.exam_service, "import_exam", import_exam)
        path = "/admin/exams/import?dry_run=false"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            first = asyncio.create_task(client.post(path, files={"file": ("a.md", exam_file("A"))}))
            waiter = successor = None
            try:
                await asyncio.wait_for(entered.wait(), 5)
                waiter = asyncio.create_task(client.post(path, files={"file": ("c.md", exam_file("C"))}))
                await asyncio.sleep(0.05)
                waiter.cancel()
                waiter_result, = await asyncio.gather(waiter, return_exceptions=True)
                first.cancel()
                await asyncio.sleep(0)
                first.cancel()
                # The default dry run must remain usable while commits wait.
                dry = await asyncio.wait_for(client.post(
                    "/admin/exams/import", files={"file": ("dry.md", exam_file("DRY"))},
                ), 2)
                successor = asyncio.create_task(client.post(path, files={"file": ("b.md", exam_file("B"))}))
                await asyncio.wait({successor}, timeout=0.1)
                upserts_before_release = list(db.upserts)
            finally:
                release.set()
                tasks = [first] + ([waiter] if waiter else []) + ([successor] if successor else [])
                results = await asyncio.gather(*tasks, return_exceptions=True)
                await asyncio.wait_for(finished.wait(), 5)
        assert isinstance(waiter_result, asyncio.CancelledError)
        assert isinstance(results[0], asyncio.CancelledError)
        assert dry.status_code == 200 and dry.json()["committed"] is False
        assert dry.json()["test"]["title"] == "DRY"
        assert results[-1].status_code == 200
        assert upserts_before_release == ["A"]
        assert db.upserts == ["A", "B"]
        test, = db.tables["exam_tests"]
        question, = db.tables["exam_questions"]
        assert test["title"] == question["answer"]["answer"] == "B"
        await asyncio.sleep(0)
        assert unhandled == []

    asyncio.run(scenario())
