"""COURSEACCESS-0055 G04-T08 (plan 5.6 Writing): credits and ai_instant.

Two layers, both with fakes (no network, no AI):

* ``submit_my_assignment`` (class work): the SAGA submit of
  test_writing_student_saga with a fake credit RPC. A refused hold leaves no
  essay waiting to be graded and keeps the draft (FR-019, FR-020).
* ``_bg_grade_essay`` / ``_mark_failed`` / requeue: commit after a grade,
  deliver an ``ai_instant`` essay, return the credit once on a terminal
  failure and never on a requeue (FR-021).

The flag stays the gate everywhere: off → no credit RPC (FR-018).
"""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import writing_student as ws_module  # noqa: E402
from routers.writing_student import SubmitEssay, submit_my_assignment  # noqa: E402
from services import credits, essay_service, runtime_flags  # noqa: E402
from test_essay_service import (  # noqa: E402
    _ESSAY_ID as BG_ESSAY_ID,
    _JOB_ID as BG_JOB_ID,
    _FakeSupabase,
    _bg_essay_responses,
    _valid_feedback_obj,
)
from test_writing_student_saga import (  # noqa: E402
    _ESSAY_ID,
    _LONG,
    _USER_ID,
    _Client,
    _patch_saga_service,
    _run,
    _student,
)

COURSE = "11111111-1111-1111-1111-111111111111"
COHORT = "22222222-2222-2222-2222-222222222222"


class _CohortClient(_Client):
    """The SAGA fake, with the assignment given by a class (cohort_id)."""

    def __init__(self, *a, cohort_id=COHORT, **kw):
        super().__init__(*a, **kw)
        self._cohort_id = cohort_id

    def _respond(self, rec):
        r = super()._respond(rec)
        if rec["table"] == "writing_assignments" and rec["action"] == "select" and r.data:
            r.data = [{**r.data[0], "cohort_id": self._cohort_id}]
        return r


class FakeRpc:
    """fn_credit_reserve / commit / release for one writing essay each."""

    def __init__(self, *, balance=5, fail=False, force=None):
        self.balance, self.fail, self.force = balance, fail, force
        self.calls: list[tuple[str, dict]] = []
        self.holds: dict[str, str] = {}      # reservation id → status

    def names(self, name):
        return [p for n, p in self.calls if n == name]

    async def rpc(self, name, params):
        self.calls.append((name, dict(params)))
        if self.fail:
            raise credits.CreditUnavailable(name)
        if name == "fn_credit_reserve":
            if self.force:
                return {"status": self.force, "balance": self.balance}
            if self.balance < params["p_cost"]:
                return {"status": "insufficient_credits", "balance": self.balance}
            self.balance -= params["p_cost"]
            rid = f"res-{len(self.holds)}"
            self.holds[rid] = "open"
            return {"status": "reserved", "reservation_id": rid, "balance_after": self.balance}
        if name == "fn_credit_release":
            if self.holds.get(params["p_reservation_id"]) == "open":
                self.holds[params["p_reservation_id"]] = "released"
                self.balance += 1
                return {"status": "released"}
            return {"status": "not_open"}
        raise AssertionError(name)


@pytest.fixture
def world(monkeypatch):
    w = SimpleNamespace(flag=True, flag_error=False, class_entitled=True, converted=False,
                        legacy=(), fake=FakeRpc(), events=[])

    def strict(key, default=False):
        assert key == "credit_metering"
        if w.flag_error:
            raise runtime_flags.FlagLookupError(key)
        return w.flag
    monkeypatch.setattr(credits, "_metering_last", None)
    monkeypatch.setattr(credits.runtime_flags, "is_enabled_strict", strict)
    monkeypatch.setattr(credits, "fetch_cohort_course", lambda _c: COURSE)
    monkeypatch.setattr(credits, "fetch_ever_had_class_entitlement", lambda _u, _c: w.class_entitled)
    monkeypatch.setattr(credits, "fetch_cohort_converted", lambda _c: w.converted)
    monkeypatch.setattr(credits, "fetch_legacy_code_features", lambda _u: w.legacy)

    async def rpc(name, params):
        w.events.append(name)
        return await w.fake.rpc(name, params)
    monkeypatch.setattr(credits, "_rpc", rpc)
    monkeypatch.setattr(ws_module, "_require_class_accepts_work", lambda _a: None)
    return w


