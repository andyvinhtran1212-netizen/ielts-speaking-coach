"""The revision binder never chooses or borrows: it refuses every ambiguity."""
import copy

import pytest

from scripts.bind_revision_web_explanations import (
    BindingRefused, _mcq_multi_groups, _paper_questions, build_plan, marker_forms, source_test_id_for,
)
from services.listening_test_grader import answer_matches, collect_answer_key, grade_attempt
from services.mock_correction_service import apply_scoring_overrides

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


def test_revision_accepting_an_undocumented_answer_is_refused_until_the_sync_is_reviewed():
    # REVEXPLAIN-0023 FR-003/FR-006: an undocumented form is never accepted silently.
    inputs = _inputs("listening")
    inputs["revision_keys"][3] = {"answer": "a3", "alternatives": ["guess"]}
    assert "câu cần đồng bộ đáp án là [3]" in _refusal(inputs)
    inputs["reviewed_answer_sync"] = frozenset({3})
    plan = build_plan(**inputs)
    assert plan["rows"][2]["payload"]["item"]["answer"]["accepted_forms"] == ["a3", "guess"]


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


class _Bucket:
    def __init__(self, files):
        self.files = files

    def download(self, path):
        if path not in self.files:
            raise FileNotFoundError(path)
        return self.files[path]


class _Storage:
    def __init__(self, files):
        self.files = files

    def from_(self, bucket):
        assert bucket == "listening-audio"
        return _Bucket(self.files)


class _FakeDB:
    def __init__(self, tables, files=None):
        self.tables = {"listening_tests": [{"id": "paper", "audio_assembly_mode": "full_premixed",
                                            "full_audio_storage_path": None}], **tables}
        self.storage = _Storage(files or {})

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


# ── Codex review on #1692 ────────────────────────────────────────────────────


@pytest.mark.parametrize("skill", ["reading", "listening"])
def test_policy_bearing_revision_key_is_refused_until_supported(skill):
    inputs = _inputs(skill)
    # Primary a7 + alias in the legacy fields, but the authored policy (what
    # graders actually use) accepts only a7: the binder must not approve it.
    inputs["revision_keys"][7] = {"answer": "a7", "alternatives": ["alias"],
                                  "response_policy": {"kind": "literal", "accepted": ["a7"]}}
    inputs["source_objects"][6]["payload"]["item"]["answer"]["accepted_forms"] = ["a7", "alias"]
    assert "Q07: đáp án REV có response_policy" in _refusal(inputs)


def _listening_audio_db(path, data, mode="full_premixed"):
    return _FakeDB({
        "listening_tests": [{"id": "paper", "audio_assembly_mode": mode, "full_audio_storage_path": path}],
        "listening_content": [{"id": "s1", "test_id": "paper", "transcript": "Area is 69 hectares"}],
        "listening_exercises": [{"id": "e1", "content_id": "s1", "exercise_type": "dictation",
                                 "payload": {"answers": [{"q_num": 1, "answer": "69"}]}}],
    }, files={path: data} if path else {})


def test_listening_fingerprint_tracks_test_level_audio_content_not_its_path():
    _, base = _paper_questions(_listening_audio_db("tests/src/full.mp3", b"recording-A"), "listening", "paper")
    _, copied = _paper_questions(_listening_audio_db("tests/rev/full.mp3", b"recording-A"), "listening", "paper")
    _, replaced = _paper_questions(_listening_audio_db("tests/rev/full.mp3", b"recording-B"), "listening", "paper")
    _, remixed = _paper_questions(_listening_audio_db("tests/rev/full.mp3", b"recording-A",
                                                      mode="parts_auto_assembled"), "listening", "paper")
    assert copied == base  # same bytes under the copy's own path
    assert replaced != base  # a different recording invalidates the reviewed SHA
    assert remixed != base


def test_listening_loader_refuses_unreadable_audio_or_missing_test_row():
    db = _listening_audio_db("tests/rev/full.mp3", b"recording-A")
    db.storage.files.clear()
    with pytest.raises(BindingRefused):
        _paper_questions(db, "listening", "paper")
    db = _listening_audio_db(None, b"")
    db.tables["listening_tests"] = []
    with pytest.raises(BindingRefused):
        _paper_questions(db, "listening", "paper")


