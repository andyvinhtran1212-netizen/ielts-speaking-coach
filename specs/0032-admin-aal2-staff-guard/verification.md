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
| FR-012 | kind=test; ref=frontend/tests/admin-mfa-next-behavior.test.mjs and the /admin/mfa Next-native browser verifier (enroll, challenge, wrong code, rate limit, remove with fresh code, next sanitising); Amendment 1: kind=test; ref=backend/tests/test_staff_guard.py (spec.md AC11: 12 h + 1 s refused, 11 h 59 m allowed, missing amr expired, ADMIN_AAL2_MAX_AGE_HOURS abc/0/48 → 12 with a startup log, report-only one would_block line) and the /admin/mfa node test that a factor is deleted only after a fresh verify (AC12); kind=journey; ref=spec.md AC11 report-only log for an old TOTP on staging; Amendment 2 planned: kind=test; ref=backend/tests/test_staff_guard.py (AC15: NaN/±inf ignored before latest finite timestamp selection, no finite candidate = totp_expired, mixed entry order, both enforcement flags and safe logging) | PENDING |
| FR-013 | kind=test; ref=frontend/tests/admin-mfa-gate.test.mjs (gate redirect, report-only banner, api.js mfa_required navigation) and frontend/tooling/verify-admin-mfa-flow.mjs, with the existing verify-admin-*.mjs verifiers green using the shared AAL2 stub | PENDING |
| FR-014 | kind=test; ref=frontend/tests/instructor-inactive-state.test.mjs (three instructor clients map a mid-session inactive 403 to the denied state) plus the PR #1771 activation-gate tests for load and reload; kind=journey; ref=spec.md AC5 on staging | PENDING |
| FR-015 | kind=test; ref=backend/tests/test_admin_staff_security_routes.py (security-audit order, alert_status, 503) and frontend/tests/admin-users-staff-security.test.mjs (⚠ on lookup failure) | PENDING |
| FR-016 | kind=test; ref=frontend/tests/staging-e2e-admin-aal2-contract.test.mjs (only helpers.js signs in the admin; writing-prompt-courses uses signInSession; helpers AAL2 step-up, AAL1 fallback without the secret, RFC 6238 vectors, no secret in errors); kind=test; ref=backend/tests/test_staging_seed_admin_totp.py (secret only in the 0600 creds file, reseed keeps a verified factor only when the stored secret verifies, reset); kind=journey; ref=live Staging E2E at the T012 SHA with ADMIN_AAL2_ENFORCE=true, admin seams and the Writing course allocation journey green; kind=check; ref=CI log scan shows no TOTP secret or token | PENDING |
| FR-018 | kind=test; ref=backend/tests/test_migration_332_staff_security_audit.py (suspension guard on every reactivation path, concurrent activation blocked on the lock) and backend/tests/test_activation_suspended_account.py (403 account_suspended before claim, code unused, admin issuance 409 with compensation); kind=test; ref=frontend/tests/login-suspended-account.test.mjs; kind=journey; ref=spec.md AC9 on staging with forced revocation failure | PENDING |
| FR-017 | kind=query; ref=rollout.md P4 readiness query on staging and production; kind=test; ref=backend/tests/test_migration_332_staff_security_audit.py (bootstrap grants, admins_exist refusal, zero-admin restore); kind=journey; ref=spec.md AC8 recovery drill timings on staging, including path (e) from zero eligible admins | PENDING |
| FR-019 | kind=test; ref=backend/tests/test_migration_336_suspended_account_role_guard.py (role change of a suspended account refused through the RPC, service REST, owner and superuser SQL; allowed after reactivation; bootstrap exempt; preconditions, postconditions, rollback); kind=test; ref=backend/tests/test_admin_user_role.py (409 account_suspended_role_change with the Vietnamese message); kind=journey; ref=spec.md AC10 on staging after 336 is applied | PENDING |
| FR-020 | kind=test; ref=backend/tests/test_staff_guard.py and backend/tests/test_admin_staff_security_routes.py and backend/tests/test_admin_user_role.py (spec.md AC12: TOTP 16 min + ADMIN_STEP_UP_ENFORCE=true on PATCH role, PATCH active, POST revoke-sessions → 403 step_up_required with no row change, no staff_security_audit row, no outbox row; 14 min succeeds; report-only one admin_step_up_would_block line; invalid config → 15 / false); kind=test; ref=backend/tests/test_staff_guard_inventory.py (every route that uses require_recent_mfa); kind=test; ref=frontend node test that the UI resends exactly once after a successful challenge; kind=journey; ref=spec.md AC12 on staging: report-only logs, helpers.js fresh AAL2 before sensitive steps, live Staging E2E green; enforcement on staging only in lot 11 or later; Amendment 2 planned: kind=test; ref=backend/tests/test_staff_guard.py (FR-020a/AC13: any verified factor, both timestamps, 24 h boundary, no bypass, report-only reason); kind=test; ref=backend/tests/test_access_code_generation.py and backend/tests/test_staff_guard_inventory.py (AC14: conditional grants_role guard, both branches, zero side effects); kind=test; ref=frontend/tests/admin-mfa-transport.test.mjs and frontend/tests/admin-access-codes.test.mjs (cool-off wait without prompt/retry, stale-TOTP retry once, immediate/reload truth); kind=check; ref=specs/0032-admin-aal2-staff-guard/spec.md AC13–AC15 and Amendment 2 delivery gate (SA review, no flag enablement) | PENDING |

