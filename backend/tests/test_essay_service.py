"""Tests for services.essay_service (Sprint W2 Phase 2).

Service-level coverage for ETA lookup, helpers, and the BG grader's
success/failure paths. supabase_admin and the Gemini grader are both
mocked — no DB IO, no network IO. Router-level wiring is covered in
test_admin_writing.py.
"""

from __future__ import annotations

from typing import Optional
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from models.writing_feedback import WritingFeedback
from services import essay_service
from services.gemini_writing_grader import (
    AISafetyBlockError,
    APIRetryFailedError,
)


_ADMIN_ID = "00000000-0000-0000-0000-00000000aaaa"
_STUDENT_ID = "00000000-0000-0000-0000-000000000001"
_ESSAY_ID = "00000000-0000-0000-0000-000000000002"
_JOB_ID = "00000000-0000-0000-0000-000000000003"


# ── ETA lookup ───────────────────────────────────────────────────────

@pytest.mark.parametrize("level,model,expected", [
    (1, "gemini-2.5-flash", 15),
    (3, "gemini-2.5-pro",   45),
    (5, "gemini-2.5-pro",   90),
    # Unmapped combos fall back to default
    (2, "gemini-2.5-pro",   60),
    (4, "gemini-2.5-flash", 60),
])
def test_estimate_eta_seconds(level, model, expected):
    assert essay_service.estimate_eta_seconds(
        analysis_level=level, selected_model=model,
    ) == expected


# ── Word count helper ────────────────────────────────────────────────

def test_word_count_simple():
    assert essay_service._word_count("hello world this is a test") == 6


def test_word_count_handles_extra_whitespace():
    assert essay_service._word_count("  hello   world  ") == 2


def test_word_count_empty():
    assert essay_service._word_count("") == 0


# ── Supabase chain stub helper ───────────────────────────────────────

class _FakeSupabase:
    """Stub mimicking the Supabase fluent client.

    Records every (table, op, payload, filters) tuple so tests can assert
    the exact sequence of writes. Configurable per-table responses.
    """

    def __init__(self, responses: dict | None = None) -> None:
        # responses: {("table", "op"): list_of_data}, defaults to []
        self.responses = responses or {}
        self.calls: list[dict] = []

    def table(self, name: str) -> "_FakeQuery":
        return _FakeQuery(self, name)


class _FakeQuery:
    def __init__(self, parent: _FakeSupabase, table: str) -> None:
        self._parent = parent
        self._table = table
        self._op: Optional[str] = None  # type: ignore[name-defined]
        self._payload = None
        self._filters: list[tuple] = []
        self._select: Optional[str] = None  # type: ignore[name-defined]

    # Mutations
    def insert(self, payload):
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def select(self, cols):
        self._op = "select"
        self._select = cols
        return self

    # Filters & ordering (no-ops for assertions, recorded only)
    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def is_(self, col, val):
        self._filters.append(("is_", col, val))
        return self

    def order(self, *a, **kw):
        return self

    def limit(self, *a, **kw):
        return self

    def range(self, *a, **kw):
        return self

    def execute(self):
        key = (self._table, self._op)
        data = self._parent.responses.get(key, [])
        self._parent.calls.append({
            "table":    self._table,
            "op":       self._op,
            "payload":  self._payload,
            "filters":  list(self._filters),
            "select":   self._select,
        })
        return MagicMock(data=data)


# ── create_essay_with_job ────────────────────────────────────────────

def _valid_create_data() -> dict:
    return {
        "student_id":      _STUDENT_ID,
        "task_type":       "task2",
        "prompt_text":     "Some prompt",
        "essay_text":      "This is a sample essay for testing the word count logic.",
        "analysis_level":  3,
        "form_of_address": "em",
        "selected_model":  "gemini-2.5-pro",
    }


