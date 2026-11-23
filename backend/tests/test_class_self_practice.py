"""LEARNERCORE-0063 amendment 3, T30b: POST /api/class/assignments/{item_id}/self-practice
and the `self_practice_available` flag of GET /api/student/assigned.

A closed class assignment opens the SAME paper in ordinary self-practice, but
only when that paper is open to public self-practice now. Nothing is written,
and the launch carries no class item, so the attempt never counts for the
assignment.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from services import class_self_practice as csp
from services import student_assigned as sa
from services import student_today as st

NOW = datetime(2026, 11, 23, 3, 0, tzinfo=timezone.utc)
PAST = (NOW - timedelta(days=1)).isoformat()
FUTURE = (NOW + timedelta(days=1)).isoformat()
STUDENT = {"id": "s1", "cohort_id": "c1"}


class _Res:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.n = db, table, [], None

    def select(self, *_a, **_k):
        return self

    def eq(self, f, v):
        self.filters.append(lambda r: str(r.get(f)) == str(v))
        return self

    def in_(self, f, vs):
        vs = {str(v) for v in vs}
        self.filters.append(lambda r: str(r.get(f)) in vs)
        return self

    @property
    def not_(self):
        query = self

        class _Not:
            def is_(self, f, _v):
                query.filters.append(lambda r: r.get(f) is not None)
                return query
        return _Not()

    def limit(self, n):
        self.n = n
        return self

    def _write(self, *_a, **_k):
        self.db.writes.append(self.table)
        return self

    update = insert = upsert = delete = _write

    def execute(self):
        self.db.reads.append(self.table)
        rows = [r for r in self.db.tables.get(self.table, []) if all(f(r) for f in self.filters)]
        return _Res(rows[: self.n] if self.n else rows)


class _DB:
    def __init__(self, tables):
        self.tables, self.writes, self.reads = tables, [], []

    def table(self, name):
        return _Q(self, name)


def _listening(test_id="L1", **over):
    row = {"id": test_id, "status": "published", "exam_only": False, "is_public": True,
           "public_practice_enabled": True, "full_audio_storage_path": "a.mp3",
           "assembled_audio_storage_path": None}
    row.update(over)
    return row


def _reading(test_id="R1", **over):
    row = {"id": test_id, "test_id": "reading-01", "status": "published", "exam_only": False,
           "is_public": True, "public_practice_enabled": True}
    row.update(over)
    return row


def _db(skill="listening", *, due=PAST, content_id=None, cfg=None, papers=None,
        item_owner="s1", status="published", topics=None, attempts=None):
    content_id = content_id or {"listening": "L1", "reading": "R1", "speaking": "T1"}.get(skill, "X1")
    return _DB({
        "class_assignment_items": [{"id": "item-1", "assignment_id": "a1",
                                    "student_id": item_owner, "submitted_at": None,
                                    "state": "assigned"}],
        "class_assignments": [{"id": "a1", "cohort_id": "c1", "skill": skill, "status": status,
                               "publish_at": None, "due_at": due, "content_id": content_id,
                               "content_config": cfg or {}}],
        "listening_public_practice_catalog": papers if papers is not None and skill == "listening" else [_listening()],
        "reading_public_practice_catalog": papers if papers is not None and skill == "reading" else [_reading()],
        "topics": topics if topics is not None else [
            {"id": "T1", "title": "Hometown", "part": 1, "is_active": True}],
        "writing_assignments": [{"id": "w-1", "student_id": "s1"}],
        "listening_test_attempts": list(attempts or []) if skill == "listening" else [],
        "reading_test_attempts": list(attempts or []) if skill == "reading" else [],
    })


def _call(db, item_id="item-1", *, active=True, user_id="u-1"):
    with patch("services.class_membership_service.student_is_active_in_cohort",
               return_value=active):
        return csp.self_practice(db, student=STUDENT, item_id=item_id, now=NOW, user_id=user_id)


def _error(db, **kw):
    with pytest.raises(csp.SelfPracticeError) as exc:
        _call(db, **kw)
    return exc.value.status, exc.value.code


# ── route rules (FR-100) ──────────────────────────────────────────────────────


def test_closed_listening_returns_public_href_without_class_item():
    db = _db("listening")
    out = _call(db)
    assert out == {"skill": "listening",
                   "launch": {"href": "/core-player/launch?surface=listening_test&id=L1"}}
    assert "class_item" not in out["launch"]["href"]
    assert db.writes == []


def test_closed_reading_uses_the_public_paper_code():
    out = _call(_db("reading"))
    assert out["launch"]["href"] == "/core-player/launch?surface=reading_exam&test_id=reading-01"


def test_closed_speaking_returns_session_params_without_item_id():
    db = _db("speaking", cfg={"mode": "practice", "part": 2, "topic": "Hometown"})
    out = _call(db)
    assert out == {"skill": "speaking",
                   "launch": {"session_params": {"mode": "practice", "part": 2, "topic": "Hometown"}}}
    assert "class_assignment_item_id" not in out["launch"]["session_params"]
    assert db.writes == []


def test_another_learners_item_is_404():
    assert _error(_db(item_owner="s2"))[0] == 404


def test_item_left_after_moving_class_is_404():
    """The `student_is_active_in_cohort` gate stands first, as in start_assignment."""
    assert _error(_db(), active=False)[0] == 404


def test_hidden_assignment_is_404():
    assert _error(_db(status="draft"))[0] == 404


def test_still_open_is_409():
    assert _error(_db(due=FUTURE)) == (409, "assignment_still_open")
    assert _error(_db(due=None)) == (409, "assignment_still_open")


@pytest.mark.parametrize("skill", ["course", "vocab", "grammar"])
def test_skill_without_self_practice_is_422(skill):
    assert _error(_db(skill)) == (422, "self_practice_unsupported")


def test_writing_before_g08_is_422_unsupported():
    assert _error(_db(), item_id="w-1") == (422, "self_practice_unsupported")


def test_assigned_practice_only_paper_is_not_borrowed():
    """The give opened a non-public paper through delivery_mode=assigned_practice;
    self-practice must not."""
    db = _db("listening", cfg={"delivery_mode": "assigned_practice"},
             papers=[_listening(is_public=False, exam_only=True, public_practice_enabled=False)])
    assert _error(db) == (422, "self_practice_paper_unavailable")


@pytest.mark.parametrize("over", [
    {"exam_only": True, "is_public": False, "public_practice_enabled": False},  # exam only
    {"is_public": False},                                                       # held / not public
    {"status": "draft"},                                                        # unpublished
    {"full_audio_storage_path": None},                                          # no audio
])
def test_listening_paper_not_open_is_422(over):
    assert _error(_db("listening", papers=[_listening(**over)])) == (422, "self_practice_paper_unavailable")


def test_reading_paper_without_public_code_is_422():
    assert _error(_db("reading", papers=[_reading(test_id=None)])) == (422, "self_practice_paper_unavailable")


def test_speaking_topic_not_in_active_library_is_422():
    db = _db("speaking", topics=[{"id": "T1", "title": "Hometown", "part": 1, "is_active": False}])
    assert _error(db) == (422, "self_practice_paper_unavailable")


def test_archived_class_still_allows_self_practice():
    """No archive gate: an archived class only reviews and self-practises."""
    db = _db("listening")
    db.tables["class_assignments"][0]["cohort_archived_at"] = PAST
    assert _call(db)["skill"] == "listening"


# ── read API flag (shares the rule) ──────────────────────────────────────────


def _row(item_id, skill, *, due=PAST, assignment_id="a1"):
    return {"item_id": item_id, "state": "assigned", "submitted_at": None,
            "course_action": None, "is_missing": True,
            "assignment": {"id": assignment_id, "skill": skill, "due_at": due,
                           "content_config": {}}}


def test_paper_open_flags_only_open_papers_in_one_read_per_skill():
    db = _DB({
        "class_assignments": [
            {"id": "a1", "skill": "listening", "content_id": "L1"},
            {"id": "a2", "skill": "listening", "content_id": "L2"},
            {"id": "a3", "skill": "reading", "content_id": "R1"},
        ],
        "listening_public_practice_catalog": [_listening("L1"), _listening("L2", exam_only=True, is_public=False)],
        "reading_public_practice_catalog": [_reading("R1")],
        "topics": [],
    })
    rows = [_row("i1", "listening"), _row("i2", "listening", assignment_id="a2"),
            _row("i3", "reading", assignment_id="a3"), _row("i4", "writing", assignment_id="w")]
    assert csp.paper_open_for_self_practice(db, rows, now=NOW) == {"i1", "i3"}
    assert db.reads.count("listening_public_practice_catalog") == 1
    assert db.writes == []


def test_read_api_marks_self_practice_and_matches_the_route(monkeypatch):
    db = _db("listening")
    rows = [_row("item-1", "listening")]
    monkeypatch.setattr(st, "_visible_assignments_for", lambda *_a: (True, rows, False))
    monkeypatch.setattr("database.supabase_admin", db)
    item = sa.get_assigned("u-1", "A", NOW)["items"][0]
    assert item["self_practice_available"] is True
    assert item["action"] == "self_practice"
    assert _call(db)["skill"] == "listening"


def test_read_api_hides_self_practice_when_the_route_would_refuse(monkeypatch):
    db = _db("listening", papers=[_listening(exam_only=True, is_public=False)])
    rows = [_row("item-1", "listening")]
    monkeypatch.setattr(st, "_visible_assignments_for", lambda *_a: (True, rows, False))
    monkeypatch.setattr("database.supabase_admin", db)
    item = sa.get_assigned("u-1", "A", NOW)["items"][0]
    assert item["self_practice_available"] is False
    assert item["action"] == "none"
    assert _error(db) == (422, "self_practice_paper_unavailable")


def test_read_api_course_and_writing_never_self_practice(monkeypatch):
    rows = [_row("c", "course"), _row("w", "writing")]
    rows[1]["state"] = "submitted"  # a closed writing give that no longer accepts
    monkeypatch.setattr(st, "_visible_assignments_for", lambda *_a: (True, rows, False))
    monkeypatch.setattr("database.supabase_admin", _DB({"class_assignments": []}))
    for item in sa.get_assigned("u-1", "A", NOW)["items"]:
        assert item["self_practice_available"] is False


def test_read_api_paper_read_failure_hides_the_button(monkeypatch):
    class _Boom:
        def table(self, _name):
            raise RuntimeError("db down")
    rows = [_row("item-1", "listening")]
    monkeypatch.setattr(st, "_visible_assignments_for", lambda *_a: (True, rows, False))
    monkeypatch.setattr("database.supabase_admin", _Boom())
    out = sa.get_assigned("u-1", "A", NOW)
    assert out["items"][0]["self_practice_available"] is False
    assert out["degraded"] == []


# ── HTTP route ────────────────────────────────────────────────────────────────


@pytest.fixture
def api(monkeypatch):
    from fastapi.testclient import TestClient
    import main
    from routers import class_student

    async def _user(_authorization):
        return {"id": "u-1", "email": "a@x.test", "user_metadata": {}}

    async def _true(*_a, **_k):
        return True

    monkeypatch.setattr(class_student, "get_supabase_user", _user)
    monkeypatch.setattr(class_student, "_student_for_user", lambda *_a: STUDENT)
    from services import activation_gate
    monkeypatch.setattr(activation_gate, "aaccount_is_active", _true)
    return TestClient(main.app, raise_server_exceptions=False), class_student


def test_route_200_private_and_no_writes(monkeypatch, api):
    client, class_student = api
    db = _db("listening")
    monkeypatch.setattr(class_student, "supabase_admin", db)
    with patch("services.class_membership_service.student_is_active_in_cohort", return_value=True):
        res = client.post("/api/class/assignments/item-1/self-practice",
                          headers={"Authorization": "Bearer x"})
    assert res.status_code == 200, res.text
    assert res.json() == {"skill": "listening",
                          "launch": {"href": "/core-player/launch?surface=listening_test&id=L1"}}
    assert res.headers["cache-control"] == "private, no-store"
    assert db.writes == []


def test_route_errors_keep_their_codes(monkeypatch, api):
    client, class_student = api
    monkeypatch.setattr(class_student, "supabase_admin", _db("listening", due=FUTURE))
    with patch("services.class_membership_service.student_is_active_in_cohort", return_value=True):
        res = client.post("/api/class/assignments/item-1/self-practice",
                          headers={"Authorization": "Bearer x"})
    assert res.status_code == 409
    assert res.json()["detail"]["error"] == "assignment_still_open"
    assert res.headers["cache-control"] == "private, no-store"


def test_a_session_made_from_the_speaking_launch_never_touches_the_ledger():
    """Completing a session built from the launch runs the existing completion
    hook, which records a class hand-in only for a session that carries
    `class_assignment_item_id`. The launch never carries one, so the item's
    state cannot change."""
    from routers import sessions

    params = _call(_db("speaking", cfg={"mode": "practice", "part": 1, "topic": "Hometown"}))[
        "launch"]["session_params"]
    session = {"id": "sess-1", "user_id": "u-1", "status": "completed",
               "completed_at": NOW.isoformat(), **params}
    db = _DB({"class_assignment_items": [{"id": "item-1", "state": "assigned",
                                          "submitted_at": None}]})
    with patch.object(sessions, "supabase_admin", db):
        assert sessions._record_class_submission(session) is False
    assert db.writes == [] and db.reads == []
    assert db.tables["class_assignment_items"][0]["state"] == "assigned"


@pytest.mark.parametrize("skill", ["listening", "reading"])
def test_test_launch_carries_no_class_item(skill):
    """The player ties an attempt to homework only through `class_item` in the
    launch query (start_assignment); the self-practice href has none."""
    from urllib.parse import parse_qs, urlparse

    href = _call(_db(skill))["launch"]["href"]
    query = parse_qs(urlparse(href).query)
    assert "class_item" not in query and "class_assignment_item_id" not in query


# ── Review round 1 (Codex P2 on #2580) ───────────────────────────────────────


def _attempt(test_id, *, item="item-old", expires=FUTURE, status="in_progress", user="u-1"):
    return {"id": f"att-{test_id}-{item}", "test_id": test_id, "user_id": user,
            "status": status, "resume_expires_at": expires,
            "class_assignment_item_id": item}


@pytest.mark.parametrize("skill", ["listening", "reading"])
def test_paper_outside_the_canonical_catalog_is_unavailable(skill):
    """A paper the public catalog view leaves out (e.g. a protected mock
    dependency without an overlap approval) is never offered, even though its
    base row is published and public."""
    db = _db(skill, papers=[])
    assert _error(db) == (422, "self_practice_paper_unavailable")
    assert csp.paper_open_for_self_practice(db, [_row("item-1", skill)], "u-1", now=NOW) == set()
    assert "listening_tests" not in db.reads and "reading_tests" not in db.reads


@pytest.mark.parametrize("skill", ["listening", "reading"])
def test_resumable_homework_attempt_on_the_paper_blocks_self_practice(skill):
    paper = {"listening": "L1", "reading": "R1"}[skill]
    db = _db(skill, attempts=[_attempt(paper)])
    assert _error(db) == (409, "homework_attempt_in_progress")
    assert csp.paper_open_for_self_practice(db, [_row("item-1", skill)], "u-1", now=NOW) == set()
    assert db.writes == []


@pytest.mark.parametrize("over", [
    {"expires": PAST},                       # expired: the player will not resume it
    {"item": None},                          # a plain self-practice attempt
    {"status": "completed"},
    {"user": "someone-else"},
])
def test_non_resumable_or_unlinked_attempts_do_not_block(over):
    db = _db("reading", attempts=[_attempt("R1", **over)])
    assert _call(db)["skill"] == "reading"
    assert csp.paper_open_for_self_practice(db, [_row("item-1", "reading")], "u-1", now=NOW) == {"item-1"}


def test_read_api_hides_the_button_while_a_homework_attempt_is_resumable(monkeypatch):
    db = _db("listening", attempts=[_attempt("L1")])
    monkeypatch.setattr(st, "_visible_assignments_for",
                        lambda *_a: (True, [_row("item-1", "listening")], False))
    monkeypatch.setattr("database.supabase_admin", db)
    item = sa.get_assigned("u-1", "A", NOW)["items"][0]
    assert item["self_practice_available"] is False
    assert item["action"] == "none"


def test_attempt_expiry_is_judged_at_the_callers_now_not_the_real_clock():
    """Review 7112015108: the expiry check used the real clock while the rest of
    the call used `now`, so these tests would start failing once the real clock
    passed FUTURE. The attempt expires at FUTURE (NOW + 1 day): it blocks at
    NOW and no longer blocks at NOW + 2 days, whatever the real clock says."""
    later = NOW + timedelta(days=2)
    rows = [_row("item-1", "reading")]
    db = _db("reading", attempts=[_attempt("R1")])
    assert csp.paper_open_for_self_practice(db, rows, "u-1", now=NOW) == set()
    assert csp.paper_open_for_self_practice(db, rows, "u-1", now=later) == {"item-1"}
    # Before the fix the second call read the real clock: it still blocked
    # until the real clock passed FUTURE, and every call blocked after it.
    assert csp.papers_with_homework_attempt(db, "u-1", "reading", ["R1"], now=NOW) == {"R1"}
    assert csp.papers_with_homework_attempt(db, "u-1", "reading", ["R1"], now=later) == set()
