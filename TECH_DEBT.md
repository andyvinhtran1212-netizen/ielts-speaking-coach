# Tech Debt — IELTS Speaking Coach

Last updated: 2026-04-27

Comprehensive snapshot of tech debt + improvement opportunities across the
codebase as of post-Phase-D-Wave-2 + rich-content rollout.  Sorted by
priority: CRITICAL → HIGH → MEDIUM → LOW → NICE_TO_HAVE.

This file supersedes the older `TECH_DEBT_BACKLOG.md` (Phase A/B-era
items absorbed in §"Pre-Phase D legacy items" below).

---

## CRITICAL (security / compliance)

### CRIT-1: Rotate database password
- **What:** Production DB password leaked through chat at least twice
  during recent troubleshooting; staging DB password leaked once.
- **Action:** Reset Supabase DB password from the Dashboard, update
  `backend/.env`, `backend/.env.staging`, and the Railway
  `DATABASE_URL` env var.  Verify backend reconnects cleanly afterwards.
- **Effort:** 5–10 minutes.
- **Status:** PENDING — surfaced multiple times in conversation; user
  has dismissed it for now but the residual risk remains until the
  password is rotated.

### CRIT-2: JWT exposure in chat session
- **What:** An admin JWT (≤1h TTL, since expired) was pasted in a chat
  session during troubleshooting.  Short-lived so blast radius is
  small, but the habit is the issue.
- **Action:** Process change only — when sharing a token for a
  collaborator to inspect, paste only the first/last 20 chars; never
  the full payload.
- **Effort:** Norm change, no code.

---

## HIGH (functional bugs / UX gaps that affect real users)

### HIGH-1: Idiom enrichment fails silently
- **What:** Vocab `played by ear` (and similar idioms) didn't make it
  through Gemini's `_validate_item` — most likely the example
  sentence didn't case-insensitively contain the headword, or the
  IPA-slashes regex rejected the multi-token output.
- **Symptom:** Dogfood account ended up with 17/18 vocab enriched.
  The unenriched row renders correctly in the UI (frontend tolerates
  NULL ipa/example_sentence) but the UX is degraded.
- **Action options:**
  - Update the Gemini system prompt with explicit idiom guidance
    (multi-word phrase handling, looser IPA expectations).
  - Skip enrichment for headwords > 3 words and render an idiom-
    specific UI block instead.
  - Maintain a manual SQL fallback for known idioms.
- **Effort:** 1–2 hours.
- **Tracked:** ~5% miss rate in current dataset; acceptable for now
  but worth a Phase E pass.

### HIGH-2: Phase B FP-rate dogfood session 2 not yet run
- **What:** Session 1 measured 37% FP rate against a < 10% gate.
  Post-dogfood remediation (migration 020 + the ROUND2 audit) shipped,
  but session 2 hasn't been run to verify the < 15% acceptance gate.
- **Action:** Run one full dogfood session, log issues in
  `DOGFOOD_PHASE_B_NOTES.md` (or equivalent), decide whether to
  expand the rollout or run a third remediation pass.
- **Effort:** 1–2 hours of dogfood + analysis.

### HIGH-3: Wave 2 flashcard SRS dogfood not yet run
- **What:** SRS algorithm has 7 deterministic unit tests pinning
  ease-factor floor/cap and interval growth, but nobody has actually
  studied a deck for ≥5 days to feel whether the intervals match
  pedagogical expectation.
- **Action:** 10 cards/day for 5–7 days, log subjective "felt about
  right / too soon / too late" per rating.  Adjust the SM-2 multiplier
  constants if needed.  Migrations not required — `services/srs.py`
  is the single tunable file.
- **Effort:** ~30 min/day × 5 days.

---

## MEDIUM (improvement opportunities)

### MED-1: Topic IS NULL filter UX verification
- **What:** Audit Wave 2 caught a backend gap (no `topic IS NULL`
  filter path) which was fixed via the `__uncategorized__` sentinel
  + a "📂 Chưa phân loại" chip.  Backend has tests; frontend chip
  has been seen working manually but not formally smoke-tested.
