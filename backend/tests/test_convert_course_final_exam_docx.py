"""Parsing tests for the Course final .docx → assessment JSON converter.

The fixtures rebuild the real paper/key layout (Heading 1 parts followed by a
range line, Heading 2 passages, bold ``Câu NNN`` / ``A.`` labels, a bold
``Ngữ cảnh`` passage label, the quick-key table and the detailed key with
``Nguồn x.y.zz``) without committing the exam content itself.
"""

from __future__ import annotations

import copy

import docx
import pytest

from scripts.convert_course_final_exam_docx import build_rows, main, parse_paper, read_docx
from services.course_assessment_import import normalize_assessment_rows

PASSAGES = [
    # (passage lines as (bold label, text)), questions as (stem, options, key)
    ([("", "We travel in July.")], [
        ("In July cung cấp loại thông tin nào?",
         ["Phương tiện.", "Người đi cùng.", "Tháng đi.", "Giờ đi.", "Nơi đến."], "C"),
        ("Đổi July thành Monday thì dùng giới từ nào?",
         ["On Monday.", "Into Monday.", "By Monday.", "Under Monday.", "At Monday."], "A"),
    ]),
    ([("Ngữ cảnh", "We visited a museum."), ("", "The museum was quiet.")], [
        ("The museum chỉ bảo tàng nào?",
         ["Bảo tàng mai mở.", "Bảo tàng vừa nhắc.", "Mọi bảo tàng.",
          "Bảo tàng khác.", "Không bảo tàng nào."], "B"),
        ("The dùng vì sao?",
         ["Số nhiều.", "Tên riêng.", "Đã xác định.", "Không đếm được.", "Lần đầu nhắc."],
         "C"),
    ]),
]
SOURCES = ["6.2.02", "17.4.10"]


def _para(document, labelled, style=None):
    paragraph = document.add_paragraph(style=style)
    label, text = labelled
    if label:
        paragraph.add_run(f"{label} ").bold = True
    paragraph.add_run(text)


def _write_paper(path, passages=PASSAGES):
    document = docx.Document()
    document.add_paragraph("Kiểm tra tổng kết", style="Title")
    _para(document, ("", "Chọn một đáp án phù hợp nhất A, B, C, D hoặc E."))
    number = 0
    for p_index, (lines, questions) in enumerate(passages, start=1):
        if p_index == 1:
            document.add_paragraph("Phần 1", style="Heading 1")
            _para(document, ("", "Ngữ liệu 001 đến 001"))
        if p_index == 2:
            document.add_paragraph("Phần 2", style="Heading 1")
            _para(document, ("", "Ngữ liệu 002 đến 002"))
        document.add_paragraph(f"Ngữ liệu {p_index:03d}", style="Heading 2")
        for label, text in lines:
            paragraph = document.add_paragraph()
            if label:
                paragraph.add_run(f"{label} ").bold = True
            paragraph.add_run(text).italic = True
        for stem, options, _key in questions:
            number += 1
            _para(document, (f"Câu {number:03d}", stem))
            for letter, option in zip("ABCDE", options):
                _para(document, (f"{letter}.", option))
    document.save(path)


