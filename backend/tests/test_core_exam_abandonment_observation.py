"""Exercise actual start-over routes against an in-memory committed-row fake."""
import asyncio
import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from routers import listening, reading_student as reading
from services import core_attempt_observation as obs
from services.core_attempt_evidence import EvidenceEvent, ReceiptStatus


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters = db, table, []
        self.action, self.payload = "select", None

    def select(self, *_args, **_kwargs): return self
    def eq(self, key, value): self.filters.append((key, value)); return self
    def limit(self, _value): return self
    def update(self, payload): self.action, self.payload = "update", payload; return self
    def insert(self, payload): self.action, self.payload = "insert", payload; return self

    def execute(self):
        self.db.calls.append((self.table, self.action, list(self.filters)))
        if self.table == "listening_tests":
            return SimpleNamespace(data=[self.db.test])
        if self.action == "insert":
            if self.db.insert_error:
                raise self.db.insert_error
            self.db.rows.append(copy.deepcopy(self.payload))
            return SimpleNamespace(data=[copy.deepcopy(self.payload)])
        matches = [row for row in self.db.rows if all(row.get(key) == value for key, value in self.filters)]
        if self.action == "update":
            if self.db.update_error:
                raise self.db.update_error
            for row in matches:
                row.update(self.payload)
        return SimpleNamespace(data=copy.deepcopy(matches))


class DB:
    def __init__(self, test, rows):
        self.test, self.rows, self.calls = test, rows, []
        self.insert_error = self.update_error = None

    def table(self, name): return Query(self, name)


