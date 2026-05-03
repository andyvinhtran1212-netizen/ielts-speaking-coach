# Sprint 5b Phase 0 Reconnaissance

**Date:** 2026-05-03
**Branch:** `audit/grammar-sprint-5-frontend-2026-05-03` (5 Sprint 5 commits present, none from Sprint 5b yet)
**Scope:** patch sprint addressing Codex audit findings on Sprint 5
**Status:** STOPPED for planner review per user directive

---

## Branch posture

```
$ git branch --show-current
audit/grammar-sprint-5-frontend-2026-05-03

$ git log --oneline main..HEAD
5f68840 docs(grammar): Sprint 5 execution report — production deep-link LIVE
3c4ec40 feat(grammar): 3-second teal pulse on landed anchor heading
2363f72 feat(grammar): smooth-scroll to deep-link anchor on grammar-article load
1294227 feat(grammar): deep-link recommendation cards in result page (URLs #2 + #3)
b1e3154 feat(grammar): deep-link recommendation cards in practice page (URL #1)
```

Sprint 5b will append commits onto this branch (no new branch).

---

## Codex audit findings — disposition

| # | Finding | Severity | Disposition |
|---|---|---|---|
| Blocker 1 | 0/N production rows have `recommended_anchor` populated — mapping coverage gap | Critical | **Deferred to Sprint 6** (mapping work, not frontend) |
| Blocker 2 | Practice page Quick Grammar Tip card drops anchor — Sprint 5 fixed inline link only | High | **Sprint 5b Phase 1** |
| Follow-up A | No integration test for production-like issue strings | High | **Sprint 5b Phase 2** |
| Follow-up B | CI gate doesn't trigger on frontend-only PRs (drift gate skipped) | High | **Sprint 5b Phase 3** |

Production sample confirms Blocker 1 directly: I queried `grammar_recommendations` on production for the most recent 80 rows; **0/80 have `recommended_anchor` set**. Slugs resolve correctly (article-errors, tense-consistency, pronouns, etc.) but the anchor field is universally NULL. This is a mapping problem, not a Sprint 5 frontend problem — confirming Andy's Sprint 6 scope decision.

---

## Phase 0a — Blocker 2 confirmed in `frontend/js/practice.js`

Two distinct bugs in the same file. The Sprint 5 commit `b1e3154` only fixed URL #1 (the per-issue inline `→ Học bài: <title>` link in `_grammarIssuesBlock`). The Quick Grammar Tip resource card (URL on the practice feedback screen) was missed.

### Bug 1 — `_grammarCardHtml` href construction (line 838-876)

```javascript
function _grammarCardHtml(match, isPrimary) {
  var slug   = match.slug, meta = match.meta;
  var href   = '/grammar/' + encodeURIComponent(meta.category) + '/' + encodeURIComponent(slug);
                                                                                         // ↑ no anchor
  var reason = _grReason(match.topField, match.topic);
  ...
}
```

`href` is built without `match.anchor`. Both primary card (line 844) and secondary card (line 863) use this `href` — both are broken.

### Bug 2 — `_showGrammarResources` match construction (line 884-893)

```javascript
var recs = Array.isArray(data.grammar_recommendations) ? data.grammar_recommendations : [];
if (recs.length) {
  var rec  = recs[0];
  var meta = _grMeta(rec.slug) || { category: rec.category, title: rec.title, summary: '' };
  var match = { slug: rec.slug, meta: meta, topField: 'gi', topic: rec.issue };
                                                                              // ↑ rec.anchor dropped
  _GR_TRACKER.track([match]);
  cards.innerHTML = _grammarCardHtml(match, true);
  wrap.style.display = '';
  return;
}
```

Even if Bug 1 above is fixed, the `match` object never carries `rec.anchor` — so `match.anchor` is undefined inside `_grammarCardHtml` and the ternary falls through to article-level URL.

The fallback path at line 896-901 (`_matchGrArticles` keyword matching) is fine — keyword matches genuinely have no anchor information, so falling through is correct.

---

## Phase 0b — Sprint 5 result.html mirror pattern (commit `1294227`)

The exact pattern Sprint 5b will mirror in practice.js, copied from `frontend/pages/result.html`:

