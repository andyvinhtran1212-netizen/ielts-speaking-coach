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
| FR-016 | kind=test; ref=frontend/tests/staging-e2e-admin-aal2-contract.test.mjs (only helpers.js signs in the admin; writing-prompt-courses uses signInSession; helpers AAL2 step-up, AAL1 fallback without the secret, RFC 6238 vectors, no secret in errors); kind=test; ref=backend/tests/test_staging_seed_admin_totp.py (secret only in the 0600 creds file, reseed keeps a verified factor only when the stored secret verifies, reset); kind=journey; ref=live Staging E2E at the T012 SHA with ADMIN_AAL2_ENFORCE=true, admin seams and the Writing course allocation journey green; kind=check; ref=CI log scan shows no TOTP secret or token | PENDING |
| FR-018 | kind=test; ref=backend/tests/test_migration_332_staff_security_audit.py (suspension guard on every reactivation path, concurrent activation blocked on the lock) and backend/tests/test_activation_suspended_account.py (403 account_suspended before claim, code unused, admin issuance 409 with compensation); kind=test; ref=frontend/tests/login-suspended-account.test.mjs; kind=journey; ref=spec.md AC9 on staging with forced revocation failure | PENDING |
| FR-017 | kind=query; ref=rollout.md P4 readiness query on staging and production; kind=test; ref=backend/tests/test_migration_332_staff_security_audit.py (bootstrap grants, admins_exist refusal, zero-admin restore); kind=journey; ref=spec.md AC8 recovery drill timings on staging, including path (e) from zero eligible admins | PENDING |
| FR-019 | kind=test; ref=backend/tests/test_migration_336_suspended_account_role_guard.py (role change of a suspended account refused through the RPC, service REST, owner and superuser SQL; allowed after reactivation; bootstrap exempt; preconditions, postconditions, rollback); kind=test; ref=backend/tests/test_admin_user_role.py (409 account_suspended_role_change with the Vietnamese message); kind=journey; ref=spec.md AC10 on staging after 336 is applied | PENDING |

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

### T009 hand-off: Leader steps before T012 enforcement (staging only)

T009 (PC-J41) changed code only. Nobody has run the seed, enrolled a factor
or set a secret yet. The steps below are for the Leader. Run them in this
order, staging only. Never print the secret.

1. **Seed the factor.** Run `python3 scripts/staging_seed.py --ns smoke --admin-totp-file /workspace/qa/creds/staging-e2e-admin-totp-smoke.env` from `backend/`.
   - `E2E_PASSWORD` is the current secret value.
   - `backend/.env.staging` has `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `SUPABASE_ANON_KEY`.
   - Expected line: `+ e2e-admin-smoke@… TOTP factor enrolled and verified; secret written to …`. A rerun prints `= … TOTP factor kept`.
   - The step's verify signs out every other AAL1 session of the admin (`research.md` §9.3), so do not run it while live Staging E2E is running.
2. **Store the CI secret.** Run `gh secret set -f /workspace/qa/creds/staging-e2e-admin-totp-smoke.env`. The file is one dotenv line, `STAGING_E2E_ADMIN_TOTP_SECRET=…`, mode 0600.
3. **Pass it to the smoke job.** Add `STAGING_E2E_ADMIN_TOTP_SECRET: ${{ secrets.STAGING_E2E_ADMIN_TOTP_SECRET }}` to the `Run live staging release smoke` step env in `.github/workflows/staging-release-smoke.yml`. That file is outside T009 `owns`, so it needs its own PR. While the variable is empty, `helpers.signInSession` keeps the AAL1 password session, which is valid only while `ADMIN_AAL2_ENFORCE` is off.
4. **Check AAL2 with the flag still off.** Run live Staging E2E. It must be green, the admin seams must get an `aal2` token, and the CI log must contain no secret or token (FR-016 kind=check).
5. **Rotation or loss.** Rerun step 1 with `--reset-admin-totp`. It deletes the admin's TOTP factors and enrolls a new one. Then repeat step 2.

**Open gap for T012 (outside T009 `owns`).**
`frontend/tooling/capture-staging-release-provenance.mjs` signs in the admin
with a password only and reads `git_sha` from `GET /health/runtime`. That
route uses the soft admin check (lot 03). Under enforcement an AAL1 admin is
treated as a non-admin, so the release fingerprint is redacted and the
provenance gate fails. Before `ADMIN_AAL2_ENFORCE=true`, the tool must step
the admin up to AAL2 from the same secret, in its own PR.