- **Action:** Walk through the Manual Stack modal with a vocab bank
  containing both topic'd and topic-NULL rows; confirm the chip
  appears, click → preview count matches an SQL `WHERE topic IS NULL`
  count.
- **Effort:** 30 minutes.

### MED-2: Live RLS coverage for cards + reviews — verify CI runs them
- **What:** PR #11 extended `test_stack_rls.py` from 3 cases to 7
  (added flashcard_cards + flashcard_reviews cross-user denial).
  The CI command must source `backend/.env.staging.test` for these to
  run; if it doesn't, the suite quietly skips and we lose coverage.
- **Action:** Confirm the CI pipeline does `set -a; source
  backend/.env.staging.test` before pytest.  Verify a recent CI run
  shows 7 RLS tests passing (not skipped).
- **Effort:** 15 minutes if CI is wired correctly; 1 hour if it isn't.

### MED-3: Admin generate-batch progress polling
- **What:** D1 admin generate-batch is a fire-and-forget background
  task; the frontend currently refreshes manually to see results.
  For 60-word batches the admin sometimes refreshes too early and
  thinks nothing happened.
- **Action:** Add `GET /admin/exercises/d1/generate-batch/{job_id}/status`
  + a small polling loop on the admin page.  The job_id format already
  exists from the Wave 2 backfill endpoint pattern.
- **Effort:** 2–3 hours.

### MED-4: Legacy vocab without topic — orphan classification UX
- **What:** Migration 028 backfilled `user_vocabulary.topic` from
  `sessions.topic`, but vocab manually added (or whose session itself
  had no topic) stays NULL forever.  The "Chưa phân loại" bucket
  catches them in flashcard filters, but there's no flow for the user
  to actually classify them.
- **Action:** Add a "Classify topic" inline editor on each card row
  in My Vocabulary.  Drop-down of distinct topics + free-text fallback.
  PATCH /api/vocabulary/bank/{id} already accepts arbitrary fields.
- **Effort:** 4–6 hours including the small pick-list endpoint.

---

## LOW (cleanup / polish)

### LOW-1: Hardcoded URL fallback sweep
- **What:** Audit Wave 2 caught the dead `localhost:8000` /
  `railway.app` fallback in `frontend/js/my-vocabulary.js`; PR #11
  removed it.  Other JS files may still carry the same pattern from
  earlier copy-paste.
- **Action:**
  ```bash
  grep -rn "localhost:8000\|railway.app" frontend/
  ```
  Remove every remaining match; everything should route through
  `window.api.base`.
- **Effort:** 30 minutes.

### LOW-2: Tailwind CDN in production
- **What:** `cdn.tailwindcss.com` logs a console warning in production
  ("should not be used in production").  Acceptable for the current
  project size; a real PostCSS pipeline isn't worth the maintenance
  cost yet.
- **Action:** Defer.  Revisit when the frontend grows past ~10 pages
  or build-step tooling appears for other reasons.
- **Effort:** 4–6 hours when we choose to do it.

### LOW-3: Missing favicon
- **What:** Browser console logs a 404 for `/favicon.ico`.  Cosmetic
  only.
- **Action:** Add a 16×16 + 32×32 favicon to `frontend/` root.
- **Effort:** 10 minutes.

### LOW-4: AUDIT_*.md clutter at repo root
- **What:** 11 audit reports live at the repo root from various
  rounds.  Useful for traceability but cluttering.
- **Action:** Move to `docs/audits/` or `audits/` and update any
  internal links.  Keep them in git history; do NOT edit the
  contents.
- **Effort:** 15 minutes.

### LOW-5: Local-only backup script
- **What:** `backend/scripts/backup_production.sh` runs nightly at
  03:00 via launchd, but only when the Mac is on.  Skips silently if
  the laptop is sleeping.
- **Action:** Defer.  When we need stronger guarantees, switch to
  a remote backup target (S3 / GCS) or use Supabase's own scheduled
  backup features.
- **Effort:** 2–3 hours.

---

## NICE_TO_HAVE (future enhancements)

### NTH-1: Audio pronunciation on flashcards
- IPA text is good; an actual TTS playback button would be better.
  Reuse the Google Cloud TTS service already wired for sample answers.