```diff
   function _grammarCardHtml(match, isPrimary) {
     var slug   = match.slug, meta = match.meta;
-    var href   = '/grammar/' + encodeURIComponent(meta.category) + '/' + encodeURIComponent(slug);
+    var href   = '/grammar/' + encodeURIComponent(meta.category) + '/' + encodeURIComponent(slug)
+               + (match.anchor ? '#' + encodeURIComponent(match.anchor) : '');
     var reason = _grReason(match.topField, match.topic);
```

```diff
       var meta = _grMeta(rec.slug) || { category: rec.category, title: rec.title, summary: '' };
-      recMatches.push({ slug: rec.slug, meta: meta, topField: 'gi', topic: rec.issue });
+      recMatches.push({ slug: rec.slug, meta: meta, topField: 'gi', topic: rec.issue, anchor: rec.anchor || null });
```

practice.js requires the same two adjustments. NULL anchor → article-level URL fallback (backward compatible with rows where matcher returned no anchor — i.e. all 80/80 production rows today).

---

## Phase 0c — production issue samples for integration test

Pulled the 80 most recent rows from `grammar_recommendations` (production Supabase). 80 unique `grammar_issue` strings; 0 have `recommended_anchor` populated.

Representative spread (curated for fixture diversity in Phase 2):

| Slug resolved | Anchor populated | Issue (Vietnamese) |
|---|---|---|
| `article-errors` | ❌ None | `Thiếu mạo từ 'the' trước 'fast-paced life'` |
| `article-errors` | ❌ None | `Thiếu mạo từ: 'as matter of fact' — đúng là 'as a matter of fact'` |
| `article-errors` | ❌ None | `Thiếu mạo từ 'the' trước 'Mountain View' (lần đầu tiên)` |
| `tense-consistency` | ❌ None | `Sai thì hiện tại đơn trong ngữ cảnh quá khứ — 'It is a sliver lego' nên là 'It was a silver lego'` |
| `tense-consistency` | ❌ None | `Sai thì — 'which created' nên là 'which creates'` |
| `pronouns` | ❌ None | `Đại từ 'this' không rõ ràng — không chỉ rõ người nói muốn nói đến cái gì` |
| `nouns` | ❌ None | `Cấu trúc 'a fundamental part of my protein' không hợp lý` |
| `expressing-preferences-naturally` | ❌ None | `Sai động từ 'refer' — nên dùng 'prefer' thay vì 'refer to'` |
| `missing-subjects` | ❌ None | `Thiếu chủ ngữ hoặc cấu trúc không hoàn chỉnh trong phần cuối câu` |
| `this-that-these-those-in-use` | ❌ None | `Cấu trúc 'explore this place' không tự nhiên` |

**Test design implication:** All currently observed production strings hit `find_best_match` (slug resolves) but miss `find_best_anchor` (anchor None). The integration test will pin **exactly that current behaviour** — slug resolved, anchor None — using `expected_anchor_present: False` parametrization. Sprint 6 will flip these to True one-by-one as mapping coverage is added; the test failures will signal which fixtures are now covered.

This makes the test forward-compatible: it locks in current state, doesn't pretend production is healthier than it is, and turns into Sprint 6's progress meter.

---

## Phase 0d — current CI workflow

`.github/workflows/backend-tests.yml` triggers on:

```yaml
on:
  pull_request:
    paths:
      - 'backend/**'
      - '.github/workflows/backend-tests.yml'
```

A frontend-only PR (e.g. fixing this Sprint 5b Blocker 2 in practice.js — entirely under `frontend/`) **does not run the drift gate**. If a future frontend PR ever touched mapping or content (unlikely but possible — the audit reports living in `grammar-audit/` are gitignored, but a frontend dev could touch `feedback-anchor-mapping.yaml` from VS Code with no signal), the gate would silently miss it.

**Sprint 5b Phase 3 fix:** add `frontend/**` to the paths list.

```yaml
on:
  pull_request:
    paths:
      - 'backend/**'
      - 'frontend/**'
      - '.github/workflows/backend-tests.yml'
```

