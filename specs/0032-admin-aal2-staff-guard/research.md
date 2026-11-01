# Research: staff guards, role/is_active writes, MFA and alerting today

Survey of `origin/staging` at `5cdb93953` (2026-10-27). Read-only code reading;
no database, Auth or provider call was made for this spec. Statements marked
**verify** are Supabase Auth (GoTrue) behaviours that must be confirmed on
staging with a synthetic account before implementation (gates R1–R3 and R5, below; R4 was dropped with the auth-schema trigger).
The gate results (T001, run on staging on 2026-10-28 with synthetic accounts
only) are in §9. They supersede the **verify** markers in §1–§4.

## 1. Backend guards

### 1.1 The two guards

| Guard | Location | What it checks today |
| --- | --- | --- |
| `require_admin(authorization)` | `backend/routers/admin.py:84-103` | Bearer token verified by Supabase Auth, then `users.role == 'admin'` read with `service_role` on every call. No `is_active`, no assurance level. A lookup exception is a 500. |
| `require_instructor(authorization)` | `backend/routers/admin.py:106-131` | Same, with `role in ('instructor', 'admin')`. No `is_active`, no assurance level. |

Both are plain async functions called at the top of each handler
(`await require_admin(authorization)`), not FastAPI `Depends`. There are 329
`await require_admin(` / `await require_instructor(` call sites in
`backend/routers/`.

PR #1771 (job Q-13, merged to `staging` as `4c3a192fc` on 2026-10-28, after this survey) adds `activation_gate.ensure_account_active(user_id)`
after the role check in both guards. It also removes `/admin` and `/instructor`
from the frontend activation-redirect exemptions
(`frontend/lib/auth/activation-gate.mjs`, `ACTIVATION_EXEMPT_PREFIXES`), so an
inactive account opening a staff console is sent to `/login`, which opens the
access-code dialog. This fixes the production report that an inactive
instructor can open `/instructor`. This spec treats #1771 as phase 0 and builds
the single staff guard on top of it (FR-001, FR-005, FR-014).

### 1.2 Token verification and the `aal` claim

`backend/routers/auth.py:123-187` (`get_supabase_user`) verifies the bearer by
calling `GET {SUPABASE_URL}/auth/v1/user` (line 160) and returns the GoTrue
**user object**. That object has no `aal`. The assurance level is a claim in the
access-token JWT (`aal`, with `amr` and `session_id`). The repository decodes no
JWT today: there is no `jwt`/`jose` import and no `aal`, `amr` or `factor`
reference in `backend/`.

Because GoTrue has just accepted the same token, the backend can read `aal`
from that token's payload without a second signature check. No new secret is
needed. The user object includes a `factors` array (id, type, status), so the
guard can tell "no verified factor yet" (enroll) from "factor exists, session
still AAL1" (challenge). **verify** R1.

`activation_gate.remembered_user` (`backend/services/activation_gate.py:133-138`)
memoises the verified user for one request only. `aal` must come from the same
token, so the memo keeps working.

### 1.3 Activation gate and staff paths

`backend/services/activation_gate.py`:

- `STAFF_PATH_PREFIXES = ("/admin", "/api/admin", "/instructor")` (line 49).
  The learner gate skips these paths (`_enforce`, lines 194-204), so today
  nothing checks `is_active` on staff routes.
- `lookup_is_active` (lines 147-165) fails closed with a 503 when the read
  fails. `ensure_account_active` (line 188) raises 403 with `INACTIVE_DETAIL`
  ("Tài khoản chưa được kích hoạt").
- `tests/test_activation_gate_inventory.py` walks the real app. It is the model
  for the staff-guard inventory test (T004).

### 1.4 Admin power outside the `/admin` prefix

