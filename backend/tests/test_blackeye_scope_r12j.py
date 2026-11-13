"""SA scope ruling C2-C4/GAP7; synthetic HTTP boundaries, no live database.

Package import has a CLI/service entry, not a deployed HTTP endpoint. The test
adapter below exposes that exact service gate/commit through FastAPI so status,
headers and zero-mutation behavior are exercised without adding a product API.
"""
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from config import settings
from models.listening_blackeye import PROGRAMME
from routers import listening as lr
from services import listening_package_import as importer
from test_listening_blackeye import BASE, env


class ImportDB:
    def __init__(self, ready=True, error=None):
        self.ready, self.error = ready, error
        self.lookups, self.writes, self.import_rpcs = [], [], []
        self.storage = SimpleNamespace(from_=self.bucket)

    def bucket(self, name):
        self.writes.append(("storage", name))
        return object()

    def rpc(self, name, args):
        if name == "fn_content_namespace_ready":
            self.lookups.append(name)
            def execute():
                if self.error:
                    raise self.error
                return SimpleNamespace(data=self.ready)
            return SimpleNamespace(execute=execute)
        self.import_rpcs.append((name, args))
        self.writes.append(("rpc", name))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=[dict(
            action="created", lessons_written=1, forms_written=1,
            items_written=1, stimuli_written=1)]))


def import_plan():
    return SimpleNamespace(package=dict(programme_id="ielts", source_counts=dict(
        lessons=1, forms=1, items=1, stimuli=1)),
        forms=[dict(metadata={}, content_metadata={}, audio_storage_path="synthetic.wav")],
        lessons=[], stimuli=[], visual_assets=[], report={})


def import_client(plan, db, monkeypatch):
    app = FastAPI()
    monkeypatch.setattr(importer, "_form_audio_bytes", lambda *_: b"synthetic")
    monkeypatch.setattr(importer, "_ensure_immutable_object", lambda *a: "created")

    @app.post("/import")
    def run(commit: bool = False):
        importer.require_import_namespace_ready(plan, db)
        if commit:
            return importer.commit_import_plan(plan, db, bucket_name="synthetic")
        return {"dry_run_mutations": 0}

    return TestClient(app)


def assert_import_denied(client, db):
    responses = [client.post("/import", params={"commit": value}) for value in (False, True)]
    for response in responses:
        assert response.status_code == 503, response.text
        assert response.headers["cache-control"] == "private, no-store"
    assert responses[0].json() == responses[1].json()
    assert db.writes == [] and db.import_rpcs == []
    # The only permitted RPC is M-A's read-only catalog capability lookup.
    assert set(db.lookups) <= {"fn_content_namespace_ready"}


@pytest.mark.parametrize("code", ["PGRST202", "42883"])
def test_import_missing_ma_denied_without_writes(monkeypatch, code):
    monkeypatch.setattr(settings, "RESTRICTED_NAMESPACE_READY", True)
    plan = import_plan()
    plan.package["programme_id"] = PROGRAMME
    db = ImportDB(error=APIError(dict(code=code, message="missing", details=None, hint=None)))
    assert_import_denied(import_client(plan, db, monkeypatch), db)


def test_import_lookup_error_denied_without_writes(monkeypatch):
    monkeypatch.setattr(settings, "RESTRICTED_NAMESPACE_READY", True)
    plan = import_plan()
    plan.forms[0]["metadata"] = {"blackeye": None}
    db = ImportDB(error=RuntimeError("synthetic lookup failure"))
    assert_import_denied(import_client(plan, db, monkeypatch), db)


def test_import_flag_off_even_when_ma_present(monkeypatch):
    monkeypatch.setattr(settings, "RESTRICTED_NAMESPACE_READY", False)
    plan = import_plan()
    plan.package["programme_id"] = PROGRAMME
    db = ImportDB(ready=True)
    assert_import_denied(import_client(plan, db, monkeypatch), db)
    assert db.lookups == []