- Effort: 1–2 days.

### NTH-2: Image cards
- Visual learning aid for concrete nouns / scenes.  Adds a media
  layer to `user_vocabulary` and a render path on the back face.
- Effort: 2–3 days.

### NTH-3: Streak heatmap (Duolingo-style)
- Daily activity visualisation drawn from `flashcard_review_log`
  (already populated by every review).
- Effort: 1–2 days.

### NTH-4: Anki export / import
- Power-user request.  Anki CSV format is well-documented.
- Effort: 1 day.

### NTH-5: D3 — Speak with target (Phase E)
- Deferred from the original Wave 2 plan in favour of flashcards.
  Cost is the gate (~$190/mo at production speaking volume); a
  pricing tier or quota model is the prerequisite, not the code.
- Effort: 1 week to ship; pricing decision is a separate workstream.

### NTH-6: Reading + Listening modules
- Would reuse vocab bank + flashcard infrastructure.  Each module is
  its own ~2–3 weeks of design + build.

### NTH-7: Mobile native apps
- Mobile web works today but has no push notifications.  React Native
  would be the obvious port.  Effort: 1–2 months.

---

## Process improvements

### PROC-1: Plans must verify schema before referencing columns
- **Background:** Wave 2 plan referenced `user_vocabulary.topic` in
  §6 + §8; column didn't exist.  Caught at step 3 (mid-build) → had
  to add migration 028 mid-flight.
- **Action:** Update the Antigravity prompt template with a rule:
  "Before referencing any DB column in a plan, grep
  `backend/migrations/` to confirm it exists; flag a `+ALTER` need
  upfront if not."
- **Cost saved:** ~1 round-trip per future plan.

### PROC-2: Step-by-step commits + checkpoints proven valuable
- **Background:** Wave 2 used per-step commits with explicit user
  checkpoints (after step 1, step 4, step 9).  The pattern caught
  the topic red flag in step 3 — would have been much worse to
  discover in a single 50-file PR.
- **Action:** Adopt as the default for any future major wave.
- **Cost:** ~10% slower than batch shipping; pays back many times in
  audit cleanliness.

