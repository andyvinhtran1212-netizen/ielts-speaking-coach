# Implementation plan

No code is written under this plan until ADMINAAL2-0032 is approved on
`staging` and the Leader has reserved migration 332 (Q8).

## Architecture impact

### Backend

- **`backend/services/staff_guard.py` (new)** is the one staff decision point.
  - `resolve_staff(authorization, *, need: "admin" | "instructor", allow_aal1: bool = False)`:
    1. Verifies the bearer through the existing `routers.auth.get_supabase_user`.
       It reuses the per-request memo, so there is no extra Auth round-trip.
    2. Makes one `service_role` read, `users.role, users.is_active`. A read
       failure gives 503.
    3. Applies the role and `is_active` rule.
    4. For role admin, reads `aal` from the payload of the token that Supabase
       Auth just accepted. It base64url-decodes the payload and requires
       `sub == user.id`. It never decodes a token that has not been accepted.
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
  phase-0 (PR #1771) `ensure_account_active` call is folded into the same single read.
- **`backend/routers/sessions.py:585-600`**: the inline admin quota bypass
  calls `staff_guard.is_privileged_admin` instead of reading `users.role`.
  The soft `_is_admin` helpers in `health.py`, `reading_student.py` and
  `listening.py` already call `require_admin`, so they inherit the rule
  without edits.
- **`backend/config.py`** adds `ADMIN_AAL2_ENFORCE: bool = False`, `OWNER_ALERT_EMAILS: str = ""`
  and the email-provider key (Q2). The flag uses the standard pydantic
  boolean parsing, so an unparseable value fails startup instead of choosing
  a mode.
- **`backend/services/staff_security.py` (new)**:
  - `set_role` and `set_active` call the migration-332 RPC
    `fn_set_staff_privilege`.
  - `revoke_sessions(user_id, *, ban: bool)` uses the mechanism chosen by
    gate R2.
  - Both enqueue alerts and return `{audit_id, changed, sessions_revoked, revoke_error}`.
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
    an admin's own enroll or removal is audited at once.
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
- **Route manifest**: register `/admin/mfa` for
  `frontend/tooling/route-ownership-check.mjs --manifest`. Regenerate
  `frontend/types/api.d.ts`.

### Staging E2E

- **`backend/scripts/staging_seed.py`** enrolls and verifies one TOTP factor for
  the synthetic admin, as that admin through GoTrue REST. It writes the secret
  only to the QA creds store, never to stdout. The step is idempotent: it keeps
  an existing verified factor.
- **`frontend/tests/staging-e2e/helpers.js`**: `signIn(request, 'admin')`
  performs `POST /auth/v1/factors/{id}/challenge` and `/verify`, computing the
  RFC 6238 code with `node:crypto` from the CI secret
  `STAGING_E2E_ADMIN_TOTP_SECRET`. No new dependency. The secret and tokens are
  never logged.

## Data and contracts

### Migration 332 (provisional number), `backend/migrations/332_staff_security_audit.sql`

Additive and forward-only, in one transaction.

1. **`public.staff_security_audit`**
   - Columns: `id uuid pk default gen_random_uuid()`,
     `occurred_at timestamptz not null default now()`,
     `event text not null check (event in ('role_changed','active_changed','staff_row_inserted','sessions_revoked','sessions_revoke_failed','mfa_factor_enrolled','mfa_factor_verified','mfa_factor_deleted'))`,
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
   1. Locks the target row and every `role = 'admin' AND is_active` row
      `FOR UPDATE` in id order.
   2. Raises `last_admin` (SQLSTATE `P0001`, message prefix `last_admin`)
      when the result leaves zero active admins.
   3. Sets `aver.actor_id`, `aver.reason` and `aver.request_id` with
      `set_config(..., true)`.
   4. Updates only the fields that change.
   5. Returns `(changed boolean, audit_id uuid, before jsonb, after jsonb)`.
      A no-op returns `changed = false` and writes no row.
6. **Postcondition block**: tables, grants, triggers and function `EXECUTE`
   grants as above. The block aborts the transaction on mismatch. The
   `backend/migrations/README.md` numbering note and a
   `forward-policy.tsv` row (`pending_feature`, group `admin_aal2`) are
   updated with the migration.

**Compatibility with deployed code.** The deployed backend never calls the new
function. The only behaviour change for N-1 code is that each `users` update
touching `role` or `is_active` (activation, archive) also inserts one audit
row in the same transaction. The trigger function is SECURITY DEFINER, so
caller grants cannot make it fail. Rollback SQL (in `rollout.md`) drops the
trigger first, then the function, and keeps the tables.

### Wire contracts (all new response models are published in OpenAPI)

| Route | Request | Success | Errors |
| --- | --- | --- | --- |
| any admin route (enforced, AAL1) | — | — | 403 `{"detail": {"code":"mfa_required","next_step":"enroll"\|"challenge","message":…}}` |
| any staff route, inactive | — | — | 403 `{"detail":"Tài khoản chưa được kích hoạt"}` (existing `INACTIVE_DETAIL`) |
| `GET /admin/mfa/status` | — | `{aal:"aal1"\|"aal2", enforce:bool, verified_factor_count:int, next_step:"none"\|"enroll"\|"challenge"}` | 401, 403 non-admin/inactive, 503 |
| `PATCH /admin/users/{id}/active` | `{is_active:bool, reason:str}` | `{ok:true, id, is_active, changed, audit_id, sessions_revoked:bool\|null, revoke_error:str\|null}` | 400 self, 404, 409 `{"code":"last_admin"}`, 422 non-staff/reason |
| `PATCH /admin/users/{id}/role` | `{role}` (unchanged) | `{ok, id, role}` **plus** `changed, audit_id, sessions_revoked, revoke_error` | existing 400/404/500, new 409 `last_admin` |
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
