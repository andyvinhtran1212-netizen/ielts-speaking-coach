"""Tests for the Phase 2.6 spam-flag flow in submit_my_assignment.

Strategy mirrors test_writing_student_assignments.py:
  • Direct async-handler invocation, sidestepping FastAPI's auth
    wiring (already pinned elsewhere).
  • A small table-aware dispatcher mock that records every call so
    we can assert the writes the flagged path is supposed to make
    (writing_essays insert, writing_assignments update, students
    rollup, writing_drafts delete) WITHOUT touching a real DB.

What we pin:
  • Short essay → flagged-path response shape (status 200, is_flagged
    true, message includes Vietnamese explanation).
  • The detector's flag codes survive into writing_essays.flag_reasons.
  • student.flag_count increments and crosses the 3-flag threshold
    that auto-sets is_under_review=true.
  • The grader pipeline is NOT invoked on flagged submissions
    (essay_service.create_essay_with_job stays untouched).
  • A clean essay still takes the original happy path.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

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


# ── Mock dispatcher (table-aware) ────────────────────────────────────


class _Builder:
    def __init__(self, parent, table):
        self._parent  = parent
        self._table   = table
        self._action  = None
        self._payload = None
        self._filters: list[tuple] = []
        # Sprint 2.7 fix #3: support `.in_()` on the atomic-claim UPDATE.
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
        self._parent.calls.append(rec)
        return self._parent._respond(rec)


class _Client:
    """A wider table dispatcher than test_writing_student_assignments.py
    — adds writing_essays + students because the flagged path
    touches both."""

    def __init__(self, *, assignments_data, drafts_data=None,
                 student_row=None, essay_id=_ESSAY_ID):
        self._assignments = assignments_data
        self._drafts      = drafts_data or []
        self._student_row = student_row or {"flag_count": 0, "is_under_review": False}
        self._essay_id    = essay_id
        self.calls: list[dict] = []

    def table(self, name): return _Builder(self, name)

    def _respond(self, rec):
        class _R: pass
        r = _R(); r.data = []

        t, a = rec["table"], rec["action"]
        if t == "writing_assignments":
            if a == "select":
                rows = self._assignments
                for col, val in rec["filters"]:
                    rows = [x for x in rows if str(x.get(col)) == str(val)]
                r.data = rows
            elif a == "update":
                # Sprint 2.7 fix #3: honor `.in_()` for the atomic claim
                # — empty data ⇒ lost race ⇒ router raises 409.
                if rec.get("in"):
                    in_col, in_vals = rec["in"]
                    matches = self._assignments
                    for col, val in rec["filters"]:
                        matches = [a2 for a2 in matches if str(a2.get(col)) == str(val)]
                    if not matches or matches[0].get(in_col) not in in_vals:
                        r.data = []
                        return r
                r.data = [{"id": rec["filters"][0][1] if rec["filters"] else None,
                           **(rec["payload"] or {})}]
        elif t == "writing_drafts":
            if a == "select":
                rows = self._drafts
                for col, val in rec["filters"]:
                    rows = [x for x in rows if str(x.get(col)) == str(val)]
                r.data = rows
            elif a == "delete":
                r.data = []
        elif t == "writing_essays":
            if a == "insert":
                # Echo the inserted payload + a fake id back, mimicking
                # the Supabase python client's `.insert(...).execute()`.
                r.data = [{"id": self._essay_id, **(rec["payload"] or {})}]
        elif t == "students":
            if a == "select":
                r.data = [self._student_row]
            elif a == "update":
                r.data = [{"id": rec["filters"][0][1] if rec["filters"] else None,
                           **(rec["payload"] or {})}]
        return r


def _patch_essay_service(monkeypatch):
    """Replace `essay_service.create_essay_with_job` with a recording
    mock so we can assert it was NOT called on the flagged path."""
    fake = MagicMock(return_value={
        "essay_id":    _ESSAY_ID,
        "job_id":      "job-uuid-ffff",
        "eta_seconds": 60,
    })
    monkeypatch.setattr(ws_module.essay_service, "create_essay_with_job", fake)
    return fake


# ── Tests ────────────────────────────────────────────────────────────


def _active_assignment_row():
    return {
        "id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
        "status": "in_progress",
        "writing_prompts": {
            "id": _PROMPT_ID, "title": "T",
            "prompt_text": "Some Task 2 prompt about education.",
            "task_type": "task2",
        },
    }


def test_short_essay_takes_flagged_path(monkeypatch):
    """An essay with 9 chars / 2 words used to 400. Now it returns a
    200-shaped response with `is_flagged=true` and the detector's
    reason codes; the grader is NEVER invoked."""
    client = _Client(
        assignments_data=[_active_assignment_row()],
        student_row={"flag_count": 0, "is_under_review": False},
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    fake_create = _patch_essay_service(monkeypatch)

    bg = MagicMock(); bg.add_task = MagicMock()
    result = _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text="too short"),
        background_tasks=bg,
        student=_student(),
    ))

    assert result["is_flagged"] is True
    assert "too_short_chars" in result["flag_reasons"]
    assert result["status"] == "delivered"
    assert "Bài đã nộp" in result["message"]
    # The grader pipeline must stay untouched.
    fake_create.assert_not_called()
    bg.add_task.assert_not_called()


def test_flagged_essay_inserts_with_flag_reasons(monkeypatch):
    """The writing_essays insert payload carries is_flagged=true and
    the full flag_reasons array. Pinning prevents a regression where
    we accept the submission but lose the audit trail."""
    client = _Client(
        assignments_data=[_active_assignment_row()],
        student_row={"flag_count": 0, "is_under_review": False},
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    _patch_essay_service(monkeypatch)

    bg = MagicMock(); bg.add_task = MagicMock()
    _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text="x"),  # too short
        background_tasks=bg,
        student=_student(),
    ))

    inserts = [c for c in client.calls
               if c["table"] == "writing_essays" and c["action"] == "insert"]
    assert len(inserts) == 1
    payload = inserts[0]["payload"]
    assert payload["is_flagged"] is True
    assert "too_short_chars" in payload["flag_reasons"]
    assert payload["status"] == "delivered"
    # submitted_by_admin gets the student's user_id (audit-field
    # caveat — the column name is misleading but the FK semantic
    # holds).
    assert payload["submitted_by_admin"] == _USER_ID


def test_flagged_essay_does_not_write_writing_feedback(monkeypatch):
    """No writing_feedback row on the flagged path. Skipping it is a
    deliberate schema decision (overall_band_score NOT NULL) — pin
    that we don't accidentally start writing stub rows."""
    client = _Client(
        assignments_data=[_active_assignment_row()],
        student_row={"flag_count": 0, "is_under_review": False},
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    _patch_essay_service(monkeypatch)

    bg = MagicMock(); bg.add_task = MagicMock()
    _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text="too short"),
        background_tasks=bg,
        student=_student(),
    ))

    feedback_writes = [c for c in client.calls if c["table"] == "writing_feedback"]
    assert feedback_writes == []


