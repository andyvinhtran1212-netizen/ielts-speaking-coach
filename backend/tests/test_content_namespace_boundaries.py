"""Persisted namespace flags on the real generic HTTP/auth boundary.

These DB doubles verify consumers, not SQL trigger stamping. Migration 381's
PostgreSQL matrix is required before any namespace release.
"""
from uuid import uuid4
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from test_listening_blackeye import env
from test_listening_blackeye_guard_identity import admin_env


def _assignment_db(tables):
    from test_class_archive_learner_reads import _Db, _Q
    from blackeye_query_double import matches_blackeye_filter
    class Query(_Q):
        def limit(self, maximum):
            self.maximum = maximum
            return self

        def or_(self, expression):
            return self._keep(lambda row: matches_blackeye_filter(row, expression))

        def execute(self):
            result = super().execute()
            result.data = result.data[:getattr(self, "maximum", len(result.data))]
            return result

    class Database(_Db):
        def table(self, name):
            return Query(self, name)

    return Database(**tables)


@pytest.mark.parametrize("key,table", [
    ("test_id", "listening_tests"), ("drill_id", "listening_tests"),
    ("content_id", "listening_content"), ("attempt_id", "listening_test_attempts"),
    ("session_id", "dictation_sessions"), ("exercise_id", "listening_content"),
])
@pytest.mark.parametrize("state", [False, True, None, "absent", "missing_row"])
def test_generic_admin_http_uses_each_persisted_flag(admin_env, key, table, state):
    e = admin_env
    target = str(uuid4())
    row = {"id": target, "test_id": None, "programme_id": "ielts", "metadata": {}}
    if state not in {"absent", "missing_row"}:
        row["restricted"] = state
    if state is True:
        row["source_test_id"] = str(uuid4())  # source deleted; sticky flag survives
    e.db.rows.setdefault(table, [])
    if state != "missing_row":
        e.db.rows[table].append(row)
    if key == "exercise_id":
        content_id, target = target, str(uuid4())
        e.db.rows["listening_exercises"].append({"id": target, "content_id": content_id})
    response = e.client.get(f'/admin/listening/tests/{e.normal["id"]}', params={key: target})
    assert response.status_code == (200 if state is False else 404), response.text
    if state is not False:
        assert response.headers["cache-control"] == "private, no-store"
        assert all(cols != "*" and patch is None for _, cols, patch in e.db.calls)
    assert e.db.rpcs == []


def test_assignment_flags_are_batched_and_missing_targets_fail_closed(admin_env):
    from services import listening_blackeye
    e = admin_env
    e.db.rows["content_access_namespaces"].append({"programme_id": "next-book", "scope": "assignment_only"})
    tests = [{"id": f"test-{n}", "restricted": n % 2 == 0} for n in range(235)]
    e.db.rows["listening_tests"] = tests
    rows = [{"id": f"assignment-{n}", "skill": "listening", "content_id": t["id"]}
            for n, t in enumerate(tests)]
    rows.extend([
        {"id": "unresolved", "skill": "listening", "content_id": "gone"},
        {"id": "new-namespace", "content_config": {"programme_id": "next-book"}},
        {"id": "ordinary-speaking", "skill": "speaking", "content_id": "topic"},
    ])
    visible = listening_blackeye.generic_assignments(e.db, rows)
    assert [r["id"] for r in visible] == [*[f"assignment-{n}" for n in range(235) if n % 2], "ordinary-speaking"]
    assert [(t, cols) for t, cols, _ in e.db.calls] == [
        ("content_access_namespaces", "programme_id"), *[("listening_tests", "id,restricted")] * 3]
    assert all(len(v) <= 100 for q in e.db.queries for _, v, op in q.filters if op == "in")


