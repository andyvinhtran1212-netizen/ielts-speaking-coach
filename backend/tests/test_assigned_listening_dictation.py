"""Synthetic assignment config and transcript authorization; no remote services."""
from copy import deepcopy
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

import test_listening_test_dictation as fixtures
import test_admin_class_assignments_paper_gate as assignment_fixtures
from routers import listening as router, admin_class_assignments as admin
from services import listening_drill_homework


def world(monkeypatch, mode="optional"):
    db, auth = fixtures._patch(monkeypatch)
    test = fixtures._seed_test(db, is_public=False, exam_only=True, test_type="full")
    fixtures._seed_section(db, test["id"], 1, "A synthetic sentence.")
    config = {} if mode == "none" else {"skill_drill": {"dictation_required": mode == "required", "sections": [1]}}
    assignment = dict(id="assignment", cohort_id="cohort", skill="listening", content_id=test["id"],
                      status="published", content_config={"delivery_mode": "assigned_practice", **config})
    db.tables.update(students=[dict(id="student", user_id="user-1", cohort_id="cohort")],
                     student_cohort_memberships=[dict(id="member", student_id="student", cohort_id="cohort", is_active=True)],
                     cohorts=[dict(id="cohort", status="active")],
                     class_assignment_items=[dict(id="item", student_id="student", assignment_id="assignment")],
                     class_assignments=[assignment], listening_test_attempts=[dict(id="listening-attempt", test_id=test["id"],
                         user_id="user-1", class_assignment_item_id="item", status="submitted")])
    original_rpc = db.rpc

    def rpc(name, params):
        if name == "fn_resolve_mock_paper_access" and params.get("p_class_item_id"):
            db.rpc_calls.append((name, dict(params)))
            # The Python gate must still reject invalid/closed/unconfigured items,
            # even when the paper policy has granted assigned-practice access.
            return fixtures._RpcResult(dict(allowed=True, attempt_purpose="assigned_practice",
                                             paper_revision=0, policy_revision=0))
        return original_rpc(name, params)
    monkeypatch.setattr(db, "rpc", rpc)
    return db, auth, test, assignment


def boot(test, auth):
    return fixtures._run(router.get_listening_test_dictation(test["id"], authorization=auth, class_item="item"))


def grade(test, auth, section=1):
    return fixtures._run(router.grade_listening_test_dictation(router.ListeningTestDictationGradeRequest(
        test_id=test["id"], section_num=section, sentence_idx=0, user_transcript=""), authorization=auth, class_item="item"))


@pytest.mark.parametrize("mode", ["optional", "required"])
def test_hidden_assignment_opens_boot_grade_attempt_and_session(monkeypatch, mode):
    db, auth, test, assignment = world(monkeypatch, mode)
    assert boot(test, auth)["sections"][0]["sentences"] == ["A synthetic sentence."]
    assert [op["expected"] for op in grade(test, auth)["diff"]] == ["A", "synthetic", "sentence."]
    attempt = fixtures._run(router.start_dictation_attempt(test["id"], 1, authorization=auth, class_item="item"))
    fixtures._run(router.grade_and_save_dictation_attempt_sentence(UUID(attempt["attempt_id"]), 0,
        router.DictationAttemptAnswerRequest(user_transcript="A synthetic sentence."), authorization=auth))
    body = router.DictationSessionRequest(attempt_id=attempt["attempt_id"], test_id=test["id"], section_num=1,
        client_request_id=uuid4(), sentences=[router.DictationSentenceSubmit(sentence_idx=0, user_transcript="A synthetic sentence.")])
    report = fixtures._run(router.submit_listening_dictation_session(body, authorization=auth))
    assert report["accuracy"] == 1
    assert db.tables["dictation_sessions"][0]["class_assignment_item_id"] == "item"
    assert all(params["p_class_item_id"] == "item" for name, params in db.rpc_calls
               if name == "fn_resolve_mock_paper_access")
    assignment["content_config"].pop("skill_drill")
    # Idempotent replay and stored report reads must not bypass the live config.
    for invoke in [lambda: fixtures._run(router.submit_listening_dictation_session(body, authorization=auth)),
                   lambda: fixtures._run(router.get_listening_dictation_session(report["session_id"], authorization=auth)),
                   lambda: fixtures._run(router.get_listening_dictation_session_by_request(body.client_request_id, authorization=auth))]:
        with pytest.raises(HTTPException) as error:
            invoke()
        assert error.value.status_code == 404


