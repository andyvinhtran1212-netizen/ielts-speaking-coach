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


# ── Level-aware default model (P1-A) ─────────────────────────────────

def test_default_grading_model_level_aware(monkeypatch):
    """L1–L3 → 3.5 Flash, L4–L5 → Pro when the flag is on."""
    from config import settings
    monkeypatch.setattr(settings, "WRITING_LEVEL_AWARE_MODEL", True)
    monkeypatch.setattr(settings, "WRITING_FLASH_MAX_LEVEL", 3)
    assert essay_service.default_grading_model(1) == "gemini-3.5-flash"
    assert essay_service.default_grading_model(3) == "gemini-3.5-flash"
    assert essay_service.default_grading_model(4) == "gemini-2.5-pro"
    assert essay_service.default_grading_model(5) == "gemini-2.5-pro"


def test_default_grading_model_flag_off_always_pro(monkeypatch):
    """Flag off → every level reverts to Pro (instant kill-switch)."""
    from config import settings
    monkeypatch.setattr(settings, "WRITING_LEVEL_AWARE_MODEL", False)
    for lvl in (1, 2, 3, 4, 5):
        assert essay_service.default_grading_model(lvl) == "gemini-2.5-pro"


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
        if name == "writing_feedback_current":   # GV-1a: view == base for single-version test data
            name = "writing_feedback"
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

    def in_(self, col, vals):
        self._filters.append(("in_", col, list(vals)))
        return self

    def lt(self, col, val):
        self._filters.append(("lt", col, val))
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
    # Final updates set status=graded / completed. GV-1b appends a separate
    # writing_essays update {current_version: …} AFTER the status flip (advance
    # LAST), so target the graded update specifically rather than [-1].
    graded_essay = [c for c in fake.calls if c["table"] == "writing_essays"
                    and c["op"] == "update" and c["payload"].get("status") == "graded"][-1]
    assert graded_essay["payload"]["status"] == "graded"
    cv_update = [c for c in fake.calls if c["table"] == "writing_essays"
                 and c["op"] == "update" and "current_version" in c["payload"]]
    assert cv_update, "GV-1b must advance current_version after grading"
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
async def test_bg_grade_essay_retry_failure_requeues_when_attempts_remain(monkeypatch):
    """Sprint W-MM: a transient API failure on a non-final attempt REQUEUES
    (job→queued, schedule a re-run) instead of stranding the essay in 'failed'.
    The essay stays in-flight; no terminal failure is written."""
    from config import settings
    monkeypatch.setattr(settings, "WRITING_GRADING_MAX_ATTEMPTS", 3)
    # Job read returns attempt_count 0 → this is attempt 1 of 3 → requeue.
    responses = _bg_essay_responses()
    responses[("writing_jobs", "select")] = [{"attempt_count": 0, "max_attempts": 3}]
    fake = _FakeSupabase(responses=responses)
    fake_grader = MagicMock()

    async def fake_grade(_config):
        raise APIRetryFailedError("3 retries failed")
    fake_grader.grade_essay = fake_grade

    requeue = MagicMock()
    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "_schedule_requeue", requeue), \
         patch.object(essay_service, "get_recurring_patterns", return_value=None), \
         patch.object(essay_service, "get_band_trajectory",  return_value=None):
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    # Requeue was scheduled; essay was NOT marked failed.
    requeue.assert_called_once()
    essay_updates = [c for c in fake.calls if c["table"] == "writing_essays" and c["op"] == "update"]
    assert all(c["payload"].get("status") != "failed" for c in essay_updates)
    # Job was reset to 'queued' for the re-run.
    job_queued = [c for c in fake.calls if c["table"] == "writing_jobs"
                  and c["op"] == "update" and c["payload"].get("status") == "queued"]
    assert job_queued, "requeue must reset the job to 'queued'"
    # The failed attempt was recorded to error_log (per-attempt ledger).
    log_writes = [c for c in fake.calls if c["table"] == "writing_jobs"
                  and c["op"] == "update" and "error_log" in c["payload"]]
    assert log_writes, "the failed attempt must be appended to error_log"


