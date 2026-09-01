from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grammar_content import grammar_service
from services.grammar_learning_blocks import inject_learning_blocks, validate_learning_blocks


def _check_block() -> dict:
    return {
        "id": "sample-check",
        "type": "check",
        "title": "Chọn đáp án",
        "prompt": "Câu nào đúng?",
        "options": [
            {"text": "She is student.", "feedback": "Thiếu mạo từ."},
            {"text": "She is a student.", "feedback": "Có determiner."},
        ],
        "correct_index": 1,
        "kp_anchor": "articles.overview",
    }


def test_check_block_validates_and_renders_escaped_html():
    blocks, errors = validate_learning_blocks(
        [_check_block()], "<!-- learning-block: sample-check -->",
    )
    assert errors == []
    blocks[0]["prompt"] = '<img src=x onerror="alert(1)">'
    rendered = inject_learning_blocks(
        "<p>Before</p><!-- learning-block: sample-check --><p>After</p>",
        blocks,
        article_slug="articles",
    )
    assert 'data-learning-block="sample-check"' in rendered
    assert "&lt;img" in rendered
    assert '<img src=x' not in rendered
    assert 'data-kp-anchor="articles.overview"' in rendered


def test_validator_rejects_orphan_marker_and_invalid_answer_index():
    bad = _check_block()
    bad["correct_index"] = 9
    _, errors = validate_learning_blocks(
        [bad], "<!-- learning-block: missing-block -->",
    )
    assert any("correct_index" in error for error in errors)
    assert any("has no body marker" in error for error in errors)
    assert any("has no frontmatter block" in error for error in errors)


def test_loader_exposes_learning_blocks_on_every_article():
    missing = [slug for slug, article in grammar_service.articles_by_slug.items() if "learning_blocks" not in article]
    assert not missing
