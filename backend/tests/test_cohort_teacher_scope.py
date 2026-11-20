"""G09-T24 (ADMINIA-0074 FR-102, FR-108, FR-113): one teacher per class.

* services/staff_scope.py — the only reader of cohorts.instructor_id for
  access: an admin sees every class, a teacher only the classes whose
  instructor_id is theirs, a class without a teacher belongs to no teacher,
  and an unreadable scope fails closed (503), never "every class".
* PATCH /admin/cohorts/{id} — instructor_id (an active instructor or admin,
  else 422 invalid_instructor), weekly_schedule and start_date; the teacher
  change goes through fn_set_cohort_teacher, which logs it. A teacher change
  sent with is_active is refused (422) before anything is written.
* GET /admin/cohorts and /{id}/members carry `instructor: {id, name} | null`.

The SQL runs on PostgreSQL in test_migration_441_cohort_teacher_schedule.py.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from routers import cohorts as mod
from services import staff_scope

COHORT_A = "aaaaaaaa-0000-0000-0000-000000000001"
COHORT_B = "bbbbbbbb-0000-0000-0000-000000000002"
TEACHER_A = "11111111-0000-0000-0000-00000000000a"
TEACHER_B = "11111111-0000-0000-0000-00000000000b"
LEARNER = "22222222-0000-0000-0000-000000000001"
GONE = "22222222-0000-0000-0000-000000000002"
NOBODY = "99999999-0000-0000-0000-000000000000"


class _Resp:
    def __init__(self, data):
        self.data = data


class _Table:
    """A tiny in-memory table: select/eq/in_/limit/update/execute."""

    def __init__(self, db, name):
        self.db, self.name, self.filters, self.payload = db, name, [], None

    def select(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def order(self, *_a, **_k): return self

    def eq(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) == str(val))
        return self

    def in_(self, col, vals):
        self.filters.append(lambda r: r.get(col) in vals)
        return self

    def update(self, payload):
        self.payload = payload
        return self

    def execute(self):
        if self.name in self.db.fail:
            raise RuntimeError("db down")
        rows = [r for r in self.db.rows[self.name] if all(f(r) for f in self.filters)]
        if self.payload is not None:
            for r in rows:
                r.update(self.payload)
        return _Resp([dict(r) for r in rows])


class _Rpc:
    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        assert self.name == "fn_set_cohort_teacher"
        if self.name in self.db.fail:
            raise RuntimeError("db down")
        self.db.rpc_calls.append(self.params)
        row = next((r for r in self.db.rows["cohorts"] if r["id"] == self.params["p_cohort_id"]), None)
        if row is None:
            return _Resp(None)
        previous = row.get("instructor_id")
        if previous == self.params["p_instructor_id"]:
            return _Resp({"status": "unchanged", "instructor_id": previous})
        row["instructor_id"] = self.params["p_instructor_id"]
        return _Resp({"status": "changed", "instructor_id": row["instructor_id"],
                      "previous_instructor_id": previous})


class _DB:
    def __init__(self):
        self.rows = {
            "cohorts": [
                {"id": COHORT_A, "name": "IELTS 6.5 tối 2-4", "instructor_id": TEACHER_A},
                {"id": COHORT_B, "name": "IELTS 7.0 sáng", "instructor_id": None},
            ],
            "users": [
                {"id": TEACHER_A, "role": "instructor", "is_active": True, "display_name": "Cô Lan"},
                {"id": TEACHER_B, "role": "instructor", "is_active": True, "display_name": "Thầy Minh"},
                {"id": "admin-1", "role": "admin", "is_active": True, "display_name": "Andy"},
                {"id": LEARNER, "role": "user", "is_active": True, "display_name": "Học viên"},
                {"id": GONE, "role": "instructor", "is_active": False, "display_name": "Đã nghỉ"},
            ],
        }
        self.fail: set[str] = set()
        self.rpc_calls: list[dict] = []

    def table(self, name):
        return _Table(self, name)

    def rpc(self, name, params):
        return _Rpc(self, name, params)


@pytest.fixture
def db(monkeypatch):
    fake = _DB()
    monkeypatch.setattr(staff_scope, "supabase_admin", fake)
    monkeypatch.setattr(mod, "supabase_admin", fake)
    return fake


def _as(monkeypatch, db, user_id):
    """Pretend require_instructor admitted ``user_id``; the role comes from the
    fake users table, as _staff_role_row reads it."""
    async def require_instructor(_auth):
        role = next((u["role"] for u in db.rows["users"] if u["id"] == user_id), None)
        if role not in ("instructor", "admin"):
            raise HTTPException(403, "staff only")
        return {"id": user_id}

    async def role_row(uid):
        if "users" in db.fail:
            raise RuntimeError("db down")
        return _Resp([{"role": u["role"]} for u in db.rows["users"] if u["id"] == uid])

    monkeypatch.setattr(staff_scope, "require_instructor", require_instructor)
    monkeypatch.setattr(staff_scope, "_staff_role_row", role_row)


# ── staff_scope ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_admin_sees_every_class(monkeypatch, db):
    _as(monkeypatch, db, "admin-1")
    scope = await staff_scope.resolve_staff_scope("Bearer x")
    assert scope.is_admin and scope.cohort_ids is None
    scope.assert_cohort(COHORT_B)  # a class without a teacher is still an admin's


@pytest.mark.asyncio
async def test_teacher_sees_only_their_classes(monkeypatch, db):
    _as(monkeypatch, db, TEACHER_A)
    scope = await staff_scope.resolve_staff_scope("Bearer x")
    assert scope.cohort_ids == frozenset({COHORT_A}) and not scope.is_admin
    scope.assert_cohort(COHORT_A)
    with pytest.raises(HTTPException) as caught:
        scope.assert_cohort(COHORT_B)  # no teacher: admins only
    assert caught.value.status_code == 404
    assert scope.filter_cohorts([COHORT_A, COHORT_B]) == [COHORT_A]


@pytest.mark.asyncio
async def test_moving_a_class_to_another_teacher_moves_the_access(monkeypatch, db):
    db.rows["cohorts"][0]["instructor_id"] = TEACHER_B
    _as(monkeypatch, db, TEACHER_A)
    old = await staff_scope.resolve_staff_scope("Bearer x")
    with pytest.raises(HTTPException) as caught:
        old.assert_cohort(COHORT_A)
    assert caught.value.status_code == 404
    _as(monkeypatch, db, TEACHER_B)
    (await staff_scope.resolve_staff_scope("Bearer x")).assert_cohort(COHORT_A)


@pytest.mark.asyncio
async def test_a_learner_is_refused(monkeypatch, db):
    _as(monkeypatch, db, LEARNER)
    with pytest.raises(HTTPException) as caught:
        await staff_scope.resolve_staff_scope("Bearer x")
    assert caught.value.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("table", ["users", "cohorts"])
async def test_an_unreadable_scope_fails_closed(monkeypatch, db, table):
    _as(monkeypatch, db, TEACHER_A)
    db.fail.add(table)
    with pytest.raises(HTTPException) as caught:
        await staff_scope.resolve_staff_scope("Bearer x")
    assert caught.value.status_code == 503
    assert caught.value.detail["code"] == "staff_scope_unavailable"


# ── PATCH /admin/cohorts/{id} ───────────────────────────────────────────────

async def _patch(cohort_id, **fields):
    with patch.object(mod, "require_admin", AsyncMock(return_value={"id": "admin-1", "email": "a@x.test"})):
        return await mod.update_cohort(cohort_id, mod.CohortPatchRequest(**fields), None)


@pytest.mark.asyncio
async def test_setting_a_teacher_goes_through_the_logged_rpc(db):
    row = await _patch(COHORT_B, instructor_id=TEACHER_B)
    assert db.rpc_calls == [{"p_cohort_id": COHORT_B, "p_instructor_id": TEACHER_B,
                             "p_actor_id": "admin-1", "p_actor_email": "a@x.test"}]
    assert row["instructor_id"] == TEACHER_B and row["teacher_receipt"]["status"] == "changed"
    # Setting the class teacher never rewrites a student's Writing teacher.
    assert "students" not in db.rows


@pytest.mark.asyncio
async def test_explicit_null_removes_the_teacher(db):
    row = await _patch(COHORT_A, instructor_id=None)
    assert db.rpc_calls[0]["p_instructor_id"] is None and row["instructor_id"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("user_id", [LEARNER, GONE, NOBODY])
async def test_only_an_active_instructor_or_admin_can_be_the_teacher(db, user_id):
    with pytest.raises(HTTPException) as caught:
        await _patch(COHORT_A, instructor_id=user_id)
    assert caught.value.status_code == 422 and caught.value.detail["code"] == "invalid_instructor"
    assert db.rpc_calls == []


@pytest.mark.asyncio
async def test_schedule_and_start_date_are_saved_and_cleared(db):
    row = await _patch(COHORT_A, weekly_schedule=[{"dow": 1, "start": "19:30"}, {"dow": 3, "start": "19:30"}],
                       start_date="2026-12-01")
    assert row["weekly_schedule"] == [{"dow": 1, "start": "19:30"}, {"dow": 3, "start": "19:30"}]
    assert row["start_date"] == "2026-12-01" and db.rpc_calls == []
    row = await _patch(COHORT_A, weekly_schedule=None, start_date=None)
    assert row["weekly_schedule"] is None and row["start_date"] is None


@pytest.mark.parametrize("slot", [{"dow": 0, "start": "19:30"}, {"dow": 8, "start": "19:30"},
                                  {"dow": 2, "start": "7:30"}, {"dow": 2, "start": "24:00"},
                                  {"dow": "2", "start": "19:30"}])
def test_a_bad_schedule_slot_is_refused(slot):
    with pytest.raises(ValidationError):
        mod.CohortPatchRequest(weekly_schedule=[slot])


@pytest.mark.asyncio
async def test_a_failed_teacher_write_is_reported_and_nothing_else_is_saved(db):
    db.fail.add("fn_set_cohort_teacher")
    with pytest.raises(HTTPException) as caught:
        await _patch(COHORT_A, instructor_id=TEACHER_B, name="Lớp mới")
    assert caught.value.status_code == 500
    assert db.rows["cohorts"][0]["name"] == "IELTS 6.5 tối 2-4"


@pytest.mark.asyncio
@pytest.mark.parametrize("is_active", [False, True])
async def test_teacher_change_with_archive_or_restore_is_refused_before_any_write(
        db, monkeypatch, is_active):
    lifecycle_calls = []
    monkeypatch.setattr(mod.class_archive_service, "archive_class",
                        lambda *a, **k: lifecycle_calls.append(("archive", k)) or {"status": "archived"})
    monkeypatch.setattr(mod.class_archive_service, "restore_class",
                        lambda *a, **k: lifecycle_calls.append(("restore", k)) or {"status": "restored"})
    before = [dict(r) for r in db.rows["cohorts"]]
    with pytest.raises(HTTPException) as caught:
        await _patch(COHORT_A, is_active=is_active, instructor_id=TEACHER_B)
    assert caught.value.status_code == 422
    assert caught.value.detail["code"] == "teacher_and_lifecycle_together"
    assert lifecycle_calls == [] and db.rpc_calls == []
    assert db.rows["cohorts"] == before


# ── Reads ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_members_route_names_the_teacher(db, monkeypatch):
    monkeypatch.setattr(mod, "active_students_for_cohort", lambda *_a, **_k: [])
    with patch.object(mod, "require_admin", AsyncMock(return_value={"id": "admin-1"})):
        out = await mod.cohort_members(COHORT_A, None)
        assert out["cohort"]["instructor"] == {"id": TEACHER_A, "name": "Cô Lan"}
        out = await mod.cohort_members(COHORT_B, None)
        assert out["cohort"]["instructor"] is None
        db.fail.add("users")
        out = await mod.cohort_members(COHORT_A, None)
    # The teacher is known; only the name could not be read, and that is said.
    assert out["cohort"]["instructor"] == {"id": TEACHER_A, "name": None}
    assert out["cohort"]["instructor_lookup_failed"] is True


def test_teacher_helpers_ignore_rows_read_before_441(db):
    names, failed = mod._teacher_names([None, None])
    assert names == {} and failed is False
    assert mod._teacher_of({"id": COHORT_A}, names) is None
