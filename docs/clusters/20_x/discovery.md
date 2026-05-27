# Cluster 20.x Reading Module — Discovery (Sprint 20.0)

**Date:** 2026-05-27
**Author:** Code (autonomous Discovery)
**Type:** Discovery-first multi-touchpoint (Pattern #43) — zero feature LOC
**Predecessor:** Cluster 19.x Writing-Coach Refinement (closed PR #316)
**Authority:** Code PF empirical authoritative for findings (Pattern #42); decisions surfaced non-authoritative for Mình + Andy

---

## Section 0 — Mind-side premise corrections (Pattern #42)

The single biggest correction reframes the whole cluster: the commission frames reuse around **Speaking + Writing**, but the closest analog to a Reading module already exists and is **mature — the Listening module**. Listening is an objective, auto-scored, multi-question-type, timed-test subsystem with attempt persistence and a question-paper UI. Reading is structurally the same problem (passage instead of audio). **Listening is the master template; Writing/Speaking contribute secondary idioms.**

| # | Mình premise (commission) | Code empirical finding | Verdict |
|---|---|---|---|
| 1 | Reading subsystem maturity unknown | **Zero reading code.** No `reading*` router, no `reading_*` migration (last is `085`), no reading page/table. BUT `aver-chrome.js:321` already ships a **locked "Reading" nav tab** and `student_home.py:8` names Reading as a planned surface. | Greenfield, slot reserved |
| 2 | Reuse mostly from Speaking/Writing | **Listening is the dominant reuse target** (auto-scoring, attempt schema, 8 question renderers, band-map, nav palette, exam-paper CSS). Writing contributes the *admin-import UX idiom* + markdown rendering + Cloudinary image idiom only. | Reframed |
| 3 | Listening scoring approach unknown (blind spot #3) | **Deterministic, no-AI.** `listening_test_grader.py` does per-question string matching + `_BAND_MAP` (40-pt → band). Directly clonable for Reading. Big LOC saver for Sprint 20.5. | Confirmed reusable |
| 4 | ~70% of 19.x tokens transferable to exam chrome | **Higher (~90%).** Tokens are chrome-agnostic; `--av-font-mono` (JetBrains Mono) is *already* designated for "timer/band" numerics in the baseline. Exam chrome diverges in *application* (density, zero decorative motion), not in *tokens*. | Higher than assumed |
| 5 | 3-chrome mechanism unknown | **Per-page explicit opt-in via Shadow-DOM web components** (no runtime detection). Adding a third chrome = add `aver-exam-chrome.js`, mirror the pattern. Zero contamination risk. | Mechanism is trivial |
| 6 | Question renderers mostly net-new | **6+ renderers already exist** in `listening-test-player.js` (form/table/notes/summary/sentence completion, short-answer, MCQ, plan-label-select). Reading reuses most. Only *matching headings* + drag-drop are net-new. | Mostly reuse |
| 7 | Markdown may be insufficient for passages | **GFM (marked + DOMPurify) covers tables/blockquote/lists/links/images.** Subscript/superscript + raw HTML are stripped — but IELTS Academic Reading rarely needs them. | Markdown sufficient Phase 1 |
| 8 | Reading content reuses the 19.1C writing import | **Partial.** The 19.1C importer is *markdown-body* oriented (prose tips/samples). Reading *exercises/tests* need structured **question + answer-key JSON**, which matches the **Listening content model** (`listening_exercises.payload` JSONB), not the writing-tips markdown row. | Split: see §2/§8 |
| 9 | Split-view is "just layout" | The **passage↔question split panel is the one genuinely net-new exam primitive.** Listening has no passage panel (audio plays); `ielts-test-paper.css` is single-column. This is the Sprint 20.4 mockup focal point. | Net-new, focal |

---

## Section 1 — Existing reading subsystem inventory

**Maturity: GREENFIELD (zero code), with a reserved UI slot.**

Empirical sweep (repo root `/Users/trantrongvinh/Documents/ielts-speaking-coach`):

- `backend/routers/` — no `reading*.py`. (Closest: `listening.py`, `questions.py`, `sessions.py`.)
- `backend/services/` — no `reading*`. ~12 `listening_*` services exist.
- `backend/migrations/` — no `reading_*` table. Highest migration is **`085_essay_regrade_reason_check.sql`** → next reading migration = **086**.
- `frontend/pages/` — no `reading-*.html`. Listening has 11 pages.
- `frontend/pages/admin/` — no `reading/` dir.
- **Reserved slot:** `frontend/js/components/aver-chrome.js:321` → `<span class="locked" aria-disabled="true">Reading</span>`. The student nav already anticipates a Reading tab; unlocking it is a 1-line change once pages exist.

**Naming conventions established (to follow for reading):** singular-prefixed tables (`listening_tests`, `listening_content`, `listening_exercises`, `listening_test_attempts`); `*_attempts` for graded sessions; pages are kebab `listening-*.html`; admin pages live under `pages/admin/<module>/`.

---

## Section 2 — Speaking + Writing + Listening reusable patterns

### 2A — Listening module (PRIMARY reuse — clone-grade)

| Asset | File:line | Reading applicability |
|---|---|---|
| **Auto-scoring** (deterministic, no AI) | `services/listening_test_grader.py` — `grade_attempt()` L222–273; `_BAND_MAP` L136–158; per-Q string match L94–159 | Clone wholesale. Swap band table (Reading has its own /40→band map). |
| **Attempt schema** | `migrations/068_listening_test_attempts.sql` — `answers` JSONB array, `status` (in_progress/submitted/abandoned), `score`, `grading_details` JSONB, `band_estimate`, RLS | Clone as `reading_test_attempts`. Same incremental-PATCH model. |
| **Content/question schema** | `migrations/056` (`listening_content`, `listening_exercises.payload` JSONB), `065` (`listening_tests`), `066` (test↔section link) | Mirror as `reading_tests` / `reading_passages` / `reading_questions`. The `payload` JSONB `{questions[], answers[]}` discriminated-by-type pattern transfers exactly. |
| **Answer-key stripping** | `listening.py` GET test L4819 `strip_answer_keys()` | Reuse: never ship answer keys to the student fetch. |
| **Attempt lifecycle** | `listening.py` — POST attempts L4887 (abandons prior in-progress), PATCH answers L4955 (upsert by `q_num`, debounced 2s client-side), POST submit L4991 (extract key → grade → immutable write) | Clone the 3-endpoint lifecycle verbatim. |
| **Question renderers** | `js/listening-test-player.js` L341–599 | Reuse: `mcq_3option`, `sentence_completion`, `summary_completion`, `notes/table/form_completion`, `short_answer`, `plan_label`(select). |
| **Exam-paper CSS** | `css/ielts-test-paper.css` (18 KB, all `--av-*`) — circled Q-numbers L101, dotted gap inputs L120, form/table/MCQ containers, 40-Q nav grid `repeat(20,minmax(24px,1fr))` L476 | Reuse for the question panel. **Does not include a split-view** — that is net-new (§7). |
| **Diagnostic-style rollup** | `listening_test_grader.py` `trap_analytics` L164–189 + `section_breakdown` L195–216 | Direct precedent for rule-based **tag aggregation** (each Q tagged → aggregate accuracy by tag). The diagnostic engine is *the same shape* as trap_analytics. |
| **Optional AI gist grade** | `services/listening_gist_grader.py` (Claude Haiku 4.5, fail-soft) | Only if Reading later adds a free-text summary task. Phase 1 reading = objective only → **no AI dep**. |

### 2B — Writing module (SECONDARY reuse — idioms)

| Asset | File:line | Reading applicability |
|---|---|---|
| **Admin import UX** (dry-run → commit, drag-drop) | `routers/admin_writing_tips.py` L234–309; `pages/admin/writing/tips.html` L410–552; `.aw-import-*` in `admin-writing.css` | Reuse the *idiom* (dry-run preview → commit, upsert by slug) for the reading-passage/test authoring page. |
| **Content import service** | `services/content_import_service.py` — markdown+YAML frontmatter, `CONTENT_TYPES` enum L27, `type_data` JSONB (validate at API layer, no DB CHECK) L112 | **Reuse for L1 prose passages + glossary** (markdown body). **Not** ideal for L2/L3 structured question banks — those fit the Listening `payload` model better. See §8 decision D1. |
| **`.docx`/`.txt` extraction** | `services/file_extract_service.py` (2 MB, 15k chars) | Reading passages often arrive as Word docs → admin can extract into the editor. Reusable as-is. |
| **Cloudinary images** | `services/cloudinary_service.py` (jpg/png/webp/gif, 5 MB, auto-transform) + `js/image-lightbox.js` (19.3.5 shared idiom) | Reading passages with charts/diagrams reuse this directly. |
| **Markdown render** | `js/markdown.js` (marked + DOMPurify, GFM, `breaks:true`) + `css/markdown.css` `.md-body` | Reuse for passage/glossary rendering. GFM tables/blockquote/lists OK; subscript/sup + raw HTML stripped (§Dimension-8). |
| **Status simplification (19.1A)** | baseline §5 (6 backend → 4 student states) | Reading attempt states are simpler (in_progress/submitted) — the *collapse pattern* applies if grading ever becomes async. |
| **Notification deferral hooks** | `# TODO(19.4 email deferred)` in `writing_student.py` etc. | Reading test completion notify = same deferral posture (no email infra). **Not a Phase-1 need.** |

### 2C — Speaking module (TERTIARY — minimal)

Speaking's renderers are audio + free-text (not objective question types); little direct transfer. The reusable bit is the **session → result → PDF export** flow shape (`pdf_generator.py` ReportLab) if Reading later wants a printable result. Not Phase 1.

---

## Section 3 — Question-type rendering complexity

11 IELTS Academic Reading types, classified by reuse against existing `listening-test-player.js` renderers + `ielts-test-paper.css`:

| # | Type | Input primitive | Existing renderer? | Complexity | Phase |
|---|---|---|---|---|---|
| 1 | Multiple choice (single) | radio | ✅ `renderMCQ` (mcq_3option) | Low | **1** |
| 2 | Multiple choice (multi) | checkbox group | ⚠ adapt MCQ → checkbox + multi-key scoring | Low-Med | 1/B |
| 3 | True / False / Not Given | 3-way radio | ⚠ extend listening `true_false` (2-way) → 3-way | Low | **1** |
| 4 | Yes / No / Not Given | 3-way radio | ⚠ same renderer as #3, different labels | Low | **1** |
| 5 | Matching information (para→statement) | dropdown-select | ⚠ adapt `plan_label` select pattern | Med | 1/B |
| 6 | Matching headings (para→heading) | dropdown-select | ⚠ adapt `plan_label` select pattern | Med | **1** (select variant) |
| 7 | Matching features (statement→feature) | dropdown-select | ⚠ adapt `plan_label` | Med | B |
| 8 | Matching sentence endings | dropdown-select | ⚠ adapt `plan_label` | Med | B |
| 9 | Sentence completion | text gap | ✅ `renderSentenceCompletion` | Low | **1** |
| 10 | Summary / note / table / flow-chart completion | text gaps | ✅ `renderSummary/Notes/Table/FormCompletion` | Low | **1** |
| 11 | Short-answer | text input | ✅ `renderShortAnswer` | Low | **1** |

**Code's Phase-1 subset recommendation (lowest-risk, all reuse):** **#1 MCQ-single, #3 T/F/NG, #4 Y/N/NG, #9 sentence completion, #10 summary/note/table completion, #11 short-answer**, plus **#6 matching headings as a dropdown-select variant** (the one mild stretch, but it reuses `plan_label`'s select machinery rather than drag-drop). This covers the commission's "MCQ + T/F/NG + matching headings + sentence completion" target *and* the high-frequency completion family, all via existing renderers.

**Defer to Phase B:** drag-and-drop matching (#5/#7/#8 as true drag UI), multi-answer MCQ (#2). The IELTS computer test uses drag-drop for matching, but a **dropdown-select is functionally equivalent and far cheaper** — recommend select for Phase 1, drag-drop as a Phase-B polish.

**Net-new frontend work is small:** a 3-way T/F/NG radio (trivial), and reusing `plan_label`'s `<select>` for matching headings. Everything else is a renderer that already exists.

---

## Section 4 — Test scoring infrastructure

**Reading scoring = clone of Listening (objective, deterministic, no AI).** This is the cleanest reuse in the whole cluster.

- **Algorithm:** `listening_test_grader.grade_attempt(user_answers, answer_key)` (`listening_test_grader.py:222`) — per-question case-insensitive, whitespace-collapsed string match for text answers; single-letter match for MCQ; T/F/NG normalization. Already handles **UK/US spelling variants** and **alternative answers** lists (L55–87). Reading needs exactly this.
- **Band conversion:** `_BAND_MAP` (L136) is the **Listening** table. **Reading uses a different /40→band table** (Academic Reading and General Training each have their own published Cambridge conversion). → swap the constant; keep the function. (Decision D6.)
- **Diagnostic precedent:** `trap_analytics` (L164) and `section_breakdown` (L195) already implement *"aggregate per-question outcomes into a rollup."* The Phase-1 **rule-based tag-aggregation diagnostic** is the same computation with `skill_tag` as the grouping key instead of `trap_mechanism`/section. **Reuse the rollup shape verbatim.**
- **Persistence:** `reading_test_attempts` mirrors `068` — `answers` JSONB array (incremental PATCH by `q_num`), immutable grade write on submit (`score`, `grading_details` JSONB, `band_estimate`, `skill_breakdown` JSONB for diagnostic).

**Schema candidates (mirror listening):**
- `reading_tests` (id, test_id TEXT unique, title, version, module ∈ {academic, general}, status) — clone of `065`.
- `reading_passages` (id, test_id FK, passage_num, title, body_markdown, image_url?, metadata JSONB) — replaces listening's audio `listening_content`.
- `reading_questions` (id, passage_id FK, q_num, question_type, payload JSONB `{prompt, options[], answer, alternatives[], skill_tag, sub_skill}`) — mirrors `listening_exercises.payload`.
- `reading_test_attempts` (id, test_id FK, user_id, status, answers JSONB, score, grading_details JSONB, band_estimate, skill_breakdown JSONB, started_at, submitted_at, RLS) — clone of `068`.

**Net-new backend estimate: low.** Most of Sprint 20.5 is rename + adapt of listening's grader + attempt endpoints, not greenfield.

---

## Section 5 — BC/IDP computer-delivered IELTS Reading UI research

Curated from official British Council / IDP / IELTS-Australia sources (no copyrighted assets embedded — URLs only):

**Reference URLs:**
1. [IELTS on computer — how it works (British Council)](https://takeielts.britishcouncil.org/take-ielts/prepare/free-ielts-english-practice-tests/ielts-on-computer/how-it-works)
2. [IELTS on computer — Academic Reading practice test (BC)](https://takeielts.britishcouncil.org/take-ielts/prepare/free-ielts-english-practice-tests/ielts-on-computer/practice-tests/reading-academic)
3. [IELTS on computer — Reading section overview (BC)](https://takeielts.britishcouncil.org/take-ielts/prepare/free-ielts-english-practice-tests/ielts-on-computer/about/reading)
4. [Computer-delivered IELTS tutorial — Reading (BC Bangladesh)](https://www.britishcouncil.org.bd/en/exam/ielts/prepare/how-cdilets-works/reading)
5. [IELTS on computer familiarisation test (BC)](https://takeielts.britishcouncil.org/take-ielts/prepare/free-ielts-english-practice-tests/ielts-on-computer/familiarisation-test)
6. [Computer-delivered Reading practice (IELTS Australia / IDP)](https://admin.ielts.com.au/computer-delivered-ielts/computer-reading-practice-test/)
7. [Computer-delivered Reading practice (IDP Middle East)](https://idpielts.me/computer-delivered-ielts-reading-practice-test/)
8. [Try computer-delivered Reading (IELTS Greece)](https://www.ieltsgreece.eu/try-computer-delivered-reading/)
9. [OneIELTS free CB mock (3rd-party reference for interaction patterns)](https://oneielts.com/)

**Documented official features (verified across sources):**
- **Split layout:** passage **left**, questions **right**; *each panel scrolls independently* ("use both scroll bars"). Proportions ~50/50–55/45.
- **Timer:** top of screen, persistent countdown. (Real exam shows a colour-change warning near the end — our exam chrome will use `--av-warning` flash at 10 + 5 min, per commission decision 4.)
- **Settings (top-right):** adjust **text size** and **colour/contrast**. (Maps cleanly onto our existing `[data-theme]` + token type-scale — partially free.)
- **Navigation bar (bottom):** numbered questions, **skip & return later**, jump-to-Q, **review** before submit.
- **Highlight tool:** select text → right-click context menu → "highlight". (Phase-B per commission decision 4 — *skip* Phase 1.)
- **Notes tool:** select text → popup → "take notes". (Phase-B — *skip* Phase 1.)
- **Copy/paste:** allowed — candidates copy passage words into completion answers. (Native browser copy is already available; nothing to build — just don't block it.)

**Aesthetic philosophy (for the exam chrome):** utilitarian, distraction-free, concentration-focused. Neutral surfaces, ONE accent for interactive/timer state, zero decorative motion. This is the **opposite** of the warm/encouraging study chrome — and crucially, it is *also* the opposite of "AI slop": restraint and precision (per `frontend-design` skill's minimalism guidance) is the differentiator.

**Aesthetic gap analysis vs 19.x brand:** the 19.x palette is *warm* (teal + amber + warm off-white). Exam-grade wants *cooler/neutral* (low-chroma grays). **Compatible:** typography (Plus Jakarta Sans body + JetBrains Mono timer), spacing scale, radii, focus-ring/a11y primitives, dark-mode plumbing. **Needs exam-specific override:** surface palette (neutral gray vs warm off-white), accent restraint (drop amber entirely; teal only for the single interactive accent), motion (functional-only). See §6 matrix.

---

## Section 6 — Cluster 19.x design baseline integration analysis

Source: `docs/clusters/19_x/design_baseline.md` (tokens defined in `frontend/css/aver-design/tokens.css`).

**Token transferability matrix** (Student / Aver-admin reuse 19.x as-is; Exam is the analysis target):

| Token group | 19.x value | → Exam chrome | Transferable? |
|---|---|---|---|
| **Type family** | Plus Jakarta Sans + JetBrains Mono | same body; **mono already designated for "timer/band" numerics** (baseline §2 L27) | ✅ Direct — exam-ready by design |
| **Type scale** `--av-fs-*` | xs–3xl | reuse; passage body `--av-fs-base/lg` at `--av-lh-relaxed` (long-reading line-height already exists, §2 L30) | ✅ Direct |
| **Spacing** `--av-space-*` | 4px scale (skipped steps fail CI) | reuse; exam panels denser → favour `space-3/4` | ✅ Direct (mind the CI skip-step test) |
| **Radii** `--av-radius-*` | sm–pill | reuse; exam favours `sm/md` (flatter) | ✅ Direct |
| **Color — text ladder** | primary/secondary/muted/faint | reuse (passage = primary at relaxed LH) | ✅ Direct |
| **Color — surfaces** | `--av-surface-page` = warm off-white `#FAFAF9` | exam wants **neutral gray** (cooler, lower warmth) | ⚠ **Override** — needs exam surface tokens |
| **Color — brand accent** | teal `--av-primary` | keep teal as the *single* interactive accent | ✅ Direct (but ration to interactive-only) |
| **Color — amber accent** | `--av-accent`/`--av-warning` (warmth + urgency) | **drop "warmth" use**; keep ONLY `--av-warning`/`--av-error` for timer warning | ⚠ **Partial** — semantic-only |
| **Semantic quartet** | success/warning/error/info | reuse (correct/incorrect/timer) | ✅ Direct |
| **Motion** | 3 durations + bounce easing | exam = **functional only** (timer flash, flag toggle, nav highlight); drop hover-lifts/bounce | ⚠ **Restrict**, don't redefine |
| **A11y primitives** | focus ring `2px --av-primary`, contrast AA, reduced-motion guard, `text-faint` CI cap | reuse all (exam is *more* a11y-critical) | ✅ Direct + mandatory |

**Conflict points:** only **two** real ones — (a) warm vs neutral page surface, (b) amber "encouragement" warmth has no place in an exam. Both resolve by adding a thin **exam surface/accent override layer**, not by forking tokens.

**Proposed cluster 20.x baseline doc structure (TOC for Sprint 20.1 shipment):**
1. Aesthetic direction — 3 chromes, one design language (study-warm / admin-dense / exam-neutral).
2. Shared primitives (typography, spacing, radii, a11y) — *reference 19.x, do not redefine*.
3. Student-chrome (L1/L2 browse) — *reuse 19.x baseline verbatim*.
4. Exam-chrome overrides — neutral surface tokens, accent rationing, functional-motion rules, split-view spec.
5. Component patterns net-new for reading (question paper, nav palette w/ flag, timer, passage panel, glossary popover).
6. Open decisions resolved (the §8 items Andy settles).

---

## Section 7 — 3-chrome architectural proposal

**Mechanism (empirical):** chromes are **Shadow-DOM custom elements with per-page explicit opt-in** — no runtime/URL detection, no body-class switching. A page picks its chrome by (1) importing the component module, (2) placing the element, (3) running the anti-flash theme IIFE. Both existing chromes style themselves with `--av-*` tokens bridged into the shadow root via `:host-context([data-theme])`.

- Student: `js/components/aver-chrome.js` → `<aver-chrome active="…">` (top nav). Used by all student pages incl. `listening-test.html`.
- Admin: `js/components/aver-admin-chrome.js` → `<aver-admin-chrome active="…">` (header + sidebar grid, slot-wrapped content). `admin-components.css` supplies `box-sizing:border-box` for admin tables.

**Recommended exam chrome (NEW):**

| Chrome | Surface | Density | Motion | Distinctive |
|---|---|---|---|---|
| Student | warm off-white / deep navy | generous | subtle hover/transition | library cards, progress, encouraging copy |
| Aver-admin | info-dense | compact tables | minimal (status) | bulk actions, filters, full 6-state metadata |
| **Exam (new)** | **neutral gray, low chroma** | **compact, exam-utility** | **functional only** (timer flash, flag toggle, nav highlight) | **split 55/45 passage↔question, prominent timer, persistent bottom nav palette + per-Q flag, review screen** |

**Implementation approach (Code authoritative — simplest reliable):**
- New file `frontend/js/components/aver-exam-chrome.js`, mirror the existing two: Shadow DOM, inline `<style>` referencing `--av-*` tokens, anti-flash IIFE on the host page. **Zero coupling** — student/admin pages are untouched, and exiting the exam (navigating back to a student page) is a normal page nav that simply loads the student chrome.
- Exam-specific surface/accent overrides go in a new `frontend/css/aver-design/exam-components.css` (mirrors the `admin-components.css` precedent) — linked **only** by exam pages. Keeps neutral-gray surfaces and split-view layout out of the student/admin bundles.
- The question-paper interior reuses `css/ielts-test-paper.css` (already token-based). The genuinely **net-new CSS = the split-view shell** (two independently-scrolling panels) + the **flag indicator** on the nav palette (palette grid itself exists at `ielts-test-paper.css:476`).
- Files touched when the exam chrome ships (Sprint 20.4 mockup → 20.5/20.6 impl): `+ aver-exam-chrome.js`, `+ exam-components.css`, reuse `ielts-test-paper.css`, unlock `aver-chrome.js:321` Reading tab.

---

## Section 8 — Architectural decisions to settle BEFORE Sprint 20.1+

*(Code surfaces options + a lean; Mình + Andy decide — non-authoritative.)*

**D1 — Reading content data model.** Two stores, by content nature:
- *Option A (recommended):* **Clone the Listening schema** for L2/L3 (`reading_tests`/`reading_passages`/`reading_questions`/`reading_test_attempts`, structured Q+answer-key JSON). Use the **19.1C markdown importer idiom** only for **L1 prose passages + glossary**. — *Lean: A.* Structured questions need keyed JSON + auto-scoring; the writing-tips markdown row can't carry that cleanly.
- *Option B:* Force everything through the writing `content_type`/`type_data` table. — Not recommended; `writing_tips` table name + writing-only `task_type` are wrong for reading (the retro already flags a `writing_tips→writing_content` rename as deferred debt — don't entangle reading into it).

**D2 — Skill-tag taxonomy (drives the diagnostic engine).** Free-form text vs standardized enum.
- *Lean: standardized enum.* Rule-based tag aggregation **requires** a closed vocabulary or accuracy-by-tag rollup is meaningless. Proposed IELTS-aligned set: `skimming`, `scanning`, `detail`, `main_idea`, `inference`, `vocabulary_in_context`, `reference_cohesion`, `writer_view_TFNG`. Andy picks/edits the final list at content-production time; store as `skill_tag` (+ optional `sub_skill`) on each `reading_questions` row.

**D3 — Test timer mechanism (anti-cheat vs UX).** Client-only vs server-validated.
- *Lean: client countdown UX + server-side guard.* Listening already records `started_at`/`submitted_at`. Add: server stamps `started_at` at attempt creation; at submit, server validates `elapsed ≤ limit + grace`; a client timer drives UX and auto-submits at zero. Avoids hard real-time server enforcement (clock-drift/latency) while preventing gross overruns. Copy-from-passage stays allowed (it's allowed in the real exam).

**D4 — Passage richness.** Markdown (GFM) vs rich HTML.
- *Lean: markdown sufficient Phase 1.* GFM covers headings/bold/italic/lists/tables/blockquote/links/images. Subscript/superscript + raw HTML are stripped by DOMPurify, but Academic Reading rarely needs them. Revisit only if Andy's content includes chemistry/math notation.

**D5 — Passage images.** Reuse Cloudinary jpg/png/webp/gif 5 MB + `image-lightbox.js`.
- *Lean: reuse as-is.* Complex vector charts (SVG) / multi-page PDFs → defer Phase B (same call as 19.3.5 D5). Confirm Andy's content tool exports raster.

**D6 — Band conversion table.** Reading ≠ Listening table; Academic ≠ General Training.
- *Lean: ship Academic Reading band map Phase 1*, display "raw /40 + estimated band range" with the "ước tính tham khảo" disclaimer (commission decision 7). Decide General Training scope separately (likely Phase B). Tables are public Cambridge data — no dependency.

**D7 — Matching-headings input.** Drag-drop (exam-authentic) vs dropdown-select (cheap).
- *Lean: dropdown-select Phase 1* (reuse `plan_label`), drag-drop as Phase-B polish. Functionally equivalent for scoring; far lower risk.

**D8 — L1 comprehension question storage.** Do L1 "light comprehension Qs" reuse the `reading_questions` model or a lighter inline structure?
- *Lean: reuse `reading_questions`* (same renderers/scoring), just fewer per passage and ungraded/practice-mode. Avoids a second question model.

---

## Section 9 — Recommended sprint sequencing (non-authoritative)

Largely confirms Andy's plan; the empirical refinement is **"clone Listening, don't build fresh"** for the test backend, and **two content tracks** (markdown for L1 prose, structured JSON for L2/L3).

| Sprint | Scope | Empirical note |
|---|---|---|
| **20.0** | Discovery (this doc) | — |
| **20.1** | Content infra + **cluster 20.x design baseline doc** | Two import tracks: extend `content_import_service` for L1 passages/glossary (markdown); define `reading_questions` JSON shape for L2/L3. Migration 086+. Ship baseline doc (lesson 19.1A). |
| **20.2** | **L1 Vocab Reading** (student) | Reuse markdown render + glossary popover + light `reading_questions`. Student chrome. |
| **20.3** | **L2 Skill Practice** (student + admin authoring) | Reuse listening renderers + admin-import idiom; introduce `skill_tag` taxonomy (D2). |
| **20.4** | **Exam-chrome HTML/CSS mockup** (Andy approval gate) | Focal net-new = split-view shell + flag palette + timer. Reuse `ielts-test-paper.css`. **Gate before 20.5/20.6.** |
| **20.5** | **L3 backend** (tests, attempts, auto-scoring) | Clone `listening_test_grader` + `068` attempt schema + 3-endpoint lifecycle. Swap Reading band map (D6). Low LOC. |
| **20.6** | **L3 exam UI** (split-view, timer, nav palette, flag) | Implement approved 20.4 mockup; unlock `aver-chrome.js:321` Reading tab. |
| **20.7** | **Diagnostic engine** (rule-based tag aggregation) | Clone `trap_analytics`/`section_breakdown` rollup shape, key by `skill_tag`. Strengths/weaknesses + recommended exercises. |
| **20.8+** | Admin tooling polish, Phase-B types (drag-drop, highlight/notes), GT module | Per Andy content priorities. |

---

## Section 10 — Pre-emptive guidance for Sprint 20.1 commission

**Reuse mandates (cite these file:line in the 20.1 commission):**
- Content service: `services/content_import_service.py` (extend `CONTENT_TYPES` + `type_data` validation for L1 passages; do **not** invent a parallel parser).
- Test backend (20.5): clone `services/listening_test_grader.py` + `migrations/068_listening_test_attempts.sql` + `routers/listening.py:4887–5056` lifecycle.
- Renderers (20.6): reuse `js/listening-test-player.js:341–599`; styles `css/ielts-test-paper.css`.
- Chrome (20.4/20.6): mirror `js/components/aver-chrome.js` / `aver-admin-chrome.js`; add `exam-components.css` (mirror `admin-components.css`).
- Images: `services/cloudinary_service.py` + `js/image-lightbox.js`; markdown `js/markdown.js`.

**LOC accounting per artifact (rough, for 20.1+ caps):** L1 import extension small (≈ +80 service + tests); reading test schema migration ≈ 1 file; grader clone ≈ adapt not author; exam chrome JS ≈ mirror existing (~400–600) + `exam-components.css` (~200, mostly split-view); the diagnostic ≈ a rollup function (~100).

**Pattern #42 watch-items for 20.1:**
- Don't route reading into `writing_tips`/`task_type` (writing-only vocab; rename is deferred debt). Reading gets its own tables (D1).
- The `--av-space-*` scale has **skipped steps that fail a CI test** — exam CSS must compose existing steps, not invent `space-5/7/9`.
- `text-faint` is CI-capped (≤ a threshold) — exam neutral-gray passages must use `text-secondary/muted`, not faint.
- Answer keys must be stripped before student fetch (`strip_answer_keys` precedent) — easy to forget in a fresh router.

**External dependencies surfaced (lesson 19.4) — NONE new required for Phase 1:**
- ✅ Auto-scoring is rule-based → **no AI provider** needed (unlike Writing's Gemini). Optional AI prose summary is explicitly Phase B (commission decision 5).
- ✅ Cloudinary + Gemini already integrated; no new credentials.
- ✅ Band tables = public Cambridge data; no dependency.
- ✅ No transactional-email need for reading Phase 1 (the 19.4 email-deferral does **not** block reading).
- ⚠ **Andy-side (content production, not a project dep):** Andy's AI agent must emit content in the agreed format — Sprint 20.1 should publish a **reading content spec** (extend `content_format_v1.md` → reading section, or a sibling `reading_content_format_v1.md`) defining passage frontmatter + the `reading_questions` JSON shape (q_num, type, options, answer, alternatives, `skill_tag`).
- ⚠ Confirm Andy's content tool exports **raster images** (jpg/png/webp), not SVG/PDF, to match Cloudinary (D5).

---

## Appendix — Process note: skill-directive noise (cluster 20.x tracking start)

Cluster 19.x established the `frontend-design` hook is **edit-triggered, not read-triggered** → Discovery sprints (docs + reads only) fire ~0–3 times. Sprint 20.0 observed a **NEW false-positive class**: the **Vercel plugin `UserPromptSubmit` hook** injected `workflow` + `verification` skill mandates (keyword-matched on "state machine", "pipeline", "verify flow"). These are irrelevant — this is a FastAPI + vanilla-JS app on **GitHub Pages, not Vercel**, and 20.0 is docs-only. **Disregarded** per cluster 19.x established handling. Cluster 20.x baseline: 1 new false-positive *class* (Vercel keyword injection), 0 `frontend-design` edit-trigger firings (no frontend files touched).

**— END Sprint 20.0 Discovery —**
