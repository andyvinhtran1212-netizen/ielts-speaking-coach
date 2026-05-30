# Design-Consistency Cluster — Closure Note

**Status:** Design-consistency cluster CLOSED. Audit (whole-web) → 6 fix batches (B1-B6) → 3 fix PRs merged.
**Audience:** Andy + future frontend leads.
**Authority:** Mind, synthesizing Codex audit + Code's 3 fix sprints + Andy's dogfood.

---

## 1. Arc

- **Audit** (Codex, Discovery-first) — `docs/audits/design_consistency_audit.md`. Baseline exists (`--av-*` tokens, components.css, admin-components.css, DESIGN_SYSTEM.md); problem = uneven adoption, not absence. 0 P0 / 15 P1 / 13 P2 / 2 intentional-subsystems-correctly-excluded.
- **Fix-1 (PR #360)** — B1 admin status pills + B2 action groups + B6 governance.
- **Fix-2 (PR #361)** — B3 admin button consolidation + B4 hub card primitive.
- **Fix-3 (PR #362)** — B5 user-facing semantic token cleanup.

---

## 2. Primitives created (durable assets)

| Primitive | File | Replaces |
|---|---|---|
| `.adm-status-pill` (10 states) | `admin-status.css` | `.lst-chip`/`.tl-chip`/`.det-chip`/`.td-chip`/`.ar-status-pill`/`.aw-pill--*` |
| `.adm-action-group` (+`--compact`) | `admin-status.css` | bare inline action fragments |
| `.adm-btn-*` (primary/secondary/danger/sm) | admin primitive layer | page-local `.btn-*`/`.td-btn-*`/`.db-refresh` |
| `.admin-hub-grid` + `.admin-hub-card` | side-effect-free file | per-prefix hub CSS (grm/vcb/spk/sys/ov) |
| `.admin-card-link` | primitive layer | varied "Xem chi tiết →" styles |

Hub tags REUSE `.adm-status-pill` (no separate `.admin-hub-tag`) — avoided re-duplicating what B1 unified.

---

## 3. Key architecture decisions

1. **Side-effect-free primitive file** (Code, fix-1 latitude) — primitives went into a dedicated `admin-status.css` (@imported by admin-components.css), NOT directly into admin-components.css, because the latter carries a global `*{box-sizing:border-box}` reset that listening/reading/writing pages never adopted. Linking the whole file would have silently flipped their box model. The side-effect-free file lets pages link the primitive with zero box-model risk. **This is the load-bearing decision** — it's why the consolidation didn't cause silent layout regressions.
2. **Aliasing-first** — many JS renderers emit specific class names bound to listeners. Every batch aliased legacy classes onto the new primitive (CSS) BEFORE migrating markup, so JS-coupling never broke (Lesson 9 spirit).
3. **No new component library** (Codex audit rec + Mind) — vanilla stack; existing CSS-layer abstraction was right. Fill missing primitives + alias, don't build a JS component system.

---

## 4. Absent-token bug pattern (Lesson 16 candidate)

Two referenced tokens were never defined, silently falling back to hardcoded hex:
- `--av-color-error` (fix-1) — `.adm-btn-danger` fell back to muted text → danger button didn't look like danger
- `--av-critical` (fix-3) — reading error-text fell back to hardcoded red, bypassing the design system

**Pattern:** `var(--undefined-token, #hardcoded-fallback)` silently bypasses the design system — the fallback masks the missing token, so it renders "fine" while being un-themed + un-tracked. Both surfaced only during a consistency audit.

**Lesson 16 (candidate):** Token references must resolve to a defined token. A `var(--token, #fallback)` with an undefined `--token` is design-system drift hiding behind a working render. Mitigation: a CSS sentinel that flags references to tokens not defined in `tokens.css` (catches the class of bug both fixes hit).

---

## 5. Governance additions (in DESIGN_SYSTEM.md)

- New pages use `tokens.css` + `components.css`/`admin-components.css`; `ds.css` is legacy bridge only — no new `.ds-*`/`.btn-*`/`.badge-*`.
- No new inline Tailwind color config (18 existing pages recorded as opportunistic migration targets).
- CSS sentinels (3 added across fixes) guard against re-introducing hardcoded semantic hex + the absent-token pattern.

---

## 6. Deferred items

| Item | Why deferred |
|---|---|
| **Vocab Article editorial decision** | DM Sans/Lora on hardcoded dark bg + ds.css — editorial-subsystem candidate (like Grammar Wiki) vs drift. Bigger than a color swap; **pending Andy product decision** |
| Inline-Tailwind long-tail (18 user pages) | Opportunistic migration when touching those pages; not a batch |
| Additional button families (`.btn-ghost`/`.btn-warn`/`rej`/`pub`/`.ac-btn*`/`.cv-btn*`) | Out of B3 scope; future consolidation pass |
| `ds.css` removal | Legacy bridge still loaded; remove per-page when migrating |
| `admin.html` monolith refactor | Large structural; separate effort |

---

## 7. Final state

Design-consistency: admin status pills, action groups, buttons, hub cards, card links — all token-driven + theme-aware via shared primitives. User-facing semantic colors (Listening MCQ/TF, error banners) + mono fonts tokenized. Intentional subsystems (Grammar Wiki editorial, Reading exam chrome) preserved untouched. Two absent-token bugs fixed. Sentinels + governance guard regression.

**Deferred** (§6) are tracked, non-blocking. Reopen for the Vocab Article decision or a button-family consolidation pass when prioritized.

---

*Design-consistency cluster: CLOSED. Lessons register gains Lesson 16 (absent-token silent fallback) if ratified. Patterns: #47 reuse (hub tags reuse status pill; side-effect-free-file pattern carried fix-1→fix-2).*
