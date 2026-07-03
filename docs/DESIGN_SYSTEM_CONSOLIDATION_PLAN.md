# Design-System Consolidation Plan (deferred audit items A1–A6)

**Date:** 2026-07-03 · **Source:** AUDIT_STRUCTURE_DESIGN_2026-07-03 §A · **Status:** plan (not executed)

## Scope
- **Surfaces:** whole student app (105+ pages) + admin, with focus on the post-pivot surfaces (Reading exam, Listening, Vocab Wiki) that "opted out" of `--av-*`.
- **Primary modes:** (1) **cross-surface alignment** — pull post-pivot surfaces back onto the canonical `--av-*` system; (2) **primitive governance** — collapse 5 button / 7 modal / 2 admin-kit families and set rules so fragmentation can't recur.
- **Shared goal:** one token system, one type scale per role, canonical primitives, and a CI guard that keeps them canonical — without visually regressing 29+ live pages.

## Verified current state (2026-07-03)
| System | Adoption | Verdict |
|---|---|---|
| `--av-*` (`aver-design/tokens.css`) | **112 pages**, dual-theme | ✅ canonical |
| `--ds-*` (`ds.css`) | 20 pages | legacy; **already aliases → `--av-*` under `[data-theme=light]`** (ds.css:95-107); `:root` dark values are dark-only literals |
| `design-system/tokens.css` (`--color-*`) | **0 pages** | dead fork; README still mandates it → **archive** |
| `--exam-*` (`reading-exam.css`) | 3 pages | **82 hex / 4 tokens** — flagship offender, dark-theme-impossible |
| `--ielts-*` (`ielts-test-paper.css`) | 1 page | intentional Cambridge skin — keep, document |
| Tailwind overlay | 51 pages | keep; `tailwind.build.css`+`.inter.css` are CI staleness-gated |
| `vocab-wiki.css` | 2 pages | 207 tokens / 2 hex — **already tokenized**; only issue is undocumented Fraunces/Hanken/DM-Mono fonts |
| `vocabulary.css` | 11 pages | 132 tokens / 1 hex; **10 Listening pages borrow it** (coupling) |

**Buttons:** `btn-primary` (52 files, de-facto) · `av-button` (2, "official" but unused) · `aw-btn` (9) · `adm-btn` (9) · `exam-btn` (1).
**Modals:** 7 live families (`av/adm/aw/wd/wr/exam/fc-modal`).
**Safety net that already exists:** frontend `node --test` suite pins tokens (`undefined-token-sentinel`, `theme-toggle`, `*-redesign` tests) — a real regression tripwire we lean on throughout.

---

## Governance rules (decide FIRST — these prevent recurrence)
The root cause is that new surfaces had no enforced rule to use `--av-*`. Lock these before/while migrating:
1. **One token namespace:** `--av-*` is the only sanctioned token layer. `--ds-*` is frozen (no new usage); `--exam-*`/`--ielts-*` are surface-local skins that must be *built from* `--av-*` values, not raw hex.
2. **No new hex in shared/page CSS:** color must be `var(--av-*)`. Skin files may define a *small, named* local palette but must derive from tokens.
3. **Primitive promotion rule:** a visual pattern used by ≥2 surfaces becomes an `--av-`/`.av-*` primitive; one-surface UI stays product-local (e.g. the Cambridge exam skin).
4. **CI enforcement:** add a lint test (extend `undefined-token-sentinel.test.mjs`) that **fails a PR if changed CSS adds a new hex literal or a new `--xxx-` namespace** outside an allowlist. This is the single highest-leverage item — it makes every later phase self-policing.
5. **Ownership:** token/primitive changes go through the `aver-design/` files + a test update; page CSS may only *consume*.

**Accessibility baseline (applies to every migrated token):** each `--av-*` color pair must hold WCAG AA (4.5:1 text) in **both** themes; focus rings and `prefers-reduced-motion` posture inherited from `aver-design`. Contrast **verification** of any new/retuned token → route to `web-accessibility`.

---

## Phased roadmap (low → high visual-regression risk)

