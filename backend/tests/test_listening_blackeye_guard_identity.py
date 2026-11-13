"""HTTP regressions for additive Black Eye identities and Skill Drill playback."""
import ast
import inspect
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import pytest
from postgrest.exceptions import APIError

from test_listening_blackeye import BASE, env
from routers import listening as lr, admin_class_assignments


@pytest.fixture
def admin_env(env, monkeypatch):
    monkeypatch.setattr(lr, "_staff_admin_guard", admin_class_assignments.require_admin)
    env.app.include_router(lr.admin_router)
    env.actor["admin"] = True
    normal = dict(id=str(uuid4()), restricted=False, programme_id="ielts-listening-practice", metadata={})
    env.db.rows["listening_tests"].append(normal)
    env.db.rows["listening_content"] = []
    env.db.rows["listening_exercises"] = []
    env.normal = normal
    return env


def denied(response, status=404):
    assert response.status_code == status, response.text
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.parametrize("key", ["content_id", "attempt_id", "exercise_id", "test_id"])
@pytest.mark.parametrize("target", ["missing", "normal", "blackeye"])
@pytest.mark.parametrize("path_hidden", [False, True])
def test_admin_test_path_and_query_are_independent(admin_env, key, target, path_hidden):
    e = admin_env
    value = str(uuid4())
    query_test = e.p if target == "blackeye" else e.normal
    if key == "test_id":
        if target != "missing":
            value = query_test["id"]
    elif target != "missing":
        table = {"content_id": "listening_content", "attempt_id": "listening_test_attempts",
                 "exercise_id": "listening_exercises"}[key]
        row = dict(id=value, test_id=query_test["id"], restricted=query_test["restricted"])
        if key == "exercise_id":
            row = dict(id=value, content_id=str(uuid4()))
            e.db.rows["listening_content"].append(dict(id=row["content_id"], test_id=query_test["id"], restricted=query_test["restricted"]))
        e.db.rows[table].append(row)
    # Keep the positive detail path free of children: query identities may
    # belong to another ordinary test; unresolved identities fail closed.
    path_test = e.p if path_hidden else dict(e.normal, id=str(uuid4()))
    if not path_hidden:
        e.db.rows["listening_tests"].append(path_test)
    response = e.client.get(f'/admin/listening/tests/{path_test["id"]}', params={key: value})
    if path_hidden or target == "blackeye" or target == "missing":
        denied(response)
        assert not any(cols == "*" for _, cols, _ in e.db.calls)
    else:
        assert response.status_code == 200, response.text
        assert response.json()["id"] == path_test["id"]
    assert e.db.rpcs == []
    assert not any(patch for _, _, patch in e.db.calls)


def test_normal_content_path_with_hidden_query_test_denied(admin_env):
    e = admin_env
    content_id = str(uuid4())
    e.db.rows["listening_content"] = [dict(id=content_id, test_id=e.normal["id"])]
    denied(e.client.get(f"/admin/listening/content/{content_id}", params={"test_id": e.p["id"]}))
    assert not any(cols == "*" for _, cols, _ in e.db.calls)


@pytest.mark.parametrize("hidden_first", [False, True])
def test_repeated_query_identity_cannot_mask_hidden_test(admin_env, hidden_first):
    e = admin_env
    ids = [e.p["id"], e.normal["id"]] if hidden_first else [e.normal["id"], e.p["id"]]
    denied(e.client.get(f'/admin/listening/tests/{e.normal["id"]}', params=[("test_id", i) for i in ids]))


@pytest.mark.parametrize("parent", [None, "missing", "missing_test_id", "missing_test"])
def test_existing_exercise_with_unresolved_parent_denied(admin_env, parent):
    e = admin_env
    exercise_id = str(uuid4())
    e.db.rows["listening_exercises"] = [dict(id=exercise_id, content_id=parent)]
    if parent == "missing_test_id":
        e.db.rows["listening_content"] = [dict(id=parent)]
    elif parent == "missing_test":
        e.db.rows["listening_content"] = [dict(id=parent, test_id=str(uuid4()))]
    denied(e.client.get(f'/admin/listening/tests/{e.normal["id"]}', params={"exercise_id": exercise_id}))
    assert not any(cols == "*" for _, cols, _ in e.db.calls)


