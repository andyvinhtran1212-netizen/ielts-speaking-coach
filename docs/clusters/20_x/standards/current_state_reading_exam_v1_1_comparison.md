# Current State — Reading Exam Display Fidelity vs Interactive HTML Standards v1.1

**Sprint:** 20.14 — Discovery (D0) before §2A / §3A refactor
**Audience:** Andy + Mind, deciding the refactor scope (single vs split sprint, Phase B inclusion).
**Authority:** Code, after reading the v1.1 standards, the live exam JS/CSS/HTML, the v2 content spec, and the AVR-READ-001 production seed.
**Standards target:** `docs/clusters/20_x/standards/Interactive_HTML_Standards.md` v1.1 (2026-05-29), specifically the new §2A (14 question types) and §3A (palette / passage switch / time signalling / live feedback).
**Reference (gold):** `docs/clusters/20_x/standards/IELTS_Reading_Test_01_Interactive.html`.

## Sources read

- v1.1 standards — `Interactive_HTML_Standards.md` (391 LOC, includes new §2A + §3A)
- Frontend exam — `frontend/js/reading-exam.js` (1506 LOC), `frontend/css/reading-exam.css` (702 LOC), `frontend/css/reading-exam-mockup.css` (the 20.4c base + topbar / palette / question-block styles), `frontend/pages/reading-exam.html` (293 LOC)
- Backend authoring spec — `docs/clusters/20_x/reading_content_format_v2.md`
- Backend importer / type whitelist — `backend/services/content_import_service.py::READING_QUESTION_TYPES_PHASE1`
- Production seed — `backend/content/reading/l3-academic-reading-test-1.md` (`AVR-READ-001`)
- Recent ship history — PR #338 (20.13a fidelity), #340 (20.13b a11y), #342 (20.13c behaviour)

## Architecture orientation

The live exam UI is **backend-driven** (FastAPI + Supabase + v2 content spec), not the single-file embedded-JSON architecture the standards doc was originally written for. v1.1 §2A + §3A talk about the visible markup + behaviour — those translate cleanly to our backend-driven renderer. **Backend question-type coverage** is the constraint that decides whether a given §2A type is reachable this sprint or needs a Phase B backend extension (the v2 spec + grader + importer to gain the new type).

The live render path is **inline** in `reading-exam.js` — there is no separate `reading-questions.js`. Three functions matter:

| Function | LOC | Job |
|---|---|---|
| `renderPassages(passages)` | 338 | Stacks 3 passages, markdown body, `.exam-passage__part` wrapper |
| `renderQuestions(questions)` | 438 | Group by `passage_order` → per-Part heading + sub-group by `question_type` → per-type instruction block |
| `renderQuestion(q)` + `renderInputs(body, q)` | 494 / 524 | Per-question card — number badge + prompt + input(s) + flag button |

`renderInputs()` is the type-dispatch site (`if mcq_single → radios; else if TFNG/YNG → select; else if matching_headings → select; else → generic text input`). **Everything that isn't one of those three branches falls through to a generic text input** — including the per-type rendering the standards mandate.

---

## §2A — Per-question-type display: current state + gap

The §2A table below lists each of the 14 types, what `AVR-READ-001` carries, what the backend importer supports today (Phase 1 whitelist), and what the renderer actually produces vs the v1.1 mandate.

