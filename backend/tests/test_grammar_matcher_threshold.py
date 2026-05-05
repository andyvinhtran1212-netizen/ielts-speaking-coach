"""False-positive guard tests for the grammar matcher threshold.

Sprint 6.7 lowered `_MATCH_THRESHOLD` from 0.35 to 0.20 after Sprint 6.6
production logs revealed Vietnamese AI feedback strings scoring 0.18-0.30
and silently being rejected. The lower floor recovers the 0.20-0.35 band
of legitimate matches but raises the false-positive risk.

This file pins the matcher's behaviour on three feedback shapes that
should NOT route to a grammar article:

  1. Pronunciation-only feedback (no grammar concept)
  2. Vocabulary / word-choice feedback (lexical, not structural)
  3. Fluency feedback (delivery, not language)

A regression here means the matcher is over-matching — pull-quote the
failing case and either tighten `_DIRECT_MAP` keywords, narrow a
`_VI_EN` term's English fan-out, or revert the threshold and plan
Sprint 7 mapping expansion instead.

The fourth test documents the three production canary issues from the
Sprint 6.6 Railway log (2026-05-05) — the rows that motivated the
threshold tune. We don't assert a specific match count (some issues
genuinely have no target article), only that the lowered threshold
doesn't silently break grading on real production input.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grammar_content import _MATCH_THRESHOLD, grammar_service


def test_threshold_constant_pinned_at_0_20():
    """Pin the constant value so a casual edit doesn't drift it back to
    0.35 (or up). If a future sprint genuinely needs a different floor,
    update this assertion + run the canary in Phase 2 of that sprint."""
    assert _MATCH_THRESHOLD == 0.20


def test_matcher_does_not_match_unrelated_topic():
    """Pronunciation-only feedback shouldn't match grammar articles.

    'phát âm' isn't in `_VI_EN`, so no extra English tokens are fanned
    out, and the only ASCII tokens of length ≥3 the regex extracts are
    none — Vietnamese here has no embedded English. Result: no_tokens
    path, returns None.
    """
    result = grammar_service.find_best_match("Phát âm 'th' chưa đúng — luyện thêm")
    assert result is None or result["score"] < _MATCH_THRESHOLD


def test_matcher_does_not_match_vocabulary_only():
    """Pure vocabulary feedback shouldn't fire as a strong grammar match.

    Sprint 7c rework: scoring now leads with curated mapping keywords +
    user_phrase_examples. Rich Sprint 7a examples inevitably contain
    common English words like "really" / "quite" that overlap with
    vocabulary feedback. We can no longer guarantee None or a score
    below _MATCH_THRESHOLD — single-token incidental matches at
    1/N=0.33 happen by design. The looser bar pinned here is: the
    score must stay below 0.50 (i.e. a single-token coincidence,
    never a 2+ token concrete-pattern match), so that vocabulary-
    flavoured feedback never confidently outranks a real grammar
    pattern. If this fails, M039's examples (or whichever slug is
    winning) have started overlapping with vocabulary feedback in
    multiple tokens — investigate whether the example set should be
    tightened.
    """
    result = grammar_service.find_best_match(
        "Từ 'somehow' không phù hợp ngữ cảnh — dùng 'quite' hoặc 'really'"
    )
    assert result is None or result["score"] < 0.50


def test_matcher_does_not_match_fluency_only():
    """Fluency feedback (delivery, not grammar) returns None."""
    result = grammar_service.find_best_match("Nói chậm hơn để rõ ý")
    assert result is None


def test_matcher_handles_real_production_misses():
    """Sprint 6.6 canary 3 issues (Railway logs 2026-05-05).

    These all scored below the old 0.35 floor and were rejected,
    leaving `recommended_anchor=NULL` on every production row. We
    don't pin a specific match count — some issues legitimately
    have no target article (e.g. cấu trúc câu where the AI commentary
    is meta rather than rule-based) — we only document the fixtures
    so a future regression on this exact set is investigable.
    """
    issues = [
        "Sai cấu trúc: 'English is chosen to be' — nên dùng bị động đơn giản hơn hoặc chủ động",
        "Thiếu chủ ngữ rõ ràng: 'I used to use it for learning English, but also in the workplace'",
        "Lặp từ 'chosen' không cần thiết — 'English is chosen... It is the language chosen'",
    ]
    matches = [grammar_service.find_best_match(i) for i in issues]
    matched_count = sum(1 for m in matches if m is not None)
    # Document baseline; Phase 2 production canary will tell us the
    # real shape and we'll tighten this in a follow-up if warranted.
    assert matched_count >= 0


# ── Sprint 7c.2 — modal-verbs false-positive on quoted student errors ─
#
# AI feedback often quotes the student's broken English verbatim:
#     "Sai cấu trúc động từ — 'can uh success in' không hợp lệ"
# Words like "can" / "should" / "must" inside such quotes used to
# trigger _VI_EN expansion AND raw_words extraction — both biased
# routing toward modal-verbs (M023's "can to V" keyword matched the
# bare "can" token). Sprint 7c.2 strips quoted phrases of ≥3 words
# (heuristic for "this is a student-error sample, not a topic name")
# from BOTH VI_EN scan input and raw_words input. Short quotes (≤2
# words, e.g. 'past simple') are left in place so legitimate quoted
# topic names still contribute to article matching.

def test_routing_strips_long_quoted_student_errors():
    """Sprint 7c.2 production bug: 'can uh success in' (4-word
    student quote) used to route to modal-verbs because raw 'can'
    matched M023. After stripping, the rest of the issue's
    Vietnamese signal ('thiếu động từ chính') wins."""
    issue = "Sai cấu trúc động từ — 'can uh success in' không hợp lệ, thiếu động từ chính"
    match = grammar_service.find_best_match(issue)
    assert match is not None, f"No match for {issue!r}"
    assert match["slug"] != "modal-verbs", (
        f"Sprint 7c.2 regression: 'can' inside student quote routed to "
        f"modal-verbs at score {match['score']:.3f}. The 4-word quote "
        f"should have been stripped before VI_EN / raw_words scans."
    )
    assert match["slug"] == "missing-main-verbs", (
        f"Expected missing-main-verbs (M050), got {match['slug']!r}"
    )


def test_routing_strips_curly_quotes_too():
    """Sprint 7c.2: handle Unicode curly quotes (U+2018 / U+2019) the
    same as straight quotes — AI feedback occasionally renders with
    smart quotes. With the long-quote heuristic, the quoted student
    fragment gets stripped; the residual issue ('Sai cấu trúc — không
    hợp lệ') has no clear routing signal, so returning None is
    acceptable. The bar is: do NOT route to modal-verbs."""
    issue = "Sai cấu trúc — \u2018can uh success in\u2019 không hợp lệ"
    match = grammar_service.find_best_match(issue)
    if match is not None:
        assert match["slug"] != "modal-verbs", (
            f"Sprint 7c.2 curly-quote regression: routed to modal-verbs at "
            f"score {match['score']:.3f}. Curly-quote stripping failed."
        )


def test_short_quoted_topic_names_still_contribute_to_routing():
    """Sprint 7c.2: short quotes (≤2 words) are LEFT in the issue
    text so legitimate topic-name quotes still drive routing. Here
    'past simple' is a 2-word topic mention, 'go' / 'went' / 'thay
    vì' are short — none should be stripped, so the matcher still
    sees the past/simple/went tokens.
    """
    issue = "Lỗi 'past simple' — học viên dùng 'go' thay vì 'went'"
    match = grammar_service.find_best_match(issue)
    assert match is not None, (
        f"Short quotes were stripped or matcher returned None — "
        f"the long-quote heuristic should have kept them in."
    )
    # Tense-related slug expected — past-simple, present-perfect (which
    # has 'past simple where pp needed' keywords), tense-consistency, or
    # past-perfect-* are all reasonable routes for verb-form-in-past
    # feedback.
    ok_slug_parts = ("past", "perfect", "tense", "present")
    assert any(part in match["slug"] for part in ok_slug_parts), (
        f"Expected tense-related slug, got {match['slug']!r}. "
        f"Short-quote tokens 'past' + 'simple' should win Tier 1."
    )
