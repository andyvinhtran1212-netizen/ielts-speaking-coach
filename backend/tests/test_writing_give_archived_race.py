"""GIVEARCHIVE-0031 route contract: a give refused by the 331 trigger is a 409.

Each Writing give path pre-checks `students.archived_at` and writes in a later
statement. When an archive commits in between, migration 331 refuses the
insert with `student_archived` (DETAIL = student id) and nothing is written.
Every path must answer the 0029 409 shape instead of a 500:

  individual — admin idempotent RPC, admin legacy insert, instructor insert;
  class      — admin RPC fan-out, admin legacy fan-out and instructor fan-out
               (`fan_out_assignment`), late-joiner backfill
               (`/auth/activate` Step 6 stays best-effort; the roster script
               skips the learner and continues).

The fake below plays the trigger: at write time it marks the learner archived
(the archive commits) and raises the PostgREST error the trigger produces. The
database half is test_migration_331_archived_student_give_guard.py.
"""

from __future__ import annotations

import logging
import sys
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from test_admin_students_archive import (
    ACTIVE_ID, ADMIN, ARCHIVED_AT, AUTH, COHORT_ID, INSTRUCTOR, PROMPT, USER_ID,
    FakeDB, _activate, _client, _code_row, _instructor_patches, _row, _writing_patches,
)

RACER = "00000000-0000-0000-0000-000000000003"   # archived mid-request
PROMPT_2 = "00000000-0000-0000-0000-00000000bbb2"
REQUEST_ID = "00000000-0000-4000-8000-000000000331"


def _trigger_error(student_id: str | None) -> APIError:
    body = {"message": "student_archived", "code": "P0001",
            "hint": "GIVEARCHIVE-0031: restore the learner before giving new Writing work."}
    if student_id:
        body["details"] = student_id
    return APIError(body)


def _archive_now(db: FakeDB, student_id: str) -> None:
    next(r for r in db.tables["students"] if r["id"] == student_id)["archived_at"] = ARCHIVED_AT


def _trigger(racer: str = RACER, *, details: bool = True):
    """before_write hook: the archive commits, then the 331 trigger refuses."""
    def hook(db, table, action, payload):
        if table != "writing_assignments" or action != "insert":
            return
        _archive_now(db, racer)
        rows = payload if isinstance(payload, list) else [payload]
        if any(str(r.get("student_id")) == racer for r in rows):
            raise _trigger_error(racer if details else None)
    return hook


def _rpc_trigger(db: FakeDB, racer: str = RACER, *, details: bool = True):
    def call(params):
        _archive_now(db, racer)
        raise _trigger_error(racer if details else None)
    return call


def _db(**tables) -> FakeDB:
    return FakeDB({
        "students": [_row(ACTIVE_ID, archived=False), _row(RACER, archived=False)],
        "writing_assignments": [], "writing_assignment_requests": [],
        "student_cohort_memberships": [
            {"id": "m1", "student_id": RACER, "cohort_id": COHORT_ID, "is_active": True},
            {"id": "m2", "student_id": ACTIVE_ID, "cohort_id": COHORT_ID, "is_active": True}],
        "cohorts": [{"id": COHORT_ID, "created_by": INSTRUCTOR}],
        "writing_prompts": [{"id": PROMPT, "created_by": INSTRUCTOR},
                            {"id": PROMPT_2, "created_by": INSTRUCTOR}],
        **tables,
    })


def _assert_409(response, ids=(RACER,)):
    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "student_archived"
    assert detail["student_ids"] == list(ids)
    assert detail["message"] == "Học viên đã được lưu trữ — khôi phục hồ sơ trước khi thao tác."


# ── Individual gives ────────────────────────────────────────────────────────

@pytest.mark.parametrize("details", [True, False])
def test_admin_idempotent_individual_give_archived_mid_request_is_409(details):
    db = _db()
    db.rpc_results["fn_create_writing_assignments_idempotent"] = _rpc_trigger(db, details=details)
    admin, sb = _writing_patches(db)
    with admin, sb:
        r = _client().post("/admin/writing/assignments", headers=AUTH, json={
            "request_id": REQUEST_ID, "prompt_ids": [PROMPT], "student_ids": [ACTIVE_ID, RACER]})
    # With no DETAIL the ids come from the canonical re-read.
    _assert_409(r)
    assert [name for name, _ in db.rpcs] == ["fn_create_writing_assignments_idempotent"]
    assert db.writes() == [] and db.tables["writing_assignments"] == []


