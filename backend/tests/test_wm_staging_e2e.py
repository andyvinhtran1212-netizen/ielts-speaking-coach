"""Hermetic safety/contract checks for the standalone WM staging runner."""

from importlib.util import module_from_spec, spec_from_file_location
import io
import json
from pathlib import Path
import sys
from urllib.error import HTTPError
from unittest.mock import MagicMock, Mock

import pytest


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/e2e-staging/wm_e2e.py"
spec = spec_from_file_location("wm_staging_e2e", SCRIPT)
wm = module_from_spec(spec)
sys.modules[spec.name] = wm
spec.loader.exec_module(wm)

CID = "10000000-0000-0000-0000-000000000001"
TASK = "20000000-0000-0000-0000-000000000001"
STUDENT = "30000000-0000-0000-0000-000000000001"
GROUP = "50000000-0000-0000-0000-000000000001"
TOKEN = "test-header.test-payload.test-signature"


def fixture_api(config, handler):
    """Keep the real route guard/serialization; replace only HTTP transport."""
    api = wm.API(config)
    api.opener = MagicMock()

    def call(role, method, path, body):
        result = handler(role, method, path, body)
        api.opener.open.return_value.__enter__.return_value.read.return_value = json.dumps(result).encode()
        return api.call(role, method, path, body)

    return Mock(call=Mock(side_effect=call))


@pytest.mark.parametrize("url", [
    "https://averlearning.com", "https://ielts-speaking-coach.up.railway.app",
    "http://" + wm.STAGING_HOST, "https://" + wm.STAGING_HOST + ".evil.test",
    "https://" + wm.STAGING_HOST + "@evil.test", "https://user:password@" + wm.STAGING_HOST,
    "https://" + wm.STAGING_HOST + ":444", "https://" + wm.STAGING_HOST + "/api",
    "https://" + wm.STAGING_HOST + "?target=production", "https://" + wm.STAGING_HOST + "#prod",
    "https://" + wm.STAGING_HOST + "?", "https://" + wm.STAGING_HOST + "#",
    "https://" + wm.STAGING_HOST + "/\n", "https://" + wm.STAGING_HOST + ".",
    " https://" + wm.STAGING_HOST, "https://" + wm.STAGING_HOST + ":bad",
])
def test_host_guard_rejects_other_origins_and_url_ambiguities(url):
    with pytest.raises(wm.Stop, match="allowlisted staging"):
        wm.staging_url(url)


@pytest.mark.parametrize("suffix", ["", "/", ":443", ":443/"])
def test_host_guard_allows_only_staging_origin(suffix):
    assert wm.staging_url(wm.STAGING_URL + suffix) == wm.STAGING_URL


def test_env_missing_credentials_is_empty_and_never_falls_back_to_other_vars():
    config = wm.Config.from_env({"SUPABASE_SERVICE_KEY": "never-read", "PASSWORD": "never-read"})
    assert config.tokens == {}
    assert config.base_url == wm.STAGING_URL
    assert config.listening_test is None


def test_env_uses_only_e2e_tokens_and_source_uuids_and_hides_secrets_in_repr():
    config = wm.Config.from_env({"E2E_STUDENT_TOKEN": TOKEN, "E2E_LISTENING_TEST_ID": TASK})
    assert config.tokens == {"STUDENT": TOKEN}
    assert config.listening_test == TASK
    assert TOKEN not in repr(config)


@pytest.mark.parametrize("env", [
    {"E2E_ADMIN_TOKEN": "secret\r\nInjected: header"},
    {"E2E_ADMIN_TOKEN": "Bearer secret"},
    {"E2E_LISTENING_TEST_ID": "secret-not-a-uuid"},
    {"E2E_SPEAKING_TOPIC_ID": "secret-not-a-uuid"},
])
def test_env_errors_never_echo_invalid_values(env):
    with pytest.raises(wm.Stop) as exc:
        wm.Config.from_env(env)
    assert "secret" not in str(exc.value)