def _write_key(path, passages=PASSAGES, quick_override=None, detail_override=None,
               duplicate_source=None, translation_override=None):
    quick_override = quick_override or {}
    detail_override = detail_override or {}
    translation_override = translation_override or {}
    document = docx.Document()
    document.add_paragraph("Đáp án và giải thích", style="Title")
    document.add_paragraph("Bảng đáp án nhanh", style="Heading 1")
    answers = [key for _lines, questions in passages for *_rest, key in questions]
    table = document.add_table(rows=1 + len(answers), cols=2)
    table.cell(0, 0).text, table.cell(0, 1).text = "Câu", "Đáp án"
    for row, key in enumerate(answers, start=1):
        table.cell(row, 0).text = f"{row:03d}"
        table.cell(row, 1).text = quick_override.get(row, key)
    document.add_paragraph("Đáp án chi tiết theo ngữ liệu", style="Heading 1")
    number = 0
    for p_index, (_lines, questions) in enumerate(passages, start=1):
        document.add_paragraph(
            f"Ngữ liệu {p_index:03d}  Nguồn {SOURCES[p_index - 1]}", style="Heading 2")
        _para(document, ("Dịch tham khảo",
                         translation_override.get(p_index, f"Bản dịch {p_index}.")))
        for _stem, options, key in questions:
            number += 1
            letter, text = detail_override.get(number, (key, options["ABCDE".index(key)]))
            _para(document, (f"Câu {number:03d}  {letter}  Đáp án", text))
            _para(document, ("Giải thích", f"Lý do câu {number}."))
        _para(document, ("Chấp nhận thêm khi tự luận", "Chỉ cho bản tự luận."))
    if duplicate_source is not None:
        document.add_paragraph(
            f"Ngữ liệu 001 Nguồn {duplicate_source}", style="Heading 2")
    document.save(path)


def _build(tmp_path, *, passages=PASSAGES, key_kwargs=None, **options):
    paper, key = tmp_path / "a.docx", tmp_path / "b.docx"
    _write_paper(paper, passages)
    _write_key(key, passages, **(key_kwargs or {}))
    paper_paras, paper_tables = read_docx(paper)
    key_paras, key_tables = read_docx(key)
    return build_rows(paper_paras, paper_tables, key_paras, key_tables,
                      id_prefix="C1-FINAL", expected_questions=4,
                      expected_passages=2, **options)


def test_maps_the_real_layout_into_rows_with_passage_key_and_explanation(tmp_path):
    rows, errors, report = _build(tmp_path)
    assert errors == []
    assert [row["id"] for row in rows] == [f"C1-FINAL-Q00{n}" for n in range(1, 5)]
    first, third = rows[0], rows[2]
    assert first["de"] == ("Ngữ liệu 001\nWe travel in July.\n\n"
                           "In July cung cấp loại thông tin nào?")
    assert third["de"].startswith(
        "Ngữ liệu 002\nNgữ cảnh: We visited a museum.\nThe museum was quiet.\n\n")
    assert first["dap_an"] == 2 and first["dap_an_chu"] == "C"
    assert first["pa"][2] == "Tháng đi."
    assert first["giai_thich"] == "Lý do câu 1.\nDịch tham khảo: Bản dịch 1."
    assert "Chỉ cho bản tự luận" not in rows[1]["giai_thich"]
    assert (first["lesson_primary"], third["lesson_primary"]) == ("B06", "B17")
    assert (third["truc"], third["diem_day"]) == ("Buổi 17", "Nguồn 17.4.10")
    assert [row["phan"] for row in rows] == [1, 1, 2, 2]
    assert report["by_part"] == {1: 2, 2: 2}


def test_flags_quick_key_disagreeing_with_the_detailed_key(tmp_path):
    rows, errors, _ = _build(tmp_path, key_kwargs={"quick_override": {2: "E"}})
    assert errors == ["câu 002: bảng nhanh E ≠ đáp án chi tiết A"]
    assert [row["id"] for row in rows] == ["C1-FINAL-Q001", "C1-FINAL-Q003", "C1-FINAL-Q004"]


def test_flags_answer_text_that_is_not_the_keyed_option(tmp_path):
    _, errors, _ = _build(tmp_path, key_kwargs={"detail_override": {3: ("B", "Mọi bảo tàng.")}})
    assert len(errors) == 1 and errors[0].startswith("câu 003: phương án B trong đề")


def _assert_cli_rejects(tmp_path, monkeypatch, capsys, expected_error):
    output = tmp_path / "final.json"
    monkeypatch.setattr("sys.argv", [
        "convert_course_final_exam_docx", "--paper", str(tmp_path / "a.docx"),
        "--key", str(tmp_path / "b.docx"), "--out", str(output),
        "--id-prefix", "C1-FINAL", "--expected-count", "4",
        "--expected-passages", "2", "--dang", "A1",
        "--generic-wrong-reason", "--confirm-classroom-alignment",
    ])
    assert main() == 1
    assert expected_error in capsys.readouterr().err
    assert not output.exists()


