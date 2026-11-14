"""Synthetic package projection: no source-book content or provider calls."""
import json
from copy import deepcopy
from uuid import uuid4

import pytest

from models.listening_blackeye import PROGRAMME
from services import listening_package_import as importer
from services.listening_blackeye import activity_from_paper
from test_listening_content_programmes import (
    _minimal_publish_ready_package, _rebind_manifest, _write_json,
)


def synthetic_contract():
    binding = dict(programme_id=PROGRAMME, collection_id="blackeye-v5-upper",
                   source_contract="blackeye_u1_v1", unit_id="U1", activity_id="U1-A01",
                   content_revision="synthetic-content-1", policy_revision="synthetic-policy-1",
                   answer_set_revision=str(uuid4()))
    public = dict(binding=binding, title="Synthetic activity", order=1, readiness="ready",
                  readiness_reasons=[], selectable=True, response_cell_count=1,
                  scoring_policy="report_only", objective_denominator=0,
                  dictation=dict(available=False, reason="separate_release_required"),
                  media_handle=None, items=[dict(source_item_id="item-1", q_num=1,
                      source_display_number="1", interaction="text", prompt="Synthetic prompt",
                      instruction="Synthetic instruction", givens=[], group_id=None,
                      row_id=None, column_id=None)])
    paper = dict(id="package-source-id", programme_id=PROGRAMME, scoring_policy="report_only",
                 metadata=dict(blackeye=public,
                     blackeye_db_revisions=dict(paper_revision=0, policy_revision=1),
                     blackeye_context=dict(kind="standalone", class_assignment_item_id=None,
                                           assignment_id=None, cohort_id=None)))
    review = dict(binding=deepcopy(binding), items=[dict(q_num=1, source_item_id="item-1",
        source_status="CONFIRMED", scoring_mode="SELF-CHECK", academic_verdict="CONFIRMED",
        reference="Synthetic reference", reference_provenance="editorial",
        explanation_vi="Giải thích giả lập", limitation_vi=None, evidence_pointer=None)],
        transcript=[dict(text="Synthetic transcript", start=None, end=None)])
    return paper, review


def blackeye_package(tmp_path, mutate=None):
    root = _minimal_publish_ready_package(tmp_path)
    package = root / "general/fixture"
    paper, review = synthetic_contract()
    if mutate:
        mutate(paper, review)
    lesson_path = package / "learner/content/lessons/lesson-1.json"
    lesson = json.loads(lesson_path.read_text())
    lesson["programme_id"] = PROGRAMME
    lesson["forms"][0]["blackeye_paper"] = paper
    # Black Eye review is always SELF-CHECK, never generic exact-key scoring.
    lesson["items"][0]["response_type"] = "short_answer"
    _write_json(lesson_path, lesson)
    protected_path = package / "protected/source-lessons/lesson-1.json"
    protected = json.loads(protected_path.read_text())
    protected["forms"][0]["blackeye_review"] = review
    _write_json(protected_path, protected)
    manifest_path = package / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["programme_id"] = PROGRAMME
    manifest["package_id"] = "fixture-blackeye-v1"
    _write_json(manifest_path, manifest)
    index_path = root / "release-index.json"
    index = json.loads(index_path.read_text())
    index["programmes"][0]["id"] = PROGRAMME
    index["programmes"][0]["packages"][0]["package_id"] = "fixture-blackeye-v1"
    _write_json(index_path, index)
    _rebind_manifest(root)
    return importer.select_package(root, "fixture-blackeye-v1"), paper, review


def test_blackeye_plan_preserves_package_contract_and_protected_review(tmp_path):
    location, paper, review = blackeye_package(tmp_path)
    plan = importer.build_import_plan(location)
    form = plan.forms[0]
    for key, value in paper["metadata"].items():
        assert form["metadata"][key] == value
    assert form["exercise_payload"]["blackeye_review"] == review
    activity, full = activity_from_paper(dict(id="db-id", programme_id=PROGRAMME,
        scoring_policy="report_only", metadata=form["metadata"]))
    assert activity.test_id == "db-id" and activity.items[0].source_item_id == "item-1"
    assert full.answer_set_revision == paper["metadata"]["blackeye"]["binding"]["answer_set_revision"]
    assert "answer_set_revision" not in activity.model_dump()["binding"]
    assert "blackeye_review" not in form["metadata"]
    assert "Synthetic reference" not in json.dumps(form["metadata"])
    assert "Synthetic transcript" not in json.dumps(form["metadata"])


