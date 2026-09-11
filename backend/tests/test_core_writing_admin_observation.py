"""Actual admin/instructor route -> batch -> canonical read -> private receipt.

No real DB/AI. These snapshots prove saved feedback, NOT delivery/viewing.
"""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from routers import admin_instructor_queue, admin_writing, instructor
from services import core_attempt_outcomes as outcomes
from services.core_attempt_evidence import ReceiptStatus
from test_core_attempt_outcomes import writing
from test_f2_compose_versions import _FakeSB, _fj


@pytest.fixture
def world(monkeypatch):
    attempt, row = writing()
    essay = row["essay"]
    essay_id = UUID(essay["id"])
    order = []
    snapshots = []
    admin = {"id": str(uuid4())}
    monkeypatch.setattr(admin_writing, "require_admin", AsyncMock(return_value=admin))
    monkeypatch.setattr(admin_instructor_queue, "require_admin", AsyncMock(return_value=admin))
    monkeypatch.setattr(instructor, "_me", AsyncMock(return_value=admin["id"]))
    monkeypatch.setattr(instructor, "assert_essay_owned", Mock())
    monkeypatch.setattr(outcomes.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", True)
    fake = _FakeSB({"writing_essays": [essay]})
    monkeypatch.setattr(admin_writing, "supabase_admin", fake)
    monkeypatch.setattr(instructor, "supabase_admin", fake)
    monkeypatch.setattr("services.mock_review_workflow.sync_writing_band_for_essay",
                        lambda _: order.append("mock_sync"))
    monkeypatch.setattr("services.instructor_workflow.sync_revoke_review",
                        lambda _: order.append("review_sync"))

    class Query:
        def __init__(self):
            self.filters = []

        def table(self, name):
            self.table_name = name
            return self

        def select(self, columns):
            self.columns = columns
            return self

        def eq(self, *args):
            self.filters.append(args)
            return self

        def limit(self, *args):
            return self

        async def execute(self):
            # Model actual selection: wrong table/filter yields no matched row.
            expected_filter = ("essay_id", str(essay_id)) if self.columns == "id" else ("id", str(attempt))
            if self.table_name != "writing_assignments" or self.filters != [expected_filter]:
                return SimpleNamespace(data=[])
            order.append(("read", essay["status"], essay["current_version"]))
            snapshot = deepcopy(row)
            if "writing_feedback" in fake.store:
                snapshot["essay"]["feedback"] = [
                    {"version": item["version"], "overall_band_score": item.get("overall_band_score")}
                    for item in fake.store["writing_feedback"]
                    if item["essay_id"] == str(essay_id) and item["version"] == essay["current_version"]
                ]
            if self.columns != "id":
                snapshots.append(deepcopy(snapshot))
            return SimpleNamespace(data=[{"id": str(attempt)}] if self.columns == "id" else [snapshot])

    getter = AsyncMock(side_effect=lambda: Query())
    monkeypatch.setattr(outcomes, "get_supabase_async", getter)
    receipt = AsyncMock(return_value=ReceiptStatus.RECORDED)
    monkeypatch.setattr(outcomes, "try_record_event", receipt)
    return SimpleNamespace(attempt=attempt, row=row, essay=essay, id=essay_id,
                           order=order, receipt=receipt, getter=getter, admin=admin, fake=fake, snapshots=snapshots)


async def run_action(action, w, monkeypatch):
    if action == "admin_edit":
        def compose(*args, **kwargs):
            w.essay.update(current_version=2, feedback=[{"version": 2, "overall_band_score": 7}])
            w.order.append("compose")
            return 2
        monkeypatch.setattr("services.essay_service.upsert_composed_version", compose)
        return await admin_writing.update_feedback(w.id, _fj(2, (7, 7, 7, 7)), "auth")
    if action == "instructor_compose":
        def compose(*args, **kwargs):
            w.essay.update(current_version=2, feedback=[{"version": 2, "overall_band_score": 7}])
            w.order.append("compose")
            return 2
        monkeypatch.setattr("services.essay_service.compose_version", compose)
        body = instructor.ComposeBody(base_version=1, mainCriterion=1,
            coherenceCohesion=1, lexicalResource=1, grammaticalRange=1)
        return await instructor.compose_essay_version(None, w.id, body, "auth")
    if action in {"admin_revoke", "instructor_revoke"}:
        w.essay["status"] = "delivered"
        if action == "admin_revoke":
            return await admin_writing.revoke_delivery(w.id, "auth")
        return await instructor.revoke_delivery(None, w.id, "auth")
    if action == "admin_deliver":
        def deliver(*args):
            w.essay["status"] = "delivered"
            w.order.append("deliver")
            return {"ok": True, "reason": None}
        monkeypatch.setattr(admin_writing, "_deliver_essay", deliver)
        return await admin_writing.mark_delivered(w.id, admin_writing.MarkDeliveredRequest(), "auth")
    def deliver(*args, **kwargs):
        w.essay["status"] = "delivered"
        w.order.append("deliver")
        return SimpleNamespace(essay_id=w.id)
    monkeypatch.setattr("services.instructor_workflow.deliver", deliver)
    if action == "instructor_deliver":
        return await instructor.deliver_review(None, uuid4(),
            instructor.InstructorDeliverBody(essay_id=w.id), "auth")
    return await admin_instructor_queue.deliver_review(uuid4(),
        admin_instructor_queue.DeliverRequest(instructor_note="test note"), "auth")


ACTIONS = ["admin_edit", "instructor_compose", "admin_revoke", "instructor_revoke",
           "admin_deliver", "instructor_deliver", "admin_queue_deliver"]


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["admin_revoke", "instructor_revoke"])
async def test_revoke_write_survives_later_sync_error(world, monkeypatch, action):
    failure = RuntimeError("review sync failed")
    monkeypatch.setattr("services.instructor_workflow.sync_revoke_review", Mock(side_effect=failure))
    with pytest.raises(RuntimeError) as exc:
        await run_action(action, world, monkeypatch)
    assert exc.value is failure
    assert world.essay["status"] == "reviewed"
    world.receipt.assert_awaited_once()
    assert world.receipt.call_args.kwargs["outcome"] == "success"


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ACTIONS)
async def test_mutations_read_current_feedback_after_all_writes(world, monkeypatch, action):
    result = await run_action(action, world, monkeypatch)
    assert result is not None
    reads = [item for item in world.order if isinstance(item, tuple)]
    expected_status = "reviewed" if action in {"admin_edit", "admin_revoke", "instructor_revoke"} else (
        "graded" if action == "instructor_compose" else "delivered")
    expected_version = 2 if action in {"admin_edit", "instructor_compose"} else 1
    assert reads and all(item == ("read", expected_status, expected_version) for item in reads)
    assert isinstance(world.order[0], str)  # product write/sync precedes observation
    world.receipt.assert_awaited_once()
    fact = world.receipt.call_args.kwargs
    assert fact["canonical_attempt_id"] == world.attempt
    assert fact["event_kind"] == "outcome_observed"
    assert fact["outcome"] == "success"  # saved current feedback, even after revoke
    assert fact["operation"] == "finalize"
    assert "delivered" not in fact.values()


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ACTIONS)
@pytest.mark.parametrize("enabled", [True, False])
async def test_unavailable_or_disabled_evidence_preserves_response(world, monkeypatch, caplog, action, enabled):
    monkeypatch.setattr(outcomes.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", enabled)
    world.getter.side_effect = RuntimeError("PRIVATE_PAYLOAD")
    result = await run_action(action, world, monkeypatch)
    assert result is not None
    world.receipt.assert_not_awaited()
    if not enabled:
        world.getter.assert_not_awaited()
    assert "PRIVATE_PAYLOAD" not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("later_error", [False, True])
async def test_bulk_records_prior_commits_once_after_all_writes(world, monkeypatch, later_error):
    other = uuid4()
    def deliver(essay_id, method):
        world.order.append("deliver")
        if essay_id == str(other):
            if later_error:
                raise HTTPException(500, "db unavailable")
            return {"ok": False, "reason": "not_reviewed", "status": "graded"}
        world.essay["status"] = "delivered"
        return {"ok": True}
    monkeypatch.setattr(admin_writing, "_deliver_essay", deliver)
    body = admin_writing.BulkMarkDeliveredRequest(essay_ids=[world.id, world.id, other])
    if later_error:
        with pytest.raises(HTTPException) as exc:
            await admin_writing.bulk_mark_delivered(body, "auth")
        assert exc.value.status_code == 500
    else:
        result = await admin_writing.bulk_mark_delivered(body, "auth")
        assert result["delivered"] == [str(world.id)]
        assert result["skipped_count"] == 1
    assert world.order[:2] == ["deliver", "deliver"]
    world.receipt.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ACTIONS)