def test_sorh_admin_content_http_filters_null_test_provenance_before_page(admin_env, monkeypatch):
    from routers import listening
    from test_listening_overview import _FakeSB
    e = admin_env
    rows = [
        {"id": "marker", "restricted": True, "test_id": None, "metadata": {"blackeye": {}}},
        {"id": "source", "restricted": True, "test_id": None, "source_test_id": "hidden"},
        {"id": "ancestor", "restricted": True, "test_id": None, "parent_content_id": "source"},
        {"id": "public-one", "restricted": False, "test_id": None},
        {"id": "public-two", "restricted": False, "test_id": None},
    ]
    e.db.rows["listening_content"] = rows
    original, store = e.db.table, _FakeSB(e.db.rows)
    def table(name):
        return store.table(name) if name == "v_listening_content_public" else original(name)
    monkeypatch.setattr(listening.supabase_admin, "table", table)
    response = e.client.get('/admin/listening/content', params={"limit": 1, "offset": 1})
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 2
    assert [r["id"] for r in response.json()["items"]] == ["public-two"]


def test_programme_overview_and_lesson_http_exclude_registry_namespaces(monkeypatch):
    from routers import listening
    from test_listening_overview import _FakeSB
    lesson_id = str(uuid4())
    db = _FakeSB({
        "content_access_namespaces": [{"programme_id": "general-listening-practice", "scope": "assignment_only"}],
        "listening_content_packages": [
            {"id": "hidden-package", "programme_id": "general-listening-practice", "status": "published", "title": "HIDDEN"},
            {"id": "public-package", "programme_id": "ielts-listening-practice", "status": "published", "title": "Ordinary"},
        ],
        "listening_lessons": [{"id": lesson_id, "programme_id": "general-listening-practice", "status": "published", "title": "HIDDEN"}],
        "listening_tests": [], "listening_test_attempts": [],
    })
    monkeypatch.setattr(listening, "supabase_admin", db)
    monkeypatch.setattr(listening, "_require_auth", AsyncMock(return_value={"id": "learner"}))
    cards, resume, recent, partial = listening._load_programme_overview("learner")
    assert [row["id"] for row in cards] == ["ielts-listening-practice"]
    assert resume is None and recent == [] and partial is False
    app = FastAPI()
    app.include_router(listening.user_router)
    with TestClient(app) as client:
        response = client.get('/api/listening/programmes/general-listening-practice/lessons')
        assert response.status_code == 200, response.text
        assert response.json()["items"] == [] and response.json()["total"] == 0
        response = client.get(f'/api/listening/lessons/{lesson_id}')
        assert response.status_code == 404, response.text
        assert "HIDDEN" not in response.text


@pytest.mark.parametrize("table,builder", [
    ("listening_tests", "v_listening_tests_public"),
    ("listening_content", "v_listening_content_public"),
    ("listening_test_attempts", "v_listening_attempts_public"),
    ("dictation_sessions", "v_dictation_sessions_public"),
])
def test_shared_paging_and_id_joins_use_views(admin_env, monkeypatch, table, builder):
    from routers import listening
    from services import class_assignment_service, cohort_progress_aggregator
    e = admin_env
    e.db.rows[table] = [{"id": "ordinary", "restricted": False},
                        {"id": "hidden", "restricted": True}]
    for paged in (class_assignment_service._paged, cohort_progress_aggregator._paged):
        e.db.calls.clear()
        assert paged(e.db, table, "id", lambda q: q) == [{"id": "ordinary"}]
        assert e.db.calls == [(builder, "id", None)]
    e.db.calls.clear()
    assert listening._rows_by_id(table, ["ordinary", "hidden"], "id") == {
        "ordinary": {"id": "ordinary"}}
    assert e.db.calls == [(builder, "id", None)]


def test_dictation_report_http_excludes_sticky_flag_before_payload(admin_env):
    e = admin_env
    session_id = str(uuid4())
    e.db.rows["dictation_sessions"] = [{
        "id": session_id, "user_id": e.actor["id"], "test_id": None,
        "restricted": True, "results": ["HIDDEN-RESULT"],
    }]
    response = e.client.get(f'/api/listening/tests/dictation/session/{session_id}')
    assert response.status_code == 404, response.text
    assert "HIDDEN-RESULT" not in response.text
    assert e.db.calls == [("v_dictation_sessions_public", "*", None)]