def test_flagged_assignment_transitions_to_delivered(monkeypatch):
    """Assignment row jumps straight to `delivered` (skipping
    `submitted` because there's no grader run). Pinning prevents
    regressions where we accidentally send flagged rows into the
    grading queue."""
    client = _Client(
        assignments_data=[_active_assignment_row()],
        student_row={"flag_count": 0, "is_under_review": False},
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    _patch_essay_service(monkeypatch)

    bg = MagicMock(); bg.add_task = MagicMock()
    _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text="too short"),
        background_tasks=bg,
        student=_student(),
    ))

    # Sprint 2.7 fix #3: with the atomic claim in place, the FIRST
    # writing_assignments UPDATE is the claim (status=submitted). The
    # flagged-path helper then issues a SECOND UPDATE that flips to
    # `delivered` — find it by status to keep this test stable
    # regardless of how many intermediate updates exist.
    a_updates = [c for c in client.calls
                 if c["table"] == "writing_assignments" and c["action"] == "update"]
    assert a_updates, "expected a writing_assignments update"
    delivered = next(
        (u for u in a_updates if (u["payload"] or {}).get("status") == "delivered"),
        None,
    )
    assert delivered is not None, "expected a status=delivered update"
    payload = delivered["payload"]
    assert payload["essay_id"]     == _ESSAY_ID
    assert payload["delivered_at"] is not None


