"""TASK B2 — staging-only hiding of E2E/QA test data from list views.

Covers the matcher, the staging/flag gate, the per-viewer decision (test
identities and admins who opt in see everything), the request header plumbing
through the real app middleware, and each filtered list route. Every route
test also pins the default: with the flag off nothing is hidden and no extra
query runs, which is the production contract.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from services import test_data_visibility as tdv

_TEST_EMAIL = "e2e-student-smoke@staging-e2e.averlearning.com"
_ADMIN = {"id": "admin-1", "email": "owner@averlearning.com"}
_AUTH = {"Authorization": "Bearer synthetic"}


# ── In-memory PostgREST stand-in ──────────────────────────────────────────────


class _Res:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _Q:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.rows = [dict(r) for r in db.tables.get(table, [])]
        self.negate = False
        self.count_mode = None
        self.window = None

    def _keep(self, op, predicate):
        negate, self.negate = self.negate, False
        self.db.log.append((self.table, ("not." if negate else "") + op))
        self.rows = [r for r in self.rows if predicate(r) != negate]
        return self

    @property
    def not_(self):
        self.negate = True
        return self

    def select(self, *_a, count=None, **_k):
        self.count_mode = count
        return self

    def eq(self, col, val):
        return self._keep(f"eq.{col}", lambda r: r.get(col) == val)

    def neq(self, col, val):
        return self._keep(f"neq.{col}", lambda r: r.get(col) != val)

    def is_(self, col, _val):
        return self._keep(f"is.{col}", lambda r: r.get(col) is None)

    def in_(self, col, values):
        values = {str(v) for v in values}
        return self._keep(f"in.{col}", lambda r: str(r.get(col)) in values)

    def ilike(self, col, pattern):
        suffix = pattern.lstrip("%").lower()
        return self._keep(f"ilike.{col}", lambda r: str(r.get(col) or "").lower().endswith(suffix))

    def or_(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self.window = (0, n - 1)
        return self

    def range(self, start, end):
        self.window = (start, end)
        return self

    def execute(self):
        total = len(self.rows)
        rows = self.rows
        if self.window:
            rows = rows[self.window[0]:self.window[1] + 1]
        return _Res(rows, total if self.count_mode else None)


class _DB:
    def __init__(self, **tables):
        self.tables = tables
        self.log: list[tuple[str, str]] = []

    def table(self, name):
        return _Q(self, name)

    def ops(self, table):
        return [op for t, op in self.log if t == table]


@pytest.fixture
def staging(monkeypatch):
    def _set(*, flag=True, environment="staging"):
        monkeypatch.setattr(tdv.settings, "HIDE_TEST_DATA", flag)
        monkeypatch.setattr(tdv.settings, "ENVIRONMENT", environment)
    _set()
    return _set


@pytest.fixture
def show_header():
    token = tdv.begin_request("1")
    yield
    tdv.reset_request(token)


# ── Matcher ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("label", [
    # Real staging rows seen 2026-10-27.
    "QA-0029 archive E2E (staging test, safe to delete)",
    "E2E VOCABSETS-0020 · Lớp C2 giả",
    "QA Course 1 Resume 20261010",
    "QA TEST Task 2 – do not use",
    "E2E Writing Courses 5a41a3a9a9e0",
    "[STAGING] Gate E Writing Coexistence",
    "[STAGING] Gate E Listening Coexistence 3",
    "[INTERNAL QA] Cambridge IELTS 16 Test 2 Reading",
    "[SYNTHETIC ENGINEERING ONLY] Listening frozen snapshot acceptance",
    "[SYNTHETIC OWNED STAGING] Frozen Reading runtime only",
    "ILR-RDG-LSN-L01 — QA Reading synthetic",
    "VOCAB20-QA-PEER-20261014",
    "UXQA-EXPORT-20261007-e13a2fac",
    "e2e vocab20 acquire updated",
])
def test_test_labels_match(label):
    assert tdv.is_test_label(label)


@pytest.mark.parametrize("label", [
    "Cambridge IELTS 19 — Reading Test 1",
    "Lớp IELTS 6.5 tối thứ 3",
    "Integrated synthesis review — 30 questions",
    "Quality of life in cities",
    "Q&A practice: hometown",
    "Synthetic fibres and the environment",
    "Aqua farming",
    "Day 71 — Part 1",
    "[Revised] Cambridge IELTS 18 Test 2",
    "",
    None,
])
def test_real_labels_do_not_match(label):
    assert not tdv.is_test_label(label)


def test_test_email_is_the_staging_e2e_namespace_only():
    assert tdv.is_test_email(_TEST_EMAIL)
    assert tdv.is_test_email("QA-SEC-W03@STAGING-E2E.AVERLEARNING.COM")
    assert not tdv.is_test_email("andy@averlearning.com")
    assert not tdv.is_test_email("someone@notstaging-e2e.averlearning.com.evil")
    assert not tdv.is_test_email(None)


# ── Gate + per-viewer decision ────────────────────────────────────────────────


@pytest.mark.parametrize("flag,environment,expected", [
    (False, "staging", False),       # default: nothing hidden
    (True, "production", False),     # copied to production: still nothing
    (True, "development", False),
    (True, " Staging ", True),
])
def test_hiding_needs_flag_and_staging(staging, flag, environment, expected):
    staging(flag=flag, environment=environment)
    assert tdv.hiding_enabled() is expected


def test_flag_defaults_off():
    from config import Settings
    assert Settings.model_fields["HIDE_TEST_DATA"].default is False


def test_hide_for_viewers(staging, monkeypatch):
    db = _DB(users=[
        {"id": "real", "email": "learner@gmail.com", "role": "user"},
        {"id": "e2e", "email": _TEST_EMAIL, "role": "user"},
        {"id": "boss", "email": "boss@averlearning.com", "role": "admin"},
    ])
    monkeypatch.setattr(tdv, "supabase_admin", db)
    assert tdv.hide_for() is True                       # anonymous
    assert tdv.hide_for(email="learner@gmail.com") is True
    assert tdv.hide_for(email=_TEST_EMAIL) is False     # suites keep their rows
    assert tdv.hide_for(user_id="e2e") is False         # e-mail resolved by id
    assert tdv.hide_for(user_id="boss") is True         # admin without opt-in
    assert db.ops("users") == ["eq.id", "eq.id"]        # no role read without the header


def test_admin_opt_in_header_is_admin_only(staging, monkeypatch, show_header):
    db = _DB(users=[
        {"id": "real", "email": "learner@gmail.com", "role": "user"},
        {"id": "boss", "email": "boss@averlearning.com", "role": "admin"},
    ])
    monkeypatch.setattr(tdv, "supabase_admin", db)
    assert tdv.hide_for(email="boss@averlearning.com", is_admin=True) is False
    assert tdv.hide_for(user_id="boss") is False
    assert tdv.hide_for(email="learner@gmail.com", user_id="real") is True
    assert tdv.hide_for() is True


def test_lookup_failure_shows_data(staging, monkeypatch):
    class _Broken:
        def table(self, _name):
            raise RuntimeError("db down")
    monkeypatch.setattr(tdv, "supabase_admin", _Broken())
    assert tdv.hide_for(user_id="anyone") is False


def test_flag_off_never_touches_the_database(staging, monkeypatch):
    staging(flag=False)
    db = _DB()
    monkeypatch.setattr(tdv, "supabase_admin", db)
    assert tdv.hide_for(user_id="anyone") is False
    assert db.log == []


# ── Real app: header plumbing + admin visibility route ────────────────────────


@pytest.fixture
def client():
    from main import app
    with patch("routers.admin.require_admin", new=AsyncMock(return_value=_ADMIN)):
        with TestClient(app) as c:
            yield c


def test_visibility_route_reports_header_through_middleware(staging, client):
    assert client.get("/admin/test-data/visibility", headers=_AUTH).json() == {
        "hiding_enabled": True, "showing_test_data": False}
    assert client.get("/admin/test-data/visibility",
                      headers={**_AUTH, "X-Show-Test-Data": "1"}).json() == {
        "hiding_enabled": True, "showing_test_data": True}
    # Request-scoped: the next call without the header is hidden again.
    assert client.get("/admin/test-data/visibility", headers=_AUTH).json()["showing_test_data"] is False


def test_visibility_route_off_by_default(staging, client):
    staging(flag=False)
    assert client.get("/admin/test-data/visibility",
                      headers={**_AUTH, "X-Show-Test-Data": "1"}).json() == {
        "hiding_enabled": False, "showing_test_data": False}


def test_cors_allows_the_opt_in_header():
    import main
    assert "X-Show-Test-Data" in main._CORS_HEADERS


# ── Admin people/cohort lists ────────────────────────────────────────────────


def _users_db():
    return _DB(
        users=[
            {"id": "u-real", "email": "learner@gmail.com", "display_name": "Real",
             "created_at": None, "is_active": True, "role": "user"},
            {"id": "u-e2e", "email": _TEST_EMAIL, "display_name": "E2E student",
             "created_at": None, "is_active": True, "role": "user"},
        ],
        sessions=[], students=[], cohorts=[], student_cohort_memberships=[],
    )


@pytest.mark.parametrize("flag,header,expected", [
    (True, {}, ["u-real"]),
    (True, {"X-Show-Test-Data": "1"}, ["u-real", "u-e2e"]),
    (False, {}, ["u-real", "u-e2e"]),
])
def test_admin_users_hides_staging_e2e_accounts(staging, client, monkeypatch, flag, header, expected):
    staging(flag=flag)
    db = _users_db()
    monkeypatch.setattr("routers.admin.supabase_admin", db)
    monkeypatch.setattr("routers.admin.active_memberships_for_students", lambda *_a: [])
    monkeypatch.setattr("routers.admin.get_users_code_summary", lambda _ids: {})
    r = client.get("/admin/users", headers={**_AUTH, **header})
    assert r.status_code == 200, r.text
    assert [u["id"] for u in r.json()] == expected


def test_admin_users_shows_everything_to_a_test_admin(staging, monkeypatch):
    from main import app
    db = _users_db()
    monkeypatch.setattr("routers.admin.supabase_admin", db)
    monkeypatch.setattr("routers.admin.active_memberships_for_students", lambda *_a: [])
    monkeypatch.setattr("routers.admin.get_users_code_summary", lambda _ids: {})
    e2e_admin = {"id": "e2e-admin", "email": "e2e-admin-smoke@staging-e2e.averlearning.com"}
    with patch("routers.admin.require_admin", new=AsyncMock(return_value=e2e_admin)), TestClient(app) as c:
        assert len(c.get("/admin/users", headers=_AUTH).json()) == 2


def test_admin_students_excludes_test_rows_in_sql(staging, monkeypatch):
    from routers import admin_students
    from services import student_service
    rows = [
        {"id": "s-real", "user_id": "u-real", "full_name": "Hubert Chen", "student_code": "02L7"},
        {"id": "s-linked", "user_id": "u-e2e", "full_name": "Gate student", "student_code": "GATE"},
        {"id": "s-label", "user_id": None, "full_name": "QA export 20261007", "student_code": "X1"},
    ]
    db = _DB(students=rows, users=[{"id": "u-e2e", "email": _TEST_EMAIL}])
    monkeypatch.setattr(tdv, "supabase_admin", db)
    monkeypatch.setattr(student_service, "supabase_admin", db)
    monkeypatch.setattr(student_service, "_attach_cohort_memberships", lambda _rows: True)
    monkeypatch.setattr(admin_students, "require_admin", AsyncMock(return_value=_ADMIN))
    import asyncio
    out = asyncio.run(admin_students.list_students(
        search=None, limit=50, offset=0, include_archived=False, authorization="Bearer x"))
    assert [r["id"] for r in out] == ["s-real"]
    assert "not.in.id" in db.ops("students")  # excluded before .range(), pages stay full

    staging(flag=False)
    db.log.clear()
    out = asyncio.run(admin_students.list_students(
        search=None, limit=50, offset=0, include_archived=False, authorization="Bearer x"))
    assert len(out) == 3
    assert db.ops("users") == [] and "not.in.id" not in db.ops("students")


def test_admin_cohort_lists_hide_test_classes(staging, monkeypatch):
    import asyncio
    from routers import admin_writing_cohorts, cohorts
    rows = [
        {"id": "c-real", "name": "IELTS 6.5 tối", "is_active": True},
        {"id": "c-qa", "name": "QA Course 1 Resume 20261010", "is_active": True},
        {"id": "c-e2e", "name": "E2E VOCABSETS-0020 · Lớp C2 giả", "is_active": True},
    ]
    monkeypatch.setattr(cohorts, "require_admin", AsyncMock(return_value=_ADMIN))
    monkeypatch.setattr(cohorts, "list_cohorts_basic", lambda *_a, **_k: {"cohorts": [dict(r) for r in rows]})
    out = asyncio.run(cohorts.list_cohorts(is_active=None, course_id=None, with_rollup=False,
                                           authorization="Bearer x"))
    assert [c["id"] for c in out["cohorts"]] == ["c-real"]

    db = _DB(cohorts=rows)
    monkeypatch.setattr(admin_writing_cohorts, "supabase_admin", db)
    monkeypatch.setattr(admin_writing_cohorts, "require_admin", AsyncMock(return_value=_ADMIN))
    monkeypatch.setattr(admin_writing_cohorts, "active_memberships_for_cohorts", lambda *_a: [])
    monkeypatch.setattr(admin_writing_cohorts, "_fetch_essays_by_ids", lambda _ids: {})
    out = asyncio.run(admin_writing_cohorts.list_cohorts(authorization="Bearer x"))
    assert [c["id"] for c in out["cohorts"]] == ["c-real"]

    staging(flag=False)
    out = asyncio.run(cohorts.list_cohorts(is_active=None, course_id=None, with_rollup=False,
                                           authorization="Bearer x"))
    assert len(out["cohorts"]) == 3


def test_instructor_lists_hide_test_rows(staging, monkeypatch):
    import asyncio
    from routers import instructor
    db = _DB(
        users=[{"id": "u-e2e", "email": _TEST_EMAIL},
               {"id": "gv", "email": "teacher@averlearning.com", "role": "instructor"}],
        students=[
            {"id": "a", "user_id": "u-real", "full_name": "Andy Chen", "student_code": "O5EJ"},
            {"id": "b", "user_id": "u-e2e", "full_name": "Gate", "student_code": "GATE"},
            {"id": "c", "user_id": None, "full_name": "QA sec w03", "student_code": "QA-SEC-W03"},
        ],
        cohorts=[{"id": "k-real", "name": "IELTS 7.0"}, {"id": "k-qa", "name": "QA-0029 archive E2E"}],
    )
    monkeypatch.setattr(tdv, "supabase_admin", db)
    monkeypatch.setattr(instructor, "_me", AsyncMock(return_value="gv"))
    monkeypatch.setattr(instructor, "instructor_db", lambda _me: db)
    students = asyncio.run(instructor.list_students(None, authorization="Bearer x"))
    classes = asyncio.run(instructor.list_cohorts(None, authorization="Bearer x"))
    assert [r["id"] for r in students] == ["a"]
    assert [r["id"] for r in classes] == ["k-real"]

    staging(flag=False)
    assert len(asyncio.run(instructor.list_students(None, authorization="Bearer x"))) == 3
    assert len(asyncio.run(instructor.list_cohorts(None, authorization="Bearer x"))) == 2


# ── Learner catalogues ───────────────────────────────────────────────────────


def test_prompt_bank_drops_test_prompts(staging, monkeypatch):
    import asyncio
    from routers import writing_student as ws

    class _Req:
        headers: dict = {}

    monkeypatch.setattr(ws.settings, "WRITING_PROMPT_BANK_ENABLED", True)
    db = _DB(writing_prompts=[
        {"id": "p-real", "title": "Some people think cities…", "is_active": True, "exam_only": False},
        {"id": "p-qa", "title": "QA TEST Task 2 – do not use", "is_active": True, "exam_only": False},
        {"id": "p-gate", "title": "[STAGING] Gate E Writing Coexistence", "is_active": True, "exam_only": False},
    ])
    monkeypatch.setattr(ws, "supabase_admin", db)
    import json
    body = json.loads(asyncio.run(ws.get_prompt_bank(_Req(), task_type=None)).body)
    assert [p["id"] for p in body["prompts"]] == ["p-real"]
    staging(flag=False)
    body = json.loads(asyncio.run(ws.get_prompt_bank(_Req(), task_type=None)).body)
    assert len(body["prompts"]) == 3


def test_reading_test_list_excludes_test_papers_before_paging(staging, monkeypatch):
    import asyncio
    from routers import reading_student as rs
    catalog = [
        {"id": "r-qa", "title": "[INTERNAL QA] Cambridge IELTS 16 Test 2 Reading",
         "status": "published", "test_type": "full", "is_public": True},
        {"id": "r-real", "title": "Cambridge IELTS 19 — Reading Test 1",
         "status": "published", "test_type": "full", "is_public": True},
    ]
    db = _DB(reading_public_practice_catalog=catalog)
    monkeypatch.setattr(rs, "supabase_admin", db)
    monkeypatch.setattr(tdv, "supabase_admin", db)
    monkeypatch.setattr(rs, "_require_auth", AsyncMock(return_value={"id": "u", "email": "learner@gmail.com"}))
    out = asyncio.run(rs.list_reading_tests(module=None, test_type=None, limit=1, offset=0,
                                            authorization="Bearer x"))
    assert [i["id"] for i in out["items"]] == ["r-real"] and out["total"] == 1

    monkeypatch.setattr(rs, "_require_auth", AsyncMock(return_value={"id": "e", "email": _TEST_EMAIL}))
    out = asyncio.run(rs.list_reading_tests(module=None, test_type=None, limit=10, offset=0,
                                            authorization="Bearer x"))
    assert out["total"] == 2


def test_listening_helpers_drop_tests_and_their_sections(staging, monkeypatch):
    from routers import listening as ls
    db = _DB(
        listening_tests=[{"id": "t-gate", "title": "[STAGING] Gate E Listening Coexistence 1"},
                         {"id": "t-real", "title": "Cambridge IELTS 19 Test 1 Listening"}],
        listening_content=[{"id": "c-gate", "title": "GATE-E-LISTENING-COEXISTENCE-1 — Section 1", "test_id": "t-gate"},
                           {"id": "c-qa", "title": "QA dictation probe", "test_id": None},
                           {"id": "c-real", "title": "Campus tour", "test_id": "t-real"}],
        listening_public_practice_catalog=[
            {"id": "t-gate", "test_type": "full", "status": "published", "scoring_policy": "diagnostic", "is_public": True},
            {"id": "t-real", "test_type": "full", "status": "published", "scoring_policy": "diagnostic", "is_public": True},
        ],
    )
    monkeypatch.setattr(tdv, "supabase_admin", db)
    monkeypatch.setattr(ls, "supabase_admin", db)
    hidden = ls._hidden_listening_ids({"id": "u", "email": "learner@gmail.com"})
    assert hidden == (frozenset({"t-gate"}), frozenset({"c-qa"}))
    kept = ls._drop_hidden_content(db.tables["listening_content"], hidden)
    assert [r["id"] for r in kept] == ["c-real"]
    tests, _groups, public_ids = ls._published_test_counts(hidden[0])
    assert tests["full"] == 1 and public_ids == {"t-real"}

    assert ls._hidden_listening_ids({"id": "e", "email": _TEST_EMAIL}) == ls._NO_HIDDEN
    staging(flag=False)
    assert ls._hidden_listening_ids({"id": "u", "email": "learner@gmail.com"}) == ls._NO_HIDDEN
    assert ls._drop_hidden_content(db.tables["listening_content"], ls._NO_HIDDEN) == db.tables["listening_content"]


def test_listening_test_list_excludes_test_bundles_before_paging(staging, monkeypatch):
    import asyncio
    from routers import listening as ls
    shelf = {"status": "published", "is_public": True, "scoring_policy": "diagnostic",
             "test_type": "full", "full_audio_storage_path": "a.mp3"}
    db = _DB(
        listening_tests=[{"id": "t-gate", "title": "[STAGING] Gate E Listening Coexistence 1"},
                         {"id": "t-real", "title": "Cambridge IELTS 19 Test 1 Listening"}],
        listening_content=[],
        listening_public_practice_catalog=[
            {**shelf, "id": "t-gate", "title": "[STAGING] Gate E Listening Coexistence 1"},
            {**shelf, "id": "t-real", "title": "Cambridge IELTS 19 Test 1 Listening"},
        ],
        listening_test_attempts=[],
    )
    monkeypatch.setattr(tdv, "supabase_admin", db)
    monkeypatch.setattr(ls, "supabase_admin", db)
    monkeypatch.setattr(ls, "_require_auth", AsyncMock(return_value={"id": "u", "email": "learner@gmail.com"}))
    out = asyncio.run(ls.list_published_listening_tests(
        test_type=None, programme_id=None, practice_group=None, limit=1, offset=0,
        authorization="Bearer x"))
    assert [i["id"] for i in out["items"]] == ["t-real"] and out["total"] == 1
    assert "not.in.id" in db.ops("listening_public_practice_catalog")

    staging(flag=False)
    db.log.clear()
    out = asyncio.run(ls.list_published_listening_tests(
        test_type=None, programme_id=None, practice_group=None, limit=10, offset=0,
        authorization="Bearer x"))
    assert out["total"] == 2 and db.ops("listening_tests") == []