def test_import_flag_on_but_ma_missing(monkeypatch):
    monkeypatch.setattr(settings, "RESTRICTED_NAMESPACE_READY", True)
    plan = import_plan()
    plan.package["programme_id"] = PROGRAMME
    db = ImportDB(ready=False)
    assert_import_denied(import_client(plan, db, monkeypatch), db)


def test_import_package_programme_blackeye_denied(monkeypatch):
    monkeypatch.setattr(settings, "RESTRICTED_NAMESPACE_READY", False)
    plan = import_plan()
    plan.package["programme_id"] = PROGRAMME
    db = ImportDB()
    assert_import_denied(import_client(plan, db, monkeypatch), db)


@pytest.mark.parametrize("target", ["form", "content", "package", "test_programme"])
@pytest.mark.parametrize("marker", [None, False, {}])
def test_import_ordinary_package_with_one_hidden_row_denied(monkeypatch, target, marker):
    monkeypatch.setattr(settings, "RESTRICTED_NAMESPACE_READY", False)
    plan = import_plan()
    if target == "test_programme":
        plan.forms[0]["programme_id"] = PROGRAMME
    elif target == "package":
        plan.package["metadata"] = {"blackeye": marker}
    else:
        plan.forms[0]["metadata" if target == "form" else "content_metadata"] = {"blackeye": marker}
    db = ImportDB()
    assert_import_denied(import_client(plan, db, monkeypatch), db)


def test_import_ordinary_package_unchanged(monkeypatch):
    monkeypatch.setattr(settings, "RESTRICTED_NAMESPACE_READY", False)
    db = ImportDB(error=AssertionError("ordinary import must not probe M-A"))
    client = import_client(import_plan(), db, monkeypatch)
    assert client.post("/import").json() == {"dry_run_mutations": 0}
    assert db.writes == [] and db.import_rpcs == [] and db.lookups == []
    response = client.post("/import", params={"commit": True})
    assert response.status_code == 200, response.text
    assert response.json()["action"] == "created"
    assert [name for name, _ in db.import_rpcs] == ["import_listening_content_package_atomic"]
    assert db.lookups == []


def test_import_requires_both_flag_and_catalog_positive(monkeypatch):
    monkeypatch.setattr(settings, "RESTRICTED_NAMESPACE_READY", True)
    plan = import_plan()
    plan.package["programme_id"] = PROGRAMME
    db = ImportDB(ready=True)
    response = import_client(plan, db, monkeypatch).post("/import", params={"commit": True})
    assert response.status_code == 200, response.text
    assert db.lookups == ["fn_content_namespace_ready"] * 2
    assert len(db.import_rpcs) == 1


@pytest.mark.parametrize("route", ["content", "boot", "exercises", "attempt_content", "attempt_exercise"])
@pytest.mark.parametrize("chain", ["standalone", "ordinary", "hidden", "missing", "marker", "cycle", "missing_content",
                                    "direct_ordinary", "direct_hidden", "direct_missing",
                                    "ordinary_marker", "ordinary_hidden_source", "ordinary_missing_source", "ordinary_cycle",
                                    "missing_test_id"])
