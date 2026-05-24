# Cluster 14.x — DEBT-SPEAKING-GRADING-QUALITY — Closure Retrospective

**Status:** CLOSED on Sprint 14.9 merge (2026-05-24)
**Cluster span:** Sprint 14.0 (2026-05-22) → Sprint 14.9 (2026-05-24)
**Branch model:** branch-per-sprint, PR each with full CI green before merge
**Predecessor cluster:** 13.x DEBT-ADMIN-LISTENING-AUTHORING (closed Sprint 13.6.3)

> **Honesty note (a.k.a. the whole point of this cluster's process).** Figures
> below are taken from verifiable sources only: the merged-PR list (`gh`), the
> current test suite, the Codex audit report, and first-hand sprint records.
> Where the originating commission asserted a number this retrospective could
> NOT verify (e.g. cluster-start test baselines, a "18 patterns codified"
> registry, a letter grade), the claim is corrected or omitted rather than
> repeated. The corrections themselves are catalogued under Pattern #42 below —
> they are the cluster's defining process lesson, not an embarrassment to hide.

---

## What shipped

All 8 user-reported Speaking-grading deficiencies were resolved, plus the three
P0/P1 findings from a mid-cluster Codex audit. The cluster pivoted early (per
the discovery doc) from the original "Grammar Mindmap + Checker" framing to a
user-deficiency-driven enhancement set.

### Verified sprint roll-up (16 merged PRs)

| Sprint | PR | Merged | Outcome |
|--------|-----|--------|---------|
| 14.0 | #258 | 05-22 | Discovery doc (doc only) |
| 14.1 | #260 | 05-22 | Speaking results light-theme fix (spike + fix) |
| 14.2 | #261 | 05-22 | Audio playback + per-Q length gate |
| 14.3 | #262 | 05-22 | AI provider fallback chain (Haiku → Gemini → Sonnet) |
| 14.4 | #263 | 05-22 | Cue-card detection for custom Part 2 questions |
| 14.5 | #264 | 05-22 | Rubric + prompt uplift (bands 1–3, anti-inflation, VN-learner) |
| 14.6.1 | #265 | 05-22 | Light-theme bullets hotfix (results feedback JS render path) |
| 14.6.2 | #266 | 05-22 | Replace mode toggle with part-driven custom-Q routing |
| 14.7 | #267 | 05-22 | Off-topic detection (LLM judge) + length soft warnings |
| 14.8 | #268 | 05-22 | Grammar checker integration (Phase A enrich + transcript highlight) |
| 14.6.3 | #269 | 05-23 | Cue-card endpoint frontend API base-URL hotfix (P0) |
| 14.6.4 | #270 | 05-24 | Part 2 input UX simplification (line 1 only + length warning) |
| 14.6.5 | #271 | 05-24 | Light-theme Phase B panels + result-card band consistency hotfix |
| 14.5.1 | #272 | 05-24 | Practice result-page completeness (coaching weaknesses + takeaway) |
| 14.8.1 | #273 | 05-24 | Codex P0+P1: signal persistence + telemetry RLS + responses uniqueness |
| 14.8.2 | #274 | 05-24 | Response-save atomic upsert (F3 code swap, after migration 077 live) |
| 14.9 | #275 | 05-24 | **Cluster closure** (this retrospective + Phase B backlog + ledger + F5) |

**Honest count:** 16 merged PRs + this closure PR = **17 sprints / 17 PRs**.
(The originating commission's "15 PRs / 19 sprints" tally was off — see Pattern #42.)

**Migrations added this cluster:** 073 → 077 (grading_events, event_kind,
grammar_check_infra, telemetry RLS, responses partial UNIQUE).

**Backend test suite at closure:** 1824 passing (cluster-start baseline not
captured in-repo, so the "+154" delta the commission cited is unverifiable and
is omitted here).

---

## 8 user deficiencies → resolution sprint

| # | Deficiency | Resolved in |
|---|---|---|
| 1 | Grading criteria opaque / under-specified | 14.5 |
| 2 | Correction feedback too thin | 14.5 + 14.8 + 14.5.1 |
| 3 | Light-theme results unreadable | 14.1 + 14.6.1 + 14.6.5 |
| 4 | No length warning for short audio | 14.2 + 14.7 |
| 5 | No off-topic warning | 14.7 |
| 6 | Part 2 cue-card detection | 14.4 + 14.6.2 + 14.6.3 + 14.6.4 |
| 7 | Audio playback + hard reject | 14.2 |
| 8 | Grammar checker integration | 14.8 + 14.8.1 |

(The discovery pre-flight judged 5 of the 8 accurate-as-reported and 3
partially false / less severe — see `discovery.md` §2.)

---

## Codex audit (2026-05-24) — findings and resolution

The audit (`audit-reports/2026-05-24-cluster-14x-speaking-grading-enhancement.md`)
raised 7 findings by severity: 1×P0, 2×P1, 3×P2, 1×P3. It did **not** assign a
letter grade. Resolution:

| Finding | Sev | Summary | Resolved |
|---|---|---|---|
| F1 | P0 | Off-topic/length/grammar signals returned but never persisted → vanish on reload | **14.8.1** — persist `{**grading, **signals}`; render on result.html |
| F2 | P1 | `grading_events` / `grammar_check_cache` shipped without RLS | **14.8.1** — migration 076 (RLS + deny client roles) |
| F3 | P1 | Non-atomic response save, no uniqueness on `(session_id, question_id)` | **14.8.1** migration 077 (UNIQUE + dedup) + **14.8.2** atomic upsert |
| F4 | P2 | Sentinels covered immediate `practice.js` path, not persisted `result.html` | **14.8.1** added persisted-render source-scan sentinels. True browser/integration test **deferred Phase B** (repo has no jsdom/Postgres CI). |
| F5 | P2 | Grammar tests don't exercise the real LanguageTool/JRE runtime | **14.9** — `/health/grammar-check` deploy-time probe (forces LTBackend init, checks a known-bad transcript) |
| F6 | P2 | No closure artifacts; roadmap contradicts what shipped | **14.9** — this retrospective, `phase_b_backlog.md`, ledger cross-ref row, discovery reconciliation |
| F7 | P3 | "26/26 first-try CI green" not substantiated | **14.9** — reworded (below) |

### F7 — CI claim reword (honest wording)

> All required CI checks (Backend pytest + anchor drift, Frontend node --test,
> Vercel deploy, Vercel preview) were green at merge for every cluster 14.x PR.
> A "first-try-green" claim was **not** systematically measured — some PRs
> required follow-up commits, a rebase/merge to resolve a CI-list conflict, or a
> re-run before the final green merge. Systematic first-try-green measurement is
> a Phase B nicety (low priority), not a closure blocker.

---

## Pattern #42 — *Commission as hypothesis, code pre-flight is authoritative*

The defining process finding of this cluster. Plan-side commissions are
**starting hypotheses, not specs.** A mandatory code-first pre-flight verified
or corrected them before any code shipped. Across the cluster, commissions
named functions/tokens/files that did not exist, misdiagnosed root causes, and
assumed test/CI/DB infrastructure the repo does not have.

Corrections marked **✓** were verified first-hand during the relevant sprint
this session; others are corroborated by the discovery pre-flight or PR records.

| Sprint | Commission claimed | Reality (pre-flight) |
|---|---|---|
| 14.0 | 3 of the 8 deficiencies as-severe-as-reported | Partially false / less severe (discovery §2) |
| 14.1 | Light-theme bug in `result.css` | Bug in `ds.css` legacy `:root` bridge |
| 14.3 | (14.0 framing) Gemini is the grader | Production grades with Claude Haiku; Gemini is fallback |
| 14.5 | v2 structured schema | 4+ surface ripple → kept flat schema + prompt-only uplift |
| 14.6.5 ✓ | `_pronunciationBlock` / `_grammarResourcesBlock`; `--ds-text-primary/secondary` | Real: `_renderFullPronBlock`/`_renderPronBlock`/`_pronChip`/`_grammarCardHtml`; `--ds-text/muted/faint` |
| 14.6.5 ✓ | Band 5.5-vs-6.0 is a rounding bug | Raw holistic vs pronunciation-adjusted display mismatch (symmetric delta) |
| 14.5.1 ✓ | Add v3 per-criterion scoring to practice mode | Practice is coaching-format by design; adapted page to existing coaching data |
| 14.5.1 ✓ | `listening-mini-test.js` is a dead test | Live Sprint 11.5 Listening Mini Test runner; bare-`node --test` filename collision |
| 14.8.1 ✓ | jsdom integration tests; live-DB assertions | Repo CI is zero-dependency node:test + mocked Supabase (no jsdom, no Postgres) |
| 14.8.2 ✓ | Swap a `persist_response_atomic` async wrapper | No such wrapper existed; real path is a sync inline `_upsert_response` closure |
| 14.9 ✓ | 15 PRs / 19 sprints; C/C+/C/B- grade; full ledger row; 18 patterns codified; HTTP 503 health | 16 PRs / 17 sprints; audit has no letter grade; backend clusters use a ledger **cross-ref** row; no patterns registry exists in-repo; health probes return 200 + status by repo convention |

**Implication for cluster 15.x+:** keep the code-first pre-flight mandatory;
treat every commission figure as a claim to verify; log corrections openly in PR
bodies and the closure retrospective (this table) rather than quietly conforming
to the commission or inflating the record.

---

## Lessons

1. **Empirical pre-flight saves sprints** — every misdiagnosis above would have
   shipped wrong code or wasted effort without it.
2. **Sentinel coverage ≠ feature coverage.** Tests passed CI while production
   broke: CSS-only scan missed JS inline literals (→ Pattern #26, Sprint 14.6.1);
   immediate-path sentinels missed the persisted contract (→ Codex F1, Sprint
   14.8.1). Sentinels must target the surface the user actually hits.
3. **Honest scope shrinkage beats padding** — Sprint 14.5 kept a flat schema and
   deferred v2 with an explicit empirical-motivation gate (later closed by 14.5.1
   coaching aggregation, not a v2 rewrite).
4. **Production dogfood is the final sentinel** — the Codex audit + Andy's
   dogfood surfaced gaps green CI did not.
5. **Repo conventions are commission constraints.** Plan-side commissions assumed
   jsdom + Postgres CI, an async DB client, a patterns registry, and 5xx health
   probes — none of which match this repo. Future pre-flights must include a
   "verify CI/test/deploy conventions" step.
6. **Cluster closure ≠ feature complete.** Sprint 14.8 was framed as the final
   feature, but true closure needed 14.5.1 (deferred UI), 14.8.1/14.8.2 (Codex
   P0/P1), and 14.9 (artifacts + P2/P3). Future clusters should define the
   closure sprint up front in discovery, not bolt it on post-feature-ship.
7. **Migrations are a manual, ordered prod step.** Schema lands by a manual
   Supabase apply; code that depends on it (e.g. the F3 atomic upsert) must ship
   in a separate PR *after* the index is verified live (the 14.8.1 → 14.8.2 split).

---

## Cambridge descriptor sourcing — disclaimer (Phase B)

Per discovery §3 and Sprint 14.5: the grading rubric uses **paraphrased**
Cambridge / British Council band descriptors, in good faith — the same source
the production prompt has used for months. The canonical PDF was not reproduced
verbatim. A formal legal review is **deferred to Phase B** (trigger: MVP launch
+ first paying user, or pre-Series-A diligence). Not a cluster-closure blocker.

---

## Closure declaration

Cluster 14.x DEBT-SPEAKING-GRADING-QUALITY is **CLOSED** (2026-05-24):

- ✅ 8/8 user deficiencies resolved
- ✅ Codex P0/P1 resolved (F1, F2, F3)
- ✅ Codex P2/P3 resolved or explicitly deferred with rationale (F4 deferred, F5, F6, F7)
- ✅ Closure artifacts: this retrospective, `phase_b_backlog.md`, ledger cross-ref row, discovery reconciliation
- ✅ Pattern #42 codified with an evidence table
- ✅ Honest accounting (corrected counts; no fabricated grade/metrics)

See `phase_b_backlog.md` for carried-forward items and `PHASE_CLOSURE_LEDGER.md`
(backend-cluster cross-reference table) for the canonical closure row. Cluster
15.x scope is Andy's call, driven by the Phase B backlog or new user feedback.
