"""G09-T05 (ADMINIA-0074 FR-075, FR-102): quick search for admins and teachers.

Runs the real service (services/admin_search.py over the T03 directory) and
routes (routers/admin_search.py) over the in-memory stand-in of the T03
tests. All names and addresses are made up; no AI or network call.
"""

from __future__ import annotations

import asyncio
import logging
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from models.admin_search import SearchIn
from routers import admin_search as mod
from services import admin_learner_directory as directory
from services import admin_search, staff_scope, test_data_visibility
from tests.test_admin_learners import C_A, C_B, S_LAN, S_MINH, U_ADMIN, U_LAN, U_MINH, U_TEACH, U_TEACH_B, _as, _DB

EMPTY = {"learners": [], "classes": [], "submissions": []}


@pytest.fixture
def db(monkeypatch):
    fake = _DB()
    fake.rows["cohorts"][0].update(code_prefix="TT19", is_active=True)
    fake.rows["cohorts"][1].update(code_prefix="SS09", is_active=True)
    fake.rows["writing_essays"] = [
        # Lan: one essay given to class A, one practice essay of her own.
        {"id": "e-class", "student_id": S_LAN, "task_type": "task2", "status": "delivered",
         "created_at": "2026-11-10T08:00:00+00:00", "deleted_at": None},
        {"id": "e-practice", "student_id": S_LAN, "task_type": "task1_academic", "status": "graded",
         "created_at": "2026-11-12T08:00:00+00:00", "deleted_at": None},
        {"id": "e-gone", "student_id": S_LAN, "task_type": "task2", "status": "delivered",
         "created_at": "2026-11-13T08:00:00+00:00", "deleted_at": "2026-11-14T08:00:00+00:00"},
        # Minh: work given to class B.
        {"id": "e-minh", "student_id": S_MINH, "task_type": "task2", "status": "pending",
         "created_at": "2026-11-11T08:00:00+00:00", "deleted_at": None},
    ]
    fake.rows["writing_assignments"] = [
        {"id": "w1", "student_id": S_LAN, "cohort_id": C_A, "essay_id": "e-class", "assigned_by": U_TEACH},
        {"id": "w2", "student_id": S_MINH, "cohort_id": C_B, "essay_id": "e-minh", "assigned_by": U_TEACH_B},
        {"id": "w3", "student_id": S_LAN, "cohort_id": C_A, "essay_id": None, "assigned_by": U_TEACH},
    ]
    fake.rows["writing_prompts"] = [{"id": "p1", "title": "Tue–Thu chart: energy use", "task_type": "task1_academic",
                                     "is_active": True}]
    fake.rows["topics"] = [{"id": "t1", "title": "Hometown", "part": 1, "is_active": True}]
    fake.rows["reading_passages"] = [{"id": "r1", "title": "The history of tea", "library": "l2_skill"}]
    fake.rows["listening_tests"] = [{"id": "l1", "title": "Cambridge 18 Test 1", "test_id": "C18-T1"}]
    for module in (directory, admin_search, staff_scope):
        monkeypatch.setattr(module, "supabase_admin", fake)
    monkeypatch.setattr(test_data_visibility, "hide_for", lambda **_k: False)
    monkeypatch.setattr(mod, "require_admin", AsyncMock(return_value={"id": U_ADMIN, "email": "admin@example.test"}))
    return fake


def _admin(q):
    return asyncio.run(mod.search_admin(body=SearchIn(q=q), authorization="Bearer x"))


def _teacher(monkeypatch, db, user_id, q):
    _as(monkeypatch, db, user_id)
    return asyncio.run(mod.search_instructor(body=SearchIn(q=q), authorization="Bearer x"))


def _titles(out, group):
    return [row["title"] for row in out[group]]


