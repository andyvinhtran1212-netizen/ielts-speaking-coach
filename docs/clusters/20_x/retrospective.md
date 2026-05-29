# Cluster 20.x Reading — Retrospective

**Cluster closed:** 2026-05-29 (Sprint 20.8, PR forthcoming)
**Duration:** ≈ 7 weeks across 10 sprints (20.0 Discovery → 20.8 Close)
**Entrance state:** zero Reading module — no schema, no surface, no content
**Exit state:** three live libraries (L1/L2/L3), full L3 exam UI, rule-based diagnostic, locked content-authoring spec with enforced validator, admin import page with structured preview
**Cluster siblings for context:** 19.x Writing (preceded), 21.x Grammar (concurrent)

---

## 0. Cluster arc — sprint table

| Sprint | Title | What landed | Notable |
|---|---|---|---|
| 20.0 | Discovery | "Clone Listening, don't build fresh" + rule-based diagnostic decision; D2 skill_tag enum locked | Mind under-specced; Code/Codex empirical surfaced clone path |
| 20.1 | Foundation | 4-table schema (reading_passages, reading_questions, reading_tests, reading_test_attempts); L1 import live | Code consolidated Discovery's 6 tables → 4 |
| 20.2 | L1 Vocab | Student UI; glossary auto-wrap via DOMPurify-safe DOM walking | Glossary popovers work without `[term](glossary:slug)` markdown leakage |
| 20.3 | L2 + Admin UI | L2 Skill Practice (clone + skill_focus); admin authoring page (curl-friction killer) | Shared `reading-questions` web component for both libraries |
| 20.4 / 20.4b / 20.4c | Exam chrome mockup | Approval gate; 3 iterations to BC/IDP fidelity; 2 intentional deviations flagged transparently | Approval-gate pattern proven viable |
| 20.5 | L3 backend | Grader clone (Listening's `answer_matches` reused); Academic band table; GT=Phase B gate; `skill_breakdown` emitted ready for 20.7 | Forward-thinking emission (no refactor in 20.7) |
| 20.6 | L3 exam UI | Full L3 end-to-end (state machine, timer with grace, palette, auto-save, results) | Production absorbed mockup interactions inline (no DRY shortcut, zero regression risk) |
| 20.6.5 | Content Format v2 | Unified FLAT/NESTED spec; 3 dry-run-validated examples; flagged F1/F2 | v1 example shape mismatch surfaced via spec audit |
| 20.6.6 | F1/F2 fix | Validator silent → loud; seed correction; full parse → grade round-trip test | 76 errors raised on broken seed at dry-run |
| 20.7 | Diagnostic engine | Per-attempt skill_breakdown rollups + recommendations | (CI-verify only sprint — small surface) |
| 20.8 | Close (provisional) | Admin polish (5 gaps) + mockup retirement + retrospective + governance | Observation phase declared (rescinded — see 20.10) |
| 20.9 | Audit-driven hardening (post-close) | 3 P1 integrity seams + 2 P2 quality gaps + docs corrections | "Truly closed" again (rescinded — see 20.10) |
| 20.10 | Production hotfix | CORS apex/www regex + CSS `[hidden]` override + timer-state gating + palette grouping; 4 prod bugs in one shot | First prod dogfood; "truly closed" again (rescinded — see 20.11) |
| 20.11 | Exam UX iteration v2 | Divider visual upgrade + per-type English instruction blocks + palette pill separation + locale boundary + Resume/Start-fresh affordance | Second prod dogfood — UX gaps + stuck-attempt trap closed |
| **20.12** | **Meta-process docs hardening** | **Lessons 10/11/12 added to retrospective + governance §5b/§8/§9 expanded with prod-dogfood-anchor + deploy procedure + workaround review** | **Cluster truly closed (this time gated by post-merge prod-dogfood + ops-applied checklist)** |

## 1. By the numbers

### Code surface delivered

| Layer | LOC | Notes |
|---|---:|---|
| Backend services (`content_import_service`, `reading_test_grader`, `reading_diagnostic_engine`) | ~1,250 | Grader was a clone of listening's 13.5 grader; ~50 net adapter LOC |
| Backend routers (`admin_reading`, `reading_student`) | ~1,150 | Student router covers L1/L2/L3 student surfaces |
| Frontend pages + JS (vocab/skill/test/exam + admin) | ~1,800 | `reading-exam.js` carried the heaviest budget (883 LOC — Sprint 20.6 absorbed mockup interactions) |
| Migrations | 2 (mig 086 + 087) | 086 = 4-table foundation; 087 = test_attempts surface |
| Content seeds | 4 .md files | 2 L1 + 1 L2 + 1 L3 (AVR-READ-001, 40 Qs) |
| Spec docs | 5 | discovery + design_baseline + content_format_v1/v2 + exam_chrome_mockup |
| Cluster docs (this sprint) | 2 | retrospective + governance |
| Tests | ~3,600 LOC across 11 files | 8 backend + 3 frontend; F1/F2 round-trip test closes the coverage gap |

### Sprint LOC discipline

| Sprint | Hard cap | Shipped | Notes |
|---|---|---|---|
| 20.0–20.3 | per-spec | per-spec | Within cap |
| 20.4 series | 600 (mockup) | 750 | Code flagged + Andy approved deviation (fidelity worth it) |
| 20.5 | 500 backend | ≈ 480 | Within cap |
| 20.6 | 600 exam UI | 774 | Code flagged — duplication-avoidance over consolidation; mockup retired in 20.8 closes that debt |
| 20.6.5 | 100 code | 164 | Within cap (regression test slightly over by design) |
| 20.6.6 | 60 validator | ~50 net | Within cap |
| 20.8 | 290–1,115 | ≈ 700 | Within cap |

---

## 2. Lessons hardened (and the next cluster's heuristic)

These are the takeaways worth carrying out of the reading cluster into the
next one. Each one is anchored to a concrete moment in the arc — the kind
of thing future coordinators should not have to re-discover.

### 2.1 Verify-first beats spec-trust — *Pattern #42 in action*
**Where surfaced:** 20.0 Discovery (Mind's 6-table proposal → Code's empirical
4-table consolidation); 20.6.5 (v1 spec example was the storage shape, not
the author shape).
**Heuristic:** when the Mind hands the Code a structure or contract, the
Code is authorised to verify it against the actual moving parts before
implementing — and to push back with the empirical reality, even when
that contradicts a doc Mind already wrote.
**Carry forward:** Pattern #42 (Code-authoritative latitude) plus
"commission-as-hypothesis" — commissions are good seeds, not handcuffs.

### 2.2 Test coverage must span the FULL chain — *F1's escape route*
**Where surfaced:** 20.5 shipped a seed regression test that ran
`parse + validate` and stopped there. The build step (`build_reading_question_payloads`)
silently dropped options + double-nested answers for the entire nested-shape
seed. The defect made it into the cluster's flagship content file
(`AVR-READ-001`) and only got caught by the 20.6.5 spec audit.
**Heuristic:** for any pipeline of N stages, the seed regression must
exercise all N — at minimum `parse → validate → build → consume` (e.g.
`grade_attempt` here, `render` in other contexts). Stopping at stage K
hides everything past K.
**Closed in:** 20.6.6's `test_corrected_l3_seed_builds_and_grades_correctly`
round-trips the seed through every stage, including a perfect-student grade.
**Carry forward:** every cluster ships a full-chain seed/example regression
before the cluster closes.

### 2.3 Silent failure must become loud failure — *the F1/F2 closure*
**Where surfaced:** 20.6.5 noted that the v1 nested shape *parsed clean and
validated clean* (the dict-valued `answer:` slipped through a "non-empty"
guard), so the spec was the only line of defence. Specs alone don't enforce.
**Heuristic:** if the spec says "you must X", the validator must reject
not-X — preferably with an error message that quotes the spec section.
A validator that fails to enforce what the spec promises is a spec
already half-broken.
**Closed in:** 20.6.6 — every new validator error message links the author
back to `reading_content_format_v2.md §4`.
**Carry forward:** validators are the spec's teeth. No spec rule ships
without an enforcement path or an explicit "documented quirk, not enforced"
label.

### 2.4 Approval-gate iterations beat speculative perfection
**Where surfaced:** 20.4 / 20.4b / 20.4c — three iterations on the exam
chrome mockup before code-down. Mind held the design-acceptance authority;
Code shipped tight iterations against documented institutional fidelity
(BC/IDP); Code transparently flagged 2 intentional deviations (draggable
divider, live setInterval timer) for explicit Andy approval rather than
silently shipping or silently restricting.
**Heuristic:** when fidelity to an external standard matters, run an
explicit approval gate with named deviations. Don't let "code authoritative"
become a silent escape hatch from external standards.
**Carry forward:** institutional-fidelity work always goes through an
approval gate. Deviations are listed and approved, not assumed.

### 2.5 Worktree isolation across parallel agents — *production-proven*
**Where surfaced:** four worktrees during cluster (reading-20-2, reading-20-3,
reading-20-7 + the main one); Code, Codex, and Andy occasionally driving
concurrently. The pre-existing "concurrent sessions git hazard" memory
described an HEAD-collision scenario; with worktree isolation we never
re-encountered it.
**Heuristic:** one worktree per active branch, regardless of agent. Per-sprint
worktrees + explicit pathspecs on `git add` keep simultaneous sprints
non-colliding.
**Carry forward:** keep the worktree-per-sprint discipline.

### 2.6 Forward-thinking emission > backward-fitting refactor
**Where surfaced:** 20.5 emitted `skill_breakdown` JSONB on `reading_test_attempts`
even before the 20.7 diagnostic engine consumed it — chosen because the data
was free to compute at grade time and the column was free to write. When 20.7
landed, it consumed pre-existing data; zero refactor of 20.5 needed.
**Heuristic:** when a downstream consumer is on the roadmap and the upstream
data is cheap to emit, emit it now even if no consumer exists yet. A
"reserved column / empty payload" is far cheaper than a backfill migration.
**Carry forward:** every cluster identifies its near-future consumers
during Discovery and reserves data shape for them.

### 2.7 Mockup retirement is part of the cluster, not a tech-debt item
**Where surfaced:** 20.6 kept the approval-gate mockup alongside production
to reduce regression risk during the heaviest sprint of the cluster.
20.6 docs flagged this as a follow-up cleanup. 20.8 closes the loop.
**Heuristic:** if a sprint defers cleanup to ship safely, the cluster
closing sprint owns the cleanup. Don't let approval-gate scaffolding
ship to production permanently.
**Carry forward:** cluster-close sprints always audit "what scaffolding
did we leave standing?" and retire it.

### 2.8 SPLIT clause: unused in 20.6, but the option mattered
**Where surfaced:** 20.6 commission allowed splitting backend wiring +
exam UI into two sprints. Code absorbed both layers in one (~774 LOC,
slightly over the 600 cap), flagged transparently.
**Heuristic:** offering a SPLIT clause up front means the agent can opt
into single-sprint if the cohesion is genuine, or escalate into two
sprints if scope balloons. The option is a control valve.
**Carry forward:** SPLIT clauses are cheap insurance on ambitious sprints.

### 2.9 Claim → enforced: the docs-vs-code parallel of F1/F2 (added in 20.9)
**Where surfaced:** the Codex audit (after 20.8 close) found the cluster's
docs claimed three integrity guarantees the code didn't actually enforce:
"≤1 active attempt per user+test" (router-only, no DB constraint), "PATCH
is idempotent per q_num" (read-modify-write race window), "fully overwrites
on re-import" (orphan passages survived). Each was a doc claim with no
matching test or constraint — the same shape as F1/F2 but at the
integrity-claim layer instead of the spec-rule layer.
**Heuristic:** F1/F2 said "if the spec says X, the validator rejects not-X".
The 20.9 generalisation is "if the docs claim invariant X, the code or DB
enforces X — or the docs label X as 'unenforced quirk' explicitly".
**Closed in:** Sprint 20.9 (this PR). Three doc claims are now real:
partial unique index for active attempts; PK upsert for per-q_num PATCH;
reconciliation step for L3 re-import. The governance §5b table lists every
integrity invariant with the matching enforcement (DB constraint, test,
or explicit quirk label).
**Carry forward:** retrospective / governance / spec language is reviewed
the same way validator code is — every claim sits next to a test or
constraint, or it's labelled as a known unenforced quirk. The audit also
hardened the diagnostic-threshold language: those numbers are observation
heuristics, not externally validated IELTS calibration; the retrospective
now says so.

### 2.10 Diagnostic thresholds are heuristic observation values (added in 20.9)
**Where surfaced:** Sprint 20.7's diagnostic engine uses `WEAK < 60%`,
`WATCH < 75%`, and `TREND_DELTA = 10` as cluster-wide cutoffs. The Codex
audit (P2-5) flagged that the cluster docs didn't say these are heuristic
product choices, not externally validated IELTS thresholds. Treating
them as if they were anchored could mislead future content prioritisation.
**Heuristic:** when an engine uses numeric thresholds that look anchored
(60 = sounds like a percentage band, 75 = sounds like a B2 threshold),
the docs must say explicitly whether they are heuristic observation
choices or externally calibrated. If heuristic, that's fine — name it.
**Carry forward:** any future diagnostic rule with numeric cutoffs ships
with a one-line note on rationale (`# heuristic observation; tune in Phase B`).

### 2.11 Production dogfood is a separate closure gate (added in 20.12)
**Where surfaced:** Sprint 20.10. By the time 20.9 merged the cluster had
2,148 passing backend tests, 89 passing reading-frontend sentinels, a
Codex audit with no P0 findings, and an end-to-end integration test
(D6) covering admin import → student detail → start → patch → submit →
diagnostic at the live HTTP route layer. Mind declared the cluster
"truly closed" — twice (20.8 + 20.9). **Andy's first real production
dogfood, a few days after the 20.9 merge, surfaced four bugs in one
session:** CORS rejecting `www.averlearning.com`, the `.exam-state-shell { display: flex }`
rule silently overriding `[hidden]` (so every state panel was visible at
once after the first transition), the timer interval continuing to tick
after a transition out of `in_progress`, and the palette ungrouped vs
real BC/IDP fidelity. Each was the kind of defect that only surfaces when
the multi-state composition is rendered in a real browser, with real
state transitions, on the real production deployment.
**Why it slipped:** unit + integration tests in this cluster render single
DOM elements or single response shapes; they don't compose multiple state
panels at once. The Codex audit reads code statically — it would not catch
a CSS specificity bug that depends on the cascade of two rules from two
different stylesheets. The full-chain D6 integration test exercised the
HTTP route chain end-to-end, not the *visual* composition.
**Heuristic:** test-green + audit-pass are necessary but NOT sufficient
for cluster closure. The fourth gate is *production dogfood pass on the
real deployed surfaces*. Without it, "truly closed" is wishful thinking
about classes of defects that the prior three gates structurally cannot
see.
**Closed in:** Sprint 20.12 (this PR) — governance §5b extended with a
fourth anchor type ("prod-dogfood pass"), Pattern #45 carry-forward says
cluster closure REQUIRES a documented prod-dogfood pass alongside the
three test/audit/integration gates.
**Carry forward:** no cluster closure ships without a one-paragraph
prod-dogfood report from a real user on a real deployment. The report
names the surfaces exercised + states transitioned through + bugs
surfaced (zero is fine; one is enough to defer closure).

### 2.12 Code deploys and DB migrations are 2 separate ops steps (added in 20.12)
**Where surfaced:** Sprint 20.10's audit of the CORS symptom revealed a
parallel discovery: the explicit `www.averlearning.com` origin had been
in `main` since commit `4c9fc1e9` on 2026-04-08 — **seven weeks** before
Andy hit the prod CORS error. Railway's auto-deploy had been stale that
whole time; the merged code never reached the running backend. Sprint
20.9's migration 088 (partial unique index + `reading_attempt_answers`
table) had the same problem: the PR merge dropped the SQL file on disk
but never applied it to the production Supabase instance. Andy had to
manually trigger a Railway redeploy AND apply migration 088 via the
Supabase SQL editor before the 20.9 work was actually live.
**Why it slipped:** Mind's commissions and the retrospective both
treated "merged to main" as synonymous with "deployed and applied". No
sprint closure checklist explicitly verified Railway's deployed commit
hash or Supabase's applied-migration state. The PR templates didn't ask.
The 20.9 integration test ran against in-process FastAPI + a mocked
Supabase client — green tests said nothing about the prod runtime.
**Heuristic:** for any sprint touching backend code, a migration, or
both, "merged" is only the first of three ops steps. The remaining two
are *deployed* (Railway dashboard's latest deployment commit hash matches
`main` HEAD) and, when a migration shipped, *applied* (schema assertion
passes against the prod DB). Closure is contingent on all three.
**Closed in:** Sprint 20.12 — new governance §8 (Deploy & Apply
Procedure) makes the three-step checklist explicit and pins it as a
closure requirement. The §5b doc-claim discipline now lists "deployed +
applied" as a precondition for any post-merge integrity claim.
**Carry forward:** every PR that touches `backend/` or `backend/migrations/`
ends with a two-line "Deploy + Apply" status comment in the merge thread
or coordination memory. The status is one of: `not-applicable` (frontend-
only), `deployed-only` (backend, no migration), `deployed-and-applied`
(both). Anything else is open work, not closure.

