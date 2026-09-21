from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import import_cambridge_canonical_qa as importer  # noqa: E402


def _q(number: int, text: str, options: dict[str, str], qtype: str = "multi-select"):
    return {"number": number, "text": text, "options": options, "question_type": qtype}


def test_choose_two_groups_are_chunked_even_when_option_banks_repeat():
    options = {"A": "one", "B": "two", "C": "three", "D": "four", "E": "five"}
    rows = [
        _q(17, "Choose TWO letters, A–E.\nFirst stem", options),
        _q(18, "Choose TWO letters, A–E.\nFirst stem", options),
        _q(19, "Choose TWO letters, A–E.\nSecond stem", options),
        _q(20, "Choose TWO letters, A–E.\nSecond stem", options),
    ]

    groups = importer._listening_groups(rows)

    assert [[q["number"] for q in group] for group in groups] == [[17, 18], [19, 20]]
    assert all(group[0]["_effective_type"] == "multi-select" for group in groups)


def test_shared_box_multi_select_is_classified_as_matching():
    options = {"A": "one", "B": "two", "C": "three"}
    text = "Choose SIX answers from the box and write the correct letter, A-I, next to Questions 11-16."
    rows = [_q(number, f"{text}\nItem {number}", options) for number in range(11, 17)]

    groups = importer._listening_groups(rows)

    assert len(groups) == 1
    assert groups[0][0]["_effective_type"] == "matching"


def test_answer_arrays_are_alternatives_unless_authored_as_whole_set():
    assert importer._answer(["twenty", "20"]) == {
        "answer": "twenty",
        "alternatives": ["20"],
    }
    assert importer._answer(["A", "D"], whole_set=True) == {
        "answer": "A, D",
        "alternatives": [],
    }


def test_answer_shorthand_is_expanded_at_import_boundary():
    assert importer._answer("(food) consumption") == {
        "answer": "consumption",
        "alternatives": ["food consumption"],
    }
    assert importer._answer("flavour / flavor") == {
        "answer": "flavour",
        "alternatives": ["flavor"],
    }
    assert importer._answer("24/04") == {
        "answer": "24/04",
        "alternatives": [],
    }
    assert importer._answer("(B, E)", whole_set=True) == {
        "answer": "B, E",
        "alternatives": [],
    }


def test_completion_template_moves_markers_to_printed_blanks():
    raw = (
        "Complete the sentences using words from the passage. "
        "Limit: ONE WORD ONLY.\n"
        "each answer.\n"
        "{{22}} Some dead wood may cause ________ .\n"
        "{{23}} The ________ improves soil quality."
    )
    assert importer._reading_word_limit(raw) == "ONE WORD ONLY"
    assert importer._completion_template(raw) == (
        "Some dead wood may cause {{22}} .\n"
        "The {{23}} improves soil quality."
    )


def test_completion_template_moves_marker_across_wrapped_line():
    raw = (
        "Complete the sentences using words from the passage. "
        "Limit: NO MORE THAN TWO WORDS AND/OR A NUMBER.\n"
        "each answer.\n"
        "{{3}} It may account for 10% of\n"
        "the city's ________ overall."
    )

    result = importer._completion_template(raw)

    assert result == "It may account for 10% of\nthe city's {{3}} overall."
    assert not importer.BLANK_RE.search(result)


def test_completion_template_handles_bullets_and_inline_markers():
    raw = (
        "Complete the notes using words from the passage. Limit: TWO WORDS.\n"
        "- {{1}} ________ may have been arranged\n"
        "- builders used {{2}} to make sledges\n"
        "{{3}} ________ It is therefore important"
    )

    result = importer._completion_template(raw)

    assert result == (
        "- {{1}} may have been arranged\n"
        "- builders used {{2}} to make sledges\n"
        "{{3}} It is therefore important"
    )
    assert not importer.BLANK_RE.search(result)


def test_completion_template_preserves_spacing_for_already_placed_markers():
    raw = (
        "Complete the summary using words from the passage.\n"
        "Advice on the {{32}} of space and unused {{33}} material."
    )

    assert importer._completion_template(raw) == (
        "Advice on the {{32}} of space and unused {{33}} material."
    )


def test_cam16_t2_part1_template_owns_each_gap_exactly_once():
    q_nums = [
        item["q_num"]
        for group in importer.CAM16_T2_PART1_TEMPLATE["groups"]
        for item in group["items"]
        if "q_num" in item
    ]
    assert q_nums == list(range(1, 11))
    assert sorted(importer.CAM16_T2_PART1_PROMPTS) == list(range(1, 11))


def test_deterministic_ids_are_stable_and_domain_separated():
    assert importer._uuid("cambridge-13-test-1:reading:test") == importer._uuid(
        "cambridge-13-test-1:reading:test"
    )
    assert importer._uuid("cambridge-13-test-1:reading:test") != importer._uuid(
        "cambridge-13-test-1:listening:test"
    )


def test_production_hidden_guard_rejects_any_visibility_drift():
    hidden = {
        "status": "draft",
        "exam_only": True,
        "is_public": False,
        "public_practice_enabled": False,
        "web_explanation_mode": "disabled",
    }
    plan = SimpleNamespace(
        source_id="cambridge-13-test-1",
        reading_test=dict(hidden),
        listening_test=dict(hidden),
    )
    importer._assert_hidden_visibility([plan])

    plan.listening_test["public_practice_enabled"] = True
    with pytest.raises(importer.ValidationError, match="visibility không còn hidden"):
        importer._assert_hidden_visibility([plan])

    plan.listening_test["public_practice_enabled"] = False
    plan.reading_test["is_public"] = True
    with pytest.raises(importer.ValidationError, match="visibility không còn hidden"):
        importer._assert_hidden_visibility([plan])


def test_production_commit_requires_explicit_hidden_override(monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    with pytest.raises(importer.ValidationError, match="--allow-production-hidden"):
        importer.commit_plan([], confirmed_ref="production-ref")


def test_cambridge_15_test_4_q07_repair_survives_reimport():
    passages = []
    for passage_number, bounds in enumerate(((1, 14), (15, 27), (28, 40)), start=1):
        start, end = bounds
        passage_questions = []
        for number in range(start, end + 1):
            text = f"Question {number}"
            if number == 6:
                text = "Summary {{6}} {{7}} {{8}}"
            passage_questions.append(_q(number, text, {}, "gap-fill"))
        passages.append({
            "number": passage_number,
            "questions": passage_questions,
            "context": "word " * 20,
        })
    package = {
        "reading": {
            "passages": passages,
            "answers": [
                {"number": number, "answer": "placeholder"}
                for number in range(1, 41)
            ],
        }
    }

    _test, _passages, rows = importer._reading_rows(
        "cambridge-15-test-4", package
    )
    q07 = next(row for row in rows if row["q_num"] == 7)

    assert q07["answer"] == {
        "answer": "leaves bark",
        "alternatives": [
            "bark leaves", "leaves and bark", "bark and leaves",
            "leaves, bark", "bark, leaves",
        ],
    }
    assert q07["payload"]["solution"] == {
        "question_text": "Which two parts of the tree were used for medicine? Enter both words; either order is accepted.",
        "tips": "Điền đủ hai từ leaves và bark. Có thể đảo thứ tự; chỉ điền một từ thì không được tính điểm.",
        "trap_analysis": (
            "Đây là hai ô con cùng mang số 7. Từ and nằm cố định giữa hai ô "
            "trong bản in, nên hai từ cần nhập là leaves và bark; cả hai đều bắt buộc."
        ),
    }
