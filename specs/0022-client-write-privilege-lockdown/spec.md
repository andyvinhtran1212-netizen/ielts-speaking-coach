---
id: SECWRITE-0022
title: Client roles cannot write privilege, score or session data
status: draft
risk: critical
owner: product
---

# Client roles cannot write privilege, score or session data

## Problem

The staging security audit of 2026-10-25 (verified by the project manager)
found that a signed-in browser session can write directly to PostgreSQL through
PostgREST, bypassing FastAPI:

- F01 (critical): any signed-in user can set their own `users.role` to `admin`
  and then pass every admin/instructor gate.
- F03 (high): a student can rewrite their own scores, bands and statuses.
- F04 (high): an account that never redeemed an access code can create a
  Speaking session directly and then obtain paid AI grading.

The browser never needs these writes; FastAPI is the only business backend.

## Scope

- Remove direct client (`anon`, `authenticated`) write privileges from every
  public table and view, including tables created later, except the learner's
  own Vocabulary/D1 practice rows that FastAPI deliberately writes with the
  learner's token.
- Allow a client role to change only its own profile fields on `users`, and
  reject any change to role, activation, permissions, feature flags or other
  server-owned columns from a client role.
- Keep every FastAPI journey, service-role write and migration/maintenance
  path working unchanged.

## Non-goals

- Changing read access, SELECT policies or Storage policies.
- Moving the Vocabulary/D1 learner-token routers to the service role.
- Changing RPC EXECUTE grants (already restricted by earlier migrations).
- Any data rewrite, user-role repair or new UI.

## Users and journeys

- Student: practises, edits their profile and reviews results through the app;
  nothing changes for them.
- Attacker with a valid student/unactivated session: attempts direct PostgREST
  writes to escalate, forge scores or create sessions; every attempt is denied.
- Admin/instructor: manages users, codes and grades through FastAPI as before.

## Requirements

- **FR-001:** A client role cannot change `users.role`, `is_active`,
  `permissions`, `feature_flags`, `access_code_used` or any non-profile column,
  directly or through a SECURITY DEFINER wrapper called with a client JWT; it
  cannot insert or delete `users` rows.
- **FR-002:** A client role can update only its own `users` profile columns
  accepted by PATCH `/auth/profile`.
- **FR-003:** A client role cannot insert, update, delete or truncate any public
  table, partitioned table or view outside the eight learner-owned
  Vocabulary/D1 practice tables, so scores, bands, statuses, sessions and
  responses are server-written only.
- **FR-004:** `anon` has no write privilege on any public relation.
- **FR-005:** Learner-token Vocabulary/D1 writes (flashcards, vocabulary bank,
  exercises and their invoker RPCs) keep working under their owner-scoped RLS.
- **FR-006:** Tables created after the migration are not client-writable unless
  their own migration grants a specific privilege.
- **FR-007:** Service-role and database-owner writes, including role and
  activation changes made by FastAPI, are unaffected.
- **FR-008:** The migration is idempotent and aborts if any client write
  privilege survives.

## Acceptance scenarios

### Role escalation is denied

- **Given** a signed-in student on staging
- **When** they PATCH `/rest/v1/users?id=eq.<self>` with `{"role":"admin"}`
- **Then** PostgREST returns a permission error and the role is unchanged

### Unactivated session creation is denied

- **Given** an account that never redeemed an access code
- **When** it POSTs a row to `/rest/v1/sessions`
- **Then** PostgREST returns a permission error and no session exists

### Learner practice still works

- **Given** an activated learner
- **When** they save a vocabulary word, review flashcards and finish a D1 set
- **Then** each action succeeds exactly as before the migration

## Edge cases

- A table owned by a role the runner cannot revoke for: the postcondition
  aborts the migration and nothing is applied.
- A dashboard-created policy outside the repo: privileges are checked before
  RLS, so the policy cannot reopen a write.
- `updated_at` maintained by a database trigger is not treated as a privileged
  change.

## Success criteria

- The read-only verification query in migration 320 returns zero rows on
  staging and production.
- The three audit exploits fail on staging; the affected FastAPI journeys and
  live Staging E2E pass at the merged SHA.

## Open questions

- Owner approval of this spec on `staging` before implementation is accepted.