def setup(monkeypatch, flavor, enabled=True):
    user, test_id = str(uuid4()), str(uuid4())
    capability = "c" * 32
    owner = {"user_id": None, "anon_id": capability} if flavor == "share" else {"user_id": user}
    old = {"id": str(uuid4()), "test_id": test_id, **owner,
           "status": "in_progress", "renderer_affinity": "next", "answers": ["private answer"]}
    other = {**old, "id": str(uuid4()), "user_id": str(uuid4()), "anon_id": "d" * 32}
    other_test = {**old, "id": str(uuid4()), "test_id": str(uuid4())}
    done = {**old, "id": str(uuid4()), "status": "submitted"}
    test = {"id": test_id, "status": "published", "time_limit_minutes": 60,
            "full_audio_storage_path": "synthetic/audio", "metadata": {"share": {"token": "share-fixture"}}}
    db = DB(test, [old, other, other_test, done])
    monkeypatch.setattr(obs.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", enabled)
    events, old_states_at_receipt = [], []
    async def record(**fields):
        old_states_at_receipt.append(old["status"])
        events.append(EvidenceEvent(**fields))
        return ReceiptStatus.RECORDED
    monkeypatch.setattr(obs, "try_record_event", AsyncMock(side_effect=record))
    module = listening if flavor == "listening" else reading
    monkeypatch.setattr(module, "supabase_admin", db)
    monkeypatch.setattr(module, "_require_auth", AsyncMock(return_value={"id": user}))
    if flavor == "listening":
        monkeypatch.setattr(listening, "_assert_listening_exam_content_allowed", lambda *_args: None)
        invoke = lambda: listening.start_listening_test_attempt(test_id)
    else:
        monkeypatch.setattr(reading, "_fetch_published_test", lambda *_args: test)
        monkeypatch.setattr(reading, "_assert_exam_content_allowed", lambda *_args: None)
        monkeypatch.setattr(reading, "_require_test_unlocked", lambda *_args: None)
        monkeypatch.setattr(reading, "_resolve_share", lambda *_args, **_kwargs: test)
        monkeypatch.setattr(reading, "_hash_anon_src", lambda *_args: None)
        invoke = (lambda: reading.start_shared_reading_test_attempt("share-fixture", None, x_reading_anon=capability)) if flavor == "share" else (lambda: reading.start_reading_test_attempt(test_id))
    return SimpleNamespace(db=db, old=old, other=other, other_test=other_test, done=done,
                           invoke=invoke, events=events, old_states_at_receipt=old_states_at_receipt,
                           user=user, capability=capability, module=module)


@pytest.mark.parametrize("flavor", ["reading", "share", "listening"])
@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("insert_failed", [False, True])
def test_actual_start_over_records_only_acknowledged_old_attempt_even_if_new_insert_fails(monkeypatch, flavor, enabled, insert_failed):
    world = setup(monkeypatch, flavor, enabled)
    if insert_failed:
        world.db.insert_error = RuntimeError("synthetic insert failure")
        with pytest.raises(RuntimeError, match="synthetic insert failure"):
            asyncio.run(world.invoke())
    else:
        reply = asyncio.run(world.invoke())
        assert reply["attempt_id"] != world.old["id"]
        assert world.db.rows[-1]["status"] == "in_progress"
    assert world.old["status"] == "abandoned"
    assert world.other["status"] == world.other_test["status"] == "in_progress"
    assert world.done["status"] == "submitted"
    abandoned = [event for event in world.events if event.outcome == "abandoned"]
    assert len(abandoned) == int(enabled)
    if enabled:
        assert world.old_states_at_receipt == ["abandoned", "abandoned"]
        event = abandoned[0]
        assert event.canonical_attempt_id == UUID(world.old["id"])
        assert event.start_observed is False and event.event_kind == "outcome_observed"
        assert event.traffic_class == "unknown" and event.release_id is None
        assert event.renderer == "next" and event.operation == "start"
        assert len(world.events) == 2
        start = next(item for item in world.events if item is not event)
        assert event.operation_id == start.operation_id
        assert start.canonical_attempt_id == (None if insert_failed else UUID(reply["attempt_id"]))
        assert start.event_kind == ("operation_failed" if insert_failed else "started")
    else:
        assert world.events == []
    assert all(event.canonical_attempt_id != UUID(world.other["id"]) for event in world.events)
    encoded = str(world.events)
    assert world.user not in encoded and world.capability not in encoded and "private answer" not in encoded


@pytest.mark.parametrize("flavor", ["reading", "share", "listening"])
def test_unacknowledged_update_does_not_fabricate_abandonment(monkeypatch, flavor):
    world = setup(monkeypatch, flavor)
    world.db.update_error = RuntimeError("update unavailable")
    with pytest.raises(RuntimeError, match="update unavailable"):
        asyncio.run(world.invoke())
    assert world.old["status"] == "in_progress"
    assert len(world.events) == 1 and world.events[0].event_kind == "operation_failed"
    assert all(event.outcome != "abandoned" for event in world.events)
    assert all(action != "insert" for _, action, _ in world.db.calls)


@pytest.mark.parametrize("flavor", ["reading", "share", "listening"])
def test_denied_start_never_updates_or_observes_old_attempt(monkeypatch, flavor):
    world = setup(monkeypatch, flavor)
    if flavor == "share":
        monkeypatch.setattr(reading, "_resolve_share", lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPException(403, "denied")))
    else:
        monkeypatch.setattr(world.module, "_require_auth", AsyncMock(side_effect=HTTPException(403, "denied")))
    with pytest.raises(HTTPException):
        asyncio.run(world.invoke())
    assert world.db.calls == [] and world.events == []


@pytest.mark.parametrize("invalid", ["none", "owner", "test", "status", "id", "renderer", "oversize", "missing_data"])
def test_invalid_return_set_never_invents_abandoned_outcomes(invalid):
    user, test_id = str(uuid4()), str(uuid4())
    row = {"id": str(uuid4()), "user_id": user, "test_id": test_id, "status": "abandoned"}
    rows = [row]
    if invalid == "none": rows = None
    if invalid == "owner": row["user_id"] = str(uuid4())
    if invalid == "test": row["test_id"] = str(uuid4())
    if invalid == "status": row["status"] = "in_progress"
    if invalid == "id": row["id"] = "invalid"
    if invalid == "renderer": row["renderer_affinity"] = "browser-claim"
    if invalid == "oversize": rows = [row] * 101
    result = SimpleNamespace() if invalid == "missing_data" else SimpleNamespace(data=rows)
    current = obs._Observation("reading_exam", "start", admitted=True)
    token = obs._current.set(current)
    try:
        obs.note_abandoned_exam_attempts(result, test_id=test_id, user_id=user)
        assert current.abandoned_exams == {} and current.abandoned_exams_incomplete is True
    finally:
        obs._current.reset(token)


