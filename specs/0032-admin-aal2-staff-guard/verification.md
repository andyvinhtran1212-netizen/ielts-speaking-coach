# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_staff_guard.py (role × is_active × aal × flag matrix, soft wrappers, sessions quota bypass, 503 fail-closed) and backend/tests/test_staff_guard_inventory.py; kind=journey; ref=spec.md AC1, AC2 on staging | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_staff_guard.py (403 detail shape, next_step enroll/challenge, no handler side effect before the guard); kind=journey; ref=spec.md AC1 on staging and production | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_staff_guard.py (flag false keeps behaviour, exactly one admin_aal2_would_block line with no email/token); kind=journey; ref=spec.md AC7 Railway log excerpt on staging | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_staff_guard_inventory.py (AAL1 allow-list is exactly GET /admin/mfa/status) and backend/tests/test_admin_staff_security_routes.py (status shape, own data only) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_staff_guard.py (inactive instructor 403 on /instructor/*, AAL1 admin impersonation refused without a governance_audit row); kind=journey; ref=spec.md AC5 on staging | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_admin_staff_security_routes.py (suspend, reactivate, self 400, non-staff 422, last_admin 409, actor suspended mid-request 403, sign_in_restored false, idempotent repeat); kind=journey; ref=spec.md AC3 on staging with a synthetic instructor | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_admin_staff_security_routes.py (existing role contract fields unchanged, demotion revokes, last_admin); kind=journey; ref=spec.md AC4 on staging | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_admin_staff_security_routes.py (revoke failure keeps change, sessions_revoked false, audit sessions_revoke_failed, alert queued, retry route) | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_migration_332_staff_security_audit.py (one row per change, source classification, append-only for owner, grants, N-1 activation); kind=query; ref=rollout.md S5 audit coverage query on staging | PENDING |
| FR-010 | kind=test; ref=backend/tests/test_staff_security_sweep.py (factor verified and deleted between two runs yields two rows, idempotent re-run, cursor durability, snapshot backstop, no secret stored); kind=journey; ref=spec.md AC6 factor enroll and removal on staging within 5 minutes, including add-then-remove inside one sweep interval | PENDING |
| FR-011 | kind=test; ref=backend/tests/test_owner_alerts.py (event set, recipients from env only, payload has no token or secret, retry to 5 then failed); kind=journey; ref=spec.md AC6 email received on staging | PENDING |
| FR-012 | kind=test; ref=frontend/tests/admin-mfa-next-behavior.test.mjs and the /admin/mfa Next-native browser verifier (enroll, challenge, wrong code, rate limit, remove with fresh code, next sanitising); Amendment 1: kind=test; ref=backend/tests/test_staff_guard.py (spec.md AC11: 12 h + 1 s refused, 11 h 59 m allowed, missing amr expired, ADMIN_AAL2_MAX_AGE_HOURS abc/0/48 → 12 with a startup log, report-only one would_block line) and the /admin/mfa node test that a factor is deleted only after a fresh verify (AC12); kind=journey; ref=spec.md AC11 report-only log for an old TOTP on staging | PENDING |
| FR-013 | kind=test; ref=frontend/tests/admin-mfa-gate.test.mjs (gate redirect, report-only banner, api.js mfa_required navigation) and frontend/tooling/verify-admin-mfa-flow.mjs, with the existing verify-admin-*.mjs verifiers green using the shared AAL2 stub | PENDING |
| FR-014 | kind=test; ref=frontend/tests/instructor-inactive-state.test.mjs (three instructor clients map a mid-session inactive 403 to the denied state) plus the PR #1771 activation-gate tests for load and reload; kind=journey; ref=spec.md AC5 on staging | PENDING |
| FR-015 | kind=test; ref=backend/tests/test_admin_staff_security_routes.py (security-audit order, alert_status, 503) and frontend/tests/admin-users-staff-security.test.mjs (⚠ on lookup failure) | PENDING |
| FR-016 | kind=test; ref=frontend/tests/staging-e2e-admin-aal2-contract.test.mjs (only helpers.js signs in the admin; writing-prompt-courses uses signInSession; helpers AAL2 step-up, AAL1 fallback without the secret, RFC 6238 vectors, no secret in errors); kind=test; ref=backend/tests/test_staging_seed_admin_totp.py (secret only in the 0600 creds file, reseed keeps a verified factor only when the stored secret verifies, reset); kind=journey; ref=live Staging E2E at the T012 SHA with ADMIN_AAL2_ENFORCE=true, admin seams and the Writing course allocation journey green; kind=check; ref=CI log scan shows no TOTP secret or token | PENDING |
| FR-018 | kind=test; ref=backend/tests/test_migration_332_staff_security_audit.py (suspension guard on every reactivation path, concurrent activation blocked on the lock) and backend/tests/test_activation_suspended_account.py (403 account_suspended before claim, code unused, admin issuance 409 with compensation); kind=test; ref=frontend/tests/login-suspended-account.test.mjs; kind=journey; ref=spec.md AC9 on staging with forced revocation failure | PENDING |
| FR-017 | kind=query; ref=rollout.md P4 readiness query on staging and production; kind=test; ref=backend/tests/test_migration_332_staff_security_audit.py (bootstrap grants, admins_exist refusal, zero-admin restore); kind=journey; ref=spec.md AC8 recovery drill timings on staging, including path (e) from zero eligible admins | PENDING |
| FR-019 | kind=test; ref=backend/tests/test_migration_336_suspended_account_role_guard.py (role change of a suspended account refused through the RPC, service REST, owner and superuser SQL; allowed after reactivation; bootstrap exempt; preconditions, postconditions, rollback); kind=test; ref=backend/tests/test_admin_user_role.py (409 account_suspended_role_change with the Vietnamese message); kind=journey; ref=spec.md AC10 on staging after 336 is applied | PENDING |
| FR-020 | kind=test; ref=backend/tests/test_staff_guard.py and backend/tests/test_admin_staff_security_routes.py and backend/tests/test_admin_user_role.py (spec.md AC12: TOTP 16 min + ADMIN_STEP_UP_ENFORCE=true on PATCH role, PATCH active, POST revoke-sessions → 403 step_up_required with no row change, no staff_security_audit row, no outbox row; 14 min succeeds; report-only one admin_step_up_would_block line; invalid config → 15 / false); kind=test; ref=backend/tests/test_staff_guard_inventory.py (every route that uses require_recent_mfa); kind=test; ref=frontend node test that the UI resends exactly once after a successful challenge; kind=journey; ref=spec.md AC12 on staging: report-only logs, helpers.js fresh AAL2 before sensitive steps, live Staging E2E green; enforcement on staging only in lot 11 or later | PENDING |

