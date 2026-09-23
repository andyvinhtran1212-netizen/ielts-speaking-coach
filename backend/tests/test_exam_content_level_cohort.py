"""Cấp khoá học + gán lớp cho nội dung kỳ thi (Đợt 3).

Choosing which paper goes to which class was done from memory: nothing on a
test or a prompt said what course level it targets or which classes it is for.
With three libraries that does not scale, and picking the wrong paper for a
class is a mistake nobody notices until the exam is under way.
"""

from __future__ import annotations

import re
import inspect
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from fastapi.routing import APIRoute

import services.exam_content_service as svc
from routers.admin_exam_content import router as content_router
from services import mock_exam_service

BACKEND = Path(__file__).resolve().parents[1]


# ── Fake DB ───────────────────────────────────────────────────────────


class _Resp:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, db, table):
        self.db, self.table_name = db, table
        self.op = "select"
        self.payload = None
        self.eqs: list = []
        self.neqs: list = []
        self.ins: list = []

    def select(self, *_a, **_k):
        return self

    def update(self, p):
        self.op, self.payload = "update", p
        return self

    def insert(self, p):
        self.op, self.payload = "insert", p
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, c, v):
        self.eqs.append((c, v))
        return self

    def neq(self, c, v):
        self.neqs.append((c, v))
        return self

    def in_(self, c, vs):
        self.ins.append((c, [str(x) for x in vs]))
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def range(self, s, e):
        self._range = (s, e)
        return self

    def _match(self, r):
        for c, v in self.eqs:
            if str(r.get(c)) != str(v):
                return False
        for c, v in self.neqs:
            if str(r.get(c)) == str(v):
                return False
        for c, vs in self.ins:
            if str(r.get(c)) not in vs:
                return False
        return True

    def execute(self):
        rows = self.db.t.setdefault(self.table_name, [])
        if self.op == "insert":
            items = self.payload if isinstance(self.payload, list) else [self.payload]
            for it in items:
                it = dict(it)
                it.setdefault("id", f"row-{len(rows)+1}")
                rows.append(it)
            return _Resp(items)
        hit = [r for r in rows if self._match(r)]
        if self.op == "update":
            for r in hit:
                r.update(self.payload)
            return _Resp(hit)
        if self.op == "delete":
            self.db.t[self.table_name] = [r for r in rows if not self._match(r)]
            return _Resp(hit)
        if getattr(self, "_range", None):
            s, e = self._range
            hit = hit[s:e + 1]
        return _Resp(hit)


class _Deferred:
    """postgrest-py defers until .execute(); the fake must too."""

    def __init__(self, data):
        self._d = data

    def execute(self):
        return _Resp(self._d)


class _DB:
    def __init__(self):
        self.t: dict = {}
        self.page_calls: list[dict] = []

    def table(self, name):
        return _Q(self, name)

    # fn_set_exam_content_cohorts (mig 172) — modelled with the SAME semantics
    # the SQL implements (one transaction, ON CONFLICT DO NOTHING, delete of the
    # complement), like the fakes for mig 163/168/169. A stub would make these
    # tests assert against a stub.
    def rpc(self, name, params):
        if name == "fn_admin_exam_content_levels":
            table, _ = svc._KINDS[params["p_kind"]]
            return _Deferred(sorted({str(row["course_level"]).strip()
                                     for row in self.t.get(table, [])
                                     if row.get("course_level") and str(row["course_level"]).strip()}))
        if name == "fn_admin_exam_content_page_ids":
            self.page_calls.append(dict(params))
            kind = params["p_kind"]
            table, code_col = svc._KINDS[kind]
            query = (params.get("p_query") or "").lower()
            attention = params["p_attention"]
            rows = []
            for row in self.t.get(table, []):
                cid = str(row["id"])
                links = [link for link in self.t.get("exam_content_cohorts", [])
                         if link["content_kind"] == kind and str(link["content_id"]) == cid]
                in_mock = any(
                    (kind == "reading" and exam.get("reading_test_id") == cid)
                    or (kind == "listening" and exam.get("listening_test_id") == cid)
                    or (kind == "writing" and cid in (
                        exam.get("writing_task1_prompt_id"), exam.get("writing_task2_prompt_id")))
                    for exam in self.t.get("mock_exams", [])
                )
                status = row.get("status") or ("published" if row.get("is_active") else "archived")
                ready = svc.publication_readiness(kind, row)[0] if kind != "writing" else False
                if params.get("p_course_level") is not None and (row.get("course_level") or "") != params["p_course_level"]:
                    continue
                if params.get("p_cohort_id") is not None and not any(
                    link["cohort_id"] == params["p_cohort_id"] for link in links
                ):
                    continue
                if params.get("p_exam_only") is not None and bool(row.get("exam_only")) != params["p_exam_only"]:
                    continue
                if params.get("p_is_public") is not None and (
                    kind == "writing" or bool(row.get("is_public")) != params["p_is_public"]
                ):
                    continue
                if query and not any(query in str(value or "").lower() for value in (
                    cid, row.get(code_col) if code_col else None,
                    row.get("title"), row.get("course_level"),
                )):
                    continue
                if attention == "no-level" and row.get("course_level"):
                    continue
                if attention == "draft" and status != "draft":
                    continue
                if attention == "unassigned" and in_mock:
                    continue
                if attention == "action" and (status == "archived" or not (
                    (kind != "writing" and (status != "published" or not ready))
                    or not row.get("course_level") or not links
                )):
                    continue
                rows.append(row)
            rows.sort(key=lambda row: (
                str((row.get(code_col) if code_col else None) or row.get("title") or "").lower(),
                str(row["id"]),
            ))
            start = params["p_offset"]
            return _Deferred({"ids": [str(row["id"]) for row in rows[start:start + params["p_limit"]]],
                              "total": len(rows)})
        assert name == "fn_set_exam_content_cohorts", name
        kind, cid = params["p_kind"], str(params["p_content_id"])
        wanted = sorted({str(c) for c in (params.get("p_cohort_ids") or [])})
        rows = self.t.setdefault("exam_content_cohorts", [])
        mine = [r for r in rows
                if r["content_kind"] == kind and str(r["content_id"]) == cid]
        have = {r["cohort_id"] for r in mine}
        removed = len([r for r in mine if r["cohort_id"] not in wanted])
        self.t["exam_content_cohorts"] = [
            r for r in rows
            if not (r["content_kind"] == kind and str(r["content_id"]) == cid
                    and r["cohort_id"] not in wanted)
        ]
        added = [c for c in wanted if c not in have]
        for c in added:
            self.t["exam_content_cohorts"].append({
                "id": "row-%d" % (len(self.t["exam_content_cohorts"]) + 1),
                "content_kind": kind, "content_id": cid, "cohort_id": c,
                "created_by": params.get("p_created_by"),
            })
        return _Deferred({"added": added, "removed": removed, "cohort_ids": wanted})