@pytest.mark.asyncio
async def test_bg_grade_essay_marks_failed_when_attempts_exhausted(monkeypatch):
    """Sprint W-MM: on the FINAL attempt a hard failure is terminal — essay
    'failed' with an error_message so the admin UI stops showing 'đang chấm'."""
    from config import settings
    monkeypatch.setattr(settings, "WRITING_GRADING_MAX_ATTEMPTS", 3)
    responses = _bg_essay_responses()
    responses[("writing_jobs", "select")] = [{"attempt_count": 2, "max_attempts": 3}]
    fake = _FakeSupabase(responses=responses)
    fake_grader = MagicMock()

    async def fake_grade(_config):
        raise APIRetryFailedError("3 retries failed")
    fake_grader.grade_essay = fake_grade

    requeue = MagicMock()
    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "_schedule_requeue", requeue), \
         patch.object(essay_service, "get_recurring_patterns", return_value=None), \
         patch.object(essay_service, "get_band_trajectory",  return_value=None):
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    requeue.assert_not_called()
    final_essay = [c for c in fake.calls if c["table"] == "writing_essays" and c["op"] == "update"][-1]
    assert final_essay["payload"]["status"] == "failed"
    assert "APIRetryFailedError" in final_essay["payload"]["error_message"]


@pytest.mark.asyncio
async def test_bg_grade_essay_final_attempt_uses_fallback_model(monkeypatch):
    """Sprint W-MM: the final attempt switches to WRITING_FALLBACK_MODEL so a
    model/region-specific failure can still deliver a result. The grader is
    handed the fallback model, not the primary."""
    from config import settings
    monkeypatch.setattr(settings, "WRITING_GRADING_MAX_ATTEMPTS", 3)
    monkeypatch.setattr(settings, "WRITING_GRADING_FALLBACK_ENABLED", True)
    monkeypatch.setattr(settings, "WRITING_FALLBACK_MODEL", "gemini-2.5-flash")
    responses = _bg_essay_responses()                                 # primary = gemini-2.5-pro
    responses[("writing_jobs", "select")] = [{"attempt_count": 2, "max_attempts": 3}]  # → attempt 3
    fake = _FakeSupabase(responses=responses)
    fake_grader = MagicMock()
    captured: dict = {}

    async def fake_grade(config):
        captured["config"] = config
        return MagicMock(
            feedback=_valid_feedback_obj(), model_used="gemini-2.5-flash",
            tokens_input=1, tokens_output=1, cost_usd=0.001,
            grading_duration_ms=10, prompt_version="v1.0",
        )
    fake_grader.grade_essay = fake_grade

    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "get_recurring_patterns", return_value=None), \
         patch.object(essay_service, "get_band_trajectory",  return_value=None):
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    assert captured["config"].selected_model == "gemini-2.5-flash"   # fallback, not pro


@pytest.mark.asyncio
async def test_bg_grade_essay_increments_attempt_counter(monkeypatch):
    """Sprint W-MM: each BG run bumps writing_jobs.attempt_count (per-essay retry
    ledger). A job previously at attempt 1 runs as attempt 2."""
    responses = _bg_essay_responses()
    responses[("writing_jobs", "select")] = [{"attempt_count": 1, "max_attempts": 3}]
    fake = _FakeSupabase(responses=responses)
    fake_grader = MagicMock()

    async def fake_grade(_config):
        return MagicMock(
            feedback=_valid_feedback_obj(), model_used="gemini-2.5-pro",
            tokens_input=1, tokens_output=1, cost_usd=0.001,
            grading_duration_ms=10, prompt_version="v1.0",
        )
    fake_grader.grade_essay = fake_grade

    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "get_recurring_patterns", return_value=None), \
         patch.object(essay_service, "get_band_trajectory",  return_value=None):
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    running = [c for c in fake.calls if c["table"] == "writing_jobs"
               and c["op"] == "update" and "attempt_count" in c["payload"]][0]
    assert running["payload"]["attempt_count"] == 2     # was 1 → now 2


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
async def test_bg_grade_essay_passes_authoritative_word_count_to_grader():
    """Bug-2 fix: _bg_grade_essay computes the deterministic body word count
    and puts it on GraderConfig.word_count, so the grader applies Rule 2 caps
    to the real number instead of the LLM's self-count."""
    responses = {
        ("writing_essays", "select"): [{
            "task_type":       "task2",
            "prompt_text":     "P",
            "essay_text":      "one two three four five six seven",   # 7 words
            "analysis_level":  3,
            "form_of_address": "em",
            "selected_model":  "gemini-2.5-pro",
            "student_id":      _STUDENT_ID,
        }],
    }
    fake = _FakeSupabase(responses=responses)
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
         patch.object(essay_service, "get_recurring_patterns", return_value=None), \
         patch.object(essay_service, "get_band_trajectory",  return_value=None):
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    assert captured["config"].word_count == 7
    assert captured["config"].word_count == essay_service._word_count(
        "one two three four five six seven"
    )


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

    # Feedback row still inserted, essay still marked graded. (GV-1b appends a
    # current_version advance after the status flip → target the graded update.)
    ops = [(c["table"], c["op"]) for c in fake.calls]
    assert ("writing_feedback", "insert") in ops
    graded_essay = [c for c in fake.calls if c["table"] == "writing_essays"
                    and c["op"] == "update" and c["payload"].get("status") == "graded"][-1]
    assert graded_essay["payload"]["status"] == "graded"


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
    # No job row → retry ledger defaults (Sprint W-MM).
    assert out["attempt_count"] == 0
    assert out["attempt_failures"] == 0
    assert out["last_failure"] is None