def _submit(monkeypatch, world, *, cohort_id=COHORT, client=None, schedule_fails=False):
    client = client or _CohortClient(assignment_status="in_progress", cohort_id=cohort_id,
                                     drafts_data=[{"assignment_id": "assign-uuid-cccc",
                                                   "draft_text": _LONG, "paste_events": []}])
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    row_kwargs: list[dict] = []
    _patch_saga_service(
        monkeypatch,
        on_row_only=lambda kw: (row_kwargs.append(kw), world.events.append("essay_row")),
        on_schedule=lambda _kw: _schedule(world, schedule_fails),
    )
    bg = MagicMock()
    bg.add_task = MagicMock(side_effect=lambda *_a, **_k: world.events.append("bg_task"))
    out = SimpleNamespace(result=None, error=None, client=client, bg=bg, row_kwargs=row_kwargs)
    try:
        out.result = _run(submit_my_assignment(
            assignment_id="assign-uuid-cccc", body=SubmitEssay(essay_text=_LONG),
            background_tasks=bg, student=_student()))
    except HTTPException as exc:
        out.error = exc
    return out


def _schedule(world, fails):
    world.events.append("schedule_job")
    if fails:
        raise RuntimeError("queue down")


def _db(out, table, action):
    return [rec for _k, rec in out.client.calls if rec["table"] == table and rec["action"] == action]


def _claims(out):
    return [rec for rec in _db(out, "writing_assignments", "update") if rec.get("in")]


def test_job_scheduling_failure_keeps_the_hold_and_logs_it(monkeypatch, world, caplog):
    """CR+SA nit 1 on 9d69881a: SAGA 3 fails after the hold. The submission
    still succeeds (today's trade-off), the hold stays open for an admin
    re-queue or the expiry sweep, and the case is logged for reconciliation."""
    with caplog.at_level("WARNING"):
        out = _submit(monkeypatch, world, schedule_fails=True)
    assert out.error is None and out.result["status"] == "submitted"
    assert world.events == ["essay_row", "fn_credit_reserve", "schedule_job"]
    assert world.fake.holds == {"res-0": "open"}
    assert any("decision=hold_without_job" in r.getMessage() and _ESSAY_ID in r.getMessage()
               for r in caplog.records)


# ── Not metered: today's flow, no credit RPC (FR-018, FR-019) ───────────────

@pytest.mark.parametrize("case", ["flag_off", "legacy_class", "legacy_code_no_class"])
def test_unmetered_class_work_keeps_todays_flow(monkeypatch, world, case):
    cohort = COHORT
    if case == "flag_off":
        world.flag = False
    elif case == "legacy_class":
        world.class_entitled = False                 # class still runs on access codes
    else:
        cohort = None
        world.legacy = ("writing",)
    out = _submit(monkeypatch, world, cohort_id=cohort)
    assert out.error is None and out.result["status"] == "submitted"
    assert world.fake.calls == []
    assert world.events == ["essay_row", "schedule_job", "bg_task"]
    assert "review_mode" not in out.row_kwargs[0]


@pytest.mark.parametrize("legacy", [(), ("writing",)])
def test_individual_assignment_without_a_cohort_is_class_work(monkeypatch, world, legacy, caplog):
    """Andy 2026-11-23 11:52Z on #2593: an assignment given to one learner
    (no cohort_id) counts as class work. There is no class course to meter,
    so it is not metered, with or without a legacy Writing code, and never
    403 no_entitlement."""
    world.legacy = legacy
    with caplog.at_level("INFO"):
        out = _submit(monkeypatch, world, cohort_id=None)
    assert out.error is None and out.result["status"] == "submitted"
    assert world.fake.calls == []
    assert world.events == ["essay_row", "schedule_job", "bg_task"]
    assert any("class_work_unmapped" in r.getMessage() for r in caplog.records)
    assert credits.charge_plan(_USER_ID, "writing_grading", assignment={"cohort_id": None}).reason == "legacy_class"
    # A never-free feature still meters on any entitlement.
    assert credits.charge_plan(_USER_ID, "writing_grading", assignment={"cohort_id": None},
                               new_feature=True).reason == "entitlement"


# ── Class entitlement holder (FR-019, FR-020) ───────────────────────────────

