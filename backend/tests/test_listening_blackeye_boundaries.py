"""BLACKEYE-0052 C1/C2/F11: synthetic HTTP capability and privacy matrix."""
import asyncio
from copy import deepcopy
import json
import logging
import re
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from test_listening_blackeye import env, paper, start, visible, leak_free, BASE
from routers import listening as lr, mock_attempt_flags as flags, mock_corrections as corrections
from services import listening_blackeye as svc


def add_side_routes(e, monkeypatch):
    monkeypatch.setattr(flags, "supabase_admin", e.db)
    monkeypatch.setattr(corrections, "get_supabase_user", lr._require_auth)
    e.app.include_router(flags.router)
    e.app.include_router(corrections.router)


SIDES = [
    ("get", "review-flags", None, 422),
    ("patch", "review-flags", {"q_num": 1, "flagged": True, "expected_revision": 0, "operation_id": "00000000-0000-0000-0000-000000000003"}, 422),
    ("post", "renderer-affinity", {"renderer_affinity": "next"}, 503),
    ("post", "playback-started", {"playback_claim_id": "00000000-0000-0000-0000-000000000001"}, 503),
    ("post", "post-test-capture", {"items": []}, 422),
    ("post", "items/1/events", {"event_id": "00000000-0000-0000-0000-000000000002", "event_name": "correction_result_seen"}, 422),
]


@pytest.mark.parametrize("admin", [False, True])
@pytest.mark.parametrize("method,suffix,body", [
    ("get", "", None), ("get", "review", None),
    ("patch", "answers", {"q_num": 1, "user_answer": "SYNTHETIC_ANSWER"}),
    ("post", "submit", None),
] + [(m, s, b) for m, s, b, _ in SIDES])
def test_idor_matrix_owner_lookup_before_snapshot(env, monkeypatch, admin, method, suffix, body):
    add_side_routes(env, monkeypatch)
    a = env.db.freeze(env.p)
    env.actor.update(id=str(uuid4()), admin=admin)
    prefix = "/api/mock-corrections/listening/attempts" if suffix in {"post-test-capture", "items/1/events"} else BASE + "/tests/attempts"
    url = f'{prefix}/{a["id"]}' + (f"/{suffix}" if suffix else "")
    response = getattr(env.client, method)(url, **({"json": body} if body else {}))
    assert response.status_code == 404, response.text
    assert not any(t == "mock_paper_attempt_snapshots" or patch for t, _, patch in env.db.calls)
    assert env.db.rpcs == []


@pytest.mark.parametrize("method,suffix,body,status", SIDES)
def test_generic_side_route_denials_precede_private_io(env, monkeypatch, method, suffix, body, status):
    add_side_routes(env, monkeypatch)
    a = env.db.freeze(env.p)
    prefix = "/api/mock-corrections/listening/attempts" if suffix in {"post-test-capture", "items/1/events"} else BASE + "/tests/attempts"
    r = getattr(env.client, method)(f'{prefix}/{a["id"]}/{suffix}', **({"json": body} if body else {}))
    assert r.status_code == status, r.text
    assert env.db.rpcs == []
    assert not any(patch or "marking_rows" in cols or (t == "mock_paper_attempt_snapshots" and cols == "*") for t, cols, patch in env.db.calls)


@pytest.mark.parametrize('foreign_owner', [False, True])
def test_skill_drill_playback_cannot_record_blackeye_attempt(env, foreign_owner):
    attempt = env.db.freeze(env.p)
    if foreign_owner:
        env.actor['id'] = str(uuid4())
    response = env.client.post(f'{BASE}/skill-drill-playback/{attempt["id"]}', json={
        'stage': 'listening', 'page_id': str(uuid4()), 'plays': 1, 'played_ms': 1000,
    })
    assert response.status_code == 404, response.text
    if foreign_owner:
        assert response.headers['cache-control'] == 'private, no-store'
    assert env.db.rpcs == []
    assert not any(t == 'mock_paper_attempt_snapshots' or patch for t, _, patch in env.db.calls)


def test_windows_programme_and_in_progress_seams(env):
    for path in [f'/tests/{env.p["id"]}/practice-windows', f'/programmes/{svc.PROGRAMME}/lessons', f'/tests/{env.p["id"]}/attempts/in-progress?class_item=synthetic']:
        r = env.client.get(BASE + path)
        assert r.status_code == 503, r.text
    r = env.client.get(f'{BASE}/tests/{env.p["id"]}/attempts/in-progress?standalone=true')
    assert r.status_code == 404
    assert env.db.rpcs == []
    assert not any(t == "mock_paper_attempt_snapshots" for t, _, _ in env.db.calls)


