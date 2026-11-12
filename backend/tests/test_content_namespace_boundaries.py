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
