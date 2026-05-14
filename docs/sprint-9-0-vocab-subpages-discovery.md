# Sprint 9.0 — Vocabulary Sub-Pages Discovery Audit

**Status:** Discovery / pending Andy decision
**Date:** 2026-05-14
**Pattern reference:** Sprint 7.1 (vocab iframe discovery), Sprint 7.9 (chrome web component discovery)
**Scope:** `my-vocabulary.html` / `flashcards.html` / `exercises.html` standalone sub-pages
**Production code changes:** NONE — pure audit + doc

---

## TL;DR

Andy's "lọt thỏm" and "không ăn nhập" perceptions are **objective**, not subjective:

1. **3 sub-pages ship a duplicated "context bar" header** with 3 different class prefixes (`.mv-header` / `.fc-header` / `.ex-header`) that resolve to byte-identical CSS — the rule-of-three trigger is **already fired**.
2. **Top spacing is excessive** — chrome bottom (64px) + context bar (~56px) + main `pt-20` (80px) = **200px before any content renders**. This is the "lọt thỏm" — content visually disconnected from chrome.
3. **3 different card classes** (`.stack-card` / `.ex-card` / `.mode-card`) share ~90% of their declarations.
4. **D3 "Speak with target" card** is at `exercises.js:88-99`, clean to delete (no JS handler dependency — `data-card="d3"` is read by `init()` but only to leave it visible; removing the markup is safe).
5. **Banner asymmetry** — `my-vocab` context bar uses `justify-between` (with Add button on the right); `flashcards` + `exercises` use `gap-4` (no right-aligned content). Different visual axis on the same surface.

**Recommendation:** **Hard refactor across 1 sprint** (not 3) — lift a shared `.subpage-header` primitive + consolidate the 3 card classes to `.mode-card`. Estimated 3-4h. Soft polish would only paper over the duplication; the visual inconsistency Andy noticed IS the duplication.

---

## Phase A — Audit findings

### Step 1: Sub-page banner pattern

All 3 modules render a "context bar" header as the first child of their template. Pattern:

```html
<header class="{PREFIX}-header {PREFIX}-context-bar px-6 py-4">
  <div class="max-w-3xl mx-auto flex items-center {LAYOUT}">
    {RIGHT_ALIGN_OPTIONAL}
    <p class="eyebrow" style="margin:0;">Vocabulary</p>
    <span class="{PREFIX}-header__sep">|</span>
    <h1 class="{PREFIX}-header__title text-base font-semibold">{TITLE}</h1>
    {ACTION_BUTTON_OPTIONAL}
  </div>
</header>
```

| File | `{PREFIX}` | `{LAYOUT}` | `{TITLE}` | Action button |
|---|---|---|---|---|
| `my-vocab.js:52-64` | `mv` | `justify-between gap-4` | `My Vocab Bank` | `<button data-action="toggle-add-form" class="mv-add-btn">…Add word</button>` |
| `flashcards.js:42-48` | `fc` | `gap-4` | `📚 Flashcards` | (none — "+ Tạo stack mới" lives inside the panel) |
| `exercises.js:33-39` | `ex` | `gap-4` | `Exercises` | (none) |

**Inconsistencies:**
- `flashcards` title carries an inline 📚 emoji prefix; `my-vocab` + `exercises` don't.
- `my-vocab` uses `justify-between` (action button on the right); other two use `gap-4` (everything left-aligned).
- Three different class prefixes (`mv`/`fc`/`ex`) on otherwise-identical markup.

### Step 2: Banner CSS — 3x duplication

The three header rule sets are byte-identical except for the prefix:

```css
/* my-vocabulary.css */
.mv-header        { background: var(--av-surface-elevated); border-bottom: 1px solid var(--av-border-subtle); }
.mv-header__sep   { color: var(--av-text-faint); }
.mv-header__title { color: var(--av-text-primary); }

/* flashcards.css */
.fc-header        { background: var(--av-surface-elevated); border-bottom: 1px solid var(--av-border-subtle); }
.fc-header__sep   { color: var(--av-text-faint); }
.fc-header__title { color: var(--av-text-primary); }

/* exercises.css */
.ex-header        { background: var(--av-surface-elevated); border-bottom: 1px solid var(--av-border-subtle); }
.ex-header__sep   { color: var(--av-text-faint); }
.ex-header__title { color: var(--av-text-primary); }
```