@pytest.mark.parametrize("role", ["creator", "global", "other_cohort", "student"])
def test_generic_admin_detail_never_reads_blackeye_work(env, monkeypatch, role):
    monkeypatch.setattr(lr, "_staff_admin_guard", __import__("routers.admin_class_assignments", fromlist=["require_admin"]).require_admin)
    env.app.include_router(lr.admin_router)
    a = env.db.freeze(env.p)
    env.actor.update(admin=role != "student", id=role)
    r = env.client.get(f'/admin/listening/attempts/{a["id"]}')
    assert r.status_code == (403 if role == "student" else 404), r.text
    assert not any(cols == "*" or "marking_rows" in cols for _, cols, _ in env.db.calls)
    assert env.db.rpcs == []


def test_admin_list_and_aggregator_queries_exclude_before_joins(env):
    from services import cohort_progress_aggregator as agg, class_assignment_service as assignments
    generic = paper(activity="U1-A02")
    generic.update(programme_id="ielts", metadata={})
    env.db.rows["listening_tests"].append(generic)
    blackeye = env.db.freeze(env.p)
    normal = deepcopy(blackeye)
    normal.update(id=str(uuid4()), test_id=generic["id"])
    env.db.rows["listening_test_attempts"].append(normal)
    for paged in (agg._paged, assignments._paged):
        env.db.calls.clear()
        rows = paged(env.db, "listening_test_attempts", "id,user_id,test_id,status", lambda q: q)
        assert [r["id"] for r in rows] == [normal["id"]]
        assert not any(t == "mock_paper_attempt_snapshots" for t, _, _ in env.db.calls)
    q = svc.exclude_tests(env.db, env.db.table("listening_test_attempts").select("id,test_id"))
    assert [r["id"] for r in q.execute().data] == [normal["id"]]
    env.db.rows["class_assignments"] = [
        dict(id="hidden", skill="listening", content_id=env.p["id"]),
        dict(id="visible", skill="listening", content_id=generic["id"]),
    ]
    rows = assignments._paged(env.db, "class_assignments", "id", lambda q: q)
    assert [r["id"] for r in rows] == ["visible"]
    with pytest.raises(HTTPException) as error:
        svc.guard_generic_assignment(env.db, "hidden")
    assert error.value.status_code == 503
    assert env.db.rpcs == []


def test_no_answer_or_pii_in_logging_error_logs_or_sentry(env, monkeypatch, caplog):
    from routers import error_logs
    from services.sentry_setup import before_send
    from services.log_redaction import AccessLogRedactionFilter
    sentinel = "SYNTHETIC_PRIVATE_NAME answer transcript explanation learner@example.invalid " + env.db.user
    env.db.rpc_error = sentinel
    with caplog.at_level(logging.DEBUG):
        response = start(env)
    assert response.status_code == 503
    for value in (sentinel, env.db.user, "learner@example.invalid"):
        assert value not in caplog.text
    env.db.rows["error_logs"] = []
    monkeypatch.setattr(error_logs, "supabase_admin", env.db)
    async def auth(_): return {"id": env.db.user}
    monkeypatch.setattr(error_logs, "_get_user_optional", auth)
    env.app.include_router(error_logs.router)
    response = env.client.post("/api/error-logs", json=dict(message=sentinel, stack=sentinel,
        url="/listening/programmes/form/synthetic?answer=" + sentinel, extra={"answer": sentinel}))
    assert response.status_code == 200, response.text
    row = env.db.rows["error_logs"][0]
    assert row["user_id"] == env.db.user  # F11: the structured owner is allowed.
    assert sentinel not in json.dumps({k:v for k,v in row.items() if k != "user_id"})
    event = before_send(dict(message=sentinel, request={"url": "/api/listening/tests/synthetic"},
        exception={"values": [{"value": sentinel}]}, breadcrumbs={"values": [{"message": sentinel}]}, extra={"answer": sentinel}))
    assert sentinel not in json.dumps(event)
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
        ("client", "GET", "/api/listening/tests/" + env.db.user + "?anything=" + sentinel, "1.1", 503), None)
    AccessLogRedactionFilter().filter(record)
    assert sentinel not in record.getMessage() and env.db.user not in record.getMessage()


