# DEBT-ADMIN-IA-REFACTOR — Cluster Closure Retrospective

**Status:** CLOSED on Sprint 12.8 merge
**Cluster span:** Sprint 12.0 → 12.8 (8 sprints + 1 hotfix = 9 PRs)
**Branch model:** branch-per-sprint, PR each with full CI green before merge

---

## What we shipped

The DEBT-ADMIN-IA-REFACTOR cluster carved the 3,151-line `frontend/admin.html`
monolith into a unified Information Architecture under `/pages/admin/`. After
closure, `admin.html` is a 91-LOC pure redirect.

### Sprint roll-up

| Sprint | PR  | Branch                                       | Outcome |
|--------|-----|----------------------------------------------|---------|
| 12.0   | #217 | `sprint-12-0-admin-discovery`               | Discovery doc + IA proposal |
| 12.1   | #218 | `sprint-12-1-admin-sidebar-shell`           | `<aver-admin-chrome>` + 13 page moves + redirects |
| 12.2   | #220 | `sprint-12-2-cohort-access-codes-fold-ins`  | Cohort schema (Migration 060) + Access Codes carve (Migration 062) + 4 audit fold-ins |
| 12.3   | #221 | `sprint-12-3-error-logs`                    | Error logs schema (Migration 061) + capture pipeline + admin viewer |
| 12.3.1 | #222 | `sprint-12-3-1-onerror-capture-hotfix`      | Falsification #82 — error reporter onerror silent-swallow fix |
| 12.4   | #223 | `sprint-12-4-overview-dashboard`            | Tổng quan dashboard with cross-module aggregator |
| 12.5   | #224 | `sprint-12-5-speaking-extract`              | Speaking carve (Sessions + Topics) |
| 12.6   | #225 | `sprint-12-6-vocab-admin`                   | Vocab carve + brand-new D1 Curation + Lemma Overrides (Migration 063) |
| 12.7   | #226 | `sprint-12-7-grammar-admin`                 | Grammar admin (read-only hybrid file-based) + recommendation tester |
| 12.8   | #227 | `sprint-12-8-cluster-closure`               | Final monolith carve (AI usage + Alerts + Vocab Exercises) + Users role mgmt + admin.html → pure redirect |

### What lives where now

| Surface | Before (admin.html section) | After (new IA path) |
|---|---|---|
| Sessions Speaking | `panel-sessions` | `/pages/admin/speaking/sessions.html` |
| Topics + Questions | `panel-topics` | `/pages/admin/speaking/topics.html` |
| Access Codes | `panel-codes` | `/pages/admin/access-codes/index.html` |
| Vocab Bank stats + flag | `panel-vocab_monitor` | `/pages/admin/vocab/stats.html` |
| Flashcards stats | `panel-flashcards` | `/pages/admin/vocab/stats.html` (merged) |
| D1 admin pool review | `panel-vocab_exercises` | `/pages/admin/vocab/exercises.html` |
| Personalized D1 | (no UI) | `/pages/admin/vocab/d1-curation.html` (NEW) |
| Lemma overrides | (no UI) | `/pages/admin/vocab/lemmas.html` (NEW) |
| Grammar articles | (no UI) | `/pages/admin/grammar/articles.html` (NEW) |
| Grammar analytics | (no UI) | `/pages/admin/grammar/analytics.html` (NEW) |
| Grammar matcher dogfood | (no UI) | `/pages/admin/grammar/recommend-test.html` (NEW) |
| AI Usage | `panel-ai_usage` | `/pages/admin/system/ai-usage.html` |
| Alerts | `panel-alerts` | `/pages/admin/system/alerts.html` |
| Error Logs | (limited UI) | `/pages/admin/error-logs/index.html` |
| Users + role mgmt | `panel-users` | `/pages/admin/users/index.html` (PATCH /admin/users/{id}/role NEW) |

---

## Wins

### Engineering

- **All 9 PRs merged with green required checks.** Every closure
  required backend pytest + frontend node:test + Vercel preview +
  preview-comments all green before merge. No skipped suites, no
  `--no-verify`, no amend-on-amend hot patches. The four required
  checks across nine merged PRs is the reproducible figure; cite that
  shape rather than a single composite number when auditing.

  **Count methodology** (per Codex audit 2026-05-19 §31): "CI checks"
  = the four required workflows GitHub reports on each PR's
  `statusCheckRollup` (`Backend (pytest + anchor drift)` ·
  `Frontend (node --test)` · `Vercel` · `Vercel Preview Comments`).
  "PRs" = the 9 merged into `main`: #217, #218, #220, #221, #222 (12.3.1
  hotfix), #223, #224, #225, #226, #227. Skip presence verified locally
  by greppimg the relevant `*.test.mjs` files for `.skip` markers (0
  matches across all 19 frontend test files in the cluster's add/edit
  set). Anyone reproducing this should pull the PR list and call
  `gh pr view <N> --json statusCheckRollup` per PR — that's the source
  the figure quotes.