@pytest.mark.parametrize("key", ["blackeye", "blackeye_db_revisions", "blackeye_context"])
def test_missing_metadata_fails_before_any_import(tmp_path, key):
    location, _, _ = blackeye_package(tmp_path, lambda p, r: p["metadata"].pop(key))
    with pytest.raises(importer.PackageValidationError):
        importer.build_import_plan(location)


@pytest.mark.parametrize("mapping", [None, {}, {"paper_revision": 0},
    {"paper_revision": 0, "policy_revision": 1, "extra": 1},
    {"paper_revision": True, "policy_revision": 1},
    {"paper_revision": "0", "policy_revision": 1},
    {"paper_revision": -1, "policy_revision": 1},
    {"paper_revision": 1, "policy_revision": 1},
    {"paper_revision": 0, "policy_revision": 0},
    {"paper_revision": 0, "policy_revision": 2**63}])
def test_invalid_db_mapping_rejected(tmp_path, mapping):
    location, _, _ = blackeye_package(tmp_path, lambda p, r: p["metadata"].update(blackeye_db_revisions=mapping))
    with pytest.raises(importer.PackageValidationError, match="Black Eye import contract invalid"):
        importer.build_import_plan(location)


@pytest.mark.parametrize("damage", ["uuid", "uuid_spelling", "review_binding", "cell", "count",
    "mode", "reference", "verdict", "transcript", "transcript_text", "context", "assigned"])
def test_invalid_review_or_context_is_closed(tmp_path, damage):
    def mutate(p, r):
        if damage in {"uuid", "uuid_spelling"}:
            p["metadata"]["blackeye"]["binding"]["answer_set_revision"] = "a" * 32 if damage == "uuid_spelling" else "answer-hash"
        elif damage == "review_binding": r["binding"]["answer_set_revision"] = str(uuid4())
        elif damage == "cell": r["items"][0]["source_item_id"] = "wrong"
        elif damage == "count": r["items"] = []
        elif damage == "mode": r["items"][0]["scoring_mode"] = "objective_exact"
        elif damage == "reference": r["items"][0]["reference"] = 7
        elif damage == "verdict": r["items"][0]["academic_verdict"] = "invalid"
        elif damage == "transcript": r["transcript"] = None
        elif damage == "transcript_text": r["transcript"][0]["text"] = 7
        elif damage == "context": p["metadata"]["blackeye_context"]["cohort_id"] = "unexpected"
        else: p["metadata"]["blackeye_context"].update(kind="assigned", cohort_id="c", assignment_id="a", class_assignment_item_id="i")
    location, _, _ = blackeye_package(tmp_path, mutate)
    with pytest.raises(importer.PackageValidationError):
        importer.build_import_plan(location)


def test_missing_protected_review_fails_closed(tmp_path):
    location, _, _ = blackeye_package(tmp_path)
    path = location.package_root / "protected/source-lessons/lesson-1.json"
    protected = json.loads(path.read_text())
    del protected["forms"][0]["blackeye_review"]
    _write_json(path, protected)
    _rebind_manifest(location.release_root)
    location = importer.select_package(location.release_root, location.package_id)
    with pytest.raises(importer.PackageValidationError, match="Black Eye import contract invalid"):
        importer.build_import_plan(location)


def test_answer_identity_is_preserved_when_reference_changes():
    paper, review = synthetic_contract()
    before, _ = importer._blackeye_import_fields(paper, {"blackeye_review": review})
    review["items"][0]["reference"] = "Another synthetic reference"
    after, changed_review = importer._blackeye_import_fields(paper, {"blackeye_review": review})
    assert after == before
    assert changed_review["binding"]["answer_set_revision"] == review["binding"]["answer_set_revision"]
    assert changed_review["items"][0]["reference"] == "Another synthetic reference"


def test_generic_plan_does_not_consult_or_store_blackeye_fields(tmp_path, monkeypatch):
    root = _minimal_publish_ready_package(tmp_path)
    location = importer.select_package(root, "fixture-general-v1")
    before = importer.build_import_plan(location)
    path = location.package_root / "learner/content/lessons/lesson-1.json"
    lesson = json.loads(path.read_text())
    lesson["forms"][0]["blackeye_paper"] = {"invalid": "ignored by legacy path"}
    _write_json(path, lesson)
    _rebind_manifest(root)
    monkeypatch.setattr(importer, "_blackeye_import_fields", lambda *a: pytest.fail("generic consulted Black Eye"))
    after = importer.build_import_plan(importer.select_package(root, location.package_id))
    # Manifest-bound storage names change; every non-storage output stays equal.
    for form in (before.forms[0], after.forms[0]):
        form.pop("audio_storage_path")
    assert after.forms == before.forms