# ── REVEXPLAIN-0023: agree the way learners are marked ─────────────────────

OVERRIDE = {"release_adjudication": {"override_version": "cambridge-release-overrides/1.0"}}


def _explain(inputs, q, canonical, accepted, *, override=False):
    payload = inputs["source_objects"][q - 1]["payload"]
    payload["item"]["answer"] = {"canonical": canonical, "accepted_forms": accepted}
    if override:
        payload["audit"] = copy.deepcopy(OVERRIDE)


@pytest.mark.parametrize(("canonical", "accepted", "rev"), [
    ("flavour", ["flavour", "flavor"], {"answer": "flavour / flavor", "alternatives": []}),   # C17T2 R
    ("(food) consumption", ["(food) consumption"],
     {"answer": "consumption", "alternatives": ["food consumption"]}),                         # C18T1 R
    ("tail(s)", ["tail(s)"], {"answer": "tail", "alternatives": ["tails"]}),                    # C13T1 L
    ("jewellery", ["jewellery", "jewelry"], {"answer": "jewellery / jewelry", "alternatives": []}),  # C21T2 R
    ("B", ["B"], {"answer": "b †", "alternatives": []}),                                       # C14T1 L
])
def test_shorthand_and_spelling_forms_are_equivalent_without_sync(canonical, accepted, rev):
    inputs = _inputs("reading")
    _explain(inputs, 9, canonical, accepted)
    inputs["revision_keys"][9] = rev
    plan = build_plan(**inputs)
    assert plan["classification"]["9"] == "equivalent" and plan["answer_sync"] == {}
    assert plan["rows"][8]["payload"] == inputs["source_objects"][8]["payload"]


def test_compact_slash_stays_literal_as_at_marking():
    assert marker_forms("24/04") == {"24/04"}
    assert marker_forms("24 / 04") == {"24", "04"}


def test_marker_forms_match_the_runtime_marker():
    for raw in ["flavour / flavor", "(Sumatran) orangutan", "tail(s)", "10(th) October", "£250", "20%"]:
        for form in marker_forms(raw):
            assert answer_matches(form, raw, [])


def test_revision_superset_is_synced_into_the_copy_only():
    # C14T1 Listening Q10: REV also accepts the unspaced phone number.
    inputs = _inputs("listening")
    _explain(inputs, 10, "87954 82361", ["87954 82361"])
    inputs["revision_keys"][10] = {"answer": "87954 82361", "alternatives": ["8795482361"]}
    inputs["reviewed_answer_sync"] = frozenset({10})
    before = copy.deepcopy(inputs["source_objects"][9]["payload"])
    plan = build_plan(**inputs)
    row = plan["rows"][9]
    assert row["payload"]["item"]["answer"] == {"canonical": "87954 82361",
                                                "accepted_forms": ["87954 82361", "8795482361"]}
    assert row["payload"]["audit"]["revision_answer_sync"] == {
        "spec": "REVEXPLAIN-0023", "revision_test_id": inputs["revision"]["test_id"],
        "added_forms": ["8795482361"], "grading_change": False}
    assert row["source_hash"] == "h10"
    assert inputs["source_objects"][9]["payload"] == before  # source never mutated
    assert plan["classification"]["10"] == "synced" and plan["answer_sync"]["10"]["added_forms"] == ["8795482361"]
    # An override-free copy never reaches the runtime key: grading is the REV key's.
    frozen = [{"question_number": r["question_number"], "payload": r["payload"]} for r in plan["rows"]]
    key = [{"q_num": 10, "answer": "87954 82361", "alternatives": ["8795482361"]}]
    assert apply_scoring_overrides("listening", "x", key, frozen_rows=frozen) == key


def test_extra_reviewed_sync_number_is_refused():
    inputs = _inputs("reading")
    inputs["reviewed_answer_sync"] = frozenset({4})
    assert "--reviewed-answer-sync khai [4]" in _refusal(inputs)