@pytest.mark.parametrize("source", [SOURCES[0], "19.1.01"])
def test_rejects_duplicate_detailed_passage_without_overwriting_source(
        tmp_path, monkeypatch, capsys, source):
    rows, errors, _ = _build(tmp_path, key_kwargs={"duplicate_source": source})
    expected_error = "đáp án: ngữ liệu 001 xuất hiện hai lần"
    assert errors == [expected_error]
    assert [row["lesson_primary"] for row in rows[:2]] == ["B06", "B06"]
    _assert_cli_rejects(tmp_path, monkeypatch, capsys, expected_error)


@pytest.mark.parametrize("translation", ["", " \t\u00a0 "])
def test_rejects_label_only_reference_translation(
        tmp_path, monkeypatch, capsys, translation):
    _, errors, _ = _build(
        tmp_path, key_kwargs={"translation_override": {1: translation}})
    expected_error = "đáp án: ngữ liệu 001 thiếu Dịch tham khảo"
    assert expected_error in errors
    _assert_cli_rejects(tmp_path, monkeypatch, capsys, expected_error)


def test_flags_a_question_without_five_options_and_a_numbering_gap(tmp_path):
    broken = copy.deepcopy(PASSAGES)
    stem, options, key = broken[1][1][1]
    broken[1][1][1] = (stem, options[:4], key)
    _, errors, _ = _build(tmp_path, passages=broken)
    assert "câu 004 có 4 phương án, cần 5" in errors

    _, errors, _ = _build(tmp_path, passages=PASSAGES)
    assert errors == []
    paper_paras, paper_tables = read_docx(tmp_path / "a.docx")
    key_paras, key_tables = read_docx(tmp_path / "b.docx")
    _, errors, _ = build_rows(paper_paras, paper_tables, key_paras, key_tables,
                              id_prefix="C1-FINAL", expected_questions=5,
                              expected_passages=2)
    assert "đề: câu thiếu 005" in errors


def test_default_output_is_refused_by_the_importer_until_reviewed_fields_exist(tmp_path):
    rows, errors, _ = _build(tmp_path)
    assert errors == []
    assert not {"dang", "bay", "ma_bay", "classroom_alignment"} & set(rows[0])
    with pytest.raises(ValueError, match="thiếu mã dạng"):
        normalize_assessment_rows(rows, expected_count=4, scope="B01-B20")

    rows, errors, _ = _build(tmp_path, dang="A1", generic_wrong_reason=True,
                             confirm_alignment=True)
    assert errors == []
    mapped = normalize_assessment_rows(rows, expected_count=4, scope="B01-B20")
    assert set(mapped[0]["why_wrong"]) == {"0", "1", "3", "4"}
    assert rows[0]["ma_bay"][2] == "" and len(set(rows[0]["ma_bay"])) == 5


def _numbering_documents(tmp_path):
    rows, errors, _ = _build(tmp_path, passages=PASSAGES)
    assert errors == []
    return rows, docx.Document(tmp_path / "a.docx"), docx.Document(tmp_path / "b.docx")


def _rebuild_numbering_documents(tmp_path, paper, key):
    paper.save(tmp_path / "a.docx")
    key.save(tmp_path / "b.docx")
    paper_paras, paper_tables = read_docx(tmp_path / "a.docx")
    key_paras, key_tables = read_docx(tmp_path / "b.docx")
    return build_rows(paper_paras, paper_tables, key_paras, key_tables,
                      id_prefix="C1-FINAL", expected_questions=4,
                      expected_passages=2)


def _question_paragraphs(paper, number):
    paragraphs = paper.paragraphs
    start = next(i for i, paragraph in enumerate(paragraphs)
                 if paragraph.text.startswith(f"Câu {number:03d} "))
    return paragraphs[start:start + 6]  # Question stem followed by options A–E.