def test_disabled_note_does_not_touch_update_response():
    class Unreadable:
        @property
        def data(self): raise AssertionError("must not inspect response outside an enabled observation")
    assert obs._current.get() is None
    obs.note_abandoned_exam_attempts(Unreadable(), test_id=str(uuid4()), user_id=str(uuid4()))


def test_duplicate_returns_keep_only_metadata_and_do_not_rebind_new_attempt():
    user, test_id, old, new = (str(uuid4()) for _ in range(4))
    row = {"id": old, "user_id": user, "test_id": test_id, "status": "abandoned", "renderer_affinity": "legacy", "answers": ["private"]}
    current = obs._Observation("reading_exam", "start", admitted=True)
    token = obs._current.set(current)
    try:
        for _ in range(3):
            obs.note_abandoned_exam_attempts(SimpleNamespace(data=[row]), test_id=test_id, user_id=user)
        obs.bind_owned_attempt({"id": new, "user_id": user, "status": "in_progress"}, started=True)
        assert current.abandoned_exams == {UUID(old): "legacy"}
        assert current.attempt_id == UUID(new) and current.started
        assert "private" not in str(current) and user not in str(current) and test_id not in str(current)
    finally:
        obs._current.reset(token)


def test_abandonment_workers_share_original_budget_and_propagate_cancellation(monkeypatch, caplog):
    current = obs._Observation("reading_exam", "start", admitted=True,
                               abandoned_exams={uuid4(): None for _ in range(12)})
    active = maximum = 0
    async def blocked(**fields):
        nonlocal active, maximum
        if fields.get("outcome") != "abandoned": return ReceiptStatus.RECORDED
        active += 1
        maximum = max(maximum, active)
        try:
            await asyncio.Event().wait()
        finally:
            active -= 1
    monkeypatch.setattr(obs, "try_record_event", blocked)
    async def check():
        error = RuntimeError("new attempt insert failed")
        await obs._emit_safely(current, error)
        assert active == 0 and maximum == 4
        task = asyncio.create_task(obs._emit_safely(current, error))
        while active == 0: await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert active == 0
    asyncio.run(check())
    messages = [record.getMessage() for record in caplog.records
                if "core_attempt_observation_unavailable" in record.getMessage()]
    assert messages == ["core_attempt_observation_unavailable surface=reading_exam operation=start component=deadline"]


def test_later_unverified_retry_does_not_erase_prior_confirmed_abandonments():
    user, test_id = str(uuid4()), str(uuid4())
    first, second = uuid4(), uuid4()
    current = obs._Observation("reading_exam", "start", admitted=True)
    token = obs._current.set(current)
    try:
        def note(attempt_id):
            obs.note_abandoned_exam_attempts(SimpleNamespace(data=[{
                "id": str(attempt_id), "user_id": user, "test_id": test_id, "status": "abandoned",
            }]), test_id=test_id, user_id=user)
        note(first)
        obs.note_abandoned_exam_attempts(SimpleNamespace(data=None), test_id=test_id, user_id=user)
        note(second)
        assert current.abandoned_exams == {first: None, second: None}
        assert current.abandoned_exams_incomplete
    finally:
        obs._current.reset(token)


