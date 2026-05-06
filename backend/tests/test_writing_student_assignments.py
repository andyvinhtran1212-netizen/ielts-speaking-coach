"""Tests for the Phase 2.3b student assignments + draft + submit
endpoints (extends routers/writing_student.py).

Strategy:
  • Each test directly invokes the async router function with a
    pre-resolved `student` dict, sidestepping FastAPI's dependency
    injection. This keeps the surface area narrow — we're testing
    handler logic, not the auth wiring (which is already pinned by
    test_writing_student.py).
  • supabase_admin is patched on the writing_student module with a
    table-aware dispatcher so each query gets the right shape.
  • essay_service and BackgroundTasks are patched so the submit path
    doesn't actually try to reach Gemini.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from routers import writing_student as ws_module
from routers.writing_student import (
    DraftUpsert,
    SubmitEssay,
    get_my_assignment,
    list_my_assignments,
    submit_my_assignment,
    upsert_my_draft,
)


_USER_ID         = "user-uuid-aaaa"
_STUDENT_ID      = "student-uuid-bbbb"
_ASSIGNMENT_ID   = "assign-uuid-cccc"
_PROMPT_ID       = "prompt-uuid-dddd"
_OTHER_ASSIGNMENT_ID = "assign-uuid-other"


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


# ── Smart dispatcher mock ────────────────────────────────────────────


class _Builder:
    """Records every chained query and returns canned data based on
    the table + action it observed."""
    def __init__(self, parent: "_Client", table: str):
        self._parent  = parent
        self._table   = table
        self._action  = None
        self._payload = None
        self._filters: list[tuple] = []

    def select(self, *_a, **_kw):
        self._action = "select"
        return self

    def insert(self, payload, *_a, **_kw):
        self._action  = "insert"
        self._payload = payload
        return self

    def upsert(self, payload, *_a, **_kw):
        self._action  = "upsert"
        self._payload = payload
        return self

    def update(self, payload, *_a, **_kw):
        self._action  = "update"
        self._payload = payload
        return self

    def delete(self, *_a, **_kw):
        self._action = "delete"
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def order(self, *_a, **_kw):  return self
    def limit(self, *_a, **_kw):  return self

    def execute(self):
        rec = {
            "table":   self._table,
            "action":  self._action,
            "payload": self._payload,
            "filters": list(self._filters),
        }
        self._parent.calls.append(rec)
        return self._parent._respond(rec)


class _Client:
    def __init__(
        self,
        *,
        assignments_data: list[dict] | None = None,
        drafts_data:      list[dict] | None = None,
    ):
        self._assignments = assignments_data or []
        self._drafts      = drafts_data or []
        self.calls: list[dict] = []

    def table(self, name): return _Builder(self, name)

    def _respond(self, rec):
        class _R: pass
        r = _R()
        r.data = []

        table  = rec["table"]
        action = rec["action"]

        if table == "writing_assignments":
            if action in ("select",):
                # Filter by id + student_id when both filters present.
                rows = self._assignments
                for col, val in rec["filters"]:
                    rows = [a for a in rows if str(a.get(col)) == str(val)]
                r.data = rows
            elif action == "update":
                # Echo the patch + id back as if Supabase returned it.
                r.data = [{"id": rec["filters"][0][1] if rec["filters"] else None,
                           **(rec["payload"] or {})}]
        elif table == "writing_drafts":
            if action == "select":
                rows = self._drafts
                for col, val in rec["filters"]:
                    rows = [d for d in rows if str(d.get(col)) == str(val)]
                r.data = rows
            elif action in ("upsert", "insert"):
                r.data = [rec["payload"]]
            elif action == "delete":
                r.data = []
        return r


# ── Listing ──────────────────────────────────────────────────────────


def test_list_my_assignments_annotates_drafts(monkeypatch):
    """Each row in the response carries `has_draft` / `draft_word_count`
    / `draft_updated_at` — the dashboard needs these to render the
    "📝 Bản nháp: 250 từ" hint without a per-row round trip."""
    client = _Client(
        assignments_data=[
            {"id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "status": "in_progress", "deadline": None, "instructions": None,
             "created_at": "2026-05-06T10:00:00Z",
             "submitted_at": None, "delivered_at": None, "essay_id": None,
             "writing_prompts": {"id": _PROMPT_ID, "title": "Test prompt",
                                  "task_type": "task2", "difficulty": "intermediate"}},
            {"id": _OTHER_ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "status": "pending", "deadline": None, "instructions": None,
             "created_at": "2026-05-06T09:00:00Z",
             "submitted_at": None, "delivered_at": None, "essay_id": None,
             "writing_prompts": {"id": _PROMPT_ID, "title": "Other",
                                  "task_type": "task2", "difficulty": "beginner"}},
        ],
        drafts_data=[
            {"assignment_id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "word_count": 152, "updated_at": "2026-05-06T11:00:00Z"},
        ],
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    result = _run(list_my_assignments(status_filter=None, student=_student()))

    by_id = {a["id"]: a for a in result["assignments"]}
    assert by_id[_ASSIGNMENT_ID]["has_draft"]      is True
    assert by_id[_ASSIGNMENT_ID]["draft_word_count"] == 152
    assert by_id[_OTHER_ASSIGNMENT_ID]["has_draft"] is False
    assert by_id[_OTHER_ASSIGNMENT_ID]["draft_word_count"] == 0


# ── Single fetch: 404 isolation ──────────────────────────────────────


def test_get_my_assignment_404_when_owned_by_another_student(monkeypatch):
    """An assignment owned by a different student returns 404 — same
    response shape as a nonexistent id, no information leak about
    other students' work."""
    client = _Client(
        assignments_data=[
            {"id": _ASSIGNMENT_ID, "student_id": "some-other-student",
             "status": "pending", "writing_prompts": {}},
        ],
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    with pytest.raises(HTTPException) as exc:
        _run(get_my_assignment(assignment_id=_ASSIGNMENT_ID, student=_student()))
    assert exc.value.status_code == 404


# ── Draft upsert ─────────────────────────────────────────────────────


def test_draft_upsert_auto_transitions_pending_to_in_progress(monkeypatch):
    """First save against a `pending` assignment must auto-transition
    the row to `in_progress` — once a student has touched the card
    the dashboard shouldn't read 'Chờ làm' anymore."""
    client = _Client(
        assignments_data=[
            {"id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "status": "pending",
             "writing_prompts": {"id": _PROMPT_ID, "title": "T",
                                  "task_type": "task2"}},
        ],
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    _run(upsert_my_draft(
        assignment_id=_ASSIGNMENT_ID,
        body=DraftUpsert(draft_text="Hello world."),
        student=_student(),
    ))

    # Find the writing_assignments UPDATE call — must include
    # status='in_progress'.
    update_calls = [c for c in client.calls
                    if c["table"] == "writing_assignments" and c["action"] == "update"]
    assert update_calls, "expected a writing_assignments update for the auto-transition"
    assert update_calls[0]["payload"] == {"status": "in_progress"}


def test_draft_upsert_blocked_when_status_past_in_progress(monkeypatch):
    """Drafts are immutable once the row has been handed to the grader
    — anything past `in_progress` returns 409."""
    client = _Client(
        assignments_data=[
            {"id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "status": "submitted",
             "writing_prompts": {"id": _PROMPT_ID, "title": "T",
                                  "task_type": "task2"}},
        ],
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    with pytest.raises(HTTPException) as exc:
        _run(upsert_my_draft(
            assignment_id=_ASSIGNMENT_ID,
            body=DraftUpsert(draft_text="too late"),
            student=_student(),
        ))
    assert exc.value.status_code == 409
    # No upsert / update should have been issued.
    assert not [c for c in client.calls
                if c["table"] == "writing_drafts" and c["action"] == "upsert"]


# ── Submit ───────────────────────────────────────────────────────────


def _patch_essay_service(monkeypatch):
    """Replace essay_service.create_essay_with_job + _bg_grade_essay
    so submit tests don't try to reach the real grader."""
    fake_create = MagicMock(return_value={
        "essay_id":    "essay-uuid-eeee",
        "job_id":      "job-uuid-ffff",
        "eta_seconds": 45,
    })
    monkeypatch.setattr(ws_module.essay_service, "create_essay_with_job", fake_create)
    monkeypatch.setattr(ws_module.essay_service, "_bg_grade_essay",
                        lambda *_a, **_kw: None)
    return fake_create


def test_submit_falls_back_to_draft_text_when_body_essay_text_is_none(monkeypatch):
    """If the request body omits essay_text, submit pulls the saved
    draft. Lets a student with bad connectivity who lost the form
    submit "what was last saved" without retyping."""
    saved_draft = "This is the saved draft body. " * 5  # > min 50 chars
    client = _Client(
        assignments_data=[
            {"id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "status": "in_progress",
             "writing_prompts": {"id": _PROMPT_ID, "title": "T",
                                  "prompt_text": "Some Task 2 prompt.",
                                  "task_type": "task2"}},
        ],
        drafts_data=[
            {"assignment_id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "draft_text": saved_draft},
        ],
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    fake_create = _patch_essay_service(monkeypatch)

    bg = MagicMock()
    bg.add_task = MagicMock()

    result = _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text=None),
        background_tasks=bg,
        student=_student(),
    ))

    assert result["status"] == "submitted"
    # The grader was called with the draft text (stripped).
    submitted_text = fake_create.call_args.kwargs["data"]["essay_text"]
    assert submitted_text == saved_draft.strip()
    # admin_id = student.user_id (audit-field caveat in handler comment).
    assert fake_create.call_args.kwargs["admin_id"] == _USER_ID
    # BG task was scheduled.
    bg.add_task.assert_called_once()


def test_submit_rejects_too_short_essay(monkeypatch):
    """Essay shorter than 50 chars (after strip) → 400. Catches the
    misclick where a student with an empty draft hits Submit and would
    otherwise burn a Gemini grade on whitespace."""
    client = _Client(
        assignments_data=[
            {"id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "status": "in_progress",
             "writing_prompts": {"id": _PROMPT_ID, "title": "T",
                                  "prompt_text": "P", "task_type": "task2"}},
        ],
        drafts_data=[],
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    fake_create = _patch_essay_service(monkeypatch)

    bg = MagicMock(); bg.add_task = MagicMock()
    with pytest.raises(HTTPException) as exc:
        _run(submit_my_assignment(
            assignment_id=_ASSIGNMENT_ID,
            body=SubmitEssay(essay_text="too short"),
            background_tasks=bg,
            student=_student(),
        ))
    assert exc.value.status_code == 400
    fake_create.assert_not_called()


def test_submit_blocked_when_already_submitted(monkeypatch):
    """Status past `in_progress` → 409, grader is NEVER called.
    Re-submission would otherwise overwrite an already-graded essay."""
    client = _Client(
        assignments_data=[
            {"id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "status": "submitted",
             "writing_prompts": {"id": _PROMPT_ID, "title": "T",
                                  "prompt_text": "P", "task_type": "task2"}},
        ],
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    fake_create = _patch_essay_service(monkeypatch)

    bg = MagicMock(); bg.add_task = MagicMock()
    long_text = "Valid essay body. " * 10
    with pytest.raises(HTTPException) as exc:
        _run(submit_my_assignment(
            assignment_id=_ASSIGNMENT_ID,
            body=SubmitEssay(essay_text=long_text),
            background_tasks=bg,
            student=_student(),
        ))
    assert exc.value.status_code == 409
    fake_create.assert_not_called()
    bg.add_task.assert_not_called()


def test_submit_links_essay_and_advances_status(monkeypatch):
    """Successful submit does THREE writes against writing_assignments:
    the auto-resolution SELECT + the link UPDATE that sets essay_id +
    status='submitted' + submitted_at. Pinning this prevents a
    regression where the link silently fails and the assignment
    remains in `in_progress` while the essay is grading."""
    client = _Client(
        assignments_data=[
            {"id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "status": "in_progress",
             "writing_prompts": {"id": _PROMPT_ID, "title": "T",
                                  "prompt_text": "Some Task 2 prompt.",
                                  "task_type": "task2"}},
        ],
        drafts_data=[],
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    _patch_essay_service(monkeypatch)

    bg = MagicMock(); bg.add_task = MagicMock()
    long_text = "Valid essay body that is long enough to clear 50 chars min."
    result = _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text=long_text),
        background_tasks=bg,
        student=_student(),
    ))

    # Find the link UPDATE call.
    updates = [c for c in client.calls
               if c["table"] == "writing_assignments" and c["action"] == "update"]
    assert updates, "expected an assignment link update on submit"
    payload = updates[0]["payload"]
    assert payload["essay_id"] == "essay-uuid-eeee"
    assert payload["status"]   == "submitted"
    assert "submitted_at"      in payload
    # Draft cleanup is best-effort but should be attempted.
    assert any(c["table"] == "writing_drafts" and c["action"] == "delete"
               for c in client.calls)
    assert result["essay_id"]  == "essay-uuid-eeee"
    assert result["status"]    == "submitted"
