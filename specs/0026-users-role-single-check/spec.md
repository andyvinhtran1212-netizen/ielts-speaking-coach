---
id: ROLECHECK-0026
title: Admins can make a user an instructor because users.role has one correct CHECK
status: implementing
risk: high
owner: product
---

# Admins can make a user an instructor because users.role has one correct CHECK

Approval: approved by Vinh 2026-10-27 07:14 UTC+7 (see
[`approval-decision.md`](approval-decision.md)). Bug A-05 (Assignment Tracker
bot). This is the "batch 3" follow-up that SECWRITE-0022 deferred
(`specs/0022-client-write-privilege-lockdown/spec.md` Non-goals). Locked
migration number: **323** (`323_users_role_single_check.sql`; 321 is #1727,
322 is #1720). The Vietnamese evidence record with every file:line citation,
staging query and full SQL is [`research.md`](research.md).

## Problem

An admin cannot turn an account into an instructor, and cannot set any account
to `student`. `public.users.role` carries two CHECK constraints and a row must
satisfy both, so the effective allowed set is their intersection:

| Constraint | Allowed values | Origin |
| --- | --- | --- |
| `chk_users_role` | `user, student, instructor, admin` | `backend/migrations/106_instructor_role_foundation.sql:92-106` |
| `users_role_check` | `user, admin` | not in any repo migration (schema drift; `backend/scripts/staging_seed.py:109-112` calls it "production truth") |
| Effective | `user, admin` | |

Both write paths fail with `23514 check_violation` on `users_role_check`, even
as `service_role`:

- `PATCH /admin/users/{id}/role` (`backend/routers/admin.py:827-861`; the update
  at 852-856 is caught at 858-859 and returned as HTTP 500 "Role update failed").
- Instructor-grant access-code activation, `POST /auth/activate`
  (`backend/routers/auth.py:503-513`); the role is in the same UPDATE as
  activation, so the account is not activated either and the code stays unused.

Staging (read-only, 2026-10-27): both constraints are present and validated;
roles are `user` 18, `admin` 6, zero `student`/`instructor`/NULL rows.
Production (read-only P1–P6, 2026-10-27 ~07:19 UTC+7, with Vinh's permission):
the same two constraints with identical definitions, roles `user` 125 and
`admin` 1 (total 126), zero rows outside the set, zero NULL, the 320 trigger
enabled, ledger highest 320. No schema drift between the environments.

## Scope

- One forward migration (323) that keeps `chk_users_role` as the only CHECK on
  `users.role` with exactly `user, student, instructor, admin`, and drops
  `users_role_check`.
- The migration aborts on rows outside the set and when the SECWRITE-0022
  (migration 320) trigger `trg_users_guard_privileged_columns` is missing.
- Housekeeping in the implementation PR: `backend/migrations/README.md`
  highest/next numbers and the 320 note, the stale comment in
  `backend/scripts/staging_seed.py`, and a migration test.

## Non-goals

- Merging `student` into `user`, or making `role` NOT NULL / changing its default.
- An admin UI to mint `grants_role='instructor'` codes.
- Any change to the 320 trigger, grants or policies, or to `require_admin` /
  `require_instructor`.
- Any data rewrite.

## Users and journeys

- Admin: promotes a user to instructor, or demotes an instructor to student, in
  `/admin/users`.
- Invited instructor: redeems an email-bound instructor access code.
- Learners and other users: unaffected; still cannot change their own role.

## Requirements

- **FR-001:** An admin can set another user's role to `instructor` or `student` through `PATCH /admin/users/{id}/role`; the API returns 200 and the database stores the new role.
- **FR-002:** Redeeming an email-bound `grants_role='instructor'` code with the matching email sets `role='instructor'` and activates the account in the same update; a non-matching email is still refused with 403.
- **FR-003:** `public.users.role` has exactly one CHECK constraint, `chk_users_role`, validated, allowing only `user`, `student`, `instructor` and `admin`; any other value is rejected for every database role including `service_role`.
- **FR-004:** Client roles (`anon`, `authenticated`, including a newly promoted instructor) still cannot change `role` for themselves or anyone else; the migration 320 trigger, grants and policies are unchanged and the migration aborts if the trigger is missing.
- **FR-005:** Migration 323 changes no row; existing users' sign-in, `/auth/me`, profile edit and activation behave as before, and the admin self-demotion guard still returns 400.

## Acceptance scenarios

### Scenario 1 — admin promotes an instructor

- **Given** migration 323 is applied on staging and an E2E user has role `user`
- **When** an admin selects `instructor` for that user in `/admin/users`
- **Then** the API returns 200, the row stores `instructor`, the user appears in `GET /admin/instructors` and can open `/instructor`

### Scenario 2 — instructor code activation

- **Given** an admin-minted code with `grants_role='instructor'` bound to the E2E email
- **When** that user calls `POST /auth/activate`
- **Then** the account is `instructor` and active, the audit has `promote_role`, and the code is used; a different email gets 403 and nothing changes

### Scenario 3 — no self-escalation

- **Given** a learner JWT and a newly promoted instructor JWT
- **When** either sends `PATCH /rest/v1/users?id=eq.<id>` with `{"role":"admin"}`
- **Then** the write is refused and the row is unchanged

## Edge cases

- A production row with an unexpected role value: the migration aborts and the row is reviewed; no automatic rewrite.
- A third, unknown CHECK on `users.role` in production: the postcondition (exactly one CHECK) aborts.
- Lock contention on `users`: `lock_timeout = 5s` fails fast; re-run off-peak.
- Demoting an instructor to `student` must work (it is the only UI path to remove instructor access).

## Success criteria

- Zero `Role update failed ... users_role_check` 500s after 323 on staging and production.
- Instructor promotion journeys AC-3 to AC-7 in [`research.md`](research.md) §8 pass on staging.
- Catalog query shows a single validated role CHECK on both environments.

## Open questions

- None block implementation. Recorded for later decisions: whether to merge `student` into `user`; whether `role` becomes NOT NULL; whether to add an admin UI for instructor codes. Production was checked read-only on 2026-10-27 ~07:19 UTC+7 with Vinh's permission (`research.md` §5.2): both constraints are present and identical to staging, roles `user` 125 / `admin` 1, zero rows outside the set, zero NULL, the 320 trigger is enabled and the ledger's highest entry is 320 — no drift, 323 is safe on current data.
