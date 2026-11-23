"""G09-T03 (ADMINIA-0074 FR-09-020…022, FR-09-029, FR-102): learner directory.

Runs the real service (services/admin_learner_directory.py and
services/learner_attention.py) and routes (routers/admin_learners.py) over a
small in-memory stand-in for the service client. All names and addresses are
made up; no AI or network call.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import admin_learners as mod
from services import admin_learner_directory as directory
from services import learner_attention, ops_thresholds, staff_scope, test_data_visibility

NOW = datetime.now(timezone.utc)
U_LAN, U_MINH, U_ONLY, U_TEACH, U_ADMIN, U_E2E = (f"10000000-0000-0000-0000-00000000000{i}" for i in range(1, 7))
U_TEACH_B = "10000000-0000-0000-0000-0000000000b0"
S_LAN, S_MINH, S_OFFLINE, S_E2E, S_OLD = (f"20000000-0000-0000-0000-00000000000{i}" for i in range(1, 6))
C_A, C_B = "30000000-0000-0000-0000-00000000000a", "30000000-0000-0000-0000-00000000000b"
DEFAULTS = {t.key: t.default for t in ops_thresholds.EDITABLE}


def _ago(**kw) -> str:
    return (NOW - timedelta(**kw)).isoformat()


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, name):
        self.db, self.name, self.filters, self._neg = db, name, [], False
        self._order, self._range, self._limit = None, None, None

    def _add(self, fn):
        neg, self._neg = self._neg, False
        self.filters.append((lambda r: not fn(r)) if neg else fn)
        return self

    @property
    def not_(self):
        self._neg = True
        return self

    def select(self, *_a, **_k): return self

    def _write(self, kind):
        def record(*_a, **_k):
            self.db.writes.append((kind, self.name))
            return self
        return record

    insert = property(lambda self: self._write("insert"))
    update = property(lambda self: self._write("update"))
    upsert = property(lambda self: self._write("upsert"))
    delete = property(lambda self: self._write("delete"))
    def eq(self, c, v): return self._add(lambda r: str(r.get(c)) == str(v) if not isinstance(v, bool) else r.get(c) is v)
    def in_(self, c, vs):
        if c == "class_assignment_item_id":
            self.db.evidence_queries.append(",".join(str(v) for v in vs))
        return self._add(lambda r: str(r.get(c)) in {str(v) for v in vs})
    def is_(self, c, v): return self._add(lambda r: r.get(c) is None)
    def gte(self, c, v): return self._add(lambda r: r.get(c) is not None and str(r.get(c)) >= str(v))
    def lt(self, c, v): return self._add(lambda r: r.get(c) is not None and str(r.get(c)) < str(v))
    # Only the blackeye hidden-test filter uses or_; no fixture holds such a
    # test, so it keeps every row.
    def or_(self, *_a, **_k): return self
    def ilike(self, c, v): return self._add(lambda r: str(r.get(c) or "").lower() == v.replace("\\", "").lower())

    def order(self, c, desc=False):
        self._order = (c, desc)
        return self

    def range(self, a, b):
        self._range = (a, b)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def execute(self):
        if self.name in self.db.fail:
            raise RuntimeError("db down")
        rows = [dict(r) for r in self.db.rows.get(self.name, []) if all(f(r) for f in self.filters)]
        if self._order:
            c, desc = self._order
            rows.sort(key=lambda r: str(r.get(c) or ""), reverse=desc)
        if self._range:
            rows = rows[self._range[0]: self._range[1] + 1]
        if self._limit is not None:
            rows = rows[: self._limit]
        return _Resp(rows)


class _DB:
    def __init__(self):
        self.fail: set[str] = set()
        self.writes: list[tuple[str, str]] = []
        self.evidence_queries: list[str] = []
        user = lambda uid, email, role="user", name=None, **kw: {
            "id": uid, "email": email, "display_name": name, "role": role, "is_active": True,
            "last_seen_at": _ago(days=1), "created_at": _ago(days=90), "target_band": None, "exam_date": None, **kw}
        student = lambda sid, code, name, uid=None, **kw: {
            "id": sid, "user_id": uid, "student_code": code, "full_name": name, "target_band": None,
            "target_date": None, "archived_at": None, "created_at": _ago(days=60), **kw}
        self.rows = {
            "users": [
                user(U_LAN, "lan@example.test", target_band=7.0, exam_date="2027-01-10"),
                user(U_MINH, "minh@example.test", last_seen_at=_ago(days=10)),
                user(U_ONLY, "chua-ho-so@example.test", name="Bảo Châu"),
                user(U_TEACH, "gv@example.test", role="instructor", name="Cô Hà"),
                user(U_TEACH_B, "gv-b@example.test", role="instructor", name="Thầy Tâm"),
                user(U_ADMIN, "admin@example.test", role="admin", name="Quản trị"),
                user(U_E2E, "robot@staging-e2e.averlearning.com", name="Robot"),
            ],
            "students": [
                student(S_LAN, "HV001", "Nguyễn Thị Lan", U_LAN, target_band=7.0, target_date="2027-01-10"),
                student(S_MINH, "HV002", "Trần Văn Minh", U_MINH, target_band=6.5),
                student(S_OLD, "HV000", "Trần Văn Minh (cũ)", U_MINH, archived_at=_ago(days=30)),
                student(S_OFFLINE, "HV003", "Đỗ Anh Đức"),
                student(S_E2E, "HV-E2E", "e2e learner", U_E2E),
            ],
            "student_cohort_memberships": [
                {"id": "m1", "student_id": S_LAN, "cohort_id": C_A, "is_active": True},
                {"id": "m2", "student_id": S_MINH, "cohort_id": C_B, "is_active": True},
                {"id": "m3", "student_id": S_OFFLINE, "cohort_id": C_A, "is_active": True},
            ],
            "cohorts": [{"id": C_A, "name": "Tue–Thu 19:30", "instructor_id": U_TEACH},
                        {"id": C_B, "name": "Sat–Sun 09:00", "instructor_id": U_TEACH_B}],
            "class_assignments": [
                {"id": "a1", "cohort_id": C_A, "title": "Buổi 8 · Writing Task 2", "skill": "writing", "due_at": _ago(days=10), "status": "published"},
                {"id": "a2", "cohort_id": C_A, "title": "Buổi 9 · Reading", "skill": "reading", "due_at": _ago(days=5), "status": "published"},
                {"id": "a3", "cohort_id": C_A, "title": "Buổi 10 · Listening", "skill": "listening", "due_at": _ago(days=2), "status": "published"},
                {"id": "a4", "cohort_id": C_A, "title": "Buổi 11 · Speaking", "skill": "speaking", "due_at": (NOW + timedelta(days=3)).isoformat(),
                 "status": "published"},
            ],
            "class_assignment_items": [
                # Lan: on time, then two in a row not handed in -> a streak of 2.
                {"id": "i1", "assignment_id": "a1", "student_id": S_LAN, "state": "graded", "submitted_at": _ago(days=11)},
                {"id": "i2", "assignment_id": "a2", "student_id": S_LAN, "state": "assigned", "submitted_at": None},
                {"id": "i3", "assignment_id": "a3", "student_id": S_LAN, "state": "opened", "submitted_at": None},
                {"id": "i4", "assignment_id": "a4", "student_id": S_LAN, "state": "assigned", "submitted_at": None},
                # Đức: late but handed in, then on time -> no streak.
                {"id": "i5", "assignment_id": "a2", "student_id": S_OFFLINE, "state": "submitted", "submitted_at": _ago(days=4)},
                {"id": "i6", "assignment_id": "a3", "student_id": S_OFFLINE, "state": "submitted", "submitted_at": _ago(days=3)},
            ],
            "writing_essays": [
                {"id": f"e{i}", "student_id": S_LAN, "status": "delivered", "is_flagged": False, "deleted_at": None,
                 "delivered_at": _ago(days=i), "writing_feedback": {"overall_band_score": 6.0 + i / 2}}
                for i in range(1, 6)
            ] + [{"id": "e-draft", "student_id": S_LAN, "status": "graded", "is_flagged": False, "deleted_at": None,
                  "delivered_at": None, "writing_feedback": {"overall_band_score": 9.0}}],
            "sessions": [{"id": "x1", "user_id": U_LAN, "status": "completed", "overall_band": 6.5,
                          "started_at": _ago(days=2)}],
            "access_codes": [{"id": "k1", "code": "AVER-LAN1", "used_by": None}],
            "user_code_assignments": [{"code_id": "k1", "user_id": U_LAN, "is_active": True}],
        }

    def table(self, name):
        return _Query(self, name)


@pytest.fixture
def db(monkeypatch):
    fake = _DB()
    for module in (directory, learner_attention, staff_scope):
        monkeypatch.setattr(module, "supabase_admin", fake)
    monkeypatch.setattr(ops_thresholds, "get", AsyncMock(return_value=dict(DEFAULTS)))
    monkeypatch.setattr(test_data_visibility, "hide_for", lambda **_k: False)
    monkeypatch.setattr(mod, "require_admin", AsyncMock(return_value={"id": U_ADMIN, "email": "admin@example.test"}))
    return fake


def _list(**kw):
    params = dict(q=None, cohort_id=None, kind=None, status=None, attention=None, credits_max=None,
                  role="user,student", page=1, page_size=25, authorization="Bearer x")
    params.update(kw)
    return asyncio.run(mod.list_learners(**params))


def _by_ref(out):
    return {row["ref"]: row for row in out["items"]}


def _as(monkeypatch, db, user_id):
    async def require_instructor(_auth):
        role = next((u["role"] for u in db.rows["users"] if u["id"] == user_id), None)
        if role not in ("instructor", "admin"):
            raise HTTPException(403, "staff only")
        return {"id": user_id}

    async def role_row(uid):
        return _Resp([{"role": u["role"]} for u in db.rows["users"] if u["id"] == uid])

    monkeypatch.setattr(staff_scope, "require_instructor", require_instructor)
    monkeypatch.setattr(staff_scope, "_staff_role_row", role_row)


# ── Directory ──────────────────────────────────────────────────────────────

def test_one_row_per_person_across_users_and_students(db):
    rows = _by_ref(_list())
    lan = rows[f"u-{U_LAN}"]   # account + profile: one row, by the account
    assert lan["student_code"] == "HV001" and lan["account_state"] == "active" and lan["profile_state"] == "active"
    assert lan["cohorts"] == [{"id": C_A, "name": "Tue–Thu 19:30"}]
    offline = rows[f"s-{S_OFFLINE}"]   # profile without an account
    assert offline["account_state"] == "none" and offline["email"] is None
    only = rows[f"u-{U_ONLY}"]   # account without a profile
    assert only["profile_state"] == "none" and only["name"] == "Bảo Châu" and only["cohorts"] == []
    # Minh has an archived and an active profile: one row, the active one.
    assert rows[f"u-{U_MINH}"]["student_code"] == "HV002"
    # The profile id for class writes (G09-T10 "Gán vào lớp"); none without a profile.
    assert lan["student_id"] == S_LAN and offline["student_id"] == S_OFFLINE and only["student_id"] is None
    assert f"s-{S_LAN}" not in rows and f"s-{S_MINH}" not in rows and f"s-{S_OLD}" not in rows
    # G04 has no read API: null, not a guess.
    assert lan["kind"] is None and lan["courses"] is None and lan["credits_left"] is None


def test_staff_are_hidden_unless_asked_for(db):
    refs = set(_by_ref(_list()))
    assert f"u-{U_TEACH}" not in refs and f"u-{U_ADMIN}" not in refs
    staff = set(_by_ref(_list(role="instructor")))
    assert staff == {f"u-{U_TEACH}", f"u-{U_TEACH_B}"}
    with pytest.raises(HTTPException) as caught:
        _list(role="owner")
    assert caught.value.status_code == 422


def test_staging_test_data_is_hidden_like_the_students_list(db, monkeypatch):
    assert f"u-{U_E2E}" in _by_ref(_list())
    monkeypatch.setattr(test_data_visibility, "hide_for", lambda **_k: True)
    assert f"u-{U_E2E}" not in _by_ref(_list())


def test_sorted_by_given_name_then_paged_by_25(db):
    names = [row["name"] for row in _list()["items"]]
    # By the last word, accents folded: Châu, Đức, Lan, learner, Minh.
    assert names == ["Bảo Châu", "Đỗ Anh Đức", "Nguyễn Thị Lan", "e2e learner", "Trần Văn Minh"]
    for i in range(30):
        db.rows["students"].append({"id": f"40000000-0000-0000-0000-{i:012d}", "user_id": None,
                                    "student_code": f"P{i:02d}", "full_name": f"Học viên {i:02d}",
                                    "archived_at": None, "created_at": _ago(days=1)})
    first, second = _list(), _list(page=2)
    assert first["total"] == second["total"] == 35
    assert len(first["items"]) == 25 and len(second["items"]) == 10
    assert not set(_by_ref(first)) & set(_by_ref(second))


def test_search_ignores_accents_and_finds_codes_and_emails(db):
    assert set(_by_ref(_list(q="duc"))) == {f"s-{S_OFFLINE}"}
    assert set(_by_ref(_list(q="minh@example"))) == {f"u-{U_MINH}"}
    assert set(_by_ref(_list(q="HV003"))) == {f"s-{S_OFFLINE}"}
    assert set(_by_ref(_list(q="aver-lan1"))) == {f"u-{U_LAN}"}   # activation code



def test_code_search_follows_current_ownership_not_a_former_holder(db):
    """A reassigned code belongs to its active assignment; its old used_by is a
    former holder and is not found. A legacy code with no assignment row still
    finds its used_by."""
    db.rows["access_codes"] += [{"id": "k2", "code": "AVER-MOVED", "used_by": U_MINH},
                                {"id": "k3", "code": "AVER-OLD1", "used_by": U_MINH}]
    db.rows["user_code_assignments"] += [{"code_id": "k2", "user_id": U_MINH, "is_active": False},
                                         {"code_id": "k2", "user_id": U_LAN, "is_active": True}]
    assert set(_by_ref(_list(q="aver-moved"))) == {f"u-{U_LAN}"}
    assert set(_by_ref(_list(q="aver-old1"))) == {f"u-{U_MINH}"}

def test_filters_by_class_and_archive(db):
    assert set(_by_ref(_list(cohort_id=C_A))) == {f"u-{U_LAN}", f"s-{S_OFFLINE}"}
    db.rows["students"][3]["archived_at"] = _ago(days=1)   # Đức leaves
    assert f"s-{S_OFFLINE}" not in _by_ref(_list())
    assert set(_by_ref(_list(status="archived"))) == {f"s-{S_OFFLINE}"}


@pytest.mark.parametrize("kw", [{"kind": "online"}, {"status": "expiring"}, {"attention": "low_credits"},
                                {"credits_max": 3}])
def test_filters_that_need_g04_are_refused_not_guessed(db, kw):
    with pytest.raises(HTTPException) as caught:
        _list(**kw)
    assert caught.value.status_code == 422 and caught.value.detail["code"] == "filter_unavailable"


def test_attention_column_and_filter_use_the_thresholds(db, monkeypatch):
    rows = _by_ref(_list())
    assert rows[f"u-{U_LAN}"]["attention"] == [{"code": "late_streak", "text": "trễ 2 bài liên tiếp"}]
    assert rows[f"u-{U_MINH}"]["attention"] == [{"code": "inactive", "text": "không hoạt động 10 ngày"}]
    assert rows[f"s-{S_OFFLINE}"]["attention"] == []   # late once, then on time; no account → no "inactive"
    assert set(_by_ref(_list(attention="any"))) == {f"u-{U_LAN}", f"u-{U_MINH}"}
    # The admin raises both thresholds: nobody needs attention any more.
    monkeypatch.setattr(ops_thresholds, "get", AsyncMock(return_value={**DEFAULTS, "late_streak_count": 3,
                                                                         "inactive_days": 14}))
    assert _list(attention="any")["total"] == 0
    assert _by_ref(_list())[f"u-{U_LAN}"]["attention"] == []


def test_a_failed_class_lookup_still_lists_and_says_so(db):
    db.fail.add("cohorts")
    out = _list()
    # The class table also says which classes are archived, so the late
    # streak is not decided either: both sources are named.
    assert out["sources_failed"] == ["assignments", "cohorts"]
    assert all(row["cohorts"] is None for row in out["items"])
    assert all(not any(r["code"] == "late_streak" for r in row["attention"]) for row in out["items"])


def test_unreadable_attention_is_never_shown_as_fine(db, monkeypatch):
    db.fail.add("class_assignment_items")
    out = _list()
    assert "assignments" in out["sources_failed"]
    with pytest.raises(HTTPException) as caught:
        _list(attention="any")
    assert caught.value.status_code == 503
    monkeypatch.setattr(ops_thresholds, "get", AsyncMock(side_effect=ops_thresholds.ThresholdsUnavailable("x")))
    db.fail.clear()
    assert "thresholds" in _list()["sources_failed"]


def test_an_on_time_hand_in_whose_ledger_write_failed_is_not_missing(db):
    """Lan's Buổi 10 Listening has no ledger submitted_at, but her submitted
    attempt linked to that item (on time) is durable evidence: it counts as
    handed in, read only, so the streak breaks and the overdue count drops."""
    db.rows["listening_test_attempts"] = [{"id": "lt1", "class_assignment_item_id": "i3",
                                           "status": "submitted", "submitted_at": _ago(days=3)}]
    s = asyncio.run(mod.get_learner(f"u-{U_LAN}", "Bearer x"))["summary"]
    assert s["overdue"] == {"count": 1, "latest_title": "Buổi 9 · Reading"}
    assert s["status"]["reasons"] == []


def _drill_with_dictation(db, dictation):
    """Lan's Buổi 10 is a Listening Skill Drill that requires dictation of
    sections 1 and 2; her listening attempt was submitted on time (3 days
    ago, due 2 days ago) but the ledger write failed."""
    for a in db.rows["class_assignments"]:
        if a["id"] == "a3":
            a["content_config"] = {"skill_drill": {"dictation_required": True, "sections": [1, 2]}}
    db.rows["listening_test_attempts"] = [{"id": "lt1", "class_assignment_item_id": "i3",
                                           "status": "submitted", "submitted_at": _ago(days=3)}]
    db.rows["dictation_sessions"] = [
        {"id": f"d{n}", "class_assignment_item_id": "i3", "section_num": n, "completed_at": at}
        for n, at in dictation]
    return asyncio.run(mod.get_learner(f"u-{U_LAN}", "Bearer x"))["summary"]


def test_a_drill_without_its_required_dictation_is_still_missing(db):
    s = _drill_with_dictation(db, [(1, _ago(days=3, hours=-1))])   # section 2 never done
    assert s["overdue"] == {"count": 2, "latest_title": "Buổi 10 · Listening"}
    assert s["status"]["reasons"][0]["code"] == "late_streak"


def test_a_drill_with_its_dictation_done_before_the_deadline_is_handed_in(db):
    s = _drill_with_dictation(db, [(1, _ago(days=3, hours=-1)), (2, _ago(days=3, hours=-2))])
    assert s["overdue"] == {"count": 1, "latest_title": "Buổi 9 · Reading"}
    assert s["status"]["reasons"] == []


def test_a_drill_whose_dictation_finished_after_the_deadline_stays_missing(db):
    s = _drill_with_dictation(db, [(1, _ago(days=3, hours=-1)), (2, _ago(days=1))])
    assert s["overdue"]["count"] == 2


def test_a_completion_after_the_deadline_stays_missing(db):
    db.rows["sessions"].append({"id": "x-late", "user_id": U_LAN, "class_assignment_item_id": "i3",
                                "status": "completed", "completed_at": _ago(days=1), "started_at": _ago(days=1)})
    s = asyncio.run(mod.get_learner(f"u-{U_LAN}", "Bearer x"))["summary"]
    assert s["overdue"]["count"] == 2


def test_unreadable_hand_in_evidence_is_reported_not_read_as_missing(db):
    db.fail.add("listening_test_attempts")
    detail = asyncio.run(mod.get_learner(f"u-{U_LAN}", "Bearer x"))
    assert detail["summary"]["overdue"] is None and detail["summary"]["status"]["level"] is None
    assert "assignments" in detail["sources_failed"]


def _lesson_item(db, quiz_ended_at):
    """Lan's Buổi 10 becomes a lesson item (skill "course") with an empty
    ledger and one ended quiz session linked to it."""
    for a in db.rows["class_assignments"]:
        if a["id"] == "a3":
            a["skill"] = "course"
    db.rows["quiz_sessions"] = [{"id": "q1", "class_assignment_item_id": "i3", "ended_at": quiz_ended_at}]


def test_one_ended_lesson_section_is_not_read_as_a_hand_in(db):
    """A multi-section lesson with one section done: whether that is a hand-in
    is the ledger repair's call. The read neither credits it nor counts it
    missing or late; it says the assignment source is undecided."""
    _lesson_item(db, _ago(days=3))
    detail = asyncio.run(mod.get_learner(f"u-{U_LAN}", "Bearer x"))
    assert "assignments" in detail["sources_failed"]
    assert detail["summary"]["overdue"] is None
    assert detail["summary"]["status"]["level"] is None
    history = learner_attention.assignment_history([S_LAN], NOW)[S_LAN]
    assert history.unconfirmed and "i3" not in {r["title"] for r in history.past_due}
    assert [r["title"] for r in history.past_due] == ["Buổi 9 · Reading", "Buổi 8 · Writing Task 2"]


def test_late_lesson_work_is_not_counted_missing(db):
    """Lesson work after the deadline is late, not missing; a read cannot
    tell which, so the item is left out and the source is reported."""
    _lesson_item(db, _ago(days=1))
    out = _list()
    lan = next(r for r in out["items"] if r["ref"] == f"u-{U_LAN}")
    assert "assignments" in out["sources_failed"]
    assert not any(r["code"] == "late_streak" for r in lan["attention"])
    history = learner_attention.assignment_history([S_LAN], NOW)[S_LAN]
    assert history.unconfirmed and all(not r["missing"] for r in history.past_due if r["title"].startswith("Buổi 10"))
    # Only that learner is undecided: another learner's streak is still raised.
    late = {"title": "x", "due_at": NOW, "cohort_id": C_A, "missing": True, "late": True}
    other = learner_attention.AssignmentHistory(past_due=[late, dict(late)])
    res = learner_attention.compute(
        [{"key": "a", "student_id": "sa", "has_account": False},
         {"key": "b", "student_id": "sb", "has_account": False}],
        dict(DEFAULTS), now=NOW, history={"sa": history, "sb": other})
    assert res.reasons["a"] == [] and [r["code"] for r in res.reasons["b"]] == ["late_streak"]
    assert res.sources_failed == ["assignments"]


def test_an_undecided_learner_does_not_take_down_the_attention_filter(db):
    """One learner with an undecided lesson item (a quiz started, not
    finished) must not make the filtered directory 503: that learner is left
    out of the result and named in ``undecided``; everyone else is decided."""
    _lesson_item(db, _ago(days=3))
    for attention in ("any", "late_streak"):
        out = _list(attention=attention)
        assert f"u-{U_LAN}" not in _by_ref(out)
        assert out["undecided"] == [f"u-{U_LAN}"]
        assert "assignments" in out["sources_failed"]
    # Inactivity does not depend on the class ledger: nobody is undecided.
    out = _list(attention="inactive")
    assert out["undecided"] == [] and f"u-{U_MINH}" in _by_ref(out)
    # Without a lesson item Lan is decided and listed, and nobody is undecided.
    db.rows["quiz_sessions"] = []
    out = _list(attention="late_streak")
    assert f"u-{U_LAN}" in _by_ref(out) and out["undecided"] == []


def test_an_archived_class_work_is_not_counted_missing(db):
    for c in db.rows["cohorts"]:
        if c["id"] == C_A:
            c.update(is_active=False, archived_at=_ago(days=1))
    s = asyncio.run(mod.get_learner(f"u-{U_LAN}", "Bearer x"))["summary"]
    assert s["overdue"] == {"count": 0, "latest_title": None}
    assert s["status"]["reasons"] == []


def test_teacher_reads_write_nothing(db, monkeypatch):
    """A teacher's GET never writes, for any class: the ledger is not repaired
    here, and out-of-scope classes are not even read for evidence."""
    db.rows["student_cohort_memberships"].append(
        {"id": "m4", "student_id": S_LAN, "cohort_id": C_B, "is_active": True})
    db.rows["class_assignments"].append(
        {"id": "b1", "cohort_id": C_B, "title": "Lớp B", "due_at": _ago(days=1), "status": "published"})
    db.rows["class_assignment_items"].append(
        {"id": "ib1", "assignment_id": "b1", "student_id": S_LAN, "state": "assigned", "submitted_at": None})
    _as(monkeypatch, db, U_TEACH)
    asyncio.run(mod.get_learner_summary(f"u-{U_LAN}", "Bearer x"))
    asyncio.run(mod.get_instructor_learner(f"u-{U_LAN}", "Bearer x"))
    assert db.writes == []
    assert not any("ib1" in q for q in db.evidence_queries)


def test_an_unreadable_directory_is_503(db):
    db.fail.add("users")
    with pytest.raises(HTTPException) as caught:
        _list()
    assert caught.value.status_code == 503 and caught.value.detail["code"] == "learners_unavailable"


# ── Detail and summary ─────────────────────────────────────────────────────

def test_profile_ref_of_a_person_with_an_account_points_to_the_account(db):
    out = asyncio.run(mod.get_learner(f"s-{S_LAN}", "Bearer x"))
    assert out["ref"] == f"s-{S_LAN}" and out["canonical_ref"] == f"u-{U_LAN}"
    assert out["student_id"] == S_LAN
    assert out["account"]["user_id"] == U_LAN and out["account"]["is_active"] is True
    assert out["account"]["role"] == next(u["role"] for u in db.rows["users"] if u["id"] == U_LAN)
    offline = asyncio.run(mod.get_learner(f"s-{S_OFFLINE}", "Bearer x"))
    assert offline["canonical_ref"] == f"s-{S_OFFLINE}"
    assert offline["student_id"] == S_OFFLINE and offline["account"] is None
    for ref in ("x-123", f"u-{S_OFFLINE}", "u-not-a-uuid"):
        with pytest.raises(HTTPException) as caught:
            asyncio.run(mod.get_learner(ref, "Bearer x"))
        assert caught.value.status_code == 404


def test_summary_has_the_seven_fields_of_the_shared_block(db):
    detail = asyncio.run(mod.get_learner(f"u-{U_LAN}", "Bearer x"))
    s = detail["summary"]
    assert set(s) == {"name", "cohorts", "courses", "status", "goal", "overdue", "recent_bands",
                      "last_active_at", "latest_note"}
    assert s["name"] == "Nguyễn Thị Lan" and s["cohorts"][0]["name"] == "Tue–Thu 19:30"
    assert s["status"] == {"level": "attention", "reasons": [{"code": "late_streak", "text": "trễ 2 bài liên tiếp"}]}
    assert s["goal"] == {"target_band": 7.0, "exam_date": "2027-01-10", "source": "both_equal"}
    assert s["overdue"] == {"count": 2, "latest_title": "Buổi 10 · Listening"}   # Buổi 11 is not due yet
    # Only returned (delivered) Writing counts, newest first, at most four.
    assert s["recent_bands"] == {"writing": [6.5, 7.0, 7.5, 8.0], "speaking": [6.5]}
    assert s["latest_note"] is None and s["courses"] is None
    assert detail["sources_failed"] == []



def test_recent_bands_leave_out_mock_exam_work(db):
    """FR-104: a mock-exam Speaking session or Writing essay (sitting_id set) is
    exam work, not a practice band."""
    db.rows["sessions"].append({"id": "x-mock", "user_id": U_LAN, "status": "completed", "overall_band": 9.0,
                                "started_at": _ago(days=1), "sitting_id": "sit-1"})
    db.rows["writing_essays"].append({"id": "e-mock", "student_id": S_LAN, "status": "delivered",
                                      "is_flagged": False, "deleted_at": None, "delivered_at": _ago(hours=1),
                                      "sitting_id": "sit-1", "writing_feedback": {"overall_band_score": 9.0}})
    bands = asyncio.run(mod.get_learner(f"u-{U_LAN}", "Bearer x"))["summary"]["recent_bands"]
    assert bands == {"writing": [6.5, 7.0, 7.5, 8.0], "speaking": [6.5]}


def test_goal_sources(db):
    minh = asyncio.run(mod.get_learner(f"u-{U_MINH}", "Bearer x"))["summary"]
    assert minh["goal"] == {"target_band": 6.5, "exam_date": None, "source": "admin"}
    db.rows["users"][1]["target_band"] = 7.5
    minh = asyncio.run(mod.get_learner(f"u-{U_MINH}", "Bearer x"))["summary"]
    assert minh["goal"]["source"] == "conflict"
    # Same band, the date set on the learner's side only: not a conflict (the
    # overview and fn_learner_goal_resolve use the same rule), and the summary
    # keeps the one date there is.
    db.rows["users"][1].update(target_band=6.5, exam_date="2027-03-01")
    minh = asyncio.run(mod.get_learner(f"u-{U_MINH}", "Bearer x"))["summary"]
    assert minh["goal"] == {"target_band": 6.5, "exam_date": "2027-03-01", "source": "both_equal"}
    only = asyncio.run(mod.get_learner(f"u-{U_ONLY}", "Bearer x"))["summary"]
    assert only["goal"] == {"target_band": None, "exam_date": None, "source": "none"}
    assert only["recent_bands"] == {"writing": [], "speaking": []}   # nothing yet, not a band


def test_one_failed_source_keeps_the_rest_of_the_summary(db):
    db.fail.add("writing_essays")
    out = asyncio.run(mod.get_learner(f"u-{U_LAN}", "Bearer x"))
    assert out["sources_failed"] == ["writing"]
    assert out["summary"]["recent_bands"] == {"writing": None, "speaking": [6.5]}
    db.fail = {"class_assignment_items"}
    out = asyncio.run(mod.get_learner(f"u-{U_LAN}", "Bearer x"))
    assert out["summary"]["overdue"] is None and out["summary"]["status"]["level"] is None
    assert "assignments" in out["sources_failed"]


# ── Teacher scope and roles ────────────────────────────────────────────────

def test_teacher_sees_only_learners_of_their_classes(db, monkeypatch):
    _as(monkeypatch, db, U_TEACH)
    out = asyncio.run(mod.get_instructor_learner(f"u-{U_LAN}", "Bearer x"))
    assert out["summary"]["name"] == "Nguyễn Thị Lan"
    # The account and profile ids are admin detail only (G09-T11b).
    assert "account" not in out and "student_id" not in out
    assert asyncio.run(mod.get_learner_summary(f"s-{S_OFFLINE}", "Bearer x"))["name"] == "Đỗ Anh Đức"
    for call in (mod.get_instructor_learner, mod.get_learner_summary):
        for ref in (f"u-{U_MINH}", f"u-{U_ONLY}"):   # another class; no class at all
            with pytest.raises(HTTPException) as caught:
                asyncio.run(call(ref, "Bearer x"))
            assert caught.value.status_code == 404


def test_a_learner_in_two_teachers_classes_shows_each_teacher_only_their_class(db, monkeypatch):
    """FR-102: Lan is in Cô Hà's class (C_A) and Thầy Tâm's class (C_B). Each
    teacher sees only their own class and its work; the admin sees both."""
    db.rows["student_cohort_memberships"].append(
        {"id": "m4", "student_id": S_LAN, "cohort_id": C_B, "is_active": True})
    db.rows["class_assignments"].append(
        {"id": "b1", "cohort_id": C_B, "title": "Lớp B · Mock test", "due_at": _ago(days=1), "status": "published"})
    db.rows["class_assignment_items"].append(
        {"id": "ib1", "assignment_id": "b1", "student_id": S_LAN, "state": "assigned", "submitted_at": None})

    def summary_as(user_id):
        _as(monkeypatch, db, user_id)
        return asyncio.run(mod.get_learner_summary(f"u-{U_LAN}", "Bearer x"))

    a = summary_as(U_TEACH)
    assert [c["id"] for c in a["cohorts"]] == [C_A]
    assert a["overdue"] == {"count": 2, "latest_title": "Buổi 10 · Listening"}
    b = summary_as(U_TEACH_B)
    assert [c["id"] for c in b["cohorts"]] == [C_B]
    assert b["overdue"] == {"count": 1, "latest_title": "Lớp B · Mock test"}
    assert "Tue–Thu 19:30" not in repr(b) and "Buổi" not in repr(b)
    detail_b = asyncio.run(mod.get_instructor_learner(f"u-{U_LAN}", "Bearer x"))["summary"]
    assert [c["id"] for c in detail_b["cohorts"]] == [C_B] and detail_b["overdue"]["count"] == 1
    # Practice bands belong to no class, so neither teacher sees them, on
    # either teacher route; the admin sees them all.
    for summary in (a, b, detail_b):
        assert summary["recent_bands"] == {"writing": None, "speaking": None}
    admin = summary_as(U_ADMIN)
    assert sorted(c["id"] for c in admin["cohorts"]) == sorted([C_A, C_B])
    assert admin["overdue"] == {"count": 3, "latest_title": "Lớp B · Mock test"}
    assert admin["recent_bands"] == {"writing": [6.5, 7.0, 7.5, 8.0], "speaking": [6.5]}


def test_admin_reads_any_summary(db, monkeypatch):
    _as(monkeypatch, db, U_ADMIN)
    assert asyncio.run(mod.get_learner_summary(f"u-{U_MINH}", "Bearer x"))["name"] == "Trần Văn Minh"


def test_a_learner_token_is_refused(db, monkeypatch):
    _as(monkeypatch, db, U_LAN)
    for call in (mod.get_instructor_learner, mod.get_learner_summary):
        with pytest.raises(HTTPException) as caught:
            asyncio.run(call(f"u-{U_LAN}", "Bearer x"))
        assert caught.value.status_code == 403
    monkeypatch.setattr(mod, "require_admin", AsyncMock(side_effect=HTTPException(403, "admin only")))
    with pytest.raises(HTTPException) as caught:
        _list()
    assert caught.value.status_code == 403


def test_teacher_scope_that_cannot_be_read_fails_closed(db, monkeypatch):
    _as(monkeypatch, db, U_TEACH)
    db.fail.add("student_cohort_memberships")
    with pytest.raises(HTTPException) as caught:
        asyncio.run(mod.get_learner_summary(f"u-{U_LAN}", "Bearer x"))
    assert caught.value.status_code == 503