def test_class_holder_reserves_on_the_class_course_before_claim_and_job(monkeypatch, world):
    out = _submit(monkeypatch, world)
    assert out.error is None and out.result["status"] == "submitted"
    (params,) = world.fake.names("fn_credit_reserve")
    assert params["p_feature"] == "writing_grading" and params["p_cost"] == 1
    assert params["p_resource_type"] == "writing_essay" and params["p_resource_id"] == _ESSAY_ID
    assert params["p_request_key"] == f"writing_essay:{_ESSAY_ID}"
    assert params["p_course_ids"] == [COURSE] and params["p_kinds"] == ["class", "repractice"]
    assert params["p_ttl_seconds"] == 86400
    assert params["p_user_id"] == _USER_ID
    # hold after the row, before the claim and the job; nothing settled yet
    assert world.events == ["essay_row", "fn_credit_reserve", "schedule_job", "bg_task"]
    assert len(_claims(out)) == 1
    assert world.fake.holds == {"res-0": "open"}
    # class work keeps its review flow: no review_mode on the essay
    assert "review_mode" not in out.row_kwargs[0]


@pytest.mark.parametrize("force, status, code, source", [
    ("insufficient_credits", 402, "insufficient_credits", "class"),
    ("no_entitlement", 403, "no_entitlement", "class"),
])
def test_refused_hold_leaves_no_essay_waiting_and_keeps_the_draft(monkeypatch, world, force, status, code, source):
    world.fake.force = force
    out = _submit(monkeypatch, world)
    assert out.error.status_code == status
    assert out.error.detail["error_code"] == code and out.error.detail["credit_source"] == source
    if code == "insufficient_credits":
        assert out.error.detail["balance"] == 5
    assert _db(out, "writing_essays", "delete"), "the speculative essay is removed"
    assert _claims(out) == [] and "schedule_job" not in world.events
    out.bg.add_task.assert_not_called()
    assert _db(out, "writing_drafts", "delete") == [], "the learner's draft is kept"


def test_rpc_error_is_503_and_leaves_nothing(monkeypatch, world):
    world.fake.fail = True
    out = _submit(monkeypatch, world)
    assert out.error.status_code == 503 and out.error.detail["error_code"] == "credits_unavailable"
    assert _db(out, "writing_essays", "delete") and _claims(out) == []
    out.bg.add_task.assert_not_called()


def test_flag_read_error_is_503_before_any_write(monkeypatch, world):
    world.flag_error = True
    out = _submit(monkeypatch, world)
    assert out.error.status_code == 503 and out.error.detail["error_code"] == "credits_unavailable"
    assert world.events == [] and world.fake.calls == []      # no essay row, no RPC
    assert _db(out, "writing_essays", "delete") == []


def test_lost_claim_race_returns_the_credit(monkeypatch, world):
    class _LosesClaim(_CohortClient):
        def _respond(self, rec):
            if rec["table"] == "writing_assignments" and rec["action"] == "update" and rec.get("in"):
                self._assignment_status = "submitted"        # another tab won
            return super()._respond(rec)
    out = _submit(monkeypatch, world, client=_LosesClaim(assignment_status="in_progress"))
    assert out.error.status_code == 409
    (release,) = world.fake.names("fn_credit_release")
    assert release["p_reason"] == "request_failed"
    assert world.fake.holds == {"res-0": "released"} and world.fake.balance == 5
    assert _db(out, "writing_essays", "delete")


def test_writing_outside_an_assignment_reserves_on_any_course(world):
    """No assignment (G08 self-practice), no legacy code: step 6 of plan 5.4,
    any usable entitlement. Since Andy's 11:52Z decision every assignment is
    class work, so the submit route itself never reaches this step."""
    plan = credits.charge_plan(_USER_ID, "writing_grading")
    assert plan.metered and plan.reason == "entitlement"
    assert plan.course_ids is None and plan.kinds is None


# ── New features are never free (C1 e) ──────────────────────────────────────

def test_new_feature_with_the_flag_off_is_503(world):
    world.flag = False
    with pytest.raises(credits.CreditUnavailable):
        credits.charge_plan(_USER_ID, "writing_grading", new_feature=True)
    with pytest.raises(credits.CreditUnavailable):
        credits.charge_plan(_USER_ID, "short_writing_feedback")