@pytest.fixture
def _duplicate_middle_question_rows(tmp_path):
    baseline, paper, key = _numbering_documents(tmp_path)
    next_part = next(p for p in paper.paragraphs if p.text == "Phần 2")
    _stem, options, _answer = PASSAGES[0][1][1]
    duplicate = [("Câu 002", "Nội dung câu trùng không được thay câu gốc.")]
    duplicate.extend((f"{letter}.", option) for letter, option in zip("ABCDE", options))
    for labelled in duplicate:
        _para(paper, labelled)
        next_part._p.addprevious(paper.paragraphs[-1]._p)

    rows, errors, _ = _rebuild_numbering_documents(tmp_path, paper, key)
    return baseline, rows, errors


def test_rejects_duplicate_middle_question(
        tmp_path, monkeypatch, capsys, _duplicate_middle_question_rows):
    baseline, rows, errors = _duplicate_middle_question_rows
    expected_error = "đề: câu 002 xuất hiện hai lần"
    assert errors == [expected_error]
    _assert_cli_rejects(tmp_path, monkeypatch, capsys, expected_error)
    assert [row["id"] for row in rows] == [row["id"] for row in baseline]


def test_duplicate_middle_question_preserves_original_row(_duplicate_middle_question_rows):
    baseline, rows, _ = _duplicate_middle_question_rows
    assert rows[1] == baseline[1]


def test_duplicate_passage_heading_keeps_the_first_passage(tmp_path, monkeypatch, capsys):
    baseline, paper, key = _numbering_documents(tmp_path)
    # A second "Ngữ liệu 001" block in Phần 2 must not replace passage 001's text or part.
    paper.add_paragraph("Ngữ liệu 001", style="Heading 2")
    paper.add_paragraph().add_run("Đoạn trùng không được thay ngữ liệu gốc.").italic = True

    rows, errors, _ = _rebuild_numbering_documents(tmp_path, paper, key)

    expected_error = "đề: ngữ liệu 001 xuất hiện hai lần"
    assert errors == [expected_error]
    assert rows == baseline
    passages, questions = parse_paper(read_docx(tmp_path / "a.docx")[0], [])
    assert (passages[1].lines, passages[1].part) == (["We travel in July."], 1)
    assert [(questions[n].passage, questions[n].part) for n in (1, 2)] == [(1, 1), (1, 1)]
    _assert_cli_rejects(tmp_path, monkeypatch, capsys, expected_error)


def test_flags_a_missing_middle_question_with_unchanged_expected_count(tmp_path):
    baseline, paper, key = _numbering_documents(tmp_path)
    for paragraph in _question_paragraphs(paper, 2):
        paragraph._p.getparent().remove(paragraph._p)

    rows, errors, report = _rebuild_numbering_documents(tmp_path, paper, key)

    assert errors == ["đề: câu thiếu 002"]
    assert rows == [row for row in baseline if row["id"] != "C1-FINAL-Q002"]
    assert report["questions"] == 3
    assert report["quick_key"] == report["detailed_key"] == 4


def test_checks_question_order_within_a_passage(tmp_path, monkeypatch, capsys):
    baseline, paper, key = _numbering_documents(tmp_path)
    second = _question_paragraphs(paper, 2)[0]
    for paragraph in _question_paragraphs(paper, 3):
        second._p.addprevious(paragraph._p)

    _, errors, _ = _rebuild_numbering_documents(tmp_path, paper, key)

    # 003 before 002 under one heading violates the two-questions-per-passage rule.
    expected_error = "câu 003 nằm ở ngữ liệu 001, không theo thứ tự 2 câu/ngữ liệu"
    assert errors == [expected_error,
                      "câu 003: đề ở ngữ liệu 001, đáp án ở ngữ liệu 002"]
    _assert_cli_rejects(tmp_path, monkeypatch, capsys, expected_error)

    # Reordering each passage's own pair is accepted without shifting any mapping.
    _, paper, key = _numbering_documents(tmp_path)
    for first_number, second_number in ((1, 2), (3, 4)):
        first = _question_paragraphs(paper, first_number)[0]
        for paragraph in _question_paragraphs(paper, second_number):
            first._p.addprevious(paragraph._p)
    rows, errors, report = _rebuild_numbering_documents(tmp_path, paper, key)

    assert errors == []
    assert rows == baseline
    assert [(row["ngu_lieu"], row["phan"]) for row in rows] == [
        (1, 1), (1, 1), (2, 2), (2, 2)]
    quick_answers = [row.cells[1].text for row in key.tables[0].rows[1:]]
    assert [row["dap_an_chu"] for row in rows] == quick_answers
    assert [row["dap_an"] for row in rows] == ["ABCDE".index(a) for a in quick_answers]
    assert report["by_part"] == {1: 2, 2: 2}


