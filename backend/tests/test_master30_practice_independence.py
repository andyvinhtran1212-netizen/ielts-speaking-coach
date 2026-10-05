"""Release checks must protect reserved source families, not only runtime IDs."""
import copy
import json

import pytest

from scripts.validate_master30_assigned_practice import validate_independence


@pytest.fixture
def source(tmp_path):
    diagnostic = tmp_path / "MASTER30-DIAGNOSTIC/web-upload/diagnostic"
    diagnostic.mkdir(parents=True)
    (diagnostic / "q-matrix.json").write_text(json.dumps({"items": [{
        "item_id": "reserved-source", "diagnostic_status": "HOLDOUT_RESERVED",
        "stimulus_family": "reserved-family", "parallel_set_id": "reserved-parallel",
    }]}))
    (diagnostic / "runtime-bank.json").write_text(json.dumps({"items": [{
        "id": "runtime-source", "prompt": "Choose the reserved runtime item.",
    }]}))
    bank = tmp_path / "Buoi-01"
    bank.mkdir()
    (bank / "KBT-buoi-01.jsonl").write_text(json.dumps({
        "id": "reserved-source", "de": "A reserved item outside the runtime export.",
    }))
    return tmp_path


def package():
    return {"version": "v2", "lessons": {"M30-B01": {"questions": [{
        "id": "M30P2-B01-01", "prompt": "An independently written practice prompt.",
        "provenance": {"kind": "newly_authored"},
    }]}}}


def test_fresh_practice_is_counted_with_source_hash_evidence(source):
    report = validate_independence(package(), source)
    assert report["question_count"] == 1 and report["exact_overlaps"] == 0
    assert report["reserved_source_ids"] == 2
    assert len(report["source_hashes"]) == 2


@pytest.mark.parametrize("reuse", ["id", "runtime_prompt", "canonical_prompt", "source_id", "family", "parallel", "duplicate"])
def test_reserved_or_duplicate_question_blocks_release(source, reuse):
    data = package()
    question = data["lessons"]["M30-B01"]["questions"][0]
    if reuse == "id": question["id"] = "reserved-source"
    elif reuse == "runtime_prompt": question["prompt"] = "Choose the RESERVED runtime item!"
    elif reuse == "canonical_prompt": question["prompt"] = "A reserved item outside the runtime export."
    elif reuse == "source_id": question["provenance"]["source_item_id"] = "reserved-source"
    elif reuse == "family": question["provenance"]["stimulus_family"] = "reserved-family"
    elif reuse == "parallel": question["provenance"]["parallel_set_id"] = "reserved-parallel"
    else:
        duplicate = copy.deepcopy(question)
        duplicate["id"] = "M30P2-B01-02"
        data["lessons"]["M30-B01"]["questions"].append(duplicate)
    with pytest.raises(ValueError, match="Reserved or duplicate"):
        validate_independence(data, source)
