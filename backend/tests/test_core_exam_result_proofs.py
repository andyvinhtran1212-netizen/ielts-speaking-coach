"""Failure-isolated private proof writer and real request observer integration."""

import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from services import core_exam_result_proofs as proofs, core_attempt_observation as obs
from services.core_operation_correlation import operation_hint_scope
from services.core_attempt_evidence import ReceiptStatus
from test_migration_243_core_exam_proofs import metadata


class DB:
    def __init__(self, mode="ok"):
        self.calls, self.mode = [], mode

    def rpc(self, name, payload):
        assert name == "fn_record_core_exam_result_proof"
        self.calls.append(payload)
        return self

    async def execute(self):
        if self.mode == "error":
            raise RuntimeError("private answer / secret")
        if self.mode == "timeout":
            await asyncio.Event().wait()
        if self.mode == "cancel":
            raise asyncio.CancelledError()
        return SimpleNamespace(data="a" * 64 if self.mode == "ok" else {"not": "a receipt"})


@pytest.fixture
def wire(monkeypatch):
    def setup(mode="ok", enabled=True):
        db = DB(mode)
        monkeypatch.setattr(proofs.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", enabled)
        monkeypatch.setattr(proofs, "get_supabase_async", AsyncMock(return_value=db))
        monkeypatch.setattr(proofs, "PROOF_BUDGET_SECONDS", 0.02)
        monkeypatch.setattr(obs, "try_record_event", AsyncMock(return_value=ReceiptStatus.RECORDED))
        monkeypatch.setattr(obs, "record_operation_correlation", AsyncMock(return_value=ReceiptStatus.RECORDED))
        return db
    return setup


@pytest.mark.parametrize("mode,expected", [("ok", "recorded"), ("error", "unavailable"), ("timeout", "unavailable"), ("bad_receipt", "unavailable")])
def test_writer_status_deadline_and_no_raw_error(wire, caplog, mode, expected):
    db = wire(mode)
    outcome = asyncio.run(proofs.record_exam_result_proof("reading_exam", uuid4(), metadata(), [1, 2]))
    assert outcome.value == expected and len(db.calls) == 1
    assert "secret" not in caplog.text and "private answer" not in caplog.text


def test_disabled_does_not_validate_or_query(wire):
    db = wire(enabled=False)
    assert asyncio.run(proofs.record_exam_result_proof("invalid", None, None, [])) == ReceiptStatus.DISABLED
    assert db.calls == []


@pytest.mark.parametrize("patch,expected", [
    ({"answer": "private"}, [1, 2]), ({"score": True}, [1, 2]), ({"score": float("nan")}, [1, 2]),
    ({"grading_details": [{"q_num": 1, "correct": True, "user_answer": "private"}]}, [1]),
    ({"submitted_at": "2026-09-10T01:00:00"}, [1, 2]), ({}, [True, 2]), ({}, [1]), ({}, [1, 2, 2]),
])
def test_invalid_payload_rejected_before_network(wire, patch, expected):
    db = wire()
    assert asyncio.run(proofs.record_exam_result_proof("reading_exam", uuid4(), metadata() | patch, expected)) == ReceiptStatus.INVALID
    assert db.calls == []


def test_proof_cancellation_propagates(wire):
    wire("cancel")
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(proofs.record_exam_result_proof("reading_exam", uuid4(), metadata(), [1, 2]))


@pytest.mark.parametrize("code,expected", [("22023", ReceiptStatus.INVALID), ("PGRST202", ReceiptStatus.UNAVAILABLE)])
def test_structured_rejection_is_not_a_retryable_transport_failure(wire, code, expected, caplog):
    db = wire()
    error = RuntimeError("private input must stay out of logs")
    error.code = code
    db.execute = AsyncMock(side_effect=error)
    assert asyncio.run(proofs.record_exam_result_proof("reading_exam", uuid4(), metadata(), [1, 2])) == expected
    assert "private input" not in caplog.text


@pytest.mark.parametrize("surface", ["reading_exam", "listening_test"])
@pytest.mark.parametrize("mode", ["ok", "error", "timeout", "bad_receipt"])
def test_request_preserves_sealed_response_and_only_sends_stripped_returning_metadata(wire, surface, mode):
    db = wire(mode)
    attempt = {"id": str(uuid4()), "renderer_affinity": "next", "status": "in_progress"}
    saved = metadata() | {"id": attempt["id"], "user_id": "private learner"}
    saved["grading_details"][0].update(user_answer="private answer", expected="private key", explanation="private explanation")
    @obs.observe_operation(surface, "submit")
    async def endpoint():
        obs.bind_owned_attempt(attempt)
        obs.note_persisted_exam_result(saved, expected_questions=[{"q_num": 1, "answer": "private key"}, {"q_num": 2}])
        return {"sealed": True, "received": True}
    assert asyncio.run(endpoint()) == {"sealed": True, "received": True}
    assert len(db.calls) == 1
    assert db.calls[0]["p_metadata"] == metadata()
    assert db.calls[0]["p_canonical_attempt_id"] == attempt["id"]
    assert "private" not in json.dumps(db.calls)
    assert obs._current.get() is None


def test_invalid_second_note_cannot_reuse_prior_valid_witness(wire):
    db = wire()
    attempt = {"id": str(uuid4()), "renderer_affinity": "next"}
    @obs.observe_operation("reading_exam", "submit")
    async def endpoint():
        obs.bind_owned_attempt(attempt)
        obs.note_persisted_exam_result(metadata() | attempt, expected_questions=[{"q_num": 1}, {"q_num": 2}])
        obs.note_persisted_exam_result({}, expected_questions=[])
    asyncio.run(endpoint())
    assert db.calls == []


@pytest.mark.parametrize("error", ["soft", "hard"])
def test_error_after_saved_note_does_not_fabricate_normal_completion(wire, error):
    db = wire()
    attempt = {"id": str(uuid4()), "renderer_affinity": "next"}
    @obs.observe_operation("reading_exam", "submit")
    async def endpoint():
        obs.bind_owned_attempt(attempt)
        obs.note_persisted_exam_result(metadata() | attempt, expected_questions=[{"q_num": 1}, {"q_num": 2}])
        if error == "hard":
            raise RuntimeError("existing failure")
        obs.note_operation_failure()
    if error == "hard":
        with pytest.raises(RuntimeError, match="existing failure"):
            asyncio.run(endpoint())
    else:
        asyncio.run(endpoint())
    assert db.calls == []


@pytest.mark.parametrize("surface", ["reading_exam", "listening_test"])
@pytest.mark.parametrize("sealed", [False, True])
@pytest.mark.parametrize("mode", ["ok", "error", "disabled", "before_write", "lost_ack", "foreign_owner"])
def test_actual_submit_routes_prove_only_acknowledged_persisted_results(monkeypatch, wire, surface, sealed, mode):
    from routers import reading_student, listening
    from services import mock_exam_service
    from test_student_listening_full_test import _Fake, _Q, _seed_test, _seed_sections_with_exercises
    fake = _Fake()
    attempt, owner, test_id = str(uuid4()), str(uuid4()), str(uuid4())
    now = datetime.now(timezone.utc)
    table = "reading_test_attempts" if surface == "reading_exam" else "listening_test_attempts"
    source = {"id": attempt, "user_id": str(uuid4()) if mode == "foreign_owner" else owner,
              "test_id": test_id, "status": "in_progress", "renderer_affinity": "next",
              "started_at": now.isoformat(), "resume_expires_at": (now + timedelta(hours=1)).isoformat(),
              "sitting_id": "sealed-fixture" if sealed else None, "answers": [{"q_num": 1, "user_answer": "answer-1"}]}
    if surface == "reading_exam":
        fake.tables["reading_test_attempts"] = [source]
        fake.tables["reading_tests"] = [{"id": test_id, "time_limit_minutes": 60, "module": "academic"}]
        fake.tables["reading_passages"] = [{"id": "p1", "test_id": test_id, "library": "l3_test", "passage_order": 1}]
        fake.tables["reading_questions"] = [{"passage_id": "p1", "q_num": n, "question_type": "short_answer", "answer": {"answer": f"answer-{n}"}} for n in (1, 2)]
        fake.tables["reading_attempt_answers"] = []
        monkeypatch.setattr(reading_student, "supabase_admin", fake)
        monkeypatch.setattr(reading_student, "_optional_auth", AsyncMock(return_value={"id": owner}))
        monkeypatch.setattr(mock_exam_service, "is_sealed", lambda *_: sealed)
    else:
        test = _seed_test(fake, id=test_id)
        _seed_sections_with_exercises(fake, test["id"])
        fake.tables["listening_test_attempts"].append(source)
        monkeypatch.setattr(listening, "supabase_admin", fake)
        monkeypatch.setattr(listening, "_require_auth", AsyncMock(return_value={"id": owner}))
        monkeypatch.setattr(listening, "_mock_sealed", lambda *_: sealed)
    committed = []
    class Q(_Q):
        def execute(self):
            if self.name == table and self._mode == "update" and mode == "before_write":
                raise RuntimeError("injected before write")
            result = super().execute()
            if self.name == table and self._mode == "update":
                committed.extend(result.data)
                if mode == "lost_ack":
                    raise RuntimeError("injected lost acknowledgement")
            return result
    fake.table = lambda name: Q(fake, name)
    db = wire("error" if mode == "error" else "ok", enabled=mode != "disabled")
    original_execute = db.execute
    proof_source_snapshots = []
    async def execute_proof():
        proof_source_snapshots.append([(row.get("status"), row.get("score")) for row in committed])
        return await original_execute()
    db.execute = execute_proof
    async def run():
        with operation_hint_scope([str(uuid4())]):
            if surface == "reading_exam":
                return await reading_student.submit_reading_test_attempt(attempt, reading_student._SubmitRequest(answers=source["answers"]), authorization="Bearer fixture")
            return await listening.submit_listening_test_attempt(attempt, authorization="Bearer fixture")
    if mode in {"before_write", "lost_ack"}:
        with pytest.raises(RuntimeError, match="injected"):
            asyncio.run(run())
    elif mode == "foreign_owner":
        with pytest.raises(HTTPException) as error:
            asyncio.run(run())
        assert error.value.status_code == 403
    else:
        result = asyncio.run(run())
        assert len(committed) == 1 and committed[0]["score"] == 1
        if sealed:
            assert result == {"received": True, "sitting_id": "sealed-fixture", "sealed": True}
        else:
            assert result["score"] == 1 and "core_evidence" not in json.dumps(result)
    assert len(db.calls) == (1 if mode in {"ok", "error"} else 0)
    assert obs.record_operation_correlation.await_count == (0 if mode in {"disabled", "foreign_owner"} else 1)
    if db.calls:
        # Assert outside the fail-open writer, so an AssertionError cannot be
        # swallowed and accidentally make a broken ordering test pass.
        assert proof_source_snapshots == [[("submitted", 1)]]
        assert db.calls[0]["p_metadata"]["score"] == 1
        assert db.calls[0]["p_expected_qnums"] == list(range(1, 3 if surface == "reading_exam" else 41))
        assert "user_answer" not in json.dumps(db.calls) and "answer-1" not in json.dumps(db.calls)
    if mode == "lost_ack":
        assert len(committed) == 1 and committed[0]["status"] == "submitted"
    elif mode in {"foreign_owner", "before_write"}:
        assert committed == []