def test_save_submit_correlation_excludes_answers_and_preserves_retry_hint(env, monkeypatch, caplog):
    from main import request_id_middleware
    from services import core_attempt_observation as obs, core_operation_correlation as corr
    from services.core_attempt_evidence import ReceiptStatus
    env.app.middleware("http")(request_id_middleware)
    monkeypatch.setattr(obs.settings, "CORE_ATTEMPT_EVIDENCE_ENABLED", True)
    monkeypatch.setattr(obs, "try_record_event", AsyncMock(return_value=ReceiptStatus.RECORDED))
    stored = []
    class CorrelationDB:
        def rpc(self, name, payload):
            assert name == "fn_record_core_operation_correlation"
            stored.append(payload)
            return SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(data=payload["p_operation_id"])))
    monkeypatch.setattr(corr, "get_supabase_async", AsyncMock(return_value=CorrelationDB()))
    a = env.db.freeze(env.p)
    hint = str(uuid4())
    headers = {corr.HEADER_NAME: hint}
    answers = [json.dumps(dict(version="blackeye_keep_change_v1", action="CHANGE", correction_text=value))
               for value in ("SYNTHETIC_PRIVATE_ALPHA", "SYNTHETIC_PRIVATE_BETA")]
    with caplog.at_level(logging.DEBUG):
        for value in (answers[0], answers[1], answers[1]):
            response = env.client.patch(f'{BASE}/tests/attempts/{a["id"]}/answers',
                json={"q_num": 1, "user_answer": value}, headers=headers)
            assert response.status_code == 200, response.text
        assert a["answers"] == [{"q_num": 1, "user_answer": answers[1]}]
        first = env.client.post(f'{BASE}/tests/attempts/{a["id"]}/submit', headers=headers)
        retry = env.client.post(f'{BASE}/tests/attempts/{a["id"]}/submit', headers=headers)
    assert first.status_code == retry.status_code == 200
    assert first.content == retry.content
    saves = [row for row in stored if row["p_operation"] == "save"]
    submits = [row for row in stored if row["p_operation"] == "submit"]
    assert len(saves) == 3 and len(submits) == 2
    assert len({r["p_input_digest"] for r in saves}) == 1
    assert len({r["p_input_digest"] for r in submits}) == 1
    assert saves[0]["p_input_digest"] != submits[0]["p_input_digest"]
    assert all(row["p_client_operation_id"] == hint and row["p_canonical_attempt_id"] == a["id"] for row in stored)
    assert len({r["p_operation_id"] for r in stored}) == 5
    for sentinel in ("SYNTHETIC_PRIVATE_ALPHA", "SYNTHETIC_PRIVATE_BETA"):
        assert sentinel not in json.dumps(stored) + caplog.text
    for endpoint in (lr.patch_listening_test_attempt_answer, lr.submit_listening_test_attempt):
        assert endpoint.__core_correlation_fields__ == ("attempt_id",)


def test_submit_service_receives_authenticated_actor_and_rejects_other_owner(env, monkeypatch):
    attempt = env.db.freeze(env.p)
    actual_submit = svc.submit
    calls = []
    def submit(db, row, user_id):
        calls.append(user_id)
        return actual_submit(db, row, user_id)
    monkeypatch.setattr(svc, "submit", submit)
    response = env.client.post(f'{BASE}/tests/attempts/{attempt["id"]}/submit')
    assert response.status_code == 200, response.text
    assert calls == [env.actor["id"]]
    assert next(params for name, params in env.db.rpcs if name == "fn_submit_blackeye_attempt")["p_user_id"] == env.actor["id"]
    env.db.calls.clear()
    env.db.rpcs.clear()
    for status in ("in_progress", "submitted"):
        with pytest.raises(HTTPException) as error:
            actual_submit(env.db, dict(attempt, status=status), str(uuid4()))
        assert error.value.status_code == 404
    assert env.db.rpcs == [] and env.db.calls == []


def test_pre_submit_projection_has_no_key_material(env):
    response = start(env)
    assert response.status_code == 200
    leak_free(env, response)
    assert response.json()["answers"] == []
    for text in ("SYNTHETIC_REFERENCE", "SYNTHETIC_TRANSCRIPT", "reference", "explanation_vi"):
        assert text not in response.text


def inventory_path(path):
    """Classify resource paths regardless of the identifier parameter's name."""
    return "{" in path and bool(re.search(
        r"^/(?:admin|api)/(?:listening|mock-corrections|core-attempt-evidence|exam-content|"
        r"reading/(?:content/tests|test)|exams|exercises|grammar-lessons/attempts)(?:/|$)"
        r"|^/admin/cohorts/[^/]+/lessons/", path))


def test_route_inventory_new_identifier_routes_require_classification():
    from main import app
    expected = set(ROUTE_INVENTORY.splitlines()) | set(INDEPENDENT_DOMAIN_ROUTES.splitlines())
    actual = {f"{method} {route.path}" for route in app.routes for method in getattr(route, "methods", ())
              if inventory_path(route.path)}
    assert actual == expected
    # Black Eye uses the positive routes in plan.md. Every other entry is a
    # generic deny/exclude boundary, or a dictation-attempt table that admission
    # cannot populate. Behavioral matrix above pins 422 and 503 before private IO.