This is the **rule-of-three trigger already fired** — 3 instances, byte-identical CSS, ready to lift.

Each module also redefines a `.{PREFIX}-back-link` rule (5 declarations each) that is **dead code** in the current markup — there's no `<a class="…-back-link">` element rendered anywhere in the 3 templates. Likely an artifact of an earlier IA where the sub-pages had a "← Back to Vocabulary" link, retired some time after Sprint 7.3-7.5 module migration.

### Step 3: Top-spacing rhythm with chrome

Each module's `<main>` element opens with `pt-20` (80px Tailwind class). The intent (per Sprint 6.18 Cat A canonical sentinel in `chrome-spacing-canonical.test.mjs:120-148`) is to compensate for the absence of the page-level `.shell` top padding when the page mounts in a standalone shell.

**The problem:** the context bar `<header>` sits BETWEEN the chrome and the `<main>`, so the spacing stack becomes:

```
┌──────────────────────────────────────────┐
│  <aver-chrome>                            │ ← chrome (64px bottom margin from
└──────────────────────────────────────────┘    aver-chrome.js shadow style)
       64px gap
┌──────────────────────────────────────────┐
│  <header class="mv-context-bar px-6 py-4">│ ← ~56px tall (py-4 = 16+16, content ~24)
└──────────────────────────────────────────┘
       0px gap
┌──────────────────────────────────────────┐
│  <main class="…pt-20 pb-6">               │ ← 80px top padding
│                                           │
│   First content row appears here          │
└──────────────────────────────────────────┘
```

**Net distance chrome bottom → first content: ~200px.** Compare:
- vocabulary.html (parent page): chrome → eyebrow → h1, ~88px
- home.html: chrome → eyebrow → h1, ~88px
- speaking.html (post-Sprint 8.1): chrome → eyebrow → h1 → stats, ~88px

