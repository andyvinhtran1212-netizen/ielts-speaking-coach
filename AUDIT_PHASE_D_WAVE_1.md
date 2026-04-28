# Audit Phase D Wave 1 — 2026-04-25

Branch: `feature/vocab-phase-d-wave-1-d1-admin`  
Commits reviewed: `2375fd7..031068b`  
Spec: `PHASE_D_V3_PLAN.md` (Wave 1 scope)

## Overall verdict

❌ BLOCK

Wave 1 ships a substantial amount of the intended surface: migrations 021/022 exist, the setup/parity scripts run, D1 UI pages are present, the admin review tab is wired, and the local regression suite is green. However, there are still blocking infrastructure mismatches against the Wave 1 spec. The biggest ones are that `022_vocabulary_exercise_attempts.sql` does not implement the required UPDATE `USING` + `WITH CHECK` policy shape, and the user-facing D1 routes still use `supabase_admin` instead of an RLS-scoped user client. On top of that, the mandatory live 2-JWT RLS verification could not run because the provided envs do not contain `RLS_TEST_USER_*`, so the branch does not satisfy the “no skip” live-RLS requirement.

## Status matrix

| Area | Status | Notes |
|------|--------|-------|
| 1.1 Migration 021 | ✅ | Schema, RLS enabled, policies, index, rollback comments verified on staging |
| 1.2 Migration 022 | ❌ | Only SELECT/INSERT policies exist; missing UPDATE policy with `USING` + `WITH CHECK` per spec |
| 2.1 setup script | ✅ | Executable, runs twice, idempotent, seeds 50 published D1 exercises |
| 2.2 page parity script | ✅ | Executable; passes for Wave 1 pages and skips Wave 2 page intentionally |
| 3 Rate limit | ⚠️ | Enforcement works in tests, but implemented as helper not decorator; tests do not prove DB-backed per-user/type UTC behavior |
| 4.1 Flag code | ✅ | `is_d1_enabled()` and `is_d3_enabled()` exist; strict `is True`; DB errors default-deny |
| 4.2 /auth/me | ✅ | Exposes `vocab_bank_enabled`, `d1_enabled`, `d3_enabled` |
| 4.3 Settings | ✅ | `D1_ENABLED=False`, `D3_ENABLED=False` by default |
| 5 D1 endpoints | ❌ | User-facing list/detail/attempt routes read/write via `supabase_admin`, not RLS-scoped client |
| 6 D1 grading | ✅ | Pure string match, trim + lowercase, no AI dependency |
| 7.1 Page parity | ✅ | New Wave 1 pages include Supabase CDN + `api.js` + `initSupabase()` |
| 7.2 Cross-file | ⚠️ | Dashboard/admin/my-vocabulary entry points updated, but `?vocab_id=` propagation is not consumed downstream |
| 7.3 URL handling | ⚠️ | Exercise entry links exist, but `vocab_id` is ignored and frontend still duplicates hardcoded base fallbacks |
| 8 Admin tool | ⚠️ | Review UI exists and tests pass locally, but generate-batch response shape misses spec `202 + job_id` |
| 9 Gemini gen | ✅ | Gemini call + validation + draft insert background pattern are present |
| 10 Phase B regression | ⚠️ UNVERIFIED | Local Phase B tests pass, but live Phase B RLS regression test also skipped due missing test-user env |
| Deploy checklist | ✅ | Exists at repo root and covers pre-deploy, DB, backend, frontend, rollout, smoke, dogfood |
| Anti-patterns | ❌ | Service-role in user routes + missing no-skip live RLS verification are still present |

## Findings

### [CRITICAL] - Migration 022 does not implement the required UPDATE `USING` + `WITH CHECK` RLS policy
- Location: [backend/migrations/022_vocabulary_exercise_attempts.sql:29-38](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/migrations/022_vocabulary_exercise_attempts.sql:29)
- Description:
  The spec requires `vocabulary_exercise_attempts` to have RLS with both `USING` and `WITH CHECK (auth.uid() = user_id)` semantics. The shipped migration only creates:
  - `SELECT USING (auth.uid() = user_id)`
  - `INSERT WITH CHECK (auth.uid() = user_id)`
  There is no UPDATE policy at all.
- Impact:
  This does not match the Wave 1 data-safety contract. Even if the app currently treats attempts as append-only, the migration is still missing the exact RLS shape that Wave 2 is supposed to reuse.
- Reproduction:
  Live policy query on staging returned only:
  - `vocab_attempts_select`
  - `vocab_attempts_insert`
  and no UPDATE policy.