def test_learner_by_id_strict_chain_before_payload_or_signing(env, monkeypatch, route, chain):
    content = dict(id=str(uuid4()), test_id=None, status="published", metadata={},
                   transcript="SYNTHETIC_PRIVATE_TRANSCRIPT", audio_storage_path="synthetic.wav")
    ancestor = dict(id=str(uuid4()), test_id=None, metadata={})
    env.db.rows["listening_content"] = [content, ancestor]
    if chain in {"ordinary", "hidden", "missing"}:
        content["parent_content_id"] = ancestor["id"]
        ancestor["source_test_id"] = env.p["id"] if chain == "hidden" else str(uuid4())
        if chain == "ordinary":
            env.db.rows["listening_tests"].append(dict(id=ancestor["source_test_id"], metadata={}, programme_id="ielts"))
    elif chain == "marker":
        content["metadata"] = {"blackeye": None}
    elif chain == "cycle":
        content["parent_content_id"] = ancestor["id"]
        ancestor["parent_content_id"] = content["id"]
    elif chain == "missing_content":
        env.db.rows["listening_content"] = []
    elif chain == "missing_test_id":
        del content["test_id"]
    if chain.startswith(("direct_", "ordinary_")):
        content["test_id"] = env.p["id"] if chain == "direct_hidden" else str(uuid4())
        if chain not in {"direct_hidden", "direct_missing"}:
            env.db.rows["listening_tests"].append(dict(id=content["test_id"], metadata={}, programme_id="ielts"))
        if chain == "ordinary_marker":
            content["metadata"] = {"blackeye": False}
        elif chain.endswith("source"):
            content["source_test_id"] = env.p["id"] if chain == "ordinary_hidden_source" else str(uuid4())
        elif chain == "ordinary_cycle":
            content["parent_content_id"] = content["id"]
    exercise = dict(id=str(uuid4()), content_id=content["id"], status="published", exercise_type="dictation",
                    payload={"answers": ["SYNTHETIC_PRIVATE_KEY"]}, segments=[])
    env.db.rows["listening_exercises"] = [exercise]
    signs, grades = [], []
    def sign(*args):
        signs.append(args)
        return {"signedURL": "synthetic-signed"}
    env.db.storage = SimpleNamespace(from_=lambda *_: SimpleNamespace(create_signed_url=sign))
    def grade(**kwargs):
        grades.append(kwargs)
        return {"graded": True}
    monkeypatch.setattr(lr, "_grade_and_save_dictation", grade)
    if route == "content":
        response = env.client.get(f'{BASE}/content/{content["id"]}')
    elif route == "boot":
        response = env.client.get(f'{BASE}/dictation/{content["id"]}/boot')
    elif route == "exercises":
        response = env.client.get(f'{BASE}/exercises', params={"content_id": content["id"]})
    else:
        identity = {"content_id": content["id"]} if route == "attempt_content" else {"exercise_id": exercise["id"]}
        response = env.client.post(f"{BASE}/attempts", json={**identity, "mode": "dictation", "user_transcript": "synthetic"})
    allowed = chain in {"ordinary", "standalone", "direct_ordinary"}
    expected = 200 if allowed else 422 if chain in {
        "hidden", "marker", "direct_hidden", "ordinary_marker", "ordinary_hidden_source"} else 404
    assert response.status_code == expected, response.text
    assert "SYNTHETIC_PRIVATE" not in response.text
    if allowed:
        assert bool(signs) == (route in {"content", "boot"})
        assert bool(grades) == route.startswith("attempt")
    else:
        assert response.headers["cache-control"] == "private, no-store"
        assert signs == [] and grades == []
        assert all(cols != "*" and "transcript" not in cols and "payload" not in cols and not patch
                   for _, cols, patch in env.db.calls)
    assert env.db.rpcs == []
    content_reads = [cols for table, cols, _ in env.db.calls if table == "listening_content"]
    assert content_reads[0] == "test_id"
    if chain == "direct_hidden":
        assert content_reads == ["test_id"]
    else:
        assert "id,test_id,metadata,source_test_id,parent_content_id" in content_reads


