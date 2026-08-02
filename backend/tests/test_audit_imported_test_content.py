"""Bộ soát nội dung đề nhập: các phép tự-kiểm phải bắt đúng thứ đã lọt lưới.

Bối cảnh (đợt kiểm 01/08/2026): bộ chuyển đổi Cambridge làm hỏng 961 chỗ trên
70/72 đề mà không có tín hiệu nào báo động — đề vẫn published, vẫn chấm được.
Bộ soát fidelity (so với đề gốc) báo XANH suốt trong khi 16 câu KHÔNG THỂ TRẢ
LỜI: 11 câu trắc nghiệm không có lựa chọn A/B/C nào và 5 câu flow-chart rỗng cả
đề bài. Bài học được ghim ở đây: "khớp nguồn" và "trả lời được" là HAI phép
kiểm khác nhau, và phép thứ hai mới là phép chặn người học.

Chỉ test các hàm thuần — phần chạm Supabase không thuộc phạm vi unit test.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.audit_imported_test_content import (  # noqa: E402
    LIMIT_KINDS,
    LIMIT_RE,
    PDF_VERIFIED_LIMITS,
    READING_NEED_OPTIONS,
    TEMPLATE_KINDS,
    has_choices,
    has_visual,
    junk_items,
    limit_for,
    source_limits,
    template_has,
)


# ── đọc giới hạn từ trong đề gốc ────────────────────────────────────────────
def test_source_limits_reads_each_block_own_limit(tmp_path: Path):
    """Mỗi khối có giới hạn RIÊNG; gộp chung là gốc của lỗi 367 câu."""
    md = tmp_path / "cambridge_ielts_18_test_2_listening.md"
    md.write_text(
        "### Questions 1-5\n\n"
        "Complete the notes below.\n"
        "Write ONE WORD ONLY for each answer.\n\n"
        "### Questions 6-10\n\n"
        "Complete the table below.\n"
        "Write ONE WORD AND/OR A NUMBER for each answer.\n"
    )
    got = source_limits(md)
    assert got == {(1, 5): "ONE WORD ONLY", (6, 10): "ONE WORD AND/OR A NUMBER"}


def test_source_limits_ignores_limit_deep_inside_a_block(tmp_path: Path):
    """Chỉ đọc phần HƯỚNG DẪN (mấy dòng đầu). Một câu hỏi nhắc lại cụm giới hạn
    ở giữa thân khối không được ghi đè giới hạn thật."""
    md = tmp_path / "x.md"
    md.write_text(
        "### Questions 1-5\n\n"
        "Complete the notes below.\n"
        "Write ONE WORD ONLY for each answer.\n"
        + "\n".join(f"{i} filler line" for i in range(1, 12))
        + "\nNO MORE THAN THREE WORDS mentioned in passing\n"
    )
    assert source_limits(md) == {(1, 5): "ONE WORD ONLY"}


def test_source_limits_missing_file_is_empty_not_a_crash(tmp_path: Path):
    assert source_limits(tmp_path / "khong-ton-tai.md") == {}


def test_limit_for_maps_question_into_its_block():
    table = {(1, 8): "NO MORE THAN TWO WORDS", (34, 40): "ONE WORD ONLY"}
    assert limit_for(1, table) == "NO MORE THAN TWO WORDS"
    assert limit_for(8, table) == "NO MORE THAN TWO WORDS"
    assert limit_for(34, table) == "ONE WORD ONLY"
    assert limit_for(20, table) is None          # câu ngoài mọi khối


# ── "trả lời được" — phép kiểm đã bỏ sót ────────────────────────────────────
def test_template_has_finds_a_question_at_any_depth():
    """Câu điền chữ được phép KHÔNG có prompt, miễn template có dòng cho nó —
    nên phép dò phải xuyên hết mọi tầng lồng nhau, không chỉ tầng một."""
    tpl = {"groups": [
        {"heading": "Benefits", "items": [
            {"q_num": 1, "prefix": "", "suffix": "provided for all staff"},
            {"text": "must be prepared to work well in a team"},
        ]},
    ]}
    assert template_has(tpl, 1) is True
    assert template_has(tpl, 2) is False


def test_template_has_walks_table_rows():
    """Bảng lồng list-trong-list — dạng table_completion dùng shape này."""
    tpl = {"rows": [[{"q_num": 6, "suffix": "Street"}, "Breakfast supervisor"]]}
    assert template_has(tpl, 6) is True
    assert template_has(tpl, 7) is False


def test_template_has_tolerates_none_and_scalars():
    assert template_has(None, 1) is False
    assert template_has("not a template", 1) is False


# ── rác lọt vào template ────────────────────────────────────────────────────
def test_junk_items_flags_fake_blanks_and_page_numbers():
    """Ô trống GIẢ ('6 ____ Street' dưới dạng chữ) và số trang lọt từ OCR —
    học viên thấy ô trống nhưng không gõ được vào đó."""
    tpl = {"groups": [{"heading": "x", "items": [
        {"text": "6 ________ Street Breakfast supervisor"},
        {"text": "38"},                                   # số trang
        {"text": "Maintaining stock | 10 . once a month"},
        {"text": "The wearer could use the pockets for small items."},
        {"q_num": 33, "prefix": "A", "suffix": "sewed pockets"},
    ]}]}
    junk = junk_items(tpl)
    assert len(junk) == 3
    assert any("Street" in j for j in junk)
    assert "38" in junk
    # dòng ngữ cảnh hợp lệ và item có q_num KHÔNG được coi là rác
    assert not any("The wearer" in j for j in junk)


# ── phản hồi review PR #892 (Codex) ─────────────────────────────────────────
def test_limit_re_accepts_every_real_wording_including_ocr_damage():
    """Mẫu chuẩn của repo dùng "ONE WORD OR A NUMBER"; OCR hay biến dấu gạch
    chéo thành chữ I ("ANDIOR"). Bỏ sót một biến thể là khối đó biến mất khỏi
    phép soát mà không ai biết."""
    for phrase, want in [
        ("Write ONE WORD ONLY for each answer.", "ONE WORD ONLY"),
        ("Write ONE WORD OR A NUMBER for each answer.", "ONE WORD OR A NUMBER"),
        ("Write ONE WORD AND/OR A NUMBER for each answer.", "ONE WORD AND/OR A NUMBER"),
        ("Write ONE WORD ANDIOR A NUMBER for each answer.", "ONE WORD ANDIOR A NUMBER"),
        ("Choose NO MORE THAN TWO WORDS from the passage.", "NO MORE THAN TWO WORDS"),
        ("Write NO MORE THAN THREE WORDS AND/OR A NUMBER.",
         "NO MORE THAN THREE WORDS AND/OR A NUMBER"),
    ]:
        m = LIMIT_RE.search(phrase)
        assert m, f"không nhận ra: {phrase}"
        assert m.group(1).upper() == want.upper(), phrase


def test_limit_re_accepts_bare_one_word():
    """"Write ONE WORD for each answer." (không "ONLY") là cách viết THẬT —
    Cambridge 17 Test 4 Part 1, kiểm ở 700dpi, và 10/10 đáp án đều một từ không
    số. Bỏ sót nó thì cả đề đó biến mất khỏi phép soát."""
    m = LIMIT_RE.search("Write ONE WORD for each answer.")
    assert m and m.group(1).upper() == "ONE WORD"


def test_limit_re_never_stops_at_the_short_prefix():
    """"ONE WORD" đứng một mình KHÔNG phải giới hạn hợp lệ. Nếu cho nó khớp,
    "ONE WORD ANDIOR A NUMBER" sẽ khớp mẩu đầu và sinh lệch giả."""
    m = LIMIT_RE.search("Write ONE WORD ANDIOR A NUMBER for each answer.")
    assert m.group(1).upper() != "ONE WORD"


def test_source_limits_parses_every_heading_dialect(tmp_path):
    """Bộ Cambridge không đồng nhất: quyển 13-14 dùng "Section", 17-21 dùng
    "PART", 20-21 dùng "and". Bản đầu chỉ đọc được một dạng nên 11 đề âm thầm
    không được đối chiếu gì cả."""
    md = tmp_path / "x.md"
    md.write_text(
        "## Section 1 Questions 1-10\n\nWrite ONE WORD AND/OR A NUMBER for each answer.\n\n"
        "## PART 2 Questions 11-20\n\nWrite ONE WORD ONLY for each answer.\n\n"
        "### Questions 19 and 20\n\nWrite NO MORE THAN TWO WORDS for each answer.\n"
    )
    got = source_limits(md)
    assert (1, 10) in got and (11, 20) in got and (19, 20) in got


def test_limit_for_prefers_the_narrowest_enclosing_block():
    """Đầu mục lồng nhau: khối con phải thắng khối cha, nếu không câu 19-20 sẽ
    thừa hưởng giới hạn của cả PART 2."""
    table = {(11, 20): "ONE WORD ONLY", (19, 20): "NO MORE THAN TWO WORDS"}
    assert limit_for(15, table) == "ONE WORD ONLY"
    assert limit_for(19, table) == "NO MORE THAN TWO WORDS"


def test_flow_chart_completion_is_a_known_template_kind():
    """listening_convert.py phát ra CẢ hai tên; thiếu tên dài thì flow-chart
    hợp lệ bị báo oan là "không có đề bài"."""
    assert {"flow_chart", "flow_chart_completion"} <= TEMPLATE_KINDS


def test_has_choices_knows_where_each_kind_keeps_its_bank():
    """Mỗi dạng cất lựa chọn một chỗ (tra trong listening-test-player.js).
    Dò sai chỗ thì vừa bỏ lọt câu hỏng vừa đánh trượt câu lành."""
    # bản đồ: lựa chọn ở metadata.letter_options, câu không cần options riêng
    assert has_choices("plan_label", {"metadata": {"letter_options": list("ABCDEFGH")}}, {})
    assert not has_choices("plan_label", {"metadata": {}}, {})
    # chọn-nhiều và matching: dùng chung metadata.match_options
    assert has_choices("mcq_multi", {"metadata": {"match_options": [{"letter": "A"}]}}, {})
    assert not has_choices("mcq_multi", {"metadata": {"match_options": []}}, {})
    assert has_choices("matching", {"metadata": {"match_options": [{"letter": "A"}]}}, {})
    # trắc nghiệm 3 lựa chọn: options nằm ở TỪNG câu
    assert has_choices("mcq_3option", {}, {"options": [{"letter": "A"}]})
    assert not has_choices("mcq_3option", {}, {"options": []})


def test_matching_information_does_not_require_an_authored_bank():
    """Chữ cái của dạng này là NHÃN ĐOẠN VĂN của chính bài đọc, không phải bank
    do tác giả soạn — đòi payload.options ở đây là báo oan hàng chục câu lành."""
    assert "matching_information" not in READING_NEED_OPTIONS
    assert {"mcq_single", "matching_headings"} <= READING_NEED_OPTIONS


# ── phản hồi review PR #892 vòng 2 (Codex) ──────────────────────────────────
def test_shared_bank_kinds_ignore_per_question_options():
    """renderMultiSelect/renderMatching KHÔNG đọc options của từng câu. Coi nó
    là bằng chứng "có lựa chọn" sẽ che mất khối đã mất bank."""
    q_with_opts = {"options": [{"letter": "A"}]}
    assert not has_choices("mcq_multi", {"metadata": {}}, q_with_opts)
    assert not has_choices("matching", {"metadata": {}}, q_with_opts)
    # còn dạng MCQ thường thì options của từng câu MỚI là nguồn đúng
    assert has_choices("mcq_3option", {"metadata": {}}, q_with_opts)


def test_matching_needs_the_bank_text_not_just_letters():
    """letter_options chỉ đổ chữ cái vào dropdown; phần chữ giải nghĩa dựng
    riêng từ match_options. Có chữ cái mà mất bank thì học viên không biết
    A/B/C nghĩa là gì."""
    only_letters = {"metadata": {"letter_options": list("ABCDEFG")}}
    assert not has_choices("matching", only_letters, {})
    assert has_choices("matching", {"metadata": {"match_options": [{"letter": "A"}]}}, {})


def test_plan_label_needs_a_visual():
    """Đủ đề bài và đủ chữ cái vẫn vô nghĩa nếu không có hình để nhìn."""
    assert has_visual({"map_image_storage_path": "tests/x.png"})
    assert has_visual({"map_svg": "<svg/>"})
    assert not has_visual({"metadata": {"letter_options": list("ABCDEFGH")}})


def test_template_has_recognises_summary_gap_tokens():
    """summary_completion cất khoảng trống dạng "{{Q38}}" trong
    template.paragraph và để prompt rỗng — chỉ dò dict-có-q_num thì summary
    lành bị báo oan là "không có đề bài"."""
    tpl = {"paragraph": "Pockets were made using {{Q38}} to link them."}
    assert template_has(tpl, 38) is True
    assert template_has(tpl, 39) is False
    assert template_has({"paragraph": "gap {{39}} here"}, 39) is True


def test_short_answer_blocks_carry_a_word_limit():
    """Khối "Answer the questions" cũng mang giới hạn từ ⇒ phải vào phép L1."""
    assert "short_answer" in LIMIT_KINDS
    assert TEMPLATE_KINDS <= LIMIT_KINDS


def test_pdf_verified_limits_are_expectations_not_waivers():
    """Giá trị đọc từ PDF phải là CHUẨN SO SÁNH, không phải danh sách miễn kiểm.
    Nếu chỉ miễn kiểm theo mã đề thì một lần re-import làm hỏng đúng khối ấy sẽ
    im lặng luôn."""
    assert ("ILR-LIS-CAM-B20-T1", 31) in PDF_VERIFIED_LIMITS
    assert PDF_VERIFIED_LIMITS[("ILR-LIS-CAM-B20-T1", 31)] == "ONE WORD ONLY"
    # khoá là (mã đề, câu đầu của khối) — không phải chỉ mã đề
    assert all(isinstance(k, tuple) and len(k) == 2 for k in PDF_VERIFIED_LIMITS)


def test_junk_items_clean_template_is_empty():
    tpl = {"groups": [{"heading": "Benefits", "items": [
        {"q_num": 1, "prefix": "", "suffix": "provided for all staff"},
        {"text": "must be prepared to work well in a team"},
    ]}]}
    assert junk_items(tpl) == []
