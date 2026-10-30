---
id: ADMINAAL2-0032
title: Admin powers require a verified second factor and a suspended or demoted staff account loses access on its next request
status: approved
risk: critical
owner: product
---

# Admin powers require a verified second factor and a suspended or demoted staff account loses access on its next request

Approval: approved by Vinh on 2026-10-28 09:11 (UTC+7), relayed by the
Leader, with every default answer to Q1–Q10 accepted and the Q2 alert recipient
set to `andyvinhtran1212@gmail.com`. By Vinh's decision (a) of 09:35, alerts
are sent from `alerts@averlearning.com` through Resend once the domain's DNS
is verified (see
[`approval-decision.md`](approval-decision.md) and
[Owner decisions](#owner-decisions)). Source: product brief ADMIN-AAL2
(Feature Developer, 2026-10-27 23:10, approved for spec writing 23:01 via
Leader). Its owner decisions are binding defaults here. Risk source:
`/workspace/cc-jobs/dr-tabletop-1027.md` §5. Code inventory with citations:
[`research.md`](research.md). Migration number **332** is the accepted Q8
default; the Leader still confirms the reservation before T001.
FR-019 (role frozen while suspended, migration 336) was added by Vinh's
decision 1A on 2026-10-28 17:53 (UTC+7); see [Owner decisions](#owner-decisions) Q11.
Amendment 1 (AAL2 max age and 15-minute step-up, report-only first) was
approved by Vinh on 2026-10-29 14:44 (UTC+7), verbatim "Duyệt cả 5 theo đề
xuất", item (a), verified by the Leader. It amends FR-012, adds FR-020, AC11
and AC12, and revises Q5 to "step-up 15 minutes". See
[Amendment 1](#amendment-1-aal2-max-age-and-15-minute-step-up-q5-revised) and
[Rủi ro còn lại](#rủi-ro-còn-lại-residual-risk).

## Thay đổi người dùng thấy (tóm tắt cho anh Vinh)

- **Admin** phải bật xác thực 2 bước (ứng dụng authenticator, mã TOTP 6 số)
  mới dùng được quyền admin. Trang mới `/admin/mfa` dùng để quét mã QR lần đầu
  và nhập mã ở mỗi lần đăng nhập. Trong giai đoạn "chỉ ghi log", admin chưa bật
  2 bước vẫn làm việc bình thường và chỉ thấy một banner nhắc.
- **Admin hoặc giảng viên bị tắt tài khoản, hoặc bị hạ quyền**, mất quyền ngay ở
  thao tác kế tiếp, kể cả khi trình duyệt vẫn còn phiên. Phiên đăng nhập bị thu
  hồi. Tài khoản bị tạm khóa không thể tự mở lại bằng mã kích hoạt; chỉ admin
  khác mở khóa được.
- Không đổi được **vai trò** của tài khoản đang bị tạm khóa. Admin phải mở khóa
  trước rồi mới đổi vai trò. Trang Người dùng sẽ báo: "Không thể đổi vai trò
  của tài khoản đang bị tạm khóa. Hãy mở khóa tài khoản trước, rồi đổi vai
  trò." (quyết định 1A của anh Vinh, 28/10 17:53).
- **Amendment 1 (anh Vinh duyệt 29/10 14:44):** quyền admin hết hạn sau
  12 giờ tính từ lần nhập mã 2 bước gần nhất; làm mới phiên không gia hạn mốc
  này. Đổi vai trò, tạm khóa/mở khóa, thu hồi phiên và các thao tác ngân sách AI
  cần mã nhập trong 15 phút gần nhất; nếu cũ hơn, trang hỏi lại: "Thao tác này
  cần nhập lại mã xác thực 2 bước." Trước hết chỉ ghi log (report-only); bật
  bắt buộc là một bước riêng sau đó.
- **Giảng viên chưa kích hoạt / bị tắt** mở `/instructor` sẽ được chuyển về
  `/login` để nhập mã kích hoạt, và không thấy dữ liệu (lỗi production đang gặp,
  sửa ở PR #1771). Nếu tài khoản bị tắt khi đang mở trang, trang hiện "Tài
  khoản chưa được kích hoạt".
- Trang Người dùng có thêm nút **Tạm khóa / Mở khóa** tài khoản admin và giảng
  viên, cùng mục **Lịch sử quyền** (ai đổi, lúc nào, trước/sau).
- Anh Vinh nhận **email cảnh báo** khi có người được cấp hoặc bị gỡ admin, admin
  bị tạm khóa hoặc mở khóa, hoặc admin thêm hay xoá yếu tố 2 bước. Học viên và
  giảng viên không nhận email nào.
- Học viên: không có gì thay đổi.

## Problem

Taking over an admin password is enough to hold every admin power. Locking a
compromised admin out is not possible from the product.

- `require_admin` (`backend/routers/admin.py:84-103`) checks only a valid
  Supabase token and `users.role == 'admin'`. It never reads the session's
  authenticator assurance level, so a password-only (AAL1) session is a full
  admin. TOTP is enabled in Supabase Auth on both projects, but no admin is
  required to use it.
- Before phase 0 (PR #1771, merged 2026-10-28), neither `require_admin` nor
  `require_instructor` (`admin.py:106-131` at `5cdb93953`) read
  `users.is_active`. The learner activation gate deliberately skips staff paths
  (`backend/services/activation_gate.py:49, 194-204`). Two consequences follow:
  an inactive instructor can open `/instructor` (production report, job Q-13, fix in PR #1771),
  and setting `is_active = false` does not stop an admin.
- No API suspends a staff account. Sessions and refresh tokens are never
  revoked. A demoted or locked account keeps a working session for other
  surfaces and can refresh indefinitely.
- `PATCH /admin/users/{id}/role` (`admin.py:825-860`) can grant admin to anyone
  and writes no audit. Changes made in the Supabase SQL editor leave no trace
  at all, and nobody is alerted.

## Scope

- Phase 0 (PR #1771, job Q-13, ships first under its own PR): `require_admin`
  and `require_instructor` require `users.is_active`, and the frontend
  activation redirect covers `/admin` and `/instructor`.
- One staff guard: admin = valid token + `role = 'admin'` + `is_active` +
  AAL2. Instructor = valid token + `role ∈ {instructor, admin}` + `is_active`,
  with AAL2 when the caller is an admin. Read from the database on every
  request.
- AAL2 enforcement behind the Railway env flag `ADMIN_AAL2_ENFORCE`. The
  default is report-only (`false`), with a structured "would block" log.
- `403` with `code: mfa_required` for an admin without AAL2. The only admin
  route an AAL1 admin may call is their own MFA status.
- `/admin/mfa`: TOTP enroll (QR), challenge, factor list, backup factor, and
  factor removal from an AAL2 session only.
- Staff suspension and reactivation API and UI. On demotion or suspension,
  revoke the target's sessions and refresh tokens, with a visible failure and
  retry. A durable suspension marker that no access code, restore or SQL
  update can undo.
- An append-only `staff_security_audit` for every change of `users.role` or
  `users.is_active` by any path, and for admin MFA factor changes.
- An owner-email alert outbox for the admin events in FR-011.
- A staging E2E admin that holds a TOTP factor and signs in at AAL2.
- A rollout that cannot lock the owner out, and a recovery runbook drilled on
  staging.
- Amendment 1: a configurable AAL2 max age (12 h from the last TOTP entry) and
  a 15-minute step-up on privilege-changing and budget routes, report-only
  first. Code and config only, no migration.

## Non-goals

- AAL2 for instructors (phase 2 per the brief). Instructors get only the
  `is_active` requirement now.
- SMS, WebAuthn or e-mail OTP factors. TOTP only.
- Recovery codes. Supabase Auth has none; the backup is a second TOTP factor
  (Q1).
- Step-up "recent re-verification" windows for admin actions other than those
  listed in FR-020 and factor removal. (The original phase-1 non-goal "no
  step-up beyond factor removal" was replaced by Amendment 1, Q5 revised.)
- Learner `is_active` workflows. Learner locking stays with the archive flow
  (STUDENTARCHIVE-0029). Learner activation rows are audited by the trigger,
  but no learner-facing behaviour changes.
- Alerting channels other than email; anomaly detection on sign-ins.
- AI budget alerts (AI-BUDGET spec). That spec may reuse this outbox and
  recipient setting.
- Confirming migration 320 on production. That is a precondition check
  (`rollout.md` P2), not work in this spec.

## Users and journeys

- **Owner/admin (Vinh)** enrolls an authenticator and a backup factor on
  staging, then on production. After that, each sign-in asks for a 6-digit code
  before any admin page loads.
- **Admin** suspends a compromised instructor or co-admin. The target's very
  next request fails, their refresh fails, and the owner gets an email.
- **Admin** changes a role and can later see who changed it, when, and from
  what to what.
- **Instructor whose account is inactive** is sent to `/login` activation
  instead of seeing the workspace, on first load and on reload. If the account
  is suspended while the page is open, the page shows a clear "inactive" state.
- **Release operator** turns enforcement on per environment only after every
  admin has a verified factor. They can turn it off with one Railway variable.

## Requirements

- **FR-001:** Every admin power resolves through one guard that, on every request and without any cross-request cache, requires a token accepted by Supabase Auth, `users.role = 'admin'`, `users.is_active = true`, and — when `ADMIN_AAL2_ENFORCE` is true — the token's `aal` claim equal to `aal2`. This covers all `require_admin` call sites, including `/api/admin/feedback` and the soft `_is_admin` wrappers in `health.py`, `reading_student.py` and `listening.py` (`research.md` §1.4), the admin quota bypass in `sessions.py:585-600`, and admin impersonation in `instructor.py:106-125`. A role or `is_active` lookup failure denies with 503 and never grants.
- **FR-002:** With enforcement on, a caller with role admin and an AAL1 session receives HTTP 403 whose `detail` is `{"code": "mfa_required", "next_step": "enroll" | "challenge", "message": "Cần xác thực 2 bước để dùng quyền admin."}` before the handler reads or writes any domain data. `next_step` is `enroll` when the account has no verified TOTP factor and `challenge` otherwise. Soft admin checks treat that caller as a non-admin: redacted health output, no other-user attempt access, learner quota applies. They do not error.
- **FR-003:** With `ADMIN_AAL2_ENFORCE` unset or false, admin behaviour is unchanged from phase 0, except that each request that enforcement would block emits exactly one structured warning `admin_aal2_would_block`. The warning carries user id (UUID only), HTTP method, route template, `aal` and `next_step`. It contains no email, token or request body.
- **FR-004:** `GET /admin/mfa/status` is the only admin route an AAL1 admin may call. It requires role admin and `is_active`. It returns only the caller's own `{aal, enforce, verified_factor_count, next_step}` and exposes no other user's or domain data. An inventory test fails if any other route accepts an AAL1 admin while enforcement is on.
- **FR-005:** Every `/instructor/*` route requires role `instructor` or `admin` and `is_active = true`. An inactive caller gets 403 with detail "Tài khoản chưa được kích hoạt" and no data. A caller whose role is admin must also satisfy the FR-001/FR-002 AAL2 rule on these routes, including `?as_instructor` impersonation. An instructor with an AAL1 session is not asked for MFA in this phase.
- **FR-006:** `PATCH /admin/users/{user_id}/active` with `{is_active: bool, reason: string (3–500 chars)}` suspends or reactivates an account whose role is `admin` or `instructor`. It returns 404 for an unknown user, 422 for any other role, 400 for the caller's own account, and 409 `last_admin` when the change would leave no active admin. Suspension sets `is_active = false` and records a durable suspension marker (`suspended_at`, `suspended_by`, `suspension_reason`) that is distinct from "never activated". It revokes every session and refresh token of the target and blocks new sign-in until reactivation. Only this route, run by a different active AAL2 admin, clears the marker. It also restores sign-in, and a failure to restore sign-in is reported as `sign_in_restored: false` with a retry, never silently. The actor's own admin status and activity are re-checked under the same row locks, so an admin suspended mid-request cannot complete a privilege change. Repeating the same request is idempotent and produces no second audit row.
- **FR-007:** `PATCH /admin/users/{user_id}/role` keeps its path, allow-list, self-demotion refusal and success fields (`ok`, `id`, `role`). It additionally refuses with 409 `last_admin` a change that would leave no active admin. It revokes the target's sessions whenever the change removes admin or instructor privilege. The response adds `sessions_revoked` (bool or null when not applicable) and `audit_id`.
- **FR-008:** A revocation failure is never silent. The committed role or `is_active` change stands and the guard still blocks the target. The response carries `sessions_revoked: false` and a `revoke_error` code. An audit row `sessions_revoke_failed` and an owner alert are written. `POST /admin/users/{user_id}/revoke-sessions` retries idempotently and reports the outcome.
- **FR-009:** Every change of `users.role` or `users.is_active`, and every insert of a `users` row with role admin or instructor, writes exactly one row to the append-only `staff_security_audit` in the same database transaction. This applies to every path: admin API, service code, RPC, or SQL editor. The row holds `target_user_id`, `actor_user_id` (null when unknown), `source` (`admin_api`, `service`, `out_of_band`), `before`, `after`, `reason`, `request_id` and `occurred_at`. `anon` and `authenticated` cannot read or write the table. `service_role` may only insert and select. No role used by the application may update, delete or truncate it.
- **FR-010:** For an account with role admin, every TOTP factor enrollment, verification and deletion produces its own `staff_security_audit` row (`mfa_factor_enrolled` / `mfa_factor_verified` / `mfa_factor_deleted`, factor id, never the secret) within 5 minutes. This holds even when a factor is created and removed between two sweeps. The event source is Supabase Auth's append-only audit log, read by a durable cursor. A factor snapshot diff is only a backstop. If staging gate R5 shows the Auth audit log cannot provide these events, implementation stops and the guarantee is re-approved before T007; it is never silently narrowed.
- **FR-011:** The owner recipients configured in the backend environment receive one email for each of these events: an account gains admin, an account loses admin, an admin is suspended or reactivated, a factor is verified or deleted on an admin account, or staff session revocation fails. This holds whatever the event's source, including `out_of_band`. The email names the event, target email, actor email or "không rõ (ngoài ứng dụng)", time in Vietnam time, and source. It never contains tokens, secrets or factor secrets. No email goes to learners or instructors. Delivery is recorded per audit row (`pending`, `sent`, `failed`) and retried up to 5 times. A failure is logged and shown in the admin security history.
- **FR-012:** `/admin/mfa` lets a signed-in admin enroll a TOTP factor (QR code plus a copyable text secret, then a 6-digit confirmation), complete a challenge from an AAL1 session, list factors, and add a backup factor. A factor can be removed only from an AAL2 session after entering a fresh code on that page. The page returns only to a same-origin `next` path that starts with `/admin/`, and to `/admin` otherwise. *(Amended by Amendment 1, 2026-10-29.)* AAL2 counts for admin rights only while `now − amr.totp.timestamp ≤ ADMIN_AAL2_MAX_AGE_HOURS` (default 12). Refresh does not renew the timestamp. A missing `amr` entry counts as expired. Over the limit → 403 `{code:"mfa_required", next_step:"challenge"}` under enforcement. Report-only otherwise (one `admin_aal2_would_block` line with `reason=totp_expired`).
- **FR-013:** Admin pages never render admin data to an admin who lacks AAL2 while enforcement is on. `AdminAccessGate` and the shared transport navigate to `/admin/mfa?next=<current path>` whenever the backend returns `mfa_required`, on first load and on any later admin call. An inactive account never reaches admin children: the phase-0 activation redirect sends it to `/login`, and an inactive 403 from any admin call shows the denied state. In report-only mode an AAL1 admin sees a dismissible banner linking to `/admin/mfa`.
- **FR-014:** `/instructor`, `/instructor/grade` and `/instructor/compare` never render instructor data to an inactive account. On load and on reload the phase-0 activation redirect (PR #1771) sends it to `/login`. When an instructor API returns the inactive 403 after the page has loaded (suspension mid-session), the page replaces its content with the denied state "Tài khoản chưa được kích hoạt — liên hệ admin" instead of a generic load error.
- **FR-015:** `GET /admin/users/{user_id}/security-audit` (AAL2 admin) returns that user's audit rows newest first, including alert delivery status. The admin users panel shows them as "Lịch sử quyền". A lookup failure renders "⚠ không tải được lịch sử", never an empty list.
- **FR-016:** The synthetic staging admin created by `backend/scripts/staging_seed.py` holds a verified TOTP factor. Every live Staging E2E admin sign-in completes challenge and verify through one shared helper to obtain an AAL2 session, including the browser session injected by the Writing course journey. A PR-time test fails if any staging spec signs in the admin another way. The TOTP secret lives only in CI secrets and the QA creds store and is never printed in logs or artifacts.
- **FR-017:** Enforcement is enabled in an environment only after a read-only query shows every active admin with at least one verified TOTP factor, and either at least two such admins or one admin with an offline backup factor. The recovery runbook (`rollout.md` §Rollback and repair) has been executed on staging with measured durations. It covers: flag off, factor reset, backup factor, a clean-admin RPC repair, and a control-plane bootstrap that restores the first admin when no eligible admin exists. The bootstrap is executable only by the database owner, never by `service_role` or the app. It refuses while any eligible admin exists, and it is audited and emailed.
- **FR-018:** No other path can make a suspended account active again: self-service `/auth/activate` with any access code, admin-issued codes, student restore (`fn_restore_student`), or a direct SQL update. The database refuses any `is_active` change from false to true while `suspended_at` is set, unless the change comes through the FR-006 reactivation. This holds under concurrent requests. `/auth/activate` refuses a suspended account with 403 `{"code": "account_suspended"}` before the access code is claimed, so the code stays unused. `/auth/me` and `/auth/check-active` report `suspended: true`, and `/login` shows "Tài khoản đang bị tạm khóa — liên hệ admin" instead of the activation dialog. This holds even when session revocation or the sign-in ban failed.
- **FR-019:** The role of a suspended account cannot change. While `users.suspended_at` is set, the database refuses any change of `users.role` with SQLSTATE P0001 and the message `account_suspended_role_change`. This includes `fn_set_staff_privilege`, alone or combined with reactivation in one call, as well as service-role REST, the SQL editor and a superuser. Only the owner-only `fn_bootstrap_admin_recovery` (FR-017) is exempt, because it clears the marker in the same write. An admin first reactivates the account (FR-006), then changes its role. Repeating the current role is still a no-op. `PATCH /admin/users/{user_id}/role` answers 409 `{"code": "account_suspended_role_change", "message": "Không thể đổi vai trò của tài khoản đang bị tạm khóa. Hãy mở khóa tài khoản trước, rồi đổi vai trò."}`, changes nothing, and the admin users panel shows that message. Migration 336 enforces this rule. It refuses to apply while a suspended account already holds a non-staff role, because the rule would leave that account impossible to reactivate in the app.
- **FR-020:** *(Amendment 1, 2026-10-29.)* Step-up: `PATCH /admin/users/{user_id}/role`, `PATCH /admin/users/{user_id}/active`, `POST /admin/users/{user_id}/revoke-sessions`, and every AIBUDGET-0033 budget-mutation route (raise, end raise), depend on `require_recent_mfa()`. That check passes only if `now − amr.totp.timestamp ≤ ADMIN_STEP_UP_MINUTES` (default 15). Under `ADMIN_STEP_UP_ENFORCE=true`, a failure is 403 `{code:"step_up_required", next_step:"challenge", max_age_seconds}`, raised **before any DB read or write and before any audit row**. Under `false` (default): one `admin_step_up_would_block` log line per request and today's behaviour. Step-up is only evaluated after the FR-001 guard has passed.

## Acceptance scenarios

### AC1 — AAL1 admin is refused without data (FR-001, FR-002, FR-004)

- **Given** `ADMIN_AAL2_ENFORCE=true` and an active admin signed in with password only
- **When** they call `GET /admin/users`, `GET /api/admin/feedback`, `GET /admin/listening/content/{id}`, or `GET /instructor/students?as_instructor=X`
- **Then** each returns 403 `mfa_required` with `next_step`, the response holds no domain data, no impersonation audit row is written, and `GET /admin/mfa/status` still returns 200 with `aal: "aal1"`

### AC2 — AAL2 admin works (FR-001)

- **Given** the same admin after a successful TOTP challenge
- **When** they call the same routes
- **Then** each returns 200 as before

### AC3 — Suspension takes effect on the next request (FR-006, FR-008)

- **Given** an active instructor (or a second admin) with a fresh, unexpired access token and refresh token
- **When** an AAL2 admin calls `PATCH /admin/users/{id}/active {is_active:false, reason}`
- **Then** the target's next `/instructor/*` or `/admin/*` request returns 403, the refresh-token grant fails, a new sign-in is refused (Q3 default), the response says `sessions_revoked: true`, and one audit row exists

### AC4 — Demotion takes effect on the next request (FR-001, FR-007)

- **Given** a second admin with a live AAL2 session
- **When** they are changed to `student`
- **Then** their next admin request returns 403, their sessions are revoked, and an audit row plus an owner email exist

### AC5 — Inactive instructor sees no workspace (FR-005, FR-014)

- **Given** a role-instructor account with `is_active = false` (the production report)
- **When** it opens `/instructor`, reloads, and calls `GET /instructor/students` directly
- **Then** both loads land on `/login` activation with no instructor data rendered, and the API call returns 403 "Tài khoản chưa được kích hoạt"
- **And when** an active instructor with the workspace open is suspended, the next workspace refresh shows the inactive denied state

### AC6 — Audit and alert for every privilege change (FR-009, FR-010, FR-011, FR-015)

- **Given** a role change made through the API, and separately through the Supabase SQL editor on staging
- **When** the change commits
- **Then** each produces one `staff_security_audit` row (`source` `admin_api` and `out_of_band`), the owner receives one email per event, and "Lịch sử quyền" lists both

### AC7 — Report-only keeps the old behaviour (FR-003)

- **Given** `ADMIN_AAL2_ENFORCE=false`
- **When** an AAL1 admin uses the admin console
- **Then** all calls behave as before, one `admin_aal2_would_block` log line is emitted per request, and the banner is shown

### AC8 — Recovery is rehearsed (FR-017)

- **Given** staging with enforcement on
- **When** the operator runs each runbook path (flag off; delete a synthetic admin's factor; sign in with the backup factor; bootstrap from zero eligible admins)
- **Then** each path restores admin access within the target time recorded in `rollout.md`, and each step leaves the expected audit and alert

### AC9 — Activation cannot undo a suspension (FR-006, FR-018)

- **Given** a suspended instructor whose session revocation and ban were forced to fail, and who holds a valid unused access code
- **When** they call `/auth/activate` with that code, and in parallel an admin issues them a code
- **Then** both are refused with `account_suspended`, the code stays unused, `users.is_active` stays false with `suspended_at` set, every `/instructor/*` call returns 403, and `/login` shows the suspended message

### AC10 — A suspended account keeps its role until it is reactivated (FR-019)

- **Given** a suspended instructor
- **When** an admin changes its role to student, either in the admin users panel or through `fn_set_staff_privilege`
- **Then** the change is refused with `account_suspended_role_change`, the panel shows "Không thể đổi vai trò của tài khoản đang bị tạm khóa. Hãy mở khóa tài khoản trước, rồi đổi vai trò.", and the role, the marker and the audit are unchanged
- **And when** the admin reactivates the account first (FR-006), the same role change succeeds

### AC11 — AAL2 expires 12 hours after the last TOTP (FR-012; Amendment 1 draft AC10)

Offline tests:

- With enforce on, a TOTP 12 h + 1 s old → 403 `mfa_required`.
- 11 h 59 m → allowed.
- Missing `amr` → expired.
- `ADMIN_AAL2_MAX_AGE_HOURS=abc` / `0` / `48` → 12 (startup log).
- Report-only → exactly one `would_block` line, request succeeds.

### AC12 — Step-up within 15 minutes for sensitive routes (FR-020, FR-012; Amendment 1 draft AC11)

Offline tests:

- TOTP 16 min old + `ADMIN_STEP_UP_ENFORCE=true` on PATCH role, PATCH active or POST revoke-sessions → 403 `step_up_required`. No row changes, no `staff_security_audit` row, no outbox row.
- 14 min → succeeds.
- Report-only → one `admin_step_up_would_block` line, success.
- The UI resends exactly once after a successful challenge.
- `/admin/mfa` deletes a factor only after a fresh verify (node test).
- The inventory test lists every route that uses `require_recent_mfa`.

Staging (`staging.averlearning.com`, staging Supabase, synthetic admin), for AC11 and AC12:

- report-only logs appear for an old TOTP;
- the E2E helper (`frontend/tests/staging-e2e/helpers.js`) takes a fresh AAL2 before sensitive steps;
- Staging E2E is green.
- Enforcement of step-up on staging happens in lot 11 or later, on Leader's go.

AC11 and AC12 were numbered AC10 and AC11 in the approved Amendment 1 draft
(`/workspace/specs-drafts/0032-amendment-q5-step-up.md`). They are renumbered
here only because AC10 already belongs to FR-019. The content is unchanged.

## Amendment 1: AAL2 max age and 15-minute step-up (Q5 revised)

Approved by Vinh 2026-10-29 14:44 (UTC+7), item (a) of
`handoff/leader/20261029-1442-fd-questions-vinh.md`; see
[`approval-decision.md`](approval-decision.md). Source finding:
SEC-20261028-03 F-03 Gap B
(`handoff/leader/done/20261028-0930-security-auditor-spec0032-aal-gaps.md`).
Migration: **none** (code and config only). Prod: only at a promotion Vinh
authorises, and enforcement only on his go (as for T013). The code inventory
behind it is in [`research.md`](research.md) §10.

### Goal

- An admin's AAL2 stops counting 12 hours after the last TOTP entry, even if
  the session is refreshed.
- Privilege-changing and budget actions need a TOTP entered within the last
  15 minutes.
- Both run report-only first. Enforcement is a separate, later switch.

### Config

- `ADMIN_AAL2_MAX_AGE_HOURS`, `ADMIN_STEP_UP_MINUTES` and
  `ADMIN_STEP_UP_ENFORCE` in `backend/config.py`, parsed strictly.
  - Max age: an invalid value, or one outside 1–12, → 12.
  - Step-up: an invalid value, or one outside 1–15, → 15.
  - An invalid enforce value → `false`, plus one startup error log.
  - **`ADMIN_STEP_UP_ENFORCE` default `false` is confirmed by Leader
    (29/10 14:53).** This is the "report-only first" Vinh approved. Turning
    it on in prod needs Vinh's separate approval; turning it on in staging is
    Leader's call (lot 11 or later).
  - A value never disables a check.

### Factor delete

The backend cannot gate a GoTrue call, so step-up here is done in the UI.
`/admin/mfa` must run a fresh `challenge`+`verify` immediately before
`unenroll`. The existing factor-deleted owner alert (T007 sweep) stays the
detective control. This limitation is stated in `research.md` §10.2.

### UI

- `api.js` and `AdminAccessGate` handle `step_up_required` by opening the TOTP
  dialog. After verification they resend the same request once, and never
  twice.
- Text: "Thao tác này cần nhập lại mã xác thực 2 bước." (Content Manager to
  check.)
- A new `aal2_expired` banner is not needed: `mfa_required` +
  `next_step=challenge` already covers it.

### User flow

1. An admin signed in at AAL2 eight hours ago opens `/admin/users` and changes
   a role.
2. The TOTP is older than 15 minutes, so the server returns 403
   `step_up_required`.
3. The dialog asks for the code; `mfa.challenge`+`verify` issues a new AAL2
   token with a fresh `amr`.
4. The request is resent and succeeds, with one audit row.
5. Twelve hours after the last TOTP, every admin route returns
   `mfa_required`, and `/admin/mfa` asks for the code.

### API

- No new routes.
- New 403 detail code `step_up_required` on the four route groups.
- OpenAPI and `frontend/types/api.d.ts` updated.

### Security risks

- Clock skew: reuse `_CLOCK_SKEW_SECONDS` (300 s). A future `amr` timestamp
  beyond the skew → invalid.
- Replay of an old token: the age is read from the GoTrue-accepted token only
  (existing `sub` check).
- Lockout: wrong values fall back to the safe defaults. Recovery stays via
  `fn_bootstrap_admin_recovery` (owner only).
- Factor delete is UI-enforced only: see
  [Rủi ro còn lại](#rủi-ro-còn-lại-residual-risk).

### Order

- After #1898 (T010) merges.
- AIBUDGET-0033 T013 (raise routes) must adopt `require_recent_mfa` when it
  lands (PC-J138).

## Rủi ro còn lại (residual risk)

Accepted by Leader 29/10/2026 14:53 (UTC+7).

- **Factor delete is not enforced on the server.**
  - The `/admin/mfa` page calls Supabase Auth (`mfa.unenroll`) **directly from
    the browser**. The FastAPI backend never sees the request, so
    `require_recent_mfa()` cannot run on it.
  - GoTrue itself only requires an AAL2 session to delete a verified factor.
    It does not require a fresh TOTP within 15 minutes.
  - Anyone holding a stolen AAL2 session (≤ 12 h old) could therefore delete a
    factor without a new code by calling GoTrue directly, skipping the UI.
- **Controls in place:**
  - (1) A UI gate: `/admin/mfa` runs a fresh `challenge`+`verify` immediately
    before `unenroll` (AC12 node test).
  - (2) A detective backstop: the factor-deleted owner alert of ADMINAAL2-0032
    T007 (`staff_security_sweep.py`, Auth audit-log cursor + snapshot). It
    emails the owner within one sweep run (≤ 5 minutes, cron `*/5`).
  - (3) Admin rights still expire 12 h after the last TOTP (FR-012).
- **Not mitigated:** the deletion itself. Recovery is to re-enroll and review
  the alert. The risk is recorded in `research.md` and `verification.md`.
  Closing it needs a server-side proxy for factor deletion, which is out of
  scope here and can be proposed later.

## Edge cases

- **Last admin.** Demoting or suspending the only active admin is refused with
  409. The check locks the admin rows, so two concurrent demotions cannot both
  pass. Two admins suspending each other concurrently is the same case: the
  second request finds its own actor suspended and is refused.
- **Suspended vs never activated.** `suspended_at` is set only by FR-006, so a
  new instructor who has not redeemed a code still activates normally.
  Learner archive (0029) keeps its own `account_deactivated` meaning.
- **Role change while suspended (FR-019).** Without FR-019, demoting a suspended
  instructor to student would leave a row that FR-006 can no longer reactivate,
  because reactivation needs a staff role, and that no admin could restore in the app.
  So the role is frozen until the account is reactivated.
- **Out-of-band suspension.** An `is_active = false` written in the SQL editor
  sets no marker, so the runbook suspends through the RPC (`rollout.md` path
  (d)) rather than a bare update.
- **Concurrent suspension and request.** A request that passed the guard before
  the suspension committed may finish. The next one fails. This is accepted
  (the guard is per request).
- **Supabase Auth down.** Token verification already returns 502 or 401.
  Nothing falls back to a role-only check.
- **Audit insert fails.** The privilege change fails with it (same
  transaction); it is never applied unaudited.
- **Email provider down.** The change and audit stand. The alert stays
  `pending`/`failed` with a retry and is visible in "Lịch sử quyền".
- **Factor removed while signed in.** The session keeps its current `aal` until
  it ends. The next sign-in asks to enroll. The removal is audited and alerted.
- **OAuth (Google) admin.** The Google session starts at AAL1 and goes through
  the same challenge.
- **Clock skew on TOTP.** GoTrue's tolerance applies. The UI says the code was
  wrong and lets the user retry. A GoTrue rate-limit response shows a wait
  state.
- **`next` open redirect.** Any `next` value that is not a same-origin
  `/admin/…` path is replaced by `/admin`.
- **Enforcement flag typo.** The flag uses the backend's standard boolean
  settings parsing. An unparseable value fails startup visibly in the Railway
  deploy instead of silently choosing a mode. The runbook value is the literal
  `false`.

## Success criteria

- 0 admin routes accept an AAL1 admin with enforcement on (inventory test plus
  AC1 on staging and production).
- 100% of active production admins hold a verified TOTP factor before
  enforcement (FR-017 query).
- A suspended or demoted staff account is refused on its first request after
  the change (AC3, AC4). Its refresh fails.
- 100% of role and `is_active` changes on staging during the rollout window
  have an audit row. 100% of the FR-011 events produce an email or a visible
  `failed` status.
- Recovery drill: flag-off path restores access in ≤ 10 minutes, factor-reset
  path in ≤ 30 minutes (targets; measured values recorded in
  `verification.md`).

## Owner decisions

Decided by Vinh on 2026-10-28 09:11 (UTC+7): **every default below is
accepted** as written. The only addition is the Q2 address. Each item keeps
the wording of the default that was approved.

- **Q1: Offline recovery.** *Decided: default accepted.* Supabase has no recovery codes. *Default:* every
  admin enrolls two TOTP factors (phone app plus a backup whose QR/secret is
  stored offline, e.g. a printed sheet in a safe or a password manager on a
  separate device). Production keeps at least two admins with MFA.
- **Q2: Alert email recipients and provider.** *Decided: default accepted.* The backend sends no email
  today. *Default:* a single HTTPS transactional email provider (Resend, one
  new Railway secret) with recipients in `OWNER_ALERT_EMAILS`. Vinh supplies
  the owner address at approval. AI-BUDGET reuses the same channel and
  recipients. *Owner address (2026-10-28, sender set by decision (a) at
  09:35):* the recipient is `andyvinhtran1212@gmail.com`, the single value
  of `OWNER_ALERT_EMAILS`. Alerts are sent FROM `alerts@averlearning.com`
  through Resend, once the `averlearning.com` domain's DNS is verified.
  Gmail SMTP is not used. While the domain is unverified, a Resend
  rejection leaves the outbox row unsent and retried; no other transport or
  sender is tried, and the implementer does not choose another sender. This
  matches AIBUDGET-0033 (#1773).
- **Q3: Suspension strength.** *Decided: default accepted.* Ban sign-in until reactivation, or only revoke
  sessions? *Default:* ban and revoke (a suspended staff member cannot sign in
  even as a learner).
- **Q4: Instructor grant, revoke and suspension emails.** *Decided: default accepted.* *Default:* audit row
  only, no email (brief: email only for admin events).
- **Q5: Step-up for privilege changes.** *Revised by Vinh on 2026-10-29
  14:44 (UTC+7), Amendment 1: step-up 15 minutes.* AAL2 counts for admin
  rights for at most 12 hours after the last TOTP entry (FR-012), and the
  routes in FR-020 need a TOTP entered within the last 15 minutes, report-only
  first (`ADMIN_STEP_UP_ENFORCE=false`). Factor removal keeps its fresh code
  on `/admin/mfa` (UI only; see [Rủi ro còn lại](#rủi-ro-còn-lại-residual-risk)).
  *Superseded 2026-10-28 decision (default accepted):* Should granting admin
  require a TOTP code entered in the last 15 minutes? *Default:* not in phase
  1. AAL2 is required for every admin action; factor removal alone needs a
  fresh code.
- **Q6: Production enforcement date.** *Decided: default accepted.* *Default:* enable on production within
  7 days after staging enforcement passes AC1–AC9 and the FR-017 query is
  green on production, on Vinh's explicit go.
- **Q7: Soft admin privileges.** *Decided: default accepted.* Should the admin session-quota bypass and the
  admin-only views on learner routes also need AAL2? *Default:* yes (FR-001);
  an AAL1 admin is treated as a learner there.
- **Q8: Migration number.** *Decided: default accepted.* *Default:* 332. 327–330 are reserved and 331 is
  GIVEARCHIVE-0031. The Leader must confirm the reservation before T001. If
  AI-BUDGET also needs a migration, it takes the next free number after the
  Leader's allocation.
- **Q9: Audit retention.** *Decided: default accepted.* *Default:* keep indefinitely. Volume is low:
  learner activations add about one row per activation.
- **Q10: A new Railway cron service.** *Decided: default accepted.* Every 5 minutes it dispatches pending
  alerts and reconciles admin MFA factors (`plan.md`). This is needed for
  out-of-band changes and factor deletions that never touch the backend.
  *Default:* approve it as part of this spec. It runs the backend image with
  `python -m scripts.staff_security_sweep`.
- **Q11: Role change of a suspended account.** *Decided by Vinh on
  2026-10-28 17:53 (UTC+7), option 1A (relayed by the Leader, t246u).*
  `fn_set_staff_privilege` refuses any role change on an account that is
  currently suspended. An admin must reactivate the account first. This
  became FR-019 and migration 336, after #1806 reached staging. It prevents a
  suspended instructor from being demoted to student and then being
  impossible to restore in the app.
