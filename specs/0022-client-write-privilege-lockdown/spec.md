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
- F14: seven SECURITY DEFINER trigger functions are callable by `anon` and
  `authenticated` through `/rest/v1/rpc`.

The Project Coordinator review of 2026-10-26 added: default privileges must be
changed for the owner role that holds them (`postgres`), the paid Speaking
endpoints must re-check activation and permission, D1 results must not be
learner-writable, and the `users` update policy needs WITH CHECK.

The browser never needs these writes; FastAPI is the only business backend.

## Scope

- Remove direct client (`anon`, `authenticated`) write privileges from every
  public table, view and sequence (setval), including objects created later by
  `postgres` or `supabase_admin`, except the learner's own Vocabulary and
  flashcard rows that FastAPI deliberately writes with the learner's token.
- Make D1 results server-written: FastAPI writes `d1_sessions` and
  `vocabulary_exercise_attempts` with the service role and the verified user
  id; the learner may only toggle `user_d1_questions.is_active`.
- Remove every client UPDATE on `users` (PATCH `/auth/profile` already writes
  with the service role) and harden the dashboard update policy; reject any
  change to role, activation, permissions, feature flags or other server-owned
  columns from a client role, even through a SECURITY DEFINER wrapper.
- Remove client EXECUTE on SECURITY DEFINER trigger functions.
- Re-check activation and the session mode's permission on Speaking question
  generation, custom questions, cue-card generation, grading and full-test
  pronunciation.
- Keep every legitimate FastAPI journey, service-role write, trigger guard and
  migration/maintenance path working.

## Non-goals

- Changing read access, SELECT policies or Storage policies.
- Moving the Vocabulary bank and flashcard learner-token writes to the service
  role (learner-owned content and SRS schedule, not grades).
- Changing default EXECUTE privileges for functions: SECURITY INVOKER RPCs
  cannot write past the caller's table privileges, and RLS helper functions
  must stay callable.
- Dropping `users_role_check` (batch 3, after this fix).
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
- **FR-002:** A client role has no UPDATE privilege on `users`; profile edits
  go through PATCH `/auth/profile` (service role, validated). The dashboard
  policy "Users can update own data", when present, applies only to
  `authenticated` with USING and WITH CHECK `auth.uid() = id`.
- **FR-003:** A client role cannot insert, update, delete or truncate any public
  table, partitioned table or view outside the five learner-owned Vocabulary
  and flashcard tables (plus UPDATE of `user_d1_questions.is_active`), so
  scores, bands, statuses, sessions, responses, D1 session counts and D1
  attempt correctness/score/feedback are server-written only.
- **FR-004:** `anon` has no write privilege on any public relation.
- **FR-005:** Learner-token Vocabulary and flashcard writes (vocabulary bank,
  flashcards and `fn_apply_srs_review_idempotent`) keep working under their
  owner-scoped RLS; D1 sessions, attempts and finalization keep working through
  the service role with the verified user id.
- **FR-006:** Tables and sequences created after the migration by `postgres` or
  `supabase_admin` are not client-writable unless their own migration grants a
  specific privilege.
- **FR-007:** Service-role and database-owner writes, including role and
  activation changes made by FastAPI, are unaffected.
- **FR-008:** The migration is idempotent and aborts if any client write
  privilege, client write default privilege, client-executable SECURITY
  DEFINER function or unhardened users update policy survives.
- **FR-009:** No SECURITY DEFINER function in `public` is executable by `anon`
  or `authenticated`; the trigger guards still fire for every writer.
- **FR-010:** Speaking question generation, custom questions, cue-card
  generation, grading and full-test pronunciation reject an inactive account
  (403) and an account without the session mode's permission (403) unless the
  session answers a class assignment, after confirming ownership (404 for a
  foreign session) and before any AI call or quota use.

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

### Forged D1 results are denied

- **Given** a signed-in learner with D1 enabled
- **When** they PATCH `/rest/v1/d1_sessions` or `/rest/v1/vocabulary_exercise_attempts`
  to set `correct_count`, `status`, `is_correct` or `score`
- **Then** PostgREST returns a permission error and the stored result is unchanged

### Unentitled grading is denied

- **Given** an account whose activation or Speaking permission is missing
- **When** it calls question generation, grading or full-test pronunciation for its own session
- **Then** FastAPI returns 403 before any AI provider call

## Edge cases

- A table owned by a role the runner cannot revoke for: the postcondition
  aborts the migration and nothing is applied.
- A dashboard-created policy outside the repo: privileges are checked before
  RLS, so the policy cannot reopen a write.
- `updated_at` maintained by a database trigger is not treated as a privileged
  change.
- `supabase_admin` exists but the runner cannot act for it: its default ACL is
  skipped with a NOTICE, and the postcondition aborts if that ACL still grants
  client writes in `public`.
- An account deactivated or whose code is revoked in the middle of a Speaking
  session is refused at the next paid step, consistent with session creation.
- Between applying 320 and promoting its backend, D1 attempt/session writes
  from the previous backend fail closed (D1 is default-off).

## Success criteria

- The read-only verification query in migration 320 returns zero rows on
  staging and production.
- The three audit exploits fail on staging; the affected FastAPI journeys and
  live Staging E2E pass at the merged SHA.

## Open questions

- Owner approval of this spec on `staging` before implementation is accepted.
- Production pre-check: confirm no other client-executable SECURITY DEFINER
  function and no `supabase_admin` default ACL in `public` (see rollout).