### 2.13 "Dev workaround" framing in commissions can mask production UX defects (added in 20.12)
**Where surfaced:** Sprint 20.11 D5 was commissioned as a "dev / admin
'Start fresh' affordance to abandon current attempt" — Mind's framing
treated the stuck-mid-attempt problem as friction *Andy hit during
dogfood*, fixable with an internal tool. Code's read of the commission
recognised the larger shape: any student who paused mid-attempt and
came back to the exam URL was auto-resumed into the running clock with
no way to restart short of a SQL UPDATE. The "dev workaround" was just
the developer's name for a UX defect every user shared. Code shipped
D5 as a Resume + Start-fresh affordance in the pre-start screen for
**every authenticated user**, with a confirmation modal — no SQL hatch
needed because the production UX no longer requires one.
**Why it slipped:** when an agent (Mind) sees a peer (Andy) hit
immediate friction, the natural framing is "what tool would unblock
the peer right now?" That framing collapses the difference between
internal-tool scope and product-UX scope. If the underlying defect
affects every user but is *discovered* during dev work, "dev workaround"
prejudges the scope as the smaller of the two.
**Heuristic:** when a commission deliverable carries the words
"workaround", "dev tool", "admin affordance", "SQL fix", or "manual
procedure", the first question to answer before accepting the framing
is: *would a real user encounter the underlying defect on the production
surface?* If yes, the deliverable's true scope is a UX fix for all users,
not a tool for the dev. The workaround belongs in the discarded-options
list, not in the shipped deliverable.
**Closed in:** Sprint 20.12 — new governance §9 (Workaround Review)
codifies the check. Mind's commission template (Mind-side, not in this
repo) absorbs the same checklist.
**Carry forward:** every commission whose scope contains a
workaround-style word goes through one explicit checklist line: "Is
this workaround needed because production UX has the underlying defect?
[yes / no — justify]". If yes, the deliverable rewrites as a UX fix
before the sprint starts.

