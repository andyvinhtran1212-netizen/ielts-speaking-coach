"""Regression coverage for Grammar Markdown list spacing."""
from __future__ import annotations

import re
import sys
from pathlib import Path

import markdown

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grammar_content import (  # noqa: E402
    _MD_EXTENSIONS,
    _insert_blank_lines_before_lists,
    grammar_service,
)


def _render(text: str) -> str:
    prepared = _insert_blank_lines_before_lists(text)
    return markdown.Markdown(extensions=_MD_EXTENSIONS).convert(prepared)


def test_prose_followed_by_bullets_renders_as_a_list():
    html = _render("Hậu quả là:\n- a\n- b")

    assert html == "<p>Hậu quả là:</p>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>"


def test_asterisk_and_ordered_lists_are_also_separated_from_prose():
    assert "<ul>\n<li>a</li>\n</ul>" in _render("Hậu quả là:\n* a")
    assert "<ol>\n<li>a</li>\n</ol>" in _render("Các bước:\n1. a")


def test_bullet_like_code_fence_content_is_unchanged():
    source = "Ví dụ:\n```text\nDòng mã\n- x\n```"

    assert _insert_blank_lines_before_lists(source) == source
    html = _render(source)
    assert "<ul>" not in html
    assert "Dòng mã\n- x" in html


def test_nested_lists_tables_and_blockquotes_keep_their_structure():
    source = (
        "Giới thiệu:\n"
        "- mục cha\n"
        "    - mục con\n"
        "- mục ngang hàng\n\n"
        "> Ghi chú:\n"
        "> - mục trích dẫn\n\n"
        "| Cột A | Cột B |\n"
        "| --- | --- |\n"
        "| a | b |"
    )
    expected = source.replace("Giới thiệu:\n- mục cha", "Giới thiệu:\n\n- mục cha")

    assert _insert_blank_lines_before_lists(source) == expected


def test_parts_of_speech_importance_section_renders_bullets():
    html = grammar_service.articles_by_slug["parts-of-speech"]["html"]
    section_match = re.search(
        r'<h2[^>]*>Tại sao quan trọng</h2>(.*?)(?=<h2\b)',
        html,
        re.DOTALL,
    )

    assert section_match is not None
    section = section_match.group(1)
    assert re.search(r"<p>.*Hậu quả là:</p>\s*<ul>", section, re.DOTALL)
    assert section.count("<li>") == 3
