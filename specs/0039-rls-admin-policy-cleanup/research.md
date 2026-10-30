# Research — T001 (read-only staging catalog)

## Method

- Project: Supabase **staging** only, ref `zjphffoujxkpltixsbzj`. Production was
  not contacted.
- Transport: Supabase Management API `POST /v1/projects/zjphffoujxkpltixsbzj/database/query`
  with `"read_only": true`. The job named the Supabase MCP `execute_sql` tool,
  which is not available in this session; the sandbox has HTTPS egress only, so
  the read-only Management API endpoint was used instead. Every query is a catalog read; no
  row of user data was read and nothing was written.
- Run at `2026-10-29 11:23:31Z` (18:23 UTC+7), PostgreSQL 17.6, staging ledger
  322 rows, highest file `338_reading_listening_paper_updated_at.sql`
  (344 not applied, as expected).
- Raw outputs: `/workspace/cc-jobs/job-q-18f-pc-j130-rls-admin-spec-0039.log.d/q*.out.json`.
- The 21 tables: access_codes, class_action_log, class_assignment_items, class_assignments, class_lessons, cohorts, courses, error_logs, essay_regrade_requests, mock_exam_assignments, speaking_lesson_set_questions, speaking_lesson_sets, speaking_progress_marks, students, writing_assignment_requests, writing_assignments, writing_drafts, writing_essays, writing_feedback, writing_prompts, writing_tips.

## Result summary

| Check | Spec expects | Live (staging) | Match |
| --- | --- | --- | --- |
| Policies calling either helper, any schema | 29 on 21 tables | 29 on 21 tables, all in `public`, names identical to `spec.md` | yes |
| Tables outside the 21 | none | none | yes (no STOP) |
| BL-11 own-row write policies | 3 | 3 (`error_logs` INSERT, `essay_regrade_requests` INSERT, `writing_drafts` ALL) | yes |
| `anon` / `authenticated` privileges on the 21 | read only after 320 | `anon=r`, `authenticated=r` on all 21; no write privilege | yes |
| `relrowsecurity` | true on 21 | true on 21 (`relforcerowsecurity` false on 21) | yes |
| Helper function EXECUTE | revoked from client roles (108) | `{postgres=X/postgres,service_role=X/postgres}` for both | yes |

Differences from the spec draft: none in the 29 + 3 policies or the 21 tables.
Findings to carry into PC-J131:

1. **`service_role` ACL baseline is not uniform.** `class_action_log` has
   `service_role=arwdxtm/postgres` (no TRUNCATE `D`); the other 20 tables have
   `service_role=arwdDxtm/postgres`. FR-003's byte-identical check must compare
   against this baseline, not against a fixed privilege string.
2. **`information_schema.role_table_grants` returned 0 rows** for the read-only
   Management API role (query Q3 below): that view only lists privileges the
   current role grants or holds. The grants baseline is therefore taken from
   `pg_class.relacl` (Q4), which is authoritative. J131's before/after diff and
   its postconditions should read `relacl` / `aclexplode` (or `has_table_privilege`),
   not `information_schema`.
3. **`access_codes."Admin only"`** exists on staging: an inline
   `role = 'admin'` policy that no repository migration creates (drift already
   recorded for spec 0028). It does not call either helper, so it is not one of
   the 29; it becomes inert after 344 revokes SELECT. Recorded as out of scope in
   `spec.md`; the drop decision is the Leader's.
4. Besides the 29 + 3, the 21 tables carry 8 other policies on staging
   (Q5): `access_codes."Admin only"` and the seven learner own-read policies.
   344 leaves all 8 in place.

## Queries and output

### Q1 — policies that call either helper (all schemas)

```sql
SELECT schemaname, tablename, policyname, cmd, roles::text AS roles, qual, with_check FROM pg_policies WHERE qual ~ 'is_current_user_(admin|instructor)' OR with_check ~ 'is_current_user_(admin|instructor)' ORDER BY 2,3;
```

29 rows, all `schemaname = public`:

| tablename | policyname | cmd | roles | qual | with_check |
| --- | --- | --- | --- | --- | --- |
| `access_codes` | `access_codes_admin_all` | `ALL` | `{public}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `access_codes` | `access_codes_instructor_own` | `ALL` | `{public}` | `((issued_by = auth.uid()) AND is_current_user_instructor())` | `((issued_by = auth.uid()) AND is_current_user_instructor())` |
| `class_action_log` | `cal_admin_append` | `INSERT` | `{authenticated}` | NULL | `is_current_user_admin()` |
| `class_action_log` | `cal_admin_read` | `SELECT` | `{authenticated}` | `is_current_user_admin()` | NULL |
| `class_assignment_items` | `class_assignment_items_admin_all` | `ALL` | `{authenticated}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `class_assignments` | `class_assignments_admin_all` | `ALL` | `{authenticated}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `class_lessons` | `class_lessons_admin_all` | `ALL` | `{authenticated}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `cohorts` | `Admins manage cohorts` | `ALL` | `{public}` | `is_current_user_admin()` | NULL |
| `cohorts` | `Admins read all cohorts` | `SELECT` | `{public}` | `is_current_user_admin()` | NULL |
| `cohorts` | `cohorts_instructor_own` | `ALL` | `{public}` | `((created_by = auth.uid()) AND is_current_user_instructor())` | `((created_by = auth.uid()) AND is_current_user_instructor())` |
| `courses` | `courses_admin_all` | `ALL` | `{authenticated}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `error_logs` | `Admins dismiss error logs` | `UPDATE` | `{public}` | `is_current_user_admin()` | NULL |
| `error_logs` | `Admins read all error logs` | `SELECT` | `{public}` | `is_current_user_admin()` | NULL |
| `essay_regrade_requests` | `regrade_requests_admin_all` | `ALL` | `{authenticated}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `mock_exam_assignments` | `mock_exam_assignments_admin_all` | `ALL` | `{authenticated}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `speaking_lesson_set_questions` | `slsq_admin_all` | `ALL` | `{authenticated}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `speaking_lesson_sets` | `speaking_lesson_sets_admin_all` | `ALL` | `{authenticated}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `speaking_progress_marks` | `spm_admin_all` | `ALL` | `{authenticated}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `students` | `students_admin_all` | `ALL` | `{public}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `students` | `students_instructor_own` | `ALL` | `{public}` | `((instructor_id = auth.uid()) AND is_current_user_instructor())` | `((instructor_id = auth.uid()) AND is_current_user_instructor())` |
| `writing_assignment_requests` | `writing_assignment_requests_admin_all` | `ALL` | `{authenticated}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `writing_assignments` | `writing_assignments_admin_all` | `ALL` | `{authenticated}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `writing_assignments` | `writing_assignments_instructor_own` | `ALL` | `{public}` | `((assigned_by = auth.uid()) AND is_current_user_instructor())` | `((assigned_by = auth.uid()) AND is_current_user_instructor())` |
| `writing_drafts` | `writing_drafts_admin_all` | `ALL` | `{authenticated}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `writing_essays` | `writing_essays_admin_all` | `ALL` | `{public}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `writing_feedback` | `writing_feedback_admin_all` | `ALL` | `{public}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `writing_prompts` | `writing_prompts_admin_all` | `ALL` | `{authenticated}` | `is_current_user_admin()` | `is_current_user_admin()` |
| `writing_prompts` | `writing_prompts_instructor_own` | `ALL` | `{public}` | `((created_by = auth.uid()) AND is_current_user_instructor())` | `((created_by = auth.uid()) AND is_current_user_instructor())` |
| `writing_tips` | `writing_tips_admin_all` | `ALL` | `{authenticated}` | `is_current_user_admin()` | `is_current_user_admin()` |

### Q2 — the three BL-11 policies by name

```sql
SELECT schemaname, tablename, policyname, permissive, cmd, roles::text AS roles, qual, with_check FROM pg_policies WHERE schemaname='public' AND (tablename, policyname) IN (('error_logs','Authenticated users can report own errors'),('essay_regrade_requests','regrade_requests_student_insert'),('writing_drafts','writing_drafts_student_own')) ORDER BY 2,3;
```

3 rows:

| tablename | policyname | permissive | cmd | roles | qual | with_check |
| --- | --- | --- | --- | --- | --- | --- |
| `error_logs` | `Authenticated users can report own errors` | `PERMISSIVE` | `INSERT` | `{authenticated}` | NULL | `((source = 'frontend'::text) AND ((user_id IS NULL) OR (user_id = auth.uid())))` |
| `essay_regrade_requests` | `regrade_requests_student_insert` | `PERMISSIVE` | `INSERT` | `{authenticated}` | NULL | `(student_id IN ( SELECT students.id    FROM students   WHERE (students.user_id = auth.uid())))` |
| `writing_drafts` | `writing_drafts_student_own` | `PERMISSIVE` | `ALL` | `{authenticated}` | `(student_id IN ( SELECT students.id    FROM students   WHERE (students.user_id = auth.uid())))` | `(student_id IN ( SELECT students.id    FROM students   WHERE (students.user_id = auth.uid())))` |

### Q3 — `anon` / `authenticated` / `service_role` grants via information_schema

```sql
SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated','service_role','PUBLIC') AND table_name IN ('access_codes','class_action_log','class_assignment_items','class_assignments','class_lessons','cohorts','courses','error_logs','essay_regrade_requests','mock_exam_assignments','speaking_lesson_set_questions','speaking_lesson_sets','speaking_progress_marks','students','writing_assignment_requests','writing_assignments','writing_drafts','writing_essays','writing_feedback','writing_prompts','writing_tips') GROUP BY 1,2 ORDER BY 1,2;
```

0 rows (see finding 2). Superseded by Q4.

### Q4 — RLS flags and ACL of the 21 tables (grants baseline before 344)

```sql
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl::text AS relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname IN ('access_codes','class_action_log','class_assignment_items','class_assignments','class_lessons','cohorts','courses','error_logs','essay_regrade_requests','mock_exam_assignments','speaking_lesson_set_questions','speaking_lesson_sets','speaking_progress_marks','students','writing_assignment_requests','writing_assignments','writing_drafts','writing_essays','writing_feedback','writing_prompts','writing_tips') ORDER BY 1;
```