def test_source_book_public_readers_use_registry_and_flags(admin_env):
    from services import listening_source_collection as source
    from test_listening_overview import _FakeSB
    from models.listening_source_collection import SOURCE_PROGRAMME, SOURCE_CONTRACT
    db = _FakeSB({
        "content_access_namespaces": [],
        "listening_content_packages": [{"id": "package", "status": "published",
            "programme_id": SOURCE_PROGRAMME, "validation_summary": {"source_contract": SOURCE_CONTRACT}}],
        "listening_lessons": [{"id": "lesson", "package_id": "package", "programme_id": SOURCE_PROGRAMME,
            "status": "published", "sequence_num": 1}],
        "listening_tests": [dict(id=str(n), content_package_id="package", programme_id=SOURCE_PROGRAMME,
            status="published", is_public=True, scoring_policy="report_only", restricted=bool(n)) for n in (0, 1)],
    })
    package = source.published_package(db)
    assert [row["id"] for row in source.source_forms(db, package)] == ["0"]
    assert [row["id"] for row in source.source_lessons(db, package)] == ["lesson"]
    db.tables["content_access_namespaces"] = [{"programme_id": SOURCE_PROGRAMME, "scope": "assignment_only"}]
    with pytest.raises(HTTPException) as error:
        source.published_package(db)
    assert error.value.status_code == 404
    assert source.source_lessons(db, package) == []


def test_legacy_level_suggestions_use_public_namespace(monkeypatch):
    from services import exam_content_service
    from test_listening_overview import _FakeSB
    db = _FakeSB({"listening_tests": [
        {"id": "public", "course_level": "L2", "restricted": False},
        {"id": "hidden", "course_level": "HIDDEN-LEVEL", "restricted": True},
    ], "reading_tests": [], "writing_prompts": []})
    monkeypatch.setattr(exam_content_service, "supabase_admin", db)
    assert exam_content_service.known_course_levels_with_failures() == (["L2"], [])


@pytest.mark.parametrize("state", [True, None, "absent", "missing_row"])
def test_assignment_create_http_rejects_flag_before_paper_or_service(admin_env, monkeypatch, state):
    from routers import admin_class_assignments as assignments
    e = admin_env
    target = str(uuid4())
    row = {"id": target, "programme_id": "ielts", "metadata": {}}
    if state not in {"absent", "missing_row"}:
        row["restricted"] = state
    if state != "missing_row":
        e.db.rows["listening_tests"].append(row)
    monkeypatch.setattr(assignments, "_require_cohort", lambda _: {"id": "cohort", "is_active": True})
    def forbidden(*args, **kwargs):
        pytest.fail("assignment service reached before namespace denial")
    monkeypatch.setattr(assignments, "create_class_assignment", forbidden)
    response = e.client.post('/admin/cohorts/cohort/assignments', json={
        "skill": "listening", "title": "Synthetic task", "content_id": target})
    assert response.status_code == (404 if state == "missing_row" else 503), response.text
    if state != "missing_row":
        assert response.headers["cache-control"] == "private, no-store"
    assert e.db.calls == [("listening_tests", "id,restricted", None)]
    assert e.db.rpcs == []


@pytest.mark.parametrize("state", [True, None, "absent", "missing_row", "config_namespace"])
def test_assignment_service_rejects_persisted_or_config_namespace(admin_env, state):
    from services.class_assignment_service import create_class_assignment
    e = admin_env
    target = str(uuid4())
    row = {"id": target, "programme_id": "ielts", "metadata": {}}
    config = None
    if state not in {"absent", "missing_row"}:
        row["restricted"] = False if state == "config_namespace" else state
    if state != "missing_row":
        e.db.rows["listening_tests"].append(row)
    if state == "config_namespace":
        e.db.rows["content_access_namespaces"].append({"programme_id": "next-book", "scope": "assignment_only"})
        config = {"programme_id": "next-book"}
    with pytest.raises(HTTPException) as error:
        create_class_assignment(e.db, cohort_id="cohort", skill="listening", title="Synthetic",
                                content_id=target, content_config=config)
    assert error.value.status_code == 503
    assert error.value.headers["Cache-Control"] == "private, no-store"
    assert e.db.calls == [("content_access_namespaces", "programme_id", None),
                          ("listening_tests", "id,restricted", None)]
    assert e.db.rpcs == []