def test_sync_changes_the_plan_sha():
    inputs = _inputs("reading")
    inputs["revision_keys"][3] = {"answer": "a3", "alternatives": ["a three"]}
    inputs["reviewed_answer_sync"] = frozenset({3})
    synced = build_plan(**inputs)["sha256"]
    assert synced != build_plan(**_inputs("reading"))["sha256"]


def test_override_conflict_needs_owner_approval_then_takes_the_union():
    # C19T3 Listening Q3: REV 3.30/three thirty, adjudicated override 3.30/3:30.
    inputs = _inputs("listening")
    _explain(inputs, 3, "3.30", ["3.30", "3:30"], override=True)
    inputs["revision_keys"][3] = {"answer": "3.30", "alternatives": ["three thirty"]}
    assert "Q03: scoring override" in _refusal(inputs)
    inputs["reviewed_answer_sync"] = frozenset({3})
    assert "--approved-grading-changes khai []" in _refusal(inputs) or "Q03: scoring override" in _refusal(inputs)
    inputs["approved_grading_changes"] = frozenset({3})
    plan = build_plan(**inputs)
    assert plan["classification"]["3"] == "grading_change"
    assert plan["rows"][2]["payload"]["item"]["answer"]["accepted_forms"] == ["3.30", "3:30", "three thirty"]
    # The overlay the marker actually uses accepts both sets.
    frozen = [{"question_number": r["question_number"], "payload": r["payload"]} for r in plan["rows"]]
    key = apply_scoring_overrides("listening", "x", [{"q_num": 3, "answer": "3.30",
                                                      "alternatives": ["three thirty"]}], frozen_rows=frozen)
    assert all(answer_matches(form, key[0]["answer"], key[0]["alternatives"])
               for form in ["3.30", "3:30", "three thirty"])


def test_override_that_marks_like_the_revision_is_a_plain_sync():
    # C21T3 Listening Q3: override 250/£250 (both mark "250"), REV adds a written form.
    inputs = _inputs("listening")
    _explain(inputs, 3, "250", ["250", "£250"], override=True)
    inputs["revision_keys"][3] = {"answer": "250", "alternatives": ["two hundred and fifty"]}
    inputs["reviewed_answer_sync"] = frozenset({3})
    plan = build_plan(**inputs)
    assert plan["classification"]["3"] == "synced"
    assert plan["answer_sync"]["3"]["grading_change"] is False


def test_approving_a_grading_change_that_is_not_one_is_refused():
    inputs = _inputs("listening")
    inputs["approved_grading_changes"] = frozenset({5})
    assert "--approved-grading-changes khai [5]" in _refusal(inputs)


def test_revision_that_rejects_a_documented_form_still_refuses_without_override():
    inputs = _inputs("reading")
    _explain(inputs, 11, "intestines", ["intestines", "gut"])
    inputs["revision_keys"][11] = {"answer": "intestines", "alternatives": ["bowel"]}
    assert "Q11: đáp án REV" in _refusal(inputs) and "chấm sai dạng lời giải ghi nhận ['gut']" in _refusal(inputs)


def _policy(kind, accepted, **settings):
    return {"kind": kind, "version": 1, "settings": settings or {"case_sensitive": False}, "max_words": 2,
            "policy_id": "test-policy", "accepted_answers": accepted,
            "provenance": {"source_item_id": "q1", "reviewer": "test", "item_revision": "r1",
                           "review_status": "ACCEPTED", "source_sha256": "0" * 64}}


def test_policy_question_binds_when_every_documented_form_passes():
    # C16T4 Listening Q1: literal policy 28th/28; explanation documents 28th.
    inputs = _inputs("listening")
    _explain(inputs, 1, "28th", ["28th"])
    inputs["revision_keys"][1] = {"answer": "28th", "alternatives": ["28"],
                                  "response_policy": _policy("literal", ["28th", "28"])}
    inputs["reviewed_answer_sync"] = frozenset({1})
    plan = build_plan(**inputs)
    assert plan["classification"]["1"] == "policy"
    assert plan["rows"][0]["payload"]["item"]["answer"]["accepted_forms"] == ["28th", "28"]