@pytest.mark.parametrize("details", [True, False])
def test_admin_legacy_individual_give_archived_mid_request_is_409(details):
    db = _db()
    db.before_write = _trigger(details=details)
    admin, sb = _writing_patches(db)
    with admin, sb:
        r = _client().post("/admin/writing/assignments", headers=AUTH, json={
            "prompt_ids": [PROMPT, PROMPT_2], "student_ids": [ACTIVE_ID, RACER]})
    _assert_409(r)
    assert db.tables["writing_assignments"] == [], "the bulk insert is one statement"


def test_instructor_individual_give_archived_mid_request_is_409():
    db = _db()
    db.before_write = _trigger()
    me, access = _instructor_patches(db)
    with me, access, patch("routers.instructor.supabase_admin", db):
        r = _client().post("/instructor/assignments", headers=AUTH,
                           json={"prompt_id": PROMPT, "student_id": RACER})
    _assert_409(r)
    assert db.tables["writing_assignments"] == []


# ── Class gives ─────────────────────────────────────────────────────────────

def test_admin_idempotent_fan_out_refused_by_the_trigger_is_409():
    """Backstop: archive usually ends the membership first (roster_changed)."""
    db = _db()
    db.rpc_results["fn_create_writing_assignments_idempotent"] = _rpc_trigger(db)
    admin, sb = _writing_patches(db)
    with admin, sb:
        r = _client().post("/admin/writing/assignments/fan-out", headers=AUTH, json={
            "request_id": REQUEST_ID, "prompt_ids": [PROMPT], "cohort_id": COHORT_ID})
    _assert_409(r)
    assert db.tables["writing_assignments"] == []


@pytest.mark.parametrize("details", [True, False])
def test_admin_legacy_fan_out_refuses_the_whole_give(details):
    """Decision 2: one learner archived mid-give → nobody in the class gets it."""
    db = _db()
    db.before_write = _trigger(details=details)
    admin, sb = _writing_patches(db)
    with admin, sb:
        r = _client().post("/admin/writing/assignments/fan-out", headers=AUTH, json={
            "prompt_ids": [PROMPT, PROMPT_2], "cohort_id": COHORT_ID})
    _assert_409(r)
    assert db.tables["writing_assignments"] == []


def test_instructor_fan_out_refuses_the_whole_give():
    db = _db()
    db.before_write = _trigger()
    me, access = _instructor_patches(db)
    with me, access, patch("routers.instructor.supabase_admin", db):
        r = _client().post("/instructor/assignments/fan-out", headers=AUTH, json={
            "prompt_ids": [PROMPT], "cohort_id": COHORT_ID})
    _assert_409(r)
    assert db.tables["writing_assignments"] == []


def _open_give() -> dict:
    return {"id": "g-row", "prompt_id": PROMPT, "student_id": ACTIVE_ID, "cohort_id": COHORT_ID,
            "assignment_group_id": "grp-1", "name": "Buổi 1", "allow_soft_check": False,
            "assigned_by": ADMIN["id"], "deadline": None, "instructions": None, "is_timed": False,
            "time_limit_minutes": None, "analysis_level": 3, "grading_tier": "standard"}


def test_late_joiner_backfill_archived_mid_request_is_409_with_nothing_created():
    from services.cohort_assignment_service import backfill_cohort_writing_assignments
    db = _db(writing_assignments=[_open_give()])
    db.before_write = _trigger()
    with pytest.raises(HTTPException) as error:
        backfill_cohort_writing_assignments(db, student_id=RACER, cohort_id=COHORT_ID)
    assert error.value.status_code == 409
    assert error.value.detail["code"] == "student_archived"
    assert error.value.detail["student_ids"] == [RACER]
    assert [r["student_id"] for r in db.tables["writing_assignments"]] == [ACTIVE_ID]


