"""Student reads/submissions must not observe a partially replaced answer key."""

import asyncio
import threading
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI

from routers import admin_exams, exams
from test_admin_exam_import_races import ImportDB, ImportQuery, exam_file


class StudentImportDB(ImportDB):
    def __init__(self):
        super().__init__(lambda _row: None)
        self.tables["exam_attempts"] = []
        self.after_delete = lambda: None
        self.fail_insert = False

    def table(self, name):
        return StudentImportQuery(self, name)


class StudentImportQuery(ImportQuery):
    def select(self, columns="*"):
        self.columns = columns
        return super().select(columns)

    def order(self, *_args, **_kwargs):
        return self

    def execute(self):
        if self.op == "insert" and self.name == "exam_questions" and self.db.fail_insert:
            raise RuntimeError("question insertion failed")
        if self.op == "insert" and self.name == "exam_attempts":
            with self.db.lock:
                row = {"id": "attempt-1", **deepcopy(self.payload)}
                self.db.tables[self.name].append(row)
                return SimpleNamespace(data=[deepcopy(row)])
        result = super().execute()
        if self.op == "delete" and self.name == "exam_questions":
            self.db.after_delete()
        if self.op == "select" and self.columns != "*":
            columns = [c.strip() for c in self.columns.split(",")]
            result.data = [{k: v for k, v in row.items() if k in columns} for row in result.data]
        return result


def published_file(revision):
    return exam_file(revision).replace("title:", "status: published\ntitle:", 1)


@pytest.mark.parametrize("operation", ["play", "submit"])
@pytest.mark.parametrize("cancel_import", [False, True])
@pytest.mark.parametrize("fail_insert", [False, True])
def test_student_never_reads_empty_key_during_import(
    monkeypatch, operation, cancel_import, fail_insert,
):
    app = FastAPI()
    app.include_router(admin_exams.router)
    app.include_router(exams.router)
    monkeypatch.setattr(admin_exams, "require_admin", AsyncMock(return_value={"id": "admin-1"}))
    monkeypatch.setattr(exams, "get_supabase_user", AsyncMock(return_value={"id": "learner-1"}))

    @app.get("/ping")
    async def ping():
        return {"ok": True}

    db = StudentImportDB()
    monkeypatch.setattr(admin_exams.exam_service, "supabase_admin", db)
    admin_exams.exam_service.import_exam(published_file("A"), dry_run=False)
    release = threading.Event()

    async def scenario():
        loop, deleted = asyncio.get_running_loop(), asyncio.Event()

        def after_delete():
            loop.call_soon_threadsafe(deleted.set)
            assert release.wait(5), "test did not release import after delete"

        db.after_delete, db.fail_insert = after_delete, fail_insert
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            importer = asyncio.create_task(client.post(
                "/admin/exams/import?dry_run=false",
                files={"file": ("exam.md", published_file("B"))},
            ))
            student = None
            try:
                await asyncio.wait_for(deleted.wait(), 5)
                assert db.tables["exam_questions"] == []
                if cancel_import:
                    importer.cancel()
                    await asyncio.sleep(0)
                    importer.cancel()
                student = asyncio.create_task(
                    client.get("/api/exams/exam-1") if operation == "play" else
                    client.post("/api/exams/exam-1/attempts", json={
                        "answers": [{"q_num": 1, "user_answer": "B"}],
                    })
                )
                await asyncio.wait({student}, timeout=0.1)
                attempts_before_release = deepcopy(db.tables["exam_attempts"])
                assert (await asyncio.wait_for(client.get("/ping"), 1)).json() == {"ok": True}
            finally:
                release.set()
                results = await asyncio.gather(
                    importer, *([student] if student else []), return_exceptions=True,
                )
            if cancel_import:
                assert isinstance(results[0], asyncio.CancelledError)
            else:
                assert results[0].status_code == (500 if fail_insert else 200)
            response = results[1]
            assert response.status_code == (409 if fail_insert else 200)
            if not fail_insert:
                payload = response.json()
                if operation == "play":
                    assert payload["total_questions"] == len(payload["questions"]) == 1
                    assert payload["title"] == "B"
                    assert payload["questions"][0]["prompt"] == "Question from B"
                    assert "answer" not in payload["questions"][0]
                else:
                    assert payload["score"] == payload["max_score"] == 1
                    attempt, = db.tables["exam_attempts"]
                    assert attempt["score"] == attempt["max_score"] == 1
                    assert attempt["grading_details"][0]["prompt"] == "Question from B"
            else:
                assert db.tables["exam_attempts"] == []
            assert attempts_before_release == []

    asyncio.run(scenario())