def test_flags_question_under_the_wrong_passage_heading(tmp_path, monkeypatch, capsys):
    _, paper, key = _numbering_documents(tmp_path)
    next_part = next(p for p in paper.paragraphs if p.text == "Phần 2")
    for paragraph in _question_paragraphs(paper, 3):
        next_part._p.addprevious(paragraph._p)

    _, errors, report = _rebuild_numbering_documents(tmp_path, paper, key)

    expected_error = "câu 003 nằm ở ngữ liệu 001, không theo thứ tự 2 câu/ngữ liệu"
    assert errors == [expected_error,
                      "câu 003: đề ở ngữ liệu 001, đáp án ở ngữ liệu 002"]
    assert report["questions"] == report["quick_key"] == report["detailed_key"] == 4
    assert report["passages"] == 2
    _assert_cli_rejects(tmp_path, monkeypatch, capsys, expected_error)


def test_flags_duplicate_middle_question_in_the_quick_key(tmp_path, monkeypatch, capsys):
    baseline, paper, key = _numbering_documents(tmp_path)
    second = key.tables[0].rows[2]._tr
    second.addnext(copy.deepcopy(second))

    rows, errors, _ = _rebuild_numbering_documents(tmp_path, paper, key)

    expected_error = "bảng nhanh: câu 002 xuất hiện hai lần"
    assert errors == [expected_error]
    assert rows == baseline
    _assert_cli_rejects(tmp_path, monkeypatch, capsys, expected_error)


def test_duplicate_detailed_key_question_keeps_the_first_answer(tmp_path, monkeypatch, capsys):
    baseline, paper, key = _numbering_documents(tmp_path)
    previous = next(p for p in key.paragraphs if p.text == "Giải thích Lý do câu 2.")
    for labelled in [
        ("Câu 002  E  Đáp án", "Đáp án trùng không được thay đáp án gốc."),
        ("Giải thích", "Giải thích trùng không được thay giải thích gốc."),
    ]:
        _para(key, labelled)
        duplicate = key.paragraphs[-1]
        previous._p.addnext(duplicate._p)
        previous = duplicate

    rows, errors, _ = _rebuild_numbering_documents(tmp_path, paper, key)

    expected_error = "đáp án: câu 002 xuất hiện hai lần"
    assert errors == [expected_error]
    assert rows == baseline
    _assert_cli_rejects(tmp_path, monkeypatch, capsys, expected_error)


def test_duplicate_quick_key_with_a_different_letter_keeps_the_first(
        tmp_path, monkeypatch, capsys):
    baseline, paper, key = _numbering_documents(tmp_path)
    table = key.tables[0]
    duplicate = table.add_row()
    duplicate.cells[0].text, duplicate.cells[1].text = "002", "E"
    table.rows[2]._tr.addnext(duplicate._tr)

    rows, errors, _ = _rebuild_numbering_documents(tmp_path, paper, key)

    expected_error = "bảng nhanh: câu 002 xuất hiện hai lần"
    assert errors == [expected_error]
    assert rows == baseline
    _assert_cli_rejects(tmp_path, monkeypatch, capsys, expected_error)