@pytest.mark.parametrize("scope", [None, "listening"])
def test_assignment_service_public_flag_preserves_atomic_rpc(admin_env, monkeypatch, scope):
    from services.class_assignment_service import create_class_assignment
    from types import SimpleNamespace
    e = admin_env
    calls = []
    def rpc(name, params):
        calls.append((name, params))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=[{
            "assignment": {"id": "assignment"}, "student_count": 2, "unactivated_count": 0}]))
    monkeypatch.setattr(e.db, "rpc", rpc)
    result = create_class_assignment(e.db, cohort_id="cohort", skill="listening", title="Synthetic",
        content_id=e.normal["id"], exam_scope_kind=scope)
    assert result == {"id": "assignment", "student_count": 2, "unactivated_count": 0}
    assert [name for name, _ in calls] == [
        "fn_create_scoped_exam_class_assignment" if scope else "fn_create_class_assignment"]
    assert e.db.calls == [("content_access_namespaces", "programme_id", None),
                          ("listening_tests", "id,restricted", None)]


@pytest.mark.parametrize("method,path,key,table", [
    ("get", "/content/{id}", "content_id", "listening_content"),
    ("get", "/tests/{id}", "test_id", "listening_tests"),
    ("get", "/tests/{id}/preview", "test_id", "listening_tests"),
    ("get", "/tests/{id}/audit", "test_id", "listening_tests"),
    ("get", "/tests/{id}/audio/signed-urls", "test_id", "listening_tests"),
    ("get", "/tests/{id}/player-preview", "test_id", "listening_tests"),
    ("get", "/dictation-reports/{id}", "session_id", "dictation_sessions"),
    ("get", "/attempts/{id}", "attempt_id", "listening_test_attempts"),
    ("get", "/exercises/{id}/map-image/signed-url", "exercise_id", "listening_content"),
    ("delete", "/exercises/{id}", "exercise_id", "listening_content"),
    ("delete", "/exercises/{id}/map-image", "exercise_id", "listening_content"),
    ("delete", "/tests/{id}", "test_id", "listening_tests"),
    ("delete", "/tests/{id}/hard", "test_id", "listening_tests"),
])
@pytest.mark.parametrize("state", [True, None, "absent", "missing_row"])
def test_admin_by_id_routes_deny_before_payload_or_mutation(admin_env, method, path, key, table, state):
    e = admin_env
    target = str(uuid4())
    row = {"id": target, "test_id": None, "programme_id": "ielts", "metadata": {}}
    e.db.rows.setdefault(table, [])
    if state not in {"absent", "missing_row"}:
        row["restricted"] = state
    if state != "missing_row":
        e.db.rows.setdefault(table, []).append(row)
    if key == "exercise_id":
        content_id, target = target, str(uuid4())
        e.db.rows["listening_exercises"].append({"id": target, "content_id": content_id})
    response = e.client.request(method, '/admin/listening' + path.format(id=target))
    assert response.status_code == (503 if path.endswith("/player-preview") else 404), response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert all(cols in {"id,restricted", "id,content_id"} and patch is None
               for _, cols, patch in e.db.calls)
    assert e.db.rpcs == []


@pytest.mark.parametrize("path,body", [
    ("post-test-capture", {"items": []}),
    ("items/1/events", {"event_id": str(uuid4()), "event_name": "correction_result_seen"}),
])
@pytest.mark.parametrize("state", [True, None, "absent", "missing_row", "foreign_owner"])
def test_correction_http_checks_owned_flag_before_work(env, monkeypatch, path, body, state):
    from routers import mock_corrections
    e = env
    e.app.include_router(mock_corrections.router)
    monkeypatch.setattr(mock_corrections, "get_supabase_user", AsyncMock(return_value=e.actor))
    target = str(uuid4())
    row = {"id": target, "user_id": e.actor["id"], "status": "submitted"}
    if state not in {"absent", "missing_row"}:
        row["restricted"] = False if state == "foreign_owner" else state
    if state == "foreign_owner":
        row["user_id"] = str(uuid4())
    if state != "missing_row":
        e.db.rows["listening_test_attempts"].append(row)
    response = e.client.post(f'/api/mock-corrections/listening/attempts/{target}/{path}', json=body)
    assert response.status_code == (404 if state in {"missing_row", "foreign_owner"} else 422), response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert e.db.calls == [("listening_test_attempts", "id,restricted", None)]
    assert e.db.rpcs == []


