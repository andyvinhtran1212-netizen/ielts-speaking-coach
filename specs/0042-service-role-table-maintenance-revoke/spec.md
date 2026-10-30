---
id: SVCPRIV-0042
title: service_role cannot attach triggers to, reference, truncate or maintain public tables, so code it plants never runs as the table owner
status: draft
risk: critical
owner: product
---

# service_role cannot attach triggers to, reference, truncate or maintain public tables, so code it plants never runs as the table owner

Status: **draft, chưa duyệt**. Job PC-J357 (1gn) chỉ viết spec, không viết
migration. Chỉ mở phiếu migration (T001) sau khi anh Vinh duyệt các câu hỏi ở
mục *Open questions* (Leader chuyển câu hỏi).
Spec number 0042 is provisional (0039–0041 are taken by open PRs); the Leader
may renumber. The migration number is assigned by the Leader when T001 is
opened and is written `NNN` below.
Origin: Security Auditor P2-SA-1 and its "separate, wider ticket" note in
`reviews/PR-2050.md` (SA review of migration 341, 2026-10-30 15:10–15:40
UTC+7). SA counted 147 of 166 public tables on staging that grant
`service_role` TRIGGER, plus a default ACL that grants it again to every new
table. Merged with PC-J350 (F10 of #2045, clone script `GRANT ALL`), which
already has PR #2055.

## Tóm tắt (tiếng Việt)

Người dùng không thấy thay đổi gì. Học viên, giáo viên và admin vẫn làm mọi
việc như cũ. Backend vẫn đọc và ghi đúng như hiện nay.

Thay đổi nằm ở quyền trong database. Hiện `service_role` (vai mà backend dùng)
có quyền TRIGGER trên hầu hết bảng `public`. Người nắm `service_role` có thể
gắn một trigger tự viết vào `users`, `students` hay `student_cohort_memberships`.
Sau đó, khi một hàm SECURITY DEFINER hợp lệ ghi vào bảng đó (đình chỉ giáo
viên, lưu trữ hay khôi phục học viên, thêm học viên vào lớp), trigger chạy
**dưới quyền owner `postgres`**. Nó tắt được mọi guard và audit của 332/336/341,
rồi tự xoá dấu vết khi phiên kết thúc. SA đã chạy lại được kịch bản này.

Migration `NNN` sẽ thu bốn quyền mà backend không dùng (TRIGGER, REFERENCES,
TRUNCATE và MAINTAIN trên PG 17) khỏi `service_role` trên **mọi** bảng
`public`, kể cả quyền mặc định cho bảng tạo sau này. Migration giữ nguyên
SELECT, INSERT, UPDATE và DELETE. Kèm theo là hậu điều kiện trong migration,
test chạy trên PostgreSQL thật, và một guard tĩnh để migration hay script sau
này không cấp lại các quyền đó. Script clone staging (J350, PR #2055) cũng không
được cấp lại.

## Problem

- A trigger function without SECURITY DEFINER runs with the identity of
  whoever fires the trigger. When an owner-owned SECURITY DEFINER function, a
  definer trigger, a foreign-key cascade or an owner session writes a table,
  every trigger on that table runs as the table owner (`postgres`).
- `service_role` holds TRIGGER on most `public` tables. This comes from the
  Supabase default ACL (`arwdDxtm`), from explicit `GRANT ALL ON TABLE … TO
  service_role` in migrations 194, 223, 226, 227, 281, 282, 288, 295 and 312,
  and from the old clone script's blanket grants. `service_role` can also
  create functions in `pg_temp` through the default TEMP privilege.
- SA reproduced the attack (`reviews/PR-2050.md`, P2-SA-1, probes in
  `/workspace/qa/pr2050/`). Running as the real `service_role` (rolsuper = f):
  1. Create `pg_temp.x()` and attach it with `CREATE TRIGGER … BEFORE UPDATE
     ON public.users`.
  2. Make one legitimate `fn_set_staff_privilege` call. The planted trigger
     runs as the owner and can GRANT itself anything, or rewrite a guard body
     with `CREATE OR REPLACE`.
  3. The next transaction promotes a suspended instructor to an active admin.

  The `pg_temp` function, and with it the trigger, disappears when the
  session ends.
- The same path is open on every table that owner-identity code writes, for
  example the student archive/restore and class-membership RPCs. `research.md`
  lists them from the repository: 83 tables, 10 of them in priority group 1.
- TRUNCATE skips RLS and row triggers, so it can empty append-only audit
  tables. REFERENCES lets a role add foreign keys that block owner deletes.
  MAINTAIN (PG 17) allows `LOCK … ACCESS EXCLUSIVE`, VACUUM FULL, CLUSTER and
  REINDEX on any table. No backend path needs any of the four
  (`research.md` §3).

## Scope

- One forward migration `NNN`. It revokes TRIGGER, REFERENCES, TRUNCATE and,
  on PostgreSQL 17 or later, MAINTAIN from `service_role` on every relation in
  schema `public`. It repeats the same revoke for PUBLIC, anon and
  authenticated; that part is idempotent because 320 already removed those
  privileges for them.
- The same four privileges are removed from every default ACL that applies to
  new `public` tables, in both the schema-scoped and the global form, for every
  owner the runner can act for.
- An in-migration postcondition that aborts the transaction on any drift. It
  includes a probe table created and dropped inside the transaction.
- Real-PostgreSQL tests on PG 16 and PG 17, including SA's P2-SA-1 repro as
  a regression.
- A static guard that stops later migrations, rollback files and
  `backend/scripts/` from granting these privileges again.
- The contract for `backend/scripts/staging_clone_schema_from_prod.sh`
  (PC-J350). The fix itself is PR #2055; this spec only states the
  requirement and does not edit the script.

## Non-goals

- Revoking or narrowing SELECT, INSERT, UPDATE or DELETE from `service_role`,
  including column privileges and RLS bypass (`BYPASSRLS`). The backend needs
  them.
- Schemas other than `public` (`auth`, `storage`, `extensions`, `realtime`,
  `vault` and other Supabase-managed schemas), sequences, and function EXECUTE
  grants.
- The TEMP privilege on the database, `CREATE` on schema `public` (clone
  script line 53 grants `ALL ON SCHEMA public TO service_role`), and
  function-overload shadowing. These are related hardening steps with their
  own compatibility risk; they are listed as open question Q3, not part of
  this FR set.
- Other roles that hold these privileges (`authenticator`, `dashboard_user`,
  `supabase_admin`, `postgres` as owner). The postcondition reports them
  (FR-004); it does not revoke them.
- The owner-level residuals CR and SA accepted for 341 (an owner session
  forging evidence, P3-1 to P3-7). Those belong to ADMINAAL2-0032 §9.2.
- Editing the clone script (owned by PC-J350 / PR #2055) and any
  production apply. Production is applied only with Vinh's authorization at
  promotion (T003).
- UI, API or response-shape changes.

## Users and journeys

- Security Auditor / product owner: `service_role` must never be able to run
  code as the table owner, so the DB guards for staff privilege, suspension,
  role freeze, student/class archive and the append-only audit tables hold
  even against a leaked service key used on a direct connection.
- Backend (FastAPI as `service_role` via PostgREST/RPC): every existing read,
  write and RPC keeps working unchanged.
- Leader / migration runner (`postgres`): applies `NNN` on staging, then on
  production at promotion, and reads a clear postcheck.

## Requirements

- **FR-001:** After migration NNN, for every relation in schema `public` whose `relkind` is `r`, `p`, `v`, `m` or `f` (table, partitioned table, view, materialized view, foreign table) and that is not owned by `service_role`, `has_table_privilege(<role>, <relation oid>, <privilege>)` is false for `<role>` in `service_role`, `anon`, `authenticated` and every privilege in TRIGGER, REFERENCES and TRUNCATE, plus MAINTAIN when `server_version_num >= 170000`; on PostgreSQL 16 the migration never names MAINTAIN; `relacl` has no PUBLIC (grantee 0) entry carrying any of these privileges; the priority-1 tables in `research.md` §2 (`users`, `students`, `student_cohort_memberships`, `student_lifecycle_audit`, `cohorts`, `class_lifecycle_audit`, `vocab_curated_cohort_events`, `staff_security_audit`, `owner_alert_outbox`, `activation_attempts`, plus `staff_privilege_evidence` from 341 and `class_action_log` when present) are checked by name so that a missing table is reported rather than silently skipped.
- **FR-002:** Migration NNN contains no GRANT statement and changes no SELECT, INSERT, UPDATE or DELETE privilege, table-level or column-level, of any role on any `public` relation: before revoking, the migration snapshots `aclexplode(relacl)` and the column ACLs (`pg_attribute.attacl`) for those four privileges into a temporary table, and the postcondition aborts if any snapshot entry is missing or any new entry appears after the revoke; RLS settings, policies, ownership, triggers, functions and data are not changed.
- **FR-003:** For every `pg_default_acl` entry with `defaclobjtype = 'r'` and `defaclnamespace` equal to 0 (global) or to schema `public`, whose `defaclrole` the runner is a superuser for or a member of, migration NNN runs `ALTER DEFAULT PRIVILEGES FOR ROLE <defaclrole> [IN SCHEMA public] REVOKE TRIGGER, REFERENCES, TRUNCATE [, MAINTAIN on PG 17+] ON TABLES FROM service_role, PUBLIC, anon, authenticated` in the matching scope, using the 320 loop pattern (320:236-266). Afterwards no such entry grants any of these privileges to those grantees. Entries whose owner the runner cannot act for (hosted `supabase_admin`) do not abort the migration; they are listed in a `RAISE WARNING` naming owner, scope, grantee and privilege, and recorded as a Supabase-support follow-up in `rollout.md`. Inside the same transaction, the migration creates `public._svcpriv_default_probe` as the runner, asserts FR-001 on it, and drops it before commit.
- **FR-004:** Migration NNN runs in one transaction with `SET LOCAL lock_timeout = '5s'`, is safe to apply again (every statement is a REVOKE, an idempotent ALTER DEFAULT PRIVILEGES or a read), and ends with a postcondition `DO` block that raises an exception, rolling back the whole migration, when FR-001, FR-002 or the actable part of FR-003 does not hold. Before any revoke, the precondition aborts with a message listing the relations if a `public` relation is owned by `service_role`, because an owner's rights cannot be revoked. The postcondition also emits `RAISE NOTICE` lines for two report-only findings that do not abort: any other non-owner grantee that still holds TRIGGER, REFERENCES, TRUNCATE or MAINTAIN on a `public` relation, and any trigger on a `public` relation whose function is in a `pg_temp_*` schema or owned by a role other than the relation owner.
- **FR-005:** On a real PostgreSQL 16 and 17 harness with a Supabase-style default ACL (`GRANT ALL ON TABLES TO anon, authenticated, service_role`) and the migrations that create the priority-1 tables, after NNN a session that is genuinely `service_role` (`SET LOCAL ROLE service_role` with `ASSERT current_user = 'service_role'` and fixture checks `rolsuper = false` for anon, authenticated and service_role, per P3-SA-8) gets SQLSTATE `42501` for `CREATE TRIGGER` on each priority-1 table, for `TRUNCATE` on each, for creating a table with `FOREIGN KEY … REFERENCES public.users(id)` in a harness-only scratch schema owned by `service_role`, and on PG 17 for `LOCK TABLE public.activation_attempts IN ACCESS EXCLUSIVE MODE` (a table where `service_role` has only SELECT); SA's P2-SA-1 sequence (planted `pg_temp` trigger, then `fn_set_staff_privilege`) stops at step 1 with `42501`, and no `users` row or ACL changes. The same session can still SELECT, INSERT, UPDATE and DELETE on representative backend tables, and `fn_set_staff_privilege`, `fn_archive_student`, `fn_restore_student`, `fn_add_student_cohort_membership`, `fn_remove_student_cohort_membership`, `fn_archive_cohort` and `fn_restore_cohort` succeed exactly as before NNN. A negative control built without NNN shows that the planted trigger does run as the owner.
- **FR-006:** A static test fails when any forward migration numbered above NNN, any file added under `backend/migrations/rollback/` for NNN or later, or any `backend/scripts/**/*.sh`, `**/*.sql` or `**/*.py` file contains, outside SQL/shell comments, a GRANT that gives `service_role`, PUBLIC, anon or authenticated `ALL [PRIVILEGES]`, TRIGGER, REFERENCES, TRUNCATE or MAINTAIN on a table, on `ALL TABLES IN SCHEMA`, or through `ALTER DEFAULT PRIVILEGES … ON TABLES`; migrations numbered at or below NNN are exempt because they are forward-only history that NNN re-revokes. A committed mutation test proves the guard fails on such a line in a `.sql` and a `.sh` fixture. `backend/migrations/README.md` states that new tables grant `service_role` an explicit `SELECT, INSERT, UPDATE, DELETE` list instead of `GRANT ALL`.
- **FR-007:** `backend/scripts/staging_clone_schema_from_prod.sh` grants none of TRIGGER, REFERENCES, TRUNCATE, MAINTAIN or `ALL` on tables, on `ALL TABLES IN SCHEMA public` or through default privileges on tables, to `service_role`, PUBLIC, anon or authenticated. This spec does not edit the script: the requirement is met when PC-J350's PR #2055 (dump with object ACLs, blanket grants removed) is merged, and FR-006's guard then keeps it so. After any clone run, the FR-001 and FR-003 read-only postcheck in `rollout.md` is re-run on staging before staging is used for evidence. Because #2055 copies the source's ACLs, a clone from a source without NNN carries that source's grants, and its ledger baseline shows NNN unapplied, so NNN is applied again.
- **FR-008:** Migration NNN is independent of and consistent with neighbouring work. It does not require 341 (#2050) or 356 (#2045/#2054) to be applied, and it does not conflict with them: if 341/341b already revoked these privileges on `public.users` (P2-SA-1 minimal fix) or 356 revoked them on `public.class_action_log` (CALAPPEND-0041 FR-002), NNN is a no-op for those tables and their postconditions still hold. NNN does not create, replace or drop any function, trigger, policy or table other than the FR-003 probe table.

## Acceptance scenarios

### Scenario 1 — every public table loses the four privileges (FR-001, FR-004)

- **Given** a PostgreSQL 17 database with the Supabase-style default ACL, the
  migrations that create the priority-1 tables, and an extra view, a
  partitioned table with one partition, and a materialized view in `public`
- **When** migration NNN is applied
- **Then** `has_table_privilege` is false for `service_role`, anon and
  authenticated for TRIGGER, REFERENCES, TRUNCATE and MAINTAIN on every one of
  those relations, no `relacl` has a PUBLIC entry with them, and the run
  succeeds a second time with the same result; on PostgreSQL 16 the same holds
  without MAINTAIN, and the SQL text never names MAINTAIN outside the version
  gate

### Scenario 2 — backend privileges unchanged (FR-002)

- **Given** the same database, where `service_role` has table-level ALL on
  most tables, column-level UPDATE on one test table, and only SELECT on
  `activation_attempts`
- **When** NNN is applied
- **Then** the before/after snapshot of SELECT, INSERT, UPDATE and DELETE
  entries (table and column level) is identical for every role, and
  `service_role` can still SELECT, INSERT, UPDATE and DELETE a row in
  representative tables

### Scenario 3 — new tables do not get them back (FR-003)

- **Given** NNN is applied with a schema-scoped and a global default ACL for
  the runner, both granting ALL on tables to `service_role`
- **When** the runner creates `public.t_new` afterwards
- **Then** `service_role` has SELECT, INSERT, UPDATE and DELETE on `t_new`
  but not TRIGGER, REFERENCES, TRUNCATE or MAINTAIN; the in-migration probe
  table does not exist after commit; and a default ACL owned by a role the
  runner cannot act for produces a WARNING, not an abort

### Scenario 4 — P2-SA-1 repro is refused (FR-005)

- **Given** NNN is applied and an instructor and a suspended instructor exist
- **When** a genuine `service_role` session creates `pg_temp.x()` and runs
  `CREATE TRIGGER aaa BEFORE UPDATE ON public.users … EXECUTE FUNCTION
  pg_temp.x()`
- **Then** the statement fails with `42501`. A following valid
  `fn_set_staff_privilege` call behaves exactly as without the attack, the
  suspended instructor stays suspended and non-admin, and
  `staff_privilege_evidence` (when 341 is present) is empty after commit

### Scenario 5 — backend RPCs unaffected (FR-005, FR-008)

- **Given** the same database
- **When** `service_role` calls `fn_archive_student`, `fn_restore_student`,
  `fn_add_student_cohort_membership`, `fn_remove_student_cohort_membership`,
  `fn_archive_cohort`, `fn_restore_cohort` and `fn_set_staff_privilege` with
  valid arguments
- **Then** each returns the same result and writes the same rows and audit
  rows as on a database without NNN

### Scenario 6 — guards against re-granting (FR-006, FR-007)

- **Given** the repository with NNN
- **When** a later migration, a rollback file or a script under
  `backend/scripts/` contains `GRANT ALL ON TABLE public.x TO service_role`,
  `GRANT TRIGGER ON ALL TABLES IN SCHEMA public TO service_role`, or `ALTER
  DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role`
- **Then** the static test fails and names the file and line. With #2055
  merged, the clone script passes the guard; with the old lines 58–63 it
  fails

### Scenario 7 — fail closed on unexpected state (FR-004)

- **Given** a database where `service_role` owns one `public` table, or where
  a revoke is undone between revoke and postcondition (test seam)
- **When** NNN runs
- **Then** the migration aborts with a message naming the relation and
  privilege, and no privilege or default ACL changes are committed

## Edge cases

- **Tables created later by a role the runner cannot act for.** This covers
  `supabase_admin`, extensions and the Supabase dashboard when it runs as that
  role. Its default ACL can still grant the privileges; FR-003 warns about it,
  and `rollout.md` asks Supabase support to change it, the same boundary as
  320. FR-001 still covers every relation that exists at apply time, and the
  drift query in `rollout.md` catches later ones.
- **Partitions.** A new partition takes its ACL from the default ACL, not from
  the parent. FR-003 covers partitions created by the runner. Triggers on a
  partition fire for rows routed through the parent, which is why FR-001
  includes partitions.
- **Inherited privileges.** If `service_role` inherits one of these privileges
  through role membership, REVOKE cannot remove it. FR-001 uses
  `has_table_privilege`, which counts inheritance, so the migration aborts and
  names the table instead of passing.
- **Planted triggers that already exist.** A trigger attached before NNN keeps
  firing after NNN, because REVOKE does not drop triggers. FR-004 lists any
  trigger whose function lives in `pg_temp_*` or is owned by a role other than
  the table owner. `rollout.md` adds a read-only pre-apply list of every
  `public` trigger that no repository migration creates, for SA to triage.
  Removing such a trigger is a separate, explicitly authorized step.
- **Supabase re-granting.** Dashboard actions such as exposing a schema in the
  Data API may grant privileges again. The drift query in `rollout.md` is
  re-run after such an action, and SA's read-only check on
  `has_table_privilege('service_role','public.users','TRIGGER')` stays part of
  every retest.
- **LOCK TABLE.** In PostgreSQL 17, `LOCK TABLE` in ROW EXCLUSIVE or a
  stronger mode needs UPDATE, DELETE, TRUNCATE or MAINTAIN. Where
  `service_role` keeps UPDATE or DELETE, it can still take that lock. Where it
  only has SELECT or INSERT (`activation_attempts`, the audit tables), it
  cannot, and no backend path issues `LOCK TABLE` (`research.md` §3).
- **pg_dump and backups.** These need only SELECT and run as `postgres`, so
  they are unaffected.
- **PG 16 CI and PG 17 staging/production.** The MAINTAIN keyword is gated on
  `server_version_num >= 170000` with dynamic SQL, as in 320 and 356.

## Success criteria

- On staging after the apply, the read-only drift query in `rollout.md`
  returns zero rows for `service_role`, anon, authenticated and PUBLIC. That
  query covers TRIGGER, REFERENCES, TRUNCATE and MAINTAIN on public relations,
  plus actable default ACLs.
  `has_table_privilege('service_role','public.users','TRIGGER')` is false.
- SA reruns `sa2050_probe.py` section "== P" and gets `42501` at `CREATE
  TRIGGER` (P2-SA-1 retest).
- Staging E2E and backend smoke stay green. No `42501`/`permission denied`
  error from `service_role` appears in Railway staging logs in the 24 h after
  the apply.
- FR-001–FR-006 have passing real-PostgreSQL or static tests on PG 16
  (required CI) and PG 17.

## Open questions

These are the approval questions. Leader forwards them to anh Vinh; T001 is
opened only after Q1 is answered.

- **Q-J357-1 (duyệt FR):** Anh duyệt SVCPRIV-0042 FR-001…FR-008 không? Nội
  dung: migration `NNN` thu TRIGGER, REFERENCES, TRUNCATE và MAINTAIN (PG 17)
  khỏi `service_role` trên **mọi** bảng `public` và trong quyền mặc định. Giữ
  nguyên SELECT/INSERT/UPDATE/DELETE. Thêm hậu điều kiện, test PostgreSQL
  thật và guard tĩnh. Script clone staging không cấp lại các quyền này (đã có
  PR #2055 của J350). Trả lời gợi ý: "SVCPRIV ok" hoặc "SVCPRIV ok, chỉ
  nhóm 1".
- **Q-J357-2 (phạm vi):** Làm một lần cho mọi bảng `public` (khuyến nghị: dễ
  kiểm, không phải giữ danh sách, đóng luôn đường FK cascade và trigger), hay
  chỉ làm nhóm ưu tiên 1 trước (`research.md` §2) rồi mới làm phần còn lại?
  Phía backend như nhau: không đường nào dùng bốn quyền này.
- **Q-J357-3 (ngoài phạm vi, phiếu riêng?):** Có mở phiếu SA riêng cho các
  việc sau không?
  - thu `CREATE` trên schema `public` khỏi `service_role` (clone script dòng
    53 đang cấp `ALL ON SCHEMA public`);
  - thu TEMP trên database;
  - kiểm các schema khác (`storage`, …).

  Đây là bước làm cứng tiếp theo và có rủi ro tương thích riêng, nên spec này
  không gộp vào.
- **Q-J357-4 (thứ tự với 341):** P2-SA-1 có cần sửa tối thiểu trên
  `public.users` ngay trong 341/341b (#2050) trước khi promote không? SA đề
  nghị như vậy; FR-008 bảo đảm hai bên không xung đột. Hay chờ migration
  `NNN`, và coi P2-SA-1 là điều kiện chặn promote prod cho tới khi `NNN` lên?