@pytest.mark.parametrize("parameter", ["drill_id", "renamed", "id"])
def test_inventory_detects_drill_resource_with_any_parameter_name(parameter):
    assert inventory_path(f"/admin/listening/drills/{{{parameter}}}/publish")


def test_drill_publish_denies_blackeye_before_private_io(env, monkeypatch):
    from routers import admin_class_assignments
    monkeypatch.setattr(lr, "_staff_admin_guard", admin_class_assignments.require_admin)
    env.app.include_router(lr.admin_router)
    env.actor["admin"] = True
    response = env.client.post(f'/admin/listening/drills/{env.p["id"]}/publish')
    assert response.status_code == 404
    assert env.db.rpcs == []
    assert not any(patch or t not in {"listening_tests"} for t, _, patch in env.db.calls)


ROUTE_INVENTORY = """GET /admin/listening/dictation-reports/{session_id}
GET /api/listening/source-collections/80-days/days/{day_number}
GET /api/listening/source-collections/80-days/days/{day_number}/audio
GET /api/listening/tests/dictation/session/by-request/{client_request_id}
GET /api/listening/tests/dictation/session/{session_id}
POST /admin/listening/drills/{drill_id}/publish
POST /admin/listening/drills/{drill_id}/sync
POST /admin/listening/packages/{package_id}/archive
POST /admin/listening/packages/{package_id}/publish
POST /api/listening/source-collections/80-days/days/{day_number}/study
POST /api/listening/skill-drill-playback/{attempt_id}
DELETE /admin/listening/exercises/{exercise_id}
DELETE /admin/listening/exercises/{exercise_id}/map-image
DELETE /admin/listening/tests/{test_id}
DELETE /admin/listening/tests/{test_id}/hard
GET /admin/core-attempt-evidence/{surface}/{canonical_attempt_id}
GET /admin/exam-content/{kind}/{content_id}/policy
GET /admin/listening/attempts/{attempt_id}
GET /admin/listening/content/{content_id}
GET /admin/listening/exercises/{exercise_id}/map-image/signed-url
GET /admin/listening/tests/{test_id}
GET /admin/listening/tests/{test_id}/audio/signed-urls
GET /admin/listening/tests/{test_id}/audit
GET /admin/listening/tests/{test_id}/player-preview
GET /admin/listening/tests/{test_id}/preview
GET /api/listening/content/{content_id}
GET /api/listening/dictation/{content_id}/boot
GET /api/listening/lessons/{lesson_id}
GET /api/listening/programmes/{programme_id}/lessons
GET /api/listening/tests/attempts/{attempt_id}
GET /api/listening/tests/attempts/{attempt_id}/guided-state
GET /api/listening/tests/attempts/{attempt_id}/review
GET /api/listening/tests/attempts/{attempt_id}/review-flags
GET /api/listening/tests/{test_id}
GET /api/listening/tests/{test_id}/attempts/in-progress
GET /api/listening/tests/{test_id}/dictation
GET /api/listening/tests/{test_id}/dictation/attempts/in-progress
GET /api/listening/tests/{test_id}/practice-windows
PATCH /admin/exam-content/{kind}/{content_id}/cohorts
PATCH /admin/exam-content/{kind}/{content_id}/level
PATCH /admin/exam-content/{kind}/{content_id}/status
PATCH /admin/exam-content/{kind}/{content_id}/visibility
PATCH /admin/listening/content/{content_id}
PATCH /admin/listening/content/{content_id}/status
PATCH /admin/listening/exercises/{exercise_id}/questions/{q_num}
PATCH /admin/listening/tests/{test_id}
PATCH /admin/listening/tests/{test_id}/audio/mode
PATCH /admin/listening/tests/{test_id}/audit
PATCH /admin/listening/tests/{test_id}/status
PATCH /admin/mock-corrections/public-tests/{skill}/{test_id}
PATCH /api/listening/tests/attempts/{attempt_id}/answers
PATCH /api/listening/tests/attempts/{attempt_id}/review-flags
POST /admin/exam-content/{kind}/{content_id}/policy/restore
POST /admin/listening/exercises/{exercise_id}/upload-map-image
POST /admin/listening/tests/{test_id}/audio/assemble
POST /admin/listening/tests/{test_id}/audio/full
POST /admin/listening/tests/{test_id}/audio/section/{section_num}
POST /admin/listening/tests/{test_id}/audit/run
POST /api/listening/tests/attempts/{attempt_id}/check
POST /api/listening/tests/attempts/{attempt_id}/playback-started
POST /api/listening/tests/attempts/{attempt_id}/questions/{q_num}/reveal
POST /api/listening/tests/attempts/{attempt_id}/renderer-affinity
POST /api/listening/tests/attempts/{attempt_id}/submit
POST /api/listening/tests/dictation/attempts/{attempt_id}/renderer-affinity
POST /api/listening/tests/dictation/attempts/{attempt_id}/sentences/{sentence_idx}
POST /api/listening/tests/{test_id}/attempts
POST /api/listening/tests/{test_id}/dictation/attempts
POST /api/mock-corrections/{skill}/attempts/{attempt_id}/items/{question_number}/events
POST /api/mock-corrections/{skill}/attempts/{attempt_id}/post-test-capture"""