---

## 3. Goals achieved (entrance → exit delta)

- ✅ **Three reading libraries live** — L1 Vocab, L2 Skill Practice, L3 Full Test all imported, served, gradeable
- ✅ **Diagnostic learning loop functional** — `skill_breakdown` per attempt + rule-based recommendation engine (Sprint 20.7)
- ✅ **Content production pipeline safe** — v2 spec (FLAT vs NESTED separation), validator enforcement (F1/F2), dry-run-then-commit workflow, idempotent re-import
- ✅ **Admin authoring** — drag-drop import + structured preview + L1/L2/L3 filtered listing; admin can produce content without curl
- ✅ **Institutional exam fidelity** — approved BC/IDP-style chrome shipped, 2 deviations flagged + approved (live timer, draggable divider)
- ✅ **Test coverage spans the full chain** — F1/F2 closed the parse-only gap; corrected seed round-trips through grade
- ✅ **Zero broken DB rows in production** if the corrected seed is re-imported (idempotent upsert per the v2 spec §11)

---

## 4. Deferred (named, not abandoned)

These items remain open at cluster close. They are not failures of the
cluster — each was a deliberate Phase B / out-of-scope decision with a
named trigger for re-opening.

| Item | Why deferred | Re-open trigger |
|---|---|---|
| **Mass content production** | NOT a sprint — it is an Andy/content-agent workflow using the v2 spec | Ongoing (observation phase) |
| **Completion-aware diagnostic** | L2 doesn't persist attempts; diagnostic only sees L3 attempts | Phase B; when L2 attempt persistence ships |
| **General Training band table** | Cambridge GT has a different raw → band curve; not authored in 20.5 | When GT content production starts |
| **L2 attempt persistence** | Sprint 20.3 grades inline without writing to a table | When per-skill longitudinal tracking matters |
| **`reading-exam-mockup.css` rename → `reading-exam-chrome.css`** | Cosmetic-only; deferred in 20.8 to avoid risk in a closing sprint | Next cluster touching exam chrome |
| **Per-type "required render data" check beyond options** | F2 covers options; `template:` for `*_completion` types is still optional/unenforced | If completion-type bugs surface |
| **Phase B question types** (`mcq_multi`, `matching_information`, etc.) | DB CHECK allows them; importer's Phase 1 subset rejects them | When the renderer + grader handle them |
| **Admin delete endpoint** | List exists (20.3 + 20.8 L3 branch); delete via Supabase SQL today | When non-engineer admin needs deletion |
| **"Tất cả" filter excludes l3_test passages** | The unfiltered admin list still shows 3 rows per L3 test (one per passage_order) | Cosmetic UX — when first content reviewer complains |

