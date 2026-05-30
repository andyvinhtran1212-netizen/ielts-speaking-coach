# Cluster 20.x Reading Module — Retrospective (Final, through 20.15 + Perf)

**Status:** Cluster 20.x reading module — closure synthesis covering the full arc 20.0 → 20.15 plus the cross-cluster performance initiative (Perf-1/2/3).
**Audience:** Andy + future cluster leads. Reference for what was built, what went wrong, and what finally made closure stick.
**Authority:** Mind (chat orchestrator), synthesizing Code/Codex empirical reports + Andy's production dogfood across the arc.
**Supersedes:** the interim "truly closed" declarations at 20.8 and 20.12 (both rescinded — see §Premature-closure meta-pattern).

---

## 1. Full arc

### Phase I — Initial build (20.0 → 20.8)
- **20.0** Discovery · **20.1** Foundation (4-table schema, migs 086+087) · **20.2** L1 Vocab student · **20.3** L2 + admin UI · **20.4/4b/4c** exam-chrome mockup (3 approval iterations) · **20.5** L3 backend grader (Academic band table, answer-key stripping, skill_breakdown emit) · **20.6** L3 exam UI (state machine, scoped chrome, auto-save) · **20.6.5** Content Format v2 (FLAT vs NESTED) · **20.6.6** F1/F2 silent-failure fix (validator rejects nested + requires options) · **20.7** diagnostic engine (Codex) · **20.8** cluster close (1st — RESCINDED).

### Phase II — Post-audit hardening (Codex audit → 20.9 → 20.12)
- **Codex audit** — 0 P0, 4 P1 integrity seams, 5 P2 · **20.9** hardening (passage reconciliation, partial unique index + retry, atomic PATCH via new table, fail-closed started_at, diagnostic pins, live-route integration test) · **20.10** prod hotfix (root cause = 1 CSS specificity bug: `.exam-state-shell{display:flex}` overrode `[hidden]`; + CORS regex + 7-week-stale Railway redeploy) · **20.11** exam UX v2 (divider perceptual fix, question grouping, palette grouping, locale boundary, resume-no-auto-resume killing SQL workaround) · **20.12** governance hardening (Lessons 10/11/12 codified; cluster close 2nd — RESCINDED for standards).

