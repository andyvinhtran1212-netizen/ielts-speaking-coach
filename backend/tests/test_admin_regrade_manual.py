"""Tests for Phase 2.5 admin instructor view endpoints.

Three new endpoints from migration 043:

  PATCH /admin/writing/essays/{id}/instructor-note
  POST  /admin/writing/essays/{id}/regrade
  GET   /admin/students/{id}/summary

Test strategy follows test_admin_writing.py: TestClient + patched
require_admin + a per-test Supabase dispatcher mock. The
manual-edit audit fields on the existing PATCH /feedback endpoint
are also pinned here (they were extended by Phase 2.5 to stamp
is_manually_edited / last_edited_by / last_edited_at)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_ESSAY_ID   = "00000000-0000-0000-0000-000000000002"
_STUDENT_ID = "00000000-0000-0000-0000-000000000001"
_JOB_ID     = "00000000-0000-0000-0000-000000000777"


# ── Mock dispatcher ──────────────────────────────────────────────────


class _Dispatcher:
    """Table-aware MagicMock-equivalent that records every chained
    call and returns canned data per (table, action). More flexible
    than test_admin_writing._fake_supabase for the multi-table
    scenarios in regrade + student-summary."""

    def __init__(
        self,
        *,
        essays:           list[dict] | None = None,
        feedback:         list[dict] | None = None,
        assignments:      list[dict] | None = None,
        students:         list[dict] | None = None,
    ):
        self._essays      = essays      or []
        self._feedback    = feedback    or []
        self._assignments = assignments or []
        self._students    = students    or []
        self.calls: list[dict] = []

    def table(self, name):
        if name == "writing_feedback_current":   # GV-1a: view == base for single-version test data
            name = "writing_feedback"
        return _Builder(self, name)

    def _respond(self, rec):
        class _R: pass
        r = _R(); r.data = []
        t, a = rec["table"], rec["action"]

        if t == "writing_essays":
            if a == "select":
                rows = self._essays
                for col, val in rec["filters"]:
                    rows = [x for x in rows if str(x.get(col)) == str(val)]
                r.data = rows
            elif a == "update":
                r.data = [{"id": _ESSAY_ID, **(rec["payload"] or {})}]
            elif a == "delete":
                r.data = []
        elif t == "writing_feedback":
            if a == "select":
                rows = self._feedback
                for col, val in rec["filters"]:
                    rows = [x for x in rows if str(x.get(col)) == str(val)]
                r.data = rows
            elif a == "delete":
                r.data = []
        elif t == "writing_assignments":
            if a == "select":
                rows = self._assignments
                for col, val in rec["filters"]:
                    rows = [x for x in rows if str(x.get(col)) == str(val)]
                r.data = rows
        elif t == "students":
            if a == "select":
                rows = self._students
                for col, val in rec["filters"]:
                    rows = [x for x in rows if str(x.get(col)) == str(val)]
                r.data = rows
        return r


class _Builder:
    def __init__(self, parent, table):
        self._parent  = parent
        self._table   = table
        self._action  = None
        self._payload = None
        self._filters: list[tuple] = []

    def select(self, *_a, **_kw): self._action = "select"; return self
    def insert(self, payload, *_a, **_kw): self._action = "insert"; self._payload = payload; return self
    def update(self, payload, *_a, **_kw): self._action = "update"; self._payload = payload; return self
    def delete(self, *_a, **_kw): self._action = "delete"; return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def is_(self, *_a, **_kw):   return self   # R2a soft-delete passthrough (deleted_at IS NULL)
    def order(self, *_a, **_kw): return self
    def limit(self, *_a, **_kw): return self
    def in_(self, *_a, **_kw):   return self

    def execute(self):
        rec = {"table": self._table, "action": self._action,
               "payload": self._payload, "filters": list(self._filters)}
        self._parent.calls.append(rec)
        return self._parent._respond(rec)


# ── PATCH /feedback — manual-edit audit (Phase 2.5 extension) ────────


def _valid_feedback_edits() -> dict:
    """Mirrors the existing helper in test_admin_writing — keeps the
    canonical-shape edits dict in one place."""
    return {
        "overallBandScore": 7.0,
        "overallBandScoreSummary": "Sau khi admin edit.",
        "keyTakeaways": {"strengths": ["s"], "areasForImprovement": ["a"]},
        "criteriaFeedback": {
            "mainCriterion":     {"title": "T", "explanation": "x", "feedback": "y", "bandScore": 7},
            "coherenceCohesion": {"title": "T", "explanation": "x", "feedback": "y", "bandScore": 7},
            "lexicalResource":   {"title": "T", "explanation": "x", "feedback": "y", "bandScore": 7},
            "grammaticalRange":  {"title": "T", "explanation": "x", "feedback": "y", "bandScore": 7},
        },
        "mistakeAnalysis": [],
        "aiContentAnalysis": {"likelihood": 5, "explanation": "Natural"},
        "improvedEssay": "Improved.",
    }


def test_patch_feedback_stamps_manual_edit_audit_fields():
    """Sprint 2.5: the existing PATCH /feedback endpoint now also writes
    is_manually_edited=true + last_edited_by + last_edited_at.  This is
    what drives the '✏ Đã sửa thủ công' badge in the admin UI."""
    fake = _Dispatcher(essays=[{"id": _ESSAY_ID, "status": "graded"}])
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake):
        r = _client().patch(
            f"/admin/writing/essays/{_ESSAY_ID}/feedback",
            json=_valid_feedback_edits(),
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200, r.text

    update = next(c for c in fake.calls
                  if c["table"] == "writing_essays" and c["action"] == "update")
    payload = update["payload"]
    assert payload["is_manually_edited"] is True
    assert payload["last_edited_by"] == _ADMIN_USER["id"]
    assert payload["last_edited_at"]                    # truthy ISO timestamp
    # Pre-2.5 contract still holds:
    assert payload["status"] == "reviewed"
    assert payload["admin_edits_json"]["overallBandScore"] == 7.0


# ── PATCH /instructor-note ───────────────────────────────────────────


def test_instructor_note_persists_text_and_audit():
    """Note + last_edited_by/at are written; admin_edits_json is NOT
    touched (the note is a sibling field, on purpose)."""
    fake = _Dispatcher(essays=[{"id": _ESSAY_ID, "status": "delivered"}])
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake):
        r = _client().patch(
            f"/admin/writing/essays/{_ESSAY_ID}/instructor-note",
            json={"instructor_note": "Em viết tốt phần coherence, cần thêm linking words."},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["essay_id"] == _ESSAY_ID
    assert "linking words" in body["instructor_note"]

    update = next(c for c in fake.calls
                  if c["table"] == "writing_essays" and c["action"] == "update")
    payload = update["payload"]
    assert "instructor_note" in payload
    assert payload["last_edited_by"] == _ADMIN_USER["id"]
    # The note flow MUST NOT touch admin_edits_json — that's the
    # PATCH /feedback endpoint's domain.  A regression that bundled
    # them would silently overwrite Andy's structural edits.
    assert "admin_edits_json" not in payload


def test_instructor_note_empty_string_clears_note():
    """Empty string is the canonical 'clear my note' payload — the
    UI's textarea posts whatever it contains, including the empty
    state after Andy hits Backspace through it."""
    fake = _Dispatcher(essays=[{"id": _ESSAY_ID, "status": "reviewed"}])
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake):
        r = _client().patch(
            f"/admin/writing/essays/{_ESSAY_ID}/instructor-note",
            json={"instructor_note": ""},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200
    update = next(c for c in fake.calls
                  if c["table"] == "writing_essays" and c["action"] == "update")
    assert update["payload"]["instructor_note"] == ""


def test_instructor_note_blocks_pending_grading_failed():
    """Setting a note on an essay that hasn't reached `graded` yet is
    nonsense — the student's draft might still be edited and the AI
    grade hasn't run.  409 with a helpful message."""
    fake = _Dispatcher(essays=[{"id": _ESSAY_ID, "status": "pending"}])
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake):
        r = _client().patch(
            f"/admin/writing/essays/{_ESSAY_ID}/instructor-note",
            json={"instructor_note": "test"},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 409


def test_instructor_note_404_when_essay_missing():
    fake = _Dispatcher(essays=[])
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake):
        r = _client().patch(
            f"/admin/writing/essays/{_ESSAY_ID}/instructor-note",
            json={"instructor_note": "test"},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 404


def test_instructor_note_requires_auth():
    r = _client().patch(
        f"/admin/writing/essays/{_ESSAY_ID}/instructor-note",
        json={"instructor_note": "test"},
    )
    assert r.status_code == 401


# ── POST /regrade ────────────────────────────────────────────────────


def _graded_essay() -> dict:
    return {
        "id":               _ESSAY_ID,
        "student_id":       _STUDENT_ID,
        "prompt_text":      "Some prompt",
        "prompt_image_url": None,
        "essay_text":       "Some essay body.",
        "task_type":        "task2",
        "analysis_level":   3,
        "form_of_address":  "em",
        "selected_model":   "gemini-2.5-pro",
        "is_flagged":       False,
        "status":           "graded",
        "regrade_count":    0,
    }


def test_regrade_increments_count_and_resets_admin_edits():
    """SAGA legacy honored: the new AI grade supersedes any prior
    manual edit, so admin_edits_json + is_manually_edited are reset.
    instructor_note is NOT touched (it's about the student, not the
    grade — regrade shouldn't wipe Andy's personal feedback)."""
    fake = _Dispatcher(essays=[_graded_essay()])
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake), \
         patch("services.essay_service.supabase_admin", fake), \
         patch("services.essay_service.schedule_grading_job",
               return_value={"job_id": _JOB_ID, "eta_seconds": 45}), \
         patch("services.essay_service._bg_grade_essay",
               new=AsyncMock(return_value=None)):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/regrade",
            json={},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["regrade_count"] == 1
    assert body["job_id"]        == _JOB_ID
    assert body["eta_seconds"]   == 45

    update = next(c for c in fake.calls
                  if c["table"] == "writing_essays" and c["action"] == "update")
    payload = update["payload"]
    assert payload["regrade_count"]      == 1
    assert payload["last_regraded_by"]   == _ADMIN_USER["id"]
    assert payload["last_regraded_at"]
    assert payload["status"]             == "grading"
    # Resets — manual edits are gone, the new AI grade replaces them.
    assert payload["admin_edits_json"]   is None
    assert payload["is_manually_edited"] is False
    # NOT touched — instructor_note survives regrades by design.
    assert "instructor_note" not in payload