@pytest.mark.parametrize("failing_branch", ["operation", "abandonment"])
def test_unexpected_observer_failure_does_not_cancel_independent_receipt(monkeypatch, caplog, failing_branch):
    current = obs._Observation("reading_exam", "start", admitted=True,
                               abandoned_exams={uuid4(): None})
    completed = []

    async def check():
        pending = asyncio.Event()

        async def failing(*_args):
            await pending.wait()
            raise RuntimeError("private observer failure")

        async def surviving(*_args):
            pending.set()
            # Ensure the sibling fails while this receipt is still pending.
            await asyncio.sleep(0.01)
            completed.append("recorded")

        monkeypatch.setattr(obs, "_emit", failing if failing_branch == "operation" else surviving)
        monkeypatch.setattr(obs, "_emit_abandoned_exams", failing if failing_branch == "abandonment" else surviving)
        await obs._emit_safely(current, RuntimeError("original business error"))

    asyncio.run(check())
    assert completed == ["recorded"]
    messages = [record.getMessage() for record in caplog.records
                if "core_attempt_observation_unavailable" in record.getMessage()]
    assert messages == [f"core_attempt_observation_unavailable surface=reading_exam operation=start component={failing_branch}"]
    assert "private observer failure" not in caplog.text


@pytest.mark.parametrize("flavor", ["reading", "share", "listening"])
def test_actual_insert_error_survives_broken_new_attempt_observer(monkeypatch, flavor):
    world = setup(monkeypatch, flavor)
    original = RuntimeError("original insert failure")
    world.db.insert_error = original

    async def broken(*_args):
        raise RuntimeError("observer failure")

    monkeypatch.setattr(obs, "_emit", broken)
    with pytest.raises(RuntimeError) as raised:
        asyncio.run(world.invoke())
    assert raised.value is original
    assert world.old["status"] == "abandoned"
    assert len(world.events) == 1
    assert world.events[0].canonical_attempt_id == UUID(world.old["id"])
    assert world.events[0].outcome == "abandoned"


def test_unverified_returns_log_one_scoped_diagnostic_without_raw_metadata(monkeypatch, caplog):
    current = obs._Observation("reading_exam", "start", admitted=True)
    token = obs._current.set(current)
    user, test_id = str(uuid4()), str(uuid4())
    try:
        for _ in range(2):
            obs.note_abandoned_exam_attempts(SimpleNamespace(data=[{
                "id": "invalid", "status": "abandoned", "test_id": test_id,
                "user_id": user, "answers": ["private answer"],
            }]), test_id=test_id, user_id=user)
    finally:
        obs._current.reset(token)
    monkeypatch.setattr(obs, "_emit", AsyncMock())
    asyncio.run(obs._emit_safely(current, None))
    messages = [record.getMessage() for record in caplog.records
                if "core_exam_abandonment_unverified" in record.getMessage()]
    assert messages == [f"core_exam_abandonment_unverified surface=reading_exam operation_id={current.operation_id}"]
    assert all(value not in caplog.text for value in (user, test_id, "private answer", "invalid"))


def test_empty_acknowledged_return_set_is_not_invented_as_abandonment_or_error(monkeypatch, caplog):
    current = obs._Observation("reading_exam", "start", admitted=True)
    token = obs._current.set(current)
    try:
        obs.note_abandoned_exam_attempts(SimpleNamespace(data=[]), test_id=str(uuid4()), user_id=str(uuid4()))
    finally:
        obs._current.reset(token)
    assert current.abandoned_exams == {} and not current.abandoned_exams_incomplete
    monkeypatch.setattr(obs, "_emit", AsyncMock())
    asyncio.run(obs._emit_safely(current, None))
    assert "core_exam_abandonment_unverified" not in caplog.text


def test_inner_timeout_error_is_not_mislabeled_as_shared_deadline_expiry(monkeypatch, caplog):
    current = obs._Observation("reading_exam", "start", admitted=True)
    monkeypatch.setattr(obs, "_emit", AsyncMock(side_effect=TimeoutError("private transport failure")))
    asyncio.run(obs._emit_safely(current, None))
    messages = [record.getMessage() for record in caplog.records
                if "core_attempt_observation_unavailable" in record.getMessage()]
    assert messages == ["core_attempt_observation_unavailable surface=reading_exam operation=start component=boundary"]
    assert "private transport failure" not in caplog.text
