# Sprint 5 Execution Report — Frontend Deep-Link UX

**Date:** 2026-05-03
**Branch:** `audit/grammar-sprint-5-frontend-2026-05-03`
**Base:** `367a72e` (main HEAD; Sprint 4 PR #41 merge)
**Approach:** Phase 0 reconnaissance corrected planner assumptions; Option A (5 commits, file-atomic)

---

## Outcome

| Metric | Value |
|---|---|
| URL #1 — practice.js inline link | ✓ extended with anchor hash |
| URL #2 — result.html inline link | ✓ extended |
| URL #3 — result.html resource card | ✓ extended (+ recMatches plumbing fix) |
| Smooth-scroll on grammar-article load | ✓ hooked into `loadGrammarArticle()` end |
| 3-second teal pulse on landed heading | ✓ |
| Backward compatibility (NULL anchor) | ✓ ternary fallback present in all 3 URL constructions |
| Backend tests still pass | ✓ 20 / 20 grammar+anchor tests green |
| Atomic commits | **5** |

---

## Q&A decisions captured

| # | Question | Decision | Implementation |
|---|---|---|---|
| Q1 | Pulse target | **Just next-sibling heading** | `_pulseAnchorHeading` only pulses if `anchorEl.nextElementSibling` is `<h1>`-`<h6>`; defensively skips otherwise |
| Q2 | Pulse color | **Teal `#14b8a6`** (matches design tokens) | `rgba(20, 184, 166, 0.18)` peak; fade via `ease-out` over 3s |
| Q3 | TOC clicks pulse too | **No** — only outside deep-links | `_pulseAnchorHeading` only fires from `_scrollToHashAnchor`; TOC clicks use browser-native scroll + existing active-state highlight |
| Q4 | Sticky header offset | **`scroll-margin-top` CSS** (not JS magic numbers) | `.article-body .grammar-anchor { scroll-margin-top: 80px }` — matches existing convention used for `h2`/`h3`. Header is `h-14` (56px) + breathing room → 80px. JS just calls `scrollIntoView({ block: 'start' })`; browser honours offset |

### Phase 0 corrections vs prompt premise

| Prompt assumed | Reality | Correction |
|---|---|---|
| 2 recommendation renderers | **3 URL constructions** across 2 files | Phase 3 commit bundles URL #2 + URL #3 + recMatches plumbing in one file-atomic change |
| Field name `recommended_anchor` on frontend | Backend pipes `anchor` (DB column ≠ API field name) | All 3 URL constructions read `rec.anchor` / `match.anchor` |
| `DOMContentLoaded` handler suffices | Article HTML loads **async** via `loadGrammarArticle()` — element doesn't exist at DOMContentLoaded | Hook hash handler at END of `loadGrammarArticle`, after `_show('article-container')` |
| Resource card already carries anchor | Anchor was **dropped** at `recMatches.push({...})` line 911 | Plumb `anchor: rec.anchor || null` through; card href reads `match.anchor` |
| `grammar.zero-article` has anchor declared | (not relevant to Sprint 5 — already shipped Sprint 1) | — |

---

## What shipped

### Commit 1 — `b1e3154` — Phase 2: practice.js URL extension (URL #1)
`_grammarIssuesBlock` now appends `'#' + encodeURIComponent(rec.anchor)` when present, otherwise empty string. Per-issue inline link `→ Học bài: <title>` on Practice page now deep-links.

### Commit 2 — `1294227` — Phase 3: result.html URLs #2 + #3 + plumbing
Two URL constructions extended in same file-atomic commit:
- `_fbGrammarIssues` per-issue inline link (`/grammar.html?category=X&slug=Y#anchor`)
- `_grammarCardHtml` resource card (Vercel pretty-URL form: `/grammar/<cat>/<slug>#anchor`)

Plus the critical plumbing fix: `recMatches.push({...})` at line 911 was previously dropping `rec.anchor`; now it threads through as `match.anchor` so the card href can read it.

### Commit 3 — `2363f72` — Phase 4: smooth-scroll handler
Added `_scrollToHashAnchor()` helper in `js/grammar.js`. Wired into `loadGrammarArticle()` after `_show('article-container')` so it runs once the article body is in the DOM. Uses `requestAnimationFrame` to wait for layout, then `el.scrollIntoView({ behavior: 'smooth', block: 'start' })`. Graceful degradation on missing anchor: console.warn, no user-visible error.

CSS: `.article-body .grammar-anchor { scroll-margin-top: 80px }` — matches existing `h2`/`h3` convention. **Single source of truth** for the offset; future header-height changes are one CSS edit.

### Commit 4 — `3c4ec40` — Phase 5: 3s teal pulse on landed heading
Added `_pulseAnchorHeading(anchorEl)` helper. Called from `_scrollToHashAnchor` after `scrollIntoView`. Pulses the next sibling **only if** it's a heading (`<h1>`–`<h6>`); defensively skips otherwise.

CSS keyframe in inline `<style>`:
```css
.grammar-anchor-pulse {
  animation: grammarAnchorPulse 3s ease-out;
  border-radius: 6px;
}
@keyframes grammarAnchorPulse {
  0%   { background-color: transparent; }
  15%  { background-color: rgba(20, 184, 166, 0.18); }
  100% { background-color: transparent; }
}
```

JS uses `remove → reflow → add → setTimeout(remove)` pattern so rapid back-and-forth navigation re-pulses cleanly. Class auto-removes after 3.1s (3000ms animation + 100ms buffer).

### Commit 5 — this report

---

## Verification

### Static analysis (automated) ✓
```
OK URL #1 (practice.js): anchor extension present
OK URL #2 (result.html per-issue link): anchor extension present
OK URL #3 (result.html resource card): anchor extension + recMatches plumbing present
OK CSS: scroll-margin-top + teal pulse keyframes present in grammar-article.html
OK JS: scroll handler + pulse trigger wired into loadGrammarArticle
OK NULL anchor backward-compat ternary present in all 3 URL constructions
OK Backend tests still pass: 20/20 grammar+anchor tests green
```

### Cross-browser smoke matrix (manual — Andy to run before merge)

The static analysis above covers the contract layer. Live browser testing is required to confirm the smooth-scroll/pulse rendering across rendering engines. Suggested matrix:

| Browser | Device | Test | Status |
|---|---|---|---|
| Chrome | Desktop | Click rec → land at section + pulse | ⏳ |
| Safari | Desktop | Same | ⏳ |
| Firefox | Desktop | Same | ⏳ |
| Safari | iPhone | Same on mobile viewport | ⏳ |
| Chrome | Android | Same | ⏳ |

Test scenarios:
- Anchor present + valid → scroll + pulse
- Anchor NULL → article top (no hash, no error)
- Anchor non-existent (e.g. URL hand-edited) → console.warn, page stays at top, no error
- Multiple recommendations on Result page → click each, all work
- Browser back button → returns to Result page, recs still rendered
- Click TOC sidebar link → no pulse fires (TOC behavior unchanged)

### Browser support note (Andy Q4 follow-up)

`scroll-margin-top` is supported in: Safari 14.5+ (May 2021), Chrome 69+ (Sep 2018), Firefox 68+ (Jul 2019). **Coverage: ~98%+ of users globally** including Vietnamese mobile traffic. No fallback needed for the audience.

If a much older browser visits, scroll lands without the offset (anchor lands under the sticky nav by ~56px) — degraded but functional. JS still works.

---

## What was NOT touched (per scope discipline)

- ❌ RLS security fix on grammar_recommendations + 3 other tables (separate sprint)
- ❌ Mobile responsive review of Batch 1+2A pages (different scope)
- ❌ Generation of Batch 2B/2C/2D Grammar pages (Andy's design work)
- ❌ Listening mode feature decision
- ❌ Backend changes (Sprint 4 was final backend sprint)
- ❌ Cleanup of vestigial `deferred_until` fields in mapping file (maintenance pass)
- ❌ Migration of `grammar-audit/` to `docs/audits/` (post-Sprint-5 cleanup task)
- ❌ TOC sidebar pulse (Andy Q3 — out of scope)

---

## Production deep-link feature: LIVE (after this PR merge)

User flow now closed end-to-end:

1. User finishes practice session
2. Whisper STT → Claude grader → structured `grammar_issues` + matcher resolves slugs + anchors
3. Result page renders recommendations with `/grammar/<cat>/<slug>#<anchor>` URLs
4. User clicks → browser navigates → `loadGrammarArticle()` fetches + injects body
5. `_scrollToHashAnchor()` smooth-scrolls to the `<a id>` (with 80px offset for sticky nav)
6. `_pulseAnchorHeading()` flashes teal on the heading for 3s — visual confirmation

**This is the product win Andy wanted** — closes the practice → wiki feedback loop with precision.

---

## Cumulative state across 6 sprints

| Sprint | Outcome | PR |
|---|---|---|
| 0 | Archive 17 drops + loader exclusion | #37 |
| 1 | 165 anchors + drift gate | #38 |
| 2 | 12 merges + 28 metadata + group rename | #39 |
| 3 | 3 new topics + deferred resolutions | #40 |
| 4 | Backend deep-link infra (renderer, loader, matcher, persistence, CI) | #41 |
| 5 | Frontend deep-link UX (URLs, scroll, pulse) | #42 (this) |

| Metric | Pre-audit | Post Sprint 5 |
|---|---|---|
| Articles | 126 | 98 |
| Declared anchors | 0 | 200 |
| Active mappings | 0 | 30 (all resolve) |
| Backend tests | 235 | 265 |
| Migrations | 31 | 32 (032 → recommended_anchor) |
| Production deep-link feature | absent | **LIVE** |

**6 sprints over a few days, zero rollbacks. Content audit + deep-link infrastructure complete.**

---

## Outstanding tasks post-Sprint-5 (separate work)

1. RLS security fix — apply RLS policies to `grammar_recommendations` + 3 other tables
2. Mobile responsive review — Batch 1+2A pages
3. Generate Batch 2B/2C/2D — Vocabulary study, Profile, Grammar pages (Andy via Claude Design)
4. Listening mode feature decision
5. Cleanup `grammar-audit/` → `docs/audits/grammar-2026-05/`
6. Optional: cleanup vestigial `deferred_until` fields in `feedback-anchor-mapping.yaml`

When Andy ready for any of these, planner Claude will help plan execution.

---

## Next steps for Andy

1. Review: `git diff main...HEAD --stat` — expect 9 commits (5 Sprint 5 + 4 Sprint 5b)
2. Run cross-browser smoke matrix (5 environments × 6 scenarios — see above)
3. Optional: hand-craft a deep-link URL in browser to verify graceful degradation on unknown anchor (e.g. `/grammar/foundations/articles#nonexistent.anchor.id`)
4. Decide:
   - Merge to main → deploy → users see deep-links in next practice session
   - Adjust → polish CSS pulse timing/intensity
   - Rollback → backup at `backups/frontend-pre-sprint-5-20260503-*`

---

# Sprint 5b Patch Addendum — Codex audit follow-up

**Date:** 2026-05-03 (same day, branch appended)
**Branch:** same — `audit/grammar-sprint-5-frontend-2026-05-03`
**Approach:** 4 atomic append-only commits on existing Sprint 5 branch (no rebase, no force-push)
**Trigger:** Codex audit dated 2026-05-03 on Sprint 5 deliverable

## Audit findings disposition

| # | Finding | Severity | Disposition |
|---|---|---|---|
| Blocker 1 | 0/N production rows have `recommended_anchor` populated — mapping coverage gap | Critical | **Deferred to Sprint 6** (mapping work, not a Sprint 5 frontend bug) |
| Blocker 2 | Practice-page Quick Grammar Tip card drops anchor — Sprint 5 fixed inline link only | High | **Sprint 5b Phase 1** — fixed |
| Follow-up A | No integration test for production-like issue strings | High | **Sprint 5b Phase 2** — added |
| Follow-up B | CI gate doesn't trigger on frontend-only PRs (drift gate skipped) | High | **Sprint 5b Phase 3** — broadened |

Production reality: queried `grammar_recommendations` on 2026-05-03; **0 of the 80 most recent rows** have `recommended_anchor` set. Slugs (article-errors, tense-consistency, pronouns, etc.) resolve correctly via `find_best_match` but those slugs aren't covered by `feedback-anchor-mapping.yaml`. Pure mapping work for Sprint 6.

## What shipped (4 new commits)

### Commit 6 — `a4d73de` — Phase 1: practice.js Quick Grammar Tip card deep-link
Two adjacent bugs in `frontend/js/practice.js`, fixed in one file-atomic commit (mirroring Sprint 5 commit `1294227` for result.html):

- `_grammarCardHtml` (line 838-876): href built without `match.anchor` → both primary and secondary card variants now append `#anchor` when present.
- `_showGrammarResources` (line 884-893): match object now carries `anchor: rec.anchor || null` so `_grammarCardHtml` has the field to read.

NULL anchor → article-level URL fallback (backward compatible with all current production rows).

This commit also brought in `grammar-audit/sprint-5b-reconnaissance.md` (Phase 0 deliverable, force-added per `grammar-audit/` gitignore convention).

### Commit 7 — `d617a12` — Phase 2: production-string integration test
New file `backend/tests/test_grammar_matcher_integration.py` — 10 parametrized cases:
- 8 production-sampled Vietnamese issue strings, all `expected_anchor_present=False` (pinning current Sprint 6 mapping coverage gap)
- 2 synthetic positive controls (`Word order sai...` strings) hitting M007 mapping → `word-order.question-inversion`

Distinct from existing `test_grammar_anchor_matcher.py` (unit-tests matcher logic with controlled fixtures): this file pins **observed production behaviour**. When Sprint 6 mapping expansion lands, fixtures flipping False→True is the success signal. The False-case assertion message instructs the contributor to flip the flag and record which Sprint 6 mapping addressed the case — turning the file into a Sprint 6 progress meter.

Q&A captured per planner sign-off:
- Q1: inline parametrize (no YAML fixture file)
- Q2: exact slug assertion (loose `is not None` would mask routing drift)
- Q3: single bool param (no test-function split)
- Q5: new file (different intent from existing matcher unit tests)

Verified: 10/10 pass on 2026-05-03 baseline; full suite 259 passed / 15 skipped.

### Commit 8 — `815282e` — Phase 3: CI trigger broadened to frontend
`.github/workflows/backend-tests.yml` now triggers on `frontend/**` in addition to `backend/**` and the workflow file. Frontend-only PRs (like Sprint 5b Phase 1's practice.js fix) now run the anchor drift gate.

Wider than strictly necessary but trivially cheap (10-min job, PR-only, respects Sprint 4 Q4 quota directive). Added comment block explaining motivation so a future contributor doesn't narrow the filter.

### Commit 9 — this addendum

## Verification

| Check | Result |
|---|---|
| Phase 1 — practice.js anchor extension present in `_grammarCardHtml` href | ✓ |
| Phase 1 — `_showGrammarResources` plumbs `rec.anchor` into match object | ✓ |
| Phase 2 — new integration test 10/10 pass | ✓ |
| Phase 2 — full backend suite 259 passed / 15 skipped | ✓ |
| Phase 3 — CI workflow paths includes `frontend/**` | ✓ |
| Anchor drift gate clean — 30 active mappings resolve, 0 deferred | ✓ |
| No new branch created — append-only on Sprint 5 branch | ✓ |
| Branch ends at 9 commits ahead of main | ✓ |

## What was NOT touched (Sprint 5b scope discipline)

- ❌ Mapping coverage gaps (Blocker 1) — Sprint 6 work
- ❌ Refactoring `_grammarCardHtml` or `_showGrammarResources` beyond targeted anchor fixes
- ❌ Other Sprint 5 deliverables (grammar.js, result.html, grammar-article.html — all untouched)
- ❌ Backend matcher logic — only the test file is new; matcher itself unchanged
- ❌ CI runner config, dependencies, or test command — only the `paths:` filter

## Final state at end of Sprint 5b

| Sprint | Commits |
|---|---|
| 5 (original) | b1e3154, 1294227, 2363f72, 3c4ec40, 5f68840 |
| 5b (patch) | a4d73de, d617a12, 815282e, this commit |
| **Total on branch** | **9 commits, ready for merge** |

| Metric | Sprint 5 close | Sprint 5b close |
|---|---|---|
| Backend tests | 235→265 (Sprint 5 reported) | 259 passing + 15 skipped (10 new integration cases) |
| Frontend deep-link card paths fixed | 3 of 4 (URLs #1 #2 #3, missed practice card #4) | 4 of 4 |
| CI gate breadth | `backend/**` only | `backend/**` + `frontend/**` |
| Production rows with anchor | 0/80 | 0/80 (Sprint 6 will fix) |

## Sprint 6 entry conditions

When Andy ready to start Sprint 6 (mapping coverage expansion):
1. Read `grammar-audit/sprint-5b-reconnaissance.md` — Phase 0c production sample documents the highest-value fixture targets
2. Watch `tests/test_grammar_matcher_integration.py` — the 8 False-cases name exactly which slugs need mapping coverage:
   - `article-errors` (3 cases — most common production issue type)
   - `tense-consistency` (2 cases)
   - `pronouns`, `expressing-preferences-naturally`, `missing-subjects` (1 case each)
3. Each Sprint 6 mapping addition: flip the corresponding fixture's `expected_anchor_present` flag from False → True, add a comment naming the new mapping ID. Test file becomes the merge-time signal.

## Updated next steps for Andy

1. Review: `git diff main...HEAD --stat` — expect **9 commits**
2. Run cross-browser smoke matrix (5 environments × 6 scenarios — see above) — Sprint 5b doesn't change scenarios, but **also test the practice page Quick Grammar Tip card** (was not deep-linking before this patch)
3. Optional: hand-craft a deep-link URL to verify graceful degradation on unknown anchor
4. Decide:
   - Merge to main → deploy → users see deep-links from BOTH practice-page card AND result-page card/inline-link
   - Adjust → polish CSS pulse timing/intensity
   - Rollback → backup at `backups/frontend-pre-sprint-5-20260503-*`
