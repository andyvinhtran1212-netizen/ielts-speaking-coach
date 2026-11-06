"""CLASSARCHIVE-0030 FR-004 — the Listening submit grades the answers it finalizes.

The archive gate in ``submit_listening_test_attempt`` awaits a worker thread,
so an answer PATCH (``fn_upsert_listening_answer``) can commit while it runs.
The submit grades a snapshot read after that await and both finalize UPDATEs
(graded and report_only) carry an ``answers`` CAS: a save that lands after the
snapshot fails the CAS and the submit 409s instead of finalizing a grade that
leaves a saved answer out.

Two requests share one event loop, as in one uvicorn worker. Every read hands
back a deep copy, so a request only sees a write by reading again.
"""

from __future__ import annotations

import asyncio
import copy
import json
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import listening
from services import class_archive_service as archive
from services import mock_correction_service, mock_paper_policy

ACTIVE = {"id": "c1", "is_active": True, "archived_at": None}
GRADED_ROWS = [{"payload": {"template_kind": "gap_fill", "answers": [
    {"q_num": 1, "answer": "alpha"}, {"q_num": 2, "answer": "beta"}]}}]
REPORT_ROWS = [{"payload": {
    "variant": "programme_form_v1",
    "questions": [{"q_num": 1, "response_type": "single_choice"},
                  {"q_num": 2, "response_type": "single_choice"}],
    "answers": [{"q_num": 1, "answers": ["alpha"]}, {"q_num": 2, "answers": ["beta"]}],
}}]
CONFLICT = "Attempt đã thay đổi; hãy tải lại trạng thái."


class _Query:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters: list = []
        self.payload = None

    def select(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def update(self, payload): self.payload = payload; return self
    def eq(self, field, value): self.filters.append(("eq", field, value)); return self
    def gt(self, field, value): self.filters.append(("gt", field, value)); return self

    def _holds(self, row):
        for op, field, value in self.filters:
            have = row.get(field)
            if op == "gt":
                if not (have is not None and str(have) > str(value)):
                    return False
            elif isinstance(have, (list, dict)):
                # PostgREST eq on jsonb compares the parsed JSON text.
                if have != json.loads(value):
                    return False
            elif str(have) != str(value):
                return False
        return True

    def execute(self):
        rows = self.db.tables[self.name]
        matched = [r for r in rows if self._holds(r)]
        if self.payload is not None:
            for row in matched:
                row.update(copy.deepcopy(self.payload))
            self.db.finalize_calls.append(copy.deepcopy(self.filters))
        return SimpleNamespace(data=copy.deepcopy(matched))


class _DB:
    def __init__(self, attempt):
        self.tables = {
            "listening_test_attempts": [copy.deepcopy(attempt)],
            "cohorts": [dict(ACTIVE)],
            "class_assignment_items": [{"id": "item-1", "assignment_id": "a1"}],
            "class_assignments": [{"id": "a1", "cohort_id": "c1"}],
        }
        self.finalize_calls: list = []

    @property
    def row(self):
        return self.tables["listening_test_attempts"][0]

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        """fn_upsert_listening_answer (mig 224): replace by q_num, in_progress only."""
        assert name == "fn_upsert_listening_answer"
        row = self.row
        if row["status"] != "in_progress":
            return SimpleNamespace(execute=lambda: SimpleNamespace(data=None))
        kept = [a for a in row["answers"] if a["q_num"] != params["p_q_num"]]
        kept.append({"q_num": params["p_q_num"], "user_answer": params["p_user_answer"],
                     "answered_at": "2026-11-03T00:00:01+00:00"})
        row["answers"] = sorted(kept, key=lambda a: a["q_num"])
        count = len(row["answers"])
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=count))


def _attempt(policy):
    return {"id": "att-1", "user_id": "u1", "test_id": "t1", "status": "in_progress",
            "scoring_policy": policy, "sitting_id": None,
            "class_assignment_item_id": "item-1",
            "started_at": "2026-11-03T00:00:00+00:00",
            "resume_expires_at": "2999-01-01T00:00:00+00:00",
            "answers": [{"q_num": 1, "user_answer": "alpha",
                         "answered_at": "2026-11-03T00:00:00+00:00"}]}


def _wire(monkeypatch, db, policy):
    monkeypatch.setattr(listening, "supabase_admin", db)
    monkeypatch.setattr(listening, "_require_auth", AsyncMock(return_value={"id": "u1"}))
    monkeypatch.setattr(listening, "_fetch_attempt_or_404",
                        lambda *_a: copy.deepcopy(db.row))
    monkeypatch.setattr(listening, "bind_owned_attempt", lambda _a: None)
    monkeypatch.setattr(listening, "require_resume_active", lambda _a: None)
    monkeypatch.setattr(listening, "_mock_sealed", lambda _a: False)
    monkeypatch.setattr(listening, "_attempt_test_type", lambda _a: "full")
    monkeypatch.setattr(listening, "_source_required_for_test", lambda _t: False)
    monkeypatch.setattr(listening, "note_persisted_exam_result", lambda *_a, **_k: None)
    rows = REPORT_ROWS if policy == "report_only" else GRADED_ROWS
    monkeypatch.setattr(mock_paper_policy, "guard_owned_attempt", lambda *_a, **_k: None)
    monkeypatch.setattr(mock_paper_policy, "load_marking_snapshot",
                        lambda *_a, **_k: {"marking_rows": copy.deepcopy(rows)})
    monkeypatch.setattr(mock_paper_policy, "frozen_answer_key", lambda *_a, **_k: None)
    monkeypatch.setattr(mock_correction_service, "apply_scoring_overrides",
                        lambda _s, _t, key: key)
    monkeypatch.setattr(mock_correction_service, "finalize_item_observations",
                        lambda *_a, **_k: None)
    monkeypatch.setattr(mock_correction_service, "capture_required_envelope",
                        lambda *_a, **_k: None)
    monkeypatch.setattr(mock_correction_service, "record_answer_commit",
                        lambda *_a, **_k: False)