def standalone_exercise(e, metadata=None):
    content = dict(id=str(uuid4()), test_id=None, metadata=metadata or {},
                   restricted="blackeye" in (metadata or {}))
    exercise = dict(id=str(uuid4()), content_id=content["id"], status="published")
    e.db.rows["listening_content"] = [content]
    e.db.rows["listening_exercises"] = [exercise]
    return exercise


def test_standalone_ordinary_exercise_allowed_after_both_rows_read(admin_env):
    e = admin_env
    exercise = standalone_exercise(e)
    response = e.client.delete(f'/admin/listening/exercises/{exercise["id"]}')
    assert response.status_code == 200, response.text
    assert exercise["status"] == "archived"
    reads = [(table, cols) for table, cols, patch in e.db.calls if not patch]
    assert ("listening_exercises", "id,content_id") in reads
    assert ("listening_content", "id,restricted") in reads


@pytest.mark.parametrize("metadata", [{"blackeye": None}, {"blackeye": {}}, {"blackeye": False}])
def test_standalone_blackeye_content_denied(admin_env, metadata):
    e = admin_env
    exercise = standalone_exercise(e, metadata)
    denied(e.client.delete(f'/admin/listening/exercises/{exercise["id"]}'))
    assert exercise["status"] == "published"
    assert all(cols != "*" and not patch for _, cols, patch in e.db.calls)


@pytest.mark.parametrize("route", ["content", "exercises"])
@pytest.mark.parametrize("metadata", [{}, {"blackeye": None}, {"blackeye": {}}, {"blackeye": False}])
def test_direct_standalone_content_namespace_http(admin_env, monkeypatch, route, metadata):
    e = admin_env
    exercise = standalone_exercise(e, metadata)
    content = e.db.rows["listening_content"][0]
    content["transcript"] = "SYNTHETIC_PRIVATE_TRANSCRIPT"
    content["audio_storage_path"] = "synthetic/private.wav"
    signed = []
    def sign(path, expires):
        signed.append((path, expires))
        return {"signedURL": "https://audio.invalid/synthetic"}
    monkeypatch.setattr(e.db, "storage", SimpleNamespace(
        from_=lambda _bucket: SimpleNamespace(create_signed_url=sign)), raising=False)
    url = (f'/admin/listening/content/{content["id"]}' if route == "content"
           else f'/admin/listening/exercises?content_id={content["id"]}')
    response = e.client.get(url)
    assert ("listening_content", "id,restricted", None) in e.db.calls
    if "blackeye" in metadata:
        denied(response)
        assert "SYNTHETIC_PRIVATE_TRANSCRIPT" not in response.text
        assert all(cols != "*" and not patch for _, cols, patch in e.db.calls)
        assert signed == []
    else:
        assert response.status_code == 200, response.text
        if route == "content":
            assert response.json()["transcript"] == content["transcript"]
            assert response.json()["audio_signed_url"] == "https://audio.invalid/synthetic"
            assert signed == [(content["audio_storage_path"], 3600)]
        else:
            assert response.json()["exercises"][0]["id"] == exercise["id"]
            assert signed == []
    assert e.db.rpcs == []
    assert not any(patch for _, _, patch in e.db.calls)


def test_nonexistent_exercise_denied_before_protected_reads(admin_env):
    e = admin_env
    denied(e.client.delete(f'/admin/listening/exercises/{uuid4()}'))
    assert all(table == "listening_exercises" and cols == "id,content_id" and not patch
               for table, cols, patch in e.db.calls)