This is wider than strictly necessary (most frontend PRs won't touch mapping) but trivially cheap (10-min job, runs on Andy's free GitHub Actions quota — burst tolerance is fine) and closes the gap with zero downside. Andy's Sprint 4 Q4 directive was "PR-only trigger" for quota reasons; broadening the path filter respects that intent (still PR-only, just more PRs gated).

---

## Phase 0e — Sprint 5b execution shape

| Phase | Action | Files | Commit |
|---|---|---|---|
| 1 | practice.js — `_grammarCardHtml` href + `_showGrammarResources` plumbing | `frontend/js/practice.js` | 1 commit, mirrors `1294227` |
| 2 | Add integration test — production-like strings through `find_best_match` + `find_best_anchor`, `expected_anchor_present: False` parametrized | `backend/tests/test_grammar_matcher_integration.py` (new) | 1 commit |
| 3 | Broaden CI gate paths trigger | `.github/workflows/backend-tests.yml` | 1 commit |
| 4 | Append Sprint 5b summary to existing execution report | `grammar-audit/sprint-5-execution-report.md` | 1 commit |

**Total: 4 new commits → branch ends at 5+4 = 9 commits.**

No new branch, no rebase, no force push. Pure append.

---

## Open questions for planner

**Q1 — fixture format:** plain `pytest.mark.parametrize` list of tuples, or YAML/JSON fixture file loaded into `parametrize`?

  My recommendation: parametrize list inline. Test is short (~10 fixtures), keeps the production strings visible in code review (they're the contract being pinned), and avoids file IO in tests. Yaml fixtures are over-engineered for this size.

**Q2 — Should the test assert exact slug, or just "slug is non-None"?**

  My recommendation: assert exact slug. The matcher's slug-resolution behaviour on production strings is itself a regression target — if a future change causes `Thiếu mạo từ 'the' trước 'fast-paced life'` to suddenly resolve to `nouns` instead of `article-errors`, that's a high-value alarm worth catching. Loose `is not None` masks that.

**Q3 — `expected_anchor_present` parameter or split into two test functions?**

  My recommendation: one parametrize per row, `expected_anchor_present: bool`. Single test body, clean assertion. When Sprint 6 fills mapping coverage, flipping a fixture from False → True is a one-line change. Two functions would force fixture duplication.

**Q4 — Phase 1 commit boundary: combine the two practice.js bugs into one commit, or split?**

  My recommendation: **one commit** (file-atomic, mirroring Sprint 5's `1294227` pattern — same file, same logical fix, same defect class). Splitting `_grammarCardHtml` from `_showGrammarResources` would be artificial: each fix is incomplete without the other (fixing only the href without plumbing match.anchor leaves the bug intact).

**Q5 — Test naming:** `test_grammar_matcher_integration.py` (proposed) vs. extending existing `test_grammar_anchor_matcher.py`?

  My recommendation: new file. Existing `test_grammar_anchor_matcher.py` uses controlled, hand-crafted fixtures targeting specific anchors — a unit test of the matcher's logic. The new test pins **production observed behaviour** (which is mostly "anchor=None today, will be filled in Sprint 6"). Different intent, different decay characteristics. Mixing them muddies what each file is asserting.

---

## What is NOT in scope for Sprint 5b

- ❌ Filling mapping coverage gaps (Sprint 6)
- ❌ Refactoring `_grammarCardHtml` or `_showGrammarResources` beyond the targeted anchor fixes
- ❌ Touching grammar.js, result.html, grammar-article.html (Sprint 5 already shipped, untouched)
- ❌ Backend changes (Sprint 4 was final backend sprint; integration test only consumes existing matcher, no new code)
- ❌ Changing CI runner config, dependencies, or test command — only the `paths:` trigger filter

---

## STOP — awaiting planner Claude review

Per Sprint 5b prompt directive: **do not proceed past Phase 0 until planner Claude reviews this report and answers the 5 open questions above (or signs off on my recommended answers).**

Branch posture verified, both Blocker 2 bugs confirmed in code, mirror pattern from Sprint 5 result.html documented, production sample collected with statistics, CI workflow current state captured, execution shape proposed (4 commits, all append-only), 5 open questions surfaced.