@pytest.mark.parametrize("denial", ["none", "empty_sections", "other_student", "closed", "wrong_test", "inactive_member"])
@pytest.mark.parametrize("route", ["boot", "grade", "start", "resume", "session"])
def test_assignment_routes_fail_closed_before_returning_transcript(monkeypatch, denial, route):
    db, auth, test, assignment = world(monkeypatch, "none" if denial == "none" else "optional")
    if denial == "empty_sections": assignment["content_config"]["skill_drill"]["sections"] = []
    if denial == "other_student": db.tables["class_assignment_items"][0]["student_id"] = "someone-else"
    if denial == "closed": assignment["status"] = "archived"
    if denial == "wrong_test": assignment["content_id"] = "other-test"
    if denial == "inactive_member": db.tables["student_cohort_memberships"][0]["is_active"] = False
    attempt_id = str(uuid4())
    db.tables["dictation_attempts"].append(dict(id=attempt_id, user_id="user-1", test_id=test["id"], section_num=1,
        class_assignment_item_id="item", status="in_progress", resume_expires_at=router.resume_expires_at(), units_snapshot=[dict(text="A synthetic sentence.")]))
    calls = {
        "boot": lambda: boot(test, auth), "grade": lambda: grade(test, auth),
        "start": lambda: fixtures._run(router.start_dictation_attempt(test["id"], 1, authorization=auth, class_item="item")),
        "resume": lambda: fixtures._run(router.get_in_progress_dictation_attempt(test["id"], 1, authorization=auth, class_item="item")),
        "session": lambda: fixtures._run(router.submit_listening_dictation_session(router.DictationSessionRequest(
            test_id=test["id"], section_num=1, attempt_id=attempt_id,
            sentences=[router.DictationSentenceSubmit(sentence_idx=0)]), authorization=auth)),
    }
    before = deepcopy(db.tables)
    with pytest.raises(HTTPException) as error: calls[route]()
    assert error.value.status_code == 404
    assert db.tables == before


def test_hidden_paper_still_denies_dictation_without_item_and_unassigned_section(monkeypatch):
    db, auth, test, assignment = world(monkeypatch)
    with pytest.raises(HTTPException) as error:
        fixtures._run(router.get_listening_test_dictation(test["id"], authorization=auth))
    assert error.value.status_code == 404
    with pytest.raises(HTTPException) as error: grade(test, auth, section=2)
    assert error.value.status_code == 404


@pytest.mark.parametrize("mode", ["none", "optional", "required"])
def test_exam_player_carries_assignment_config(monkeypatch, mode):
    db, auth, test, assignment = world(monkeypatch, mode)
    monkeypatch.setattr(router, "_assemble_listening_player_payload", lambda *_a, **_kw: {"id": test["id"], "test_type": "full"})
    payload = fixtures._run(router.get_published_listening_test(test["id"], authorization=auth, class_item="item"))
    assert payload.get("skill_drill_homework") == listening_drill_homework.drill_config(assignment)


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["none", "optional", "required"])
async def test_create_exam_assignment_snapshots_modes_without_skill_drill_flag(monkeypatch, mode):
    capture = {}
    seen = []
    def prepare(test_id, required):
        seen.append((test_id, required))
        return dict(dictation_required=required, sections=[1])
    monkeypatch.setattr(admin, "_prepare_assigned_listening_dictation", prepare)
    await assignment_fixtures._create(assignment_fixtures._playable(is_public=False, exam_only=True), skill="listening",
        capture=capture, delivery_mode="assigned_practice", dictation_mode=mode)
    config = capture["content_config"]
    assert config["delivery_mode"] == "assigned_practice"
    if mode == "none":
        assert "skill_drill" not in config and not seen
    else:
        assert config["skill_drill"] == dict(dictation_required=mode == "required", sections=[1])
        assert seen == [("uuid-1", mode == "required")]


@pytest.mark.asyncio
@pytest.mark.parametrize("skill,delivery", [("reading", "assigned_practice"), ("listening", "standard")])
async def test_modes_reject_wrong_assignment_kind(monkeypatch, skill, delivery):
    with pytest.raises(HTTPException) as error:
        await assignment_fixtures._create(assignment_fixtures._playable(), skill=skill, dictation_mode="optional", delivery_mode=delivery)
    assert error.value.status_code == 422


