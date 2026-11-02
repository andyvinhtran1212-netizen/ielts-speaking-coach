"""CLASSARCHIVE-0030 T004/T006 — learner reads and class-item gates.

- `active_cohort_ids_for_student` drops ARCHIVED classes (``is_active=false AND
  archived_at IS NOT NULL``) in the membership branch and the legacy-pointer
  fallback; a legacy inactive class (``archived_at IS NULL``) is kept (FR-001,
  FR-009). Callers that need history pass ``include_archived=True``; the
  inventory test below lists every caller with its mode.
- `/class/me` and `/class/my-assignments` follow the helper (FR-001).
- `POST /class/assignments/{id}/start` refuses new or continued work in an
  archived class with the learner 409 and keeps every read-only review lane
  (FR-004, Variant A). The Speaking/Reading/Listening validators refuse a new
  session or attempt for an archived class's item.
- Mock sittings: a learner whose exam class is archived gets the truthful
  "class ended" message (research.md §3).
"""

from __future__ import annotations

import ast
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from routers import class_student as mod
from services import class_archive_service as archive
from services import class_assignment_service as cas
from services import class_membership_service as membership
from services import mock_exam_service as mock_svc

ARCHIVED_AT = "2026-11-02T05:00:00+00:00"
ACTIVE = {"id": "c-active", "name": "Lớp đang học", "is_active": True, "archived_at": None,
          "course_id": None, "description": None}
ARCHIVED = {"id": "c-archived", "name": "Lớp đã lưu trữ", "is_active": False,
            "archived_at": ARCHIVED_AT, "course_id": None, "description": None}
LEGACY = {"id": "c-legacy", "name": "Lớp lưu trữ cũ", "is_active": False, "archived_at": None,
          "course_id": None, "description": None}
DB_TEXT = 'relation "cohorts" secret_col private-db-value'
LEARNER_409 = {"code": "cohort_archived", "message": archive.COHORT_ARCHIVED_LEARNER_MESSAGE}


# ── Filtering fake PostgREST client ──────────────────────────────────────

