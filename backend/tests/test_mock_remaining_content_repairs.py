"""Exercise the repaired source groups through the native grader/review."""
from copy import deepcopy
import json
from pathlib import Path

import pytest

from services.listening_test_grader import collect_answer_key, grade_attempt


FIXTURE = json.loads((Path(__file__).parent / "fixtures" /
                      "mock_remaining_content_repairs.json").read_text())


@pytest.mark.parametrize("reverse", [False, True])
def test_c20l1_three_choose_two_groups_grade_six_independent_slots(reverse):
    exercises = deepcopy(FIXTURE["m01_after_groups"])
    key = collect_answer_key(exercises)
    assert {row["group_key"] for row in key} == {"mm-21", "mm-23", "mm-25"}
    picks = []
    for first, expected in [(21, ["C", "E"]), (23, ["A", "C"]), (25, ["A", "B"])]:
        labels = list(reversed(expected)) if reverse else expected
        picks.extend({"q_num": first + index, "user_answer": label} for index, label in enumerate(labels))
    result = grade_attempt(picks, key)
    assert result["score"] == result["max_score"] == 6
    assert all(row["correct"] for row in result["per_question"])
    # A second selection in another question cannot consume this group's C.
    # D belongs to none of the three answer sets.
    picks[2]["user_answer"] = "D"
    wrong = grade_attempt(picks, key)
    assert wrong["score"] == 5
    assert next(row for row in wrong["per_question"] if row["q_num"] == 21)["correct"]
    assert next(row for row in wrong["per_question"] if row["q_num"] == 23)["correct"] is False


def test_c20l1_each_pair_keeps_its_source_prompt_and_option_bank():
    pairs = FIXTURE["m01_after_groups"]
    assert [[q["q_num"] for q in row["payload"]["questions"]] for row in pairs] == [[21, 22], [23, 24], [25, 26]]
    assert all(row["payload"]["metadata"]["choose"] == 2 for row in pairs)
    assert "increase in loneliness" in pairs[0]["payload"]["instruction"]
    assert "health risks" in pairs[1]["payload"]["instruction"]
    assert "evolutionary theory" in pairs[2]["payload"]["instruction"]
    assert pairs[1]["payload"]["metadata"]["match_options"][2] == {"letter": "C", "text": "cancer"}
    assert pairs[2]["payload"]["metadata"]["match_options"][1] == {"letter": "B", "text": "It needs further investigation."}


def test_r001_q21_solution_names_paragraph_b_and_keeps_existing_key_and_alternative():
    question = FIXTURE["m08_question_after"]
    assert question["answer"] == {"answer": "sea temperature", "alternatives": ["ocean temperature"]}
    solution = question["payload"]["solution"]
    assert solution["source_paragraph"] == "B"
    assert "elevated sea temperature is by far the most important" in solution["source_excerpt"]
    assert "hai từ" in solution["steps"] and "elevated đã có sẵn" in solution["steps"]
    assert question["explanation"] and solution["trap_analysis"]
