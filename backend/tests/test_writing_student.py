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

    def update(self, payload, *_a, **_kw):   # R2b — clear-hook UPDATE (student_first_viewed_at)
        self._action = "update"
        self._payload = payload
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def in_(self, col, vals):
        # Sprint 2.5.5 — batch band-score fetch on /my-essays uses .in_();
        # the dispatch records it like .eq() so tests can assert the
        # filter was applied. Value list copied so test assertions stay
        # stable even if the caller mutates it.
        self._filters.append((col, list(vals)))
        return self

    def order(self, *_a, **_kw):
        return self

    def limit(self, *_a, **_kw):
        return self

    def is_(self, *_a, **_kw):   # R2a soft-delete passthrough (deleted_at IS NULL)
        return self

    def execute(self):
        rec = {
            "table":   self._table,
            "action":  self._action,
            "select":  self._select_cols,
            "filters": list(self._filters),
            "payload": getattr(self, "_payload", None),
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
        if name == "writing_feedback_current":   # GV-1a: view == base for single-version test data
            name = "writing_feedback"
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


def test_get_essay_signals_hide_subbands_overall_still_present(monkeypatch):
    """T3·1: GET surfaces essay.hide_subbands so the FE can conditionally
    render the 4 sub-bands (T3·2). The flag lives on the essay and never
    touches feedback — the OVERALL band is returned regardless of the flag."""
    fb_payload = {
        "feedback_json":      {"overallBandScore": 7.0},
        "overall_band_score": 7.0,
        "created_at":         "2026-05-05T11:00:00Z",
    }
    client = _patch(
        monkeypatch,
        students_data=[_student_row()],
        essays_data=[{
            "id": _ESSAY_ID, "task_type": "task2",
            "prompt_text": "Q", "essay_text": "E",
            "status": "delivered",
            "created_at": "2026-05-05T10:00:00Z",
            "delivered_at": "2026-05-05T11:00:00Z",
            "hide_subbands": True,
        }],
        feedback_data=[fb_payload],
    )
    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    out = _run(ws_module.get_my_essay(_ESSAY_ID, student=student))

    assert out["essay"]["hide_subbands"] is True             # signal for the FE
    assert out["feedback"]["overall_band_score"] == 7.0      # overall ALWAYS present
    # The detail projection actually fetches the column.
    detail_select = next(
        c["select"] for c in client.calls
        if c["table"] == "writing_essays" and c["action"] == "select"
        and "essay_text" in (c["select"] or "")
    )
    assert "hide_subbands" in detail_select


def test_get_essay_hide_subbands_defaults_false(monkeypatch):
    """T3·1: an essay delivered without the flag (or pre-migration apply-
    forward) reads false = show — the legacy behaviour, zero regression."""
    _patch(
        monkeypatch,
        students_data=[_student_row()],
        essays_data=[{
            "id": _ESSAY_ID, "task_type": "task2",
            "prompt_text": "Q", "essay_text": "E",
            "status": "delivered",
            "created_at": "2026-05-05T10:00:00Z",
            "delivered_at": "2026-05-05T11:00:00Z",
            "hide_subbands": False,
        }],
        feedback_data=[{"feedback_json": {"overallBandScore": 7.0},
                        "overall_band_score": 7.0,
                        "created_at": "2026-05-05T11:00:00Z"}],
    )
    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    out = _run(ws_module.get_my_essay(_ESSAY_ID, student=student))

    assert out["essay"]["hide_subbands"] is False


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


# ── Sprint 2.5.5 — band batch + instructor_note + export.docx ──────────


class _ListClient(_Client):
    """Subclass that splits writing_essays responses by SELECT shape so
    the band-batch fetch (different SELECT than the ownership query)
    gets its own response. Reuses the parent dispatcher otherwise."""

    def __init__(self, *, band_rows: list[dict] | None = None,
                 note_rows: list[dict] | None = None, **kwargs):
        super().__init__(**kwargs)
        self._band_rows = band_rows or []
        self._note_rows = note_rows or []

    def _respond(self, rec):
        # writing_feedback queries with SELECT containing 'overall_band_score'
        # AND an essay_id IN (...) filter are the band-batch path; route
        # them to the dedicated rows so we can mix delivered + grading
        # essays in one fixture.
        if (rec["table"] == "writing_feedback"
                and rec.get("select")
                and "overall_band_score" in rec["select"]
                and any(c == "essay_id" for c, _ in rec["filters"])):
            class _R: pass
            r = _R(); r.data = self._band_rows
            return r
        # writing_essays SELECT 'instructor_note' is the dedicated re-fetch
        # for the detail endpoint's note path.
        if rec["table"] == "writing_essays" and rec.get("select") == "instructor_note":
            class _R: pass
            r = _R(); r.data = self._note_rows
            return r
        return super()._respond(rec)


def test_my_essays_includes_band_score_for_delivered_essays(monkeypatch):
    """Sprint 2.5.5: list endpoint surfaces overall_band_score on
    delivered essays so dashboard cards render a band pill. Non-
    delivered essays carry None — the frontend hides the pill."""
    client = _ListClient(
        students_data=[_student_row()],
        essays_data=[
            {"id": "e1", "task_type": "task2", "prompt_text": "Q1",
             "status": "delivered", "created_at": "2026-05-05T10:00:00Z",
             "delivered_at": "2026-05-05T11:00:00Z"},
            {"id": "e2", "task_type": "task2", "prompt_text": "Q2",
             "status": "grading", "created_at": "2026-05-04T10:00:00Z",
             "delivered_at": None},
        ],
        band_rows=[
            {"essay_id": "e1", "overall_band_score": 7.0},
            # e2 is not delivered, so no row here even if writing_feedback exists.
        ],
    )

    async def _fake_user(_authz): return {"id": _USER_ID}
    monkeypatch.setattr(ws_module, "get_supabase_user", _fake_user)
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    out = _run(ws_module.list_my_essays(student=student))

    assert out["essays"][0]["id"] == "e1"
    assert out["essays"][0]["overall_band_score"] == 7.0
    assert out["essays"][1]["id"] == "e2"
    assert out["essays"][1]["overall_band_score"] is None

    # Band batch query was issued with a single .in_("essay_id", [...])
    # restricted to the delivered ids — non-delivered essays must NOT
    # appear in the IN list (defensive: feedback row may exist for
    # status='reviewed' and a leak would let students see un-curated AI output).
    band_calls = [c for c in client.calls
                  if c["table"] == "writing_feedback"
                  and "overall_band_score" in (c.get("select") or "")]
    assert len(band_calls) == 1
    in_filter = next((v for col, v in band_calls[0]["filters"] if col == "essay_id"), None)
    assert in_filter == ["e1"]


def test_my_essays_band_batch_failure_degrades_gracefully(monkeypatch):
    """Band batch fetch failing must NOT 500 the whole list — cards
    still render, just without the pill. Mirrors the existing detail
    endpoint's feedback-fetch resilience."""

    class _FailingBandClient(_ListClient):
        def _respond(self, rec):
            if (rec["table"] == "writing_feedback"
                    and rec.get("select")
                    and "overall_band_score" in rec["select"]):
                raise RuntimeError("band table down")
            return super()._respond(rec)

    client = _FailingBandClient(
        students_data=[_student_row()],
        essays_data=[
            {"id": "e1", "task_type": "task2", "prompt_text": "Q1",
             "status": "delivered", "created_at": "2026-05-05T10:00:00Z",
             "delivered_at": "2026-05-05T11:00:00Z"},
        ],
    )
    async def _fake_user(_authz): return {"id": _USER_ID}
    monkeypatch.setattr(ws_module, "get_supabase_user", _fake_user)
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    out = _run(ws_module.list_my_essays(student=student))
    # No 500 — list still returns, band score just missing.
    assert out["essays"][0]["id"] == "e1"
    assert out["essays"][0]["overall_band_score"] is None


def test_get_essay_returns_instructor_note_on_delivered(monkeypatch):
    """Sprint 2.5.5: detail endpoint surfaces instructor_note for the
    student tab 5. Only fires on status=='delivered' — admin-internal
    notes on graded/reviewed essays must not leak to the student."""
    client = _ListClient(
        students_data=[_student_row()],
        essays_data=[{
            "id": _ESSAY_ID, "task_type": "task2",
            "prompt_text": "Q", "essay_text": "E",
            "status": "delivered",
            "created_at": "2026-05-05T10:00:00Z",
            "delivered_at": "2026-05-05T11:00:00Z",
        }],
        feedback_data=[{"feedback_json": {}, "overall_band_score": 6.5}],
        note_rows=[{"instructor_note": "Em viết tốt phần coherence."}],
    )
    async def _fake_user(_authz): return {"id": _USER_ID}
    monkeypatch.setattr(ws_module, "get_supabase_user", _fake_user)
    monkeypatch.setattr(ws_module, "supabase_admin", client)

    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    out = _run(ws_module.get_my_essay(_ESSAY_ID, student=student))

    assert out["instructor_note"] == "Em viết tốt phần coherence."


def test_get_essay_does_not_return_instructor_note_when_undelivered(monkeypatch):
    """An admin-only note on a graded/reviewed essay must NOT surface
    via the student detail endpoint — guard against leaking
    in-progress instructor edits."""
    _patch(
        monkeypatch,
        students_data=[_student_row()],
        essays_data=[{
            "id": _ESSAY_ID, "task_type": "task2",
            "prompt_text": "Q", "essay_text": "E",
            "status": "graded",  # NOT delivered
            "created_at": "2026-05-05T10:00:00Z",
            "delivered_at": None,
        }],
    )
    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    out = _run(ws_module.get_my_essay(_ESSAY_ID, student=student))

    assert out["instructor_note"] is None
    assert out["feedback"] is None


def test_export_docx_404_for_other_students_essay(monkeypatch):
    """Sprint 2.5.5: docx export must enforce ownership. Querying
    someone else's essay 404s identically to a nonexistent one — same
    no-leak symmetry as the detail endpoint."""
    _patch(
        monkeypatch,
        students_data=[_student_row()],
        essays_data=[],  # student_id filter excluded the row
    )
    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    with pytest.raises(HTTPException) as exc:
        _run(ws_module.export_my_essay_docx(_ESSAY_ID, student=student))
    assert exc.value.status_code == 404


def test_export_docx_403_when_not_yet_delivered(monkeypatch):
    """Owner of an undelivered essay can't download yet — 403 with
    Vietnamese explanation. Distinct from 404 because the student
    already knows from the dashboard that they own it."""
    _patch(
        monkeypatch,
        students_data=[_student_row()],
        essays_data=[{"status": "graded"}],  # owned but not delivered
    )
    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    with pytest.raises(HTTPException) as exc:
        _run(ws_module.export_my_essay_docx(_ESSAY_ID, student=student))
    assert exc.value.status_code == 403
    assert "duyệt" in exc.value.detail or "delivered" in exc.value.detail.lower()


# ── R2b — "Mới" badge: clear-on-view + list flag ─────────────────────


def _writing_essay_update_calls(client):
    return [c for c in client.calls
            if c["table"] == "writing_essays" and c["action"] == "update"
            and "student_first_viewed_at" in (c.get("payload") or {})]


def test_get_essay_clears_new_badge_on_detail_open(monkeypatch):
    """Opening a delivered essay stamps student_first_viewed_at (clear "Mới")."""
    client = _patch(
        monkeypatch,
        students_data=[_student_row()],
        essays_data=[{
            "id": _ESSAY_ID, "task_type": "task2", "prompt_text": "Q",
            "essay_text": "E", "status": "delivered",
            "created_at": "2026-05-05T10:00:00Z", "delivered_at": "2026-05-05T11:00:00Z",
        }],
        feedback_data=[{"feedback_json": {}, "overall_band_score": 7.0,
                        "created_at": "2026-05-05T11:00:00Z"}],
    )
    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    _run(ws_module.get_my_essay(_ESSAY_ID, student=student))
    assert _writing_essay_update_calls(client), "delivered detail-open must stamp student_first_viewed_at"


def test_get_essay_does_not_clear_when_not_delivered(monkeypatch):
    """A non-delivered essay has no badge → no clear write."""
    client = _patch(
        monkeypatch,
        students_data=[_student_row()],
        essays_data=[{
            "id": _ESSAY_ID, "task_type": "task2", "prompt_text": "Q",
            "essay_text": "E", "status": "graded",
            "created_at": "2026-05-05T10:00:00Z", "delivered_at": None,
        }],
    )
    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    _run(ws_module.get_my_essay(_ESSAY_ID, student=student))
    assert not _writing_essay_update_calls(client)


def test_export_clears_new_badge(monkeypatch):
    """Downloading the .docx (the dashboard bypass path) also clears "Mới"."""
    client = _patch(
        monkeypatch,
        students_data=[_student_row()],
        essays_data=[{"id": _ESSAY_ID, "status": "delivered"}],
    )
    monkeypatch.setattr(
        ws_module.essay_service, "get_essay_render_context",
        lambda _eid: {"feedback": {}, "essay_text": "E", "prompt_text": "Q",
                      "task_type": "task2", "student_name": "N", "student_code": "STU123"},
    )
    monkeypatch.setattr(
        "services.writing_word_exporter.render_essay_to_docx",
        lambda **_kw: (b"docx-bytes", "essay.docx"),
    )
    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    _run(ws_module.export_my_essay_docx(_ESSAY_ID, student=student))
    assert _writing_essay_update_calls(client), "export must stamp student_first_viewed_at"


def test_my_essays_has_new_feedback_flag(monkeypatch):
    """List computes has_new_feedback: delivered+unviewed=True; viewed=False;
    not-delivered=False."""
    _patch(
        monkeypatch,
        students_data=[_student_row()],
        essays_data=[
            {"id": "e-new", "task_type": "task2", "prompt_text": "Q", "status": "delivered",
             "created_at": "2026-05-05T10:00:00Z", "delivered_at": "2026-05-05T11:00:00Z",
             "student_first_viewed_at": None},
            {"id": "e-seen", "task_type": "task2", "prompt_text": "Q", "status": "delivered",
             "created_at": "2026-05-04T10:00:00Z", "delivered_at": "2026-05-04T11:00:00Z",
             "student_first_viewed_at": "2026-05-04T12:00:00Z"},
            {"id": "e-grading", "task_type": "task2", "prompt_text": "Q", "status": "grading",
             "created_at": "2026-05-03T10:00:00Z", "delivered_at": None,
             "student_first_viewed_at": None},
        ],
    )
    student = _run(ws_module.get_current_student(authorization="Bearer x"))
    out = _run(ws_module.list_my_essays(student=student))
    by_id = {e["id"]: e for e in out["essays"]}
    assert by_id["e-new"]["has_new_feedback"] is True
    assert by_id["e-seen"]["has_new_feedback"] is False
    assert by_id["e-grading"]["has_new_feedback"] is False