@pytest.mark.parametrize("key", ["test_id", "content_id", "attempt_id"])
def test_standalone_exercise_never_clears_other_hidden_identity(admin_env, key):
    e = admin_env
    exercise = standalone_exercise(e)
    value = e.p["id"]
    if key != "test_id":
        value = str(uuid4())
        table = "listening_content" if key == "content_id" else "listening_test_attempts"
        e.db.rows[table].append(dict(id=value, test_id=e.p["id"]))
    denied(e.client.get(f'/admin/listening/tests/{value if key == "test_id" else e.normal["id"]}',
                        params={"exercise_id": exercise["id"], key: value}))
    assert all(cols != "*" and not patch for _, cols, patch in e.db.calls)


@pytest.mark.parametrize("table", ["listening_exercises", "listening_content", "listening_tests"])
def test_exercise_identity_lookup_errors_are_private_404(admin_env, monkeypatch, table):
    e = admin_env
    exercise = standalone_exercise(e)
    e.db.rows["listening_content"][0]["test_id"] = e.normal["id"]
    original = e.db.table
    def failing(name):
        query = original(name)
        if name == table:
            def fail():
                raise RuntimeError("Synthetic identity lookup failure")
            query.execute = fail
        return query
    monkeypatch.setattr(e.db, "table", failing)
    response = e.client.delete(f'/admin/listening/exercises/{exercise["id"]}')
    if table == "listening_tests":
        # Content's persisted flag is authoritative; no catalog re-inference.
        assert response.status_code == 200, response.text
        assert exercise["status"] == "archived"
        assert all(t != "listening_tests" for t, _, _ in e.db.calls)
    else:
        denied(response)
        assert exercise["status"] == "published"
        assert all(cols != "*" and not patch for _, cols, patch in e.db.calls)


@pytest.mark.parametrize("identity", ["package_metadata", "child_programme", "child_metadata"])
@pytest.mark.parametrize("action", ["publish", "archive"])
def test_normal_package_cannot_publish_or_archive_hidden_children(admin_env, identity, action):
    e = admin_env
    package = dict(id=str(uuid4()), package_id="ordinary-package", programme_id="ielts-listening-practice")
    e.db.rows["listening_content_packages"] = [package]
    if identity == "package_metadata":
        package["metadata"] = {"blackeye": None}
    else:
        child = deepcopy(e.p)
        child["content_package_id"] = package["id"]
        if identity == "child_metadata":
            child["programme_id"] = "ielts-listening-practice"
        e.db.rows["listening_tests"] = [e.normal, child]
    denied(e.client.post(f'/admin/listening/packages/{package["package_id"]}/{action}',
                         json={"manifest_sha256": "a" * 64}))
    assert e.db.rpcs == []
    assert not any(patch for _, _, patch in e.db.calls)


@pytest.mark.parametrize("suffix", ["", "/aggregate"])
@pytest.mark.parametrize("code_kind", ["uuid_external", "uuid_primary", "duplicate", "unknown_plus_hidden"])
def test_external_codes_check_all_interpretations(admin_env, suffix, code_kind):
    e = admin_env
    value = e.normal["id"] if code_kind.startswith("uuid") else "DUPLICATE"
    if code_kind == "uuid_primary":
        value = e.p["id"]
        e.normal["test_id"] = value
    else:
        e.p["test_id"] = value
        e.normal["test_id"] = value
        e.db.rows["listening_tests"] = [e.normal, e.p]
    params = [("test_id", value)]
    if code_kind == "unknown_plus_hidden":
        params = [("test_id", e.p["id"]), ("test_id", "UNKNOWN-CODE")]
    denied(e.client.get("/admin/listening/dictation-reports" + suffix, params=params))
    assert not any(table == "dictation_sessions" for table, _, _ in e.db.calls)


@pytest.mark.parametrize("action", ["publish", "sync"])
def test_drill_alias_checks_hidden_test_before_payload_or_writes(admin_env, action):
    e = admin_env
    e.p["test_type"] = "drill"
    kwargs = {} if action == "publish" else {"files": {name: (name, b"{}")
        for name in ("source_json", "solution", "timings", "audio")}}
    denied(e.client.post(f'/admin/listening/drills/{e.p["id"]}/{action}', **kwargs))
    assert all(table == "listening_tests" and cols != "*" and not patch
               for table, cols, patch in e.db.calls)
    assert e.db.rpcs == []