@pytest.mark.parametrize("method", ["create", "update"])
@pytest.mark.parametrize("identity", ["programme", "metadata"])
def test_mock_exam_attach_blackeye_before_any_write(env, monkeypatch, method, identity):
    from routers import admin_mock_exams as router
    from services import mock_exam_service as svc
    async def admin(_):
        return {"id": env.actor["id"]}
    monkeypatch.setattr(router, "require_admin", admin)
    monkeypatch.setattr(svc, "supabase_admin", env.db)
    env.app.include_router(router.router)
    if identity == "metadata":
        env.p["programme_id"] = "ielts"
    body = {"listening_test_id": env.p["id"]}
    if method == "create":
        response = env.client.post("/admin/mock-exams", json={**body, "code": "synthetic", "title": "Synthetic"})
    else:
        # The mode RPC must not run even in a mixed update.
        response = env.client.patch(f"/admin/mock-exams/{uuid4()}", json={**body, "exam_mode": "retake"})
    assert response.status_code == 503, response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert env.db.rpcs == []
    assert all(table == "listening_tests" and cols != "*" and not patch for table, cols, patch in env.db.calls)


@pytest.mark.parametrize("chain", ["ordinary", "marker", "hidden_source", "missing", "cycle"])
def test_feedback_content_identity_uses_strict_classifier(env, monkeypatch, chain):
    from routers import feedback
    async def user(_):
        return {"id": env.actor["id"]}
    monkeypatch.setattr(feedback, "get_supabase_user", user)
    monkeypatch.setattr(feedback, "supabase_admin", env.db)
    env.app.include_router(feedback.router)
    content = dict(id=str(uuid4()), test_id=None, metadata={})
    if chain == "marker":
        content["metadata"] = {"blackeye": False}
    elif chain == "hidden_source":
        content["source_test_id"] = env.p["id"]
    elif chain == "cycle":
        content["parent_content_id"] = content["id"]
    env.db.rows["listening_content"] = [] if chain == "missing" else [content]
    env.db.rows["user_feedback"] = []
    response = env.client.post("/api/feedback", headers={"authorization": "Bearer synthetic"}, json={
        "type": "flag", "skill": "listening", "content_id": content["id"], "category": "other"})
    assert response.status_code == (200 if chain == "ordinary" else 404), response.text
    if chain != "ordinary":
        assert response.headers["cache-control"] == "private, no-store"
        assert env.db.rows["user_feedback"] == []
        assert all(cols != "*" and not patch for _, cols, patch in env.db.calls)
    assert env.db.rpcs == []


@pytest.mark.parametrize("owned", [False, True])
def test_feedback_frozen_attempt_cannot_escape_after_catalog_change(env, monkeypatch, owned):
    from routers import feedback
    async def user(_):
        return {"id": env.actor["id"]}
    monkeypatch.setattr(feedback, "get_supabase_user", user)
    monkeypatch.setattr(feedback, "supabase_admin", env.db)
    env.app.include_router(feedback.router)
    attempt = env.db.freeze(env.p)
    env.p.update(programme_id="ielts", metadata={})
    if not owned:
        env.actor["id"] = str(uuid4())
    env.db.rows["user_feedback"] = []
    response = env.client.post("/api/feedback", headers={"authorization": "Bearer synthetic"}, json={
        "type": "flag", "skill": "listening", "attempt_id": attempt["id"], "q_num": 1})
    assert response.status_code == (422 if owned else 404), response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert env.db.rows["user_feedback"] == [] and env.db.rpcs == []
    assert all(cols != "*" and not patch for _, cols, patch in env.db.calls)


@pytest.mark.parametrize("identity", ["programme", "metadata", "assignment_config"])
def test_class_start_assignment_denies_blackeye_before_attempt_reads_or_writes(env, monkeypatch, identity):
    from routers import class_student as router
    async def user(_):
        return {"id": env.actor["id"]}
    monkeypatch.setattr(router, "get_supabase_user", user)
    monkeypatch.setattr(router, "supabase_admin", env.db)
    monkeypatch.setattr(router, "_student_for_user", lambda *_: {"id": "synthetic-student"})
    env.app.include_router(router.router)
    if identity == "metadata":
        env.p["programme_id"] = "ielts"
    assignment = dict(id=str(uuid4()), cohort_id="synthetic-cohort", skill="listening", status="published",
                      content_id=env.p["id"], content_config={})
    if identity == "assignment_config":
        assignment["content_config"] = {"blackeye": None}
        assignment["content_id"] = None
    item = dict(id=str(uuid4()), assignment_id=assignment["id"], student_id="synthetic-student")
    env.db.rows["class_assignments"] = [assignment]
    env.db.rows["class_assignment_items"] = [item]
    response = env.client.post(f'/api/class/assignments/{item["id"]}/start')
    assert response.status_code == 503, response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert env.db.rpcs == []
    assert all(not patch and table in {"class_assignments", "class_assignment_items", "listening_tests",
                                      "content_access_namespaces"}
               for table, _, patch in env.db.calls)


