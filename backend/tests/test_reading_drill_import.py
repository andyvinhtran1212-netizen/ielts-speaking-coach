"""reading_drill_import — single-passage skill drill → ParsedReadingTest.

Fixtures are INLINE (not read from the content library) so these run in CI:
the drill corpus lives outside the repo, and a skipped test guards nothing.

Focus is the logic that silently corrupts answer keys if it regresses:
  • optional-word parentheses expanded into real alternatives (the grader only
    strips SURROUNDING punctuation, so a stored "(digital) model" is unmatchable)
  • a second `answer_accept` table not bleeding into the quick-answer grid
  • one gap per blank — not two, and not a stray marker digit
  • inline emphasis stripped everywhere the renderer emits plain text nodes
  • every per-question solution header dialect parsed (an unmatched header
    drops the whole rich solution and the review page loses "Xem lời giải")
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts import import_reading_drills as import_script
from services.content_import_service import validate_reading_test
from services.reading_test_grader import grade_attempt
from services.reading_prose_import import parse_rich_solutions
from services.reading_drill_import import (
    _DRILL_SOL_HDR_RE,
    build_parsed_reading_test_from_drill,
    expand_answer,
    parse_quick_answers,
)


def _drill(
    dang: str,
    questions: str,
    passage: str = "**A.** Alpha body text.",
    total_questions: int = 2,
) -> str:
    return f"""# ILR-RDG-DRL-XX-L2-T1 — Sample Title

| Field | Value |
| --- | --- |
| Test ID | ILR-RDG-DRL-XX-L2-T1 |
| Dạng | {dang} |
| Cấp | L2 Intermediate (target band 6.0–6.5) |
| Chủ đề | Testing |
| Số câu | {total_questions} |

## Passage — Sample Title

{passage}

## Questions 1–{total_questions}

*Instruction line.*

{questions}
"""


def _solution(rows: str, header: str = "| Q | Type | Answer | Band | Skill |",
              extra: str = "") -> str:
    return f"""# ILR-RDG-DRL-XX-L2-T1 — Đáp án

## Bảng đáp án nhanh
{header}
| --- | --- | --- | --- | --- |
{rows}
{extra}

## Phân bố kỹ năng
| Mã | Tên tiếng Việt | Số câu | Các câu |
|----|----------------|--------|---------|
| SCAN | Định vị thông tin | 2 | 1, 2 |

## Passage + Bản dịch sát nghĩa

**Đoạn A.** Bản dịch đoạn A.
"""


# ── expand_answer ─────────────────────────────────────────────────────

def test_leading_optional_words_become_alternatives():
    # "(digital) model" stored verbatim can never match: normalize_answer strips
    # only surrounding punctuation, leaving "digital) model".
    assert expand_answer("(digital) model") == ("model", ["digital model"])


def test_trailing_optional_words_become_alternatives():
    assert expand_answer("ultraviolet (radiation)") == (
        "ultraviolet", ["ultraviolet radiation"])


def test_inline_accept_marker_is_split_out():
    assert expand_answer("supporting (accept: temporary)") == (
        "supporting", ["temporary"])


def test_accept_column_splits_on_semicolon_and_slash():
    answer, alts = expand_answer("tubing", "tube; rubber tubing / rubber tube")
    assert answer == "tubing"
    assert alts == ["tube", "rubber tubing", "rubber tube"]


def test_accept_entry_equal_to_answer_is_not_duplicated():
    answer, alts = expand_answer("a third", "one third / a third")
    assert answer == "a third"
    assert alts == ["one third"]


def test_hyphenated_and_unhyphenated_accept_forms_remain_distinct_and_grade():
    answer, alts = expand_answer("X-ray", "X ray")
    assert answer == "X-ray"
    assert alts == ["X ray"]
    key = [{
        "q_num": 1,
        "answer": answer,
        "alternatives": alts,
        "skill_tag": "detail",
        "passage_order": 1,
    }]
    assert grade_attempt([{"q_num": 1, "user_answer": "X-ray"}], key)["score"] == 1
    assert grade_attempt([{"q_num": 1, "user_answer": "X ray"}], key)["score"] == 1


def test_empty_and_dash_cells_are_ignored():
    assert expand_answer("storm", "—") == ("storm", [])
    assert expand_answer("—") == ("", [])


# ── per-question solution header dialects ─────────────────────────────
#
# The drill corpus writes the "**Câu N — …**" header five different ways. The
# full-test regex only accepts the first; the other four used to fall through
# silently, so `parse_rich_solutions` returned {} and every question landed
# with an EMPTY solution — the review page then renders no "Xem lời giải"
# toggle at all. This is what broke TC-L2-T1 "Bringing Back the Mangroves".

_HEADERS = [
    # code + Vietnamese skill name (the only dialect the full-test regex takes)
    "**Câu 1 — Đáp án: a third · Kỹ năng: SCAN Định vị thông tin · Band 5.5**",
    # skill code ONLY, no name
    "**Câu 1 — Đáp án: a third · Kỹ năng: SCAN · Band 5.5**",
    # paragraph reference before the answer (matching-headings drills)
    "**Câu 1 — Đoạn A · Đáp án: ii · Kỹ năng: SKIM · Band 5.5**",
    # paragraph reference after the question number
    "**Câu 1 (Đoạn A) — Đáp án: ii · Kỹ năng: SKIM · Band 5.5**",
    # word-count segment between answer and skill
    "**Câu 1 — Đáp án: a third · Số từ: 1–2 · Kỹ năng: SCAN · Band 5.5**",
    # band range, and a trailing note after the closing **
    "**Câu 1 — Đáp án: a third · Kỹ năng: SCAN · Band 5.5–6.0**",
    "**Câu 1 — Đáp án: a third · Kỹ năng: SCAN · Band 5.5** ⟵ *câu rung*",
    "**Câu 1 — Đáp án: a third · Kỹ năng: SCAN · Band 5.5 (câu rung chuông)**",
]


@pytest.mark.parametrize("header", _HEADERS)
def test_every_drill_solution_header_dialect_yields_a_rich_solution(header):
    sol = f"""## Giải chi tiết câu 1