def test_create_essay_with_job_happy_path():
    fake = _FakeSupabase(responses={
        ("students", "select"): [{"id": _STUDENT_ID}],
        ("writing_essays", "insert"): [{"id": _ESSAY_ID}],
        ("writing_jobs", "insert"):   [{"id": _JOB_ID}],
    })
    with patch.object(essay_service, "supabase_admin", fake):
        out = essay_service.create_essay_with_job(
            data=_valid_create_data(), admin_id=_ADMIN_ID,
        )

    assert out == {"essay_id": _ESSAY_ID, "job_id": _JOB_ID, "eta_seconds": 45}
    # Verify the essay payload carries derived word_count + admin id
    essay_insert = next(c for c in fake.calls if c["table"] == "writing_essays" and c["op"] == "insert")
    assert essay_insert["payload"]["submitted_by_admin"] == _ADMIN_ID
    assert essay_insert["payload"]["word_count"] > 0
    assert essay_insert["payload"]["status"] == "pending"


def test_create_essay_with_job_404s_when_student_missing():
    fake = _FakeSupabase(responses={("students", "select"): []})
    with patch.object(essay_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as exc:
            essay_service.create_essay_with_job(
                data=_valid_create_data(), admin_id=_ADMIN_ID,
            )
    assert exc.value.status_code == 404


def test_create_essay_rolls_back_essay_when_job_insert_returns_no_rows():
    fake = _FakeSupabase(responses={
        ("students", "select"):       [{"id": _STUDENT_ID}],
        ("writing_essays", "insert"): [{"id": _ESSAY_ID}],
        # writing_jobs.insert returns empty → rollback path
        ("writing_jobs", "insert"):   [],
    })
    with patch.object(essay_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as exc:
            essay_service.create_essay_with_job(
                data=_valid_create_data(), admin_id=_ADMIN_ID,
            )
    assert exc.value.status_code == 500
    # Rollback issued a delete on writing_essays
    deletes = [c for c in fake.calls if c["table"] == "writing_essays" and c["op"] == "delete"]
    assert len(deletes) == 1
    assert ("eq", "id", _ESSAY_ID) in deletes[0]["filters"]


# ── _bg_grade_essay ──────────────────────────────────────────────────

def _valid_feedback_obj() -> WritingFeedback:
    return WritingFeedback(
        overallBandScore=6.5,
        overallBandScoreSummary="OK",
        keyTakeaways={"strengths": ["s"], "areasForImprovement": ["a"]},
        criteriaFeedback={
            "mainCriterion":     {"title": "Task Response", "explanation": "...", "feedback": "...", "bandScore": 6},
            "coherenceCohesion": {"title": "Coherence",     "explanation": "...", "feedback": "...", "bandScore": 6},
            "lexicalResource":   {"title": "Lexical",       "explanation": "...", "feedback": "...", "bandScore": 7},
            "grammaticalRange":  {"title": "Grammar",       "explanation": "...", "feedback": "...", "bandScore": 6},
        },
        mistakeAnalysis=[],
        aiContentAnalysis={"likelihood": 5, "explanation": "Natural"},
        improvedEssay="Improved.",
    )


def _bg_essay_responses() -> dict:
    # student_id added in Phase 1.5a so _bg_grade_essay can fetch
    # recurring-patterns history before constructing GraderConfig.
    return {
        ("writing_essays", "select"): [{
            "task_type":       "task2",
            "prompt_text":     "P",
            "essay_text":      "E",
            "analysis_level":  3,
            "form_of_address": "em",
            "selected_model":  "gemini-2.5-pro",
            "student_id":      _STUDENT_ID,
        }],
    }


@pytest.mark.asyncio
async def test_bg_grade_essay_happy_path_writes_feedback_and_marks_graded():
    fake = _FakeSupabase(responses=_bg_essay_responses())
    fake_grader = MagicMock()

    async def fake_grade(_config):
        return MagicMock(
            feedback=_valid_feedback_obj(),
            model_used="gemini-2.5-pro",
            tokens_input=3000,
            tokens_output=2000,
            cost_usd=0.025,
            grading_duration_ms=5000,
            prompt_version="v1.0",
        )
    fake_grader.grade_essay = fake_grade

    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "get_recurring_patterns", return_value=None), \
         patch.object(essay_service, "get_band_trajectory",  return_value=None):
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    ops = [(c["table"], c["op"]) for c in fake.calls]
    assert ("writing_jobs",     "update") in ops    # → running
    assert ("writing_essays",   "update") in ops    # → grading
    assert ("writing_feedback", "insert") in ops
    # Final updates set status=graded / completed
    final_essay = [c for c in fake.calls if c["table"] == "writing_essays" and c["op"] == "update"][-1]
    assert final_essay["payload"]["status"] == "graded"
    final_job = [c for c in fake.calls if c["table"] == "writing_jobs" and c["op"] == "update"][-1]
    assert final_job["payload"]["status"] == "completed"

    # Feedback row carries the per-criterion bands
    fb_insert = next(c for c in fake.calls if c["table"] == "writing_feedback" and c["op"] == "insert")
    assert fb_insert["payload"]["overall_band_score"] == 6.5
    assert fb_insert["payload"]["band_lexical_resource"] == 7.0
    assert fb_insert["payload"]["model_used"] == "gemini-2.5-pro"


@pytest.mark.asyncio
async def test_bg_grade_essay_safety_block_marks_failed():
    fake = _FakeSupabase(responses=_bg_essay_responses())
    fake_grader = MagicMock()

    async def fake_grade(_config):
        raise AISafetyBlockError("blocked")
    fake_grader.grade_essay = fake_grade

    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "get_recurring_patterns", return_value=None), \
         patch.object(essay_service, "get_band_trajectory",  return_value=None):
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    final_essay = [c for c in fake.calls if c["table"] == "writing_essays" and c["op"] == "update"][-1]
    assert final_essay["payload"]["status"] == "failed"
    assert "AISafetyBlockError" in final_essay["payload"]["error_message"]
    final_job = [c for c in fake.calls if c["table"] == "writing_jobs" and c["op"] == "update"][-1]
    assert final_job["payload"]["status"] == "failed"