def test_dry_run_with_all_credentials_cannot_construct_transport(monkeypatch, capsys):
    monkeypatch.setattr(wm, "API", Mock(side_effect=AssertionError("network forbidden")))
    env = {f"E2E_{role}_TOKEN": TOKEN for role in wm.ROLES}
    assert wm.main(["--dry-run", "--run-id", "unit"], env) == 0
    out = capsys.readouterr().out
    assert "network requests=0" in out
    assert "SKIP Writing submit/grading" in out and "SKIP Speaking submit/grading" in out
    assert TOKEN not in out


def test_missing_tokens_skip_before_network(monkeypatch, capsys):
    monkeypatch.setattr(wm.API, "call", Mock(side_effect=AssertionError("network forbidden")))
    assert wm.main(["--run-id", "unit"], {}) == 3
    out = capsys.readouterr().out
    for role in ("ADMIN", "INSTRUCTOR", "STUDENT"):
        assert f"E2E_{role}_TOKEN" in out


def test_cleanup_requires_original_run_id_before_network(capsys):
    assert wm.main(["--cleanup"], {}) == 1
    assert "requires the original --run-id" in capsys.readouterr().err


@pytest.mark.parametrize("argv,env,exit_code", [
    (["--dry-run"], {}, 0),
    (["--run-id", "unit"], {"E2E_BASE_URL": "https://example.test"}, 1),
    (["--invalid", TOKEN], {}, 1),
    (["--run-id", "unit"], {}, 3),
    (["--cleanup", "--run-id", "unit"], {}, 3),
])
def test_cli_exit_codes_without_network(argv, env, exit_code, monkeypatch, capsys):
    monkeypatch.setattr(wm.API, "call", Mock(side_effect=AssertionError("network forbidden")))
    assert wm.main(argv, env) == exit_code
    output = capsys.readouterr()
    assert TOKEN not in output.out + output.err
    if exit_code == 1:
        assert output.err.startswith("FAIL ")
    if exit_code == 3:
        assert "SKIP " in output.out


@pytest.mark.parametrize("key", ["id", "group_id", "attempt_id", "user_id", "student_id"])
@pytest.mark.parametrize("row", [{}, None, [], {"value": "sensitive-not-a-uuid"},
                                 {"value": None}, {"value": 123}, {"value": []}])
def test_response_uuid_checks_report_field_without_echoing_value(key, row):
    if isinstance(row, dict) and "value" in row:
        row = {key: row["value"]}
    with pytest.raises(wm.Stop, match=f"API returned an invalid {key} UUID") as exc:
        wm.row_id(row, key)
    assert "sensitive" not in str(exc.value)


def test_redirect_never_forwards_authorization_to_another_host():
    assert wm.NoRedirect().redirect_request(Mock(), None, 302, "redirect", {}, "https://evil.test") is None


@pytest.mark.parametrize("path", [
    "/sessions/example/responses", "/api/writing/my-assignments/example/submit",
    "/sessions/example/responses?mode=fixture", "/api/writing/my-assignments/example/submit?fixture=1",
    "/instructor/essays/example/regrade", "/admin/topics/example/generate-questions",
])
def test_paid_routes_are_blocked_before_transport(path):
    api = wm.API(wm.Config(wm.STAGING_URL, {"STUDENT": TOKEN}))
    api.opener = Mock()
    with pytest.raises(wm.Stop, match="outside the fixture route allow-list"):
        api.call("STUDENT", "POST", path, {})
    api.opener.open.assert_not_called()