## PC-J150 — missing revocation alert status (FR-011, FR-015)

- Prerequisite #1928 merged at `2026-10-30T08:57:15Z`: merge commit
  `d94c303e7e1e886228b64ada802a2ef58456a991`, PR head
  `721ce781c8eee96a2e84e614db9f6d3d4c115406`. At the starting staging SHA
  `bf22c10ee5e83dcd96beda1ee338eef63059480c`, the affected backend service
  and response model were unchanged from #1928 and had no `not_recorded`.
- Red/green: before the implementation change, the new missing-outbox case
  and the extended retry test failed (`2 failed, 6 passed`): history returned
  `null`. After the change, all 116 tests in
  `backend/tests/test_admin_staff_security_routes.py` passed with
  `REQUIRE_PG=1` against a disposable local PostgreSQL 17 cluster.
- `TestSecurityAudit::test_revocation_failure_uses_outbox_status_or_not_recorded`
  covers an `admin_api` revocation failure without an outbox row and with
  `pending`, `sent`, and `failed` rows. The shared event/source predicate also
  generates the retry enqueue SQL. `test_other_orphan_rows_do_not_get_not_recorded`
  excludes successful retries, `out_of_band` failures, and instructor role changes.
- `TestRevocationFailure::test_failure_audit_write_failing_still_answers_the_committed_change`
  now reads the orphan as `not_recorded` before retry and as `pending` after
  retry, retaining every existing assertion. The unchanged reload/outbox and
  newest-first tests also pass.
- `frontend/tests/admin-users-staff-security.test.mjs` asserts the exact label
  and failed tone. `frontend/tests/react/admin-users-staff-security.test.tsx`
  checks the owner-alert cell, the `null` dash, and reopening with `pending`.
  Full Node tests: 13,711 passed, 1 existing skip; React: 986 passed.
  Strict and legacy TypeScript checks, Next build, and regeneration of
  `frontend/types/api.d.ts` with the CI OpenAPI command passed.
- Local Next browser fixture: both themes show the label and `null` dash;
  a full page reload with the updated API response shows `pending` without
  the old label (four history reads, no browser exceptions). Screenshots:
  [light](evidence/pc-j150-not-recorded-light.png),
  [dark](evidence/pc-j150-not-recorded-dark.png). Every remote request was
  intercepted; only synthetic fixture data was used.
- No migration, staging database write, production access, real email, or
  Railway change. Staging merge remains Leader-owned after CI is green (00e).

## Amendment 1 evidence (AC11, AC12) — offline done, staging PENDING

Approved 2026-10-29 14:44 (UTC+7); implementation is T016 (PC-J135), after
#1898 (T010). The offline tests below ran on the PC-J135 branch; the FR-012
and FR-020 rows stay `PENDING` until the staging journeys and Amendment 2
evidence below are complete. These are historical Amendment 1 results,
not proof that the Amendment 2 controls pass.

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