async def test_auth_denial_never_reads_evidence(world, monkeypatch, action):
    denied = AsyncMock(side_effect=HTTPException(403, "forbidden"))
    monkeypatch.setattr(admin_writing, "require_admin", denied)
    monkeypatch.setattr(admin_instructor_queue, "require_admin", denied)
    monkeypatch.setattr(instructor, "_me", denied)
    with pytest.raises(HTTPException) as exc:
        await run_action(action, world, monkeypatch)
    assert exc.value.status_code == 403
    world.getter.assert_not_awaited()
    world.receipt.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["instructor_compose", "instructor_revoke", "instructor_deliver"])
async def test_instructor_ownership_denial_never_reads_evidence(world, monkeypatch, action):
    monkeypatch.setattr(instructor, "assert_essay_owned", Mock(side_effect=PermissionError("not owned")))
    with pytest.raises(PermissionError):
        await run_action(action, world, monkeypatch)
    world.getter.assert_not_awaited()
    world.receipt.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("reason,status", [("not_found", 404), ("not_reviewed", 409)])
async def test_rejected_delivery_does_not_fabricate_outcome(world, monkeypatch, reason, status):
    monkeypatch.setattr(admin_writing, "_deliver_essay",
                        lambda *args: {"ok": False, "reason": reason, "status": "graded"})
    with pytest.raises(HTTPException) as exc:
        await admin_writing.mark_delivered(world.id, admin_writing.MarkDeliveredRequest(), "auth")
    assert exc.value.status_code == status
    world.getter.assert_not_awaited()


