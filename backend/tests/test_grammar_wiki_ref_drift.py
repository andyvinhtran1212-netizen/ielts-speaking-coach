"""B6 — guard against Grammar Wiki cross-reference drift.

Every related_pages / next_articles / compare_with / prerequisites slug in an
article's frontmatter MUST resolve to a live (non-archived) article. An
unresolved slug is a dead cross-link the loader silently drops (grammar_content.
_resolve_related), so it never surfaces as a visible error. This test pins the
post-cleanup state and fails CI the moment an edit re-introduces a dangling ref
or archives an article still referenced elsewhere.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grammar_content import GrammarContentService

_REF_FIELDS = ("related_pages", "next_articles", "compare_with", "prerequisites")


def test_no_dangling_grammar_cross_references():
    gs = GrammarContentService()          # fresh scan of backend/content/**
    live = set(gs.articles_by_slug)
    assert live, "no grammar articles loaded — content dir missing?"

    broken: list[str] = []
    for slug, a in gs.articles_by_slug.items():
        for field in _REF_FIELDS:
            for ref in (a.get(field) or []):
                if ref not in live:
                    broken.append(f"  {slug}.{field} → '{ref}'")

    assert not broken, (
        "Dangling grammar-wiki cross-references (create the target article OR "
        "remove the ref):\n" + "\n".join(sorted(broken))
    )


def test_emphasis_inversion_refs_repointed_to_inversion():
    """B6 — emphasis-inversion was archived; live refs were re-pointed to its
    successor `inversion` (not left dangling). inversion itself must exist."""
    gs = GrammarContentService()
    assert "inversion" in gs.articles_by_slug
    assert "emphasis-inversion" not in gs.articles_by_slug   # stays archived