### PROC-3: Codex audit catches recur the same patterns
- **Background:** 8/10 audits found ≥1 finding (mostly MEDIUM).
  Recurring patterns:
  - Cross-file forgot-update (frontend entry point missed when a
    backend field was added).
  - RLS WITH CHECK missing on UPDATE policy.
  - Hardcoded URL fallback in frontend.
  - Inline transcript surfacing despite the "transcript is unreliable"
    rule (Wave 2 rich-content's first attempt).
- **Action:** Add pre-commit hooks for the mechanical ones (RLS
  WITH CHECK grep, hardcoded URL grep).  The cross-file forgets need
  human review; can't easily automate.
- **Effort:** 1–2 hours for the hooks.

### PROC-4: Live test infrastructure pays back
- **Background:** Phase B + Wave 1 + Wave 2 all shipped a setup
  script + 2-JWT live RLS tests on day 1, before feature code.
  Cost ~1 day per wave; benefit so far is 0 RLS bugs in production
  across three feature rollouts.
- **Action:** Continue.  Don't let a future wave skip this even
  under deadline pressure.

---

## Anti-pattern lessons (cumulative across phases)

These are codified into all Claude Code prompt templates today; listing
them here so a new collaborator can skim the prior-art:

1. **Fix hẹp** — Claude Code consistently fixes only the files mentioned
   in the prompt.  Always include an explicit "grep for X across the
   repo" step when adding a UI element / config / field.
2. **Migration always manual** — auto-deploy never touches the DB.
   Backup → migrate → deploy in that exact order.
3. **Live test infra from day 1** — setup script + RLS tests ship in
   the first commit of a wave, before feature code.
4. **Audit ≠ dogfood** — audit catches correctness, dogfood catches
   UX.  Wave 2 was clean on audit Round 1 and still surfaced 3 UX
   issues during the first day of dogfood.
5. **Symptoms ≠ root causes** — two independent bugs can produce the
   same symptom; resist the urge to ship a single fix that just
   silences the symptom.
6. **Page template parity** — every new page must carry the Supabase
   CDN + api.js + initSupabase trio.  `verify_page_parity.sh` enforces.
7. **Default-deny feature flags** — strict `is True` / `=== true` on
   both server and client; exception → False; default OFF in env.
8. **Service role only in admin / background** — user-facing routes
   use a JWT-scoped client.  RLS is the security layer; service-role
   bypasses it.
9. **Plans must verify schema before referencing a column** (added
   after Wave 2's `topic` red flag — see PROC-1).
10. **RLS UPDATE policies need both USING and WITH CHECK** (added
    after Phase B's 019b fix).
11. **No hardcoded URLs in frontend** — every fetch routes through
    `window.api.base` (added after Wave 2 audit found the dead
    `my-vocabulary.js` fallback).

---

## Pre-Phase D legacy items

These items predate Phase D and were tracked in the previous
`TECH_DEBT_BACKLOG.md`.  Folded in here so we have one debt doc, not
two; statuses preserved as-of the prior file.

### LEG-1: Full-test recovery after timeout *(High at the time)*
- `_bg_finalize_full_test()` has a grace period but isn't truly self-
  healing if grading finishes after the timeout window.  A slow full
  test can land in `analysis_failed` and need manual admin recovery.
- Suggested fix: safe re-finalize path for `submitted` /
  `analysis_failed` full-test sessions once all responses are graded;
  prefer automatic retry over manual repair.

### LEG-2: Token accumulation not atomic *(Medium)*
- `sessions.tokens_used` is additive but uses a read-then-write
  pattern.  Concurrent grading can lose increments.
- Suggested fix: atomic DB-side increment, OR document tokens_used
  as approximate.

### LEG-3: Grammar `compare_with` graph is asymmetric *(Medium)*
- Slug validity is fine; many `compare_with` relationships are still
  one-way.
- Suggested fix: content-integrity pass for reciprocal relationships,
  or decide that asymmetry is intentional.

### LEG-4: Grammar saved/viewed slug validation *(Medium)*
- `grammar_user_data` rows can accept arbitrary slugs without
  verifying article existence.  Orphan rows accumulate when slugs
  change.
- Suggested fix: validate at write time, or add a periodic cleanup.

### LEG-5: Legacy `responses.py` router *(Medium)*
- Audio-only response flow believed obsolete; final removal /
  quarantine decision pending.
- Suggested fix: confirm no production path depends on it, then
  remove or quarantine.

### LEG-6: Admin regrade / rebuild semantics *(Low–Medium)*
- Admin flows are honest, but naming and UX could be clearer about
  the difference between a full regrade, a partial repair, and a
  rebuild summary.
- Suggested fix: tighten admin labels, surface partial-failure
  states explicitly.

### LEG-7: Result pipeline readiness / recovery unification *(Low–Medium)*
- Readiness, completion, and recovery semantics work but some paths
  are practical rather than elegant.
- Suggested fix: centralise finalisation/recovery; keep all UI
  surfaces reading canonical `sessions.*` truth only.

### LEG-8: Grammar metadata pedagogy pass *(Low)*
- Metadata is structurally usable but not perfect.  Some pathways are
  broad; some `next_articles` are "related" rather than true next
  steps.
- Suggested fix: a future refinement focused on pedagogy, not
  structural correctness.

### LEG-9: Vocab + Grammar content loaders are separate copies *(Low — intentional)*
- `services/vocab_content.py` is a hand-adapted copy of
  `services/grammar_content.py`.  Parsing logic must be updated in two
  places.
- Suggested fix: extract a shared `BaseContentService`.  Phase B was
  the right time; can still happen any quiet refactor sprint.

### LEG-10: Phase B follow-ups *(Low)*
- Make `backend/scripts/setup_phase_b_test_env.sh` more ergonomic /
  fail-fast.
- Improve repeatability of staging / live verification workflow.
- Polish analytics + cost-observability for vocab extraction.
- Review CI path for staging-backed RLS checks.
- Clean up pytest async loop-scope warning (also visible in
  vocab-enrichment test runs).
- Review Supabase client deprecation warnings (`timeout`, `verify`).