@pytest.mark.asyncio
async def test_bulk_all_skipped_has_no_observation(world, monkeypatch):
    monkeypatch.setattr(admin_writing, "_deliver_essay",
                        lambda *args: {"ok": False, "reason": "not_reviewed", "status": "graded"})
    result = await admin_writing.bulk_mark_delivered(
        admin_writing.BulkMarkDeliveredRequest(essay_ids=[world.id]), "auth")
    assert result["delivered_count"] == 0
    assert result["skipped_count"] == 1
    world.getter.assert_not_awaited()


@pytest.mark.asyncio
async def test_bulk_original_error_survives_evidence_outage(world, monkeypatch, caplog):
    world.getter.side_effect = RuntimeError("PRIVATE_PAYLOAD")
    other = uuid4()
    failure = HTTPException(500, "original product error")
    def deliver(essay_id, method):
        if essay_id == str(other):
            raise failure
        return {"ok": True}
    monkeypatch.setattr(admin_writing, "_deliver_essay", deliver)
    with pytest.raises(HTTPException) as exc:
        await admin_writing.bulk_mark_delivered(
            admin_writing.BulkMarkDeliveredRequest(essay_ids=[world.id, other]), "auth")
    assert exc.value is failure
    world.receipt.assert_not_awaited()
    assert "PRIVATE_PAYLOAD" not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("admin_queue", [False, True])
@pytest.mark.parametrize("enabled", [False, True])
async def test_real_delivery_service_returns_bound_review_before_observation(world, monkeypatch, admin_queue, enabled):
    from models.instructor_review import InstructorReview
    monkeypatch.setattr(outcomes.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", enabled)
    review_id = uuid4()
    world.fake.store["instructor_reviews"] = [{
        "id": str(review_id), "essay_id": str(world.id), "status": "claimed",
        "claimed_by": world.admin["id"], "created_at": "2026-09-10T00:00:00Z",
        "updated_at": "2026-09-10T00:00:00Z",
    }]
    world.fake.store["writing_feedback"] = [{
        "essay_id": str(world.id), "version": 1, "prompt_version": "test-instructor-pending", "overall_band_score": 6,
    }]
    monkeypatch.setattr("services.instructor_workflow.supabase_admin", world.fake)
    if admin_queue:
        result = await admin_instructor_queue.deliver_review(review_id,
            admin_instructor_queue.DeliverRequest(instructor_note="test note"), "auth")
    else:
        result = await instructor.deliver_review(None, review_id,
            instructor.InstructorDeliverBody(essay_id=world.id, instructor_note="test note"), "auth")
    assert isinstance(result, InstructorReview)
    assert result.essay_id == world.id
    assert world.essay["status"] == "delivered"
    assert world.fake.store["writing_feedback"][0]["prompt_version"] == "test-instructor"
    if enabled:
        world.receipt.assert_awaited_once()
        assert world.receipt.call_args.kwargs["canonical_attempt_id"] == world.attempt
    else:
        world.getter.assert_not_awaited()


def fault_database(world, monkeypatch, should_fail):
    failure = RuntimeError("injected product write failure")
    def table(name):
        query = world.fake.table(name)
        execute = query.execute
        def guarded_execute():
            if should_fail(name, query.op, query.payload):
                raise failure
            return execute()
        query.execute = guarded_execute
        return query
    db = SimpleNamespace(table=table)
    monkeypatch.setattr(admin_writing, "supabase_admin", db)
    monkeypatch.setattr("services.essay_service.supabase_admin", db)
    monkeypatch.setattr("services.instructor_workflow.supabase_admin", db)
    return failure


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["before_insert", "pointer", "badge", "inplace_badge"])
async def test_real_feedback_write_failure_uses_current_pointer(world, monkeypatch, stage):
    world.fake.store["writing_feedback"] = [{
        "essay_id": str(world.id), "version": 1, "source": "composed" if stage == "inplace_badge" else "ai_pro",
        "parent_version": None, "prompt_version": "test", "model_used": "test",
        "feedback_json": _fj(1, (6, 6, 6, 6)), "overall_band_score": 6,
    }]
    def should_fail(name, op, payload):
        return ((stage == "before_insert" and name == "writing_feedback" and op == "insert")
            or (stage == "pointer" and name == "writing_essays" and op == "update" and "current_version" in payload)
            or (stage in {"badge", "inplace_badge"} and name == "writing_essays" and op == "update" and "status" in payload))
    failure = fault_database(world, monkeypatch, should_fail)
    edits = _fj(2, (7, 7, 7, 7))
    edits["overallBandScore"] = 7
    wrapped = stage in {"badge", "inplace_badge"}
    with pytest.raises(HTTPException if wrapped else RuntimeError) as exc:
        await admin_writing.update_feedback(world.id, edits, "auth")
    if wrapped:
        assert exc.value.status_code == 500
        assert exc.value.__context__ is failure
    else:
        assert exc.value is failure
    assert world.essay["status"] == "graded"
    assert world.essay["current_version"] == (2 if stage == "badge" else 1)
    if stage == "before_insert":
        world.getter.assert_not_awaited()
        world.receipt.assert_not_awaited()
    else:
        world.receipt.assert_awaited_once()
        assert world.receipt.call_args.kwargs["outcome"] == "success"
        assert world.receipt.call_args.kwargs["event_kind"] == "outcome_observed"
        assert world.fake.store["writing_feedback"][-1]["overall_band_score"] == 7
        observed = world.snapshots[-1]["essay"]
        assert observed["current_version"] == (2 if stage == "badge" else 1)
        assert observed["feedback"] == [{"version": observed["current_version"],
                                         "overall_band_score": 6 if stage == "pointer" else 7}]
        assert "overall_band_score" not in world.receipt.call_args.kwargs