{header}
- *Các bước ra đáp án:* (1) Quét đoạn A. (2) Đọc cụm trước đó.
- *Trích đoạn nguồn:* "roughly a third of the world's mangrove cover"
- *Từ vựng:* `cover` = độ che phủ
- *Paraphrase:* was lost ↔ disappeared
- *Phân tích bẫy & kỹ năng:* Đừng điền "roughly a third" (3 từ).
"""
    rich = parse_rich_solutions(sol, _DRILL_SOL_HDR_RE)
    assert set(rich) == {1}, header
    assert rich[1]["band"] == 5.5
    assert rich[1]["skill_code"] in ("SCAN", "SKIM")
    # every field the review page renders must survive
    assert rich[1]["steps"].startswith("(1) Quét đoạn A.")
    assert "mangrove cover" in rich[1]["source_excerpt"]
    assert rich[1]["vocab"] == ["`cover` = độ che phủ"]
    assert rich[1]["paraphrase"] == "was lost ↔ disappeared"
    assert "3 từ" in rich[1]["trap_analysis"]


def test_code_only_header_leaves_skill_name_empty_not_missing_the_block():
    """No Vietnamese name → skill_name is simply absent, block still parsed."""
    sol = ("**Câu 1 — Đáp án: oxygen · Kỹ năng: PARA · Band 6.0**\n"
           "- *Các bước ra đáp án:* (1) Đọc đoạn B.\n")
    rich = parse_rich_solutions(sol, _DRILL_SOL_HDR_RE)
    assert rich[1]["skill_code"] == "PARA"
    assert "skill_name" not in rich[1]
    assert rich[1]["steps"] == "(1) Đọc đoạn B."


def test_drill_questions_carry_the_rich_solution():
    """End-to-end: a code-only header must reach question['solution']."""
    drill = _drill("Table Completion",
                   "| Topic | Detail |\n| --- | --- |\n"
                   "| **Carbon** | The soils hold almost no **1** …………… . |",
                   total_questions=1)
    sol = _solution("| 1 | Table Completion | oxygen | 6.0 | PARA |") + """
## Giải chi tiết câu 1