@pytest.mark.parametrize("entry", ["package_cli", "source_cli", "package_commit", "source_commit"])
def test_real_import_entries_gate_before_dry_run_success_or_any_write(monkeypatch, entry, capsys):
    from fastapi import HTTPException
    from services import listening_source_package_import as source
    from scripts import import_listening_content_package as package_cli
    from scripts import import_listening_source_collection as source_cli
    import sys
    monkeypatch.setattr(settings, "RESTRICTED_NAMESPACE_READY", False)
    plan = import_plan()
    plan.package["programme_id"] = PROGRAMME
    db = ImportDB()
    if entry == "package_cli":
        monkeypatch.setattr(sys, "argv", ["import", "--release-root", "synthetic"])
        monkeypatch.setattr(package_cli, "discover_packages", lambda *_: [object()])
        monkeypatch.setattr(package_cli, "build_import_plan", lambda *a, **kw: plan)
        def forbidden():
            raise AssertionError("flag-off dry run must not connect")
        monkeypatch.setattr(package_cli, "_admin", forbidden)
        run = package_cli.main
    elif entry == "source_cli":
        monkeypatch.setattr(sys, "argv", ["import", "--release-root", "synthetic"])
        monkeypatch.setattr(source_cli, "build_source_import_plan", lambda *a, **kw: plan)
        run = source_cli.main
    else:
        commit = importer.commit_import_plan if entry == "package_commit" else source.commit_source_import_plan
        run = lambda: commit(plan, db, bucket_name="synthetic")
    with pytest.raises(HTTPException) as error:
        run()
    assert error.value.status_code == 503
    assert error.value.headers["Cache-Control"] == "private, no-store"
    assert "DRY RUN PASS" not in capsys.readouterr().out
    assert db.writes == [] and db.import_rpcs == [] and db.lookups == []


@pytest.mark.parametrize("mode", ["dictation", "gist", "true_false", "mcq"])
@pytest.mark.parametrize("anchor", ["content_id", "exercise_id"])
def test_all_attempt_modes_deny_hidden_before_grader_or_lazy_writes(env, monkeypatch, mode, anchor):
    content = dict(id=str(uuid4()), test_id=None, metadata={"blackeye": None}, status="published")
    exercise = dict(id=str(uuid4()), content_id=content["id"], exercise_type=mode, status="published")
    env.db.rows["listening_content"] = [content]
    env.db.rows["listening_exercises"] = [exercise]
    def forbidden(*args, **kwargs):
        raise AssertionError("hidden identity reached grading or lazy write")
    for name in ("_grade_and_save_dictation", "_grade_and_save_gist", "_grade_and_save_true_false",
                 "_grade_and_save_mcq", "_ensure_dictation_exercise", "_insert_attempt", "_enforce_gist_rate_limit"):
        monkeypatch.setattr(lr, name, forbidden)
    response = env.client.post(f"{BASE}/attempts", json={anchor: content["id"] if anchor == "content_id" else exercise["id"],
                                                     "mode": mode, "user_transcript": "synthetic"})
    assert response.status_code == 422, response.text
    assert response.headers["cache-control"] == "private, no-store"
    assert env.db.rpcs == []
    assert all(cols != "*" and "transcript" not in cols and not patch for _, cols, patch in env.db.calls)
