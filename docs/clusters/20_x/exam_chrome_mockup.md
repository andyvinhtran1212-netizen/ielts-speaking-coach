# Exam Chrome Mockup — Sprint 20.4 Approval Gate

**Sprint:** 20.4 — exam-chrome mockup (Pattern #43, approval-as-Discovery)
**Predecessor:** Sprint 20.3 (PR #322 merged) — L2 + admin authoring UI
**Successor:** Sprint 20.5 (L3 backend, clone listening grader) — **BLOCKED until this mockup is approved**
**Authority:** Code authoritative on implementation; **Andy authoritative on fidelity acceptance**

> This is the approval gate. The mockup is a **reviewable visual prototype, not production**. Andy's review decides whether to proceed to Sprint 20.5 (L3 backend) as-is or iterate.

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

## §2 — Fidelity checklist (BC/IDP element → mockup status)

| BC/IDP element (Discovery §5) | Mockup status | Notes |
|---|---|---|
| Top bar — candidate id / name | ✅ Placeholder (`Candidate 0000-0000 · Test Taker`) | Real id wired in 20.6 from session |
| Top bar — countdown timer (mono, prominent, top-right) | ✅ Visual (static `59:42`) + warning / critical states demoable via `?demo=warning\|critical` | Real countdown + auto-submit = 20.6 |
| Top bar — section indicator (e.g. "Part 1 of 3") | ✅ Centered | Section transitions wired in 20.6 |
| Top bar — Settings (text size / contrast) | ✅ Text size (A / A / A) interactive; Contrast disabled (Phase B label) | Contrast = Phase B per Discovery §5 |
| Top bar — Hide / Help | ⚠ Buttons present but inert | Phase B; surface in open questions |
| **Split view — passage LEFT, questions RIGHT** | ✅ 55% / 45%, **independent scroll** per panel, visible vertical boundary | Faithful to "use both scroll bars" Discovery finding |
| Passage rendering | ✅ Paragraph-labelled (A–E), institutional sans, line-height 1.7 | Real passages = markdown → marked + DOMPurify in 20.6 |
| **Question nav palette (bottom, numbered 1–N)** | ✅ Numbered buttons, current/answered/flagged states, click-to-jump scroll | Full 40-Q grid in 20.6; mockup ships 10 |
| **Flag-for-review** per question | ✅ Flag button on each card; corner-triangle indicator on the palette | Faithful to BC/IDP "skip & return later" flow |
| Auto "answered" state when a control changes | ✅ Wired (palette button gets `.is-answered` on input/change) | Mockup-level — production tracks server-side |
| **Highlight tool** (select text → highlight) | ⚠ **Visual-only example** in para A (`citizen science` highlighted) | Interactive highlight = Phase B per Discovery §5 + commission decision 4 |
| Notes tool | ❌ Not shown | Phase B per Discovery §5 |
| Copy/paste from passage | ✅ Native browser copy works | Don't block — Discovery §5 |
| Review screen (end of section) | ❌ Not in this mockup | Sprint 20.6 — flag indicators on the palette communicate intent for now |
| Back / Next / Submit buttons | ⚠ Submit + Review buttons present, inert | Section navigation = 20.6 |
| Visual tone — institutional, no brand warmth | ✅ Neutral grays (`~#F5F6F7` base, `~#C7CBD1` border), single teal accent, zero amber | Override layer; student/aver-admin chromes unchanged |
| Mobile policy | ✅ "Best on desktop" notice + stacked fallback under 900px | Real exam is desktop-only (test centres) |

## §3 — Open questions for Andy (fidelity decisions)

These are decisions where the Discovery research left room or where screenshot fidelity would tighten the call. Each has a Code lean — Andy override at will.

1. **Body typeface for the chrome** — I'm using `Plus Jakarta Sans` (the project brand sans) because the design baseline §2 lists it as transferring to exam. **Real BC/IDP exam looks more like Verdana / system-ui**. *Lean: keep Plus Jakarta Sans (already documented in the baseline). Override = swap to `system-ui, -apple-system, Segoe UI, Verdana` for stricter institutional feel.* Reference screenshots would settle this in one look.
2. **Passage typeface** — currently same sans as the chrome. Some commentary on the real BC exam mentions a serif passage body; my Discovery §5 found sans-serif. *Lean: stay sans (Discovery finding). Override = add a serif (e.g. Georgia, system-ui-serif) for the `.exam-passage__body` only.*
3. **Highlight tool — interactive in the chrome mockup, or deferred to 20.6?** Discovery §5 + commission decision 4 say Phase B. Mockup ships **visual-only** (one example highlight). *Lean: keep Phase B. Override = build a `select → toolbar → highlight` interaction in this sprint (cheap-ish, ~80–120 LOC).* Andy may prefer to see it as a fidelity demo before 20.5.
4. **Resizable split divider** — real exam: fixed proportions, not user-resizable (per Discovery §5). Mockup ships fixed 55/45. *Lean: keep fixed.*
5. **Timer treatment in 20.6** — mockup is static + `?demo=` flag. *Lean for 20.6:* client countdown UX + server `started_at` validation on submit (D3 from 20.0 Discovery). Confirm this stands.
6. **Hide / Help buttons** — inert in the mockup. *Lean: keep as Phase B placeholders.* Override = wire Help to a static help modal in 20.6.
7. **Single-section vs full 3-part test in the production exam** — mockup shows one Part 1 only. 20.6 will need Part transitions. *Lean:* 3 separate `reading_test_attempts` answer regions OR one attempt with section navigation; 20.5 backend design will pick. Surface here in case Andy has a preference.
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
