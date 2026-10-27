# Rollout and rollback

The rollout is ordered so that the owner can never be locked out. Enforcement
is the last switch, it is per environment, and it can be turned off without a
code deploy.

## Preconditions

- **P1.** ADMINAAL2-0032 is approved on `staging` with Q1–Q10 decided, and the
  Leader has reserved migration 332.
- **P2.** Read-only confirmation that migration 320's `public.users` client
  guard is live on the target environment: no `UPDATE` grant on `users` for
  `authenticated` or `anon`, and the `BEFORE UPDATE` guard trigger is present.
  Without it, an ordinary account could change its own role. That would be a
  separate incident, handled before this rollout.
- **P3.** The email provider key and `OWNER_ALERT_EMAILS` are set in the
  Railway backend and cron services of the environment. One test alert has
  been sent with `python -m scripts.staff_security_sweep --test-alert`, which
  sends a fixed "kiểm tra kênh cảnh báo" message.
- **P4.** Readiness query (read-only; run as the runner role; the output is
  counts only, never emails):

  ```sql
  SELECT count(*) FILTER (WHERE f.verified >= 1) AS admins_with_totp,
         count(*)                                AS active_admins,
         count(*) FILTER (WHERE f.verified >= 2) AS admins_with_backup
    FROM public.users u
    LEFT JOIN LATERAL (
      SELECT count(*) AS verified FROM auth.mfa_factors m
       WHERE m.user_id = u.id AND m.factor_type = 'totp' AND m.status = 'verified'
    ) f ON true
   WHERE u.role = 'admin' AND u.is_active;
  ```

  Enforcement may be switched on only when `admins_with_totp = active_admins`
  and (`active_admins >= 2` or `admins_with_backup >= 1`). The same numbers
  come from the Auth admin API if the runner cannot read `auth.mfa_factors`.
- **P5.** The synthetic staging admin has a TOTP factor, and
  `STAGING_E2E_ADMIN_TOTP_SECRET` is in GitHub Actions secrets (FR-016).

## Staging

- **S1.** Apply `332_staff_security_audit.sql` with the advisory-locked runner
  (`backend/scripts/apply_migrations.sh`) before the dependent backend SHA is
  deployed.
- **S2.** Postconditions (read-only):
  - the three tables exist with RLS on;
  - `has_table_privilege('authenticated', 'public.staff_security_audit', 'SELECT')`
    is false;
  - `has_table_privilege('service_role', 'public.staff_security_audit', 'UPDATE')`
    is false;
  - the trigger on `public.users` exists;
  - `has_function_privilege('authenticated', 'public.fn_set_staff_privilege(uuid,uuid,text,boolean,text,text)', 'EXECUTE')`
    is false.
- **S3.** Deploy the merged staging SHA with `ADMIN_AAL2_ENFORCE=false` and
  start the cron service. Confirm that `admin_aal2_would_block` lines appear
  for AAL1 admin traffic, and that nothing else changed (the AC7 log excerpt).
- **S4.** Vinh and every staging admin enroll at `/admin/mfa`, including a
  backup factor (Q1). Run P4.
- **S5.** Audit coverage. Make one role change through the API and one in the
  SQL editor on a synthetic account. Check:

  ```sql
  SELECT event, source, count(*) FROM public.staff_security_audit
   WHERE occurred_at > now() - interval '1 hour' GROUP BY 1, 2;
  ```

  One email arrives per admin event (AC6).
- **S6.** Set `ADMIN_AAL2_ENFORCE=true` on the staging backend service.
  Railway restarts the service; this is not a code deploy. Run AC1–AC6 with
  synthetic accounts. Run live Staging E2E at the same SHA, which must be
  green with AAL2 admin sign-in.
- **S7.** Recovery drill (AC8). Time each path from the start of the action to
  restored admin access, and record it in `verification.md`:
  - (a) flag off and on again;
  - (b) delete a synthetic admin's factor through the Supabase dashboard, then
    that admin re-enrolls;
  - (c) sign in with the backup factor only.

## Production

- **R1.** Only through the `staging` → `main` promotion PR, with Vinh's
  explicit authorization for migration 332. Apply 332 under the advisory lock
  before the backend promotion. Run the S2 queries read-only.
- **R2.** Deploy with `ADMIN_AAL2_ENFORCE=false`. Confirm the cron is running
  and P3 passed on production.
