# Tech Debt — IELTS Speaking Coach

**Last updated:** 2026-05-05 (PM)
**Last reviewed:** 2026-05-05 (PM)

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

### High priority — Sprint 6 follow-up + Writing Coach Phase 1

#### HIGH-6: Sprint 6 24h soak verification — PENDING
- **What:** Sprint 6 mapping coverage expansion shipped 2026-05-03 with
  projected ~78% production anchor coverage on NEW practice rows. 24h soak
  window in progress at time of this update.
- **Action:** Run 3 SQL queries on production Supabase 24h post-deploy:
  total new rows + coverage rate, coverage by slug, mapping firing frequency.
  Pass thresholds: ≥60% strong success, 40-60% moderate, <40% Sprint 6.5
  patch trigger (suspect M033 keyword scoring miss on number-agreement
  errors mislabeled "sai thì").
- **Effort:** 30 min execute + analyze.
- **Blocking:** HIGH-7 Sprint 7 design (Branch A/B/C decision tree).

#### HIGH-7: Sprint 7 mapping coverage expansion — DEPENDS on HIGH-6
- **What:** Continue mapping coverage to remaining 11% production traffic
  (smaller slugs: this-that-these-those-in-use, missing-subjects,
  missing-main-verbs, articles-with-places-and-names, agreeing-and-
  disagreeing-naturally, overusing-i-think).
- **Action:** Same Phase 2a/2b pattern as Sprint 6 (anchor declarations
  in target md files + new mappings M038+).
- **Effort:** 2-4 hours work + 24h soak.
- **Blocked by:** HIGH-6 results.

#### ~~HIGH-8: Writing Coach Phase 1 — Sprint W0 (schema + scaffolding)~~ ✅ DONE 2026-05-04
- **What:** New IELTS Writing analysis tool integrated into Aver Learning,
  admin-only Phase 1, eliminate Andy's copy/paste friction (current workflow:
  Google Doc → AI grader → Word → Google Doc, 4× copy/paste operations).
- **Reference:** `WRITING_COACH_INTEGRATION_ARCHITECTURE_V2.md` (planner output).
- **Sprint W0 scope:** Migration 033 (students + writing_essays + writing_feedback
  + writing_jobs tables), RLS policies (admin-only), `require_admin` middleware,
  empty router structure, frontend admin page stubs.
- **Effort:** 30-40 hours = 1 week.
- **Owner:** Code (after planner writes Sprint W0 prompt).

#### ~~HIGH-9: Writing Coach Phase 1 — Sprint W1 (Gemini grader)~~ ✅ DONE 2026-05-04
- **What:** Gemini grader service supporting all 5 levels from TECHNICAL_SPEC
  (Strict Grammar Police → Pedantic Linguist).
- **Scope:** 5 system prompts + shared modules (strict_grammar_check,
  persona_vn_examiner), full Pydantic WritingFeedback schema, retry logic,
  JSON cleaning + validation.
- **Effort:** 40-50 hours = 1 week.
- **Blocked by:** HIGH-8 ship.

#### ~~HIGH-10: Writing Coach Phase 1 — Sprint W2 (submission + grading flow)~~ ✅ DONE 2026-05-04
- **What:** End-to-end submission pipeline: form → background grading →
  status polling → admin review.
- **Scope:** POST /admin/writing/essays endpoint, FastAPI BackgroundTasks
  wiring, frontend admin-writing-new.html (submission form), student selector
  with search, status page, browser notification on completion.
- **Effort:** 40-50 hours = 1 week.
- **Blocked by:** HIGH-9 ship.

#### ~~HIGH-11: Writing Coach Phase 1 — Sprint W3 (render + delivery)~~ ✅ DONE 2026-05-05

#### ~~HIGH-12: Codex audit Sprint 0-6 (Speaking deep-link broken)~~ ✅ DONE 2026-05-05
- **What:** Andy manual smoke 2026-05-04 reports 3 features không hoạt động
  trong production:
  - URL bar không có #anchor-name sau click recommendation
  - Page không smooth-scroll to specific section
  - Heading không pulse teal 3 seconds
- **Status:** Production deploy verified (Railway /health 200), tests pass
  (261 backend), drift gate green, Codex audit Blockers RESOLVED... yet smoke fails.
- **Action:** Codex audit prompt ready
  (`PROMPT_CODEX_AUDIT_DEEPLINK_VALIDATION.md`). Run when Andy resumes Speaking.
- **Severity:** Critical — 7 sprints + 4 weeks work, deep-link feature should be
  user-facing value but currently invisible.
- **Effort:** 30-45 min audit + Sprint 6.5 patch (TBD scope based on findings).
- **Blocked by:** Andy bandwidth.
- **What:** Output rendering + delivery via clipboard copy (primary) and
  Word download (secondary).
