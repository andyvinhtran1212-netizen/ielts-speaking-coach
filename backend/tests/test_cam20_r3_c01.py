import copy
import json
import subprocess
import sys

import pytest

from content_mock_correction.cam20_r3_c01 import SPEC, build_plan, rehearsal_sql
from services.reading_test_grader import collect_answer_key, grade_attempt


@pytest.fixture
def snapshot():
    paper = {**SPEC["paper"], "mock_content_revision": 83, "policy_revision": 3}
    return [{"paper": copy.deepcopy(paper), "question": {
        "id": q["id"], "q_num": q["q_num"], "prompt": q["prompt"],
        "answer": copy.deepcopy(q["answer"]), "passage_id": SPEC["passage_id"],
        "question_type": "mcq_single", "updated_at": "2026-10-07T00:34:42.467323+00:00",
        "payload": {"options": copy.deepcopy(SPEC["options_before"]),
                    "solution": {"tips": "Do not modify this teaching text"}},
        "explanation": "Preserve", "skill_tag": "inference", "order_num": q["q_num"] - 26,
    }} for q in SPEC["questions"]]


def test_only_exact_four_option_banks_change_without_mutating_input(snapshot):
    original = copy.deepcopy(snapshot)
    plan = build_plan(snapshot)
    assert snapshot == original
    assert [c["after"]["q_num"] for c in plan["changes"]] == [37, 38, 39, 40]
    for change, source in zip(plan["changes"], SPEC["questions"]):
        expected = copy.deepcopy(change["before"])
        expected["payload"]["options"] = source["options"]
        assert change["after"] == expected
        assert [o["label"] for o in change["after"]["payload"]["options"]] == list("ABCD")
    assert plan["changes"][0]["after"]["payload"]["options"][0] == SPEC["options_before"][0]
    assert SPEC["source"]["printed_pages"] == [100, 101]
    assert SPEC["source"]["sha256"] == "a818cf2a0132c37e04c810d30932733f872da0b9122ce13561001887f79fbb0e"


@pytest.mark.parametrize("q_num,key", [(37, "B"), (38, "C"), (39, "B"), (40, "C")])
def test_keys_and_all_distractors_keep_existing_grading(snapshot, q_num, key):
    plan = build_plan(snapshot)
    row = next(c["after"] for c in plan["changes"] if c["after"]["q_num"] == q_num)
    answer_key = collect_answer_key([row])
    for letter in "ABCD":
        result = grade_attempt([{"q_num": q_num, "user_answer": letter}], answer_key)
        assert result["score"] == (1 if letter == key else 0)


@pytest.mark.parametrize("field,value", [
    ("id", "wrong"), ("passage_id", "wrong"), ("prompt", "changed"),
    ("question_type", "mcq_multi"), ("answer", {"answer": "A", "alternatives": []}),
    ("q_num", 36), ("updated_at", None),
])
def test_reject_question_drift(snapshot, field, value):
    snapshot[-1]["question"][field] = value
    with pytest.raises(ValueError):
        build_plan(snapshot)


@pytest.mark.parametrize("field,value", [
    ("id", "wrong"), ("test_id", "ILR-RDG-CAM-B20-T3"), ("status", "draft"),
    ("is_public", True), ("exam_only", False), ("mock_content_revision", None),
    ("policy_revision", None),
])
def test_reject_paper_drift(snapshot, field, value):
    snapshot[0]["paper"][field] = value
    with pytest.raises(ValueError):
        build_plan(snapshot)


def test_reject_missing_duplicate_and_already_correct_rows(snapshot):
    with pytest.raises(ValueError):
        build_plan(snapshot[:-1])
    duplicate = copy.deepcopy(snapshot)
    duplicate[-1] = duplicate[0]
    with pytest.raises(ValueError):
        build_plan(duplicate)
    snapshot[0]["question"]["payload"]["options"] = SPEC["questions"][0]["options"]
    with pytest.raises(ValueError, match="already applied"):
        build_plan(snapshot)


def test_sql_is_atomic_guarded_rollback_and_escapes_content(snapshot):
    snapshot[0]["question"]["explanation"] = "Student's unchanged explanation"
    sql = rehearsal_sql(snapshot)
    assert "Student''s unchanged explanation" in sql
    assert sql.startswith("-- C01") and sql.endswith("ROLLBACK;\n")
    assert "COMMIT;" not in sql
    assert "fn_lock_mock_paper" in sql and "FOR SHARE" in sql and "FOR UPDATE" in sql
    assert "AND to_jsonb(q) = item->'before'" in sql
    assert "SET payload = item->'after'->'payload'" in sql
    assert "touched <> 1" in sql and "C01 readback mismatch" in sql
    assert "UPDATE public.reading_tests" not in sql
    assert "reading_test_attempts" not in sql
    snapshot[0]["question"]["explanation"] = "$c01$"
    with pytest.raises(ValueError, match="reserved SQL delimiter"):
        rehearsal_sql(snapshot)


def test_cli_is_offline_plan_by_default_and_never_applies(snapshot, tmp_path):
    path = tmp_path / "before.json"
    path.write_text(json.dumps(snapshot), encoding="utf-8")
    result = subprocess.run([sys.executable, "-m", "content_mock_correction.cam20_r3_c01", str(path)],
                            capture_output=True, text=True, check=True)
    assert json.loads(result.stdout) == build_plan(snapshot)
    sql = subprocess.run([sys.executable, "-m", "content_mock_correction.cam20_r3_c01", str(path), "--sql"],
                         capture_output=True, text=True, check=True)
    assert sql.stdout.rstrip().endswith("ROLLBACK;")
