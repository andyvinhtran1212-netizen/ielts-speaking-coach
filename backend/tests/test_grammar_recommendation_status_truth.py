from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services import claude_grader  # noqa: E402
from services.grammar_content import GrammarContentService  # noqa: E402


def test_parse_file_preserves_draft_status(tmp_path):
    article = tmp_path / "draft-article.md"
    article.write_text(
        """---
slug: draft-article
category: foundations
title: Draft Article
status: draft
---

# Draft body
""",
        encoding="utf-8",
    )

    service = GrammarContentService.__new__(GrammarContentService)
    parsed = service._parse_file(article)

    assert parsed is not None
    assert parsed["status"] == "draft"


def test_attach_recommendations_skips_draft_articles(monkeypatch):
    result = {
        "grammar_issues": [
            "Lỗi nên bỏ qua vì bài đang draft",
            "Lỗi nên giữ lại vì bài đã complete",
        ]
    }

    def fake_match(issue: str):
        if "draft" in issue:
            return {
                "slug": "draft-slug",
                "category": "foundations",
                "title": "Draft Article",
                "score": 0.91,
            }
        return {
            "slug": "live-slug",
            "category": "foundations",
            "title": "Live Article",
            "score": 0.88,
        }

    def fake_summary(slug: str):
        if slug == "draft-slug":
            return {"slug": slug, "status": "draft"}
        if slug == "live-slug":
            return {"slug": slug, "status": "complete"}
        return None

    monkeypatch.setattr(claude_grader.grammar_service, "find_best_match", fake_match)
    monkeypatch.setattr(claude_grader.grammar_service, "get_article_by_slug", fake_summary)
    monkeypatch.setattr(
        claude_grader.grammar_service,
        "find_best_anchor",
        lambda issue, slug: slug + ".anchor",
    )

    claude_grader._attach_grammar_recommendations(result)

    assert result["grammar_recommendations"] == [
        {
            "issue": "Lỗi nên giữ lại vì bài đã complete",
            "slug": "live-slug",
            "category": "foundations",
            "title": "Live Article",
            "score": 0.88,
            "anchor": "live-slug.anchor",
        }
    ]
