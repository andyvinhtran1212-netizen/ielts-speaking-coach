# Access-Codes "+ Tạo mã mới" Overflow — Fresh Empirical Investigation

**Date:** 2026-05-26 · **Auditor:** Code · **Method:** deployed-artifact fetch + diff + full cascade trace
**Headline:** All three prior fixes are **live and byte-identical to repo HEAD**; the current
deployed CSS has **no remaining horizontal-overflow mechanism** for the button. Most-likely residual
cause = **browser/edge CSS cache of the pre-fix state**. No further code fix recommended — verify with a
hard refresh.

---

## §1 — Prior 3 hypotheses + outcomes (factual recap)

| Sprint | Hypothesis | Fix | Deployed? (verified) | Was it the cause? |
|---|---|---|---|---|
| 18.3.1 #301 | content-box → overflow | `*{box-sizing:border-box}` | ✅ live | Partial — real (fixed the filter-input padding cascade) |
| 18.3.1.1 #302 | header missing flex-wrap | `.adm-btn-* {white-space:nowrap}` + `.co-detail-head` wrap | ✅ live | Fixed **cohorts**, not access-codes (premise was about cohorts) |
| 18.3.1.2 #303 | non-shrinkable filter child | `.ac-filter {flex:1 1 160px; min-width:0}` + control caps | ✅ live | Real + correct — removed the last child-shrink blocker |