---

## 5. Observation phase (what 20.9+ looks like)

Cluster 20.x enters **observation**, mirroring cluster 21.x's post-21.3 state.
Code/Codex are no longer the primary drivers of the reading module — Andy
and the content-production agent are.

### 5.1 What "observation" means in practice
- **No new feature sprints planned** for the reading module unless a
  re-open trigger fires (see §4).
- **Mass content production is live** via the v2 spec + content agent.
  Each new file is dry-run-validated, then committed. The validator now
  enforces what the spec describes (F1/F2 closed).
- **Bug fixes are welcome** but small and surgical — no "cluster 20.9 admin
  redesign". If the admin UX needs a rethink, it earns its own discovery
  sprint, not a "20.x continuation".

### 5.2 What to watch
- **Content-agent drift** — if an agent starts producing files that
  consistently hit one validation error, the spec or validator may need
  a sharper guard. Track the rate.
- **L3 attempt grade-correctness** — the F1/F2 fix closes silent
  mis-grading; any future regression here is a P0.
- **Diagnostic engine signal quality** — if `skill_breakdown` rollups
  produce noisy recommendations, the rule set in `reading_diagnostic_engine.py`
  is the right knob, not the spec.
- **Glossary popover UX in production** — auto-wrap was non-trivial in
  20.2; any DOMPurify-tightening change in the framework could regress it.