def test_activation_step6_stays_best_effort_when_the_backfill_is_refused(caplog):
    """The code is already claimed at Step 6: activation still succeeds and
    logs the refusal; no give is created for the learner."""
    db = FakeDB({"access_codes": [_code_row()],
                 "users": [{"id": USER_ID, "is_active": False}],
                 "students": [_row(RACER, archived=False, user_id=USER_ID, cohort_id=COHORT_ID)],
                 "student_cohort_memberships": [
                     {"id": "m1", "student_id": RACER, "cohort_id": COHORT_ID, "is_active": True}],
                 "cohorts": [{"id": COHORT_ID, "created_by": None}],
                 "user_code_assignments": [], "student_lifecycle_audit": [],
                 "writing_assignments": [_open_give()]})
    db.before_write = _trigger()
    with caplog.at_level(logging.WARNING, logger="routers.auth"):
        result = _activate(db)
    assert result["success"] is True
    assert db.tables["access_codes"][0]["is_used"] is True
    assert [r["student_id"] for r in db.tables["writing_assignments"]] == [ACTIVE_ID]
    assert any("cohort give backfill failed" in m and "student_archived" in m for m in caplog.messages)


def test_roster_backfill_script_skips_the_archived_learner_and_continues(caplog, monkeypatch):
    from scripts import backfill_class_enrollment_roster as script
    db = _db(writing_assignments=[_open_give()])
    # RACER comes first in the roster, so continuing past them is observable.
    db.tables["students"].append(_row("00000000-0000-0000-0000-000000000004", archived=False))
    db.tables["student_cohort_memberships"] = [
        {"id": "m1", "student_id": RACER, "cohort_id": COHORT_ID, "is_active": True},
        {"id": "m3", "student_id": "00000000-0000-0000-0000-000000000004",
         "cohort_id": COHORT_ID, "is_active": True}]
    db.before_write = _trigger()
    monkeypatch.setattr(sys, "argv", ["backfill_class_enrollment_roster", "--apply"])
    with patch("database.supabase_admin", db), \
            caplog.at_level(logging.INFO, logger="backfill_class_enrollment_roster"):
        assert script.main() == 0
    given = sorted(r["student_id"] for r in db.tables["writing_assignments"])
    assert given == sorted([ACTIVE_ID, "00000000-0000-0000-0000-000000000004"])
    assert f"E1 skipped archived student={RACER} cohort={COHORT_ID}" in caplog.messages
    assert any("skipped_archived=1" in m for m in caplog.messages)


# ── Mapping boundaries ──────────────────────────────────────────────────────

def test_other_insert_errors_still_fail_as_500():
    db = _db()

    def fk_violation(db, table, action, payload):
        if table == "writing_assignments" and action == "insert":
            raise APIError({"message": "insert or update on table violates foreign key constraint",
                            "code": "23503", "details": "Key (prompt_id) is not present"})
    db.before_write = fk_violation
    admin, sb = _writing_patches(db)
    from main import app
    with admin, sb:
        r = TestClient(app, raise_server_exceptions=False).post(
            "/admin/writing/assignments", headers=AUTH,
            json={"prompt_ids": [PROMPT], "student_ids": [ACTIVE_ID]})
    assert r.status_code == 500


def test_mapping_helper_contract():
    from services.student_service import raise_if_student_archived
    db = _db()
    # Not an archive refusal → no-op (the caller re-raises the original).
    raise_if_student_archived(db, APIError({"message": "boom", "code": "XX000"}), [RACER])
    # An already-mapped 409 is not re-wrapped.
    raise_if_student_archived(db, HTTPException(409, {"code": "student_archived"}), [RACER])
    # The 326 bulk guard's comma DETAIL names every learner.
    with pytest.raises(HTTPException) as error:
        raise_if_student_archived(db, APIError({"message": "student_archived", "code": "P0001",
                                                "details": f"{RACER},{ACTIVE_ID}"}))
    assert error.value.detail["student_ids"] == sorted([RACER, ACTIVE_ID])
    # No DETAIL and the re-read fails → still a 409, without ids.
    broken = FakeDB()
    broken.table = lambda name: (_ for _ in ()).throw(RuntimeError("db down"))
    with pytest.raises(HTTPException) as error:
        raise_if_student_archived(broken, _trigger_error(None), [RACER])
    assert error.value.status_code == 409 and "student_ids" not in error.value.detail