@pytest.fixture()
def db(monkeypatch):
    d = _DB()
    monkeypatch.setattr(svc, "supabase_admin", d)
    return d


# ── Course level ──────────────────────────────────────────────────────


def test_setting_a_level(db):
    db.t["reading_tests"] = [{"id": "r1", "title": "T", "course_level": None}]
    out = svc.set_course_level("reading", "r1", "C2")
    assert out["course_level"] == "C2"


def test_clearing_a_level_stores_null_not_empty_string(db):
    """An empty string would be a level named "" — it would show up in the
    suggestion list and in filters as a real value."""
    db.t["writing_prompts"] = [{"id": "w1", "course_level": "C4"}]
    assert svc.set_course_level("writing", "w1", "   ")["course_level"] is None
    assert svc.set_course_level("writing", "w1", None)["course_level"] is None


def test_an_unknown_kind_is_refused(db):
    for fn, args in ((svc.set_course_level, ("speaking", "x", "C2")),
                     (svc.set_cohorts, ("speaking", "x", [])),
                     (svc.cohorts_for, ("speaking", []))):
        with pytest.raises(svc.UnknownKindError):
            fn(*args)


def test_a_missing_row_is_reported_not_silently_ignored(db):
    db.t["reading_tests"] = []
    with pytest.raises(LookupError):
        svc.set_course_level("reading", "nope", "C2")


def test_central_publish_gate_publishes_ready_reading(db):
    db.t["reading_tests"] = [{
        "id": "r1", "status": "draft", "passage_count": 3, "total_questions": 40,
    }]
    assert svc.set_status("reading", "r1", "published")["status"] == "published"


def test_central_publish_gate_publishes_ready_reading_mini(db):
    db.t["reading_tests"] = [{
        "id": "r-mini", "status": "draft", "test_type": "mini",
        "passage_count": 1, "total_questions": 7,
    }]
    assert svc.set_status("reading", "r-mini", "published")["status"] == "published"


def test_reading_mini_without_questions_is_not_publishable(db):
    db.t["reading_tests"] = [{
        "id": "r-mini", "status": "draft", "test_type": "mini",
        "passage_count": 1, "total_questions": 0,
    }]
    with pytest.raises(svc.ContentNotReadyError, match="1 passage và có câu hỏi"):
        svc.set_status("reading", "r-mini", "published")


def test_incomplete_reading_has_an_actionable_publish_reason(db):
    db.t["reading_tests"] = [{
        "id": "r1", "status": "draft", "passage_count": 2, "total_questions": 28,
    }]
    with pytest.raises(svc.ContentNotReadyError, match="3 passages và 40 câu"):
        svc.set_status("reading", "r1", "published")


def test_central_publish_gate_explains_missing_listening_audio(db):
    db.t["listening_tests"] = [{
        "id": "l1", "status": "draft", "audio_assembly_mode": "full_premixed",
        "full_audio_storage_path": None,
    }]
    with pytest.raises(svc.ContentNotReadyError, match="full_audio_storage_path"):
        svc.set_status("listening", "l1", "published")


