"""Regression coverage for Grammar Markdown list spacing."""
from __future__ import annotations

import re
import sys
from pathlib import Path

import markdown
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grammar_content import (  # noqa: E402
    _MD_EXTENSIONS,
    _MD_EXT_CONFIGS,
    _insert_blank_lines_before_lists,
    grammar_service,
)


def _render(text: str) -> str:
    prepared = _insert_blank_lines_before_lists(text)
    return _render_source(prepared)


def _render_source(text: str) -> str:
    return markdown.Markdown(
        extensions=_MD_EXTENSIONS, extension_configs=_MD_EXT_CONFIGS,
    ).convert(text)


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


@pytest.mark.parametrize("source", [
    pytest.param("Name | Value\n--- | ---\n- item | value", id="table"),
    pytest.param("> Ghi chú:\n- item", id="lazy-blockquote"),
    pytest.param("- first\n  continuation\n- second", id="tight-list"),
    pytest.param("~~~text\nDòng mã\n- x\n~~~", id="tilde-fence"),
    pytest.param("```text\nDòng mã\n````\n- x\n```", id="backtick-length"),
    pytest.param(
        "- parent\n    - first\n      continuation\n    - second\n- sibling",
        id="nested-list-continuation",
    ),
    pytest.param("- first\ncontinuation\n- second", id="lazy-list-continuation"),
    pytest.param("    Dòng mã\n    - x", id="indented-code"),
    pytest.param("    Dòng mã\n- x", id="list-after-indented-code"),
    pytest.param("<pre>\n\nDòng mã\n- x\n</pre>", id="raw-code-with-blank-line"),
    pytest.param("Prose\n- item | value\n--- | ---", id="ambiguous-table-header"),
    pytest.param("+ first\n  continuation\n- second", id="plus-list-continuation"),
    pytest.param("Heading\n---\n- item", id="setext-heading"),
    pytest.param("Prose\n- - -", id="thematic-break"),
    pytest.param("~~~text\nDòng mã\n~~~~\n- x\n~~~", id="tilde-length"),
    pytest.param("````text\nDòng mã\n```\n- x\n````", id="shorter-fence"),
    pytest.param("```text\nDòng mã\n~~~\n- x\n```", id="different-fence-character"),
    pytest.param('``` {.text #sample}\nDòng mã\n- x\n```', id="fence-attributes"),
    pytest.param('~~~text hl_lines="1"\nDòng mã\n- x\n~~~', id="fence-highlight-lines"),
    pytest.param("~~~text\r\nDòng mã\r\n- x\r\n~~~\t", id="fence-crlf-tabs"),
])
def test_existing_markdown_structures_render_identically(source):
    prepared = _insert_blank_lines_before_lists(source)

    assert prepared == source
    assert _render_source(source) == _render_source(prepared)


def test_prose_after_a_fence_can_still_start_a_list():
    source = "~~~text\nDòng mã\n- x\n~~~\n\nCác bước:\n1. a\n2. b"

    assert _insert_blank_lines_before_lists(source) == source.replace(
        "Các bước:\n1.", "Các bước:\n\n1.",
    )
    assert "<ol>\n<li>a</li>\n<li>b</li>\n</ol>" in _render(source)


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