@pytest.mark.asyncio
async def test_backend_crash_capture_discards_private_exception(env, monkeypatch, caplog):
    import main
    from starlette.requests import Request
    sentinel = "SYNTHETIC_PRIVATE_RESPONSE " + env.db.user
    captured = []
    monkeypatch.setattr(main, "_insert_error_log_safely", captured.append)
    monkeypatch.setattr(main, "_unhandled_error_log_tasks", set())
    request = Request({"type": "http", "method": "PATCH", "path": "/api/listening/tests/attempts/synthetic/answers",
        "query_string": ("unknown=" + sentinel).encode(), "headers": [], "scheme": "http",
        "server": ("testserver", 80), "route": SimpleNamespace(path="/api/listening/tests/attempts/{attempt_id}/answers")})
    with caplog.at_level(logging.DEBUG):
        response = await main.unhandled_exception_handler(request, RuntimeError(sentinel))
        await asyncio.gather(*main._unhandled_error_log_tasks)
    assert response.status_code == 500
    assert captured and sentinel not in json.dumps(captured)
    assert sentinel not in caplog.text


@pytest.mark.parametrize("admin", [False, True])
def test_in_progress_cannot_find_another_owners_attempt(env, admin):
    env.db.freeze(env.p)
    env.actor.update(id=str(uuid4()), admin=admin)
    r = env.client.get(f'{BASE}/tests/{env.p["id"]}/attempts/in-progress?standalone=true')
    assert r.status_code == 404
    assert not any(t == "mock_paper_attempt_snapshots" for t, _, _ in env.db.calls)
    assert env.db.rpcs == []


def test_student_profile_summary_excludes_blackeye_counts(env, monkeypatch):
    from services import student_service
    from test_student_service import _LisFake
    generic = paper(activity="U1-A02")
    generic.update(programme_id="ielts", metadata={})
    rows = [dict(id="hidden", test_id=env.p["id"], status="submitted", created_at="2026-11-10"),
            dict(id="shown", test_id=generic["id"], status="in_progress", created_at="2026-11-09")]
    db = _LisFake(dict(listening_tests=[env.p, generic], listening_test_attempts=rows))
    monkeypatch.setattr(student_service, "supabase_admin", db)
    result = student_service._listening_summary(env.db.user)
    assert result["attempts_total"] == 1
    assert result["attempts_submitted"] == 0
    assert result["last_attempt_at"] == "2026-11-09"


@pytest.mark.parametrize("method,suffix,payload", [
    ("patch", "", {"status": "archived"}), ("delete", "", None),
    ("post", "/backfill", {"student_ids": []}),
    ("patch", "/due", {"due_date": "2026-11-12"}),
    ("post", "/return/synthetic-student", {}),
    ("get", "/tally", None),
])
@pytest.mark.parametrize("role", ["creator", "global", "other_cohort", "student"])
def test_generic_assignment_routes_cannot_mutate_or_tally_blackeye(env, role, method, suffix, payload):
    env.db.rows["class_assignments"] = [dict(id="synthetic-assignment", cohort_id="synthetic-cohort", skill="listening", content_id=env.p["id"])]
    env.actor.update(admin=role != "student", id=role)
    response = getattr(env.client, method)("/admin/cohorts/synthetic-cohort/assignments/synthetic-assignment" + suffix,
        **({"json": payload} if payload is not None else {}))
    assert response.status_code == (403 if role == "student" else 503), response.text
    assert env.db.rpcs == []
    assert not any(patch or t == "class_assignment_items" or t == "mock_paper_attempt_snapshots" for t, _, patch in env.db.calls)