def test_ready_listening_can_be_published_from_the_catalog(db):
    db.t["listening_tests"] = [{
        "id": "l1", "status": "draft", "audio_assembly_mode": "full_premixed",
        "full_audio_storage_path": "full/test.mp3",
    }]
    assert svc.set_status("listening", "l1", "published")["status"] == "published"


def test_published_paper_with_active_assignment_cannot_return_to_draft(db, monkeypatch):
    db.t["reading_tests"] = [{
        "id": "r1", "status": "published", "passage_count": 3, "total_questions": 40,
    }]
    monkeypatch.setattr(svc, "active_exam_assignment_references", lambda *_a: [{
        "id": "give-1", "title": "Bài kiểm tra tuần 4",
    }])
    with pytest.raises(svc.ActiveAssignmentError, match="Bài kiểm tra tuần 4"):
        svc.set_status("reading", "r1", "draft")


def test_published_paper_in_live_mock_exam_cannot_leave_published(db, monkeypatch):
    db.t["reading_tests"] = [{
        "id": "r1", "status": "published", "passage_count": 3, "total_questions": 40,
    }]
    db.t["mock_exams"] = [
        {"id": "m-draft", "code": "MOCK-DRAFT", "status": "draft", "reading_test_id": "r1"},
        {"id": "m-live", "code": "MOCK-LIVE", "status": "published", "reading_test_id": "r1"},
        {"id": "m-old", "code": "MOCK-OLD", "status": "archived", "reading_test_id": "r1"},
    ]
    monkeypatch.setattr(svc, "active_exam_assignment_references", lambda *_a: [])
    monkeypatch.setattr(mock_exam_service, "supabase_admin", db)

    for next_status in ("draft", "archived"):
        with pytest.raises(svc.ActiveMockExamError, match="MOCK-DRAFT, MOCK-LIVE"):
            svc.set_status("reading", "r1", next_status)


def test_archived_mock_exam_does_not_block_depublishing_paper(db, monkeypatch):
    db.t["reading_tests"] = [{
        "id": "r1", "status": "published", "passage_count": 3, "total_questions": 40,
    }]
    db.t["mock_exams"] = [
        {"id": "m-old", "code": "MOCK-OLD", "status": "archived", "reading_test_id": "r1"},
    ]
    monkeypatch.setattr(svc, "active_exam_assignment_references", lambda *_a: [])
    monkeypatch.setattr(mock_exam_service, "supabase_admin", db)

    assert svc.set_status("reading", "r1", "draft")["status"] == "draft"


def test_known_levels_are_derived_from_the_data(db):
    """The column is free text on purpose — a CHECK would need a migration per
    new course — so the suggestion list must never be hard-coded."""
    db.t["reading_tests"] = [{"id": "r1", "course_level": "C2"},
                             {"id": "r2", "course_level": "  "}]
    db.t["listening_tests"] = [{"id": "l1", "course_level": "C4"}]
    db.t["writing_prompts"] = [{"id": "w1", "course_level": "C2"}]
    assert svc.known_course_levels() == ["C2", "C4"]
    assert svc.known_course_levels_with_failures() == (["C2", "C4"], [])


# ── Cohort assignment ─────────────────────────────────────────────────


def test_assigning_a_paper_to_several_classes(db):
    """Many-to-many was the explicit decision: a paper is reused across classes."""
    db.t["reading_tests"] = [{"id": "r1"}]
    out = svc.set_cohorts("reading", "r1", ["c1", "c2"], created_by="admin")
    assert out["cohort_ids"] == ["c1", "c2"]
    assert svc.cohorts_for("reading", ["r1"]) == {"r1": ["c1", "c2"]}


def test_it_replaces_the_set_rather_than_appending(db):
    """The screen shows every tick, so what it sends IS the intended state."""
    db.t["reading_tests"] = [{"id": "r1"}]
    db.t["reading_tests"] = [{"id": "r1"}]
    svc.set_cohorts("reading", "r1", ["c1", "c2"])
    out = svc.set_cohorts("reading", "r1", ["c2", "c3"])
    assert out["cohort_ids"] == ["c2", "c3"]
    assert svc.cohorts_for("reading", ["r1"])["r1"] == ["c2", "c3"]


def test_re_sending_the_same_set_changes_nothing(db):
    """A double-click must not create a duplicate that then needs two clicks to
    undo — nor churn rows for no reason."""
    db.t["reading_tests"] = [{"id": "r1"}]
    svc.set_cohorts("reading", "r1", ["c1"])
    before = list(db.t["exam_content_cohorts"])
    out = svc.set_cohorts("reading", "r1", ["c1"])
    assert out == {"added": [], "removed": 0, "cohort_ids": ["c1"]}
    assert db.t["exam_content_cohorts"] == before


