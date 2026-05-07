"""Sprint 2.7 fix #1 (MED): cross-student isolation pinning.

The student-facing routers all run through `supabase_admin` (RLS
bypass) but defend against cross-student reads with explicit
`.eq("student_id", student["id"])` filters. The Codex audit flagged
that this is a single line of defense per endpoint — if a refactor
ever drops the filter, no test catches it.

This file pins the contract: when a logged-in student A asks for
student B's data through any of the eight student endpoints, the
response is either 404 (detail / mutate) or empty (list).  No row
content for B leaks through.

Pattern per test:
  • Seed the dispatcher with a single row owned by student B.
  • Call the handler with student A's identity.
  • Assert 404 / empty.

We deliberately reuse the table-aware mock dispatcher pattern from
the other writing-student tests rather than spinning up TestClient
+ dependency overrides — it lets us pin the SQL filter (eq on
student_id) instead of just the response code, so a regression that
silently relaxes the filter still surfaces here.
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
    PasteLog,
    SubmitEssay,
    get_my_assignment,
    get_my_essay,
    get_timer_state,
    list_my_assignments,
    list_my_essays,
    log_paste,
    start_assignment,
    submit_my_assignment,
    upsert_my_draft,
)


# Student A (the logged-in caller).  Anything seeded onto a row
# carrying these IDs is OWNED by A and the endpoint should return it.
_A_USER       = "user-uuid-aaaa"
_A_STUDENT    = "student-uuid-aaaa"

# Student B (the rightful owner of the seeded data).  When A asks
# for any of B's rows the endpoint must respond as if the row didn't
# exist.
_B_USER       = "user-uuid-bbbb"
_B_STUDENT    = "student-uuid-bbbb"

_ASSIGN_ID    = "assign-uuid-zzzz"
_ESSAY_ID     = "essay-uuid-zzzz"
_PROMPT_ID    = "prompt-uuid-zzzz"


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _student_a() -> dict:
    """The logged-in caller in every test below."""
    return {
        "id":           _A_STUDENT,
        "user_id":      _A_USER,
        "student_code": "STU-A",
        "full_name":    "Student A",
        "target_band":  7.0,
    }


# ── Mock dispatcher ──────────────────────────────────────────────────


class _Builder:
    """Filters every chained query the same way the real Postgres
    rows would: an `.eq(student_id, X)` excludes rows owned by anyone
    other than X. That's the load-bearing assertion in this file —
    if a router stops adding the filter, the dispatcher silently
    starts returning B's row and the test fails."""
    def __init__(self, parent, table):
        self._parent  = parent
        self._table   = table
        self._action  = None
        self._payload = None
        self._filters: list[tuple] = []

    def select(self, *_a, **_kw): self._action = "select"; return self
    def insert(self, payload, *_a, **_kw): self._action = "insert"; self._payload = payload; return self
    def upsert(self, payload, *_a, **_kw): self._action = "upsert"; self._payload = payload; return self
    def update(self, payload, *_a, **_kw): self._action = "update"; self._payload = payload; return self
    def delete(self, *_a, **_kw): self._action = "delete"; return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def order(self, *_a, **_kw):  return self
    def limit(self, *_a, **_kw):  return self
    def in_(self, *_a, **_kw):    return self

    def execute(self):
        rec = {
            "table":   self._table,
            "action":  self._action,
            "filters": list(self._filters),
        }
        self._parent.calls.append(rec)
        return self._parent._respond(rec)


class _Client:
    def __init__(
        self,
        *,
        essays_data:      list[dict] | None = None,
        assignments_data: list[dict] | None = None,
        drafts_data:      list[dict] | None = None,
    ):
        self._essays      = essays_data or []
        self._assignments = assignments_data or []
        self._drafts      = drafts_data or []
        self.calls: list[dict] = []

    def table(self, name): return _Builder(self, name)

    def _respond(self, rec):
        class _R: pass
        r = _R(); r.data = []
        t, a = rec["table"], rec["action"]

        if a == "select":
            rows = {
                "writing_essays":      self._essays,
                "writing_assignments": self._assignments,
                "writing_drafts":      self._drafts,
            }.get(t, [])
            for col, val in rec["filters"]:
                rows = [x for x in rows if str(x.get(col)) == str(val)]
            r.data = rows
        elif a in ("insert", "upsert"):
            r.data = []
        elif a in ("update", "delete"):
            r.data = []
        return r


def _b_owned_essay() -> dict:
    return {
        "id":           _ESSAY_ID,
        "student_id":   _B_STUDENT,
        "task_type":    "task2",
        "prompt_text":  "Some Task 2 prompt about education.",
        "essay_text":   "B's private essay body — must not leak.",
        "status":       "delivered",
        "created_at":   "2026-05-06T10:00:00Z",
        "delivered_at": "2026-05-06T11:00:00Z",
        "is_flagged":   False,
        "flag_reasons": [],
    }


def _b_owned_assignment(*, status: str = "in_progress") -> dict:
    return {
        "id":            _ASSIGN_ID,
        "student_id":    _B_STUDENT,
        "status":        status,
        "deadline":      None,
        "instructions":  None,
        "created_at":    "2026-05-06T09:00:00Z",
        "submitted_at":  None,
        "delivered_at":  None,
        "essay_id":      None,
        "is_timed":      False,
        "time_limit_minutes": None,
        "started_at":    None,
        "auto_submitted": False,
        "writing_prompts": {
            "id":          _PROMPT_ID,
            "title":       "B's prompt",
            "prompt_text": "B's private prompt.",
            "task_type":   "task2",
            "difficulty":  "intermediate",
        },
    }


# ── Tests ────────────────────────────────────────────────────────────