| § | Type | Backend Phase 1? | In `AVR-READ-001`? | Current frontend render | v1.1 §2A gap |
|---|---|:---:|:---:|---|---|
| 2A.1 | `mcq_single` | ✅ | ✅ 7 Qs | Radio per option, `<label>` wraps input + text. Option text is `"A. <text>"` (label prefix inline) | **Layout drift**: standards want each option on its own line with `A/B/C/D` **bold prefix**, hanging indent, NO border around the question, hover blue. The current `.exam-q` card has `border: 1px solid` (§2A says no border for regular Qs) |
| 2A.2 | `mcq_multi` | ❌ Phase B | ❌ | Falls through to generic text input | **Type not served by backend.** Phase B: add to importer + grader (mcq_multi already mentioned as Phase B in v2 spec §4.2). Frontend renderer also missing checkbox + "Choose TWO" instruction lock |
| 2A.3 | `true_false_not_given` | ✅ | ✅ 4 Qs | `<select>` dropdown — `"— Select —"` placeholder + 3 options. Shipped in 20.13a (was 3 radios pre-20.13a) | **Layout: largely compliant.** Instruction is rendered via `QTYPE_INSTRUCTIONS` template but the 3-line "TRUE if… / FALSE if… / NOT GIVEN if…" block (with `white-space: pre-wrap`) is not what's emitted — current instruction is a one-line "Decide if…" rubric |
| 2A.4 | `yes_no_not_given` | ✅ | ✅ 5 Qs | Same as TFNG | Same gap as 2A.3 |
| 2A.5 | `matching_headings` | ✅ | ✅ 11 Qs | `<select>` per Q with options `"i. Heading text"` / `"ii. Heading text"` …; the heading list is INVISIBLE outside the dropdown | **🔴 CRITICAL** — standards mandate a **`.headings-box` bordered, sticky, ABOVE the questions**, Roman numerals **bold**, each heading on its own line. The current UI hides the headings inside each dropdown — students cannot scan the bank, which is the entire point of the matching format. **This is the single most visible AV3 dissatisfaction Andy flagged from the production screenshot.** |
| 2A.6 | `matching_information` | ❌ Phase B | ❌ | Falls through to text input | Backend type missing. Phase B |
| 2A.7 | `matching_features` | ❌ Phase B | ❌ | Falls through | Backend type missing + `.features-box` renderer missing |
| 2A.8 | `matching_sentence_endings` | ❌ Phase B | ❌ | Falls through | Backend type missing + `.endings-box` renderer missing |
| 2A.9 | `sentence_completion` | ✅ | ✅ 4 Qs | Generic text input AFTER the prompt as a separate element (`<input class="exam-q__gap">` appended to the question body) | **Standards: input must sit INLINE at the `____` position inside the stem**, 120–220px wide. Current renderer doesn't parse the stem for `____` gaps — it always appends the input after. Visual fidelity gap, not behavioural |
| 2A.10 | `summary_completion` (no word box) | ✅ | ✅ 5 Qs | Same as 2A.9 — generic appended text input. No summary container | Standards: the whole summary lives in a **`.gap-box` (light bg)** with a navy-accent **bold number** + inline input AT each gap. The renderer needs the summary text + the regex that turns `"… and 14 ____ are …"` → `"… and <span class=gnum>14</span> <input data-q=14> are …"` |
| 2A.11 | `summary_completion` (with word bank A–J) | ⚠ same DB type as 2A.10, no shape distinction | ❌ | Same fall-through | Backend has no way today to distinguish a word-bank summary from a no-bank summary. Either author convention (presence of `options:`) or a sibling `question_type` (`summary_completion_word_bank`) is needed. Plus the word-bank box render. Phase B / spec extension |
| 2A.12 | `notes_completion` / `table_completion` (+ `flow_chart_completion` Phase B) | ✅ notes, ✅ table; ❌ flow_chart | ❌ | Same fall-through generic input | Standards: **`.gap-box.mono-block`** (monospace, `white-space: pre-wrap`) preserving columns / arrows / indent, with inline inputs in cells. The content-shape question is: does the v2 spec carry the table/notes layout as preformatted text, or as structured rows that the renderer turns into a `<table>`? Need to read seeds to confirm — the AVR-READ-001 seed has none of these, so the question is moot until a seed exercises them |
| 2A.13 | `diagram_label_completion` | ❌ Phase B | ❌ | Falls through | Backend type missing + ASCII-art rendering scaffold missing |
| 2A.14 | `short_answer` | ✅ | ✅ 4 Qs | Generic text input — but here the standards model is exactly "Wh- question + text input at end", so the current fall-through behaviour is essentially right | Minor — verify hanging indent + spacing match §2A.15 |

**§2A.15 common conventions audit:**

