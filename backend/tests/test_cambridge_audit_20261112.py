"""Regression evidence for the four reviewed Cambridge answer variants."""
from copy import deepcopy
import json
from pathlib import Path

import pytest

from content_mock_correction.cambridge_audit_20261112 import REPAIRS, repair_answer
from services.listening_test_grader import answer_matches
from services.listening_test_grader import collect_answer_key, grade_attempt
from content_mock_correction.cambridge_audit_20261112 import (
    MATCHING_LABELS, MATCHING_OPTIONS, MATCHING_STEM, ROW_IDS, build_changes, repair_matching,
    transaction_sql,
)


@pytest.mark.parametrize("identity,target", REPAIRS.items())
def test_adds_only_reviewed_form_and_does_not_mutate_snapshot(identity, target):
    canonical, alternatives, added = target
    original = {"answer": canonical, "alternatives": list(alternatives),
                "rationale": {"unrelated": "preserved"}}
    snapshot = deepcopy(original)
    assert not answer_matches(added, canonical, alternatives)
    repaired = repair_answer(*identity, original)
    assert original == snapshot
    assert repaired == {**snapshot, "alternatives": alternatives + [added]}
    assert answer_matches(added, repaired["answer"], repaired["alternatives"])
    assert repair_answer(*identity, repaired) == repaired
    for prior in [canonical, *alternatives]:
        # The combined printed slash notation is not itself a learner answer.
        if answer_matches(prior, canonical, alternatives):
            assert answer_matches(prior, repaired["answer"], repaired["alternatives"])


@pytest.mark.parametrize("book,number,rejected", [
    ("LIS-CAM-B20-T4-REV02", 8, ["230", "2.03", "2:03", "2:30 pm"]),
    ("RDG-CAM-B18-T1-REV01", 2, ["1.000 kg", "1000 g", "100 kg", "1000"]),
    ("LIS-CAM-B17-T2-REV01", 31, ["321.000", "32,100", "32100", "321001"]),
    ("RDG-CAM-B16-T4-REV01", 13, ["a harbor", "the harbor entrance", "the river"]),
])
def test_wrong_magnitude_time_unit_and_extra_words_still_fail(book, number, rejected):
    identity = ("MOCK0016-PROD-20261006-ILR-" + book, number)
    canonical, alternatives, _ = REPAIRS[identity]
    repaired = repair_answer(*identity, {"answer": canonical, "alternatives": alternatives})
    for answer in rejected:
        assert not answer_matches(answer, repaired["answer"], repaired["alternatives"])


def test_optional_article_and_both_spellings_keep_prior_forms():
    identity = ("MOCK0016-PROD-20261006-ILR-RDG-CAM-B16-T4-REV01", 13)
    repaired = repair_answer(*identity, {"answer": "(the) harbour / harbor", "alternatives": []})
    for form in ["harbour", "harbor", "the harbour", "the harbor"]:
        assert answer_matches(form, repaired["answer"], repaired["alternatives"])


@pytest.mark.parametrize("answer", [
    {"answer": "2.03", "alternatives": ["two thirty"]},
    {"answer": "2.30", "alternatives": ["half past two"]},
    {"answer": "2.30", "alternatives": ["two thirty"], "response_policy": {}},
])
def test_drift_fails_closed(answer):
    with pytest.raises(ValueError):
        repair_answer("MOCK0016-PROD-20261006-ILR-LIS-CAM-B20-T4-REV02", 8, answer)


def test_unreviewed_item_is_rejected_and_no_global_numeric_guessing():
    with pytest.raises(ValueError):
        repair_answer("ILR-LIS-CAM-B20-T4", 8, {"answer": "2.30", "alternatives": []})
    assert not answer_matches("2:30", "2.30", [])
    assert not answer_matches("1000", "1,000", [])


def matching_source():
    return {
        "template_kind": "mcq_multi", "variant": "mcq_multi",
        "instruction": "Choose **TWO** letters, A-I. " + MATCHING_STEM,
        "metadata": {"choose": 2, "match_options": [{"letter": x, "text": text} for x, text in zip("ABCDEFGHI", MATCHING_OPTIONS)], "letter_options": list("ABCDEFGHI")},
        "questions": [{"q_num": n, "prompt": MATCHING_STEM} for n in MATCHING_LABELS],
        "answers": [{"q_num": n, "answer": a, "alternatives": []} for n, a in zip(MATCHING_LABELS, "DIHEAB")],
        "solutions": {"11": {"script": "Preserve"}}, "audio_windows": {"11": {"start": 1}},
    }


def test_matching_restores_six_labels_and_preserves_keys_audio_solutions():
    before = matching_source()
    untouched = deepcopy(before)
    after = repair_matching(before)
    assert before == untouched
    assert after["template_kind"] == after["variant"] == "matching"
    assert "choose" not in after["metadata"]
    for key in ["answers", "solutions", "audio_windows"]:
        assert after[key] == before[key]
    assert after["metadata"]["match_options"] == before["metadata"]["match_options"]
    assert [q["prompt"] for q in after["questions"]] == list(MATCHING_LABELS.values())
    assert repair_matching(after) == after


def test_matching_scores_each_slot_not_an_unordered_choose_two_set():
    after = repair_matching(matching_source())
    key = collect_answer_key([{"payload": after}])
    assert all(k["group_key"] is None for k in key)
    answers = [{"q_num": a["q_num"], "user_answer": a["answer"]} for a in after["answers"]]
    assert all(r["correct"] for r in grade_attempt(answers, key)["per_question"])
    partial = grade_attempt(answers[:2], key)["per_question"]
    assert sum(r["correct"] for r in partial) == 2
    answers[0]["user_answer"], answers[1]["user_answer"] = "I", "D"
    assert sum(r["correct"] for r in grade_attempt(answers, key)["per_question"]) == 4