@pytest.mark.parametrize("method,path", [
    ("GET", "/unlisted"),
    ("POST", "/api/unknown-paid-service"),
    ("POST", "/auth/profile"),
    ("DELETE", "/instructor/cohorts"),
    ("POST", f"/api/grammar/diagnostics/sessions/{TASK}/submit"),
    ("POST", f"/api/grammar/diagnostics/sessions/{TASK}/responses?fixture=1"),
    ("GET", "/auth/profile?redirect=elsewhere"),
    ("GET", "/auth/../profile"),
    ("GET", "/auth/%70rofile"),
    ("GET", "/auth/profile\n"),
    ("GET", "/instructor/prompts/not-a-uuid"),
    ("POST", f"/api/listening/tests/{TASK}/attempts?class_item={CID}&fixture=1"),
])
def test_unlisted_methods_paths_and_queries_are_blocked_before_transport(method, path):
    api = wm.API(wm.Config(wm.STAGING_URL, {"STUDENT": TOKEN}))
    api.opener = Mock()
    with pytest.raises(wm.Stop, match="outside the fixture route allow-list"):
        api.call("STUDENT", method, path, {})
    api.opener.open.assert_not_called()


def test_transport_disables_environment_proxies():
    api = wm.API(wm.Config(wm.STAGING_URL, {"STUDENT": TOKEN}))
    assert not any(isinstance(handler, wm.ProxyHandler) for handler in api.opener.handlers)


def test_grammar_rule_response_is_not_confused_with_speaking_paid_route():
    api = wm.API(wm.Config(wm.STAGING_URL, {"STUDENT": TOKEN}))
    api.opener = MagicMock()
    api.opener.open.return_value.__enter__.return_value.read.return_value = b'{"accepted":true}'
    assert api.call("STUDENT", "POST", f"/api/grammar/diagnostics/sessions/{TASK}/responses", {}) == {"accepted": True}


def test_http_errors_with_sensitive_body_headers_or_url_are_redacted():
    api = wm.API(wm.Config(wm.STAGING_URL, {"STUDENT": TOKEN}))
    api.opener = Mock()
    api.opener.open.side_effect = HTTPError("https://secret.example", 500, TOKEN, {"Authorization": TOKEN}, io.BytesIO(TOKEN.encode()))
    with pytest.raises(wm.APIError) as exc:
        api.call("STUDENT", "GET", "/auth/profile")
    assert TOKEN not in str(exc.value) and "secret.example" not in str(exc.value)
    assert "500" in str(exc.value)


def test_cleanup_marker_is_delimited_not_a_prefix_match():
    journey = wm.Journey(wm.Config(wm.STAGING_URL, {}), "E2E-unit", api=Mock())
    assert journey.owned({"title": "E2E-unit · grammar"}, "title")
    assert journey.owned({"title": "E2E-unit"}, "title")
    for title in ("E2E-unit2", "E2E-unit-other", "E2E-unit other", "QA TEST real class"):
        assert not journey.owned({"title": title}, "title")


def test_discovery_refuses_possibly_truncated_api_collection():
    journey = wm.Journey(wm.Config(wm.STAGING_URL, {}), "E2E-unit", api=Mock())
    journey.api.call.return_value = {"cohorts": [{"id": CID, "name": "older-run"}] * 1000}
    with pytest.raises(wm.Stop, match="may be capped"):
        journey.cohorts()


def test_non_qa_identity_stops_before_mutations():
    api = Mock()
    api.call.return_value = {"display_name": "Real learner", "role": "user", "is_active": True, "id": STUDENT}
    journey = wm.Journey(wm.Config(wm.STAGING_URL, {}), "E2E-unit", api=api)
    with pytest.raises(wm.Stop, match="QA TEST identity"):
        journey.identity("STUDENT")
    assert all(call.args[1] == "GET" for call in api.call.call_args_list)


def test_cleanup_refuses_cohort_not_owned_by_qa_instructor_before_writes():
    api = Mock()
    def call(role, method, path, body):
        assert method == "GET", "Must refuse before mutating unowned data"
        if path == "/auth/profile":
            return {"id": CID, "display_name": "QA TEST staff", "role": role.lower(),
                    "is_active": True, "email": "unit@staging-e2e.averlearning.com"}
        if path == "/instructor/cohorts":
            return []
        if path == "/admin/cohorts":
            return {"cohorts": [{"id": CID, "name": "E2E-unit"}]}
        raise AssertionError(path)
    api.call.side_effect = call
    journey = wm.Journey(wm.Config(wm.STAGING_URL, {"ADMIN": TOKEN, "INSTRUCTOR": TOKEN}), "E2E-unit", api=api)
    with pytest.raises(wm.Stop, match="not owned"):
        journey.cleanup()


