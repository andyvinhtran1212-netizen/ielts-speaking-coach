from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace

import pytest

from services.listening_editorial_validation import (
    EditorialValidationError,
    build_approved_translation_projection,
    source_catalog_from_plans,
    validate_question_batches,
)


PACKAGE_ID = "general-listening-practice-v1.0.0"
MANIFEST_SHA = "a" * 64
SOURCE = {
    PACKAGE_ID: {
        "choice-1": {"prompt": "Choose one.", "options": {"A": "One", "B": "Two"}},
        "short-1": {"prompt": "What did you hear?", "options": {}},
    },
}
BATCH = {
    "batch_id": "LISTENING-0007-B01",
    "status": "approved_by_owner_not_published",
    "source_package_id": PACKAGE_ID,
    "source_language": "en",
    "target_language": "vi",
    "items": [
        {
            "id": "choice-1",
            "source_prompt": "Choose one.",
            "source_options": {"A": "One", "B": "Two"},
            "prompt_vi": "Chọn một đáp án.",
            "options_vi": {"A": "Một", "B": "Hai"},
        },
        {
            "id": "short-1",
            "source_prompt": "What did you hear?",
            "prompt_vi": "Bạn nghe thấy gì?",
        },
    ],
}


def validate(batches, **kwargs):
    return validate_question_batches(
        SOURCE,
        batches,
        expected_manifest_sha256={PACKAGE_ID: MANIFEST_SHA},
        actual_manifest_sha256={PACKAGE_ID: MANIFEST_SHA},
        **kwargs,
    )


def test_complete_owner_approved_batch_is_source_bound():
    assert validate([BATCH], require_all_drafted=True, require_all_approved=True) == {
        "source_items": 2,
        "drafted_items": 2,
        "approved_items": 2,
        "pending_items": 0,
        "missing_items": 0,
        "batch_count": 1,
        "source_manifest_sha256": {PACKAGE_ID: MANIFEST_SHA},
    }


def test_delegated_editorial_approval_is_distinct_from_owner_review_but_projectable():
    batch = deepcopy(BATCH)
    batch["status"] = "approved_under_owner_delegation_not_published"
    report = validate([batch], require_all_approved=True)
    assert report["approved_items"] == 2
    projection, _ = build_approved_translation_projection(
        SOURCE, [batch],
        expected_manifest_sha256={PACKAGE_ID: MANIFEST_SHA},
        actual_manifest_sha256={PACKAGE_ID: MANIFEST_SHA},
        require_all_approved=True,
    )
    assert len(projection) == 2


@pytest.mark.parametrize("mutation, error", [
    (lambda b: b["items"][0].update(source_prompt="Changed"), "Source prompt mismatch"),
    (lambda b: b["items"][0]["source_options"].update(A="Changed"), "Source options mismatch"),
    (lambda b: b["items"][0]["options_vi"].pop("B"), "Target option keys"),
    (lambda b: b["items"][0].update(prompt_vi=" "), "Target prompt thiếu"),
    (lambda b: b["items"][0].update(options_en={"A": "One", "B": "Two"}), "ghi đè ngôn ngữ gốc"),
    (lambda b: b["items"].append(deepcopy(b["items"][0])), "Item ID trùng"),
    (lambda b: b["items"][0].update(answer="A"), "trường lạ"),
])
def test_stale_or_unsafe_editorial_entries_fail_closed(mutation, error):
    batch = deepcopy(BATCH)
    mutation(batch)
    with pytest.raises(EditorialValidationError, match=error):
        validate([batch])


def test_unchanged_heard_word_labels_require_explicit_review():
    batch = deepcopy(BATCH)
    batch["items"][0].pop("options_vi")
    with pytest.raises(EditorialValidationError, match="Option review state"):
        validate([batch])
    batch["items"][0]["unchanged_options_reviewed"] = True
    assert validate([batch], require_all_drafted=True)["drafted_items"] == 2


def test_pending_text_never_passes_release_approval_gate():
    batch = deepcopy(BATCH)
    batch["status"] = "draft_pending_owner_review"
    assert validate([batch], require_all_drafted=True)["approved_items"] == 0
    with pytest.raises(EditorialValidationError, match="editorial approval"):
        validate([batch], require_all_approved=True)


@pytest.mark.parametrize("field", ["source_package_id", "source_language", "target_language", "status"])
def test_malformed_batch_identity_fails_closed(field):
    batch = deepcopy(BATCH)
    batch[field] = []
    with pytest.raises(EditorialValidationError):
        validate([batch])


def test_manifest_lock_and_missing_item_fail_release_gate():
    with pytest.raises(EditorialValidationError, match="Source manifest đã đổi"):
        validate_question_batches(
            SOURCE, [BATCH],
            expected_manifest_sha256={PACKAGE_ID: MANIFEST_SHA},
            actual_manifest_sha256={PACKAGE_ID: "b" * 64},
        )
    batch = deepcopy(BATCH)
    batch["items"].pop()
    with pytest.raises(EditorialValidationError, match="Thiếu 1 item"):
        validate([batch], require_all_drafted=True)


def test_source_catalog_rejects_same_item_in_two_forms():
    question = {"source_item_id": "choice-1", "prompt": "Choose one.", "options": {"A": "One", "B": "Two"}}
    plan = SimpleNamespace(
        location=SimpleNamespace(package_id=PACKAGE_ID),
        package={"source_counts": {"items": 1}},
        forms=[{"exercise_payload": {"questions": [question]}}],
    )
    assert source_catalog_from_plans([plan]) == {
        PACKAGE_ID: {"choice-1": {"prompt": "Choose one.", "options": {"A": "One", "B": "Two"}}}
    }
    plan.forms.append({"exercise_payload": {"questions": [question]}})
    with pytest.raises(EditorialValidationError, match="nhiều form"):
        source_catalog_from_plans([plan])


def test_projection_contains_only_approved_learner_safe_display_fields():
    approved = deepcopy(BATCH)
    pending = deepcopy(BATCH)
    approved["items"] = approved["items"][:1]
    pending["batch_id"] = "LISTENING-0007-B02"
    pending["status"] = "draft_pending_owner_review"
    pending["items"] = pending["items"][1:]
    projection, report = build_approved_translation_projection(
        SOURCE, [approved, pending],
        expected_manifest_sha256={PACKAGE_ID: MANIFEST_SHA},
        actual_manifest_sha256={PACKAGE_ID: MANIFEST_SHA},
    )
    assert report["approved_items"] == 1
    assert report["pending_items"] == 1
    assert projection == {(PACKAGE_ID, "choice-1"): {
        "status": "approved",
        "source_item_id": "choice-1",
        "source_language": "en",
        "target_language": "vi",
        "source_prompt": "Choose one.",
        "source_options": {"A": "One", "B": "Two"},
        "prompt": "Chọn một đáp án.",
        "options": {"A": "Một", "B": "Hai"},
    }}
    projection[(PACKAGE_ID, "choice-1")]["options"]["A"] = "Modified locally"
    assert approved["items"][0]["options_vi"]["A"] == "Một"
    with pytest.raises(EditorialValidationError, match="editorial approval"):
        build_approved_translation_projection(
            SOURCE, [approved, pending],
            expected_manifest_sha256={PACKAGE_ID: MANIFEST_SHA},
            actual_manifest_sha256={PACKAGE_ID: MANIFEST_SHA},
            require_all_approved=True,
        )