def test_matching_drift_refuses_instead_of_overwriting():
    source = matching_source()
    source["questions"][0]["prompt"] = "Other content"
    with pytest.raises(ValueError, match="differs"):
        repair_matching(source)


def plan_rows():
    rows = []
    for code, (row_id, test_uuid) in ROW_IDS.items():
        if code.startswith("ILR-"):
            continue
        reading = "-RDG-" in code
        if code.endswith("B20-T2-REV02"):
            value = matching_source()
        else:
            identity = next(key for key in REPAIRS if key[0] == code)
            canonical, alternatives, _ = REPAIRS[identity]
            answer = {"answer": canonical, "alternatives": list(alternatives)}
            value = answer if reading else {"answers": [{"q_num": identity[1], **answer}]}
        rows.append({"test_id": code, "id": row_id, "test_uuid": test_uuid,
                     "table_name": "reading_questions" if reading else "listening_exercises",
                     "field": "answer" if reading else "payload", "status": "published",
                     "is_public": False, "updated_at": "2026-10-07T00:34:42.467323+00:00",
                     "before_value": value})
    return rows


def test_plan_has_five_exact_targets_and_default_sql_rolls_back():
    rows = plan_rows()
    before = deepcopy(rows)
    changes = build_changes(rows)
    assert rows == before and len(changes) == 5
    sql = transaction_sql(changes)
    assert sql.count("UPDATE public.") == 5
    assert sql.count("GET DIAGNOSTICS changed = ROW_COUNT") == 5
    assert sql.endswith("ROLLBACK;\n") and "COMMIT;" not in sql
    assert "standard_conforming_strings = on" in sql
    assert "reading_test_attempts" not in sql and "listening_test_attempts" not in sql
    assert transaction_sql(changes, rollback=False).endswith("COMMIT;\n")


@pytest.mark.parametrize("field,value", [
    ("id", "00000000-0000-0000-0000-000000000000"),
    ("test_uuid", "00000000-0000-0000-0000-000000000000"),
    ("field", "payload"), ("table_name", "listening_exercises"),
    ("status", "draft"), ("is_public", True), ("updated_at", None),
])
def test_snapshot_identity_policy_and_timestamp_drift_rejected(field, value):
    rows = plan_rows()
    rows[0][field] = value
    with pytest.raises(ValueError):
        build_changes(rows)


def test_duplicate_listening_answer_slot_rejected():
    rows = plan_rows()
    row = next(r for r in rows if r["test_id"].endswith("B20-T4-REV02"))
    row["before_value"]["answers"] *= 2
    with pytest.raises(ValueError, match="exactly one"):
        build_changes(rows)


def test_matching_changed_key_rejected():
    source = matching_source()
    source["answers"][0]["answer"] = "A"
    with pytest.raises(ValueError, match="keys differ"):
        repair_matching(source)


def test_generated_sql_rejects_reserved_delimiter():
    rows = plan_rows()
    rows[0]["before_value"]["note"] = "$cambridge_repair$"
    with pytest.raises(ValueError, match="reserved"):
        transaction_sql(build_changes(rows))


@pytest.mark.parametrize("field,value", [("match_options", []), ("letter_options", []),
                                         ("match_options", [{"letter": x, "text": x} for x in "ABCDEFGHI"])])
def test_matching_option_drift_rejected(field, value):
    source = matching_source()
    source["metadata"][field] = value
    with pytest.raises(ValueError, match="option bank"):
        repair_matching(source)


def test_transform_matches_exact_rendered_fixture():
    fixture = json.loads((Path(__file__).resolve().parents[2] /
                          "frontend/tests/fixtures/cam20-t2-reviewed-matching.json").read_text())
    before = deepcopy(fixture)
    before["template_kind"] = before["variant"] = "mcq_multi"
    before["instruction"] = "Choose **TWO** letters, A-I. " + MATCHING_STEM
    before["metadata"]["choose"] = 2
    before["answers"] = matching_source()["answers"]
    for q in before["questions"]:
        q["prompt"] = MATCHING_STEM
    after = repair_matching(before)
    assert {k: after[k] for k in fixture} == fixture


def staging_rows():
    rows = plan_rows()
    for row in rows:
        code = "ILR-" + row["test_id"].split("-ILR-", 1)[1].rsplit("-REV", 1)[0]
        row.update(test_id=code, id=ROW_IDS[code][0], test_uuid=ROW_IDS[code][1], status="draft")
        if code.endswith("B16-T4"):
            row["before_value"] = {"answer": "(the) harbour", "alternatives": ["harbor"]}
        elif code.endswith("B20-T4"):
            row["before_value"]["answers"][0]["alternatives"] = []
        elif code.endswith("B20-T2"):
            bank = [{"label": x, "text": text} for x, text in zip("ABCDEFGHI", MATCHING_OPTIONS)]
            row["before_value"] = {"template_kind": "matching", "metadata": {"match_options": bank},
                                   "questions": [{"q_num": n, "prompt": MATCHING_STEM + "\n" + text, "options": bank}
                                                 for n, text in MATCHING_LABELS.items()]}
    return rows


def test_staging_requires_one_complete_correct_reference_but_never_changes_it():
    rows = staging_rows()
    before = deepcopy(rows)
    assert len(build_changes(rows, rehearsal=True)) == 4
    assert rows == before
    reference = next(r for r in rows if r["test_id"].endswith("B20-T2"))
    with pytest.raises(ValueError):
        build_changes([r for r in rows if r is not reference], rehearsal=True)
    with pytest.raises(ValueError):
        build_changes(rows + [reference], rehearsal=True)
    reference["before_value"]["questions"] = []
    with pytest.raises(ValueError):
        build_changes(rows, rehearsal=True)