## Amendment 1 evidence (AC11, AC12) — offline done, staging PENDING

Approved 2026-10-29 14:44 (UTC+7); implementation is T016 (PC-J135), after
#1898 (T010). The offline tests below ran on the PC-J135 branch; the FR-012
and FR-020 rows stay `PENDING` until the staging journeys run.

- **AC11 (FR-012), offline:** `backend/tests/test_staff_guard.py`
  (`test_totp_12h_plus_1s_is_refused_under_enforcement`,
  `test_totp_11h59m_is_allowed_under_enforcement`,
  `test_missing_amr_counts_as_expired_and_a_future_one_is_invalid`,
  `test_invalid_aal2_max_age_falls_back_to_12_with_a_startup_log` for
  `abc`/`0`/`48`/`-1`/`12.5`/`13`, `test_no_max_age_value_can_widen_or_disable_the_check`,
  `test_report_only_expired_totp_logs_one_totp_expired_line_and_succeeds`).
  A missing `amr` entry now reports `reason=totp_expired`; a timestamp more
  than `_CLOCK_SKEW_SECONDS` in the future reports `totp_invalid`.
- **AC12 (FR-020), offline:** `backend/tests/test_admin_staff_security_routes.py::TestStepUp`
  (16 min + `ADMIN_STEP_UP_ENFORCE=true` on PATCH role, PATCH active and
  POST revoke-sessions → 403 `step_up_required` with no read, write, lock,
  GoTrue call, `staff_security_audit` or outbox row; 14 min succeeds;
  report-only one `admin_step_up_would_block` line and success),
  `backend/tests/test_admin_user_role.py::TestRoleStepUp`,
  `backend/tests/test_staff_guard.py` (step-up contract, window, config
  fallbacks 15 / false with one startup log, fail-closed 503),
  `backend/tests/test_staff_guard_inventory.py` section 4 (the routes that
  call `require_recent_mfa` are exactly the three, each right after its
  guard, each refusing a stale TOTP before any DB call);
  `frontend/tests/admin-mfa-transport.test.mjs` (resend exactly once, never a
  third request, closed or unclaimed prompt rejects, concurrent refusals
  share one prompt), `frontend/tests/react/admin-step-up.test.tsx` (gate
  dialog), `frontend/tests/react/admin-mfa-page.test.tsx` (factor removed
  only after challenge + verify; wrong code removes nothing),
  `frontend/tests/react/admin-directory-ui.test.tsx` (stacked dialog owns the
  keyboard), `frontend/tests/staging-e2e-admin-aal2-contract.test.mjs`
  (`freshAdminToken`, step-up route specs must use it).