def test_the_replacement_is_one_statement_not_two_calls(db):
    """As insert-then-delete, a failing delete left {old ∪ new} persisted while
    the request reported an error — the endpoint had both FAILED and WIDENED the
    assignment. Reversing the order only swaps that for "assigned to nobody", so
    the fix is a transaction (mig 172, Codex review PR #864)."""
    import inspect
    src = inspect.getsource(svc.set_cohorts)
    assert 'rpc("fn_set_exam_content_cohorts"' in src
    assert ".insert(" not in src and ".delete(" not in src


def test_assigning_to_content_that_does_not_exist_is_refused(db):
    """The join table deliberately has no FK on content_id, so nothing else stops
    a stale UUID being "assigned" while the endpoint reports success."""
    db.t["reading_tests"] = []
    with pytest.raises(LookupError):
        svc.set_cohorts("reading", "ghost", ["c1"])
    assert not db.t.get("exam_content_cohorts")


def test_kinds_do_not_bleed_into_each_other(db):
    """content_id is polymorphic — the same UUID could exist in two libraries."""
    db.t["reading_tests"] = [{"id": "x1"}]
    db.t["listening_tests"] = [{"id": "x1"}]
    svc.set_cohorts("reading", "x1", ["c1"])
    svc.set_cohorts("listening", "x1", ["c2"])
    assert svc.cohorts_for("reading", ["x1"])["x1"] == ["c1"]
    assert svc.cohorts_for("listening", ["x1"])["x1"] == ["c2"]


def test_cohorts_for_answers_for_every_id_asked_about(db):
    """A list screen renders one row per id; a missing key would be a crash or a
    silently blank cell."""
    db.t["reading_tests"] = [{"id": "r1"}]
    svc.set_cohorts("reading", "r1", ["c1"])
    assert svc.cohorts_for("reading", ["r1", "r2"]) == {"r1": ["c1"], "r2": []}
    assert svc.cohorts_for("reading", []) == {}


# ── The combined screen ───────────────────────────────────────────────


def _seed_three(db):
    db.t["reading_tests"] = [
        {"id": "r1", "test_id": "R-01", "title": "R one", "status": "published",
         "exam_only": True, "is_public": False, "course_level": "C2",
         "test_type": "full", "passage_count": 3, "total_questions": 40},
    ]
    db.t["listening_tests"] = [
        {"id": "l1", "test_id": "L-01", "title": "L one", "status": "published",
         "exam_only": False, "is_public": True, "course_level": "C4"},
    ]
    db.t["writing_prompts"] = [
        {"id": "w1", "title": "W one", "is_active": True,
         "exam_only": True, "course_level": "C2"},
    ]


def test_one_screen_covers_all_three_libraries(db):
    _seed_three(db)
    kinds = {r["kind"] for r in svc.list_exam_content()["items"]}
    assert kinds == {"reading", "listening", "writing"}


def test_catalog_marks_a_valid_reading_mini_ready_to_assign(db):
    db.t["reading_tests"] = [{
        "id": "r-mini", "test_id": "R-MINI-01", "title": "Mini one",
        "status": "published", "exam_only": False, "is_public": True,
        "course_level": "C1", "test_type": "mini",
        "passage_count": 1, "total_questions": 11,
    }]
    row = svc.list_exam_content(kind="reading")["items"][0]
    assert row["publish_ready"] is True
    assert row["readiness_reason"] is None


def test_writing_status_is_normalised_so_one_column_serves_three(db):
    """Prompts are soft-deleted with is_active, tests carry a status enum."""
    _seed_three(db)
    by_kind = {r["kind"]: r for r in svc.list_exam_content()["items"]}
    assert by_kind["writing"]["status"] == "published"
    db.t["writing_prompts"][0]["is_active"] = False
    by_kind = {r["kind"]: r for r in svc.list_exam_content()["items"]}
    assert by_kind["writing"]["status"] == "archived"


def test_filters(db):
    _seed_three(db)
    svc.set_cohorts("reading", "r1", ["c1"])
    assert {r["kind"] for r in svc.list_exam_content(course_level="C2")["items"]} == {"reading", "writing"}
    assert {r["kind"] for r in svc.list_exam_content(exam_only=False)["items"]} == {"listening"}
    assert {r["kind"] for r in svc.list_exam_content(is_public=True)["items"]} == {"listening"}
    assert {r["kind"] for r in svc.list_exam_content(is_public=False)["items"]} == {"reading"}
    assert [r["id"] for r in svc.list_exam_content(cohort_id="c1")["items"]] == ["r1"]
    assert svc.list_exam_content(cohort_id="nope")["items"] == []


def test_catalog_search_attention_and_pagination_return_truthful_total(db):
    _seed_three(db)
    svc.set_cohorts("reading", "r1", ["c1"])
    svc.set_cohorts("writing", "w1", ["c1"])

    searched = svc.list_exam_content(q="r one", limit=25, offset=0)
    assert [row["id"] for row in searched["items"]] == ["r1"]
    assert searched["total"] == 1

    missing_level = svc.list_exam_content(attention="no-level", limit=25, offset=0)
    assert missing_level["items"] == []
    assert missing_level["total"] == 0

    unassigned = svc.list_exam_content(attention="unassigned", limit=1, offset=1)
    assert unassigned["total"] == 3
    assert len(unassigned["items"]) == 1

    needs_action = svc.list_exam_content(attention="action")
    assert "w1" not in {row["id"] for row in needs_action["items"]}

    with pytest.raises(ValueError, match="attention"):
        svc.list_exam_content(attention="invented")