def test_grammar_fixture_submits_and_reads_actual_report_contract():
    responses = iter([
        {"id": TASK}, {"complete": False, "item": {"item_id": "question-1"}},
        {"accepted": True}, {"complete": True}, {"profile_kind": "diagnostic"}, {"session_id": TASK},
    ])
    config = wm.Config(wm.STAGING_URL, {"STUDENT": TOKEN})
    api = fixture_api(config, lambda *args: next(responses))
    journey = wm.Journey(config, "E2E-unit", api=api)
    journey.grammar({"item_id": CID})
    calls = api.call.call_args_list
    assert calls[0].args[3]["class_assignment_item_id"] == CID
    assert calls[2].args[3]["selected_option"] == 0
    assert calls[-1].args[1:3] == ("GET", f"/api/grammar/diagnostics/sessions/{TASK}/report")


def test_listening_refuses_start_that_would_abandon_open_mock():
    api = Mock()
    api.call.return_value = {"total": 1, "items": [{"user": {"id": STUDENT}, "test": {"id": TASK}}]}
    journey = wm.Journey(wm.Config(wm.STAGING_URL, {}, listening_test=TASK), "E2E-unit", api=api)
    journey.learner_id = STUDENT
    with pytest.raises(wm.Stop, match="open Listening attempt"):
        journey.listening({"item_id": CID})
    assert api.call.call_count == 1


def test_listening_fixture_uses_linked_attempt_and_refetches_submission():
    responses = iter([{"total": 0, "items": []}, {"attempt_id": TASK}, {}, {}, {"status": "submitted"}])
    config = wm.Config(wm.STAGING_URL, {"ADMIN": TOKEN, "STUDENT": TOKEN}, listening_test=TASK)
    api = fixture_api(config, lambda *args: next(responses))
    journey = wm.Journey(config, "E2E-unit", api=api)
    journey.learner_id = STUDENT
    journey.listening({"item_id": CID})
    calls = api.call.call_args_list
    assert calls[1].args[2].endswith("?class_item=" + CID)
    assert calls[2].args[3] == {"q_num": 1, "user_answer": "E2E-unit"}
    assert calls[-1].args[1:3] == ("GET", "/api/listening/tests/attempts/" + TASK)


@pytest.mark.parametrize("result", [{}, {"attempt_id": "sensitive-not-a-uuid"},
                                   {"attempt_id": None}, {"attempt_id": 123}])
def test_invalid_listening_attempt_id_is_cli_failure_before_answer_writes(result, monkeypatch, capsys):
    responses = iter([{"total": 0, "items": []}, result])
    config = wm.Config(wm.STAGING_URL, {"ADMIN": TOKEN, "STUDENT": TOKEN}, listening_test=TASK)
    api = fixture_api(config, lambda *args: next(responses))
    journey = wm.Journey(config, "E2E-unit", api=api)
    journey.learner_id = STUDENT
    monkeypatch.setattr(journey, "run", lambda: journey.listening({"item_id": CID}))
    monkeypatch.setattr(wm, "Journey", Mock(return_value=journey))
    assert wm.main(["--run-id", "unit"], {}) == 1
    output = capsys.readouterr()
    assert "FAIL API returned an invalid attempt_id UUID" in output.err
    assert "sensitive" not in output.err and "Traceback" not in output.err
    assert api.call.call_count == 2


@pytest.mark.parametrize("give_fields", [{"group_id": GROUP}, {}, {"group_id": "sensitive-not-a-uuid"},
                                         {"group_id": None}, {"group_id": 123}])