def test_get_essay_status_includes_retry_ledger():
    """Sprint W-MM: the status payload surfaces the grading-job retry ledger
    (attempt_count / failures / last failure) so the admin status page can show
    'đã thử lại N lần' and which model failed."""
    failure = {"attempt": 1, "model": "gemini-2.5-pro", "kind": "StuckTimeout",
               "message": "...", "at": "2026-06-29T15:29:00Z"}
    fake = _FakeSupabase(responses={
        ("writing_essays", "select"): [{
            "id":             _ESSAY_ID,
            "status":         "grading",
            "error_message":  None,
            "analysis_level": 4,
            "selected_model": "gemini-2.5-pro",
            "grading_tier":   "standard",
            "created_at":     "2026-06-29T00:00:00Z",
        }],
        ("writing_jobs", "select"): [{
            "attempt_count": 2, "max_attempts": 3, "error_log": [failure],
        }],
    })
    with patch.object(essay_service, "supabase_admin", fake):
        out = essay_service.get_essay_status(_ESSAY_ID)
    assert out["attempt_count"] == 2
    assert out["max_attempts"] == 3
    assert out["attempt_failures"] == 1
    assert out["last_failure"] == failure


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


def test_render_context_reads_current_version_feedback():
    """GV-1c: single source of truth = the CURRENT version (writing_feedback_current
    view). A human edit is a composed version, so the edited band lives in the
    current version's feedback_json — no admin_edits_json overlay."""
    edited = _valid_feedback_json()
    edited["overallBandScore"] = 7.5  # the composed (edited) current version
    fake = _FakeSupabase(responses={
        ("writing_essays", "select"): [{
            "id":               _ESSAY_ID,
            "student_id":       _STUDENT_ID,
            "task_type":        "task2",
            "prompt_text":      "P",
            "essay_text":       "E",
            "status":           "reviewed",
        }],
        ("writing_feedback", "select"): [{"feedback_json": edited}],
        ("students", "select"): [{"student_code": "S001", "full_name": "Tran A"}],
    })
    with patch.object(essay_service, "supabase_admin", fake):
        ctx = essay_service.get_essay_render_context(_ESSAY_ID)

    assert ctx["feedback"].overallBandScore == 7.5  # current version's feedback
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