@pytest.mark.asyncio
async def test_bg_grade_essay_retry_failure_marks_failed():
    fake = _FakeSupabase(responses=_bg_essay_responses())
    fake_grader = MagicMock()

    async def fake_grade(_config):
        raise APIRetryFailedError("3 retries failed")
    fake_grader.grade_essay = fake_grade

    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "get_recurring_patterns", return_value=None), \
         patch.object(essay_service, "get_band_trajectory",  return_value=None):
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    final_essay = [c for c in fake.calls if c["table"] == "writing_essays" and c["op"] == "update"][-1]
    assert final_essay["payload"]["status"] == "failed"
    assert "APIRetryFailedError" in final_essay["payload"]["error_message"]


# ── Phase 1.5a: history wiring ───────────────────────────────────────


@pytest.mark.asyncio
async def test_bg_grade_essay_passes_recurring_patterns_to_grader():
    """Phase 1.5a: when the student has ≥5 essays, _bg_grade_essay must
    inject the patterns dict into GraderConfig.history so the grader's
    _build_user_prompt can format it into the Gemini prompt."""
    fake = _FakeSupabase(responses=_bg_essay_responses())
    fake_grader = MagicMock()
    captured: dict = {}

    async def fake_grade(config):
        captured["config"] = config
        return MagicMock(
            feedback=_valid_feedback_obj(),
            model_used="gemini-2.5-pro",
            tokens_input=1, tokens_output=1, cost_usd=0.001,
            grading_duration_ms=10, prompt_version="v1.0",
        )
    fake_grader.grade_essay = fake_grade

    patterns = {
        "essays_analyzed": 5,
        "patterns": [
            {"mistakeType": "Grammar - Article", "count": 7,
             "examples": ["the others"], "criterion": "GRA"},
        ],
    }

    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "get_recurring_patterns",
                      return_value=patterns) as mock_history, \
         patch.object(essay_service, "get_band_trajectory",
                      return_value=None):
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    # Aggregator was called with the essay's student_id (proves student_id
    # was actually loaded from the row, not hardcoded).
    mock_history.assert_called_once_with(_STUDENT_ID)
    # GraderConfig carries the patterns dict on its `history` field, so
    # the grader's prompt builder can format it into the user message.
    assert captured["config"].history == patterns


