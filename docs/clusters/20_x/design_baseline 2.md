# Cluster 20.x Reading Module — Design Baseline

**Sprint:** 20.1 (shipped sprint 1, lesson 19.1A — establish design discipline early)
**Scope of authority:** the Reading module across its three chromes. Student
chrome (L1 vocab, L2 browse) and aver-admin chrome (authoring) **reuse the
cluster 19.x baseline verbatim**; the **exam chrome (L3 timed test) is new** and
is the substantive content of this doc.
**Source of truth for tokens:** `frontend/css/aver-design/tokens.css`. This doc
documents *choices* layered on those tokens — it does **not** redefine them.
**References (do not duplicate):** `docs/clusters/19_x/design_baseline.md`
(shared tokens + student/admin patterns), `docs/clusters/20_x/discovery.md`
(empirical basis: §5 BC/IDP UI research, §6 token matrix, §7 3-chrome).

> Empirical note (Pattern #42): the exam chrome's one genuinely net-new visual
> primitive is the **split passage↔question panel** — Listening has no passage
> panel (audio plays), so `frontend/css/ielts-test-paper.css` is single-column.
> Everything else (question renderers, 40-Q nav grid, mono numerics, tokens) is
> reuse. This baseline therefore spends its words on the split-view + exam
> surface overrides, not on re-deriving the design language.

---

## Section 1 — 3-chrome architecture

**Mechanism (empirical, `discovery.md` §7):** chromes are **Shadow-DOM custom
elements with per-page explicit opt-in** — no runtime/URL detection, no
body-class switching. A page picks its chrome by (1) importing the component
module, (2) placing the element, (3) running the anti-flash theme IIFE. Tokens
bridge into each shadow root via `:host-context([data-theme])`.

| Chrome | Component | Used by | Status |
|---|---|---|---|
| **Student** | `frontend/js/components/aver-chrome.js` (`<aver-chrome>`) | L1 vocab, L2 browse/study | **exists** — Reading nav tab is currently `<span class="locked">` (`aver-chrome.js:321`); unlock when L1 ships (Sprint 20.2) |
| **Aver-admin** | `frontend/js/components/aver-admin-chrome.js` | Reading authoring / test builder | **exists** — reuse as-is (Sprint 20.3/20.8) |
| **Exam** | `frontend/js/components/aver-exam-chrome.js` | L3 timed full test | **NEW** — ships Sprint 20.4 (mockup, Andy gate) → 20.6 (impl). Mirror the existing two; add `frontend/css/aver-design/exam-components.css` (mirrors `admin-components.css`) linked only by exam pages. |

**Boundary rule:** entering an L3 test loads the exam chrome; exiting is a normal
page nav back to a student page (re-loads student chrome). Zero coupling — adding
the exam chrome touches no student/admin page.

---

## Section 2 — Shared design tokens (reuse 19.x verbatim)

All from `tokens.css`; see `19_x/design_baseline.md` §§2–4,6 for the full
treatment. **Never hardcode hex; never invent tokens.**

- **Typography:** Plus Jakarta Sans (`--av-font-sans`) body/display; **JetBrains
  Mono (`--av-font-mono`) for numerics** — already designated for "band, timer,
  deadlines" in 19.x §2, i.e. the exam timer/score is *already* mono by the
  existing baseline. Type scale `--av-fs-*` (xs–3xl); line-height `--av-lh-*`
  (use `relaxed 1.7` for long passage reading).
- **Spacing:** 4px scale `--av-space-*`. **Skipped steps (5/7/9/10/11/13/14/15)
  do not exist — a CI test fails on `var(--av-space-5)`.** Compose (`4 + 2`) when
  a between-value is needed.
- **Radii:** `--av-radius-*` (sm 4 · md 8 · lg 12 · xl 16 · pill 999).
- **Shadow / motion:** `--av-shadow-*`; durations `--av-duration-fast/base/slow`
  + easings.
- **A11y primitives:** focus ring `2px solid var(--av-primary)` `outline-offset
  2px`; WCAG-AA token pairs; `prefers-reduced-motion` guard. **`text-faint` is
  CI-capped** — do not use it for exam passage text (use `text-secondary`/`-muted`).

---

## Section 3 — Chrome-specific overrides

### 3A — Student chrome (L1 vocab reading, L2 browse) — reuse 19.x verbatim
Warm off-white / deep navy surfaces, generous spacing, subtle hover/transition
motion. Patterns: **library cards** (reuse `.essay-card`/card idiom for L1/L2
catalog tiles), filter chips (`.aw-filter-btn`), empty states. New student
component: the **glossary popover** (§4C, Sprint 20.2). No new opinions here —
if a token is missing, escalate to `tokens.css`, don't hardcode.

### 3B — Aver-admin chrome (authoring, test builder) — reuse 19.x verbatim
Information-dense; admin sees full status sets (no student-side hiding). Reuse
the `.aw-import-*` drag-drop idiom for content import, `admin-components.css`
(`box-sizing:border-box`) on any new admin table page. Test-builder workflow
patterns documented when that sprint lands (20.8).

### 3C — Exam chrome (L3 test session) — NEW
Aesthetic direction: **industrial/utilitarian** — concentration-focused,
distraction-free, exam-grade (BC/IDP reference, `discovery.md` §5). The opposite
of the warm student chrome; restraint *is* the differentiator (not decoration).

| Aspect | Exam-chrome choice | vs 19.x |
|---|---|---|
| **Surface** | Neutral, low-chroma gray (light: `~#F4F5F6` base, `~#E5E7EB` borders; dark: cool slate). Add as **exam surface tokens** in `exam-components.css`, not new global tokens. | Override (19.x is warm off-white) |
| **Accent** | **One** accent (teal `--av-primary`) for interactive states only; **drop amber/"warmth" entirely**; `--av-error` red reserved for the timer warning. | Override (19.x uses amber for encouragement) |
| **Typography** | `--av-font-mono` for timer + score; body sans for passage + questions; passage at `--av-lh-relaxed`. | Reuse |
| **Motion** | **Zero decorative.** Functional only: (a) timer red pulse at 10 + 5 min remaining, (b) flag toggle state, (c) nav-palette current-Q highlight. All `prefers-reduced-motion`-guarded. | Restrict |
| **Density** | Compact, exam-utility; question paper reuses `ielts-test-paper.css` spacing. | Reuse |

**Layout (split-view):** passage **left ~55%**, questions **right ~45%**, each
panel **scrolls independently** with a visible boundary. Top: prominent timer +
test progress. Bottom: persistent **nav palette** (numbered, jump-to-Q) with a
**flag indicator** per question. Right-click highlight/notes context menu =
**Phase B** (not Phase 1). Copy-from-passage stays allowed (native; don't block).

---

## Section 4 — Reading-specific component patterns (NEW)

### 4A — Passage panel (exam chrome) — the one net-new primitive
- Left ~55% of the split; **independent scroll** from the question panel
  (`overflow:auto` per panel, not page-level). Visible vertical boundary
  (`--av-border-default`).
- Body via `js/markdown.js` (marked + DOMPurify) into a `.md-body`-style
  container at `--av-lh-relaxed`.
- Mobile (`<768px`): **graceful degradation** — stacked (passage above
  questions) with a sticky toggle, not side-by-side (Pattern #29).
- Highlight tool = placeholder/Phase B.

### 4B — Question paper (reuse 19.x + listening)
- Reuse `css/ielts-test-paper.css` (already `--av-*`): circled Q-numbers, dotted
  gap inputs (`.ielts-gap-input`), form/table/MCQ containers.
- **Nav palette:** reuse the 40-Q grid `repeat(20, minmax(24px,1fr))`
  (`ielts-test-paper.css:476`); add a **flag state** (corner dot / ring) — the
  net-new addition to the palette.

### 4C — Glossary popover (student chrome, Sprint 20.2)
- Inline highlighted term in an L1 passage → click/Enter opens a popover with
  definition + example. Aver-brand styling (warm, `--av-surface-elevated`,
  `--av-shadow-md`), **not** exam-grade. Keyboard + `aria` (popover is
  `role="dialog"` or a labelled disclosure); Esc/click-out close (reuse the
  `.wr-modal`/lightbox close idiom).

### 4D — Skill-tag badges (diagnostic UI, Sprint 20.7)
- Per-question + per-result rollup. 8 D2 tags with consistent color coding
  (semantic, from tokens — not 8 arbitrary hues): group warm vs cool by skill
  family, reuse `.pill`/`*-soft` tints. Defined in detail when 20.7 lands.

---

## Section 5 — Question-type rendering language

Phase 1 subset (all reuse `listening-test-player.js` renderers per
`discovery.md` §3):

1. **MCQ single** — radio (`renderMCQ`).
2. **True/False/Not Given** — 3-way radio (extend listening's 2-way `true_false`).
3. **Yes/No/Not Given** — same renderer as #2, different labels.
4. **Sentence completion** — text gap (`renderSentenceCompletion`).
5. **Summary / note / table / form completion** — text gaps (listening completion renderers).
6. **Short answer** — text input (`renderShortAnswer`).
7. **Matching headings** — dropdown-`<select>` (reuse `plan_label`; D7), the one mild adaptation.

Phase B: drag-drop matching (`matching_information/features/sentence_endings`),
`mcq_multi`, `flow_chart_completion`, `diagram_label_completion`.

---

## Section 6 — Mobile + accessibility constraints

- **Exam chrome is desktop-primary**; mobile degrades to stacked panels with a
  scrollable nav palette (Pattern #29). Never hide the timer or submit on mobile.
- **Keyboard:** Tab through questions/inputs; nav-palette items are focusable
  buttons (arrow-key jump optional); Enter on the focused palette item jumps;
  submit reachable without a pointer.
- **Screen reader:** each question has an `aria-label`/legend naming its number +
  type; the timer is an `aria-live="polite"` region that announces at the 10 + 5
  min warnings (not every tick); flag toggle exposes pressed state
  (`aria-pressed`).
- **Reduced motion:** the three functional motions (§3C) are all guarded.

---

## Section 7 — Token transferability matrix (from `discovery.md` §6)

| Token group | → Exam chrome | Transferable? |
|---|---|---|
| Type family (sans + mono) | mono already = timer/band numerics | ✅ direct |
| Type scale / line-height | passage at `relaxed` | ✅ direct |
| Spacing (4px) | denser; favour `space-3/4`; mind CI skip-steps | ✅ direct |
| Radii | flatter; favour `sm/md` | ✅ direct |
| Text ladder | passage = `primary`; **avoid `text-faint` (CI-capped)** | ✅ direct |
| **Surface palette** | warm off-white → **neutral gray** | ⚠ override (exam-components.css) |
| Brand accent (teal) | keep, interactive-only | ✅ direct (rationed) |
| **Amber accent** | drop "warmth"; keep only `--av-warning`/`--av-error` | ⚠ partial (semantic-only) |
| Semantic quartet | correct/incorrect/timer | ✅ direct |
| Motion | functional-only | ⚠ restrict |
| A11y primitives | reuse all (exam is a11y-critical) | ✅ direct + mandatory |

**Only two real conflicts:** warm vs neutral page surface, and amber warmth.
Both resolve via a thin exam override layer (`exam-components.css`), **not** a
token fork.

---

## Section 8 — Subsequent-sprint design discipline (cluster 20.x lifecycle)

Per lesson 19.1A (baseline grows with the cluster):

- Every **frontend** sprint commission MUST (a) paste the `frontend-design`
  skill inline (Pattern #44) and (b) reference this baseline doc.
- **New components → document HERE before shipping.** Specifically:
  - **Sprint 20.2** fills §4C (glossary popover) with final specs.
  - **Sprint 20.4** (exam-chrome mockup, Andy gate) updates §3C + §4A/4B with
    the approved split-view + nav-palette/flag + timer details, and lands the
    concrete exam surface token values in `exam-components.css`.
  - **Sprint 20.7** fills §4D (skill-tag badge color system).
- **Pattern #42 watch-items (carry every sprint):** compose `--av-space-*`
  (never invent `space-5/7/9`); `text-faint` is CI-capped; mono is already the
  timer/band font (don't add a new one). Reading gets its **own** tables/CSS —
  never entangle with writing_tips/`task_type` (deferred rename debt).

---

**Baseline owner:** whoever lands a sprint that changes a shared pattern. Needs a
token that doesn't exist? **Escalate** — extend `tokens.css` deliberately, don't
hardcode.