| Convention | Current state | Gap |
|---|---|---|
| `Questions X–Y` bold standalone line per group | ✅ — `_qRangeLabel(run)` + `QTYPE_INSTRUCTIONS` template emit this | OK |
| Instruction italic/bold, word-limit **inside** the instruction (not a separate banner) | ⚠ — instructions render in `.exam-questions__instructions--type` which is a **bordered sunken box with a 3-px left accent**; standards want inline italic + thin separator only | Restyle (CSS only) |
| Each item: bold navy-circle number badge, top-aligned, hanging indent | ⚠ — `.exam-q__num` is a 26×26 circle but **outlined** (border + transparent fill), not filled navy. Layout is grid-aligned (28px badge column), not hanging-indent | Restyle badge + question layout |
| Spacing: ≥8px items, ≥22px q-groups, thin separator under instruction | ⚠ — `.exam-q { margin-bottom: 10px }` is fine for items; q-group spacing is fine; separator is the heavy box, not a thin rule | Restyle |
| Shared-list components boxed (headings/features/endings/word-bank) | ❌ — none rendered today | **Build the box renderers** (Tier 1 work for served types: just `.headings-box`) |
| Regular questions NO border | ❌ — `.exam-q { border: 1px solid var(--exam-border-subtle) }` | Remove border in production layer (don't touch mockup CSS — it's a separate cluster) |
| All dynamic text through `esc()` | ⚠ — renderer uses `textContent` (XSS-safe by construction) but the mock-up's markdown body uses `innerHTML` via `window.renderMarkdown`. Standards' `esc()` mandate is satisfied for question content; passage body is sanitised by the markdown renderer | OK with caveat |

---

## §3A — Palette + passage switching + time signalling + live feedback

### §3A.1 Palette (1–40 at the bottom)

