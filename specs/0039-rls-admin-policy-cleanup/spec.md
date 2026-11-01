---
id: RLSCLEANUP-0039
title: No RLS policy depends on the revoked admin or instructor helper functions, and learner or instructor JWTs have no direct access to the 21 admin-managed tables
status: approved
risk: high
owner: product
---

# No RLS policy depends on the revoked admin or instructor helper functions, and learner or instructor JWTs have no direct access to the 21 admin-managed tables

Approval: approved by Vinh on 2026-10-29 at 14:44 (UTC+7), verbatim "Duyệt cả 5
theo đề xuất", item (c); the Leader verified it in the Leader chat (see
[`approval-decision.md`](approval-decision.md)).
Spec number **0039** and migration number **344**: confirmed by the Leader on
2026-10-29 at 14:53 (UTC+7).
Tracker rows: RLS-ADMIN, BL-11. This spec replaces PC-J07
(`handoff/leader/20261028-0920-project-coordinator-PC-J07-rls-admin-policy-spec.md`,
marked SUPERSEDED). Sources: `handoff/leader/20261029-1442-fd-questions-vinh.md`
(c), brief `handoff/leader/20261028-0925-feature-developer-brief-rls-admin-policies.md`,
FD ticket H-1029-FD6. The Leader chose option (a).

## Tóm tắt (tiếng Việt)

21 bảng do admin quản lý còn 29 policy RLS gọi hàm `is_current_user_admin()` /
`is_current_user_instructor()`, nhưng quyền EXECUTE của hai hàm này đã bị thu
hồi từ migration 108. Hiện tại vẫn an toàn (JWT học viên/giảng viên đọc các bảng
này bị lỗi 42501 phát ra từ trong policy), nhưng rối và dễ mở nhầm quyền về sau.
Ngoài ra còn 3 policy cho học viên tự ghi dòng của mình (BL-11) đã chết từ
migration 320 (không còn quyền INSERT/UPDATE/DELETE).

Migration 344 chỉ **xoá** (DROP) 29 + 3 policy đó và **thu hồi** (REVOKE) mọi
quyền của `anon`/`authenticated` trên 21 bảng. Không cấp quyền mới, không đổi
quyền `service_role`, RLS vẫn bật, không xoá hai hàm. Admin vẫn truy cập qua
backend (service_role + guard 0032) như hiện nay; người dùng không thấy thay đổi.

## Problem

Migration 108 (`108_security_hardening.sql:90-91`) revoked EXECUTE on
`public.is_current_user_admin()` and `public.is_current_user_instructor()` from
PUBLIC, `anon` and `authenticated`. Staging confirms it (T001: both functions'
ACL is `{postgres=X/postgres,service_role=X/postgres}`). Yet 29 RLS policies on
21 tables still call them. A learner or instructor JWT that SELECTs one of these
tables gets 42501 raised from inside a policy instead of a clean result
(PC-J74 I5). The policies give nobody access, but they look like a working
admin/instructor path and invite someone to "fix" them by re-granting EXECUTE.

BL-11: since migration 320, `authenticated` has no INSERT/UPDATE/DELETE on any
of these tables (320 keeps client writes only on the five vocabulary/flashcard
tables; T001 shows `anon=r` and `authenticated=r` only). So three own-row write
policies are dead.

Nobody reads these tables directly:

- The frontend has **no** `supabase.from(...)` table calls (git grep on
  `origin/staging`).
- The backend JWT-scoped clients (`routers/dashboard.py`, `exercises.py`,
  `vocabulary_bank.py`, `flashcards.py`) touch none of the 21 tables.
- Admin access goes only through the backend (`service_role` + the 0032 guard).

## Facts

Static analysis of `backend/migrations` on `origin/staging` (CREATE/DROP POLICY
replayed in order), confirmed on staging by T001 on 2026-10-29 (live list ==
this list, see [`research.md`](research.md)). 29 policies on 21 tables in schema
`public` call the two functions (creating migration in brackets):