@pytest.mark.asyncio
async def test_bg_grade_essay_drops_noncorrection_mistakes():
    """P-2a: a mistakeAnalysis entry whose original==suggestion (after norm) is
    dropped before persist; real corrections survive in feedback_json."""
    fb = _valid_feedback_obj()
    from models.writing_feedback import MistakeAnalysis
    fb.mistakeAnalysis = [
        MistakeAnalysis(original="teh", suggestion="The", mistakeType="spelling",
                        explanation="capitalise + fix typo", criterion="GRA"),
        MistakeAnalysis(original="the cat", suggestion="the cat", mistakeType="x",
                        explanation="junk", criterion="LR"),  # junk: original==suggestion
    ]

    fake = _FakeSupabase(responses=_bg_essay_responses())
    fake_grader = MagicMock()

    async def fake_grade(_config):
        return MagicMock(
            feedback=fb, model_used="gemini-2.5-pro",
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
    mistakes = fb_insert["payload"]["feedback_json"]["mistakeAnalysis"]
    assert [m["original"] for m in mistakes] == ["teh"]   # junk dropped, real kept


# ── Sprint W-MM: model-fallback policy ───────────────────────────────

def test_model_for_attempt_keeps_primary_before_final(monkeypatch):
    from config import settings
    monkeypatch.setattr(settings, "WRITING_GRADING_FALLBACK_ENABLED", True)
    monkeypatch.setattr(settings, "WRITING_FALLBACK_MODEL", "gemini-2.5-flash")
    # attempts 1 & 2 of 3 keep the primary model
    assert essay_service._model_for_attempt("gemini-2.5-pro", 1, 3) == "gemini-2.5-pro"
    assert essay_service._model_for_attempt("gemini-2.5-pro", 2, 3) == "gemini-2.5-pro"


def test_model_for_attempt_switches_on_final(monkeypatch):
    from config import settings
    monkeypatch.setattr(settings, "WRITING_GRADING_FALLBACK_ENABLED", True)
    monkeypatch.setattr(settings, "WRITING_FALLBACK_MODEL", "gemini-2.5-flash")
    # final attempt (3 of 3) switches to the fallback
    assert essay_service._model_for_attempt("gemini-2.5-pro", 3, 3) == "gemini-2.5-flash"


def test_model_for_attempt_disabled_always_primary(monkeypatch):
    from config import settings
    monkeypatch.setattr(settings, "WRITING_GRADING_FALLBACK_ENABLED", False)
    monkeypatch.setattr(settings, "WRITING_FALLBACK_MODEL", "gemini-2.5-flash")
    assert essay_service._model_for_attempt("gemini-2.5-pro", 3, 3) == "gemini-2.5-pro"


def test_model_for_attempt_noop_when_fallback_equals_primary(monkeypatch):
    from config import settings
    monkeypatch.setattr(settings, "WRITING_GRADING_FALLBACK_ENABLED", True)
    monkeypatch.setattr(settings, "WRITING_FALLBACK_MODEL", "gemini-2.5-pro")
    assert essay_service._model_for_attempt("gemini-2.5-pro", 3, 3) == "gemini-2.5-pro"


# ── Sprint W-MM: stuck-job reaper ────────────────────────────────────

from datetime import datetime, timedelta, timezone  # noqa: E402

_FIXED_NOW = datetime(2026, 6, 29, 12, 0, 0, tzinfo=timezone.utc)


def _reaper_responses(job_overrides=None, essay_overrides=None):
    job = {
        "id": _JOB_ID, "essay_id": _ESSAY_ID,
        "created_at": (_FIXED_NOW - timedelta(seconds=500)).isoformat(),  # > std 360s
        "attempt_count": 0, "max_attempts": 3,
    }
    job.update(job_overrides or {})
    essay = {"status": "grading", "grading_tier": "standard", "selected_model": "gemini-2.5-pro"}
    essay.update(essay_overrides or {})
    return {
        ("writing_jobs", "select"):   [job],
        ("writing_essays", "select"): [essay],
    }


@pytest.mark.asyncio
async def test_reap_requeues_stuck_job_with_attempts_remaining():
    fake = _FakeSupabase(responses=_reaper_responses())
    requeue = MagicMock()
    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "_schedule_requeue", requeue):
        summary = await essay_service.reap_stuck_grading_jobs(now=_FIXED_NOW)

    assert summary["requeued"] == 1 and summary["failed"] == 0
    requeue.assert_called_once()
    job_queued = [c for c in fake.calls if c["table"] == "writing_jobs"
                  and c["op"] == "update" and c["payload"].get("status") == "queued"]
    assert job_queued


@pytest.mark.asyncio
async def test_reap_terminal_fails_when_attempts_exhausted():
    fake = _FakeSupabase(responses=_reaper_responses(
        job_overrides={"attempt_count": 3, "max_attempts": 3}))
    requeue = MagicMock()
    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "_schedule_requeue", requeue):
        summary = await essay_service.reap_stuck_grading_jobs(now=_FIXED_NOW)

    assert summary["failed"] == 1 and summary["requeued"] == 0
    requeue.assert_not_called()
    failed_essay = [c for c in fake.calls if c["table"] == "writing_essays"
                    and c["op"] == "update" and c["payload"].get("status") == "failed"]
    assert failed_essay


@pytest.mark.asyncio
async def test_reap_skips_essay_already_resolved():
    fake = _FakeSupabase(responses=_reaper_responses(
        essay_overrides={"status": "graded"}))   # finished between query and check
    requeue = MagicMock()
    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "_schedule_requeue", requeue):
        summary = await essay_service.reap_stuck_grading_jobs(now=_FIXED_NOW)

    assert summary == {"candidates": 1, "requeued": 0, "failed": 0, "skipped": 1}
    requeue.assert_not_called()