## Amendment 2 verification plan (AC13–AC15) — implementation PENDING

Approval source: **Leader báo anh Vinh duyệt FR020 a c 30/10 13:38
(t744s2552)**, 2026 (UTC+7), Q-0935-FR020-AMEND2 / PC-J346. Prerequisite
#2023 merged to staging on 2026-10-31 at
`55258077f712cde9cdbb9dec482ae164e7d98e9a`. PC-J298 changes specs only;
T018 (PC-J300, phương án a + c) starts after this spec PR merges.
`ADMIN_STEP_UP_ENFORCE` stays **OFF everywhere**. No DB, environment,
real-GoTrue attack reproduction or real-recipient email is part of this job.

FR-020a is a subclause of FR-020; its evidence belongs to the FR-020 row
above. All tests below are **planned**, not executed Amendment 2 evidence.

| Scope | Required evidence in PC-J300 | Result |
| --- | --- | --- |
| FR-020a / AC13 guard | Extend `backend/tests/test_staff_guard.py`: fresh AAL2/TOTP plus a recent verified TOTP factor → 403 `step_up_required`, `reason=new_factor_cooloff`; inspect every factor in both list orders, either timestamp recent, backup factors, exact 86400 s and older allowed only with fresh TOTP, future times blocked, missing/malformed metadata fail closed, unverified/non-TOTP ignored, refresh/re-challenge no bypass, one reasoned report-only log even if also stale. Use fixed UTC clock/claims/fixtures, no live GoTrue. | PENDING |
| FR-020a / AC13 route effects | Extend `backend/tests/test_staff_guard_inventory.py` and existing staff route tests: every implemented FR-020 route rejects a recent factor before handler DB/engine/lock calls, code creation, audit/outbox or GoTrue mutation; preserve FR-001 authorization reads. Assert both flags and no new DB lookup for factor metadata. Budget routes join when implemented by PC-J138. | PENDING |
| FR-020 / AC14 access codes | Extend `backend/tests/test_access_code_generation.py` and the inventory: non-null normalized `grants_role` with 16 min TOTP refused, 14 min with old factors allowed, fresh TOTP plus recent factor refused; no code/audit on refusal. Omitted/null/empty/whitespace role takes ordinary-code path under FR-001 only; normalized instructor still guarded; existing role/email validation and `{created, codes}` shape retained. Report-only logs once and preserves generation. | PENDING |
| FR-012 / AC15 non-finite claims | Extend `backend/tests/test_staff_guard.py`: NaN/±inf alone and mixed, fresh/expired finite companion in either order, bool/non-numeric rejection, future-skew rule; AAL2 enforced → `mfa_required`, report-only → `totp_expired` log without conversion error; step-up enforced/report-only follow their existing contract with no finite TOTP. | PENDING |
| Wire contract and UI | Regenerate OpenAPI and `frontend/types/api.d.ts` with additive cool-off `reason` and generation-route 403. Extend `frontend/tests/admin-mfa-transport.test.mjs` and the admin code fixture journey: cool-off surfaces the wait with no challenge/resend, stale-TOTP still retries once; verify immediate post-action and full-reload code-list truth. Older consumers can resend only once and remain refused. | PENDING |
| Review and handoff | SA reviews the spec PR and the exact PC-J300 head; Feature Developer reads the spec PR for alignment. Record local suite commands/counts, exact SHA, OpenAPI drift and fixture evidence here. J300 is released only after the spec PR merges, with the existing job plus “phương án a + c”; no flag switch is authorized by either job. | PENDING |

### PC-J298 spec-only validation (2026-11-02)

- `python backend/scripts/validate_specs.py`: 49 feature specs validated.
- `python -m pytest tests/test_validate_specs.py -q` from `backend/`:
  **88 passed**, 9 existing deprecation warnings (11.01 s), using the
  backend venv and the task-owned pytest basetemp; summary saved outside
  the repository and temp directory removed.
- Changed-document Markdown links and literal code/test references resolve;
  only the three authorized spec files changed; `git diff --check` is clean.
