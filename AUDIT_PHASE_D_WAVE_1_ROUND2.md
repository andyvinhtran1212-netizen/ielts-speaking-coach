# Audit Phase D Wave 1 — Round 2

Branch: `feature/vocab-phase-d-wave-1-d1-admin`  
Scope: re-audit after fix (`022b` RLS, user-route RLS client, live 2-JWT test, `generate-batch`, `vocab_id`, hardcoded URL, Phase B regression)

## Overall verdict

**APPROVE**

The blocking Wave 1 issues from Round 1 are now closed. The `022b` fix-forward migration adds the missing `UPDATE` policy with both `USING` and `WITH CHECK`, the user-facing D1 routes now use a JWT-scoped Supabase client instead of `supabase_admin`, and the previously skipped live 2-JWT RLS suites now run and pass against staging when executed outside the sandbox. Phase B regression checks also pass. One low-priority frontend fallback remains in `my-vocabulary.js`, but it does not affect the merge gate for this round.

## Status matrix

| Item | Status | Notes |
|------|--------|-------|
| 1. CRITICAL — `022b` RLS UPDATE + WITH CHECK applied | ✅ | `backend/migrations/022b_fix_attempts_rls_update_policy.sql` adds `FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)` |
| 2. HIGH — User routes no longer use `supabase_admin` | ✅ | D1 list/detail/attempt now use `_user_sb(_bearer_token(...))` |
| 3. HIGH — Live 2-JWT test runs, not skip | ✅ | `tests/test_exercise_rls.py` and `tests/test_rls_vocab_integration.py` both ran and passed on staging outside sandbox |
| 4. MEDIUM — `generate-batch` returns `202 + job_id` | ✅ | Admin route now has `status_code=202` and returns `job_id` |
| 5. MEDIUM — `vocab_id` param removed | ✅ | `my-vocabulary.js` now links to `exercises.html` without dead `?vocab_id=` |
| 6. LOW — Hardcoded URL removed | ⚠️ | D1 pages use `window.api.base`, but `frontend/js/my-vocabulary.js` still carries a local fallback |
| 7. Phase B no regression | ✅ | `test_vocab_guards.py`, `test_grammar_smoke.py`, and live `test_rls_vocab_integration.py` passed |

## Findings

### [LOW] - `my-vocabulary.js` still duplicates API base fallback
- Location: [frontend/js/my-vocabulary.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/my-vocabulary.js:6)
- Description: The D1 pages now rely on `window.api.base`, but `my-vocabulary.js` still falls back to hardcoded localhost/Railway URLs when `window.api` is missing.
- Impact: This leaves one remaining copy of environment routing logic, which is exactly the drift pattern Wave 1 was trying to reduce. It does not affect the corrected D1 routes or the live RLS behavior.
- Reproduction: `rg -n "http://localhost:8000|https://ielts-speaking-coach-production.up.railway.app" frontend/js/my-vocabulary.js`
- Suggested fix: Swap `my-vocabulary.js` to require `api.js` and use `window.api.base` only.

## What was verified

- `022b` fix-forward migration contents: [backend/migrations/022b_fix_attempts_rls_update_policy.sql](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/migrations/022b_fix_attempts_rls_update_policy.sql:12)
- User routes now use JWT-scoped client:
  - [backend/routers/exercises.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/exercises.py:54)
  - [backend/routers/exercises.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/exercises.py:127)
  - [backend/routers/exercises.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/exercises.py:164)
  - [backend/routers/exercises.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/exercises.py:197)
- `generate-batch` now returns queued shape with `job_id` and `202`:
  - [backend/routers/exercises.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/exercises.py:456)
- Dead `vocab_id` link removed:
  - [frontend/js/my-vocabulary.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/my-vocabulary.js:163)

## Tests run

- `zsh -lc 'set -a; source backend/.env.staging; bash backend/scripts/setup_phase_d_test_env.sh'`
  - Passed; applied `021`, `022`, `022b`, verified tables, seeded/kept `50` D1 exercises, auto-created RLS test users.
- `zsh -lc 'set -a; source backend/.env.staging; source backend/.env.staging.test; cd backend && ../backend/venv/bin/python -m pytest tests/test_exercise_rls.py -v'` (outside sandbox)
  - `2 passed`
- `zsh -lc 'set -a; source backend/.env.staging; source backend/.env.staging.test; cd backend && ../backend/venv/bin/python -m pytest tests/test_rls_vocab_integration.py -v'` (outside sandbox)
  - `3 passed`
- `cd backend && ../backend/venv/bin/python -m pytest tests/test_vocab_guards.py tests/test_grammar_smoke.py -q`
  - `38 passed`
- `cd backend && ../backend/venv/bin/python -m pytest tests/test_admin_exercise_review.py -q`
  - `5 passed`

## Merge recommendation

**APPROVE**

All re-audit scope items that could block Wave 1 are resolved, and there is no Phase B regression in the tested surface. The remaining hardcoded fallback in `my-vocabulary.js` should be tracked as low-priority cleanup, not as a Wave 1 blocker.