- `access_codes`: `access_codes_admin_all`, `access_codes_instructor_own` (106)
- `class_action_log`: `cal_admin_append`, `cal_admin_read` (198)
- `class_assignment_items`: `class_assignment_items_admin_all` (177)
- `class_assignments`: `class_assignments_admin_all` (177)
- `class_lessons`: `class_lessons_admin_all` (176)
- `cohorts`: `"Admins manage cohorts"`, `"Admins read all cohorts"` (060), `cohorts_instructor_own` (106)
- `courses`: `courses_admin_all` (175)
- `error_logs`: `"Admins dismiss error logs"`, `"Admins read all error logs"` (061)
- `essay_regrade_requests`: `regrade_requests_admin_all` (084)
- `mock_exam_assignments`: `mock_exam_assignments_admin_all` (154)
- `speaking_lesson_set_questions`: `slsq_admin_all` (183)
- `speaking_lesson_sets`: `speaking_lesson_sets_admin_all` (183)
- `speaking_progress_marks`: `spm_admin_all` (185)
- `students`: `students_admin_all` (033), `students_instructor_own` (106)
- `writing_assignment_requests`: `writing_assignment_requests_admin_all` (206)
- `writing_assignments`: `writing_assignments_admin_all` (036), `writing_assignments_instructor_own` (106)
- `writing_drafts`: `writing_drafts_admin_all` (037)
- `writing_essays`: `writing_essays_admin_all` (033)
- `writing_feedback`: `writing_feedback_admin_all` (033)
- `writing_prompts`: `writing_prompts_admin_all` (035), `writing_prompts_instructor_own` (106)
- `writing_tips`: `writing_tips_admin_all` (082)

**BL-11** is a **DROP** of three dead own-row write policies (not an addition;
the FD ticket wording "Thêm 3 policy" is a mistake):

- `error_logs."Authenticated users can report own errors"` (061, FOR INSERT)
- `essay_regrade_requests.regrade_requests_student_insert` (084, FOR INSERT)
- `writing_drafts.writing_drafts_student_own` (037, FOR ALL)

**Table name warning for PC-J131:** `regrade_requests_student_insert` and
`regrade_requests_admin_all` live on **`public.essay_regrade_requests`**
(migration 084). They have nothing to do with the new table
**`public.regrade_requests`** of AIBUDGET-0033 FR-025 (migration 342, PC-J137).
Migration 344 must not touch `public.regrade_requests` or any 342 object.

## Scope

- Migration **344** (`backend/migrations/344_rls_admin_policy_cleanup.sql`):
  - `DROP POLICY IF EXISTS` for the 29 + 3 policies above.
  - `REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
    <21 tables> FROM anon, authenticated`, plus `MAINTAIN` on PostgreSQL 17
    (same pattern as 320).
  - Preconditions and catalog postconditions; a guarded down script.
- `backend/migrations/README.md` note and `backend/migrations/forward-policy.tsv`
  entry.
- PostgreSQL 16/17 tests in
  `backend/tests/test_migration_344_rls_policy_cleanup.py` with a fixture that
  replays the 29 + 3 policies.
- No app code.

## Non-goals

- Any GRANT. The change only removes access.
- Dropping `public.is_current_user_admin()` / `public.is_current_user_instructor()`
  or changing their EXECUTE ACL.
- Changing `service_role` grants, or disabling RLS on any table.
- Dropping the learner own-read policies (`students_self_read`,
  `writing_essays_student_read`, `writing_assignments_student_read`,
  `writing_feedback_student_read`, `regrade_requests_student_own`,
  `mock_exam_assignments_student_read`, `writing_tips_read_published`). They stay
  in place, inert without a table grant.
- The 332 staff security audit tables (not in the list).
- `public.regrade_requests` (0033 FR-025, migration 342).
- API route or frontend changes.

### Out of scope

- **Inline `role = 'admin'` policies on 6 tables** (`dictation_sessions`,
  `dictation_attempts`, `dictation_attempt_answers`, `user_feedback`,
  `lemma_overrides`, `vocabulary_exercises`): Security Auditor 2026-10-29 14:44
  finding F1 (from PC-J74). They let a suspended admin read during the token
  lifetime. They go to **PC-J119, migration 345**; the Leader decided on
  2026-10-29 at 14:53 to keep it a separate job, not merged into 344.
- **`access_codes."Admin only"`** (T001): an inline
  `EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')`
  policy that no repository migration creates. It is the drifted policy already
  recorded in `specs/0028-access-code-unique-canonical/research.md` and
  `backend/migrations/README.md` (325 note) as out of scope. It does not call
  either helper function, so 344 does not drop it; after 344 it is inert
  because `anon`/`authenticated` lose SELECT on `access_codes`. Whether it is
  dropped (in PC-J119 / 345 or elsewhere) is a Leader decision.

## Users and journeys

- Learners and instructors: no visible change. Every learner, instructor and
  admin page reads and writes these tables through FastAPI with
  `service_role`.
- A learner or instructor JWT calling PostgREST directly on one of the 21
  tables gets a plain "permission denied for table" (42501) for every command,
  instead of an error raised from inside a policy.
- Admins: unchanged; admin access stays behind the backend and the 0032 guard.
- Operators and future migrations: no policy suggests a client admin path
  through the revoked functions.

## Requirements

