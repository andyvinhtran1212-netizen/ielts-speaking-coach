"""G09-T38 backend: GET /admin/speaking/mock-queue (ADMINIA-0074 plan 5.4).

The service reads four tables through a small in-memory fake that honours the
filters the service uses (eq, in_, not_.in_, not_.is_ null), so each case
checks the real "waiting" rule rather than a mocked answer.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from routers import admin_speaking_mock_queue as route
from services import ops_thresholds, speaking_mock_queue as svc, test_data_visibility
from services.staff_scope import StaffScope

NOW = datetime(2026, 11, 23, 12, 0, tzinfo=timezone.utc)
SPEAK = {"part1": ["t1"]}


def ago(hours: float) -> str:
    return (NOW - timedelta(hours=hours)).isoformat()


class _Res:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.preds, self._neg = db, table, [], False

    def select(self, _cols):
        return self

    @property
    def not_(self):
        self._neg = True
        return self

    def _add(self, fn):
        neg, self._neg = self._neg, False
        self.preds.append((lambda r: not fn(r)) if neg else fn)
        return self

    def eq(self, col, val):
        return self._add(lambda r: str(r.get(col)) == str(val))

    def in_(self, col, vals):
        vals = {str(v) for v in vals}
        return self._add(lambda r: str(r.get(col)) in vals)

    def is_(self, col, val):
        assert val == "null"
        return self._add(lambda r: r.get(col) is None)

    def execute(self):
        self.db.calls.append(self.table)
        if self.table in self.db.fail:
            raise RuntimeError("db down")
        return _Res([dict(r) for r in self.db.rows.get(self.table, []) if all(p(r) for p in self.preds)])


class _DB:
    def __init__(self, **rows):
        self.rows, self.calls, self.fail = rows, [], set()

    def table(self, name):
        return _Q(self, name)


def _exam(id_, *, cohort="c1", speaking=SPEAK, mode="sequential", title=None):
    return {"id": id_, "title": title or f"Exam {id_}", "cohort_id": cohort, "exam_mode": mode,
            "speaking_topic_set": speaking, "listening_test_id": "L", "reading_test_id": "R"}


def _sitting(id_, exam, *, user="u1", status="all_submitted", done=ago(10), ids=("s1",), assigned=None):
    return {"id": id_, "user_id": user, "mock_exam_id": exam, "status": status,
            "assigned_skills": assigned, "speaking_completed_at": done,
            "speaking_session_ids": list(ids)}


@pytest.fixture
def db(monkeypatch):
    d = _DB(
        mock_exams=[_exam("e1"), _exam("e2", cohort="c2"), _exam("e3", speaking={}),
                    _exam("e4", mode="retake"), _exam("e5", cohort=None)],
        mock_exam_sittings=[],
        mock_exam_reviews=[],
        cohorts=[{"id": "c1", "name": "IELTS 6.5 tối"}, {"id": "c2", "name": "Lớp B"}],
        users=[{"id": "u1", "display_name": "An"}, {"id": "u2", "display_name": "Bình"},
               {"id": "t9", "display_name": "Cô Hà"}, {"id": "u3", "email": "x@e2e.test"}],
    )
    monkeypatch.setattr(svc, "supabase_admin", d)
    monkeypatch.setattr(svc.wf, "supabase_admin", d)
    return d


def _ids(items):
    return [i["sitting_id"] for i in items]


def test_waiting_rule(db):
    S = db.rows["mock_exam_sittings"]
    S += [
        _sitting("ok", "e1"),
        _sitting("not_recorded", "e1", done=None),
        _sitting("no_sessions", "e1", ids=()),
        _sitting("void", "e1", status="void"),
        _sitting("released", "e1", status="released"),
        _sitting("final", "e1"),
        _sitting("draft_only", "e1", done=ago(20)),
        _sitting("no_speaking_exam", "e3"),
        _sitting("retake_without_s", "e4", assigned=["writing"]),
        _sitting("retake_with_s", "e4", assigned=["writing", "speaking"], done=ago(5)),
        _sitting("speaking_pending_lrw_open", "e1", status="lrw_in_progress", done=ago(1)),
    ]
    db.rows["mock_exam_reviews"] += [
        {"sitting_id": "final", "claimed_by": None, "final_bands": {"speaking": 6.5}},
        {"sitting_id": "draft_only", "claimed_by": "t9",
         "final_bands": {"writing": 6}, "ai_draft": {"speaking": {"band": 6}}},
    ]
    items = svc.pending_items(overdue_hours=72, now=NOW)
    # Oldest first; the draft band is not final, so that sitting still waits.
    assert _ids(items) == ["draft_only", "ok", "retake_with_s", "speaking_pending_lrw_open"]
    draft = items[0]
    assert draft["claimed_by"] == {"id": "t9", "name": "Cô Hà"}
    assert draft["exam"] == {"id": "e1", "title": "Exam e1"}
    assert draft["cohort"] == {"id": "c1", "name": "IELTS 6.5 tối"}
    assert draft["name"] == "An" and draft["flags"] == [] and draft["waited_hours"] == 20
    assert items[1]["claimed_by"] is None


def test_overdue_uses_threshold_and_never_guesses(db):
    db.rows["mock_exam_sittings"] += [_sitting("old", "e1", done=ago(80)),
                                      _sitting("new", "e1", done=ago(71.9))]
    by = {i["sitting_id"]: i for i in svc.pending_items(overdue_hours=72, now=NOW)}
    assert by["old"]["overdue"] is True and by["old"]["waited_hours"] == 80
    assert by["new"]["overdue"] is False and by["new"]["waited_hours"] == 71
    assert all(i["overdue"] is None for i in svc.pending_items(overdue_hours=None, now=NOW))


def test_exam_filter_and_teacher_scope(db):
    db.rows["mock_exam_sittings"] += [_sitting("a", "e1"), _sitting("b", "e2"), _sitting("c", "e5")]
    assert _ids(svc.pending_items(now=NOW)) == ["a", "b", "c"]
    assert _ids(svc.pending_items(exam_id="e2", now=NOW)) == ["b"]
    # A teacher of c1 sees only c1's exam; a class-less exam belongs to no teacher.
    assert _ids(svc.pending_items(cohort_ids=frozenset({"c1"}), now=NOW)) == ["a"]
    assert svc.pending_items(cohort_ids=frozenset({"c1"}), exam_id="e2", now=NOW) == []
    db.calls.clear()
    assert svc.pending_items(cohort_ids=frozenset(), now=NOW) == []
    assert db.calls == []  # no class: nothing read
    c = svc.pending_items(exam_id="e5", now=NOW)[0]
    assert c["cohort"] is None


def test_hidden_test_users_are_dropped(db):
    db.rows["mock_exam_sittings"] += [_sitting("real", "e1"), _sitting("qa", "e1", user="u3")]
    assert _ids(svc.pending_items(hide_user_ids=frozenset({"u3"}), now=NOW)) == ["real"]
    assert _ids(svc.pending_items(now=NOW)) == ["qa", "real"]


def test_practice_speaking_never_read(db):
    db.rows["mock_exam_sittings"] += [_sitting("a", "e1")]
    svc.pending_items(now=NOW)
    assert "sessions" not in db.calls


# ---- route -------------------------------------------------------------


def _patch_route(monkeypatch, db, *, scope, thresholds=None, hide=False):
    async def _scope(_auth):
        return scope

    async def _get():
        if thresholds is None:
            raise ops_thresholds.ThresholdsUnavailable("x")
        return thresholds

    monkeypatch.setattr(route, "resolve_staff_scope", _scope)
    monkeypatch.setattr(route.ops_thresholds, "get", _get)
    monkeypatch.setattr(test_data_visibility, "hide_for", lambda **_: hide)
    monkeypatch.setattr(test_data_visibility, "test_user_ids", lambda: {"u3"})


ADMIN = StaffScope(role="admin", user_id="adm", cohort_ids=None)
TEACHER = StaffScope(role="instructor", user_id="t9", cohort_ids=frozenset({"c2"}))


def test_route_admin_with_thresholds(monkeypatch, db):
    db.rows["mock_exam_sittings"] += [_sitting("a", "e1", done=ago(100)), _sitting("qa", "e1", user="u3")]
    _patch_route(monkeypatch, db, scope=ADMIN, thresholds={"speaking_mock_hours": 72}, hide=True)
    out = asyncio.run(route.mock_queue(exam_id=None, authorization="Bearer x"))
    assert out["overdue_hours"] == 72
    assert [i["sitting_id"] for i in out["items"]] == ["a"]
    assert out["items"][0]["overdue"] is True


def test_route_teacher_scope_and_unreadable_thresholds(monkeypatch, db):
    db.rows["mock_exam_sittings"] += [_sitting("a", "e1"), _sitting("b", "e2")]
    _patch_route(monkeypatch, db, scope=TEACHER, thresholds=None)
    out = asyncio.run(route.mock_queue(exam_id=None, authorization="Bearer x"))
    assert out["overdue_hours"] is None
    assert [(i["sitting_id"], i["overdue"]) for i in out["items"]] == [("b", None)]


def test_route_read_failure_is_visible(monkeypatch, db):
    db.rows["mock_exam_sittings"] += [_sitting("a", "e1")]
    db.fail.add("mock_exam_reviews")
    _patch_route(monkeypatch, db, scope=ADMIN, thresholds={"speaking_mock_hours": 72})
    with pytest.raises(HTTPException) as exc:
        asyncio.run(route.mock_queue(exam_id=None, authorization="Bearer x"))
    assert exc.value.status_code == 503
    assert exc.value.detail["code"] == "speaking_queue_unavailable"


def test_route_awaits_its_guard_first():
    import ast
    import inspect
    import textwrap

    fn = ast.parse(textwrap.dedent(inspect.getsource(route.mock_queue))).body[0]
    first = fn.body[0]
    assert isinstance(first, ast.Assign)
    call = first.value.value  # await resolve_staff_scope(...)
    assert isinstance(first.value, ast.Await) and call.func.id == "resolve_staff_scope"
