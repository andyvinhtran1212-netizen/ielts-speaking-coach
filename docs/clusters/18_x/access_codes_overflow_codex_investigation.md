# Independent Codex Investigation — Access-Codes “+ Tạo mã mới” Overflow

**Date:** 2026-05-26  
**Auditor:** Codex  
**Method:** deployed-artifact fetch + repo diff + live reproduction + source/cascade audit

## Executive summary

I did **not** find deploy drift, CSS minification drift, or JavaScript runtime styling overrides. Production `access-codes/index.html`, `admin-components.css`, `tokens.css`, `admin-access-codes.js`, and `aver-admin-chrome.js` are byte-identical to repo HEAD.

The overflow/clipping problem is still reproducible on the live page in a narrower Chrome viewport. That means the next investigation should **stop treating this as a child-selector micro-fix problem** and instead treat it as a **layout-budget / breakpoint / parent-container problem** inside the aver-admin chrome shell.

This report deliberately does **not** continue the prior 3 hypothesis chains. It steps back and documents what those attempts proved, what they did **not** prove, and where the remaining structural uncertainty still lives.

---

## 1. Prior 3 failed hypotheses recap (factual only)

| Sprint | Hypothesis family | Shipped change | Status now | What it actually proved |
|---|---|---|---|---|
| 18.3.1 / PR #301 | `box-sizing: content-box` overflow | shared reset in [frontend/css/aver-design/admin-components.css:16-23](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/css/aver-design/admin-components.css:16) | Live | Useful hardening, but not sufficient |
| 18.3.1.1 / PR #302 | button text wrap / cohorts flex-wrap | `.adm-btn-* { white-space: nowrap; }` at [frontend/css/aver-design/admin-components.css:60-62](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/css/aver-design/admin-components.css:60) + cohorts-specific wrap elsewhere | Live | Fixed a different layout family; did not close access-codes |
| 18.3.1.2 / PR #303 | non-shrinkable `.ac-filter` child | `.ac-filter { flex: 1 1 160px; min-width: 0; }` and control caps at [frontend/pages/admin/access-codes/index.html:54-77](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/access-codes/index.html:54) | Live | Improved the toolbar, but did not eliminate the repro Andy reported |

Important pattern note:
- The prior test file [frontend/tests/sprint-18-3-1-2-toolbar.test.mjs](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/tests/sprint-18-3-1-2-toolbar.test.mjs:4) hardens the narrative that hypothesis family #3 found “the real cause.” That is too strong given the bug still reproduces on live production.

---

## 2. Empirical data gathered

### 2.1 Deployed artifacts fetched

Fetched from production:

- `https://www.averlearning.com/pages/admin/access-codes/index.html`
- `https://www.averlearning.com/css/aver-design/admin-components.css`
- `https://www.averlearning.com/css/aver-design/tokens.css`
- `https://www.averlearning.com/js/admin-access-codes.js`
- `https://www.averlearning.com/js/components/aver-admin-chrome.js`
- `https://www.averlearning.com/pages/admin/students/index.html` (for Part A shipped-state verification)

### 2.2 Diff result

All deployed artifacts above are byte-identical to repo HEAD.

Implication:
- **This is not a Vercel transform/minification drift issue.**
- **This is not a stale repo-vs-production mismatch.**

### 2.3 Live reproduction

Using live production `https://www.averlearning.com/pages/admin/access-codes/index.html` in Chrome:
- the page loads and data renders;
- the “+ Tạo mã mới” button remains present in the accessibility tree;
- in a narrower viewport / DevTools-docked state, the right-edge clipping issue is still visually reproducible.

Implication:
- the bug is real on the shipped artifact;
- the remaining cause is layout/runtime context, not local source drift.

### 2.4 What I did **not** get

I attempted a browser-side computed-style dump via DevTools console, but could not reliably harvest the serialized JSON back through the accessibility tooling in this pass. So the cascade table below is derived from the **deployed source and shadow CSS**, plus live repro, not from a pixel-perfect console export.

---

## 3. Diff analysis (deployed vs repo)

### `frontend/pages/admin/access-codes/index.html`
- Live page still contains the current toolbar structure and PR #303 shrink logic at [47-77](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/access-codes/index.html:47).
- Button remains at [153](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/access-codes/index.html:153).