@pytest.mark.parametrize("role", ["creator", "global", "other_cohort", "student"])
def test_generic_admin_list_never_joins_hidden_learner(env, monkeypatch, role):
    from routers import admin_class_assignments
    monkeypatch.setattr(lr, "_staff_admin_guard", admin_class_assignments.require_admin)
    env.app.include_router(lr.admin_router)
    env.db.freeze(env.p)
    ordinary = paper(activity="U1-A02")
    ordinary.update(programme_id="ielts", metadata={})
    env.db.rows["listening_tests"].append(ordinary)
    env.db.rows["listening_test_attempts"].append(dict(id="ordinary-attempt", user_id="ordinary-user",
        test_id=ordinary["id"], status="in_progress", scoring_policy="diagnostic"))
    joined = []
    def lookup(table, ids, cols, **kwargs):
        joined.extend(ids)
        assert env.db.user not in ids and env.p["id"] not in ids
        return {}
    monkeypatch.setattr(lr, "_rows_by_id", lookup)
    env.actor.update(id=role, admin=role != "student")
    response = env.client.get("/admin/listening/attempts")
    assert response.status_code == (403 if role == "student" else 200), response.text
    if role != "student":
        assert response.json()["total"] == 1
        assert [r["id"] for r in response.json()["items"]] == ["ordinary-attempt"]
        assert joined == ["ordinary-user", ordinary["id"]]
    assert not any(t == "mock_paper_attempt_snapshots" for t, _, _ in env.db.calls)


def test_action_log_excludes_hidden_assignment_before_name_joins(env):
    from services.class_assignment_service import read_class_actions
    env.db.rows["class_assignments"] = [dict(id="hidden", cohort_id="synthetic", skill="listening", content_id=env.p["id"])]
    env.db.rows["class_action_log"] = [dict(id="private-action", cohort_id="synthetic", assignment_id="hidden", student_name="PRIVATE_NAME")]
    result = read_class_actions(env.db, cohort_id="synthetic")
    assert result == {"actions": [], "has_more": False, "next_before": None}
    assert not any(t == "students" or t == "mock_paper_attempt_snapshots" for t, _, _ in env.db.calls)


@pytest.mark.parametrize("role", ["creator", "global", "other_cohort", "student"])
def test_generic_admin_body_target_cannot_write_blackeye_exercise(env, monkeypatch, role):
    from routers import admin_class_assignments
    monkeypatch.setattr(lr, "_staff_admin_guard", admin_class_assignments.require_admin)
    env.app.include_router(lr.admin_router)
    env.actor.update(id=role, admin=role != "student")
    env.db.rows["listening_content"] = [dict(id="synthetic-content", test_id=env.p["id"])]
    response = env.client.post("/admin/listening/exercises", json=dict(content_id="synthetic-content", segments=[]))
    assert response.status_code == (403 if role == "student" else 404), response.text
    assert not any(patch or t == "listening_exercises" for t, _, patch in env.db.calls)
    assert env.db.rpcs == []


@pytest.mark.parametrize('action', ['publish', 'archive'])
@pytest.mark.parametrize('hidden', [False, True])
def test_package_slug_publish_archive(env, monkeypatch, action, hidden):
    from routers import admin_class_assignments
    from services import listening_package_import
    monkeypatch.setattr(lr, '_staff_admin_guard', admin_class_assignments.require_admin)
    env.app.include_router(lr.admin_router)
    env.actor['admin'] = True
    slug = 'synthetic-package-not-a-uuid'
    env.db.rows['listening_content_packages'] = [dict(id=str(uuid4()), package_id=slug,
        programme_id=svc.PROGRAMME if hidden else 'general-listening-practice')]
    calls = []
    def set_status(db, *, package_id, manifest_sha256, action, actor, bucket_name):
        status = 'published' if action == 'publish' else 'archived'
        calls.append((package_id, status))
        return {'package_uuid': 'synthetic-uuid', 'status': status, 'forms_changed': 1}
    monkeypatch.setattr(listening_package_import, 'set_package_status', set_status)
    response = env.client.post(f'/admin/listening/packages/{slug}/{action}', json={'manifest_sha256': 'a' * 64})
    assert response.status_code == (404 if hidden else 200), response.text
    assert calls == ([] if hidden else [(slug, 'published' if action == 'publish' else 'archived')])


@pytest.mark.parametrize('suffix', ['', '/aggregate'])
@pytest.mark.parametrize('target', ['uuid_generic', 'uuid_blackeye', 'uuid_unknown',
    'external_generic', 'external_blackeye', 'external_metadata_blackeye', 'external_unknown'])