@pytest.mark.asyncio
@pytest.mark.parametrize("admin_queue", [False, True])
@pytest.mark.parametrize("stage", ["review", "essay", "stamp"])
async def test_real_review_delivery_partial_writes(world, monkeypatch, admin_queue, stage):
    review_id = uuid4()
    world.fake.store["instructor_reviews"] = [{
        "id": str(review_id), "essay_id": str(world.id), "status": "claimed", "claimed_by": world.admin["id"],
        "created_at": "2026-09-10T00:00:00Z", "updated_at": "2026-09-10T00:00:00Z",
    }]
    world.fake.store["writing_feedback"] = [{
        "essay_id": str(world.id), "version": 1, "prompt_version": "test-instructor-pending", "overall_band_score": 6,
    }]
    failing_table = {"review": "instructor_reviews", "essay": "writing_essays", "stamp": "writing_feedback"}[stage]
    fault_database(world, monkeypatch, lambda name, op, payload: name == failing_table and op == "update")
    with pytest.raises(RuntimeError, match="injected product write failure"):
        if admin_queue:
            await admin_instructor_queue.deliver_review(review_id,
                admin_instructor_queue.DeliverRequest(instructor_note="test note"), "auth")
        else:
            await instructor.deliver_review(None, review_id,
                instructor.InstructorDeliverBody(essay_id=world.id, instructor_note="test note"), "auth")
    assert world.essay["status"] == ("delivered" if stage == "stamp" else "graded")
    if stage == "review":
        world.receipt.assert_not_awaited()
        world.getter.assert_not_awaited()
    else:
        assert world.fake.store["instructor_reviews"][0]["status"] == "delivered"
        world.receipt.assert_awaited_once()
        assert world.receipt.call_args.kwargs["outcome"] == "success"


@pytest.mark.asyncio
async def test_real_instructor_composition_pointer_failure_is_observed(world, monkeypatch):
    world.fake.store["writing_feedback"] = [{
        "essay_id": str(world.id), "version": 1, "source": "ai_pro", "parent_version": None,
        "prompt_version": "test", "model_used": "test", "overall_band_score": 6,
        "feedback_json": _fj(1, (6, 6, 6, 6)),
    }]
    fault_database(world, monkeypatch, lambda name, op, payload:
        name == "writing_essays" and op == "update" and "current_version" in payload)
    body = instructor.ComposeBody(base_version=1, mainCriterion=1,
        coherenceCohesion=1, lexicalResource=1, grammaticalRange=1)
    with pytest.raises(RuntimeError, match="injected product write failure"):
        await instructor.compose_essay_version(None, world.id, body, "auth")
    assert len(world.fake.store["writing_feedback"]) == 2
    assert world.essay["current_version"] == 1
    world.receipt.assert_awaited_once()
    assert world.receipt.call_args.kwargs["outcome"] == "success"
