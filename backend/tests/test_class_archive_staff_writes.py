"""CLASSARCHIVE-0030 T005 (W3–W6, W8, W10, W13): staff writes into an archived class.

research.md §4.1/§4.2: every admin write that would add a learner, a code or
new work to an archived class (``is_active = false AND archived_at IS NOT
NULL``) answers 409 ``{"code": "cohort_archived", "message": <staff text>}``
before anything is written. A legacy inactive class (``archived_at IS NULL``)
and an active class behave as before (FR-009). A ``cohort_archived`` raise of
the 337/346 guards (the class was archived after the pre-check) maps to the
same 409; ``student_archived`` keeps precedence; no response carries DB text.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from postgrest.exceptions import APIError

from routers import admin as admin_mod
from routers import admin_class_assignments as ca_mod
from routers import admin_class_lessons as lessons_mod
from routers import admin_students as students_mod
from routers import cohorts as cohorts_mod
from services import class_archive_service as svc
from services import student_service

CID = "aaaaaaaa-0000-0000-0000-000000000001"
SID = "bbbbbbbb-0000-0000-0000-000000000001"
SID2 = "bbbbbbbb-0000-0000-0000-000000000002"
UID = "cccccccc-0000-0000-0000-000000000001"
CODE_ID = "dddddddd-0000-0000-0000-000000000001"
OTHER_CID = "aaaaaaaa-0000-0000-0000-000000000002"
ADMIN = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}
DB_TEXT = 'relation "cohorts" secret_col private-db-value'

ACTIVE = {"is_active": True, "archived_at": None}
LEGACY = {"is_active": False, "archived_at": None}
ARCHIVED = {"is_active": False, "archived_at": "2026-11-02T12:00:00+00:00"}
STATES = {"active": ACTIVE, "legacy": LEGACY, "archived": ARCHIVED}


class _Calls(list):
    """Recorded calls plus an optional exception to raise."""
    fail: BaseException | None = None


def _guard_error() -> APIError:
    return APIError({"code": "P0001", "message": "cohort_archived", "details": CID})


# ── Fake PostgREST client ────────────────────────────────────────────────

class _Q:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.mode, self.payload = "select", None
        self.filters: list = []
        self._not = False

    def select(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def order(self, *_a, **_k): return self

    @property
    def not_(self):
        self._not = True
        return self

    def eq(self, field, value):
        self.filters.append(lambda row, f=field, v=value: str(row.get(f)) == str(v))
        return self

    def in_(self, field, values):
        vals = {str(v) for v in values}
        self.filters.append(lambda row, f=field: str(row.get(f)) in vals)
        return self

    def is_(self, field, value):
        negate, self._not = self._not, False
        assert value == "null"
        self.filters.append(lambda row, f=field, n=negate: (row.get(f) is None) != n)
        return self

    def insert(self, payload):
        self.mode, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.mode, self.payload = "update", payload
        return self

    def upsert(self, payload, **_k):
        self.mode, self.payload = "upsert", payload
        return self

    def execute(self):
        key = f"{self.table}.{self.mode}"
        self.db.calls.append((key, self.payload))
        failure = self.db.fail.get(key)
        if failure:
            raise failure
        rows = [r for r in self.db.tables.get(self.table, [])
                if all(f(r) for f in self.filters)]
        if self.mode == "select":
            return SimpleNamespace(data=[dict(r) for r in rows])
        if self.mode == "update":
            for row in rows:
                row.update(self.payload)
            return SimpleNamespace(data=[dict(r) for r in rows])
        payload = self.payload if isinstance(self.payload, dict) else {}
        return SimpleNamespace(data=[{"id": "new-row", **payload}])


class _Rpc:
    def __init__(self, db, name, params):
        self.db, self.name, self.params = db, name, params

    def execute(self):
        self.db.calls.append((self.name, self.params))
        failure = self.db.fail.get(self.name)
        if failure:
            raise failure
        return SimpleNamespace(data=self.db.rpc_result.get(self.name))


class _Db:
    def __init__(self, cohort_state=ACTIVE):
        self.tables = {
            "cohorts": [{"id": CID, "name": "C2-K12", **cohort_state},
                        {"id": OTHER_CID, "name": "C2-K13", **ACTIVE}],
            "students": [{"id": SID, "user_id": UID, "archived_at": None},
                         {"id": SID2, "user_id": None, "archived_at": None}],
            "users": [{"id": UID, "is_active": True}],
            "access_codes": [{"id": CODE_ID, "code": "AVR-1", "cohort_id": CID,
                              "code_type": "direct", "permissions": ["all"],
                              "is_revoked": False, "used_by": UID, "notes": None}],
            "user_code_assignments": [{"id": "uca-1", "code_id": CODE_ID, "user_id": UID,
                                       "is_active": True}],
        }
        self.calls: list = []
        self.fail: dict = {}
        self.rpc_result: dict = {}

    def table(self, name): return _Q(self, name)
    def rpc(self, name, params): return _Rpc(self, name, params)

    def writes(self) -> list:
        return [name for name, _ in self.calls
                if not name.endswith(".select")]


@pytest.fixture
def db(monkeypatch):
    fake = _Db()
    for module in (cohorts_mod, admin_mod, ca_mod, lessons_mod):
        monkeypatch.setattr(module, "supabase_admin", fake)
    for module in (cohorts_mod, admin_mod, ca_mod, lessons_mod):
        monkeypatch.setattr(module, "require_admin", AsyncMock(return_value=ADMIN))
    return fake


def _set_state(db, state):
    db.tables["cohorts"][0].update(STATES[state])


def _run(coro):
    return asyncio.run(coro)


def _assert_cohort_archived(exc_info):
    exc = exc_info.value
    assert exc.status_code == 409
    assert exc.detail == {"code": "cohort_archived", "message": svc.COHORT_ARCHIVED_STAFF_MESSAGE}
    assert DB_TEXT not in str(exc.detail)


def _assert_student_archived(exc_info, ids):
    exc = exc_info.value
    assert exc.status_code == 409
    assert exc.detail["code"] == "student_archived"
    assert exc.detail["student_ids"] == sorted(ids)


# ── W3 single add ────────────────────────────────────────────────────────

def _assign(sid=SID):
    return cohorts_mod.assign_student_to_cohort(
        CID, cohorts_mod.AssignStudentRequest(student_id=sid), authorization="Bearer t")


def test_w3_archived_class_refuses_before_the_membership_rpc(db):
    _set_state(db, "archived")
    with pytest.raises(HTTPException) as exc_info:
        _run(_assign())
    _assert_cohort_archived(exc_info)
    assert db.writes() == []


def test_w3_archived_learner_gets_student_archived_first(db):
    _set_state(db, "archived")
    db.tables["students"][0]["archived_at"] = "2026-10-01T00:00:00+00:00"
    with pytest.raises(HTTPException) as exc_info:
        _run(_assign())
    _assert_student_archived(exc_info, [SID])
    assert db.writes() == []


@pytest.mark.parametrize("state", ["active", "legacy"])
def test_w3_active_and_legacy_classes_add_as_before(db, state):
    _set_state(db, state)
    out = _run(_assign())
    assert out == {"ok": True, "student_id": SID, "cohort_id": CID}
    assert db.writes() == ["fn_add_student_cohort_membership"]


def test_w3_guard_raise_after_the_precheck_is_the_409(db):
    db.fail["fn_add_student_cohort_membership"] = _guard_error()
    with pytest.raises(HTTPException) as exc_info:
        _run(_assign())
    _assert_cohort_archived(exc_info)


def test_w3_student_archived_guard_keeps_precedence_over_cohort_mapping(db):
    db.fail["fn_add_student_cohort_membership"] = Exception("student_archived")
    with pytest.raises(HTTPException) as exc_info:
        _run(_assign())
    _assert_student_archived(exc_info, [SID])


def test_w3_other_db_errors_stay_generic(db):
    db.fail["fn_add_student_cohort_membership"] = Exception(DB_TEXT)
    with pytest.raises(HTTPException) as exc_info:
        _run(_assign())
    assert exc_info.value.status_code == 500
    assert DB_TEXT not in str(exc_info.value.detail)


# ── W4 bulk add ──────────────────────────────────────────────────────────

def _bulk():
    return cohorts_mod.bulk_assign_students_to_cohort(
        CID, cohorts_mod.BulkAssignStudentsRequest(student_ids=[SID, SID2]),
        authorization="Bearer t")


def test_w4_archived_class_refuses_the_whole_batch(db):
    _set_state(db, "archived")
    with pytest.raises(HTTPException) as exc_info:
        _run(_bulk())
    _assert_cohort_archived(exc_info)
    assert db.writes() == []


def test_w4_an_archived_learner_in_the_batch_gets_student_archived_first(db):
    _set_state(db, "archived")
    db.tables["students"][1]["archived_at"] = "2026-10-01T00:00:00+00:00"
    with pytest.raises(HTTPException) as exc_info:
        _run(_bulk())
    _assert_student_archived(exc_info, [SID2])
    assert db.writes() == []


def test_w4_failed_learner_lookup_still_refuses_as_cohort_archived(db, monkeypatch):
    _set_state(db, "archived")
    monkeypatch.setattr(student_service, "archived_student_ids",
                        lambda *_a: (_ for _ in ()).throw(Exception(DB_TEXT)))
    with pytest.raises(HTTPException) as exc_info:
        _run(_bulk())
    _assert_cohort_archived(exc_info)
    assert db.writes() == []


@pytest.mark.parametrize("state", ["active", "legacy"])
def test_w4_active_and_legacy_classes_add_as_before(db, state):
    _set_state(db, state)
    db.rpc_result["fn_add_students_cohort_membership"] = 2
    out = _run(_bulk())
    assert out == {"ok": True, "cohort_id": CID, "assigned": 2}
    assert db.writes() == ["fn_add_students_cohort_membership"]


def test_w4_guard_raise_is_the_409(db):
    db.fail["fn_add_students_cohort_membership"] = _guard_error()
    with pytest.raises(HTTPException) as exc_info:
        _run(_bulk())
    _assert_cohort_archived(exc_info)


# ── W5 add by issuing a code ─────────────────────────────────────────────

@pytest.fixture
def issued(monkeypatch):
    calls: list = []

    def fake_issue(**kwargs):
        calls.append(("issue", kwargs))
        return {"id": "new-code", "code": "AVR-NEW", "permissions": ["all"]}

    for module in (cohorts_mod, admin_mod):
        monkeypatch.setattr(module, "_issue_code_and_assign", fake_issue)
        monkeypatch.setattr(module, "_activate_with_issued_code",
                            lambda user_id, code: calls.append(("activate", user_id)))
    return calls


def _add_member():
    return cohorts_mod.add_cohort_member(
        CID, cohorts_mod.AddMemberRequest(user_id=UID), authorization="Bearer t")


def test_w5_archived_class_issues_no_code(db, issued):
    _set_state(db, "archived")
    with pytest.raises(HTTPException) as exc_info:
        _run(_add_member())
    _assert_cohort_archived(exc_info)
    assert issued == []
    assert db.writes() == []


@pytest.mark.parametrize("state", ["active", "legacy"])
def test_w5_active_and_legacy_classes_issue_as_before(db, issued, state):
    _set_state(db, state)
    out = _run(_add_member())
    assert out["new_code"] == "AVR-NEW"
    assert [kind for kind, _ in issued] == ["issue", "activate"]
    assert issued[0][1]["cohort_id"] == CID


# ── W6 admin class codes ─────────────────────────────────────────────────

@pytest.fixture
def minted(monkeypatch):
    calls: list = []

    def fake_insert(_table, rows):
        calls.append(rows)
        return SimpleNamespace(data=[{"id": f"c{i}", **row} for i, row in enumerate(rows)]), \
            [f"AVR-{i}" for i in range(len(rows))]

    monkeypatch.setattr(admin_mod, "insert_with_unique_codes", fake_insert)
    monkeypatch.setattr(admin_mod, "_audit_entitlement", lambda *_a, **_k: None)
    return calls


def _generate(cohort_id=CID):
    return admin_mod.generate_access_codes(
        admin_mod.GenerateCodesRequest(count=2, permissions=["all"], code_type="direct",
                                       cohort_id=cohort_id),
        authorization="Bearer t")


def test_w6_generate_into_an_archived_class_inserts_nothing(db, minted):
    _set_state(db, "archived")
    with pytest.raises(HTTPException) as exc_info:
        _run(_generate())
    _assert_cohort_archived(exc_info)
    assert minted == []


@pytest.mark.parametrize("state", ["active", "legacy"])
def test_w6_generate_into_active_and_legacy_classes_as_before(db, minted, state):
    _set_state(db, state)
    out = _run(_generate())
    assert out["created"] == 2
    assert [row["cohort_id"] for row in minted[0]] == [CID, CID]


def test_w6_generate_without_a_class_does_not_read_cohorts(db, minted):
    out = _run(admin_mod.generate_access_codes(
        admin_mod.GenerateCodesRequest(count=1, permissions=["all"], code_type="mass"),
        authorization="Bearer t"))
    assert out["created"] == 1
    assert "cohorts.select" not in [name for name, _ in db.calls]


def test_w6_failed_class_read_refuses_without_db_text(db, minted):
    db.fail["cohorts.select"] = Exception(DB_TEXT)
    with pytest.raises(HTTPException) as exc_info:
        _run(_generate())
    assert exc_info.value.status_code == 500
    assert exc_info.value.detail["error_code"] == "cohort_lookup_failed"
    assert DB_TEXT not in str(exc_info.value.detail)
    assert minted == []


def _generate_and_assign():
    return admin_mod.generate_and_assign_code(
        admin_mod.GenerateAndAssignRequest(user_id=UID, code_type="direct", cohort_id=CID),
        authorization="Bearer t")


def test_w6_generate_and_assign_into_an_archived_class_issues_nothing(db, issued, monkeypatch):
    monkeypatch.setattr(admin_mod, "_audit_entitlement", lambda *_a, **_k: None)
    _set_state(db, "archived")
    with pytest.raises(HTTPException) as exc_info:
        _run(_generate_and_assign())
    _assert_cohort_archived(exc_info)
    assert issued == []
    assert db.writes() == []


def test_w6_generate_and_assign_archived_learner_first(db, issued, monkeypatch):
    monkeypatch.setattr(admin_mod, "_audit_entitlement", lambda *_a, **_k: None)
    _set_state(db, "archived")
    db.tables["students"][0]["archived_at"] = "2026-10-01T00:00:00+00:00"
    with pytest.raises(HTTPException) as exc_info:
        _run(_generate_and_assign())
    _assert_student_archived(exc_info, [SID])
    assert issued == []


@pytest.mark.parametrize("state", ["active", "legacy"])
def test_w6_generate_and_assign_active_and_legacy_as_before(db, issued, monkeypatch, state):
    monkeypatch.setattr(admin_mod, "_audit_entitlement", lambda *_a, **_k: None)
    _set_state(db, state)
    out = _run(_generate_and_assign())
    assert out["code"] == "AVR-NEW"
    assert "fn_add_student_cohort_membership" in db.writes()


def _patch_code(**fields):
    return admin_mod.patch_access_code(
        CODE_ID, admin_mod.PatchCodeRequest(**fields), authorization="Bearer t")


def test_w6_moving_a_code_into_an_archived_class_is_refused(db, monkeypatch):
    monkeypatch.setattr(admin_mod, "_audit_entitlement", lambda *_a, **_k: None)
    db.tables["access_codes"][0]["cohort_id"] = OTHER_CID
    _set_state(db, "archived")
    with pytest.raises(HTTPException) as exc_info:
        _run(_patch_code(cohort_id=CID))
    _assert_cohort_archived(exc_info)
    assert db.writes() == []
    assert db.tables["access_codes"][0]["cohort_id"] == OTHER_CID


def test_w6_resending_the_codes_current_archived_class_is_not_a_change(db, monkeypatch):
    monkeypatch.setattr(admin_mod, "_audit_entitlement", lambda *_a, **_k: None)
    _set_state(db, "archived")
    out = _run(_patch_code(cohort_id=CID, notes="ghi chú"))
    assert out["notes"] == "ghi chú"
    assert db.writes() == ["access_codes.update"]


@pytest.mark.parametrize("state", ["active", "legacy"])
def test_w6_moving_a_code_into_active_or_legacy_class_as_before(db, monkeypatch, state):
    monkeypatch.setattr(admin_mod, "_audit_entitlement", lambda *_a, **_k: None)
    db.tables["access_codes"][0]["cohort_id"] = OTHER_CID
    _set_state(db, state)
    out = _run(_patch_code(cohort_id=CID))
    assert out["cohort_id"] == CID


def test_w6_refill_from_an_archived_class_code_issues_nothing(db, issued, monkeypatch):
    monkeypatch.setattr(admin_mod, "_audit_entitlement", lambda *_a, **_k: None)
    _set_state(db, "archived")
    with pytest.raises(HTTPException) as exc_info:
        _run(admin_mod.refill_code(CODE_ID, admin_mod.RefillRequest(), authorization="Bearer t"))
    _assert_cohort_archived(exc_info)
    assert issued == []


@pytest.mark.parametrize("state", ["active", "legacy"])
def test_w6_refill_active_and_legacy_as_before(db, issued, monkeypatch, state):
    monkeypatch.setattr(admin_mod, "_audit_entitlement", lambda *_a, **_k: None)
    _set_state(db, state)
    out = _run(admin_mod.refill_code(CODE_ID, admin_mod.RefillRequest(), authorization="Bearer t"))
    assert out["new_code"] == "AVR-NEW"


# ── W8 class assignments ─────────────────────────────────────────────────

@pytest.fixture
def give(monkeypatch):
    calls = _Calls()

    def fake_create(_db, **kwargs):
        calls.append(kwargs)
        if calls.fail is not None:
            raise calls.fail
        return {"assignment_id": "a1", "student_count": 1}

    monkeypatch.setattr(ca_mod, "create_class_assignment", fake_create)
    monkeypatch.setattr(ca_mod, "_resolve_speaking_topic", lambda *_a: ("topic-1", {}))
    return calls


def _create_speaking():
    return ca_mod.create_assignment(
        CID, ca_mod.AssignmentCreate(skill="speaking", title="Bài 1", content_id="topic-1"),
        authorization="Bearer t")


def test_w8_archived_class_gets_no_new_assignment(db, give):
    _set_state(db, "archived")
    with pytest.raises(HTTPException) as exc_info:
        _run(_create_speaking())
    _assert_cohort_archived(exc_info)
    assert give == []


@pytest.mark.parametrize("state", ["active", "legacy"])
def test_w8_active_and_legacy_classes_give_as_before(db, give, state):
    _set_state(db, state)
    assert _run(_create_speaking())["assignment_id"] == "a1"
    assert len(give) == 1


def test_w8_guard_raise_after_the_check_is_the_409(db, give):
    give.fail = _guard_error()
    with pytest.raises(HTTPException) as exc_info:
        _run(_create_speaking())
    _assert_cohort_archived(exc_info)


def test_w8_a_grammar_give_completed_before_the_archive_replays(db, give, monkeypatch):
    _set_state(db, "archived")
    receipt = {"assignment_id": "a-old", "replayed": True}
    monkeypatch.setattr(ca_mod, "_require_course_five", lambda *_a: None)
    monkeypatch.setattr(ca_mod, "_grammar_give_fingerprint", lambda *_a: "fp")
    monkeypatch.setattr(ca_mod, "_existing_grammar_give", lambda *_a: receipt)
    body = ca_mod.AssignmentCreate.model_construct(
        skill="grammar", title="Ôn", grammar_lesson_id="M30-B02",
        give_request_id="11111111-1111-1111-1111-111111111111")
    assert _run(ca_mod.create_assignment(CID, body, authorization="Bearer t")) == receipt
    assert give == []


def test_w8_a_new_grammar_give_into_an_archived_class_is_refused(db, give, monkeypatch):
    _set_state(db, "archived")
    monkeypatch.setattr(ca_mod, "_require_course_five", lambda *_a: None)
    monkeypatch.setattr(ca_mod, "_grammar_give_fingerprint", lambda *_a: "fp")
    monkeypatch.setattr(ca_mod, "_existing_grammar_give", lambda *_a: None)
    body = ca_mod.AssignmentCreate.model_construct(
        skill="grammar", title="Ôn", grammar_lesson_id="M30-B02",
        give_request_id="11111111-1111-1111-1111-111111111111")
    with pytest.raises(HTTPException) as exc_info:
        _run(ca_mod.create_assignment(CID, body, authorization="Bearer t"))
    _assert_cohort_archived(exc_info)
    assert give == []


@pytest.fixture
def backfill(monkeypatch, db):
    calls = _Calls()
    db.tables["class_assignments"] = [{"id": "a1", "cohort_id": CID}]

    def fake_backfill(_db, **kwargs):
        calls.append(kwargs)
        if calls.fail is not None:
            raise calls.fail
        return {"created_count": 1}

    monkeypatch.setattr(ca_mod, "backfill_assignment_items", fake_backfill)
    return calls


def _backfill():
    return ca_mod.backfill_assignment(CID, "a1", ca_mod.BackfillBody(), authorization="Bearer t")


def test_w8_backfill_into_an_archived_class_is_refused(db, backfill):
    _set_state(db, "archived")
    with pytest.raises(HTTPException) as exc_info:
        _run(_backfill())
    _assert_cohort_archived(exc_info)
    assert backfill == []


@pytest.mark.parametrize("state", ["active", "legacy"])
def test_w8_backfill_active_and_legacy_as_before(db, backfill, state):
    _set_state(db, state)
    assert _run(_backfill()) == {"created_count": 1}


def test_w8_backfill_guard_raise_is_the_409(db, backfill):
    backfill.fail = _guard_error()
    with pytest.raises(HTTPException) as exc_info:
        _run(_backfill())
    _assert_cohort_archived(exc_info)


# ── W10 class lessons ────────────────────────────────────────────────────

def _create_lesson():
    return lessons_mod.create_lesson(CID, lessons_mod.LessonCreate(title="Buổi 1"),
                                     authorization="Bearer t")


def _update_lesson():
    return lessons_mod.update_lesson(CID, "l1", lessons_mod.LessonPatch(title="Đổi"),
                                     authorization="Bearer t")


@pytest.mark.parametrize("call", [_create_lesson, _update_lesson])
def test_w10_archived_class_refuses_lesson_create_and_edit(db, call):
    db.tables["class_lessons"] = [{"id": "l1", "cohort_id": CID, "title": "Buổi 1"}]
    _set_state(db, "archived")
    with pytest.raises(HTTPException) as exc_info:
        _run(call())
    _assert_cohort_archived(exc_info)
    assert db.writes() == []


@pytest.mark.parametrize("state", ["active", "legacy"])
@pytest.mark.parametrize("call", [_create_lesson, _update_lesson])
def test_w10_active_and_legacy_classes_edit_as_before(db, call, state):
    db.tables["class_lessons"] = [{"id": "l1", "cohort_id": CID, "title": "Buổi 1"}]
    _set_state(db, state)
    _run(call())
    assert db.writes() in (["class_lessons.insert"], ["class_lessons.update"])


def test_w10_archived_class_lessons_stay_readable_and_deletable(db):
    db.tables["class_lessons"] = [{"id": "l1", "cohort_id": CID, "title": "Buổi 1"}]
    _set_state(db, "archived")
    assert _run(lessons_mod.list_lessons(CID, authorization="Bearer t"))["lessons"][0]["id"] == "l1"

    class _Delete(_Q):
        def delete(self):
            self.mode = "delete"
            return self

    db.table = lambda name: _Delete(db, name)
    _run(lessons_mod.delete_lesson(CID, "l1", authorization="Bearer t"))
    assert db.writes() == ["class_lessons.delete"]


# ── W13 learner cohort_id edit ───────────────────────────────────────────

def test_w13_student_patch_cannot_write_cohort_id(monkeypatch):
    """`PATCH /admin/students/{id}` has no `cohort_id` field, so no admin edit of
    a learner can move them into an archived class through it (research.md §4.2
    W13); a name-only edit is unaffected. If the field is ever added, this test
    fails and the route needs `raise_if_cohort_archived` before the write."""
    seen: list = []
    monkeypatch.setattr(students_mod, "require_admin", AsyncMock(return_value=ADMIN))
    monkeypatch.setattr(students_mod.student_service, "update_student",
                        lambda *, student_id, data: seen.append(data) or {"id": student_id})
    body = students_mod.UpdateStudentRequest.model_validate(
        {"full_name": "Lan", "cohort_id": CID})
    _run(students_mod.update_student(SID, body, authorization="Bearer t"))
    assert seen == [{"full_name": "Lan"}]
    assert "cohort_id" not in students_mod.UpdateStudentRequest.model_fields
