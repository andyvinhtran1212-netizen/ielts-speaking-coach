"""STUDENTARCHIVE-0029 route contract: admin student delete archives.

FR-001  DELETE /admin/students/{id} archives through fn_archive_student (204,
        idempotent, 404 unknown) and never calls .delete().
FR-002  Archived learners leave the default admin list and the instructor
        roster, get no new individual Writing give, are locked out of Writing
        (fetch_linked_student), cannot re-activate through a code (403 before
        the code is consumed), and class add / direct-code bridge answer 409.
FR-003  ?include_archived=true lists them; POST /{id}/restore → 200 or 409.
FR-006  No hard delete is reachable from the admin student routes.

The database half (guards, audit, concurrency) is
test_migration_326_student_archive.py. The fake below applies the filters it
is given, so a route that forgets the archived filter fails here.
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]

ADMIN = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x", "role": "admin"}
AUTH = {"Authorization": "Bearer fake.admin.jwt"}
ACTIVE_ID = "00000000-0000-0000-0000-000000000001"
ARCHIVED_ID = "00000000-0000-0000-0000-000000000002"
USER_ID = "00000000-0000-0000-0000-0000000000a1"
COHORT_ID = "00000000-0000-0000-0000-0000000000c1"
INSTRUCTOR = "00000000-0000-0000-0000-0000000000e1"
ARCHIVED_AT = "2026-10-27T01:00:00+00:00"


def _client() -> TestClient:
    from main import app
    return TestClient(app)


def _row(student_id: str, *, archived: bool, **extra) -> dict:
    return {
        "id": student_id, "student_code": f"S-{student_id[-1]}", "full_name": f"Learner {student_id[-1]}",
        "target_band": None, "target_date": None, "persona_notes": None,
        "current_band_estimate": None, "user_id": None, "created_by": ADMIN["id"],
        "created_at": "2026-05-01T00:00:00Z", "updated_at": "2026-05-01T00:00:00Z",
        "flag_count": 0, "last_flagged_at": None, "is_under_review": False,
        "instructor_id": INSTRUCTOR, "cohort_id": None,
        "archived_at": ARCHIVED_AT if archived else None,
        "archived_by": ADMIN["id"] if archived else None,
        "archive_reason": "left" if archived else None,
        **extra,
    }


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    """PostgREST-shaped builder that really filters rows."""

    def __init__(self, db: "FakeDB", table: str):
        self.db, self.table = db, table
        self.action, self.payload = "select", None
        self.filters: list = []
        self._negate = False

    def select(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self
    def range(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self
    def or_(self, *_a, **_k): return self

    @property
    def not_(self):
        self._negate = True
        return self

    def _add(self, test):
        negate, self._negate = self._negate, False
        self.filters.append((lambda row: not test(row)) if negate else test)
        return self

    def eq(self, col, val): return self._add(lambda r: str(r.get(col)) == str(val))
    def in_(self, col, vals): return self._add(lambda r: str(r.get(col)) in {str(v) for v in vals})
    def is_(self, col, val):
        assert val == "null"
        return self._add(lambda r: r.get(col) is None)

    def insert(self, payload, *_a, **_k):
        self.action, self.payload = "insert", payload
        return self

    def update(self, payload, *_a, **_k):
        self.action, self.payload = "update", payload
        return self

    def upsert(self, payload, *_a, **_k):
        self.action, self.payload = "upsert", payload
        return self

    def delete(self):
        self.action = "delete"
        return self

    def execute(self):
        self.db.calls.append((self.table, self.action, self.payload))
        rows = self.db.tables.setdefault(self.table, [])
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if self.action == "select":
            return _Result([dict(r) for r in matched])
        if self.action == "update":
            for r in matched:
                r.update(self.payload)
            return _Result([dict(r) for r in matched])
        if self.action in ("insert", "upsert"):
            new = self.payload if isinstance(self.payload, list) else [self.payload]
            rows.extend(dict(r) for r in new)
            return _Result([dict(r) for r in new])
        if self.action == "delete":
            for r in matched:
                rows.remove(r)
            return _Result(matched)
        raise AssertionError(self.action)


class _Rpc:
    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        self.db.rpcs.append((self.name, self.params))
        value = self.db.rpc_results.get(self.name)
        if isinstance(value, Exception):
            raise value
        return _Result(value(self.params) if callable(value) else value)


class FakeDB:
    def __init__(self, tables: dict[str, list[dict]] | None = None, rpc_results: dict | None = None):
        self.tables = {k: [dict(r) for r in v] for k, v in (tables or {}).items()}
        self.rpc_results = rpc_results or {}
        self.calls: list[tuple[str, str, Any]] = []
        self.rpcs: list[tuple[str, dict]] = []

    def table(self, name): return _Query(self, name)
    def rpc(self, name, params): return _Rpc(self, name, params)

    def writes(self, action: str | None = None) -> list:
        return [c for c in self.calls if c[1] != "select" and (action is None or c[1] == action)]


def _admin_patch():
    return patch("routers.admin_students.require_admin", new=AsyncMock(return_value=ADMIN))


def _students_db(**kw) -> FakeDB:
    return FakeDB({"students": [_row(ACTIVE_ID, archived=False), _row(ARCHIVED_ID, archived=True)],
                   "student_cohort_memberships": [], "cohorts": []}, **kw)


# ── FR-001 / FR-006: DELETE archives, never deletes ─────────────────────────

def test_delete_archives_through_the_rpc_and_deletes_nothing():
    db = _students_db(rpc_results={"fn_archive_student": {
        "status": "archived", "ended_cohort_ids": [COHORT_ID], "account_deactivated": True}})
    with _admin_patch(), patch("services.student_service.supabase_admin", db):
        r = _client().delete(f"/admin/students/{ACTIVE_ID}?reason=%20left%20&deactivate_account=true",
                             headers=AUTH)
    assert r.status_code == 204, r.text
    assert db.rpcs == [("fn_archive_student", {
        "p_student_id": ACTIVE_ID, "p_actor": ADMIN["id"], "p_reason": "left",
        "p_deactivate_account": True})]
    assert db.writes() == [], "the route must not write any table directly"
    assert len(db.tables["students"]) == 2


def test_delete_is_idempotent_and_defaults_keep_the_account():
    db = _students_db(rpc_results={"fn_archive_student": {"status": "already_archived",
                                                          "archived_at": ARCHIVED_AT}})
    with _admin_patch(), patch("services.student_service.supabase_admin", db):
        r = _client().delete(f"/admin/students/{ARCHIVED_ID}", headers=AUTH)
    assert r.status_code == 204
    assert db.rpcs[0][1]["p_deactivate_account"] is False and db.rpcs[0][1]["p_reason"] is None
    assert db.writes() == []


def test_delete_unknown_student_is_404():
    db = _students_db(rpc_results={"fn_archive_student": None})
    with _admin_patch(), patch("services.student_service.supabase_admin", db):
        r = _client().delete(f"/admin/students/{ACTIVE_ID}", headers=AUTH)
    assert r.status_code == 404


def test_delete_surfaces_a_failed_archive_instead_of_204():
    db = _students_db(rpc_results={"fn_archive_student": RuntimeError("lock timeout")})
    with _admin_patch(), patch("services.student_service.supabase_admin", db):
        r = _client().delete(f"/admin/students/{ACTIVE_ID}", headers=AUTH)
    assert r.status_code == 500


def test_no_hard_delete_is_reachable_from_admin_student_code():
    for path in ("routers/admin_students.py", "services/student_service.py"):
        source = (BACKEND / path).read_text(encoding="utf-8")
        assert not re.search(r"\.delete\(\s*\)", source), f"{path} still performs a DELETE"
    from services import student_service
    assert not hasattr(student_service, "delete_student")


# ── FR-003: restore ─────────────────────────────────────────────────────────

def test_restore_returns_the_receipt():
    receipt = {"status": "restored", "restored_cohort_ids": [COHORT_ID], "account_reactivated": True}
    db = _students_db(rpc_results={"fn_restore_student": receipt})
    with _admin_patch(), patch("services.student_service.supabase_admin", db):
        r = _client().post(f"/admin/students/{ARCHIVED_ID}/restore",
                           json={"reason": " back ", "reactivate_account": True}, headers=AUTH)
    assert r.status_code == 200 and r.json() == receipt
    assert db.rpcs == [("fn_restore_student", {
        "p_student_id": ARCHIVED_ID, "p_actor": ADMIN["id"], "p_reason": "back",
        "p_restore_cohorts": True, "p_reactivate_account": True})]


def test_restore_without_body_and_not_archived_is_409():
    db = _students_db(rpc_results={"fn_restore_student": {"status": "not_archived"}})
    with _admin_patch(), patch("services.student_service.supabase_admin", db):
        r = _client().post(f"/admin/students/{ACTIVE_ID}/restore", headers=AUTH)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "not_archived"
    assert db.rpcs[0][1]["p_reactivate_account"] is False


def test_restore_unknown_student_is_404_and_requires_admin():
    db = _students_db(rpc_results={"fn_restore_student": None})
    with _admin_patch(), patch("services.student_service.supabase_admin", db):
        assert _client().post(f"/admin/students/{ACTIVE_ID}/restore", headers=AUTH).status_code == 404
    assert _client().post(f"/admin/students/{ACTIVE_ID}/restore").status_code == 401


# ── FR-002 / FR-003: listing ───────────────────────────────────────────────

@pytest.mark.parametrize("query,expected", [
    ("", [ACTIVE_ID]),
    ("?include_archived=false", [ACTIVE_ID]),
    ("?include_archived=true", [ACTIVE_ID, ARCHIVED_ID]),
])
def test_admin_list_hides_archived_unless_requested(query, expected):
    db = _students_db()
    with _admin_patch(), patch("services.student_service.supabase_admin", db):
        r = _client().get(f"/admin/students{query}", headers=AUTH)
    assert r.status_code == 200, r.text
    rows = {row["id"]: row for row in r.json()}
    assert sorted(rows) == expected
    if ARCHIVED_ID in rows:
        assert rows[ARCHIVED_ID]["archived_at"].startswith("2026-10-27")
        assert rows[ARCHIVED_ID]["archive_reason"] == "left"
    assert rows[ACTIVE_ID]["archived_at"] is None


def test_admin_detail_still_shows_an_archived_learner():
    from services import student_service
    db = _students_db()
    db.tables["writing_essays"] = []
    with patch("services.student_service.supabase_admin", db):
        detail = student_service.get_student_with_history(ARCHIVED_ID)
    assert detail["archived_at"] == ARCHIVED_AT


# ── FR-002: Writing / class lockout ────────────────────────────────────────

def test_fetch_linked_student_ignores_archived_profiles():
    from services.student_service import fetch_linked_student
    archived = _row(ARCHIVED_ID, archived=True, user_id=USER_ID)
    db = FakeDB({"students": [archived]})
    assert fetch_linked_student(db, USER_ID) is None
    db = FakeDB({"students": [archived, _row(ACTIVE_ID, archived=False, user_id=USER_ID)]})
    assert fetch_linked_student(db, USER_ID)["id"] == ACTIVE_ID


def test_archived_learner_gets_the_writing_403():
    from routers import writing_student
    db = FakeDB({"students": [_row(ARCHIVED_ID, archived=True, user_id=USER_ID)]})
    with patch.object(writing_student, "get_supabase_user",
                      new=AsyncMock(return_value={"id": USER_ID, "user_metadata": {}})), \
         patch.object(writing_student, "supabase_admin", db):
        with pytest.raises(HTTPException) as error:
            asyncio.run(writing_student.get_current_student("Bearer x"))
    assert error.value.status_code == 403


# ── FR-002: instructor roster and individual give ──────────────────────────

def _instructor_db() -> FakeDB:
    return FakeDB({"students": [_row(ACTIVE_ID, archived=False), _row(ARCHIVED_ID, archived=True)],
                   "writing_prompts": [{"id": "p1", "created_by": INSTRUCTOR}],
                   "writing_assignments": []})


def _instructor_patches(db):
    return (patch("routers.instructor._me", new=AsyncMock(return_value=INSTRUCTOR)),
            patch("services.instructor_access.supabase_admin", db))


def test_instructor_roster_and_detail_exclude_archived():
    db = _instructor_db()
    me, access = _instructor_patches(db)
    with me, access:
        client = _client()
        roster = client.get("/instructor/students", headers=AUTH)
        archived = client.get(f"/instructor/students/{ARCHIVED_ID}", headers=AUTH)
        active = client.get(f"/instructor/students/{ACTIVE_ID}", headers=AUTH)
        summary = client.get(f"/instructor/students/{ARCHIVED_ID}/summary", headers=AUTH)
    assert roster.status_code == 200 and [s["id"] for s in roster.json()] == [ACTIVE_ID]
    assert archived.status_code == 404 and active.status_code == 200
    assert summary.status_code == 404


def test_instructor_cannot_give_writing_to_an_archived_learner():
    db = _instructor_db()
    me, access = _instructor_patches(db)
    prompt = "00000000-0000-0000-0000-0000000000f1"
    db.tables["writing_prompts"] = [{"id": prompt, "created_by": INSTRUCTOR}]
    with me, access:
        r = _client().post("/instructor/assignments",
                           json={"prompt_id": prompt, "student_id": ARCHIVED_ID}, headers=AUTH)
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "student_archived"
    assert db.writes("insert") == []


def _writing_patches(db):
    return (patch("routers.admin_writing_assignments.require_admin", new=AsyncMock(return_value=ADMIN)),
            patch("routers.admin_writing_assignments.supabase_admin", db))


PROMPT = "00000000-0000-0000-0000-00000000bbbb"


@pytest.mark.parametrize("request_id", [None, "00000000-0000-4000-8000-000000000123"])
def test_admin_individual_writing_give_refuses_archived_learners(request_id):
    db = _students_db(rpc_results={"fn_create_writing_assignments_idempotent": {"created": []}})
    db.tables["writing_assignment_requests"] = []
    body = {"prompt_id": PROMPT, "student_ids": [ACTIVE_ID, ARCHIVED_ID]}
    if request_id:
        body["request_id"] = request_id
    admin, sb = _writing_patches(db)
    with admin, sb:
        r = _client().post("/admin/writing/assignments", json=body, headers=AUTH)
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == {"code": "student_archived", "student_ids": [ARCHIVED_ID],
                                  "message": r.json()["detail"]["message"]}
    assert db.rpcs == [] and db.writes() == []


def test_completed_writing_request_still_replays_after_an_archive():
    request_id = "00000000-0000-4000-8000-000000000123"
    body = {"request_id": request_id, "prompt_id": PROMPT, "student_ids": [ARCHIVED_ID]}
    from routers.admin_writing_assignments import AssignmentCreate
    payload = AssignmentCreate(**body).model_dump(mode="json", exclude={"request_id", "prompt_id"})
    db = _students_db()
    db.tables["writing_assignment_requests"] = [{
        "id": request_id, "assigned_by": ADMIN["id"], "request_payload": payload,
        "receipt": {"created": [{"id": "a1"}], "created_count": 1, "group_id": "g1",
                    "duplicates_warning": []}}]
    admin, sb = _writing_patches(db)
    with admin, sb:
        r = _client().post("/admin/writing/assignments", json=body, headers=AUTH)
    assert r.status_code == 201, r.text
    assert r.json() == {"created": [{"id": "a1"}], "count": 1, "group_id": "g1",
                        "duplicates_warning": [], "replayed": True}
    assert db.rpcs == []


def test_admin_individual_writing_give_to_active_learner_is_unchanged():
    db = _students_db()
    db.tables["writing_assignments"] = []
    admin, sb = _writing_patches(db)
    with admin, sb:
        r = _client().post("/admin/writing/assignments",
                           json={"prompt_id": PROMPT, "student_ids": [ACTIVE_ID]}, headers=AUTH)
    assert r.status_code == 201, r.text
    assert r.json()["count"] == 1


# ── FR-002: class add and direct-code bridge → 409 ─────────────────────────

def _cohort_db(archived_rpc: bool) -> FakeDB:
    error = RuntimeError("{'message': 'student_archived', 'code': 'P0001'}")
    return FakeDB(
        {"cohorts": [{"id": COHORT_ID}],
         "students": [_row(ACTIVE_ID, archived=False), _row(ARCHIVED_ID, archived=True)]},
        rpc_results={"fn_add_student_cohort_membership": error if archived_rpc else True,
                     "fn_add_students_cohort_membership": error if archived_rpc else 2})


def _cohort_patches(db):
    return (patch("routers.cohorts.require_admin", new=AsyncMock(return_value=ADMIN)),
            patch("routers.cohorts.supabase_admin", db))


def test_single_class_add_of_archived_learner_is_409():
    db = _cohort_db(archived_rpc=True)
    admin, sb = _cohort_patches(db)
    with admin, sb:
        r = _client().post(f"/admin/cohorts/{COHORT_ID}/students",
                           json={"student_id": ARCHIVED_ID}, headers=AUTH)
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "student_archived"
    assert r.json()["detail"]["student_ids"] == [ARCHIVED_ID]


def test_bulk_class_add_with_an_archived_learner_is_409_naming_them():
    db = _cohort_db(archived_rpc=True)
    admin, sb = _cohort_patches(db)
    with admin, sb:
        r = _client().post(f"/admin/cohorts/{COHORT_ID}/students/bulk",
                           json={"student_ids": [ACTIVE_ID, ARCHIVED_ID]}, headers=AUTH)
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["student_ids"] == [ARCHIVED_ID]


def test_other_class_add_failures_stay_500():
    db = _cohort_db(archived_rpc=False)
    db.rpc_results["fn_add_student_cohort_membership"] = RuntimeError("cohort_not_found")
    admin, sb = _cohort_patches(db)
    with admin, sb:
        r = _client().post(f"/admin/cohorts/{COHORT_ID}/students",
                           json={"student_id": ACTIVE_ID}, headers=AUTH)
    assert r.status_code == 500


def _bridge(db, issue):
    with patch("routers.admin.require_admin", new=AsyncMock(return_value=ADMIN)), \
         patch("routers.admin.supabase_admin", db), \
         patch("routers.admin._issue_code_and_assign", issue), \
         patch("routers.admin._audit_entitlement", MagicMock()):
        return _client().post("/admin/access-codes/generate-and-assign", headers=AUTH, json={
            "user_id": USER_ID, "permissions": ["all"], "code_type": "direct", "cohort_id": COHORT_ID})


def test_direct_code_bridge_refuses_an_archived_profile_before_minting():
    db = FakeDB({"users": [{"id": USER_ID, "is_active": True}],
                 "students": [_row(ARCHIVED_ID, archived=True, user_id=USER_ID)]})
    issue = MagicMock()
    r = _bridge(db, issue)
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "student_archived"
    issue.assert_not_called()
    assert db.rpcs == [] and db.writes() == []


def test_direct_code_bridge_adds_the_active_profile():
    db = FakeDB({"users": [{"id": USER_ID, "is_active": False}],
                 "students": [_row(ARCHIVED_ID, archived=True, user_id=USER_ID),
                              _row(ACTIVE_ID, archived=False, user_id=USER_ID)]},
                rpc_results={"fn_add_student_cohort_membership": True})
    issue = MagicMock(return_value={"id": "code-1", "code": "ABCD", "permissions": ["all"]})
    r = _bridge(db, issue)
    assert r.status_code == 200, r.text
    issue.assert_called_once()
    assert db.rpcs == [("fn_add_student_cohort_membership", {
        "p_student_id": ACTIVE_ID, "p_cohort_id": COHORT_ID, "p_added_by": ADMIN["id"]})]


# ── FR-002: activation refused before the code is consumed ─────────────────

def _activate(db):
    from routers import auth as auth_module
    auth_module._activate_attempts.clear()
    with patch.object(auth_module, "get_supabase_user",
                      new=AsyncMock(return_value={"id": USER_ID, "email": "l@x", "user_metadata": {}})), \
         patch.object(auth_module, "supabase_admin", db):
        return asyncio.run(auth_module.activate_account(
            auth_module.ActivateRequest(access_code="NEWCODE1"), authorization="Bearer x"))


def _code_row() -> dict:
    return {"id": "code-1", "code": "NEWCODE1", "is_used": False, "is_revoked": False,
            "expires_at": None, "permissions": ["writing"], "grants_role": None,
            "issued_by": None, "cohort_id": COHORT_ID}


@pytest.mark.parametrize("students", [
    [_row(ARCHIVED_ID, archived=True, user_id=USER_ID)],                       # linked profile
    [_row(ARCHIVED_ID, archived=True, user_id=None, student_code="NEWCODE1")],  # pre-created bridge
])
def test_activation_of_an_archived_profile_is_403_and_consumes_nothing(students):
    db = FakeDB({"access_codes": [_code_row()], "users": [{"id": USER_ID, "is_active": False}],
                 "students": students})
    with pytest.raises(HTTPException) as error:
        _activate(db)
    assert error.value.status_code == 403
    assert "lưu trữ" in error.value.detail
    assert db.writes() == [], "no users.is_active change, no code claim, no enroll"
    assert db.tables["access_codes"][0]["is_used"] is False
    assert db.tables["users"][0]["is_active"] is False
