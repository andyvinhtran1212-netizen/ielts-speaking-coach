# Cluster 19.x — Writing-Coach Design Baseline

**Sprint:** 19.1A (captured alongside the first feature sprint)
**Scope of authority:** student-facing Writing-Coach pages (`writing-dashboard.html`, `writing-result.html`). Admin writing pages are a separate concern (their own chrome) and out of scope here.
**Source of truth for tokens:** `frontend/css/aver-design/tokens.css`. This doc documents *choices* layered on those tokens — it does **not** redefine them.
**Purpose:** lock the aesthetic so sprints 19.1B → 19.4 extend it instead of drifting, avoiding an end-of-cluster restyle.

> Empirical note (Pattern #42): both pages were *already* migrated to the `--av-*` token system (Sprints 6.7/6.8) and already use the student `<aver-chrome>` shell. 19.1A is **refinement**, not a redesign — the baseline below is mostly *documenting what the token system already commits to*, plus the small set of new component patterns 19.1A introduced.

---

## 1. Aesthetic direction

**Refined minimalism, editorial calm.** The student is mid-exam-prep and often anxious about scores — the interface should feel composed, legible, and unhurried, never busy or gamified. Dominant warm-neutral surfaces, a single teal brand accent doing the pointing, generous line-height tuned for Vietnamese diacritics, and restraint with colour (colour means something — band tiers, urgency, status). Motion is a quiet confirmation layer, not decoration.

This is the *opposite* of maximalism by design: per the `frontend-design` skill, "minimalist and refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details." The brand already chose distinctive type (Plus Jakarta Sans, not Inter/Roboto) — the job is to wield it consistently.

---

## 2. Typography

All values from `tokens.css` (do not hardcode):

| Role | Token | Value |
|---|---|---|
| Display / body | `--av-font-sans` / `--av-font-display` | Plus Jakarta Sans (geometric-humanist, strong VN diacritics) |
| Numerics (band, timer, deadlines) | `--av-font-mono` | JetBrains Mono |

Type scale (`--av-fs-*`): `xs 12px · sm 14px · base 16px · lg 18px · xl 20px · 2xl 24px · 3xl 30px`.
Line-height (`--av-lh-*`): `tight 1.2` (display only) · `snug 1.4` (short headings/buttons) · `normal 1.55` (body — VN-safe default) · `relaxed 1.7` (long reading: essay text, feedback prose).
Weights (`--av-fw-*`): regular 400 · medium 500 · semibold 600 · bold 700.
Letter-spacing: `--av-tracking-widest (0.18em)` for uppercase eyebrows/labels; `--av-tracking-wide (0.04em)` for small uppercase section titles.

**Usage rules**
- Page H1 (greeting, essay prompt title): `--av-fs-2xl`/`3xl`, semibold, `--av-text-primary`.
- Section titles: `--av-fs-lg`, semibold.
- The brand **eyebrow** ("Writing") is the canonical `.eyebrow` component (`components.css`) — uppercase, widest tracking, `--av-primary`. Reuse it, never re-style it locally.
- Numerics that need alignment (band scores, `mm:ss` timer, "Còn N giờ") use `--av-font-mono`.
- Body copy ≥ `--av-fs-sm` at `--av-lh-normal`; long-form (essay original, feedback) at `--av-lh-relaxed`.

---

## 3. Color palette

Teal-primary, warm off-white (light) / deep navy (dark), amber accent, semantic quartet. Both themes ship from day one via `[data-theme]`; **never hardcode hex** (only documented exception: `@media print` in `writing-result.css`).

| Intent | Token |
|---|---|
| Brand / primary action / links | `--av-primary` (+ `-hover`, `-soft`, `-border`) |
| Encouragement / "in progress" warmth | `--av-accent` / `--av-warning` (amber) |
| Page / card / elevated / sunken surfaces | `--av-surface-page` / `-card` / `-elevated` / `-sunken` |
| Text ladder | `--av-text-primary` / `-secondary` / `-muted` / `-faint` |
| Borders | `--av-border-subtle` / `-default` / `-strong` |
| Success / warning / error / info (+ `-soft`) | `--av-success` / `-warning` / `-error` / `-info` |

**Usage rules (semantic, per UNIFIED_DESIGN_BRIEF §11)**
- Primary content → `text-primary`; secondary → `text-secondary`; meta/dates/hints → `text-muted`; em-dash placeholders → `text-faint`. **`text-faint` is rationed** (a result-page test caps usage ≤ 10) — don't reach for it as "light gray."
- One accent at a time: teal points; amber warms/warns; semantic colours only carry their meaning (don't use `--av-error` red for decoration).
- `*-soft` tints are for pill/chip backgrounds; the solid token for the text/icon on top.

---

## 4. Spacing rhythm

4px base scale (`--av-space-*`): `1=4 · 2=8 · 3=12 · 4=16 · 6=24 · 8=32 · 12=48 · 16=64 · 20=80 · 24=96`. **Skipped steps (5/7/9/10/11/13/14/15) do not exist** — a CI test fails on `var(--av-space-5)` etc. Compose (`4 + 2`) when a between-value is genuinely needed.

Patterns in use:
- Card padding: `--av-space-4` (16px); compact rows: `--av-space-2`/`-3`.
- Section gap: `--av-space-6`/`-8`; chrome-to-content rhythm uses the canonical `--av-chrome-*` tokens.
- Inline control gap: `--av-space-1`/`-2`/`-3`.
- Radii (`--av-radius-*`): `sm 4 · md 8 · lg 12 · xl 16 · pill 999`. Cards/panels = `lg`; buttons/inputs/chips = `md`; status pills = `pill`.

---

## 5. Component patterns

| Component | Spec | Class hooks |
|---|---|---|
| **Card** (essay / assignment) | `--av-surface-card`, `--av-border-subtle`, radius `lg`, padding `space-4`; hover lifts `translateY(-2px)` + `--av-shadow-md` + `--av-primary-soft` tint (clickable only) | `.essay-card(.clickable)`, `.assignment-card` |
| **Status pill** | radius `pill`, `fs-xs`, medium; `*-soft` bg + solid text | `.pill` + `.pill-{green,amber,red,wait,blue,gray,purple,timed}` |
| **Student status model** (Deliverable 4 — **canonical, reuse cluster-wide**) | 4 student-visible states; the AI grading lifecycle is **never** exposed on student surfaces | see table below |
| **Band pill** | radius `md`, bold, 4 tiers by score | `.essay-band-pill.band-{low,mid,good,high}` |
| **Primary button** | `--av-primary` bg, `--av-text-on-primary`, radius `md`, hover `translateY(-1px)` | `.btn-primary`, `.btn-start-assignment`, `.wd-modal-btn-submit` |
| **Secondary / icon button** | `--av-surface-card` + `--av-border-subtle`, hover elevates border+surface | `.btn-secondary`, `.btn-icon`, `.essay-dl-btn` |
| **Tabs** | underline (dashboard) or soft-pill (result); active = `--av-primary` | `.tab-btn(.active/.is-active)` |
| **Filter chips** | radius `md`, soft-active state + count bubble | `.essay-filter-btn`, `.filter-count` |
| **Deadline row** (Deliverable 2) | full-width button, urgency dot + mono "when" label, hover tint | `.wd-deadline-row(--overdue/urgent/soon/normal)` |
| **Empty state** | dashed border, centred icon + title + hint | `.wd-empty(.--compact)` |
| **Modal** | full-screen overlay on `--av-surface-page`, prompt panel as a card | `.wd-submit-modal`, `.wd-modal-*` |

**Student status model (collapse 6 backend states → 4 visible):**

| Visible label | Backend states | Pill |
|---|---|---|
| `⏳ Chờ chấm` (neutral) | pending, submitted, grading, graded, reviewed | `.pill-wait` (slate, `--av-surface-sunken`) |
| `✓ Đã chấm` (success) | delivered | `.pill-green` |
| `⚠ Bị đánh dấu` (warning) | `is_flagged` (resolved **before** status — flagged carries status='delivered') | `.pill-amber` |
| `⚠ Lỗi` (error) | failed | `.pill-red` |

**Urgency colour mapping (deadlines):** overdue → `--av-error`; `<24h` urgent → `--av-warning`; `<72h` soon → `--av-info`; else normal → `--av-text-muted`.

---

## 6. Motion conventions

Three durations + canonical easings from `tokens.css`: `--av-duration-fast 150ms` (hover/focus, colour) · `--av-duration-base 250ms` (card transform/shadow) · `--av-duration-slow 400ms` (page-level). Easing: `--av-easing-default` (standard), `--av-easing-bounce` (playful — use sparingly). Anti-flash IIFE + `.theme-loading` suppress transitions on first paint.

Rules: transition specific properties (not `all`) where practical; hover lifts are `translateY(-1px/-2px)`; spinners use the local `state-spin` keyframe. **Every motion must be wrapped by a `@media (prefers-reduced-motion: reduce)` guard** (added to both pages in 19.1A) — transitions/transforms/spin disabled, smooth-scroll off.

---

## 7. Accessibility notes

- **Contrast:** token text/surface pairs target WCAG AA in both themes; `text-faint` is rationed (CI-capped) to avoid sub-AA gray-on-gray.
- **Focus:** every interactive control shows a visible `:focus-visible` ring — `2px solid var(--av-primary)`, `outline-offset 2px`. 19.1A added these to result-page tabs/buttons and all new dashboard controls. New surfaces **must** include it.
- **Keyboard:** clickable cards are `role="link" tabindex="0"` with Enter/Space handlers; nested action buttons (download) `stopPropagation` so focus/activation never double-fires.
- **Semantics:** decorative emoji/icons are `aria-hidden`; action buttons carry Vietnamese `aria-label`s; status uses label text + colour (never colour alone).
- **Reduced motion:** honoured (see §6).

---

## 8. Subsequent-sprint guidance (best-effort — refine per commission)

**19.1B — Writing-tips library (admin CRUD + student "Mẹo viết" tab)** ✅ SHIPPED (#309)
- Student tips surface lives as a **third dashboard tab** alongside `Bài giao` / `Bài đã nộp`, reusing `.tab-btn` + the `.wd-empty` empty state. Tip cards reuse the `.essay-card` pattern.
- Admin CRUD on admin chrome. Markdown render+sanitize shared via `js/markdown.js` + `.md-body` (`css/markdown.css`).

**19.2 — Cohort admin views (student × essay status matrix)** ✅ SHIPPED (#311)
- Admin surface (aver-admin chrome). Admin cells show the full 6 backend states (the student-side AI-hiding rule is student-only). Drag-drop import idiom: `.aw-import-*` in `admin-writing.css`.

**19.3 — Independent grading file upload (admin)** ✅ SHIPPED (#-)
- Reused the **`.aw-import-*` drag-drop panel** (19.1C) on `new.html` as a `<details>` helper above the essay field. **Established pattern: extract → fill the textarea (textarea stays the source of truth for submit)** — mirrors the student `/extract-text` flow; do NOT hard-toggle/hide the paste field. Backend reuses `file_extract_service` (`.docx`/`.txt`, 2MB, 15k chars). Export UX on `grade.html` was already mature (`/render`→ClipboardItem for Google Docs paste + `export.docx`); 19.3 only added clearer VN labels/tooltips + loading state.

**19.3.5 — Task 1 Academic image support** ✅ SHIPPED (#314)
- **Image display + lightbox is a shared idiom now:** `js/image-lightbox.js` (`window.AvImageLightbox.open(src, alt)`, Esc/backdrop close) + `css/image-lightbox.css` (`.prompt-chart-img` thumbnail + `.av-lightbox` overlay, all `--av-*`). Reuse on any page that shows a chart/diagram — link both, render `<img class="prompt-chart-img" role="button" tabindex="0">`, call `AvImageLightbox.open` on click/Enter/Space. Used by `grade.html` (admin) + `writing-result.html` (student).
- **Multimodal Gemini pattern** (`gemini_writing_grader.py`): the legacy `google.generativeai` SDK takes a `generate_content([text, {"mime_type", "data": bytes}])` list. Image fetched from the Cloudinary URL (httpx, ≤2 retries / ~10s cap); fetch failure or missing image → text-only + a caveat prepended to `overallBandScoreSummary` (D7), never a block.
- **Snapshot wiring (Pattern #42 fix):** the student submit path didn't populate `writing_essays.prompt_image_url`; 19.3.5 wired it so library Task 1 Academic essays reach the grader with their chart.

**19.4 — Student regrade-request + result-page tips recommendation** ✅ SHIPPED (#315) — *email DEFERRED*
- **Email NOT shipped:** there is NO transactional-email infra in the backend — signup/reset are sent by Supabase Auth (managed), not project code. Building it needs a provider + credentials (out of "reuse-only" scope). Andy chose to defer; trigger points carry `# TODO(19.4 email deferred)` comments at `mark_delivered` (student) + the student regrade POST (admin). A future sprint wires a provider (Resend/SendGrid/SMTP) into those hooks.
- **Regrade request state machine:** `essay_regrade_requests` (UNIQUE essay_id = 1/essay). Student POSTs reason (50–500) on a `delivered` essay → `pending`. Admin **accept** → un-delivers the essay (`delivered → reviewed`, `delivered_at=null`) so the student stops seeing final feedback + admin re-handles in grade.html; re-delivery (`mark_delivered`) flips the request to `fulfilled`. Admin **reject** → terminal + `admin_response` shown to the student. The student result page polls `GET …/regrade-request` for the right state (button / pending / rejected / fulfilled).
- **Re-grade control** sits in `writing-result.html` header-actions as a `.btn-icon`; modal reason uses the `.wr-modal` shell (centred, backdrop+Esc close) — reuse `.wr-modal` for any student-side form/detail modal.
- **Tips recommendation:** `writing-result.html` fetches `GET /api/writing/tips` once + filters client-side by `_essayTaskToTipTask` (essay `task1_academic`/`task1_general` → tip `task_1`; `task2` → `task_2`; always include `both`) — handles the two task_type vocabularies until 19.5 reconciles them. Cards (`.tips-reco__card`) open the tip in a `.wr-modal` via `renderMarkdown`.

> Cluster 19.x retrospective deferred to the **19.5 cleanup phase** (which also closes: email provider, `writing_tips` rename, task_type vocab reconciliation, the stale `aver-admin-chrome.test.mjs` cohorts/usage fails, and `cohorts.html`'s `essay-filter-btn`→`aw-filter-btn` chip-class fix).

---

**Baseline owner:** updated by whoever lands a sprint that changes a shared pattern. If a sprint needs a token that doesn't exist, **escalate** — extend `tokens.css` deliberately, don't hardcode.