def test_admin_finds_each_group_without_accents(db):
    out = _admin("lan")
    assert _titles(out, "learners") == ["Nguyễn Thị Lan"]
    assert out["learners"][0] == {"title": "Nguyễn Thị Lan", "meta": "HV001 · Tue–Thu 19:30",
                                  "href": "/admin/students"}
    # Newest first; a deleted essay is not listed.
    assert [r["href"] for r in out["submissions"]] == ["/admin/writing/grade?essay_id=e-practice",
                                                      "/admin/writing/grade?essay_id=e-class"]
    assert out["submissions"][1]["title"] == "Writing · Task 2 · Nguyễn Thị Lan"
    assert out["orders"] == [] and out["unavailable"] == ["orders"] and out["sources_failed"] == []

    assert _titles(_admin("tue thu"), "classes") == []   # "–" is not a space
    classes = _admin("tue–thu")
    assert classes["classes"] == [{"title": "Tue–Thu 19:30", "meta": "TT19", "href": f"/admin/classes/{C_A}"}]
    assert _titles(classes, "content") == ["Tue–Thu chart: energy use"]
    assert _titles(_admin("ss09"), "classes") == ["Sat–Sun 09:00"]
    assert [r["href"] for r in _admin("tea")["content"]] == ["/admin/reading/content?library=l2_skill"]
    assert [r["href"] for r in _admin("energy")["content"]] == ["/admin/writing/prompts?q=Tue%E2%80%93Thu%20chart%3A%20energy%20use"]
    assert _admin("c18")["content"] == []    # titles only
    assert _admin("cambridge")["content"][0]["meta"] == "Đề Listening · C18-T1"


def test_content_links_open_the_matching_item(db):
    db.rows["topics"].append({"id": "t2", "title": "Describe a hometown festival", "part": 2, "is_active": True})
    hrefs = [r["href"] for r in _admin("hometown")["content"]]
    # Open topics by title: "Describe…" before "Hometown"; each keeps its part.
    assert hrefs == ["/admin/speaking/topics?part=2&topic=t2", "/admin/speaking/topics?part=1&topic=t1"]


def test_the_newest_submissions_come_from_every_matched_learner(db):
    """More matches than any cut-off: the newest essay belongs to the learner
    sorted last by name, and it is still listed first."""
    many = [f"40000000-0000-0000-0000-{i:012d}" for i in range(260)]
    db.rows["students"] += [{"id": sid, "user_id": None, "student_code": f"HV9{i:03d}", "full_name": f"Học viên Lan {i:03d}",
                             "target_band": None, "target_date": None, "archived_at": None, "created_at": "2026-01-01"}
                            for i, sid in enumerate(many)]
    db.rows["writing_essays"].append({"id": "e-last", "student_id": many[-1], "task_type": "task2", "status": "pending",
                                      "created_at": "2026-11-20T08:00:00+00:00", "deleted_at": None})
    out = _admin("lan")
    assert out["submissions"][0]["href"] == "/admin/writing/grade?essay_id=e-last"
    assert len(out["submissions"]) == 3 and out["sources_failed"] == []


def test_every_group_has_at_most_three_rows(db):
    db.rows["cohorts"] += [{"id": f"30000000-0000-0000-0000-0000000000c{i}", "name": f"Lớp tối {i}",
                            "code_prefix": None, "is_active": True} for i in range(5)]
    db.rows["writing_essays"] += [{"id": f"e-x{i}", "student_id": S_LAN, "task_type": "task2", "status": "pending",
                                   "created_at": f"2026-11-0{i + 1}T08:00:00+00:00", "deleted_at": None}
                                  for i in range(5)]
    assert len(_admin("lop toi")["classes"]) == 3
    assert len(_admin("lan")["submissions"]) == 3


def test_a_teacher_sees_only_their_classes(db, monkeypatch):
    """Acceptance: teacher A does not see a learner of class B."""
    a = _teacher(monkeypatch, db, U_TEACH, "tran van minh")
    assert a["learners"] == [] and a["submissions"] == []
    a = _teacher(monkeypatch, db, U_TEACH, "sat")
    assert a["classes"] == []
    assert set(a) == {"learners", "classes", "submissions", "sources_failed", "unavailable"}

    b = _teacher(monkeypatch, db, U_TEACH_B, "minh")
    assert b["learners"] == [{"title": "Trần Văn Minh", "meta": "HV002 · Sat–Sun 09:00",
                              "href": "/instructor"}]
    assert [r["href"] for r in b["submissions"]] == ["/instructor/grade?essay_id=e-minh"]
    assert _teacher(monkeypatch, db, U_TEACH_B, "lan")["learners"] == []