- **Scope:** Jinja2 HTML template (matches Andy's sample Word file structure),
  /admin/writing/essays/{id}/render endpoint, frontend admin-writing-grade.html
  (review + edit screen with editable fields), "Copy formatted" button
  (clipboard API with text/html MIME), "Download .docx" button (html2docx),
  mark delivered workflow, admin essay history view, production deploy.
- **Effort:** 40-50 hours = 1 week.
- **Blocked by:** HIGH-10 ship.

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

### Writing Coach roadmap (post Phase 1)

#### W-PHASE-1.5a: Admin essay history view
- **What:** Admin page hiển thị tất cả essays đã graded, filter by student/date/status,
  click vào → mở grade page. Cần thiết để Andy review past work + tham khảo
  khi grade student mới.
- **Effort:** ~1 day (extend existing admin-writing.html dashboard).
- **Trigger:** Phase 1 daily-use feedback shows demand. Defer until ≥20 essays graded.

#### W-PHASE-1.5b: Task 1 image upload (charts/maps/processes)
- **What:** Task 1 Academic essays mô tả biểu đồ/bản đồ/quy trình. Hiện tại Andy
  phải mô tả textually trong prompt_text. Future: upload image → Gemini multimodal
  reads → grades essay against actual chart.
- **Effort:** 1-2 weeks. Migration cho prompt_image_url (column đã có sẵn,
  chưa wire). Frontend image upload + preview. Backend: store ở Supabase Storage,
  inject vào Gemini call.
- **Trigger:** Task 1 Academic volume justifies (Andy decides). Originally Phase 3,
  pull forward nếu cần.

#### W-PHASE-1.5c: Prompt hardening — schema drift prevention
- **What:** Phase 1 shipped 3 Gemini-shape regressions (W2.1 suggestion-as-string,
  W3.3 counterargumentAnalysis hallucination, plus unknown others). Pattern
  suggests systematic prompt brittleness, not isolated bugs.
- **Action:**
  1. Survey all Pydantic sub-types — which ones rely on Gemini following nested shape?
  2. Add explicit ❌/✅ examples for ALL nested object fields (mistakeAnalysis,
     wordsToUpgrade, sentenceUpgrades, ideaDevelopmentAnalysis, etc.)
  3. Add automated drift test: random Gemini calls → assert all top-level
     fields match expected types
  4. Consider Pydantic strict mode opt-in for production grading
- **Effort:** 2-3 days.
- **Trigger:** Phase 1.5a or 1.5b — bundle với schema work.

#### W-PHASE-1.5: History-aware AI grading
- **What:** AI sees previous student essays when grading new essay; pattern
  detection ("Lỗi article xuất hiện 4/5 bài gần nhất"); band trajectory
  analysis ("Improvement in lexical resource since essay #3").
- **Effort:** 1-2 weeks (Sprint W4-W5).
- **Trigger:** Phase 1 stable in production + 5+ essays/student exist (need
  data before patterns meaningful).
- **Cost impact:** ~2× per grading (acceptable: $20-50/month at 250
  essays/week target).

#### W-PHASE-2: Student submission portal
- **What:** Direct student access — submit essay via web, queue management,
  notifications, optionally Google Docs API integration for direct delivery
  (eliminate remaining copy/paste).
- **Scope:** Student-facing UI (submit form, dashboard, history, results
  viewer), daily limits enforcement, admin queue view, auto-AI grade trigger
  with Andy review, email notifications, Google Docs API write-back (Phase 2b).
- **Effort:** 3-4 weeks (Sprint W6-W9).
- **Trigger:** Phase 1 + 1.5 stable, Andy ready to expand to direct student access.

#### W-PHASE-3: Pre-submission preview
- **What:** Manual "Check before submit" button with severity-rated issue list
  (high/medium/low), specific suggestions, off-topic detection.
- **Scope:** Lightweight Gemini call (different prompt focused on issues),
  inline issue highlighting, iterative editing flow, cross-essay pattern
  recurrence detection, personal weakness highlighting.
- **Effort:** 3-4 weeks (Sprint W10-W12).
- **Trigger:** Phase 2 stable, students using regularly.

#### W-PHASE-4: Scale & monetize
- **What:** Tier system (free/standard/premium), Stripe integration, cost
  dashboard, async queue with Redis (replace BackgroundTasks for scale).
- **Effort:** TBD based on business model.
- **Trigger:** Business validation post Phase 3.

### Design system migration (Pack v2 received 2026-05-04, integration deferred)

#### DES-1: Roadmap re-generation (14 → 22 topics)
- **What:** Pack v2 grammar-roadmap.html has 14 topics (5 Foundation / 5
  Intermediate / 4 Advanced); audit decision = 22 topics (8 / 9 / 5).
- **Action:** Re-generate via Claude Design with curated 22-topic list.
- **Reference:** `PROMPT_CLAUDE_DESIGN_ROADMAP_22_TOPICS.md` ready in
  planner outputs.
- **Effort:** 30 min Claude Design + verification.
- **Defer until:** All Sprint pipeline complete (Andy decision 2026-05-04 —
  do design integration in single batch later).

#### DES-2: Vocab Article re-export
- **What:** Pack v2 `vocab-article.html` is 0 bytes (Claude Design export
  glitch).
- **Action:** Re-generate via Claude Design.
- **Effort:** 15 min re-export.
- **Defer until:** Design integration batch.

#### DES-3: Page integration (9 PRs)
- **What:** 9 redesigned pages from Pack v2 await integration:
  dashboard, profile, grammar-roadmap, grammar-article, grammar-search,
  grammar-compare, exercises, d1-exercise, flashcard-study.
- **Critical merge:** `grammar-article.html` integration must preserve
  Sprint 5 deep-link UX (scroll-margin-top, pulse animation, hash handler)
  while adopting pack design.
- **Effort:** 9 PRs, ~2-3 hours per page = 18-27 hours total.
- **Defer until:** All Sprint pipeline complete (Andy explicit decision
  2026-05-04 — defer design integration entirely until Sprint 7+ done).

### Codex audit deferred items (2026-05-03 audit)

#### CODEX-1: analytics_events RLS policies
- **What:** Codex audit 2026-05-03 found `analytics_events` table has RLS
  enabled but no policies defined.
- **Action:** Define INSERT policy (allow service role + authenticated users
  to insert their own events).
- **Effort:** 30 min.

#### CODEX-2: Renderer test malformed comment cases
- **What:** Codex audit found `test_grammar_renderer_anchors.py` lacks
  malformed comment edge cases.
- **Effort:** 1 hour.

#### CODEX-3: Matcher test exact-threshold pinning at 0.35
- **What:** Codex audit found matcher tests don't pin behavior exactly at
  0.35 confidence threshold (boundary condition).
- **Effort:** 30 min.

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

### Performance optimization — next batch (post Phase 2.5)

**Status:** ⏸️ DEFERRED until next performance audit.

**Current state:** Dashboard cold-load 16.29s → ~6-7s after PR #33 + #34
(~58% improvement; manual Incognito verification still pending).
Acceptable for solo dogfood scale; not yet at the <5s aspiration.  Each
item below is a follow-up, not a blocker.

#### PERF-3: Tailwind CDN → bundled CSS
- **Current:** `cdn.tailwindcss.com` is loaded on every page (~127KB plus
  ~200ms compile-on-load) and emits the production-warning console line.
- **Fix:** Build Tailwind locally, ship a static CSS bundle.
- **Effort:** ~1 hour once a build-tooling pick is made.
- **Impact:** −200ms per page + clears the production warning.
- **Defer until:** Frontend build pipeline decision (which bundler).
  Already tracked as **LOW-2 (Tailwind CDN in production)** above —
  this entry is the implementation-shaped sibling.

#### PERF-4: localStorage cache for `/auth/me`
- **Current:** Every page reload re-fetches `/auth/me` (provisioning +
  flag computation + telemetry).  Cheap individually, but adds a
  blocking call to first paint on every navigation.
- **Fix:** Cache the response in `localStorage` with a 5-min TTL +
  stale-while-revalidate pattern.
- **Effort:** ~2 hours.
- **Impact:** Instant first paint on subsequent loads.
- **Defer until:** A user reports slow second-load specifically.
  Auth-side-effect endpoints generally shouldn't be aggressively cached
  on the client without a clear trigger.

#### PERF-5: Service Worker for tab navigation
- **Current:** Multi-page app — every tab switch is a full HTML reload.
- **Fix:** Service Worker caches static assets (HTML / CSS / JS) so
  navigation between pages becomes near-instant.
- **Effort:** ~3-4 hours.
- **Impact:** Tab switching feels instant.
- **Defer until:** Phase 3+ (significant scope; needs cache-invalidation
  discipline aligned with deploys).

#### PERF-6: Backend response time (Railway free tier cold start)
- **Current:** Each API call is ~1.5-3.5s on cold containers.
  `/health` ~700ms, `/health/ready` ~4s — most of that is cold start +
  Railway proxy + Supabase round-trip.
- **Options:** Railway paid tier (~$5/mo, always-on); database
  connection pooling; query caching for hot paths.
- **Effort:** Investigation needed before committing to one approach.
- **Impact:** Every page benefits, not just the dashboard.
- **Defer until:** Production scale demands it OR a budget decision is
  made on Railway tier.  Tied to **LOW-8 (endpoint latency)** above.

#### PERF-7: Codified browser-level cold-load benchmark
- **From:** PR #34 Codex audit, the only LOW finding
  (`AUDIT_PR34_DASHBOARD_AGGREGATE_ENDPOINT.md`).
- **Current:** Cold-load improvements are verified by manual Incognito
  timing.  No automated browser benchmark exists in repo.
- **Fix:** Lightweight headless-browser perf smoke (Playwright or
  similar) that records dashboard `Finish` time post-deploy and asserts
  a regression budget.
- **Effort:** ~2-3 hours.
- **Impact:** The 6-7s target becomes test-enforced rather than
  observational.
- **Defer until:** A regression worry surfaces, OR Phase 3 if multiple
  perf-sensitive paths land at once.

---

## 🗑️ OBSOLETE

(empty — items here are kept for history when they become irrelevant)

---

## ✅ Completed

### Speaking Deep-link Feature LIVE — 2026-05-05 (PM, 11 PRs across 1 day)

**MILESTONE:** Speaking deep-link feature từ Codex audit RED (2026-05-04) đến
production LIVE verified. AI grammar feedback now resolves to specific anchor
sections trong Grammar Wiki articles, with smooth-scroll + pulse animation.

**Sprints shipped (PRs #55-#65):**
- 6.5 PR #55: Diagnostic logging trong matcher pipeline + /health/runtime endpoint
- 6.6 PR #56: Logging config (basicConfig added — Sprint 6.5 logs were silent)
- 6.7 PR #57: Lower matcher threshold 0.35 → 0.20
- 7 scaffolding PR #58: Mapping coverage audit (98 articles, 18 mapped, 80 missing)
- 7a Day 2: AI-generated 11 mapping drafts (planner approved 8, dropped 3)
- 7a Day 3 PR #58 merge: 8 new mappings (M038-M048 minus M041/M042/M045)
- 7a Day 4 PR #59: Tune M044 prepositions với VN production keywords
- 7b PR #60: Declare anchors + write M049/M050 (missing-subjects, missing-main-verbs)
- 7c PR #61: Rework find_best_match scoring (3-tier: mapping > title > body)
- 7c.1+7c.2 PR #62: Apply hardening to find_best_anchor + quoted-phrase stripping
- 7c.3 PR #64: Tune M023 modal-verbs với VN keywords
- Unfreeze stale defers PR #65: M016/M017/M025/M027/M028 unfrozen, count 42→47

**Plus operational:**
- Admin bypass quota PR #63 (admin role unlimited sessions)

**Cumulative state:**
- Tests: 450 → 471 (+21)
- Active mappings: 31 → 47 (+16)
- Declared anchors: 207 → 217 (+10 from M049/M050 + Sprint 7b anchor declarations)
- Coverage: 18 → 26 mapped slugs

**Architecture insights gained:**
- Tests passing với mocked matcher ≠ production behavior (Sprint 6.6: logging silent)
- Article body word frequency dominated routing (Sprint 7c: 3-tier scoring)
- Quoted student errors confused VN_HINT triggers (Sprint 7c.2: strip quotes ≥3 words)
- Vietnamese-only mapping keywords needed for production AI feedback (Sprint 7a Day 4 + 7c.3)

**Codex audit verdict 2026-05-04:**
- Original RED → Sprint 6.5+6.6 revealed root cause (logging silent, then matcher gaps)
- Final state: production canary 2026-05-05 verified deep-link working

**Production canary verified working:**
- "Sai cấu trúc động từ — 'can easily to attract' — sai động từ nguyên mẫu sau 'can'"
- → routed modal-verbs slug ✅
- → resolved anchor modal-verbs.structure.bare-infinitive-required ✅
- → URL hash, smooth scroll, pulse animation all functional ✅

**Open from canary observations (defer):**
- 67 blocked articles still need anchor declarations (low emit frequency)
- Other M-mappings may have English-only keywords (apply M044/M023 playbook as data reveals)

### Phase 1 Writing Coach GA — 2026-05-05 (10 PRs across 5 days)

**MILESTONE:** Writing Coach Phase 1 LIVE. Andy's copy/paste workflow eliminated.
Admin can submit essay → AI grades async → review/edit on web → copy formatted
output to Google Docs OR download Word file → mark delivered.

**Sprints shipped (PRs #44-#53):**
- W0 PR #44 (5170452): Schema + scaffolding (Migration 033, 4 tables, RLS, admin gates)
- W1 PR #45 (eed2df4): Gemini grader service (5 levels, retry, cost tracking)
- W2 PR #46: Submission flow + admin grading UI (CRUD, async grading)
- W2.1 PR #47: Schema patch (suggestion-as-string tolerance)
- W2.2 PR #48: Audit AMBER fixes (payload size guards, staging verification)
- W2.3 PR #49: Auth redirect loop fix
- W3 PR #50: Render + delivery (HTML clipboard, Word export, edit UI)
- W3.1 PR #51: Audit AMBER fixes (state machine + dirty-state)
- W3.2 PR #52: UX polish (4 tabs, click-scroll, Word/clipboard styling)
- W3.3 PR #53: counterargumentAnalysis schema fix

**Codex audits:**
- W1+W2: AMBER → fixed in W2.2
- W3: AMBER → fixed in W3.1

**Cumulative state:**
- Tests: 261 → 450 (+189)
- New tables: 4 (students, writing_essays, writing_feedback, writing_jobs)
- New endpoints: 16 admin (writing + students)
- New services: 5 (grader, prompt_loader, render, exporter, essay_service)
- New prompts: 9 markdown files (5 levels + 3 shared + README)
- Production cost: ~$0.04/essay (gemini-2.5-pro)
- Speaking Coach: zero regression throughout

**Architecture decisions confirmed:**
- Stack stays vanilla HTML + Tailwind CDN (no React migration)
- Admin-only Phase 1 (student access deferred Phase 2)
- HTML clipboard primary delivery (Word optional download)
- All 5 levels available day 1
- FastAPI BackgroundTasks for async (Celery defer Phase 4)

**Open from W3 audit (Phase 1.5 candidates):**
- Browser smoke coverage (clipboard cross-browser)
- Supabase config consolidation (admin pages duplicate URL/key)
- "Delivered cannot revert" integration test

**Andy first-use feedback addressed in W3.2:**
- Tab navigation (4 tabs)
- Click error → scroll + pulse
- Word file colors + bullets
- Clipboard format preservation

**Andy first-use feedback deferred (W-PHASE-1.5a/b):**
- Admin essay history view
- Task 1 image upload

**Planner mistakes during Phase 1 (logged in HANDOFF):**
- #8 verbose responses (Andy pushback "đang bị overexplain")
- #9-#11: 3 Gemini schema-drift surprises caught by production smoke,
  not by tests. W-PHASE-1.5c addresses systematic prevention.

### Phase 3 Day 1 — 2026-05-03 (Grammar Wiki deep-link feature ACTIVATED, 2 PRs)

**MAJOR MILESTONE:** Deep-link feature LIVE in production after 7 sprints
(Sprint 0-6 + 5b patch).  Practice → AI feedback → click recommendation →
smooth-scroll to specific grammar anchor → teal pulse confirmation.

**Sprint 5 + 5b — Frontend deep-link UX (PR #42, 9 commits):**

Sprint 5 (5 commits):
- ✅ 3 URL hash extensions across surfaces (practice.js inline link +
  result.html × 2)
- ✅ Critical plumbing fix: `result.html:911` was dropping `anchor` field at
  recMatches reduction (Phase 0 reconnaissance caught this — invisible
  without code investigation)
- ✅ Smooth-scroll handler hooked into async `loadGrammarArticle()` flow
- ✅ 3-second teal pulse animation (#14b8a6) on landed heading
- ✅ scroll-margin-top 80px CSS for sticky header offset

Sprint 5b — Codex audit response (4 commits, 2026-05-03):
- ✅ Codex audit 2026-05-03 verdict: FAIL (RED) → 2 blockers identified
- ✅ Blocker 2 fixed: practice.js Quick Grammar Tip card (`_grammarCardHtml`
  + `_showGrammarResources`) preserves anchor hash (mirrors Sprint 5
  result.html commit 1294227 pattern)
- ✅ Integration test for production-like issues: 10 cases (8 baseline False
  + 2 synthetic True), pins current matcher behavior as Sprint 6 baseline
- ✅ CI gate broadened: `backend-tests.yml` now triggers on `frontend/**`
  (drift gate runs on frontend-only PRs — was missing in Sprint 5)
- ✅ Execution report addendum documenting 5b patch sprint

**Sprint 6 — Mapping coverage expansion (PR #43, 4 commits):**

Phase 0: Production sampling
- ✅ Sampled 160 most recent `grammar_recommendations` rows
- ✅ Confirmed Codex audit Blocker 1: 0/160 rows had `recommended_anchor`
- ✅ Top slugs: articles (72, 45%), tense-consistency (31, 19%),
  article-errors (22, 14%) — top 3 = 78% production traffic

Phase 1: Reconnaissance
- ✅ Verified M001-M003 anchors still exist (post Sprint 0-3 changes)
- ✅ Discovered 7 of 8 uncovered slugs have NO `anchors:` block declared
- ✅ Convention `<article>.common-mistake.<descriptor>` confirmed against
  Sprint 3 deferred mappings

Phase 2a: Anchor declarations (commit 4cecb67)
- ✅ 7 new anchors declared in `error-clinic/article-errors.md`
- ✅ Latent inline marker fix in `tense-consistency.md` (Sprint 5 missed —
  anchors declared but renderer needed inline markers to inject `<a id>`)
- ✅ 200 → 207 declared anchors

Phase 2b: New mappings M031-M037 (commit c02995b)
- ✅ M031: Missing 'the' before specific noun (45+ of 72 articles rows)
- ✅ M032: Missing 'a/an' (overlaps M001 intentionally — slug routing differs)
- ✅ M033: Tense shift mid-narrative (covers 31 production rows)
- ✅ M034-M037: Additional article-errors patterns
- ✅ Vietnamese-keyword-first design (production AI emits Vietnamese)
- ✅ 30 → 37 active mappings

Phase 2c-pre: Investigation (architecture discovery)
- ✅ Discovered `_DIRECT_MAP` routing layer (`grammar_content.py:331-341`)
  — hardcoded keyword → slug rules that intercept BEFORE `find_best_match`
- ✅ 3-layer matcher pipeline: `_DIRECT_MAP` → `find_best_match` →
  `find_best_anchor`
- ✅ 47.5% production traffic hits `_DIRECT_MAP` (bypasses M001-M030 entirely)
- ✅ 50% flows to `find_best_match` → mostly slugs without M001-M030
- ✅ Only 2.5% reaches `find_best_match` → articles slug (Phase 2c addressable)

Phase 2c: SKIPPED (Plan A — strategic decision)
- ✅ Bilingualize would impact only ~1-2% (not 45% planner anticipated)
- ✅ Effort:reward unfavorable for 30-mapping mechanical pass
- ✅ Phase 2b alone projects 78-80% coverage of NEW production rows
- ✅ Anti-pattern #14 documented (JSON snapshot ≠ live routing reality)

Phase 3: Test fixture updates (commit 3e89aac)
- ✅ 5 Sprint 5b designed-failing fixtures flipped False → True
  (3 prod_article_missing_the_* → M031, 2 prod_tense_* → M033)
- ✅ 2 new positive controls added (M032 a/an + M037 anaphoric)
- ✅ 261 backend tests pass (was 259)

Phase 5: Execution report (commit 910a3d4)
- ✅ Full Phase 0/1/2c-pre/2a/2b/2c/3 artifacts captured
- ✅ 24h post-deploy verification protocol documented (HIGH-6)
- ✅ Sprint 7 entry conditions documented (HIGH-7)

**Codex audit (2026-05-03) — both blockers RESOLVED:**
- Blocker 2 (High): practice.js Quick Grammar Tip card → FIXED in Sprint 5b
- Blocker 1 (Critical): 0/160 anchor population → FIXED in Sprint 6
  (mapping expansion, projected 78% on NEW rows)

**Cumulative state across 7 sprints:**
- Articles: 126 → 98 (audit-driven consolidation)
- Anchors: 0 → 207
- Mappings: 0 → 37 active
- Backend tests: 235 → 261
- Production deep-link infrastructure: 0% → projected 78% NEW row coverage
- Zero rollbacks across all 7 sprints
- 5 planner Claude mistakes documented (process improvement, all caught
  by Code agent's pre-flight discipline or external Codex audit)

**Architecture knowledge captured:**
- `_DIRECT_MAP` routing (Sprint 6 discovery)
- 3-layer matcher pipeline documented
- Live code tracing required for mapping design (anti-pattern #14)

### Phase 2.5 Day 6 — 2026-05-02 (Performance, 2 PRs)

**Investigation (Incognito timing, 2026-05-02):**
- Dashboard cold-load baseline: 16.29s
- Dashboard warm-reload baseline: 10.70s
- Root causes: per-request CORS preflight (~300-500ms × N), duplicate
  `/auth/me` fetch on first paint (~3s), and 6+ sequential init fetches.

**PR #33 — PR-A: CORS preflight cache + `/auth/me` dedup:**
- ✅ `main.py` CORSMiddleware now sets `max_age=86400` (24h, the cap
  Chromium honours and Firefox respects).  Browsers cache the OK
  preflight; subsequent fetches skip the OPTIONS round-trip.
- ✅ `dashboard.html init()` hoists the `/auth/me` payload into outer
  scope and threads it into `loadVocabUpdates(token, user)` so the widget
  reuses the flag check instead of re-fetching.  Default-deny preserved.
- 4 lines of behaviour change + comments; 2 commits; no Codex audit
  needed.

**PR #34 — PR-B: `/api/dashboard/init` aggregate endpoint — Codex APPROVE:**
- ✅ New service `backend/services/dashboard_aggregator.py` builds the
  payload from three sub-queries (sessions stats, recent vocab updates,
  flashcard due count).  JWT-scoped end-to-end via caller-passed Supabase
  client.
- ✅ New router `backend/routers/dashboard.py` (thin auth layer mirroring
  `flashcards.py` / `vocabulary_bank.py` convention) registers
  `GET /api/dashboard/init`.
- ✅ Partial-response semantics — each sub-query isolated; one failure
  lands its key in `_errors` and leaves the rest populated.  Frontend
  logs the gap and renders successful sections.
- ✅ Frontend `init()` consumes the aggregate; legacy `/sessions/stats`,
  `/api/vocabulary/bank/recent-updates`, `/api/flashcards/due/count`
  paths preserved as automatic fallback when the aggregate request fails
  (rollback path needs no code change).
- ✅ Render-only helpers extracted (`renderVocabUpdates(user, events)`,
  `_setFlashcardsBadgeCount(count)`) so both the aggregate and legacy
  call sites share the renderer.
- ✅ HIGH-1 decoupling pinned — regex-based regression tests assert
  neither `services/dashboard_aggregator.py` nor `routers/dashboard.py`
  imports or calls `supabase_admin`.  Aggregator duplicates the
  `/sessions/stats` query body rather than extracting from it (extracting
  would have pulled HIGH-1 contamination into the new code path).
- ✅ 10 new offline tests cover happy path, partial-response failure,
  empty state, filter discipline (excludes archived + skipped),
  chart-data ordering + limit, and the HIGH-1 decoupling regex pin.
- Codex audit verdict (`AUDIT_PR34_DASHBOARD_AGGREGATE_ENDPOINT.md`): ✅
  APPROVE with one LOW finding — no codified browser-level cold-load
  benchmark; tracked as PERF-7 below.

**Folded fetches (3):**
- `/sessions/stats?limit=20`
- `/api/vocabulary/bank/recent-updates?limit=5`
- `/api/flashcards/due/count`

**Stay separate (3):**
- `/auth/me` — auto-provisions the user row, bumps `last_seen_at`,
  computes feature flags.  Side effects belong to a dedicated endpoint.
- `/sessions?limit=200` — history list with its own pagination/search
  contract.
- `/api/grammar/dashboard-data` — different concern, separate router.

**Net result:** Dashboard request graph 6+ → **4** first-paint calls.
Expected cold-load 16.29s → ~6-7s (~58% from baseline).  Manual Incognito
verification still pending post-deploy.

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

## 📊 Health metrics — snapshot 2026-05-05 (post Phase 1 Writing GA)

For the cumulative snapshot, see the comprehensive production audit
captured 2026-04-30.  Coverage baseline lives at
`docs/audits/COVERAGE_BASELINE_2026-04-30.md`.

**Code:**
- Backend tests: **471 collected** (was 261 pre-Writing-Coach; +189 across
  W0 → W3.3).
- Coverage baseline: **50% overall** (PR #31; unchanged).
- Page parity: 4 pages checked, all OK; `frontend/pages/d3-exercise.html`
  intentionally skipped (deferred to Phase E).
- Migrations applied production: **001–032** (032 deep-link `recommended_anchor`
  column on `grammar_recommendations`, Sprint 4).
- Live RLS tests: **8 pass live** (no skips when staging creds present).
- Active grammar mappings: **47** (was 37, Sprint 7 series +10).
- Declared grammar anchors: **217** (was 207, Sprint 7b +10).
- Drift gate: **green throughout**.
- Writing Coach: **16 admin endpoints, 5 services, 9 prompt files, ~$0.04/essay cost.**

**Production posture (2026-05-04):**
- Overall: **WARNING** — HIGH-1 still deferred to dedicated security sprint
  (legacy `sessions`/`responses` tables have no RLS yet; mitigated by
  app-layer ownership filters + JWT validation; no known active exploit
  vector).  Improved with Sprint 6 (deep-link infra LIVE, Codex audit
  Blockers 1+2 RESOLVED).
- Tech debt level: **MEDIUM** — Phase 3 multi-track (Speaking deep-link
  in soak, Writing Coach Phase 1 ready to start, design pack deferred).
- Codex audit (2026-05-03): Both blockers RESOLVED.
- Ready for Phase 3: **YES** — Phase 3 = Grammar Wiki deep-link (Sprint 7
  pending) + Writing Coach Phase 1 (Sprint W0 ready to start).  HIGH-1
  hardening still recommended before broader user expansion.

**Workstream status (2026-05-05):**
- IELTS Speaking deep-link: **LIVE in production VERIFIED** 2026-05-05 PM.
  9-sprint cycle (6.5 → 7c.3) addressed Codex audit RED findings.
  All 3 features working: URL hash, smooth-scroll, pulse.
- Writing Coach Phase 1: **LIVE in production GA 2026-05-05**. Daily admin use ready.
- Writing Coach Phase 1.5: 3 candidates queued (W-PHASE-1.5a/b/c).
- Design pack v2: Received 2026-05-04, integration deferred (9 pages
  pending) — Andy decision: do all design integrations in single batch
  after Sprint pipeline complete.
- Stack consolidation: **DECIDED 2026-05-04** — stay vanilla HTML +
  Tailwind CDN (no React/Next.js migration); choice matches problem
  complexity for content-heavy app + solo dev capacity.

**Production:**
- Vercel: deployed main HEAD post PR #34, status Ready.
- Railway: deployed, `/health` returns OK; `/health/ready` all-checks OK.
- Supabase: vocab enrichment partial — 12/36 `used_well` and 6/14
  `needs_review` rows missing `definition_vi/_en` at audit time
  (MED-2, backfill rerun pending).
- Backup: daily 03:00 via launchd, ~13 MB dumps.

**Dogfood data — gaps:**
- Phase B FP rate Session 2: ✅ ran 2026-04-29 (per dogfood log; no FP-rate
  finding in Combo Day 2 audit).
- Wave 2 SRS Day 1: ✅ ran 2026-04-29; 6 issues addressed in PR #25 + #28 +
  #29.  Days 2-4 (interval-feel test against the cleaned UX) intentionally
  paused while Phase 3 strategic direction is being processed.
- Engagement metrics: minimal (1 active user = self).
- Baseline metrics doc not yet captured (HIGH-5; intentionally paused).

**Production performance (post Day 6):**
- Dashboard cold-load: **~6-7s expected** (down from 16.29s baseline,
  ~58% improvement after PR #33 + #34; manual Incognito verification
  still pending post-deploy).
- Dashboard warm-reload: ~3-4s estimated.
- Other pages: 3-8s — acceptable at solo-dogfood scale, see PERF-3..7
  for the deferred follow-up batch.
- `/health` ~650-750ms (aspirational <200ms — see LOW-8 / PERF-6).
- `/health/ready` ~3.6-4.3s (acceptable for diagnostic endpoint).
- `/api/grammar/home` and `/api/grammar/categories` ~1.1s.

**Cost (current):**
- Total historical: ~$10.56 since project start
  (Claude $5.94 / Whisper $4.00 / TTS $0.58 / Gemini $0.04).
- Gemini contribution is 0.4% of historical spend — validates the
  Gemini Flash route decision and defers any Gemma self-host migration
  ~6 months.
- Estimated monthly: ~$5–10.
- Supabase / Railway / Vercel: free tier
  (LOW-8 + PERF-6 latency tied to Railway free tier — paid would help).

---

## 🎯 Next decisions needed

### Phase 2.5 completion criteria

- [x] Phase B FP rate < 15% verified (Session 2 ran 2026-04-29; per dogfood
      log the gate held).
- [x] Tech debt CRITICAL cleared (HIGH-1 strategic defer).
- [x] Comprehensive audit findings addressed (4/5 LOW+MEDIUM done in PR
      #31; MED-2 vocab backfill is the only one still pending and is
      blocked on production access).
- [x] Performance critical path optimized — Dashboard 16.29s → ~6-7s
      after PR #33 + #34 (~58% from baseline).
- [ ] Wave 2 dogfood Day 2-4 — **paused** (HIGH-3); other workstreams
      (Speaking deep-link, Writing Coach) took priority.
- [ ] Baseline metrics documented — **paused** (HIGH-5).
- [x] Phase 3 direction chosen — **DECIDED**: Multi-track approach.
      Track 1 = Grammar Wiki deep-link (Sprint 0-6 + 5b shipped + Sprint 7
      series 2026-05-05 PM resolved Codex audit RED, LIVE verified).  Track 2 = Writing Coach
      (Phase 1 GA 2026-05-05 with 10 PRs W0→W3.3).  Track 3 = Design pack
      integration (deferred batch).

**Status:** Phase 3 is multi-track and active.  Phase 2.5 wrapped 2026-05-02.
Phase 3 launched immediately with Grammar Wiki deep-link sprints
(2026-05-03 Sprint 5+5b+6 shipped), now awaiting 24h soak verification.
Writing Coach Phase 1 ready to start in parallel or sequentially.

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
14. **JSON sample snapshots ≠ live code routing reality** — added 2026-05-03
    after Sprint 6 Phase 2c-pre investigation.  Planner Claude estimated
    bilingualizing M001-M030 mappings would impact 45% of production traffic
    based on JSON sample showing 72/160 rows on `articles` slug.  Reality:
    those rows were stored under older `_DIRECT_MAP` routing; live code now
    routes them to `article-errors` slug.  Bilingualize impact actually
    ~1-2%, not 45%.  Code's investigation tracing live `find_best_match` +
    `_DIRECT_MAP` caught the false estimate.  Lesson: when designing mapping
    changes, trace through ALL 3 layers of the matcher pipeline
    (`_DIRECT_MAP` → `find_best_match` → `find_best_anchor`), not just
    JSON data snapshots.  Saved ~1-2 hours of wasted bilingualize work in
    Sprint 6 Phase 2c.
15. **Branch creation ≠ production shipping** — added 2026-05-04 after
    planner Claude assumed Sprint 6 was merged based on Code's "Sprint
    complete" report.  Reality: 4 commits sat on feature branch unmerged
    while planner started writing TECH_DEBT update treating Sprint 6 as
    "shipped".  Code's pre-flight check caught the discrepancy by running
    `git log --oneline main..HEAD` (4 commits ahead) and confirming PR
    not yet created.  Lesson: verify `git log main` and `gh pr list` show
    the work shipped before documenting as complete.  Branch existence,
    "all commits done", and even "tests passing" do not equal deployment.
    The merge ceremony (push → PR → CI → merge → deploy) is part of
    "shipped", not optional.
17. **Logging silent without basicConfig** — added 2026-05-05 PM after
    Sprint 6.5 shipped 10 logger.info diagnostic calls but Railway logs
    showed zero output. Root cause: backend never called logging.basicConfig,
    so Python defaulted to WARNING level — all INFO calls silent. Required
    Sprint 6.6 patch (basicConfig + StreamHandler stdout) to make Sprint 6.5
    diagnostic actually visible. Lesson: every Python service deployed to
    cloud needs explicit logging config; never assume default INFO works.
    Drove total ship time from 1-sprint diagnosis (planned) to 2-sprint
    (diagnostic + config fix) before real fix work could start.

16. **Tests passing ≠ Gemini schema compliance in production** — added 2026-05-05
    after Phase 1 Writing shipped 3 Gemini schema-drift bugs (W2.1, W3.3, plus
    suggestion field) that all tests passed mocked but failed live. Tests use
    `mock_gemini_response` with hand-crafted valid JSON — they validate the
    schema, not Gemini's actual behavior. Production smoke is the only
    catch-net for hallucinated shapes. Lesson: schema flexibility (default
    fields, type coercion, drop unknown) is mandatory for any LLM JSON
    interface; supplement with explicit ❌/✅ examples in prompt; consider
    Phase 1.5 systematic hardening (W-PHASE-1.5c).

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