def test_dictation_report_test_filter_resolves_external_identity(env, monkeypatch, suffix, target):
    from uuid import UUID
    from routers import admin_class_assignments
    from test_listening_blackeye import Query
    monkeypatch.setattr(lr, '_staff_admin_guard', admin_class_assignments.require_admin)
    env.app.include_router(lr.admin_router)
    env.actor['admin'] = True
    hidden = 'blackeye' in target
    unknown = 'unknown' in target
    test = deepcopy(env.p)
    test['test_id'] = 'C19-T1'
    if not hidden or target == 'external_metadata_blackeye':
        test['programme_id'] = 'ielts'
    if not hidden:
        test['metadata'] = {}
    env.db.rows['listening_tests'] = [] if unknown else [test]
    value = (str(uuid4()) if unknown else test['id']) if target.startswith('uuid_') else (
        'UNKNOWN-CODE' if unknown else test['test_id'])
    # Model PostgREST's UUID cast error, which the shared in-memory DB does not.
    original_eq = Query.eq
    def typed_eq(query, key, value):
        if query.table == 'listening_tests' and key == 'id':
            UUID(str(value))
        return original_eq(query, key, value)
    monkeypatch.setattr(Query, 'eq', typed_eq)
    matching = dict(id='matching', test_id_external=value, accuracy=0.75, total_sentences=4)
    env.db.rows['dictation_sessions'] = [dict(matching, id='other', test_id_external='OTHER')]
    if not unknown:
        env.db.rows['dictation_sessions'].append(matching)
    response = env.client.get('/admin/listening/dictation-reports' + suffix, params={'test_id': value})
    assert response.status_code == (404 if hidden else 200), response.text
    if hidden:
        assert not any(table == 'dictation_sessions' for table, _, _ in env.db.calls)
    elif suffix:
        assert response.json()['session_count'] == (0 if unknown else 1)
        assert response.json()['mean_accuracy'] == (0 if unknown else 0.75)
    else:
        assert response.json()['total'] == (0 if unknown else 1)
        assert [row['id'] for row in response.json()['items']] == ([] if unknown else ['matching'])
    assert not any(patch or table == 'mock_paper_attempt_snapshots' for table, _, patch in env.db.calls)


@pytest.mark.parametrize('suffix', ['', '/aggregate'])
def test_dictation_external_lookup_requires_staff_and_fails_closed(env, monkeypatch, suffix):
    from routers import admin_class_assignments
    monkeypatch.setattr(lr, '_staff_admin_guard', admin_class_assignments.require_admin)
    env.app.include_router(lr.admin_router)
    path = '/admin/listening/dictation-reports' + suffix
    assert env.client.get(path, params={'test_id': 'C19-T1'}).status_code == 403
    assert env.db.calls == []
    env.actor['admin'] = True
    def unavailable_table(_name):
        raise RuntimeError('synthetic identity lookup outage')
    monkeypatch.setattr(env.db, 'table', unavailable_table)
    assert env.client.get(path, params={'test_id': 'C19-T1'}).status_code == 503


@pytest.mark.parametrize('count', [10, 500])
def test_hidden_assignment_scan_constant_calls_and_cohort_scope(env, count):
    env.db.rows['class_assignments'] = [dict(id=f'a-{i}', skill='listening', cohort_id='target',
        content_id=env.p['id'] if i % 2 else 'generic') for i in range(count)] + [
        dict(id='other', skill='listening', cohort_id='other', content_id=env.p['id'])]
    ids = svc.hidden_assignment_ids(env.db, cohort_id='target')
    assert set(ids) == {f'a-{i}' for i in range(count) if i % 2}
    assert [t for t, _, _ in env.db.calls] == ['listening_tests', 'class_assignments']


@pytest.mark.parametrize('method,suffix,body', [
    ('patch','visibility', {'is_public': True}), ('patch','status', {'status': 'archived'}),
    ('get','policy', None), ('post','policy/restore', {'snapshot_id': str(uuid4()), 'expected_revision': 1}),
    ('patch','level', {'course_level': 'synthetic'}), ('patch','cohorts', {'cohort_ids': []}),
])
def test_exam_content_hidden_target_denied_before_service_io(env, monkeypatch, method, suffix, body):
    from routers import admin_exam_content as router
    monkeypatch.setattr(router, 'require_admin', __import__('routers.admin_class_assignments', fromlist=['require_admin']).require_admin)
    monkeypatch.setattr(router.svc, 'supabase_admin', env.db)
    env.app.include_router(router.router)
    env.actor['admin'] = True
    response = getattr(env.client, method)(f'/admin/exam-content/listening/{env.p["id"]}/{suffix}',
        **({'json': body} if body is not None else {}))
    assert response.status_code == 503, response.text
    assert [t for t, _, _ in env.db.calls] == ['listening_tests']
    assert env.db.rpcs == []