def test_catalog_tied_display_keys_have_stable_page_order(db):
    db.t["writing_prompts"] = [
        {"id": "w-b", "title": "Shared title", "is_active": True,
         "exam_only": True, "course_level": "C2"},
        {"id": "w-a", "title": "Shared title", "is_active": True,
         "exam_only": True, "course_level": "C2"},
    ]
    first = svc.list_exam_content(kind="writing", limit=1, offset=0)
    second = svc.list_exam_content(kind="writing", limit=1, offset=1)
    assert first["total"] == second["total"] == 2
    assert [first["items"][0]["id"], second["items"][0]["id"]] == ["w-a", "w-b"]
    db.t["writing_prompts"].reverse()
    assert [row["id"] for row in svc.list_exam_content(kind="writing")["items"]] == ["w-a", "w-b"]


def test_catalog_page_crosses_kind_boundaries_without_scanning_source_rows(db, monkeypatch):
    _seed_three(db)
    monkeypatch.setattr(svc, "cohorts_for", lambda _kind, _ids: {})
    monkeypatch.setattr(svc, "explanation_readiness_for", lambda _kind, _ids: {})
    monkeypatch.setattr(svc, "_mock_refs_for", lambda _kind, _ids: {})
    monkeypatch.setattr(svc, "_paged", lambda *_args, **_kwargs: pytest.fail("unbounded scan"))
    first = svc.list_exam_content(limit=2, offset=0)
    second = svc.list_exam_content(limit=2, offset=2)
    assert first["total"] == second["total"] == 3
    assert [(row["kind"], row["id"]) for row in first["items"]] == [
        ("listening", "l1"), ("reading", "r1")]
    assert [(row["kind"], row["id"]) for row in second["items"]] == [
        ("writing", "w1")]
    assert all(0 <= call["p_limit"] <= 2 for call in db.page_calls)


@pytest.mark.parametrize("suffix, expected_limit, expected_status", [
    ("", 25, 200), ("?limit=100", 100, 200), ("?limit=101", None, 422),
])
def test_catalog_page_enforces_bounded_page_size(suffix, expected_limit, expected_status):
    from main import app

    with patch("routers.admin_exam_content.require_admin",
               new=AsyncMock(return_value={"id": "admin"})), patch(
        "routers.admin_exam_content.svc.list_exam_content",
        return_value={"items": [], "total": 0, "failed_kinds": [],
                      "limit": expected_limit or 25, "offset": 0},
    ) as mock_page, patch(
        "routers.admin_exam_content.svc.known_course_levels_bounded_with_failures", return_value=([], []),
    ):
        response = TestClient(app).get(
            f"/admin/exam-content/page{suffix}",
            headers={"Authorization": "Bearer fake.admin.jwt"},
        )
    assert response.status_code == expected_status
    if expected_limit is None:
        mock_page.assert_not_called()
    else:
        assert mock_page.call_args.kwargs["limit"] == expected_limit


def test_catalog_page_keeps_levels_found_only_beyond_first_page(db):
    from main import app

    db.t["writing_prompts"] = [{
        "id": f"w-{index:03d}", "title": f"Prompt {index:03d}",
        "is_active": True, "exam_only": True,
        "course_level": "C9" if index == 30 else "C2",
    } for index in range(31)]
    with patch("routers.admin_exam_content.require_admin",
               new=AsyncMock(return_value={"id": "admin"})):
        response = TestClient(app).get(
            "/admin/exam-content/page?kind=writing&limit=25",
            headers={"Authorization": "Bearer fake.admin.jwt"},
        )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload["items"]) == 25
    assert "C9" not in {row["course_level"] for row in payload["items"]}
    assert payload["levels"] == ["C2", "C9"]
    assert payload["levels_complete"] is True
    assert payload["failed_level_kinds"] == []


def test_catalog_page_marks_level_scan_failure_separately_from_exact_total(db):
    from main import app

    db.t["writing_prompts"] = [{"id": "w-1", "title": "Prompt", "is_active": True}]
    with patch("routers.admin_exam_content.require_admin",
               new=AsyncMock(return_value={"id": "admin"})), patch(
        "routers.admin_exam_content.svc.known_course_levels_bounded_with_failures",
        return_value=(["C2"], ["listening"]),
    ):
        response = TestClient(app).get(
            "/admin/exam-content/page?kind=writing",
            headers={"Authorization": "Bearer fake.admin.jwt"},
        )
    assert response.status_code == 200, response.text
    assert response.json()["total_complete"] is True
    assert response.json()["levels_complete"] is False
    assert response.json()["failed_level_kinds"] == ["listening"]


