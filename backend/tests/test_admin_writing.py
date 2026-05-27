"""Tests for /admin/writing/* endpoints (Sprint W2 Phase 2).

Covers three layers:
  1. Auth gate — Pydantic body validation reaches the auth gate when a
     valid body shape is supplied.
  2. Pydantic body validation — required fields, enum-shaped strings,
     bounds.
  3. Happy-path handler logic — request/response shape with require_admin
     and essay_service stubbed out so we don't touch Supabase or Gemini.

W0 already pinned no-auth-header → 401 for POST /admin/writing/essays
and GET /admin/writing/essays in test_admin_writing_routers.py; we add
PATCH/DELETE/status/render coverage here.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
_STUDENT_ID = "00000000-0000-0000-0000-000000000001"
_ESSAY_ID   = "00000000-0000-0000-0000-000000000002"
_JOB_ID     = "00000000-0000-0000-0000-000000000003"


def _valid_create_body() -> dict:
    return {
        "student_id":      _STUDENT_ID,
        "task_type":       "task2",
        "prompt_text":     "Some Task 2 prompt",
        "essay_text":      "An IELTS task 2 essay submitted for grading.",
        "analysis_level":  3,
        "form_of_address": "em",
        "selected_model":  "gemini-2.5-pro",
    }


# ── Auth gate (extends W0 coverage) ──────────────────────────────────

def test_essays_status_requires_auth_header():
    r = _client().get(f"/admin/writing/essays/{_ESSAY_ID}/status")
    assert r.status_code == 401


def test_essays_get_one_requires_auth_header():
    r = _client().get(f"/admin/writing/essays/{_ESSAY_ID}")
    assert r.status_code == 401


# ── Pydantic body validation ─────────────────────────────────────────

def test_create_essay_rejects_missing_required_fields():
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/writing/essays", json={}, headers=_ADMIN_AUTH)
    assert r.status_code == 422


def test_create_essay_rejects_invalid_task_type():
    body = _valid_create_body()
    body["task_type"] = "task3"
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/writing/essays", json=body, headers=_ADMIN_AUTH)
    assert r.status_code == 422


def test_create_essay_rejects_invalid_analysis_level():
    body = _valid_create_body()
    body["analysis_level"] = 7
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/writing/essays", json=body, headers=_ADMIN_AUTH)
    assert r.status_code == 422


def test_create_essay_rejects_invalid_model():
    body = _valid_create_body()
    body["selected_model"] = "gpt-4"
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/writing/essays", json=body, headers=_ADMIN_AUTH)
    assert r.status_code == 422


# ── Sprint 2.7a — grading_tier on submission ─────────────────────────
# (Quick rejection added in Sprint 2.7a.1)


def test_create_essay_default_grading_tier_is_standard():
    """A pre-2.7a client that doesn't send `grading_tier` must hit the
    grader with `tier='standard'` (backward-compat). The router fills
    the default; the service-layer call sees it on the data dict."""
    info = {"essay_id": _ESSAY_ID, "job_id": _JOB_ID, "eta_seconds": 45}
    sentinel_bg = MagicMock(__name__="_bg_grade_essay")

    body = _valid_create_body()
    assert "grading_tier" not in body  # sanity — we're testing the missing case

    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.create_essay_with_job",
               return_value=info) as mock_create, \
         patch("routers.admin_writing.essay_service._bg_grade_essay", new=sentinel_bg):
        r = _client().post("/admin/writing/essays", json=body, headers=_ADMIN_AUTH)

    assert r.status_code == 202, r.text
    kwargs = mock_create.call_args.kwargs
    assert kwargs["data"]["grading_tier"] == "standard", (
        "Missing grading_tier must default to 'standard' so pre-2.7a "
        "clients keep their pipeline behaviour"
    )


def test_create_essay_explicit_standard_tier_succeeds():
    """An explicit grading_tier='standard' is forwarded to essay_service
    and the request returns 202 with the BG task scheduled."""
    info = {"essay_id": _ESSAY_ID, "job_id": _JOB_ID, "eta_seconds": 45}
    sentinel_bg = MagicMock(__name__="_bg_grade_essay")

    body = _valid_create_body()
    body["grading_tier"] = "standard"

    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.create_essay_with_job",
               return_value=info) as mock_create, \
         patch("routers.admin_writing.essay_service._bg_grade_essay", new=sentinel_bg):
        r = _client().post("/admin/writing/essays", json=body, headers=_ADMIN_AUTH)

    assert r.status_code == 202, r.text
    kwargs = mock_create.call_args.kwargs
    assert kwargs["data"]["grading_tier"] == "standard"


# ── Sprint 2.7a.1 — Quick + reserved-tier API rejection ───────────────


def test_create_essay_rejects_quick_tier_with_400():
    """Sprint 2.7a.1: Quick tier is removed (orthogonality conflict
    with Levels L3-L5). The API gates with a 400 + a helpful message
    that points the caller at Standard. Critically, NO BG task is
    scheduled — a Quick request must never reach the grader queue."""
    body = _valid_create_body()
    body["grading_tier"] = "quick"

    sentinel_bg = MagicMock(__name__="_bg_grade_essay")
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.create_essay_with_job") as mock_create, \
         patch("routers.admin_writing.essay_service._bg_grade_essay", new=sentinel_bg):
        r = _client().post("/admin/writing/essays", json=body, headers=_ADMIN_AUTH)

    assert r.status_code == 400, r.text
    detail = r.json().get("detail", "")
    assert "Quick" in detail and "2.7a.1" in detail, (
        f"Rejection message should explain the removal; got: {detail!r}"
    )
    # No essay was created — the gate fires before create_essay_with_job.
    mock_create.assert_not_called()


def test_create_essay_deep_tier_succeeds_after_2_7b():
    """Sprint 2.7b: Deep tier is now live. The API accepts the request
    (no 400 gate), forwards 'deep' to essay_service, and schedules the
    BG grading job. Replaces the 2.7a-era rejection test that asserted
    the 2.7b pointer."""
    info = {"essay_id": _ESSAY_ID, "job_id": _JOB_ID, "eta_seconds": 240}
    sentinel_bg = MagicMock(__name__="_bg_grade_essay")

    body = _valid_create_body()
    body["grading_tier"] = "deep"

    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.create_essay_with_job",
               return_value=info) as mock_create, \
         patch("routers.admin_writing.essay_service._bg_grade_essay", new=sentinel_bg):
        r = _client().post("/admin/writing/essays", json=body, headers=_ADMIN_AUTH)

    assert r.status_code == 202, r.text
    kwargs = mock_create.call_args.kwargs
    assert kwargs["data"]["grading_tier"] == "deep"


def test_create_essay_instructor_tier_succeeds_after_2_7d_1():
    """Sprint 2.7d.1: Instructor tier is now live. The API accepts
    the request (no 400 gate), forwards 'instructor' to essay_service,
    and schedules the BG grading job. AI Pass 1 will run; the queue
    row is created post-grading by the _bg_grade_essay hook (covered
    in test_essay_service_instructor_hook). Replaces the 2.7a-era
    rejection test that asserted the 2.7c pointer."""
    info = {"essay_id": _ESSAY_ID, "job_id": _JOB_ID, "eta_seconds": 60}
    sentinel_bg = MagicMock(__name__="_bg_grade_essay")

    body = _valid_create_body()
    body["grading_tier"] = "instructor"

    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.create_essay_with_job",
               return_value=info) as mock_create, \
         patch("routers.admin_writing.essay_service._bg_grade_essay", new=sentinel_bg):
        r = _client().post("/admin/writing/essays", json=body, headers=_ADMIN_AUTH)

    assert r.status_code == 202, r.text
    kwargs = mock_create.call_args.kwargs
    assert kwargs["data"]["grading_tier"] == "instructor"


def test_create_essay_rejects_invalid_grading_tier():
    """Unknown tier strings get rejected at the Pydantic boundary (422)
    so the service layer never sees a bad value."""
    body = _valid_create_body()
    body["grading_tier"] = "premium"  # not in {quick, standard, deep, instructor}
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/writing/essays", json=body, headers=_ADMIN_AUTH)
    assert r.status_code == 422


# ── Payload size guards (W2.2 audit) ─────────────────────────────────

def test_submission_rejects_oversize_essay():
    """essay_text > 10_000 chars → 422 from router-level Pydantic guard."""
    body = _valid_create_body()
    body["essay_text"] = "x" * 10_001
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/writing/essays", json=body, headers=_ADMIN_AUTH)
    assert r.status_code == 422


def test_submission_rejects_oversize_prompt():
    """prompt_text > 5_000 chars → 422 from router-level Pydantic guard."""
    body = _valid_create_body()
    body["prompt_text"] = "x" * 5_001
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post("/admin/writing/essays", json=body, headers=_ADMIN_AUTH)
    assert r.status_code == 422


def test_submission_accepts_max_size_essay():
    """Exactly 10_000-char essay + 5_000-char prompt are accepted (boundary)."""
    body = _valid_create_body()
    body["essay_text"]  = "x" * 10_000
    body["prompt_text"] = "y" * 5_000

    info = {"essay_id": _ESSAY_ID, "job_id": _JOB_ID, "eta_seconds": 45}
    sentinel_bg = MagicMock(__name__="_bg_grade_essay")
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.create_essay_with_job",
               return_value=info), \
         patch("routers.admin_writing.essay_service._bg_grade_essay", new=sentinel_bg):
        r = _client().post("/admin/writing/essays", json=body, headers=_ADMIN_AUTH)
    assert r.status_code == 202, r.text


# ── Happy-path handler wiring ────────────────────────────────────────

def test_create_essay_returns_202_with_eta_and_schedules_bg_task():
    info = {"essay_id": _ESSAY_ID, "job_id": _JOB_ID, "eta_seconds": 45}
    sentinel_bg = MagicMock(__name__="_bg_grade_essay")

    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.create_essay_with_job",
               return_value=info) as mock_create, \
         patch("routers.admin_writing.essay_service._bg_grade_essay", new=sentinel_bg):
        r = _client().post(
            "/admin/writing/essays",
            json=_valid_create_body(),
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 202, r.text
    body = r.json()
    assert body["essay_id"] == _ESSAY_ID
    assert body["job_id"] == _JOB_ID
    assert body["eta_seconds"] == 45
    assert body["status"] == "queued"

    # admin_id propagated; UUID coerced to str for Supabase
    kwargs = mock_create.call_args.kwargs
    assert kwargs["admin_id"] == _ADMIN_USER["id"]
    assert kwargs["data"]["student_id"] == _STUDENT_ID
    assert isinstance(kwargs["data"]["student_id"], str)


def test_list_essays_passes_filters():
    rows = [{"id": _ESSAY_ID, "status": "graded"}]
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.list_essays",
               return_value=rows) as mock_list:
        r = _client().get(
            f"/admin/writing/essays?status=graded&student_id={_STUDENT_ID}&limit=10&offset=20",
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200
    assert r.json() == rows
    kwargs = mock_list.call_args.kwargs
    assert kwargs == {
        "status": "graded",
        "student_id": _STUDENT_ID,
        "limit": 10,
        "offset": 20,
    }


def test_list_essays_no_filters_passes_none():
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.list_essays",
               return_value=[]) as mock_list:
        r = _client().get("/admin/writing/essays", headers=_ADMIN_AUTH)
    assert r.status_code == 200
    kwargs = mock_list.call_args.kwargs
    assert kwargs["status"] is None
    assert kwargs["student_id"] is None


def test_get_essay_returns_detail():
    detail = {"id": _ESSAY_ID, "status": "graded", "feedback": {"overall_band_score": 7.0}}
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.get_essay_with_feedback",
               return_value=detail) as mock_detail:
        r = _client().get(f"/admin/writing/essays/{_ESSAY_ID}", headers=_ADMIN_AUTH)
    assert r.status_code == 200
    assert r.json() == detail
    mock_detail.assert_called_once_with(_ESSAY_ID)


def test_get_essay_status_returns_eta_payload():
    payload = {
        "essay_id": _ESSAY_ID,
        "status": "grading",
        "error_message": None,
        "eta_seconds": 45,
        "created_at": "2026-05-01T00:00:00Z",
    }
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.get_essay_status",
               return_value=payload):
        r = _client().get(
            f"/admin/writing/essays/{_ESSAY_ID}/status",
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200
    assert r.json()["eta_seconds"] == 45


# ── W3 render endpoint ───────────────────────────────────────────────

def test_render_endpoint_returns_html_and_plain_text():
    """GET /render returns {html, plain_text} when essay + feedback exist."""
    fake_ctx = {
        "feedback": MagicMock(
            overallBandScore=6.5,
            overallBandScoreSummary="OK",
            keyTakeaways=MagicMock(strengths=[], areasForImprovement=[]),
            criteriaFeedback=MagicMock(
                mainCriterion=MagicMock(title="Task Response", explanation="x", feedback="y", bandScore=6),
                coherenceCohesion=MagicMock(title="C&C", explanation="x", feedback="y", bandScore=6),
                lexicalResource=MagicMock(title="LR",  explanation="x", feedback="y", bandScore=6),
                grammaticalRange=MagicMock(title="GRA", explanation="x", feedback="y", bandScore=6),
            ),
            mistakeAnalysis=[],
            ideaDevelopmentAnalysis=None,
            coherenceAnalysis=None,
            counterargumentAnalysis=None,
            lexicalAnalysis=None,
            sentenceStructureAnalysis=None,
            aiContentAnalysis=MagicMock(likelihood=5, explanation="natural"),
            improvedEssay="Improved.",
        ),
        "essay_text":   "My essay.",
        "prompt_text":  "Prompt.",
        "task_type":    "task2",
        "student_name": "Test Student",
        "student_code": "S001",
        "essay_id":     _ESSAY_ID,
    }
    fake_html = "<html>RENDERED</html>"

    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.get_essay_render_context",
               return_value=fake_ctx) as mock_ctx, \
         patch("routers.admin_writing.render_feedback_html",
               return_value=fake_html) as mock_render, \
         patch("routers.admin_writing.render_plain_text",
               return_value="RENDERED") as mock_plain:
        r = _client().get(
            f"/admin/writing/essays/{_ESSAY_ID}/render",
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["html"] == fake_html
    assert body["plain_text"] == "RENDERED"
    mock_ctx.assert_called_once_with(_ESSAY_ID)
    # Renderer received the context fields verbatim
    rkwargs = mock_render.call_args.kwargs
    assert rkwargs["task_type"] == "task2"
    assert rkwargs["student_name"] == "Test Student"
    mock_plain.assert_called_once_with(fake_html)


def test_render_endpoint_requires_auth():
    r = _client().get(f"/admin/writing/essays/{_ESSAY_ID}/render")
    assert r.status_code == 401


# ── W3 Word export endpoint ──────────────────────────────────────────

def test_export_docx_streams_word_file():
    """GET /export.docx returns a binary Word stream with proper headers."""
    fake_ctx = {
        "feedback":     MagicMock(),
        "essay_text":   "E",
        "prompt_text":  "P",
        "task_type":    "task2",
        "student_name": "Test",
        "student_code": "S001",
        "essay_id":     _ESSAY_ID,
    }
    fake_bytes = b"PK\x03\x04docxbytes"  # zip-like prefix sentinel
    fake_filename = "S001_20260504_T2.docx"

    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.essay_service.get_essay_render_context",
               return_value=fake_ctx), \
         patch("routers.admin_writing.render_essay_to_docx",
               return_value=(fake_bytes, fake_filename)) as mock_export:
        r = _client().get(
            f"/admin/writing/essays/{_ESSAY_ID}/export.docx",
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 200, r.text
    assert r.content == fake_bytes
    assert "wordprocessingml" in r.headers["content-type"]
    assert fake_filename in r.headers["content-disposition"]
    # Renderer received the context fields
    kwargs = mock_export.call_args.kwargs
    assert kwargs["task_type"] == "task2"
    assert kwargs["student_code"] == "S001"


def test_export_docx_requires_auth():
    r = _client().get(f"/admin/writing/essays/{_ESSAY_ID}/export.docx")
    assert r.status_code == 401


# ── W3 Phase 3 PATCH /feedback + POST /mark-delivered ────────────────

def _valid_feedback_edits() -> dict:
    return {
        "overallBandScore": 7.0,
        "overallBandScoreSummary": "Sau khi admin edit.",
        "keyTakeaways": {"strengths": ["s"], "areasForImprovement": ["a"]},
        "criteriaFeedback": {
            "mainCriterion":     {"title": "Task Response",       "explanation": "x", "feedback": "y", "bandScore": 7},
            "coherenceCohesion": {"title": "Coherence & Cohesion", "explanation": "x", "feedback": "y", "bandScore": 7},
            "lexicalResource":   {"title": "Lexical Resource",     "explanation": "x", "feedback": "y", "bandScore": 7},
            "grammaticalRange":  {"title": "Grammatical Range",    "explanation": "x", "feedback": "y", "bandScore": 7},
        },
        "mistakeAnalysis": [],
        "aiContentAnalysis": {"likelihood": 5, "explanation": "Natural"},
        "improvedEssay": "Improved.",
    }


def _fake_supabase(*, status: str | None, update_data: list | None = None) -> MagicMock:
    """Build a MagicMock that mocks both the SELECT(status) and UPDATE chains
    used by PATCH /feedback and POST /mark-delivered.

    SELECT chain: table().select(...).eq(...).limit(1).execute() →
        data=[{"status": <status>}]   (or [] if status is None → 404)
    UPDATE chain: table().update(...).eq(...).execute() →
        data=update_data              (default [{"id": _ESSAY_ID}])
    """
    fake = MagicMock()
    table = fake.table.return_value

    select_data = [{"status": status}] if status is not None else []
    table.select.return_value.eq.return_value.limit.return_value.execute.return_value = (
        MagicMock(data=select_data)
    )

    if update_data is None:
        update_data = [{"id": _ESSAY_ID}]
    table.update.return_value.eq.return_value.execute.return_value = (
        MagicMock(data=update_data)
    )
    return fake


def test_patch_feedback_validates_and_persists():
    """Edits validated against schema, then written with status='reviewed'."""
    fake = _fake_supabase(status="graded")
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake):
        r = _client().patch(
            f"/admin/writing/essays/{_ESSAY_ID}/feedback",
            json=_valid_feedback_edits(),
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200, r.text
    assert r.json() == {"essay_id": _ESSAY_ID, "status": "reviewed"}
    payload = fake.table.return_value.update.call_args.args[0]
    assert payload["status"] == "reviewed"
    assert payload["admin_edits_json"]["overallBandScore"] == 7.0
    assert payload["admin_reviewed_at"]


def test_patch_feedback_422_when_edits_fail_schema():
    """Server-side schema validation prevents storing junk that would break the renderer later."""
    bad = _valid_feedback_edits()
    bad["overallBandScore"] = 12.0  # > 9 fails schema
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().patch(
            f"/admin/writing/essays/{_ESSAY_ID}/feedback",
            json=bad,
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 422


def test_patch_feedback_404_when_essay_missing():
    fake = _fake_supabase(status=None)  # SELECT returns []
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake):
        r = _client().patch(
            f"/admin/writing/essays/{_ESSAY_ID}/feedback",
            json=_valid_feedback_edits(),
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 404


def test_patch_feedback_requires_auth():
    r = _client().patch(
        f"/admin/writing/essays/{_ESSAY_ID}/feedback",
        json=_valid_feedback_edits(),
    )
    assert r.status_code == 401


def test_mark_delivered_default_method_persists():
    fake = _fake_supabase(status="reviewed")
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/mark-delivered",
            json={},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "delivered"
    assert body["method"] == "google_docs_paste"  # default
    # Sprint 19.4: mark_delivered now also (best-effort) fulfils an accepted
    # regrade request, so the essay-delivery update is no longer the only
    # .update() call — find the one carrying delivery_method.
    payloads = [c.args[0] for c in fake.table.return_value.update.call_args_list]
    delivery = next(p for p in payloads if "delivery_method" in p)
    assert delivery["delivery_method"] == "google_docs_paste"


def test_mark_delivered_word_download_method():
    fake = _fake_supabase(status="reviewed")
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/mark-delivered",
            json={"method": "word_download"},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200
    assert r.json()["method"] == "word_download"


def test_mark_delivered_400_on_invalid_method():
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/mark-delivered",
            json={"method": "telegram"},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 400


def test_mark_delivered_404_when_essay_missing():
    fake = _fake_supabase(status=None)
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/mark-delivered",
            json={},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 404


# ── W3.1 state machine ──────────────────────────────────────────────

@pytest.mark.parametrize("blocked_status", ["pending", "grading", "failed", "delivered"])
def test_patch_feedback_409_when_status_not_graded_or_reviewed(blocked_status):
    """Only graded + reviewed accept edits — everything else returns 409."""
    fake = _fake_supabase(status=blocked_status)
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake):
        r = _client().patch(
            f"/admin/writing/essays/{_ESSAY_ID}/feedback",
            json=_valid_feedback_edits(),
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 409
    assert "Allowed states" in r.json()["detail"]
    # No update issued when status guard rejects
    fake.table.return_value.update.assert_not_called()


def test_patch_feedback_allows_reviewed_status_for_re_edit():
    """Re-editing a reviewed essay is permitted (idempotent)."""
    fake = _fake_supabase(status="reviewed")
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake):
        r = _client().patch(
            f"/admin/writing/essays/{_ESSAY_ID}/feedback",
            json=_valid_feedback_edits(),
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200
    assert r.json()["status"] == "reviewed"


def test_mark_delivered_409_when_essay_not_yet_reviewed():
    """Cannot skip the review step (graded → delivered)."""
    fake = _fake_supabase(status="graded")
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/mark-delivered",
            json={},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 409
    assert "Save edits first" in r.json()["detail"]
    fake.table.return_value.update.assert_not_called()


def test_mark_delivered_409_when_already_delivered():
    """Re-delivering a delivered essay is rejected (immutable in W3)."""
    fake = _fake_supabase(status="delivered")
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/mark-delivered",
            json={},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 409


@pytest.mark.parametrize("blocked_status", ["pending", "grading", "failed"])
def test_mark_delivered_409_for_pre_review_states(blocked_status):
    """pending / grading / failed all rejected — none of them are 'reviewed'."""
    fake = _fake_supabase(status=blocked_status)
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_writing.supabase_admin", fake):
        r = _client().post(
            f"/admin/writing/essays/{_ESSAY_ID}/mark-delivered",
            json={},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 409


# ── W3 placeholders still 501 ────────────────────────────────────────

def test_w3_endpoints_still_return_501():
    """Sanity: DELETE + /stats stay 501 (deferred past W3)."""
    with patch("routers.admin_writing.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().delete(
            f"/admin/writing/essays/{_ESSAY_ID}",
            headers=_ADMIN_AUTH,
        )
        assert r.status_code == 501
        r = _client().get("/admin/writing/stats", headers=_ADMIN_AUTH)
        assert r.status_code == 501