- **Staging (AC11, AC12):** PENDING. Report-only logs for an old TOTP on
  `staging.averlearning.com` with the synthetic admin; `helpers.js` takes a
  fresh AAL2 before sensitive steps; live Staging E2E green. Step-up
  enforcement on staging is not part of this evidence until lot 11 or later,
  on the Leader's go.
- **AIBUDGET-0033 budget routes:** the raise / end-raise routes of 0033 T013
  must show `require_recent_mfa` in the same inventory test when they land
  (PC-J138).

### Rủi ro còn lại (residual risk, accepted by Leader 2026-10-29 14:53)

Factor deletion is **not** enforced on the server. `/admin/mfa` calls GoTrue
`mfa.unenroll` directly from the browser, so `require_recent_mfa()` never runs
on it, and GoTrue only requires AAL2. A stolen AAL2 session (≤ 12 h old) can
delete a factor without a new code by calling GoTrue directly. Controls: the
fresh verify in the `/admin/mfa` UI (AC12 node test), the T007 factor-deleted
owner alert within one sweep run (≤ 5 minutes), and the 12 h expiry (FR-012).
The deletion itself is not mitigated; recovery is to re-enroll and review the
alert. Details: `research.md` §10.2. This is expected to remain open at T016
and is not a failed check.

## T007 test evidence (PC-J40, 2026-10-28)

The FR-010 and FR-011 rows above stay `PENDING` until the staging journeys
(AC6) run in T012. The automated half, from `backend/`:

```bash
TEST_PG_URL=postgres://postgres@127.0.0.1:<port>/postgres REQUIRE_PG=1 \
  python -m pytest tests/test_owner_alerts.py tests/test_staff_security_sweep.py -q
```