class _Q:
    def __init__(self, db, name):
        self.db, self.name, self.rows = db, name, [dict(r) for r in db.tables.get(name, [])]
        self._negate = False

    def select(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def order(self, *_a, **_k): return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    @property
    def not_(self):
        self._negate = True
        return self

    def _keep(self, keep):
        negate, self._negate = self._negate, False
        self.rows = [r for r in self.rows if keep(r) != negate]
        return self

    def eq(self, field, value):
        return self._keep(lambda r: str(r.get(field)) == str(value)
                          if not isinstance(value, bool) else r.get(field) is value)

    def in_(self, field, values):
        self.db.in_calls.append((self.name, list(values)))
        allowed = {str(v) for v in values}
        return self._keep(lambda r: str(r.get(field)) in allowed)

    def is_(self, field, _null):
        return self._keep(lambda r: r.get(field) is None)

    def update(self, payload):
        self.db.updates.append((self.name, payload))
        return self

    def execute(self):
        self.db.reads.append(self.name)
        if self.name in self.db.fail:
            raise RuntimeError(DB_TEXT)
        rows = self.rows
        if hasattr(self, "_range"):
            start, end = self._range
            rows = rows[start:end + 1]
        return SimpleNamespace(data=rows)


class _Db:
    def __init__(self, **tables):
        self.tables = tables
        self.fail: set = set()
        self.reads: list = []
        self.in_calls: list = []
        self.updates: list = []

    def table(self, name):
        return _Q(self, name)


def _memberships(*cohort_ids, student_id="s1"):
    return [{"id": f"m-{cid}", "student_id": student_id, "cohort_id": cid, "is_active": True,
             "joined_at": None} for cid in cohort_ids]


def _db(*memberships, cohorts=(ACTIVE, ARCHIVED, LEGACY), **tables):
    return _Db(cohorts=[dict(c) for c in cohorts],
               student_cohort_memberships=list(memberships), **tables)


# ── class_membership_service.active_cohort_ids_for_student ───────────────

def test_membership_branch_drops_archived_and_keeps_legacy():
    db = _db(*_memberships("c-active", "c-archived", "c-legacy"))
    student = {"id": "s1", "cohort_id": "c-active"}
    assert membership.active_cohort_ids_for_student(db, student) == ["c-active", "c-legacy"]
    assert membership.active_cohort_ids_for_student(
        db, student, include_archived=True) == ["c-active", "c-archived", "c-legacy"]


@pytest.mark.parametrize("pointer,expected", [
    ("c-archived", []), ("c-legacy", ["c-legacy"]), ("c-active", ["c-active"]),
])
def test_legacy_pointer_branch_follows_the_same_rule(pointer, expected):
    db = _db()
    student = {"id": "s1", "cohort_id": pointer}
    assert membership.active_cohort_ids_for_student(db, student) == expected
    assert membership.active_cohort_ids_for_student(
        db, student, include_archived=True) == [pointer]


@pytest.mark.parametrize("pointer,expected", [("c-archived", []), ("c-legacy", ["c-legacy"])])
def test_membership_read_failure_fallback_is_filtered_too(pointer, expected):
    db = _db()
    db.fail.add("student_cohort_memberships")
    student = {"id": "s1", "cohort_id": pointer}
    assert membership.active_cohort_ids_for_student(db, student) == expected
    assert membership.active_cohort_ids_for_student(
        db, student, include_archived=True) == [pointer]


def test_membership_read_failure_without_a_pointer_still_raises():
    db = _db()
    db.fail.add("student_cohort_memberships")
    with pytest.raises(RuntimeError):
        membership.active_cohort_ids_for_student(db, {"id": "s1", "cohort_id": None})


def test_a_failed_archive_lookup_propagates_instead_of_guessing():
    db = _db(*_memberships("c-active"))
    db.fail.add("cohorts")
    with pytest.raises(RuntimeError):
        membership.active_cohort_ids_for_student(db, {"id": "s1"})
    # include_archived never reads the class rows.
    assert membership.active_cohort_ids_for_student(
        db, {"id": "s1"}, include_archived=True) == ["c-active"]


def test_no_class_means_no_class_read():
    db = _db()
    assert membership.active_cohort_ids_for_student(db, {"id": "s1", "cohort_id": None}) == []
    assert "cohorts" not in db.reads


# ── class_archive_service helpers ────────────────────────────────────────

def test_archived_cohort_ids_is_the_archived_subset_only():
    pre337 = {"id": "c-old", "is_active": False}          # no 337 columns: legacy
    db = _db(cohorts=(ACTIVE, ARCHIVED, LEGACY, pre337))
    assert archive.archived_cohort_ids(
        db, ["c-active", "c-archived", "c-legacy", "c-old", "c-unknown", None, "c-archived"]
    ) == {"c-archived"}
    assert archive.archived_cohort_ids(db, []) == set()
    assert db.reads == ["cohorts"]


def test_archived_cohort_ids_reads_in_chunks():
    many = [{"id": f"c{i}", "is_active": False, "archived_at": ARCHIVED_AT} for i in range(250)]
    db = _db(cohorts=many)
    assert archive.archived_cohort_ids(db, [row["id"] for row in many]) == {
        row["id"] for row in many}
    assert [len(ids) for name, ids in db.in_calls if name == "cohorts"] == [100, 100, 50]


def test_archived_cohort_ids_propagates_a_db_error():
    db = _db()
    db.fail.add("cohorts")
    with pytest.raises(RuntimeError):
        archive.archived_cohort_ids(db, ["c-active"])


_BEFORE = "2026-11-02T04:55:00+00:00"
_AFTER = "2026-11-02T05:05:00+00:00"


@pytest.mark.parametrize("assignment,cohort,allowed", [
    ({"is_timed": True, "started_at": _BEFORE}, ARCHIVED, True),
    ({"is_timed": True, "started_at": "2026-11-02T04:55:00Z"}, ARCHIVED, True),
    ({"is_timed": True, "started_at": _AFTER}, ARCHIVED, False),
    ({"is_timed": True, "started_at": ARCHIVED_AT}, ARCHIVED, False),       # strict <
    ({"is_timed": True, "started_at": None}, ARCHIVED, False),
    ({"is_timed": False, "started_at": _BEFORE}, ARCHIVED, False),
    ({"is_timed": True, "started_at": _BEFORE, "submitted_at": _AFTER}, ARCHIVED, False),
    ({"is_timed": True, "started_at": "not-a-date"}, ARCHIVED, False),
    ({"is_timed": True, "started_at": _BEFORE}, LEGACY, False),
    ({"is_timed": True, "started_at": _BEFORE}, ACTIVE, False),
    ({"is_timed": True, "started_at": _BEFORE}, None, False),
])
def test_archive_finish_allowed_is_the_d3_case_only(assignment, cohort, allowed):
    assert archive.archive_finish_allowed(assignment, cohort) is allowed


# ── /class/me and /class/my-assignments ──────────────────────────────────

def _student(pointer="c-active"):
    return {"id": "s1", "cohort_id": pointer, "full_name": "A", "student_code": "S1"}


async def _my_class(db, *, student=None, summary=False):
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value=student or _student()), \
         patch.object(mod, "supabase_admin", db):
        return await mod.my_class(summary, None)


