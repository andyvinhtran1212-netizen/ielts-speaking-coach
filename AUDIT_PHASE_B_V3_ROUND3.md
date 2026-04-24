# Audit Phase B V3 — Round 3 (Final)

Branch: `feature/vocab-phase-b-v3`  
Commits reviewed: `121e56a .. 113c2d4`  
Previous rounds: `AUDIT_PHASE_B_V3.md`, `AUDIT_PHASE_B_V3_ROUND2.md`

## Overall verdict (Round 3 — Final)

❌ ESCALATE TO HUMAN REVIEW

Round 3 code changes appear to address the three unresolved Round 2 findings at the static-code level: the vocab insert loop now re-raises non-duplicate errors, `result.html` now fail-safes on `vocab_bank_enabled`, and a new Guard 7 injection-artifact filter was added to the vocab guard pipeline. Claude Code also extracted service-role usage into dedicated services with rationale, which is an improvement over the previous direct router usage. I re-ran the mandatory live DB setup after your note about the SQL table update, but the verification still could not proceed because `backend/scripts/setup_phase_b_test_env.sh` fails before migration/application logic with a real connectivity error (`psql ... No route to host`). Per the Round 3 rules, that still blocks merge and requires human review rather than another AI fix/audit loop.

## Status matrix — evolution across rounds

| Finding | R1 | R2 | R3 | Final status |
|---------|----|----|----|--------------|
| C1 RLS bypass | CRITICAL | ⚠️ PARTIAL | ⚠️ LIVE UNVERIFIED | ESCALATE |
| C2 Upsert target | CRITICAL | ❌ STILL FAILING | ✅ STATIC FIX OBSERVED | CONDITIONAL ON LIVE RETEST |
| C3 RLS UPDATE WITH CHECK | CRITICAL | ⚠️ PARTIAL | ⚠️ LIVE UNVERIFIED | ESCALATE |
| H1-H6 | HIGH | ✅ RESOLVED | ✅ NO REGRESSION OBSERVED | RESOLVED |
| H2 `/auth/me` flag | HIGH | ❌ STILL FAILING | ✅ STATIC FIX OBSERVED | CONDITIONAL ON UI RETEST |
| H7 Prompt injection | HIGH | ❌ STILL FAILING | ✅ STATIC FIX OBSERVED | CONDITIONAL ON LIVE/UNIT RETEST |

## C1 decision review

Option chosen by Claude Code: **A**

Assessment: **Accepted**

Rationale:
- `backend/services/feature_flags.py` now centralizes feature-flag reads through a dedicated service-layer helper instead of embedding `supabase_admin` access directly in the vocab router.
- `backend/services/analytics.py` now centralizes analytics writes, again with explicit docstring rationale for service-role use.
- This is a materially better shape than Round 2 because the user-facing router no longer appears to construct or expose service-role access inline.
- The rationale is acceptable: feature flags are treated as system metadata, analytics writes are treated as backend-owned system records, and neither service leaks the service-role client back to callers.

Note:
- This decision is only accepted at the architecture/rationale level. The required live 2-JWT route verification for C1 could not be completed because DB setup failed.

## Still failing / blocked verification

### 1. Live integration verification blocked by DB environment setup failure

- Root cause: the new setup script could not connect to the configured Supabase database host while applying migrations.
- Severity: **Critical**
- Impacted file: [backend/scripts/setup_phase_b_test_env.sh](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/scripts/setup_phase_b_test_env.sh)
- Observed failure:

```text
== Phase B Test Env Setup ==
Applying migration: 018_analytics_events...
psql: error: connection to server at "db.nqhrtqspznepmveyurzm.supabase.co" ..., port 5432 failed: No route to host
```

- Why this blocks Round 3:
  - The Round 3 audit rules require live DB setup before continuing.
  - Without successful setup, the following mandatory checks remain unverified:
    - C1 live 2-JWT RLS route test
    - C3 live `WITH CHECK` / reassign prevention test
    - F5 RLS integration test execution against a real prepared schema
    - Happy-path persistence confirmation against the live DB
- Minimal additional fix needed:
  - Human-level environment/infrastructure check for DB reachability, VPN/network policy, Supabase host accessibility, or credentials/host validity in `backend/.env`.
  - Re-run `bash backend/scripts/setup_phase_b_test_env.sh` only after connectivity is fixed.
- Reproduction command:

```bash
zsh -lc 'set -a; source backend/.env; bash backend/scripts/setup_phase_b_test_env.sh'
```

## New regressions introduced by fix

No direct code regression was confirmed within the scoped diff.

One infra-quality note:
- `backend/scripts/setup_phase_b_test_env.sh` exists but is not marked executable. This is not the main blocker because it still runs via `bash ...`, but it is a small polish gap for a test-infra script.

## Live integration test results

- DB setup: **failed**
- 2-JWT RLS test: **not run** (blocked by setup failure)
- RLS UPDATE WITH CHECK live test: **not run** (blocked by setup failure)

## Test infrastructure assessment

### F4 setup script

Status: **Partially working, but blocked by environment**

What looks good:
- File exists: [backend/scripts/setup_phase_b_test_env.sh](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/scripts/setup_phase_b_test_env.sh)
- Script applies migrations in the intended order:
  - `018_analytics_events.sql`
  - `019_user_vocabulary.sql`
  - `019b_fix_rls_update_policy.sql`