21 rows. This is the byte-for-byte `service_role` baseline for FR-003:

| relname | relrowsecurity | relforcerowsecurity | relacl |
| --- | --- | --- | --- |
| `access_codes` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `class_action_log` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdxtm/postgres}` |
| `class_assignment_items` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `class_assignments` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `class_lessons` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `cohorts` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `courses` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `error_logs` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `essay_regrade_requests` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `mock_exam_assignments` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `speaking_lesson_set_questions` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `speaking_lesson_sets` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `speaking_progress_marks` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `students` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `writing_assignment_requests` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `writing_assignments` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `writing_drafts` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `writing_essays` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `writing_feedback` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `writing_prompts` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |
| `writing_tips` | `True` | `False` | `{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}` |

### Q5 — the other policies on the 21 tables

Q5a lists every policy on the 21 tables with a `uses_fn` flag (40 rows: 29
`true`, 11 `false`; the 11 are the 3 BL-11 policies and the 8 below). Q5b shows
the expressions of the non-helper policies outside BL-11:

```sql
SELECT tablename, policyname, cmd, roles::text AS roles, (coalesce(qual,'')||' '||coalesce(with_check,'')) ~ 'is_current_user_(admin|instructor)' AS uses_fn FROM pg_policies WHERE schemaname='public' AND tablename IN ('access_codes','class_action_log','class_assignment_items','class_assignments','class_lessons','cohorts','courses','error_logs','essay_regrade_requests','mock_exam_assignments','speaking_lesson_set_questions','speaking_lesson_sets','speaking_progress_marks','students','writing_assignment_requests','writing_assignments','writing_drafts','writing_essays','writing_feedback','writing_prompts','writing_tips') ORDER BY 1,2;
```

```sql
SELECT tablename, policyname, permissive, cmd, roles::text AS roles, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('access_codes','essay_regrade_requests','mock_exam_assignments','students','writing_assignments','writing_essays','writing_feedback','writing_tips') AND NOT ((coalesce(qual,'')||' '||coalesce(with_check,'')) ~ 'is_current_user_(admin|instructor)') ORDER BY 1,2;
```

| tablename | policyname | cmd | roles | qual | with_check |
| --- | --- | --- | --- | --- | --- |
| `access_codes` | `Admin only` | `ALL` | `{public}` | `(EXISTS ( SELECT 1    FROM users   WHERE ((users.id = auth.uid()) AND (users.role = 'admin'::text))))` | NULL |
| `essay_regrade_requests` | `regrade_requests_student_insert` | `INSERT` | `{authenticated}` | NULL | `(student_id IN ( SELECT students.id    FROM students   WHERE (students.user_id = auth.uid())))` |
| `essay_regrade_requests` | `regrade_requests_student_own` | `SELECT` | `{authenticated}` | `(student_id IN ( SELECT students.id    FROM students   WHERE (students.user_id = auth.uid())))` | NULL |
| `mock_exam_assignments` | `mock_exam_assignments_student_read` | `SELECT` | `{authenticated}` | `(user_id = auth.uid())` | NULL |
| `students` | `students_self_read` | `SELECT` | `{authenticated}` | `(user_id = auth.uid())` | NULL |
| `writing_assignments` | `writing_assignments_student_read` | `SELECT` | `{authenticated}` | `(student_id IN ( SELECT students.id    FROM students   WHERE (students.user_id = auth.uid())))` | NULL |
| `writing_essays` | `writing_essays_student_read` | `SELECT` | `{authenticated}` | `(student_id IN ( SELECT students.id    FROM students   WHERE (students.user_id = auth.uid())))` | NULL |
| `writing_feedback` | `writing_feedback_student_read` | `SELECT` | `{authenticated}` | `(EXISTS ( SELECT 1    FROM (writing_essays we      JOIN students s ON ((s.id = we.student_id)))   WHERE ((we.id = writing_feedback.essay_id) AND (s.user_id = auth.uid()))))` | NULL |
| `writing_tips` | `writing_tips_read_published` | `SELECT` | `{authenticated}` | `(published = true)` | NULL |

### Q6 — context (server, ledger, helper ACL)

```sql
SELECT version() AS v, current_database() AS db, (SELECT count(*) FROM _schema_migrations) AS ledger_rows, (SELECT max(filename) FROM _schema_migrations) AS max_mig, (SELECT string_agg(p.proname||':'||coalesce(p.proacl::text,'<null>'), ' | ' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('is_current_user_admin','is_current_user_instructor')) AS fn_acl, now() AS at;
```

| v | ledger_rows | max_mig | fn_acl | at |
| --- | --- | --- | --- | --- |
| `PostgreSQL 17.6 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit` | `322` | `338_reading_listening_paper_updated_at.sql` | `is_current_user_admin:{postgres=X/postgres,service_role=X/postgres} \| is_current_user_instructor:{postgres=X/postgres,service_role=X/postgres}` | `2026-10-29 11:23:31.664116+00` |
