# Audit D1 Session Redesign — 2026-04-27

Branch: `feature/d1-session-based-redesign`  
Commits: `ec61d47..52b9e9a`  
Spec: `PROMPT_CLAUDE_CODE_D1_SESSION_FINAL.md` (not present locally; audited against the user-provided checklist plus [PHASE_D_V3_PLAN.md](/Users/trantrongvinh/Documents/ielts-speaking-coach/PHASE_D_V3_PLAN.md))

## Overall verdict

**CONDITIONAL**

The redesign gets the hard parts mostly right: migrations `023` and `024` are live-applicable and idempotent, `d1_sessions` has the expected RLS shape with `UPDATE ... USING + WITH CHECK`, user-facing D1 routes stay on JWT-scoped clients, and both Phase B and Wave 1 regression suites still pass, including live 2-JWT tests on staging. The main remaining issue is a real summary-correctness bug in the new fire-and-forget session flow: if one or more `/attempt` writes fail, the UI can still end the session successfully but then overwrite the correct local summary with an incomplete backend summary. There is also a test-infrastructure gap: the branch does not ship the promised automated live `test_session_rls_isolation` case for `d1_sessions`, even though manual live probes confirmed the table is isolated correctly.

## Status matrix

| Area | Status | Notes |
|------|--------|-------|
| 1.1 Migration 023 schema | ✅ | Table, columns, status CHECK, index, rollback comments all present |
| 1.2 Migration 023 RLS | ✅ | Live staging query shows SELECT, INSERT, UPDATE; UPDATE has both `qual` and `with_check` |
| 2 Migration 024 | ✅ | `session_id` column + `ON DELETE SET NULL` + partial index; re-apply clean on second setup run |
| 3.1 POST /sessions | ✅ | Auth + flag + `_user_sb`; prefers unattempted, falls back, returns `answer` |
| 3.2 GET /sessions/{id} | ✅ | JWT-scoped and returns session row + linked attempts |
| 3.3 POST /sessions/{id}/complete | ⚠️ | Correctly updates/stamps session, but summary can drift if prior fire-and-forget `/attempt` posts failed |
| 3.4 POST /attempt backwards compat | ✅ | `session_id` optional; legacy path still works; backend still grades authoritatively |
| 3.5 PATCH /unpublish | ✅ | Admin-only route exists; unit test verifies non-admin 403 |
| 4 Local grading security | ✅ | Trade-off documented; answer revealed only for published D1; backend POST remains authoritative and rate-limited |
| 5.1-5.4 Frontend refactor | ⚠️ | Session/start/progress/review flow is solid, but summary fallback is incomplete when attempt sync fails |
| 6 Admin tab filter | ✅ | Draft/Published/Rejected tabs, counts, and Unpublish action are wired in admin UI |
| 7 Tests | ⚠️ | Local suite passes, but `test_session_rls_isolation` is missing from `test_d1_session.py`; live session RLS had to be verified manually |
| 8 Phase B/Wave 1 regression | **NO REGRESSION** | `73` local tests passed; live `test_exercise_rls.py` and `test_rls_vocab_integration.py` passed |
| Anti-patterns | ✅ | Page parity passes; user routes avoid `supabase_admin`; default-deny flags remain strict |

## Findings

### [HIGH] - Summary screen can undercount when fire-and-forget `/attempt` writes fail
- Location: [frontend/js/d1-exercise.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/d1-exercise.js:227), [frontend/js/d1-exercise.js](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/js/d1-exercise.js:253), [backend/routers/exercises.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/exercises.py:328), [backend/routers/exercises.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/exercises.py:571)
- Description: The new UX grades locally and sends `/attempt` in fire-and-forget mode. If one or more of those writes fail, the UI still progresses and records the answer in `_session.attempts`, but `showSummary()` will replace the correct local summary with the backend result whenever `/complete` returns `200`. The backend summary is derived only from persisted `vocabulary_exercise_attempts` rows linked to `session_id`, so failed writes disappear from the final score/lists.
- Impact: Users can finish a 10-question session and still see an incorrect summary or persisted `correct_count` if the network flakes during one or more answers. This directly undermines the redesign’s summary-screen goal.
- Reproduction: Force `/api/exercises/d1/{id}/attempt` to fail for one answer (offline tab, devtools request blocking, or temporary `500`), then let `/api/exercises/d1/sessions/{id}/complete` succeed. The user-visible summary will be computed from fewer attempts than the local session actually contains.
- Suggested fix: Track attempt-sync failures client-side and prefer `computeLocalSummary()` whenever any attempt POST failed, or reconcile `/complete` against the local attempt list before replacing the UI summary.

