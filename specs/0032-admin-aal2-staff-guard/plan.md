# Implementation plan

No code is written under this plan until ADMINAAL2-0032 is approved on
`staging` and the Leader has reserved migration 332 (Q8).

## Architecture impact

### Backend

- **`backend/services/staff_guard.py` (new)** is the one staff decision point.
  - `resolve_staff(authorization, *, need: "admin" | "instructor", allow_aal1: bool = False)`:
    1. Verifies the bearer through the existing `routers.auth.get_supabase_user`.
       It reuses the per-request memo, so there is no extra Auth round-trip.
    2. Reads `users.role` with `service_role` as today, then `is_active`
       through `activation_gate.account_is_active`. That is the phase-0
       (PR #1771) path, memoised per request, and its conftest
       default-active seam keeps existing staff tests valid. Any read failure
       gives 503.
    3. Applies the role and `is_active` rule.
    4. For role admin, reads `aal` from the payload of the token that Supabase
       Auth just accepted. It base64url-decodes the payload and requires
       `sub == user.id`. It never decodes a token that has not been accepted.
       A payload that cannot be decoded, or that has no `aal`, counts as
       `aal1`: denied under enforcement, logged in report-only. This also
       keeps the opaque test tokens of existing route tests working while the
       flag defaults to false.
    5. Applies `ADMIN_AAL2_ENFORCE`: either 403 `mfa_required`, or one
       `admin_aal2_would_block` warning.
  - It returns the auth user dict unchanged. `next_step` is derived from the
    `factors` array of that user object.
  - `is_privileged_admin(authorization) -> bool` is the soft variant. It never
    raises and returns false for an AAL1 admin under enforcement.
- **`backend/routers/admin.py`**: `require_admin` and `require_instructor` keep
  their names, signatures and return value. They become thin wrappers over
  `resolve_staff`, so the 329 call sites need no edit. `require_instructor`
  applies the AAL2 rule only when the caller's role is admin (FR-005). The
  phase-0 (PR #1771) `ensure_account_active` call moves inside
  `resolve_staff`, unchanged.
- **`backend/routers/sessions.py:585-600`**: the inline admin quota bypass
  calls `staff_guard.is_privileged_admin` instead of reading `users.role`.
  The soft `_is_admin` helpers in `health.py`, `reading_student.py` and
  `listening.py` already call `require_admin`, so they inherit the rule
  without edits.
- **`backend/config.py`** adds `ADMIN_AAL2_ENFORCE: bool = False`, `OWNER_ALERT_EMAILS: str = ""`
  and the email-provider key (Q2). Per the Q2 decision and decision (a),
  `OWNER_ALERT_EMAILS` holds only the recipient, and alerts are sent from
  `alerts@averlearning.com` through the Resend transport shared with
  AIBUDGET-0033; no separate sender variable is added. The flag uses the standard pydantic
  boolean parsing, so an unparseable value fails startup instead of choosing
  a mode.
- **`backend/services/staff_security.py` (new)**:
  - `set_role` and `set_active` call the migration-332 RPC
    `fn_set_staff_privilege`.
  - `revoke_sessions(user_id, *, ban: bool)` uses the mechanism chosen by
    gate R2.
  - `restore_sign_in(user_id)` unbans the account on reactivation.
  - Both enqueue alerts and return `{audit_id, changed, sessions_revoked, revoke_error, sign_in_restored}`.
- **`backend/routers/auth.py`**:
  - `activate_account` gains a Step 1d, beside the archived-profile Step 1c:
    it refuses a suspended account with 403 `{"code":"account_suspended"}`
    before the code is claimed, and maps the trigger's `account_suspended`
    at Step 3 to the same 403. Step 4 never runs, so the code stays unused.
  - `/auth/me` and `/auth/check-active` add `suspended: bool`.
  - Admin code issuance maps the trigger error to 409 `account_suspended`
    and compensates the issued code through the existing
    `_activate_with_issued_code` revoke path.
- **`backend/routers/admin_staff_security.py` (new)**, registered in
  `backend/main.py`:
  - `GET /admin/mfa/status` (`allow_aal1=True`, FR-004)
  - `PATCH /admin/users/{user_id}/active` (FR-006)
  - `POST /admin/users/{user_id}/revoke-sessions` (FR-008)
  - `GET /admin/users/{user_id}/security-audit` (FR-015)
  `PATCH /admin/users/{user_id}/role` stays in `admin.py` and delegates to
  `staff_security.set_role` (FR-007).
- **`backend/services/owner_alerts.py` (new)**: dispatches the
  `owner_alert_outbox` rows over one HTTPS email API.
  - Dispatch runs inline right after a committed API change.
  - **`backend/scripts/staff_security_sweep.py` (new)**, a Railway cron
    service every 5 minutes, also:
    1. dispatches `pending` rows, and `failed` rows below 5 attempts, with
       backoff;
    2. reads Supabase Auth's append-only audit log (`auth.audit_log_entries`,
       read-only, over the backend's existing direct DB connection) after the
       cursor stored in `staff_security_sweep_cursor`. For each factor event
       of an admin account, it writes one audit row in the same transaction
       that advances the cursor: enroll, verify or unenroll, keyed by the
       Auth log entry id (unique, so a re-run cannot duplicate). This is the
       durable event source. A factor verified and deleted between two runs
       still yields two rows (FR-010);
    3. as a backstop only, diffs every admin's factors from the Auth admin
       API (`GET /auth/v1/admin/users/{id}/factors`) against
       `staff_mfa_factor_snapshot`. A net difference that has no matching
       log-sourced row produces an audit row with `detail.detected_by =
       'snapshot'` and an error-level log, because it means the log missed an
       event.
  - `GET /admin/mfa/status` also runs the sweep steps for the caller only, so
    an admin's own enroll or removal is audited at once. PC-J201 admission is
    shared through `staff_mfa_status_throttle` (one private row per account):
    a 30-second unchanged-state cooldown is recorded only after both sweep
    steps succeed. Changed states can bypass that cooldown, but at most six
    sweep attempts may start per rolling minute, including failed attempts;
    an exhausted account receives 429 with `Retry-After`. Repeated reads
    skipped by cooldown or in-flight/busy admission do not consume attempts.
    A short, transaction-level advisory lock serializes admission across
    workers; at most two passes have active leases globally. No admission
    lock is held during Auth HTTP. Leases expire five seconds after the
    caller's overall timeout; completion clears only its own lease token.
    Admission failure logs and skips the caller pass, leaving the status
    response and the cron fallback available. The existing per-worker
    in-flight guard also limits admission connections during a local burst.
  - The cron has a 240-second overall `asyncio.wait_for` deadline, including
    connection setup, snapshot/Auth work, dispatch and the follow-up wait.
    Timeout logs `staff_security_sweep_failed error=timeout`, exits non-zero
    and cancels transactions; connection cleanup is bounded to one second.
  - The cron is the only new long-running component. Approving this spec
    approves it.
- **Why no trigger on `auth.mfa_factors`**: Supabase owns the `auth` schema
  and its upgrades may replace those tables. A failing trigger there would
  also block MFA enrollment, which is the lock-out this rollout must avoid.
  Reading the Auth audit log and the admin API gets the same truth without
  writing to the `auth` schema. Gate R5 must confirm the event names and
  traits, the read privilege, and that "write Auth audit logs to the database"
  is enabled on both projects (rollout P6).

### Frontend

- **`frontend/app/(authed-admin-mfa)/admin/mfa/` (new route)**: `page.tsx` and
  the client `admin-mfa.tsx`.
  - Uses the shared Supabase client through `getSupabase()` (no new browser
    client) and `sb.auth.mfa.enroll / challenge / verify / unenroll / listFactors`.
  - Renders the enroll QR from the SVG data URL GoTrue returns, so no new
    dependency.
  - Reads `GET /admin/mfa/status` through `frontend/lib/admin-mfa-api.ts`
    (generated OpenAPI types).
  - The page is **not** wrapped in `AdminAccessGate`, which would redirect
    loop. Its own gate requires signed-in, role admin and `is_active`.
- **`frontend/components/admin-access-gate.tsx`**: after the existing
  `/auth/me` role check:
  - calls `GET /admin/mfa/status` (an inactive account never gets here,
    because of the phase-0 activation redirect in PR #1771);
  - when `enforce && aal !== 'aal2'`, replaces the location with
    `/admin/mfa?next=…`;
  - when `!enforce && aal !== 'aal2'`, renders the report-only banner.
- **`frontend/lib/auth-wire-model.mjs` and `frontend/lib/auth-api.ts`**:
  `AuthRoleIdentity` adds `is_active`.
- **`frontend/public/js/api.js`**: a 403 whose `detail.code === 'mfa_required'`
  navigates to `/admin/mfa?next=<path+search>` (as 401 navigates to
  `/login`), except on `/admin/mfa` itself. Errors keep `.status`/`.detail`.
- **Instructor surfaces** (`instructor-dashboard.tsx`, `instructor-grade.tsx`,
  `instructor-compare.tsx`): map an inactive 403 received after load to the
  denied state (FR-014). Load-time redirect is phase 0 (PR #1771).
- **`frontend/app/(authed-admin-users)/admin/users/admin-users-panel.tsx`**:
  - a "Tạm khóa" / "Mở khóa" action on admin and instructor rows, with a
    reason dialog;
  - a result banner showing the revoke outcome and a "Thu hồi phiên lại"
    retry;
  - a "Lịch sử quyền" section from `GET /admin/users/{id}/security-audit`.
  After every mutation it refetches `/admin/users`, with no optimistic state.
- **Next-native admin verifiers**: all 60
  `frontend/tooling/verify-admin-*.mjs` stub `/auth/me`, and unknown API paths
  answer `{}`. The gate validates the status payload and fails closed, so it
  would show its error state in every verifier. A shared stub module,
  `frontend/tooling/admin-mfa-stub.mjs`, exports an AAL2 `/admin/mfa/status`
  route handler, and each verifier registers it next to its `/auth/me` stub
  (as the W-03 `/auth/check-active` stub was added). A new
  `verify-admin-mfa-flow.mjs` covers the enforced-AAL1 redirect, the
  report-only banner and the `/admin/mfa` states.
- **Route manifest**: register `/admin/mfa` for
  `frontend/tooling/route-ownership-check.mjs --manifest`. Regenerate
  `frontend/types/api.d.ts`.

### Staging E2E

- **`backend/scripts/staging_seed.py`** enrolls and verifies one TOTP factor for
  the synthetic admin, as that admin through GoTrue REST. It writes the secret
  only to the QA creds store, never to stdout. The step is idempotent: it keeps
  an existing verified factor.
- **`frontend/tests/staging-e2e/helpers.js`** gets a new exported
  `signInSession(request, role)`. It returns the complete GoTrue session
  (`access_token`, `refresh_token`, `expires_at`, `user`). For `admin` it
  runs the password grant, then `POST /auth/v1/factors/{id}/challenge` and
  `/verify`, and returns the AAL2 session from the verify response. The code
  is computed with RFC 6238 and `node:crypto` from the CI secret
  `STAGING_E2E_ADMIN_TOTP_SECRET`, with no new dependency.
  `signIn(request, role)` returns `signInSession(...).access_token`. The
  secret and tokens are never logged.
- **`frontend/tests/staging-e2e/writing-prompt-courses.spec.js:31-38`** does
  its own admin password grant. It uses that session both for
  `POST /admin/writing/prompts` and for browser storage injection. It moves
  to `helpers.signInSession(request, 'admin')`, so the API call and the
  injected browser session are both AAL2. The learner-role `signInSession`
  helpers in `core-player-failure-injection`, `pilot-3-profile`,
  `pilot-4-profile-save` and `speaking-start-flow` never sign in the admin;
  their admin tokens already come from `helpers.signIn`.
- **`frontend/tests/staging-e2e-admin-aal2-contract.test.mjs` (new,
  PR-time node test)** fails when any `frontend/tests/staging-e2e/*.js`
  file other than `helpers.js` posts `grant_type=password` for the admin
  identity, or uses an admin token that does not come from
  `helpers.signIn`/`signInSession`.

## Data and contracts

### Migration 332 (provisional number), `backend/migrations/332_staff_security_audit.sql`

Additive and forward-only, in one transaction.

0. **`public.users` suspension marker**: nullable `suspended_at timestamptz`,
   `suspended_by uuid`, `suspension_reason text`, with a CHECK that the three
   are set or cleared together and `suspended_at IS NULL OR NOT is_active`.
   Migration 320's client guard already rejects client changes to any column
   added later. A `BEFORE UPDATE OF is_active, suspended_at, suspended_by, suspension_reason ON public.users`
   trigger, `fn_users_suspension_guard`, raises SQLSTATE `P0001` with message
   prefix `account_suspended` in two cases: when `NEW.is_active AND NOT OLD.is_active AND OLD.suspended_at IS NOT NULL`,
   or when any marker column changes, unless the transaction-local
   `aver.staff_privilege` setting is `on`. Only `fn_set_staff_privilege` sets
   that setting. Under READ COMMITTED a concurrent activation `UPDATE` waits
   for the suspension's row lock, re-reads the committed row and is refused.
   This covers `activate_account` (`backend/routers/auth.py:565-580`),
   `_activate_user_for_code` (`backend/routers/admin.py:2473-2487`),
   `fn_restore_student` (`backend/migrations/326_student_archive.sql:248-250`)
   and SQL-editor updates.

1. **`public.staff_security_audit`**
   - Columns: `id uuid pk default gen_random_uuid()`,
     `occurred_at timestamptz not null default now()`,
     `event text not null check (event in ('role_changed','active_changed','staff_row_inserted','sessions_revoked','sessions_revoke_failed','mfa_factor_enrolled','mfa_factor_verified','mfa_factor_deleted','bootstrap_recovery'))`,
     `target_user_id uuid not null`, `actor_user_id uuid`,
     `source text not null check (source in ('admin_api','service','out_of_band','auth'))`,
     `before jsonb`, `after jsonb`, `reason text`, `request_id text`, `detail jsonb`.
   - No foreign keys, so the audit survives user deletion (as in 099/107).
   - Index `(target_user_id, occurred_at desc)`.
   - RLS enabled with no policies. `REVOKE ALL` from `PUBLIC`, `anon`,
     `authenticated`, `service_role`; `GRANT SELECT, INSERT` to `service_role`.
   - A `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` statement
     trigger raise an exception, so the table is append-only even for the
     table owner short of disabling triggers.
2. **`public.owner_alert_outbox`**
   - Columns: `id uuid pk`, `audit_id uuid not null unique references staff_security_audit(id)`,
     `event text not null`, `payload jsonb not null` (email-safe fields only),
     `status text not null default 'pending' check (status in ('pending','sent','failed'))`,
     `attempts int not null default 0`, `last_error text`,
     `next_attempt_at timestamptz not null default now()`, `sent_at timestamptz`,
     `created_at timestamptz not null default now()`.
   - RLS enabled with no policies. `service_role` gets `SELECT, INSERT, UPDATE`;
     clients get nothing.
3. **`public.staff_mfa_factor_snapshot`**
   - Columns: `user_id uuid`, `factor_id uuid`, `factor_type text`,
     `status text`, `seen_at timestamptz`, primary key `(user_id, factor_id)`.
   - `service_role` gets `SELECT, INSERT, UPDATE, DELETE`; clients get nothing.
   - **`public.staff_security_sweep_cursor`** (`name text pk`,
     `last_created_at timestamptz`, `last_entry_id uuid`, `updated_at`) has
     the same grants. `staff_security_audit` gets a partial unique index on
     `(detail->>'auth_log_entry_id')` where it is not null.
4. **`public.fn_users_privilege_audit()`** (SECURITY DEFINER,
   `search_path = public, pg_temp`), attached as an `AFTER INSERT OR UPDATE OF role, is_active ON public.users`
   row trigger. On update it fires only when `role` or `is_active` is
   distinct; on insert only when role is admin or instructor.
   - It writes one audit row.
   - `source` is `admin_api` when the transaction-local
     `aver.actor_id` setting is present, `service` when
     `request.jwt.claims ->> 'role' = 'service_role'`, and `out_of_band`
     otherwise (SQL editor, runner).
   - `actor_user_id`, `reason` and `request_id` come from the
     `aver.*` settings.
   - For admin-relevant changes (role to or from admin, or `is_active` changed
     on an admin) it also inserts an outbox row.
   - It runs after migration 320's `BEFORE UPDATE` client guard and does not
     change it.
5. **`public.fn_set_staff_privilege(p_actor uuid, p_target uuid, p_role text, p_is_active boolean, p_reason text, p_request_id text)`**
   (SECURITY DEFINER; `EXECUTE` revoked from `PUBLIC`, `anon`,
   `authenticated` and granted to `service_role` only).
   1. Locks the actor row, the target row and every `role = 'admin' AND is_active` row
      `FOR UPDATE` in id order.
   2. Raises `actor_not_admin` unless the actor is still `role = 'admin'`,
      `is_active` and not suspended under that lock, and differs from the
      target for any suspension change. A request whose actor was suspended
      after its guard check therefore fails.
   3. Raises `last_admin` (SQLSTATE `P0001`, message prefix `last_admin`)
      when the result leaves zero active admins.
   4. Sets `aver.actor_id`, `aver.reason`, `aver.request_id` and
      `aver.staff_privilege = on` with `set_config(..., true)`.
   5. Updates only the fields that change. Suspension sets `is_active = false`
      and the marker; reactivation clears the marker and sets
      `is_active = true` in the same `UPDATE`.
   6. Returns `(changed boolean, audit_id uuid, before jsonb, after jsonb)`.
      A no-op returns `changed = false` and writes no row.
5b. **`public.fn_bootstrap_admin_recovery(p_target uuid, p_operator text, p_reason text)`**
   is the control-plane-only path for path (e) in `rollout.md`.
   - SECURITY INVOKER, owned by the migration owner. `EXECUTE` is revoked from
     `PUBLIC`, `anon`, `authenticated` **and `service_role`**, so neither the
     app nor a leaked service key can call it. Only the database owner role
     can, from the SQL editor or the runner.
   - It locks every `role = 'admin'` row and raises `admins_exist` unless no
     admin is `is_active` and unsuspended. It therefore cannot bypass
     FR-006's actor rule while any eligible admin exists.
   - It sets `aver.staff_privilege = on`, then makes `p_target` `role = 'admin'`,
     `is_active = true` and clears its suspension marker in one `UPDATE`.
   - In addition to the trigger's own `role_changed` / `active_changed` rows
     (FR-009), it writes one `bootstrap_recovery` audit row (`source = out_of_band`,
     `actor_user_id = NULL`, `detail.operator = p_operator`, before and
     after) and an outbox row, so the owner is emailed.
   - It returns the audit id. Unbanning and the target's MFA factor stay in
     the Supabase dashboard (runbook (e)).
6. **Postcondition block**: the columns and CHECK, tables, grants, both
   triggers and function `EXECUTE` grants as above, including that `service_role` cannot execute `fn_bootstrap_admin_recovery`. The block aborts the transaction on mismatch. The
   `backend/migrations/README.md` numbering note and a
   `forward-policy.tsv` row (`pending_feature`, group `admin_aal2`) are
   updated with the migration.

**Compatibility with deployed code.** The deployed backend never calls the new
function. The only behaviour change for N-1 code is that each `users` update
touching `role` or `is_active` (activation, archive) also inserts one audit
row in the same transaction. The trigger function is SECURITY DEFINER, so
caller grants cannot make it fail. Rollback SQL (in `rollout.md`) drops the
trigger first, then the function, and keeps the tables.

### Migration 336, `backend/migrations/336_suspended_account_role_guard.sql` (FR-019)

Forward-only, one transaction, no data change, re-runnable. Same forward-policy
group as 332 (`pending_feature`, `admin_aal2`), applied after it.

- **Preconditions.** 332 is applied: the marker columns and
  `fn_set_staff_privilege` exist. No suspended row holds a non-staff role. Such
  a row could not be reactivated by FR-006 once its role is frozen, so the
  operator repairs it out of band first (`suspended_non_staff_account_exists`).
- **`fn_users_suspension_role_guard`** (SECURITY INVOKER, no client EXECUTE)
  and the trigger `BEFORE UPDATE OF role ON public.users`, named
  `trg_users_suspension_role_guard`. It raises P0001 `account_suspended_role_change`
  (DETAIL = user id) when `NEW.role IS DISTINCT FROM OLD.role AND OLD.suspended_at IS NOT NULL`.
  It ignores `aver.staff_privilege`, so the RPC's own UPDATE is refused too. The only
  bypass is `aver.bootstrap = 'on'`, which only `fn_bootstrap_admin_recovery`
  sets. The trigger name sorts after `trg_users_suspension_guard`, so an
  activation that also changes the role still fails with `account_suspended`.
- **Postconditions.** The function exists with the expected security, search_path
  and EXECUTE privileges, and the trigger is enabled. Rollback (header) drops
  the trigger, then the function.

### Wire contracts (all new response models are published in OpenAPI)

| Route | Request | Success | Errors |
| --- | --- | --- | --- |
| any admin route (enforced, AAL1) | — | — | 403 `{"detail": {"code":"mfa_required","next_step":"enroll"\|"challenge","message":…}}` |
| any staff route, inactive | — | — | 403 `{"detail":"Tài khoản chưa được kích hoạt"}` (existing `INACTIVE_DETAIL`) |
| `GET /admin/mfa/status` | — | `{aal:"aal1"\|"aal2", enforce:bool, verified_factor_count:int, next_step:"none"\|"enroll"\|"challenge"}` | 401, 403 non-admin/inactive, 503 |
| `PATCH /admin/users/{id}/active` | `{is_active:bool, reason:str}` | `{ok:true, id, is_active, suspended_at, changed, audit_id, sessions_revoked:bool\|null, revoke_error:str\|null, sign_in_restored:bool\|null}` | 400 self, 403 `actor_not_admin`, 404, 409 `{"code":"last_admin"}`, 422 non-staff/reason |
| `PATCH /admin/users/{id}/role` | `{role}` (unchanged) | `{ok, id, role}` **plus** `changed, audit_id, sessions_revoked, revoke_error` | existing 400/404/500, new 409 `last_admin`, 409 `{"code":"account_suspended_role_change","message":…}` (FR-019, migration 336) |
| `POST /auth/activate` (existing) | unchanged | unchanged | new 403 `{"code":"account_suspended","message":"Tài khoản đang bị tạm khóa — liên hệ admin"}`; code not consumed |
| `GET /auth/me`, `GET /auth/check-active` (existing) | — | additive `suspended: bool` | unchanged |
| `POST /admin/users/{id}/revoke-sessions` | `{reason?:str}` | `{ok:bool, sessions_revoked:bool, revoke_error:str\|null, audit_id}` | 404 |
| `GET /admin/users/{id}/security-audit` | `?limit=1..200` (default 50) | `{rows:[{id, occurred_at, event, source, actor_user_id, actor_email, before, after, reason, alert_status}], lookup_failed:false}` | 503 → frontend `⚠` |

Backward compatibility: the role PATCH response is additive. The existing admin
users panel reads only `ok/role`. Learners see no change. A FastAPI 403 with
an object `detail` is already supported by `public/js/api.js`.

### Source of truth

- Privilege: `public.users.role`, `public.users.is_active`.
- Assurance: the Supabase session (`aal` claim).
- Factors: Supabase Auth.
- History: `staff_security_audit`.

The frontend never caches any of these across navigations. Every admin
mutation refetches.

## UI and interaction

See [`ui-states.md`](ui-states.md). Ownership:

- `/admin/mfa`: new `admin-mfa.tsx`
- gate redirect and banner: `admin-access-gate.tsx`
- transport redirect: `public/js/api.js`
- suspend and history: `admin-users-panel.tsx` (plus a new
  `admin-security-history.tsx`)
- instructor inactive state: the three instructor clients

## Work decomposition

Order and file ownership are in [`tasks.md`](tasks.md). The backend guard (T002)
and the migration (T001) come before every UI task. The staging E2E TOTP
sign-in (T009) must merge before staging enforcement (T012).

## Rollout and rollback

Full procedure in [`rollout.md`](rollout.md). In summary:

1. Migration 332 goes to staging.
2. Code ships with `ADMIN_AAL2_ENFORCE=false` (report-only).
3. Admins enroll on staging, then production.
4. FR-017 readiness query.
5. Staging enforcement, with AC1–AC8 and the recovery drill.
6. Production enforcement on Vinh's go.

Rollback of AAL2 is one Railway variable plus a restart. Code rollback
leaves the additive tables in place.

## Verification strategy

- **Backend unit and route tests**:
  - the guard matrix (role × `is_active` × `aal` × flag × soft/hard);
  - the AAL1 allow-list inventory;
  - suspend, role, revoke and history routes;
  - alert outbox;
  - all with Supabase Auth mocked.
- **PostgreSQL tests for migration 332**:
  - trigger source classification;
  - append-only enforcement;
  - grants;
  - `last_admin` under two concurrent sessions;
  - N-1 activation still works with the trigger installed.
- **Frontend tests**:
  - node tests for the gate, transport and instructor states;
  - a Next-native browser verifier for `/admin/mfa` (enroll, challenge,
    wrong code, rate-limited, remove-with-fresh-code), with the GoTrue MFA
    endpoints stubbed.
- **Staging**:
  - gates R1–R3 and R5 (`research.md` §8) before T003/T006/T007;
  - AC1–AC8 with synthetic accounts;
  - the recovery drill with timings;
  - live Staging E2E green with enforcement on.
- **Production**:
  - the FR-017 read-only query;
  - AC1/AC2 with the owner's own admin after enforcement;
  - one audit/alert spot check.
