"""LEARNERCORE-0063 amendment 4 (G07-T31): review notes and one flag per question.

Behaviour against an in-memory table that applies the filters each route sends
and enforces the two uniques migration 421 adds, so a racing duplicate flag
reaches the index backstop instead of a mocked branch:

* ``GET/PATCH /api/review-notes`` (FR-106/FR-107): save, edit, delete with an
  empty body, 500 vs 501 characters, other user's attempt, unknown attempt,
  question outside the test, sign-in required, a note seen again on a new
  attempt of the same test, only the caller's notes.
* ``POST /api/feedback`` (FR-108): a second flag on the same attempt and
  question is 409 ``already_flagged`` and adds no row; other question or
  attempt still saves; the unique-index race answers the same 409; anonymous
  Reading takers by ``anon_id``; reports and ratings keep their rules.
* ``my_flagged_q_nums`` (FR-109): only the caller's flags on that attempt.
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from routers import feedback as F
from routers import review_notes as RN
from services import review_notes as svc

USER = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
A1 = "33333333-3333-4333-8333-333333333331"
A2 = "33333333-3333-4333-8333-333333333332"
A_OTHER = "33333333-3333-4333-8333-333333333339"
A_ANON = "33333333-3333-4333-8333-33333333333a"
TEST = "44444444-4444-4444-8444-444444444444"
GRADED = [{"q_num": q, "correct": q % 2 == 0} for q in range(1, 41)]


class _UniqueViolation(Exception):
    pass


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.op, self.payload = db, table, "select", None
        self.filters, self.limit_n, self.on_conflict = [], None, None

    def select(self, *_a, **_k):
        return self

    def insert(self, row):
        self.op, self.payload = "insert", row
        return self

    def upsert(self, row, on_conflict=None):
        self.op, self.payload, self.on_conflict = "upsert", row, on_conflict
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, col, val):
        self.filters.append((col, val))
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def _match(self, row):
        return all(row.get(c) == v for c, v in self.filters)

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        self.db.ops.append((self.table, self.op))
        result = type("R", (), {})()
        if self.op == "select":
            found = [copy.deepcopy(r) for r in rows if self._match(r)]
            result.data = found[: self.limit_n] if self.limit_n else found
        elif self.op == "insert":
            self.db.check_unique(self.table, self.payload)
            rows.append(copy.deepcopy(self.payload))
            result.data = [copy.deepcopy(self.payload)]
        elif self.op == "upsert":
            keys = self.on_conflict.split(",")
            hit = [r for r in rows if all(r.get(k) == self.payload[k] for k in keys)]
            if hit:
                hit[0].update(self.payload)
                result.data = [copy.deepcopy(hit[0])]
            else:
                row = {"id": str(uuid.uuid4()), **self.payload}
                rows.append(row)
                result.data = [copy.deepcopy(row)]
        else:
            keep = [r for r in rows if not self._match(r)]
            result.data = [r for r in rows if self._match(r)]
            self.db.tables[self.table] = keep
        return result


class _DB:
    def __init__(self):
        self.ops = []
        self.tables = {
            "listening_test_attempts": [
                {"id": A1, "user_id": USER, "test_id": TEST, "grading_details": GRADED},
                {"id": A2, "user_id": USER, "test_id": TEST, "grading_details": GRADED},
                {"id": A_OTHER, "user_id": OTHER, "test_id": TEST, "grading_details": GRADED},
            ],
            "reading_test_attempts": [
                {"id": A_ANON, "user_id": None, "anon_id": "anon-secret", "test_id": TEST,
                 "grading_details": GRADED},
                {"id": A1, "user_id": USER, "anon_id": None, "test_id": TEST, "grading_details": GRADED},
            ],
            "listening_tests": [{"id": TEST, "test_id": "ILT-1"}],
            "reading_tests": [{"id": TEST, "test_id": "IRT-1"}],
            "review_notes": [],
            "user_feedback": [],
        }
        self.skip_flag_precheck = False

    def table(self, name):
        if name == "user_feedback" and self.skip_flag_precheck:
            self.skip_flag_precheck = False
            return _EmptySelect(self, name)
        return _Q(self, name)

    def check_unique(self, table, row):
        if table != "user_feedback" or row.get("type") != "flag" or not row.get("attempt_id"):
            return
        q = row.get("q_num") if row.get("q_num") is not None else -1
        for ident, index in (("created_by", "uq_feedback_flag_user"), ("anon_id", "uq_feedback_flag_anon")):
            if row.get(ident) is None:
                continue
            for other in self.tables["user_feedback"]:
                other_q = other.get("q_num") if other.get("q_num") is not None else -1
                if (other.get("type") == "flag" and other.get("attempt_id") == row["attempt_id"]
                        and other_q == q and other.get(ident) == row[ident]):
                    raise _UniqueViolation(
                        f'duplicate key value violates unique constraint "{index}" (23505)')


class _EmptySelect(_Q):
    """The pre-check misses (a second request raced past it)."""

    def execute(self):
        result = type("R", (), {})()
        result.data = []
        return result


@pytest.fixture
def db(monkeypatch):
    database = _DB()

    async def auth(authorization):
        if authorization == "Bearer user":
            return {"id": USER}
        if authorization == "Bearer other":
            return {"id": OTHER}
        raise HTTPException(401, "Missing or invalid Authorization header")

    monkeypatch.setattr(RN, "supabase_admin", database)
    monkeypatch.setattr(F, "supabase_admin", database)
    monkeypatch.setattr(RN, "get_supabase_user", auth)
    monkeypatch.setattr(F, "get_supabase_user", auth)
    from services import listening_blackeye
    monkeypatch.setattr(listening_blackeye, "guard_generic_target", lambda *a, **k: None)
    return database


def _put(skill="listening", attempt_id=A1, q_num=3, body="Nghe nhầm 'fifteen'", auth="Bearer user"):
    from starlette.responses import Response
    payload = RN.ReviewNoteIn(skill=skill, attempt_id=attempt_id, q_num=q_num, body=body)
    return asyncio.run(RN.save_review_note(payload, Response(), authorization=auth))


def _get(skill="listening", attempt_id=A1, auth="Bearer user"):
    from starlette.responses import Response
    return asyncio.run(RN.list_review_notes(Response(), skill=skill, attempt_id=uuid.UUID(attempt_id),
                                            authorization=auth))


def _error(exc):
    return exc.value.status_code, exc.value.detail


# ── review notes ──────────────────────────────────────────────────────────


def test_save_edit_and_delete_with_an_empty_body(db):
    saved = _put(body="  Nghe nhầm 'fifteen'  ")
    assert saved["q_num"] == 3 and saved["body"] == "Nghe nhầm 'fifteen'" and saved["updated_at"]
    assert _get()["notes"] == [{"q_num": 3, "body": "Nghe nhầm 'fifteen'", "updated_at": saved["updated_at"]}]
    edited = _put(body="fifteen, không phải fifty")
    assert edited["body"] == "fifteen, không phải fifty"
    assert len(db.tables["review_notes"]) == 1
    assert _put(body="   ") == {"q_num": 3, "body": None, "updated_at": None}
    assert _get()["notes"] == [] and db.tables["review_notes"] == []


def test_five_hundred_characters_save_and_five_hundred_one_are_refused(db):
    assert _put(body="é" * 500)["body"] == "é" * 500
    with pytest.raises(HTTPException) as exc:
        _put(body="é" * 501)
    assert _error(exc) == (422, {"error": "note_too_long", "message": "Ghi chú tối đa 500 ký tự."})
    assert db.tables["review_notes"][0]["body"] == "é" * 500


def test_another_users_attempt_is_403_and_unknown_attempt_404(db):
    with pytest.raises(HTTPException) as exc:
        _put(attempt_id=A_OTHER)
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        _get(attempt_id=str(uuid.uuid4()))
    assert exc.value.status_code == 404
    assert db.tables["review_notes"] == []


def test_question_outside_the_test_is_422(db):
    with pytest.raises(HTTPException) as exc:
        _put(q_num=41)
    assert _error(exc)[0] == 422 and _error(exc)[1]["error"] == "q_num_invalid"


def test_sign_in_is_required_and_an_anonymous_attempt_has_no_notes(db):
    with pytest.raises(HTTPException) as exc:
        _put(auth=None)
    assert exc.value.status_code == 401
    with pytest.raises(HTTPException) as exc:
        _get(skill="reading", attempt_id=A_ANON, auth=None)
    assert exc.value.status_code == 401
    with pytest.raises(HTTPException) as exc:
        _put(skill="reading", attempt_id=A_ANON)
    assert exc.value.status_code == 403


def test_a_note_shows_again_on_a_new_attempt_of_the_same_test(db):
    _put(attempt_id=A1, q_num=7, body="đọc lại câu hỏi")
    assert [n["q_num"] for n in _get(attempt_id=A2)["notes"]] == [7]
    assert db.tables["review_notes"][0]["test_uuid"] == TEST


def test_only_the_callers_notes_are_listed_and_skills_stay_apart(db):
    _put(q_num=5, body="của tôi")
    db.tables["review_notes"].append({"user_id": OTHER, "skill": "listening", "test_uuid": TEST,
                                      "q_num": 6, "body": "của người khác", "updated_at": "x"})
    db.tables["review_notes"].append({"user_id": USER, "skill": "reading", "test_uuid": TEST,
                                      "q_num": 8, "body": "reading", "updated_at": "x"})
    assert [n["q_num"] for n in _get()["notes"]] == [5]


def test_the_routes_are_registered_behind_the_activation_gate():
    from main import _ACTIVE_LEARNER, app
    routes = {(r.path, m): r for r in app.routes for m in getattr(r, "methods", ())
              if getattr(r, "path", "") == "/api/review-notes"}
    assert set(routes) == {("/api/review-notes", "GET"), ("/api/review-notes", "PATCH")}
    for route in routes.values():
        assert {d.dependency for d in _ACTIVE_LEARNER} <= {d.call for d in route.dependant.dependencies}
    client = TestClient(app)
    assert client.get(f"/api/review-notes?skill=listening&attempt_id={A1}").status_code == 401


def test_the_save_verb_passes_the_cors_preflight():
    """FR-107 names PUT, but PUT is not in the CORS allowlist (test_cors_hardening):
    the browser would refuse the preflight and the note would never be sent."""
    import main as app_main
    verbs = {m for r in RN.router.routes for m in getattr(r, "methods", set())}
    assert verbs <= set(app_main._CORS_METHODS) and "PATCH" in verbs and "PUT" not in verbs


def test_note_bodies_are_never_logged():
    src = inspect.getsource(RN)
    assert "logger" not in src and "logging" not in src and "print(" not in src
    # The service logs only the exception type of a failed flag read.
    calls = [line.strip() for line in inspect.getsource(svc).splitlines() if "logger." in line]
    assert calls == ['logger.warning("[review_notes] my_flagged_q_nums read failed: %s", type(exc).__name__)']
    assert "print(" not in inspect.getsource(svc)


# ── flag once per (attempt, question, sender) ─────────────────────────────


def _flag(attempt_id=A1, q_num=3, skill="listening", auth="Bearer user", anon=None, kind="flag", **extra):
    body = F.FeedbackIn(type=kind, skill=skill, attempt_id=attempt_id, q_num=q_num, **extra)
    return asyncio.run(F.submit_feedback(body, authorization=auth, x_reading_anon=anon))


def _flags():
    return [r for r in F.supabase_admin.tables["user_feedback"] if r["type"] == "flag"]


def test_a_second_flag_on_the_same_question_is_409_and_adds_no_row(db):
    assert _flag()["status"] == "new"
    with pytest.raises(HTTPException) as exc:
        _flag()
    assert _error(exc) == (409, {"error": "already_flagged", "message": "Bạn đã báo lỗi câu này."})
    assert len(_flags()) == 1


def test_another_question_or_attempt_still_saves(db):
    _flag(q_num=3)
    _flag(q_num=4)
    _flag(attempt_id=A2, q_num=3)
    assert sorted((r["attempt_id"], r["q_num"]) for r in _flags()) == [(A1, 3), (A1, 4), (A2, 3)]


def test_a_racing_duplicate_hits_the_index_and_gets_the_same_409(db):
    _flag()
    db.skip_flag_precheck = True
    with pytest.raises(HTTPException) as exc:
        _flag()
    assert _error(exc)[0] == 409 and _error(exc)[1]["error"] == "already_flagged"
    assert len(_flags()) == 1


def test_anonymous_reading_taker_is_limited_by_anon_id(db):
    _flag(skill="reading", attempt_id=A_ANON, auth=None, anon="anon-secret")
    with pytest.raises(HTTPException) as exc:
        _flag(skill="reading", attempt_id=A_ANON, auth=None, anon="anon-secret")
    assert _error(exc)[1]["error"] == "already_flagged"
    (row,) = _flags()
    assert row["anon_id"] == "anon-secret" and row["created_by"] is None


def test_reports_stay_uncapped_and_rating_keeps_its_own_409(db):
    _flag(kind="report", category="wrong_answer")
    _flag(kind="report", category="wrong_answer")
    reports = [r for r in db.tables["user_feedback"] if r["type"] == "report"]
    assert len(reports) == 2
    _flag(kind="rating", q_num=None, rating_de=4)
    with pytest.raises(HTTPException) as exc:
        _flag(kind="rating", q_num=None, rating_de=5)
    assert _error(exc) == (409, "Bạn đã đánh giá đề này rồi.")


# ── my_flagged_q_nums ─────────────────────────────────────────────────────


def test_my_flagged_q_nums_lists_only_the_callers_flags_on_that_attempt(db):
    db.tables["user_feedback"] += [
        {"type": "flag", "attempt_id": A1, "q_num": 9, "created_by": USER},
        {"type": "flag", "attempt_id": A1, "q_num": 2, "created_by": USER},
        {"type": "flag", "attempt_id": A1, "q_num": None, "created_by": USER},
        {"type": "report", "attempt_id": A1, "q_num": 5, "created_by": USER},
        {"type": "flag", "attempt_id": A1, "q_num": 4, "created_by": OTHER},
        {"type": "flag", "attempt_id": A2, "q_num": 6, "created_by": USER},
        {"type": "flag", "attempt_id": A_ANON, "q_num": 1, "anon_id": "anon-secret"},
    ]
    assert svc.my_flagged_q_nums(db, attempt_id=A1, user_id=USER) == [2, 9]
    assert svc.my_flagged_q_nums(db, attempt_id=A_ANON, anon_id="anon-secret") == [1]
    assert svc.my_flagged_q_nums(db, attempt_id=A1) == []


def test_my_flagged_q_nums_read_failure_degrades_to_empty(caplog):
    class _Broken:
        def table(self, _name):
            raise RuntimeError("db down")

    with caplog.at_level("WARNING"):
        assert svc.my_flagged_q_nums(_Broken(), attempt_id=A1, user_id=USER) == []
    assert "my_flagged_q_nums read failed" in caplog.text


def test_review_notes_responses_are_private_and_the_payload_is_bounded(db, monkeypatch):
    from fastapi.testclient import TestClient
    from main import app
    from main import require_active_learner

    app.dependency_overrides[require_active_learner] = lambda: None
    try:
        client = TestClient(app)
        headers = {"Authorization": "Bearer user"}
        got = client.get(f"/api/review-notes?skill=listening&attempt_id={A1}", headers=headers)
        assert got.status_code == 200 and got.headers["cache-control"] == "private, no-store"
        put = client.patch("/api/review-notes", headers=headers,
                         json={"skill": "listening", "attempt_id": A1, "q_num": 3, "body": "ok"})
        assert put.status_code == 200 and put.headers["cache-control"] == "private, no-store"
        assert put.json()["body"] == "ok"
        huge = client.patch("/api/review-notes", headers=headers,
                          json={"skill": "listening", "attempt_id": A1, "q_num": 3, "body": "x" * 10_001})
        assert huge.status_code == 422
    finally:
        app.dependency_overrides.pop(require_active_learner, None)


def test_both_review_routes_return_my_flagged_q_nums():
    import routers.listening as L
    import routers.reading_student as R
    from models.listening_programmes import ListeningAttemptReviewResponse
    for fn in (L.get_listening_test_attempt_review, R.review_reading_test_attempt):
        src = inspect.getsource(fn)
        assert 'review["my_flagged_q_nums"] = await asyncio.to_thread(' in src, fn.__name__
        assert "my_flagged_q_nums, supabase_admin, attempt_id=attempt_id" in src, fn.__name__
    assert ListeningAttemptReviewResponse().my_flagged_q_nums == []
