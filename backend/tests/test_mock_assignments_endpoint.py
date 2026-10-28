"""Admin retake-assignment endpoints (PR A, 2026-07-12).

POST/GET/DELETE /admin/mock-exams/{exam_id}/assignments — auth gate + that the
router forwards to mock_exam_assignment_service with the admin id + skills."""
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


def _client() -> TestClient:
    from main import app
    return TestClient(app)


_AUTH = {"Authorization": "Bearer faketoken"}
_ADMIN = {"id": "admin-1"}
_EXAM = "exam-1"


def test_assignments_require_auth():
    assert _client().get(f"/admin/mock-exams/{_EXAM}/assignments").status_code == 401
    assert _client().post(f"/admin/mock-exams/{_EXAM}/assignments", json={}).status_code == 401
    assert _client().delete(f"/admin/mock-exams/{_EXAM}/assignments/s1").status_code == 401


def test_create_assignments_forwards_rows_and_admin():
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.assign_svc.assign",
               return_value={"group_id": "g1", "assigned": ["u1"], "skipped": []}) as mock_assign:
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/assignments",
            json={"source_exam_id": "src", "assignments": [
                # open_until is required for any row that is actually WRITTEN
                # (an open-ended retake never finishes — D3). Enforced by the
                # service, not the schema; see the skill-less test below.
                {"user_id": "u1", "skills": ["writing"], "open_from": None,
                 "open_until": "2026-12-31T23:59:00Z"},
            ]},
            headers=_AUTH,
        )
    assert r.status_code == 200, r.text
    assert r.json()["assigned"] == ["u1"]
    args, kwargs = mock_assign.call_args
    assert args[0] == _EXAM
    assert args[1][0]["user_id"] == "u1"
    assert args[1][0]["skills"] == ["writing"]
    assert kwargs["created_by"] == "admin-1"
    assert kwargs["source_exam_id"] == "src"


def test_create_assignments_400_on_inverted_window():
    """An inverted window surfaces as a 400 (not a 500) — the service raises
    InvalidWindowError, the router maps it. Uses the REAL service (patched db)
    so the mapping is exercised end-to-end."""
    from unittest.mock import MagicMock
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("services.mock_exam_assignment_service.supabase_admin", db):
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/assignments",
            json={"assignments": [{
                "user_id": "u1", "skills": ["writing"],
                "open_from": "2026-07-20T10:00:00Z", "open_until": "2026-07-20T09:00:00Z",
            }]},
            headers=_AUTH,
        )
    assert r.status_code == 400, r.text


def test_delete_assignment_forwards():
    # D4 (2026-07-25) — remove() now also VOIDS any sitting the student already
    # opened (deleting the assignment alone did not revoke access), so it takes
    # the acting admin for the audit stamp and reports what it voided.
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.assign_svc.remove",
               return_value={"voided": ["sit-1"]}) as mock_remove:
        r = _client().delete(f"/admin/mock-exams/{_EXAM}/assignments/u1", headers=_AUTH)
    assert r.status_code == 200, r.text
    mock_remove.assert_called_once_with(_EXAM, "u1", admin_id=_ADMIN["id"])
    # the voided ids are surfaced, not swallowed — one verb, two effects
    assert r.json() == {"ok": True, "voided": ["sit-1"]}


def test_skill_less_row_without_deadline_does_not_abort_the_batch():
    """A row with no valid skill is documented to be SKIPPED, and a skipped row
    has no window to validate.

    Making open_until unconditionally required at the schema level meant
    FastAPI 422'd the whole payload before assign() could skip it — so one
    leftover skill-less row unassigned every valid student sent alongside it
    (Codex review, PR #839)."""
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.assign_svc.assign",
               return_value={"group_id": "g1", "assigned": ["u1"], "skipped": ["u2"]}) as mock_assign:
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/assignments",
            json={"assignments": [
                {"user_id": "u1", "skills": ["writing"],
                 "open_until": "2026-12-31T23:59:00Z"},
                {"user_id": "u2", "skills": []},          # no skills, no deadline
            ]},
            headers=_AUTH,
        )
    assert r.status_code == 200, r.text
    assert r.json()["assigned"] == ["u1"]
    assert mock_assign.call_args[0][1][1]["open_until"] is None


def test_row_with_skills_but_no_deadline_is_a_400_not_a_422():
    """The refusal still happens — as the explicit, translated 400 the service
    raises, so the admin sees why rather than a schema dump."""
    from unittest.mock import MagicMock
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.execute.return_value.data = []
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("services.mock_exam_assignment_service.supabase_admin", db):
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/assignments",
            json={"assignments": [{"user_id": "u1", "skills": ["writing"]}]},
            headers=_AUTH,
        )
    assert r.status_code == 400, r.text


