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
        # Sprint 2.7 fix #3: atomic-claim UPDATE filters on
        # `status IN ('pending', 'in_progress')`. We capture the IN-list
        # so `_respond` can mimic Postgres's `RETURNING …` behaviour:
        # a row whose current status is outside the list yields zero
        # affected rows, which is how the router detects a lost race.
        self._in: tuple[str, list] | None = None

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
                # Sprint 2.7 fix #3: if the UPDATE carried an `.in_(col, [...])`
                # filter (the atomic claim does this on `status`), look up
                # the current row by the eq filters and short-circuit to
                # empty data when its column value is outside the list —
                # that's the "lost race" signal the router detects.
                if rec.get("in"):
                    in_col, in_vals = rec["in"]
                    matches = self._assignments
                    for col, val in rec["filters"]:
                        matches = [a for a in matches if str(a.get(col)) == str(val)]
                    if not matches or matches[0].get(in_col) not in in_vals:
                        r.data = []
                        return r
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
    """Sprint 2.7.1 SAGA: row creation and grading-job scheduling
    are split into two service functions. Tests mock both plus the
    BG grader stub so submit tests never reach the real grader.

    Returns (fake_row, fake_job) so tests can assert on call args
    (e.g. `fake_row.call_args.kwargs["data"]["paste_events"]`).
    For backward-compat the legacy combined call is also stubbed
    in case any caller path still routes through it."""
    fake_row = MagicMock(return_value={
        "essay_id":    "essay-uuid-eeee",
        "eta_seconds": 45,
    })
    fake_job = MagicMock(return_value={
        "job_id":      "job-uuid-ffff",
        "eta_seconds": 45,
    })
    fake_combined = MagicMock(return_value={
        "essay_id":    "essay-uuid-eeee",
        "job_id":      "job-uuid-ffff",
        "eta_seconds": 45,
    })
    monkeypatch.setattr(ws_module.essay_service, "create_essay_row_only", fake_row)
    monkeypatch.setattr(ws_module.essay_service, "schedule_grading_job",  fake_job)
    monkeypatch.setattr(ws_module.essay_service, "create_essay_with_job", fake_combined)
    monkeypatch.setattr(ws_module.essay_service, "_bg_grade_essay",
                        lambda *_a, **_kw: None)
    return fake_row, fake_job


def test_submit_falls_back_to_draft_text_when_body_essay_text_is_none(monkeypatch):
    """If the request body omits essay_text, submit pulls the saved
    draft. Lets a student with bad connectivity who lost the form
    submit "what was last saved" without retyping.

    Phase 2.6: the fixture must clear BOTH MIN_CHARS and MIN_WORDS
    so the new spam detector doesn't divert this case into the
    flagged path.  6 words × 25 reps = 150 words, well past the
    100-word floor."""
    saved_draft = (
        "This is the saved draft body containing meaningful content. " * 25
    )  # 150 words, ~1500 chars
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
    fake_row, fake_job = _patch_essay_service(monkeypatch)

    bg = MagicMock()
    bg.add_task = MagicMock()

    result = _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text=None),
        background_tasks=bg,
        student=_student(),
    ))

    assert result["status"] == "submitted"
    # SAGA leg 1: the essay row was created with the draft text.
    submitted_text = fake_row.call_args.kwargs["data"]["essay_text"]
    assert submitted_text == saved_draft.strip()
    # admin_id = student.user_id (audit-field caveat in handler comment).
    assert fake_row.call_args.kwargs["admin_id"] == _USER_ID
    # SAGA leg 3: grading job scheduled + BG task added.
    fake_job.assert_called_once()
    bg.add_task.assert_called_once()