- Script includes final schema verification queries for:
  - `users.feature_flags`
  - `user_vocabulary` existence
  - `rowsecurity`

What remains:
- Script is not executable (`test -x` returned `executable_no`)
- Real run failed on DB connectivity before schema verification could complete

### F5 integration test

Status: **Looks reasonable, not executed live**

File:
- [backend/tests/test_rls_vocab_integration.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/tests/test_rls_vocab_integration.py)

What looks good:
- Covers cross-user visibility expectations
- Covers update / reassignment protection
- Skips cleanly if required env vars are missing
- Includes cleanup paths in the test flow

What remains:
- Not actually run in Round 3 because the DB setup prerequisite failed first

## Round 3 static verification results

These checks were completed by code inspection/diff review after Round 2.

### C2: Insert error handling — static status

Status: **Static fix observed**

Evidence:
- [backend/routers/grading.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/grading.py:688)

Current behavior in the insert loop:
- duplicate-like errors (`duplicate`, `unique`, `23505`) log and continue
- non-duplicate errors are re-raised immediately

Why this is better than Round 2:
- It no longer silently swallows arbitrary insert failures
- The control flow now matches the intended “skip duplicates only” contract

Remaining limitation:
- Not exercised against a live DB in Round 3 because setup failed before that stage

### H2: `result.html` gating — static status

Status: **Static fix observed**

Evidence:
- `/auth/me` exposure still exists in [backend/routers/auth.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/routers/auth.py)
- Result page gate now appears in [frontend/pages/result.html](/Users/trantrongvinh/Documents/ielts-speaking-coach/frontend/pages/result.html:1114)

What changed:
- `_pollVocabToast()` now fetches `/auth/me`
- it returns early unless `vocab_bank_enabled === true`
- this is fail-safe for disabled users and for `/auth/me` failure

Remaining limitation:
- Not browser-retested in Round 3 because the final-round live environment gate failed first

### H7: Guard 7 injection rejection — static status

Status: **Static fix observed**

Evidence:
- Guard function exists at [backend/services/vocab_guards.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/vocab_guards.py:83)
- Guard is wired into `run_all_guards()` at [backend/services/vocab_guards.py](/Users/trantrongvinh/Documents/ielts-speaking-coach/backend/services/vocab_guards.py:172)

What changed:
- new injection-artifact guard rejects obviously adversarial/system-prompt/JSON-shaped artifacts before later vocab suggestions proceed

Remaining limitation:
- Round 3 did not execute the user-requested adversarial probe matrix because live verification was halted at setup failure

## Tests run during round 3

- `git log --oneline --decorate -n 8`
- `git diff --stat 121e56a..113c2d4 -- backend/routers/grading.py frontend/pages/result.html backend/services/vocab_guards.py backend/services/feature_flags.py backend/services/analytics.py backend/scripts/setup_phase_b_test_env.sh backend/tests/test_rls_vocab_integration.py backend/routers/vocabulary_bank.py backend/routers/auth.py`
- `git diff 121e56a..113c2d4 -- backend/routers/grading.py frontend/pages/result.html backend/services/vocab_guards.py backend/services/feature_flags.py backend/services/analytics.py backend/scripts/setup_phase_b_test_env.sh backend/tests/test_rls_vocab_integration.py backend/routers/vocabulary_bank.py backend/routers/auth.py`
- `test -x backend/scripts/setup_phase_b_test_env.sh && echo executable_yes || echo executable_no`
  - Result: `executable_no`
- `which psql`
  - Result: `/opt/homebrew/bin/psql`
- `zsh -lc 'set -a; source backend/.env; bash backend/scripts/setup_phase_b_test_env.sh'`
  - Result: failed with `No route to host`
- Re-run after SQL-table update note:
  - `zsh -lc 'set -a; source backend/.env; bash backend/scripts/setup_phase_b_test_env.sh'`
  - Result: failed again with the same `No route to host` error before schema verification

## Merge recommendation

### ❌ ESCALATE TO HUMAN REVIEW

Reason:
- Round 3 requires live DB verification.
- The repository now includes a dedicated setup script and RLS integration test, so the previous “env not ready” exception no longer applies.
- Even so, the live DB setup still could not be completed because the configured Supabase database host was unreachable from this environment.
- Under the final-round rules, that is enough to stop the AI loop and escalate to human review rather than issuing another fix/audit cycle.

## Recommended follow-up (post-escalation)

- Human review / infra check for Supabase DB reachability from the audit environment
- After connectivity is restored, rerun:
  - `bash backend/scripts/setup_phase_b_test_env.sh`
  - `cd backend && pytest tests/test_rls_vocab_integration.py -v`
  - full 2-JWT API route verification for C1
  - live `WITH CHECK` reassignment verification for C3
- Minor cleanup:
  - mark `backend/scripts/setup_phase_b_test_env.sh` executable

## Decision log

- C1 chosen option: **service extraction + documented rationale**
- Round 3 respected the “live DB test is mandatory” rule and stopped when setup failed
- No Round 4 is recommended
- Final disposition is escalation, not another AI remediation loop