**Câu 1 — Đáp án: oxygen · Kỹ năng: PARA · Band 6.0**
- *Các bước ra đáp án:* (1) Hàng "Carbon storage" → đoạn B.
- *Trích đoạn nguồn:* "waterlogged soils contain little oxygen"
"""
    _, qs = _one(drill, sol)
    assert qs[0]["solution"]["steps"].startswith('(1) Hàng "Carbon storage"')
    assert "little oxygen" in qs[0]["solution"]["source_excerpt"]


def test_solution_prose_is_emphasis_stripped():
    """reading-review.js renders solution text with formatProse, which escapes
    HTML and does NOT read markdown — `**x**` would show literal asterisks."""
    drill = _drill("Table Completion",
                   "| Topic | Detail |\n| --- | --- |\n"
                   "| **Carbon** | The soils hold almost no **1** …………… . |",
                   total_questions=1)
    sol = _solution("| 1 | Table Completion | oxygen | 6.0 | PARA |") + """
## Giải chi tiết câu 1

**Câu 1 — Đáp án: oxygen · Kỹ năng: PARA · Band 6.0**
- *Các bước ra đáp án:* (1) Đọc đoạn B → điền **oxygen**.
- *Từ vựng:* `waterlogged` = *ngập nước*
- *Phân tích bẫy & kỹ năng:* Đừng để **carbon** đánh lừa.
"""
    _, qs = _one(drill, sol)
    s = qs[0]["solution"]
    assert s["steps"] == "(1) Đọc đoạn B → điền oxygen."
    assert s["trap_analysis"] == "Đừng để carbon đánh lừa."
    # backticks survive — formatProse turns them into <code>
    assert s["vocab"] == ["`waterlogged` = ngập nước"]


def test_full_test_header_regex_is_unchanged_by_the_drill_dialect():
    """The drill regex is opt-in; the default (full-test) one stays strict."""
    code_only = "**Câu 1 — Đáp án: oxygen · Kỹ năng: PARA · Band 6.0**\n" \
                "- *Các bước ra đáp án:* (1) Đọc đoạn B.\n"
    assert parse_rich_solutions(code_only) == {}
    named = "**Câu 1 — Đáp án: oxygen · Kỹ năng: PARA Nhận diện paraphrase · Band 6.0**\n" \
            "- *Các bước ra đáp án:* (1) Đọc đoạn B.\n"
    assert parse_rich_solutions(named)[1]["skill_name"] == "Nhận diện paraphrase"


# ── quick-answer table ────────────────────────────────────────────────

def test_six_column_table_with_accept_column():
    sol = _solution(
        "| 1 | Sentence Completion | X-ray imaging | X-ray | 6.5 | PARA |",
        header="| Q | Type | Answer | Accept | Band | Skill |",
    )
    qa = parse_quick_answers(sol, [])
    assert qa[1]["answer"] == "X-ray imaging"
    assert qa[1]["alternatives"] == ["X-ray"]
    assert qa[1]["band"] == 6.5


def test_matching_headings_qnum_carries_paragraph_letter():
    sol = _solution("| 1 (A) | Matching Headings | ii | 5.5 | SKIM |")
    qa = parse_quick_answers(sol, [])
    assert qa[1]["answer"] == "ii"
    assert qa[1]["para_letter"] == "A"


def test_second_accept_table_does_not_bleed_into_the_first():
    """DL adds an `answer_accept` grid below the quick-answer grid. Flattening
    both into one row list made its answers parse as TYPE labels, dropping every
    real answer while emitting bogus 'unmapped type' warnings."""
    extra = """