def test_journey_orders_late_join_after_give_and_distinguishes_backfill(give_fields, monkeypatch, capsys):
    """Exercise orchestration with published response shapes, never live APIs."""
    marker = "E2E-unit"
    late_id = "30000000-0000-0000-0000-000000000002"
    late_assignment = "20000000-0000-0000-0000-000000000002"
    user_ids = {role: f"40000000-0000-0000-0000-00000000000{i}" for i, role in enumerate(wm.ROLES, 1)}
    members, writing, class_items, cohorts, codes, events = [], [], [], [], [], []
    config = wm.Config(wm.STAGING_URL, {r: TOKEN for r in wm.ROLES})

    def call(role, method, path, body):
        events.append((role, method, path))
        if path == "/auth/profile":
            return {"id": user_ids[role], "role": role.lower() if role in {"INSTRUCTOR", "ADMIN"} else "user",
                    "display_name": "QA TEST " + role, "email": "unit@staging-e2e.averlearning.com", "is_active": True}
        if path == "/instructor/students":
            return [{"id": sid, "user_id": user_ids[r], "full_name": "QA TEST learner"}
                    for r, sid in (("STUDENT", STUDENT), ("LATE_STUDENT", late_id))]
        if path == "/admin/cohorts":
            return {"cohorts": list(cohorts)}
        if path == "/instructor/cohorts":
            cohorts.append({"id": CID, **body})
            return cohorts[-1]
        if path == "/instructor/codes":
            if method == "POST":
                for c in codes:
                    c["is_used"] = True
                codes.append({"id": TASK, "code": "sensitive-code-never-log", "is_active": True,
                              "is_used": False, **body})
                return {"created": 1, "codes": [codes[-1]["code"]]}
            return codes
        if path == "/auth/activate":
            sid = STUDENT if role == "STUDENT" else late_id
            members.append({"student_id": sid})
            if role == "LATE_STUDENT":
                assert writing, "Late enrolment must happen after give"
                writing.append({"id": late_assignment, "assignment_group_id": GROUP,
                                "name": marker + " · Writing"})
            return {"success": True}
        if path == f"/admin/cohorts/{CID}/members":
            return {"members": members}
        if path == "/instructor/prompts":
            return {"id": TASK, **body}
        if path == "/instructor/assignments/fan-out":
            writing.append({"id": TASK, "assignment_group_id": GROUP, "name": body["name"]})
            return {"created_count": 1, "assignment_ids": [TASK], **give_fields}
        if path == "/api/writing/my-assignments":
            # The real learner list projection omits cohort_id; a late join
            # receives a different assignment ID in the original give group.
            assignment_id = late_assignment if role == "LATE_STUDENT" else TASK
            rows = [dict(r) for r in writing if r["id"] == assignment_id]
            assert all("cohort_id" not in r for r in rows)
            return {"assignments": rows}
        if path == f"/admin/cohorts/{CID}/assignments":
            class_items.append({"item_id": TASK, "submitted_at": None,
                                "assignment": {"id": TASK, "cohort_id": CID, **body}})
            return {"id": TASK, **body}
        if path.endswith("/backfill"):
            assert body["student_ids"] == [late_id]
            return {"added": 1}
        if path == "/api/class/my-assignments":
            return {"assignments": class_items}
        if path.endswith("/tally"):
            return {"counts": {"submitted": 1}}
        raise AssertionError((method, path))

    journey = wm.Journey(config, marker, api=fixture_api(config, call))
    def submit_grammar(item):
        stored = next(row for row in class_items if row["item_id"] == item["item_id"])
        stored["submitted_at"] = "2026-11-02T00:00:00Z"
    monkeypatch.setattr(journey, "grammar", submit_grammar)
    monkeypatch.setattr(wm, "Journey", Mock(return_value=journey))
    env = {f"E2E_{role}_TOKEN": TOKEN for role in wm.ROLES}
    valid = give_fields.get("group_id") == GROUP
    assert wm.main(["--run-id", "unit"], env) == (2 if valid else 1)
    output = capsys.readouterr()
    if valid:
        assert "late Writing auto-backfill" in output.out
        assert "PARTIAL:" in output.out and not output.err
    else:
        assert "FAIL API returned an invalid group_id UUID" in output.err
        assert events[-1][2] == "/instructor/assignments/fan-out"
    assert "sensitive" not in output.out + output.err and TOKEN not in output.out + output.err
    assert "Traceback" not in output.err
    assert not any(path.endswith("/submit") or path.startswith("/sessions/") for _, _, path in events)