### `frontend/css/aver-design/admin-components.css`
- Live CSS contains the shared border-box reset at [23](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/css/aver-design/admin-components.css:23).
- Live CSS contains `white-space: nowrap` on `.adm-btn-*` at [62](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/css/aver-design/admin-components.css:62).

### `frontend/js/admin-access-codes.js`
- Live JS matches repo and does not inject width/min-width styles at runtime.

### `frontend/js/components/aver-admin-chrome.js`
- Live shadow component matches repo and still wraps slotted page content inside `.content` at [540-552](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/components/aver-admin-chrome.js:540).

Conclusion:
- **The live problem is not explained by deploy drift.**

---

## 4. Full cascade audit table

The commission asked for the ancestor chain around `button#btn-create.adm-btn-primary`. The table below follows the shipped DOM and shipped CSS.

| Level | Node | Key shipped rules | Notes |
|---|---|---|---|
| 0 | `html` | No page-specific rule in `access-codes/index.html` | UA default block root |
| 1 | `body.av-page` | `font-family: var(--av-font-sans); margin: 0;` at [32](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/access-codes/index.html:32) | No `overflow-x` override |
| 2 | `<aver-admin-chrome active="access-codes">` | `:host { display:block; --admin-sidebar-w:240px; }` at [67-73](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/components/aver-admin-chrome.js:67) | Open shadow root host; no direct styling of button |
| 3 | shadow `.admin-body` | `display:grid; grid-template-columns: var(--admin-sidebar-w) 1fr; min-height: ...` at [173-180](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/components/aver-admin-chrome.js:173) | Content sits in the `1fr` track |
| 4 | shadow `main.content` | `padding: var(--av-space-6); background: ...; min-width: 0;` at [302-306](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/components/aver-admin-chrome.js:302) | This is the first width budget squeeze on slotted content |
| 5 | light `main.ac-shell` | `max-width:1180px; margin:0 auto; padding:var(--av-space-6); display:flex; flex-direction:column; gap:...` at [33-37](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/access-codes/index.html:33) | Second width budget squeeze; 24px internal pad each side |
| 6 | `div.ac-toolbar` | `display:flex; gap:var(--av-space-3); align-items:flex-end; flex-wrap:wrap; justify-content:space-between;` at [47-50](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/access-codes/index.html:47) | Wrap exists already; no explicit narrow breakpoint |
| 7 | `div.ac-filter-bar` | `display:flex; gap:var(--av-space-3); flex-wrap:wrap; flex:1 1 auto; min-width:0;` at [52-53](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/access-codes/index.html:52) | Filter group can shrink and wrap |
| 8 | `div.ac-filter` | `display:flex; flex-direction:column; gap:4px; flex:1 1 160px; min-width:0;` at [54-60](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/access-codes/index.html:54) | PR #303 change is live |
| 9 | `select` / `input[type="search"]` | `width:100%; min-width:0; max-width:100%;` at [67-77](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/access-codes/index.html:67) | PR #303 control-cap is live |
| 10 | `button#btn-create.adm-btn-primary` | page markup at [153](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/access-codes/index.html:153) + shared button style at [62-70](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/css/aver-design/admin-components.css:62) | `white-space: nowrap`, no width/min-width override |

### Structural observation

By shipped CSS, the button sits inside:
- shadow `.content` with `24px` horizontal padding;
- light `.ac-shell` with another `24px` horizontal padding.

That means the toolbar is negotiating inside a content lane that loses **48px per side / 96px total** before its children even start sharing width. This is a parent-width budgeting fact, not a `.ac-filter`-only fact.

---

## 5. JS runtime audit findings

### `frontend/js/admin-access-codes.js`
- No `.style.width`, `.style.minWidth`, or `element.style = ...` layout mutations.
- The only direct `btn-create` interaction is opening the modal at [328-331](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/admin-access-codes.js:328).

### `frontend/js/components/aver-admin-chrome.js`
- No slotted-content sizing mutation.
- The only direct `document.body.style...` mutation is mobile sidebar scroll-lock at [677-688](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/components/aver-admin-chrome.js:677), unrelated to the access-codes toolbar.

Conclusion:
- **There is no evidence that JS is overriding CSS layout at runtime for this button.**

