"""Báo cáo săn lỗi B1-15 / B1-21: POST /admin/writing/essays/{id}/regrade.

B1-15: hai cú bấm gần nhau đều đọc status 'graded' rồi cùng ghi 'grading' và
cùng xếp job ⇒ chấm 2 lần. Lệnh chuyển status nay so-và-đổi theo status vừa
đọc; bên thua nhận 409 và không xếp job.

B1-21: xếp job lỗi thì không reaper nào trả status về ⇒ bài kẹt 'grading'
vĩnh viễn. Route nay trả status cũ trước khi báo lỗi.
"""

from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException

from routers import admin_writing
from services import essay_service
from test_core_writing_admin_observation import world  # noqa: F401  (fixture)


def _db(world, *, lose_claim=False, job_fails=False):
    def table(name):
        query = world.fake.table(name)
        execute = query.execute

        def run():
            if lose_claim and name == "writing_essays" and query.op == "update":
                # Lượt khác đã chuyển sang 'grading' giữa bước đọc và bước ghi.
                world.essay["status"] = "grading"
            if job_fails and name == "writing_jobs" and query.op == "insert":
                raise RuntimeError("jobs table down")
            if name == "writing_jobs" and query.op == "insert":
                query.payload.update(id="job-1", created_at="2026-11-25T00:00:00Z")
            return execute()
        query.execute = run
        return query
    return SimpleNamespace(table=table)


def _wire(world, monkeypatch, db):
    world.essay["status"] = "graded"
    for mod in (admin_writing, essay_service):
        monkeypatch.setattr(mod, "supabase_admin", db)
    monkeypatch.setattr(essay_service, "live_version_count", lambda _: 1)
    monkeypatch.setattr(essay_service, "estimate_eta_seconds", lambda **_k: 12)


@pytest.mark.asyncio
async def test_lost_status_claim_is_409_and_queues_nothing(world, monkeypatch):
    _wire(world, monkeypatch, _db(world, lose_claim=True))
    tasks = BackgroundTasks()
    with pytest.raises(HTTPException) as exc:
        await admin_writing.trigger_regrade(world.id, tasks, admin_writing.RegradeRequest(), "auth")
    assert exc.value.status_code == 409
    assert not tasks.tasks
    assert world.fake.store.get("writing_jobs", []) == []


@pytest.mark.asyncio
async def test_job_scheduling_failure_restores_the_old_status(world, monkeypatch):
    _wire(world, monkeypatch, _db(world, job_fails=True))
    tasks = BackgroundTasks()
    with pytest.raises(HTTPException) as exc:
        await admin_writing.trigger_regrade(world.id, tasks, admin_writing.RegradeRequest(), "auth")
    assert exc.value.status_code == 500
    assert world.essay["status"] == "graded"
    assert not tasks.tasks


@pytest.mark.asyncio
async def test_normal_regrade_still_queues_one_job(world, monkeypatch):
    _wire(world, monkeypatch, _db(world))
    tasks = BackgroundTasks()
    out = await admin_writing.trigger_regrade(world.id, tasks, admin_writing.RegradeRequest(), "auth")
    assert out["job_id"] == "job-1"
    assert world.essay["status"] == "grading"
    assert len(tasks.tasks) == 1
