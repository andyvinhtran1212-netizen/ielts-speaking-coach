"""LEARNERCORE-0063 amendment 3, T30a: GET /api/student/assigned.

The list comes from the T13 wrapper over `_visible_assignments`;
these tests pin the four fields the service adds (`group`, `action`,
`accepting`, `self_practice_available`), the pass-through of the base element
and of `homework_stale`, the degraded path, the route, and the FR-103 write
rule: the two ledger reconcilers can write only the caller's ledger items.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from services import student_assigned as sa
from services import student_today as st

NOW = datetime(2026, 11, 23, 3, 0, tzinfo=timezone.utc)  # 10:00 in Vietnam


def _iso(dt):
    return dt.isoformat()


def _row(item_id, skill="speaking", *, due=None, submitted=None, state="assigned",
         missing=None, **extra):
    if missing is None:
        missing = bool(not submitted and due and due < NOW)
    row = {
        "item_id": item_id,
        "state": state,
        "submitted_at": _iso(submitted) if submitted else None,
        "score": None,
        "passed_at": None,
        "course_action": None,
        "writing_expected": False,
        "is_late": False,
        "is_missing": missing,
        "assignment": {
            "id": f"a-{item_id}", "cohort_id": "c1", "cohort_name": None,
            "title": f"Bài {item_id}", "skill": skill, "instructions": None,
            "due_at": _iso(due) if due else None, "content_config": {},
        },
    }
    row.update(extra)
    return row


def _writing(item_id, *, due=None, submitted=None, status="pending", review_state=None,
             band=None, result_path=None):
    row = _row(item_id, "writing", due=due, submitted=submitted, state=status)
    row.update({
        "review_state": review_state or ("submitted" if submitted else "not_submitted"),
        "band": band,
        "result_path": result_path,
    })
    return row


def _get(monkeypatch, rows, *, has_class=True, stale=False):
    monkeypatch.setattr(st, "_visible_assignments_for",
                        lambda *_a, **_k: (has_class, rows, stale))
    return sa.get_assigned("u-1", "A", NOW)


def _by_id(out):
    return {row["item_id"]: row for row in out["items"]}


# ── groups (FR-096) ───────────────────────────────────────────────────────────


def test_four_groups_from_fake_data(monkeypatch):
    rows = [
        _row("todo", "listening", due=NOW + timedelta(days=2)),
        _row("closed", "reading", due=NOW - timedelta(hours=1)),
        _writing("graded", submitted=NOW - timedelta(days=1), status="graded",
                 review_state="graded"),
        _row("spoken", "speaking", submitted=NOW - timedelta(hours=3), state="submitted",
             score=6.5),
    ]
    items = _by_id(_get(monkeypatch, rows))
    assert {k: v["group"] for k, v in items.items()} == {
        "todo": "todo", "closed": "overdue", "graded": "awaiting_review", "spoken": "returned",
    }
    assert items["todo"]["accepting"] is True and items["todo"]["action"] == "start"
    assert items["closed"]["accepting"] is False and items["closed"]["action"] == "none"
    assert items["graded"]["action"] == "review_submitted"
    assert items["spoken"]["action"] == "result"


def test_reopened_course_retake_is_todo_not_returned(monkeypatch):
    """HOLD patch: a failed course hand-in whose deadline the teacher extended
    (`course_action=retake`) is work again even with a submitted_at."""
    row = _row("c", "course", due=NOW + timedelta(days=1),
               submitted=NOW - timedelta(days=2), state="submitted", course_action="retake")
    item = _get(monkeypatch, [row])["items"][0]
    assert item["group"] == "todo"
    assert item["action"] == "start"
    assert item["accepting"] is True


def test_reopened_course_work_past_its_deadline_is_overdue(monkeypatch):
    row = _row("c", "course", due=NOW - timedelta(hours=1),
               submitted=NOW - timedelta(days=2), state="submitted",
               course_action="retake")
    item = _get(monkeypatch, [row])["items"][0]
    assert (item["group"], item["accepting"], item["action"]) == ("overdue", False, "none")


def test_course_timer_ran_out_before_the_deadline_is_not_accepting(monkeypatch):
    """CR #2573: `expired_pending` (timer over, hand-in being collected) takes
    no new work even though the deadline is still ahead; it opens the read-only
    "Đang thu bài" lane like /my-class."""
    row = _row("c", "course", due=NOW + timedelta(days=1), state="opened",
               course_action="expired_pending")
    item = _get(monkeypatch, [row])["items"][0]
    assert item["accepting"] is False
    assert item["group"] == "overdue"
    assert item["action"] == "review_submitted"


def test_course_review_before_the_deadline_is_not_accepting(monkeypatch):
    """CR #2573: a passed course hand-in (`review`) is not accepting just
    because its deadline is still ahead."""
    row = _row("c", "course", due=NOW + timedelta(days=1),
               submitted=NOW - timedelta(days=1), state="submitted", course_action="review")
    item = _get(monkeypatch, [row])["items"][0]
    assert (item["accepting"], item["group"], item["action"]) == (False, "returned", "result")


def test_course_review_is_returned_with_result(monkeypatch):
    row = _row("c", "course", submitted=NOW - timedelta(days=1), state="submitted",
               course_action="review")
    item = _get(monkeypatch, [row])["items"][0]
    assert (item["group"], item["action"]) == ("returned", "result")


def test_course_continue_is_resume(monkeypatch):
    row = _row("c", "course", due=NOW + timedelta(days=1), state="opened",
               course_action="continue")
    assert _get(monkeypatch, [row])["items"][0]["action"] == "resume"


def test_no_deadline_is_todo(monkeypatch):
    item = _get(monkeypatch, [_row("n", "reading")])["items"][0]
    assert (item["group"], item["accepting"], item["action"]) == ("todo", True, "start")


def test_opened_ledger_task_is_resume(monkeypatch):
    row = _row("o", "listening", due=NOW + timedelta(days=1), state="opened")
    assert _get(monkeypatch, [row])["items"][0]["action"] == "resume"


def test_unreadable_deadline_is_not_accepting(monkeypatch):
    """`is_accepting_submissions` refuses an unreadable due_at; the page must
    not offer "Làm bài" for a task every hand-in route would refuse."""
    row = _row("u", "speaking")
    row["assignment"]["due_at"] = "not-a-date"
    item = _get(monkeypatch, [row])["items"][0]
    assert item["accepting"] is False
    assert item["group"] == "overdue"


# ── Writing ───────────────────────────────────────────────────────────────────


def test_overdue_writing_is_still_accepting_by_the_writing_rule(monkeypatch):
    """The Writing submit route has no deadline cutoff: an overdue `pending`
    give is still taken, so it is overdue AND accepting, with "Làm bài"."""
    row = _writing("w", due=NOW - timedelta(days=1))
    item = _get(monkeypatch, [row])["items"][0]
    assert item["accepting"] is True
    assert item["group"] == "overdue"
    assert item["action"] == "start"


def test_writing_graded_has_no_band(monkeypatch):
    row = _writing("w", submitted=NOW - timedelta(days=1), status="graded",
                   review_state="graded", band=None)
    item = _get(monkeypatch, [row])["items"][0]
    assert item["group"] == "awaiting_review"
    assert item["band"] is None


def test_writing_returned_with_result_path(monkeypatch):
    row = _writing("w", submitted=NOW - timedelta(days=2), status="returned",
                   review_state="returned", band=6.5, result_path="/writing/result?essay_id=e1")
    item = _get(monkeypatch, [row])["items"][0]
    assert (item["group"], item["action"], item["band"]) == ("returned", "result", 6.5)


# ── self-practice (T30b) ──────────────────────────────────────────────────────


def test_self_practice_is_hidden_until_t30b(monkeypatch):
    rows = [_row("closed", "reading", due=NOW - timedelta(hours=1)),
            _row("c", "course", due=NOW - timedelta(hours=1), course_action="closed")]
    for item in _get(monkeypatch, rows)["items"]:
        assert item["self_practice_available"] is False
        assert item["action"] != "self_practice"


def test_self_practice_hook_only_marks_closed_unsubmitted_supported_skills():
    rows = [
        _row("closed", "reading", due=NOW - timedelta(hours=1)),
        _row("open", "reading", due=NOW + timedelta(days=1)),
        _row("done", "reading", submitted=NOW - timedelta(days=1), state="submitted"),
        _row("course", "course", due=NOW - timedelta(hours=1), course_action="closed"),
        _row("vocab", "vocab", due=NOW - timedelta(hours=1)),
    ]
    seen = {}

    def everything_open(candidates):
        seen["ids"] = sorted(r["item_id"] for r in candidates)
        return {r["item_id"] for r in rows}  # claims too much on purpose

    items = {r["item_id"]: r for r in sa.decorate(rows, NOW, open_ids=everything_open)}
    assert seen["ids"] == ["closed"]
    assert [k for k, v in items.items() if v["self_practice_available"]] == ["closed"]
    assert items["closed"]["action"] == "self_practice"
    assert items["course"]["self_practice_available"] is False


# ── payload ───────────────────────────────────────────────────────────────────


def test_base_element_is_passed_through_unchanged(monkeypatch):
    row = _row("x", "listening", due=NOW + timedelta(days=1), score=None)
    item = _get(monkeypatch, [dict(row)])["items"][0]
    for key, value in row.items():
        assert item[key] == value


def test_homework_stale_is_passed_through(monkeypatch):
    out = _get(monkeypatch, [_row("x")], stale=True)
    assert out["homework_stale"] is True
    assert out["degraded"] == []


def test_no_class(monkeypatch):
    out = _get(monkeypatch, [], has_class=False)
    assert out == {"has_class": False, "items": [], "repractice": [],
                   "homework_stale": False, "degraded": []}


def test_a_failed_list_read_is_degraded_not_empty(monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("db down")
    monkeypatch.setattr(st, "_visible_assignments_for", boom)
    out = sa.get_assigned("u-1", "A", NOW)
    assert out["degraded"] == ["items"]
    assert out["items"] == []


def test_reads_only_the_callers_rows(monkeypatch):
    calls = []
    monkeypatch.setattr(st, "_visible_assignments_for",
                        lambda uid, name, now, *, reconcile_student_only:
                        calls.append((uid, name, now, reconcile_student_only)) or (True, [], False))
    sa.get_assigned("u-1", "A", NOW)
    assert calls == [("u-1", "A", NOW, True)]


# ── FR-103: unreconciled data, and nothing but the reconcilers writes ─────────


class _Res:
    def __init__(self, data):
        self.data = data
        self.count = len(data)


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.filters = db, table, []
        self.update_values = None

    def select(self, *_a, **_k):
        return self

    def eq(self, f, v):
        self.filters.append(lambda r: str(r.get(f)) == str(v))
        return self

    def in_(self, f, vs):
        vs = {str(v) for v in vs}
        self.filters.append(lambda r: str(r.get(f)) in vs)
        return self

    def or_(self, expression):
        # The fixture has no Black Eye papers.
        assert self.table == "listening_tests" and not self.db.tables.get(self.table)
        assert "metadata->blackeye.not.is.null" in expression
        return self

    def is_(self, f, _v):
        self.filters.append(lambda r: r.get(f) is None)
        return self

    @property
    def not_(self):
        q = self

        class _Not:
            def is_(self, f, _v):
                q.filters.append(lambda r: r.get(f) is not None)
                return q
        return _Not()

    def order(self, *_a, **_k):
        return self

    def range(self, *_a):
        return self

    def limit(self, *_a):
        return self

    def _write(self, *_a, **_k):
        self.db.writes.append(self.table)
        return self

    insert = upsert = delete = _write

    def update(self, values):
        self.update_values = values
        return self

    def execute(self):
        rows = [r for r in self.db.tables.get(self.table, []) if all(f(r) for f in self.filters)]
        if self.update_values is not None:
            self.db.writes.extend((self.table, row["id"]) for row in rows)
            for row in rows:
                row.update(self.update_values)
        return _Res([dict(row) for row in rows])


class _DB:
    def __init__(self, tables):
        self.tables, self.writes = tables, []

    def table(self, name):
        return _Q(self, name)


def test_assigned_reconciles_only_the_callers_reading_and_course_ledgers():
    import database
    from routers import class_student
    from services import quiz_service

    students = ["s1", "s2"]
    finished = _iso(NOW - timedelta(hours=1))
    db = _DB({
        "students": [
            {"id": student, "user_id": f"u-{number}", "cohort_id": "c1"}
            for number, student in enumerate(students, start=1)
        ],
        "student_cohort_memberships": [
            {"id": student, "student_id": student, "cohort_id": "c1", "is_active": True}
            for student in students
        ],
        "class_assignment_items": [
            {"id": f"{skill}-{student}", "assignment_id": skill, "student_id": student,
             "submitted_at": None, "state": "assigned", "score": None}
            for skill in ("reading", "course") for student in students
        ],
        "class_assignments": [
            {"id": skill, "cohort_id": "c1", "skill": skill, "status": "published",
             "publish_at": None, "due_at": _iso(NOW + timedelta(days=1)),
             "title": skill, "content_id": bank, "content_config": {}}
            for skill, bank in (("reading", "paper"), ("course", "bank"))
        ],
        "reading_test_attempts": [
            {"id": f"attempt-{student}", "class_assignment_item_id": f"reading-{student}",
             "status": "submitted", "submitted_at": finished, "band_estimate": 6}
            for student in students
        ],
        "course_writing_submissions": [
            {"id": f"essay-{student}", "class_assignment_item_id": f"course-{student}",
             "graded_at": finished, "total": 8, "clean": True}
            for student in students
        ],
        "quiz_questions": [{"id": "prompt", "bank_id": "bank", "qid": "prompt", "type": "writing"}],
    })
    with patch.object(class_student, "supabase_admin", db), \
         patch.object(quiz_service, "supabase_admin", db), \
         patch.object(database, "supabase_admin", db):
        out = sa.get_assigned("u-1", "A", NOW)
        replay = sa.get_assigned("u-1", "A", NOW)

    items = _by_id(out)
    assert set(items) == {"reading-s1", "course-s1"}
    assert items["reading-s1"]["group"] == "returned"
    assert items["reading-s1"]["action"] == "result"
    assert all(item["submitted_at"] == finished for item in items.values())
    assert out["homework_stale"] is False
    assert replay == out
    assert db.writes == [
        ("class_assignment_items", "reading-s1"),
        ("class_assignment_items", "course-s1"),
    ]

    # Teacher-style batch calls still repair the other learner's pending items.
    assert class_student.reconcile_test_attempts(db, db.tables["class_assignments"]) == 1
    assert class_student.reconcile_course_items(db, ["course"]) == 1
    assert db.writes[-2:] == [
        ("class_assignment_items", "reading-s2"),
        ("class_assignment_items", "course-s2"),
    ]


# ── route ─────────────────────────────────────────────────────────────────────


@pytest.fixture
def api(monkeypatch):
    from fastapi.testclient import TestClient
    import main
    from routers import student_home

    async def _user(_authorization):
        return {"id": "u-1", "email": "a@x.test", "user_metadata": {}}

    async def _true(*_a, **_k):
        return True

    monkeypatch.setattr(student_home, "get_supabase_user", _user)
    from services import activation_gate
    monkeypatch.setattr(activation_gate, "aaccount_is_active", _true)
    # The route answers only while learner_v2 is on for the caller (gate tests below).
    monkeypatch.setattr(student_home, "is_learner_v2_enabled", lambda _uid: True)
    return TestClient(main.app, raise_server_exceptions=False)


def test_route_matches_response_model(monkeypatch, api):
    monkeypatch.setattr(st, "_visible_assignments_for", lambda *_a, **_k: (
        True, [_row("x", "listening", due=NOW + timedelta(days=365))], False))
    res = api.get("/api/student/assigned", headers={"Authorization": "Bearer x"})
    assert res.status_code == 200, res.text
    assert res.headers["cache-control"] == "private, no-store"
    body = res.json()
    assert body["has_class"] is True
    item = body["items"][0]
    assert item["group"] == "todo" and item["action"] == "start"
    assert item["assignment"]["title"] == "Bài x", "the base element survives the model"


def test_route_requires_sign_in():
    from fastapi.testclient import TestClient
    import main

    res = TestClient(main.app, raise_server_exceptions=False).get("/api/student/assigned")
    assert res.status_code == 401


def _never(*_a):
    raise AssertionError("class-ledger reconcile ran behind a closed learner_v2 gate")


def test_route_404_while_learner_v2_is_off(monkeypatch, api):
    from routers import student_home

    asked = []
    monkeypatch.setattr(student_home, "is_learner_v2_enabled",
                        lambda uid: asked.append(uid) or False)
    monkeypatch.setattr(st, "_visible_assignments_for", _never)
    res = api.get("/api/student/assigned", headers={"Authorization": "Bearer x"})
    assert res.status_code == 404, res.text
    assert res.json()["detail"]["code"] == "not_found"
    assert res.headers["cache-control"] == "private, no-store"
    assert asked == ["u-1"]


def test_route_gate_denies_on_flag_lookup_error(monkeypatch, api):
    from routers import student_home
    from services import feature_flags, runtime_flags

    monkeypatch.setattr(student_home, "is_learner_v2_enabled", feature_flags.is_learner_v2_enabled)
    monkeypatch.setattr(feature_flags, "_per_user_flag", lambda *_a: True)
    # Opted in, but the runtime-flag read fails: is_enabled answers its on_error.
    monkeypatch.setattr(runtime_flags, "is_enabled",
                        lambda key, default=False, on_error=False: on_error)
    monkeypatch.setattr(st, "_visible_assignments_for", _never)
    res = api.get("/api/student/assigned", headers={"Authorization": "Bearer x"})
    assert res.status_code == 404, res.text


def test_course_work_actions_match_the_router_set():
    """The copy here must stay equal to the set `_visible_assignments` uses."""
    from routers.class_student import _COURSE_WORK_ACTIONS

    assert sa.COURSE_WORK_ACTIONS == frozenset(_COURSE_WORK_ACTIONS)
