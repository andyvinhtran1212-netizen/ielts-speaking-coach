"""The revision binder never chooses or borrows: it refuses every ambiguity."""
import copy

import pytest

from scripts.bind_revision_web_explanations import BindingRefused, build_plan, source_test_id_for

VERSION = "cambridge-web-explanations/2026-09-10-v1"


def _paper(skill, rev=True):
    code = "RDG" if skill == "reading" else "LIS"
    base = f"ILR-{code}-CAM-B19-T1"
    if rev:
        return {"id": f"rev-{skill}", "test_id": f"MOCK0016-PROD-20261006-{base}-REV01", "status": "published"}
    return {"id": f"src-{skill}", "test_id": base, "status": "published"}


def _inputs(skill):
    source = _paper(skill, rev=False)
    objects = [{
        "object_id": f"cambridge-19-test-1-{skill}-q{q:02d}", "content_version": VERSION,
        "question_number": q, "is_current": True, "binding_status": "BOUND",
        f"{skill}_test_id": source["id"], "skill": skill, "source_test_key": "cambridge-19-test-1",
        "book_number": 19, "test_number": 1, "source_hash": f"h{q}", "audit_verdict": "CONFIRMED",
        "rights_status": "BLOCKED_PENDING_RIGHTS_REVIEW",
        "editorial_status": "GENERATED_REQUIRES_EDITORIAL_REVIEW",
        "serving_status": "ELIGIBLE_AFTER_GLOBAL_RELEASE_GATES",
        "payload": {"item": {"prompt": f"Question {q} about the text",
                             "answer": {"canonical": f"a{q}", "accepted_forms": [f"a{q}"]}}},
    } for q in range(1, 41)]
    return {
        "skill": skill, "revision": _paper(skill), "source": source,
        "source_objects": objects, "revision_objects": [],
        "revision_keys": {q: {"answer": f"a{q}", "alternatives": []} for q in range(1, 41)},
        "revision_fingerprints": {q: f"fp{q}" for q in range(1, 41)},
        "source_fingerprints": {q: f"fp{q}" for q in range(1, 41)},
        "reviewed_changes": frozenset(),
        "expected_source_version": VERSION,
    }


def _refusal(inputs):
    with pytest.raises(BindingRefused) as caught:
        build_plan(**inputs)
    return " | ".join(caught.value.reasons)


@pytest.mark.parametrize("skill", ["reading", "listening"])
def test_plan_copies_source_evidence_to_revision_identity_only(skill):
    inputs = _inputs(skill)
    before = copy.deepcopy(inputs["source_objects"])
    plan = build_plan(**inputs)
    assert len(plan["rows"]) == 40
    first = plan["rows"][0]
    assert first["object_id"] == f"mock-rev-{skill}-{skill}-q01"
    assert first["content_version"] == f"{VERSION}@{inputs['revision']['test_id']}"
    assert first[f"{skill}_test_id"] == f"rev-{skill}"
    other = "listening" if skill == "reading" else "reading"
    assert first[f"{other}_test_id"] is None
    assert first["payload"] == before[0]["payload"] and first["source_hash"] == "h1"
    assert first["rights_status"] == "BLOCKED_PENDING_RIGHTS_REVIEW"  # approval stays the give's job
    assert inputs["source_objects"] == before  # the source set is never modified
    assert build_plan(**_inputs(skill))["sha256"] == plan["sha256"]  # reviewable, deterministic


@pytest.mark.parametrize("skill", ["reading", "listening"])
def test_source_with_no_current_version_is_refused(skill):
    inputs = _inputs(skill)
    for row in inputs["source_objects"]:
        row["is_current"] = False
    assert "0 content version hiện hành" in _refusal(inputs)


@pytest.mark.parametrize("skill", ["reading", "listening"])
def test_source_with_multiple_current_versions_is_refused_not_chosen(skill):
    inputs = _inputs(skill)
    extra = copy.deepcopy(inputs["source_objects"][0])
    extra.update(content_version="v2", object_id="other")
    inputs["source_objects"].append(extra)
    assert "2 content version hiện hành" in _refusal(inputs)


