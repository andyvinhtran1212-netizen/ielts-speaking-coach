# Exam Chrome Mockup — Sprint 20.4 + 20.4b Approval Gate

**Sprint:** 20.4 (mockup) + **20.4b (fidelity revision per Andy feedback)**
**Predecessor:** Sprint 20.3 (PR #322 merged) — L2 + admin authoring UI
**Successor:** Sprint 20.5 (L3 backend, clone listening grader) — **BLOCKED until this mockup is approved**
**Authority:** Code authoritative on implementation; **Andy authoritative on fidelity acceptance**

> Approval gate, iteration 1. The mockup is a **reviewable visual prototype, not production**.
>
> **What changed in 20.4b** (Andy review of 20.4 PR #323): rubric text bumped to 15 px;
> **draggable** split divider (50/50 default, clamps 30–70%, sessionStorage persistence);
> **highlight + note** tools live now (right-click context menu, faithful to real BC/IDP);
> timer moved upper-MIDDLE with minutes-only display per Mình's research; exam-only typeface
> override to institutional `system-ui / Arial`; prev/next palette nav arrows added.
> See §3 below for which 20.4 open questions are now resolved.

## How to review

```bash
# Serve the worktree's frontend directory on :5500 (any static server)
cd ~/Documents/ielts-worktrees/reading-20-3/frontend
python3 -m http.server 5500
# Open:
# http://localhost:5500/pages/reading-exam-mockup.html
# Preview the timer warning/critical states:
# http://localhost:5500/pages/reading-exam-mockup.html?demo=warning
# http://localhost:5500/pages/reading-exam-mockup.html?demo=critical
```

The page is static — no auth, no backend, no real timer. Click around the question palette, toggle flags, change the text size in the Settings popover.

## Fidelity reference + caveat

**Primary reference:** `docs/clusters/20_x/discovery.md` §5 — BC/IDP UI research from Sprint 20.0 (9 official BC/IDP/IELTS-Australia URLs). The mockup applies those documented features.

⚠️ **No screenshots were attached to the 20.4 commission.** The commission's Andy-execution step 2 noted "Optional but recommended: supply Code official IELTS computer-based Reading UI reference screenshots." Without them, the mockup's fidelity is bounded by the Discovery §5 textual research + the cluster 20.x `design_baseline.md` §3C. **Items where screenshot fidelity would tighten the design are flagged in §3 Open questions below.**

## §1 — Architectural choices (Code-authoritative, surface for review)

- **Chrome isolation = inline page CSS scoped under `.exam-chrome`**, not a Shadow-DOM web component (yet). The design baseline calls for a 3rd chrome via the existing per-page Shadow-DOM opt-in mechanism, but for a *mockup*, a single-page inline shell is enough — and lets Andy review the surface without component-encapsulation overhead. The web-component `aver-exam-chrome.js` lands in Sprint 20.6 when L3 ships (the CSS + structure here is what it'll wrap).
- **Token override layer**: a small set of `--exam-*` vars on `.exam-chrome` (not new global tokens). Surfaces, borders, accent + warning + critical, mono-timer alias. Student/aver-admin chromes are untouched.
- **Mockup-only affordances**: the yellow banner across the top + the `?demo=warning|critical` query flag exist for Andy's review and are removed when the production exam chrome ships.
- **🔶 Intentional fidelity deviation: draggable split divider** (Sprint 20.4b). Strict real-exam fidelity = a fixed 50/50 split with independent scrollbars (the real BC/IDP CD Reading UI does **not** expose a user-resizable divider in most versions). Andy's product decision favours usability over strict fidelity, so the mockup ships a **draggable** divider (default 50%, clamps 30–70%, sessionStorage persistence, keyboard arrow-key a11y when focused). Surfacing this here so it's not mistaken for a fidelity oversight when Andy compares against the real exam.

## §2 — Fidelity checklist (BC/IDP element → mockup status)

| BC/IDP element (Discovery §5 + Mình research) | Mockup status | Notes |
|---|---|---|
| Top bar — candidate id / name | ✅ Placeholder (`Candidate 0000-0000 · Test Taker`) | Real id wired in 20.6 |
| **Top bar — countdown timer — upper-MIDDLE, MINUTES-ONLY** | ✅ **20.4b**: `<div class="exam-timer-wrap">` in the centre column, value is a bare integer + "MIN REMAINING" label; warning at 10 min, critical pulse at 5 min (preview via `?demo=warning\|critical`) | Real countdown + auto-submit = 20.6 |
| Top bar — section indicator | ✅ "Reading · Part 1 of 3" under candidate info (top-left) | Section transitions = 20.6 |
| Top bar — Settings (text size / contrast) | ✅ Text size (A / A / A) interactive; Contrast disabled (Phase B label) | Phase B per Discovery §5 |
| Top bar — Hide / Help | ⚠ Buttons present, inert | Phase B |
| **Split view — passage LEFT, questions RIGHT, draggable** | ✅ **20.4b**: default **50/50** ("two halves"), **draggable divider** (clamps 30–70%, sessionStorage, keyboard arrows when focused), independent scroll preserved | **Intentional fidelity deviation** per Andy — real exam has a fixed split; Andy's product decision favours usability (see §1) |
| Passage rendering | ✅ Paragraph-labelled A–E, institutional sans, line-height 1.7 | Real passages → marked + DOMPurify in 20.6 |
| **Rubric / instruction text** | ✅ **20.4b**: bumped 13 px → 15 px (matches question-prompt size; was Andy feedback #1) | — |
| **Question nav palette** (numbered 1–N) | ✅ Numbered buttons + current/answered/flagged states + click-to-jump + **20.4b prev/next arrows** bottom-right | Full 40-Q grid in 20.6; mockup ships 10 |
| **Flag-for-review** per question | ✅ Flag button on each card; corner-triangle indicator on the palette | Faithful to BC/IDP "skip & return later" |
| Auto "answered" state when a control changes | ✅ Palette button gets `.is-answered` on input/change | Mockup-level |
| **Highlight tool** (select → right-click → Highlight) | ✅ **20.4b LIVE** — works on **both** passage AND questions panels (per Mình research); multiple highlights coexist; right-click an existing one → Remove; XSS-safe (TreeWalker text-node walking, never `innerHTML`) | Was Phase B (Sprint 20.4) → **built now** per Andy feedback #3 |
| **Notes tool** (select → Note → popover) | ✅ **20.4b LIVE** — same context menu's Note action wraps the selection + adds an inline `note` marker; click marker re-opens the popover (Save / Cancel / Delete); persists in-session via `data-note` attribute | Was Phase B → built now |
| Copy/paste from passage | ✅ Native browser copy works | — |
| Review screen (end of section) | ❌ Not in this mockup | Sprint 20.6 |
| Back / Next / Submit buttons | ✅ **20.4b**: Prev/Next arrows wired (cycle palette + scroll); Review + Submit inert | Section transitions = 20.6 |
| **Typeface** | ✅ **20.4b**: exam-only override `system-ui, -apple-system, Segoe UI, Verdana, Arial, sans-serif` (resolves Q1 toward institutional fidelity) | Student + aver-admin chromes keep Plus Jakarta Sans |
| Visual tone — institutional, no brand warmth | ✅ Neutral grays (`~#F5F6F7` base, `~#C7CBD1` border), single teal accent, zero amber | Scoped override layer |
| Mobile policy | ✅ "Best on desktop" notice + stacked fallback under 900px | Real exam is desktop-only |

## §3 — Open questions (status after Andy's 20.4 review)

Andy's 20.4 review resolved three of the original eight. The rest stand for the next decision point (Sprint 20.5/20.6).

1. ~~**Body typeface for the chrome**~~ → **RESOLVED 20.4b: institutional system stack.** Mình + Andy's fidelity reading is that the real CD exam uses Arial-family / system-ui, not the brand sans. The exam chrome now uses `system-ui, -apple-system, Segoe UI, Verdana, Arial, sans-serif` (scoped to `.exam-chrome` only; student + aver-admin chromes still use Plus Jakarta Sans).
2. **Passage typeface** — still same sans as the chrome. Mình's research note mentioned "institutional sans + serif passage text per BC/IDP", but Discovery §5 found sans-serif. *Lean: stay sans for now.* Andy can override → add a serif (e.g. Georgia) for `.exam-passage__body` only. Reference screenshots would still settle this in one look.
3. ~~**Highlight tool — interactive in the mockup?**~~ → **RESOLVED 20.4b: built now.** Right-click context menu (Highlight / Note / Remove) wired on both passage and question panels. XSS-safe (TreeWalker + textContent). Multi-paragraph selections supported.
4. ~~**Resizable split divider**~~ → **RESOLVED 20.4b: draggable, with explicit fidelity-deviation flag.** Andy's product decision overrides strict fidelity here (real exam = fixed split). Default 50/50 ("two halves"), clamped 30–70%, sessionStorage persistence, arrow-key a11y when focused. *Documented as intentional deviation* in §1.
5. **Timer treatment in 20.6** — mockup is static (now minutes-only, upper-middle) + `?demo=` flag. *Lean for 20.6:* client countdown UX + server `started_at` validation on submit (D3 from 20.0 Discovery). **Open — confirm at 20.5/20.6 hand-off.**
6. **Hide / Help buttons** — inert in the mockup. *Lean: keep as Phase B placeholders.* Override = wire Help to a static help modal in 20.6.
7. **Single-section vs full 3-part test in production** — mockup shows Part 1 only. 20.6 will need Part transitions. *Lean:* 3 separate `reading_test_attempts` answer regions OR one attempt with section navigation. **20.5 backend design surfaces the choice.**
8. **Submit confirmation modal** — real exam shows a confirm dialog before final submit. Mockup omits. *Lean: build in 20.6.*

## §4 — Acceptance criteria (what Andy is approving)

✅ approval of the mockup means agreement on:

- The exam chrome's **structural elements** (top bar / split view / nav palette) and **proportions** (55/45 split).
- The **institutional neutral tone** (gray surfaces, single teal accent, mono timer, zero brand warmth, functional-only motion).
- The **Phase 1 / Phase B split** in the fidelity table above (highlight tool, notes, hide/help, contrast = Phase B; everything else Phase 1).
- The **open-question leans** in §3, unless Andy overrides specific items.

Approving 20.4 unblocks Sprint 20.5 (L3 backend: clone of `listening_test_grader`, `reading_test_attempts` writes, the 3 student endpoints' L3 trio). If Andy wants a fidelity revision before that, Sprint 20.4b incorporates the feedback first.

## §5 — What's still deferred (clear scope boundary)

- All **backend work**: grading, attempt persistence, band conversion (Reading band map distinct from Listening), section transitions — Sprint 20.5.
- **Real countdown** + auto-submit at zero — Sprint 20.6.
- **Web-component** wrapping (`aver-exam-chrome.js` mirroring the existing two chromes) — Sprint 20.6, with the CSS + structure from this mockup as its body.
- **L3 content import** — one-line `_LIBRARY_BY_CONTENT_TYPE` addition + a passage-grouping migration (Code's 20.3 generalisation already provides the hook).
- **Diagnostic rollup** (skill_breakdown by `skill_tag` at submit) — Sprint 20.7.

## §6 — Files in this sprint

| File | Purpose |
|---|---|
| `frontend/pages/reading-exam-mockup.html` | Static mockup page (chrome shell + sample Part 1 content) |
| `frontend/js/reading-exam-mockup.js` | Mockup-only interactions (palette scroll, flag, settings, demo flag) |
| `frontend/css/reading-exam-mockup.css` | Exam-chrome token overrides + layout + palette + question card |
| `docs/clusters/20_x/exam_chrome_mockup.md` | **This doc** — fidelity checklist + open questions |
| `frontend/tests/sprint-20-4-exam-chrome-mockup.test.mjs` | Sentinel for the shell + split-view + palette structure |
