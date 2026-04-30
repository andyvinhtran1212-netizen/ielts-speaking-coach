# Tech Debt — IELTS Speaking Coach

**Last updated:** 2026-04-30
**Last reviewed:** 2026-04-30

Comprehensive snapshot of tech debt + improvement opportunities, restructured
2026-04-28 to track state explicitly per item rather than by priority bucket.

## Format conventions

- 🔴 **ACTIVE** — chưa làm, cần action
- 🟡 **IN PROGRESS** — đang làm
- ✅ **DONE** — completed (with date + PR ref)
- ⏸️ **DEFERRED** — known but intentionally pushed back, with reason + revisit trigger
- 🗑️ **OBSOLETE** — no longer relevant, kept here for history

Long-running historical sections (Pre-Phase-D legacy items, anti-pattern
lessons, completed phases) live near the bottom — they're stable reference
material, not active backlog.

---

## 🔴 ACTIVE — Cần action

### High priority — blocking Phase 3 strategic decision

#### HIGH-2: Phase B FP-rate dogfood session 2 not yet run
- **What:** Session 1 measured 37% FP rate against a < 10% gate.  Post-dogfood
  remediation (migration 020 + the ROUND2 audit) shipped, but session 2
  hasn't been run to verify the < 15% acceptance gate.
- **Action:** Run one full dogfood session, log issues in
  `DOGFOOD_PHASE_B_NOTES.md` (or equivalent), decide whether to expand the
  rollout or run a third remediation pass.
- **Effort:** 1–2 hours of dogfood + analysis.
- **Blocking:** Phase 3 direction decision.

#### HIGH-3: Wave 2 flashcard SRS dogfood not yet run
- **What:** SRS algorithm has 7 deterministic unit tests pinning ease-factor
  floor/cap and interval growth, but nobody has actually studied a deck for
  ≥ 5 days to feel whether the intervals match pedagogical expectation.
- **Action:** 10 cards/day for 5–7 days, log subjective "felt about right /
  too soon / too late" per rating.  Adjust the SM-2 multiplier constants in
  `services/srs.py` if needed.
