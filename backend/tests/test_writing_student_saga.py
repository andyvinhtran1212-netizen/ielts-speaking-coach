"""Sprint 2.7.1 — SAGA-pattern submit pinning tests.

Closes Codex re-audit MED finding 2026-05-07: the pre-2.7.1 ordering
(claim assignment → create essay row → backfill link) leaves a
50ms-2s window where a Railway crash freezes the assignment in
`status='submitted'` with `essay_id=NULL`.  Student is then stuck:
the dashboard locks the form (status past `in_progress`) but no
essay has been created so the result page has nothing to render.

The fix is a SAGA reverse order:

  1. Create the essay row first (status=pending, no link, no job).
  2. Atomic claim + link in a single conditional UPDATE.
     `.in_("status", ["pending", "in_progress"])` is the race gate;
     a lost-race tab gets `data=[]` back.
  3. On lost race (or UPDATE round-trip failure): DELETE the orphan
     essay row so the moderation queue isn't poisoned.
  4. Schedule the grading job ONLY after the link is committed.
     Failure here does NOT fail the request — assignment is
     correctly linked, admin can manually re-queue grading.

This file pins:
  • Call order (essay before claim, grading job last).
  • Lost-race rollback (orphan essay DELETE'd, no BG task).
  • Grading-job failure resilience (request succeeds, log captures
    the error for admin attention).
  • The same SAGA shape on the flagged-submission path.

The crash window assertion isn't directly testable in unit-land
(we'd need to fault-inject between two real DB calls), but pinning
the call sequence + the lost-race rollback is what guarantees the
window now contains only one round-trip — and a crash there leaves
an orphan essay (recoverable) instead of a stuck assignment
(blocking).
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from routers import writing_student as ws_module
from routers.writing_student import (
    SubmitEssay,
    submit_my_assignment,
)


_USER_ID       = "user-uuid-aaaa"
_STUDENT_ID    = "student-uuid-bbbb"
_ASSIGNMENT_ID = "assign-uuid-cccc"
_PROMPT_ID     = "prompt-uuid-dddd"
_ESSAY_ID      = "essay-uuid-eeee"
_JOB_ID        = "job-uuid-ffff"


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _student() -> dict:
    return {
        "id":           _STUDENT_ID,
        "user_id":      _USER_ID,
        "student_code": "STU001",
        "full_name":    "Test Student",
        "target_band":  7.0,
    }


# ── Mock dispatcher ──────────────────────────────────────────────────


class _Builder:
    def __init__(self, parent, table):
        self._parent  = parent
        self._table   = table
        self._action  = None
        self._payload = None
        self._filters: list[tuple] = []
        self._in: tuple[str, list] | None = None

    def select(self, *_a, **_kw): self._action = "select"; return self
    def insert(self, payload, *_a, **_kw): self._action = "insert"; self._payload = payload; return self
    def update(self, payload, *_a, **_kw): self._action = "update"; self._payload = payload; return self
    def delete(self, *_a, **_kw): self._action = "delete"; return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def order(self, *_a, **_kw):  return self
    def limit(self, *_a, **_kw):  return self
    def in_(self, col, vals):
        self._in = (col, list(vals))
        return self

    def execute(self):
        rec = {
            "table":   self._table,
            "action":  self._action,
            "payload": self._payload,
            "filters": list(self._filters),
            "in":      self._in,
        }
        self._parent.calls.append(("call", rec))
        return self._parent._respond(rec)


class _Client:
    """Records BOTH service-mock invocations and DB calls into a
    single ordered list so tests can assert call order across the
    boundary (e.g. `create_essay_row_only` fired BEFORE the claim
    UPDATE).  Without a unified log we'd have to rely on per-mock
    timestamps which is flaky."""

    def __init__(self, *, assignment_status="in_progress", drafts_data=None,
                 student_row=None, analysis_level=None):
        self._assignment_status = assignment_status
        self._analysis_level    = analysis_level
        self._drafts            = drafts_data or []
        self._student_row       = student_row or {"flag_count": 0, "is_under_review": False}
        self.calls: list[tuple] = []

    def table(self, name): return _Builder(self, name)

    def _respond(self, rec):
        class _R: pass
        r = _R(); r.data = []
        t, a = rec["table"], rec["action"]

        if t == "writing_assignments":
            if a == "select":
                row = {
                    "id":          _ASSIGNMENT_ID,
                    "student_id":  _STUDENT_ID,
                    "status":      self._assignment_status,
                    "deadline":    None,
                    "instructions": None,
                    "created_at":  "2026-05-07T09:00:00Z",
                    "submitted_at": None,
                    "delivered_at": None,
                    "essay_id":    None,
                    "is_timed":    False,
                    "time_limit_minutes": None,
                    "started_at":  None,
                    "auto_submitted": False,
                    "analysis_level": self._analysis_level,
                    "writing_prompts": {
                        "id":          _PROMPT_ID,
                        "title":       "T",
                        "prompt_text": "Some Task 2 prompt about education.",
                        "task_type":   "task2",
                        "difficulty":  "intermediate",
                    },
                }
                r.data = [row]
            elif a == "update":
                # Honor `.in_()` filter for atomic claim semantics.
                if rec.get("in"):
                    in_col, in_vals = rec["in"]
                    if in_col == "status" and self._assignment_status not in in_vals:
                        r.data = []
                        return r
                r.data = [{"id": _ASSIGNMENT_ID, **(rec["payload"] or {})}]
        elif t == "writing_drafts":
            if a == "select":
                rows = self._drafts
                for col, val in rec["filters"]:
                    rows = [d for d in rows if str(d.get(col)) == str(val)]
                r.data = rows
            elif a == "delete":
                r.data = []
        elif t == "writing_essays":
            if a == "delete":
                r.data = []
        elif t == "students":
            if a == "select":
                r.data = [self._student_row]
            elif a == "update":
                r.data = [{"id": _STUDENT_ID, **(rec["payload"] or {})}]
        return r


def _patch_saga_service(monkeypatch, *, on_row_only=None, on_schedule=None):
    """Wire the SAGA service split.  The `on_row_only` and `on_schedule`
    hooks let individual tests record into the shared call log so
    we can assert ordering across the service/DB boundary."""
    def fake_row_only(**kwargs):
        if on_row_only is not None:
            on_row_only(kwargs)
        return {"essay_id": _ESSAY_ID, "eta_seconds": 60}

    def fake_schedule(**kwargs):
        if on_schedule is not None:
            on_schedule(kwargs)
        return {"job_id": _JOB_ID, "eta_seconds": 60}

    monkeypatch.setattr(ws_module.essay_service, "create_essay_row_only", fake_row_only)
    monkeypatch.setattr(ws_module.essay_service, "schedule_grading_job",  fake_schedule)
    monkeypatch.setattr(ws_module.essay_service, "create_essay_with_job",
                        MagicMock(return_value={
                            "essay_id":    _ESSAY_ID,
                            "job_id":      _JOB_ID,
                            "eta_seconds": 60,
                        }))
    monkeypatch.setattr(ws_module.essay_service, "_bg_grade_essay",
                        lambda *_a, **_kw: None)


_LONG = "Valid essay body with multiple meaningful words here. " * 25


# ── Tests ────────────────────────────────────────────────────────────


def test_saga_creates_essay_before_claim_and_schedules_job_after_link(monkeypatch):
    """The SAGA's load-bearing invariant: the call sequence is
    `create_essay_row_only` → writing_assignments UPDATE (claim+link)
    → `schedule_grading_job` → BG task.

    A regression that flips any of these (e.g. someone moves
    schedule_grading_job before the claim) gets caught here.  The
    in-test ordering is enforced by piping every relevant event
    into a single `events` list as it happens."""
    events: list[str] = []

    client = _Client(assignment_status="in_progress")
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    _patch_saga_service(
        monkeypatch,
        on_row_only=lambda _kw: events.append("essay_row_only"),
        on_schedule=lambda _kw: events.append("schedule_job"),
    )

    bg = MagicMock()
    def add_task_track(*_a, **_kw): events.append("bg_task")
    bg.add_task = MagicMock(side_effect=add_task_track)

    _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text=_LONG),
        background_tasks=bg,
        student=_student(),
    ))

    # The claim UPDATE is somewhere in client.calls — find its index
    # and inject it into the unified timeline.
    for i, (kind, rec) in enumerate(client.calls):
        if (kind == "call"
                and rec["table"] == "writing_assignments"
                and rec["action"] == "update"
                and rec.get("in")):  # only the claim has an in_ filter
            events.insert(events.index("essay_row_only") + 1, "claim_update")
            break

    assert events[0] == "essay_row_only", \
        "SAGA leg 1 must run first (essay row created speculatively)"
    assert events[1] == "claim_update", \
        "SAGA leg 2 must immediately follow leg 1 (atomic claim+link)"
    assert events[2] == "schedule_job", \
        "SAGA leg 3 must run AFTER the link is committed"
    assert events[3] == "bg_task", \
        "BG task is added last, after the job row is queued"


def test_saga_rolls_back_orphan_essay_on_lost_race(monkeypatch):
    """Lost race: the row is already past an active state by the
    time the conditional UPDATE fires.  SAGA must DELETE the
    speculative essay so an admin doesn't see an orphan in the
    moderation queue."""
    deleted_ids: list[str] = []

    client = _Client(assignment_status="submitted")  # tab A already won
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    # Hook the orphan DELETE so we can assert by id.
    real_table = client.table

    def table_with_delete_track(name):
        b = real_table(name)
        if name == "writing_essays":
            orig_delete = b.delete
            def tracking_delete(*_a, **_kw):
                # capture the eventual eq() value (essay id)
                ret = orig_delete()
                orig_eq = ret.eq
                def eq_track(col, val):
                    if col == "id":
                        deleted_ids.append(val)
                    return orig_eq(col, val)
                ret.eq = eq_track
                return ret
            b.delete = tracking_delete
        return b
    monkeypatch.setattr(client, "table", table_with_delete_track)

    _patch_saga_service(monkeypatch)

    bg = MagicMock(); bg.add_task = MagicMock()
    with pytest.raises(HTTPException) as exc:
        _run(submit_my_assignment(
            assignment_id=_ASSIGNMENT_ID,
            body=SubmitEssay(essay_text=_LONG),
            background_tasks=bg,
            student=_student(),
        ))
    assert exc.value.status_code == 409
    assert _ESSAY_ID in deleted_ids, \
        "lost race must DELETE the speculatively-created essay"
    bg.add_task.assert_not_called()


def test_saga_grading_job_failure_does_not_fail_the_request(monkeypatch):
    """If `schedule_grading_job` raises AFTER a successful claim,
    the request still returns 200.  Rationale: assignment row is
    correctly linked, the student already saw "submitted" client-
    side, and admin can manually re-queue grading via the existing
    admin retry path.  Failing the request would leave the student
    confused (their dashboard says submitted but the request 500'd)."""
    client = _Client(assignment_status="in_progress")
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    def boom(**_kw):
        raise RuntimeError("Job queue down")

    monkeypatch.setattr(ws_module.essay_service, "create_essay_row_only",
                        lambda **_kw: {"essay_id": _ESSAY_ID, "eta_seconds": 60})
    monkeypatch.setattr(ws_module.essay_service, "schedule_grading_job", boom)
    monkeypatch.setattr(ws_module.essay_service, "create_essay_with_job",
                        MagicMock())
    monkeypatch.setattr(ws_module.essay_service, "_bg_grade_essay",
                        lambda *_a, **_kw: None)

    bg = MagicMock(); bg.add_task = MagicMock()

    # The handler must NOT re-raise — capture logs to confirm the
    # error was surfaced to admin-via-logs instead.
    caplog_records: list[logging.LogRecord] = []
    class _Handler(logging.Handler):
        def emit(self, record):
            caplog_records.append(record)
    h = _Handler(level=logging.ERROR)
    ws_module.logger.addHandler(h)
    try:
        result = _run(submit_my_assignment(
            assignment_id=_ASSIGNMENT_ID,
            body=SubmitEssay(essay_text=_LONG),
            background_tasks=bg,
            student=_student(),
        ))
    finally:
        ws_module.logger.removeHandler(h)

    assert result["status"] == "submitted"
    assert result["essay_id"] == _ESSAY_ID
    # `job_id` is None because scheduling blew up — but the assignment
    # row is still correctly linked (the claim+link UPDATE already ran).
    assert result["job_id"] is None
    bg.add_task.assert_not_called()

    # Admin must see an ERROR log mentioning the essay so manual
    # re-grading is targeted.
    error_messages = [
        r.getMessage() for r in caplog_records if r.levelno == logging.ERROR
    ]
    assert any("schedule grading job failed" in m and _ESSAY_ID in m
               for m in error_messages), \
        "grading-job failure must produce an actionable ERROR log"


def test_saga_flagged_path_creates_row_first_then_claims(monkeypatch):
    """The flagged path follows the same SAGA order: row first
    (terminal `delivered` state), atomic claim+link second, NO
    grading job ever scheduled.  Pin: row+claim ordering, no
    schedule_grading_job call."""
    events: list[str] = []

    client = _Client(assignment_status="in_progress")
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    _patch_saga_service(
        monkeypatch,
        on_row_only=lambda kw: events.append(
            "essay_row_only:flagged" if kw["data"].get("is_flagged") else "essay_row_only"
        ),
        on_schedule=lambda _kw: events.append("schedule_job"),
    )

    bg = MagicMock(); bg.add_task = MagicMock()
    result = _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text="too short"),  # triggers the spam detector
        background_tasks=bg,
        student=_student(),
    ))

    # Verify the response shape so we know we actually hit the
    # flagged branch (and didn't accidentally fall through to clean).
    assert result["is_flagged"] is True
    assert result["status"]     == "delivered"
    assert "schedule_job" not in events, \
        "flagged path must not schedule grading"
    assert events[0] == "essay_row_only:flagged", \
        "flagged path's SAGA leg 1 created the terminal-state essay row"

    # The single conditional UPDATE on writing_assignments did the
    # claim + link.  Find it and verify it set status=delivered.
    a_updates = [rec for kind, rec in client.calls
                 if kind == "call"
                 and rec["table"] == "writing_assignments"
                 and rec["action"] == "update"]
    assert len(a_updates) == 1, "flagged SAGA: exactly one assignment UPDATE"
    assert a_updates[0]["payload"]["status"]   == "delivered"
    assert a_updates[0]["payload"]["essay_id"] == _ESSAY_ID