### 5.3 The next cluster's seed advantage
Cluster 21.x post-close, 22.x (whichever ships next) inherits:
- A working approval-gate pattern (20.4 series).
- A working spec-→ validator-→ test feedback loop (20.6.5 → 20.6.6).
- A working full-chain seed regression template (the 20.6.6 round-trip test).
- The Pattern #42 (Code-authoritative + commission-as-hypothesis) cadence.

The reading cluster was the first to ship all three of (a) an approval
gate, (b) a spec audit catching a silent failure, and (c) a follow-up
sprint enforcing the spec. Future clusters can take that order as a
default.

---

## 6. Acknowledgements (the cluster's actual decisions)

A few specific decisions worth re-stating, with attribution:

- **Mind**: cluster shape (10 sprints, approval gate, Phase B gates),
  authority on fidelity acceptance (20.4 series), authority on the F1/F2
  reject-vs-normalize call (chose reject).
- **Code**: 4-table consolidation in 20.1 (overruled Mind's 6-table proposal
  via Pattern #42); v2 spec audit catching F1/F2; deliberate SPLIT-clause
  declination in 20.6 (single-sprint absorbed both layers).
- **Codex (when active)**: 20.7 diagnostic engine; parallel work on adjacent
  cluster slots without worktree collisions.
- **Andy**: 20.4-series fidelity reviews (3 iterations); F1/F2 production
  scoping ("did the broken seed actually break prod?"); 20.8 cluster-close
  commission.

---

**Cluster 20.x — closed cleanly. Observation phase begins.**
