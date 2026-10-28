# Research: staff guards, role/is_active writes, MFA and alerting today

Survey of `origin/staging` at `5cdb93953` (2026-10-27). Read-only code reading;
no database, Auth or provider call was made for this spec. Statements marked
**verify** are Supabase Auth (GoTrue) behaviours that must be confirmed on
staging with a synthetic account before implementation (gates R1–R3 and R5, below; R4 was dropped with the auth-schema trigger).

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
refresh and every non-staff surface fail (AC3).

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
