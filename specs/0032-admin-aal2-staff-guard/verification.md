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
| FR-012 | kind=test; ref=frontend/tests/admin-mfa-next-behavior.test.mjs and the /admin/mfa Next-native browser verifier (enroll, challenge, wrong code, rate limit, remove with fresh code, next sanitising) | PENDING |
| FR-013 | kind=test; ref=frontend/tests/admin-mfa-gate.test.mjs (gate redirect, report-only banner, api.js mfa_required navigation) and frontend/tooling/verify-admin-mfa-flow.mjs, with the existing verify-admin-*.mjs verifiers green using the shared AAL2 stub | PENDING |
| FR-014 | kind=test; ref=frontend/tests/instructor-inactive-state.test.mjs (three instructor clients map a mid-session inactive 403 to the denied state) plus the PR #1771 activation-gate tests for load and reload; kind=journey; ref=spec.md AC5 on staging | PENDING |
| FR-015 | kind=test; ref=backend/tests/test_admin_staff_security_routes.py (security-audit order, alert_status, 503) and frontend/tests/admin-users-staff-security.test.mjs (⚠ on lookup failure) | PENDING |
| FR-016 | kind=test; ref=frontend/tests/staging-e2e-admin-aal2-contract.test.mjs (only helpers.js signs in the admin; writing-prompt-courses uses signInSession); kind=journey; ref=live Staging E2E at the T012 SHA with ADMIN_AAL2_ENFORCE=true, admin seams and the Writing course allocation journey green; kind=check; ref=CI log scan shows no TOTP secret or token | PENDING |
| FR-018 | kind=test; ref=backend/tests/test_migration_332_staff_security_audit.py (suspension guard on every reactivation path, concurrent activation blocked on the lock) and backend/tests/test_activation_suspended_account.py (403 account_suspended before claim, code unused, admin issuance 409 with compensation); kind=test; ref=frontend/tests/login-suspended-account.test.mjs; kind=journey; ref=spec.md AC9 on staging with forced revocation failure | PENDING |
| FR-017 | kind=query; ref=rollout.md P4 readiness query on staging and production; kind=test; ref=backend/tests/test_migration_332_staff_security_audit.py (bootstrap grants, admins_exist refusal, zero-admin restore); kind=journey; ref=spec.md AC8 recovery drill timings on staging, including path (e) from zero eligible admins | PENDING |
| FR-019 | kind=test; ref=backend/tests/test_migration_336_suspended_account_role_guard.py (role change of a suspended account refused through the RPC, service REST, owner and superuser SQL; allowed after reactivation; bootstrap exempt; preconditions, postconditions, rollback); kind=test; ref=backend/tests/test_admin_user_role.py (409 account_suspended_role_change with the Vietnamese message); kind=journey; ref=spec.md AC10 on staging after 336 is applied | PENDING |

## T007 test evidence (PC-J40, 2026-10-28)

The FR-010 and FR-011 rows above stay `PENDING` until the staging journeys
(AC6) run in T012. The automated half, from `backend/`:

```bash
TEST_PG_URL=postgres://postgres@127.0.0.1:<port>/postgres REQUIRE_PG=1 \
  python -m pytest tests/test_owner_alerts.py tests/test_staff_security_sweep.py -q
```

Result: 48 passed on PostgreSQL 16.2 and 17.11 (local disposable clusters).
The PostgreSQL cases run the sweep and outbox SQL against migration 332 as
its NOSUPERUSER owner role, with a stand-in `auth.audit_log_entries`.

- FR-010: `test_staff_security_sweep.py` covers these cases:
  - a factor enrolled, verified and deleted between two runs gives one row each, and verified and deleted are alerted;
  - a re-run, and a rewound cursor, add no row or alert;
  - a failed batch rolls back its rows and the cursor;
  - entries inside the lag wait for the next run;
  - step-up sign-ins are not verifications;
  - an admin-API delete is attributed to `traits.user_id` with an unknown actor;
  - only admin accounts are audited;
  - the snapshot backstop fires only when the log has no entry for the factor, and ignores vanished unverified factors;
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