@pytest.mark.parametrize("required,transcripts,expected", [
    (False, ["One.", ""], [1]), (True, ["One.", "Two."], [1, 2]),
    (False, ["", ""], None), (True, ["One.", ""], None), (True, [], None),
])
def test_prepare_assigned_dictation_requires_usable_transcript(monkeypatch, required, transcripts, expected):
    db, auth = fixtures._patch(monkeypatch)
    test = fixtures._seed_test(db, is_public=False)
    for num, transcript in enumerate(transcripts, 1): fixtures._seed_section(db, test["id"], num, transcript)
    monkeypatch.setattr(admin, "supabase_admin", db)
    monkeypatch.setattr(listening_drill_homework, "require_homework_schema", lambda _db: None)
    # Hidden exam preparation must never go through the public-drill predicate.
    monkeypatch.setattr(listening_drill_homework, "public_drill", lambda *_: pytest.fail("public_drill called"))
    if expected is None:
        with pytest.raises(HTTPException) as error: admin._prepare_assigned_listening_dictation(test["id"], required)
        assert error.value.status_code == 422
    else:
        assert admin._prepare_assigned_listening_dictation(test["id"], required) == dict(dictation_required=required, sections=expected)


@pytest.mark.parametrize("key", ["type", "qtype", "q_type", "question_type", "template_kind", "variant"])
def test_keep_change_exercise_or_question_is_never_a_dictation_unit(key):
    section = {"transcript": "Synthetic printed value.", "exercises": [{"exercise_type": "dictation", "payload": {key: "keep_change"}}]}
    assert router._dictation_units(section) == []
    section["exercises"] = [{"payload": {"questions": [{key: "keep_change"}]}}]
    assert router._dictation_units(section) == []


def test_persisted_keep_change_shape_is_excluded_and_self_check_is_unchanged(monkeypatch):
    db, auth = fixtures._patch(monkeypatch)
    test = fixtures._seed_test(db)
    fixtures._seed_section(db, test["id"], 1, "A synthetic sentence.")
    section = db.tables["listening_content"][0]
    db.tables["listening_exercises"] = [dict(content_id=section["id"], exercise_type="dictation",
        payload=dict(template_kind="keep_change", variant="keep_change", questions=[dict(q_num=1, printed_value="KEEP me")]))]
    assert router._dictation_units_for_content(section) == []
    assert boot_public(test, auth)["sections"][0]["sentences"] == []
    with pytest.raises(HTTPException) as error: router._dictation_section_units_snapshot(test["id"], 1)
    assert error.value.status_code == 404
    db.tables["listening_exercises"][0]["payload"] = dict(template_kind="short_answer", questions=[dict(q_num=1, scoring="self_check")])
    assert router._dictation_units_for_content(section) == [dict(text="A synthetic sentence.", start=None, end=None)]


def boot_public(test, auth):
    return fixtures._run(router.get_listening_test_dictation(test["id"], authorization=auth))


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["none", "optional", "required"])
async def test_class_start_sends_only_required_exam_homework_to_dictation(monkeypatch, mode):
    import test_class_student_page as class_fixtures
    config = {"delivery_mode": "assigned_practice"}
    if mode != "none": config["skill_drill"] = dict(dictation_required=mode == "required", sections=[1])
    db = class_fixtures._start_db(skill="listening", content_id="uuid-xyz", tables={
        "class_assignments": [dict(id="a1", cohort_id="c1", skill="listening", status="published", content_id="uuid-xyz",
                                   content_config=config, due_at=None)],
        "listening_test_attempts": [dict(id="submitted", test_id="uuid-xyz", class_assignment_item_id="item-1",
                                         user_id="u1", status="submitted")],
    })
    reply = await class_fixtures._start(db)
    assert reply["player_surface"] == ("listening_dictation" if mode == "required" else "listening_test")
    assert reply["player_query"]["class_item"] == "item-1"


@pytest.mark.parametrize("mode", ["none", "optional", "required"])
def test_boot_and_grade_query_contract_over_http(monkeypatch, mode):
    from fastapi.testclient import TestClient
    from main import app
    db, auth, test, _ = world(monkeypatch, mode)
    client = TestClient(app)
    headers = {"Authorization": auth}
    boot_reply = client.get(f'/api/listening/tests/{test["id"]}/dictation?class_item=item', headers=headers)
    grade_reply = client.post('/api/listening/tests/dictation/grade?class_item=item', headers=headers,
        json=dict(test_id=test["id"], section_num=1, sentence_idx=0, user_transcript="A synthetic sentence."))
    assert boot_reply.status_code == grade_reply.status_code == (404 if mode == "none" else 200)
    if mode != "none": assert grade_reply.json()["is_correct"] is True