@pytest.mark.asyncio
async def test_bg_grade_essay_history_none_when_student_below_threshold():
    """New students (<5 essays) ⇒ aggregators return None ⇒ GraderConfig
    .history AND .trajectory both stay None so prompt is unchanged
    from Phase-1 behaviour."""
    fake = _FakeSupabase(responses=_bg_essay_responses())
    fake_grader = MagicMock()
    captured: dict = {}

    async def fake_grade(config):
        captured["config"] = config
        return MagicMock(
            feedback=_valid_feedback_obj(),
            model_used="gemini-2.5-pro",
            tokens_input=1, tokens_output=1, cost_usd=0.001,
            grading_duration_ms=10, prompt_version="v1.0",
        )
    fake_grader.grade_essay = fake_grade

    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "get_recurring_patterns",
                      return_value=None), \
         patch.object(essay_service, "get_band_trajectory",
                      return_value=None):
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    assert captured["config"].history    is None
    assert captured["config"].trajectory is None


# ── Phase 1.5b: trajectory wiring ────────────────────────────────────


@pytest.mark.asyncio
async def test_bg_grade_essay_passes_band_trajectory_to_grader():
    """Phase 1.5b: trajectory aggregator must be called with the same
    student_id that fed the patterns aggregator, and its result must
    flow through to GraderConfig.trajectory so _build_user_prompt
    can format it into the Gemini prompt."""
    fake = _FakeSupabase(responses=_bg_essay_responses())
    fake_grader = MagicMock()
    captured: dict = {}

    async def fake_grade(config):
        captured["config"] = config
        return MagicMock(
            feedback=_valid_feedback_obj(),
            model_used="gemini-2.5-pro",
            tokens_input=1, tokens_output=1, cost_usd=0.001,
            grading_duration_ms=10, prompt_version="v1.0",
        )
    fake_grader.grade_essay = fake_grade

    trajectory = {
        "essays_analyzed":    5,
        "average_last_5":     6.5,
        "trend":              "improving",
        "trend_delta":        0.5,
        "criteria_breakdown": [
            {"criterion": "Task Response", "average": 7.0, "trend": "improving"},
        ],
    }

    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "get_recurring_patterns",
                      return_value=None), \
         patch.object(essay_service, "get_band_trajectory",
                      return_value=trajectory) as mock_traj:
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    mock_traj.assert_called_once_with(_STUDENT_ID)
    assert captured["config"].trajectory == trajectory


# ── Sprint 2.7d.1 — Instructor tier post-grading hook ────────────────


@pytest.mark.asyncio
async def test_bg_grade_essay_instructor_tier_creates_review_row():
    """When grading_tier=instructor, _bg_grade_essay must call
    instructor_workflow.create_review(essay_id) AFTER the feedback
    row is persisted. Idempotency + error-tolerance live in the
    workflow service; this test pins the call site."""
    from models.writing_feedback import GradingTier

    fake = _FakeSupabase(responses=_bg_essay_responses())
    fake_grader = MagicMock()

    async def fake_grade(_config):
        return MagicMock(
            feedback=_valid_feedback_obj(),
            model_used="gemini-2.5-pro",
            tokens_input=3000, tokens_output=2000,
            cost_usd=0.025, grading_duration_ms=5000,
            prompt_version="v2.1-instructor-pending",
            grading_tier=GradingTier.INSTRUCTOR,
            tier_metadata={},
        )
    fake_grader.grade_essay = fake_grade

    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "get_recurring_patterns", return_value=None), \
         patch.object(essay_service, "get_band_trajectory",  return_value=None), \
         patch("services.instructor_workflow.create_review") as mock_create_review:
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    mock_create_review.assert_called_once()
    # Called with the essay UUID (passed as a UUID object, not str).
    called_arg = mock_create_review.call_args[0][0]
    assert str(called_arg) == _ESSAY_ID


@pytest.mark.asyncio
async def test_bg_grade_essay_standard_tier_does_not_create_review_row():
    """Pin: only Instructor tier triggers the queue creation. A
    Standard-tier grading must not touch the instructor_reviews table."""
    from models.writing_feedback import GradingTier

    fake = _FakeSupabase(responses=_bg_essay_responses())
    fake_grader = MagicMock()

    async def fake_grade(_config):
        return MagicMock(
            feedback=_valid_feedback_obj(),
            model_used="gemini-2.5-pro",
            tokens_input=100, tokens_output=100,
            cost_usd=0.001, grading_duration_ms=3000,
            prompt_version="v2.1",
            grading_tier=GradingTier.STANDARD,
            tier_metadata={},
        )
    fake_grader.grade_essay = fake_grade

    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "get_recurring_patterns", return_value=None), \
         patch.object(essay_service, "get_band_trajectory",  return_value=None), \
         patch("services.instructor_workflow.create_review") as mock_create_review:
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    mock_create_review.assert_not_called()