async def _my_assignments(db, *, student=None):
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value=student or _student()), \
         patch.object(mod, "supabase_admin", db):
        return await mod.my_assignments(None)


@pytest.mark.asyncio
@pytest.mark.parametrize("summary", [False, True])
async def test_my_class_omits_archived_classes(summary):
    db = _db(*_memberships("c-active", "c-archived"))
    out = await _my_class(db, summary=summary)
    assert out["has_class"] is True
    assert [c["id"] for c in out["classes"]] == ["c-active"]
    assert out["class_count"] == 1
    assert "degraded" not in out


@pytest.mark.asyncio
@pytest.mark.parametrize("summary", [False, True])
async def test_only_archived_classes_is_the_no_class_state(summary):
    db = _db(*_memberships("c-archived"))
    assert await _my_class(db, student=_student("c-archived"), summary=summary) == {
        "has_class": False}


@pytest.mark.asyncio
async def test_a_legacy_inactive_class_is_still_shown_as_before():
    db = _db(*_memberships("c-legacy"))
    out = await _my_class(db, student=_student("c-legacy"))
    assert [c["id"] for c in out["classes"]] == ["c-legacy"]


@pytest.mark.asyncio
async def test_my_class_archive_lookup_failure_degrades_class_and_keeps_work():
    db = _db(*_memberships("c-active", "c-archived"))
    db.fail.add("cohorts")
    out = await _my_class(db)
    assert out["has_class"] is True
    assert out["degraded"].count("class") == 1
    assert out["class_count"] == 2       # unfiltered fallback, flagged as degraded
    assert DB_TEXT not in json.dumps(out, default=str)


@pytest.mark.asyncio
async def test_my_assignments_omits_archived_classes():
    db = _db(*_memberships("c-archived"), class_assignment_items=[], class_assignments=[],
             writing_assignments=[])
    assert await _my_assignments(db, student=_student("c-archived")) == {
        "has_class": False, "assignments": []}

    db = _db(*_memberships("c-active", "c-archived"), class_assignment_items=[],
             class_assignments=[], writing_assignments=[])
    out = await _my_assignments(db)
    assert out["has_class"] is True and out["class_count"] == 1


@pytest.mark.asyncio
async def test_my_assignments_lookup_failure_is_a_clean_500():
    db = _db(*_memberships("c-active"))
    db.fail.add("cohorts")
    with pytest.raises(HTTPException) as caught:
        await _my_assignments(db)
    assert caught.value.status_code == 500
    assert caught.value.detail == "Lỗi khi tải bài tập. Vui lòng thử lại."


# ── POST /class/assignments/{id}/start ───────────────────────────────────

def _start_db(cohort, *, skill="reading", item=None, member=True, content_config=None):
    item = {"id": "item-1", "student_id": "s1", "assignment_id": "a1", "state": "assigned",
            **(item or {})}
    return _Db(
        cohorts=[dict(cohort)],
        class_assignment_items=[item],
        class_assignments=[{"id": "a1", "cohort_id": cohort["id"], "skill": skill,
                            "status": "published", "content_id": "uuid-abc",
                            "content_config": content_config or {}, "due_at": None}],
        student_cohort_memberships=_memberships(cohort["id"]) if member else [],
        reading_tests=[{"id": "uuid-abc", "test_id": "CAM19-T3", "status": "published",
                        "exam_only": False, "is_public": True}],
    )


async def _start(db, *, pointer=None, existing=None):
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user",
                      return_value={"id": "s1", "cohort_id": pointer}), \
         patch.object(mod, "is_assignment_open", return_value=True), \
         patch.object(mod, "_existing_speaking_session", return_value=existing), \
         patch.object(mod, "supabase_admin", db):
        return await mod.start_assignment("item-1", None)


@pytest.mark.asyncio
async def test_a_new_start_in_an_archived_class_is_the_learner_409():
    db = _start_db(ARCHIVED)
    with pytest.raises(HTTPException) as caught:
        await _start(db)
    assert caught.value.status_code == 409
    assert caught.value.detail == LEARNER_409
    assert db.updates == [], "a refused start must not mark the item opened"


@pytest.mark.asyncio
@pytest.mark.parametrize("cohort", [ACTIVE, LEGACY])
async def test_active_and_legacy_classes_start_as_before(cohort):
    out = await _start(_start_db(cohort))
    assert out["player_surface"] == "reading_exam"