def test_dictation_session_target_denied_before_full_report(admin_env):
    e = admin_env
    session_id = str(uuid4())
    e.db.rows["dictation_sessions"] = [dict(id=session_id, test_id=e.p["id"], results=["PRIVATE"])]
    denied(e.client.get(f"/admin/listening/dictation-reports/{session_id}"))
    assert all(cols != "*" and not patch for _, cols, patch in e.db.calls)


def test_identifier_admin_routes_use_module_staff_guard():
    """Every route authenticates as its first await, before any database read."""
    assert lr.require_admin.__module__ == lr.__name__
    tree = ast.parse(inspect.getsource(lr))
    functions = {node.name: node for node in tree.body
                 if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}

    def first_guard(name, seen):
        assert name not in seen, name
        node = functions[name]
        assert not any(isinstance(n, ast.ImportFrom) and any(a.name == "require_admin" for a in n.names)
                       for n in ast.walk(node)), name
        body = ast.Module(body=node.body, type_ignores=[])
        calls = sorted((n for n in ast.walk(body) if isinstance(n, ast.Call)),
                       key=lambda n: (n.lineno, n.col_offset))
        assert calls, name
        call = calls[0]
        assert isinstance(call.func, ast.Name), name
        awaits = sorted((n for n in ast.walk(body) if isinstance(n, ast.Await)),
                        key=lambda n: (n.lineno, n.col_offset))
        assert awaits and awaits[0].value is call, name
        if call.func.id != "require_admin":
            first_guard(call.func.id, seen | {name})

    routes = list(lr.admin_router.routes)
    assert routes
    for route in routes:
        first_guard(inspect.unwrap(route.endpoint).__name__, set())


@pytest.mark.parametrize("key,method,path,table", [
    ("content_id", "get", "content", "listening_content"),
    ("attempt_id", "get", "attempts", "listening_test_attempts"),
    ("exercise_id", "delete", "exercises", "listening_exercises"),
])
@pytest.mark.parametrize("query_found", [False, True])
def test_other_path_identities_survive_same_query_key(admin_env, key, method, path, table, query_found):
    e = admin_env
    path_id, query_id = str(uuid4()), str(uuid4())
    rows = [dict(id=path_id, test_id=e.p["id"])]
    if query_found:
        rows.append(dict(id=query_id, test_id=e.normal["id"]))
    if key == "exercise_id":
        for row in rows:
            row["content_id"] = str(uuid4())
            e.db.rows["listening_content"].append(dict(id=row["content_id"], test_id=row.pop("test_id")))
    e.db.rows[table] = rows
    denied(getattr(e.client, method)(f"/admin/listening/{path}/{path_id}", params={key: query_id}))
    assert all(cols != "*" and not patch for _, cols, patch in e.db.calls)
    assert e.db.rpcs == []


@pytest.mark.parametrize("route", ["content", "exercises", "exercise"])
@pytest.mark.parametrize("provenance", ["hidden_source", "missing_source", "hidden_parent",
                                         "missing_parent", "cycle", "ordinary_source", "ordinary_parent"])
def test_content_provenance_http(admin_env, route, provenance):
    e = admin_env
    exercise = standalone_exercise(e)
    content = e.db.rows["listening_content"][0]
    # Migration 381 stamps this flag, including broken/cyclic provenance.
    # This HTTP test proves consumption; N2 proves stamping in PostgreSQL.
    content["restricted"] = not provenance.startswith("ordinary")
    content["audio_storage_path"] = None
    if provenance.endswith("source"):
        content["source_test_id"] = (e.p["id"] if provenance.startswith("hidden") else
                                      e.normal["id"] if provenance.startswith("ordinary") else str(uuid4()))
    else:
        content["parent_content_id"] = content["id"] if provenance == "cycle" else str(uuid4())
        if provenance in {"hidden_parent", "ordinary_parent"}:
            e.db.rows["listening_content"].append(dict(id=content["parent_content_id"], test_id=None,
                metadata={"blackeye": None} if provenance == "hidden_parent" else {}))
    url = (f'/admin/listening/content/{content["id"]}' if route == "content" else
           f'/admin/listening/exercises?content_id={content["id"]}' if route == "exercises" else
           f'/admin/listening/exercises/{exercise["id"]}')
    response = getattr(e.client, "delete" if route == "exercise" else "get")(url)
    if provenance.startswith("ordinary"):
        assert response.status_code == 200, response.text
    else:
        denied(response)
        assert all(cols != "*" and not patch for _, cols, patch in e.db.calls)
    assert e.db.rpcs == []


