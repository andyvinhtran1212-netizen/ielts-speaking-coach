"""Actual Dictation start/resume paths; no copied route logic or live services."""

import asyncio
import copy
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

import test_listening_test_dictation as fixtures
from routers import listening
from services import core_attempt_observation as obs
from services.core_attempt_evidence import EvidenceEvent, ReceiptStatus


def setup(monkeypatch, *, enabled=True, scenario="normal"):
    user = str(uuid4())
    db, auth = fixtures._patch(monkeypatch, user_id=user)
    test = fixtures._seed_test(db)
    fixtures._seed_section(db, test["id"], 1, "Fresh section content.")
    now = datetime.now(timezone.utc)
    old = {
        "id": str(uuid4()), "user_id": user, "test_id": test["id"], "section_num": 1,
        "status": "in_progress", "renderer_affinity": "next",
        "started_at": (now - timedelta(days=2)).isoformat(),
        "created_at": (now - timedelta(days=2)).isoformat(),
        "resume_expires_at": (now - timedelta(days=1)).isoformat(),
        "units_snapshot": [{"text": "Private old section."}],
    }
    others = [dict(old, id=str(uuid4()), **changes) for changes in (
        {"user_id": str(uuid4())}, {"test_id": str(uuid4())}, {"section_num": 2},
    )]
    db.tables["dictation_attempts"] = [old, *others]
    db.tables["dictation_attempt_answers"] = [{"attempt_id": old["id"], "sentence_idx": 0,
                                               "user_transcript": "Private learner answer."}]
    answers_before = copy.deepcopy(db.tables["dictation_attempt_answers"])
    others_before = copy.deepcopy(others)
    if scenario == "active":
        old["resume_expires_at"] = (now + timedelta(hours=1)).isoformat()
    if scenario == "missing_expiry":
        old["resume_expires_at"] = None
    if scenario == "content_failure":
        db.tables["listening_content"] = []
    winner = dict(old, id=str(uuid4()), created_at=now.isoformat(),
                  resume_expires_at=(now + timedelta(days=1)).isoformat())
    events, calls, receipt_states, incomplete_at_receipt = [], [], [], []
    monkeypatch.setattr(obs.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", enabled)

    async def record(**fields):
        events.append(EvidenceEvent(**fields))
        receipt_states.append(old["status"])
        incomplete_at_receipt.append(obs._current.get().abandoned_exams_incomplete)
        return ReceiptStatus.RECORDED
    monkeypatch.setattr(obs, "try_record_event", record)
    execute = fixtures._Q.execute

    def intercepted(query):
        calls.append((query.name, query._mode))
        if query.name == "dictation_attempts":
            if query._mode == "update":
                if scenario == "update_failure":
                    raise RuntimeError("synthetic update failure")
                if scenario == "update_ack_lost":
                    execute(query)
                    raise RuntimeError("synthetic update acknowledgement lost")
                if scenario == "update_race":
                    old["status"] = "completed"
            if query._mode == "insert":
                if scenario == "insert_failure":
                    raise RuntimeError("synthetic insert failure")
                if scenario in {"duplicate_recovered", "duplicate_missing"}:
                    if scenario == "duplicate_recovered":
                        db.tables["dictation_attempts"].append(winner)
                    raise RuntimeError("23505 synthetic conflict")
        result = execute(query)
        # Match PostgREST JSON snapshots, not references to mutable fake rows.
        return SimpleNamespace(data=copy.deepcopy(result.data), count=result.count)

    monkeypatch.setattr(fixtures._Q, "execute", intercepted)
    invoke = lambda: listening.start_dictation_attempt(test["id"], section_num=1, authorization=auth)
    return SimpleNamespace(db=db, user=user, test=test, auth=auth, old=old, winner=winner,
                           events=events, calls=calls, receipt_states=receipt_states,
                           incomplete_at_receipt=incomplete_at_receipt,
                           others=others, others_before=others_before,
                           answers_before=answers_before, invoke=invoke)


@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize("scenario", ["normal", "missing_expiry", "content_failure", "insert_failure",
                                      "duplicate_recovered", "duplicate_missing"])
def test_actual_retirement_is_observed_even_when_new_creation_fails(monkeypatch, enabled, scenario):
    world = setup(monkeypatch, enabled=enabled, scenario=scenario)
    status = {"content_failure": 404, "insert_failure": 500, "duplicate_missing": 409}.get(scenario)
    reply = None
    if status:
        with pytest.raises(HTTPException) as error:
            asyncio.run(world.invoke())
        assert error.value.status_code == status
    else:
        reply = asyncio.run(world.invoke())
        assert reply["created"] is (scenario != "duplicate_recovered")
        assert reply["attempt_id"] != world.old["id"]
        if scenario == "duplicate_recovered":
            assert reply["attempt_id"] == world.winner["id"]
    assert world.old["status"] == "abandoned"
    assert world.db.tables["dictation_attempt_answers"] == world.answers_before
    assert world.others == world.others_before
    if not enabled:
        assert world.events == []
        return
    assert len(world.events) == 2
    abandoned = next(event for event in world.events if event.outcome == "abandoned")
    new = next(event for event in world.events if event is not abandoned)
    assert abandoned.surface == "listening_dictation" and abandoned.attempt_kind == "default"
    assert abandoned.canonical_attempt_id == UUID(world.old["id"])
    assert not abandoned.start_observed and abandoned.renderer == "next"
    assert abandoned.traffic_class == "unknown" and abandoned.release_id is None
    assert abandoned.operation_id == new.operation_id
    assert new.canonical_attempt_id == (UUID(reply["attempt_id"]) if reply else None)
    assert new.event_kind == ("operation_failed" if status else "operation_succeeded" if scenario == "duplicate_recovered" else "started")
    assert world.receipt_states == ["abandoned", "abandoned"]
    assert world.incomplete_at_receipt == [False, False]
    metadata = str([asdict(event) for event in world.events])
    for private in (world.user, world.test["id"], "Private old section.", "Private learner answer."):
        assert private not in metadata


@pytest.mark.parametrize("scenario", ["active", "update_race", "update_failure", "update_ack_lost"])
def test_no_abandonment_is_inferred_from_a_preread(monkeypatch, caplog, scenario):
    world = setup(monkeypatch, scenario=scenario)
    if scenario in {"update_failure", "update_ack_lost"}:
        with pytest.raises(RuntimeError, match="synthetic update"):
            asyncio.run(world.invoke())
    else:
        reply = asyncio.run(world.invoke())
        assert reply["created"] is (scenario != "active")
    assert len(world.events) == 1 and world.events[0].outcome is None
    assert world.old["status"] == ("completed" if scenario == "update_race" else "abandoned" if scenario == "update_ack_lost" else "in_progress")
    gap = scenario in {"update_failure", "update_ack_lost"}
    assert world.incomplete_at_receipt == [gap]
    assert ("core_exam_abandonment_unverified" in caplog.text) is gap
    if scenario in {"active", "update_failure", "update_ack_lost"}:
        assert ("dictation_attempts", "insert") not in world.calls
    if scenario == "active":
        assert ("dictation_attempts", "update") not in world.calls
        assert world.events[0].event_kind == "operation_succeeded"
        assert world.events[0].canonical_attempt_id == UUID(world.old["id"])


def test_expired_get_remains_read_only_and_does_not_fabricate_abandonment(monkeypatch):
    world = setup(monkeypatch)
    reply = asyncio.run(listening.get_in_progress_dictation_attempt(
        world.test["id"], section_num=1, authorization=world.auth))
    assert reply == {"attempt": None}
    assert world.old["status"] == "in_progress" and world.events == []
    assert all(mode == "select" for _, mode in world.calls)


@pytest.mark.parametrize("denial", ["auth", "unpublished"])
def test_denied_dictation_start_cannot_retire_or_observe_old_work(monkeypatch, denial):
    world = setup(monkeypatch)
    if denial == "auth":
        monkeypatch.setattr(listening, "_require_auth", AsyncMock(side_effect=HTTPException(401)))
    else:
        world.test["status"] = "draft"
    with pytest.raises(HTTPException):
        asyncio.run(world.invoke())
    assert world.events == [] and world.old["status"] == "in_progress"
    assert all(mode == "select" for _, mode in world.calls)


@pytest.mark.parametrize("invalid", ["id", "owner", "test", "section", "bool_section", "status", "renderer", "missing", "duplicate"])
def test_returned_dictation_parent_must_match_the_exact_owned_section(invalid):
    attempt, user, test = str(uuid4()), str(uuid4()), str(uuid4())
    row = {"id": attempt, "user_id": user, "test_id": test, "section_num": 1, "status": "abandoned"}
    if invalid == "id": row["id"] = str(uuid4())
    if invalid == "owner": row["user_id"] = str(uuid4())
    if invalid == "test": row["test_id"] = str(uuid4())
    if invalid == "section": row["section_num"] = 2
    if invalid == "bool_section": row["section_num"] = True
    if invalid == "status": row["status"] = "in_progress"
    if invalid == "renderer": row["renderer_affinity"] = "browser-claim"
    rows = None if invalid == "missing" else [row, row] if invalid == "duplicate" else [row]
    current = obs._Observation("listening_dictation", "start", admitted=True)
    token = obs._current.set(current)
    try:
        obs.note_abandoned_dictation_attempt(SimpleNamespace(data=rows), attempt_id=attempt,
                                            test_id=test, user_id=user, section_num=1)
        assert current.abandoned_exams == {} and current.abandoned_exams_incomplete
    finally:
        obs._current.reset(token)


def test_repeated_acknowledgements_deduplicate_and_bad_return_cannot_erase_old_id():
    attempt, user, test = str(uuid4()), str(uuid4()), str(uuid4())
    row = {"id": attempt, "user_id": user, "test_id": test, "section_num": 1,
           "status": "abandoned", "renderer_affinity": "legacy", "units_snapshot": [{"text": "private"}]}
    current = obs._Observation("listening_dictation", "start", admitted=True)
    token = obs._current.set(current)
    try:
        for rows in ([row], [row], None, []):
            obs.note_abandoned_dictation_attempt(SimpleNamespace(data=rows), attempt_id=attempt,
                                                test_id=test, user_id=user, section_num=1)
        assert current.abandoned_exams == {UUID(attempt): "legacy"}
        assert current.abandoned_exams_incomplete and current.attempt_id is None
        metadata = str(asdict(current))
        assert all(value not in metadata for value in (user, test, "private"))
    finally:
        obs._current.reset(token)


@pytest.mark.parametrize("context", [None, ("reading_exam", "start", True),
                                    ("listening_dictation", "save", True),
                                    ("listening_dictation", "start", False)])
def test_note_outside_admitted_dictation_start_does_not_inspect_response(context):
    class Unreadable:
        @property
        def data(self): raise AssertionError("response must not be inspected")
    current = obs._Observation(context[0], context[1], admitted=context[2]) if context else None
    token = obs._current.set(current)
    try:
        obs.note_abandoned_dictation_attempt(Unreadable(), attempt_id="unused", test_id="unused",
                                            user_id="unused", section_num=1)
    finally:
        obs._current.reset(token)


def test_configured_sync_update_requests_representation_without_executing():
    from database import supabase_admin
    query = supabase_admin.table("dictation_attempts").update({"status": "abandoned"}).eq("id", str(uuid4()))
    assert "return=representation" in query.request.headers["Prefer"].split(",")


@pytest.mark.parametrize("invalid", ["attempt_id", "test_id", "user_id", "section_bool", "section_zero", "section_negative", "dict", "str"])
def test_invalid_scope_or_response_type_remains_an_explicit_gap(invalid):
    args = dict(attempt_id=str(uuid4()), test_id=str(uuid4()), user_id=str(uuid4()), section_num=1)
    if invalid in {"attempt_id", "test_id", "user_id"}: args[invalid] = "not-a-uuid"
    if invalid == "section_bool": args["section_num"] = True
    if invalid == "section_zero": args["section_num"] = 0
    if invalid == "section_negative": args["section_num"] = -1
    rows = {} if invalid == "dict" else "not-a-list" if invalid == "str" else []
    current = obs._Observation("listening_dictation", "start", admitted=True)
    token = obs._current.set(current)
    try:
        obs.note_abandoned_dictation_attempt(SimpleNamespace(data=rows), **args)
        assert current.abandoned_exams == {} and current.abandoned_exams_incomplete
    finally:
        obs._current.reset(token)


def test_failed_old_receipt_does_not_break_new_attempt_or_claim_receipt_success(monkeypatch):
    world = setup(monkeypatch)
    attempted, saved = [], []
    async def record(**fields):
        event = EvidenceEvent(**fields)
        attempted.append(event)
        if event.outcome == "abandoned":
            return ReceiptStatus.UNAVAILABLE
        saved.append(event)
        return ReceiptStatus.RECORDED
    monkeypatch.setattr(obs, "try_record_event", record)
    reply = asyncio.run(world.invoke())
    assert reply["created"] is True and world.old["status"] == "abandoned"
    assert len(attempted) == 2 and len(saved) == 1
    assert saved[0].event_kind == "started" and saved[0].canonical_attempt_id == UUID(reply["attempt_id"])