def test_first_flag_increments_count_no_review_yet(monkeypatch):
    """flag_count goes 0 → 1; is_under_review NOT set yet (threshold
    is 3). Protects against an over-eager auto-promotion that would
    flood admin's review queue on a single misclick."""
    client = _Client(
        assignments_data=[_active_assignment_row()],
        student_row={"flag_count": 0, "is_under_review": False},
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    _patch_essay_service(monkeypatch)

    bg = MagicMock(); bg.add_task = MagicMock()
    _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text="too short"),
        background_tasks=bg,
        student=_student(),
    ))

    s_updates = [c for c in client.calls
                 if c["table"] == "students" and c["action"] == "update"]
    assert s_updates, "expected a students rollup update"
    payload = s_updates[0]["payload"]
    assert payload["flag_count"] == 1
    assert "is_under_review" not in payload


def test_third_flag_auto_marks_under_review(monkeypatch):
    """When flag_count was already 2, the third flagged submission
    crosses the threshold and sets is_under_review=true. This is the
    Phase 2.6 promise: repeat offenders surface in the admin queue
    automatically."""
    client = _Client(
        assignments_data=[_active_assignment_row()],
        student_row={"flag_count": 2, "is_under_review": False},
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    _patch_essay_service(monkeypatch)

    bg = MagicMock(); bg.add_task = MagicMock()
    _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text="too short"),
        background_tasks=bg,
        student=_student(),
    ))

    s_updates = [c for c in client.calls
                 if c["table"] == "students" and c["action"] == "update"]
    assert s_updates
    payload = s_updates[0]["payload"]
    assert payload["flag_count"] == 3
    assert payload["is_under_review"] is True


def test_already_under_review_does_not_re_flip(monkeypatch):
    """A student already in review whose 4th flag fires shouldn't
    double-stamp `is_under_review`. The update payload should carry
    only the counter + timestamp — keeps audit history clean."""
    client = _Client(
        assignments_data=[_active_assignment_row()],
        student_row={"flag_count": 5, "is_under_review": True},
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    _patch_essay_service(monkeypatch)

    bg = MagicMock(); bg.add_task = MagicMock()
    _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text="too short"),
        background_tasks=bg,
        student=_student(),
    ))

    s_updates = [c for c in client.calls
                 if c["table"] == "students" and c["action"] == "update"]
    assert s_updates
    payload = s_updates[0]["payload"]
    assert payload["flag_count"] == 6
    # Don't re-write is_under_review — the column is already TRUE
    # and we don't want a noise row in the audit log.
    assert "is_under_review" not in payload


def test_flagged_path_cleans_up_draft(monkeypatch):
    """The form is now locked (assignment.status=delivered). A stale
    draft would surface as 'Bản nháp: …' on the dashboard for an
    assignment the student can't open — confusing UX."""
    client = _Client(
        assignments_data=[_active_assignment_row()],
        drafts_data=[
            {"assignment_id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "draft_text": "x"},
        ],
        student_row={"flag_count": 0, "is_under_review": False},
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    _patch_essay_service(monkeypatch)

    bg = MagicMock(); bg.add_task = MagicMock()
    _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text="too short"),
        background_tasks=bg,
        student=_student(),
    ))

    deletes = [c for c in client.calls
               if c["table"] == "writing_drafts" and c["action"] == "delete"]
    assert len(deletes) == 1