def test_policy_question_refuses_when_a_documented_form_fails_or_override_exists():
    inputs = _inputs("listening")
    _explain(inputs, 1, "28th", ["28th", "twenty-eighth"])
    inputs["revision_keys"][1] = {"answer": "28th", "alternatives": [],
                                  "response_policy": _policy("literal", ["28th"])}
    assert "Q01: đáp án REV có response_policy" in _refusal(inputs)
    _explain(inputs, 1, "28th", ["28th"], override=True)
    assert "scoring override" in _refusal(inputs)


def _group_inputs(rev_rows, canonical, slots=(21, 22)):
    inputs = _inputs("listening")
    for q, rev in zip(slots, rev_rows):
        _explain(inputs, q, canonical, canonical)
        inputs["revision_keys"][q] = {"answer": rev, "alternatives": []}
    inputs["revision_groups"] = {q: tuple(slots) for q in slots}
    return inputs


@pytest.mark.parametrize("rev_rows", [("D", "E"), ("E", "D"), ("D, E", "D, E"), ("E, D", "D, E")])
def test_choose_two_group_is_compared_as_the_graders_any_order_set(rev_rows):
    plan = build_plan(**_group_inputs(rev_rows, ["D", "E"]))
    assert plan["classification"]["21"] == plan["classification"]["22"] == "group"
    assert plan["answer_sync"] == {}


def test_choose_two_group_with_other_letters_or_wider_exercise_refuses():
    assert "nhóm chọn nhiều [21, 22]" in _refusal(_group_inputs(("D", "C"), ["D", "E"]))
    wide = _group_inputs(("A", "E", "C", "E"), ["A", "E"], slots=(17, 18, 19, 20))
    assert "nhóm chọn nhiều [17, 18, 19, 20]" in _refusal(wide)


def test_group_check_matches_grading_of_the_revision_key():
    rows = [{"payload": {"template_kind": "mcq_multi",
                         "answers": [{"q_num": 21, "answer": "D"}, {"q_num": 22, "answer": "E"}]}}]
    graded = grade_attempt([{"q_num": 21, "user_answer": "E"}, {"q_num": 22, "user_answer": "D"}],
                           collect_answer_key(rows))
    assert graded["score"] == 2  # any order, as the binder assumes


def test_loader_groups_mcq_multi_exercises_only():
    db = _FakeDB({
        "listening_content": [{"id": "s1", "test_id": "paper"}],
        "listening_exercises": [
            {"id": "e1", "content_id": "s1", "payload": {"template_kind": "mcq_multi",
                                                         "answers": [{"q_num": 22}, {"q_num": 21}]}},
            {"id": "e2", "content_id": "s1", "payload": {"template_kind": "form_completion",
                                                         "answers": [{"q_num": 1}, {"q_num": 2}]}},
        ],
    })
    assert _mcq_multi_groups(db, "listening", "paper") == {21: (21, 22), 22: (21, 22)}
    assert _mcq_multi_groups(db, "reading", "paper") == {}


def test_override_wider_than_the_revision_is_a_recorded_grading_change_even_without_new_forms():
    # Override 3.30/3:30, REV only 3.30: nothing to add, but marking widens.
    inputs = _inputs("listening")
    _explain(inputs, 3, "3.30", ["3.30", "3:30"], override=True)
    inputs["revision_keys"][3] = {"answer": "3.30", "alternatives": []}
    inputs["reviewed_answer_sync"] = frozenset({3})
    inputs["approved_grading_changes"] = frozenset({3})
    plan = build_plan(**inputs)
    assert plan["answer_sync"]["3"] == {"added_forms": [], "grading_change": True}
    row = plan["rows"][2]["payload"]
    assert row["item"]["answer"]["accepted_forms"] == ["3.30", "3:30"]
    assert row["audit"]["revision_answer_sync"]["grading_change"] is True


def test_choose_two_group_refuses_a_documented_letter_the_grader_rejects():
    # Codex on #1745: canonical D/E but accepted D/E/F; the grader never credits F.
    inputs = _group_inputs(("D", "E"), ["D", "E"])
    inputs["source_objects"][20]["payload"]["item"]["answer"]["accepted_forms"] = ["D", "E", "F"]
    assert "Q21: nhóm chọn nhiều [21, 22]" in _refusal(inputs) and "chấp nhận thêm ['f']" in _refusal(inputs)