An AST scan of `backend/routers/*.py` (decorated route functions whose body
calls `require_admin(` or `_is_admin(`, with the router's `prefix`) found that
most modules mixing learner and admin routes use a separate
`admin_router` with an `/admin/...` prefix (`listening.py:112`, `exercises.py:36`,
`mock_corrections.py:21`, `advanced_vocab.py:16`). The routes outside the
`/admin` prefix that need admin are:

| Route | Location | Kind |
| --- | --- | --- |
| `GET /api/admin/feedback` | `backend/routers/feedback.py:363` | hard (`require_admin`) |
| `PATCH /api/admin/feedback/{feedback_id}` | `backend/routers/feedback.py:506` | hard |
| `GET /health/ready`, `GET /health/runtime` | `backend/routers/health.py:127, 216` | soft (`_is_admin`, lines 36-52: unredacted diagnostics) |
| `GET /api/listening/tests/attempts/{attempt_id}/review` | `backend/routers/listening.py:8883` | soft (`_is_admin`, lines 7882-7893: review another user's sealed attempt) |
| `GET /api/reading/test/attempts/{attempt_id}/review` | `backend/routers/reading_student.py:1714` | soft (`_is_admin`, lines 102-114: same for Reading) |

A path-prefix rule cannot cover the soft checks, and `/health/*` is not a staff
path. Enforcement therefore belongs in the guard function itself, which every
one of these calls.

One inline privilege read bypasses the guard:
`backend/routers/sessions.py:585-600`. It reads `users.role` and lets admins
skip the daily session quota.

Role reads that are not privilege grants to the caller, and so are out of scope:

- `backend/routers/writing_student.py:1189-1210`: routing by the *assigner's*
  role.
- `backend/routers/auth.py:542-609`: activation and promote-by-code.

### 1.5 Instructor impersonation

`backend/routers/instructor.py:106-125` (`_me`): an admin calling `/instructor/*`
with `?as_instructor=X` acts as X. Every impersonated request is audited
fail-closed in `governance_audit` (lines 91-104, migration 107). Admin role is
detected with `_role_of` (lines 84-88). Impersonation is an admin power, so an
AAL1 admin must not get it (FR-005).

## 2. Where role and is_active change

| Path | Location | Audit today |
| --- | --- | --- |
| Admin role change `PATCH /admin/users/{user_id}/role` | `backend/routers/admin.py:825-860`. Allow-list `_VALID_ROLES = {admin, instructor, student}` at line 716; self-demotion refused at line 846 | **None** |
| Promote to instructor via access code | `backend/routers/auth.py:82-101` (`_audit_promote_attempt`) | Best-effort `access_code_audit` row (migration 099) |
| Activation by self-service code / admin-issued code | `backend/routers/auth.py:580`, `backend/routers/admin.py:2473-2487` (`_activate_user_for_code`) | Code audit only, not an `is_active` audit |
| Activation rollback after a lost archive race | `backend/routers/auth.py:401-427` (`_restore_archived_account_state`) | Log line only |
| Student archive with account lock | `backend/migrations/326_student_archive.sql:172-176` (`fn_archive_student`) | `student_lifecycle_audit` |
| Supabase SQL editor / dashboard (out of band) | — | **None** |

Paths that set `is_active = true` (each would undo a suspension expressed
only as `is_active = false`; Codex review round 3 on #1772):

- `activate_account` Step 3, `backend/routers/auth.py:565-580`. This runs
  before Step 4 marks the code used, after the archived-profile refusal at
  lines 511-533.
- `_activate_user_for_code`, `backend/routers/admin.py:2473-2487`.
- `fn_restore_student` with `p_reactivate_account`,
  `backend/migrations/326_student_archive.sql:248-250`.

There is **no** admin API that sets `users.is_active = false` for a staff
account. Suspending an admin today needs SQL, and the admin keeps full power
because `require_admin` never reads `is_active`. This is the dr-tabletop §5
finding. Migration 320 (`backend/migrations/320_client_write_privilege_lockdown.sql:66-75`)
removes client UPDATE on `public.users` and rejects client-role changes to
`role`/`is_active`. Its live state on production was not confirmed in the
tabletop. Confirming it is precondition P2 in `rollout.md`.

Existing audit tables are append-only by convention, not by grant:
`access_code_audit` (099) and `governance_audit` (107). Neither covers role or
`is_active`.

## 3. Session revocation

The backend never revokes a Supabase session. `supabase==2.28.3` is pinned in
`backend/requirements.txt`. Only the seed script uses
`auth.admin.*`, at `backend/scripts/staging_seed.py:83-176`
(`update_user_by_id`, `create_user`, `list_users`, `delete_user`). Candidate
mechanisms, to be confirmed by R2:

1. `auth.admin.update_user_by_id(uid, {"ban_duration": ...})`: a banned user
   cannot exchange a refresh token or sign in. **verify**
2. Deleting the user's rows in `auth.sessions`, which cascades to
   `auth.refresh_tokens`. GoTrue rejects an access token whose `session_id` no
   longer exists (`session_not_found`), so even an unexpired access token fails
   at `/auth/v1/user`. **verify** that the migration/DB role may delete there
   on Supabase.
3. Unbanning (`ban_duration: "none"`) on reactivation. **verify**

Access-token TTL is 3,600 s with refresh rotation on, on both projects
(`/workspace/cc-jobs/dr-tabletop-1027.md`, "Metadata đã xác nhận"). The DB read
in the guard already makes the next request fail. Revocation additionally makes
refresh and every backend surface fail (AC3). Gate R2 (§9.2) chose the
mechanism. A direct PostgREST call still accepts the old access token until it
expires.

## 4. MFA in Supabase Auth

- TOTP enroll and verify are enabled on staging and production (tabletop
  metadata). Actual enrolment of admins was not checked.
- Frontend `@supabase/supabase-js` is `2.107.0` (`frontend/package.json:35`),
  which exposes `auth.mfa.enroll / challenge / verify / unenroll /
  listFactors / getAuthenticatorAssuranceLevel`. No frontend code uses them
  today.
- Supabase Auth has **no recovery codes**. The documented recovery pattern is
  a second enrolled factor. Up to 10 factors per user. **verify** R3.
- Unenrolling a *verified* factor requires an AAL2 session (GoTrue rule).
  **verify** R3. This is the server-side half of "an admin cannot remove their
  own factor without re-auth".
- Factor changes go straight from the browser to GoTrue; the backend never sees
  them. Audit therefore needs an event source outside the backend. A trigger
  on `auth.mfa_factors` is rejected (`plan.md` §Architecture impact): Supabase
  owns the `auth` schema, and a failing trigger there would block MFA
  enrollment itself. A snapshot diff alone is also rejected: it misses a factor
  verified and deleted between two sweeps (Codex review on #1772). The plan
  reads GoTrue's own append-only audit log (`auth.audit_log_entries`), which
  records factor actions (**verify** R5), by a durable cursor.

## 5. Frontend guards

| Surface | Location | Behaviour today |
| --- | --- | --- |
| Admin pages (73 files wrap it) | `frontend/components/admin-access-gate.tsx:39-97` | Signed-out redirects to `/login`. Reads `/auth/me` through `getAuthorizationIdentity` (`frontend/lib/auth-api.ts:18-24`, which picks only `id`, `email`, `role`). `role === 'admin'` gives `ready`, else `denied`. No `is_active`, no AAL. |
| Instructor workspace | `frontend/app/(authed-instructor)/instructor/instructor-dashboard.tsx:150-157, 350-352` | Role check only. The prod bug is an inactive instructor seeing the page. |
| Instructor grade / compare | `frontend/app/(authed-instructor-grade)/instructor/grade/instructor-grade.tsx`, `frontend/app/(authed-instructor-compare)/instructor/compare/instructor-compare.tsx` | Same role-based pattern |
| Shared transport | `frontend/public/js/api.js:211-243` | 401 redirects to `/login`. Other errors throw with `.status` and `.detail` (object details keep `detail.code`). No `mfa_required` handling. |
| Admin users panel | `frontend/app/(authed-admin-users)/admin/users/admin-users-panel.tsx:134, 267` | Role change via `PATCH /admin/users/{id}/role`. Shows Active/Inactive. No suspend action. |

Route ownership for a new `/admin/mfa` route is enforced by
`frontend/tooling/route-ownership-check.mjs --manifest`
(`.github/workflows/route-manifest.yml:91`).

## 6. Alerting

The backend has **no outbound email**: no SMTP, Resend, SendGrid, Postmark or
Mailgun client, and no alert webhook. `services/runtime_flags.py` documents that
env flags apply on Railway variable change + restart, and that DB runtime flags
fail open. The AI-BUDGET brief (`/workspace/specs-drafts/AI-BUDGET-brief.md`)
needs the same owner-email channel. The channel in this spec is meant to be
reused (Q2, decided 2026-10-28: same channel and recipients).

## 7. Staging E2E depends on a password-only admin

The required live Staging E2E signs in a synthetic admin with a password and
uses that token for admin seams. This gives an AAL1 session:

- `frontend/tests/staging-e2e/gate-a-flows.spec.js:35-76`
- `speaking-start-flow.spec.js:68`
- `core-player-failure-injection.spec.js:72`
- `pilot-4-profile-save.spec.js:63,179`
- `next-optimization-proof.spec.js:63`
- `writing-prompt-courses.spec.js:31-38`: its own admin password grant, used for an admin API call and injected into browser storage. It does not go through `helpers.signIn`.

The cleanup seam is `DELETE /admin/e2e/sessions/{id}` in
`frontend/tests/staging-e2e/helpers.js:148-152`. The admin itself comes from
`backend/scripts/staging_seed.py:141`. Turning enforcement on in staging without
FR-016 would break the promotion gate.

## 8. Staging gate before implementation (read-only or synthetic-only)

| ID | Question | Method | Blocks |
| --- | --- | --- | --- |
| R1 | Supabase access tokens carry `aal`, `amr`, `session_id`; `aal` becomes `aal2` after challenge+verify and survives refresh | Synthetic staging admin: enroll, challenge, decode the payload locally (never print the token) | T002 |
| R2 | Which revocation (ban, `auth.sessions` delete, or both) makes (a) an unexpired access token fail at `/auth/v1/user` and (b) the refresh-token grant fail; and does unban restore sign-in | Synthetic staging instructor | T003 |
| R3 | Unenroll of a verified factor from an AAL1 session is refused; a second factor can be enrolled; the factor limit; `GET /auth/v1/admin/users/{id}/factors` lists factors with status | Synthetic staging admin | T006, T007 |
| R5 | `auth.audit_log_entries` records factor enroll, verify and unenroll for a synthetic admin, with factor id and user id. The backend DB role can `SELECT` it. "Write Auth audit logs to the database" is on in both projects (Auth config, read-only) | Synthetic staging admin; read-only SQL and Auth config read | T007; if it fails, FR-010 returns for re-approval |
| R6 | An account with one verified TOTP factor, in an AAL1 session, calls `mfa.enroll` (F-03 Gap A, added 2026-10-28 09:35) | Synthetic staging admin | T006/T010 (FR-012), T007 |

## 9. Gate results (T001, staging, 2026-10-28)

Run on the staging project `zjphffoujxkpltixsbzj` between 04:56Z and 05:02Z
(2026-10-28) against `origin/staging` at `f669785c4`. Production was not
touched. No Auth setting was changed.

### 9.0 Method and accounts

- **Accounts.** Four synthetic GoTrue-only accounts were created with
  `POST /auth/v1/admin/users` (`email_confirm: true`, random password,
  `user_metadata.synthetic = "q78-aal2-gates"`). Their addresses are
  `q78-gate-{admin,admin2,admin3,instructor}-<ns>@staging-e2e.averlearning.com`.
  No account got a `public.users` row (checked: 0 rows). There is no
  `auth.users` trigger that creates one, so no account held an app role. The
  gates test GoTrue behaviour, which does not read `public.users.role`, so an
  app-level admin was not needed.
- **Transport.** User calls go to `https://<ref>.supabase.co/auth/v1/*`, with
  the project's anon key as `apikey` and the user's access token as bearer.
  These are the same endpoints `supabase-js` `auth.mfa.*` calls. Admin calls
  use the staging secret key. SQL is read-only `SELECT`, except the R2
  `DELETE FROM auth.sessions` on the synthetic account. It goes through the
  Management API `POST /v1/projects/<ref>/database/query`, which runs as
  `postgres`. TOTP codes were computed locally (RFC 6238, SHA-1, 30 s, 6
  digits).
- **Secret handling.** Tokens are decoded only to print the `aal`, `amr`,
  `session_id`, `role`, `iat` and `exp` claims. No token, TOTP secret,
  password or key was printed or stored. The harness is in the job directory
  (`/workspace/cc-jobs/q78/bin/`), not in the repository.
- **Cleanup.** Each run deletes its account with
  `DELETE /auth/v1/admin/users/{id}`, in `finally`. The final check returned
  `users 0, sessions 0, factors 0, public.users 0`:
  ```sql
  select (select count(*) from auth.users where email like 'q78-gate-%') users,
         (select count(*) from auth.sessions s join auth.users u on u.id = s.user_id where u.email like 'q78-gate-%') sessions,
         (select count(*) from auth.mfa_factors f join auth.users u on u.id = f.user_id where u.email like 'q78-gate-%') factors,
         (select count(*) from public.users where email like 'q78-gate-%') pub,
         (select count(*) from auth.mfa_factors where friendly_name like 'q78-%') factors_by_name;
  ```
  The `auth.audit_log_entries` rows these runs produced stay. That log is
  GoTrue's append-only record and was not edited.

Staging Auth config, read with `GET /v1/projects/<ref>/config/auth`:
`mfa_totp_enroll_enabled=true`, `mfa_totp_verify_enabled=true`,
`mfa_max_enrolled_factors=10`, `mfa_allow_low_aal=false`, `jwt_exp=3600`,
`refresh_token_rotation_enabled=true`, `sessions_timebox=0`,
`sessions_inactivity_timeout=0`, `audit_log_disable_postgres=false`.

### 9.1 R1: `aal` / `amr` / `session_id` in the access token (PASS)

| Step | Call | Observed claims / result |
| --- | --- | --- |
| Password sign-in | `POST /token?grant_type=password` | `aal=aal1`, `amr=[{method: password, timestamp}]`, `session_id` set |
| User object, no factor | `GET /user` | 200; the `factors` key is **absent** (not `[]`) |
| Enroll | `POST /factors {factor_type: totp, friendly_name}` | 200 `{id, type, friendly_name, totp: {qr_code, secret, uri}}`; `GET /user` lists the factor with `status: unverified` |
| Challenge + verify | `POST /factors/{id}/challenge`, then `POST /factors/{id}/verify {challenge_id, code}` | 200 with a new token pair: `aal=aal2`, `amr=[{totp, t_verify}, {password, t_signin}]`, **same** `session_id`; `GET /user` shows `status: verified` |
| Refresh | `POST /token?grant_type=refresh_token` | `aal=aal2`. The `amr` totp timestamp is **unchanged** (refresh does not renew it). Same `session_id` |

The guard can read `aal` and `amr` from the token GoTrue has just accepted.
`GET /auth/v1/user` returns `factors[]` (`id`, `factor_type`, `status`), so
"no verified factor" (enroll) can be told apart from "factor exists, session
AAL1" (challenge). Treat a missing `factors` key as zero factors. The `amr`
TOTP timestamp is the time of the last TOTP verification on that session and
survives refresh. It is a valid anchor for an AAL2 maximum age (F-03 Gap B).

**Follow-up (account `admin3`):** after a factor is deleted, the session's
existing access token still says `aal=aal2` and `GET /auth/v1/user` still
returns 200 until `exp` (≤ 3,600 s). This holds for a self-unenroll at AAL2 and
for an admin-API delete. The user object at that point lists 0 verified
factors. The next refresh returns `aal1`. Note that GoTrue does not lower the
AAL of a live token.

### 9.2 R2: session revocation and ban (PASS, mechanism chosen)

Synthetic account `instructor`. Each probe calls `GET /auth/v1/user` (the
backend's verification path), `GET /rest/v1/users?select=id&limit=1` (direct
PostgREST) and the refresh-token grant.

| Action | `/auth/v1/user` | PostgREST | Refresh | New password sign-in |
| --- | --- | --- | --- | --- |
| Ban only: `PUT /auth/v1/admin/users/{id} {"ban_duration":"876000h"}` | 403 `user_banned` | **200** | 400 `user_banned` | 400 `user_banned` |
| Unban (`{"ban_duration":"none"}`), old session never touched | **200 again** | 200 | **200 again** | 200 |
| Session delete only (SQL below) | 403 `session_not_found` | **200** | 400 `refresh_token_not_found` | **200** (new session) |
| Ban, then session delete | 403 `session_not_found` | **200** | 400 `refresh_token_not_found` | 400 `user_banned` |
| …then unban | old token still 403 `session_not_found` | 200 | old token still 400 | 200 |

Ban did not delete any `auth.sessions` or `auth.refresh_tokens` row (2 / 2
before and after). The revocation SQL, run as `postgres`:

```sql
with d as (delete from auth.sessions where user_id = '<uid>' returning 1) select count(*) from d;
-- refresh tokens cascade: afterwards
select (select count(*) from auth.sessions where user_id = '<uid>') sessions,
       (select count(*) from auth.refresh_tokens where user_id = '<uid>'::text and not revoked) live_refresh;  -- 0, 0
```

Privileges (read-only):

```sql
select g.r,
       has_table_privilege(g.r, 'auth.audit_log_entries', 'SELECT') sel_audit,
       has_table_privilege(g.r, 'auth.sessions', 'DELETE') del_sess,
       has_table_privilege(g.r, 'auth.mfa_factors', 'SELECT') sel_fac
from (values ('postgres'), ('service_role'), ('authenticated'), ('anon'), ('supabase_auth_admin')) g(r);
-- postgres t/t/t, supabase_auth_admin t/t/t, service_role f/f/f, authenticated f/f/f, anon f/f/f
```

The staging backend's `DATABASE_URL` connects as `postgres.<ref>` (the
`postgres` role) through the session pooler. Only the user name was read from
the Railway variables.

**Chosen mechanism (FR-006/FR-007/FR-008, Q3 default).** It has two modes,
matching plan.md's `revoke_sessions(user_id, *, ban: bool)`. Only a suspension
bans. FR-006 and Q3 ("a suspended staff member cannot sign in even as a
learner") require that. FR-007 asks only that a demotion revokes sessions. A
ban on a demoted account would block the learner sign-in that the new role
allows, and nothing could lift it, because FR-006 reactivation accepts only a
current admin or instructor.

1. **Session delete (both modes):** `DELETE FROM auth.sessions WHERE user_id = $1`.
   Refresh tokens cascade. This makes the unexpired access token fail at
   `/auth/v1/user` at once and the refresh grant fail. `service_role` cannot
   reach `auth.sessions` through PostgREST. The delete must therefore run
   either on the backend's direct `postgres` connection, or in a
   `SECURITY DEFINER` function owned by `postgres` and executable only by
   `service_role`. That choice belongs to T002/T006.
2. **Suspension (FR-006, `ban=True`): ban first, then step 1.** The ban is
   `auth.admin.update_user_by_id(uid, {"ban_duration": "876000h"})`. Once it
   succeeds, no new session can appear, because sign-in and refresh are both
   refused. Then step 1 deletes the existing sessions. Banning alone is not
   enough: unbanning would revive the old sessions. Deleting alone is not
   enough either: the user can sign in again (row 3 of the table).
3. **Demotion (FR-007) and every other non-suspension revocation
   (`ban=False`): step 1 only.** This includes the rollout path (b) factor
   reset (§9.6). The R2 row "Session delete only" shows the old access token
   and refresh token are refused while a new password sign-in succeeds. For a
   demoted account that new session is an ordinary sign-in under the new
   role, which the guard reads from `public.users`. This mode never bans and
   never unbans. A demotion therefore leaves a suspension's ban in place if
   one exists.
4. **Reactivation (FR-006):** `ban_duration: "none"`. Old tokens stay dead and
   a new sign-in works (row 5).
5. `sessions_revoked: true` only when every step of the mode succeeded. A
   failure in any step is FR-008's `revoke_error`. The FR-008 retry route takes
   `ban` from the target's committed row at retry time: `ban=True` exactly
   when `suspended_at` is set. A failed suspension therefore retries ban and
   delete. A failed demotion retries the delete only, and so does a suspension
   that was reactivated before the retry, which is never re-banned. All steps
   are idempotent.

**Evidence still owed by the implementation (T008, AC3/AC4 staging journeys).**
R2 used a GoTrue-only account with no `public.users` row. The new session from
the delete-only row was not probed on its own, because the next row banned it.
T008 and the staging journeys must therefore show both outcomes end to end:

- a demotion to `student` makes the old access token fail at `/auth/v1/user`
  and the old refresh token fail at the refresh grant, while a fresh password
  sign-in succeeds and reaches a learner surface;
- a suspension still refuses the fresh sign-in with `user_banned`.

**Residual risk (does not block):** PostgREST, and by the same JWT-only check
Storage, verify the access token's signature and expiry, not the session. A
revoked user's last access token keeps working against direct REST/Storage
calls (under RLS, as `authenticated`) for up to `jwt_exp` = 3,600 s. Every
backend surface fails at once, because each one goes through
`/auth/v1/user`. AC3 is stated in terms of backend routes, the refresh grant
and sign-in, so it holds. The §3 sentence above was narrowed to "backend
surface".

### 9.3 R3: unenroll at AAL1, second factor, limit, admin listing (PASS)

| Check | Call | Result |
| --- | --- | --- |
| Unenroll a **verified** factor from an AAL1 session | `DELETE /factors/{id}` | **422** `insufficient_aal`, "AAL2 required to unenroll verified factor" |
| Second factor from an AAL2 session | `POST /factors`, challenge, verify | 200; 2 verified factors; `amr` totp timestamp moves to the new verify |
| Factor limit | repeated `POST /factors` at AAL2 | the 11th enroll returned **422** `too_many_enrolled_mfa_factors` ("Maximum number of verified factors reached…") with 10 factors present: **2 verified + 8 unverified**. Unverified factors count toward `mfa_max_enrolled_factors = 10` |
| Admin listing | `GET /auth/v1/admin/users/{id}/factors` (secret key) | 200, array of `{id, factor_type, friendly_name, status, created_at, updated_at, last_challenged_at, phone}`; `status` ∈ `verified`/`unverified` |
| Unenroll a verified factor at AAL2 | `DELETE /factors/{id}` | 200. The session's next refresh is `aal1` (its `amr` loses the totp entry) even though another verified factor remains, because the session's AAL was tied to the deleted factor |
| Admin delete of a verified factor | `DELETE /auth/v1/admin/users/{id}/factors/{fid}` | 200 (rollout path (b)). Live sessions are downgraded to `aal1` in `auth.sessions`, but the existing AAL2 access token keeps `aal2` until `exp` (§9.1 follow-up) |

**Side effects of a successful verification (accounts `admin`, `admin2`):**

- Every successful TOTP verification deletes **all of the user's AAL1
  sessions**. This holds for the first-factor verify, for a second-factor
  verify, and for a plain sign-in step-up on another session. Their tokens get
  403 `session_not_found` and their refresh gets 400
  `refresh_token_not_found`. AAL2 sessions survive.
- Verifying a factor removed the user's other **unverified** factors, and the
  audit log has no row for that removal.
- A wrong code returns 422 `mfa_verification_failed` and is **not** written
  to the audit log.
- The same TOTP code was accepted on two different sessions' challenges
  within one 30 s window.

### 9.4 R5: Auth audit log carries factor events (PASS on staging; production setting not read)

- Staging `audit_log_disable_postgres=false`, so "Write audit logs to the
  database" is on. `select count(*), min(created_at), max(created_at) from
  auth.audit_log_entries` gave 109 rows, the first at 2026-10-28 03:49:09Z.
  The setting was therefore enabled around then. q-00a read it as off at
  03:27Z and could not change it through the API.
- **Production was not read**, because this lot must not touch production. Its
  last known value was off (q-00a, 03:27Z). Rollout P6 must be re-read
  (read-only) and found on before T013. Without it, FR-010 fails on
  production.
- `postgres`, the backend's direct-connection role, can `SELECT` it (§9.2).
  `service_role` cannot.

Query used per account (read-only; `payload` is `json`, so it needs a `::jsonb`
cast for key functions):

```sql
select id, created_at, payload->>'action' action, payload->>'log_type' log_type,
       payload->>'actor_id' actor_id, payload->>'actor_username' actor_username,
       (select array_agg(k order by k) from jsonb_object_keys(coalesce(payload::jsonb->'traits','{}'::jsonb)) k) trait_keys,
       payload::jsonb->'traits'->>'factor_id' factor_id,
       payload::jsonb->'traits'->>'factor_status' factor_status,
       payload::jsonb->'traits'->>'user_id' trait_user
from auth.audit_log_entries
where created_at >= '<run start>'::timestamptz
  and (payload::text like '%<uid>%' or payload::text like '%<factor id>%' /* … each factor id */)
order by created_at;
```

Factor events observed (`log_type = factor` for all):

| GoTrue action | When | `actor_id` / `actor_username` | `traits` |
| --- | --- | --- | --- |
| `factor_in_progress` | enroll (`POST /factors`) succeeded | the user / the user's email | `factor_id` |
| `challenge_created` | challenge issued | the user | `factor_id`, `factor_status` (`unverified` before the first verify, `verified` for a later step-up) |
| `verification_attempted` | **successful** verify only (first verify **and** every later step-up) | the user | `challenge_id`, `factor_id`, `factor_type` |
| `factor_unenrolled` | self-unenroll (`DELETE /factors/{id}`) | the user | `factor_id`, `factor_status` (`verified`/`unverified`), `session_id` |
| `factor_deleted` | admin-API delete (`DELETE /admin/users/{id}/factors/{fid}`) | **the target user** (not the service role or operator) | `factor_id`, `user_id` |

Other rows seen: `login`, `token_refreshed`, and `token_revoked` (written on
each successful verify and refresh). `user_signedup`, `user_modified` and
`user_deleted` carry `actor_id = 00000000-…`, `actor_username = service_role`
and `traits.user_id`. Ban and unban appear only as a generic
`user_modified`. These are not logged at all: refused attempts (wrong code,
AAL1 enroll or unenroll refusals, banned sign-in or refresh), GoTrue's removal
of unverified factors on verify, and the factor rows removed with a deleted
user.

**Mapping for the sweep (T007):** each event is keyed by
`auth.audit_log_entries.id`. The user is `actor_id`, except for
`factor_deleted`, where it is `traits.user_id`.

| Sweep event | GoTrue action(s) |
| --- | --- |
| `mfa_factor_enrolled` | `factor_in_progress` |
| `mfa_factor_verified` | the **first** `verification_attempted` seen for that `factor_id`. Later ones are step-up sign-ins, not new verifications. Equivalently, the latest earlier `challenge_created` for the factor has `factor_status = unverified` |
| `mfa_factor_deleted` | `factor_unenrolled` (whether the factor was verified is in `traits.factor_status`) or `factor_deleted` (no status: look it up from earlier `verification_attempted` rows or the snapshot). For `factor_deleted`, the actor must be shown as "không rõ (ngoài ứng dụng)" / admin API, never as the target |

A factor verified and deleted between two sweeps yields `factor_in_progress`,
`verification_attempted` and `factor_unenrolled`/`factor_deleted` as separate
rows, so FR-010's two-row case is met from the log alone.

### 9.5 R6: AAL1 session with one verified factor calls `mfa.enroll` (PASS — GoTrue refuses)

Account `admin`, with factor f1 verified. A fresh password sign-in gave
`aal=aal1`. `POST /auth/v1/factors {factor_type: totp, friendly_name}` from that
session returned **403 `insufficient_aal`, "AAL2 required to enroll a new
factor"**. No factor was created and no audit row was written. With **zero**
verified factors, an AAL1 session may enroll (R1, and the account `admin2`
enrolled two unverified factors at AAL1). That is the first-factor case F-03
routes to an immediate owner email.

The other route, where an AAL1 session verifies an unverified factor left over
from the zero-factor window, could not be exercised. When the account's first
factor was verified, GoTrue deleted that AAL1 session and the leftover
unverified factor.

### 9.6 Consequences for later lots

- **Lot 03 (T003/T004):** take `aal` and `amr` from the token. Also require at
  least one `verified` entry in the `/auth/v1/user` `factors` array the guard
  already fetches. Otherwise an AAL2 token outlives the deletion of its factor
  by up to 1 h (§9.1). A missing `factors` key means none. The 12-hour age
  should use the `amr` `totp` timestamp, which refresh does not renew. A
  missing `amr` totp entry counts as expired.
- **Lot 04 (T010):** GoTrue already refuses an AAL1 enroll once a verified
  factor exists. The server-side check in FR-012 is therefore defence in
  depth and must map 403 `insufficient_aal`. `/admin/mfa` must clean up the
  user's own abandoned unverified factors, because they count toward the
  limit of 10. A successful verify signs out the user's other AAL1
  tabs and devices (`session_not_found` → `/login`). This is expected and
  should not be shown as an error.
- **Lot 06 (T006):** use the §9.2 mechanism. A suspension bans, then deletes
  `auth.sessions`, and reactivation unbans. A demotion or any other
  non-suspension revocation only deletes `auth.sessions`. Lot 02 or lot 06
  must choose between a direct `postgres` connection and a `SECURITY DEFINER`
  function in 332. Wording must not claim REST/Storage fail at once (≤ 1 h
  residual). Rollout path (b), the admin-API factor reset, should also revoke
  sessions (delete only, no ban), because a live AAL2 token survives the
  reset.
- **Lot 08 (T007):** use the event mapping above. The snapshot backstop must
  ignore unverified factors that disappear, because GoTrue removes them
  without a log row. Read `payload::jsonb`. Rollout P6 needs the production
  setting re-read before T013.
- **Lot 09 (T009):** any TOTP verification by the shared E2E admin deletes
  that admin's other AAL1 sessions. Parallel workers that sign in with a
  password and then verify can kill each other's half-finished sign-ins.
  Serialize the admin sign-in, or retry on `session_not_found`.

### 9.7 First sweep run leaves a gap (PC-J139, 2026-10-29)

On staging the sweep never ran after 332 was applied: no cron service, 0
`staff_security_sweep_cursor` rows and 0 `staff_mfa_factor_snapshot` rows
(Web Manager, 2026-10-29 14:56 UTC+7). The first run starts the cursor at the
newest entry by design, so every factor event between 332 and that run would
stay unaudited. The spec does not say how the first run treats that history.
The decision, within FR-010: a one-off `--backfill` from 332's `applied_at`,
using the step 1 mapping and dedupe key, with no owner alert or email for the
old events (Leader, 2026-10-29 15:02). Events before 332 are not written,
because `role_at` relies on the role history that starts with 332. The
procedure is rollout.md "First run and backfill". Production has the same gap
at its first run, so T013 uses the same procedure.

## 10. Amendment 1: AAL2 max age, step-up and factor deletion (2026-10-29)

Read-only against `origin/staging` by the Feature Developer at `f69055f65`
(H-1029-FD4), re-checked at `756016558` for this spec PR. `/admin/mfa` lines
are from #1898 (T010), which is not on `staging` yet.

### 10.1 Current state

- `backend/services/staff_guard.py:52` hard-codes
  `TOTP_MAX_AGE_SECONDS = 12*60*60`.
- `evaluate_admin_assurance` (`staff_guard.py:160-183`) already reads the
  `amr` `totp` timestamp. It returns `totp_expired`/`totp_missing`, logged as
  `admin_aal2_would_block` under `ADMIN_AAL2_ENFORCE=false`.
- So the 12 h rule exists, but it is not configurable.
- No step-up exists. Sensitive routes:
  - `PATCH /admin/users/{user_id}/role` (`routers/admin.py:843`)
  - `PATCH /admin/users/{user_id}/active` (`routers/admin_staff_security.py:71`)
  - `POST /admin/users/{user_id}/revoke-sessions` (`admin_staff_security.py:175`)
  - the AI-budget raise/end routes, which don't exist yet (AIBUDGET-0033
    T013). They must depend on `require_recent_mfa` when they land (PC-J138).
- Factor delete is a client-side GoTrue `mfa.unenroll` call
  (`(authed-admin-mfa)/admin/mfa/admin-mfa.tsx` on #1898).

### 10.2 Limitation: factor deletion cannot be gated by the server

- GoTrue `mfa.unenroll` is called **directly from the browser** by
  `/admin/mfa`. The FastAPI backend never sees the request, so
  `require_recent_mfa()` cannot run on it, and the server cannot block it.
- GoTrue only requires an AAL2 session to delete a verified factor (§9.3:
  422 `insufficient_aal` at AAL1, 200 at AAL2). It does not require a TOTP
  entered within 15 minutes.
- Anyone holding a stolen AAL2 session (≤ 12 h old) could therefore delete a
  factor without a new code by calling GoTrue directly, skipping the UI.

Controls:

1. **UI verify before unenroll:** `/admin/mfa` runs a fresh
   `challenge`+`verify` immediately before `unenroll` (AC12 node test).
2. **Owner alert ≤ 5 minutes:** the T007 factor-deleted alert
   (`staff_security_sweep.py`, Auth audit-log cursor + snapshot, cron `*/5`)
   emails the owner within one sweep run.
3. **12 h expiry:** admin rights still expire 12 h after the last TOTP
   (FR-012).

Not mitigated: the deletion itself. Recovery is to re-enroll and review the
alert. Closing the gap needs a server-side proxy for factor deletion, which is
out of scope for Amendment 1 and can be proposed later. Accepted by the Leader
on 2026-10-29 14:53 (UTC+7); see `spec.md` → "Rủi ro còn lại".