def test_regrade_increments_existing_count():
    """A second regrade goes 1 → 2; counter is monotonic."""
    essay = _graded_essay()
    essay["regrade_count"] = 1
    fake = _Dispatcher(essays=[essay])
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake), \
         patch("services.essay_service.supabase_admin", fake), \
         patch("services.essay_service.schedule_grading_job",
               return_value={"job_id": _JOB_ID, "eta_seconds": 45}), \
         patch("services.essay_service._bg_grade_essay",
               new=AsyncMock(return_value=None)):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/regrade",
            json={},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 202
    assert r.json()["regrade_count"] == 2


def test_regrade_blocks_flagged_essay():
    """Spam-flagged essays are terminal `delivered` and were never
    graded by design.  Regrading them would queue a Gemini call for
    content the spam detector already classified as not worth
    grading.  409 + admin must unflag manually first."""
    essay = _graded_essay()
    essay["is_flagged"] = True
    essay["status"]     = "delivered"
    fake = _Dispatcher(essays=[essay])
    schedule_mock = MagicMock()
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake), \
         patch("services.essay_service.supabase_admin", fake), \
         patch("services.essay_service.schedule_grading_job", schedule_mock):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/regrade",
            json={},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 409
    assert "flagged" in r.json()["detail"].lower()
    schedule_mock.assert_not_called()