def test_new_feature_ignores_legacy_codes_and_needs_an_entitlement(world):
    world.legacy = ("writing",)
    plan = credits.charge_plan(_USER_ID, "writing_grading", new_feature=True)
    assert plan.metered and plan.reason == "entitlement"
    world.fake.force = "no_entitlement"
    with pytest.raises(credits.CreditRefused) as refused:
        _run(essay_service.reserve_writing_credit(_USER_ID, _ESSAY_ID, f"writing_essay:{_ESSAY_ID}"))
    assert refused.value.status_code == 403 and refused.value.code == "no_entitlement"


# ── Row creation carries review_mode only when given ────────────────────────

def test_review_mode_is_written_only_when_passed(monkeypatch):
    inserted: list[dict] = []
    fake = _FakeSupabase(responses={("students", "select"): [{"id": "s"}],
                                    ("writing_essays", "insert"): [{"id": "e1"}]})
    real_table = fake.table

    def table(name):
        q = real_table(name)
        if name == "writing_essays":
            orig = q.insert
            q.insert = lambda payload: (inserted.append(payload), orig(payload))[1]
        return q
    monkeypatch.setattr(fake, "table", table)
    monkeypatch.setattr(essay_service, "supabase_admin", fake)
    data = {"student_id": "s", "task_type": "task2", "prompt_text": "P", "essay_text": "E",
            "analysis_level": 3}
    essay_service.create_essay_row_only(data=data, admin_id="u")
    essay_service.create_essay_row_only(data=data, admin_id="u", review_mode="ai_instant")
    assert "review_mode" not in inserted[0]
    assert inserted[1]["review_mode"] == "ai_instant"
    with pytest.raises(ValueError):
        essay_service.create_essay_row_only(data=data, admin_id="u", review_mode="later")


# ── The background grader (FR-021) ──────────────────────────────────────────

def _bg_fake(review_mode=None, commit_status="committed", deliver_status="delivered"):
    responses = _bg_essay_responses()
    if review_mode is not None:
        responses[("writing_essays", "select")][0]["review_mode"] = review_mode
    responses[("fn_credit_commit_for_resource", "rpc")] = {"status": commit_status}
    responses[("fn_credit_release_for_resource", "rpc")] = {"status": "released"}
    responses[("fn_deliver_writing_essay_instant", "rpc")] = {"status": deliver_status}
    return _FakeSupabase(responses=responses)


async def _grade_ok(fake, **extra):
    grader = MagicMock()

    async def grade(_config):
        return MagicMock(feedback=_valid_feedback_obj(), model_used="gemini-2.5-pro", tokens_input=1,
                         tokens_output=1, cost_usd=0.0, grading_duration_ms=1, prompt_version="v1.0")
    grader.grade_essay = grade
    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(credits, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=grader), \
         patch.object(essay_service, "get_recurring_patterns", return_value=None), \
         patch.object(essay_service, "get_band_trajectory", return_value=None), \
         patch.object(essay_service.writing_assignment_status_sync, "mark_assignment_graded",
                      side_effect=lambda _e: fake.calls.append({"table": "sync", "op": "graded"})), \
         patch.object(essay_service.writing_assignment_status_sync, "mark_assignment_delivered",
                      side_effect=lambda _e: fake.calls.append({"table": "sync", "op": "delivered"})):
        await essay_service._bg_grade_essay(BG_ESSAY_ID, BG_JOB_ID, **extra)


def _ops(fake):
    return [(c["table"], c["op"]) for c in fake.calls]


@pytest.mark.asyncio
async def test_bg_grade_commits_after_every_grade_write_and_keeps_review_flow(world):
    fake = _bg_fake(review_mode=None)
    await _grade_ok(fake)
    ops = _ops(fake)
    commit = ops.index(("fn_credit_commit_for_resource", "rpc"))
    assert ops.index(("sync", "graded")) < commit
    job_done = max(i for i, c in enumerate(fake.calls)
                   if c["table"] == "writing_jobs" and c["op"] == "update"
                   and c["payload"].get("status") == "completed")
    assert job_done < commit
    rpc = fake.calls[commit]["payload"]
    assert rpc == {"p_resource_type": "writing_essay", "p_resource_id": BG_ESSAY_ID}
    assert ("fn_deliver_writing_essay_instant", "rpc") not in ops       # NULL mode: review as today
    assert ("sync", "delivered") not in ops