def test_cleanup_is_repeatable_and_preserves_redemption_truth(monkeypatch, capsys):
    marker = "E2E-unit"
    cohort = {"id": CID, "name": marker, "is_active": True}
    task = {"id": TASK, "title": marker + " · grammar", "status": "published"}
    code = {"id": TASK, "cohort_id": CID, "notes": marker, "is_revoked": False,
            "is_used": True, "used_by": STUDENT, "used_at": "2026-11-02T00:00:00Z",
            "assignments": [{"user_id": STUDENT, "is_active": True, "display_name": "QA TEST learner"}]}
    members = [{"student_id": STUDENT, "name": "QA TEST learner"}]
    prompt = {"id": TASK, "title": marker + " · Writing", "is_active": True}
    writing = [{"id": TASK, "cohort_id": CID, "name": marker + " · Writing"}]
    redemption = {k: code[k] for k in ("is_used", "used_by", "used_at")}

    def call(role, method, path, body):
        if path == "/auth/profile":
            return {"id": CID, "display_name": "QA TEST staff", "role": role.lower(),
                    "is_active": True, "email": "unit@staging-e2e.averlearning.com"}
        if path == "/admin/cohorts":
            return {"cohorts": [dict(cohort)]}
        if path == "/instructor/cohorts":
            return [dict(cohort)]
        if path == f"/instructor/cohorts/{CID}":
            return dict(cohort)
        if path == f"/admin/cohorts/{CID}":
            cohort.update(body)
            return dict(cohort)
        if path == f"/admin/cohorts/{CID}/assignments":
            return {"assignments": [dict(task)]}
        if path == f"/admin/cohorts/{CID}/assignments/{TASK}":
            task.update(body)
            return dict(task)
        if path == "/instructor/assignments":
            return list(writing)
        if path == f"/instructor/assignments/{TASK}":
            assert method == "DELETE"
            writing.clear()
            return None
        if path == "/instructor/codes":
            return [dict(code)]
        if path == f"/admin/access-codes/{TASK}":
            if method == "DELETE":
                assert not code["assignments"][0]["is_active"]
                code["is_revoked"] = True
            return {**code, "assignments": [dict(a) for a in code["assignments"]]}
        if path == f"/admin/access-codes/{TASK}/users/{STUDENT}":
            assert method == "DELETE"
            code["assignments"][0]["is_active"] = False
            return None
        if path == f"/admin/cohorts/{CID}/members":
            return {"members": list(members)}
        if path == f"/admin/cohorts/{CID}/students/{STUDENT}":
            assert method == "DELETE"
            members.clear()
            return None
        if path == "/instructor/prompts":
            return [dict(prompt)]
        if path == f"/instructor/prompts/{TASK}":
            if method == "PATCH":
                prompt.update(body)
            return dict(prompt)
        raise AssertionError((method, path))

    config = wm.Config(wm.STAGING_URL, {"ADMIN": TOKEN, "INSTRUCTOR": TOKEN})
    journey = wm.Journey(config, marker, api=fixture_api(config, call))
    monkeypatch.setattr(wm, "Journey", Mock(return_value=journey))
    env = {f"E2E_{role}_TOKEN": TOKEN for role in config.tokens}
    assert wm.main(["--cleanup", "--run-id", "unit"], env) == 0
    assert wm.main(["--cleanup", "--run-id", "unit"], env) == 0
    assert {k: code[k] for k in redemption} == redemption
    assert cohort["is_active"] is False and task["status"] == "archived"
    assert not writing and not members and prompt["is_active"] is False