- **R3.** Production admins enroll, including the backup factor. Run P4
  read-only on production.
- **R4.** On Vinh's go (Q6), set `ADMIN_AAL2_ENFORCE=true` on the production
  backend service. Immediately afterwards, Vinh signs in, passes the
  challenge, and opens `/admin` (AC2). An AAL1 attempt with a second admin
  account returns `mfa_required` (AC1). If anything fails, revert the flag
  first and investigate second.
- **R5.** Spot check one audit row and its email for a production admin event.
  The first expected event is the factor enrollments from R3.

## Rollback and repair

Who and how long. Targets are verified in S7; the measured values replace them
in `verification.md`.

| Path | When | Who | Steps | Target time |
| --- | --- | --- | --- | --- |
| **(a) Turn enforcement off** | Any lock-out, broken challenge, GoTrue MFA outage | Vinh, or a delegate with Railway project access | Railway → backend service → Variables → `ADMIN_AAL2_ENFORCE=false` → the service restarts with the same image. Admin works at AAL1 again (report-only). `is_active` and role checks stay on | ≤ 10 min |
| **(b) Reset one admin's factor** | An admin lost the phone and has no backup | Vinh as Supabase organization owner, after confirming the admin's identity out of band (phone or in person, never only by email) | Supabase dashboard → Authentication → Users → user → MFA factors → delete. Alternatively, the Auth admin API `DELETE /auth/v1/admin/users/{id}/factors/{factor_id}` with service_role from a trusted machine. The admin then re-enrolls at `/admin/mfa`. The sweep records `mfa_factor_deleted` (`source = auth`) and emails within 5 minutes | ≤ 30 min |
| **(c) Backup** | The owner's primary device is lost | Vinh | Sign in with the offline backup factor, or have the second MFA admin perform (b) for Vinh | ≤ 15 min |
| **(d) No clean admin left** | Both admins compromised or locked | Vinh with control-plane access | Path (a), then reset with the SQL editor as owner: `role`/`is_active` (audited as `out_of_band`, alerted). Revoke the attacker's sessions through the Supabase dashboard (sign out the user, ban). Follow `dr-tabletop-1027.md` §5 recovery | ≤ 120 min |

Code rollback: the previous backend SHA ignores the new tables. Migration 332
is additive and stays, and the trigger keeps auditing. If the trigger itself
must go (it should never block an update; see `plan.md`), the owner runs:

```sql
DROP TRIGGER IF EXISTS trg_users_privilege_audit ON public.users;
DROP FUNCTION IF EXISTS public.fn_users_privilege_audit();
DROP FUNCTION IF EXISTS public.fn_set_staff_privilege(uuid, uuid, text, boolean, text, text);
-- Tables are kept: the audit is evidence. Never DROP staff_security_audit.
```

Repair:

- Alert rows stuck in `failed` are re-queued by setting `status='pending',
  attempts=0` through the service-role sweep's `--requeue <audit_id>` flag.
  This is never a manual SQL edit of the audit itself.
- A suspension whose revocation failed is fixed with
  `POST /admin/users/{id}/revoke-sessions` (FR-008).
- Access-code history (`is_used`, `used_by`, `used_at`) is never touched by
  any path here.

## Observability

- **Logs** (Railway backend), all keyed by `request_id` and the user UUID,
  never email or token:
  - `admin_aal2_would_block` (report-only volume per admin; should reach 0
    before S6/R4);
  - `admin_aal2_blocked` (enforced);
  - `staff_guard_lookup_failed` (503);
  - `staff_revoke_failed`;
  - `owner_alert_failed`.
- **Cron**: the sweep logs one summary line per run (`dispatched`, `failed`,
  `factor_diffs`). A missing run for more than 15 minutes is visible in the
  Railway cron history, which Vinh checks daily during the rollout week.
- **Audit**: `staff_security_audit` is the history of record.
  `owner_alert_outbox.status = 'failed'` rows appear as `⚠ gửi lỗi` in
  "Lịch sử quyền".
- **Alert threshold**: any `sessions_revoke_failed` or `owner_alert_failed`
  sends an email (FR-011) or, if email itself is failing, a log at error
  level.
- **Owner**: Vinh. Delegate: the Leader for log review; Railway access stays
  with Vinh.
