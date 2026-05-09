# Unified Design Brief — Per-Page Redesign

> Companion to `DESIGN_SYSTEM.md`. This brief is the operational checklist for migrating an existing page from the legacy `--ds-*` / Manrope+Fraunces system onto the unified `--av-*` / Plus Jakarta Sans + JetBrains Mono system.

---

## 1. Scope of one page redesign

A page redesign is **one PR per page**. Don't bundle two pages into one PR — review surface explodes and JS coupling breaks become impossible to localize.

Exception: pages that are sibling iframe panels (e.g., `my-vocabulary.html` + `flashcards.html` + `exercises.html` mounted into `vocabulary.html`) may share one PR if the redesign keeps them visually identical and the iframe contract is unchanged.

---

## 2. Priority order

| Phase | Pages | Reason |
|---|---|---|
| **Phase 1** | `home.html`, `speaking.html`, `practice.html`, `result.html` | Daily-use surfaces; biggest perceived-quality win |
| **Phase 2** | `writing-dashboard.html`, `writing-result.html`, `full-test-result.html`, `profile.html`, `onboarding.html`, `vocabulary.html` (+ 4 iframe panels) | High-value but lower-frequency screens |
| **Phase 3** | `admin.html` + 8 `admin-*` sub-pages | Internal-facing; bigger refactor (extract `admin.css` first) |
| **Phase 4** | Grammar Wiki cluster (`grammar.html` + 5 sub-pages, `vocab-article.html`) | Decision pending — keep DM Sans + Lora as intentional sub-system, or unify |
| **Phase 5** | `index.html`, `landing.html`, `pricing.html` | Marketing pages; reconcile Era B → Era A brand at the same time |

The `frontend-design` skill warns against the Phase 1 trap of converging on identical patterns across all pages. Each redesign should commit to a clear aesthetic direction for the page's purpose:

- **Home** — editorial overview, asymmetric, generous whitespace, display-scale stats
- **Speaking dashboard** — dense session history with a calm hierarchy, not a marketing layout
- **Practice** — focus mode, minimal chrome during recording, clear state machine affordances
- **Result** — long-form reading; relaxed line-height, atmospheric breaks between criteria

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

If the page is `writing-dashboard.html`, `writing-result.html`, or any vocabulary surface, preserve the Sprint 5.2 / 5.2.1 gating UI states:

- `.skill-card-locked` muted variant when permission missing
- Locked-CTA modal copy (Vietnamese) intact
- The `Liên hệ admin` action wired to the support email/Telegram link

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
