"""Tests for Sprint 2.6.1 — explicit /start endpoint, paste-event log,
and the paste-events transfer onto writing_essays at submit time.

Strategy mirrors test_writing_student_spam_flow.py:
  • Direct async-handler invocation, table-aware mock dispatcher.
  • The dispatcher is intentionally minimal — each test seeds only
    the rows it cares about and asserts on the calls list, so a
    regression that drops a write surfaces here even if the response
    shape happens to look correct.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent))

from routers import writing_student as ws_module
from routers.writing_student import (
    PasteLog,
    SubmitEssay,
    log_paste,
    start_assignment,
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


# ── Mock dispatcher ──────────────────────────────────────────────────


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
    def __init__(self, *, assignments_data=None, drafts_data=None,
                 student_row=None, essay_id=_ESSAY_ID):
        self._assignments = assignments_data or []
        self._drafts      = drafts_data or []
        self._student_row = student_row or {"flag_count": 0, "is_under_review": False}
        self._essay_id    = essay_id
        self.calls: list[dict] = []
        # Sprint 2.7 fix #5: paste-log now goes through .rpc() instead
        # of read-modify-write. The dispatcher records the call and
        # returns a count derived from the seeded drafts so existing
        # tests keep their "total_events == N+1" semantics.
        self.rpc_calls: list[dict] = []

    def table(self, name): return _Builder(self, name)

    def rpc(self, name, params):
        # Lazy mock object that records the call on .execute() so the
        # test bodies can assert the right arguments were passed.
        client_self = self
        class _RpcCall:
            def execute(self_rpc):
                rec = {"name": name, "params": params}
                client_self.rpc_calls.append(rec)
                # Compute the would-be total: matching draft's events
                # array length + 1, or 1 if no draft exists.
                aid = str(params.get("p_assignment_id"))
                match = next(
                    (d for d in client_self._drafts
                     if str(d.get("assignment_id")) == aid),
                    None,
                )
                prior = len((match or {}).get("paste_events") or [])
                class _R: pass
                r = _R()
                r.data = prior + 1
                return r
        return _RpcCall()

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
                # Sprint 2.7 fix #3: honor `.in_()` on atomic claim.
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
            elif a in ("insert", "update", "upsert"):
                r.data = [rec["payload"]]
            elif a == "delete":
                r.data = []
        elif t == "writing_essays":
            if a == "insert":
                r.data = [{"id": self._essay_id, **(rec["payload"] or {})}]
            elif a == "update":
                r.data = [{"id": rec["filters"][0][1] if rec["filters"] else None,
                           **(rec["payload"] or {})}]
        elif t == "students":
            if a == "select":
                r.data = [self._student_row]
            elif a == "update":
                r.data = [{"id": rec["filters"][0][1] if rec["filters"] else None,
                           **(rec["payload"] or {})}]
        return r


# ── /start ───────────────────────────────────────────────────────────


def test_start_stamps_started_at_when_null(monkeypatch):
    """A pending timed assignment that hasn't run before → /start
    stamps `started_at` AND transitions status to in_progress.
    Returns a timer state with a positive `time_remaining_seconds`
    so the frontend can immediately render the countdown."""
    client = _Client(assignments_data=[
        {"id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
         "status": "pending",
         "is_timed": True, "time_limit_minutes": 40,
         "started_at": None, "auto_submitted": False},
    ])
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    result = _run(start_assignment(
        assignment_id=_ASSIGNMENT_ID,
        student=_student(),
    ))

    assert result["started"] is True
    timer = result["timer"]
    assert timer["is_timed"] is True
    assert timer["time_remaining_seconds"] is not None
    assert timer["time_remaining_seconds"] > 0
    assert timer["status"] == "in_progress"

    updates = [c for c in client.calls
               if c["table"] == "writing_assignments" and c["action"] == "update"]
    assert len(updates) == 1
    payload = updates[0]["payload"]
    assert "started_at" in payload
    assert payload["status"] == "in_progress"


def test_start_does_not_overwrite_existing_started_at(monkeypatch):
    """Re-clicking "Làm bài" on an already-running timer must NOT
    reset the clock.  Pinning this prevents a regression where the
    student loses time on every re-open."""
    pre_existing = "2026-05-06T10:00:00+00:00"
    client = _Client(assignments_data=[
        {"id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
         "status": "in_progress",
         "is_timed": True, "time_limit_minutes": 40,
         "started_at": pre_existing, "auto_submitted": False},
    ])
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    _run(start_assignment(
        assignment_id=_ASSIGNMENT_ID,
        student=_student(),
    ))

    updates = [c for c in client.calls
               if c["table"] == "writing_assignments" and c["action"] == "update"]
    # Either no update at all, or an update whose payload doesn't
    # touch `started_at` (status is already in_progress so neither
    # field needs writing).
    if updates:
        assert "started_at" not in (updates[0]["payload"] or {})


def test_start_blocks_after_submission(monkeypatch):
    """A submitted/graded/delivered row → 409.  Restarting the timer
    on a row the grader already touched would either lose grading
    work or silently accept new edits past submit."""
    client = _Client(assignments_data=[
        {"id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
         "status": "submitted",
         "is_timed": True, "time_limit_minutes": 40,
         "started_at": "2026-05-06T10:00:00+00:00", "auto_submitted": False},
    ])
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    with pytest.raises(HTTPException) as excinfo:
        _run(start_assignment(
            assignment_id=_ASSIGNMENT_ID,
            student=_student(),
        ))
    assert excinfo.value.status_code == 409


def test_start_404_on_wrong_owner(monkeypatch):
    """Symmetric 404 for a row belonging to another student — same
    rule the rest of the file already follows."""
    client = _Client(assignments_data=[])  # nothing matches
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    with pytest.raises(HTTPException) as excinfo:
        _run(start_assignment(
            assignment_id=_ASSIGNMENT_ID,
            student=_student(),
        ))
    assert excinfo.value.status_code == 404


# ── /paste-log ───────────────────────────────────────────────────────


def test_paste_log_appends_via_rpc(monkeypatch):
    """A draft already exists with one prior paste event — the
    /paste-log endpoint dispatches to the `append_paste_event` RPC
    (migration 042) and returns the new total. Pin: the RPC is the
    one and only write the endpoint issues; no SELECT-then-UPDATE
    pattern remains."""
    prior = {"at": "2026-05-06T10:00:00+00:00", "char_count": 60, "blocked": False}
    client = _Client(
        assignments_data=[
            {"id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "status": "in_progress"},
        ],
        drafts_data=[
            {"assignment_id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "draft_text": "existing", "paste_events": [prior]},
        ],
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    result = _run(log_paste(
        assignment_id=_ASSIGNMENT_ID,
        body=PasteLog(char_count=120, blocked=False),
        student=_student(),
    ))

    assert result == {"logged": True, "total_events": 2}

    # The RPC must be the only mutation against writing_drafts —
    # no fallback UPDATE / INSERT / DELETE.
    assert len(client.rpc_calls) == 1
    call = client.rpc_calls[0]
    assert call["name"] == "append_paste_event"
    assert call["params"]["p_assignment_id"] == _ASSIGNMENT_ID
    assert call["params"]["p_student_id"]    == _STUDENT_ID
    event = call["params"]["p_event"]
    assert event["char_count"] == 120
    assert event["blocked"]    is False

    # The pre-2.7 SELECT-then-UPDATE pattern must be gone.
    assert not any(
        c["table"] == "writing_drafts" and c["action"] in ("update", "insert")
        for c in client.calls
    )


def test_paste_log_creates_draft_via_rpc_when_missing(monkeypatch):
    """Student pastes BEFORE typing anything → no draft row exists
    yet. The RPC's INSERT...ON CONFLICT path creates the row with
    the first event; we observe the RPC fires and the response total
    is 1."""
    client = _Client(
        assignments_data=[
            {"id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "status": "in_progress"},
        ],
        drafts_data=[],  # no draft yet
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    result = _run(log_paste(
        assignment_id=_ASSIGNMENT_ID,
        body=PasteLog(char_count=300, blocked=True),
        student=_student(),
    ))

    assert result == {"logged": True, "total_events": 1}

    assert len(client.rpc_calls) == 1
    event = client.rpc_calls[0]["params"]["p_event"]
    assert event["char_count"] == 300
    assert event["blocked"]    is True

    # No legacy paths.
    assert not any(
        c["table"] == "writing_drafts" and c["action"] in ("update", "insert", "select")
        for c in client.calls
    )


def test_paste_log_blocks_on_submitted_assignment(monkeypatch):
    """Status past in_progress → 409.  No point logging pastes on a
    locked row, and the writing_drafts row is gone post-submit
    anyway."""
    client = _Client(assignments_data=[
        {"id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
         "status": "submitted"},
    ])
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    with pytest.raises(HTTPException) as excinfo:
        _run(log_paste(
            assignment_id=_ASSIGNMENT_ID,
            body=PasteLog(char_count=120, blocked=False),
            student=_student(),
        ))
    assert excinfo.value.status_code == 409


# ── Paste-events transfer at submit ──────────────────────────────────


def test_clean_submit_transfers_paste_events_to_essay(monkeypatch):
    """Happy-path submit: the draft's paste_events array gets copied
    onto writing_essays via a follow-up UPDATE after
    create_essay_with_job. suspicious_paste flips on because one
    event has char_count >= 50."""
    paste = [
        {"at": "2026-05-06T10:00:00+00:00", "char_count": 75, "blocked": False},
    ]
    long_essay = "Valid essay body with multiple meaningful words here. " * 25
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
             "draft_text": "stale", "paste_events": paste},
        ],
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    fake_create = MagicMock(return_value={
        "essay_id":    _ESSAY_ID,
        "job_id":      "job-uuid",
        "eta_seconds": 60,
    })
    monkeypatch.setattr(ws_module.essay_service, "create_essay_with_job", fake_create)

    bg = MagicMock(); bg.add_task = MagicMock()
    _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text=long_essay),
        background_tasks=bg,
        student=_student(),
    ))

    e_updates = [c for c in client.calls
                 if c["table"] == "writing_essays" and c["action"] == "update"]
    assert e_updates, "expected a paste-audit UPDATE on writing_essays"
    payload = e_updates[0]["payload"]
    assert payload["paste_events"]     == paste
    assert payload["suspicious_paste"] is True


def test_clean_submit_no_paste_events_no_audit_update(monkeypatch):
    """If the draft never had paste events, we skip the follow-up
    UPDATE entirely — no point burning a round-trip to write an
    empty array onto the row's existing default '[]'."""
    long_essay = "Valid essay body with multiple meaningful words here. " * 25
    client = _Client(
        assignments_data=[
            {"id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "status": "in_progress",
             "writing_prompts": {"id": _PROMPT_ID, "title": "T",
                                  "prompt_text": "Some Task 2 prompt.",
                                  "task_type": "task2"}},
        ],
        drafts_data=[],  # no draft, no events
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    fake_create = MagicMock(return_value={
        "essay_id":    _ESSAY_ID,
        "job_id":      "job-uuid",
        "eta_seconds": 60,
    })
    monkeypatch.setattr(ws_module.essay_service, "create_essay_with_job", fake_create)

    bg = MagicMock(); bg.add_task = MagicMock()
    _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text=long_essay),
        background_tasks=bg,
        student=_student(),
    ))

    e_updates = [c for c in client.calls
                 if c["table"] == "writing_essays" and c["action"] == "update"]
    assert e_updates == []