def test_operator_must_name_the_current_source_version():
    inputs = _inputs("reading")
    inputs["expected_source_version"] = "cambridge-web-explanations/2026-09-01-v0"
    assert "không phải cambridge-web-explanations/2026-09-01-v0" in _refusal(inputs)


def test_revision_that_already_has_objects_is_not_bound_twice():
    inputs = _inputs("listening")
    inputs["revision_objects"] = [{"id": "x", "object_id": "mock-rev-listening-listening-q01"}]
    assert "đã có 1 object" in _refusal(inputs)


def test_revised_answer_key_that_disagrees_with_explanation_is_refused():
    inputs = _inputs("reading")
    inputs["revision_keys"][11] = {"answer": "gut", "alternatives": []}
    assert "Q11" in _refusal(inputs)


def test_revision_accepting_documented_alternatives_is_allowed():
    # Cam19 T1 Q11: REV accepts gut/intestines; the explanation documents both.
    inputs = _inputs("reading")
    inputs["source_objects"][10]["payload"]["item"]["answer"] = {
        "canonical": "intestines", "accepted_forms": ["intestines", "gut"]}
    inputs["revision_keys"][11] = {"answer": "gut", "alternatives": ["intestines"]}
    inputs["revision_fingerprints"][11] = "normalised-key"
    inputs["reviewed_changes"] = frozenset({11})
    assert len(build_plan(**inputs)["rows"]) == 40


def test_scoring_override_that_would_change_grading_is_refused():
    inputs = _inputs("listening")
    payload = inputs["source_objects"][4]["payload"]
    payload["audit"] = {"release_adjudication": {"override_version": "cambridge-release-overrides/1.0"}}
    payload["item"]["answer"]["accepted_forms"] = ["a5", "a-five"]
    assert "scoring override" in _refusal(inputs)


def test_changed_question_must_be_named_by_the_reviewer():
    inputs = _inputs("reading")
    inputs["revision_fingerprints"][22] = "rewritten-stem"
    assert "câu REV khác bản gốc là [22]" in _refusal(inputs)
    inputs["reviewed_changes"] = frozenset({22, 23})  # an extra number is also refused
    assert "--reviewed-changes khai [22, 23]" in _refusal(inputs)
    inputs["reviewed_changes"] = frozenset({22})
    plan = build_plan(**inputs)
    assert plan["changed_questions"] == [22]


def test_canonical_stored_as_a_list_is_compared_item_by_item():
    # Real Cam19 T1 Q11 shape: canonical is ["intestines", "gut"].
    inputs = _inputs("reading")
    inputs["source_objects"][10]["payload"]["item"]["answer"] = {
        "canonical": ["intestines", "gut"], "accepted_forms": ["intestines", "gut"]}
    inputs["revision_keys"][11] = {"answer": "intestines", "alternatives": ["gut"]}
    inputs["revision_fingerprints"][11] = "normalised-key"
    inputs["reviewed_changes"] = frozenset({11})
    assert len(build_plan(**inputs)["rows"]) == 40
    inputs["revision_keys"][11] = {"answer": "intestines", "alternatives": []}
    assert "Q11" in _refusal(inputs)  # the revision would reject a documented answer


def test_incomplete_source_set_is_refused():
    inputs = _inputs("listening")
    inputs["source_objects"].pop()
    assert "Q1–Q40" in _refusal(inputs)


@pytest.mark.parametrize(("revision", "skill"), [
    ("MOCK0016-PROD-20261006-ILR-LIS-CAM-B19-T1-REV01", "reading"),
    ("MOCK0016-PROD-20261006-ILR-RDG-001-REV02", "reading"),
    ("ILR-RDG-CAM-B19-T1", "reading"),
])
def test_only_matching_cambridge_revision_codes_are_accepted(revision, skill):
    with pytest.raises(BindingRefused):
        source_test_id_for(revision, skill)