def test_catalog_enriches_only_the_requested_page(db, monkeypatch):
    db.t["reading_tests"] = [{
        "id": f"r-{index:03d}", "test_id": f"R-{index:03d}", "title": f"Reading {index}",
        "course_level": "C2", "exam_only": False, "is_public": True,
        "status": "published", "passage_count": 3, "total_questions": 40,
    } for index in range(240)]
    seen: dict[str, list[list[str]]] = {"cohorts": [], "explanations": [], "mocks": []}

    def capture(name, value):
        ids = [str(item) for item in value]
        seen[name].append(ids)
        return {item: ({} if name == "explanations" else []) for item in ids}

    monkeypatch.setattr(svc, "cohorts_for", lambda _kind, ids: capture("cohorts", ids))
    monkeypatch.setattr(svc, "explanation_readiness_for", lambda _kind, ids: capture("explanations", ids))
    monkeypatch.setattr(svc, "_mock_refs_for", lambda _kind, ids: capture("mocks", ids))

    result = svc.list_exam_content(kind="reading", q="reading", limit=25, offset=100)

    assert result["total"] == 240
    assert len(result["items"]) == 25
    assert all(len(batch) <= 25 for batches in seen.values() for batch in batches)
    assert {item for batches in seen.values() for batch in batches for item in batch} == {
        f"r-{index:03d}" for index in range(100, 125)
    }


def test_draft_attention_excludes_published_and_archived_content(db):
    _seed_three(db)
    db.t["reading_tests"][0]["status"] = "draft"
    db.t["listening_tests"][0]["status"] = "archived"

    result = svc.list_exam_content(attention="draft")

    assert result["total"] == 1
    assert [(row["kind"], row["id"], row["status"]) for row in result["items"]] == [
        ("reading", "r1", "draft"),
    ]
    assert "l1" not in {
        row["id"] for row in svc.list_exam_content(attention="action")["items"]
    }


def test_visibility_write_is_targeted_and_independent(db):
    _seed_three(db)
    row = svc.set_public_visibility("reading", "r1", True)
    assert row["is_public"] is True
    assert row["exam_only"] is False
    assert db.t["listening_tests"][0]["is_public"] is True


def test_list_surfaces_mock_usage_without_changing_visibility(db):
    _seed_three(db)
    db.t["mock_exams"] = [{
        "id": "m1", "code": "MOCK-1", "title": "Mock one",
        "status": "published", "reading_test_id": "r1",
    }]
    row = svc.list_exam_content(kind="reading")["items"][0]
    assert row["is_public"] is False
    assert row["mock_exams"] == [{
        "id": "m1", "code": "MOCK-1", "title": "Mock one",
        "status": "published",
    }]


def test_writing_mock_usage_covers_both_slots_and_unassigned_filter(db):
    _seed_three(db)
    db.t["mock_exams"] = [{
        "id": "m1", "code": "MOCK-1", "title": "Mock one",
        "status": "published", "writing_task1_prompt_id": "w1",
        "writing_task2_prompt_id": "w1",
    }]

    row = svc.list_exam_content(kind="writing")["items"][0]
    assert row["mock_exams"] == [{
        "id": "m1", "code": "MOCK-1", "title": "Mock one",
        "status": "published",
    }]
    assert svc.list_exam_content(kind="writing", attention="unassigned")["items"] == []


def test_writing_mock_reference_lookup_merges_task1_and_task2(db):
    db.t["mock_exams"] = [
        {"id": "m1", "code": "MOCK-1", "title": "Mock one", "status": "published",
         "writing_task1_prompt_id": "w1", "writing_task2_prompt_id": None},
        {"id": "m2", "code": "MOCK-2", "title": "Mock two", "status": "draft",
         "writing_task1_prompt_id": None, "writing_task2_prompt_id": "w2"},
    ]

    refs = svc._mock_refs_for("writing", ["w1", "w2"])
    assert {prompt_id: rows[0]["id"] for prompt_id, rows in refs.items()} == {
        "w1": "m1", "w2": "m2",
    }


def test_mock_reference_lookup_chunks_ids_and_merges_every_result(db, monkeypatch):
    monkeypatch.setattr(svc, "_ID_CHUNK", 2)
    ids = [f"r{i}" for i in range(5)]
    db.t["mock_exams"] = [{
        "id": f"m{i}", "code": f"MOCK-{i}", "title": f"Mock {i}",
        "status": "published", "reading_test_id": paper_id,
    } for i, paper_id in enumerate(ids)]
    chunks = []

    def paged(build_query):
        query = build_query()
        chunks.append(query.ins[0][1])
        return query.execute().data

    monkeypatch.setattr(svc, "_paged", paged)
    refs = svc._mock_refs_for("reading", ids)

    assert chunks == [["r0", "r1"], ["r2", "r3"], ["r4"]]
    assert {paper_id: rows[0]["id"] for paper_id, rows in refs.items()} == {
        f"r{i}": f"m{i}" for i in range(5)
    }