def test_my_essays_list_filters_out_other_student_rows(monkeypatch):
    """`GET /api/writing/my-essays` must NOT surface B's essays in
    A's list. The endpoint runs `.eq("student_id", student.id)` —
    drop that filter and B's row leaks straight into A's dashboard."""
    client = _Client(essays_data=[_b_owned_essay()])
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    result = _run(list_my_essays(student=_student_a()))
    assert result["essays"] == [], "B's essay must not appear in A's list"


def test_my_essay_detail_404s_on_other_student_row(monkeypatch):
    """`GET /api/writing/my-essays/{id}` must 404 when the essay is
    owned by someone else — same response as a nonexistent id, no
    way for A to probe whether a given uuid even exists for B."""
    client = _Client(essays_data=[_b_owned_essay()])
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    with pytest.raises(HTTPException) as exc:
        _run(get_my_essay(essay_id=_ESSAY_ID, student=_student_a()))
    assert exc.value.status_code == 404


def test_my_assignments_list_filters_out_other_student_rows(monkeypatch):
    """`GET /api/writing/my-assignments` returns only rows where
    student_id matches the caller."""
    client = _Client(assignments_data=[_b_owned_assignment()])
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    result = _run(list_my_assignments(status_filter=None, student=_student_a()))
    assert result["assignments"] == []


def test_my_assignment_detail_404s_on_other_student_row(monkeypatch):
    """`GET /api/writing/my-assignments/{id}` 404s for B's rows.
    Both filters (id + student_id) must be present — the SELECT in
    `_resolve_active_assignment` hard-codes this contract."""
    client = _Client(assignments_data=[_b_owned_assignment()])
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    with pytest.raises(HTTPException) as exc:
        _run(get_my_assignment(assignment_id=_ASSIGN_ID, student=_student_a()))
    assert exc.value.status_code == 404


def test_draft_upsert_404s_on_other_student_assignment(monkeypatch):
    """`PATCH /api/writing/my-assignments/{id}/draft` resolves the
    assignment first; a wrong-owner row makes the resolve 404 BEFORE
    any write happens. Pin: no upsert is ever issued against
    writing_drafts for B's assignment."""
    client = _Client(assignments_data=[_b_owned_assignment()])
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    with pytest.raises(HTTPException) as exc:
        _run(upsert_my_draft(
            assignment_id=_ASSIGN_ID,
            body=DraftUpsert(draft_text="A trying to write into B's row"),
            student=_student_a(),
        ))
    assert exc.value.status_code == 404
    # Confirm we never reached the writing_drafts upsert.
    assert not any(
        c["table"] == "writing_drafts" and c["action"] in ("upsert", "insert")
        for c in client.calls
    )


def test_submit_404s_on_other_student_assignment(monkeypatch):
    """`POST /api/writing/my-assignments/{id}/submit` 404s before
    the spam detector or the atomic claim runs. essay_service must
    NEVER be invoked with B's assignment id."""
    client = _Client(assignments_data=[_b_owned_assignment()])
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    fake_create = MagicMock()
    monkeypatch.setattr(ws_module.essay_service, "create_essay_with_job", fake_create)

    bg = MagicMock(); bg.add_task = MagicMock()
    with pytest.raises(HTTPException) as exc:
        _run(submit_my_assignment(
            assignment_id=_ASSIGN_ID,
            body=SubmitEssay(essay_text="A trying to submit B's row " * 30),
            background_tasks=bg,
            student=_student_a(),
        ))
    assert exc.value.status_code == 404
    fake_create.assert_not_called()
    bg.add_task.assert_not_called()


def test_start_404s_on_other_student_assignment(monkeypatch):
    """`POST /api/writing/my-assignments/{id}/start` 404s without
    stamping `started_at` on B's row. The /start endpoint does its
    own SELECT-with-student_id-filter, separate from
    `_resolve_active_assignment`, so it gets its own pin here."""
    client = _Client(assignments_data=[_b_owned_assignment(status="pending")])
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    with pytest.raises(HTTPException) as exc:
        _run(start_assignment(
            assignment_id=_ASSIGN_ID,
            student=_student_a(),
        ))
    assert exc.value.status_code == 404
    assert not any(
        c["table"] == "writing_assignments" and c["action"] == "update"
        for c in client.calls
    )


def test_timer_404s_on_other_student_assignment(monkeypatch):
    """`GET /api/writing/my-assignments/{id}/timer` 404s. The timer
    endpoint is the only one a student polls every 30s — if the
    student_id filter ever drops, B's clock state would leak via
    `time_remaining_seconds` even before any write side-effect."""
    client = _Client(assignments_data=[_b_owned_assignment()])
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    with pytest.raises(HTTPException) as exc:
        _run(get_timer_state(
            assignment_id=_ASSIGN_ID,
            student=_student_a(),
        ))
    assert exc.value.status_code == 404


def test_paste_log_404s_on_other_student_assignment(monkeypatch):
    """`POST /api/writing/my-assignments/{id}/paste-log` 404s before
    appending anything to B's writing_drafts row. The paste-events
    array is part of the moderation audit trail — corrupting a row
    cross-student would taint the wrong student's record."""
    client = _Client(
        assignments_data=[_b_owned_assignment()],
        drafts_data=[
            {"assignment_id": _ASSIGN_ID, "student_id": _B_STUDENT,
             "draft_text": "B's draft", "paste_events": []},
        ],
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    with pytest.raises(HTTPException) as exc:
        _run(log_paste(
            assignment_id=_ASSIGN_ID,
            body=PasteLog(char_count=120, blocked=False),
            student=_student_a(),
        ))
    assert exc.value.status_code == 404
    # No draft writes whatsoever.
    assert not any(
        c["table"] == "writing_drafts" and c["action"] in ("update", "insert")
        for c in client.calls
    )
