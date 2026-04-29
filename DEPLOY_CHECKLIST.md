# IELTS Speaking Coach — Production Deploy Checklist

Use this checklist EVERY TIME deploying changes to production.  Each
phase has its own section; the steps within follow the same pattern
(pre-deploy → backup + migrations → backend env → frontend → rollout →
smoke + dogfood → rollback).  Default-OFF feature flags mean shipping
code is safe; the rollout step gates real exposure to users.

> **Phases shipped (in order applied):**
> 1. Phase A — Core speaking + grammar (no checklist section here; pre-dates this doc)
> 2. **Phase B — Personal Vocab Bank** (§B.0–B.7 below)
> 3. **Phase D Wave 1 — D1 fill-blank** (§0–§8 below — keeps the original numbering)
> 4. **Phase D Wave 2 — Flashcard system** (§W2.0–W2.8)
> 5. **Phase D Wave 2 — Rich content (migration 029)** (§RC.1–RC.7)
>
> No-migration patches that did not need a separate section but are
> recorded here for traceability:
> - **D1 session-based redesign** (migrations 023 + 024) — see §0 line.
> - **D1 generate-batch chunking fix** — code-only; backend redeploy.
> - **Wave 2 audit fixes** (PR #11) — code-only patch (`__uncategorized__`
>   topic sentinel + extended live RLS suite + URL-fallback removal).
>   No env / migration steps; just a Railway redeploy.
> - **Wave 2 flashcard UX fixes** (PR #12) — code-only frontend patch
>   (transcript hidden, optimistic rating, no flip-gate).  No backend
>   change; just a Vercel/GitHub Pages redeploy.

---

## Health-check verification (every deploy)

Universal post-deploy probe.  Run this immediately after Railway promotes
the new image, before the per-phase smoke tests below.

- [ ] Liveness:
  ```bash
  curl -fsS https://ielts-speaking-coach-production.up.railway.app/health
  ```
  Expect `{"status":"ok",...}`.  A non-200 here means the container did
  not boot — check Railway logs and abort the rollout.

- [ ] Readiness (DB + migrations + Gemini key + feature flags in one shot):
  ```bash
  curl -fsS https://ielts-speaking-coach-production.up.railway.app/health/ready | jq
  ```
  Expect `status: "ok"` overall and every block under `checks` reading
  ok.  A `degraded` here is informational, but the specific block tells
  you what to fix:
  - `checks.database.status: fail` → service-role key or DB URL is wrong.
  - `checks.migrations.missing` populated → a required migration didn't
    apply against production Postgres.
  - `checks.gemini_api.status: missing_key` → `GEMINI_API_KEY` not set
    in Railway env (D1 generation + vocab enrichment will silently
    degrade).
  - `checks.feature_flags` block confirms which flags Railway thinks
    are on — handy when a dogfooder reports "X doesn't work".

- [ ] (Optional) Wire `/health` into the Railway service healthcheck so
      a future bad deploy fails the rollout instead of serving 5xx:
      Railway → Service → Settings → Healthcheck Path = `/health`,
      Timeout = 5s.

### Whisper transcript leak verification

Run after any change to `services/whisper.py` or its `_VERBATIM_PROMPT`.
Phase 2.5 dogfood Day 2 caught a production transcript with the old
instruction prompt echoed three times at the head of the output;
whisper-1 treats the prompt as style context, not as instructions.

- [ ] Record one short test session.
- [ ] Inspect the resulting `sessions.transcript` row:
  ```sql
  SELECT id, transcript
  FROM sessions
  WHERE user_id = '<your_uuid>'
  ORDER BY started_at DESC
  LIMIT 1;
  ```
- [ ] Confirm NONE of these phrases appear anywhere in the transcript:
  - `Transcribe every word`
  - `Do not fix grammar`
  - `exactly as spoken`
- [ ] If the phrases still appear → escalate (Whisper API regression,
      not the prompt).  Otherwise the leak is gone.

---

## Phase B — Personal Vocab Bank

Vocab Bank shipped behind `VOCAB_BANK_FEATURE_FLAG_ENABLED` + per-user
`feature_flags.vocab_enabled`.  Three audit rounds + a post-dogfood
remediation pass landed before this section was finalised.

### B.0 Scope

- [ ] Migrations 019, 019b, 020 applied (idempotent — adds
      `users.feature_flags`, creates `user_vocabulary` with RLS, fixes
      the WITH CHECK lesson on UPDATE policy, then the post-dogfood
      improvements migration).
- [ ] `VOCAB_BANK_FEATURE_FLAG_ENABLED` known **OFF** in production
      unless this deploy is rolling out to admin / beta.
- [ ] Anthropic key (Haiku for the extractor) provisioned on Railway.

### B.1 Pre-deploy

- [ ] Branch up to date with `main`, no merge conflicts.
- [ ] Local test suite green:
  ```bash
  cd backend && python3 -m pytest \
    tests/test_vocab_guards.py tests/test_grammar_smoke.py \
    tests/test_rls_vocab_integration.py -q
  ```
- [ ] Page parity: `bash backend/scripts/verify_page_parity.sh`.
- [ ] PR approved.

### B.2 Database (production Supabase)

- [ ] **BACKUP CREATED** in Supabase Dashboard.
- [ ] Apply migrations IN ORDER:
  ```bash
  source backend/.env
  psql "$DATABASE_URL" -f backend/migrations/019_user_vocabulary.sql
  psql "$DATABASE_URL" -f backend/migrations/019b_fix_rls_update_policy.sql
  psql "$DATABASE_URL" -f backend/migrations/020_vocab_bank_dogfood_improvements.sql
  ```
  Or wrapper:
  ```bash
  bash backend/scripts/setup_phase_b_test_env.sh
  ```
- [ ] Verify `\d user_vocabulary` exposes the columns + a CHECK on
      `source_type IN ('used_well','needs_review','upgrade_suggested','manual')`.
- [ ] Verify RLS — every UPDATE policy has `USING + WITH CHECK`:
  ```sql
  SELECT policyname, cmd,
         (qual IS NOT NULL)       AS has_using,
         (with_check IS NOT NULL) AS has_with_check
    FROM pg_policies
   WHERE tablename = 'user_vocabulary'
   ORDER BY cmd, policyname;
  ```

### B.3 Backend (Railway)

- [ ] `VOCAB_BANK_FEATURE_FLAG_ENABLED=true` (global gate; per-user flag
      still required).
- [ ] `VOCAB_ANALYSIS_ENABLED=true` (turns on Claude Haiku extraction in
      the grading pipeline; default OFF so extraction stays opt-in).
- [ ] Wait for Railway redeploy.
- [ ] Smoke `/auth/me` exposes `vocab_bank_enabled: false` for a user
      without the per-user flag (proves the field is plumbed).

### B.4 Frontend (Vercel/GitHub Pages)

- [ ] Wait auto-deploy.
- [ ] Logged-out / non-flagged user sees zero vocab UI (link absent
      from dashboard nav).

### B.5 Feature flag rollout

```sql
UPDATE users
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb)
                     || '{"vocab_enabled": true}'::jsonb
 WHERE email = 'YOUR_ADMIN_EMAIL';
```

- [ ] Re-run `/auth/me` for the admin → `vocab_bank_enabled: true`.
- [ ] After dogfood gates pass, expand to beta + 5 users (per
      `PHASE_B_V3_PLAN.md §rollout`).

### B.6 Smoke E2E

- [ ] Practice a Speaking session → grading completes → background
      vocab extraction logs land in Railway (`[vocab_bg] persisted N/M`).
- [ ] My Vocabulary page lists the new entries grouped by `source_type`.
- [ ] Filter / archive / report flows all work.
- [ ] Admin monitoring dashboard shows the FP-rate gate state.

### B.7 Dogfood + rollback

Dogfood gate: FP rate < 15% over a 1-week window before broader rollout.
Session 1 came in at 37% → triggered the post-dogfood remediation
(migration 020 + the ROUND2 audit).  Dogfood session 2 still pending —
tracked as HIGH-2 in `TECH_DEBT.md`.

Rollback: `VOCAB_BANK_FEATURE_FLAG_ENABLED=false` → all users see the
flag absent; UI hides.  DDL rollback only if absolutely required (the
data is the user's own vocab — losing it is bad form).

---

## 0. Scope of this deploy

- [ ] Wave 1 (D1 fill-blank + admin review tool) only
- [ ] Wave 2 (D3 speak-with-target) — NOT in this deploy
- [ ] Migrations 021, 022 applied (idempotent)
- [ ] Feature flags `D1_ENABLED` / `D3_ENABLED` known to be **OFF** in production env unless explicitly toggled

---

## 1. Pre-deploy

- [ ] Branch up to date with `main`, no merge conflicts
- [ ] Local test suite green:
  ```bash
  cd backend && ../backend/venv/bin/python -m pytest tests/test_d1_e2e.py tests/test_rate_limit.py tests/test_admin_exercise_review.py tests/test_vocab_guards.py tests/test_grammar_smoke.py -q
  ```
- [ ] Page parity green:
  ```bash
  bash backend/scripts/verify_page_parity.sh
  ```
- [ ] Code review approved on PR (no merge to main without it)

## 2. Database (production Supabase)

- [ ] **BACKUP CREATED** in Supabase Dashboard (timestamp it in PR)
- [ ] Apply migrations IN ORDER (024 references d1_sessions which 023 creates):
  ```bash
  source backend/.env
  psql "$DATABASE_URL" -f backend/migrations/021_vocabulary_exercises.sql
  psql "$DATABASE_URL" -f backend/migrations/022_vocabulary_exercise_attempts.sql
  psql "$DATABASE_URL" -f backend/migrations/022b_fix_attempts_rls_update_policy.sql
  psql "$DATABASE_URL" -f backend/migrations/023_d1_sessions.sql                   # session-based redesign
  psql "$DATABASE_URL" -f backend/migrations/024_attempts_session_link.sql         # session-based redesign
  ```
  Or run the wrapper that applies all five + seeds the D1 pool + provisions
  RLS test users on first run:
  ```bash
  bash backend/scripts/setup_phase_d_test_env.sh
  ```
- [ ] Verify schema:
  ```bash
  psql "$DATABASE_URL" -c "\dt vocabulary_exercises"
  psql "$DATABASE_URL" -c "\dt vocabulary_exercise_attempts"
  psql "$DATABASE_URL" -c "\dt d1_sessions"
  psql "$DATABASE_URL" -c "\d vocabulary_exercises"           | grep -E 'status|exercise_type|content_payload'
  psql "$DATABASE_URL" -c "\d vocabulary_exercise_attempts"   | grep -E 'user_id|exercise_id|attempted_at|session_id'
  psql "$DATABASE_URL" -c "\d d1_sessions"                    | grep -E 'user_id|exercise_ids|status|completed_at'
  # All four RLS policies on attempts present (select + insert + update from 022b):
  psql "$DATABASE_URL" -c "SELECT policyname, cmd FROM pg_policies WHERE tablename='vocabulary_exercise_attempts'"
  # All three RLS policies on d1_sessions:
  psql "$DATABASE_URL" -c "SELECT policyname, cmd FROM pg_policies WHERE tablename='d1_sessions'"
  ```
- [ ] Idempotency re-check (re-run all migrations, expect `NOTICE ... already exists, skipping` and zero errors)

## 3. Backend (Railway)

- [ ] Confirm env vars match defaults:
  - `D1_ENABLED` — `true` only when ready to expose D1 (per-user gate still applies)
  - `D3_ENABLED` — keep `false` for Wave 1
  - `D1_DAILY_LIMIT` — default 100 is fine
  - `D3_DAILY_LIMIT_FREE` — default 3 (unused in Wave 1 but read by services/rate_limit if D3 ever turns on)
  - `D1_GENERATION_MODEL` — default `gemini-1.5-flash`; only override if cost shifts
- [ ] Wait for Railway auto-deploy
- [ ] Smoke test:
  ```bash
  curl -H "Authorization: Bearer <admin-jwt>" https://<railway>/auth/me | jq '.d1_enabled, .d3_enabled, .role'
  ```
  Expect both flags `false` for any user that hasn't been opted in via `users.feature_flags.d1_enabled`.

## 4. Frontend (Vercel)

- [ ] Wait for Vercel auto-deploy
- [ ] Smoke test in Incognito:
  - [ ] Login as admin, dashboard loads, no console errors
  - [ ] "Exercises" link is **hidden** until the user is opted in (default-deny check)
  - [ ] Admin panel → "🎯 Vocab Exercises" tab loads without errors

## 5. Feature flag rollout (per PHASE_D_V3_PLAN §15)

Flag enabled for the admin email only initially:
```sql
UPDATE users
SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"d1_enabled": true}'::jsonb
WHERE email = 'YOUR_ADMIN_EMAIL';
```
- [ ] Re-run smoke test as that admin: Exercises link now visible, hub loads, D1 card is "Live", D3 card is "Coming soon"
- [ ] After Wave-1 dogfood passes, expand to ≤3 admins, then ≤5 beta users (per plan §15)

## 6. Smoke test end-to-end (with at least one admin opted in)

- [ ] Admin → Vocab Exercises tab → Generate batch (5–10 words)
- [ ] Wait ~30s, refresh, see drafts populated
- [ ] Open one draft, verify sentence + answer + 3 distractors
- [ ] Publish 1 draft → row disappears from Drafts list, Status filter "Published" shows it
- [ ] Switch to non-admin browser session (or logout/login as user) with `d1_enabled=true`
- [ ] Dashboard → Exercises → Fill the blank → see published exercise in queue
- [ ] Submit a correct answer → green banner + Next reveals
- [ ] Submit a wrong answer → red banner + correct answer revealed
- [ ] No errors in browser console; no errors in Railway logs

## 7. Dogfood (≥1 day, end-to-end)

- [ ] Single admin uses the full flow for one full day
- [ ] Capture issues in `DOGFOOD_D_NOTES.md` (UX bugs, broken links, perceived FP)
- [ ] Decide: expand to beta / fix issues / proceed to Wave 2

## 8. Rollback (only if needed)

- [ ] Set `D1_ENABLED=false` in Railway → /auth/me returns `d1_enabled=false` for everyone, frontend cards disappear
- [ ] If migration must be reverted, run the rollback blocks at the bottom of the migration files (commented out by default — copy-paste manually)

---

# Phase D Wave 2 — Flashcards

Wave 2 ships the Flashcards feature (manual stacks + auto-stacks +
SRS).  D3 (speak-with-target) is **deferred to Phase E** — do not enable
`D3_ENABLED` as part of this deploy.

`FLASHCARD_ENABLED` defaults OFF; shipping the code is safe, the rollout
step gates real exposure.

## W2.0 Scope

- [ ] Migrations 025, 026, 027, 028 applied (idempotent)
- [ ] `FLASHCARD_ENABLED` known to be **OFF** in production env unless explicitly toggled

## W2.1 Pre-deploy

- [ ] Branch `feature/phase-d-wave-2-flashcards` rebased on `main`
- [ ] Local test suite green:
  ```bash
  cd backend && python3 -m pytest \
    tests/test_srs_algorithm.py \
    tests/test_flashcard_e2e.py \
    tests/test_due_queue.py \
    tests/test_rate_limit.py \
    tests/test_d1_e2e.py \
    tests/test_d1_session.py \
    tests/test_vocab_guards.py \
    -q
  ```
- [ ] Live RLS test (must NOT skip):
  ```bash
  set -a; source backend/.env.staging.test
  python3 -m pytest backend/tests/test_stack_rls.py -v
  ```
- [ ] Page parity green:
  ```bash
  bash backend/scripts/verify_page_parity.sh
  ```
- [ ] PR approved (no merge to main without it)

## W2.2 Database (production Supabase)

- [ ] **BACKUP CREATED** in Supabase Dashboard (timestamp it in the PR)
- [ ] Apply migrations IN ORDER (026 references 025; 028 backfills `topic` from `sessions`):
  ```bash
  source backend/.env
  psql "$DATABASE_URL" -f backend/migrations/025_flashcard_stacks.sql
  psql "$DATABASE_URL" -f backend/migrations/026_flashcard_cards.sql
  psql "$DATABASE_URL" -f backend/migrations/027_flashcard_reviews.sql
  psql "$DATABASE_URL" -f backend/migrations/028_user_vocab_topic.sql
  ```
  Or use the wrapper:
  ```bash
  bash backend/scripts/setup_phase_d_wave_2_test_env.sh
  ```
- [ ] Verify schema + RLS (the wrapper prints this; manual run below):
  ```bash
  psql "$DATABASE_URL" -c "\dt flashcard_stacks flashcard_cards flashcard_reviews flashcard_review_log"
  psql "$DATABASE_URL" -c "\d user_vocabulary" | grep -E 'topic'
  psql "$DATABASE_URL" <<'SQL'
  SELECT tablename, policyname, cmd,
         (qual IS NOT NULL) AS has_using,
         (with_check IS NOT NULL) AS has_with_check
    FROM pg_policies
   WHERE tablename IN ('flashcard_stacks','flashcard_cards','flashcard_reviews','flashcard_review_log')
   ORDER BY tablename, cmd, policyname;
  SQL
  ```
  Every UPDATE policy must show `has_using=t` AND `has_with_check=t`; every INSERT policy must show `has_with_check=t`.

## W2.3 Backend (Railway)

- [ ] Add env var `FLASHCARD_ENABLED=true` (global gate; per-user flag still required)
- [ ] (Optional) override `FLASHCARD_DAILY_REVIEW_LIMIT` if 500/day not desired
- [ ] Wait for Railway redeploy to finish
- [ ] Smoke test the global flag is plumbed:
  ```bash
  curl -H "Authorization: Bearer <admin JWT>" https://<api>/auth/me | jq .flashcard_enabled
  ```
  Expect `false` (per-user flag still off) — confirms the field exists.

## W2.4 Frontend (Vercel/GitHub Pages)

- [ ] Wait for auto-deploy
- [ ] Smoke test in Incognito (logged out): Flashcards link absent from dashboard nav

## W2.5 Feature flag rollout

- [ ] Enable for one admin first:
  ```sql
  UPDATE users
     SET feature_flags = COALESCE(feature_flags, '{}'::jsonb)
                       || '{"flashcard_enabled": true}'::jsonb
   WHERE email = 'YOUR_ADMIN_EMAIL';
  ```
- [ ] Re-run `/auth/me` for that admin → `flashcard_enabled: true`
- [ ] After Wave-2 dogfood passes (≥1 day), expand to ≤3 admins, then ≤5 beta users (plan §10)

## W2.6 Smoke test E2E (admin opted in)

- [ ] Dashboard nav shows "📚 Flashcards" tab; sub-text "Ôn từ vựng theo SRS" or "🔥 N thẻ đến hạn"
- [ ] Click Flashcards → list shows 3 auto-stacks ("Tất cả từ vựng", "Mới thêm gần đây", "Cần ôn tập") + any manual stacks
- [ ] Click "Tất cả từ vựng" → study page loads cards; tap to flip; rate "Tốt" → next card
- [ ] Complete a session → summary screen with breakdown (Quên/Khó/Tốt/Dễ)
- [ ] "+ Tạo stack mới" → modal opens; pick category "needs_review"; live preview shows count + headwords; Save → redirect to study page with the new stack
- [ ] My Vocabulary → vocab card → "📚 +Stack" → picker modal → select stack → green toast "Đã thêm"
- [ ] Repeat the same vocab → blue toast "Đã có trong …"
- [ ] Exercises hub shows "Flashcards" Live card
- [ ] No errors in browser console; no 5xx in Railway logs

## W2.7 Dogfood (≥1 day, end-to-end)

- [ ] Single admin uses the full flow for one full day (≥10 reviews)
- [ ] Capture issues in `DOGFOOD_FLASHCARD_NOTES.md`
- [ ] Decide: expand to beta / fix issues / proceed to Phase E (D3)

## W2.8 Rollback

- [ ] Set `FLASHCARD_ENABLED=false` in Railway → all users see `flashcard_enabled=false`, every entry point removes the link from the DOM
- [ ] If migrations must be reverted, run the `ROLLBACK SCRIPT` blocks (commented out) at the bottom of 025 → 028 (drop in REVERSE order: 028 first, then 027/026/025; flashcard_review_log is inside 027's rollback block)
- [ ] Migration 028 (user_vocabulary.topic) backfill is destructive on rollback — running the rollback drops the column.  If you only need to disable the feature, prefer `FLASHCARD_ENABLED=false` over rolling back DDL.

---

# Phase D Wave 2 — Flashcard Rich Content (migration 029)

Adds `user_vocabulary.ipa` + `user_vocabulary.example_sentence` so the
flashcard back face can show vetted reference material instead of the
learner's own (potentially ungrammatical) transcript.  No behavior
gate — this rolls out alongside the existing FLASHCARD_ENABLED flag.

## RC.1 Pre-deploy

- [ ] Branch `feature/flashcard-rich-content` rebased on `main`
- [ ] Local test suite green:
  ```bash
  cd backend && python3 -m pytest \
    tests/test_vocab_enrichment.py \
    tests/test_srs_algorithm.py \
    tests/test_flashcard_e2e.py \
    tests/test_due_queue.py \
    tests/test_rate_limit.py \
    tests/test_vocab_guards.py \
    -q
  ```
- [ ] Live RLS suite still green (no schema changes to flashcard_* tables):
  ```bash
  set -a; source backend/.env.staging.test
  pytest backend/tests/test_stack_rls.py -v
  ```
- [ ] Page parity green

## RC.2 Database (production Supabase)

- [ ] **BACKUP CREATED** in Supabase Dashboard
- [ ] Apply migration:
  ```bash
  source backend/.env
  psql "$DATABASE_URL" -f backend/migrations/029_user_vocab_ipa_example.sql
  ```
- [ ] Verify columns:
  ```bash
  psql "$DATABASE_URL" -c "\d user_vocabulary" | grep -E 'ipa|example_sentence'
  ```
  Expect both columns nullable, no default.

## RC.3 Backend (Railway)

- [ ] Confirm `GEMINI_API_KEY` is set in Railway (re-used from D1 generation)
- [ ] (Optional) confirm `D1_GENERATION_MODEL` knob — vocab enrichment uses
      the same model variable
- [ ] Wait for Railway redeploy to finish
- [ ] Smoke that the new admin endpoint mounts:
  ```bash
  curl -X POST -H "Authorization: Bearer <admin JWT>" \
       "https://<api>/admin/vocab/backfill-enrichment?limit=1"
  ```
  Expect 200 with `{job_id, status: "queued", estimated_cost_usd, …}`.

## RC.4 Frontend (Vercel/GitHub Pages)

- [ ] Wait auto-deploy
- [ ] In study session, verify back card shows headword + IPA banner +
      example block when the row has those fields populated.

## RC.5 Backfill (recommended, not required)

The endpoint caps at 500/call so an admin can drain in batches:
- [ ] Run once with `limit=100` for a sanity check, watch Railway logs
      for `[backfill <job_id>]` lines
- [ ] If cost + content quality look right, repeat with `limit=500` until
      no more rows return.  The endpoint is idempotent — already-enriched
      rows are excluded by the `or_("ipa.is.null,example_sentence.is.null")`
      filter.

```bash
curl -X POST -H "Authorization: Bearer <admin JWT>" \
     "https://<api>/admin/vocab/backfill-enrichment?limit=500"
```

Cost estimate per call (returned in response): ~$0.0005 × (limit/10).
500-card batch ≈ $0.025.

## RC.6 Smoke E2E

- [ ] Practice a Speaking session, wait for vocab extraction to land
- [ ] Open Vocab Bank — newly extracted rows include IPA + example
- [ ] Open Flashcards study session — back card shows the new fields
- [ ] Vocab missing IPA still renders correctly (graceful skip on the IPA
      banner; example block hidden; "Xem câu gốc" still works)
- [ ] No errors in browser console; no 5xx in Railway logs

## RC.7 Rollback

- [ ] Pure-additive migration, no behavior gate.  To roll back:
      uncomment the `DROP COLUMN` block at the bottom of
      `backend/migrations/029_user_vocab_ipa_example.sql` and run.
      Frontend tolerates NULL gracefully — old card layout returns.
- [ ] Inline Phase B integration is fail-soft already; no env flag to
      flip.  If Gemini quota is the concern, set a low daily quota in
      Google Cloud Console rather than reverting code.