def test_exam_catalog_surfaces_paper_level_explanation_readiness(db):
    _seed_three(db)
    db.t["web_explanation_objects"] = [{
        "reading_test_id": "r1", "listening_test_id": None, "is_current": True,
        "rights_status": "APPROVED", "editorial_status": "APPROVED",
        "serving_status": "ELIGIBLE_AFTER_GLOBAL_RELEASE_GATES",
    } for _ in range(40)]
    rows = {row["kind"]: row for row in svc.list_exam_content()["items"]}
    assert rows["reading"]["web_explanation_ready"] is True
    assert rows["reading"]["web_explanation_ready_count"] == 40
    assert rows["reading"]["web_explanation_state"] == "ready"
    assert rows["listening"]["web_explanation_state"] == "none"

    db.t["web_explanation_objects"][0]["editorial_status"] = (
        "GENERATED_REQUIRES_EDITORIAL_REVIEW"
    )
    row = {item["kind"]: item for item in svc.list_exam_content()["items"]}["reading"]
    assert row["web_explanation_ready"] is False
    assert row["web_explanation_ready_count"] == 39
    assert row["web_explanation_state"] == "blocked"


def test_one_broken_library_does_not_blank_the_whole_screen(db, monkeypatch):
    """An admin looking at 3 libraries should still see 2 when one errors —
    returning nothing reads as "there are no papers", which is worse."""
    _seed_three(db)
    real = db.table

    def flaky(name):
        if name == "listening_tests":
            raise RuntimeError("postgrest down")
        return real(name)

    monkeypatch.setattr(svc, "supabase_admin", type("D", (), {"table": staticmethod(flaky)})())
    kinds = {r["kind"] for r in svc.list_exam_content()["items"]}
    assert kinds == {"reading", "writing"}


# ── Migration ─────────────────────────────────────────────────────────


def _mig() -> str:
    return (BACKEND / "migrations" / "171_exam_content_level_cohort.sql").read_text(encoding="utf-8")


def test_all_three_tables_get_the_level_column():
    sql = _mig()
    for t in ("reading_tests", "listening_tests", "writing_prompts"):
        assert re.search(rf"ALTER TABLE {t}\s+ADD COLUMN IF NOT EXISTS course_level", sql), t


def _mig_statements() -> str:
    """The migration with comments stripped — the prose explains WHY there is no
    CHECK on course_level, so matching raw text asserts against itself."""
    return "\n".join(l for l in _mig().splitlines() if not l.lstrip().startswith("--"))


def test_the_level_has_no_check_constraint():
    """A CHECK would mean a migration every time a course is added, which
    guarantees the column stops being maintained."""
    stmts = _mig_statements()
    assert "course_level" in stmts
    assert not re.search(r"course_level TEXT[^;]*CHECK", stmts)


def test_the_join_table_cannot_hold_duplicates():
    assert re.search(r"UNIQUE \(content_kind, content_id, cohort_id\)", _mig())


def test_deleting_a_class_cleans_up_after_itself():
    """The cohort side CAN have a real FK, so it must — otherwise rows outlive
    the class they point at."""
    assert "cohort_id     UUID NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE" in _mig()


def test_the_content_kind_is_constrained():
    """Unlike course_level, this set only changes when the platform grows a new
    skill — which is a code change anyway."""
    assert "CHECK (content_kind IN ('reading', 'listening', 'writing'))" in _mig()


def test_the_join_table_is_backend_only():
    assert "ALTER TABLE exam_content_cohorts ENABLE ROW LEVEL SECURITY" in _mig()


def test_the_reverse_is_written_down():
    sql = _mig()
    assert "TO REVERSE" in sql
    assert "DROP TABLE IF EXISTS exam_content_cohorts" in sql


# ── Router ────────────────────────────────────────────────────────────


def test_every_route_is_admin_only():
    routes = [route for route in content_router.routes if isinstance(route, APIRoute)]
    assert routes
    assert all("await require_admin(authorization)" in inspect.getsource(route.endpoint)
               for route in routes)


def test_the_router_is_registered():
    main = (BACKEND / "main.py").read_text(encoding="utf-8")
    assert "admin_exam_content_router" in main
    assert "app.include_router(admin_exam_content_router)" in main


def test_catalog_get_exposes_a_concrete_paginated_response_contract():
    import main as app_main
    from routers.admin_exam_content import ExamContentItem

    response = app_main.app.openapi()["paths"]["/admin/exam-content"]["get"][
        "responses"
    ]["200"]["content"]["application/json"]["schema"]
    assert response == {"$ref": "#/components/schemas/ExamContentListResponse"}
    assert {
        "kind", "id", "code", "title", "status", "exam_only", "is_public",
        "public_practice_enabled", "web_explanation_mode", "course_level",
        "cohort_ids", "mock_exams", "publish_ready", "readiness_reason",
        "web_explanation_count", "web_explanation_ready_count",
        "web_explanation_ready", "web_explanation_state",
    } <= set(ExamContentItem.model_fields)