The 200px gap is what Andy is reading as "lọt thỏm" — the content visually disconnects from chrome because the dual-anchor pattern (chrome + context bar) creates an excessive top margin. The context bar duplicates information already in the chrome (the chrome's `active="vocabulary"` highlight + the page `<title>` element are both saying "Vocabulary"; the eyebrow says it a third time).

**Inconsistent pb-N closing:**
- `my-vocab.js:66` — `pt-20 pb-6` (24px bottom)
- `flashcards.js:50` — `pt-20 pb-8` (32px bottom)
- `exercises.js:41` — `pt-20 pb-8` (32px bottom)

Drift between sibling pages.

### Step 4: Card patterns audit

Three different card primitives, byte-similar shapes:

| Primitive | Defined in | Radius | Padding | Hover transform | Border-color |
|---|---|---|---|---|---|
| `.stack-card` | `flashcards.css:64` | `--av-radius-xl` | `--av-space-6` | `translateY(-3px)` *(implicit — only ease declared)* | `--av-primary-border` on hover |
| `.ex-card` | `exercises.css:59` | `--av-radius-xl` | `--av-space-6` | `translateY(-3px)` | `--av-primary-border` on hover |
| `.mode-card` (Sprint 8.1) | `speaking.css` | `--av-radius-lg` | `--av-space-6` | `translateY(-2px)` | `--av-primary-border` on hover |
| `.mode-card` (Sprint 8.2) | `vocabulary.css` | `--av-radius-lg` | `--av-space-6` | `translateY(-2px)` | `--av-primary-border` on hover |

`.stack-card` and `.ex-card` are functionally identical (only `xl` vs `lg` radius + 3px vs 2px translate differ from `.mode-card`). The visual difference between a flashcards stack card and a vocabulary mode card on `vocabulary.html` is currently noticeable — both surfaces theoretically belong to the same family but read as separate components.

**Card content shape diverges by purpose, not by visual identity:**
- `.stack-card` — stack name + due/total counts + delete button
- `.ex-card` — icon + pill + title + body + CTA
- `.mode-card` — `.head` (icon + arrow) + h3 + lede

Consolidation candidate: every card surface uses `.mode-card` outer primitive + inner-class slots; the per-page content shapes differ but the visual frame becomes unified.

### Step 5: Color + token usage

All 3 modules use canonical `--av-*` tokens. **No hardcoded hex/rgba values inside the module templates.** `--av-text-faint` cap discipline is honored in all 3 CSS files (per `vocabulary-redesign.test.mjs` cap pin).

### Step 6: my-vocab card row (additional finding)

`my-vocab.js:321` renders item cards via `cardHtml(item)` — a JS template function. Inspecting reveals each card row uses inline class hooks (`.mv-def-block` / `.mv-context` / `.mv-reason` / `.mv-action--*`) defined in `my-vocabulary.css`. These cards are **list rows** (not grid cards) and serve a different IA purpose than the stack/drill cards. They're out of the consolidation scope; Sprint 9.1+ should treat them as a distinct primitive (`.vocab-item-row` or similar).

### Step 7: D3 "Speak with target" card

Exact lines to delete in `exercises.js`:

```js
// Lines 88-99
<!-- D3: Speak with target — deferred to Phase E (was Wave 2 before pivot). -->
<div data-card="d3" class="ex-card disabled" aria-disabled="true">
  <div class="flex items-start justify-between mb-3">
    <span class="text-2xl">🎙️</span>
    <span class="ex-pill pill-soon">Coming soon</span>
  </div>
  <h3 class="ex-card__title text-base font-semibold mb-1">Speak with target</h3>
  <p class="ex-card__body text-sm">
    Record a short answer that uses a target word from your bank.
  </p>
  <p class="ex-card__cta ex-card__cta--soon text-xs mt-3">Available in a future update</p>
</div>
```

**Related code paths:**
- `exercises.js:146` — `const d3 = me.d3_enabled === true;` — read of feature flag (becomes dead code after removal).
- `exercises.js:150` — `if (!d1 && !d3 && !flashcards) { showState('disabled'); return; }` — the `!d3` clause becomes redundant when D3 has no card to show; the empty-state branch still fires correctly when no other cards are enabled.
- `exercises.js:169` — comment `// D3 stays "Coming soon" — deferred to Phase E.` — delete.

**CSS that becomes dead code:**
- `.ex-card.disabled` rule (lines 77-82 of exercises.css) — used ONLY by the D3 card. Safe to delete.
- `.ex-card.disabled:hover { transform: none; box-shadow: none; }` (line 82) — same.
- `.ex-card__cta--soon` rule (line 87) — used ONLY by the D3 card.
- `.pill-soon` rule (lines 106-110) — used ONLY by the D3 card.

**Grid layout:** the parent `<div class="grid grid-cols-1 md:grid-cols-2 gap-4">` (line 60) currently holds 3 cards (D1 + Flashcards + D3). On md+ viewports, that renders as 2 columns × 2 rows (3 cards + 1 empty cell). After D3 removal, 2 cards fit exactly in 2 columns × 1 row — cleaner.

### Step 8: Visual hierarchy issues per page

| # | Page | Issue | Severity | Fix scope |
|---|---|---|---|---|
| 1 | all 3 | Dual-anchor top: chrome + context bar = ~200px before content ("lọt thỏm") | High | Hard |
| 2 | all 3 | Three byte-identical `.{prefix}-header` rule sets — rule-of-three trigger fired | High | Hard |
| 3 | all 3 | Three `.{prefix}-back-link` rule sets are dead code (no anchor rendered) | Low | Soft |
| 4 | flashcards + exercises | `.stack-card` and `.ex-card` are functionally identical | Medium | Hard |
| 5 | all 3 vs Sprint 8.x pages | Card primitives use `xl` radius + 3px translate; canonical `.mode-card` uses `lg` + 2px | Medium | Hard |
| 6 | my-vocab | Context bar uses `justify-between` (Add button right-aligned); flashcards + exercises don't (label-only) | Medium | Soft |
| 7 | flashcards | Title carries inline 📚 emoji prefix; my-vocab + exercises don't | Low | Soft |
| 8 | my-vocab vs flashcards/exercises | Inconsistent `pb-6` vs `pb-8` on `<main>` wrapper | Low | Soft |
| 9 | exercises | D3 "Speak with target" card retired (Andy decision) | — | Standalone |
| 10 | exercises | `.ex-card.disabled` + `.ex-card__cta--soon` + `.pill-soon` rules become dead code after #9 | Low | Soft (companion to #9) |

---

## Phase B — Refactor proposals

### Option A — Soft polish (1 sprint, 2-3h)

**Scope:** treat the symptoms without consolidating the primitives.

- Standardize banner pattern across 3 modules — same `justify-between` layout, same emoji discipline (none), same `pb-N` ending.
- Tighten the top-spacing rhythm — drop `pt-20` to `pt-10` so chrome → content distance becomes ~130px (matches sibling pages within ±40px).
- Delete D3 card + its 4 orphaned CSS rules.
- Standardize the 📚 emoji handling (either all 3 carry an icon, or none does).

**Pros:** small surface, low risk. Lands in one PR.
**Cons:** does NOT fix the rule-of-three duplication. Three byte-identical `.{prefix}-header` rule sets remain. Card pattern still trifurcated. Next "lọt thỏm" report fires the same way.

**Estimate:** 2-3h.

### Option B — Hard refactor (1 sprint, 3-4h) — **RECOMMENDED**

**Scope:** lift the shared primitives once, retire the duplicates.

1. **NEW** `frontend/css/aver-design/components.css` — add a `.subpage-header` primitive replacing the 3 `.mv-header` / `.fc-header` / `.ex-header` rule sets. Inner-class skeleton: `.subpage-header__sep` / `.subpage-header__title`. The three module templates rewrite to reference the shared class.

2. **REPLACE** `.stack-card` (flashcards.css) + `.ex-card` (exercises.css) with `.mode-card` consumed from a new shared location. This is the **rule-of-three lift** flagged in Sprint 8.2 ledger ("Lifting `.mode-card` to shared location warranted if a 3rd page adopts the pattern"). The 3rd adopter is here — promote `.mode-card` from speaking.css + vocabulary.css to `frontend/css/aver-design/components.css` (or a new `modes.css`) and consume from all 4 surfaces.

3. **TIGHTEN** the top-spacing rhythm — context bar collapses into a thinner `.subpage-eyebrow` row (the eyebrow + title + optional action button at ~32px height), and `<main>` uses `pt-8` instead of `pt-20`. Net chrome → content: ~110px. Within ±20px of sibling pages.

4. **DELETE** D3 card + its 4 orphaned CSS rules.

5. **DELETE** the 3 dead `.{prefix}-back-link` rule sets.

6. **STANDARDIZE** banner across 3 modules — drop 📚 emoji from flashcards title; consistent `justify-between` layout (with or without action button on the right per page); consistent `pb-8` ending.

**Pros:**
- Fires the rule-of-three lift that Sprint 8.2 ledger predicted.
- Cures the "lọt thỏm" structurally, not cosmetically.
- Net CSS LOC reduction: ~120 lines (3 byte-identical header sets + 3 dead back-link sets + 2 byte-similar card sets + D3 orphans).
- Aligns 4 pages (speaking.html + vocabulary.html + flashcards.html + exercises.html + my-vocabulary.html) on a single `.mode-card` primitive.
- Future sub-page adopters get the primitives for free.

**Cons:**
- Higher test churn — pins in `vocab-module-loader.test.mjs` + `chrome-spacing-canonical.test.mjs` (Cat A wrapper pt-20) need flipping.
- Mode-card lift requires the speaking + vocabulary `.mode-card` definitions to be deleted and consumed from the shared location (cross-file edits).

**Estimate:** 3-4h.

### Option C — 3 sequential hard refactor sprints (5-8h total)

**Scope:** one sub-page per sprint. Sprint 9.1 my-vocab, 9.2 flashcards, 9.3 exercises.

**Pros:** smallest blast radius per PR. Easier per-PR review.
**Cons:** **anti-pattern.** A consolidation refactor is by definition cross-cutting — splitting it three ways means the shared primitive lands at sprint 9.1, sprint 9.2 lifts again, sprint 9.3 retires the redundant copies. Three PRs for a job that one PR resolves more cleanly. Each interstitial sprint leaves the codebase in a half-lifted state.

**Estimate:** 5-8h (with significant overhead vs Option B's single-sprint estimate).

---

## Recommendation

**Option B — Hard refactor in 1 sprint.**

The visual inconsistency Andy observed is structurally caused by the duplication (rule-of-three already fired) + the dual-anchor top spacing (mechanically measurable at ~200px chrome→content). Soft polish (Option A) papers over both symptoms without addressing either cause. Splitting into 3 sprints (Option C) introduces unnecessary intermediate states.

**Estimated effort:** 3-4h. **Test churn:** ~15 pin flips (CSS-class roster + chrome-spacing Cat A wrapper top-padding adjustments). **Risk:** low — `.mode-card` is already proven on 2 pages; `.subpage-header` is straightforward lift; D3 deletion is standalone.

---

## Phase D — Andy decisions needed

1. **Option A (soft) vs Option B (hard) vs Option C (split sprints)?**
   - My recommendation: **Option B** (rationale above).

2. **`.subpage-header` lift location** — `components.css` (smaller surface, no new file) or a new `subpage-shell.css` (semantic separation)?
   - My recommendation: **`components.css`** — single foundation file, easier to grep for "all sub-page primitives in one place".

3. **`.mode-card` lift location** — `components.css` (alongside `.subpage-header`) or a new `modes.css` (semantic separation, possible future home for other mode-related primitives)?
   - My recommendation: **`components.css`** for now. Move to dedicated `modes.css` only when a 3rd unrelated mode-family primitive emerges.

4. **Banner action-button policy** — should every sub-page banner carry an action button (with no-op or "Add stack" / "Add drill" / "Add word" affordances), or should the right-side action be optional per page?
   - My recommendation: **optional**. Force-feeding actions creates phantom UI.

5. **flashcards 📚 emoji on title** — drop (per visual consistency with my-vocab + exercises) or keep (per its current "iconography role" reading)?
   - My recommendation: **drop**. The chrome's `active="vocabulary"` highlight + the eyebrow already anchor the IA position; the title emoji is redundant.

6. **Top-spacing target** — match sibling pages (~88px chrome→content) or compromise at ~110px (room for the context bar's eyebrow row)?
   - My recommendation: **~110px** — preserves the "Vocabulary | {title}" sub-page anchor that Andy explicitly mentioned wanting to keep.

7. **Apply `.subpage-header` to speaking sub-pages too** (practice.html / result.html / full-test-result.html)?
   - **Out of scope for Sprint 9.1.** Flag for Sprint 9.2 if Option B lands cleanly. Speaking sub-pages currently use `.practice-header` / `.result-header` / `.ftr-header` — another 3x duplication candidate, but with distinct content shapes (band scores, session metadata) that may NOT collapse cleanly into the vocab-sub-page primitive. Separate audit needed.

8. **D3 dead-code cleanup** — companion to D3 markup deletion, OR separate follow-up sprint?
   - My recommendation: **companion**. The 4 orphaned CSS rules are clean to identify and remove in the same patch; deferring creates dead-code drift.

---

## Out of scope (defer to later sprints)

- `.vocab-item-row` (the my-vocab list-row pattern) — its content shape is fundamentally different (status pills + def-block + action links) and doesn't belong in the same family as `.mode-card`. Sprint 9.x can address this separately.
- Speaking sub-pages (`practice.html` / `result.html` / `full-test-result.html`) header consolidation — separate IA audit needed.
- Grammar sub-pages (`grammar-article.html` / `grammar-roadmap.html` / `grammar-search.html` / `grammar-compare.html`) — they use `.gw-subnav` per Sprint 8.3 decision and a separate editorial sub-system.