- Suggested fix:
  Add an explicit UPDATE policy with both `USING (auth.uid() = user_id)` and `WITH CHECK (auth.uid() = user_id)`, then rerun the live 2-JWT reassign/update check.

### [HIGH] - User-facing D1 routes still bypass RLS by using `supabase_admin`
- Location: [backend/routers/exercises.py:119-125](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/exercises.py:119), [backend/routers/exercises.py:150-156](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/exercises.py:150), [backend/routers/exercises.py:189-195](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/exercises.py:189), [backend/routers/exercises.py:217-225](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/exercises.py:217)
- Description:
  The Wave 1 prompt explicitly requires user-facing exercise endpoints to use an RLS-scoped client and forbids service-role usage on user routes. The current implementation uses `supabase_admin` for:
  - listing published D1 exercises
  - fetching a D1 exercise by id
  - loading the answer on attempt submission
  - inserting attempt rows
- Impact:
  This bypasses the very RLS surface the migrations were designed to protect, and makes the live-RLS safety story inconsistent across the feature.
- Reproduction:
  `rg -n "supabase_admin" backend/routers/exercises.py` returns user-route call sites at lines `119`, `150`, `189`, `217`.
- Suggested fix:
  Use a user-scoped client for user-facing exercise routes and reserve `supabase_admin` for admin/background paths only.

### [HIGH] - Mandatory live 2-JWT RLS verification could not run without skipping
- Location: [backend/tests/test_exercise_rls.py:17-29](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/tests/test_exercise_rls.py:17), [backend/tests/test_rls_vocab_integration.py:17-32](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/tests/test_rls_vocab_integration.py:17)
- Description:
  The Wave 1 audit requires live RLS verification with 2 JWTs and explicitly says it must not be skipped. In the available staging env, `RLS_TEST_USER_A_*` and `RLS_TEST_USER_B_*` are not set, so both the new Phase D exercise RLS test and the Phase B regression RLS test auto-skip.
- Impact:
  This leaves the most important live isolation check unproven for Wave 1, and it also prevents full verification that Wave 1 did not break Phase B’s RLS guarantees.
- Reproduction:
  - `pytest tests/test_exercise_rls.py -rs` → 2 skipped
  - `pytest tests/test_rls_vocab_integration.py -v` → 3 skipped
- Suggested fix:
  Provide the required `RLS_TEST_USER_*` credentials in the staging audit env and rerun both suites without skip before merge.

### [MEDIUM] - Generate-batch endpoint does not match the specified `202 + job_id` contract
- Location: [backend/routers/exercises.py:422-447](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/exercises.py:422), [frontend/admin.html:3382-3385](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/admin.html:3382)
- Description:
  The spec calls for `POST /admin/exercises/d1/generate-batch` to return `{ job_id, status: "queued", estimated_cost_usd }` with a queued/background-job shape. The current route returns `200` with no `job_id`; the frontend only shows a text status message and waits 30 seconds.
- Impact:
  This is a backend/frontend contract drift. It does not break the core flow, but it weakens observability and makes future batch-status tracking harder.
- Reproduction:
  Route response fields are:
  - `status`
  - `requested_count`
  - `word_count`
  - `estimated_cost_usd`
  - `message`
  and no `job_id`.
- Suggested fix:
  Either update the spec/acceptance criteria, or return a real queued-job shape with `202` and `job_id`.

### [MEDIUM] - `Practice with this word` link is wired, but `vocab_id` is never consumed
- Location: [frontend/js/my-vocabulary.js:163-166](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/my-vocabulary.js:163)
- Description:
  The vocab bank now renders a `▶ practice` link to `exercises.html?vocab_id=<item.id>`, but no Wave 1 frontend or backend exercise code reads `vocab_id`. The parameter is effectively dead on arrival.
- Impact:
  This entry point looks complete in the UI but does not actually personalize the next step to the chosen vocab item.
- Reproduction:
  `rg -n "vocab_id" frontend/pages/exercises.html frontend/pages/d1-exercise.html frontend/js/d1-exercise.js backend/routers/exercises.py` only finds the link creation in `my-vocabulary.js`.
- Suggested fix:
  Either consume `vocab_id` end-to-end in the D1 queue/load flow, or remove the parameter until that behavior exists.