- **Carve pattern locked in by Sprint 12.5.** After Speaking, the recipe
  ran: read panel markup, copy JS to a module file with `window.api`
  wiring + DOM null-guards in the dead JS, write the new IA HTML with
  shadow-DOM chrome, replace the panel markup with a migration banner.
  Sprint 12.6 and 12.7 each shipped in roughly one session because the
  pattern was clear.

- **Test count delta visible at every step.** Each carve sprint added
  +25–30 sentinels, the ID baseline on `admin-monolith-redesign.test.mjs`
  ticked down each time, and the "still-monolith panels" regression
  block confirmed the carve was scoped. The closure dropped the file
  size from ~3,151 → 91 LOC (97% reduction) without touching a single
  unrelated test.

- **Pure helpers became the testable surface.** `lemmatize()`,
  `_filter_false_article_flags`, `find_best_match`, etc. — the patterns
  Sprint 10+11 established (no I/O in the inner function, monkeypatch
  the loader) carried straight into Sprint 12 admin endpoints (D1
  list/PATCH/DELETE, lemma override CRUD with `reload_overrides()` hot
  reload).

### Product

- **Read-only admin pattern (Sprint 12.7).** The hybrid file-based
  Grammar surface proved the cluster can ship "monitor + dogfood
  without CRUD" surfaces without compromising the IA. Useful template
  for future docs/content surfaces.

- **New admin surfaces (zero before, three after).** D1 Curation,
  Lemma Overrides, Grammar Recommendation Tester — three tools that
  did not exist pre-cluster. Each addresses a measurable monitoring
  gap (D1 review for fallback_evidence rows; lemmatizer mismaps;
  recommendation quality preview).

- **Tổng quan dashboard (Sprint 12.4) replaced 11 link-cards with 4
  stat tiles + 5 skill cards + activity feed.** All five skill cards
  now LIVE (Speaking + Writing + Listening + Vocab + Grammar).
  Phase-B placeholders shrank from 5 → 2 (cohorts + usage logs only).

---

## Lessons

### Bare catch swallows (Sprint 12.3.1 hotfix)

`error-reporter.js` shipped in Sprint 12.3 with two compounding bare-
catch swallows: a missing `.catch()` on `_getAuthToken()` and an empty
`catch {}` inside `reportError()`. Tester01 dogfood Falsification #82
caught it. Fix: defensive `.catch()` chains plus `console.error`
breadcrumbs on every previously-silent path so the next swallow is
visible in dev tools. **Going forward:** any new "fire-and-forget"
async work in the error reporter must carry an explicit `.catch()` with
a breadcrumb log. Pre-merge audit checks for `}\s*catch\s*\{\s*\}` and
unresolved promise expressions.

### Test count delta verification

Sprint 12.4 admin-monolith-redesign test broke after the overview
redesign because the Sprint-12.1 baseline pinned 11 link-cards. The
audit found it because we expected `tests.passed` to *grow* by the
sentinel count we added. Going forward: every sprint reports
"before / after" sentinel counts in the PR description and verifies
the delta matches.

### Mid-cluster audit pattern

The Sprint 12.2 audit caught 4 issues (F1–F4) before they shipped to
prod by treating the in-progress carve as if it were an external
contractor's PR. Replicating the same external-review pose on Sprints
12.5–12.8 would have caught the "Sprint 12.6 commission overstated the
vocab_exercises carve" mismatch before commit. Next cluster: budget
one audit pass per 2 carves.

### Inventory + commission gap

Commissions over-specify when they prescribe the surface AND the
endpoint shape. Sprint 12.6's commission asked for "D1 curation +
Lemma overrides + Vocab Exercises carve" but vocab_exercises is a
distinct surface from personalized D1. We deferred vocab_exercises to
Sprint 12.8 (correct call) but the commission language created
friction. Next cluster: commissions name the *outcome* + the
*concrete monolith section* — Code derives the endpoint shape during
pre-flight.

---

## Phase B trigger criteria

The 2 remaining placeholder sections plus several Phase B candidates
have explicit triggers documented in
`docs/sprint-12-b-phase-b-triggers.md`.

Summary of triggers:

- **Cohort management UI** — fires when Andy needs to manage ≥5 cohorts
  without SQL.
- **Usage logs page** — fires when access-code abuse / quota incidents
  hit ≥1/month.
- **Instructor role split** (`require_instructor` guard) — fires when
  first non-Andy instructor onboards.
- **Mobile responsive polish** — fires when admin-on-phone usage > 20%
  in 30d.
- **Admin-side analytics for content tuning** — fires when content
  library > 50 items.

Until a trigger fires, **do not ship.**

---

## What's next

Cluster CLOSED. Recommended next directions (per acceptance criteria
post-merge action):

1. **Phase B triggers track** — wait-and-watch; ship on signal.
2. **Commercial launch prep** — Stripe webhook + email verification +
   SEO landing pages. The new admin IA gives us the cohort/code/user
   visibility a real launch demands.
3. **Vocab AI quality DEBT** — the brand-new D1 Curation page surfaces
   `fallback_evidence` rows where Haiku failed. Use the data to tune
   the D1 generation prompt; expect ~10% improvement in match quality.

The right next cluster is whichever moves the user-facing product
forward fastest. Admin IA is no longer a bottleneck.