def test_submit_blocked_when_already_submitted(monkeypatch):
    """Status past `in_progress` → 409. Sprint 2.7.1 SAGA: the essay
    row IS created (leg 1) but the conditional UPDATE finds no row
    matching `status IN (pending, in_progress)`, so the orphan essay
    is rolled back and grading is never scheduled.

    Pin: 409 returned, no grading job, no BG task, AND a writing_essays
    DELETE fires for the orphan."""
    client = _Client(
        assignments_data=[
            {"id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "status": "submitted",
             "writing_prompts": {"id": _PROMPT_ID, "title": "T",
                                  "prompt_text": "P", "task_type": "task2"}},
        ],
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    fake_row, fake_job = _patch_essay_service(monkeypatch)

    bg = MagicMock(); bg.add_task = MagicMock()
    # Phase 2.6: same MIN_WORDS=100 concern as the fallback test —
    # long_text must clear both length flags or the assertion would
    # fail for the wrong reason (flagged path bypasses the 409).
    long_text = "Valid essay body with multiple meaningful words here. " * 25
    with pytest.raises(HTTPException) as exc:
        _run(submit_my_assignment(
            assignment_id=_ASSIGNMENT_ID,
            body=SubmitEssay(essay_text=long_text),
            background_tasks=bg,
            student=_student(),
        ))
    assert exc.value.status_code == 409
    # SAGA leg 1 still ran (essay was created speculatively).
    fake_row.assert_called_once()
    # SAGA leg 3 must NOT have run — no grading job, no BG task.
    fake_job.assert_not_called()
    bg.add_task.assert_not_called()
    # The orphan essay was rolled back.
    deletes = [c for c in client.calls
               if c["table"] == "writing_essays" and c["action"] == "delete"]
    assert len(deletes) == 1, "expected orphan essay rollback DELETE"


def test_submit_links_essay_and_advances_status(monkeypatch):
    """Sprint 2.7.1 SAGA: the writing_assignments UPDATE is now a
    SINGLE write that carries status + submitted_at + auto_submitted
    + essay_id. The pre-2.7.1 split (claim → essay → link) is gone:
    fewer round-trips, and any post-claim crash leaves an orphan
    essay (cleanable) instead of a stuck assignment (not cleanable
    without manual SQL)."""
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
    # Phase 2.6: must clear both MIN_CHARS and MIN_WORDS so the
    # spam detector doesn't divert into the flagged path.
    long_text = "Valid essay body that is long enough and contains real content. " * 25
    result = _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text=long_text),
        background_tasks=bg,
        student=_student(),
    ))

    # SAGA: ONE conditional UPDATE on writing_assignments that does
    # status + submitted_at + auto_submitted + essay_id together.
    a_updates = [c for c in client.calls
                 if c["table"] == "writing_assignments" and c["action"] == "update"]
    assert len(a_updates) == 1, "SAGA expects exactly one writing_assignments UPDATE"

    payload = a_updates[0]["payload"]
    assert payload["status"]       == "submitted"
    assert "submitted_at"          in payload
    assert "auto_submitted"        in payload
    assert payload["essay_id"]     == "essay-uuid-eeee"

    # The single UPDATE must be `.in_()`-filtered on status so a
    # second tab whose row already moved past `in_progress` gets
    # zero rows back.
    in_filter = a_updates[0].get("in")
    assert in_filter is not None, "atomic claim must filter on status"
    assert in_filter[0] == "status"
    assert set(in_filter[1]) == {"pending", "in_progress"}

    # Draft cleanup is best-effort but should be attempted.
    assert any(c["table"] == "writing_drafts" and c["action"] == "delete"
               for c in client.calls)
    assert result["essay_id"] == "essay-uuid-eeee"
    assert result["status"]   == "submitted"


# ── Sprint 2.7.1 SAGA: lost-race protection + orphan rollback ────────


def test_submit_lost_race_rolls_back_orphan_essay(monkeypatch):
    """Two-tab race: tab A submits first, row moves to `submitted`.
    Tab B's `_resolve_active_assignment` happens to read the still-
    cached `in_progress`, but by the time the atomic claim+link
    fires the row is already past.

    Sprint 2.7.1 SAGA semantics:
      • Tab B's writing_essays row IS created (leg 1, speculative).
      • Tab B's claim UPDATE comes back empty (lost race).
      • Tab B DELETEs the orphan essay it just created (leg 2.5).
      • Tab B raises 409, no grading job, no BG task.

    The pre-2.7.1 invariant ('lost race ⇒ no essay row created')
    no longer holds — now the invariant is 'lost race ⇒ no orphan
    survives in the DB', which is what we pin here."""
    row = {
        "id":          _ASSIGNMENT_ID,
        "student_id":  _STUDENT_ID,
        "status":      "submitted",   # winning tab already advanced it
        "writing_prompts": {
            "id":          _PROMPT_ID,
            "title":       "T",
            "prompt_text": "P",
            "task_type":   "task2",
        },
    }
    client = _Client(assignments_data=[row])
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    fake_row, fake_job = _patch_essay_service(monkeypatch)

    bg = MagicMock(); bg.add_task = MagicMock()
    long_text = "Valid essay body with multiple meaningful words here. " * 25
    with pytest.raises(HTTPException) as exc:
        _run(submit_my_assignment(
            assignment_id=_ASSIGNMENT_ID,
            body=SubmitEssay(essay_text=long_text),
            background_tasks=bg,
            student=_student(),
        ))
    assert exc.value.status_code == 409
    # SAGA leg 1 fired (the speculative essay creation).
    fake_row.assert_called_once()
    # SAGA leg 3 must NOT have run.
    fake_job.assert_not_called()
    bg.add_task.assert_not_called()
    # SAGA leg 2.5: orphan rollback DELETE on writing_essays.
    deletes = [c for c in client.calls
               if c["table"] == "writing_essays" and c["action"] == "delete"]
    assert len(deletes) == 1, \
        "lost race must DELETE the orphan essay (no orphan survives)"
    # Exactly one writing_assignments UPDATE attempt fired — the
    # conditional claim that came back empty. The dispatcher records
    # the call even though Postgres would have affected zero rows.
    a_updates = [c for c in client.calls
                 if c["table"] == "writing_assignments" and c["action"] == "update"]
    assert len(a_updates) == 1, \
        "lost race: exactly one UPDATE attempt (the failed claim)"
    # And the draft must NOT have been cleaned up — that only runs
    # after a successful claim.
    draft_deletes = [c for c in client.calls
                     if c["table"] == "writing_drafts" and c["action"] == "delete"]
    assert draft_deletes == [], "lost race must not delete the draft"