def test_correction_identity_outage_is_private_and_stops_work(env, monkeypatch):
    from routers import listening, mock_corrections
    e = env
    e.app.include_router(mock_corrections.router)
    monkeypatch.setattr(mock_corrections, "get_supabase_user", AsyncMock(return_value=e.actor))
    def unavailable(_):
        raise RuntimeError("Synthetic identity outage")
    monkeypatch.setattr(listening.supabase_admin, "table", unavailable)
    response = e.client.post(f'/api/mock-corrections/listening/attempts/{uuid4()}/post-test-capture',
                             json={"items": []})
    assert response.status_code == 503, response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert "Synthetic identity outage" not in response.text
    assert e.db.rpcs == []


def test_correction_dynamic_readers_use_namespace_views(admin_env, monkeypatch):
    from services import mock_correction_service as corrections
    e = admin_env
    monkeypatch.setattr(corrections, "supabase_admin", e.db)
    e.db.rows["listening_tests"] = [
        {"id": "public", "restricted": False, "public_practice_enabled": True},
        {"id": "hidden", "restricted": True, "public_practice_enabled": True},
    ]
    e.db.rows["listening_test_attempts"] = [
        {"id": "public", "restricted": False, "user_id": "learner", "status": "submitted"},
        {"id": "hidden", "restricted": True, "user_id": "learner", "status": "submitted"},
    ]
    assert corrections.fetch_owned_submitted_attempt("listening", "public", "learner")["id"] == "public"
    with pytest.raises(corrections.NotFoundError):
        corrections.fetch_owned_submitted_attempt("listening", "hidden", "learner")
    assert corrections._one("listening_tests", "hidden") is None
    assert corrections._one("listening_tests", "public")["id"] == "public"
    assert corrections.non_public_reserved_ids("listening", {"public", "hidden"}) == {"hidden"}
    assert all(table in {"v_listening_tests_public", "v_listening_attempts_public"}
               for table, _, _ in e.db.calls)


def test_correction_scoped_summary_filters_attempts_before_item_join(admin_env, monkeypatch):
    from services import mock_correction_service as corrections
    e = admin_env
    monkeypatch.setattr(corrections, "supabase_admin", e.db)
    e.db.rows["class_assignment_items"] = [{"id": "item", "assignment_id": "assignment"}]
    e.db.rows["reading_test_attempts"] = []
    e.db.rows["listening_test_attempts"] = [
        dict(id=target, restricted=target == "hidden", class_assignment_item_id="item")
        for target in ("public", "hidden")]
    e.db.rows["mock_item_attempts"] = []
    corrections.admin_performance_summary(class_assignment_id="assignment")
    assert ("v_listening_attempts_public", "id", None) in e.db.calls
    joins = [q for q in e.db.queries if q.table == "mock_item_attempts"]
    assert len(joins) == 1
    assert ("listening_attempt_id", ["public"], "in") in joins[0].filters