Result: 49 passed on PostgreSQL 16.2 and 17.11 (local disposable clusters; 48 before the Codex #1884 fixes added one test).
The PostgreSQL cases run the sweep and outbox SQL against migration 332 as
its NOSUPERUSER owner role, with a stand-in `auth.audit_log_entries`.

- FR-010: `test_staff_security_sweep.py` covers these cases:
  - a factor enrolled, verified and deleted between two runs gives one row each, and verified and deleted are alerted;
  - a re-run, and a rewound cursor, add no row or alert;
  - a failed batch rolls back its rows and the cursor;
  - entries inside the lag wait for the next run;
  - step-up sign-ins are not verifications;
  - an admin-API delete is attributed to `traits.user_id` with an unknown actor;
  - only admin accounts are audited, by the role held when the event happened: an admin demoted before the next run still gets the rows and alerts, and a learner promoted afterwards does not (Codex #1884);
  - the snapshot backstop fires only when the log has no entry for the factor, and ignores vanished unverified factors; its e-mail shows the detection time stored on the audit row, in Vietnam time (Codex #1884);
  - a failed factor list keeps that admin's snapshot and fails the run;
  - no secret reaches the audit, the outbox or the snapshot.
- FR-011: `test_owner_alerts.py` covers these cases:
  - recipients come only from `OWNER_ALERT_EMAILS`;
  - neither the e-mail nor the Resend request carries a token, secret, reason or injected recipient, and the key appears only in the Authorization header;
  - a failed send is retried with backoff up to 5 sends and then stays `failed`, with one `owner_alert_failed` error log;
  - the compare-and-set claim stops two dispatchers from sending the same row twice (in memory and on PostgreSQL);
  - a missing key or recipient sends nothing and spends no attempt;
  - `--requeue` affects only `failed` rows.
- Mutation checks: each of the following was removed in turn, and in each case the matching test failed:
  - the `ON CONFLICT` dedup;
  - the batch transaction;
  - the cursor advance;
  - the step-up check;
  - the backstop's log check;
  - the snapshot `seen_at` check;
  - the event-time role lookup;
  - the stored detection time in the alert;
  - the claim;
  - the claim's `attempts` compare;
  - the `attempts < 5` filter.

## PC-J201 patch evidence (SA #1936 P3 c-f)

The saved PC-J201 patch from job 1an was resumed in
`/workspace/wt-q-cx-1ca-resume-1an-j201-mig352` on branch
`q/cx-1ca-resume-1an-j201-mig352`, based on current staging
`5cbf1ee8692c1ce17a03e70179cc74c6bc19edbc`. The Leader allocated migration
`352_mfa_status_throttle.sql`; the test reference, migration README and
`pending_feature` forward policy (group `mfa_status_throttle`) use that name.
Applying it is outside this job: no database migration, production access or
merge is authorized. SA retest, CR review and hosted verification remain
pending. The PR records the submitted head and local metadata gate result.

- Shared cooldown, account in-flight admission and global concurrency:
  `test_admin_mfa_status_caller_sweep.py` uses separately imported worker
  modules against the same PostgreSQL schema.
- Failed log/snapshot steps, `None` and cancellation start no cooldown;
  their attempts still count toward the shared six-per-minute budget.
- The seventh changed-state request returns 429 with `Retry-After`; another
  account is unaffected and the rolling window recovers. Expired leases
  recover, while a late completion cannot clear a newer lease.
- Migration SQL runs twice as the NOSUPERUSER schema owner. RLS is enabled;
  anon, authenticated and service_role have no table privileges.
- `test_staff_security_sweep.py` tests the cron deadline during connection
  setup, snapshot/Auth work and follow-up sleep. Each times out, logs and
  exits 1; the database backend PID is gone after cleanup.
- Prior job 1an evidence, before the current staging sync and rename:
  security regression selection: 388 passed. Its final full backend run used
  the repository's four CI shards on independent local PostgreSQL 17.11 UTF-8
  clusters: **14,445 passed, 46 skipped, no failures**. The shard verifier
  confirmed collection/union = 14,491, missing = 0, extra = 0. All PostgreSQL
  cases in the changed layers ran with `REQUIRE_PG=1`.
- Prior job's skips: 16 live Supabase probes without configured credentials,
  12 local PostgREST probes without that service, 8 Vocabulary PostgreSQL
  probes without their explicit database setting, 8 spaCy model cases,
  1 paid Gemini smoke test and 1 external MASTER30 package case. These are
  unverified prerequisites, not passing evidence. No skip/assertion/timeout
  was loosened. The initial SQL_ASCII full run was interrupted after Unicode
  fixture failures and replaced by the passing UTF-8 run above.
- Spec governance: 41 feature specs validated; `git diff --check` passed.
- Resume verification on the current staging base and numbered migration:
  focused backend selection **281 passed, 51 skipped**; complete offline
  backend suite **13,195 passed, 1,338 skipped**, exit 0 (249.11 seconds).
  The full-run skips are 1,300 PostgreSQL prerequisites, 12 PostgREST probes,
  16 live Supabase/RLS probes, 8 spaCy model cases, 1 paid smoke test and
  1 external MASTER30 source package. No database was configured and migration
  352 was not applied anywhere in this resume. The PostgreSQL tests retain
  their existing prerequisite gates; no test or assertion was weakened.
  Frontend MFA model/transport/contract checks: **33 passed**, no skips.
  The backend run reported 16 warnings and background AI logging teardown
  diagnostics outside the changed sweep code; its test result and exit were
  successful. Current-head database evidence remains for the later SA retest.

The FR-010/FR-011 staging journeys and this job's SA retest remain pending.

## Contract evidence

- **OpenAPI/type drift**: regenerate `frontend/types/api.d.ts` for the four new
  routes and the additive role-PATCH fields. The `api.d.ts ↔ OpenAPI drift`
  check must stay green.
- **Backward compatibility**: the role PATCH keeps `ok/id/role`. The 403
  `mfa_required` appears only when enforcement is on. Learner routes are
  unchanged.

## Data evidence

- **Migration/schema query**: `rollout.md` S2 postconditions on staging after
  apply. Production runs the same read-only query after apply.
- **Immediate state versus full reload**: a suspended staff row shows
  "Inactive" and the new history entry after the mutation refetch, and again
  after a reload. An inactive instructor lands on `/login` activation on both
  first load and reload.
- **Direct REST path (PC-J119, migration 345)**: the staff guard covers
  FastAPI only. Before 345, seven RLS policies admitted any admin JWT on an
  inline `role = 'admin'` check (no AAL2, `is_active` or `suspended_at`) to
  the dictation tables, `user_feedback`, `lemma_overrides`, draft
  `vocabulary_exercises` and `access_codes` through `/rest/v1/`. 345 drops
  them and fails if any `public` policy still holds an `'admin'` literal.
  Evidence: `backend/tests/test_migration_345_admin_inline_policies.py` and
  `backend/tests/test_rls_no_inline_admin_role_policy.py` (PG 16 and 17), then
  the read-only catalog query in the 345 header on staging after apply.
  Residual: learners keep SELECT on their own dictation rows and on published
  exercises. 345 also revokes every `anon`/`authenticated` privilege on
  `access_codes` and fails if any client role can still SELECT it (PC-J161),
  so the codes do not rely on 108 keeping EXECUTE revoked on the helpers.

## UI evidence

- **Viewports/themes/input methods**: `/admin/mfa`, the admin users suspend
  dialog and the instructor denied state at 390 px and 1280 px, light and
  dark, keyboard only (code input, submit, dialog focus trap and return),
  reduced motion.

## Release evidence

- **Staging SHA and checks**: pending T012. Record the SHA, the migration
  ledger row, the flag values with timestamps, live Staging E2E run IDs, and
  the recovery drill timings.
- **Production verification**: pending T013. Record the FR-017 query result,
  the enforcement switch time, AC1/AC2 on the owner's admin, and an
  audit/alert spot check.

### T009 operational follow-up: staging CI enrollment

PR #1880 delivered the shared admin MFA helper and seed support. The follow-up
wires `STAGING_E2E_ADMIN_TOTP_SECRET` into both release-provenance steps and the
live browser suite in `.github/workflows/staging-release-smoke.yml`.
`capture-staging-release-provenance.mjs` uses the same `signInSession` helper,
requires `aal2` when the secret is configured, and records only `admin_aal` in
its evidence. The contract tests exercise successful MFA, missing factors,
an AAL1 verify response, credential-free output, and operation before setup.

Operational enrollment is restricted to `e2e-admin-smoke@staging-e2e.averlearning.com`
on Supabase project `zjphffoujxkpltixsbzj`:

1. Wait until no live staging smoke is using the shared admin. A successful
   factor verification revokes its other AAL1 sessions (`research.md` §9.3).
2. Preserve the existing password. Do not run the full `staging_seed.py` against
   this namespace: reseeding rotates existing passwords. Do not extract
   `E2E_PASSWORD` from CI. A staging service credential can generate a short-lived
   magic-link session for the existing account without sending email or changing
   its password; exchange the token hash through GoTrue `/verify` in memory.
3. Enroll through the user's normal GoTrue `/factors` endpoint. Write the seed
   only to `/workspace/qa/creds/staging-e2e-admin-totp.env`, mode 0600, as
   `STAGING_E2E_ADMIN_TOTP_SECRET=…`. Never print the response, QR URI or seed.
4. Pass the seed directly to `gh secret set STAGING_E2E_ADMIN_TOTP_SECRET`
   through stdin. Complete `/factors/{id}/challenge` and `/verify`, confirm the
   returned session has `aal2`, and revoke only the temporary session locally.
5. Run the staging release smoke with the updated workflow. Record the exact
   staging SHA, run URL/result and `admin_aal: aal2` evidence in the follow-up PR.
   Scan logs and artifacts in memory for credentials without printing matches.

This follow-up does not enable enforcement. T012 still requires its separate
rollout and recovery acceptance; the live CI evidence above is a prerequisite.