# ── Window timezone (A-MOCK) ─────────────────────────────────────────────────
# open_from/open_until are normalized like Writing deadlines before they reach
# the timestamptz columns: a naive value is Vietnam wall time (not the server or
# Postgres session zone), an aware value keeps its instant, and every value is
# stored as UTC. Malformed input is a 422 rather than free text in the column.

import pytest


@pytest.mark.parametrize("raw, stored", [
    ("2026-11-01T19:00", "2026-11-01T12:00:00+00:00"),           # naive = Vietnam
    ("2026-11-01T19:00:00+07:00", "2026-11-01T12:00:00+00:00"),
    ("2026-11-01T12:00:00Z", "2026-11-01T12:00:00+00:00"),
    ("2026-11-01T05:00:00-07:00", "2026-11-01T12:00:00+00:00"),  # admin abroad
    ("2026-11-01", "2026-11-01T12:00:00+00:00"),                 # 19:00 VN default
])
def test_assignment_window_is_normalized_to_utc(raw, stored):
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.assign_svc.assign",
               return_value={"group_id": "g1", "assigned": ["u1"], "skipped": []}) as mock_assign:
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/assignments",
            json={"assignments": [{"user_id": "u1", "skills": ["writing"],
                                   "open_from": raw, "open_until": raw}]},
            headers=_AUTH,
        )
    assert r.status_code == 200, r.text
    row = mock_assign.call_args[0][1][0]
    assert row["open_from"] == stored
    assert row["open_until"] == stored


@pytest.mark.parametrize("bad", ["", "   ", "not-a-date", "2026-13-01T10:00", 5,
                                 "0001-01-01T00:00"])
def test_assignment_window_rejects_malformed_input(bad):
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.assign_svc.assign") as mock_assign:
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/assignments",
            json={"assignments": [{"user_id": "u1", "skills": ["writing"],
                                   "open_until": bad}]},
            headers=_AUTH,
        )
    assert r.status_code == 422, r.text
    mock_assign.assert_not_called()


def test_naive_and_aware_window_compare_as_instants():
    """Before normalization a naive open_from beside an aware open_until made
    the service's u < f comparison raise TypeError (a 500). Both are now aware
    UTC, and 19:00 Vietnam is earlier than 13:00 UTC on the same day."""
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch("routers.admin_mock_exams.assign_svc.assign",
               return_value={"group_id": "g1", "assigned": ["u1"], "skipped": []}) as mock_assign:
        r = _client().post(
            f"/admin/mock-exams/{_EXAM}/assignments",
            json={"assignments": [{"user_id": "u1", "skills": ["writing"],
                                   "open_from": "2026-11-01T19:00",
                                   "open_until": "2026-11-01T13:00:00Z"}]},
            headers=_AUTH,
        )
    assert r.status_code == 200, r.text
    from services.mock_exam_assignment_service import _validate_window
    row = mock_assign.call_args[0][1][0]
    _validate_window(row["open_from"], row["open_until"])  # no TypeError, valid


@pytest.mark.parametrize("method, path, svc_fn", [
    ("post", "/admin/mock-exams", "admin_create_exam"),
    ("patch", f"/admin/mock-exams/{_EXAM}", "admin_update_exam"),
])
def test_exam_window_is_normalized_to_utc(method, path, svc_fn):
    body = {"open_from": "2026-11-01T08:00", "open_until": "2026-11-01T19:00:00+07:00"}
    if method == "post":
        body.update(code="M-1", title="Mock 1")
    with patch("routers.admin_mock_exams.require_admin", new=AsyncMock(return_value=_ADMIN)), \
         patch(f"routers.admin_mock_exams.svc.{svc_fn}", return_value={"id": _EXAM}) as fn:
        r = getattr(_client(), method)(path, json=body, headers=_AUTH)
        bad = getattr(_client(), method)(path, json={**body, "open_until": "soon"},
                                         headers=_AUTH)
    assert r.status_code == 200, r.text
    sent = fn.call_args[0][1] if method == "patch" else fn.call_args[0][0]
    assert sent["open_from"] == "2026-11-01T01:00:00+00:00"
    assert sent["open_until"] == "2026-11-01T12:00:00+00:00"
    assert bad.status_code == 422, bad.text
    assert fn.call_count == 1
