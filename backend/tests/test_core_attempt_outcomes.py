"""Metadata-only outcome contracts. No learner content, remote DB or AI calls."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from services import core_attempt_outcomes as outcomes
from services.core_attempt_evidence import ReceiptStatus


NOW = "2026-09-10T00:00:00Z"


@pytest.mark.parametrize("cancellation", ["child", "external", "deadline", "inner_deadline", "deadline_during_drain"])
@pytest.mark.parametrize("row_count", [4, 8])
def test_writing_batch_drains_actual_nested_assignment_tasks(monkeypatch, cancellation, row_count):
    monkeypatch.setattr(outcomes.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", True)
    ids = [{"id": str(uuid4())} for _ in range(row_count)]
    monkeypatch.setattr(outcomes, "get_supabase_async", AsyncMock(side_effect=lambda: Query(ids)))
    monkeypatch.setattr(outcomes, "WRITING_BATCH_BUDGET_SECONDS", 0.03 if cancellation == "deadline" else 2)
    if cancellation in {"inner_deadline", "deadline_during_drain"}:
        monkeypatch.setattr(outcomes, "OUTCOME_BUDGET_SECONDS", 0.01)
    async def run():
        active = 0
        entered = 0
        ready = asyncio.Event()
        tasks = []
        original_create_task = asyncio.create_task
        def track_task(coro, **kwargs):
            task = original_create_task(coro, **kwargs)
            tasks.append(task)
            return task
        monkeypatch.setattr(asyncio, "create_task", track_task)
        async def observe(*args, **kwargs):
            nonlocal active, entered
            index = entered
            entered += 1
            active += 1
            if entered == 4:
                ready.set()
            try:
                await ready.wait()
                if cancellation in {"child", "deadline_during_drain"} and index == 0:
                    raise asyncio.CancelledError()
                await asyncio.Event().wait()
            finally:
                try:
                    await asyncio.sleep(0.08 if cancellation == "deadline_during_drain" and index != 0 else 0)
                finally:
                    active -= 1
        monkeypatch.setattr(outcomes, "observe_persisted_outcome", observe)
        task = asyncio.create_task(outcomes.observe_writing_batch([str(uuid4())]))
        await asyncio.wait_for(ready.wait(), 1)
        if cancellation == "external":
            task.cancel()
        if cancellation in {"deadline", "inner_deadline", "deadline_during_drain"}:
            await asyncio.wait_for(task, 1)
        else:
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(task, 1)
        # Assert BEFORE asyncio.run shutdown can clean up orphaned descendants.
        assert active == 0
        assert all(task.done() for task in tasks)  # includes semaphore-queued children
    asyncio.run(run())


def speaking(full=False):
    attempt, owner = uuid4(), str(uuid4())
    rows = []
    for part in ([1, 2, 3] if full else [1]):
        questions = [{"id": str(uuid4())} for _ in range({1: 9, 2: 1, 3: 5}[part] if full else 2)]
        rows.append({
            "id": str(uuid4() if full else attempt), "user_id": owner,
            "mode": "test_full" if full else "practice", "part": part,
            "full_test_attempt_id": str(attempt) if full else None,
            "sitting_id": None, "status": "completed", "overall_band": 6,
            "completed_at": NOW, "renderer_affinity": "next", "questions": questions,
            "responses": [{"question_id": q["id"], "grading_status": "completed", "overall_band": 6}
                          for q in questions],
        })
    return attempt, rows, "speaking_full_test" if full else "speaking_session"


def dictation():
    attempt, owner = uuid4(), str(uuid4())
    return attempt, {
        "id": str(attempt), "user_id": owner, "status": "completed", "completed_at": NOW,
        "core_evidence_unit_count": 2,
        "renderer_affinity": "next",
        "reports": [{"id": str(uuid4()), "attempt_id": str(attempt), "user_id": owner,
                     "total_sentences": 2, "completed_at": NOW}],
        "answers": [{"sentence_idx": 0, "score": 0}, {"sentence_idx": 1, "score": 0.5}],
    }


def writing():
    attempt, owner, essay = uuid4(), str(uuid4()), str(uuid4())
    return attempt, {
        "id": str(attempt), "student_id": owner, "essay_id": essay,
        "status": "submitted", "renderer_affinity": "next",
        "essay": {"id": essay, "student_id": owner, "status": "graded", "is_flagged": False,
                  "deleted_at": None, "current_version": 1,
                  "feedback": [{"version": 1, "overall_band_score": 6}], "jobs": []},
    }


@pytest.mark.parametrize("full", [False, True])
def test_speaking_persisted_result(full):
    attempt, rows, kind = speaking(full)
    assert outcomes.speaking_outcome(rows, attempt, kind).state == "success"


@pytest.mark.parametrize("field,value", [
    ("overall_band", None), ("overall_band", True), ("overall_band", float("nan")),
    ("completed_at", None), ("completed_at", "2026-09-10T00:00:00"),
    ("responses", []), ("questions", []), ("user_id", None),
    ("mode", "test_part"), ("part", True), ("full_test_attempt_id", str(uuid4())),
])
def test_full_speaking_malformed_or_mixed_state_is_unknown(field, value):
    attempt, rows, kind = speaking(True)
    rows[0][field] = value
    assert outcomes.speaking_outcome(rows, attempt, kind).state == "unknown"


def test_full_speaking_requires_all_parts_and_question_counts():
    attempt, rows, kind = speaking(True)
    assert outcomes.speaking_outcome(rows[:2], attempt, kind).state == "unknown"
    rows[0]["questions"].pop()
    rows[0]["responses"].pop()
    assert outcomes.speaking_outcome(rows, attempt, kind).state == "unknown"


def test_practice_subset_is_legal_but_ungraded_responses_are_not_success():
    attempt, rows, kind = speaking()
    rows[0]["responses"].pop()
    assert outcomes.speaking_outcome(rows, attempt, kind).state == "success"
    rows[0]["responses"][0]["grading_status"] = "pending"
    assert outcomes.speaking_outcome(rows, attempt, kind).state == "unknown"


@pytest.mark.parametrize("status,expected", [("in_progress", "pending"), ("submitted", "pending"),
    ("analysis_failed", "failed"), ("grading_failed", "failed"), ("abandoned", "unknown"), ("surprise", "unknown")])
def test_full_speaking_status_precedence(status, expected):
    attempt, rows, kind = speaking(True)
    rows[0]["status"] = status
    assert outcomes.speaking_outcome(rows, attempt, kind).state == expected
    if status == "abandoned":
        for row in rows:
            row["status"] = status
        assert outcomes.speaking_outcome(rows, attempt, kind).state == "abandoned"


def test_dictation_low_score_is_still_a_persisted_result():
    attempt, row = dictation()
    assert outcomes.dictation_outcome(row, attempt).state == "success"


@pytest.mark.parametrize("mutation", [
    lambda r: r.update(completed_at=None),
    lambda r: r.update(core_evidence_unit_count=None),
    lambda r: r.update(core_evidence_unit_count=3),
    lambda r: r.update(core_evidence_unit_count=True),
    lambda r: r.update(reports=[]),
    lambda r: r["reports"].append(deepcopy(r["reports"][0])),
    lambda r: r["reports"][0].update(user_id=str(uuid4())),
    lambda r: r["reports"][0].update(attempt_id=str(uuid4())),
    lambda r: r["reports"][0].update(total_sentences=True),
    lambda r: r["answers"].pop(),
    lambda r: r["answers"][1].update(sentence_idx=0),
    lambda r: r["answers"][1].update(sentence_idx=True),
    lambda r: r["answers"][0].update(score=1.1),
])
def test_dictation_incomplete_or_inconsistent_report_is_unknown(mutation):
    attempt, row = dictation()
    mutation(row)
    assert outcomes.dictation_outcome(row, attempt).state == "unknown"


@pytest.mark.parametrize("status,expected", [("in_progress", "pending"), ("abandoned", "abandoned"),
                                           ("completed", "unknown")])
def test_dictation_non_result_states(status, expected):
    attempt, row = dictation()
    row.update(status=status, reports=[])
    assert outcomes.dictation_outcome(row, attempt).state == expected


def test_writing_failed_regrade_keeps_current_good_feedback():
    attempt, row = writing()
    row["essay"]["jobs"] = [{"job_type": "analyze", "status": "failed", "created_at": NOW, "completed_at": NOW}]
    assert outcomes.writing_outcome(row, attempt).state == "success"


@pytest.mark.parametrize("mutation", [
    lambda r: r.update(status="pending"),
    lambda r: r.update(student_id=str(uuid4())),
    lambda r: r["essay"].update(is_flagged=True),
    lambda r: r["essay"].update(deleted_at=NOW),
    lambda r: r["essay"].update(current_version=2),
    lambda r: r["essay"].update(current_version=True),
    lambda r: r["essay"].update(feedback=[]),
    lambda r: r["essay"]["feedback"][0].update(version=True),
    lambda r: r["essay"]["feedback"][0].update(overall_band_score=None),
])
def test_writing_invalid_current_feedback_is_unknown(mutation):
    attempt, row = writing()
    mutation(row)
    assert outcomes.writing_outcome(row, attempt).state == "unknown"


def test_writing_failure_requires_terminal_analyze_job_and_no_retry():
    attempt, row = writing()
    essay = row["essay"]
    essay.update(status="failed", jobs=[])
    assert outcomes.writing_outcome(row, attempt).state == "unknown"
    job = {"job_type": "analyze", "status": "failed", "created_at": NOW, "completed_at": NOW}
    essay["jobs"] = [job]
    assert outcomes.writing_outcome(row, attempt).state == "failed"
    essay["jobs"].append(job | {"status": "queued"})
    assert outcomes.writing_outcome(row, attempt).state == "pending"
    essay["jobs"][1]["status"] = "completed"
    assert outcomes.writing_outcome(row, attempt).state == "unknown"  # tied timestamps


@pytest.mark.parametrize("value", [None, [], [None], {}, {"renderer_affinity": []}])
def test_malformed_shapes_do_not_raise(value):
    attempt = uuid4()
    assert outcomes.speaking_outcome(value, attempt, "speaking_session").state == "unknown"
    assert outcomes.dictation_outcome(value, attempt).state == "unknown"
    assert outcomes.writing_outcome(value, attempt).state == "unknown"


class Query:
    def __init__(self, data):
        self.data, self.calls = data, []

    def __getattr__(self, name):
        if name == "execute":
            async def execute():
                return SimpleNamespace(data=self.data)
            return execute
        def chain(*args):
            self.calls.append((name, args))
            return self
        return chain


@pytest.fixture
def capture(monkeypatch):
    monkeypatch.setattr(outcomes.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", True)
    writer = AsyncMock(return_value=ReceiptStatus.RECORDED)
    monkeypatch.setattr(outcomes, "try_record_event", writer)
    return writer


@pytest.mark.parametrize("surface,factory", [("listening_dictation", dictation), ("writing_assignment", writing)])
def test_snapshot_read_records_only_allowed_metadata(monkeypatch, capture, surface, factory):
    attempt, row = factory()
    query = Query([row])
    monkeypatch.setattr(outcomes, "get_supabase_async", AsyncMock(return_value=query))
    operation = uuid4()
    result = asyncio.run(outcomes.observe_persisted_outcome(surface, attempt, operation_id=operation))
    assert result == ReceiptStatus.RECORDED
    event = capture.call_args.kwargs
    assert event["outcome"] == "success" and event["operation_id"] == operation
    assert event["canonical_attempt_id"] == attempt and event["attempt_kind"] == "default"
    assert set(event) == {"event_id", "operation_id", "surface", "canonical_attempt_id", "attempt_kind",
                          "operation", "event_kind", "outcome", "renderer"}
    projection = next(args[0] for name, args in query.calls if name == "select")
    assert all(term not in projection for term in ("essay_text", "transcript", "student_answer", "feedback_json", "email"))
    assert ("eq", ("id", str(attempt))) in query.calls


def test_disabled_background_and_request_paths_make_no_queries(monkeypatch, capture):
    monkeypatch.setattr(outcomes.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", False)
    getter = AsyncMock(side_effect=AssertionError("must not access DB"))
    monkeypatch.setattr(outcomes, "get_supabase_async", getter)
    async def run():
        assert await outcomes.observe_persisted_outcome("speaking", uuid4()) == ReceiptStatus.DISABLED
        await outcomes.observe_speaking_background([])
        await outcomes.observe_writing_background("invalid")
    asyncio.run(run())
    getter.assert_not_called()
    capture.assert_not_called()


@pytest.mark.parametrize("operation", ["grade", "submit", "finalize"])
def test_outcome_preserves_trigger_operation(monkeypatch, capture, operation):
    attempt, rows, kind = speaking()
    monkeypatch.setattr(outcomes, "get_supabase_async", AsyncMock(return_value=Query(rows)))
    assert asyncio.run(outcomes.observe_persisted_outcome("speaking", attempt, kind, operation=operation)) == ReceiptStatus.RECORDED
    assert capture.call_args.kwargs["operation"] == operation


def test_outcome_rejects_invalid_operation_before_db(monkeypatch, capture):
    getter = AsyncMock(side_effect=AssertionError("no DB"))
    monkeypatch.setattr(outcomes, "get_supabase_async", getter)
    assert asyncio.run(outcomes.observe_persisted_outcome("speaking", uuid4(), "speaking_session", operation="start")) == ReceiptStatus.INVALID
    getter.assert_not_called()
    capture.assert_not_called()


def test_read_error_does_not_invent_an_attempt_failure_or_log_payload(monkeypatch, capture, caplog):
    monkeypatch.setattr(outcomes, "get_supabase_async", AsyncMock(side_effect=RuntimeError("SECRET_PAYLOAD")))
    assert asyncio.run(outcomes.observe_persisted_outcome("writing_assignment", uuid4())) == ReceiptStatus.UNAVAILABLE
    assert "SECRET_PAYLOAD" not in caplog.text
    capture.assert_not_called()


def test_timeout_and_cancellation(monkeypatch, capture):
    async def slow():
        await asyncio.sleep(20)
    monkeypatch.setattr(outcomes, "get_supabase_async", slow)
    monkeypatch.setattr(outcomes, "OUTCOME_BUDGET_SECONDS", 0.01)
    assert asyncio.run(outcomes.observe_persisted_outcome("writing_assignment", uuid4())) == ReceiptStatus.UNAVAILABLE
    monkeypatch.setattr(outcomes, "get_supabase_async", AsyncMock(side_effect=asyncio.CancelledError))
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(outcomes.observe_persisted_outcome("writing_assignment", uuid4()))
    capture.assert_not_called()


def test_background_full_test_resolves_one_canonical_identity(monkeypatch, capture):
    attempt, rows, kind = speaking(True)
    monkeypatch.setattr(outcomes, "get_supabase_async", AsyncMock(return_value=Query(rows)))
    recorder = AsyncMock()
    monkeypatch.setattr(outcomes, "observe_persisted_outcome", recorder)
    asyncio.run(outcomes.observe_speaking_background([row["id"] for row in rows]))
    recorder.assert_awaited_once_with("speaking", attempt, kind)
    rows[0]["full_test_attempt_id"] = str(uuid4())
    recorder.reset_mock()
    asyncio.run(outcomes.observe_speaking_background([row["id"] for row in rows]))
    recorder.assert_not_called()


def test_background_writing_targets_linked_assignments_only(monkeypatch, capture):
    ids = [str(uuid4()), str(uuid4())]
    query = Query([{"id": value} for value in ids])
    monkeypatch.setattr(outcomes, "get_supabase_async", AsyncMock(return_value=query))
    recorder = AsyncMock()
    monkeypatch.setattr(outcomes, "observe_persisted_outcome", recorder)
    essay = str(uuid4())
    asyncio.run(outcomes.observe_writing_background(essay))
    assert ("eq", ("essay_id", essay)) in query.calls
    assert [call.args for call in recorder.call_args_list] == [("writing_assignment", UUID(value)) for value in ids]


def test_unlinked_essay_does_not_invent_a_writing_assignment(monkeypatch, capture):
    query = Query([])
    monkeypatch.setattr(outcomes, "get_supabase_async", AsyncMock(return_value=query))
    recorder = AsyncMock()
    monkeypatch.setattr(outcomes, "observe_persisted_outcome", recorder)
    essay = str(uuid4())
    asyncio.run(outcomes.observe_writing_background(essay))
    assert ("eq", ("essay_id", essay)) in query.calls
    recorder.assert_not_awaited()
    capture.assert_not_awaited()


def test_background_writing_fanout_has_bounded_parallelism(monkeypatch, capture):
    ids = [str(uuid4()) for _ in range(5)]
    monkeypatch.setattr(outcomes, "get_supabase_async", AsyncMock(return_value=Query([{"id": value} for value in ids])))
    active, peak, finished = 0, 0, []
    async def observe(surface, attempt_id):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.12)
        active -= 1
        finished.append(str(attempt_id))
    monkeypatch.setattr(outcomes, "observe_persisted_outcome", observe)
    asyncio.run(outcomes.observe_writing_background(str(uuid4())))
    assert set(finished) == set(ids) and peak == 4


def test_writing_batch_deduplicates_and_skips_invalid_ids_without_logging_content(monkeypatch, capture, caplog):
    ids = [str(uuid4()), str(uuid4())]
    observer = AsyncMock()
    monkeypatch.setattr(outcomes, "observe_writing_background", observer)
    asyncio.run(outcomes.observe_writing_batch([ids[0], ids[0].upper(), ids[1], "PRIVATE_INVALID_ID"]))
    assert {call.args[0] for call in observer.call_args_list} == set(ids)
    assert observer.await_count == 2
    assert "core_writing_batch_invalid_identity" in caplog.text
    assert "PRIVATE_INVALID_ID" not in caplog.text


def test_writing_batch_disabled_does_not_validate_or_read(monkeypatch, capture):
    monkeypatch.setattr(outcomes.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", False)
    observer = AsyncMock(side_effect=AssertionError("no read"))
    monkeypatch.setattr(outcomes, "observe_writing_background", observer)
    asyncio.run(outcomes.observe_writing_batch([None]))
    observer.assert_not_called()


def test_writing_batch_has_four_workers_and_does_not_drop_later_essays_on_item_error(monkeypatch, capture, caplog):
    ids = [str(uuid4()) for _ in range(9)]
    active, peak, visited = 0, 0, []
    async def observe(essay_id):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        try:
            await asyncio.sleep(0.01)
            visited.append(essay_id)
            if essay_id == ids[0]:
                raise RuntimeError("PRIVATE_PROVIDER_ERROR")
        finally:
            active -= 1
    monkeypatch.setattr(outcomes, "observe_writing_background", observe)
    asyncio.run(outcomes.observe_writing_batch(ids))
    assert peak == 4 and active == 0
    assert set(visited) == set(ids)
    assert "core_writing_batch_item_unavailable" in caplog.text
    assert "PRIVATE_PROVIDER_ERROR" not in caplog.text


def test_writing_batch_deadline_cancels_and_drains_workers(monkeypatch, capture, caplog):
    active, cancelled = 0, 0
    async def observe(essay_id):
        nonlocal active, cancelled
        active += 1
        try:
            await asyncio.Event().wait()
        finally:
            active -= 1
            cancelled += 1
    monkeypatch.setattr(outcomes, "observe_writing_background", observe)
    monkeypatch.setattr(outcomes, "WRITING_BATCH_BUDGET_SECONDS", 0.02)
    asyncio.run(outcomes.observe_writing_batch([str(uuid4()) for _ in range(8)]))
    assert active == 0 and cancelled == 4
    assert "core_writing_batch_outcome_incomplete" in caplog.text


def test_writing_batch_child_cancellation_is_not_swallowed(monkeypatch, capture):
    monkeypatch.setattr(outcomes, "observe_writing_background", AsyncMock(side_effect=asyncio.CancelledError))
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(outcomes.observe_writing_batch([str(uuid4())]))


@pytest.mark.parametrize("repeat_cancel", [False, True])
def test_writing_batch_external_cancellation_drains_before_return(monkeypatch, capture, repeat_cancel):
    async def run():
        active = 0
        entered, cleaning = asyncio.Event(), asyncio.Event()
        async def observe(essay_id):
            nonlocal active
            active += 1
            if active == 4:
                entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cleaning.set()
                try:
                    await asyncio.sleep(0.02)
                finally:
                    active -= 1
        monkeypatch.setattr(outcomes, "observe_writing_background", observe)
        task = asyncio.create_task(outcomes.observe_writing_batch([str(uuid4()) for _ in range(8)]))
        await entered.wait()
        task.cancel()
        if repeat_cancel:
            await cleaning.wait()
            task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert active == 0, "no surviving workers before the event loop itself is closed"
    asyncio.run(run())


def test_writing_batch_child_cancellation_drains_siblings_before_return(monkeypatch, capture):
    ids = sorted(str(uuid4()) for _ in range(4))
    active = 0
    async def observe(essay_id):
        nonlocal active
        active += 1
        try:
            await asyncio.sleep(0)
            if essay_id == ids[0]:
                raise asyncio.CancelledError
            await asyncio.Event().wait()
        finally:
            active -= 1
    monkeypatch.setattr(outcomes, "observe_writing_background", observe)
    async def run():
        with pytest.raises(asyncio.CancelledError):
            await outcomes.observe_writing_batch(ids)
        assert active == 0, "must drain before event-loop shutdown, not rely on asyncio.run cleanup"
    asyncio.run(run())


@pytest.mark.parametrize("attempt_count,restore,expected", [
    (0, None, "pending"), (3, None, "failed"), (3, "delivered", "success"),
])
def test_actual_reaper_snapshot_reads_committed_state_not_reaper_counter(monkeypatch, capture, attempt_count, restore, expected):
    from services import essay_service
    from test_essay_service import _FakeSupabase, _reaper_responses, _FIXED_NOW, _ESSAY_ID
    attempt, canonical = writing()
    canonical["essay_id"] = _ESSAY_ID
    canonical["essay"]["id"] = _ESSAY_ID
    canonical["essay"]["status"] = "grading"
    responses = _reaper_responses(job_overrides={
        "attempt_count": attempt_count, "max_attempts": 3,
        "job_payload": {"restore_status": restore},
    })
    db = _FakeSupabase(responses=responses)
    monkeypatch.setattr(essay_service, "supabase_admin", db)
    monkeypatch.setattr(essay_service, "_schedule_requeue", lambda *args, **kwargs: None)

    class SnapshotQuery:
        def table(self, name):
            assert name == "writing_assignments"
            return self
        def select(self, columns):
            self.columns = columns
            return self
        def eq(self, *args): return self
        def limit(self, *args): return self
        async def execute(self):
            if self.columns == "id":
                return SimpleNamespace(data=[{"id": str(attempt)}])
            row = deepcopy(canonical)
            job = {"job_type": "analyze", "created_at": "2026-01-01T00:00:00Z", "status": "running"}
            for call in db.calls:
                if call["op"] != "update":
                    continue
                if call["table"] == "writing_essays":
                    row["essay"].update(call["payload"])
                elif call["table"] == "writing_jobs":
                    job.update(call["payload"])
            row["essay"]["jobs"] = [job]
            return SimpleNamespace(data=[row])
    monkeypatch.setattr(outcomes, "get_supabase_async", AsyncMock(side_effect=lambda: SnapshotQuery()))
    summary = asyncio.run(essay_service.reap_stuck_grading_jobs(now=_FIXED_NOW))
    event = capture.call_args.kwargs
    assert event["canonical_attempt_id"] == attempt
    assert event["outcome"] == expected
    if restore:
        assert summary["failed"] == 1 and event["outcome"] == "success", "failed regrade preserves prior good result"
