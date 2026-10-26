"""The revision binder never chooses or borrows: it refuses every ambiguity."""
import copy

import pytest

from scripts.bind_revision_web_explanations import (
    BindingRefused, _paper_questions, build_plan, source_test_id_for,
)

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
    assert first["content_version"] == VERSION  # same version as source: mock pairing still resolves
    assert first[f"{skill}_test_id"] == f"rev-{skill}"
    other = "listening" if skill == "reading" else "reading"
    assert first[f"{other}_test_id"] is None
    assert first["payload"] == before[0]["payload"] and first["source_hash"] == "h1"
    assert first["rights_status"] == "BLOCKED_PENDING_RIGHTS_REVIEW"  # approval stays the give's job
    assert first["editorial_status"] == "GENERATED_REQUIRES_EDITORIAL_REVIEW"
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


def test_already_approved_source_is_still_reapproved_on_the_revision():
    inputs = _inputs("listening")
    for row in inputs["source_objects"]:
        row.update(rights_status="APPROVED", editorial_status="APPROVED")
    rows = build_plan(**inputs)["rows"]
    assert {row["rights_status"] for row in rows} == {"BLOCKED_PENDING_RIGHTS_REVIEW"}


def test_revision_that_would_reject_a_documented_answer_is_refused():
    # Review finding: canonical "intestines", accepted [intestines, gut], REV only intestines.
    inputs = _inputs("reading")
    inputs["source_objects"][10]["payload"]["item"]["answer"] = {
        "canonical": "intestines", "accepted_forms": ["intestines", "gut"]}
    inputs["revision_keys"][11] = {"answer": "intestines", "alternatives": None}
    assert "Q11" in _refusal(inputs)


def test_revision_accepting_an_undocumented_answer_is_refused():
    inputs = _inputs("listening")
    inputs["revision_keys"][3] = {"answer": "a3", "alternatives": ["guess"]}
    assert "Q03" in _refusal(inputs)


@pytest.mark.parametrize("bad", ["a5", ["a5"], None])
def test_malformed_revision_key_is_refused_not_crashed(bad):
    inputs = _inputs("reading")
    inputs["revision_keys"][5] = bad
    assert "Q05: đáp án REV không đọc được" in _refusal(inputs)


def test_plan_sha_covers_reviewed_revision_content():
    inputs = _inputs("reading")
    inputs["revision_fingerprints"][11] = "edit-1"
    inputs["reviewed_changes"] = frozenset({11})
    first = build_plan(**inputs)["sha256"]
    inputs["revision_fingerprints"][11] = "edit-2"  # Q11 edited again after review
    assert build_plan(**inputs)["sha256"] != first


class _Query:
    def __init__(self, rows):
        self.rows, self.filters = rows, []

    def select(self, *_):
        return self

    def eq(self, key, value):
        self.filters.append(lambda row: row.get(key) == value)
        return self

    def in_(self, key, values):
        self.filters.append(lambda row: row.get(key) in set(values))
        return self

    def order(self, *_):
        return self

    def range(self, start, end):
        self.window = (start, end)
        return self

    def execute(self):
        rows = [r for r in self.rows if all(f(r) for f in self.filters)]
        start, end = getattr(self, "window", (0, len(rows)))
        return type("R", (), {"data": rows[start:end + 1]})()


class _FakeDB:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _Query(self.tables.get(name, []))


def _reading_db(passage_body="Original passage", extra_library_passage=False):
    passages = [{"id": "p1", "test_id": "paper", "library": "l3_test", "body_markdown": passage_body}]
    questions = [{"id": f"q{n}", "passage_id": "p1", "q_num": n, "prompt": f"Q{n}",
                  "answer": {"answer": "x", "alternatives": []}, "payload": {"solution": f"s{n}"}}
                 for n in range(1, 4)]
    if extra_library_passage:
        passages.append({"id": "p2", "test_id": "paper", "library": "l2_skill", "body_markdown": "other"})
        questions.append({"id": "stray", "passage_id": "p2", "q_num": 1, "prompt": "stray",
                          "answer": {"answer": "WRONG"}, "payload": {}})
    return _FakeDB({"reading_passages": passages, "reading_questions": questions})


def test_loader_marks_questions_changed_when_their_passage_text_changes():
    keys, before = _paper_questions(_reading_db(), "reading", "paper")
    _, after = _paper_questions(_reading_db("Rewritten passage"), "reading", "paper")
    assert keys[1] == {"answer": "x", "alternatives": []}
    assert all(before[q] != after[q] for q in (1, 2, 3))


def test_loader_ignores_worked_solution_text_and_non_test_passages():
    _, base = _paper_questions(_reading_db(), "reading", "paper")
    db = _reading_db(extra_library_passage=True)
    for row in db.tables["reading_questions"]:
        row["payload"] = {"solution": "rewritten worked solution"}
    keys, fp = _paper_questions(db, "reading", "paper")
    assert keys[1]["answer"] == "x" and fp == base


def test_loader_marks_listening_questions_changed_when_transcript_changes():
    def db(transcript):
        return _FakeDB({
            "listening_content": [{"id": "s1", "test_id": "paper", "transcript": transcript}],
            "listening_exercises": [{"id": "e1", "content_id": "s1", "exercise_type": "dictation",
                                     "payload": {"answers": [{"q_num": 1, "answer": "69"}],
                                                 "solutions": {"1": "worked"}}}],
        })
    _, before = _paper_questions(db("Area is 69 hectares"), "listening", "paper")
    _, after = _paper_questions(db("Area is 96 hectares"), "listening", "paper")
    assert before[1] != after[1]


def test_loader_refuses_malformed_listening_answer_rows():
    db = _FakeDB({
        "listening_content": [{"id": "s1", "test_id": "paper"}],
        "listening_exercises": [{"id": "e1", "content_id": "s1", "payload": {"answers": ["69"]}}],
    })
    with pytest.raises(BindingRefused):
        _paper_questions(db, "listening", "paper")


def test_loader_ignores_copy_bookkeeping_but_not_audio_timing():
    def db(**section):
        base = {"id": "s1", "test_id": "paper", "transcript": "Area is 69 hectares", "title": "test — Section 1",
                "slug": "a", "status": "archived", "metadata": {"section_offset": 0.0, "theme": ""}}
        return _FakeDB({
            "listening_content": [{**base, **section}],
            "listening_exercises": [{"id": "e1", "content_id": "s1", "exercise_type": "dictation",
                                     "payload": {"answers": [{"q_num": 1, "answer": "69"}]}}],
        })
    _, base = _paper_questions(db(), "listening", "paper")
    _, relabelled = _paper_questions(db(title="REV01 — Section 1", slug="b", status="draft",
                                        metadata={"section_offset": 0.0, "internal_qa": True}), "listening", "paper")
    _, retimed = _paper_questions(db(metadata={"section_offset": 4.5}), "listening", "paper")
    assert relabelled == base
    assert retimed != base


def test_staging_rehearsal_copy_maps_to_the_same_source():
    assert source_test_id_for("QA-CAM19-20261024-RDG-CAM-B19-T1-REV01", "reading") == "ILR-RDG-CAM-B19-T1"
    assert source_test_id_for("QA-CAM19-20261024-LIS-CAM-B19-T1-REV01", "listening") == "ILR-LIS-CAM-B19-T1"
    assert source_test_id_for("MOCK0016-PROD-20261006-ILR-RDG-CAM-B19-T1-REV01", "reading") == "ILR-RDG-CAM-B19-T1"
    with pytest.raises(BindingRefused):
        source_test_id_for("QA-CAM19-20261024-RDG-CAM-B19-T1-REV01", "listening")
