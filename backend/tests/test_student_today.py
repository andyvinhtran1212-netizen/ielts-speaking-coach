"""LEARNERCORE-0063 T13: GET /api/student/today and POST /api/student/today/seen.

In-memory fake Supabase (eq / in_ / gt / gte / order / limit / not_.is_ /
update / or_). The fake does not simulate SQL; the forward-only cursor update
is pinned on the PostgREST filter it sends, and its tuple rule is re-checked by
evaluating that filter here.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from services import student_today as st

NOW = datetime(2026, 11, 23, 3, 0, tzinfo=timezone.utc)  # 10:00 in Vietnam


def _iso(dt):
    return dt.isoformat()


class _Res:
    def __init__(self, data):
        self.data = data


class _Not:
    def __init__(self, q):
        self.q = q

    def is_(self, field, _value):
        self.q.filters.append(lambda r, f=field: r.get(f) is not None)
        return self.q


class _Q:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters, self.order_by, self.limit_n = [], None, None
        self.payload, self.or_filter = None, None
        self.not_ = _Not(self)

    def select(self, *_a, **_k):
        return self

    def eq(self, f, v):
        self.filters.append(lambda r: str(r.get(f)) == str(v))
        return self

    def in_(self, f, vs):
        vs = {str(v) for v in vs}
        self.filters.append(lambda r: str(r.get(f)) in vs)
        return self

    def gt(self, f, v):
        self.filters.append(lambda r: r.get(f) is not None and st._parse_ts(r[f]) > st._parse_ts(v))
        return self

    def is_(self, f, _v):
        self.filters.append(lambda r, f=f: r.get(f) is None)
        return self

    def gte(self, f, v):
        self.filters.append(lambda r: r.get(f) is not None and st._parse_ts(r[f]) >= st._parse_ts(v))
        return self

    def order(self, f, desc=False):
        self.order_by = (f, desc)
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def update(self, payload):
        self.payload = payload
        return self

    def or_(self, expr):
        self.or_filter = expr
        return self

    def execute(self):
        if self.table in self.db.fail:
            raise RuntimeError(f"{self.table} down")
        rows = [r for r in self.db.tables.get(self.table, []) if all(f(r) for f in self.filters)]
        if self.payload is not None:
            self.db.updates.append((self.table, self.payload, self.or_filter, [r.get("id") for r in rows]))
            for r in rows:
                if self.or_filter is None or _forward(r, self.payload):
                    r.update(self.payload)
            return _Res([])
        if self.order_by:
            f, desc = self.order_by
            rows.sort(key=lambda r: str(r.get(f) or ""), reverse=desc)
        if self.limit_n is not None:
            rows = rows[: self.limit_n]
        return _Res([dict(r) for r in rows])


def _forward(row, payload):
    """The tuple rule the or_ filter encodes."""
    cur_at = st._parse_ts(row.get("today_seen_at"))
    if cur_at is None:
        return True
    new_at = st._parse_ts(payload["today_seen_at"])
    return (new_at, payload["today_seen_key"]) > (cur_at, row.get("today_seen_key") or "")


class _DB:
    def __init__(self, tables=None, fail=()):
        self.tables = {k: [dict(r) for r in v] for k, v in (tables or {}).items()}
        self.fail = set(fail)
        self.updates = []

    def table(self, name):
        return _Q(self, name)


def _row(item_id, *, due=None, submitted=None, missing=False):
    return {"item_id": item_id, "submitted_at": submitted, "is_missing": missing,
            "assignment": {"id": f"a-{item_id}", "due_at": due}}


def _run_today(db, monkeypatch, *, assigned=(False, [], False), assigned_error=None):
    def _assigned(_uid, _name, _now):
        if assigned_error:
            raise assigned_error
        return assigned

    monkeypatch.setattr(st, "_visible_assignments_for", _assigned)
    return asyncio.run(st.get_today_concurrent(lambda: db, "u-1", name="Minh Anh", now=NOW))


# ── assigned ──────────────────────────────────────────────────────────────────


def test_no_class_gives_empty_assigned_and_no_course(monkeypatch):
    out = _run_today(_DB({"users": [{"id": "u-1"}]}), monkeypatch)
    assert out["assigned"] == [] and out["assigned_due_soon"] == 0
    assert out["assigned_due_later"] == 0 and out["assigned_total_open"] == 0
    assert out["state"] == "no_course"
    assert out["degraded"] == []


def test_overdue_first_submitted_dropped_and_counts():
    rows = [
        _row("tomorrow", due=_iso(NOW + timedelta(hours=20))),
        _row("over-2", due=_iso(NOW - timedelta(days=1)), missing=True),
        _row("over-1", due=_iso(NOW - timedelta(days=2)), missing=True),
        _row("done", due=_iso(NOW - timedelta(days=1)), submitted=_iso(NOW - timedelta(days=2))),
    ]
    out = st.build_assigned(rows, NOW)
    assert [r["item_id"] for r in out["assigned"]] == ["over-1", "over-2", "tomorrow"]
    assert out["assigned_due_soon"] == 3 and out["assigned_due_later"] == 0


def test_seven_due_soon_cut_to_five_but_counted_before_cut():
    rows = [_row(f"r{i}", due=_iso(NOW + timedelta(hours=i + 1))) for i in range(7)]
    out = st.build_assigned(rows, NOW)
    assert len(out["assigned"]) == 5
    assert out["assigned_due_soon"] == 7 and out["assigned_total_open"] == 7


def test_due_later_and_no_deadline_counted_but_not_listed():
    rows = [_row("t1", due=_iso(NOW + timedelta(hours=2))),
            _row("t2", due=_iso(NOW + timedelta(hours=3))),
            *[_row(f"w{i}", due=_iso(NOW + timedelta(days=7))) for i in range(2)],
            _row("nodue")]
    out = st.build_assigned(rows, NOW)
    assert [r["item_id"] for r in out["assigned"]] == ["t1", "t2"]
    assert out["assigned_due_soon"] == 2 and out["assigned_due_later"] == 3


def test_end_of_tomorrow_is_vietnam_midnight():
    # 23:59 Vietnam time tomorrow is in; 00:00 the day after is not.
    in_window = datetime(2026, 11, 24, 16, 59, tzinfo=timezone.utc)
    out_window = datetime(2026, 11, 24, 17, 0, tzinfo=timezone.utc)
    out = st.build_assigned([_row("in", due=_iso(in_window)), _row("out", due=_iso(out_window))], NOW)
    assert [r["item_id"] for r in out["assigned"]] == ["in"]
    assert out["assigned_due_later"] == 1


def test_class_learner_is_learning(monkeypatch):
    out = _run_today(_DB({"users": [{"id": "u-1"}]}), monkeypatch,
                     assigned=(True, [_row("x", due=_iso(NOW + timedelta(hours=1)))], False))
    assert out["state"] == "learning"
    assert out["assigned_due_soon"] == 1


def test_assigned_failure_is_degraded_only(monkeypatch):
    out = _run_today(_DB({"users": [{"id": "u-1", "target_band": 6.5}]}), monkeypatch,
                     assigned_error=HTTPException(503, "x"))
    assert out["degraded"] == ["assigned"]
    assert out["assigned"] == [] and out["goal"]["target_band"] == 6.5


# ── state order (FR-019) ──────────────────────────────────────────────────────


@pytest.mark.parametrize("kwargs,expected", [
    ({"has_class": True, "access": [], "orders_open": []}, "learning"),
    ({"has_class": False, "access": [{"kind": "online", "state": "active"}], "orders_open": []}, "learning"),
    ({"has_class": False, "access": [], "orders_open": [{"status": "needs_info"}]}, "order_pending"),
    ({"has_class": True, "access": [], "orders_open": [{"status": "needs_info"}]}, "learning"),
    ({"has_class": False, "access": [], "orders_open": []}, "no_course"),
])
def test_state_order(kwargs, expected):
    assert st.derive_state(**kwargs) == expected


def test_never_first_day_before_course_lessons():
    assert st.derive_state(has_class=False, access=[{"kind": "online", "state": "active"}],
                           orders_open=[]) == "learning"


# ── resume (FR-023) ───────────────────────────────────────────────────────────


def test_resume_keeps_live_in_progress_only_newest_first_cap_four():
    future = _iso(NOW + timedelta(hours=5))
    past = _iso(NOW - timedelta(minutes=1))
    tables = {
        "sessions": [
            {"id": "s-live", "user_id": "u-1", "status": "in_progress", "part": 2,
             "started_at": _iso(NOW - timedelta(hours=1)), "resume_expires_at": future},
            {"id": "s-old", "user_id": "u-1", "status": "in_progress",
             "started_at": _iso(NOW - timedelta(hours=30)), "resume_expires_at": past},
            {"id": "s-other", "user_id": "u-2", "status": "in_progress",
             "started_at": _iso(NOW), "resume_expires_at": future},
        ],
        "reading_test_attempts": [
            {"id": "r1", "user_id": "u-1", "status": "in_progress", "test_id": "rt1",
             "started_at": _iso(NOW - timedelta(minutes=10)), "resume_expires_at": future},
            {"id": "r2", "user_id": "u-1", "status": "submitted", "test_id": "rt1",
             "started_at": _iso(NOW), "resume_expires_at": future},
        ],
        "listening_test_attempts": [
            {"id": f"l{i}", "user_id": "u-1", "status": "in_progress", "test_id": "lt1",
             "started_at": _iso(NOW - timedelta(hours=2 + i)), "resume_expires_at": future}
            for i in range(3)
        ],
        "dictation_attempts": [],
        "reading_tests": [{"id": "rt1", "test_id": "cam18-t1", "title": "Cambridge 18 Test 1"}],
        "listening_tests": [{"id": "lt1", "title": "Test 2"}],
    }
    items = st.build_resume(_DB(tables), "u-1", NOW)
    assert len(items) == 4
    assert [i["kind"] for i in items] == ["reading", "speaking", "listening", "listening"]
    assert items[0]["href"] == "/core-player/launch?surface=reading_exam&test_id=cam18-t1"
    assert items[0]["title"] == "Cambridge 18 Test 1"
    assert items[1]["href"] == "/core-player/launch?surface=speaking&session_id=s-live"
    assert all("_started" not in i for i in items)


# ── goal (FR-070) ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("exam,weeks", [("2026-12-21", 4), ("2026-11-23", 0), ("2026-11-01", None), (None, None)])
def test_goal_weeks_left(exam, weeks):
    db = _DB({"users": [{"id": "u-1", "target_band": 6.5, "exam_date": exam}]})
    assert st.build_goal(db, "u-1", NOW)["weeks_left"] == weeks


def test_no_target_band_means_no_goal():
    assert st.build_goal(_DB({"users": [{"id": "u-1", "exam_date": "2027-01-01"}]}), "u-1", NOW) is None


# ── new results (FR-025, FR-078) ──────────────────────────────────────────────


def _results_tables(seen_at=None, seen_key=None, essays=(), sessions=()):
    return {
        "users": [{"id": "u-1", "today_seen_at": seen_at, "today_seen_key": seen_key}],
        "students": [{"id": "st-1", "user_id": "u-1"}],
        "writing_essays": [dict(e) for e in essays],
        "sessions": [dict(s) for s in sessions],
    }


def _essay(eid, at, status="delivered", student="st-1", deleted_at=None):
    return {"id": eid, "student_id": student, "status": status, "task_type": "task2",
            "delivered_at": _iso(at), "deleted_at": deleted_at}


def _session(sid, at, band=6.0, user="u-1", status="completed"):
    return {"id": sid, "user_id": user, "status": status, "part": 1,
            "completed_at": _iso(at), "overall_band": band}


def test_three_results_same_instant_show_two_then_one_then_zero():
    at = NOW - timedelta(hours=1)
    db = _DB(_results_tables(essays=[_essay("e1", at), _essay("e2", at), _essay("e3", at)]))
    seen = []
    for _ in range(3):
        out = st.build_new_results(db, "u-1", NOW)
        seen.append([r["key"] for r in out["new_results"]])
        if out["new_results_cursor"]:
            c = out["new_results_cursor"]
            st.advance_seen_cursor(db, "u-1", st._parse_ts(c["seen_until"]), c["seen_key"])
    assert seen == [["writing:e2", "writing:e1"], ["writing:e3"], []]


def test_oldest_two_first_newest_drawn_first_and_cursor_is_newer_of_two():
    db = _DB(_results_tables(
        essays=[_essay("e-old", NOW - timedelta(hours=5))],
        sessions=[_session("s-mid", NOW - timedelta(hours=3)), _session("s-new", NOW - timedelta(hours=1))],
    ))
    out = st.build_new_results(db, "u-1", NOW)
    assert [r["key"] for r in out["new_results"]] == ["speaking:s-mid", "writing:e-old"]
    assert out["new_results_cursor"]["seen_key"] == "speaking:s-mid"
    assert out["new_results"][0]["href"] == "/result?id=s-mid"
    assert out["new_results"][1]["href"] == "/writing/result?essay_id=e-old"


def test_same_numeric_id_in_two_kinds_never_collides():
    at = NOW - timedelta(hours=1)
    db = _DB(_results_tables(essays=[_essay("7", at)], sessions=[_session("7", at)]))
    out = st.build_new_results(db, "u-1", NOW)
    assert sorted(r["key"] for r in out["new_results"]) == ["speaking:7", "writing:7"]


def test_only_delivered_writing_and_graded_own_speaking_after_cursor():
    seen = NOW - timedelta(hours=2)
    db = _DB(_results_tables(
        seen_at=_iso(seen), seen_key="writing:zzz",
        essays=[_essay("before", NOW - timedelta(hours=3)), _essay("graded", NOW, status="graded"),
                _essay("after", NOW - timedelta(hours=1)), _essay("theirs", NOW, student="st-9")],
        sessions=[_session("noband", NOW, band=None), _session("other", NOW, user="u-2")],
    ))
    out = st.build_new_results(db, "u-1", NOW)
    assert [r["key"] for r in out["new_results"]] == ["writing:after"]


def test_soft_deleted_writing_is_never_a_new_result():
    at = NOW - timedelta(hours=1)
    db = _DB(_results_tables(essays=[_essay("gone", at, deleted_at=_iso(at)), _essay("kept", at)]))
    out = st.build_new_results(db, "u-1", NOW)
    assert [r["key"] for r in out["new_results"]] == ["writing:kept"]
    assert out["new_results_cursor"]["seen_key"] == "writing:kept"


def test_empty_cursor_uses_seven_day_window():
    db = _DB(_results_tables(essays=[_essay("old", NOW - timedelta(days=8)),
                                     _essay("recent", NOW - timedelta(days=6))]))
    assert [r["key"] for r in st.build_new_results(db, "u-1", NOW)["new_results"]] == ["writing:recent"]


def test_new_results_failure_is_degraded(monkeypatch):
    db = _DB({"users": [{"id": "u-1"}]}, fail={"writing_essays", "students"})
    out = _run_today(db, monkeypatch)
    assert out["degraded"] == ["new_results"]
    assert out["new_results"] == [] and out["new_results_cursor"] is None


def test_get_today_writes_nothing(monkeypatch):
    db = _DB(_results_tables(essays=[_essay("e1", NOW - timedelta(hours=1))]))
    out = _run_today(db, monkeypatch)
    assert out["new_results"] and db.updates == []


# ── seen cursor ───────────────────────────────────────────────────────────────


def test_seen_advances_forward_only_and_only_the_callers_row():
    at = NOW - timedelta(hours=1)
    db = _DB({"users": [{"id": "u-1", "today_seen_at": None, "today_seen_key": None},
                        {"id": "u-2", "today_seen_at": None, "today_seen_key": None}]})
    st.advance_seen_cursor(db, "u-1", at, "writing:b")
    st.advance_seen_cursor(db, "u-1", at, "writing:a")            # smaller key: no pull-back
    st.advance_seen_cursor(db, "u-1", at - timedelta(minutes=5), "writing:z")  # older: no-op
    u1, u2 = db.tables["users"]
    assert (u1["today_seen_at"], u1["today_seen_key"]) == (_iso(at), "writing:b")
    assert u2["today_seen_at"] is None
    assert all(ids == ["u-1"] for _t, _p, _o, ids in db.updates)
    expr = db.updates[0][2]
    assert expr.startswith("today_seen_at.is.null,today_seen_at.lt.")
    assert "and(today_seen_at.eq." in expr and "today_seen_key.lt." in expr


@pytest.mark.parametrize("until,key,problem", [
    (NOW + timedelta(minutes=2), "writing:x", "seen_until_in_future"),
    (NOW, "essay:x", "seen_key_invalid"),
    (NOW, "writing:", "seen_key_invalid"),
    (NOW + timedelta(seconds=30), "speaking:abc-1", None),
])
def test_validate_seen(until, key, problem):
    assert st.validate_seen(until, key, NOW) == problem


# ── join points (FR-026, FR-071) ──────────────────────────────────────────────


def test_missing_sources_are_empty_not_degraded(monkeypatch):
    out = _run_today(_DB({"users": [{"id": "u-1"}]}), monkeypatch)
    assert out["access"] == [] and out["credits"] is None and out["orders_open"] == []
    assert out["next_lesson"] is None and out["mock_exams"] == [] and out["open_surveys"] == []
    assert out["trial_today_left"] is None and out["banner"] is None
    assert out["degraded"] == []


@pytest.mark.parametrize("value,expected", [
    (None, None),
    ({"label": "Mạo từ", "count": 3, "of": 5, "review_href": None, "total_errors": 9},
     {"label": "Mạo từ", "count": 3, "of": 5, "review_href": None, "total_errors": 9}),
    ({"label": "x"}, None),
    (RuntimeError("down"), None),
])
def test_repeat_error_join_point(monkeypatch, value, expected):
    def _source(_uid):
        if isinstance(value, Exception):
            raise value
        return value

    monkeypatch.setattr(st, "_repeat_error_for", _source)
    out = _run_today(_DB({"users": [{"id": "u-1"}]}), monkeypatch)
    assert out["repeat_error"] == expected
    assert out["degraded"] == []


def test_banner_rules():
    online = [{"kind": "online", "state": "expiring", "can_renew": True}]
    assert st.derive_banner("learning", online, None, []) == "expiring"
    assert st.derive_banner("learning", online, None, [{"kind": "renewal"}]) is None
    assert st.derive_banner("learning", [{"kind": "online", "state": "expired"}], None, []) == "expired"
    assert st.derive_banner("learning", [], {"total": 0}, []) == "out_of_credits"
    assert st.derive_banner("no_course", online, None, []) is None


# ── HTTP routes ───────────────────────────────────────────────────────────────


@pytest.fixture
def api(monkeypatch):
    from fastapi.testclient import TestClient
    import main
    from routers import student_home

    async def _user(_authorization):
        return {"id": "u-1", "email": "a@x.test", "user_metadata": {}}

    monkeypatch.setattr(student_home, "get_supabase_user", _user)
    # Route-level gate is out of scope here (inventory test covers it).
    from services import activation_gate
    monkeypatch.setattr(activation_gate, "aaccount_is_active", lambda *_a, **_k: _true())
    return TestClient(main.app, raise_server_exceptions=False), student_home


async def _true():
    return True


def test_get_route_matches_response_model(monkeypatch, api):
    client, student_home = api
    db = _DB(_results_tables(essays=[_essay("e1", NOW - timedelta(hours=1))]))
    monkeypatch.setattr(student_home, "thread_supabase_admin", lambda: db)
    monkeypatch.setattr(st, "_visible_assignments_for", lambda *_a: (False, [], False))
    res = client.get("/api/student/today", headers={"Authorization": "Bearer x"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["state"] == "no_course" and body["student"]["name"] == "a"
    assert res.headers["cache-control"] == "private, no-store"
    assert db.updates == []


def test_seen_route_rejects_future_and_naive(monkeypatch, api):
    client, student_home = api
    db = _DB({"users": [{"id": "u-1"}]})
    monkeypatch.setattr(student_home, "thread_supabase_admin", lambda: db)
    future = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    res = client.post("/api/student/today/seen", headers={"Authorization": "Bearer x"},
                      json={"seen_until": future, "seen_key": "writing:e1"})
    assert res.status_code == 422
    res = client.post("/api/student/today/seen", headers={"Authorization": "Bearer x"},
                      json={"seen_until": "2026-11-23T03:00:00", "seen_key": "writing:e1"})
    assert res.status_code == 422
    assert db.updates == []


# ── migration 420 (static; the hosted apply needs Andy's typed approval) ──────


def test_migration_420_is_idempotent_and_rollback_drops_both_columns():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "migrations"
    forward = (root / "420_users_today_seen_at.sql").read_text()
    rollback = (root / "rollback" / "420_users_today_seen_at.sql").read_text()
    assert "ADD COLUMN IF NOT EXISTS today_seen_at timestamptz" in forward
    assert "ADD COLUMN IF NOT EXISTS today_seen_key text" in forward
    assert "DEFAULT" not in forward.split("BEGIN;", 1)[1].upper().replace("DEFAULT PRIVILEGES", "")
    assert "DROP COLUMN IF EXISTS today_seen_key" in rollback
    assert "DROP COLUMN IF EXISTS today_seen_at" in rollback


def test_migration_420_is_held_out_of_the_normal_apply_run():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "migrations"
    policy = [line.split("\t") for line in (root / "forward-policy.tsv").read_text().splitlines()
              if line.startswith("420_")]
    assert len(policy) == 1 and policy[0][:3] == ["420_users_today_seen_at.sql", "pending_feature", "learner_today"]
    assert "No apply on merge" in policy[0][3]
    readme = (root / "README.md").read_text()
    assert "`420` is `pending_feature learner_today`" in readme


def test_reading_resume_uses_the_public_code_and_skips_a_paper_without_one():
    future = _iso(NOW + timedelta(hours=5))
    tables = {
        "sessions": [], "listening_test_attempts": [], "dictation_attempts": [],
        "reading_test_attempts": [
            {"id": "r1", "user_id": "u-1", "status": "in_progress", "test_id": "rt-gone",
             "started_at": _iso(NOW - timedelta(minutes=5)), "resume_expires_at": future},
            {"id": "r2", "user_id": "u-1", "status": "in_progress", "test_id": "rt1",
             "started_at": _iso(NOW - timedelta(minutes=9)), "resume_expires_at": future},
        ],
        "reading_tests": [{"id": "rt1", "test_id": "cam18-t1", "title": "C18 T1"}],
        "listening_tests": [],
    }
    items = st.build_resume(_DB(tables), "u-1", NOW)
    assert [i["href"] for i in items] == ["/core-player/launch?surface=reading_exam&test_id=cam18-t1"]


def test_stale_class_ledger_marks_assigned_degraded(monkeypatch):
    out = _run_today(_DB({"users": [{"id": "u-1"}]}), monkeypatch,
                     assigned=(True, [_row("x", due=_iso(NOW + timedelta(hours=1)))], True))
    assert out["degraded"] == ["assigned"]
    assert out["state"] == "learning"


def test_assigned_wrapper_runs_the_real_imports(monkeypatch):
    """The wrapper itself, not a stub: its body imports must resolve (a wrong
    module path would land every caller in `degraded`)."""
    from routers import class_student
    from services import class_membership_service

    calls = {}
    monkeypatch.setattr(class_student, "_student_for_user", lambda uid, name: {"id": "s1", "cohort_id": "c1"})
    monkeypatch.setattr(class_membership_service, "active_cohort_ids_for_student",
                        lambda _sb, student: calls.setdefault("student", student["id"]) and ["c1"])
    row = {"assignment": {"due_at": None}, "item_id": "a"}
    monkeypatch.setattr(class_student, "_visible_assignments",
                        lambda student, now, ids: calls.setdefault("ids", ids) and ([row], False))
    assert st._visible_assignments_for("u-1", "A", NOW) == (True, [row], False)
    assert calls == {"student": "s1", "ids": ["c1"]}


def test_assigned_wrapper_no_active_class(monkeypatch):
    from routers import class_student
    from services import class_membership_service

    monkeypatch.setattr(class_student, "_student_for_user", lambda *_a: {"id": "s1", "cohort_id": None})
    monkeypatch.setattr(class_membership_service, "active_cohort_ids_for_student", lambda *_a: [])
    assert st._visible_assignments_for("u-1", "A", NOW) == (False, [], False)