**Bảng chấp nhận đáp án (answer / answer_accept):**
| Q | answer | answer_accept (chấp nhận) |
| --- | --- | --- |
| 1 | binaurals | the binaurals |
| 2 | tubing | tube; rubber tubing |
"""
    sol = _solution(
        "| 1 | Diagram Label | binaurals | 6.0 | SCAN |\n"
        "| 2 | Diagram Label | tubing | 5.5 | SCAN |",
        extra=extra,
    )
    warnings: list = []
    qa = parse_quick_answers(sol, warnings)
    assert warnings == []
    assert set(qa) == {1, 2}
    assert qa[1]["question_type"] == "diagram_label_completion"
    # the second table's column is folded in as extra accepted forms
    assert qa[1]["alternatives"] == ["the binaurals"]
    assert qa[2]["alternatives"] == ["tube", "rubber tubing"]


# ── per-type question building ────────────────────────────────────────

def _one(drill: str, sol: str):
    parsed = build_parsed_reading_test_from_drill(drill, sol, published=True)
    assert validate_reading_test(parsed) == []
    return parsed, parsed.passages[0]["questions"]


def test_table_completion_yields_one_gap_and_keeps_row_group():
    drill = _drill(
        "Table Completion",
        "| Topic | Detail |\n"
        "| --- | --- |\n"
        "| **Past losses** | About **1** …………… of cover was lost. |\n"
        "| | Cleared for ponds and **2** …………… . |",
    )
    sol = _solution(
        "| 1 | Table Completion | a third | 5.5 | SCAN |\n"
        "| 2 | Table Completion | rice fields | 5.0 | SCAN |")
    _, qs = _one(drill, sol)
    # exactly one gap: the marker becomes the blank, the dot-leader is dropped
    assert qs[0]["prompt"] == "Past losses — About ________ of cover was lost."
    # a blank row label inherits the previous row's group (rowspan grouping)
    assert qs[1]["prompt"] == "Past losses — Cleared for ponds and ________."
    assert "**" not in qs[0]["prompt"]


def test_notes_completion_builds_flowing_template_and_context_prompts():
    drill = _drill(
        "Note Completion",
        "**Waiting**\n\n"
        "**Section one**\n"
        "- People tend to **1** ____ the length of a wait.\n"
        "- Empty waits make time seem to **2** ____ quickly.\n",
    )
    sol = _solution(
        "| 1 | Note Completion | overstate | 5.5 | SCAN |\n"
        "| 2 | Note Completion | pass | 5.5 | SCAN |")
    _, qs = _one(drill, sol)
    tmpl = qs[0]["template"]["summary_text"]
    assert "{{1}}" in tmpl and "{{2}}" in tmpl
    assert "**" not in tmpl            # renderer emits plain text nodes
    assert "____" not in tmpl
    # the blank-run removal must not strand a space before the full stop
    assert "the length of a wait." in tmpl
    # only the run's FIRST question carries the block
    assert "template" not in qs[1]
    # review-page context: own gap blank, sibling gaps kept identifiable
    assert qs[1]["prompt"] == "Empty waits make time seem to ________ quickly."


def test_summary_completion_marks_sibling_gaps_without_leaking_answers():
    drill = _drill(
        "Summary Completion (no box)",
        "**Summary**\n\n"
        "Banks wanted **(1)** ............... so people used **(2)** ............... instead.",
    )
    sol = _solution(
        "| 1 | Summary Completion (no box) | collateral | 6.5 | LEX |\n"
        "| 2 | Summary Completion (no box) | moneylenders | 5.5 | PARA |")
    _, qs = _one(drill, sol)
    assert qs[0]["prompt"] == "Banks wanted ________ so people used (2) instead."
    assert "collateral" not in qs[1]["prompt"]
    assert qs[1]["prompt"] == "Banks wanted (1) so people used ________ instead."


def test_matching_headings_shares_option_bank_on_every_question():
    drill = _drill(
        "Matching Headings",
        "**List of Headings**\n\n"
        "i. First heading\n"
        "ii. Second *heading*\n"
        "iii. Third heading\n\n"
        "1. Paragraph A\n"
        "2. Paragraph B\n",
    )
    sol = _solution(
        "| 1 (A) | Matching Headings | ii | 5.5 | SKIM |\n"
        "| 2 (B) | Matching Headings | i | 5.5 | SKIM |")
    _, qs = _one(drill, sol)
    assert qs[0]["prompt"] == "Paragraph A"
    assert [o["label"] for o in qs[0]["options"]] == ["i", "ii", "iii"]
    assert qs[0]["options"][1]["text"] == "Second heading"   # emphasis stripped
    assert qs[1]["options"] == qs[0]["options"]


def test_diagram_label_prompt_uses_the_descriptive_hint():
    drill = _drill(
        "Diagram Label",
        "1. ............... (the pair of springy metal tubes)\n"
        "2. ............... (soft rounded part that enters the ear)\n",
    )
    sol = _solution(
        "| 1 | Diagram Label | binaurals | 6.0 | SCAN |\n"
        "| 2 | Diagram Label | eartip | 5.5 | DETAIL |")
    _, qs = _one(drill, sol)
    assert qs[0]["prompt"] == "The pair of springy metal tubes"
    assert not qs[0]["prompt"].startswith("____")


def test_sentence_completion_restores_the_swallowed_full_stop():
    drill = _drill(
        "Sentence Completion",
        "1. They sheltered from a ...........\n"
        "2. Rotating the ........... moved the wheels.\n",
    )
    sol = _solution(
        "| 1 | Sentence Completion | storm | 5.0 | SCAN |\n"
        "| 2 | Sentence Completion | handle | 5.5 | SCAN |")
    _, qs = _one(drill, sol)
    assert qs[0]["prompt"] == "They sheltered from a ________."
    assert qs[1]["prompt"] == "Rotating the ________ moved the wheels."


# ── whole-drill shape ─────────────────────────────────────────────────

def test_image_prompt_block_never_reaches_student_content():
    """`[IMAGE_PROMPT: …]` is an art-generation brief, not exam content."""
    drill = _drill(
        "Table Completion",
        "[IMAGE_PROMPT: a clean black-and-white table titled Foo]\n\n"
        "| Topic | Detail |\n"
        "| --- | --- |\n"
        "| **Row** | Value is **1** …………… . |",
        passage="**A.** Body.\n\n[IMAGE_PROMPT: something illustrative]",
        total_questions=1,
    )
    sol = _solution("| 1 | Table Completion | oxygen | 6.0 | SCAN |")
    parsed, qs = _one(drill, sol)
    assert "IMAGE_PROMPT" not in parsed.passages[0]["body_markdown"]
    assert all("IMAGE_PROMPT" not in q["prompt"] for q in qs)


def test_drill_becomes_a_single_passage_test_with_metadata():
    drill = _drill("True/False/Not Given",
                   "1. First statement.\n2. Second statement.\n")
    sol = _solution(
        "| 1 | True/False/Not Given | TRUE | 5.5 | SCAN |\n"
        "| 2 | True/False/Not Given | NOT GIVEN | 6.5 | SCAN |")
    parsed, qs = _one(drill, sol)
    assert parsed.test_id == "ILR-RDG-DRL-XX-L2-T1"
    assert parsed.content_type == "reading_full_test"
    assert parsed.passage_count == 1 and parsed.total_questions == 2
    assert parsed.band_target == 6.0
    assert parsed.published is True
    assert parsed.passages[0]["translation_vi"].startswith("A. Bản dịch")
    assert qs[1]["answer"] == "NOT GIVEN"   # exact token the exam UI submits
    assert parsed.warnings == []


def test_declared_question_range_rejects_a_missing_middle_answer_row():
    drill = _drill(
        "True/False/Not Given",
        "1. First statement.\n2. Second statement.\n3. Third statement.\n",
    ).replace("## Questions 1–2", "## Questions 1–3")
    sol = _solution(
        "| 1 | True/False/Not Given | TRUE | 5.5 | SCAN |\n"
        "| 3 | True/False/Not Given | FALSE | 5.5 | SCAN |"
    )
    parsed = build_parsed_reading_test_from_drill(drill, sol, published=True)
    assert parsed.total_questions == 3
    errors = validate_reading_test(parsed)
    assert any("Tổng số câu hỏi (2)" in e["message"] for e in errors)
    assert any("q_num phải liên tục" in e["message"] for e in errors)


def test_commit_imports_valid_units_but_returns_failure_for_any_skipped_unit(monkeypatch):
    parsed_by_type = {
        "BAD": SimpleNamespace(test_id="BAD"),
        "GOOD": SimpleNamespace(test_id="GOOD"),
    }
    imported: list[str] = []

    monkeypatch.setattr(
        import_script,
        "_parse",
        lambda _base, drill_type, published=True: parsed_by_type[drill_type],
    )
    monkeypatch.setattr(
        import_script,
        "validate_reading_test",
        lambda parsed: [{"field": "questions", "message": "missing"}]
        if parsed.test_id == "BAD" else [],
    )

    async def fake_commit(parsed, **_kwargs):
        imported.append(parsed.test_id)
        return {"committed_id": None, "action": "inserted", "validation_errors": []}

    monkeypatch.setitem(
        sys.modules,
        "routers.admin_reading",
        SimpleNamespace(_commit_l3_parsed=fake_commit),
    )

    status = asyncio.run(import_script.commit(Path("/unused"), ["BAD", "GOOD"]))
    assert status == 1
    assert imported == ["GOOD"]
