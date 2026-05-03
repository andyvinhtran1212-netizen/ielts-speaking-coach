"""Pin: grammar content loader converts anchor markers to clickable tags.

Sprint 4 Phase 2 introduced a post-processing step in
`GrammarContentService._parse_file` that converts
`<!-- anchor: ID -->` markers (preserved verbatim by the markdown
parser) into `<a id="ID" class="grammar-anchor"></a>` tags so the
browser can scroll to URL hash targets.

If this regresses, AI feedback deep-links won't land on the correct
section — the marker would still be in the rendered HTML but as a
non-clickable comment. The drift gate doesn't catch this; this test
does.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grammar_content import grammar_service


_ID_TAG_RE = re.compile(r'<a\s+id="([\w.\-]+)"\s+class="grammar-anchor"\s*></a>')
_RAW_MARKER_RE = re.compile(r"<!--\s*anchor:\s*[\w.\-]+\s*-->")


def _sample_article_with_anchors():
    """Return an article known to have inline anchor markers in source.
    `articles` (from Sprint 1) ships with 9 inline markers."""
    a = grammar_service.articles_by_slug.get("articles")
    assert a, "Sample article 'articles' missing from loader"
    return a


def test_renderer_emits_anchor_tags_for_each_marker():
    a = _sample_article_with_anchors()
    html = a["html"]

    # Source file has 9 markers — verify by counting them in the source.
    src = (Path(__file__).parent.parent / "content" / "foundations" / "articles.md").read_text(encoding="utf-8")
    src_marker_count = len(_RAW_MARKER_RE.findall(src))
    assert src_marker_count > 0, "Sample article should have inline markers in source"

    rendered_ids = _ID_TAG_RE.findall(html)
    assert len(rendered_ids) == src_marker_count, (
        f"Expected {src_marker_count} <a id> tags, got {len(rendered_ids)}"
    )


def test_renderer_strips_raw_anchor_comments():
    """No raw `<!-- anchor: ... -->` should remain after conversion."""
    a = _sample_article_with_anchors()
    html = a["html"]
    leftover = _RAW_MARKER_RE.findall(html)
    assert not leftover, (
        f"Raw anchor markers leaked through to HTML — converter regressed: {leftover[:3]}"
    )


def test_renderer_anchor_id_matches_frontmatter_declaration():
    """Each declared frontmatter anchor id should appear in the HTML
    as an <a id>. (Sprint 4 Phase 3 also exposes the anchors list, but
    here we just rely on the source frontmatter for ground truth.)"""
    import yaml
    src = (Path(__file__).parent.parent / "content" / "foundations" / "articles.md").read_text(encoding="utf-8")
    parts = src.split("---", 2)
    fm = yaml.safe_load(parts[1]) or {}
    declared_ids = {a["id"] for a in fm.get("anchors") or []}

    a = _sample_article_with_anchors()
    rendered_ids = set(_ID_TAG_RE.findall(a["html"]))

    # Every declared anchor with an inline marker should resolve.
    # Some declarations may be frontmatter-only (no marker yet) — those
    # legitimately won't appear. So check that rendered ⊆ declared.
    leaked = rendered_ids - declared_ids
    assert not leaked, (
        f"Rendered <a id> not declared in frontmatter — anchor name drift: {leaked}"
    )