### Phase 0 — Governance + CI guard (no visual change) · risk: none
- Add the anti-fragmentation lint (rule #4) so all later phases are guarded.
- Write the canonical decisions into `DESIGN_SYSTEM.md` (token=`--av-*`, button=<decision>, modal=<decision>) and fix its stale §14 migration table.
- **Verify:** new test fails on a planted hex; existing suite stays green.

### Phase 1 — Delete dead systems + orphans · risk: near-zero (0-page files)
- Archive/`git rm` `design-system/` (0 pages) and `css/style.css` (0 bytes). Remove the README mandate (the misleading "use design-system/tokens.css" instruction).
- **Blocker to clear first:** ~6 frontend tests reference the string `design-system`; verify each is a *sentinel asserting absence* (safe) vs one that *reads* the folder (update it). Same check for the 2 `admin.css` tests before touching `admin.css`.
- **Verify:** `node --test` green; grep confirms 0 runtime refs.

### Phase 2 — Foundations: type scale + fonts (A2, A4.5) · risk: low-med
- **h1 unification:** pick one canonical skill-hub heading token (recommend the Vocab/Home `clamp(2rem,4vw,3rem)` as the standard, or a fixed `--av-fs-3xl`). Apply to Speaking hub (`subpage-header__title` 18px → up) and Reading hub so all 3 hubs match. *Decision D1 below.*
- **Fonts:** sanction the documented set (Plus Jakarta+JetBrains; Grammar's DM Sans+Lora; exam system-ui). Resolve the **undocumented** Vocab-wiki Fraunces/Hanken/DM-Mono: either document it as a sanctioned 3rd system or migrate to standard. *Decision D2 below.*
- **Verify:** visual check of the 3 hubs (light+dark); `theme-toggle` + typography tests green.

### Phase 3 — Token-migrate the post-pivot skins (A1, A4 core) · risk: med-HIGH · **one surface per PR**
Order by isolation (least coupled first):
1. **Reading exam** (`reading-exam.css`, 82 hex → `--av-*`): the big one. Build the `--exam-*` skin *from* tokens; delete raw hex. Unlocks dark theme on 3 exam pages. Isolated (own pages).
2. **Listening** (resolve A6 coupling): give Listening its own stylesheet or promote the borrowed `vocabulary.css` classes into `--av-*` primitives, so restyling Vocab no longer silently restyles Listening (10 pages).
3. **Vocab-wiki**: already tokenized — only the font decision (Phase 2) + retire `--ds-*` usages here toward `--av-*`.
- **Per-surface verification:** before/after screenshot each page in **both themes**; token-sentinel tests green; no new hex (Phase 0 guard enforces).

### Phase 4 — Primitive consolidation (A5) · risk: HIGH · **one family per PR, LAST**
- **Button:** choose canonical (recommend `btn-primary` — 52 files, least churn — renamed/documented as the primitive; `av-button`→alias). Migrate the ~19 `aw-btn`/`adm-btn`/`exam-btn` stragglers. Component **API/variant** design (sizes, states, slots) → route to `ui-component-patterns`. *Decision D3 below.*
- **Modal:** define one canonical modal primitive (structure + a11y: focus trap, `role=dialog`, `Esc`, scrim); migrate the 7 families. Focus/keyboard **remediation** → `web-accessibility`.
- **Admin kits:** merge `.aw-*` (admin-writing.css, 1048 lines) into `.adm-*` (admin-components.css, 251 lines) or vice versa; one admin primitive layer.
- **Verify:** per-family visual + interaction check; the admin/writing redesign tests as tripwires.

---

## Route-outs (not this plan's job)
- **`ui-component-patterns`** — the button/modal **prop/slot/variant API** and component-family extraction (Phase 4 mechanics).
- **`responsive-design`** — the 3 back-link patterns + any layout collapse behavior surfaced while de-coupling Listening.
- **`web-accessibility`** — contrast **verification** of retuned tokens; modal focus-trap/keyboard remediation.
- **`web-design-guidelines`** — any broad per-page polish critique that isn't a token/primitive decision.

## Open decisions (confirm before the relevant phase)
- **D1 (Phase 2):** canonical skill-hub h1 scale — Vocab/Home `clamp(2rem,4vw,3rem)` (recommended) vs a fixed `--av-fs-3xl` (30px)?
- **D2 (Phase 2):** Vocab-wiki Fraunces/Hanken/DM-Mono — **sanction & document** as a 3rd system, or **migrate** to the standard Plus-Jakarta family?
- **D3 (Phase 4):** canonical button — `btn-primary` (recommended, 52 files) vs promote `av-button`?
- **Horizon:** ~6–8 small PRs (one surface / one primitive-family each) over multiple sessions vs one big-bang (not recommended — un-reviewable, high regression risk).

## Sequencing rationale
Phase 0's CI guard makes every later phase self-policing (no re-fragmentation mid-migration). Phase 1–2 are near-zero/low risk and remove the *confusion sources* (dead fork, mandate, mismatched scales) before touching live pixels. Phase 3–4 are the visual-risk work, isolated to **one surface / one primitive per PR** so any regression is small and reversible. This packet defines the shared system direction and governance; the button/modal **component API** belongs in `ui-component-patterns`, and token **contrast verification** belongs in `web-accessibility`.