def test_regrade_blocks_in_flight_essay():
    """status='grading' or 'pending' → 409.  Re-queuing would race
    with the BG grader that's already running."""
    essay = _graded_essay()
    essay["status"] = "grading"
    fake = _Dispatcher(essays=[essay])
    schedule_mock = MagicMock()
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake), \
         patch("services.essay_service.supabase_admin", fake), \
         patch("services.essay_service.schedule_grading_job", schedule_mock):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/regrade",
            json={},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 409
    schedule_mock.assert_not_called()


def test_regrade_does_not_delete_existing_feedback_row():
    """GV-1b: regrade is now versioned (DELETE→INSERT-version). The prior
    feedback row MUST be kept (it stays compare-able), so the regrade endpoint
    must NOT DELETE writing_feedback — the BG grader INSERTs the next version
    under UNIQUE(essay_id, version)."""
    fake = _Dispatcher(essays=[_graded_essay()])
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake), \
         patch("services.essay_service.supabase_admin", fake), \
         patch("services.essay_service.schedule_grading_job",
               return_value={"job_id": _JOB_ID, "eta_seconds": 45}), \
         patch("services.essay_service._bg_grade_essay",
               new=AsyncMock(return_value=None)):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/regrade",
            json={},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 202, r.text
    deletes = [c for c in fake.calls
               if c["table"] == "writing_feedback" and c["action"] == "delete"]
    assert deletes == [], "GV-1b must NOT delete prior feedback (versions are kept)"