@pytest.mark.asyncio
async def test_bg_grade_essay_instructor_review_creation_failure_does_not_fail_grading():
    """If create_review raises (DB hiccup), the grading must still
    succeed — the feedback row is already persisted, the queue row
    is recoverable. Pin so a future change that propagates the
    exception (and loses the AI grade) surfaces here."""
    from models.writing_feedback import GradingTier

    fake = _FakeSupabase(responses=_bg_essay_responses())
    fake_grader = MagicMock()

    async def fake_grade(_config):
        return MagicMock(
            feedback=_valid_feedback_obj(),
            model_used="gemini-2.5-pro",
            tokens_input=100, tokens_output=100,
            cost_usd=0.001, grading_duration_ms=3000,
            prompt_version="v2.1-instructor-pending",
            grading_tier=GradingTier.INSTRUCTOR,
            tier_metadata={},
        )
    fake_grader.grade_essay = fake_grade

    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "get_recurring_patterns", return_value=None), \
         patch.object(essay_service, "get_band_trajectory",  return_value=None), \
         patch("services.instructor_workflow.create_review",
               side_effect=RuntimeError("simulated DB hiccup")):
        # Must NOT raise — grading completes, queue row create is
        # logged-and-swallowed.
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    # Feedback row still inserted, essay still marked graded.
    ops = [(c["table"], c["op"]) for c in fake.calls]
    assert ("writing_feedback", "insert") in ops
    final_essay = [c for c in fake.calls if c["table"] == "writing_essays" and c["op"] == "update"][-1]
    assert final_essay["payload"]["status"] == "graded"


# ── Read paths ───────────────────────────────────────────────────────

def test_list_essays_rejects_invalid_status():
    with pytest.raises(HTTPException) as exc:
        essay_service.list_essays(status="banana")
    assert exc.value.status_code == 400


