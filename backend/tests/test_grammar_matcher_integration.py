"""Integration test: production-like grammar issue strings flowing through
both `find_best_match` (slug routing) and `find_best_anchor` (anchor
resolution within slug).

Different intent from `test_grammar_anchor_matcher.py`:
  - That file uses controlled, hand-crafted Vietnamese strings against
    explicit slugs to unit-test the matcher's anchor-scoring logic.
  - This file pins **observed production behaviour**: the actual
    Vietnamese grammar_issue strings Claude returns and stores in the
    `grammar_recommendations` table.

Why this matters
----------------
At Sprint 5 close, a query of the 80 most recent production rows showed
0/80 had `recommended_anchor` populated. Slugs resolve correctly
(article-errors, tense-consistency, pronouns, etc.) but anchor field was
universally NULL because `feedback-anchor-mapping.yaml` only covered
canonical articles like `articles`, `conditionals`, `word-order` — not
the topic-level error-clinic slugs the matcher routes to from Claude's
Vietnamese.

Sprint 6 (Phase 2a + 2b) closed the gap for the top 3 production slugs:
  - article-errors  (M031 missing-the-with-unique-reference,
                     M032 missing-a-when-categorizing,
                     M037 missing-the-on-second-mention, etc.)
  - tense-consistency (M033 tense-shift-mid-narrative)
  - articles  (already had M001-M003; live `_DIRECT_MAP` interception
               re-routes Vietnamese inputs to article-errors instead,
               so M001-M003 mostly serve English/test-mode inputs)

Of the original 8 production-sampled fixtures, 5 flipped True in Sprint 6.
The remaining 3 (pronouns, expressing-preferences-naturally,
missing-subjects) stay False — those slugs are Sprint 7 scope.

When future sprint work lands, fixtures here marked
`expected_anchor_present=False` will start failing — that failure is
a **signal**, not a regression: flip the fixture to True and add a
comment recording the mapping that addressed it.

Per Sprint 5b plan:
  - Inline parametrize (no YAML fixture file)
  - Exact slug assertion (loose `is not None` would mask routing drift)
  - Single `expected_anchor_present: bool` param
  - Production strings sourced from grammar_recommendations table
    sample (2026-05-03), plus a small synthetic block to demonstrate
    the matcher's positive contract under existing mapping coverage.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from services.grammar_content import grammar_service


# ── Fixture cases ─────────────────────────────────────────────────────
#
# Each case captures: the Claude-generated issue string, the slug
# `find_best_match` is expected to route to, and whether
# `find_best_anchor` is expected to resolve a non-null anchor for that
# slug at *current* mapping coverage (Sprint 5b close).
#
# Most production cases are `expected_anchor_present=False` — that's
# exactly the Sprint 6 work to fix. The 2 synthetic cases at the bottom
# anchor (pun intended) the test against existing mapping coverage so
# the file would catch a genuine matcher regression if anchor resolution
# stopped working entirely.

CASES = [
    # ── Production samples — Sprint 6 lifted these to True ──
    # Sprint 6 Phase 2b added M031 (article-errors.common-mistake.missing-the-with-unique-reference)
    # and M033 (tense-consistency.common-mistake.tense-shift-mid-narrative); these 5
    # production strings now resolve to anchors. Flipping the flag is the
    # success signal designed in Sprint 5b.
    {
        "id": "prod_article_missing_the_fast_paced",
        "issue": "Thiếu mạo từ 'the' trước 'fast-paced life'",
        "expected_slug": "article-errors",
        "expected_anchor_present": True,  # Sprint 6 M031 — flipped 2026-05-03
    },
    {
        "id": "prod_article_as_matter_of_fact",
        "issue": "Thiếu mạo từ: 'as matter of fact' — đúng là 'as a matter of fact'",
        "expected_slug": "article-errors",
        "expected_anchor_present": True,  # Sprint 6 M031 — flipped 2026-05-03
    },
    {
        "id": "prod_article_mountain_view",
        "issue": "Thiếu mạo từ 'the' trước 'Mountain View' (lần đầu tiên)",
        "expected_slug": "article-errors",
        "expected_anchor_present": True,  # Sprint 6 M031 — flipped 2026-05-03
    },
    {
        "id": "prod_tense_present_in_past_context",
        "issue": "Sai thì hiện tại đơn trong ngữ cảnh quá khứ — 'It is a sliver lego' nên là 'It was a silver lego'",
        "expected_slug": "tense-consistency",
        "expected_anchor_present": True,  # Sprint 6 M033 — flipped 2026-05-03
    },
    {
        "id": "prod_tense_which_created_vs_creates",
        "issue": "Sai thì — 'which created' nên là 'which creates' (hiện tại vì nói về đặc điểm hiện tại)",
        "expected_slug": "tense-consistency",
        "expected_anchor_present": True,  # Sprint 6 M033 — flipped 2026-05-03
    },
    # ── Production samples — still uncovered (Sprint 7 territory) ──
    # These slugs (pronouns, expressing-preferences-naturally, missing-subjects)
    # have no mapping entries yet. Sprint 6 explicitly chose tight scope
    # (top 3 slugs only); these flip to True when Sprint 7 expands coverage.
    {
        "id": "prod_pronoun_this_unclear",
        "issue": "Đại từ 'this' không rõ ràng — không chỉ rõ người nói muốn nói đến cái gì",
        "expected_slug": "pronouns",
        "expected_anchor_present": False,
    },
    {
        "id": "prod_verb_refer_vs_prefer",
        "issue": "Sai động từ 'refer' — nên dùng 'prefer' thay vì 'refer to'",
        "expected_slug": "expressing-preferences-naturally",
        "expected_anchor_present": False,
    },
    {
        "id": "prod_missing_subject",
        "issue": "Thiếu chủ ngữ hoặc cấu trúc không hoàn chỉnh trong phần cuối câu",
        "expected_slug": "missing-subjects",
        "expected_anchor_present": False,
    },
    # ── Sprint 6 positive controls — pin M032 and M037 directly ──
    # These production strings hit specific Sprint 6 mappings other than the
    # dominant M031/M033 path. Pinning them ensures a Sprint 7+ change that
    # accidentally collapses M032 or M037 into M031 won't go unnoticed.
    {
        "id": "prod_article_missing_a_short_of",
        "issue": "Thiếu mạo từ 'a' trước 'short of daily ritual'",
        "expected_slug": "article-errors",
        "expected_anchor_present": True,  # Sprint 6 M032 — missing-a-when-categorizing
    },
    {
        "id": "prod_article_missing_the_laptop_first_mention",
        "issue": "Thiếu mạo từ 'the' trước 'laptop' ở câu đầu tiên — 'One part of technology' nên là 'One piece of technology'",
        "expected_slug": "article-errors",
        "expected_anchor_present": True,  # Sprint 6 M037 — missing-the-on-second-mention
    },
    # ── Synthetic positive controls (pre-Sprint-6) ──
    # Strings crafted to hit existing mapping coverage in feedback-anchor-mapping.yaml.
    # If these stop resolving, the matcher itself has regressed — distinct
    # signal from any uncovered-slug False cases above.
    {
        "id": "synthetic_word_order_question_inversion",
        "issue": "Word order sai trong câu hỏi — 'I'm tall how' nên là 'how tall am I'",
        "expected_slug": "word-order",
        "expected_anchor_present": True,
    },
    {
        "id": "synthetic_word_order_inversion_alt_phrasing",
        "issue": "Word order sai trong câu hỏi đảo ngữ — Where you go nên là Where do you go",
        "expected_slug": "word-order",
        "expected_anchor_present": True,
    },
]


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_production_issue_resolves_to_expected_state(case):
    """Pin slug routing + anchor resolution against production behaviour.

    See module docstring for fixture-flipping protocol when Sprint 6
    mapping coverage starts resolving previously-None cases.
    """
    match = grammar_service.find_best_match(case["issue"])

    assert match is not None, (
        f"No slug match for issue: {case['issue']!r}. "
        f"Expected slug: {case['expected_slug']!r}."
    )
    assert match["slug"] == case["expected_slug"], (
        f"Slug routing mismatch for {case['issue']!r}: "
        f"expected {case['expected_slug']!r}, got {match['slug']!r}. "
        f"This is a high-value regression signal — investigate whether "
        f"the matcher's direct map, Vietnamese→English keyword map, or "
        f"slug ranking has changed."
    )

    anchor = grammar_service.find_best_anchor(case["issue"], match["slug"])

    if case["expected_anchor_present"]:
        assert anchor is not None, (
            f"Expected anchor for {case['issue']!r} on slug {match['slug']!r}, "
            f"got None. Sprint 6 mapping expansion may not have addressed "
            f"this case yet, OR an existing mapping has been removed/"
            f"deferred. Check feedback-anchor-mapping.yaml."
        )
    else:
        # Pin current state: known anchor-coverage gap. Sprint 6 will fix.
        # When this assertion fails, flip expected_anchor_present to True
        # and add a comment naming the Sprint 6 mapping that addressed it.
        assert anchor is None, (
            f"Anchor unexpectedly resolved for {case['issue']!r} on slug "
            f"{match['slug']!r}: got {anchor!r}. "
            f"Sprint 6 mapping expansion likely addressed this case — "
            f"flip expected_anchor_present to True in this test fixture."
        )


# ── Sprint 7a Day 4 — M044 production-canary tuning ──────────────────
#
# After Sprint 7a Day 3 merged M044 (prepositions slug coverage),
# production canary showed 2 rows that hit the slug (score ≈ 0.213) but
# `find_best_anchor` returned None. The Day 4 prompt added Vietnamese-
# leading keywords ("Sai giới từ", "Thiếu giới từ") and verb-form-after-
# preposition keywords + canary phrasings as user_phrase_examples.
#
# This test pins post-Day-4 behaviour: at least 1 of the 3 canary
# strings must now resolve to a non-null anchor on the prepositions
# slug. Not all 3 — some legitimately drift far from the
# transfer-from-vietnamese anchor's shape — but the bar is non-zero so
# a regression that re-empties M044's haystack would surface here.

_M044_CANARY_ISSUES = [
    "Thiếu giới từ — 'to support my studies, such as do homework' (phải là 'such as doing homework')",
    "Sai giới từ: 'helps the phone I use afterwards'",
    "Sai giới từ: 'helps me to entertain'",
]


def test_m044_resolves_at_least_one_production_canary():
    """Sprint 7a Day 4: ≥1/3 canary issues must reach an anchor on the
    prepositions slug after the M044 keyword tuning."""
    resolved = 0
    routed_to_prepositions = 0
    for issue in _M044_CANARY_ISSUES:
        match = grammar_service.find_best_match(issue)
        if not match or match["slug"] != "prepositions":
            continue
        routed_to_prepositions += 1
        if grammar_service.find_best_anchor(issue, "prepositions") is not None:
            resolved += 1

    assert resolved >= 1, (
        f"After Sprint 7a Day 4 M044 tuning, expected ≥1 of 3 canary "
        f"issues to resolve to a non-null anchor on the prepositions "
        f"slug; got {resolved} (routed to prepositions slug: "
        f"{routed_to_prepositions}/3). If all 3 still return None, the "
        f"M044 haystack still doesn't share enough tokens with real "
        f"production phrasing — re-tune feedback_keywords / "
        f"user_phrase_examples in feedback-anchor-mapping.yaml."
    )