@pytest.mark.asyncio
async def test_class_membership_is_still_checked_first():
    with pytest.raises(HTTPException) as caught:
        await _start(_start_db(ARCHIVED, member=False))
    assert caught.value.status_code == 404


@pytest.mark.asyncio
async def test_submitted_reading_review_stays_open_in_an_archived_class():
    db = _start_db(ARCHIVED, item={"submitted_at": "2026-11-01T00:00:00+00:00",
                                   "artifact_kind": "reading_attempt", "artifact_id": "att-1"})
    out = await _start(db)
    assert out["review_attempt_id"] == "att-1"
    assert "cohorts" not in db.reads, "a read-only lane never needs the class state"


@pytest.mark.asyncio
async def test_completed_speaking_result_stays_open_in_an_archived_class():
    db = _start_db(ARCHIVED, skill="speaking")
    out = await _start(db, existing={"id": "sess-1", "status": "completed",
                                     "renderer_affinity": "next"})
    assert out["result_session_id"] == "sess-1"


@pytest.mark.asyncio
async def test_reopening_an_unfinished_speaking_session_is_refused():
    db = _start_db(ARCHIVED, skill="speaking")
    with pytest.raises(HTTPException) as caught:
        await _start(db, existing={"id": "sess-1", "status": "in_progress",
                                   "renderer_affinity": "next"})
    assert caught.value.status_code == 409
    assert caught.value.detail == LEARNER_409


@pytest.mark.asyncio
async def test_unfinished_speaking_session_in_a_legacy_class_reopens():
    out = await _start(_start_db(LEGACY, skill="speaking"),
                       existing={"id": "sess-1", "status": "in_progress",
                                 "renderer_affinity": "next"})
    assert out["session_id"] == "sess-1"


@pytest.mark.asyncio
async def test_start_archive_lookup_failure_is_generic():
    db = _start_db(ACTIVE)
    db.fail.add("cohorts")
    with pytest.raises(HTTPException) as caught:
        await _start(db)
    assert caught.value.status_code == 500
    assert DB_TEXT not in str(caught.value.detail)


# ── Speaking / Reading / Listening item validators ──────────────────────

def _validator_db(cohort, *, due_at=None):
    return _Db(
        cohorts=[dict(cohort)],
        students=[{"id": "s1", "user_id": "u1", "cohort_id": cohort["id"]}],
        class_assignment_items=[{"id": "item-1", "student_id": "s1", "assignment_id": "a1"}],
        class_assignments=[{"id": "a1", "cohort_id": cohort["id"], "skill": "reading",
                            "status": "published", "content_id": "uuid-abc",
                            "content_config": {"mode": "practice", "part": 1},
                            "due_at": due_at}],
        student_cohort_memberships=_memberships(cohort["id"]),
    )


def _validate(kind, db):
    if kind == "session":
        return cas.validate_class_item_for_session(
            db, "u1", "item-1", session_mode="practice", session_part=1, session_topic="")
    return cas.validate_class_item_for_test(db, "u1", "item-1", skill="reading",
                                            test_id="uuid-abc")


@pytest.mark.parametrize("kind", ["session", "test"])
def test_validators_refuse_new_work_in_an_archived_class(kind):
    with pytest.raises(HTTPException) as caught:
        _validate(kind, _validator_db(ARCHIVED))
    assert caught.value.status_code == 409
    assert caught.value.detail == LEARNER_409


@pytest.mark.parametrize("kind", ["session", "test"])
@pytest.mark.parametrize("cohort", [ACTIVE, LEGACY])
def test_validators_accept_active_and_legacy_classes(kind, cohort):
    assert _validate(kind, _validator_db(cohort)) is None


@pytest.mark.parametrize("kind", ["session", "test"])
def test_validator_deadline_still_wins_over_the_archive(kind):
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    with pytest.raises(cas.DeadlinePassedError):
        _validate(kind, _validator_db(ARCHIVED, due_at=past))


# ── Mock sitting message ────────────────────────────────────────────────

def _mock_db(cohort, *, member=True):
    return _Db(
        cohorts=[dict(cohort)],
        students=[{"id": "s1", "user_id": "u1", "cohort_id": None}],
        student_cohort_memberships=_memberships(cohort["id"]) if member else [],
        mock_exam_sittings=[],
    )