def test_get_essay_with_feedback_404_when_missing():
    fake = _FakeSupabase(responses={("writing_essays", "select"): []})
    with patch.object(essay_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as exc:
            essay_service.get_essay_with_feedback(_ESSAY_ID)
    assert exc.value.status_code == 404


def test_get_essay_status_returns_eta_for_pending():
    fake = _FakeSupabase(responses={
        ("writing_essays", "select"): [{
            "id":               _ESSAY_ID,
            "status":           "pending",
            "error_message":    None,
            "analysis_level":   5,
            "selected_model":   "gemini-2.5-pro",
            "created_at":       "2026-05-01T00:00:00Z",
        }],
    })
    with patch.object(essay_service, "supabase_admin", fake):
        out = essay_service.get_essay_status(_ESSAY_ID)
    assert out["status"] == "pending"
    assert out["eta_seconds"] == 90  # L5+pro → 90s
    assert out["error_message"] is None


# ── get_essay_render_context (W3 Phase 1) ────────────────────────────

def _valid_feedback_json() -> dict:
    return {
        "overallBandScore": 6.5,
        "overallBandScoreSummary": "OK",
        "keyTakeaways": {"strengths": ["s"], "areasForImprovement": ["a"]},
        "criteriaFeedback": {
            "mainCriterion":     {"title": "Task Response",       "explanation": "x", "feedback": "y", "bandScore": 6},
            "coherenceCohesion": {"title": "Coherence & Cohesion", "explanation": "x", "feedback": "y", "bandScore": 6},
            "lexicalResource":   {"title": "Lexical Resource",     "explanation": "x", "feedback": "y", "bandScore": 7},
            "grammaticalRange":  {"title": "Grammatical Range",    "explanation": "x", "feedback": "y", "bandScore": 6},
        },
        "mistakeAnalysis": [],
        "aiContentAnalysis": {"likelihood": 5, "explanation": "Natural"},
        "improvedEssay": "Improved.",
    }


def test_render_context_uses_admin_edits_when_present():
    edits = _valid_feedback_json()
    edits["overallBandScore"] = 7.5  # different from grader output
    fake = _FakeSupabase(responses={
        ("writing_essays", "select"): [{
            "id":               _ESSAY_ID,
            "student_id":       _STUDENT_ID,
            "task_type":        "task2",
            "prompt_text":      "P",
            "essay_text":       "E",
            "admin_edits_json": edits,
            "status":           "reviewed",
        }],
        ("writing_feedback", "select"): [{"feedback_json": _valid_feedback_json()}],
        ("students", "select"): [{"student_code": "S001", "full_name": "Tran A"}],
    })
    with patch.object(essay_service, "supabase_admin", fake):
        ctx = essay_service.get_essay_render_context(_ESSAY_ID)

    assert ctx["feedback"].overallBandScore == 7.5  # edits supersede AI
    assert ctx["student_name"] == "Tran A"
    assert ctx["student_code"] == "S001"


def test_render_context_falls_back_to_ai_feedback():
    fake = _FakeSupabase(responses={
        ("writing_essays", "select"): [{
            "id":               _ESSAY_ID,
            "student_id":       _STUDENT_ID,
            "task_type":        "task2",
            "prompt_text":      "P",
            "essay_text":       "E",
            "admin_edits_json": None,  # no edits → use AI output
            "status":           "graded",
        }],
        ("writing_feedback", "select"): [{"feedback_json": _valid_feedback_json()}],
        ("students", "select"): [{"student_code": "S002", "full_name": "B"}],
    })
    with patch.object(essay_service, "supabase_admin", fake):
        ctx = essay_service.get_essay_render_context(_ESSAY_ID)

    assert ctx["feedback"].overallBandScore == 6.5  # AI output


def test_render_context_404_when_essay_missing():
    fake = _FakeSupabase(responses={("writing_essays", "select"): []})
    with patch.object(essay_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as exc:
            essay_service.get_essay_render_context(_ESSAY_ID)
    assert exc.value.status_code == 404


def test_render_context_404_when_feedback_missing():
    fake = _FakeSupabase(responses={
        ("writing_essays", "select"): [{
            "id":               _ESSAY_ID,
            "student_id":       _STUDENT_ID,
            "task_type":        "task2",
            "prompt_text":      "P",
            "essay_text":       "E",
            "admin_edits_json": None,
            "status":           "pending",
        }],
        ("writing_feedback", "select"): [],
    })
    with patch.object(essay_service, "supabase_admin", fake):
        with pytest.raises(HTTPException) as exc:
            essay_service.get_essay_render_context(_ESSAY_ID)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_bg_grade_essay_overrides_model_overall_with_ielts_round():
    """P-1: the persisted overall is BACKEND-computed (IELTS-round of the 4
    criteria), not the model's self-round. Criteria {6,6,7,6} → mean 6.25 → 6.5,
    even though the model emitted 6.0. The model value is preserved in
    feedback_json.overallBandScoreModel."""
    fb = _valid_feedback_obj()
    fb.overallBandScore = 6.0   # model self-round (wrong / different)

    fake = _FakeSupabase(responses=_bg_essay_responses())
    fake_grader = MagicMock()

    async def fake_grade(_config):
        return MagicMock(
            feedback=fb,
            model_used="gemini-2.5-pro",
            tokens_input=3000, tokens_output=2000, cost_usd=0.025,
            grading_duration_ms=5000, prompt_version="v1.0",
        )
    fake_grader.grade_essay = fake_grade

    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "get_recurring_patterns", return_value=None), \
         patch.object(essay_service, "get_band_trajectory",  return_value=None):
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    fb_insert = next(c for c in fake.calls
                     if c["table"] == "writing_feedback" and c["op"] == "insert")
    payload = fb_insert["payload"]
    # Column = backend IELTS-round of mean(6,6,7,6)=6.25 → 6.5 (NOT model's 6.0)
    assert payload["overall_band_score"] == 6.5
    # feedback_json carries the backend value + preserves the model's emission
    assert payload["feedback_json"]["overallBandScore"] == 6.5
    assert payload["feedback_json"]["overallBandScoreModel"] == 6.0