@pytest.mark.asyncio
async def test_bg_grade_delivers_an_ai_instant_essay(world):
    fake = _bg_fake(review_mode="ai_instant")
    await _grade_ok(fake)
    ops = _ops(fake)
    assert ops.index(("fn_credit_commit_for_resource", "rpc")) \
        < ops.index(("fn_deliver_writing_essay_instant", "rpc")) < ops.index(("sync", "delivered"))


@pytest.mark.asyncio
async def test_bg_grade_teacher_review_mode_is_not_delivered(world):
    fake = _bg_fake(review_mode="teacher_review")
    await _grade_ok(fake)
    assert ("fn_deliver_writing_essay_instant", "rpc") not in _ops(fake)


@pytest.mark.asyncio
async def test_bg_grade_with_the_flag_off_runs_no_credit_query(world):
    world.flag = False
    fake = _bg_fake(review_mode="ai_instant")
    await _grade_ok(fake)
    ops = _ops(fake)
    assert not any(t.startswith("fn_") for t, _ in ops)
    selects = [c for c in fake.calls if c["table"] == "writing_essays" and c["op"] == "select"]
    assert all("review_mode" not in (c.get("select") or "") for c in selects)


@pytest.mark.asyncio
async def test_bg_grade_credit_errors_never_fail_the_grade(world):
    fake = _bg_fake(review_mode="ai_instant")
    real_rpc = fake.rpc

    def rpc(name, params):
        if name.startswith("fn_credit"):
            raise RuntimeError("rpc down")
        return real_rpc(name, params)
    fake.rpc = rpc
    await _grade_ok(fake)
    statuses = [c["payload"].get("status") for c in fake.calls
                if c["table"] == "writing_essays" and c["op"] == "update"]
    assert "graded" in statuses and "failed" not in statuses


def _failed(fake, *, restore=None, times=1):
    with patch.object(essay_service, "supabase_admin", fake), patch.object(credits, "supabase_admin", fake):
        for _ in range(times):
            essay_service._mark_failed(BG_ESSAY_ID, BG_JOB_ID, RuntimeError("x"), kind="UnexpectedError",
                                       restore_status=restore)


def test_terminal_failure_releases_the_credit_grader_failed(world):
    fake = _bg_fake()
    _failed(fake)
    (rel,) = [c for c in fake.calls if c["table"] == "fn_credit_release_for_resource"]
    assert rel["payload"] == {"p_resource_type": "writing_essay", "p_resource_id": BG_ESSAY_ID,
                              "p_reason": "grader_failed"}


def test_terminal_failure_twice_returns_one_credit(world):
    """The RPC settles an open hold once: a second terminal write finds none."""
    fake = _bg_fake()
    answers = iter([{"status": "released"}, {"status": "none"}])
    real_rpc = fake.rpc

    def rpc(name, params):
        if name == "fn_credit_release_for_resource":
            fake.calls.append({"table": name, "op": "rpc", "payload": params})
            return SimpleNamespace(execute=lambda: SimpleNamespace(data=next(answers)))
        return real_rpc(name, params)
    fake.rpc = rpc
    _failed(fake, times=2)
    assert len([c for c in fake.calls if c["table"] == "fn_credit_release_for_resource"]) == 2


def test_restored_regrade_returns_nothing(world):
    fake = _bg_fake()
    _failed(fake, restore="delivered")
    assert not any(c["table"].startswith("fn_") for c in fake.calls)


def test_terminal_failure_with_the_flag_off_runs_no_rpc(world):
    world.flag = False
    fake = _bg_fake()
    _failed(fake)
    assert not any(c["table"].startswith("fn_") for c in fake.calls)


@pytest.mark.asyncio
async def test_requeue_never_returns_the_credit(world, monkeypatch):
    fake = _bg_fake()
    monkeypatch.setattr(essay_service, "_owns_job", lambda *_a: True)
    monkeypatch.setattr(essay_service, "_record_attempt_failure", lambda *_a, **_k: None)
    requeued = []
    monkeypatch.setattr(essay_service, "_schedule_requeue", lambda *a, **k: requeued.append(a))
    with patch.object(essay_service, "supabase_admin", fake), patch.object(credits, "supabase_admin", fake):
        await essay_service._handle_grade_failure(
            BG_ESSAY_ID, BG_JOB_ID, RuntimeError("x"), kind="APIRetryFailedError",
            attempt_no=1, max_attempts=3, model="m", restore_status=None)
    assert requeued and not any(c["table"].startswith("fn_") for c in fake.calls)