def test_a_teacher_sees_class_work_not_practice_essays(db, monkeypatch):
    out = _teacher(monkeypatch, db, U_TEACH, "lan")
    assert _titles(out, "learners") == ["Nguyễn Thị Lan"]
    assert [r["href"] for r in out["submissions"]] == ["/instructor/grade?essay_id=e-class"]
    assert out["classes"] == []   # "lan" names no class


def test_a_teacher_without_a_class_finds_nothing(db, monkeypatch):
    for c in db.rows["cohorts"]:
        c["instructor_id"] = None
    out = _teacher(monkeypatch, db, U_TEACH, "lan")
    assert {k: out[k] for k in EMPTY} == EMPTY and out["sources_failed"] == []


@pytest.mark.parametrize("q", ["", "a", " a ", "đ"])
def test_a_query_under_two_characters_is_422(db, monkeypatch, q):
    with pytest.raises(HTTPException) as caught:
        _admin(q)
    assert caught.value.status_code == 422 and caught.value.detail["code"] == "query_too_short"
    with pytest.raises(HTTPException) as caught:
        _teacher(monkeypatch, db, U_TEACH, q)
    assert caught.value.status_code == 422


@pytest.mark.parametrize("q", ["%%", "__", "%a", "l_n", "**", "*n"])
def test_like_wildcards_are_plain_characters(db, q):
    out = _admin(q)
    for group in ("learners", "classes", "submissions", "content"):
        assert out[group] == [], (q, group)


def test_a_failed_group_is_named_and_the_others_still_answer(db):
    db.fail.add("writing_essays")
    out = _admin("lan")
    assert out["sources_failed"] == ["submissions"] and out["submissions"] == []
    assert _titles(out, "learners") == ["Nguyễn Thị Lan"]
    db.fail = {"listening_tests"}
    out = _admin("tue–thu")
    assert out["sources_failed"] == ["content:listening_tests"]
    assert _titles(out, "content") == ["Tue–Thu chart: energy use"]


def test_an_unreadable_teacher_roster_is_never_shown_as_no_result(db, monkeypatch):
    db.fail.add("student_cohort_memberships")
    out = _teacher(monkeypatch, db, U_TEACH, "lan")
    assert out["sources_failed"] == ["learners", "submissions"]
    assert out["learners"] == [] and out["submissions"] == []


def test_an_unreadable_teacher_scope_fails_closed(db, monkeypatch):
    db.fail.add("cohorts")
    with pytest.raises(HTTPException) as caught:
        _teacher(monkeypatch, db, U_TEACH, "lan")
    assert caught.value.status_code == 503


def test_roles(db, monkeypatch):
    with pytest.raises(HTTPException) as caught:
        _teacher(monkeypatch, db, U_LAN, "lan")
    assert caught.value.status_code == 403
    admin_door = _teacher(monkeypatch, db, U_ADMIN, "minh")   # an admin on the teacher door
    assert _titles(admin_door, "learners") == ["Trần Văn Minh"] and "content" not in admin_door
    assert admin_door["unavailable"] == []
    monkeypatch.setattr(mod, "require_admin", AsyncMock(side_effect=HTTPException(403, "admin only")))
    with pytest.raises(HTTPException) as caught:
        _admin("lan")
    assert caught.value.status_code == 403


def test_the_log_line_never_holds_the_query(db, monkeypatch, caplog):
    with caplog.at_level(logging.INFO, logger="routers.admin_search"):
        _admin("nguyen thi lan")
        _teacher(monkeypatch, db, U_TEACH, "nguyen thi lan")
    lines = [r.getMessage() for r in caplog.records if r.name == "routers.admin_search"]
    assert len(lines) == 2 and all("admin_search" in line and "q_len=14" in line for line in lines)
    assert not any("nguyen" in line.lower() or "lan" in line.lower() for line in lines)


def test_search_writes_nothing(db, monkeypatch):
    _admin("lan")
    _teacher(monkeypatch, db, U_TEACH, "lan")
    assert db.writes == []