- **FR-001:** After migration 344, `pg_policies` has 0 rows, in any schema,
  whose `qual` or `with_check` mentions `is_current_user_admin` or
  `is_current_user_instructor`, and the three BL-11 policies
  (`error_logs."Authenticated users can report own errors"`,
  `essay_regrade_requests.regrade_requests_student_insert`,
  `writing_drafts.writing_drafts_student_own`) no longer exist. No other policy
  is dropped or changed.
- **FR-002:** After migration 344, `anon` and `authenticated` hold no table
  privilege (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, and
  MAINTAIN on PostgreSQL 17) on any of the 21 tables, directly or through
  PUBLIC.
- **FR-003:** Migration 344 grants nothing. `relrowsecurity` stays true on all
  21 tables; the `service_role` ACL entries on the 21 tables are byte-identical
  before and after (catalog diff; T001 baseline); the two helper functions still
  exist with an unchanged ACL; the learner own-read policies, the 332 audit
  tables and `public.regrade_requests` (342) are untouched.
- **FR-004:** Migration 344 runs in one transaction with a `lock_timeout`, is
  idempotent and re-runnable, changes no row, aborts on a missing precondition
  (migration 320 applied, the 21 tables exist), and aborts unless the FR-001 to
  FR-003 postconditions hold. Its guarded down script recreates the dropped
  policies but never grants a table privilege and never re-grants EXECUTE on
  either function.
- **FR-005:** No FastAPI route, response shape or frontend changes. The full
  backend suite, Next-native verifiers and Staging E2E stay green, no admin page
  regresses, and the PC-J94 global client-privilege invariant test (#1923,
  `backend/tests/test_client_write_invariant_postgres.py`) stays green.

## Acceptance scenarios

### Scenario 1 — postconditions on staging

- **Given** migration 344 applied to staging under the advisory lock
- **When** the T001 catalog queries are re-run read-only
- **Then** 0 policies mention either function, the 3 BL-11 policies are gone,
  `anon`/`authenticated` have no privilege on the 21 tables, all 21 have
  `relrowsecurity = true`, and the `service_role` ACL entries equal the T001
  baseline

### Scenario 2 — learner and instructor JWTs

- **Given** a test learner JWT and a test instructor JWT on staging
- **When** the Security Auditor reads and writes each of the 21 tables through
  PostgREST
- **Then** every read and every write is refused with "permission denied"; no
  row is returned or written

### Scenario 3 — admin pages

- **Given** an admin session on staging
- **When** the admin uses the access-code, class, cohort, Writing, Speaking
  lesson set and error-log pages
- **Then** every page loads and saves as before (all go through the backend)

### Scenario 4 — re-run and rollback

- **Given** a database where 344 is already applied
- **When** 344 runs again, or the down script runs
- **Then** the re-run is a no-op that passes its postconditions; the down
  script recreates the policies without granting any table privilege or
  function EXECUTE

## Edge cases

- A hidden direct reader (a client that reads one of the tables with a JWT)
  would break. T001 and the code search found none; Staging E2E covers the main
  journeys.
- A wrong down script could reopen access, so the down script never grants.
- `class_action_log` `service_role` has no TRUNCATE on staging
  (`service_role=arwdxtm`, the other 20 tables have `arwdDxtm`); the
  byte-identical check must keep that difference.
- `information_schema.role_table_grants` returns 0 rows for the read-only
  Management API role (it only lists privileges the current role grants or
  holds), so the before/after comparison uses `pg_class.relacl`.
- Lock contention: each `DROP POLICY` / `REVOKE` takes a brief lock on the
  table; on `lock_timeout` re-run off-peak (the file is re-runnable).
- PostgreSQL 16 (CI) has no MAINTAIN privilege; the REVOKE must work on both 16
  and 17 (same pattern as 320).

## Success criteria

- Staging after apply: the T001 queries return 0 function-calling policies, 0
  BL-11 policies, no `anon`/`authenticated` entry in `relacl` of the 21 tables,
  21 × `relrowsecurity = true`, and `service_role` entries equal to the T001
  baseline.
- Security Auditor JWT probe (T004): no read, no write on the 21 tables.
- Backend suite, Next-native, Staging E2E and the #1923 invariant stay green.

## Decisions

1. Option (a): drop the policies and revoke the client grants; do not rewrite
   the policies onto a client-executable helper (Leader, approved by Vinh).
2. Keep RLS enabled and keep the learner own-read policies; without a grant
   they are inert, and they document intent.
3. Keep the two helper functions; `service_role` still has EXECUTE.
4. Inline `role = 'admin'` policies are a separate job (PC-J119, migration 345).

## Open questions

- Leader: whether `access_codes."Admin only"` (drift, inline role check,
  inert after 344) is dropped in PC-J119 / 345 or left recorded as drift.
