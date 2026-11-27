"""LEARNERCORE-0063 T15 (amendment 1): GET /api/student/course.

Join points for G04 (/api/me/courses, the public catalogue) and
COURSELESSON-0064 (lesson progress) are monkeypatched with the shapes of
0055 plan 5.9; the class read runs on a small in-memory fake Supabase.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

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
    def assigned(user_id, account_name, now, *, reconcile_student_only):
        assert user_id == "u-1" and reconcile_student_only is True
        return True, rows, False

    monkeypatch.setattr(st, "_visible_assignments_for", assigned)
    monkeypatch.setattr(sc, "_courses_for", lambda _u: None)
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


def test_missing_sources_are_empty_not_degraded(monkeypatch):
    # The real join points, untouched: G04 and 0064 not merged.
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
    monkeypatch.setattr(sc, "_courses_for", lambda u: seen.setdefault("user", u) and {
        "items": [_item("A", days=5, balance=3)]})
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
