"""LEARNERCORE-0063 T15 (amendment 1): GET /api/student/course.

The HTTP tests cover the G04 joins and scoped class reconciliation using
in-memory PostgREST data. Focused assembly tests isolate individual sources.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from services import student_course as sc
from services import student_today as st

NOW = datetime(2026, 11, 23, 3, 0, tzinfo=timezone.utc)


class _Res:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.n, self.cols = db, table, [], None, ""

    def select(self, cols="*", **_k):
        self.cols = cols
        return self

    def eq(self, f, v):
        self.filters.append(lambda r: str(r.get(f)) == str(v))
        return self

    def in_(self, f, vs):
        vs = {str(v) for v in vs}
        self.filters.append(lambda r: str(r.get(f)) in vs)
        return self

    def is_(self, f, value):
        assert value == "null"
        self.filters.append(lambda r: r.get(f) is None)
        return self

    def order(self, _f):
        return self

    def limit(self, n):
        self.n = n
        return self

    def execute(self):
        if (self.table, self.cols) in self.db.broken:
            raise RuntimeError("column does not exist")
        self.db.reads.append(self.table)
        rows = [dict(r) for r in self.db.tables.get(self.table, []) if all(f(r) for f in self.filters)]
        return _Res(rows[: self.n] if self.n else rows)


class _DB:
    def __init__(self, tables, broken=()):
        self.tables, self.broken, self.reads = tables, set(broken), []

    def table(self, name):
        return _Q(self, name)


def _item(code, *, kind="online", state="active", days=None, expires=None, slug=None,
          balance=None, can_renew=False, title=None):
    return {"course_code": code, "product_slug": slug or code.lower(), "title": title or f"Khoá {code}",
            "short_title": None, "kind": kind, "source": "enrollment_order", "state": state,
            "starts_at": None, "expires_at": expires, "days_left": days, "review_mode": "ai_instant",
            "can_renew": can_renew, "renew_order_code": None,
            "credits": {"balance": balance, "usable_from": None, "usable_until": None,
                        "carry_balance": 0, "carry_expires_at": None}}


def _run(monkeypatch, *, courses=None, catalog=None, klass=None, assigned=(0, False), progress=None):
    def _value(v):
        def fn(*_a):
            if isinstance(v, Exception):
                raise v
            return v
        return fn

    monkeypatch.setattr(sc, "_courses_for", _value(courses))
    monkeypatch.setattr(sc, "_catalog_for", _value(catalog))
    monkeypatch.setattr(sc, "_class_for", _value(klass))
    monkeypatch.setattr(sc, "_assigned_open_for", _value(assigned))
    if progress is not None:
        monkeypatch.setattr(sc, "_lesson_progress_for", lambda _u, code: progress.get(code))
    return asyncio.run(sc.get_course_concurrent("u-1", account_name="A", now=NOW))


def test_no_class_no_course(monkeypatch):
    body = _run(monkeypatch)
    assert body == {"online": [], "other_products": [], "class": None, "assigned_open": 0,
                    "has_online": False, "has_class": False, "selected": None, "degraded": []}


def test_class_only_uses_todays_count(monkeypatch):
    rows = [{"assignment": {"due_at": "2026-11-30T00:00:00Z"}, "item_id": "a"},
            {"assignment": {"due_at": None}, "item_id": "b"},
            {"assignment": {"due_at": None}, "item_id": "c", "submitted_at": "2026-11-20T00:00:00Z"}]
    def assigned(user_id, account_name, now, *, read_only):
        assert user_id == "u-1" and read_only is True
        return True, rows, False

    monkeypatch.setattr(st, "_visible_assignments_for", assigned)
    monkeypatch.setattr(sc, "_courses_for", lambda _u, _now: None)
    monkeypatch.setattr(sc, "_catalog_for", lambda: None)
    monkeypatch.setattr(sc, "_class_for", lambda *_a: {"name": "IELTS 6.5 tối", "teacher_name": None,
                                                         "course_title": None, "repractice": []})
    body = asyncio.run(sc.get_course_concurrent("u-1", now=NOW))
    assert body["has_online"] is False and body["has_class"] is True
    assert body["assigned_open"] == st.build_assigned(rows, NOW)["assigned_total_open"] == 2


def test_online_active_before_expired_and_credits_per_grant(monkeypatch):
    courses = {"items": [
        _item("OLD", state="expired", expires="2026-10-01T00:00:00Z", balance=0, can_renew=True),
        _item("B", days=40, balance=7),
        _item("NEWER", state="expired", expires="2026-11-01T00:00:00Z"),
        _item("A", days=12, balance=18),
        _item("GONE", state="revoked", days=3),
    ], "credits": {"total": 25, "by_kind": {"online": 25, "class": 0}}}
    body = _run(monkeypatch, courses=courses)
    assert [r["course_code"] for r in body["online"]] == ["A", "B", "NEWER", "OLD"]
    assert [r["credits_left"] for r in body["online"]] == [18, 7, None, 0]
    assert body["online"][3]["can_renew"] is True and body["online"][3]["days_left"] is None
    assert body["has_online"] is True and body["selected"] == "A"
    assert all(r["progress"] is None for r in body["online"])  # 0064 not there yet


def test_selected_is_the_active_course_studied_last(monkeypatch):
    courses = {"items": [_item("A", days=12), _item("B", days=40),
                         _item("X", state="expired", expires="2026-11-01T00:00:00Z")]}
    progress = {"A": {"done": 2, "total": 10, "last_at": "2026-11-20T00:00:00Z"},
                "B": {"done": 1, "total": 8, "last_at": "2026-11-22T00:00:00Z"},
                "X": {"done": 5, "total": 5, "last_at": "2026-11-23T00:00:00Z"}}
    body = _run(monkeypatch, courses=courses, progress=progress)
    assert body["selected"] == "B"  # newest among ACTIVE courses; X is expired
    assert body["online"][0]["progress"] == {"done": 2, "total": 10}
    assert body["online"][2]["progress"] == {"done": 5, "total": 5}  # kept on the expired row


def test_other_products_drop_owned_and_closed(monkeypatch):
    courses = {"items": [_item("A", days=12, slug="ielts-65")]}
    catalog = [{"slug": "ielts-65", "title": "IELTS 6.5", "status": "open"},
               {"slug": "ielts-70", "title": "IELTS 7.0", "status": "coming_soon",
                "expected_open_on": "2027-01-05"},
               {"slug": "old", "title": "Cũ", "status": "closed"}]
    body = _run(monkeypatch, courses=courses, catalog=catalog)
    assert body["other_products"] == [{"slug": "ielts-70", "title": "IELTS 7.0",
                                       "status": "coming_soon", "starts_at": "2027-01-05"}]


def test_class_repractice_comes_from_class_grants(monkeypatch):
    courses = {"items": [_item("RP", kind="repractice", days=30, title="Luyện lại 6.5"),
                         _item("CL", kind="class", state="expired")]}
    body = _run(monkeypatch, courses=courses,
                klass={"name": "Lớp A", "teacher_name": "Cô Lan", "course_title": "IELTS", "repractice": []})
    assert body["class"]["repractice"] == [{"course_code": "RP", "title": "Luyện lại 6.5"}]
    assert body["online"] == [] and body["has_online"] is False


@pytest.mark.parametrize("part", ["online", "other_products", "class", "assigned_open"])
def test_a_failing_part_is_degraded_alone(monkeypatch, part):
    kwargs = {"courses": {"items": [_item("A", days=3)]}, "catalog": [],
              "klass": {"name": "Lớp A", "teacher_name": None, "course_title": None, "repractice": []},
              "assigned": (4, False)}
    key = {"online": "courses", "other_products": "catalog", "class": "klass",
           "assigned_open": "assigned"}[part]
    kwargs[key] = RuntimeError("boom")
    body = _run(monkeypatch, **kwargs)
    assert body["degraded"] == [part]
    if part != "online":
        assert body["has_online"] is True
    if part != "class":
        assert body["has_class"] is True


def test_stale_ledger_marks_assigned_open_degraded(monkeypatch):
    body = _run(monkeypatch, assigned=(3, True))
    assert body["assigned_open"] == 3 and body["degraded"] == ["assigned_open"]


def test_empty_g04_sources_are_empty_not_degraded(monkeypatch):
    from routers import courses_public, me_access

    monkeypatch.setattr(me_access, "_my_courses_reads", lambda _uid: ([], {}, {}, {}, (None, None)))
    monkeypatch.setattr(courses_public, "supabase_admin", _DB({}))
    monkeypatch.setattr(sc, "_class_for", lambda *_a: None)
    monkeypatch.setattr(sc, "_assigned_open_for", lambda *_a: (0, False))
    body = asyncio.run(sc.get_course_concurrent("u-1", now=NOW))
    assert body["online"] == [] and body["other_products"] == [] and body["degraded"] == []


# ── class read ────────────────────────────────────────────────────────────────


def _class_db(**kw):
    return _DB({
        "cohorts": [{"id": "c2", "name": "B lớp", "course_id": "k1", "instructor_id": "t1"},
                    {"id": "c1", "name": "A lớp", "course_id": None, "instructor_id": None},
                    {"id": "c9", "name": "Lớp người khác", "course_id": "k1", "instructor_id": "t1"}],
        "courses": [{"id": "k1", "name": "IELTS 6.5"}],
        "users": [{"id": "t1", "display_name": "Cô Lan"}],
    }, **kw)


def _patch_class(monkeypatch, db, *, student, cohort_ids):
    import database
    from routers import class_student
    from services import class_membership_service
    monkeypatch.setattr(database, "thread_supabase_admin", lambda: db)
    monkeypatch.setattr(class_student, "_student_for_user", lambda *_a: student)
    monkeypatch.setattr(class_membership_service, "active_cohort_ids_for_student",
                        lambda _sb, _student: cohort_ids)


def test_class_read_primary_first_with_teacher_and_course(monkeypatch):
    db = _class_db()
    _patch_class(monkeypatch, db, student={"id": "s1", "cohort_id": "c2"}, cohort_ids=["c1", "c2"])
    assert sc._class_for("u-1", "A") == {"name": "B lớp", "teacher_name": "Cô Lan",
                                         "course_title": "IELTS 6.5", "repractice": []}


def test_class_read_archived_or_none_is_no_class(monkeypatch):
    _patch_class(monkeypatch, _class_db(), student={"id": "s1", "cohort_id": "c2"}, cohort_ids=[])
    assert sc._class_for("u-1", "A") is None
    _patch_class(monkeypatch, _class_db(), student=None, cohort_ids=["c2"])
    assert sc._class_for("u-1", "A") is None


def test_teacher_column_missing_is_no_name_not_an_error(monkeypatch):
    db = _class_db(broken={("cohorts", "instructor_id")})
    _patch_class(monkeypatch, db, student={"id": "s1", "cohort_id": "c2"}, cohort_ids=["c2"])
    got = sc._class_for("u-1", "A")
    assert got["name"] == "B lớp" and got["teacher_name"] is None


def test_class_read_only_touches_the_callers_cohorts(monkeypatch):
    db = _class_db()
    _patch_class(monkeypatch, db, student={"id": "s1", "cohort_id": "c1"}, cohort_ids=["c1"])
    got = sc._class_for("u-1", "A")
    assert got["name"] == "A lớp" and got["teacher_name"] is None and got["course_title"] is None


# ── HTTP route ────────────────────────────────────────────────────────────────


async def _true():
    return True


def test_route_matches_response_model(monkeypatch):
    from fastapi.testclient import TestClient
    import main
    from routers import student_home
    from services import activation_gate

    seen = {}

    async def _user(_authorization):
        return {"id": "u-7", "email": "a@x.test", "user_metadata": {}}

    monkeypatch.setattr(student_home, "get_supabase_user", _user)
    monkeypatch.setattr(activation_gate, "aaccount_is_active", lambda *_a, **_k: _true())
    monkeypatch.setattr(sc, "_courses_for", lambda u, _now: seen.setdefault("user", u) and {
        "items": [_item("A", days=5, balance=3)]})
    monkeypatch.setattr(sc, "_catalog_for", lambda: [])
    monkeypatch.setattr(sc, "_class_for", lambda *_a: {"name": "Lớp A", "teacher_name": None,
                                                         "course_title": None, "repractice": []})
    monkeypatch.setattr(sc, "_assigned_open_for", lambda *_a: (2, False))
    client = TestClient(main.app, raise_server_exceptions=False)
    res = client.get("/api/student/course", headers={"Authorization": "Bearer x"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert seen["user"] == "u-7"
    assert body["class"]["name"] == "Lớp A" and "class_" not in body
    assert body["online"][0]["credits_left"] == 3 and body["assigned_open"] == 2
    assert res.headers["cache-control"] == "private, no-store"


@pytest.fixture
def course_client(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers import student_home

    async def authenticated(authorization):
        learner_id = "u-2" if authorization == "Bearer learner-b" else "u-1"
        return {"id": learner_id, "email": f"{learner_id}@example.com"}

    monkeypatch.setattr(student_home, "get_supabase_user", authenticated)
    app = FastAPI()
    app.include_router(student_home.router)
    return TestClient(app)


@pytest.mark.parametrize("has_class", [False, True])
def test_course_route_reads_owned_g04_entitlement_and_public_catalog(monkeypatch, course_client, has_class):
    from routers import courses_public, me_access
    from services import entitlements

    expires = datetime.now(timezone.utc) + timedelta(days=30)
    db = _DB({
        "entitlements": [
            {"id": "grant-a", "user_id": "u-1", "product_id": "own", "course_id": "g1",
             "source": "enrollment_order", "expires_at": expires.isoformat(), "status": "active"},
            {"id": "grant-b", "user_id": "u-2", "product_id": "other", "course_id": "g2",
             "source": "enrollment_order", "expires_at": expires.isoformat(), "status": "active"},
        ],
        "courses": [{"id": "g1", "code": "G1"}, {"id": "g2", "code": "G2"}],
        "course_products": [
            {"id": "own", "slug": "grammar-one", "title": "Grammar", "kind": "online",
             "is_public": True, "status": "open"},
            {"id": "other", "slug": "reading-two", "title": "Reading", "kind": "online",
             "is_public": True, "status": "coming_soon", "expected_open_on": "2027-01-05"},
            {"id": "hidden", "slug": "private", "kind": "online", "is_public": False, "status": "open"},
            {"id": "archived", "slug": "archived", "kind": "online", "is_public": True, "status": "open",
             "archived_at": "2026-11-01T00:00:00Z"},
        ],
    })
    for module in (entitlements, me_access, courses_public):
        monkeypatch.setattr(module, "supabase_admin", db)
    monkeypatch.setattr(entitlements, "fetch_legacy_code_rows", lambda _uid: [])
    monkeypatch.setattr(me_access, "fetch_credit_balance", lambda _uid: {
        "total": 30, "items": [{"entitlement_id": "grant-a", "product_kind": "online", "balance": 6}],
    })
    klass = {"name": "Lớp A", "teacher_name": None, "course_title": None, "repractice": []}
    monkeypatch.setattr(sc, "_class_for", lambda *_a: klass if has_class else None)
    monkeypatch.setattr(sc, "_assigned_open_for", lambda *_a: (0, False))

    response = course_client.get("/api/student/course", headers={"Authorization": "Bearer learner-a"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["degraded"] == []
    assert body["has_online"] is True and body["has_class"] is has_class
    assert body["selected"] == "G1"
    assert [(row["course_code"], row["product_slug"], row["credits_left"]) for row in body["online"]] == [
        ("G1", "grammar-one", 6),
    ]
    assert body["other_products"] == [
        {"slug": "reading-two", "title": "Reading", "status": "coming_soon", "starts_at": "2027-01-05"},
    ]


def test_course_route_counts_hand_ins_without_writing_any_ledgers(monkeypatch, course_client):
    import database
    from routers import class_student
    from services import quiz_service
    from test_student_assigned import _two_student_ledger_db

    db, finished = _two_student_ledger_db()
    next(row for row in db.tables["class_assignment_items"] if row["id"] == "course-s1")["passed_at"] = finished
    db.tables["reading_test_attempts"] = db.tables["reading_test_attempts"][:1]
    db.tables["course_writing_submissions"] = db.tables["course_writing_submissions"][:1]
    for module in (database, class_student, quiz_service):
        monkeypatch.setattr(module, "supabase_admin", db)
    monkeypatch.setattr(sc, "_courses_for", lambda *_a: {"items": []})
    monkeypatch.setattr(sc, "_catalog_for", lambda: [])
    monkeypatch.setattr(sc, "_class_for", lambda *_a: None)

    for learner, expected_open in (("learner-a", 0), ("learner-b", 2)):
        response = course_client.get("/api/student/course", headers={"Authorization": f"Bearer {learner}"})
        assert response.status_code == 200, response.text
        assert response.json()["degraded"] == []
        assert response.json()["assigned_open"] == expected_open

    assert db.writes == []
    assert all(row["submitted_at"] is None for row in db.tables["class_assignment_items"])