def test_flagged_submit_carries_paste_events_into_insert(monkeypatch):
    """Flagged path: paste_events + suspicious_paste land directly on
    the writing_essays INSERT payload (no follow-up UPDATE because
    we never call create_essay_with_job here)."""
    paste = [
        {"at": "2026-05-06T10:00:00+00:00", "char_count": 220, "blocked": True},
    ]
    client = _Client(
        assignments_data=[
            {"id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "status": "in_progress",
             "writing_prompts": {"id": _PROMPT_ID, "title": "T",
                                  "prompt_text": "P", "task_type": "task2"}},
        ],
        drafts_data=[
            {"assignment_id": _ASSIGNMENT_ID, "student_id": _STUDENT_ID,
             "draft_text": "x", "paste_events": paste},
        ],
        student_row={"flag_count": 0, "is_under_review": False},
    )
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    fake_create = MagicMock()  # MUST NOT be called on flagged path
    monkeypatch.setattr(ws_module.essay_service, "create_essay_with_job", fake_create)

    bg = MagicMock(); bg.add_task = MagicMock()
    _run(submit_my_assignment(
        assignment_id=_ASSIGNMENT_ID,
        body=SubmitEssay(essay_text="too short"),
        background_tasks=bg,
        student=_student(),
    ))

    fake_create.assert_not_called()
    inserts = [c for c in client.calls
               if c["table"] == "writing_essays" and c["action"] == "insert"]
    assert len(inserts) == 1
    payload = inserts[0]["payload"]
    assert payload["is_flagged"]       is True
    assert payload["paste_events"]     == paste
    assert payload["suspicious_paste"] is True