@pytest.mark.parametrize("state", [True, None, "absent", "missing_row", "config_namespace"])
def test_student_assignment_start_rejects_before_open_or_paper(env, monkeypatch, state):
    from routers import class_student
    e = env
    e.app.include_router(class_student.router)
    monkeypatch.setattr(class_student, "supabase_admin", e.db)
    monkeypatch.setattr(class_student, "get_supabase_user", AsyncMock(return_value=e.actor))
    monkeypatch.setattr(class_student, "_student_for_user", lambda *_: {"id": "student", "cohort_id": "cohort"})
    monkeypatch.setattr(class_student, "student_is_active_in_cohort", lambda *_: True)
    target = str(uuid4())
    row = {"id": target}
    if state not in {"absent", "missing_row"}:
        row["restricted"] = False if state == "config_namespace" else state
    if state != "missing_row":
        e.db.rows["listening_tests"].append(row)
    config = {}
    if state == "config_namespace":
        e.db.rows["content_access_namespaces"].append({"programme_id": "next-book", "scope": "assignment_only"})
        config = {"programme_id": "next-book"}
    e.db.rows["class_assignments"] = [{"id": "assignment", "cohort_id": "cohort", "skill": "listening",
        "status": "published", "content_id": target, "content_config": config}]
    e.db.rows["class_assignment_items"] = [{"id": "item", "student_id": "student", "assignment_id": "assignment"}]
    response = e.client.post('/api/class/assignments/item/start')
    assert response.status_code == 503, response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert all(patch is None for _, _, patch in e.db.calls)
    assert [(table, cols) for table, cols, _ in e.db.calls if table == "listening_tests"] == [
        ("listening_tests", "id,restricted")]
    assert e.db.rpcs == []


def test_student_assignment_list_and_progress_share_namespace_filter(env, monkeypatch):
    from routers import class_student
    e = env
    e.app.include_router(class_student.router)
    db = _assignment_db({
        "content_access_namespaces": [{"programme_id": "next-book", "scope": "assignment_only"}],
        "listening_tests": [{"id": "public", "restricted": False}, {"id": "hidden", "restricted": True}],
        "class_assignments": [dict(id=target, skill="listening", content_id=target, cohort_id="cohort",
            status="published", title=target, content_config={}) for target in ("public", "hidden", "missing")],
        "class_assignment_items": [dict(id=f"item-{target}", student_id="student", assignment_id=target,
            state="assigned", submitted_at=None) for target in ("public", "hidden", "missing")],
    })
    monkeypatch.setattr(class_student, "supabase_admin", db)
    monkeypatch.setattr(class_student, "get_supabase_user", AsyncMock(return_value=e.actor))
    monkeypatch.setattr(class_student, "_student_for_user", lambda *_: {"id": "student", "cohort_id": "cohort"})
    monkeypatch.setattr(class_student, "active_cohort_ids_for_student", lambda *_: ["cohort"])
    monkeypatch.setattr(class_student, "_visible_writing_gives", lambda *_: ([], False))
    monkeypatch.setattr(class_student, "reconcile_test_attempts", lambda *_: None)
    monkeypatch.setattr(class_student, "reconcile_course_items", lambda *_: None)
    for _ in range(2):
        response = e.client.get('/api/class/my-assignments')
        assert response.status_code == 200, response.text
        rows = response.json()["assignments"]
        assert [row["assignment"]["id"] for row in rows] == ["public"]
        assert class_student._progress_summary(rows)["total"] == 1


def test_student_history_excludes_namespace_before_history_cap(env, monkeypatch):
    from routers import class_student
    from datetime import datetime, timezone
    db = _assignment_db({
        "content_access_namespaces": [],
        "listening_tests": [dict(id=target, restricted=target == "hidden") for target in ("public", "hidden")],
        "class_assignments": [dict(id=target, skill="listening", content_id=target, cohort_id="cohort",
            status="published", title=target, content_config={}) for target in ("public", "hidden")],
        "class_assignment_items": [dict(id=f"item-{target}-{n}", student_id="student", assignment_id=target,
            state="submitted", submitted_at="2026-11-01T00:00:00Z")
            for target, count in (("hidden", 201), ("public", 200)) for n in range(count)],
    })
    monkeypatch.setattr(class_student, "supabase_admin", db)
    monkeypatch.setattr(class_student, "_visible_writing_gives", lambda *_: ([], False))
    monkeypatch.setattr(class_student, "reconcile_test_attempts", lambda *_: None)
    monkeypatch.setattr(class_student, "reconcile_course_items", lambda *_: None)
    rows, _ = class_student._visible_assignments({"id": "student", "cohort_id": "cohort"},
        datetime.now(timezone.utc), ["cohort"])
    assert len(rows) == class_student._MAX_HISTORY == 200
    assert all(row["assignment"]["id"] == "public" for row in rows)
    assert class_student._progress_summary(rows)["total"] == 200
