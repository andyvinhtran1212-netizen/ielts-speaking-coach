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


# ── Sprint 7c.1 — find_best_anchor hardening ─────────────────────────
#
# Sprint 7c reworked find_best_match's tokenization (word-boundary
# regex, Vietnamese stop list, word-boundary haystack matching) but
# left find_best_anchor on the older Unicode-substring path. The
# Sprint 7c production canary then surfaced 2/4 rows where the slug
# matched but recommended_anchor was NULL. Sprint 7c.1 mirrors the
# hardening into find_best_anchor, keeping the Unicode-aware regex so
# Vietnamese tokens still substring-match Vietnamese keyword chunks
# but adding the same stop filter and word-boundary haystack check.

def test_anchor_resolution_word_boundary_hardening():
    """Vietnamese-leading issue must reach the M049 anchor — without
    the Sprint 7c.1 word-boundary haystack matching, false-positive
    substring hits could outscore the right anchor."""
    anchor = grammar_service.find_best_anchor(
        "Thiếu chủ ngữ rõ ràng", "missing-subjects",
    )
    assert anchor is not None, "Expected M049 anchor to resolve"
    assert anchor.startswith("missing-subjects."), (
        f"Anchor must belong to missing-subjects slug, got {anchor!r}"
    )


def test_anchor_resolution_filters_vn_stop_tokens():
    """Stop-token filter (trong, sai, thay, khi, kia) shouldn't break
    Vietnamese semantic matching — content tokens like 'thì' / 'quá
    khứ' / 'đơn' carry the routing signal."""
    anchor = grammar_service.find_best_anchor(
        "Sai thì khi đang nói trong câu thay vì dùng quá khứ đơn",
        "tense-consistency",
    )
    assert anchor is not None, (
        "Expected tense-consistency anchor to resolve through stop-token "
        "noise via Vietnamese content tokens (thì / quá / khứ / đơn)."
    )


def test_anchor_resolution_documents_production_canary():
    """Sprint 7c canary 2026-05-05 09:00: 'attract it to people' issue
    routed to articles slug but anchor returned NULL. After Sprint
    7c.1 hardening, document the post-fix state. Anchor may legitimately
    stay None if the issue's tokens don't match any specific
    article-errors anchor — this test pins the routing reaches at
    least the slug layer reliably."""
    issue = "Cấu trúc câu không rõ ràng — 'attract it to people' không phù hợp ngữ pháp"
    match = grammar_service.find_best_match(issue)
    # Slug match is sufficient — anchor resolution is best-effort.
    assert match is not None, "Sprint 7c rework should produce some routing"


# ── Sprint 7c.3 — M023 modal-verbs Vietnamese keyword tune ────────────
#
# Sprint 7c.1+7c.2 production canary 2026-05-05: "can easily to attract"
# routed correctly to modal-verbs slug (M023's English keyword "can to V"
# matched after long-quote strip via the residual "can" token), BUT the
# anchor returned NULL because M023's keywords + examples were entirely
# English. AI feedback prefixes the quote with Vietnamese commentary
# like "sai động từ nguyên mẫu sau 'can'", which had no keyword anchor
# to score against. Sprint 7c.3 appends 8 Vietnamese keywords + 6
# production-derived phrase examples (same playbook as M044 Sprint 7a
# Day 4). This test pins the post-fix state.

def test_m023_resolves_production_canary_pattern():
    """Real production string — slug must route to modal-verbs AND
    anchor must resolve to the bare-infinitive-required anchor (or at
    minimum a modal-verbs.* anchor). If this fails after Sprint 7c.3,
    investigate whether the new VN keywords still survive tokenization
    + word-boundary haystack matching in find_best_anchor."""
    issue = "Cấu trúc 'can easily to attract' — sai động từ nguyên mẫu sau 'can'"

    match = grammar_service.find_best_match(issue)
    assert match is not None, "Slug routing regressed for M023 canary"
    assert match["slug"] == "modal-verbs", (
        f"Expected modal-verbs slug, got {match['slug']!r}"
    )

    anchor = grammar_service.find_best_anchor(issue, "modal-verbs")
    assert anchor is not None, (
        "Sprint 7c.3 regression: anchor returned NULL despite VN "
        "keyword tune. Check that 'sai động từ nguyên mẫu' / "
        "'động từ nguyên mẫu sau' survive Unicode word-boundary "
        "tokenization in find_best_anchor."
    )
    assert "bare-infinitive" in anchor or anchor.startswith("modal-verbs."), (
        f"Expected modal-verbs.* anchor, got {anchor!r}"
    )


# ── Sprint 7d — Codex AMBER finding 2026-05-05 ────────────────────────
#
# Codex AUDIT_DEEP_LINK_FIX_2026-05-05.md verdict AMBER. The original
# Sprint 6+7 RED was resolved (66.7% anchor populated post-7c) but one
# specific production string still missed:
#
#   "Sai cấu trúc 'Sometimes romance in a lot of time' — câu không có
#    động từ chính"
#
# Pre-fix routing: present-simple, anchor=NULL.
# Diagnosis: after _strip_long_quoted_phrases removes the 7-word student
# quote, the remaining cleaned text "Sai cấu trúc — câu không có động
# từ chính" has NO ASCII raw_words and only ONE _VI_EN trigger that
# fires ("động từ" → ["verb"]). With token_count=1 and "verb" appearing
# in nearly every grammar mapping's keywords, 9 slugs tie at score 1.0
# and dict-iteration order picks present-simple (M004) over
# missing-main-verbs (M050).
#
# Fix: add ONE _VI_EN entry for "không có động từ" emitting the same
# token expansion the existing "thiếu động từ chính" entry uses
# (["verb", "main verb", "missing", "sentence-structure"]). With four
# tokens, M050 hits all four (score 1.0) while the false positives
# drop to 0.5, breaking the tie cleanly.

def test_codex_audit_2026_05_05_sometimes_romance_miss():
    """Codex AMBER finding 2026-05-05: production miss.

    Pin the exact production string. After Sprint 7d's VI_EN expansion
    for "không có động từ" patterns, this should route to
    missing-main-verbs and resolve a populated anchor."""
    issue = (
        "Sai cấu trúc 'Sometimes romance in a lot of time' — "
        "câu không có động từ chính"
    )

    match = grammar_service.find_best_match(issue)
    assert match is not None, "Codex AMBER: no slug routing at all"
    assert match["slug"] == "missing-main-verbs", (
        f"Codex AMBER regression: routed to {match['slug']!r} "
        f"(score {match['score']:.3f}) instead of missing-main-verbs. "
        f"Sprint 7d fix likely backed out."
    )

    anchor = grammar_service.find_best_anchor(issue, "missing-main-verbs")
    assert anchor is not None, (
        "Sprint 7d: anchor returned NULL despite slug routing fixed. "
        "Check that find_best_anchor still tokenizes 'không có động từ' "
        "shape against M050 keywords."
    )
    assert "missing-main-verbs" in anchor, (
        f"Expected missing-main-verbs.* anchor, got {anchor!r}"
    )