@pytest.mark.asyncio
async def test_reap_skips_deep_tier_within_grace():
    # created 400s ago: past the standard 360s cutoff but inside the deep 600s
    # grace window → a deep grade is not yet stuck.
    fake = _FakeSupabase(responses=_reaper_responses(
        job_overrides={"created_at": (_FIXED_NOW - timedelta(seconds=400)).isoformat()},
        essay_overrides={"grading_tier": "deep"}))
    requeue = MagicMock()
    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "_schedule_requeue", requeue):
        summary = await essay_service.reap_stuck_grading_jobs(now=_FIXED_NOW)

    assert summary["skipped"] == 1 and summary["requeued"] == 0 and summary["failed"] == 0
    requeue.assert_not_called()


# ── Sprint W-MM review fixes: max_attempts persist, restore via job_payload,
#    started_at-based reaper staleness ─────────────────────────────────

def test_schedule_grading_job_persists_max_attempts_and_restore(monkeypatch):
    """P2: the env knob must reach the row (DB default no longer silently wins),
    and a regrade's prior good status is persisted for the reaper."""
    from config import settings
    monkeypatch.setattr(settings, "WRITING_GRADING_MAX_ATTEMPTS", 5)
    fake = _FakeSupabase(responses={("writing_jobs", "insert"): [{"id": _JOB_ID}]})
    with patch.object(essay_service, "supabase_admin", fake):
        essay_service.schedule_grading_job(
            essay_id=_ESSAY_ID, analysis_level=3, restore_status="delivered")
    ins = next(c for c in fake.calls if c["table"] == "writing_jobs" and c["op"] == "insert")
    assert ins["payload"]["max_attempts"] == 5
    assert ins["payload"]["job_payload"] == {"restore_status": "delivered"}


def test_schedule_grading_job_omits_job_payload_without_restore():
    """First-grade path passes no restore_status → no job_payload written (the
    DB default/None holds), but max_attempts is still set."""
    fake = _FakeSupabase(responses={("writing_jobs", "insert"): [{"id": _JOB_ID}]})
    with patch.object(essay_service, "supabase_admin", fake):
        essay_service.schedule_grading_job(essay_id=_ESSAY_ID, analysis_level=3)
    ins = next(c for c in fake.calls if c["table"] == "writing_jobs" and c["op"] == "insert")
    assert "job_payload" not in ins["payload"]
    assert "max_attempts" in ins["payload"]


@pytest.mark.asyncio
async def test_bg_grade_essay_restores_prior_status_from_job_payload(monkeypatch):
    """P2: a reaper-requeued run passes restore_status_on_fail=None, but the
    pre-regrade status persisted on the job must still restore the essay on a
    terminal (attempts-exhausted) failure — not strand it in 'failed'."""
    from config import settings
    monkeypatch.setattr(settings, "WRITING_GRADING_MAX_ATTEMPTS", 3)
    responses = _bg_essay_responses()
    responses[("writing_jobs", "select")] = [{
        "attempt_count": 2, "max_attempts": 3,
        "job_payload": {"restore_status": "delivered"},
    }]
    fake = _FakeSupabase(responses=responses)
    fake_grader = MagicMock()

    async def fake_grade(_config):
        raise APIRetryFailedError("3 retries failed")
    fake_grader.grade_essay = fake_grade

    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "get_recurring_patterns", return_value=None), \
         patch.object(essay_service, "get_band_trajectory",  return_value=None):
        # restore_status_on_fail omitted (None) → must fall back to job_payload
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    final_essay = [c for c in fake.calls if c["table"] == "writing_essays" and c["op"] == "update"][-1]
    assert final_essay["payload"]["status"] == "delivered"   # restored, not 'failed'


@pytest.mark.asyncio
async def test_reap_skips_requeued_job_with_fresh_started_at():
    """P1: a job requeued moments ago (created_at old but started_at fresh) must
    NOT be re-reaped — otherwise the sweep spawns a duplicate grading task while
    the live retry is still running."""
    fake = _FakeSupabase(responses=_reaper_responses(job_overrides={
        "created_at": (_FIXED_NOW - timedelta(seconds=500)).isoformat(),   # old
        "started_at": (_FIXED_NOW - timedelta(seconds=10)).isoformat(),    # just claimed
        "attempt_count": 1,
    }))
    requeue = MagicMock()
    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "_schedule_requeue", requeue):
        summary = await essay_service.reap_stuck_grading_jobs(now=_FIXED_NOW)

    assert summary["skipped"] == 1 and summary["requeued"] == 0 and summary["failed"] == 0
    requeue.assert_not_called()


