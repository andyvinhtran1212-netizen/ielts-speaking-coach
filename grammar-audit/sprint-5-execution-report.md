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

1. Review: `git diff main...HEAD --stat` — expect 5 commits
2. Run cross-browser smoke matrix (5 environments × 6 scenarios — see above)
3. Optional: hand-craft a deep-link URL in browser to verify graceful degradation on unknown anchor (e.g. `/grammar/foundations/articles#nonexistent.anchor.id`)
4. Decide:
   - Merge to main → deploy → users see deep-links in next practice session
   - Adjust → polish CSS pulse timing/intensity
   - Rollback → backup at `backups/frontend-pre-sprint-5-20260503-*`