def test_core_evidence_denied_before_history_or_status(env, monkeypatch):
    from routers import admin_core_attempt_evidence as router
    import database
    monkeypatch.setattr(router, 'require_admin', __import__('routers.admin_class_assignments', fromlist=['require_admin']).require_admin)
    monkeypatch.setattr(database, 'supabase_admin', env.db)
    env.app.include_router(router.router)
    env.actor['admin'] = True
    attempt = env.db.freeze(env.p)
    response = env.client.get(f'/admin/core-attempt-evidence/listening_test/{attempt["id"]}')
    assert response.status_code == 503, response.text
    assert [t for t, _, _ in env.db.calls] == ['listening_test_attempts', 'mock_paper_attempt_snapshots']
    assert env.db.calls[1][1] == ('programme_id:paper_row->programme_id,'
                                  'blackeye_identity:paper_row->metadata->blackeye->binding->programme_id')
    assert all(cols != '*' for _, cols, _ in env.db.calls)
    assert env.db.rpcs == []


@pytest.mark.parametrize('limit', [None, 25])
def test_exam_content_list_excludes_before_hydration(env, monkeypatch, limit):
    from services import exam_content_service as exam
    monkeypatch.setattr(exam, 'supabase_admin', env.db)
    monkeypatch.setattr(exam, 'cohorts_for', lambda kind, ids: {})
    monkeypatch.setattr(exam, '_mock_refs_for', lambda kind, ids: {})
    monkeypatch.setattr(exam, 'explanation_readiness_for', lambda kind, ids: {})
    result = exam.list_exam_content('listening', limit=limit)
    assert result == {'items': [], 'total': 0, 'failed_kinds': []}
    assert not any(t in {'exam_content_cohorts','mock_exams','mock_paper_attempt_snapshots'} for t,_,_ in env.db.calls)
    assert env.db.rpcs == []


@pytest.mark.parametrize('admin', [False, True])
def test_frozen_owner_check_when_live_identity_changes(env, admin):
    attempt = env.db.freeze(env.p)
    env.p.update(programme_id='ielts', metadata={})
    env.actor.update(id=str(uuid4()), admin=admin)
    response = env.client.get(f'{BASE}/tests/attempts/{attempt["id"]}/review')
    assert response.status_code == 404, response.text
    assert not any('marking_rows' in cols for _,cols,_ in env.db.calls)


# These paths resolve in Reading, Grammar, D1, class-lesson or correction-only
# namespaces (Black Eye has no correction capture/admission in PR1). The mixed
# class-assignment correction route uses guard_generic_assignment before IO;
# mock-exam assignment is also closed to Black Eye. Classify all by resource
# path, including share capabilities and session IDs, not parameter spelling.
INDEPENDENT_DOMAIN_ROUTES = """GET /admin/mock-corrections/content-versions/{content_version}/health
GET /admin/mock-corrections/items/{item_attempt_id}/timeline
GET /admin/reading/content/tests/{test_uuid}/preview
GET /api/exercises/d1/sessions/{session_id}
GET /api/reading/test/share/{share_token}/boot
PATCH /admin/mock-corrections/class-assignments/{assignment_id}
PATCH /admin/mock-corrections/mock-exams/{exam_id}
POST /admin/mock-corrections/content-versions/{content_version}/approve
POST /api/exercises/d1/sessions/{session_id}/complete
POST /api/reading/test/share/{share_token}/attempts
DELETE /admin/cohorts/{cohort_id}/lessons/{lesson_id}
DELETE /admin/reading/content/tests/{test_id}
GET /admin/grammar-lessons/attempts/{attempt_id}
GET /admin/reading/content/tests/{test_id}
GET /api/exams/attempts/{attempt_id}/review
GET /api/exams/{test_id}
GET /api/exercises/d1/{exercise_id}
GET /api/reading/test/attempts/{attempt_id}/review
GET /api/reading/test/attempts/{attempt_id}/review-flags
GET /api/reading/test/{test_id}
GET /api/reading/test/{test_id}/attempts/in-progress
GET /api/reading/test/{test_id}/boot
PATCH /admin/cohorts/{cohort_id}/lessons/{lesson_id}
PATCH /admin/exercises/{exercise_id}
PATCH /admin/exercises/{exercise_id}/publish
PATCH /admin/exercises/{exercise_id}/reject
PATCH /admin/exercises/{exercise_id}/unpublish
PATCH /admin/reading/content/tests/{test_id}/visibility
PATCH /api/reading/test/attempts/{attempt_id}/answers
PATCH /api/reading/test/attempts/{attempt_id}/review-flags
POST /admin/reading/content/tests/{test_id}/exam-only
POST /admin/reading/content/tests/{test_id}/lock
POST /admin/reading/content/tests/{test_id}/share
POST /api/exams/{test_id}/attempts
POST /api/exercises/d1/{exercise_id}/attempt
POST /api/reading/test/attempts/{attempt_id}/renderer-affinity
POST /api/reading/test/attempts/{attempt_id}/submit
POST /api/reading/test/{test_id}/attempts
POST /api/reading/test/{test_id}/unlock"""