@pytest.mark.asyncio
async def test_reap_terminal_restores_prior_status_from_job_payload():
    """P2: exhausted reaper attempts on a regrade restore the persisted
    pre-regrade status instead of forcing 'failed'."""
    fake = _FakeSupabase(responses=_reaper_responses(job_overrides={
        "attempt_count": 3, "max_attempts": 3,
        "job_payload": {"restore_status": "delivered"},
    }))
    requeue = MagicMock()
    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "_schedule_requeue", requeue):
        summary = await essay_service.reap_stuck_grading_jobs(now=_FIXED_NOW)

    assert summary["failed"] == 1
    restored = [c for c in fake.calls if c["table"] == "writing_essays"
                and c["op"] == "update" and c["payload"].get("status") == "delivered"]
    assert restored, "essay must be restored to its prior good status, not 'failed'"


# ── Sprint W-MM review fix P1: lease guard (stale-worker fencing) ─────

def test_owns_job_true_when_not_superseded():
    fake = _FakeSupabase(responses={("writing_jobs", "select"): [{"attempt_count": 2}]})
    with patch.object(essay_service, "supabase_admin", fake):
        assert essay_service._owns_job(_JOB_ID, 2) is True   # equal → current
        assert essay_service._owns_job(_JOB_ID, 3) is True   # stored older → current


def test_owns_job_false_when_superseded():
    """A newer attempt advanced attempt_count past ours → not the lease holder."""
    fake = _FakeSupabase(responses={("writing_jobs", "select"): [{"attempt_count": 3}]})
    with patch.object(essay_service, "supabase_admin", fake):
        assert essay_service._owns_job(_JOB_ID, 2) is False


def test_owns_job_true_when_job_missing():
    """No row / read blip → True (don't drop a fresh grade over a transient read)."""
    with patch.object(essay_service, "supabase_admin", _FakeSupabase(responses={})):
        assert essay_service._owns_job(_JOB_ID, 1) is True


@pytest.mark.asyncio
async def test_bg_grade_essay_superseded_does_not_persist_success():
    """P1: a stale worker (reaper requeued its job mid-grade) must NOT persist its
    feedback or flip the essay to graded — the authoritative retry owns the job."""
    fake = _FakeSupabase(responses=_bg_essay_responses())
    fake_grader = MagicMock()

    async def fake_grade(_config):
        return MagicMock(
            feedback=_valid_feedback_obj(), model_used="gemini-2.5-pro",
            tokens_input=1, tokens_output=1, cost_usd=0.001,
            grading_duration_ms=10, prompt_version="v1.0",
        )
    fake_grader.grade_essay = fake_grade

    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "_owns_job", return_value=False), \
         patch.object(essay_service, "get_recurring_patterns", return_value=None), \
         patch.object(essay_service, "get_band_trajectory",  return_value=None):
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    assert not any(c for c in fake.calls
                   if c["table"] == "writing_feedback" and c["op"] == "insert")
    assert not any(c for c in fake.calls if c["table"] == "writing_essays"
                   and c["op"] == "update" and c["payload"].get("status") == "graded")


@pytest.mark.asyncio
async def test_bg_grade_essay_superseded_does_not_mark_failed():
    """P1: a superseded stale worker that errors must NOT write 'failed' or
    requeue — that would clobber the authoritative retry's outcome."""
    fake = _FakeSupabase(responses=_bg_essay_responses())
    fake_grader = MagicMock()

    async def fake_grade(_config):
        raise APIRetryFailedError("boom")
    fake_grader.grade_essay = fake_grade

    requeue = MagicMock()
    with patch.object(essay_service, "supabase_admin", fake), \
         patch.object(essay_service, "get_grader", return_value=fake_grader), \
         patch.object(essay_service, "_owns_job", return_value=False), \
         patch.object(essay_service, "_schedule_requeue", requeue), \
         patch.object(essay_service, "get_recurring_patterns", return_value=None), \
         patch.object(essay_service, "get_band_trajectory",  return_value=None):
        await essay_service._bg_grade_essay(_ESSAY_ID, _JOB_ID)

    requeue.assert_not_called()
    assert not any(c for c in fake.calls if c["table"] == "writing_essays"
                   and c["op"] == "update" and c["payload"].get("status") == "failed")