def test_grouped_member_with_scalar_canonical_still_uses_group_marking():
    # Codex on #1745: per-slot canonicals D/E; the group grader ignores slot alternatives.
    inputs = _inputs("listening")
    for q, letter in ((21, "D"), (22, "E")):
        _explain(inputs, q, letter, [letter])
        inputs["revision_keys"][q] = {"answer": letter, "alternatives": []}
    inputs["revision_groups"] = {21: (21, 22), 22: (21, 22)}
    inputs["revision_keys"][21] = {"answer": "D", "alternatives": ["F"]}
    plan = build_plan(**inputs)
    assert plan["classification"]["21"] == plan["classification"]["22"] == "group"
    assert plan["answer_sync"] == {}  # F is never synced: the grader never credits it
    _explain(inputs, 21, "D", ["D", "F"])
    assert "Q21: nhóm chọn nhiều [21, 22]" in _refusal(inputs)  # nor may the explanation document it


def test_policy_forms_are_compared_by_the_policys_own_equivalence():
    # Codex on #1745: a literal policy keeps "£250" apart from "250"; the legacy normaliser would not.
    inputs = _inputs("listening")
    _explain(inputs, 3, "250", ["250"])
    inputs["revision_keys"][3] = {"answer": "250", "alternatives": [],
                                  "response_policy": _policy("literal", ["250", "£250"])}
    assert "câu cần đồng bộ đáp án là [3]" in _refusal(inputs)
    inputs["reviewed_answer_sync"] = frozenset({3})
    assert build_plan(**inputs)["rows"][2]["payload"]["item"]["answer"]["accepted_forms"] == ["250", "£250"]


def test_override_copy_keeps_every_canonical_entry_the_overlay_marks():
    # Codex on #1745: apply_scoring_overrides stringifies a list canonical.
    inputs = _inputs("listening")
    _explain(inputs, 5, ["gut", "intestines"], ["gut"], override=True)
    inputs["revision_keys"][5] = {"answer": "gut", "alternatives": ["intestines", "bowel"]}
    inputs["reviewed_answer_sync"] = frozenset({5})
    plan = build_plan(**inputs)
    accepted = plan["rows"][4]["payload"]["item"]["answer"]["accepted_forms"]
    assert accepted == ["gut", "intestines", "bowel"] and plan["classification"]["5"] == "synced"
    frozen = [{"question_number": r["question_number"], "payload": r["payload"]} for r in plan["rows"]]
    key = apply_scoring_overrides("listening", "x", [{"q_num": 5, "answer": "gut",
                                                      "alternatives": ["intestines", "bowel"]}], frozen_rows=frozen)
    assert all(answer_matches(f, key[0]["answer"], key[0]["alternatives"]) for f in ["gut", "intestines", "bowel"])


def test_number_policy_written_alias_already_documented_needs_no_sync():
    # Codex on #1745: a number policy's first answer must stay numeric.
    pol = _policy("number", ["250", "two hundred fifty"])
    pol["max_words"] = 3
    pol["settings"] = {"locale": "en"}
    inputs = _inputs("listening")
    _explain(inputs, 3, "250", ["250", "two hundred fifty"])
    inputs["revision_keys"][3] = {"answer": "250", "alternatives": [], "response_policy": pol}
    plan = build_plan(**inputs)
    assert plan["classification"]["3"] == "policy" and plan["answer_sync"] == {}


def test_list_valued_revision_primary_is_flattened_for_the_override_union():
    # Codex on #1745: a Reading primary list must not become one nested "form".
    inputs = _inputs("reading")
    _explain(inputs, 11, "gut", ["gut"], override=True)
    inputs["revision_keys"][11] = {"answer": ["gut", "intestines"], "alternatives": []}
    inputs["reviewed_answer_sync"] = frozenset({11})
    plan = build_plan(**inputs)
    assert plan["rows"][10]["payload"]["item"]["answer"]["accepted_forms"] == ["gut", "intestines"]
    assert plan["answer_sync"]["11"] == {"added_forms": ["intestines"], "grading_change": False}