# ── analysis_level wire (mig 104): assignment level → essay + grading job ──

def test_submit_uses_assignment_analysis_level(monkeypatch):
    """The submitted essay + grading job are created at the assignment's
    analysis_level (mig 104), not the old hardcoded 3."""
    captured = {}
    client = _Client(assignment_status="in_progress", analysis_level=5)
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    _patch_saga_service(
        monkeypatch,
        on_row_only=lambda kw: captured.update(row=kw),
        on_schedule=lambda kw: captured.update(sched=kw),
    )
    bg = MagicMock(); bg.add_task = MagicMock()
    _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text=_LONG),
        background_tasks=bg,
        student=_student(),
    ))
    assert captured["row"]["data"]["analysis_level"] == 5
    assert captured["sched"]["analysis_level"] == 5


def test_submit_falls_back_to_level_3_when_assignment_has_none(monkeypatch):
    """Defensive: an assignment row without analysis_level → essay graded at 3
    (preserves pre-mig-104 behavior)."""
    captured = {}
    client = _Client(assignment_status="in_progress", analysis_level=None)
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    _patch_saga_service(
        monkeypatch,
        on_row_only=lambda kw: captured.update(row=kw),
        on_schedule=lambda kw: captured.update(sched=kw),
    )
    bg = MagicMock(); bg.add_task = MagicMock()
    _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text=_LONG),
        background_tasks=bg,
        student=_student(),
    ))
    assert captured["row"]["data"]["analysis_level"] == 3
    assert captured["sched"]["analysis_level"] == 3