def _create_sitting(monkeypatch, db, cohort_id):
    exam = {"id": "e1", "code": "MOCK-A", "is_open": True, "active_section": "not_started",
            "cohort_id": cohort_id, "mode": "sequential"}
    monkeypatch.setattr(mock_svc, "supabase_admin", db)
    monkeypatch.setattr(mock_svc, "get_published_exam", lambda _code: exam)
    monkeypatch.setattr(mock_svc, "live_sitting_for_user", lambda *_a, **_k: None)
    monkeypatch.setattr(mock_svc, "is_retake", lambda _e: False)
    monkeypatch.setattr(mock_svc, "_assert_window_open", lambda _e: None)
    return mock_svc.create_sitting("u1", "MOCK-A")


def test_mock_sitting_in_an_archived_class_says_the_class_ended(monkeypatch):
    with pytest.raises(mock_svc.NotEligibleError) as caught:
        _create_sitting(monkeypatch, _mock_db(ARCHIVED), "c-archived")
    assert str(caught.value) == "Lớp của bạn đã kết thúc — kỳ thi này không còn mở."


def test_mock_sitting_for_a_non_member_keeps_the_old_message(monkeypatch):
    with pytest.raises(mock_svc.NotEligibleError) as caught:
        _create_sitting(monkeypatch, _mock_db(ARCHIVED, member=False), "c-archived")
    assert str(caught.value) == "Bạn không thuộc lớp được mở kỳ thi này."


@pytest.mark.parametrize("cohort", [ACTIVE, LEGACY])
def test_mock_cohort_gate_passes_active_and_legacy_members(monkeypatch, cohort):
    db = _mock_db(cohort)
    monkeypatch.setattr(mock_svc, "supabase_admin", db)
    assert mock_svc._user_in_cohort("u1", cohort["id"]) is True
    assert mock_svc._user_in_archived_cohort("u1", cohort["id"]) is False


def test_mock_cohort_gate_hides_an_archived_class(monkeypatch):
    monkeypatch.setattr(mock_svc, "supabase_admin", _mock_db(ARCHIVED))
    assert mock_svc._user_in_cohort("u1", "c-archived") is False
    assert mock_svc._user_in_archived_cohort("u1", "c-archived") is True


# ── Caller inventory (plan.md Verification §5) ──────────────────────────

BACKEND = Path(__file__).resolve().parents[1]

# path::function → mode. "filtered" hides archived classes (the default);
# "include_archived" passes include_archived=True for history.
EXPECTED_CALLERS = {
    "routers/class_student.py::my_assignments": "filtered",
    "routers/class_student.py::my_class": "filtered",
    "routers/class_student.py::my_class#fallback": "include_archived",
    "services/mock_exam_service.py::_user_in_cohort": "filtered",
    "services/mock_exam_service.py::_user_in_archived_cohort": "include_archived",
    # Membership still owns the item (results stay readable); the archive lane
    # is decided per item in ``_assignment_item_for``.
    "services/quiz_service.py::_assignment_item_for": "include_archived",
    # E6 owner stamping is roster repair; E1 skips archived classes itself.
    "scripts/backfill_class_enrollment_roster.py::main": "include_archived",
}


def _callers():
    found: dict[str, list[str]] = {}
    for path in sorted(BACKEND.rglob("*.py")):
        rel = path.relative_to(BACKEND).as_posix()
        if rel.startswith(("tests/", "venv/", ".venv/")) or "/site-packages/" in rel:
            continue
        if rel == "services/class_membership_service.py":
            continue
        source = path.read_text(encoding="utf-8")
        if "active_cohort_ids_for_student" not in source:
            continue
        tree = ast.parse(source)
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for node in ast.walk(fn):
                if not isinstance(node, ast.Call):
                    continue
                names = [node.func] + list(node.args)
                if not any(isinstance(n, ast.Name) and n.id == "active_cohort_ids_for_student"
                           or isinstance(n, ast.Attribute)
                           and n.attr == "active_cohort_ids_for_student" for n in names):
                    continue
                mode = "filtered"
                for kw in node.keywords:
                    if (kw.arg == "include_archived" and isinstance(kw.value, ast.Constant)
                            and kw.value.value is True):
                        mode = "include_archived"
                found.setdefault(f"{rel}::{fn.name}", []).append(mode)
    return found


def test_every_active_cohort_ids_caller_is_listed_with_its_mode():
    found = _callers()
    listed: dict[str, list[str]] = {}
    for key, mode in EXPECTED_CALLERS.items():
        listed.setdefault(key.split("#")[0], []).append(mode)
    assert {key: sorted(modes) for key, modes in found.items()} == {
        key: sorted(modes) for key, modes in listed.items()}, (
        "a caller of active_cohort_ids_for_student was added, removed or changed mode; "
        "list it in EXPECTED_CALLERS with the mode it needs")
