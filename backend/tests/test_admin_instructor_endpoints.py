"""Tests for /admin/instructor/* endpoints (Sprint 2.7d.1).

Covers the auth gate + the 4 endpoints (queue, claim, release,
deliver). The workflow service is mocked at the function level so
we exercise the router shape, error mapping, and admin_id
extraction without re-testing the workflow's atomicity (that's
covered in test_instructor_workflow.py).

The auth pattern mirrors test_admin_writing.py: patch
`routers.admin_instructor.require_admin` to short-circuit the
JWT check while keeping the router's downstream logic real.
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_ADMIN_ID = "00000000-0000-0000-0000-00000000aaaa"
_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": _ADMIN_ID, "email": "admin@x"}
_REVIEW_ID = "00000000-0000-0000-0000-000000000010"
_ESSAY_ID = "00000000-0000-0000-0000-000000000020"


def _review_dict(**overrides) -> dict:
    base = {
        "id": _REVIEW_ID,
        "essay_id": _ESSAY_ID,
        "status": "queued",
        "claimed_by": None,
        "claimed_at": None,
        "delivered_at": None,
        "instructor_note": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    base.update(overrides)
    return base


# ── Auth gate ─────────────────────────────────────────────────────────


def test_queue_requires_auth_header():
    r = _client().get("/admin/instructor/queue")
    assert r.status_code == 401


def test_claim_requires_auth_header():
    r = _client().post(f"/admin/instructor/reviews/{_REVIEW_ID}/claim")
    assert r.status_code == 401


def test_release_requires_auth_header():
    r = _client().post(f"/admin/instructor/reviews/{_REVIEW_ID}/release")
    assert r.status_code == 401


def test_deliver_requires_auth_header():
    r = _client().post(
        f"/admin/instructor/reviews/{_REVIEW_ID}/deliver",
        json={"instructor_note": "x"},
    )
    assert r.status_code == 401


# ── GET /queue ────────────────────────────────────────────────────────


def test_queue_default_returns_active_items():
    """Default (no status query) must call the workflow with None so
    the service-layer default of {queued, claimed} kicks in. Verifies
    the explicit-pass-through contract — a router that hard-codes the
    default would prevent future changes."""
    from models.instructor_review import InstructorQueueItem, InstructorReview

    sample = InstructorQueueItem(
        review=InstructorReview(**_review_dict()),
        essay_id=_ESSAY_ID,
        student_email="s@x",
        student_level=3,
        task_type="task2",
        submitted_at=datetime.now(timezone.utc),
        age_hours=1.5,
        is_overdue=False,
    )
    with patch("routers.admin_instructor.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_instructor.instructor_workflow.get_queue",
               return_value=[sample]) as mock_q:
        r = _client().get("/admin/instructor/queue", headers=_ADMIN_AUTH)

    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["essay_id"] == _ESSAY_ID
    # Default — no status filter passed through.
    kwargs = mock_q.call_args.kwargs
    assert kwargs["status_filter"] is None


def test_queue_invalid_status_value_returns_400():
    """An unknown status string must 400 at the boundary, not silently
    match nothing."""
    with patch("routers.admin_instructor.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)):
        r = _client().get(
            "/admin/instructor/queue?status=not-a-status",
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 400


# ── POST /claim ───────────────────────────────────────────────────────


def test_claim_success_returns_review():
    from models.instructor_review import InstructorReview

    claimed = InstructorReview(**_review_dict(
        status="claimed", claimed_by=_ADMIN_ID,
        claimed_at=datetime.now(timezone.utc).isoformat(),
    ))
    with patch("routers.admin_instructor.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_instructor.instructor_workflow.claim",
               return_value=claimed) as mock_claim:
        r = _client().post(
            f"/admin/instructor/reviews/{_REVIEW_ID}/claim",
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 200
    assert r.json()["status"] == "claimed"
    # Router pulls admin_id from auth_user["id"] (dict access — see
    # report on require_admin signature). Pin so a refactor that
    # switches to a Pydantic User model can't accidentally break the
    # call path.
    args = mock_claim.call_args
    assert str(args[0][1]) == _ADMIN_ID


def test_claim_conflict_maps_to_409():
    from services.instructor_workflow import ConflictError

    with patch("routers.admin_instructor.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_instructor.instructor_workflow.claim",
               side_effect=ConflictError("Already claimed")):
        r = _client().post(
            f"/admin/instructor/reviews/{_REVIEW_ID}/claim",
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 409
    assert "Already claimed" in r.json().get("detail", "")


def test_claim_not_found_maps_to_404():
    from services.instructor_workflow import NotFoundError

    with patch("routers.admin_instructor.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_instructor.instructor_workflow.claim",
               side_effect=NotFoundError("Review not found")):
        r = _client().post(
            f"/admin/instructor/reviews/{_REVIEW_ID}/claim",
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 404


# ── POST /release ─────────────────────────────────────────────────────


def test_release_permission_error_maps_to_403():
    with patch("routers.admin_instructor.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_instructor.instructor_workflow.release",
               side_effect=PermissionError("Not the owner")):
        r = _client().post(
            f"/admin/instructor/reviews/{_REVIEW_ID}/release",
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 403


# ── POST /deliver ─────────────────────────────────────────────────────


def test_deliver_with_note_calls_workflow_with_note():
    from models.instructor_review import InstructorReview

    delivered = InstructorReview(**_review_dict(
        status="delivered", claimed_by=_ADMIN_ID,
        instructor_note="Great work, em!",
        delivered_at=datetime.now(timezone.utc).isoformat(),
    ))
    with patch("routers.admin_instructor.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_instructor.instructor_workflow.deliver",
               return_value=delivered) as mock_deliver:
        r = _client().post(
            f"/admin/instructor/reviews/{_REVIEW_ID}/deliver",
            json={"instructor_note": "Great work, em!"},
            headers=_ADMIN_AUTH,
        )

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "delivered"
    assert body["instructor_note"] == "Great work, em!"
    # Router forwards the note kwarg to the workflow.
    assert mock_deliver.call_args.kwargs["instructor_note"] == "Great work, em!"


def test_deliver_without_note_passes_none():
    """Body with no instructor_note key — router must pass None
    through, NOT empty string. Distinguishes 'no note' (don't clobber
    pre-set value) from 'explicit empty' (overwrite to blank)."""
    from models.instructor_review import InstructorReview

    delivered = InstructorReview(**_review_dict(
        status="delivered", claimed_by=_ADMIN_ID,
        delivered_at=datetime.now(timezone.utc).isoformat(),
    ))
    with patch("routers.admin_instructor.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_instructor.instructor_workflow.deliver",
               return_value=delivered) as mock_deliver:
        r = _client().post(
            f"/admin/instructor/reviews/{_REVIEW_ID}/deliver",
            json={},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 200
    assert mock_deliver.call_args.kwargs["instructor_note"] is None


def test_deliver_permission_error_maps_to_403():
    with patch("routers.admin_instructor.require_admin",
               new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_instructor.instructor_workflow.deliver",
               side_effect=PermissionError("Not the claimant")):
        r = _client().post(
            f"/admin/instructor/reviews/{_REVIEW_ID}/deliver",
            json={"instructor_note": "x"},
            headers=_ADMIN_AUTH,
        )
    assert r.status_code == 403
