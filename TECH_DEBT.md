# Tech Debt — IELTS Speaking Coach

**Last updated:** 2026-05-01
**Last reviewed:** 2026-05-01

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

> HIGH-2 (Phase B FP rate Session 2) moved to **✅ Completed → Phase 2.5
> Day 3** below.  Session 2 ran during the Combo Dogfood Day 2 cycle and
> the four MEDIUM issues that surfaced were addressed in PR #22.

#### HIGH-3: Wave 2 flashcard SRS dogfood — Day 2-4 pending
- **What:** SRS algorithm has 7 deterministic unit tests pinning ease-factor
  floor/cap and interval growth, and **Day 1** dogfood ran 2026-04-29 →
  surfaced 6 issues addressed in PR #25 + #28 + #29.  Days 2-4 (subjective
  "intervals match pedagogical expectation?" feel-test) still pending now
  that the UX is clean.
- **Action:** ~30 min/day × 3 days against the post-PR-#29 build, log
  subjective "felt about right / too soon / too late" per rating.  Adjust
  the SM-2 multiplier constants in `services/srs.py` if needed.
- **Tools:** Admin Flashcard Stats tab (PR #18) surfaces rating distribution,
  avg ease, mastered count, top words — point at these during dogfood.
- **Healthy benchmark:** Again 10–20%, Hard 20–30%, Good 40–50%, Easy 10–20%.
- **Effort:** ~30 min/day × 3 days.
- **Blocking:** Phase 3 direction decision.

#### HIGH-4: Phase 3 strategic decision
- **What:** With Phase 2.5 dogfood instrumentation complete, the next big
  build needs a direction.  Five candidates on the table:
  1. Quick chatbot MVP (Speaking-style conversation practice).
  2. Mock test feature (full IELTS Speaking simulation).
  3. Reading / Listening module.
  4. Audio + image flashcards.
  5. SRS algorithm tuning based on dogfood data.
- **Decision criteria:** Dogfood findings (HIGH-3 Days 2-4 + HIGH-5
  baseline metrics) + any user signal collected.
- **Effort:** 1–2 days planning once data is in.
- **Blocked by:** HIGH-3 Days 2-4 + HIGH-5.

#### HIGH-5: Baseline metrics not yet documented
- **What:** Coverage baseline shipped in PR #31 (50% overall) but
  product-level baseline metrics have never been captured.  Phase 3
  decision making + post-Phase-3 comparison both need a "what does
  healthy look like at solo-dev scale today?" reference doc.
- **Action:** Capture SRS distribution per user (after HIGH-3 Day 4),
  API latency p95 from Railway logs, Gemini cost / active user / month,
  vocab enrichment success rate, DAU.
- **Effort:** ~1 day write-up + analysis once Days 2-4 dogfood data is in.
- **Output:** `docs/audits/BASELINE_METRICS_2026-05.md`.
- **Blocked by:** HIGH-3 Days 2-4.

### Medium priority

#### MED-2: Vocab enrichment backfill incomplete (audit MEDIUM-2)
- **What:** Audit 2026-04-30 sampled live data and found 12 of 36 `used_well`
  rows and 6 of 14 `needs_review` rows were missing `definition_vi`/`_en`
  (one row each missing IPA / `example_sentence`).  PR #16 + PR #25 ran
  enrichment passes, but rows added afterward, or chunks where Gemini
  returned partial output, didn't get re-touched.
- **Action:** Hit `POST /admin/vocab/backfill-enrichment?limit=50` with an
  admin JWT, then re-query the missing-field counts.  If a residue
  remains, inspect `ai_usage_logs` for Gemini errors and decide whether
  to extend the simpler-prompt retry path.
- **Effort:** ~30 minutes (run + verify) once an admin JWT is at hand.
- **Blocked by:** Need admin JWT (rotates) + production access — Claude
  Code session can't drive this directly.

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

#### LOW-6: No dedicated live route test for `/mark-fixed` (and `/accept`)
- **From:** PR #25 Codex audit + PR #28 Codex audit + Combo Dogfood Day 2
  audit (the same finding surfaced in three consecutive reviews).
- **What:** `test_vocab_mark_fixed.py` and the `/accept` test cover the
  handler offline; live `user_vocabulary` RLS regression tests cover the
  underlying table.  No route-specific live test analogous to
  `test_mark_fixed_rls_scoped` exists yet, so there's no pinned guarantee
  that user B can't mutate user A's row through the route under live RLS.
- **Action:** Add one staging test per route that calls the endpoint as
  user A and asserts user B cannot observe or mutate the resulting row.
- **Effort:** ~1 hour when picked up.
- **Defer until:** HIGH-1 security sprint folds it in (cheaper to do
  alongside the broader live-RLS coverage rebuild).

#### LOW-7: `recent-updates` lacks composite `(user_id, created_at DESC)` index
- **From:** Combo Dogfood Day 2 audit.
- **What:** `GET /api/vocabulary/bank/recent-updates` orders by
  `created_at DESC` after filtering by `user_id`.  Existing indexes
  (`idx_user_vocab_user`, `idx_user_vocab_user_status`, unique headword)
  don't fully cover the order-by; PostgreSQL falls back to an in-memory
  sort.
- **Impact:** Negligible at solo-dev scale; visible at multi-user scale.
- **Effort:** 2-line migration when picked up.
- **Defer until:** Performance metrics show the dashboard widget is slow
  OR before opening to beta users (see HIGH-5 baseline).

#### LOW-8: Public endpoint latency above aspirational liveness target
- **From:** Audit 2026-04-30.
- **What:** `/health` ~650-750ms, `/health/ready` ~3.6-4.3s,
  `/api/grammar/home` and `/api/grammar/categories` ~1.1s.  Acceptable for
  current dogfood scale but `/health` aspirational target is <200ms.
- **Action:** Investigate cold-start vs sustained latency once Railway
  paid-tier or Vercel-edge is on the table.
- **Effort:** Hours-to-days depending on how much rearchitecture lands.
- **Defer until:** User-facing impact OR move beyond Railway free tier.

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

#### PROC-5: State-audit checklist (codify the 2026-04-30 template)
- **Background:** The 2026-04-30 comprehensive state audit was the first
  cumulative-state pass (vs per-PR audits).  Format covered 12 areas
  (DB, API, RLS, frontend, tests, cross-PR contradictions, anti-patterns,
  deploy state, data integrity, performance, cost, security) and surfaced
  4 LOW + 2 MEDIUM + 1 HIGH that per-PR audits had missed.  Worth a
  reusable template.
- **Action:** Distill the audit prompt into a `docs/templates/STATE_AUDIT.md`
  template that can run end of each multi-PR cycle.  Note which areas are
  Claude-Code-driveable vs need staging access vs need production access.
- **Effort:** 1 day to template + run the second pass for comparison.
- **Defer until:** End of Phase 2.5 (after Wave 2 dogfood Days 2-4 land).

---

## 🗑️ OBSOLETE

(empty — items here are kept for history when they become irrelevant)

---

## ✅ Completed

### Phase 2.5 Day 5 — 2026-05-01 (1 PR)

**Quick wins from comprehensive audit (PR #31) — Codex audit deferred:**
- ✅ **LOW-1: duplicate `/health` route removed** — `main.py` had a one-line
  handler shadowed in production by `routers/health.py`; FastAPI's
  last-registered-wins meant the router version always served, so this
  was dead code.
- ✅ **LOW-2: TECH_DEBT.md health snapshot refreshed** — 254 tests, migrations
  001–031, posture WARNING/MEDIUM/Phase-3-with-fixes.
- ✅ **LOW-3: pytest-cov + coverage baseline** — first formal capture, 50%
  overall.  Doc at `docs/audits/COVERAGE_BASELINE_2026-04-30.md` with a
  per-tier table + running delta table for future runs.
- ✅ **MEDIUM-1: ai_usage_logs schema codified** — migration 031 mirrors the
  canonical comment block in `services/ai_usage_logger.py:9-26` (idempotent,
  three indexes preserved).  Logger docstring now points at the migration
  as source of truth.
- ⏸️ **MEDIUM-2: vocab enrichment backfill rerun** — moved to active backlog
  (MED-2); needs admin JWT + production access that the Claude Code
  session can't drive directly.

### Phase 2.5 Day 4 — 2026-04-30 (5 PRs)

**Hotfix list-endpoint trailing slash (PR #26):**
- ✅ Triage fetch URL now ends with `/` so FastAPI's `redirect_slashes=True`
  doesn't return a 307 that Railway's proxy then carries with `scheme=http`
  — that combination dropped the `Authorization` header on the cross-scheme
  follow and got blocked by the browser as Mixed Content.
- ✅ Added anti-pattern **#13** (list-endpoint trailing slash on the client)
  to the cumulative anti-pattern lessons.

**PR-A skip persistence (PR #27):**
- ✅ **Migration 030** — `is_skipped` column on `user_vocabulary` with a
  partial index for the active subset.
- ✅ `POST /api/vocabulary/bank/{id}/skip` endpoint — JWT-scoped, idempotent.
- ✅ `is_skipped = false` filter applied across all user-facing surfaces:
  listing, export, accept, mark-fixed, recent-updates, due-queue, auto
  flashcard stacks.
- ✅ Builder-recording test pattern (6 tests pin the filter presence) — same
  pattern as the Wave 2 stack/RLS suites.

**PR-B triage relocation + needs_review redefine (PR #28) — Codex APPROVE:**
- ✅ Verdict-triage UI moved from `flashcard-study.html` to `my-vocabulary.html`.
  Vocab management belongs in the vocab management hub; the study page now
  only does SRS for every stack.
- ✅ Inline `✏️ Đã sửa, đưa lên flashcard` + `🗑️ Bỏ qua` actions on
  `needs_review` rows (replacing the locked +Stack/Xem trước placeholders).
- ✅ `auto:needs_review` redefined from "AI grammar verdict"
  (`source_type='needs_review'`) to "SRS struggle"
  (`flashcard_reviews.lapse_count > 0`).  The auto-stack now surfaces vocab
  the user has actually lapsed on — the right SRS use case.
- ✅ Wave 2 flagship `auto:all_vocab` study mode preserved — regression test
  added.
- ✅ 11 new tests in `test_needs_review_redefined.py` pin the contract:
  only counts lapsed; excludes skipped/archived/grammar-verdict rows;
  sorted lapse_count desc + ease_factor asc tiebreaker.

**Wave 2 Day 1 polish (PR #29):**
- ✅ "Xem câu gốc" button gets clickable affordance (`.source-context-btn`
  class with cursor pointer + teal hover lift, matching the vocab-action
  pattern from PR #23).
- ✅ Drop ease_factor from the user-facing meta row; admin Flashcard Stats
  tab still surfaces it for the audience that reads the algorithm.
- ✅ Rename "Thẻ mới" → "Chưa học" (state of knowledge, not card inventory).
- ✅ Replace SRS jargon on user-facing surfaces:
  `Tiến độ SRS` → `tiến độ học tập`, `theo SRS` / `lịch SRS` →
  `theo lịch tự động` / `lịch tự động`.

**HIGH-1 strategic deferral (PR #30):**
- ⏸️ Pre-implementation investigation found the audit spec materially
  understated scope (no RLS to "add WITH CHECK to" — legacy `sessions`/
  `responses` tables have no policies at all; `responses.py` is dead code;
  same `supabase_admin`-after-JWT pattern lives in 8+ routers, not just 3).
- ⏸️ Deferred to a dedicated security sprint with staging access — see the
  detailed entry under **⏸️ DEFERRED → Security hardening (Phase 3
  prerequisite)**.

### Phase 2.5 Day 3 — 2026-04-29 (6 PRs)

**TECH_DEBT comprehensive restructure (PR #20):**
- ✅ Migrated to the explicit-state format (🔴/🟡/✅/⏸️/🗑️) instead of
  priority buckets — every item now carries its own status, blockers, and
  revisit trigger.

**Combo Dogfood Day 2 HIGH issues (PR #21):**
- ✅ **CRITICAL: Whisper transcript leak fixed** — instruction-style prompt
  removed from `services/whisper.py`; `test_whisper_prompt.py` pins the
  contract against re-introduction.
- ✅ **HIGH: flashcard card-back button overlap** — back face moved into a
  grid cell that sizes to the larger of the two faces, so rich content
  no longer overflows the 280px floor onto the rating buttons.
- ✅ **HIGH-2: Phase B FP-rate Session 2** — dogfood Session 2 ran during
  this cycle; per user dogfood log the FP rate met the < 15% acceptance
  gate (no FP-rate-related findings surfaced into the Combo Day 2 audit).
  The four MEDIUM UX issues that did surface are tracked under PR #22.
- ✅ Test pin: `flashcard_reviews` lazy-create contract (no auto-add of
  `needs_review` vocab to flashcards).

**Combo MEDIUM Dogfood Day 2 (PR #22) — Codex APPROVE:**
- ✅ Dashboard "Cập nhật từ vựng gần đây" widget replaces the result-page
  toast (`GET /api/vocabulary/bank/recent-updates`).
- ✅ Auto-stack "Đang phân loại" badge on `auto:needs_review` study page.
- ✅ Result-page parity for `test_part` flow (redirect to `result.html`).
- ✅ My Vocabulary preview-flashcard modal + `POST /accept` to promote a
  suggestion (and add to the user's default stack).

**Post-PR-#22 UX polish (PR #23):**
- ✅ Backend rejects `needs_review` rows from being added to flashcard
  stacks; frontend locks the `+Stack` button with a tooltip.
- ✅ Clickable affordance pattern (`.vocab-action-btn` family) shipped — the
  template later reused by PR #25 + PR #29.

**Post-PR-#23 UX consistency (PR #24):**
- ✅ Lock `Xem trước` for `needs_review` for the same reason `+Stack` was
  locked.
- ✅ 1-click accept-and-learn — `POST /accept` now also enrolls the row
  into the user's default flashcard stack ("Từ vựng đã chấp nhận"),
  auto-creating the stack the first time it's needed.

**Wave 2 Dogfood Day 1 fixes (PR #25) — Codex APPROVE:**
- ✅ Triage view for `auto:needs_review` (PR-A version; superseded by
  PR-B's relocation in PR #28).
- ✅ Bidirectional card flip restored on `flashcard-study.html`.
- ✅ Idiom + collocation Vietnamese definitions — Gemini prompt updated
  + `_SYSTEM_PROMPT_SIMPLE` retry path; `definition_vi`/`_en` only
  written when actually returned (non-destructive backfill).

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

## 📊 Health metrics — snapshot 2026-05-01

For the cumulative snapshot, see the comprehensive production audit
captured 2026-04-30.  Coverage baseline lives at
`docs/audits/COVERAGE_BASELINE_2026-04-30.md`.

**Code:**
- Backend tests: **254 collected** (239 passed, 15 env-gated live-RLS skips
  without staging creds in CI environment).
- Coverage baseline: **50% overall** (PR #31; tracked at
  `docs/audits/COVERAGE_BASELINE_2026-04-30.md`).
- Page parity: 4 pages checked, all OK; `frontend/pages/d3-exercise.html`
  intentionally skipped (deferred to Phase E).
- Migrations applied production: **001–031** (031 codifies the
  `ai_usage_logs` schema that previously lived only in
  `services/ai_usage_logger.py` comments).
- Live RLS tests: **8 pass live** (no skips when staging creds present).

**Production posture (2026-05-01):**
- Overall: **WARNING** — HIGH-1 deferred to dedicated security sprint
  (legacy `sessions`/`responses` tables have no RLS yet; mitigated by
  app-layer ownership filters + JWT validation; no known active exploit
  vector).
- Tech debt level: **MEDIUM**.
- Ready for Phase 3: **WITH FIXES** — HIGH-1 hardening is a Phase 3
  prerequisite.

**Production:**
- Vercel: deployed main HEAD, status Ready.
- Railway: deployed, `/health` returns OK; `/health/ready` all-checks OK.
- Supabase: vocab enrichment partial — 12/36 `used_well` and 6/14
  `needs_review` rows missing `definition_vi/_en` at audit time
  (MED-2, backfill rerun pending).
- Backup: daily 03:00 via launchd, ~13 MB dumps.

**Dogfood data — gaps:**
- Phase B FP rate Session 2: ✅ ran 2026-04-29 (per dogfood log; no FP-rate
  finding in Combo Day 2 audit).
- Wave 2 SRS Day 1: ✅ ran 2026-04-29; 6 issues addressed in PR #25 + #28 +
  #29.  Days 2-4 (interval-feel test against the cleaned UX) still pending
  (HIGH-3).
- Engagement metrics: minimal (1 active user = self).
- Baseline metrics doc not yet captured (HIGH-5).

**Production latency (sampled during audit 2026-04-30):**
- `/health` ~650-750ms (aspirational <200ms — see LOW-8).
- `/health/ready` ~3.6-4.3s (acceptable for diagnostic endpoint).
- `/api/grammar/home` and `/api/grammar/categories` ~1.1s.

**Cost (current):**
- Gemini API: ~$5–10/mo estimate (low usage; validates the Gemini Flash
  decision and defers any Gemma self-host migration ~6 months).
- Supabase: free tier.
- Railway: free tier (LOW-8 latency tied to this — paid tier would help).
- Vercel: free tier.
- **Total: ~$5–10/mo.**

---

## 🎯 Next decisions needed

### Phase 2.5 completion criteria

- [x] Phase B FP rate < 15% verified (Session 2 ran 2026-04-29; per dogfood
      log the gate held).
- [x] Tech debt CRITICAL cleared.
- [x] Comprehensive audit findings addressed (4/5 LOW+MEDIUM done in PR
      #31; MED-2 vocab backfill is the only one still pending and is
      blocked on production access).
- [ ] Wave 2 dogfood Day 2-4 complete (HIGH-3).
- [ ] Baseline metrics documented (HIGH-5).
- [ ] Phase 3 direction chosen with data justification (HIGH-4).

### Phase 3 direction options

Decision criteria: dogfood pain points + user requests, NOT assumption.

| Option              | Effort     | Trigger                                      |
|---------------------|------------|----------------------------------------------|
| Quick chatbot MVP   | 2-3 weeks  | User pain: "want quick conversational help"  |
| Mock test feature   | 2-3 weeks  | User pain: "want full IELTS Speaking sim"    |
| Reading/Listening   | 4-6 weeks  | User pain: "Speaking enough, want more"      |
| Audio cards         | 1-2 weeks  | Dogfood: SRS effective but content thin      |
| SRS tuning          | 3-5 days   | Dogfood: rating distribution clearly skewed  |

### Open decisions

1. **Beta user recruitment** (timing)
   - Currently solo dev only.
   - Risk: design without real user feedback.
   - Approach: 5–10 beta users after Phase 3 ships.
   - **Prerequisites:** HIGH-1 hardening sprint + HIGH-5 baseline metrics.

2. **AI model strategy long-term**
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