def test_regrade_404_when_essay_missing():
    fake = _Dispatcher(essays=[])
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/regrade",
            json={},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 404


def test_regrade_requires_auth():
    r = _client().post(f"/admin/writing/essays/{_ESSAY_ID}/regrade", json={})
    assert r.status_code == 401


# ── POST /regrade — T2·1 analysis-level override ─────────────────────


def test_regrade_with_level_override_persists_and_grades_at_it():
    """T2·1: a regrade body carrying analysis_level=5 (essay is currently
    level 3) persists 5 into writing_essays.analysis_level — the column the
    BG grader re-reads — so the re-run grades at level 5.  The ETA estimate
    and the response also reflect the override.  Transition/guards/counter
    are unchanged."""
    fake = _Dispatcher(essays=[_graded_essay()])           # current level = 3
    schedule_mock = MagicMock(return_value={"job_id": _JOB_ID, "eta_seconds": 90})
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake), \
         patch("services.essay_service.supabase_admin", fake), \
         patch("services.essay_service.schedule_grading_job", schedule_mock), \
         patch("services.essay_service._bg_grade_essay",
               new=AsyncMock(return_value=None)):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/regrade",
            json={"analysis_level": 5},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 202, r.text
    assert r.json()["analysis_level"] == 5

    # Persisted into the column the grader re-reads.
    update = next(c for c in fake.calls
                  if c["table"] == "writing_essays" and c["action"] == "update")
    payload = update["payload"]
    assert payload["analysis_level"] == 5
    # Existing contract unchanged by the override.
    assert payload["status"]        == "grading"
    assert payload["regrade_count"] == 1

    # ETA estimate is computed for the chosen level.
    assert schedule_mock.call_args.kwargs["analysis_level"] == 5


def test_regrade_without_level_keeps_current():
    """T2·1: an empty body (the pre-T2·1 shape) keeps the essay's current
    level — no behaviour change for callers that don't send a level."""
    fake = _Dispatcher(essays=[_graded_essay()])           # current level = 3
    schedule_mock = MagicMock(return_value={"job_id": _JOB_ID, "eta_seconds": 45})
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake), \
         patch("services.essay_service.supabase_admin", fake), \
         patch("services.essay_service.schedule_grading_job", schedule_mock), \
         patch("services.essay_service._bg_grade_essay",
               new=AsyncMock(return_value=None)):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/regrade",
            json={},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 202, r.text
    assert r.json()["analysis_level"] == 3

    update = next(c for c in fake.calls
                  if c["table"] == "writing_essays" and c["action"] == "update")
    assert update["payload"]["analysis_level"] == 3
    assert schedule_mock.call_args.kwargs["analysis_level"] == 3


def test_regrade_rejects_out_of_range_level():
    """analysis_level is bounded 1–5 (mirrors CreateEssayRequest); a 9
    is a 422 at the Pydantic boundary and never queues a job."""
    fake = _Dispatcher(essays=[_graded_essay()])
    schedule_mock = MagicMock()
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake), \
         patch("services.essay_service.supabase_admin", fake), \
         patch("services.essay_service.schedule_grading_job", schedule_mock):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/regrade",
            json={"analysis_level": 9},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 422
    schedule_mock.assert_not_called()


# ── GET /students/{id}/summary ───────────────────────────────────────


def _student_row() -> dict:
    return {
        "id":                    _STUDENT_ID,
        "student_code":          "STU001",
        "full_name":             "Test Student",
        "target_band":           7.0,
        "current_band_estimate": 6.0,
        "target_date":           "2026-12-01",
        "persona_notes":         None,
        "flag_count":            0,
        "is_under_review":       False,
        "last_flagged_at":       None,
    }


