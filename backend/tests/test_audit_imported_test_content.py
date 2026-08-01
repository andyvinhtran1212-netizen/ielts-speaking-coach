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


def test_junk_items_clean_template_is_empty():
    tpl = {"groups": [{"heading": "Benefits", "items": [
        {"q_num": 1, "prefix": "", "suffix": "provided for all staff"},
        {"text": "must be prepared to work well in a team"},
    ]}]}
    assert junk_items(tpl) == []
