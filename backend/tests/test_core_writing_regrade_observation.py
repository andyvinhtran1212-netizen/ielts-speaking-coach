"""Writing grading admission/moderation observations; no AI or live DB."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException

from routers import admin_writing, admin_writing_regrade, instructor
from services import essay_service
from services import core_attempt_outcomes as outcomes
from services import core_writing_observation as partial
from test_core_writing_admin_observation import world  # shared metadata/fake-DB fixture


@pytest.mark.asyncio
@pytest.mark.parametrize("route", ["start", "admin_regrade", "instructor_regrade"])
@pytest.mark.parametrize("stage", ["queued", "status_error", "job_error", "enqueue_error", "guard_reject"])
@pytest.mark.parametrize("observation", ["recorded", "disabled", "unavailable"])
async def test_grading_admission_snapshots_canonical_state(world, monkeypatch, route, stage, observation):
    monkeypatch.setattr(outcomes.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", observation != "disabled")
    if observation == "unavailable":
        world.getter.side_effect = RuntimeError("observer unavailable")
    world.essay["status"] = "pending" if route == "start" else "delivered"
    old_status = world.essay["status"]
    if stage == "guard_reject":
        world.essay["status"] = "grading"
    failure = RuntimeError("injected admission error")
    def table(name):
        query = world.fake.table(name)
        execute = query.execute
        def run():
            if stage == "status_error" and name == "writing_essays" and query.op == "update":
                raise failure
            if name == "writing_jobs" and query.op == "insert":
                if stage == "job_error":
                    raise failure
                query.payload.update(id=str(uuid4()), created_at="2026-09-10T00:00:00Z")
            return execute()
        query.execute = run
        return query
    db = SimpleNamespace(table=table)
    monkeypatch.setattr(admin_writing, "supabase_admin", db)
    monkeypatch.setattr(instructor, "supabase_admin", db)
    monkeypatch.setattr(essay_service, "supabase_admin", db)
    monkeypatch.setattr(essay_service, "live_version_count", lambda _: 1)
    monkeypatch.setattr(essay_service, "estimate_eta_seconds", lambda **kwargs: 12)
    tasks = BackgroundTasks()
    if stage == "enqueue_error":
        monkeypatch.setattr(tasks, "add_task", Mock(side_effect=failure))
    async def call():
        if route == "start":
            return await admin_writing.start_grading(str(world.id), admin_writing.StartGradingRequest(), tasks, "auth")
        if route == "admin_regrade":
            return await admin_writing.trigger_regrade(world.id, tasks, admin_writing.RegradeRequest(), "auth")
        return await instructor.regrade_essay(None, world.id, tasks, instructor.RegradeBody(), "auth")
    if stage == "queued":
        result = await call()
        assert result["essay_id"] == str(world.id)
        assert len(tasks.tasks) == 1  # scheduled only; never execute real AI
        assert tasks.tasks[0].func is essay_service._bg_grade_essay
    else:
        expected_http = stage in {"guard_reject", "job_error"} or (stage == "status_error" and route == "admin_regrade")
        with pytest.raises(HTTPException if expected_http else RuntimeError) as exc:
            await call()
        if expected_http:
            assert exc.value.status_code == (409 if stage == "guard_reject" else 500)
        else:
            assert exc.value is failure
        assert not tasks.tasks
    if stage in {"guard_reject", "status_error"}:
        world.getter.assert_not_awaited()
        world.receipt.assert_not_awaited()
        assert world.essay["status"] == ("grading" if stage == "guard_reject" else old_status)
    else:
        assert world.essay["status"] == "grading"
        if observation == "recorded":
            world.receipt.assert_awaited_once()
            fact = world.receipt.call_args.kwargs
            assert fact["event_kind"] == "outcome_observed"
            assert fact["canonical_attempt_id"] == world.attempt
            assert fact["outcome"] == "pending"  # NOT proof of a job or grade
        else:
            if observation == "disabled":
                world.getter.assert_not_awaited()
            else:
                world.getter.assert_awaited_once()
            world.receipt.assert_not_awaited()
        assert world.essay["current_version"] == 1
        assert world.essay["feedback"][0]["overall_band_score"] == 6
        jobs = world.fake.store.get("writing_jobs", [])
        assert len(jobs) == (0 if stage == "job_error" else 1)
        if jobs and route != "start":
            assert jobs[0]["job_payload"]["restore_status"] == old_status


@pytest.mark.asyncio
async def test_lost_pending_claim_does_not_snapshot(world, monkeypatch):
    world.essay["status"] = "pending"
    def table(name):
        query = world.fake.table(name)
        execute = query.execute
        query.execute = lambda: SimpleNamespace(data=[]) if query.op == "update" else execute()
        return query
    monkeypatch.setattr(essay_service, "supabase_admin", SimpleNamespace(table=table))
    with pytest.raises(HTTPException) as exc:
        await admin_writing.start_grading(str(world.id), admin_writing.StartGradingRequest(), BackgroundTasks(), "auth")
    assert exc.value.status_code == 409
    world.getter.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["accept", "reject"])
@pytest.mark.parametrize("stage", ["ok", "format_error", "rpc_error", "rejected", "wrong_identity"])
@pytest.mark.parametrize("observation", ["recorded", "disabled", "unavailable"])
async def test_moderation_only_accepted_essay_changes_get_snapshots(world, monkeypatch, action, stage, observation):
    monkeypatch.setattr(outcomes.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", observation != "disabled")
    if observation == "unavailable":
        world.getter.side_effect = RuntimeError("observer unavailable")
    request_id = uuid4()
    world.essay["status"] = "delivered"
    monkeypatch.setattr(admin_writing_regrade, "require_admin", AsyncMock(return_value=world.admin))
    failure = RuntimeError("injected moderation error")
    request_row = {"id": str(uuid4() if stage == "wrong_identity" else request_id),
                   "essay_id": str(world.id), "status": "accepted" if action == "accept" else "rejected"}
    def execute():
        if stage == "rpc_error":
            raise failure
        if stage == "rejected":
            return SimpleNamespace(data={"ok": False, "reason": "already_actioned", "status": "accepted"})
        if action == "accept":
            world.essay["status"] = "reviewed"
        return SimpleNamespace(data={"ok": True, "request": request_row})
    rpc = Mock(return_value=SimpleNamespace(execute=execute))
    monkeypatch.setattr(admin_writing_regrade, "supabase_admin", SimpleNamespace(rpc=rpc))
    formatter = Mock(side_effect=failure if stage == "format_error" else lambda rows: rows)
    monkeypatch.setattr(admin_writing_regrade, "_decorate", formatter)
    body = admin_writing_regrade.RegradeAction(action=action, response="test explanation")
    if stage == "ok":
        assert await admin_writing_regrade.action_regrade_request(request_id, body, "auth") == request_row
    else:
        with pytest.raises(RuntimeError if stage == "format_error" else HTTPException) as exc:
            await admin_writing_regrade.action_regrade_request(request_id, body, "auth")
        if stage == "format_error":
            assert exc.value is failure
        else:
            assert exc.value.status_code == (409 if stage == "rejected" else 500)
    assert rpc.call_args.args[0] == "fn_action_writing_regrade_request"
    assert rpc.call_args.args[1]["p_admin_id"] == world.admin["id"]
    should_read = observation != "disabled" and action == "accept" and stage in {"ok", "format_error"}
    if observation == "recorded" and should_read:
        world.receipt.assert_awaited_once()
        assert world.essay["status"] == "reviewed"
        assert world.receipt.call_args.kwargs["outcome"] == "success"
    else:
        if should_read:
            world.getter.assert_awaited_once()
        else:
            world.getter.assert_not_awaited()
        world.receipt.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("action,status", [("accept", "rejected"), ("reject", "accepted")])
async def test_moderation_hook_uses_rpc_status_not_intent(world, monkeypatch, action, status):
    request_id = uuid4()
    request_row = {"id": str(request_id), "essay_id": str(world.id), "status": status}
    monkeypatch.setattr(admin_writing_regrade, "require_admin", AsyncMock(return_value=world.admin))
    monkeypatch.setattr(admin_writing_regrade, "supabase_admin", SimpleNamespace(rpc=lambda *args:
        SimpleNamespace(execute=lambda: SimpleNamespace(data={"ok": True, "request": request_row}))))
    monkeypatch.setattr(admin_writing_regrade, "_decorate", lambda rows: rows)
    result = await admin_writing_regrade.action_regrade_request(request_id,
        admin_writing_regrade.RegradeAction(action=action, response="test explanation"), "auth")
    assert result == request_row
    if status == "accepted":
        world.receipt.assert_awaited_once()
    else:
        world.getter.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("essay_id", [None, "not-a-uuid", ""])
async def test_bad_rpc_essay_id_is_not_retained_or_queried(world, monkeypatch, essay_id):
    request_id = uuid4()
    request_row = {"id": str(request_id), "essay_id": essay_id, "status": "accepted"}
    monkeypatch.setattr(admin_writing_regrade, "require_admin", AsyncMock(return_value=world.admin))
    monkeypatch.setattr(admin_writing_regrade, "supabase_admin", SimpleNamespace(rpc=lambda *args:
        SimpleNamespace(execute=lambda: SimpleNamespace(data={"ok": True, "request": request_row}))))
    retained = []
    def decorate(rows):
        retained.append(set(partial._current.get().ids))
        return rows
    monkeypatch.setattr(admin_writing_regrade, "_decorate", decorate)
    assert await admin_writing_regrade.action_regrade_request(request_id,
        admin_writing_regrade.RegradeAction(action="accept"), "auth") == request_row
    world.getter.assert_not_awaited()
    world.receipt.assert_not_awaited()
    assert retained == [set()]


@pytest.mark.asyncio
@pytest.mark.parametrize("route", ["start", "admin_regrade", "instructor_regrade", "moderation"])
async def test_auth_denial_cannot_create_grading_evidence(world, monkeypatch, route):
    denied = AsyncMock(side_effect=HTTPException(403, "forbidden"))
    monkeypatch.setattr(admin_writing, "require_admin", denied)
    monkeypatch.setattr(admin_writing_regrade, "require_admin", denied)
    monkeypatch.setattr(instructor, "_me", denied)
    with pytest.raises(HTTPException) as exc:
        if route == "start":
            await admin_writing.start_grading(str(world.id), admin_writing.StartGradingRequest(), BackgroundTasks(), "auth")
        elif route == "admin_regrade":
            await admin_writing.trigger_regrade(world.id, BackgroundTasks(), admin_writing.RegradeRequest(), "auth")
        elif route == "instructor_regrade":
            await instructor.regrade_essay(None, world.id, BackgroundTasks(), instructor.RegradeBody(), "auth")
        else:
            await admin_writing_regrade.action_regrade_request(uuid4(),
                admin_writing_regrade.RegradeAction(action="accept"), "auth")
    assert exc.value.status_code == 403
    world.getter.assert_not_awaited()
    world.receipt.assert_not_awaited()
