"""LEARNERCORE-0063 amendment 3, T30a: GET /api/student/assigned.

The list comes from the T13 wrapper over `_visible_assignments` (unchanged);
these tests pin the four fields the service adds (`group`, `action`,
`accepting`, `self_practice_available`), the pass-through of the base element
and of `homework_stale`, the degraded path, the route, and the FR-103 write
rule: the only writes are the two ledger reconcilers `_visible_assignments`
calls itself.
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
                        lambda *_a: (has_class, rows, stale))
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
    def boom(*_a):
        raise RuntimeError("db down")
    monkeypatch.setattr(st, "_visible_assignments_for", boom)
    out = sa.get_assigned("u-1", "A", NOW)
    assert out["degraded"] == ["items"]
    assert out["items"] == []


def test_reads_only_the_callers_rows(monkeypatch):
    calls = []
    monkeypatch.setattr(st, "_visible_assignments_for",
                        lambda uid, name, now: calls.append((uid, name, now)) or (True, [], False))
    sa.get_assigned("u-1", "A", NOW)
    assert calls == [("u-1", "A", NOW)]


# ── FR-103: unreconciled data, and nothing but the reconcilers writes ─────────


class _Res:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.filters = db, table, []

    def select(self, *_a, **_k):
        return self

    def eq(self, f, v):
        self.filters.append(lambda r: str(r.get(f)) == str(v))
        return self

    def in_(self, f, vs):
        vs = {str(v) for v in vs}
        self.filters.append(lambda r: str(r.get(f)) in vs)
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

    update = insert = upsert = delete = _write

    def execute(self):
        rows = self.db.tables.get(self.table, [])
        return _Res([r for r in rows if all(f(r) for f in self.filters)])


class _DB:
    def __init__(self, tables):
        self.tables, self.writes = tables, []

    def table(self, name):
        return _Q(self, name)


def test_unreconciled_reading_hand_in_lands_in_a_submitted_group():
    """The Reading attempt is submitted but the ledger has not recorded it.
    `_visible_assignments` reconciles first (one of its two allowed writes), so
    the row is in a submitted group, not owed; no other table is written."""
    from routers import class_student

    db = _DB({
        "class_assignment_items": [{
            "id": "item-r", "assignment_id": "a-r", "student_id": "s1",
            "submitted_at": None, "state": "assigned", "score": None,
        }],
        "class_assignments": [{
            "id": "a-r", "cohort_id": "c1", "skill": "reading", "status": "published",
            "publish_at": None, "due_at": _iso(NOW + timedelta(days=1)),
            "title": "Reading 1", "content_id": "t1", "content_config": {},
        }],
        "writing_assignments": [],
    })
    reconciled = []

    def reconcile_tests(_sb, assignments):
        reconciled.append("tests")
        for row in db.tables["class_assignment_items"]:
            row.update({"submitted_at": _iso(NOW - timedelta(hours=1)), "state": "submitted"})
        return 1

    def reconcile_course(_sb, ids):
        reconciled.append("course")
        return 0

    with patch.object(class_student, "supabase_admin", db), \
         patch.object(class_student, "_student_for_user", return_value={"id": "s1", "cohort_id": "c1"}), \
         patch("services.class_membership_service.active_cohort_ids_for_student", return_value=["c1"]), \
         patch.object(class_student, "reconcile_test_attempts", reconcile_tests), \
         patch.object(class_student, "reconcile_course_items", reconcile_course):
        out = sa.get_assigned("u-1", "A", NOW)

    assert reconciled == ["tests", "course"]
    assert db.writes == [], "only the two reconcilers may write"
    item = out["items"][0]
    assert item["item_id"] == "item-r"
    assert item["group"] == "returned"
    assert item["action"] == "result"
    assert out["homework_stale"] is False


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
    monkeypatch.setattr(st, "_visible_assignments_for", lambda *_a: (
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