- The local `check-pr-metadata.sh` replica reports
  `CHECK-PR-METADATA PASS`; rerun on the committed PR head before opening.
  PR checks and SA review are separate gates. These checks do not establish
  AC13–AC15 runtime behavior or authorize releasing J300 before spec merge.

### Rủi ro còn lại — evidence boundary

The Leader's 2026-10-29 14:53 acceptance covers UI-only factor deletion.
Vinh's 2026-10-30 13:38 **a + c** decision adds the cool-off, not option b.
A stolen AAL2 session can bypass the `/admin/mfa` UI and unenroll/re-enroll
through GoTrue; verifying an attacker's factor can create a fresh `amr.totp`
and renew both freshness windows. Planned FR-020a blocks FR-020 actions
while any recent verified factor remains in the current accepted user list,
**only once implemented and enforced**. It does not prevent deletion itself,
retain deleted-factor history, or stop waiting out the cool-off. Removing
the new factor while retaining an old verified factor can remove the
cool-off signal. Do not claim these sequences are prevented by AC13.

Retain the existing UI fresh verify and FR-010/FR-011 sweep alerts for both
`mfa_factor_verified` and `mfa_factor_deleted` within ≤ 5 minutes, including
verify/delete between sweeps. The T007 evidence below covers the existing
detective mechanism, not an executed attack or an implemented cool-off.
Recovery uses suspension/session revocation and the existing factor runbook;
a legitimately re-enrolled admin also waits 24 hours with no owner bypass.
See `spec.md` “Rủi ro còn lại” and `research.md` §10.2.

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


## PC-J358: migration 341 hardening after #2050 (2026-11-02)

FR-009/FR-011/FR-019, with AIOPS-0024 FR-003: scoped follow-up to #2050
(merge `d5b1048cb7cb29aecc90626cdf5ed2a4a211624c`), based on staging
`5d84042ba4144c19781cba9617846e0731e3bc25`. Before edits, a staging-only
Management API request used `read_only: true` and `SET TRANSACTION READ ONLY`:
341 had no ledger row and `staff_privilege_evidence` did not exist. No remote
migration, data write, production access, flag change or real email was part
of this verification.

- SA P3-2: the probe2-equivalent owner-planted evidence survived an unrelated
  RPC and committed before the patch. Test-first run: seven new regression
  cases failed against the merged implementation. A deferred constraint
  trigger now rejects COMMIT with `staff_privilege_evidence_not_consumed`,
  including after a planted row's key changes; RPC/bootstrap still commit.
- SA P3-4: the 326/332 harness asserts NOSUPERUSER API roles and switches role
  inside the operation transaction with `ASSERT current_user`. Negative
  controls elevate each API role locally and prove fixture refusal.
- SA P3-7: the audit consumes OLD.id evidence, matching the guards; an owner
  changing users.id retains the bootstrap audit labels and leaves no evidence.
- SA-R4-1/2/3: regression coverage checks column I/U/R, client I/U/D,
  NOINHERIT/SET membership and an attacker-owned exact text overload.
- SA P3-5 stays a known gap in the 341 header: arbitrary service-role
  `updated_by` attribution and unaudited parent-table owner TRUNCATE. P3-6's
  rollback comments require the service-role INSERT grant and mark the
  historical client sequence GRANT DO NOT RUN. Manual dump instructions in
  `backend/migrations/README.md` exclude transient evidence data.

Local PostgreSQL 17: **438 passed, zero skips** across the complete 326,
331, 332, 336, 337, 341 and 346 migration suites. A second run of the final
341 suite (including rollback function cleanup) plus its shared-harness
consumers (admin staff routes, owner alerts, security sweep and cohort response
model) passed **411 tests, zero skips**. Commands, red/green output
and the read-only staging receipt are retained under
`/workspace/cc-jobs/job-q-1go-pc-j358-mig341-sa-p3.log.d/` (`red.result`,
`focused.result`, `affected.result`, `consumers.result`, `staging-ledger.request.json`,
`staging-ledger.result.json`). Local clusters are stopped and deleted after
each group. Independent SA retest/closure and any authorised staging apply
remain pending; these results do not close the live acceptance gates above.