def test_catalog_service_payload_satisfies_the_published_response_contract(db):
    from routers.admin_exam_content import ExamContentListResponse

    _seed_three(db)
    result = svc.list_exam_content()
    payload = ExamContentListResponse.model_validate({
        **result,
        "levels": svc.known_course_levels(),
    }).model_dump()

    assert payload["total"] == 3
    assert {row["status"] for row in payload["items"]} == {"published"}
    assert payload["failed_kinds"] == []
    assert payload["levels"] == ["C2", "C4"]


def test_replacing_the_cohort_set_is_not_a_post():
    """POST reads as "add one", which is not what this does. PUT would say it
    best but is NOT in _CORS_METHODS — adding a verb for one endpoint means a
    preflight that fails for every client holding a cached one, the exact
    failure that swallowed a student's paper on 2026-07-26. PATCH it is, with
    the contract stated in the docstring."""
    src = (BACKEND / "routers" / "admin_exam_content.py").read_text(encoding="utf-8")
    assert '@router.patch("/{kind}/{content_id}/cohorts")' in src
    assert '@router.post("/{kind}/{content_id}/cohorts")' not in src
    seg = src[src.index("async def set_cohorts("):]
    assert "Thay TOÀN BỘ" in seg[:600]


def test_the_verb_used_by_the_page_is_in_the_cors_allowlist():
    """A method the allowlist does not carry is blocked in the browser BEFORE it
    is sent — and nothing server-side ever sees it."""
    import main as app_main
    js = (BACKEND.parent / "frontend" / "public" / "js" / "admin-exam-content.js").read_text(encoding="utf-8")
    for verb, fn in (("PATCH", "window.api.patch("), ("GET", "window.api.get(")):
        if fn in js:
            assert verb in app_main._CORS_METHODS, verb
    assert "window.api.put(" not in js, "api.js has no put(), and PUT is not allowed by CORS"


# ── A broken library is NAMED, not silently rendered as empty ─────────


def test_a_failed_library_is_reported_to_the_caller(db, monkeypatch):
    """Keeping the other two visible is right, but a silent partial reads exactly
    like "there is no content" — and an admin then chooses a paper from an
    incomplete list without knowing it (Codex review, PR #864)."""
    _seed_three(db)
    real = db.table

    def flaky(name):
        if name == "listening_tests":
            raise RuntimeError("postgrest down")
        return real(name)

    monkeypatch.setattr(svc, "supabase_admin",
                        type("D", (), {"table": staticmethod(flaky)})())
    out = svc.list_exam_content()
    assert {r["kind"] for r in out["items"]} == {"reading", "writing"}
    assert out["failed_kinds"] == ["listening"]


def test_a_healthy_run_reports_no_failures(db):
    _seed_three(db)
    assert svc.list_exam_content()["failed_kinds"] == []


def test_the_endpoint_passes_the_failure_through():
    """A field the API never returns cannot warn anybody."""
    src = (BACKEND / "routers" / "admin_exam_content.py").read_text(encoding="utf-8")
    assert '"failed_kinds": res["failed_kinds"]' in src


def test_assigning_to_missing_content_is_a_404_not_a_500():
    src = (BACKEND / "routers" / "admin_exam_content.py").read_text(encoding="utf-8")
    seg = src[src.index("async def set_cohorts("):]
    assert "except LookupError as e:" in seg
    assert "HTTPException(404" in seg


# ── Migration 172 ─────────────────────────────────────────────────────


def _mig172() -> str:
    return (BACKEND / "migrations" / "172_fn_set_exam_content_cohorts.sql").read_text(encoding="utf-8")


def test_the_replacement_happens_in_one_statement():
    """Both the delete and the insert must be inside the SAME statement — as two
    calls, a failing delete left {old ∪ new} persisted while the request
    reported an error."""
    sql = _mig172()
    body = sql[sql.index("WITH wanted AS"):sql.index("RETURN jsonb_build_object")]
    assert "DELETE FROM exam_content_cohorts" in body
    assert "INSERT INTO exam_content_cohorts" in body


def test_re_sending_the_same_set_is_a_no_op_at_the_database():
    """The admin screen sends the whole state on every save; a double-click must
    not rewrite rows that are already right."""
    assert "ON CONFLICT (content_kind, content_id, cohort_id) DO NOTHING" in _mig172()


def test_the_kind_is_validated():
    assert "p_kind NOT IN ('reading', 'listening', 'writing')" in _mig172()


def test_it_is_backend_only():
    sql = _mig172()
    assert "SECURITY DEFINER" in sql
    assert "SET search_path = public, pg_temp" in sql
    assert re.search(r"REVOKE\s+EXECUTE[\s\S]{0,120}FROM\s+PUBLIC,\s*anon,\s*authenticated", sql)
    assert re.search(r"GRANT\s+EXECUTE[\s\S]{0,120}TO\s+service_role", sql)


def test_the_reverse_is_written_down_172():
    assert "TO REVERSE" in _mig172()
