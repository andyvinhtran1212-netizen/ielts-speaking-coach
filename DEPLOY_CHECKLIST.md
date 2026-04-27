# Phase D Deploy Checklist

Use this checklist EVERY TIME deploying Phase D updates to production.
Default-OFF feature flags mean shipping the code is safe; the rollout step
gates real exposure to users.

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