def test_a_teachers_essay_reads_are_chunked_by_essay(db, monkeypatch):
    """Review N2: a long Writing history never goes into one ``in_`` list."""
    db.rows["writing_assignments"] += [{"id": f"wx{i}", "student_id": S_LAN, "cohort_id": C_A, "essay_id": f"e-old{i}",
                                        "assigned_by": U_TEACH}
                                       for i in range(450)]
    sizes: list[int] = []
    real_in = db.table("writing_essays").__class__.in_

    def spy(self, c, vs):
        if self.name == "writing_essays":
            sizes.append(len(list(vs)))
        return real_in(self, c, vs)

    monkeypatch.setattr(db.table("x").__class__, "in_", spy)
    out = _teacher(monkeypatch, db, U_TEACH, "lan")
    assert [r["href"] for r in out["submissions"]] == ["/instructor/grade?essay_id=e-class"]
    assert sizes and max(sizes) <= 200 and sum(sizes) == 451


def test_a_teachers_class_work_is_read_past_the_first_page(db, monkeypatch):
    """Review R3-1: more than one PostgREST page (1,000 rows) of class work
    for one chunk of learners; the newest essay is on the second page."""
    db.rows["writing_assignments"] += [{"id": f"wa{i:04d}", "student_id": S_LAN, "cohort_id": C_A,
                                        "essay_id": f"e-pad{i}", "assigned_by": U_TEACH} for i in range(1200)]
    db.rows["writing_assignments"].append({"id": "wz-last", "student_id": S_LAN, "cohort_id": C_A,
                                           "essay_id": "e-newest", "assigned_by": U_TEACH})
    db.rows["writing_essays"].append({"id": "e-newest", "student_id": S_LAN, "task_type": "task2",
                                      "status": "pending", "created_at": "2026-11-20T08:00:00+00:00",
                                      "deleted_at": None})
    query_cls = db.table("x").__class__
    real_execute = query_cls.execute

    def capped(self):   # PostgREST answers at most 1,000 rows per request
        resp = real_execute(self)
        resp.data = resp.data[:directory._PAGE]
        return resp

    monkeypatch.setattr(query_cls, "execute", capped)
    out = _teacher(monkeypatch, db, U_TEACH, "lan")
    assert [r["href"] for r in out["submissions"]] == ["/instructor/grade?essay_id=e-newest",
                                                       "/instructor/grade?essay_id=e-class"]


def test_a_teacher_sees_only_class_work_their_grading_page_opens(db, monkeypatch):
    """Review R3-2: an essay given to the teacher's class by someone else
    opens on /instructor/essays/{id} only when the learner's
    students.instructor_id is the teacher, so the search follows that rule."""
    db.rows["writing_assignments"].append({"id": "w-adm", "student_id": S_LAN, "cohort_id": C_A,
                                           "essay_id": "e-by-admin", "assigned_by": U_ADMIN})
    db.rows["writing_essays"].append({"id": "e-by-admin", "student_id": S_LAN, "task_type": "task2",
                                      "status": "pending", "created_at": "2026-11-20T08:00:00+00:00",
                                      "deleted_at": None})
    hrefs = lambda: [r["href"] for r in _teacher(monkeypatch, db, U_TEACH, "lan")["submissions"]]
    assert hrefs() == ["/instructor/grade?essay_id=e-class"]
    lan = next(s for s in db.rows["students"] if s["id"] == S_LAN)
    lan["instructor_id"] = U_TEACH_B          # another teacher's Writing learner
    assert hrefs() == ["/instructor/grade?essay_id=e-class"]
    lan["instructor_id"] = U_TEACH            # the teacher's own Writing learner
    assert hrefs() == ["/instructor/grade?essay_id=e-by-admin", "/instructor/grade?essay_id=e-class"]


def test_the_query_travels_in_the_body_never_in_the_url(db):
    """#2450 gate: the platform's HTTP log keeps request URLs, so the search
    routes accept only POST with ``{"q": ...}``; a GET with ``?q=`` is refused
    before any search runs."""
    from fastapi.testclient import TestClient
    from main import app

    client = TestClient(app)
    for path in ("/admin/search", "/instructor/search"):
        assert client.get(path, params={"q": "lan"}).status_code == 405
    ok = client.post("/admin/search", json={"q": "lan"}, headers={"Authorization": "Bearer x"})
    assert ok.status_code == 200 and _titles(ok.json(), "learners") == ["Nguyễn Thị Lan"]
    assert client.post("/admin/search", json={"q": "x" * 129},
                       headers={"Authorization": "Bearer x"}).status_code == 422