def _park_first_gate(monkeypatch):
    """Park the first archive-gate call (the submit's) until released."""
    real = archive.require_class_attempt_accepts_work
    parked, release, calls = threading.Event(), threading.Event(), []

    def gate(db, attempt, *, surface):
        real(db, attempt, surface=surface)
        calls.append(surface)
        if len(calls) == 1:
            parked.set()
            assert release.wait(10), "submit was never released"
    monkeypatch.setattr(listening, "require_class_attempt_accepts_work", gate)
    return parked, release


async def _submit_with_save_during_gate(parked, release):
    submit = asyncio.create_task(
        listening.submit_listening_test_attempt("att-1", authorization="Bearer x"))
    assert await asyncio.to_thread(parked.wait, 10), "submit never reached the gate"
    saved = await listening.patch_listening_test_attempt_answer(
        "att-1", listening.TestAttemptAnswerPatchRequest(q_num=2, user_answer="beta"),
        authorization="Bearer x")
    release.set()
    return saved, await asyncio.wait_for(submit, 10)


def test_an_answer_saved_during_the_gate_counts_in_the_graded_result(monkeypatch):
    db = _DB(_attempt("diagnostic"))
    _wire(monkeypatch, db, "diagnostic")
    parked, release = _park_first_gate(monkeypatch)

    saved, result = asyncio.run(_submit_with_save_during_gate(parked, release))

    assert saved["answer_count"] == 2
    assert result["score"] == 2
    by_q = {q["q_num"]: q for q in result["per_question"]}
    assert by_q[2]["user_answer"] == "beta" and by_q[2]["correct"] is True
    row = db.row
    assert (row["status"], row["score"]) == ("submitted", 2)
    assert {q["q_num"]: q["user_answer"] for q in row["grading_details"]}[2] == "beta"


def test_an_answer_saved_during_the_gate_counts_in_the_report_only_result(monkeypatch):
    db = _DB(_attempt("report_only"))
    _wire(monkeypatch, db, "report_only")
    parked, release = _park_first_gate(monkeypatch)

    saved, result = asyncio.run(_submit_with_save_during_gate(parked, release))

    assert saved["answer_count"] == 2
    assert (result["status"], result["correct_count"], result["blank_count"]) == ("submitted", 2, 0)
    by_q = {q["q_num"]: q for q in result["per_question"]}
    assert by_q[2]["user_answer"] == "beta" and by_q[2]["correct"] is True
    row = db.row
    assert row["status"] == "submitted"
    assert row["result_summary"]["correct_count"] == 2
    assert {q["q_num"]: q["user_answer"] for q in row["grading_details"]}[2] == "beta"


@pytest.mark.parametrize("policy", ["diagnostic", "report_only"])
def test_a_save_landing_after_the_snapshot_fails_the_finalize_cas(monkeypatch, policy):
    """Another worker's save between the post-gate read and the UPDATE: the
    answers CAS misses, the submit 409s and the attempt stays open with the
    saved answer instead of being finalized on a grade that omits it."""
    db = _DB(_attempt(policy))
    _wire(monkeypatch, db, policy)
    rows = REPORT_ROWS if policy == "report_only" else GRADED_ROWS

    def marking_with_concurrent_save(*_a, **_k):
        db.rpc("fn_upsert_listening_answer", {
            "p_attempt_id": "att-1", "p_q_num": 2, "p_user_answer": "beta"}).execute()
        return {"marking_rows": copy.deepcopy(rows)}
    monkeypatch.setattr(mock_paper_policy, "load_marking_snapshot", marking_with_concurrent_save)

    with pytest.raises(HTTPException) as caught:
        asyncio.run(listening.submit_listening_test_attempt("att-1", authorization="Bearer x"))

    assert (caught.value.status_code, caught.value.detail) == (409, CONFLICT)
    row = db.row
    assert row["status"] == "in_progress" and row.get("grading_details") is None
    assert [a["q_num"] for a in row["answers"]] == [1, 2]
    assert len(db.finalize_calls) == 1
    assert ("eq", "status", "in_progress") in db.finalize_calls[0]
    assert any(op == "gt" and field == "resume_expires_at"
               for op, field, _v in db.finalize_calls[0])


@pytest.mark.parametrize("policy", ["diagnostic", "report_only"])
def test_a_concurrent_submit_that_won_during_the_gate_gets_409_not_a_second_grade(
        monkeypatch, policy):
    db = _DB(_attempt(policy))
    _wire(monkeypatch, db, policy)
    parked, release = _park_first_gate(monkeypatch)

    async def run():
        submit = asyncio.create_task(
            listening.submit_listening_test_attempt("att-1", authorization="Bearer x"))
        assert await asyncio.to_thread(parked.wait, 10)
        db.row.update({"status": "submitted", "score": 7})   # the other submit committed
        release.set()
        return await asyncio.wait_for(submit, 10)

    with pytest.raises(HTTPException) as caught:
        asyncio.run(run())
    assert (caught.value.status_code, caught.value.detail) == (409, CONFLICT)
    assert db.finalize_calls == []
    assert db.row["score"] == 7
