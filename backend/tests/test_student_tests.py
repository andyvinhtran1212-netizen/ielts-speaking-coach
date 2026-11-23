"""LEARNERCORE-0063 T16 (amendment 1): GET /api/student/tests.

The result sources run on a small in-memory fake Supabase that understands the
filters the service uses; the mock-exam helpers of `mock_exam_service` and the
G04 credits join point are monkeypatched.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest

from services import mock_exam_service as ms
from services import student_tests as stt

T0 = datetime(2026, 11, 23, 3, 0, tzinfo=timezone.utc)
ME, OTHER = "u-me", "u-other"


def _at(minutes: int) -> str:
    return (T0 - timedelta(minutes=minutes)).isoformat()


def _ts(value):
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


class _Res:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.filters = db, table, []
        self.n, self.order_by, self.negate = None, None, False

    def _add(self, fn):
        if self.negate:
            self.negate = False
            self.filters.append(lambda r, fn=fn: not fn(r))
        else:
            self.filters.append(fn)
        return self

    @property
    def not_(self):
        self.negate = True
        return self

    def select(self, *_a, **_k):
        return self

    def eq(self, f, v):
        return self._add(lambda r: str(r.get(f)) == str(v))

    def in_(self, f, vs):
        vs = {str(v) for v in vs}
        return self._add(lambda r: str(r.get(f)) in vs)

    def is_(self, f, v):
        assert v == "null"
        return self._add(lambda r: r.get(f) is None)

    def lte(self, f, v):
        return self._add(lambda r: r.get(f) is not None and _ts(r[f]) <= _ts(v))

    def order(self, f, desc=False):
        self.order_by = (f, desc)
        return self

    def limit(self, n):
        self.n = n
        return self

    def execute(self):
        if self.table in self.db.broken:
            raise RuntimeError("boom")
        rows = [dict(r) for r in self.db.tables.get(self.table, []) if all(f(r) for f in self.filters)]
        self.db.reads.append((self.table, [r.get("id") or r.get("sitting_id") for r in rows]))
        if self.order_by:
            f, desc = self.order_by
            rows.sort(key=lambda r: _ts(r[f]), reverse=desc)
        return _Res(rows[: self.n] if self.n else rows)


class _DB:
    def __init__(self, tables=None, broken=()):
        self.tables, self.broken, self.reads = tables or {}, set(broken), []

    def table(self, name):
        return _Q(self, name)


def _attempt(aid, test_id, minutes, *, user=ME, score=None, band=None, scored=None, **extra):
    row = {"id": aid, "test_id": test_id, "user_id": user, "status": "submitted",
           "submitted_at": _at(minutes), "score": score, "band_estimate": band,
           "sitting_id": None, "class_assignment_item_id": None, "scoring_policy": None,
           "grading_details": [{"q": i} for i in range(scored or 0)]}
    row.update(extra)
    return row


def _session(sid, part, attempt, minutes, *, band=6.0, status="completed", **extra):
    row = {"id": sid, "user_id": ME, "mode": "test_full", "part": part, "status": status,
           "overall_band": band, "full_test_attempt_id": attempt, "completed_at": _at(minutes),
           "sitting_id": None, "class_assignment_item_id": None}
    row.update(extra)
    return row


def _sitting(sid, exam, status, minutes, **extra):
    row = {"id": sid, "mock_exam_id": exam, "user_id": ME, "status": status, "created_at": _at(minutes + 200),
           "assigned_skills": None, "listening_submitted_at": None, "reading_submitted_at": None,
           "writing_submitted_at": _at(minutes), "speaking_completed_at": None}
    row.update(extra)
    return row


def _results(db, cursor=None):
    return stt.build_results(db, ME, stt.decode_cursor(cursor))


# ── Listening / Reading ───────────────────────────────────────────────────────


def test_listening_full_band_only_with_40_scored_and_mini_counts():
    db = _DB({
        "listening_tests": [
            {"id": "lt-full", "title": "Cam 18 Test 1", "test_type": "full"},
            {"id": "lt-mini", "title": "Mini 3", "test_type": "mini"},
            {"id": "lt-drill", "title": "Drill", "test_type": "drill"},
        ],
        "listening_test_attempts": [
            _attempt("a1", "lt-full", 1, score=35, band=8.0, scored=40),
            _attempt("a2", "lt-full", 2, score=30, band=7.0, scored=39),
            _attempt("a3", "lt-mini", 3, score=7, scored=10),
            _attempt("a4", "lt-drill", 4, score=5, scored=5),
            _attempt("a5", "lt-full", 5, score=20, band=6.0, scored=40, scoring_policy="report_only"),
            _attempt("a6", "lt-full", 6, score=20, band=6.0, scored=40, sitting_id="s-1"),
            _attempt("a7", "lt-full", 7, score=20, band=6.0, scored=40, class_assignment_item_id="ci"),
            _attempt("a8", "lt-full", 8, score=20, band=6.0, scored=40, user=OTHER),
            _attempt("a9", "lt-full", 9, score=20, band=6.0, scored=40, status="in_progress"),
        ],
    })
    rows = _results(db)["results"]
    assert [(r["id"], r["kind"]) for r in rows] == [
        ("a1", "listening_full"), ("a2", "listening_full"), ("a3", "listening_mini")]
    assert rows[0]["band"] == 8.0 and rows[0]["href"] == "/listening/review?attempt_id=a1"
    assert rows[1]["band"] is None  # 39 scored questions: not a 40-question band
    assert (rows[2]["correct"], rows[2]["total"], rows[2]["band"]) == (7, 10, None)
    assert all(r["overall"] is None and r["state"] is None for r in rows)


def test_reading_full_band_needs_a_40_question_paper_and_mini_needs_a_total():
    db = _DB({
        "reading_tests": [
            {"id": "rt-full", "title": "Reading Full", "test_type": "full", "total_questions": 40},
            {"id": "rt-short", "title": "Reading Short", "test_type": "full", "total_questions": 26},
            {"id": "rt-mini", "title": "Reading Mini", "test_type": "mini", "total_questions": 13},
            {"id": "rt-empty", "title": "Reading Mini 0", "test_type": "mini", "total_questions": 0},
        ],
        "reading_test_attempts": [
            _attempt("r1", "rt-full", 1, score=33, band=7.5),
            _attempt("r2", "rt-short", 2, score=20, band=7.0),
            _attempt("r3", "rt-mini", 3, score=9),
            _attempt("r4", "rt-empty", 4, score=0),
        ],
    })
    rows = {r["id"]: r for r in _results(db)["results"]}
    assert rows["r1"]["band"] == 7.5 and rows["r1"]["href"] == "/reading/review?attempt_id=r1"
    assert rows["r2"]["band"] is None
    assert (rows["r3"]["kind"], rows["r3"]["correct"], rows["r3"]["total"]) == ("reading_mini", 9, 13)
    assert (rows["r4"]["correct"], rows["r4"]["total"]) == (None, None)  # never "0 trên 0"


# ── Speaking Full Test ────────────────────────────────────────────────────────


def test_speaking_full_test_is_one_row_with_the_rounded_mean_of_three_parts():
    db = _DB({"sessions": [
        _session("p1", 1, "ft-1", 30, band=6.0), _session("p2", 2, "ft-1", 20, band=6.5),
        _session("p3", 3, "ft-1", 10, band=7.0),
        _session("q1", 1, "ft-2", 60, band=6.0), _session("q2", 2, "ft-2", 55, band=None,
                                                          status="analysis_failed"),
        _session("q3", 3, "ft-2", 50, band=6.0),
        _session("x3", 3, "ft-3", 70),  # pre-identity row: no Part 1 to open
        _session("m3", 3, "ft-4", 80, sitting_id="s-1"),  # a mock section
    ]})
    rows = _results(db)["results"]
    assert [r["id"] for r in rows] == ["p1", "q1"]
    assert rows[0]["kind"] == "speaking_full" and rows[0]["band"] == 6.5
    assert rows[0]["href"] == "/full-test-result?session_id=p1"
    assert rows[0]["submitted_at"].startswith("2026-11-23T02:50")
    assert rows[1]["band"] is None  # a Part not completed: still grading, no band


# ── Mock sittings: release lock and Overall ───────────────────────────────────


@pytest.fixture
def mock_skills(monkeypatch):
    skills = {}
    monkeypatch.setattr(ms, "sitting_skills",
                        lambda s, fb=None: skills.get(s.get("mock_exam_id"), list(stt._BAND_SKILLS)))
    return skills


def test_unreleased_sittings_carry_no_score_even_when_the_review_has_one(mock_skills):
    full = {"listening": 7.0, "reading": 7.0, "writing": 6.5, "speaking": 6.5, "overall": 7.0}
    db = _DB({
        "mock_exams": [{"id": "e1", "title": "Mock tháng 11"}],
        "mock_exam_sittings": [
            _sitting("s1", "e1", "lrw_submitted", 1), _sitting("s2", "e1", "all_submitted", 2),
            _sitting("s3", "e1", "reviewed", 3), _sitting("s4", "e1", "lrw_in_progress", 4),
            _sitting("s5", "e1", "void", 5),
        ],
        "mock_exam_reviews": [{"sitting_id": s, "final_bands": full} for s in ("s1", "s2", "s3")],
    })
    rows = _results(db)["results"]
    assert [(r["id"], r["state"]) for r in rows] == [
        ("s1", "submitted"), ("s2", "grading"), ("s3", "reviewing")]
    for r in rows:
        assert (r["band"], r["overall"], r["pending_skills"], r["correct"]) == (None, None, None, None)
        assert r["href"] == f"/mock/result?sitting={r['id']}"
    assert "6.5" not in json.dumps(rows) and "7.0" not in json.dumps(rows)
    assert not any(t == "mock_exam_reviews" for t, _ in db.reads)  # never read before release


def test_released_overall_only_with_four_banded_skills(mock_skills, monkeypatch):
    monkeypatch.setattr(ms.settings, "MOCK_OVERALL_MIN_SKILLS", 1)  # the four-skill rule still wins
    mock_skills.update({"e3": ["listening", "reading", "writing"]})
    four = {"listening": 7.0, "reading": 7.5, "writing": 6.5, "speaking": 6.0, "overall": 7.0}
    db = _DB({
        "mock_exams": [{"id": e, "title": f"Mock {e}"} for e in ("e1", "e2", "e3")],
        "mock_exam_sittings": [_sitting("s1", "e1", "released", 1), _sitting("s2", "e2", "released", 2),
                               _sitting("s3", "e3", "released", 3)],
        "mock_exam_reviews": [
            {"sitting_id": "s1", "final_bands": four},
            {"sitting_id": "s2", "final_bands": {**four, "speaking": None}},
            {"sitting_id": "s3", "final_bands": {"listening": 7.0, "reading": 7.0, "writing": 6.0,
                                                 "overall": 6.5}},
        ],
    })
    rows = {r["id"]: r for r in _results(db)["results"]}
    assert (rows["s1"]["state"], rows["s1"]["overall"], rows["s1"]["pending_skills"]) == ("released", 7.0, [])
    assert (rows["s2"]["overall"], rows["s2"]["pending_skills"]) == (None, ["speaking"])
    assert (rows["s3"]["overall"], rows["s3"]["pending_skills"]) == (None, [])  # three skills: no Overall
    assert all(r["band"] is None for r in rows.values())


# ── ordering and paging ───────────────────────────────────────────────────────


def _many(n):
    tests = [{"id": "lt", "title": "L", "test_type": "full"}]
    attempts = [_attempt(f"a{i:02d}", "lt", i, band=6.0, scored=40) for i in range(n)]
    # two rows that tie on submitted_at with a mini Reading attempt
    attempts.append(_attempt("tie-l", "lt", 19, band=6.0, scored=40))
    return _DB({"listening_tests": tests, "listening_test_attempts": attempts,
                "reading_tests": [{"id": "rt", "title": "R", "test_type": "mini", "total_questions": 5}],
                "reading_test_attempts": [_attempt("tie-r", "rt", 19, score=3)]})


def test_pages_of_twenty_newest_first_with_an_opaque_cursor_and_no_overlap():
    db = _many(25)
    first = _results(db)
    assert len(first["results"]) == 20 and first["results_next_cursor"]
    stamps = [(r["submitted_at"], r["kind"], r["id"]) for r in first["results"]]
    assert stamps == sorted(stamps, key=lambda s: (-_ts(s[0]).timestamp(), s[1], s[2]))
    second = _results(db, first["results_next_cursor"])
    assert second["results_next_cursor"] is None
    ids = [r["id"] for r in first["results"]] + [r["id"] for r in second["results"]]
    assert len(ids) == len(set(ids)) == 27  # 25 + both tie rows, each exactly once


def test_a_cursor_that_was_not_issued_is_rejected():
    for bad in ("not-base64!!", stt.encode_cursor(T0, "x", "y")[:-3] + "%%%", "W10"):
        with pytest.raises(stt.BadCursor):
            stt.decode_cursor(bad)
    assert stt.decode_cursor(stt.encode_cursor(T0, "mock", "s1")) == (T0, "mock", "s1")


# ── assigned mock exams ───────────────────────────────────────────────────────


@pytest.fixture
def exams(monkeypatch, mock_skills):
    state = {"open": [], "mine": [], "retake": set(), "cohorts": {"c-mine"}}
    monkeypatch.setattr(ms, "list_open_exams", lambda u: state["open"] if u == ME else [])
    monkeypatch.setattr(ms, "list_my_sittings", lambda u: state["mine"] if u == ME else [])
    monkeypatch.setattr(ms, "_retake_assigned_exam_ids", lambda u: state["retake"])
    monkeypatch.setattr(ms, "_user_in_cohort", lambda u, c: u == ME and c in state["cohorts"])
    return state


def _open(eid, code, *, mine=None, minutes=160):
    return {"id": eid, "code": code, "title": f"Kỳ {code}", "total_minutes": minutes,
            "review_sla_days": 3, "exam_mode": "sequential", "blocked_by_sitting_id": None,
            "my_sitting_id": mine}


def test_assigned_exams_keep_only_real_assignments(exams):
    exams["open"] = [_open("e-class", "CLS"), _open("e-public", "PUB"), _open("e-retake", "RT"),
                     _open("e-mine", "MINE", mine="s-live"), _open("e-done", "DONE")]
    exams["retake"] = {"e-retake"}
    exams["mine"] = [
        {"sitting_id": "s-live", "mock_exam_id": "e-mine", "status": "lrw_in_progress", "title": "Kỳ MINE"},
        {"sitting_id": "s-done", "mock_exam_id": "e-done", "status": "speaking_pending", "title": "Kỳ DONE"},
        {"sitting_id": "s-rel", "mock_exam_id": "e-old", "status": "released", "title": "Kỳ cũ"},
        {"sitting_id": "s-rel-0", "mock_exam_id": "e-old", "status": "released", "title": "Kỳ cũ"},
    ]
    db = _DB({"mock_exams": [
        {"id": "e-class", "cohort_id": "c-mine", "total_minutes": 160},
        {"id": "e-public", "cohort_id": None, "total_minutes": 160},
        {"id": "e-retake", "cohort_id": None, "total_minutes": 60},
        {"id": "e-mine", "cohort_id": None, "total_minutes": 160},
        {"id": "e-done", "cohort_id": "c-mine", "total_minutes": 120},
        {"id": "e-old", "cohort_id": "c-mine", "total_minutes": 90},
    ]})
    rows = stt.build_assigned_exams(db, ME)
    got = [(r["exam_id"], r["state"], r["has_sitting_in_progress"], r["href"]) for r in rows]
    assert got == [
        ("e-class", "open", False, "/mock-exam?code=CLS"),
        ("e-retake", "open", False, "/mock-exam?code=RT"),
        ("e-mine", "open", True, "/mock-exam?sitting=s-live"),
        ("e-done", "submitted", False, "/mock/result?sitting=s-done"),
        ("e-old", "released", False, "/mock/result?sitting=s-rel"),
    ]
    assert all(r["mode"] is None and r["opens_at"] is None for r in rows)
    assert rows[-1]["total_minutes"] == 90 and rows[0]["skills"] == list(stt._BAND_SKILLS)


# ── assembly, degraded, join points ───────────────────────────────────────────


def _run(monkeypatch, db, *, cursor=None, credits=None, assigned=None):
    calls = []
    monkeypatch.setattr(stt, "_credits_for", lambda u: credits(u) if callable(credits) else credits)

    def _assigned(sb, u):
        calls.append(u)
        if isinstance(assigned, Exception):
            raise assigned
        return assigned or []

    monkeypatch.setattr(stt, "build_assigned_exams", _assigned)
    body = asyncio.run(stt.get_tests_concurrent(lambda: db, ME, cursor=cursor))
    return body, calls


def test_empty_learner_is_empty_not_degraded(monkeypatch):
    body, _ = _run(monkeypatch, _DB())
    assert body == {"assigned_exams": [], "results": [], "results_next_cursor": None,
                    "credits": None, "degraded": []}


def test_credits_pass_through_as_total_only(monkeypatch):
    body, _ = _run(monkeypatch, _DB(), credits={"total": 18, "has_source": True})
    assert body["credits"] == {"total": 18}


@pytest.mark.parametrize("part", ["results", "credits", "assigned_exams"])
def test_a_failing_part_is_degraded_alone(monkeypatch, part):
    db = _many(2) if part != "results" else _DB(broken={"listening_test_attempts"})

    def credits(_u):
        if part == "credits":
            raise RuntimeError("g04 down")
        return {"total": 4}

    assigned = RuntimeError("mock down") if part == "assigned_exams" else [{"exam_id": "e"}]
    body, _ = _run(monkeypatch, db, credits=credits, assigned=assigned)
    assert body["degraded"] == [part]
    if part == "results":
        assert body["results"] == [] and body["results_next_cursor"] is None
    else:
        assert body["results"]


def test_a_more_page_carries_results_only(monkeypatch):
    db = _many(25)
    first, calls = _run(monkeypatch, db, assigned=[{"exam_id": "e"}])
    assert calls == [ME] and first["assigned_exams"]
    nxt, calls2 = _run(monkeypatch, db, cursor=first["results_next_cursor"], assigned=[{"exam_id": "e"}])
    assert calls2 == [] and nxt["assigned_exams"] == [] and len(nxt["results"]) == 7


def test_writing_full_tests_join_point_rows_are_merged(monkeypatch):
    row = stt._result("writing_full", "w1", "Writing Full Test", T0, "/writing/result?essay_id=w1")
    monkeypatch.setattr(stt, "_writing_full_tests_for", lambda u, before: [row] if u == ME else [])
    assert [r["kind"] for r in _results(_DB())["results"]] == ["writing_full"]


def test_route_matches_response_model_and_rejects_a_bad_cursor(monkeypatch, mock_skills):
    from fastapi.testclient import TestClient
    import main
    from routers import student_home
    from services import activation_gate

    async def _user(_authorization):
        return {"id": ME, "email": "a@x.test", "user_metadata": {}}

    async def _true(*_a, **_k):
        return True

    db = _DB({"mock_exams": [{"id": "e1", "title": "Mock"}],
              "mock_exam_sittings": [_sitting("s1", "e1", "under_review", 1)]})
    monkeypatch.setattr(student_home, "get_supabase_user", _user)
    monkeypatch.setattr(activation_gate, "aaccount_is_active", _true)
    monkeypatch.setattr(student_home, "thread_supabase_admin", lambda: db)
    monkeypatch.setattr(stt, "build_assigned_exams", lambda sb, u: [{
        "exam_id": "e2", "title": "Kỳ 2", "mode": None, "state": "open", "skills": None,
        "total_minutes": None, "has_sitting_in_progress": False, "href": "/mock-exam?code=K2"}])
    monkeypatch.setattr(stt, "_credits_for", lambda u: None)
    client = TestClient(main.app, raise_server_exceptions=False)
    res = client.get("/api/student/tests", headers={"Authorization": "Bearer x"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["results"][0] == {
        "kind": "mock", "id": "s1", "title": "Mock", "submitted_at": body["results"][0]["submitted_at"],
        "state": "reviewing", "band": None, "correct": None, "total": None, "pending_skills": None,
        "overall": None, "href": "/mock/result?sitting=s1"}
    assert body["assigned_exams"][0]["state"] == "open" and body["credits"] is None
    assert res.headers["cache-control"] == "private, no-store"
    bad = client.get("/api/student/tests?cursor=zzz", headers={"Authorization": "Bearer x"})
    assert bad.status_code == 400
