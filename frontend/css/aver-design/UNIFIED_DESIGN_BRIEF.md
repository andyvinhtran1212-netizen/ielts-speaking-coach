# Unified Design Brief — Per-Page Redesign

> Companion to `DESIGN_SYSTEM.md`. This brief is the operational checklist for migrating an existing page from the legacy `--ds-*` / Manrope+Fraunces system onto the unified `--av-*` / Plus Jakarta Sans + JetBrains Mono system.

---

## 1. Scope of one page redesign

A page redesign is **one PR per page**. Don't bundle two pages into one PR — review surface explodes and JS coupling breaks become impossible to localize.

Exception: pages that are sibling iframe panels (e.g., `my-vocabulary.html` + `flashcards.html` + `exercises.html` mounted into `vocabulary.html`) may share one PR if the redesign keeps them visually identical and the iframe contract is unchanged.

---

## 2. Priority order

The redesign program runs in phases. Phases 1–3 are complete (13 pages); Phase 4 is in progress (10 of 11 pages shipped — marketing COMPLETE + admin sub-pages COMPLETE, `admin.html` monolith + Grammar Wiki cluster remaining).

| Phase | Pages | Status |
|---|---|---|
| **Phase 1** — Speaking flow | `home.html` (Sprint 6.3, PR #121), `speaking.html` (6.4 / 6.4.1 / 6.4.2, PRs #123/#124/#125), `practice.html` (6.5 / 6.5.1, PRs #127/#128), `result.html` (6.6 / 6.6.1, PRs #130/#131) | **COMPLETE** |
| **Phase 2** — Writing flow + Speaking aggregate | `writing-dashboard.html` (6.7 / 6.7.1, PRs #132/#133/#134), `writing-result.html` (6.8, PR #135), `full-test-result.html` (6.9, PR #136); audit hotfix Sprint 6.9.1 PR #137 | **COMPLETE** |
| **Phase 3** — Vocabulary + Profile + Onboarding | `vocabulary.html` landing (6.10, PR #138); theme-toggle icon normalization (6.10.1, PR #139, 6-page drift fix); `my-vocabulary.html` (6.11a, PR #140); `flashcards.html` + `exercises.html` + `_renderPreviewModal` atomic (6.11b, PR #141); `profile.html` (6.12a, PR #142); `onboarding.html` (6.12b, PR #143) | **COMPLETE** |
| **Phase 4** — Marketing + Admin + Grammar Wiki | **Marketing COMPLETE:** `index.html` surgical migration + multi-skill repositioning (Sprint 6.13a + 6.13a-extension, PRs #145/#146); `pricing.html` (6.13b, PR #147); Era B `landing.html` duplicate eliminated atomically (Sprint 6.13a). **Admin sub-pages COMPLETE:** small writing cluster — `admin-writing.html` + `admin-writing-new.html` + `admin-writing-status.html` + `admin-writing-prompts.html` (6.14a, PR #149); table pages — `admin-writing-assignments.html` + `admin-students.html` (6.14b, PR #150); instructor queue + grading — `admin-instructor-queue.html` + `admin-writing-grade.html` (6.14c, PR #151); pre-work PR #148. **UPCOMING:** Sprint 6.14d `admin.html` monolith (~3,667 lines, 10-tab, 186 IDs); Sprint 6.15 Grammar Wiki cluster (`grammar.html` + 5 sub-pages, `vocab-article.html`; decision pending on DM Sans + Lora sub-system vs unification). | **IN PROGRESS** |
| **Phase 5+** — Deferred | Writing IA self-directed option; DEBT-2026-05-09-B vocabulary iframe → module extraction (no un-defer triggers fired); Stripe (Sprint 2.7e); email infra (Sprint 2.8). | **DEFERRED** |

**23 pages redesigned cumulative** (Phase 1: 4 + Phase 2: 3 + Phase 3: 6 + Phase 4 marketing: 2 + Phase 4 admin sub-pages: 8). Phase 4 admin cluster: 8 of 9 admin sub-pages shipped — only `admin.html` monolith remains.

Every redesigned page ships:

- Plus Jakarta Sans (body) + JetBrains Mono (numerics) — drops legacy Manrope + Fraunces
- Aver Design System `--av-*` tokens (light + dark from day 1)
- Canonical anti-flash IIFE (DESIGN_SYSTEM.md § 13) — validates `localStorage['av-theme']` against `light|dark`, falls back to system preference, try/catch to `light`
- Canonical `.icon-sun` / `.icon-moon` theme-toggle classes (Sprint 6.10.1 — components.css owns the visibility swap; no BEM drift)
- `ds.css` scoped overrides under `body.av-page` (Sprint 6.5.1) — the shared compatibility sheet is **never** modified during redesigns
- `--av-text-on-primary` for CTA text on brand surfaces (Sprint 6.7.1) — never hardcoded `#ffffff`

The `frontend-design` skill warns against the Phase 1 trap of converging on identical patterns across all pages. Each redesign should commit to a clear aesthetic direction for the page's purpose:

- **Home** — editorial overview, asymmetric, generous whitespace, display-scale stats
- **Speaking dashboard** — dense session history with a calm hierarchy, not a marketing layout
- **Practice** — focus mode, minimal chrome during recording, clear state machine affordances
- **Result** — long-form reading; relaxed line-height, atmospheric breaks between criteria

### 2.1 Sprint 6.14d strategy guidance (Codex audit recommendation)

Per Codex audit Phase 4 admin (`CODEX_AUDIT_PHASE_4_ADMIN.md`, AMBER #2 closure), Sprint 6.14d `admin.html` monolith should follow the same surgical strategy used across Sprints 6.14a–6.14c, with one architecture-level decision: **don't extend `admin-writing.css` with monolith-specific selectors.**

**Stylesheet architecture:**

- **Dedicated `frontend/css/admin.css`** for monolith-specific selectors (each of the 10 tabs likely has unique patterns — e.g., the "Access Codes" tab's inline Supabase pattern). Place tab-specific styles, monolith-only modals, and admin-only stat widgets here.
- **Reuse `aw-*` primitives** from `admin-writing.css` (~118 selectors available — `.aw-table`, `.aw-status-pill`, `.aw-stat-card`, `.aw-card`, `.aw-foa-pill`, `.aw-alert--*`, `.aw-mini-pill`, etc.). The monolith is a Tier 2 admin surface; the primitives already cover most cross-page idioms.
- **DO NOT extend `admin-writing.css`** with monolith-specific styles. The file is at the documented `--av-text-faint ≤ 10` ceiling (10/10, no slack) — see DESIGN_SYSTEM.md § 17.6.
- **DO NOT link `writing-renderers.css`** (Sprint 6.8 finding — admin pages own separate CSS; `writing-renderers.css` is de-facto single-consumer for `writing-result.html`).

**Foundation order for `admin.html`:**

```html
<link rel="stylesheet" href="../css/aver-design/tokens.css">
<link rel="stylesheet" href="../css/aver-design/components.css">
<link rel="stylesheet" href="../css/admin-writing.css">  <!-- reuse aw-* primitives -->
<link rel="stylesheet" href="../css/admin.css">          <!-- monolith-specific -->
```

**Outlier handling:**

Keep monolith outliers explicit (don't normalize prematurely). The 10-tab architecture has unique patterns per tab (e.g., "Access Codes" tab inline Supabase init, ownership-fallback synthesis tables, the `detailToTableShape()` re-render path documented in project `CLAUDE.md`). Document outliers via the Sprint 6.14 pre-work pattern (§ 15.2) rather than silently folding them into the primitive layer.

**Effort estimate (per Sprint 6.14 pre-work, PR #148):** 25–35h with its own mini pre-work sprint to inventory the 10 tabs + 186 JS-coupled IDs before any CSS work begins. If Sprint 6.14d Phase B pre-work reveals different scope, the estimate can be updated against findings.

---

## 3. Per-page checklist

For each page being redesigned, work through this list in order. Each item is independently testable.

### 3.1 Setup (every page)

- [ ] Add inline anti-flash IIFE in `<head>` BEFORE any `<link>` to a stylesheet
- [ ] Link in this order: `tokens.css` → `components.css` → page-specific stylesheet (if any)
- [ ] Remove the legacy `<body class="ds-canvas">` opt-in (the new system reads `[data-theme]` on `<html>` instead)
- [ ] Apply `.av-page` class to `<body>` so background + color resolve from tokens
- [ ] Add `<button class="av-theme-toggle">` to the navigation header with sun + moon SVGs
- [ ] Wire the toggle: `import { bindToggleButton } from '/js/theme-toggle.js'; bindToggleButton(...)`

### 3.2 Token replacement

- [ ] Find every `var(--ds-*)` reference in the page's inline `<style>` and any page-specific CSS file
- [ ] Map each to the equivalent `--av-*` token (use `DESIGN_SYSTEM.md` § 4 as the lookup)
- [ ] Find every hardcoded color (`#0a1628`, `#14b8a6`, `rgba(20,184,166,...)`, `teal-*` Tailwind utility, etc.) and replace with the appropriate token
- [ ] Verify with `grep` that no `var(--ds-` or hardcoded teal/navy values remain on this page

### 3.3 Component swaps

- [ ] Replace inline button styles with `.av-button` + variant
- [ ] Replace inline card styles with `.av-card` + variant
- [ ] Replace inline modal markup with `.av-modal-backdrop` + `.av-modal`
- [ ] Replace inline form-input styles with `.av-input` / `.av-select` / `.av-textarea`
- [ ] Replace inline badge styles with `.av-badge-*` variant
- [ ] Replace inline toast pattern with `.av-toast`

### 3.4 What you MUST NOT change

These class names are JS-coupled. Renaming them breaks click handlers, state machines, or admin flows:

- `.btn-primary`, `.btn-secondary`, `.btn-test`, `.btn-start`, `.btn-fulltest`, `.btn-locked`, `.btn-ghost`
- `.tab-btn`, `.main-tab-btn`, `.essay-filter-btn`
- `.skill-card`, `.skill-card-locked`, `.skill-cta-primary`, `.skill-cta-secondary`
- `.session-row`, `.essay-card`, `.part-card`, `.stat-card`
- `.preview-mode-banner`, `.page-moved-banner`, `.vocab-moved-banner`
- `.embedded-mode` and any `html.embedded-mode` selector (Sprint 6.0.1 iframe pattern)
- `.locked` (nav-link permission flag), `.lock-tag`, `.locked-skill`
- `.show`, `.hidden`, `.is-active`, `.is-recording` state classes (broadly used)

**Strategy:** instead of renaming, **co-style** — keep the legacy class on the element AND add the `.av-*` class. The legacy CSS rule still matches but the `.av-*` rule wins on cascade order (load `.av-*` last). When the legacy class is no longer JS-targeted, drop it in a follow-up cleanup sprint.

Example for a "Start practice" button currently classed `.btn-primary`:

```html
<button class="btn-primary av-button av-button-primary">
  Bắt đầu luyện tập
</button>
```

The legacy click handler still finds `.btn-primary`. The visual style comes from `.av-button-primary`. Both work.

### 3.5 Iframe contract (only for vocabulary tabs)

If the page being redesigned is `my-vocabulary.html`, `flashcards.html`, or `exercises.html`, preserve:

- The Sprint 6.0.1 inline embedded-mode IIFE at the top of `<head>` (detects `?embedded=1` and adds `html.embedded-mode`)
- The `embedded-mode.css` link
- The `<header>` and `#vocab-moved-banner` elements (CSS hides them when in embedded mode; markup must remain)

Test embed-mode rendering in BOTH themes after the redesign.

### 3.6 Permission gating contract

The Sprint 5.2 / 5.2.1 permission gating uses **per-page lock contracts** — the class names and DOM shape used to render a "locked" skill card are NOT shared across pages. Every redesign sprint MUST inspect the page's own JS render functions before assuming class names. Following this brief blindly without checking the runtime is exactly the doc/runtime drift that breaks JS-coupled redesigns.

**Inspection workflow:**

1. Open the page's JS render module (e.g., `frontend/js/home.js`).
2. Search for `permission`, `locked`, `is_active`, or `disabled` to find the gate logic.
3. Note the exact class names + data attributes the JS adds when the gate fails.
4. Preserve those exactly in the redesigned markup; style them in the page's CSS.

#### 3.6.1 Lock-state inventory (verified against shipped JS)

| Page | Locked class | Data attribute | Renderer | Notes |
|---|---|---|---|---|
| `pages/home.html` | `.coming-soon` (NOT `.skill-card-locked`) | `data-locked="true"` | `js/home.js` `renderSkillCard` (PR #115 / 6.0, lock branch lines ~155–173) | The Writing card receives this when `permissions.writing === false`. Locked markup is rendered by `home.js` (innerHTML replace), not pre-baked in HTML. Click handler navigates to a Vietnamese alert, not a route. |
| `pages/writing-dashboard.html` | `#writing-preview-banner` revealed via `.classList.remove('hidden')` + `.btn-start-assignment` and `#modal-btn-submit` flagged `.opacity-50.cursor-not-allowed` | None (banner shown as a discrete element; disabled buttons identified by their fixed IDs/classes) | Inline IIFE in `writing-dashboard.html` — `applyWritingPermissionGating()` at line ~972 reads `GET /api/student/permissions`; cached in `_writingPermitted` | Sprint 6.7 (PR #132) shipped surgical redesign. Backend `require_writing_permission` is authoritative; UI gate is defense-in-depth. Disabled state survives the redesign because the JS toggles class names byte-identical. |
| `pages/writing-result.html` | None — no UI lock banner, no JS gating function | None | Inline IIFE in `writing-result.html` reads permission at fetch time, but does NOT render a `#writing-preview-banner` or disable any control. Backend route is server-authoritative (`/api/student/writing/essays/{id}/feedback` returns 403 without permission). | Sprint 6.8 (PR #135) shipped surgical redesign. Permission is enforced at the backend route only; UI relies on server response shape (5-state machine: `loading/error/not-delivered/flagged/ready`). This is **asymmetric to writing-dashboard.html** — see § 13 "Writing flow asymmetries and shared-style boundaries". |
| Vocabulary surfaces (`my-vocabulary.html`, `flashcards.html`, etc.) | TBD — likely no lock state since vocab is permission-default-on | n/a | n/a | Sprint 6.0 didn't introduce a per-skill gate here. |

Each redesign sprint fills in the page's row above by reading the JS, not by guessing.

#### 3.6.2 Anti-pattern (avoid)

- ❌ Assuming `.skill-card-locked` is the universal lock class because the brief once said so. **It isn't.** The shipped homepage uses `.coming-soon` + `data-locked="true"`.
- ❌ Renaming whatever class the JS *does* use during redesign — that breaks the gate silently.
- ❌ Pre-baking locked markup into HTML — `home.js` replaces `innerHTML` wholesale on the `.skill-card.skeleton` placeholder, so any baked-in copy gets overwritten anyway.

#### 3.6.3 Correct pattern

- ✅ Read the page's JS render functions BEFORE rewriting HTML
- ✅ Preserve exact class names + data attributes the JS depends on
- ✅ Add new visual styling on top via composition (don't rename)
- ✅ Vietnamese microcopy (e.g., "🔒 Chưa kích hoạt", *"Quyền Writing chưa được kích hoạt cho tài khoản này. Liên hệ giảng viên để được hỗ trợ."*) lives in the JS render template — preserve it verbatim or update the JS template, not just the HTML
- ✅ The `Liên hệ admin` action stays wired to the support email/Telegram link in the JS handler, not the HTML

#### 3.6.4 Writing IA — teacher-assignment vs self-directed (Sprint 6.7 finding)

The Sprint 6.7 redesign of `writing-dashboard.html` surfaced a contract gap that future Writing-flow sprints must respect.

**Writing skill (shipped):** teacher-assignment workflow.

- Essays come from teacher-created assignments — students never pick prompts
- 2 tabs: `#tab-assignments` ("Bài giao") + `#tab-essays` ("Bài đã nộp")
- 6-state essay pill (`STATUS_CONFIG`: pending/grading/graded/reviewed/delivered/failed) + 5-state assignment pill (`ASSIGNMENT_STATUS`: pending/in_progress/submitted/graded/delivered)
- Permission gate: `writing` permission from access code → `#writing-preview-banner` + disabled buttons when false

**Speaking skill (contrast):** self-directed workflow.

- User picks mode (visual/listening) + part (1/2/3/Full Test) + topic
- No teacher dependency; no permission gate (Speaking is permission-default-on)
- No assignment lifecycle — every session is on-demand

**Implication for future redesigns:**

- `writing-result.html` (Sprint 6.8), `full-test-writing.html`, any other Writing surface — they all inherit the teacher-assignment IA. Don't design self-directed UI elements (Task 1 / Task 2 self-select cards, prompt library browser, "start new essay" CTAs) unless the IA decision changes upstream.
- The Sprint 6.7 spec proposed a self-directed dashboard; that PR (PR #132) deviated to surgical migration and preserved the teacher-assignment workflow exactly. The same deviation will likely be correct for the rest of the Writing flow.

**Phase 5+ IA question (deferred):** should Writing offer a self-directed mode where students pick their own prompts? Currently no — every essay is teacher-driven. Revisit when Phase 4 closes and the product roadmap reopens.

### 3.7 Vietnamese typography review

- [ ] Replace any `text-transform: uppercase` on Vietnamese strings ≥ 4 words with sentence case
- [ ] Verify body line-height ≥ 1.55 (`--av-lh-normal`)
- [ ] Sample-test with diacritic-rich strings: `"Học viên đang luyện tập"`, `"Đã hoàn thành phần thi"`, `"Tất cả các kỹ năng IELTS"`, `"Chuyển sang giao diện sáng"`
- [ ] Check that no font-feature-settings strip the marks (don't blanket-apply `'liga' 0` or similar)

### 3.8 Accessibility review

- [ ] Every icon-only button has `aria-label` in Vietnamese
- [ ] Theme toggle: `aria-label` + `aria-pressed` both update via `bindToggleButton()`
- [ ] Tab navigation works (no `tabindex="-1"` blocking primary actions)
- [ ] Focus-visible ring visible on all interactive elements in both themes
- [ ] Modal focus trap works; `Escape` closes the modal
- [ ] No reliance on color alone to convey state (e.g., error fields need an icon or text, not just red border)
- [ ] Touch targets ≥ 44×44 px on primary actions

### 3.9 Test before merge

- [ ] Visual smoke in light theme — desktop (1280px), tablet (768px), mobile (375px)
- [ ] Visual smoke in dark theme — same breakpoints
- [ ] Theme toggle works on this page (click → flip → reload → persists)
- [ ] System preference change reflected if user hasn't set explicit choice
- [ ] All existing tests still pass (run `node --test frontend/tests/*.test.js` + backend regression)
- [ ] No console errors in either theme
- [ ] No visual regression on adjacent pages (this redesign should not touch their CSS, but verify nothing leaked)

### 3.10 PR body

Document in this order:

1. **What changed** — files touched, classes added/removed, JS hooks affected (or "none")
2. **Spec deviations** — every place this page diverges from the design system, with rationale
3. **Manual test results** — light + dark smoke results, tested viewports
4. **Anti-patterns avoided** — be explicit about preserved class names, single-page scope, etc.

---

## 4. Foundation invariants (do not violate)

These hold across every per-page redesign:

- **Single source of truth for tokens.** `tokens.css` is the only place `--av-*` values are defined.
- **Theme switching is global.** No page-specific theme override; flipping `[data-theme]` flips every component.
- **Coexistence is permanent during migration.** `ds.css` ships in production until the cleanup sprint after Phase 5. Don't pre-emptively delete it.
- **No build step introduced.** Tailwind CDN stays. `theme-toggle.js` is plain ES module, importable without bundling.
- **Components don't override JS-coupled classes.** When in doubt, co-style instead of rename.

---

## 5. When to push back

If a page redesign requires:

- Renaming a JS-coupled class — push back, co-style instead
- Adding a new `--av-*` token because nothing fits — fine, add it to `tokens.css` and document why
- Changing the iframe contract for vocabulary tabs — push back, that's a separate sprint
- Migrating a page from light theme to dark or vice versa — push back, both themes are user-controlled
- Touching backend code — push back, redesign is frontend-only
- Updating tests for unrelated pages — push back, scope creep

---

## 6. Voice & copy patterns

Vietnamese-first voice. The patterns below are lifted directly from the Aver Learning Design System (the upstream reference Andy maintains in the design ZIP) so per-page redesign sprints can paste tested copy instead of re-inventing it.

### 6.1 Pronouns

- `bạn` for the learner (familiar but respectful, never `mày` / `cậu`)
- AI never says "tôi" / "mình" — third person or implicit
- Aver refers to itself in third person

### 6.2 Casing rules

- **Sentence case** for headings, buttons, body
- **UPPERCASE** only for:
  - Eyebrow labels (very short, ≤ 3 words)
  - IELTS criterion codes: FC, LR, GRA, P
  - Access codes
- **Title Case is avoided** entirely

### 6.3 Punctuation

- Em-dashes (`—`) for asides
- Vietnamese ellipsis `…` over `...`
- No exclamation marks (exception: onboarding success states)

### 6.4 Lifted copy examples

Use these verbatim when the surface matches. Do not paraphrase — voice consistency is one of the things the design system most reliably erodes when copy gets re-written in flight.

| Surface | Copy |
|---|---|
| Hero headline | Nói tự tin hơn. **Đạt band cao hơn.** |
| Hero sub | Luyện IELTS Speaking 1–1 cùng AI — phản hồi tức thì về từ vựng, ngữ pháp, phát âm và mạch lạc. |
| Primary CTA | Bắt đầu miễn phí · Dùng thử miễn phí |
| Secondary CTA | Xem cách hoạt động |
| Reassurance line | Không cần thẻ tín dụng · Dùng thử 3 buổi miễn phí |
| Feature blurb | Sau mỗi câu trả lời, AI nhận xét về từ vựng, ngữ pháp, mạch lạc và phát âm theo đúng tiêu chí IELTS. **Không chung chung — chỉ ra đúng chỗ cần cải thiện.** |
| Empty state | Chưa có buổi luyện nào. Bắt đầu buổi đầu tiên — bạn sẽ nhận phản hồi sau khoảng 30 giây. |
| Score card label | Từ vựng · Ngữ pháp · Mạch lạc · Phát âm (never English jargon at top level) |
| Auth | Đăng nhập bằng Google · Kích hoạt tài khoản · Nhập mã để bắt đầu luyện tập |
| Pricing reassurance | Không có cam kết dài hạn. Huỷ bất kỳ lúc nào. |

### 6.5 Microcopy rules

- **Reassurance under CTAs** — answer "what does this commit me to?". Example: *"Không cần thẻ tín dụng · Dùng thử 3 buổi miễn phí"*
- **Specific over general** — *"Phản hồi sau ~30 giây"* beats *"Fast feedback"*
- **Numbers stay numerals** — *"3 buổi miễn phí"*, *"Band 7.0"*, *"299K/tháng"*
- **Bilingual labels for IELTS jargon** — *"Từ vựng (LR)"*, *"Ngữ pháp (GRA)"* — Vietnamese first, code as hint

### 6.6 Encouragement style — "warm teacher, not cheerleader"

- Specific encouragement: *"Phát âm /θ/ trong 'think' chưa rõ — thử đặt lưỡi giữa hai răng"*
- NOT generic: *"You got this!"*

### 6.7 Vietnamese diacritic safety

- Body line-height 1.55 normal / 1.7 relaxed (NEVER tighter than 1.55 for body)
- Avoid `text-transform: uppercase` for long Vietnamese strings
- Plus Jakarta Sans is validated for diacritic clarity (chosen specifically for this)

---

## 7. Decision shortcuts

Quick reference. Consult this table when standing in front of a visual decision during a redesign sprint. Token names + class names below match what is currently shipped in `tokens.css` and `components.css`.

| Question | Answer |
|---|---|
| Primary action color? | `var(--av-primary)` (light = `#0F766E`, dark = `#14B8A6`). Hover → `var(--av-primary-hover)` |
| Friendly accent? | `var(--av-accent)` (warm amber). **Only** for streaks / encouragement / level-ups. Never primary actions |
| Sans font? | Plus Jakarta Sans via `var(--av-font-sans)` — chosen for Vietnamese diacritic clarity |
| Mono font? | JetBrains Mono via `var(--av-font-mono)` — band scores, codes, timestamps |
| Background? | `var(--av-surface-page)` — automatically light cream or deep navy depending on `[data-theme]` |
| Marketing/auth pages? | One navy→teal diagonal hero gradient is OK. App pages stay clean (no decorative gradients on dashboards) |
| Pronouns? | Always `bạn` for learner. AI never says "tôi" / "mình" |
| Casing? | Sentence case everywhere except eyebrow labels + IELTS codes (FC, LR, GRA, P) |
| Emoji? | No, except `✓` / `△` style status glyphs inside vocab chips. Prefer `.av-badge-*` instead |
| Icons? | Lucide CDN, 1.5–2px stroke, `currentColor`. No PNGs, no icon font, no hand-drawn SVG |
| Motion timing? | `var(--av-easing-default)` (cubic-bezier 0.4, 0, 0.2, 1), durations 150 / 250 / 400ms via `--av-duration-fast/base/slow`. No bounces, no springs |
| Border radius? | Buttons → `var(--av-radius-md)` (8px). Cards → `var(--av-radius-lg)` (12px). Modals → `var(--av-radius-xl)` (16px). Pills/badges → `var(--av-radius-pill)` |
| Spacing? | 4px grid via `--av-space-1..24`. Most-used: `--av-space-4` (16px) for component padding, `--av-space-6` (24px) for card padding |
| Selected card? | Border-color `var(--av-primary)` + `box-shadow: var(--av-shadow-focus)` (3px halo) |
| Focus state? | Always `box-shadow: var(--av-shadow-focus)`, never browser default outline |
| Disabled state? | `opacity: 0.5; pointer-events: none`. No greying out, no removing border |

### 7.1 Three principles — every visual decision must pass

- **HỌC THUẬT** (Academic) — Đáng tin, không khô khan
- **THÂN THIỆN** (Friendly) — Khích lệ, không trẻ con
- **HIỆN ĐẠI** (Modern) — Sạch sẽ, có chỗ thở

If a decision feels off, name which principle is being violated. That usually points at the fix.

---

## 8. Anti-patterns (NEVER do)

Drift-prevention rules. Each anti-pattern below has caused real visual divergence in past projects — they're listed here so per-page sprints don't re-discover them.

### 8.1 Drift creation

- ❌ Create a local `tokens.css` per page — all pages share `aver-design/tokens.css`
- ❌ Override tokens inside a page-specific stylesheet
- ❌ Hardcode colors / spacing / fonts — always use tokens
- ❌ Inline `style="..."` for design system attributes (color, spacing, typography). Inline styles are reserved for genuinely dynamic values (computed widths, JS-driven positions)

### 8.2 Component duplication

- ❌ Copy button styles from the design system and customize per page
- ✅ Add a modifier class in `components.css` instead (e.g., propose a new `.av-button-*` variant in a follow-up PR)

### 8.3 Theme breaking

- ❌ `color: #1a1a1a` — only works in light mode
- ✅ `color: var(--av-text-primary)` — works in both themes automatically

### 8.4 Voice / copy violations

- ❌ Title Case headings
- ❌ Generic encouragement (*"Great job!"*, *"You got this!"*)
- ❌ AI saying "tôi" / "mình"
- ❌ Emoji in production UI (legacy `🤖 📊 📥` patterns are being phased out)
- ❌ English IELTS jargon at top level without a Vietnamese label

### 8.5 Visual violations

- ❌ Gradient meshes on app surfaces (only OK on a marketing hero)
- ❌ Hand-drawn illustrations or photography
- ❌ Bouncy / spring animations (`--av-easing-bounce` exists in tokens but is reserved for very specific success states; default is the linear-ish ease-out)
- ❌ PNG icons or icon fonts
- ❌ Mixing stroke + fill icons in the same row
- ❌ Browser default focus outline (always `var(--av-shadow-focus)` halo)

---

## 9. Reference pages index

Andy maintains a separate `Aver_Learning_Design_System.zip` with 14 redesigned reference pages and 17 component preview HTML files. The ZIP is **not** in this repo — it's a working asset Andy hands to whoever is doing a redesign sprint. The mapping below tells each redesign sprint which reference page to consult.

> **Note:** This ZIP is not committed to the repo (it's heavyweight and changes outside the code review cycle). When starting a redesign sprint, ask Andy for the latest ZIP, unzip locally, and reference the listed file. Don't copy the ZIP's HTML/CSS into the repo wholesale — adapt to the shipped `--av-*` tokens and the actual component classes documented in section 10.

| Production page | Reference page in ZIP | Notes |
|---|---|---|
| `/pages/home.html` | `redesigned/pages/dashboard.html` (≈214 lines) | Multi-skill homepage layout |
| `/pages/speaking.html` | `redesigned/pages/dashboard.html` | Dashboard pattern reusable |
| `/pages/practice.html` | `redesigned/pages/practice.html` (≈640 lines) | Audio recording UI — biggest reference |
| `/pages/result.html` | `redesigned/pages/result.html` (≈285 lines) | Per-criterion feedback layout |
| `/pages/full-test-result.html` | `redesigned/pages/result.html` | Adapt for multi-part |
| `/pages/profile.html` | `redesigned/pages/profile.html` (≈337 lines) | Profile + goals form |
| `/pages/my-vocabulary.html` | `redesigned/pages/my-vocabulary.html` (≈366 lines) | Vocab list + chips |
| `/pages/flashcards.html` | `redesigned/pages/flashcards.html` (≈214 lines) | Stack overview |
| `/pages/flashcard-study.html` | `redesigned/pages/flashcard-study.html` (≈208 lines) | SRS practice UI |
| `/grammar.html` | `redesigned/pages/grammar-roadmap.html` (≈229 lines) | Grammar landing |
| `/pages/grammar-article.html` | `redesigned/pages/grammar-article.html` (≈291 lines) | Reading layout |
| `/pages/grammar-compare.html` | `redesigned/pages/grammar-compare.html` (≈265 lines) | Side-by-side comparison |
| `/pages/grammar-search.html` | `redesigned/pages/grammar-search.html` (≈169 lines) | Search results |
| `/pages/vocab-article.html` | `redesigned/pages/vocab-article.html` (≈185 lines) | Word detail page |
| `/pages/exercises.html` + `/pages/d1-exercise.html` | `redesigned/pages/exercises.html` (≈309 lines) + `d1-exercise.html` (≈308 lines) | Exercise types |

### 9.1 Component preview references

ZIP `preview/` has 17 component preview HTML files. Open these to see a single component in isolation:

| Need | Reference file |
|---|---|
| Button variants | `preview/components-buttons.html` |
| Card patterns | `preview/components-cards.html` |
| Badge variants | `preview/components-badges.html` |
| Input forms | `preview/components-inputs.html` |
| Tabs + progress | `preview/components-tabs-progress.html` |
| Toast + empty states | `preview/components-toast-empty.html` |
| Color palettes | `preview/colors-{primary,accent,neutral,semantic,surfaces}.html` |
| Spacing scale | `preview/spacing-scale.html`, `spacing-radii.html`, `spacing-shadows.html` |
| Typography | `preview/type-display.html`, `preview/type-body.html` |
| Icons inventory | `preview/icons.html` |
| Brand marks | `preview/brand-marks.html`, `preview/brand-wordmark.html` |

---

## 10. Component decision tree

Quick lookup: which `.av-*` class to reach for in which situation. **Only classes shipped today** (PR #119) are listed under "Available". Classes the upstream design system describes but that aren't yet in `components.css` are listed under "Follow-up" — propose them in a separate PR before relying on them in a redesign.

### 10.1 Buttons

```
Primary action (1 per surface)  → .av-button .av-button-primary
Secondary action                → .av-button .av-button-secondary
Tertiary / inline action        → .av-button .av-button-tertiary
Destructive (delete, revoke)    → .av-button .av-button-destructive
Icon-only (40×40 square)        → .av-button .av-button-icon

Sizes:
  Compact (chips, inline)       → .av-button .av-button-sm
  Default (40px height)         → .av-button   (no size modifier)
  Hero CTA (48px height)        → .av-button .av-button-lg
```

> **Note on naming:** the upstream design system uses `.av-btn` / `.av-btn-primary`. The repo ships `.av-button` / `.av-button-primary` (chosen during the foundation sprint to avoid abbreviation). Don't switch back to `.av-btn-*` without renaming everything in `components.css` first.

> **Follow-up:** `.av-button-accent` (warm-amber for streak / encouragement moments) is described upstream but not yet shipped. If a redesign sprint needs it, add it to `components.css` first.

### 10.2 Cards

```
Static info card                → .av-card
Clickable card                  → .av-card .av-card-interactive   (adds hover lift)
Visually elevated card          → .av-card .av-card-elevated      (deeper shadow)
Borderless / chrome-less card   → .av-card .av-card-flat
Locked / coming-soon card       → .av-card .av-card-locked        (dimmed, no hover)
```

> **Follow-up:** `.av-card-selected` (teal border + halo for the selected-of-N state) isn't shipped. For now, use `.av-card-interactive:focus-visible` styling as a stopgap.

### 10.3 Badges

```
Vocab review state:
  Used well (mastered)          → .av-badge .av-badge-used-well
  Needs review                  → .av-badge .av-badge-needs-review

Generic status:
  Neutral                       → .av-badge .av-badge-neutral
  Primary tint                  → .av-badge .av-badge-primary
  Success                       → .av-badge .av-badge-success
  Warning                       → .av-badge .av-badge-warning
  Error                         → .av-badge .av-badge-error
  Locked / coming-soon          → .av-badge .av-badge-locked
```

> **Follow-up:** `.av-badge-info` (info-blue tint) and `.av-badge-upgrade` (vocab "could be improved" hint) are described upstream but not yet shipped. Stopgap: use `.av-badge-warning` for upgrade-suggested vocab; `.av-badge-primary` reads as info on light, primary on dark.

> **Follow-up — band score pills:** `.av-band-pill` + `.av-band-high/-mid/-low` (mono font, color by tier) aren't shipped. Today the closest is `.av-feedback-band` inside an `.av-feedback-card`. Propose `.av-band-pill` separately if a redesign sprint needs it inline outside a feedback card.

### 10.4 Streak emphasis

```
Streak stat (warm-amber number) → <div class="av-stat-block is-streak">
                                    <span class="av-stat-label">…</span>
                                    <span class="av-stat-value">…</span>
                                  </div>
```

> **Follow-up:** a standalone `.av-streak` chip (described upstream as `.av-streak`) isn't shipped. Use `.av-stat-block.is-streak` for the canonical "X days streak" block; for an inline pill, use `.av-badge` with custom amber styling — and propose `.av-streak` as a follow-up if it shows up in 3+ pages.

### 10.5 Tabs

```
Horizontal tabs (top-level page nav) → .av-tabs > .av-tab
Active state                         → aria-selected="true"  OR  .is-active
Disabled tab                         → .av-tab[disabled]
```

> **Follow-up:** `.av-tabs-sidebar` (vertical sidebar nav for admin) isn't shipped. Sidebar admin pages still use the legacy `.main-tab-btn` / `.tab-btn` pattern. Add `.av-tabs-sidebar` when the admin redesign sprint starts.

### 10.6 Forms

```
Text input                 → .av-input
Textarea (resizable)       → .av-textarea
Select dropdown            → .av-select
Field label                → .av-label
Helper text                → .av-help-text
Error message              → .av-error-text
Checkbox / radio wrapper   → .av-check
```

> **Naming note:** upstream uses `.av-field-label` / `.av-field-helper` / `.av-field-error`. The repo shipped shorter `.av-label` / `.av-help-text` / `.av-error-text`. Use the shipped names; don't introduce a parallel `.av-field-*` namespace.

> **Follow-up:** an `.av-input-error` class that styles the input itself (red border) on validation failure isn't shipped. Today, use inline `aria-invalid="true"` + JS-toggled style. Propose `.av-input-error` when the writing-dashboard redesign needs it.

### 10.7 Modals

```
Backdrop (full-viewport blur) → .av-modal-backdrop
Dialog container              → .av-modal
Header                        → .av-modal-header (contains .av-modal-title)
Body                          → .av-modal-body
Footer (right-aligned action row) → .av-modal-footer
```

> **Follow-up:** size variants `.av-modal-sm` / `.av-modal-md` / `.av-modal-lg` and an `.av-modal-close` button class aren't shipped. The base `.av-modal` is `max-width: 560px`. For a smaller modal, override with inline `style="max-width: 420px"` for now and propose size modifiers as a follow-up.

### 10.8 Toast notifications

```
Toast (single styling, no variant) → .av-toast
Show state                         → .av-toast.is-shown
```

> **Follow-up:** semantic variants `.av-toast-success / -error / -warning / -info` plus the `-icon` / `-body` / `-title` / `-msg` substructure aren't shipped. The base `.av-toast` is currently neutral. If a redesign sprint introduces toast variants, add them to `components.css` first.

### 10.9 Audio (recording + playback)

```
Big mic recorder button (96×96)    → .av-recorder        (.is-recording state)
Compact playback indicator         → .av-player
```

### 10.10 Feedback panels (Speaking + Writing results)

```
Per-criterion feedback card        → .av-feedback-card
Criterion label (uppercase)        → .av-feedback-criterion
Big band number                    → .av-feedback-band

Inline correction (3-line stack):
  Original (struck-through)        → .av-correction > .av-correction-original
  Corrected                        → .av-correction > .av-correction-corrected
  Explanation (Vietnamese)         → .av-correction > .av-correction-explanation

Sample / improved answer block     → .av-sample-answer
```

### 10.11 Page surface

```
<body> opt-in (sets bg, color, font, smoothing) → class="av-page"
Tabular-numerals span                            → class="av-mono"
```

### 10.12 Theme toggle

```
Button (in nav header)             → .av-theme-toggle
  > <svg class="icon-sun">         → shown in dark theme only
  > <svg class="icon-moon">        → shown in light theme only
```

Wired via:
```js
import { bindToggleButton } from '/js/theme-toggle.js';
bindToggleButton(document.querySelector('.av-theme-toggle'));
```

### 10.13 Not yet shipped (propose-then-use)

The following classes are in the upstream Aver Learning Design System but **not** in this repo's `components.css` today. If a redesign sprint needs one, propose it in a separate PR (additive, no behavior change), then consume it in the redesign PR.

- `.av-eyebrow` — small UPPERCASE primary-teal label above a hero
- `.av-divider` — 1px subtle horizontal rule with section margins
- `.av-skeleton` — shimmer animation for loading placeholders
- `.av-progress` + `.av-progress-fill` (linear) and `.av-progress-circle` (SVG)
- `.av-empty` + `-art` / `-title` / `-body` (centered empty-state pattern)
- `.av-tabs-sidebar` (vertical admin nav)
- `.av-band-pill` + `-high` / `-mid` / `-low`
- `.av-streak` (standalone pill)
- `.av-button-accent`, `.av-card-selected`, `.av-input-error`, `.av-badge-info`, `.av-badge-upgrade`
- `.av-modal-sm` / `-md` / `-lg`, `.av-modal-close`
- `.av-toast-success` / `-error` / `-warning` / `-info` + the `-icon` / `-body` / `-title` / `-msg` substructure

---

## 11. Text token decision tree

The four text tokens (`--av-text-primary`, `--av-text-secondary`, `--av-text-muted`, `--av-text-faint`) form a **semantic** hierarchy, not an opacity ladder. Sprint 6.4.1 → 6.4.2 lesson: a per-page redesign that maps legacy `rgba(255,255,255,X)` values to tokens by opacity number ships invisible text on light theme. Sprint 6.4.1 mapped 25 elements to `--av-text-faint` based on their original 0.30/0.35 opacities; on the cream light surface that resolves to ~32% deep navy = ~3:1 contrast, failing WCAG AA. Sprint 6.4.2 fixed it by re-mapping per **semantic role**.

This section codifies the rule so future per-page redesigns (Sprint 6.5+) don't re-discover the bug.

### 11.1 Decision tree

For each piece of copy, walk this tree once. The default at the bottom (`--av-text-secondary`) is the safe fallback when a label sits between buckets:

```
Is it primary user-facing content the user came here to read?
(headings, body copy, helper text, eyebrow labels, sub-labels)
├─ YES → --av-text-primary  (headings, body)
│        --av-text-secondary  (helper, eyebrow, sub-content)
│
└─ NO → Is it secondary metadata (durations, counts, empty-state copy,
   stat-card sub-text, "X minutes ago"-style hints)?
   ├─ YES → --av-text-muted  (~4.6:1 AA in light)
   │
   └─ NO → Is it TRULY auxiliary?
      (em-dash placeholders, disabled state, raw timestamps that
      sit alongside other primary content, tab-input::placeholder)
      ├─ YES → --av-text-faint  (~3:1 — fails AA, OK only because
      │        the user reads adjacent primary copy first)
      │
      └─ Default → --av-text-secondary
```

### 11.2 Token contrast guarantees

Verified against `--av-surface-page` (`#FAFAF9` light / `#0A1628` dark):

| Token | Light contrast | Dark contrast | Use case |
|---|---|---|---|
| `--av-text-primary`   (~92% / 95% opacity) | ~13.8:1 AAA | ~17.5:1 AAA | Body, headings, page titles |
| `--av-text-secondary` (~68% / 72% opacity) | ~6.0:1  AAA | ~7.8:1  AAA | Helper text, eyebrow labels, sub-content |
| `--av-text-muted`     (~50% / 55% opacity) | ~4.6:1  AA  | ~5.6:1  AAA | Meta info, durations, counts, empty states |
| `--av-text-faint`     (~32% / 32% opacity) | ~3.0:1  ⚠️  | ~3.0:1  ⚠️  | Em-dashes, disabled state, placeholders only |

`--av-text-faint` does NOT meet WCAG AA for content. Use it only when the user reads adjacent primary copy first (e.g., an em-dash next to a band score, a timestamp next to an article title) — never as the sole content of an element.

### 11.3 When migrating legacy `rgba(255,255,255,X)` colors

**Don't map by opacity number — map by semantic role.** The legacy opacity ladder was tuned against deep navy ground; the same opacities re-applied as tokens on cream are invisible.

| Legacy pattern | Common semantic | Migrate to |
|---|---|---|
| `rgba(...,0.95–0.85)` body / heading | Primary content | `--av-text-primary` |
| `rgba(...,0.8 –0.7)` helper / sub-heading | Primary content | `--av-text-primary` or `--av-text-secondary` |
| `rgba(...,0.65–0.55)` field labels, hints in parens | Secondary content | `--av-text-secondary` |
| `rgba(...,0.5)` short metadata | Tertiary meta | `--av-text-muted` |
| `rgba(...,0.45–0.4)` durations, counts, sub-text | Tertiary meta | `--av-text-muted` |
| `rgba(...,0.35–0.3)` em-dash, disabled badge | Truly auxiliary | `--av-text-faint` |
| `rgba(...,0.25)` raw timestamps | Truly auxiliary | `--av-text-faint` |

The `0.35–0.3` row is the trap Sprint 6.4.1 hit. Inline opacities at that tier in Sprint 5.1 era code were used for sub-labels like "5 câu hỏi" and helper text in parentheses — both are **content**, not auxiliary. Run the decision tree before defaulting to `--av-text-faint`.

### 11.4 Anti-pattern: opacity-driven migration

❌ **Wrong** — Sprint 6.4.1 mistake (mechanical opacity-to-token map):

```python
# Don't do this. Opacities don't translate 1:1 across light/dark surfaces.
0.85 → text-primary
0.7  → text-secondary
0.55 → text-secondary
0.5  → text-muted
0.4  → text-muted
0.35 → text-faint  # ← becomes invisible on cream
0.30 → text-faint  # ← becomes invisible on cream
```

Result on speaking.html: 25 elements mapped to `--av-text-faint`. Andy's smoke test in light theme found Ngữ pháp eyebrows, Full Test "(tùy chọn — ...)" helper, PART sub-labels (`1 cue card`, `5 câu hỏi`), and stat-card sub-text all unreadable. Required a hotfix sprint (6.4.2) and a rerun of the entire migration script.

✅ **Correct** — Sprint 6.4.2 pattern (semantic role per element):

For each rgba occurrence, look at the surrounding markup:

1. Is this primary content the user reads (heading, body, helper, eyebrow)? → `--av-text-primary` or `--av-text-secondary`
2. Is this secondary meta (duration, count, empty state, stat sub-text)? → `--av-text-muted`
3. Is this truly auxiliary (em-dash, disabled state, raw timestamp)? → `--av-text-faint`

Final distribution on speaking.html after Sprint 6.4.2:

```
--av-text-primary    : ~25
--av-text-secondary  : 19  (helper text, eyebrow, sub-labels)
--av-text-muted      : 59  (durations, counts, meta)
--av-text-faint      :  5  (em-dash + disabled + 3× timestamps)
```

The `--av-text-faint` count dropped to 5 — exactly the truly auxiliary cases.

### 11.5 Inventory tracking — log the distribution in every redesign PR

When migrating each page, count token usage in the served HTML body and CSS, and put the table in the PR body:

```
Token usage in <page>:
  --av-text-primary   : N
  --av-text-secondary : N
  --av-text-muted     : N
  --av-text-faint     : N  (target ≤ 10 per page)
```

If `--av-text-faint` count exceeds ~10 on a page, flag it in PR review. That's almost always over-mapping; walk back through the decision tree.

### 11.6 Verification approach

Before declaring a per-page migration done:

1. Open the page in **both** themes via the toggle. Walk the page top to bottom — every text element must be readable.
2. Sample 3 elements per page in DevTools → Computed → `color`. Paste each value into [WebAIM contrast checker](https://webaim.org/resources/contrastchecker/) against `--av-surface-page`.
3. Confirm `text-secondary` is used **at least 3× more often** than `text-faint` on a content-heavy page.
4. Add a `--av-text-faint` cap to the page's pin tests (e.g., `frontend/tests/<page>-redesign.test.mjs`) so a regression fails CI.

### 11.7 Existing pin in the test suite

`frontend/tests/speaking-redesign.test.mjs` enforces the rules above for speaking.html:

- `--av-text-faint` HTML count ≤ 8 (the 5 legitimate uses + slack)
- helper text "(tùy chọn — ...)" must use `--av-text-secondary`
- PART sub-labels (`1 cue card`, `5 câu hỏi`, `3 chủ đề × 3 câu = 9 câu`) must NOT use `--av-text-faint`
- stat-card sub-text uses `--av-text-muted`
- speaking.css `--av-text-faint` references restricted to `::placeholder` rules (rule-walking allowlist)

Mirror these pins in each new per-page redesign sprint.


## 12. Hardcoded colors = silent theme bugs

Hardcoded `#ffffff`, `#000000`, or any literal color value in dual-theme page CSS can pass visual review in one theme yet **silently fail WCAG AA in the other**. The bug is invisible until a user toggles themes.

This isn't style drift — it's a semantic correctness failure that bypasses the theme system's contrast guarantees.

### 12.1 The Sprint 6.7.1 finding (PR #133)

Three CTAs in `writing-dashboard.css` shipped with `color: #ffffff`:

- `.btn-start-assignment` (the "Làm bài" / "Tiếp tục làm bài" CTA on every assignment card)
- `.btn-primary` (legacy class API kept for parity)
- `.wd-modal-btn-submit` (the "Nộp bài" CTA inside the submit modal)

Codex initially flagged them as "token discipline drift". Investigation surfaced a real WCAG AA failure in dark theme:

| Theme | CTA background (`--av-primary`) | Token `--av-text-on-primary` resolves to | Hardcoded `#ffffff` contrast |
|---|---|---|---|
| Light | `#0F766E` deep teal-700 | `#FFFFFF` | ~6.8:1 — AA ✅ |
| Dark  | `#14B8A6` bright teal-500 | `#0A1628` deep navy | ~1.6:1 — **fails AA** ❌ |

The page was tested in light theme during the Sprint 6.7 redesign; the dark-theme failure shipped unreviewed because the same CSS line rendered "white text on teal background" in both themes — which looks plausible but is wrong on bright teal.

### 12.2 The rule

**All colors in `body.av-page`-scoped CSS MUST use tokens.** Tokens encapsulate theme-flip logic; literals don't. The 4-tier text ladder (§ 11.2) covers text on page/card surfaces; for text on a brand-colored background, use the inverse token (`--av-text-on-primary` and friends).

### 12.3 Detection — run before every merge

```bash
grep -nE "color:\s*#[0-9a-fA-F]{3,6}|color:\s*white\b|color:\s*black\b" frontend/css/<page>.css
```

Expected output on a redesigned page: **0 matches**. Any match is either:

- a literal color that should use a token (the AMBER case)
- a deliberate exception (rare; document it in a comment + cite the design system section)

The same grep is wired into per-page redesign tests (e.g., `writing-dashboard-redesign.test.mjs` has a "zero hardcoded white text values" pin).

### 12.4 Token mapping — common CTA + chip patterns

Pick the inverse token by the **background** the text sits on, not by the literal color you want:

| Background | Light theme text | Dark theme text | Use token |
|---|---|---|---|
| Brand primary (`var(--av-primary)`) | white | dark navy | `var(--av-text-on-primary)` |
| Page surface (`var(--av-surface-page)`) | dark navy | warm white | `var(--av-text-primary)` |
| Card surface (`var(--av-surface-card)`) | dark navy | warm white | `var(--av-text-primary)` |
| Primary-soft tint (`var(--av-primary-soft)`) | deep teal | bright teal | `var(--av-primary)` (the brand color reads on its own tint) |
| Warning-soft (`var(--av-warning-soft)`) | amber-800 | amber-300 | `var(--av-warning)` |
| Error-soft (`var(--av-error-soft)`) | red-700 | red-300 | `var(--av-error)` |

For inverse tokens that don't yet exist (`--av-text-on-warning`, `--av-text-on-error`, etc.), don't invent literals — open a follow-up to add the token, then consume it. Token catalog stays the source of truth.

### 12.5 Anti-pattern — wrong vs right

❌ **Wrong** — passes light theme review, fails dark theme contrast:

```css
.btn-primary {
  background: var(--av-primary);
  color: #ffffff;            /* breaks AA in dark — bright teal needs dark text */
}
```

✅ **Right** — theme-aware via the token:

```css
.btn-primary {
  background: var(--av-primary);
  color: var(--av-text-on-primary);
}
```

✅ **Also right** — if no inverse token covers your case, document the exception inline and cite the design system section:

```css
.unusual-chip {
  background: var(--av-color-amethyst-500);
  /* No --av-text-on-amethyst yet; #fff verified AA in both themes
     against this fixed background. Follow-up: DESIGN-NEW-TOKEN. */
  color: #ffffff;
}
```

Document inline is a much higher bar than just writing the literal — the bar exists to prevent silent-bug recurrence.

### 12.6 Why this matters more than style discipline

Hardcoded colors don't just look inconsistent — they're **semantic bugs** that bypass the theme system's contrast guarantees. A CTA hardcoded white might pass light-theme review (white on teal works) but silently fail dark-theme contrast (white on bright teal fails AA). The bug is invisible until a user toggles themes, and a Vietnamese student reviewing their writing assignment at 10pm with system-preference dark would be the one to find it — not the dev.

The token system was designed to make this class of bug impossible. Using the token isn't ceremony; it's the contract.

### 12.7 Cumulative color lessons — apply ALL in every redesign

Each per-page redesign sprint compounds the prior lessons. Three lessons now apply universally:

| Sprint | Lesson | Pin pattern |
|---|---|---|
| **6.4.1 / 6.4.2** | Semantic-role mapping, not opacity-number mapping. `rgba(0.30–0.35)` is **not** automatically `--av-text-faint`; pick the tier by what the element *means* (primary content / helper text / meta / em-dash) | `--av-text-faint` count ≤ 10, `text-secondary` count > `text-faint` |
| **6.5.1** | ds.css legacy override pattern. The shared `ds.css` hardcodes `color:#fff` and `rgba(255,255,255,X)`; on the cream light surface those are invisible. Override under `body.av-page` instead of modifying ds.css | `body.av-page .ds-* { color: var(--av-...) }` selectors present |
| **6.7.1** | Hardcoded literals = silent theme bugs. Token discipline IS contrast discipline (this section) | Zero `color:\s*#[0-9a-fA-F]+` / `white` / `black` in page CSS |

All three pins live in the per-page redesign test suites. Future Writing-flow / Vocabulary / Profile / Admin / Marketing redesigns must apply all three; the test files are the enforcement layer.

**Sprint history references:**
- Sprint 6.4.1 / 6.4.2 PRs #124 / #125 (speaking.html contrast hotfix series)
- Sprint 6.5.1 PR #128 (practice.html question-card contrast hotfix)
- Sprint 6.7.1 PR #133 (writing-dashboard.html CTA inverse-token fix; this section)


## 13. Writing flow asymmetries and shared-style boundaries

Phase 2 (Sprint 6.7 → 6.9) revealed three architectural truths about the Writing flow that future redesigns and refactors MUST respect. Codex audit Phase 2 flagged that "tests know more than the central brief in a few places" — this section moves those findings out of test-only pin comments and into the central brief so the next contributor doesn't have to reverse-engineer them.

### 13.1 Era A/B reconcile is non-issue (Sprint 6.8 finding)

**Premise (falsified):** Writing has a dual-shape feedback parser (Era A v2.1 + Era B v1) requiring reconcile work during redesign.

**Production reality (Sprint 6.8 pre-work verified):**

- Backend stamps essays UNIFORMLY as `v2.1` (Sprint 2.6.2 anti-fabrication tuning).
- Migration `045_quick_to_standard_migrate.sql` already migrated `v2.1-quick → v2.1`.
- What VARIES is `grading_tier` (`standard` / `deep` / `instructor`) — handled via tier-aware copy + tier badge classes in `writing-renderers.js`.
- `feedback_json` shape varies per L1 / L2+ level — the renderer's `emptyShape()` + `maybeHideOptionalSections()` already handle the matrix gracefully.
- Legacy quick rows are tolerated (Sprint 2.7a.1 note: *"stale rows don't break the UI"*).

**Implication for future Writing pages:** No Era reconcile work. Renderer dispatch is era-tolerant via `emptyShape()` fallbacks. Tier handling is already abstracted. Don't write reconcile code unless pre-work proves the production shape has actually diverged.

### 13.2 Permission gating asymmetry — dashboard vs result

Different Writing pages use different permission patterns. **Don't assume one pattern applies to all.**

| Page | UI banner | JS gating function | Authority |
|---|---|---|---|
| `writing-dashboard.html` | `#writing-preview-banner` (revealed via `classList.remove('hidden')`) | `applyWritingPermissionGating()` disables `.btn-start-assignment` + `#modal-btn-submit` | Backend route-level (`require_writing_permission`) + UI defense-in-depth |
| `writing-result.html` | None | None | Backend route-level only (server-authoritative `/api/student/writing/essays/{id}/feedback` returns 403) |
| `full-test-result.html` | None | None | Backend route-level only (server-authoritative) |

**Rule:** Verify permission pattern per page during pre-work. The dashboard is the only Writing page with a UI lock banner; the result pages rely entirely on server-authoritative 403s.

### 13.3 `writing-renderers.css` is de-facto single-consumer (Sprint 6.8 finding)

The file's header comment describes it as "shared", but production reality (verified Sprint 6.8 pre-work):

- 321 lines, 87 color declarations (migrated to 202 `--av-*` refs in Sprint 6.8).
- `admin-writing-grade.html` does **NOT** link it — it has its own inline styles.
- Only `writing-result.html` consumes it.

**Rule:** Treat as page-specific in future maintenance. Don't assume "shared" comments mean cross-page contract — verify cross-page consumption with `grep -rn "writing-renderers.css" frontend/pages/` before treating any file as shared.

### 13.4 Discovery checklist — before redesigning any Writing page

Run these checks during pre-work. Each one cheap; together they prevent invented work like the falsified Era A/B reconcile.

```bash
# 1. Verify Era / version stamping in the backend
grep -rn "stamp\|version\|v2\.1\|era_" backend/services/ | grep -i writ

# 2. Verify permission gating pattern (UI banner + JS gating fn)
grep -i "permission\|preview-banner\|hasWriting" frontend/pages/<page>.html
grep -i "permission" frontend/js/<page>.js 2>/dev/null

# 3. Verify CSS file consumption breadth (is the "shared" file really shared?)
grep -rn "<page>.css\|writing-renderers.css" frontend/pages/

# 4. Verify renderer dispatch dependencies (SECTION_RENDERERS map / hooks)
grep -rn "SECTION_RENDERERS\|renderSection\|<page>Renderer" frontend/js/
```

Record each finding in the pre-work summary section of the PR description (see `DESIGN_SYSTEM.md` § 15 "Pre-work discipline pattern" for the canonical template). This is the protocol that prevents future inventions and ensures discoveries land centrally instead of in pin-test comments.

**Phase 2 evidence:** Sprint 6.7 pre-work caught the self-directed vs teacher-assignment IA mismatch (~4–6h saved). Sprint 6.8 pre-work falsified the Era A/B reconcile premise (~4h saved). Sprint 6.9 pre-work identified the Chart.js A.2 reuse opportunity (~1.5h saved vs reinventing).