Each fix was correct-but-partial; cumulatively they address every structural cause found. (Pattern #42 note: #302's commission premise — "`.ac-toolbar` missing flex-wrap" — was empirically false; `.ac-toolbar` already wrapped. Logged in #303.)

## §2 — Empirical data gathered (this investigation)

Fetched from `https://www.averlearning.com` (production):

| Artifact | HTTP | Server | Deployed vs repo HEAD |
|---|---|---|---|
| `/pages/admin/access-codes/index.html` | 200 | **Vercel** | **diff = 0 (identical)** |
| `/css/aver-design/admin-components.css` | 200 | Vercel | current — has `box-sizing:border-box`, `white-space:nowrap`, `.adm-banner.is-success` (#304) |
| `/js/components/aver-admin-chrome.js` | 200 | Vercel | current |
| `/pages/admin/students/index.html` | 200 | Vercel | diff = 0 (#304 live) |

**Pattern #42 / doc correction:** production is served by **Vercel** (`server: Vercel`, `x-vercel-cache`), not GitHub Pages. The memory note "frontend = GitHub Pages NOT Vercel" (cluster-17 discovery) is **stale/wrong** and is corrected.

## §3 — Deployed vs repo diff

`diff(deployed access-codes, repo HEAD) = 0 lines`. **No Vercel transform, no HTML minification, no stale deploy.** The deployed page contains: `flex: 1 1 160px` (#303 ×1), `min-width: 0` (×3), `.ac-toolbar … flex-wrap: wrap`, the `admin-components.css` link. Every fix is live.

## §4 — Full button-positioning cascade (great-grandparent → button)

| Level | Element | Key layout rules (deployed) | Overflow risk |
|---|---|---|---|
| GGP (shadow) | `.admin-body` | `display:grid; grid-template-columns:240px 1fr` (no column-gap) | none — `1fr` track |
| GP (shadow) | `.content` | `padding:var(--av-space-6); min-width:0` (no `width:100%`) | none — `min-width:0` lets the track shrink; width auto/stretch keeps padding inside the track |
| P (light, slotted) | `main.ac-shell` | `max-width:1180px; margin:0 auto; padding:24px; display:flex; flex-direction:column` | none — border-box (light-DOM reset), capped + centered |
| self | `.ac-toolbar` | `display:flex; flex-wrap:wrap; justify-content:space-between; align-items:flex-end` | **wraps** — button drops to a new line if it can't fit |
| sibling | `.ac-filter-bar` | `flex:1 1 auto; min-width:0; flex-wrap:wrap` | shrinkable + wraps internally |
| sibling child | `.ac-filter` | `flex:1 1 160px; min-width:0` | shrinkable below 160px |
| control | `.ac-filter select/input` | `width:100%; min-width:0; max-width:100%` | a long `#filter-cohort` option **truncates**, never widens the column |
| button | `#btn-create.adm-btn-primary` | `white-space:nowrap` | label never wraps; button stays one unit |

**Math:** button right edge = viewport − 24px (`.content` pad) − 24px (`.ac-shell` pad) = **viewport − 48px** (more if the shell is centered under its 1180px cap). The button is structurally ≥48px inside the viewport's right edge.

## §5 — JS runtime inline-style audit

`grep '.style.' admin-access-codes.js` → **0**. No script applies `width`/`min-width`/inline styles at runtime. Hypothesis "JS sets inline width on the toolbar" (h-alt-2) is **ruled out**.

## §6 — Viewport threshold analysis

Because the toolbar wraps and every child is shrinkable, **no viewport width produces horizontal overflow**:
- **Wide (≥~1320px content):** `.ac-shell` caps at 1180px; toolbar fits one row; button flush-right within shell padding.
- **Narrow:** `.ac-filter-bar` shrinks (filters wrap internally); if still tight, the button **wraps to its own row** (`.ac-toolbar` flex-wrap) — no horizontal overflow.

There is **no threshold** at which the button leaves the viewport. (At a 2560-class display the content track is wide; overflow is even less plausible.)

## §7 — Three alternative hypotheses (ranked, decoupled from the prior 3)

1. **(HIGH) Browser / Vercel-edge CSS cache of the pre-#303 (or pre-#301) state.** CSS changes are classically masked by cached stylesheets. Production responses show `x-vercel-cache: HIT`; a browser hard-cache compounds it. The deployed CSS is now correct, so a stale local copy is the most parsimonious explanation for "fixed in repo, still broken in Andy's view." **Test:** hard refresh (Cmd+Shift+R) / disable-cache reload, then re-check.
2. **(MEDIUM) Perception, not viewport overflow.** `justify-content: space-between` pins the button to the right *content* edge (48px inside the viewport). With a wide filter row it can look cramped/"at the edge" without overflowing. **Test:** `#btn-create.getBoundingClientRect().right` vs `window.innerWidth` — expect ≥48px gap. **Optional cosmetic tweak** (only if Andy wants breathing room): drop `justify-content: space-between` on `.ac-toolbar` (→ `flex-start`) so the button sits beside the filters rather than hard-right.
3. **(LOW) DPI/zoom or a *different* overflowing element.** A non-100% browser zoom, or the wide table (it scrolls inside `.adm-table-wrap`, but mis-perception is possible), could read as "overflow near the button." **Test:** `document.scrollingElement.scrollWidth <= clientWidth`; if `>`, find the actual node — the cascade shows it is **not** the button.

## §8 — Recommended next step

**No further code fix.** The structural causes are all addressed and deployed. Recommend Andy:
1. **Hard refresh** access-codes (clears the most likely cause, h-alt-A) and confirm.
2. If it persists: one-line DevTools dump — `var b=document.getElementById('btn-create').getBoundingClientRect(); ({right:b.right, vw:innerWidth, scrollW:document.scrollingElement.scrollWidth})` — which shows either the gap (resolved) or the *actual* overflowing node.
3. Otherwise **accept defer** (Andy already chose to move on). h-alt-B's cosmetic preference, if wanted later, is a trivial `justify-content` change, not a bug fix.

**Pattern #45 (new):** when N sequential fixes "don't resolve," stop attempting N+1 and run a fresh empirical pass (fetch deployed, diff, full cascade). Here it revealed the fixes were *already live and sufficient*, redirecting the question from "what's the 4th CSS cause" to "is the user seeing cached CSS."
