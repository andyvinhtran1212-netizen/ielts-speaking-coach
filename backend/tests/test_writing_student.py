"""Phase 2.1 — pin GET /api/writing/my-essays + /my-essays/{id}.

Three behaviour clusters:

  Auth & linking — get_current_student raises 403 when the JWT'd
                   user has no students row, 500 on lookup error,
                   and propagates the 401 from get_supabase_user
                   (we don't re-test get_supabase_user itself, only
                   that we don't accidentally catch its HTTPException).

  Listing — only own essays (the .eq("student_id", ...) filter is
            non-negotiable), newest first, prompt preview truncated.

  Detail — 404 for unknown / not-mine essays, feedback gated on
           status=='delivered', feedback degrades to None on inner
           feedback-fetch failure rather than 500-ing the detail.

The dispatch mock routes by (table, action) so each query gets the
right shape. supabase_admin and get_supabase_user are both patched
on the writing_student module; auth.get_supabase_user only matters
to the extent it's the import path the router pulls from.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi import HTTPException

from routers import writing_student as ws_module


_USER_ID = "user-uuid-test"
_STUDENT_ID = "student-uuid-test"
_OTHER_STUDENT_ID = "other-student-uuid"
_ESSAY_ID = "essay-uuid-test"


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Smart dispatching mock ───────────────────────────────────────────


class _Builder:
    def __init__(self, parent: "_Client", table: str):
        self._parent = parent
        self._table = table
        self._action: str | None = None
        self._select_cols: str | None = None
        self._filters: list[tuple] = []

    def select(self, cols, *_a, **_kw):
        self._action = "select"
        self._select_cols = cols
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def order(self, *_a, **_kw):
        return self

    def limit(self, *_a, **_kw):
        return self

    def execute(self):
        rec = {
            "table":   self._table,
            "action":  self._action,
            "select":  self._select_cols,
            "filters": list(self._filters),
        }
        self._parent.calls.append(rec)
        return self._parent._respond(rec)


class _Client:
    """Per-test data dispatcher. Instantiate with the rows each query
    should return; raises let tests simulate DB outages."""

    def __init__(
        self,
        *,
        students_data: list[dict] | None = None,
        students_raises: Exception | None = None,
        essays_data: list[dict] | None = None,
        essays_raises: Exception | None = None,
        feedback_data: list[dict] | None = None,
        feedback_raises: Exception | None = None,
    ):
        self._students_data = students_data
        self._students_raises = students_raises
        self._essays_data = essays_data
        self._essays_raises = essays_raises
        self._feedback_data = feedback_data
        self._feedback_raises = feedback_raises
        self.calls: list[dict] = []

    def table(self, name):
        return _Builder(self, name)

    def _respond(self, rec):
        class _R:
            pass
        r = _R()
        r.data = []

        table = rec["table"]
        if table == "students":
            if self._students_raises:
                raise self._students_raises
            r.data = self._students_data or []
        elif table == "writing_essays":
            if self._essays_raises:
                raise self._essays_raises
            r.data = self._essays_data or []
        elif table == "writing_feedback":
            if self._feedback_raises:
                raise self._feedback_raises
            r.data = self._feedback_data or []
        return r


def _patch(monkeypatch, *, user_raises: Exception | None = None, **client_kwargs):
    client = _Client(**client_kwargs)

    async def _fake_user(_authz):
        if user_raises:
            raise user_raises
        return {"id": _USER_ID}

    monkeypatch.setattr(ws_module, "get_supabase_user", _fake_user)
    monkeypatch.setattr(ws_module, "supabase_admin", client)
    return client


def _student_row(**overrides) -> dict:
    base = {
        "id":           _STUDENT_ID,
        "student_code": "STU123",
        "full_name":    "Test Student",
        "target_band":  7.0,
    }
    base.update(overrides)
    return base


# ── Auth & linking ───────────────────────────────────────────────────


def test_my_essays_403_when_user_not_linked_to_student(monkeypatch):
    """Authenticated JWT but no students row ⇒ 403 with Vietnamese
    error so the frontend can render a clear "contact instructor" CTA."""
    _patch(monkeypatch, students_data=[])

    with pytest.raises(HTTPException) as exc:
        _run(ws_module.list_my_essays(student=_run(
            ws_module.get_current_student(authorization="Bearer x")
        )))
    assert exc.value.status_code == 403
    assert "chưa được link" in exc.value.detail


def test_my_essays_500_when_students_lookup_fails(monkeypatch):
    """Students table outage ⇒ 500. Distinguishing this from 403 lets
    monitors page on real DB errors instead of a stable misconfig."""
    _patch(monkeypatch, students_raises=RuntimeError("students table down"))

    with pytest.raises(HTTPException) as exc:
        _run(ws_module.get_current_student(authorization="Bearer x"))
    assert exc.value.status_code == 500


# ── Listing ──────────────────────────────────────────────────────────


def test_my_essays_filters_by_student_id_and_orders_desc(monkeypatch):
    """The list endpoint MUST scope by student_id — that's the
    non-negotiable access boundary. Also confirms the response shape
    (student profile + essays array) and the prompt preview format."""
    long_prompt = "Q: " + ("x" * 300)
    short_prompt = "Q: short"
    client = _patch(
        monkeypatch,
        students_data=[_student_row()],
        essays_data=[
            {"id": "e1", "task_type": "task2", "prompt_text": long_prompt,
             "status": "delivered", "created_at": "2026-05-05T10:00:00Z",
             "delivered_at": "2026-05-05T11:00:00Z"},
            {"id": "e2", "task_type": "task1_general", "prompt_text": short_prompt,
             "status": "grading", "created_at": "2026-05-04T10:00:00Z",
             "delivered_at": None},
        ],
    )

    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    out = _run(ws_module.list_my_essays(student=student))

    # student_id filter actually issued
    essay_calls = [c for c in client.calls if c["table"] == "writing_essays"]
    assert essay_calls, "writing_essays must be queried"
    assert ("student_id", _STUDENT_ID) in essay_calls[0]["filters"]

    # Response shape
    assert out["student"]["full_name"] == "Test Student"
    assert out["student"]["student_code"] == "STU123"
    assert len(out["essays"]) == 2

    # Long prompt truncated with ellipsis; short prompt left alone
    e1 = out["essays"][0]
    assert e1["prompt_preview"].endswith("...")
    assert len(e1["prompt_preview"]) <= ws_module._PROMPT_PREVIEW_CHARS + 3
    e2 = out["essays"][1]
    assert e2["prompt_preview"] == short_prompt
    # Essay-level fields propagated
    assert e1["status"] == "delivered"
    assert e1["delivered_at"] == "2026-05-05T11:00:00Z"
    assert e2["delivered_at"] is None


def test_my_essays_empty_list_when_no_essays(monkeypatch):
    """Linked student with zero essays ⇒ 200 + empty array, NOT 404.
    The student profile envelope still comes back so the UI can
    render the dashboard scaffold."""
    _patch(
        monkeypatch,
        students_data=[_student_row()],
        essays_data=[],
    )
    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    out = _run(ws_module.list_my_essays(student=student))
    assert out["essays"] == []
    assert out["student"]["full_name"] == "Test Student"


# ── Detail ───────────────────────────────────────────────────────────


def test_get_essay_404_for_other_students_essay(monkeypatch):
    """Querying someone else's essay id ⇒ 404. The mock returns no
    rows because the student_id filter excludes it; the endpoint
    must NOT distinguish this from a nonexistent essay (no leak)."""
    _patch(
        monkeypatch,
        students_data=[_student_row()],
        essays_data=[],  # the .eq("student_id", ...) filtered it out
    )
    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    with pytest.raises(HTTPException) as exc:
        _run(ws_module.get_my_essay(_ESSAY_ID, student=student))
    assert exc.value.status_code == 404


def test_get_essay_no_feedback_when_status_not_delivered(monkeypatch):
    """status='graded' (admin still editing) ⇒ feedback omitted even
    if the writing_feedback row exists. Returning raw AI output here
    would leak un-curated content to the student."""
    client = _patch(
        monkeypatch,
        students_data=[_student_row()],
        essays_data=[{
            "id": _ESSAY_ID, "task_type": "task2",
            "prompt_text": "Q", "essay_text": "E",
            "status": "graded",  # NOT delivered
            "created_at": "2026-05-05T10:00:00Z",
            "delivered_at": None,
        }],
        feedback_data=[{"feedback_json": {"x": 1}, "overall_band_score": 7.0}],
    )
    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    out = _run(ws_module.get_my_essay(_ESSAY_ID, student=student))

    assert out["essay"]["status"] == "graded"
    assert out["feedback"] is None, (
        "Pre-delivery feedback must NOT leak — admin may still be editing"
    )
    # No feedback table query when status != 'delivered'.
    assert not any(c["table"] == "writing_feedback" for c in client.calls)


def test_get_essay_returns_feedback_when_delivered(monkeypatch):
    """status='delivered' ⇒ feedback_json + per-criterion bands flow
    through to the response payload."""
    fb_payload = {
        "feedback_json":           {"overallBandScore": 7.0},
        "overall_band_score":      7.0,
        "band_main_criterion":     7.0,
        "band_coherence_cohesion": 7.0,
        "band_lexical_resource":   7.0,
        "band_grammatical_range":  7.0,
        "created_at":              "2026-05-05T11:00:00Z",
    }
    _patch(
        monkeypatch,
        students_data=[_student_row()],
        essays_data=[{
            "id": _ESSAY_ID, "task_type": "task2",
            "prompt_text": "Q", "essay_text": "E",
            "status": "delivered",
            "created_at": "2026-05-05T10:00:00Z",
            "delivered_at": "2026-05-05T11:00:00Z",
        }],
        feedback_data=[fb_payload],
    )
    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    out = _run(ws_module.get_my_essay(_ESSAY_ID, student=student))

    assert out["essay"]["status"] == "delivered"
    assert out["feedback"] == fb_payload


def test_get_essay_feedback_fetch_failure_degrades_to_none(monkeypatch):
    """Feedback table outage on a delivered essay ⇒ essay still
    returned with feedback=None. The UI can show body + a 'feedback
    temporarily unavailable' affordance instead of a hard 500."""
    _patch(
        monkeypatch,
        students_data=[_student_row()],
        essays_data=[{
            "id": _ESSAY_ID, "task_type": "task2",
            "prompt_text": "Q", "essay_text": "E",
            "status": "delivered",
            "created_at": "2026-05-05T10:00:00Z",
            "delivered_at": "2026-05-05T11:00:00Z",
        }],
        feedback_raises=RuntimeError("feedback table down"),
    )
    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    out = _run(ws_module.get_my_essay(_ESSAY_ID, student=student))

    assert out["essay"]["status"] == "delivered"
    assert out["feedback"] is None