def test_student_summary_aggregates_essays_and_assignments():
    """Returns a single payload the modal can render — student
    profile + counters + last 10 essays + last 5 assignments."""
    # Note: each row carries student_id because the dispatcher filters
    # SELECT chains by every recorded `.eq()` filter, and the endpoint
    # filters writing_essays/writing_assignments by student_id.
    essays = [
        # 3 graded non-flagged, 1 flagged — counters should reflect the split.
        {"id": "e1", "student_id": _STUDENT_ID, "status": "delivered",
         "is_flagged": False, "task_type": "task2",
         "created_at": "2026-05-07T10:00:00Z",
         "delivered_at": "2026-05-07T11:00:00Z",
         "regrade_count": 0, "last_regraded_at": None,
         "writing_feedback": [{"overall_band_score": 7.0}]},
        {"id": "e2", "student_id": _STUDENT_ID, "status": "graded",
         "is_flagged": False, "task_type": "task2",
         "created_at": "2026-05-06T10:00:00Z",
         "delivered_at": None, "regrade_count": 1,
         "last_regraded_at": "2026-05-06T11:00:00Z",
         "writing_feedback": [{"overall_band_score": 6.5}]},
        {"id": "e3", "student_id": _STUDENT_ID, "status": "delivered",
         "is_flagged": True, "task_type": "task2",
         "created_at": "2026-05-05T10:00:00Z",
         "delivered_at": "2026-05-05T11:00:00Z",
         "regrade_count": 0, "last_regraded_at": None,
         "writing_feedback": []},
        {"id": "e4", "student_id": _STUDENT_ID, "status": "reviewed",
         "is_flagged": False, "task_type": "task1_academic",
         "created_at": "2026-05-04T10:00:00Z",
         "delivered_at": None, "regrade_count": 0, "last_regraded_at": None,
         "writing_feedback": [{"overall_band_score": 6.0}]},
    ]
    assignments = [
        {"id": "a1", "student_id": _STUDENT_ID, "status": "delivered",
         "deadline": None,
         "created_at": "2026-05-07T09:00:00Z",
         "submitted_at": "2026-05-07T10:00:00Z",
         "delivered_at": "2026-05-07T11:00:00Z",
         "writing_prompts": {"title": "Education", "task_type": "task2"}},
    ]
    fake = _Dispatcher(
        students=[_student_row()],
        essays=essays,
        assignments=assignments,
    )
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake), \
         patch("services.essay_service.supabase_admin", fake), \
              patch("services.essay_service.supabase_admin", fake):
        r = _client().get(
            f"/admin/writing/students/{_STUDENT_ID}/summary",
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200, r.text
    body = r.json()

    # Profile
    assert body["student"]["student_code"] == "STU001"
    assert body["student"]["target_band"]  == 7.0

    # Stats
    s = body["stats"]
    assert s["total_essays"]   == 4
    assert s["flagged_count"]  == 1
    assert s["graded_count"]   == 3   # delivered + graded + reviewed (excl. flagged)
    # Average of [7.0, 6.5, 6.0] = 6.5 (the flagged row is skipped)
    assert s["average_band_last5"] == 6.5
    assert s["valid_band_sample"]  == 3

    # Recent slices
    assert len(body["recent_essays"])      <= 10
    assert len(body["recent_assignments"]) <= 5
    assert body["recent_assignments"][0]["writing_prompts"]["title"] == "Education"


def test_student_summary_handles_no_essays():
    """A freshly-created student with no submissions yet — counters
    all 0, average None, lists empty.  The UI renders this state as
    'Chưa có bài viết'."""
    fake = _Dispatcher(students=[_student_row()])
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake), \
         patch("services.essay_service.supabase_admin", fake), \
              patch("services.essay_service.supabase_admin", fake):
        r = _client().get(
            f"/admin/writing/students/{_STUDENT_ID}/summary",
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200
    body = r.json()
    assert body["stats"]["total_essays"]       == 0
    assert body["stats"]["flagged_count"]      == 0
    assert body["stats"]["graded_count"]       == 0
    assert body["stats"]["average_band_last5"] is None
    assert body["recent_essays"]      == []
    assert body["recent_assignments"] == []


def test_student_summary_404_when_student_missing():
    fake = _Dispatcher(students=[])
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake), \
         patch("services.essay_service.supabase_admin", fake), \
              patch("services.essay_service.supabase_admin", fake):
        r = _client().get(
            f"/admin/writing/students/{_STUDENT_ID}/summary",
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 404


def test_student_summary_requires_auth():
    r = _client().get(f"/admin/writing/students/{_STUDENT_ID}/summary")
    assert r.status_code == 401