---

## 6. Shadow DOM analysis

### What the shadow root does
- Wraps page content in shadow `<main class="content"><slot></slot></main>` at [550-551](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/components/aver-admin-chrome.js:550).
- Adds grid/sidebar framing and `.content` padding.

### What the shadow root does **not** do
- No `::slotted(...)` rules.
- No button-specific selectors.
- No runtime width mutation on slotted nodes.

Implication:
- Shadow DOM is not “leaking” styles onto the button directly.
- But it **does** indirectly shape the available width by placing all light-DOM page content inside a padded `.content` wrapper inside a grid.

That makes shadow DOM relevant as a **container-budget factor**, not as a selector-leak factor.

---

## 7. Three alternative hypotheses (ranked by empirical likelihood)

### H1 — Most likely: missing deterministic narrow-width layout strategy at the toolbar level

**Why this is different from prior attempts:**  
This is not another child-shrink tweak. It is a parent-layout strategy issue.

**Evidence:**
- live artifact equals repo;
- live bug still reproduces;
- `.ac-toolbar` relies on generic `flex-wrap: wrap` + `justify-content: space-between` at [47-50](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/access-codes/index.html:47);
- there is **no page-specific breakpoint** that explicitly stacks the button below the filter group when width gets tight.

**Why likely:**  
When a layout has multiple intrinsic-width form controls plus a non-wrapping CTA, “wrap if needed” is less reliable than an explicit breakpoint. Three micro-fixes improved constraints but never changed the layout strategy itself.

### H2 — Likely: native `<select>` intrinsic width is still resisting the intended shrink behavior under real browser conditions

**Why this is different from prior attempts:**  
Prior fixes targeted the wrapper and the control cap rules; this hypothesis says the browser’s native select rendering still contributes more preferred width than the CSS narrative assumes.

**Evidence:**
- the access-codes toolbar is select-heavy (`filter-type`, `filter-status`, `filter-cohort`) at [125-150](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/access-codes/index.html:125);
- only this page combines three selects, long cohort names, and a fixed CTA in one toolbar row;
- PR #303 clearly improved conditions but did not fully remove the live repro.

**Why likely:**  
Native select controls often remain one of the hardest flex children to “shrink exactly as designed,” especially under WebKit/Chrome UI rendering and long option text.

### H3 — Plausible: the aver-admin shadow/content shell reduced the width budget enough that access-codes now needs page-specific accommodation

**Why this is different from prior attempts:**  
This is not “shadow DOM leaks styles.” It is “chrome wrapper changed the width budget.”

**Evidence:**
- shadow `.content` adds `24px` horizontal padding at [302-306](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/components/aver-admin-chrome.js:302);
- light `.ac-shell` adds another `24px` horizontal padding at [33-36](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/admin/access-codes/index.html:33);
- the button bug persisted across selector-level tweaks, which is what you expect when the remaining issue is higher up the ancestor chain.

**Why plausible:**  
The chrome shell may not be “wrong,” but it may mean this toolbar no longer has enough slack to rely on generic wrap heuristics alone.

---

## 8. Recommended next step

### Recommended path

**Do not ship a fourth micro-fix based on another child-selector hypothesis.**

Instead:
1. Run one **measured browser pass** on the live page at a few concrete viewport widths / zoom settings and capture actual `getBoundingClientRect()` values for:
   - `#btn-create`
   - `.ac-toolbar`
   - `.ac-filter-bar`
   - `.ac-shell`
   - shadow `.content`
2. Based on that measurement, choose one of two structural fixes:
   - add an explicit narrow-width breakpoint that stacks the CTA below filters, or
   - split the toolbar into two intentional rows (filters row + actions row).

### Why this is the right next step

The fresh empirical pass already ruled out:
- deploy drift;
- JS inline-style mutation;
- “missing `flex-wrap`”;
- “still on old CSS in production.”

What remains is a **layout-contract question**, not a deployment/debugging question.

### Critique of the prior approach

The first three fixes each targeted a plausible local culprit, but they all stayed inside the same diagnostic frame: “one more selector or child constraint will close it.” The live bug surviving all three attempts is a signal that the real issue is **structural width budgeting**, not another local control tweak.

That is the main blind spot this independent audit surfaced.