| Sub-requirement | Standards v1.1 | Current state | Gap |
|---|---|---|---|
| Position | Bottom nav bar, **navy background**, runs full width, horizontal scroll on overflow | `.exam-palette` background is `--exam-surface-card` (#FFFFFF). Group containers each have padding + border + radius — 3 framed "white pills" instead of one navy bar | **AV2 dissatisfaction**: full re-skin to navy bar; drop the per-group framed pill in favour of `.nav-sep` vertical dividers |
| Tile shape & size | **Square**, ~30px (≥34px mobile), thin border, rounded 3px | 36×32px, mono font, bordered. Roughly right size; aspect not square | Square it + shave 6px (Andy's "ugly + chiếm chỗ quá lớn") |
| Part grouping | "PART N" small-caps label + `.nav-sep` vertical rule between parts | `.exam-palette__group-label` exists; "Part 1/2/3" labels rendered. Visual separator is the **framed pill border**, not a thin vertical rule | Re-treat as `.nav-sep` |
| 4 states (must all visually distinguish) | Unanswered = navy-grey square (`#3b4060` bg, light-grey text). Answered = WHITE bg, NAVY text (inverted). Review = circle + amber border `#ffb74d`. Current = yellow ring `box-shadow 0 0 0 2px #ffd54f` | Unanswered = white outline (light bg). Answered = dark-grey fill + white text. Current = teal fill + accent ring. Flagged = circle + amber border (20.13a A1 shipped this correctly) | Recolour the unanswered + answered states to the inverted navy/white scheme; current's yellow ring instead of teal fill |
| Combination | Answered + review = circle + white. Current overlays yellow ring on whatever else | Same combination logic works, just the colour set is wrong | Recolour only |
| Legend strip | `aria-hidden` legend under the palette explaining square / circle / inverted | `<div class="exam-palette__legend">` exists in HTML, marked `aria-hidden="true"` ✓ | OK — verify the legend swatches still match the new colours |
| Click → jump | Smooth scroll + Part-strip update + flash 0.5s | Click jump exists; **flash 0.5s missing** | Add `.is-flash` animation (§3A.4 jump-flash) |

### §3A.2 Passage switching (Part 1 / 2 / 3)

| Sub-requirement | Current state | Gap |
|---|---|---|
| No confirm dialog | ✅ — no confirm on Part navigation | OK |
| Pane-left swaps to that Part's passage; pane-right swaps to that Part's questions | ⚠ — current render stacks **all 3 passages and all 40 questions** into the panes, and Part navigation just scrolls. This is the listening-style "single continuous list" choice, NOT the §3A.2 "swap pane content" choice | **Decision needed**: stay with continuous-scroll model, or refactor to one-Part-at-a-time. Mind's product call. Standards prefer one-Part-at-a-time, but the continuous model has prior approval (cluster 20.4c Q7 + 20.6). Recommend **stay continuous + scroll-to-Part-top**, document the deliberate divergence, since switching the model is bigger than 20.14 |
| Part Strip "Part N · questions a–b" updates on switch | ✅ — `.exam-questions__part-heading` already shows "Part N — Questions X–Y" per Part | OK (continuous variant) |
| Scroll-to-top on switch | ⚠ — currently the palette click jumps to the Q, not to the top of the Part | Tweak the palette-click handler to scroll to the Part heading when crossing a Part boundary |
| Highlight restored per Part | N/A under continuous scroll (highlights are always visible) | OK |

### §3A.3 Time signalling

| Sub-requirement | Current state | Gap |
|---|---|---|
| Countdown MM:SS, white bg / black text, centred above | ✅ — `.exam-timer` centred top-middle | OK |
| 10-min mark: **yellow background** + red toast for ~4s + SR announce | ⚠ — `.exam-timer[data-state="warning"]` adds yellow border + colour, NOT a yellow background. `liveSay('Warning: 10 minutes remaining.')` shipped (20.13b/c). **No toast DOM created** — but `.exam-time-toast` CSS exists | Add the missing toast DOM creation (CSS shipped without JS wiring); restyle warning state to a yellow **background** |
| 5-min mark: red background + flash + toast + SR (respect `prefers-reduced-motion`) | ⚠ — `.exam-timer[data-state="critical"]` has red bg + `exam-timer-pulse` keyframe animation (disabled under reduced-motion). `liveSay` shipped. **No toast DOM** | Add toast DOM; verify reduced-motion path |
| 0:00 → auto-submit, no prompt, results screen, SR announce | ✅ — `autoSubmit()` fires at remaining ≤ 0, locks chrome, `liveSay('Time is up. …')` shipped in 20.13b/c | OK |
| No modal at 10/5-min marks | ✅ — toast-only, no blocking modal | OK |

### §3A.4 Live feedback

| Sub-requirement | Current state | Gap |
|---|---|---|
| Input → `answered` class instant on the Q card (left blue border + light bg) + palette tile flips to "answered" + `aria-label` update | ⚠ — `onAnswerChanged()` updates the palette tile + `aria-label` (20.13b B4). The `answered` class on the Q card itself is **not** applied — no left-blue-border state on the question card | Add `.is-answered` to the `.exam-q` on input + style it |
| Clearing the text input removes `answered` | ⚠ — same as above; not implemented | Bind input clear → drop `is-answered` |
| Review tick: palette square→circle instant; untick → square | ✅ — 20.13a A1 + 20.13b shipped | OK |
| Hover: MCQ option row + palette/arrow get hover affordance | ⚠ — option row hover exists in mockup CSS; palette hover exists; option hover colour is current teal accent, standards want a light **blue** | Recolour the hover (one CSS swap) |
| Jump to Q: smooth scroll + flash ~0.5s background highlight (reduced-motion: no flash) | ⚠ — smooth scroll exists; flash is missing | Add `.is-flash` keyframe + apply on click + drop on animation end |
| Right-click → highlight/notes/clear menu + colour swatches | ✅ — shipped in 20.13a (multi-colour); keyboard parity Alt+H/N/C shipped in 20.13b B5 | OK |
| Autosave silent (no spinner / no toast) | ✅ — `patchAnswer()` is fire-and-forget, no visible UI | OK |
| Settings instant (text-size / theme) | ✅ — `data-text-size` / `data-exam-theme` attributes flip on the chrome immediately | OK |
| No "saved" indicator | ✅ | OK |

---

## Andy's explicit visual dissatisfaction (AV1–AV4) — concrete status

| # | Andy point | Current state | Where the fix lives |
|---|---|---|---|
| **AV1** | Passage text not justified + doesn't reflow on window resize | `.exam-passage__body { line-height: 1.7; max-width: 70ch }` — left-aligned, ragged-right; the `70ch` max-width caps reflow above ~580px (the pane gets wider, the text column stays 70ch). The pane itself uses `var(--exam-split-left, 50%)` so it DOES reflow when the window narrows, but the **text inside** plateaus at 70ch | (a) add `text-align: justify` on `.exam-passage__body`; (b) raise or drop `max-width: 70ch` so the column fills the pane width — Mind's call (justified text at the full pane width vs justified within 70ch reading optimum). Recommend **drop max-width** and let the column fill the pane, matching the screenshot's wide pane Andy expects to reflow |
| **AV2** | Palette 1–40 ugly + takes too much space | Three framed white pills with 36×32 tiles + 28px gap between groups. Vertical footprint is ~12px padding + tile height + label height + 12px padding ≈ 70px per row | Re-skin to a single navy bar (§3A.1 colours), shrink tiles to 30×30, drop the framed pills, replace with `.nav-sep` vertical rule between Parts. Drops vertical footprint by half |
| **AV3** | Question rendering doesn't match per-type format | See §2A audit above — biggest single issue is the missing matching_headings box (2A.5) | Tier 1 of the refactor — see Refactor Scope below |
| **AV4** | Overall window not visually attractive | White header + white chrome + heavy-bordered question cards + framed palette pills = "office form" feel, not premium CD-IELTS | Navy header (§3), navy palette bar, drop question-card borders, lighten instruction blocks. Plus a focused typography / spacing pass once the structural fixes land |

---

## Backend question-type coverage (Phase 1 vs §2A 14 types)

`READING_QUESTION_TYPES_PHASE1` in `backend/services/content_import_service.py` (line 59):

```python
READING_QUESTION_TYPES_PHASE1 = (
    "mcq_single", "true_false_not_given", "yes_no_not_given",
    "sentence_completion", "summary_completion", "notes_completion",
    "table_completion", "form_completion", "short_answer", "matching_headings",
)
```

Maps to §2A: **10 of 14 types** are author-able today. The **4 missing** are `mcq_multi` (2A.2), `matching_information` (2A.6), `matching_features` (2A.7), `matching_sentence_endings` (2A.8), `diagram_label_completion` (2A.13). `summary_completion` with-word-bank (2A.11) is the same DB type as without-word-bank (2A.10) — distinction would need a shape extension OR an authoring convention (presence of `options:` → render as word-bank). `flow_chart_completion` (part of 2A.12) is Phase B.

The DB `CHECK` constraint (migration `086`) accepts the full IELTS set — the gate is purely the importer's Phase 1 whitelist + the v2 spec authoring contract + the grader's logic. **Adding a Phase B type therefore touches: validator whitelist, v2 spec docs, grader (if non-trivial matching like mcq_multi candidate-set), frontend renderer. No DB migration needed.**

**Production seed `AVR-READ-001` exercises 7 types** (40 Qs total): matching_headings 11 · mcq_single 7 · yes_no_not_given 5 · summary_completion 5 · true_false_not_given 4 · short_answer 4 · sentence_completion 4. Every type in this seed IS in the Phase 1 whitelist. **Visual verification of any §2A refactor can only cover these 7 types until a richer seed lands** — see Phase B note below.

---

## Refactor scope recommendation (Code latitude)

**Code recommendation: split into two PRs.**

### Sprint 20.14a — Tier 1 (§2A served types) + Tier 2 (§3A) + AV1–AV4

One PR, frontend-only, no backend touch. Scope:

1. **§2A renderer rebuild** for the 7 served types in `AVR-READ-001` — focus the work where the seed exercises it:
   - `matching_headings` — **add `.headings-box`** above questions (this single fix is the highest-leverage AV3 win); dropdown options drop the heading text (just "i", "ii", …) since the bank is now visible
   - `mcq_single` — drop card border, hanging-indent options, bold A/B/C/D prefix
   - `true_false_not_given` + `yes_no_not_given` — emit the 3-line `pre-wrap` instruction block above the question run
   - `sentence_completion` + `summary_completion` (no-word-box variant) + `notes_completion` + `table_completion` — parse `____` in the stem / summary text → inline `<input>` at gap position; add `.gap-box` wrapper for summary; add `.gap-box.mono-block` for table when a seed exercises it
   - `short_answer` — verify spacing + hanging indent under §2A.15
2. **§2A.15 conventions** — restyle `.exam-questions__instructions--type` to thin/italic (drop the sunken box + left-border accent); restyle `.exam-q__num` to filled navy circle; remove the card border on `.exam-q`
3. **§3A.1 palette re-skin** — navy bar, square 30px, `.nav-sep` separators, 4-state recolour
4. **§3A.3 toast wiring** — create the missing toast DOM at 10/5-min marks (CSS already shipped)
5. **§3A.4 jump-flash + answered class on Q card** — add `.is-flash` keyframe (0.5s) + `.is-answered` left-border on `.exam-q`
6. **AV1 passage justify + width** — `text-align: justify` + drop the 70ch cap (let it fill the pane)
7. **AV4 polish** — navy header `.exam-topbar`, restyle topbar's text colours to light-on-navy

Estimated LOC: ~600–1200 (production code + tests). Within the commission's 950–2300 cap.

### Sprint 20.14b — Phase B backend types (deferred, separate sprint)

`mcq_multi`, `matching_information`, `matching_features`, `matching_sentence_endings`, `diagram_label_completion`, `flow_chart_completion`, and the `summary_completion` word-bank variant. Each needs validator + grader + v2 spec + frontend renderer + a seed that exercises it.

**Recommend Andy commission 20.14b AFTER a richer seed exists** — otherwise the work has no visual dogfood path. Could be bundled with content-production work (an "AVR-READ-002" that exercises the full type set, to validate the new renderers).

### What this sprint will NOT touch

- The single-file `IELTS_Reading_Test_NN_Interactive.html` build pipeline (Andy's separate content-production track)
- The continuous-scroll-vs-one-Part-at-a-time architectural choice (cluster 20.4c + 20.6 prior approval — Mind's call to revisit)
- The draggable divider (cluster 20.4b prior approval)

---

## Sprint 20.14a draft scope sheet

If Mind agrees with this split, the follow-on Tier 1+2 sprint deliverables are:

| # | Deliverable | Files | Est. LOC |
|---|---|---|---|
| T1.1 | `renderInputs()` parse-stem-for-gaps for sentence_completion / summary_completion / notes_completion / table_completion | `reading-exam.js` | 80–150 |
| T1.2 | `renderQuestions()` emit `.headings-box` before any matching_headings run | `reading-exam.js` | 40–80 |
| T1.3 | `.gap-box` + `.gap-box.mono-block` + `.headings-box` CSS | `reading-exam.css` | 80–150 |
| T1.4 | mcq_single layout: hanging indent, bold prefix, no card border | `reading-exam.css` | 30–60 |
| T1.5 | TFNG/YNG 3-line instruction block via `QTYPE_INSTRUCTIONS` | `reading-exam.js` | 30–60 |
| T1.6 | `.exam-q__num` filled navy circle; drop `.exam-q` border | `reading-exam.css` | 20–40 |
| T2.1 | §3A.1 palette re-skin (navy bar, 30px square, `.nav-sep`, 4-state recolour) | `reading-exam.css` | 80–150 |
| T2.2 | §3A.3 toast DOM creation in `startTimer()` + 4s auto-dismiss | `reading-exam.js` | 40–80 |
| T2.3 | §3A.4 jump-flash keyframe + `.is-answered` on `.exam-q` | `reading-exam.css` + `reading-exam.js` | 40–80 |
| AV1 | Passage `text-align: justify` + drop 70ch cap | `reading-exam-mockup.css` override in `reading-exam.css` | 10–20 |
| AV4 | Navy `.exam-topbar` + light-on-navy text colours | `reading-exam.css` | 30–60 |
| Tests | §2A render sentinels per type + §3A palette state + toast + jump-flash + AV1/AV4 visual contract | `frontend/tests/sprint-20-14-display-fidelity.test.mjs` | 250–500 |
| **Total** | | | **~730–1430** |

Deploy marker: **`not-applicable`** — frontend-only, no backend touch.

---

## Open questions for Andy / Mind

1. **One-Part-at-a-time vs continuous scroll** — standards §3A.2 reads as one-Part-at-a-time (swap pane content per Part). Current production is continuous (stack all 3 passages + all 40 Qs, scroll). Keep continuous (recommend), or rebuild around the swap model? Significant architectural change either way.
2. **Passage column width** — drop the `max-width: 70ch` cap entirely (full pane width, justified) or keep the reading-optimum cap (justified within 70ch)? Andy's AV1 phrasing ("đứng yên, không reflow") reads like he wants the full-pane behaviour — Code recommends drop the cap.
3. **`.exam-questions__instructions--type` sunken box** — drop entirely (standards: thin separator only) or keep a softer treatment? Standards-strict says drop; Andy AV4 might prefer a softer box than the current heavy left-accent.
4. **Phase B sprint timing** — bundle with new seed content, or commission `20.14b` standalone with `AVR-READ-001` as the (limited) dogfood seed?

---

*Discovery doc — ships as a standalone PR; refactor sprints (20.14a + optionally 20.14b) follow once Mind + Andy confirm scope.*