### [MEDIUM] - The promised live `test_session_rls_isolation` case is missing from the new session suite
- Location: [backend/tests/test_d1_session.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/tests/test_d1_session.py:1)
- Description: The branch ships `10` useful local tests, but none of them is the dedicated live 2-JWT `test_session_rls_isolation` that the redesign spec called for. The file header explicitly says live cross-user RLS verification lives elsewhere, and `pytest tests/test_d1_session.py::test_session_rls_isolation -v` fails with “not found”.
- Impact: `d1_sessions` RLS correctness is currently protected only by manual staging probes, not by an automated test that future changes would rerun.
- Reproduction: `cd backend && ../backend/venv/bin/python -m pytest tests/test_d1_session.py::test_session_rls_isolation -v`
- Suggested fix: Add a staging-gated 2-JWT test that inserts a `d1_sessions` row for user A, confirms user B gets `0` rows on `SELECT`, and confirms both cross-user updates and `user_id` reassignment are blocked.

## Tests run

- `bash backend/scripts/verify_page_parity.sh`
  - `Page parity OK (2 page(s) checked).`
- `zsh -lc 'set -a; source backend/.env.staging; bash backend/scripts/setup_phase_d_test_env.sh'`
  - Passed twice; migrations `021/022/022b/023/024` re-applied idempotently.
- `cd backend && ../backend/venv/bin/python -m pytest tests/test_d1_session.py -v`
  - `10 passed`
- `cd backend && ../backend/venv/bin/python -m pytest tests/test_vocab_guards.py tests/test_grammar_smoke.py tests/test_d1_e2e.py tests/test_admin_exercise_review.py tests/test_rate_limit.py -q`
  - `73 passed`
- `zsh -lc 'set -a; source backend/.env.staging; source backend/.env.staging.test; cd backend && ../backend/venv/bin/python -m pytest tests/test_exercise_rls.py -v'` (outside sandbox)
  - `2 passed`
- `zsh -lc 'set -a; source backend/.env.staging; source backend/.env.staging.test; cd backend && ../backend/venv/bin/python -m pytest tests/test_rls_vocab_integration.py -v'` (outside sandbox)
  - `3 passed`
- Live staging RLS probe for `d1_sessions` (manual, 2 JWTs)
  - User B `SELECT` count on user A’s session: `0`
  - User B `UPDATE` count on user A’s session: `0`
- Live staging `WITH CHECK` probe for `d1_sessions`
  - User A attempting to `UPDATE user_id -> user B` was blocked; row remained owned by user A.
- Live staging policy query for `d1_sessions`
  - Returned `3` policies: `d1_sessions_select`, `d1_sessions_insert`, `d1_sessions_update`
  - `d1_sessions_update` had both `qual` and `with_check = (auth.uid() = user_id)`

## Merge recommendation

- ✅ APPROVE: 0 CRITICAL + 0 HIGH + no regression
- ⚠️ CONDITIONAL: 0 CRITICAL + ≤2 HIGH with clear fix path
- ❌ BLOCK: ≥1 CRITICAL or Phase B/Wave 1 regression

**CONDITIONAL**

The branch is not far off, but the summary-drift bug is user-visible and undercuts the main UX win of the redesign. Once that is fixed, the remaining gap is test coverage, not product correctness.

## Wave 2 dependencies

- `d1_sessions` is intentionally D1-specific (`exercise_ids`, `correct_count`, `status`) and does **not** include a generic `exercise_type` field. For Wave 2, it will likely be cleaner to create a separate `d3_sessions` table rather than forcing both flows into this schema.
- The existing pieces Wave 2 can reuse safely:
  - RLS pattern from [backend/migrations/023_d1_sessions.sql](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/migrations/023_d1_sessions.sql:31)
  - Attempt linking pattern from [backend/migrations/024_attempts_session_link.sql](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/migrations/024_attempts_session_link.sql:13)
  - Default-deny flag exposure in `/auth/me`
  - Page parity script and live RLS env bootstrap in [backend/scripts/setup_phase_d_test_env.sh](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/scripts/setup_phase_d_test_env.sh:70)