- **Tools:** Admin Flashcard Stats tab (PR #18) surfaces rating distribution,
  avg ease, mastered count, top words — point at these during dogfood.
- **Effort:** ~30 min/day × 5 days.
- **Blocking:** Phase 3 direction decision.

#### HIGH-4: Phase 3 strategic decision
- **What:** With Phase 2.5 dogfood instrumentation complete, the next big
  build needs a direction.  Five candidates on the table:
  1. Quick chatbot MVP (Speaking-style conversation practice).
  2. Mock test feature (full IELTS Speaking simulation).
  3. Reading / Listening module.
  4. Audio + image flashcards.
  5. SRS algorithm tuning based on dogfood data.
- **Decision criteria:** Dogfood findings (HIGH-2 + HIGH-3) + any user
  signal we've collected.
- **Effort:** 1–2 days planning once data is in.
- **Blocked by:** HIGH-2 + HIGH-3.

### Medium priority

#### MED-3: D1 admin generate-batch progress polling
- **What:** D1 admin generate-batch is a fire-and-forget background task; the
  frontend currently refreshes manually to see results.  For 60-word batches
  the admin sometimes refreshes too early and thinks nothing happened.
- **Action:** Add `GET /admin/exercises/d1/generate-batch/{job_id}/status`
  + a small polling loop on the admin page.  The job_id format already
  exists from the Wave 2 backfill endpoint pattern.
- **Effort:** 2–3 hours.
- **Defer until:** Admin UX pain point reported again — current workaround
  (manual refresh) is annoying but functional.

#### MED-4: Legacy vocab without topic — orphan classification UX
- **What:** Migration 028 backfilled `user_vocabulary.topic` from
  `sessions.topic`, but vocab manually added (or whose session itself had
  no topic) stays NULL forever.  The "Chưa phân loại" bucket catches them
  in flashcard filters (PR #11), but there's no flow for the user to
  actually classify them.
- **Action:** Add a "Classify topic" inline editor on each card row in My
  Vocabulary.  Drop-down of distinct topics + free-text fallback.
  PATCH /api/vocabulary/bank/{id} already accepts arbitrary fields.
- **Effort:** 4–6 hours including the small pick-list endpoint.
- **Defer until:** Quantify impact — count vocab with topic NULL.

### Low priority

#### LOW-2: Tailwind CDN in production
- **What:** `cdn.tailwindcss.com` logs a console warning in production.
  Acceptable for the current project size; a real PostCSS pipeline isn't
  worth the maintenance cost yet.
- **Action:** Defer — revisit when frontend grows past ~10 pages OR when
  Lighthouse perf scores demand it.
- **Effort:** 4–6 hours when chosen.

#### LOW-5: Local-only backup script
- **What:** `backend/scripts/backup_production.sh` runs nightly at 03:00
  via launchd, but only when the Mac is on.  Skips silently if the laptop
  is sleeping.
- **Action:** Defer — when stronger guarantees are needed, switch to remote
  backup target (S3 / GCS) or use Supabase's own scheduled backup feature.
- **Effort:** 2–3 hours when chosen.

---

## 🟡 IN PROGRESS

(none currently — Phase 2.5 Day 2 wraps with this PR)

---

## ⏸️ DEFERRED — Roadmap

### Security hardening (Phase 3 prerequisite)

#### HIGH-1: Legacy router security model drift (DEFERRED)

**Status:** ⏸️ DEFERRED to dedicated security sprint (Phase 3 prerequisite)

**Original framing (Codex audit 2026-04-30):**
Convert sessions.py + responses.py + pronunciation.py to JWT-scoped clients,
add WITH CHECK to RLS UPDATE policies.

**Reality discovered (Claude Code investigation 2026-04-30):**
1. sessions + responses tables have NO RLS policies at all (predate
   RLS-everywhere convention)
2. Migration 031 spec was wrong — would need to INTRODUCE RLS from scratch
   on populated production tables (high blast radius)
3. responses.py is dead code per its own docstring (responses.py:6-11).
   Production grading lives in grading.py
4. Same supabase_admin-after-JWT pattern in: grading.py, questions.py,
   exercises.py, grammar.py, analytics.py, export.py — scope much larger
   than 3 named files

**True scope:**
- 8+ routers need conversion
- Multiple tables need RLS introduction (sessions, responses, pronunciation
  scores, plus any orphan tables)
- Migration touches populated production data
- Estimate: 1-2 week dedicated sprint

**Blocking factors:**
1. Need staging access for migration verification with production-shaped data
2. Need bucket policy review for audio-responses storage
3. Need decision: which legacy tables truly need RLS vs deprecation candidates
4. Need full router inventory for supabase_admin usage

**When to address:**
- After Phase 2.5 dogfood completes
- Before Phase 3 user growth (current solo dogfood = low real-world risk)
- As prerequisite hardening sprint to Phase 3 launch

**Mitigation in interim:**
- Application-layer ownership filters in all affected routes (already in place)
- JWT validation on all routes (already in place)
- Admin role check on admin routes (already in place)
- No known active exploit vector

**References:**
- Codex audit 2026-04-30 finding HIGH-1
- Claude Code investigation 2026-04-30 (this session)
- responses.py:6-11 (dead code confirmation)
- CLAUDE.md (production grading pipeline location)

### Phase E (post Phase 3)

#### D3 — Speak-with-target
- **From:** Original Phase D Wave 2 plan, pivoted to Flashcards.
- **Why deferred:** Cost ~$190/mo at production speaking volume vs $0 for
  flashcards; SRS retention better than session-based speaking practice
  given current scale.
- **When to revisit:** After user-base traction + budget allows, OR after
  a pricing tier / quota model is in place.
- **Effort:** 1 week to ship; pricing decision is a separate workstream.

#### NTH-1: Audio pronunciation on flashcards
- IPA text is good; an actual TTS playback button would be better.  Reuse
  the Google Cloud TTS service already wired for sample answers.
- **Why deferred:** TTS cost + integration complexity vs marginal benefit.
- **When:** After dogfood (HIGH-3) confirms IPA text is insufficient.
- **Effort:** 1–2 days.

#### NTH-2: Image flashcards
- Visual learning aid for concrete nouns / scenes.  Adds a media layer to
  `user_vocabulary` and a render path on the back face.
- **Why deferred:** Storage cost + image-quality / -copyright issues.
- **When:** Phase F+ if user request signals it.
- **Effort:** 2–3 days.

#### NTH-3: Streak heatmap (Duolingo-style)
- Daily activity visualisation drawn from `flashcard_review_log` (already
  populated by every review).
- **Why deferred:** Need ≥ 1 month of usage data first to make the heatmap
  show something interesting.
- **When:** After 1+ month of dogfood.
- **Effort:** 1–2 days.

#### NTH-4: Anki export / import
- Power-user request; Anki CSV format is well-documented.
- **Why deferred:** Niche audience.  Vocab CSV export shipped in PR #19
  covers the basic backup case.
- **When:** Explicit user request.
- **Effort:** 1 day.

#### NTH-6: Reading + Listening modules
- Would reuse vocab bank + flashcard infrastructure.  Each module is its
  own ~2–3 weeks of design + build.
- **Why deferred:** Speaking core not yet validated by external users.
- **When:** Phase F+ after Phase 3 chatbot or mock test ships.

#### NTH-7: Mobile native apps
- Mobile web works today but has no push notifications.  React Native
  would be the obvious port.
- **Why deferred:** Web mobile-friendly enough for now; need
  product-market fit first.
- **When:** Have PMF + need push notifications.
- **Effort:** 1–2 months.

### Process improvements (apply ongoing)

#### PROC-3: Codex-audit recurring patterns → pre-commit hooks
- **Background:** 8/10 audits found ≥ 1 finding (mostly MEDIUM).  Recurring
  mechanical patterns:
  - RLS WITH CHECK missing on UPDATE policy.
  - Hardcoded URL fallback in frontend.
  - Cross-file forgot-update (frontend entry point missed when a backend
    field was added — needs human review, can't easily automate).
- **Action:** Add pre-commit hooks for the mechanical ones.
- **Effort:** 1–2 hours.
- **Defer until:** Friction with manual audit grows; current cadence
  (1 audit per major wave) is sustainable.

#### PROC-4: Live test infrastructure pays back
- **Background:** Phase B + Wave 1 + Wave 2 all shipped a setup script +
  2-JWT live RLS tests on day 1, before feature code.  Cost ~1 day per
  wave; benefit is 0 RLS bugs in production across three feature rollouts.
- **Status:** Established norm.  Continue — don't let a future wave skip
  this even under deadline pressure.

---

## 🗑️ OBSOLETE

(empty — items here are kept for history when they become irrelevant)

---

## ✅ Completed

### Phase 2.5 Day 2 — 2026-04-28 (5 PRs)

**Schema-correctness wins (template Rule 1):**
The new prompt templates (PR #17) made schema verification mandatory before
referencing any column.  In a single day this caught **5 schema mismatches**
in incoming specs before any code was written:
- `flashcard_review_log.created_at` → `reviewed_at` (PR #18)
- `sessions.created_at` → `started_at` (PR #19)
- `sessions.band_score` → `overall_band` (PR #19)
- `/api/vocabulary` URL prefix → `/api/vocabulary/bank` (PR #19)
- `Depends(_user_sb)` → plain function `_user_sb(token)` (PR #19)

**Code quality:**
- ✅ **HIGH-1: Idiom enrichment edge case fixed** (PR #16)
  - Updated Gemini system prompt to explicitly handle multi-word
    collocations and idioms; added `_SYSTEM_PROMPT_SIMPLE` retry path
    when a chunk drops some words.
  - Verified by 20/20 unit tests + production backfill (17/18 → 18/18
    after the fix shipped).
- ✅ **MED-2: Live RLS test extend cards + reviews** (PR #16)
  - Added `test_with_check_blocks_review_user_id_reassignment` (cards +
    reviews coverage was already in main from earlier Wave-2 work).
  - 7 → 8 RLS tests pass live against staging.
- ✅ **LOW-1: Hardcoded URL fallback sweep** (PR #16)
  - Removed dead localhost/Railway fallbacks in `frontend/js/vocabulary.js`
    and `frontend/pages/result.html`'s `_pollVocabToast`.
  - `api.js` is the single source of truth for `window.api.base`.
- ✅ **MED-1: Topic IS NULL filter UX verification** (PR #17)
  - Verified the `__uncategorized__` sentinel + frontend chip "📂 Chưa
    phân loại" already shipped in main (audit Wave 2 fix); 4 backend
    tests cover the split / normalize / apply paths.  No code change
    required — flagged as already-done after schema-verification step.

**Process:**
- ✅ **PROC-1: Antigravity + Claude Code + Codex prompt templates** (PR #17)
  - 3 templates in `docs/templates/` with the four-stage Plan / Execute /
    Audit / Deploy workflow codified.
  - Schema-verification rule lives at Rule 1 of the Antigravity template.
  - Validated in PR #18 + #19 — caught 5 schema mismatches early (see
    above).  Cost saved: ~1 round-trip per future plan.

**Infrastructure:**
- ✅ **NEW: Health check endpoints** (PR #17)
  - `GET /health` — fast liveness probe (no DB, ~ instant).
  - `GET /health/ready` — comprehensive: DB connectivity, critical-table
    presence (proxy for "migrations applied"), Gemini API key, feature
    flags.  Always returns HTTP 200; per-check status carries the verdict.
  - 5 offline tests; DEPLOY_CHECKLIST has a universal verification block.

**Admin tooling:**
- ✅ **NEW: Flashcard Stats admin tab** (PR #18)
  - Activity overview (manual stacks / cards / active users / lifetime
    reviews).
  - SRS health visualization (rating distribution reconciled to exactly
    100.0%, avg ease factor, mastered ≥ 30d, lapsed cards).
  - Engagement (avg reviews/user 7d, avg DAU period, top-10 reviewed
    words with headwords resolved).
  - 30-day timeseries chart with missing-day fill.
  - Period selector 7 / 30 / 90 days.
  - 6 offline tests, 22 regression tests pass alongside.

**User-facing:**
- ✅ **NEW: Vocab CSV / JSON export** (PR #19)
  - `GET /api/vocabulary/bank/export?format=csv|json` — CSV with UTF-8
    BOM (Excel + Vietnamese diacritics), JSON shape
    `{exported_at, total_count, vocabulary[]}`.
  - Includes archived rows (lossless backup).
  - Default-deny feature-flag gate respected.
  - 8 offline tests; route registered before `/{vocab_id}` to avoid the
    dynamic-param route swallowing `/export` (regression-pinned).
- ✅ **NEW: Session search / filter / sort / pagination** (PR #19)
  - `GET /sessions` extended with `search`, `sort`, `date_from`, `date_to`,
    `page`, `page_size` — all optional.  Existing `status` / `part` /
    `limit` still work.
  - Dual-shape contract: bare list when no new params (legacy
    backwards-compat), paginated dict the moment any new param is set.
    Dashboard's existing `/sessions?limit=200` call is byte-identical.
  - Sort directions resolve to `started_at` and `overall_band` (the
    canonical schema columns).
  - Frontend extended on dashboard's existing history section (Option 1:
    no new page, no nav rework).  Search debounced 400 ms; date inputs
    apply on click; pagination hidden when total_pages ≤ 1.
  - 18 offline tests with recording stub pin every PostgREST builder call.

**Stats — 2026-04-28:**
- 5 PRs merged (#15 → #19)
- 28 commits
- ~50 new tests added (20 enrichment + 1 RLS + 5 health + 6 admin stats +
  8 vocab export + 18 sessions)
- 194 backend tests collected (was ~120 pre-Phase-2.5)
- Page parity OK across 4 pages
- 0 production fires

### Phase 2.5 Day 1 — 2026-04-27

**Security (no PR — process / dashboard work):**
- ✅ **CRIT-1: DB password rotated** — production + staging Supabase
  passwords reset; backup script + Railway redeploy verified.
- ✅ **CRIT-2: JWT exposure** — process norm established: only paste
  first/last 20 chars of a JWT for debugging, never the full token.

**UX / cosmetic (PR #15):**
- ✅ **LOW-3: favicon.ico 404** — added `frontend/favicon.svg` +
  `<link rel="icon">` in every HTML page.
- ✅ **LOW-4: AUDIT_*.md cluttering repo root** — moved to `docs/audits/`
  with `git mv` (history preserved).

### Phase D Wave 2 + Rich Content — 2026-04-27

(see git history + previous AUDIT files in `docs/audits/`)

**Major shipments:**
- Flashcard System with SRS (4 migrations: 025–028, 12 endpoints, 2 pages).
- Wave 2 audit fixes (3 findings, PR #11).
- Wave 2 UX polish (transcript hide, optimistic UI, no-flip-required).
- Flashcard Rich Content (IPA + AI examples, migration 029).

### Phase D Wave 1 + D1 Session Redesign — 2026-04-26

**Major shipments:**
- D1 Fill-blank exercises with admin generation.
- D1 batch chunking fix (60-word generate).
- D1 Session-based redesign (4 UX issues fixed).

### Phase B — 2026-04-22 to 04-25

**Major shipments:**
- Personal Vocab Bank with AI extraction.
- Admin monitoring dashboard.
- 3 audit rounds + post-dogfood fixes.

---

## 📊 Health metrics — snapshot 2026-04-30

For the cumulative snapshot, see the comprehensive production audit
captured 2026-04-30.  Coverage baseline lives at
`docs/audits/COVERAGE_BASELINE_2026-04-30.md`.

**Code:**
- Backend tests: **254 collected** (239 passed, 15 env-gated live-RLS skips
  without staging creds in CI environment).
- Coverage baseline: **50% overall** (first formal capture; details in
  `docs/audits/COVERAGE_BASELINE_2026-04-30.md`).
- Page parity: 4 pages checked, all OK; `frontend/pages/d3-exercise.html`
  intentionally skipped (deferred to Phase E).
- Migrations applied production: **001–031** (031 codifies the
  `ai_usage_logs` schema that previously lived only in
  `services/ai_usage_logger.py` comments).
- Live RLS tests: **8 pass live** (no skips when staging creds present).

**Production posture (2026-04-30):**
- Overall: **WARNING** — HIGH-1 deferred to dedicated security sprint
  (legacy `sessions`/`responses` tables have no RLS yet; mitigated by
  app-layer ownership filters + JWT validation; no known active exploit
  vector).
- Tech debt level: **MEDIUM**.
- Ready for Phase 3: **WITH FIXES** — HIGH-1 hardening is a Phase 3
  prerequisite.

**Production:**
- Vercel: deployed latest, status Ready.
- Railway: deployed, `/health` returns OK; `/health/ready` all-checks OK.
- Supabase: vocab enrichment partial — 12/36 `used_well` and 6/14
  `needs_review` rows missing `definition_vi/_en` at audit time
  (MEDIUM-2, backfill rerun pending).
- Backup: daily 03:00 via launchd, ~13 MB dumps.

**Dogfood data — gaps:**
- Phase B FP rate: not yet measured Session 2 (HIGH-2).
- Wave 2 SRS feel: not yet measured (HIGH-3).
- Engagement metrics: minimal (1 active user = self).

**Cost (current):**
- Gemini API: ~$5–10/mo estimate (low usage).
- Supabase: free tier.
- Railway: free tier.
- Vercel: free tier.
- **Total: ~$5–10/mo.**

---

## 🎯 Next decisions needed

1. **Phase 3 direction** (after Phase 2.5 dogfood — HIGH-2 + HIGH-3)
   - Quick chatbot vs Mock test vs Reading module vs Audio cards vs
     SRS tuning.
   - Decision criteria: dogfood pain points + user requests.

2. **Beta user recruitment** (timing)
   - Currently solo dev only.
   - Risk: design without real user feedback.
   - Approach: 5–10 beta users after Phase 3 ships.

3. **AI model strategy long-term**
   - Currently: Gemini Flash for all AI tasks.
   - Alternative: Gemma self-host (defer ~6 months).
   - Decision criteria: cost > $50/mo OR latency issues.

---

## Anti-pattern lessons (cumulative across phases)

These are codified into all Claude Code prompt templates today; listing them
here so a new collaborator can skim the prior-art:

1. **Fix hẹp** — Claude Code consistently fixes only the files mentioned in
   the prompt.  Always include an explicit "grep for X across the repo" step
   when adding a UI element / config / field.
2. **Migration always manual** — auto-deploy never touches the DB.  Backup
   → migrate → deploy in that exact order.
3. **Live test infra from day 1** — setup script + RLS tests ship in the
   first commit of a wave, before feature code.
4. **Audit ≠ dogfood** — audit catches correctness, dogfood catches UX.
   Wave 2 was clean on audit Round 1 and still surfaced 3 UX issues during
   the first day of dogfood.
5. **Symptoms ≠ root causes** — two independent bugs can produce the same
   symptom; resist the urge to ship a single fix that just silences the
   symptom.
6. **Page template parity** — every new page must carry the Supabase CDN +
   api.js + initSupabase trio.  `verify_page_parity.sh` enforces.
7. **Default-deny feature flags** — strict `is True` / `=== true` on both
   server and client; exception → False; default OFF in env.
8. **Service role only in admin / background** — user-facing routes use a
   JWT-scoped client.  RLS is the security layer; service-role bypasses it.
9. **Plans must verify schema before referencing a column** (PROC-1; added
   after Wave 2's `topic` red flag — has now caught 5 more in PR #18 + #19).
10. **RLS UPDATE policies need both USING and WITH CHECK** (added after
    Phase B's 019b fix).
11. **No hardcoded URLs in frontend** — every fetch routes through
    `window.api.base` (added after Wave 2 audit found the dead
    `my-vocabulary.js` fallback).
12. **Route ordering: specific paths before dynamic params** — added 2026-04-28
    after the `/api/vocabulary/bank/export` near-miss (`/{vocab_id}` would
    have swallowed it if registered later).
13. **List-endpoint trailing slash on the client** — added 2026-04-30
    after PR #25's triage fetch broke in production.  Routes registered as
    `@router.get("/")` on a prefix require the client URL to end with `/`.
    Without it FastAPI's `redirect_slashes=True` returns a 307; behind
    Railway's proxy that 307 carries `scheme=http`, which (a) drops the
    `Authorization` header on the cross-scheme follow and (b) is blocked
    by the browser as Mixed Content.  Codex audit grep:
    `grep -rn "fetch.*api/.*[a-z]\?" frontend/ --include="*.js"` should
    return no list-endpoint hits without a trailing slash before `?`.

---

## Pre-Phase D legacy items

These items predate Phase D and were tracked in the previous
`TECH_DEBT_BACKLOG.md`.  Folded in here so we have one debt doc, not two;
statuses preserved as-of the prior file.

### LEG-1: Full-test recovery after timeout *(High at the time)*
- `_bg_finalize_full_test()` has a grace period but isn't truly self-healing
  if grading finishes after the timeout window.  A slow full test can land
  in `analysis_failed` and need manual admin recovery.
- Suggested fix: safe re-finalize path for `submitted` / `analysis_failed`
  full-test sessions once all responses are graded; prefer automatic retry
  over manual repair.

### LEG-2: Token accumulation not atomic *(Medium)*
- `sessions.tokens_used` is additive but uses a read-then-write pattern.
  Concurrent grading can lose increments.
- Suggested fix: atomic DB-side increment, OR document tokens_used as
  approximate.

### LEG-3: Grammar `compare_with` graph is asymmetric *(Medium)*
- Slug validity is fine; many `compare_with` relationships are still one-way.
- Suggested fix: content-integrity pass for reciprocal relationships, or
  decide that asymmetry is intentional.

### LEG-4: Grammar saved/viewed slug validation *(Medium)*
- `grammar_user_data` rows can accept arbitrary slugs without verifying
  article existence.  Orphan rows accumulate when slugs change.
- Suggested fix: validate at write time, or add a periodic cleanup.

### LEG-5: Legacy `responses.py` router *(Medium)*
- Audio-only response flow believed obsolete; final removal / quarantine
  decision pending.
- Suggested fix: confirm no production path depends on it, then remove or
  quarantine.

### LEG-6: Admin regrade / rebuild semantics *(Low–Medium)*
- Admin flows are honest, but naming and UX could be clearer about the
  difference between a full regrade, a partial repair, and a rebuild summary.
- Suggested fix: tighten admin labels, surface partial-failure states
  explicitly.

### LEG-7: Result pipeline readiness / recovery unification *(Low–Medium)*
- Readiness, completion, and recovery semantics work but some paths are
  practical rather than elegant.
- Suggested fix: centralise finalisation/recovery; keep all UI surfaces
  reading canonical `sessions.*` truth only.

### LEG-8: Grammar metadata pedagogy pass *(Low)*
- Metadata is structurally usable but not perfect.  Some pathways are broad;
  some `next_articles` are "related" rather than true next steps.
- Suggested fix: a future refinement focused on pedagogy, not structural
  correctness.

### LEG-9: Vocab + Grammar content loaders are separate copies *(Low — intentional)*
- `services/vocab_content.py` is a hand-adapted copy of
  `services/grammar_content.py`.  Parsing logic must be updated in two
  places.
- Suggested fix: extract a shared `BaseContentService`.  Phase B was the
  right time; can still happen any quiet refactor sprint.

### LEG-10: Phase B follow-ups *(Low)*
- Make `backend/scripts/setup_phase_b_test_env.sh` more ergonomic / fail-fast.
- Improve repeatability of staging / live verification workflow.
- Polish analytics + cost-observability for vocab extraction.
- Review CI path for staging-backed RLS checks.
- Clean up pytest async loop-scope warning (also visible in
  vocab-enrichment test runs).
- Review Supabase client deprecation warnings (`timeout`, `verify`).