@pytest.mark.parametrize("catalog", ["deleted", "changed"])
def test_admin_attempt_frozen_identity_survives_catalog_changes(admin_env, catalog):
    e = admin_env
    attempt = e.db.freeze(e.p)
    e.db.rows["listening_tests"] = [e.normal]
    if catalog == "changed":
        e.db.rows["listening_tests"].append(dict(e.p, programme_id="ordinary", metadata={}))
    denied(e.client.get(f'/admin/listening/attempts/{attempt["id"]}'))
    assert e.db.calls == [("listening_test_attempts", "id,restricted", None)]
    assert all(cols != "*" and not patch for _, cols, patch in e.db.calls)


@pytest.mark.parametrize("parent", ["hidden", "missing", "empty", "ordinary", "duplicate"])
def test_admin_session_external_parent_after_delete(admin_env, parent):
    e = admin_env
    code = "SYNTHETIC-EXTERNAL"
    e.p["test_id"] = code
    e.normal["test_id"] = code if parent in {"ordinary", "duplicate"} else "OTHER"
    if parent == "ordinary":
        e.db.rows["listening_tests"] = [e.normal]
    session = dict(id=str(uuid4()), test_id=None, results=[], restricted=parent != "ordinary",
                   test_id_external=None if parent == "empty" else "UNKNOWN" if parent == "missing" else code)
    e.db.rows["dictation_sessions"] = [session]
    response = e.client.get(f'/admin/listening/dictation-reports/{session["id"]}')
    if parent == "ordinary":
        assert response.status_code == 200, response.text
    else:
        denied(response)
        assert all(cols != "*" and not patch for _, cols, patch in e.db.calls)
    assert e.db.rpcs == []


@pytest.mark.parametrize("key", ["test_id", "content_id", "exercise_id", "attempt_id",
                                 "session_id", "package_id", "drill_id"])
def test_query_identity_limits_and_empty_values(admin_env, key):
    e = admin_env
    url = f'/admin/listening/tests/{e.normal["id"]}'
    response = e.client.get(url, params=[(key, str(uuid4()))] * 21)
    denied(response, 422)
    assert e.db.calls == []
    response = e.client.get(url, params=[(key, ""), (key, " ")])
    assert response.status_code == 200, response.text
    response = e.client.get(url, params=[(key, "")] * 20)
    assert response.status_code == 200, response.text


@pytest.mark.parametrize("path", ["content", "exercises", "tests", "attempts",
                                  "dictation-reports", "dictation-reports/aggregate"])
def test_query_only_admin_routes_authenticate_before_identity_reads(admin_env, path):
    e = admin_env
    e.actor["admin"] = False
    response = e.client.get(f'/admin/listening/{path}',
                            params={"test_id": e.p["id"], "content_id": str(uuid4())})
    assert response.status_code == 403, response.text
    assert e.db.calls == []
    assert e.db.rpcs == []


@pytest.mark.parametrize("route", ["tests", "content", "exercises", "attempts", "dictation-reports"])
def test_hidden_identity_uses_ordinary_not_found_text(admin_env, route):
    e = admin_env
    value = e.p["id"]
    method = "delete" if route == "exercises" else "get"
    if route == "content":
        value = str(uuid4())
        e.db.rows["listening_content"] = [dict(id=value, test_id=None, metadata={"blackeye": None})]
    elif route == "exercises":
        value = standalone_exercise(e, {"blackeye": None})["id"]
    elif route == "attempts":
        value = e.db.freeze(e.p)["id"]
    elif route == "dictation-reports":
        value = str(uuid4())
        e.db.rows["dictation_sessions"] = [dict(id=value, test_id=e.p["id"])]
    hidden = getattr(e.client, method)(f'/admin/listening/{route}/{value}')
    missing = getattr(e.client, method)(f'/admin/listening/{route}/{uuid4()}')
    denied(hidden)
    assert missing.status_code == 404, missing.text
    assert hidden.json() == missing.json()


