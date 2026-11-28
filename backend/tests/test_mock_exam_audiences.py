"""MOCKORG-0086 G09-T31 PR1: audience / schedule service (FR-141, 142, 144).

In-memory fake of the PostgREST client; migration 445 itself is covered by
test_migration_445_mock_exam_audiences.py on a real PostgreSQL.
"""
from __future__ import annotations

import copy
import uuid

import pytest

from services import mock_exam_audience_service as aud
from services import mock_exam_service as exam_svc


def U(n: int) -> str:
    return f"00000000-0000-0000-0000-{n:012d}"


EXAM, COH_A, COH_B = U(900), U(800), U(801)
S1, S2, S3, S4, S5 = U(101), U(102), U(103), U(104), U(105)   # students
A1, A2, A3, A5 = U(201), U(202), U(203), U(205)               # their accounts (S4 has none)


class _Q:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None
        self._range = None

    # builders
    def select(self, *_a, **_k): self.op = "select"; return self
    def insert(self, payload): self.op, self.payload = "insert", payload; return self
    def update(self, payload): self.op, self.payload = "update", payload; return self
    def eq(self, col, val): self.filters.append(lambda r: str(r.get(col)) == str(val)); return self
    def in_(self, col, vals):
        vals = {str(v) for v in vals}
        self.filters.append(lambda r: str(r.get(col)) in vals); return self
    def is_(self, col, _null): self.filters.append(lambda r: r.get(col) is None); return self

    @property
    def not_(self):
        q = self

        class _Not:
            def in_(self, col, vals):
                vals = {str(v) for v in vals}
                q.filters.append(lambda r: str(r.get(col)) not in vals); return q
        return _Not()
    def order(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def range(self, a, b): self._range = (a, b); return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        match = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "insert":
            new = self.payload if isinstance(self.payload, list) else [self.payload]
            for row in new:
                row = {"id": str(uuid.uuid4()), **copy.deepcopy(row)}
                rows.append(row)
            self.db.writes.append((self.table, "insert", len(new)))
            data = new
        elif self.op == "update":
            for r in match:
                r.update(copy.deepcopy(self.payload))
            self.db.writes.append((self.table, "update", len(match)))
            data = match
        else:
            data = match
            if self._range:
                data = data[self._range[0]:self._range[1] + 1]
        return type("R", (), {"data": copy.deepcopy(data)})()


class FakeDB:
    def __init__(self):
        self.tables: dict[str, list] = {}
        self.writes: list = []

    def table(self, name):
        return _Q(self, name)


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    fake.tables["students"] = [
        {"id": S1, "user_id": A1, "full_name": "An"},
        {"id": S2, "user_id": A2, "full_name": "Bình"},
        {"id": S3, "user_id": A3, "full_name": "Chi"},
        {"id": S4, "user_id": None, "full_name": "Dũng"},
        {"id": S5, "user_id": A5, "full_name": "Em"},
    ]
    fake.tables["cohorts"] = [{"id": COH_A, "name": "Lớp A"}, {"id": COH_B, "name": "Lớp B"}]
    fake.tables["student_cohort_memberships"] = [
        {"id": U(1), "student_id": S1, "cohort_id": COH_A, "is_active": True},
        {"id": U(2), "student_id": S2, "cohort_id": COH_A, "is_active": True},
        {"id": U(3), "student_id": S4, "cohort_id": COH_A, "is_active": True},
        {"id": U(4), "student_id": S2, "cohort_id": COH_B, "is_active": True},
        {"id": U(5), "student_id": S3, "cohort_id": COH_B, "is_active": True},
    ]
    fake.tables["mock_exams"] = [{
        "id": EXAM, "status": "draft", "exam_mode": "sequential", "cohort_id": None,
        "skills": ["listening", "reading"], "listening_test_id": U(700),
        "reading_test_id": U(701), "starts_at": None, "open_until": None,
    }]
    fake.tables["mock_exam_audiences"] = []
    monkeypatch.setattr(aud, "supabase_admin", fake)
    monkeypatch.setattr(exam_svc, "supabase_admin", fake)
    flags = {"mock_exam_audiences": True, "mock_exam_audiences_learner": False}
    monkeypatch.setattr(aud.runtime_flags, "is_enabled",
                        lambda key, default=True, on_error=None: flags.get(key, default))
    monkeypatch.setattr(exam_svc, "_exam_content_readiness_issues", lambda exam, sections=None: [])
    fake.flags = flags
    return fake


def _exam(db):
    return db.tables["mock_exams"][0]


def _by_student(result):
    return {i["student_id"]: i for i in result["items"]}


def test_flag_off_refuses_every_route_and_falls_back_for_the_monitor(db):
    db.flags["mock_exam_audiences"] = False
    for call in (lambda: aud.get_audience(EXAM),
                 lambda: aud.update_audience(EXAM, {"add_cohort_ids": [COH_A]}, A1),
                 lambda: aud.schedule(EXAM, A1)):
        with pytest.raises(aud.AudienceError) as e:
            call()
        assert e.value.code == "audiences_disabled" and e.value.status == 409
    assert aud.expected_roster(_exam(db)) == (None, "legacy")
    assert db.writes == []


def test_three_sources_add_up_deduplicated_first_source_kept(db):
    out = aud.update_audience(EXAM, {"add_cohort_ids": [COH_A, COH_B],
                                     "add_student_ids": [S2, S5]}, A1)
    rows = _by_student(out)
    assert set(rows) == {S1, S2, S3, S4, S5}
    assert rows[S2]["source"] == {"kind": "cohort", "label": "Lớp A"}   # first class kept
    assert rows[S3]["source"]["label"] == "Lớp B"
    assert rows[S5]["source"]["kind"] == "learner"
    # Adding an existing learner again changes nothing.
    again = aud.update_audience(EXAM, {"add_student_ids": [S1]}, A1)
    assert len(again["items"]) == 5 and _by_student(again)[S1]["source"]["kind"] == "cohort"
    # cohort_id pointer: first class of the list.
    assert _exam(db)["cohort_id"] == COH_A


def test_learner_without_account_is_listed_unselected(db):
    rows = _by_student(aud.update_audience(EXAM, {"add_cohort_ids": [COH_A]}, A1))
    assert rows[S4]["selected"] is False and rows[S4]["excluded_reason"] == "no_account"
    with pytest.raises(aud.AudienceError) as e:
        aud.update_audience(EXAM, {"set": [{"student_id": S4, "selected": True}]}, A1)
    assert e.value.code == "no_account"


def test_skills_per_person_must_be_a_subset_of_the_exam(db):
    aud.update_audience(EXAM, {"add_cohort_ids": [COH_A]}, A1)
    rows = _by_student(aud.get_audience(EXAM))
    assert rows[S1]["skills"] == ["listening", "reading"]
    for bad in (["writing"], [], ["listening", "speaking"]):
        writes = len(db.writes)
        with pytest.raises(aud.AudienceError) as e:
            aud.update_audience(EXAM, {"set": [{"user_id": A1, "skills": bad}]}, A1)
        assert e.value.code == "skills_not_in_exam" and len(db.writes) == writes
    out = aud.update_audience(EXAM, {"set": [{"user_id": A1, "skills": ["reading"]}]}, A1)
    assert _by_student(out)[S1]["skills"] == ["reading"]


def test_refused_request_writes_nothing(db):
    aud.update_audience(EXAM, {"add_cohort_ids": [COH_A]}, A1)
    writes = len(db.writes)
    with pytest.raises(aud.AudienceError):
        aud.update_audience(EXAM, {"add_cohort_ids": [COH_B],
                                   "set": [{"user_id": A1, "skills": ["writing"]}]}, A1)
    assert len(db.writes) == writes
    assert len(aud.get_audience(EXAM)["items"]) == 3


def test_groups_are_refused_until_saved_groups_exist(db):
    with pytest.raises(aud.AudienceError) as e:
        aud.update_audience(EXAM, {"add_group_ids": [U(1)]}, A1)
    assert e.value.code == "groups_unavailable"


def test_unknown_learner_and_bad_window_are_refused(db):
    with pytest.raises(aud.AudienceError) as e:
        aud.update_audience(EXAM, {"add_student_ids": [U(999)]}, A1)
    assert e.value.code == "student_not_found"
    with pytest.raises(aud.AudienceError) as e:
        aud.update_audience(EXAM, {"window": {"open_from": "2026-12-02T00:00:00Z",
                                              "open_until": "2026-12-01T00:00:00Z"}}, A1)
    assert e.value.code == "invalid_window"


def test_snapshot_then_refresh_adds_only_new_class_members(db):
    """Q12: adding a class snapshots it; "Cập nhật theo lớp" adds later joiners."""
    aud.update_audience(EXAM, {"add_cohort_ids": [COH_A]}, A1)
    aud.update_audience(EXAM, {"set": [{"user_id": A2, "selected": False}]}, A1)
    db.tables["student_cohort_memberships"].append(
        {"id": U(9), "student_id": S5, "cohort_id": COH_A, "is_active": True})
    assert S5 not in _by_student(aud.get_audience(EXAM))          # snapshot: not automatic
    rows = _by_student(aud.update_audience(EXAM, {"refresh_cohorts": True}, A1))
    assert rows[S5]["source"]["label"] == "Lớp A"
    assert rows[S2]["selected"] is False                         # earlier edit kept


def test_listening_reading_only_live_exam_schedules(db, monkeypatch):
    aud.update_audience(EXAM, {"add_cohort_ids": [COH_A]}, A1)
    with pytest.raises(aud.AudienceError) as e:
        aud.schedule(EXAM, A1)
    assert e.value.code == "not_ready" and e.value.extra["missing"] == ["starts_at"]
    _exam(db)["starts_at"] = "2026-12-01T01:00:00Z"
    published = {}
    monkeypatch.setattr(exam_svc, "admin_update_exam",
                        lambda eid, patch, actor: published.update(patch) or {})
    out = aud.schedule(EXAM, A1)
    assert published == {"status": "published"} and out["selected"] == 2


def test_schedule_lists_what_is_missing(db):
    _exam(db).update({"reading_test_id": None, "skills": ["reading", "writing"]})
    missing = aud.schedule_missing(_exam(db), [])
    assert missing == ["reading_paper", "writing_paper", "audience", "starts_at"]


def test_live_exam_with_learners_outside_its_class_waits_for_the_learner_gate(db, monkeypatch):
    aud.update_audience(EXAM, {"add_cohort_ids": [COH_A], "add_student_ids": [S5]}, A1)
    _exam(db)["starts_at"] = "2026-12-01T01:00:00Z"
    monkeypatch.setattr(exam_svc, "admin_update_exam", lambda *a: {})
    with pytest.raises(aud.AudienceError) as e:
        aud.schedule(EXAM, A1)
    assert e.value.code == "learner_gate_not_ready" and e.value.extra["outside"] == 1
    db.flags["mock_exam_audiences_learner"] = True
    assert aud.schedule(EXAM, A1)["status"] == "published"


def test_self_paced_mirrors_assignments_only_once_scheduled(db, monkeypatch):
    _exam(db).update({"exam_mode": "retake"})
    assigned, removed = [], []
    monkeypatch.setattr(aud.assign_svc, "assign",
                        lambda eid, rows, created_by: assigned.append(rows) or {})
    monkeypatch.setattr(aud.assign_svc, "remove",
                        lambda eid, uid, admin_id=None: removed.append(uid) or {})
    monkeypatch.setattr(exam_svc, "admin_update_exam",
                        lambda eid, patch, actor: _exam(db).update(patch) or {})
    window = {"open_from": "2026-12-01T00:00:00Z", "open_until": "2026-12-03T00:00:00Z"}
    aud.update_audience(EXAM, {"add_cohort_ids": [COH_A]}, A1)
    assert assigned == []                                      # draft: not mirrored
    with pytest.raises(aud.AudienceError) as e:
        aud.schedule(EXAM, A1)
    assert e.value.extra["missing"] == ["window"]
    aud.update_audience(EXAM, {"window": window}, A1)
    aud.schedule(EXAM, A1)
    assert {r["user_id"] for r in assigned[-1]} == {A1, A2}
    assert assigned[-1][0]["skills"] == ["listening", "reading"]
    # Published: a deselect un-assigns that learner only.
    aud.update_audience(EXAM, {"set": [{"user_id": A2, "selected": False}]}, A1)
    assert removed == [A2] and {r["user_id"] for r in assigned[-1]} == {A1}


def test_published_self_paced_change_without_window_is_refused_before_writing(db, monkeypatch):
    _exam(db).update({"exam_mode": "self_paced", "status": "published"})
    writes = len(db.writes)
    with pytest.raises(aud.AudienceError) as e:
        aud.update_audience(EXAM, {"add_cohort_ids": [COH_A]}, A1)
    assert e.value.code == "window_required" and len(db.writes) == writes


def test_monitor_roster_from_audiences_keys_like_the_old_roster(db):
    assert aud.expected_roster(_exam(db)) == (None, "legacy")  # no rows yet → old roster
    aud.update_audience(EXAM, {"add_cohort_ids": [COH_A, COH_B]}, A1)
    roster, source = aud.expected_roster(_exam(db))
    assert source == "audiences"
    assert set(roster) == {A1, A2, A3}                         # S4 unselected (no account)
    assert roster[A1] == {"user_id": A1, "name": "An", "skills": ["listening", "reading"],
                          "open_until": None}


def test_archived_exam_is_locked(db):
    _exam(db)["status"] = "archived"
    with pytest.raises(aud.AudienceError) as e:
        aud.update_audience(EXAM, {"add_cohort_ids": [COH_A]}, A1)
    assert e.value.code == "exam_locked" and e.value.status == 409


def test_monitor_self_paced_fields_follow_the_shared_timeline(monkeypatch):
    from datetime import datetime, timezone
    monkeypatch.setattr(exam_svc, "_section_duration_seconds",
                        lambda exam, s: {"listening": 1800, "reading": 3600}[s])
    now = datetime(2026, 12, 1, 8, 50, tzinfo=timezone.utc)
    sitting = {"listening_started_at": "2026-12-01T08:00:00Z",
               "listening_submitted_at": "2026-12-01T08:20:00Z"}
    out = exam_svc._self_paced_fields(sitting, {}, ["listening", "reading"], {}, now)
    assert out == {"self_paced_state": "in_progress", "current_section": "reading",
                   "section_time_left_seconds": 1800,
                   "started_at": "2026-12-01T08:00:00+00:00",
                   "expected_end_at": "2026-12-01T09:20:00+00:00"}
    missed = exam_svc._self_paced_fields(None, {}, ["listening"],
                                         {"open_until": "2026-12-01T08:00:00Z"}, now)
    assert missed["self_paced_state"] == "missed" and missed["current_section"] is None


@pytest.fixture
def admin(monkeypatch):
    from routers import admin_mock_exams as r

    async def fake(_auth):
        return {"id": A1}
    monkeypatch.setattr(r, "require_admin", fake)
    return r


def test_router_refuses_445_fields_while_the_flag_is_off(admin, db, monkeypatch):
    import asyncio
    from fastapi import HTTPException
    db.flags["mock_exam_audiences"] = False
    monkeypatch.setattr(exam_svc, "admin_update_exam", lambda *a: pytest.fail("must not write"))
    monkeypatch.setattr(exam_svc, "admin_create_exam", lambda *a: pytest.fail("must not write"))
    for call in (
        lambda: admin.update_exam(EXAM, admin.ExamPatch(skills=["listening"]), authorization="x"),
        lambda: admin.create_exam(admin.ExamCreate(code="C", title="T", starts_at="2026-12-01T08:00:00Z"),
                                  authorization="x"),
        lambda: admin.get_audience(EXAM, authorization="x"),
    ):
        with pytest.raises(HTTPException) as e:
            asyncio.run(call())
        assert e.value.status_code == 409 and e.value.detail["code"] == "audiences_disabled"


def test_router_create_writes_445_fields_by_a_patch_after_create(admin, db, monkeypatch):
    import asyncio
    calls = []
    monkeypatch.setattr(exam_svc, "admin_create_exam",
                        lambda payload, actor: calls.append(("create", payload)) or {"id": EXAM})
    monkeypatch.setattr(exam_svc, "admin_update_exam",
                        lambda eid, patch, actor: calls.append(("patch", patch)) or {"id": eid})
    asyncio.run(admin.create_exam(
        admin.ExamCreate(code="C", title="T", exam_mode="self_paced",
                         skills=["reading", "listening", "reading"]), authorization="x"))
    assert calls[0][0] == "create" and "skills" not in calls[0][1]
    assert calls[0][1]["exam_mode"] == "retake"
    assert calls[1] == ("patch", {"skills": ["reading", "listening"]})


def test_router_maps_audience_errors_to_their_status(admin, db):
    import asyncio
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        asyncio.run(admin.update_audience(EXAM, admin.AudiencePatch(add_group_ids=[U(1)]),
                                          authorization="x"))
    assert e.value.status_code == 422 and e.value.detail["code"] == "groups_unavailable"


def test_setup_response_schemas_describe_the_existing_http_json(admin, db, monkeypatch):
    from fastapi import FastAPI
    from fastapi.routing import APIRoute
    from fastapi.testclient import TestClient
    from pydantic import TypeAdapter

    app = FastAPI()
    app.include_router(admin.router)
    api_paths = app.openapi()["paths"]
    response_models = {
        (method.lower(), route.path): route.response_model
        for route in app.routes if isinstance(route, APIRoute) for method in route.methods
    }
    collection = "/admin/mock-exams"
    template = f"{collection}/{{exam_id}}"
    exam_path = f"{collection}/{EXAM}"
    audience_path = f"{exam_path}/audience"

    def assert_response(method, contract_path, response, model, expected):
        assert response_models[method, contract_path] is None
        schema = api_paths[contract_path][method]["responses"]["200"]
        assert schema["content"]["application/json"]["schema"]["$ref"] == f"#/components/schemas/{model.__name__}"
        assert response.status_code == 200
        assert response.json() == expected
        TypeAdapter(model).validate_python(expected, strict=True)

    _exam(db).update({"code": "KT1", "title": "Kỳ thi", "starts_at": "2026-12-01T01:00:00Z"})
    with TestClient(app) as client:
        created = {**_exam(db), "id": U(901), "code": "KT2", "title": "Kỳ thi mới"}
        monkeypatch.setattr(exam_svc, "admin_create_exam", lambda *_: created)
        made = client.post(collection, json={"code": created["code"], "title": created["title"]})
        assert_response("post", collection, made, admin.ExamWriteResponse,
                        {**created, "exam_mode": "sequential", "exam_mode_v2": "live"})

        changed = client.patch(exam_path, json={"title": "Kỳ thi đã sửa"})
        assert_response("patch", template, changed, admin.ExamWriteResponse,
                        {**_exam(db), "exam_mode": "sequential", "exam_mode_v2": "live"})
        assert changed.json()["title"] == "Kỳ thi đã sửa"

        added = client.patch(audience_path, json={"add_cohort_ids": [COH_A]})
        draft = aud.get_audience(EXAM)
        assert len(draft["items"]) == 3
        assert_response("patch", f"{template}/audience", added, admin.ExamAudiencePatchResponse, draft)
        assert_response("get", f"{template}/audience", client.get(audience_path), admin.ExamAudienceResponse, draft)

        scheduled = client.post(f"{exam_path}/schedule")
        assert_response("post", f"{template}/schedule", scheduled, admin.ExamScheduleResponse,
                        {"status": "published", "selected": 2})

        _, window = _published_self_paced(db, monkeypatch)
        monkeypatch.setattr(aud.assign_svc, "assign", lambda *args, **kwargs: {"refresh_failed": [A1]})
        mirrored = client.patch(audience_path, json={"window": window})
        assert_response("patch", f"{template}/audience", mirrored, admin.ExamAudiencePatchResponse, {
            **aud.get_audience(EXAM),
            "mirror_failed": True,
            "mirror_locked": [],
            "mirror_refresh_failed": [A1],
        })


def test_monitor_says_when_the_audience_read_failed(db, monkeypatch):
    """CR R2: a failed read falls back to the old roster but is labelled."""
    aud.update_audience(EXAM, {"add_cohort_ids": [COH_A]}, A1)
    monkeypatch.setattr(aud, "_rows", lambda _id: (_ for _ in ()).throw(RuntimeError("db down")))
    assert aud.expected_roster(_exam(db)) == (None, "fallback_error")
    monkeypatch.setattr(exam_svc, "_legacy_roster", lambda exam: {"legacy": {}})
    assert exam_svc._roster_with_source(_exam(db)) == ({"legacy": {}}, "fallback_error")


def _published_self_paced(db, monkeypatch):
    _exam(db).update({"exam_mode": "self_paced", "status": "published"})
    calls = {"assign": [], "remove": []}
    monkeypatch.setattr(aud.assign_svc, "assign",
                        lambda eid, rows, created_by: calls["assign"].append(rows) or {})
    monkeypatch.setattr(aud.assign_svc, "remove",
                        lambda eid, uid, admin_id=None: calls["remove"].append(uid) or {})
    window = {"open_from": "2026-12-01T00:00:00Z", "open_until": "2026-12-03T00:00:00Z"}
    return calls, window


def test_mirror_io_failure_reports_mirror_failed_with_the_stored_list(db, monkeypatch):
    calls, window = _published_self_paced(db, monkeypatch)

    def boom(*_a, **_k):
        raise RuntimeError("connection reset")
    monkeypatch.setattr(aud.assign_svc, "assign", boom)
    out = aud.update_audience(EXAM, {"add_cohort_ids": [COH_A], "window": window}, A1)
    assert out["mirror_failed"] is True and len(out["items"]) == 3
    monkeypatch.setattr(aud.assign_svc, "assign", lambda *a, **k: {})
    assert aud.update_audience(EXAM, {"window": window}, A1)["mirror_failed"] is False


def test_mirror_rules_are_checked_before_any_write(db, monkeypatch):
    """CR R2: assign()'s refusals (window, unservable skill) run before writing."""
    calls, window = _published_self_paced(db, monkeypatch)
    _exam(db)["reading_test_id"] = None               # reading can no longer be served
    writes = len(db.writes)
    with pytest.raises(aud.AudienceError) as e:
        aud.update_audience(EXAM, {"add_cohort_ids": [COH_A], "window": window}, A1)
    assert e.value.code == "skill_not_servable"
    _exam(db)["reading_test_id"] = U(701)
    with pytest.raises(aud.AudienceError) as e:
        aud.update_audience(EXAM, {"add_cohort_ids": [COH_A],
                                   "window": {"open_from": "2026-12-01T00:00:00Z"}}, A1)
    assert e.value.code == "window_required"
    assert len(db.writes) == writes and calls["assign"] == []


def test_emptying_assignable_skills_unassigns_that_learner(db, monkeypatch):
    calls, window = _published_self_paced(db, monkeypatch)
    _exam(db)["skills"] = ["listening", "speaking"]
    aud.update_audience(EXAM, {"add_cohort_ids": [COH_A], "window": window}, A1)
    aud.update_audience(EXAM, {"set": [{"user_id": A1, "skills": ["speaking"]}]}, A1)
    assert calls["remove"] == [A1]
    assert {r["user_id"] for r in calls["assign"][-1]} == {A2}


def test_resent_deselect_after_a_failed_unassign_really_unassigns(db, monkeypatch):
    """HOLD #2565 P1: the first PATCH stores selected=false but remove() fails;
    the same PATCH re-sent must un-assign before reporting mirror_failed=false."""
    calls, window = _published_self_paced(db, monkeypatch)
    aud.update_audience(EXAM, {"add_cohort_ids": [COH_A], "window": window}, A1)
    body = {"set": [{"user_id": A2, "selected": False}]}

    def boom(*_a, **_k):
        raise RuntimeError("connection reset")
    monkeypatch.setattr(aud.assign_svc, "remove", boom)
    out = aud.update_audience(EXAM, body, A1)
    assert out["mirror_failed"] is True
    assert _by_student(out)[S2]["selected"] is False          # stored before the failure
    monkeypatch.setattr(aud.assign_svc, "remove",
                        lambda eid, uid, admin_id=None: calls["remove"].append(uid) or {})
    out = aud.update_audience(EXAM, body, A1)
    assert calls["remove"] == [A2] and out["mirror_failed"] is False


def test_resent_deselect_voids_a_sitting_left_open_by_a_partial_unassign(db, monkeypatch):
    """remove() deletes the assignment, then a void fails and it raises. On the
    re-sent PATCH remove() finds no assignment (no-op); the open sitting must
    still be voided, and a void failure keeps mirror_failed=true."""
    calls, window = _published_self_paced(db, monkeypatch)
    aud.update_audience(EXAM, {"add_cohort_ids": [COH_A], "window": window}, A1)
    db.tables["mock_exam_assignments"] = [{"id": U(600), "exam_id": EXAM, "user_id": A2}]
    db.tables["mock_exam_sittings"] = [
        {"id": U(610), "mock_exam_id": EXAM, "user_id": A2, "status": "in_progress"},
        {"id": U(611), "mock_exam_id": EXAM, "user_id": A2, "status": "released"},
        {"id": U(612), "mock_exam_id": EXAM, "user_id": A1, "status": "in_progress"}]

    def partial_remove(eid, uid, admin_id=None):
        db.tables["mock_exam_assignments"] = [
            r for r in db.tables["mock_exam_assignments"] if r["user_id"] != uid]
        raise RuntimeError("void failed")
    monkeypatch.setattr(aud.assign_svc, "remove", partial_remove)
    body = {"set": [{"user_id": A2, "selected": False}]}
    assert aud.update_audience(EXAM, body, A1)["mirror_failed"] is True

    monkeypatch.setattr(aud.assign_svc, "remove", lambda eid, uid, admin_id=None: {})
    voided = []

    def void_fails(sid, admin_id, reason=""):
        raise RuntimeError("still down")
    monkeypatch.setattr(aud.exam_svc, "void_sitting", void_fails)
    assert aud.update_audience(EXAM, body, A1)["mirror_failed"] is True

    def void(sid, admin_id, reason=""):
        voided.append(sid)
        next(r for r in db.tables["mock_exam_sittings"] if r["id"] == sid)["status"] = "void"
        return {}
    monkeypatch.setattr(aud.exam_svc, "void_sitting", void)
    assert aud.update_audience(EXAM, body, A1)["mirror_failed"] is False
    assert voided == [U(610)]                                 # not A1's, not the released one


def test_an_unassigned_learner_with_an_assignment_left_keeps_its_sitting(db, monkeypatch):
    """If remove() leaves the assignment (it raced a re-assign), no sitting is voided."""
    calls, window = _published_self_paced(db, monkeypatch)
    aud.update_audience(EXAM, {"add_cohort_ids": [COH_A], "window": window}, A1)
    db.tables["mock_exam_assignments"] = [{"id": U(600), "exam_id": EXAM, "user_id": A2}]
    db.tables["mock_exam_sittings"] = [
        {"id": U(610), "mock_exam_id": EXAM, "user_id": A2, "status": "in_progress"}]
    monkeypatch.setattr(aud.exam_svc, "void_sitting",
                        lambda *a, **k: pytest.fail("must not void"))
    out = aud.update_audience(EXAM, {"set": [{"user_id": A2, "selected": False}]}, A1)
    assert out["mirror_failed"] is False and calls["remove"] == [A2]


def test_window_writes_only_the_bounds_sent(db):
    aud.update_audience(EXAM, {"add_cohort_ids": [COH_A],
                               "window": {"open_until": "2026-12-03T00:00:00Z"}}, A1)
    out = aud.update_audience(EXAM, {"window": {"open_from": "2026-12-01T00:00:00Z"}}, A1)
    assert {(i["open_from"], i["open_until"]) for i in out["items"]} == {
        ("2026-12-01T00:00:00Z", "2026-12-03T00:00:00Z")}


def test_row_from_a_deleted_class_is_labelled_not_hidden(monkeypatch):
    """445: deleting a class keeps the audience row (source_removed_at); the
    list says so instead of an empty source label."""
    monkeypatch.setattr(aud, "_students", lambda ids: {"s1": {"full_name": "An"}})
    monkeypatch.setattr(aud, "_cohort_labels", lambda ids: {})
    out = aud._shape([{"student_id": "s1", "user_id": "u1", "source_kind": "cohort",
                       "source_cohort_id": None, "skills": ["reading"], "selected": True}])
    assert out["items"][0]["source"] == {"kind": "cohort", "label": "Lớp đã xoá"}


def test_account_linked_after_adding_is_read_before_selecting(db, monkeypatch):
    """Codex P2 (e0186cf3): S4 is added without an account (user_id NULL,
    no_account). Once students links an account, selecting the existing row
    stores the link and works; the row keeps its class source."""
    aud.update_audience(EXAM, {"add_cohort_ids": [COH_A]}, A1)
    with pytest.raises(aud.AudienceError) as e:
        aud.update_audience(EXAM, {"set": [{"student_id": S4, "selected": True}]}, A1)
    assert e.value.code == "no_account"
    next(s for s in db.tables["students"] if s["id"] == S4)["user_id"] = U(204)
    out = aud.update_audience(EXAM, {"set": [{"student_id": S4, "selected": True}]}, A1)
    row = _by_student(out)[S4]
    assert row["selected"] is True and row["user_id"] == U(204) and row["excluded_reason"] is None
    assert row["source"]["kind"] == "cohort"
    stored = next(r for r in db.tables["mock_exam_audiences"] if r["student_id"] == S4)
    assert stored["user_id"] == U(204) and stored["source_cohort_id"] == COH_A
    # The new account can also be named by user_id now.
    out = aud.update_audience(EXAM, {"set": [{"user_id": U(204), "selected": False}]}, A1)
    assert _by_student(out)[S4]["selected"] is False


def test_locked_and_failed_sitting_refreshes_are_reported(db, monkeypatch):
    """Codex P2 (e0186cf3): assign() updates the assignment but cannot carry the
    edit onto a sitting whose clock started (locked) or whose refresh errored
    (refresh_failed). The PATCH says so instead of a silent success."""
    calls, window = _published_self_paced(db, monkeypatch)
    aud.update_audience(EXAM, {"add_cohort_ids": [COH_A], "window": window}, A1)
    monkeypatch.setattr(aud.assign_svc, "assign",
                        lambda eid, rows, created_by: {"locked": [A1], "refresh_failed": []})
    out = aud.update_audience(EXAM, {"set": [{"user_id": A1, "skills": ["reading"]}]}, A1)
    assert out["mirror_locked"] == [A1] and out["mirror_refresh_failed"] == []
    assert out["mirror_failed"] is False                       # a deliberate refusal, not an error
    monkeypatch.setattr(aud.assign_svc, "assign",
                        lambda eid, rows, created_by: {"locked": [], "refresh_failed": [A2]})
    out = aud.update_audience(EXAM, {"set": [{"user_id": A2, "skills": ["reading"]}]}, A1)
    assert out["mirror_refresh_failed"] == [A2] and out["mirror_failed"] is True
    monkeypatch.setattr(aud.assign_svc, "assign", lambda eid, rows, created_by: {})
    out = aud.update_audience(EXAM, {"set": [{"user_id": A2, "skills": ["reading"]}]}, A1)
    assert out["mirror_failed"] is False and out["mirror_locked"] == []


def test_published_live_exam_refuses_a_new_outside_learner(db, monkeypatch):
    """Codex P2 (e0186cf3): with the learner gate off, a published live exam
    cannot gain a learner outside its class through PATCH (schedule() already
    refuses one); the audience stays unchanged. Learners already selected and
    class members are still editable."""
    monkeypatch.setattr(exam_svc, "admin_update_exam",
                        lambda eid, patch, actor: _exam(db).update(patch) or {"id": eid})
    _exam(db)["starts_at"] = "2026-12-01T01:00:00Z"
    aud.update_audience(EXAM, {"add_cohort_ids": [COH_A]}, A1)
    assert aud.schedule(EXAM, A1)["status"] == "published"
    before = copy.deepcopy(db.tables["mock_exam_audiences"])
    for body in ({"add_student_ids": [S3]}, {"add_cohort_ids": [COH_B]}):
        with pytest.raises(aud.AudienceError) as e:
            aud.update_audience(EXAM, body, A1)
        assert e.value.code == "learner_gate_not_ready"
        assert db.tables["mock_exam_audiences"] == before
    out = aud.update_audience(EXAM, {"set": [{"user_id": A1, "skills": ["reading"]}]}, A1)
    assert _by_student(out)[S1]["skills"] == ["reading"]
    # Once the room door reads audiences (learner gate on), the same add works.
    db.flags["mock_exam_audiences_learner"] = True
    out = aud.update_audience(EXAM, {"add_student_ids": [S3]}, A1)
    assert _by_student(out)[S3]["selected"] is True            # gate on: allowed