### [LOW] - Wave 1 frontend still duplicates hardcoded API fallbacks instead of relying solely on `api.js`
- Location: [frontend/pages/exercises.html:142-147](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/exercises.html:142), [frontend/js/d1-exercise.js:16-21](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/d1-exercise.js:16)
- Description:
  The Wave 1 pages still define their own `BASE` fallback using hardcoded localhost/Railway URLs rather than depending purely on `window.api.base`.
- Impact:
  This is not a correctness blocker by itself, but it repeats an anti-pattern the prompt explicitly asked to watch for.
- Reproduction:
  `rg -n "http://localhost:8000|https://ielts-speaking-coach-production.up.railway.app" frontend/pages frontend/js`
- Suggested fix:
  Standardize on `window.api.base` and keep the hardcoded fallback logic in one shared place only.

## Tests run

- `bash backend/scripts/verify_page_parity.sh`
  - Result: `SKIP: frontend/pages/d3-exercise.html (Wave 2)` then `Page parity OK (2 page(s) checked).`
- `cd backend && ../backend/venv/bin/python -m pytest tests/test_rate_limit.py tests/test_admin_exercise_review.py tests/test_d1_e2e.py tests/test_vocab_guards.py tests/test_grammar_smoke.py -q`
  - Result: `64 passed`
- `zsh -lc 'set -a; source backend/.env.staging; bash backend/scripts/setup_phase_d_test_env.sh'`
  - Result: pass, migrations applied, seeded `50` published D1 exercises
- Re-run idempotency:
  - `zsh -lc 'set -a; source backend/.env.staging; bash backend/scripts/setup_phase_d_test_env.sh'`
  - Result: pass, `already exists` notices, seed skipped because pool already has `50`
- Live schema verification:
  - `\d vocabulary_exercises`
  - `\d vocabulary_exercise_attempts`
  - `SELECT relname, relrowsecurity FROM pg_class ...`
  - Result: both tables exist, both have `relrowsecurity = true`
- Live policy verification:
  - `SELECT policyname, cmd, qual, with_check FROM pg_policies ...`
  - Result:
    - `vocabulary_exercises`: `SELECT` + `ALL` admin write
    - `vocabulary_exercise_attempts`: `SELECT` + `INSERT` only
- Live RLS tests:
  - `cd backend && ../backend/venv/bin/python -m pytest tests/test_exercise_rls.py -v`
  - Result: `2 skipped`
  - `cd backend && ../backend/venv/bin/python -m pytest tests/test_rls_vocab_integration.py -v`
  - Result: `3 skipped`

## Anti-pattern audit summary

Phase B đã 5 lần fix hẹp. Wave 1 có lặp lại không?

- Page thiếu init scripts: **PASS**
  - `verify_page_parity.sh` passed for Wave 1 pages
- Menu link chỉ ở 1 page: **PASS**
  - Dashboard, vocab bank, and admin entry points were all updated
- Hardcoded URL: **FAIL**
  - New pages still duplicate localhost/Railway fallback URLs
- Service_role trên user route: **FAIL**
  - `backend/routers/exercises.py` user routes use `supabase_admin`
- RLS thiếu WITH CHECK: **FAIL**
  - `vocabulary_exercise_attempts` has no UPDATE policy at all
- Default-allow flag: **PASS**
  - `is_d1_enabled()` / `is_d3_enabled()` use strict `is True`

## Merge recommendation

- ✅ APPROVE: 0 CRITICAL + 0 HIGH + no regression
- ⚠️ CONDITIONAL: 0 CRITICAL + ≤2 HIGH với fix path rõ
- ❌ BLOCK: ≥1 CRITICAL hoặc Phase B regression

**Current decision: ❌ BLOCK**

Why:
- Migration/RLS contract for `022_vocabulary_exercise_attempts` does not match spec
- User-facing D1 routes still bypass RLS via service-role reads/writes
- Mandatory live 2-JWT RLS verification did not run without skip
- Phase B live RLS regression therefore remains unverified in this audit environment

## Wave 2 readiness

Wave 2 dependencies that are already in place:
- `022_vocabulary_exercise_attempts` table exists
- rate-limit core exists and is reusable
- `d3_enabled` flag exists
- `/auth/me` already exposes `d3_enabled`
- parity script already tolerates/checks the Wave 2 page slot

But Wave 2 should **not** build on top of Wave 1 until these are fixed:
- `022` RLS policy shape must be corrected first, because Wave 2 D3 attempts will reuse the same table
- User-facing exercise routes should move off `supabase_admin` before D3 adds more sensitive flows
- Non-skipped live 2-JWT exercise RLS verification must be made runnable in staging