@pytest.mark.parametrize("stage", ["listening", "dictation"])
@pytest.mark.parametrize("foreign", [False, True])
def test_assigned_blackeye_playback_denied_before_assignment_or_write(env, monkeypatch, stage, foreign):
    attempt = env.db.freeze(env.p)
    attempt["class_assignment_item_id"] = str(uuid4())
    if stage == "dictation":
        attempt = dict(attempt, paper_revision=None)
        env.db.rows["dictation_attempts"] = [attempt]
    if foreign:
        env.actor["id"] = str(uuid4())
    def forbidden(*args, **kwargs):
        pytest.fail("Black Eye playback reached assignment validation")
    monkeypatch.setattr(lr, "validate_class_item_for_test", forbidden)
    response = env.client.post(f'{BASE}/skill-drill-playback/{attempt["id"]}', json={
        "stage": stage, "page_id": str(uuid4()), "plays": 1, "played_ms": 1000})
    denied(response)
    assert env.db.rpcs == []
    assert not any(patch or "marking_rows" in cols or (table == "mock_paper_attempt_snapshots" and cols == "*")
                   for table, cols, patch in env.db.calls)


@pytest.mark.parametrize("failure", [None, "unassigned", "ended", "not_found", "mismatch", "deadline",
                                     "not_drill", "rpc_inactive", "rpc_scope", "missing"])
@pytest.mark.parametrize("stage", ["listening", "dictation"])
def test_generic_playback_preserves_success_and_no_store_errors(env, monkeypatch, stage, failure):
    test = dict(id=str(uuid4()), restricted=False, programme_id="ielts-listening-practice", metadata={})
    env.db.rows["listening_tests"] = [test]
    attempt = dict(id=str(uuid4()), user_id=env.actor["id"], test_id=test["id"],
                   status="submitted" if failure == "ended" else "in_progress",
                   class_assignment_item_id=None if failure == "unassigned" else str(uuid4()))
    env.db.rows["listening_test_attempts" if stage == "listening" else "dictation_attempts"] = (
        [] if failure == "missing" else [attempt])
    def validate(*args, **kwargs):
        errors = {"not_found": lr.ItemNotFoundError, "mismatch": lr.TaskMismatchError, "deadline": lr.DeadlinePassedError}
        if failure in errors:
            raise errors[failure]("Synthetic assignment denial")
        return dict(skill="listening", content_config={} if failure == "not_drill" else {"skill_drill": {"sections": [1]}})
    monkeypatch.setattr(lr, "validate_class_item_for_test", validate)
    def rpc(name, params):
        env.db.rpcs.append((name, params))
        def execute():
            if failure in {"rpc_inactive", "rpc_scope"}:
                message = "skill_drill_attempt_inactive" if failure == "rpc_inactive" else "skill_drill_checkpoint_scope"
                raise APIError(dict(code="55000", message=message, details="", hint=""))
            return SimpleNamespace(data=None)
        return SimpleNamespace(execute=execute)
    monkeypatch.setattr(env.db, "rpc", rpc)
    response = env.client.post(f'{BASE}/skill-drill-playback/{attempt["id"]}', json={
        "stage": stage, "page_id": str(uuid4()), "plays": 1, "played_ms": 1000})
    if failure is None:
        assert response.status_code == 204, response.text
        assert env.db.rpcs[0][0] == "fn_record_listening_drill_playback_v2"
    else:
        denied(response, 409 if failure in {"ended", "deadline", "rpc_inactive"} else 404)
        if not failure.startswith("rpc_"):
            assert env.db.rpcs == []
