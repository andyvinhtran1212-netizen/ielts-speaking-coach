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
    return {
        ("writing_essays", "select"): [{
            "task_type":       "task2",
            "prompt_text":     "P",
            "essay_text":      "E",
            "analysis_level":  3,
            "form_of_address": "em",
            "selected_model":  "gemini-2.5-pro",
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
         patch.object(essay_service, "get_grader", return_value=fake_grader):
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
         patch.object(essay_service, "get_grader", return_value=fake_grader):
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
         patch.object(essay_service, "get_grader", return_value=fake_grader):
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    final_essay = [c for c in fake.calls if c["table"] == "writing_essays" and c["op"] == "update"][-1]
    assert final_essay["payload"]["status"] == "failed"
    assert "APIRetryFailedError" in final_essay["payload"]["error_message"]


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