### Phase III — Standards compliance + display fidelity (20.13 → 20.14f-α)
- Andy introduced **Interactive HTML Standards** (his content-production team's gold standard, 5-agent eval ≥9/10), evolving **v1.0 → v1.1** mid-cluster (added §2A 14-question-type display + §3A palette/feedback detail).
- **20.13a** Layer A visible fidelity (palette circle, TFNG dropdown, 4 themes, text-size, multi-color highlight) · **20.13b** Layer B a11y (modal focus trap + inert, skip link, live region, reduced-motion, palette role=group, keyboard parity) · **20.13c** Layer C behavior (wall-clock timer, norm() diacritic, answer_accept, version-gate cache, derive-from-data) — **first CI-gate failure** (Lesson 13).
- **20.14a** Tier 1 §2A served-type rebuild + Tier 2 §3A + AV1-4 (navy chrome, headings box, palette navy, justify) · **20.14a.1** dogfood bug fixes (passage width attempt 2, headings sticky boundary) · **20.14c** one-Part-at-a-time scroll · **20.14d** passage resize root-cause (marked.js `breaks:true` — Lesson 15) · **20.14b** Phase B types (10→16 types + AVR-READ-002 seed) · **20.14e** instruction prominence + summary flowing box · **20.14f** D0 diagram-image Discovery → **20.14f-α** image upload path (reuse listening mechanism).
- **20.15** admin preview + attempt-safe delete.

### Cross-cluster — Performance initiative (parallel)
- **Phase 1 Discovery** (Codex) — refuted Mind's "Grammar fast = SPA" hypothesis; real causes = no auth gate + in-memory backend + public model · **Phase 2 Discovery** — HAR capture issue caught; authenticated API timings; API-waterfall CONFIRMED · **Perf-1** Server-Timing instrumentation + Reading boot combined endpoint (3.85s→2.42s, -37%) · **Perf-2** Listening dictation boot (3.0s→1.73s, -42%) · **Perf-3** public cache headers + preconnect (Grammar 304 1.65s→0.74s, -55%) · Post-implementation addendum committed.

---

## 2. What finally made closure stick

Cluster 20.x declared "truly closed" **twice** (20.8, 20.12) and was rescinded both times, plus multiple within-sprint dogfood rescissions (20.10 after 2148 tests + audit; 20.14a-d passage-width across 4 attempts). The pattern is instructive.

**Why earlier closures failed:**
- 20.8: declared closed on test-green + feature-complete, before any production dogfood. Prod surfaced 4 bugs (20.10).
- 20.12: declared closed on governance-complete, before Andy's external standards (v1.1) raised the fidelity bar.
- Within 20.14: "shipped" declared on local-slice-green before CI full-suite (Lesson 13); on CSS-fix before root-cause (Lesson 15).

**What made the final closure durable:**
1. **All four gates honored, every sprint** (Pattern #45): test-green (CI full suite, not slice — Lesson 13) + audit-pass + prod-dogfood-pass + Deploy marker.
2. **"Shipped" redefined** — PR-open ≠ shipped. Shipped = CI-green-full + merged + deployed-verified + dogfood-passed.
3. **Honest rescission as data** — each rescission was documented as a lesson, not hidden. The arc table records CLOSURE-RESCIND history.
4. **Systematic build to spec** — 20.13-20.15 each mapped to a named standards section (§2A/§3A) or Andy dissatisfaction (AV1-4), so "done" had an objective referent.

The durable closure is not "we stopped finding bugs" — it's "every gate has an owner and an explicit check, and we honor each before declaring done."

---

## 3. Lessons — full table (1-15)

| # | Lesson | Origin |
|---|---|---|
| 1 | VERIFY-FIRST / no presumption (Mind no empirical presumption) | cluster retro |
| 2 | Full-chain test coverage (parse→validate→build→grade) | F1 |
| 3 | Silent→loud (validators enforce, not just docs) | F1/F2 |
| 4 | Claim→enforced (docs invariant needs constraint/test/dogfood) | audit/20.9 |
| 5 | Documentation enforceable (gov §5b anchor table) | 20.9 |
| 6 | Approval gate pattern (mockup iterations with flagged deviations) | 20.4 |
| 7 | Worktree isolation across parallel agents | cluster |
| 8 | skill_breakdown forward emission | 20.5→20.7 |
| 9 | SPLIT clause for large sprints | cluster |
| 10 | **Production dogfood gate** (separate from test-green + audit) | 20.10 |
| 11 | **merged ≠ deployed** (code deploy + migration = 2 ops steps; Deploy marker) | 20.10/20.11 |
| 12 | **"Dev workaround" framing audit** (workaround may mask prod UX defect) | 20.11 D5 |
| 13 | **Local test slice ≠ CI gate** (run FULL suite locally, not module slice) | 20.13c |
| 14 | **Versioned-doc bump → version-agnostic assertion tests** (`/v1\.\d+/` not `/v1\.0/`) | standards v1.1 |
| 15 | **Visual symptom → descend rendering layers, not just CSS** (passage width: max-width→specificity→cache→marked.js breaks) | 20.14a-d |

### New lessons detail

**Lesson 13 — Local slice ≠ CI gate.** In 20.13c, Code ran the reading-exam test slice (115 pass) and declared "shipped." CI ran the full frontend suite (1264 tests) and caught a `renderPalette` signature regression in a *different* file (Sprint 20.10 sentinel). Recurrence risk: agents naturally test the files they touched. Mitigation: commissions explicitly require FULL suite locally before "shipped"; "shipped" means CI-green-full, confirmed via Actions URL.

**Lesson 14 — Versioned-doc bump.** Bumping the standards doc v1.0→v1.1 broke a frontend sentinel asserting `/v1\.0/`. Fix: version-agnostic `/v1\.\d+/`. Generalization: any test asserting a version string should match a *family* (`/v1\.\d+/`), never an exact version, so doc bumps don't cascade test failures. Couples to Lesson 4 (claim→enforced) — the test enforces "standards present + versioned," not "standards is exactly v1.0."

**Lesson 15 — Descend rendering layers.** Passage-width "stuck column" survived 3 CSS-layer fixes (drop max-width, fix specificity, bust cache). Root cause was layer 4: `marked.js breaks:true` converting source-newlines to `<br>`, so the text had hardcoded breaks no CSS could reflow. Generalization: when a visual fix fails repeatedly at one layer, the cause is at a *different* layer — escalate the search (CSS width → CSS white-space → markup/render → content/source), don't retry the same layer. The symptom "wraps at fixed cadence = source line width" was the tell.

---

## 4. Patterns — active + new

### Active (carried in)
#11 three-chrome · #15 frontend zero-dep · #34 integration sentinel · #38 /goal atop commission · #42 commission-as-hypothesis + latitude · #43 Discovery-first · #44 paste frontend-design SKILL.md · #45 cluster closure (4 gates) · #46 Workaround Review.

### New (this arc)
- **#47 Pattern reuse across sprints** — extract a proven mechanism into a reusable pattern; follow-up sprints are smaller + lower-risk. Examples: Perf-2 reused Perf-1's combined-boot design; 20.14f-α reused listening's image mechanism wholesale (upload + storage + signed URLs + admin UI). Discovery-first (#43) feeds this — D0 maps the reusable mechanism before implementing.
- **#48 Empirical refutation of Mind hypothesis** — Mind's surface hypothesis is a *starting point*, not a conclusion. A Discovery agent's empirical findings refute/refine it. Confidence hierarchy: Mind-inference < code-read < measured. Example: Mind "Grammar fast = SPA/small bundle" → Phase 1 empirical "no, it's larger; real cause is auth gate + in-memory" → Phase 2 measured "auth is 16-18%, db/app dominates." Each layer corrected the prior. Codify: Mind labels claims EMPIRICAL / INFERRED / UNKNOWN; architectural changes wait for measured.
- **#49 Layered root-cause descent** — see Lesson 15. When a fix fails at layer N, search layer N+1, don't retry N. Maintain a layer ladder per problem domain (display: CSS-width → CSS-whitespace → markup → render-config → content).

---

## 5. Meta-observations

1. **Discovery-first was the dominant winning move.** Phase 1/2 perf, D0 standards comparison, D0 diagram mechanism — each prevented assumption-driven waste. The cost (a read-only investigation sprint) was repaid many times over in avoided rework + confident scope.
2. **The perf initiative validated data-driven discipline.** Server-Timing instrumentation (Perf-1 D1) turned "server-side is slow" (inferred) into "Reading is db-bound 82%, Listening app-bound 50%" (measured), redirecting future optimization per endpoint. Architectural changes (SPA/service-worker) stayed deferred because per-endpoint optimization kept delivering.
3. **SPLIT discipline scaled the standards work.** 20.13 (a/b/c) and 20.14 (a/a.1/b/c/d/e/f) were each reviewable PRs instead of one mega-PR. The cost (more PRs) bought auditability + staged deploys + isolatable regressions.
4. **Andy's production dogfood was the irreplaceable gate.** Every prod-surfaced bug (20.10 CSS, palette layout, headings sticky, passage width) passed test-green + audit first. No amount of automated testing substituted for a human looking at the rendered exam. Lesson 10 is the load-bearing gate.
5. **External standards evolving mid-cluster is normal.** v1.0→v1.1 wasn't scope creep — it was the content-production team's standard maturing. The cluster absorbed it via deliberate reopen (Pattern #45 reopen trigger), not by resisting it.

---

## 6. Final state

| Dimension | Status |
|---|---|
| Question types | 16 (full IELTS Academic Reading set) |
| Display fidelity | §2A served + Phase B types, §3A palette/feedback, one-Part scroll, passage reflow, instruction prominence, summary flowing box, diagram images |
| A11y | WCAG AA (focus trap, skip link, live region, reduced-motion, keyboard parity, contrast) |
| Behavior | wall-clock timer, diacritic-insensitive grading, answer_accept, version-gate cache |
| Admin | import, preview (with keys), diagram-image upload, attempt-safe delete |
| Performance | Reading boot -37%, Listening boot -42%, public cache -55% (304) |
| Standards | Interactive HTML Standards v1.1 §2A + §3A (versioned in repo) |

**Deferred (optional, post-closure):**
- 20.14f-β AI-gen diagrams (Gemini) — upload path covers the need; AI-gen when Andy wants it
- Library grouping (3 passage-rows → 1 test-row, cosmetic)
- Perf-4+ (Reading DB parallelization, Listening app-stage, Writing/Speaking dashboard breakdown) — incremental, data-driven when prioritized
- Architectural perf (SPA shell, service worker, bundling) — deferred per Phase 2 evidence; revisit only if per-endpoint plateaus

---

*Cluster 20.x reading module: CLOSED (durable — all four gates honored across the arc). Reopen requires a deliberate trigger per governance §6.*
