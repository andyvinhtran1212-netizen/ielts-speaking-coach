"""Pin: grammar content loader exposes `anchors` from frontmatter.

Sprint 4 Phase 3 added an `anchors` field to the article dict returned
by GrammarContentService._parse_file. Sprint 4 Phase 4 (matcher anchor
resolution) depends on this field — if it regresses, the matcher
silently falls back to slug-only matches without anchor enrichment.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grammar_content import grammar_service


def test_loader_exposes_anchors_for_articles_with_them():
    a = grammar_service.articles_by_slug.get("articles")
    assert a, "Sample CORE article 'articles' missing"
    anchors = a.get("anchors")
    assert isinstance(anchors, list), "anchors field must be a list"
    assert len(anchors) > 0, "CORE article 'articles' should have anchors after Sprint 1"
    # Each entry has an id field; types and locations are optional but
    # present for the Sprint 1 CORE batch.
    for entry in anchors:
        assert "id" in entry and entry["id"], f"anchor entry missing id: {entry}"


def test_loader_returns_empty_anchors_for_articles_without(tmp_path):
    """An article whose frontmatter has NO `anchors:` key must load with
    `anchors == []` (not a missing key), guarding downstream
    `.get('anchors', [])` callsites. Content-independent: exercises the loader
    default (`fm.get("anchors") or []`) directly, since the anchor backfill left
    no live grammar article un-anchored to sample."""
    p = tmp_path / "no-anchors.md"
    p.write_text(
        "---\ntitle: Sample\nslug: sample-no-anchors\ncategory: tenses\n---\nBody text.\n",
        encoding="utf-8",
    )
    parsed = grammar_service._parse_file(p)
    assert parsed is not None
    assert parsed["anchors"] == []


def test_loader_anchors_field_present_on_every_article():
    """Every article in the loader should have an `anchors` key —
    empty list or populated, but always present."""
    missing = [
        slug for slug, a in grammar_service.articles_by_slug.items()
        if "anchors" not in a
    ]
    assert not missing, f"Articles missing anchors field: {missing[:5]}"
