"""Pin: anchor resolution from feedback-anchor-mapping.yaml.

Sprint 4 Phase 4 added `GrammarContentService.find_best_anchor(issue, slug)`
that scores a Vietnamese grammar issue string against the mapping
file's `feedback_keywords` + `user_phrase_examples` per anchor. The
matcher uses the same 0.35 threshold as `find_best_match` (Andy Q1
directive) and defensively skips entries with `deferred_until` set
(Andy Q2 directive — defense-in-depth even though Sprint 3 resolved
all current deferrals).

If this regresses, recommendations on the result page lose their
deep-link enrichment and fall back to article-level URLs.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grammar_content import grammar_service


# ── Anchor resolution ─────────────────────────────────────────────────

def test_resolves_articles_missing_indefinite():
    """M001 — Vietnamese phrase about missing 'a' resolves to the
    singular-count-noun anchor inside articles.md."""
    anchor = grammar_service.find_best_anchor(
        "Thiếu mạo từ 'a' trước danh từ đếm được số ít",
        "articles",
    )
    assert anchor == "articles.indefinite.missing-with-singular-count-noun"


def test_resolves_via_english_keyword():
    """Even though Claude returns Vietnamese in production, the matcher
    tolerates English issue strings — they tokenize and match against
    feedback_keywords directly."""
    anchor = grammar_service.find_best_anchor(
        "missing article before singular count noun",
        "articles",
    )
    assert anchor == "articles.indefinite.missing-with-singular-count-noun"


def test_returns_none_for_unrelated_issue():
    """Issues with no token overlap return None — no false anchor."""
    anchor = grammar_service.find_best_anchor(
        "Hoàn toàn không liên quan đến chủ đề này",
        "articles",
    )
    assert anchor is None


def test_returns_none_for_unmapped_slug():
    """Slug with no mapping entries returns None gracefully."""
    anchor = grammar_service.find_best_anchor(
        "any issue text here",
        "this-slug-has-no-mapping-entries",
    )
    assert anchor is None


def test_handles_empty_inputs():
    assert grammar_service.find_best_anchor("", "articles") is None
    assert grammar_service.find_best_anchor("some issue", "") is None
    assert grammar_service.find_best_anchor(None, "articles") is None


# ── Defensive deferred skip (Andy Q2) ─────────────────────────────────

def test_mapping_index_skips_deferred_entries():
    """Defense-in-depth: mappings carrying `deferred_until` are filtered
    out even when the drift gate would catch them anyway. This guards
    against future drift-bypass scenarios (e.g. a new mapping shipped
    pre-anchor)."""
    import yaml
    raw = yaml.safe_load(
        (Path(__file__).parent.parent / "content" / "feedback-anchor-mapping.yaml")
        .read_text(encoding="utf-8")
    )
    deferred_anchors = {
        m.get("target_anchor")
        for m in (raw.get("mappings") or [])
        if m.get("deferred_until")
    }
    # Force a fresh index reload to avoid singleton state from earlier tests.
    grammar_service._mappings_by_slug = None
    idx = grammar_service._load_mappings()
    indexed_anchors = {
        m.get("target_anchor")
        for entries in idx.values()
        for m in entries
    }
    leak = deferred_anchors & indexed_anchors
    assert not leak, (
        f"Deferred mappings leaked into matcher index — defensive guard regressed: {leak}"
    )
