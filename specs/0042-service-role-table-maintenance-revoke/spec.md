---
id: SVCPRIV-0042
title: service_role loses public table maintenance privileges and schema CREATE, and unpinned public functions get a fixed search_path, to block owner-run planted triggers, function overloads and temp-object shadowing
status: draft
risk: critical
owner: product
---

# service_role loses public table maintenance privileges and schema CREATE, and unpinned public functions get a fixed search_path, to block owner-run planted triggers, function overloads and temp-object shadowing

Status: **draft, chưa duyệt**. Job PC-J357 (1gn) chỉ viết spec, không viết
migration. Chỉ mở phiếu migration (T001) sau khi anh Vinh duyệt các câu hỏi ở
mục *Open questions* (Leader chuyển câu hỏi).
Spec number 0042 is provisional (0039–0041 are taken by open PRs); the Leader
may renumber. The migration number is assigned by the Leader when T001 is
opened and is written `NNN` below. FR-010 is a separate migration that the
Leader numbered **358** (PC-J406); it is applied after 357 (PC-J365,
schema CREATE) and is not part of `NNN`.
Origin: Security Auditor P2-SA-1 and its "separate, wider ticket" note in
`reviews/PR-2050.md` (SA review of migration 341, 2026-10-30 15:10–15:40
UTC+7). The later PR #2060 SA catalog snapshot (2026-10-30) counted 150 of
169 public relations granting `service_role` TRIGGER, plus a default ACL
that grants it again to new tables and CREATE on schema `public`.
Merged with PC-J350 (F10 of #2045, clone script `GRANT ALL`), which already
has PR #2055; its remaining schema grant also needs correction (FR-007).

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
`public`, kể cả quyền mặc định cho bảng tạo sau này. Đồng thời thu CREATE
trên schema `public` khỏi `service_role`, anon, authenticated và PUBLIC để
không thể cài hàm overload rồi chạy dưới quyền owner qua RPC definer.
Riêng đường "bóng" qua object TEMP (service_role tạo `TEMP VIEW` trùng tên
bảng mà một hàm trigger chưa pin `search_path` đọc, rồi kích FK CASCADE chạy
dưới owner) thì NNN một mình không chặn được. Migration 358 (FR-010) đóng
đường này bằng cách pin `search_path = public, pg_temp` cho mọi hàm `public`
chưa pin, không đổi thân hàm.
Migration giữ nguyên SELECT, INSERT, UPDATE và DELETE. Kèm theo là hậu điều kiện trong migration,
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
- The same path is open on every table that owner-identity code writes.
  SA's catalog closure reaches **≥139 tables on staging** (of 166 `r`/`p`
  relations), including FK CASCADE/SET NULL from direct `service_role`
  DELETE/UPDATE and from `auth.users` deletes through the GoTrue admin API,
  beyond the earlier incomplete 83-table repository scan and SA's first
  132-table list (`research.md` §1). Group 1 is only a named-check
  and fixture list; applying NNN to that group alone is unsafe.
- CREATE on schema `public` is a second owner-execution path under the same
  threat model. SA's `probe_overload.out` shows that even after TRIGGER is
  revoked, `public.lower(varchar)` or
  `public.jsonb_build_object(text,uuid,text,text)` can beat a pg_catalog
  overload in a definer with `search_path = public, pg_temp`, then run as
  `postgres`. Revoking CREATE blocks planting those functions with `42501`.
- A function without a pinned `search_path` is a third path that survives
  NNN (SA P2-R2-1, `/workspace/qa/pr2060/r2/unpinned-trigger-fk-20261030.txt`,
  `probe_temp_shadow.out`). On staging the 4 trigger functions of migration
  283 have no `SET search_path`; `prevent_grammar_release_content_mutation`
  reads `grammar_content_releases` unqualified and fires on 6 `grammar_*`
  tables with `release_id … ON DELETE CASCADE`. In the post-NNN state (no
  TRIGGER, no schema CREATE), `service_role` creates `TEMP VIEW
  grammar_content_releases` calling a `pg_temp` function, then deletes a draft
  release directly. The cascade runs as the owner, the trigger resolves the
  name in `pg_temp` first, and the planted function runs as `postgres` and
  grants `TRIGGER ON public.users` back to `service_role`. Pinning
  `search_path = public, pg_temp` stops it (FR-010).
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
- `REVOKE CREATE ON SCHEMA public FROM service_role, anon, authenticated,
  PUBLIC`, with an effective-privilege postcondition and overload-shadow
  tests (FR-009). Schema USAGE stays unchanged.
- Migration 358 (FR-010): pin `search_path = public, pg_temp` on every
  `public` function without a `search_path` entry, with a fail-closed
  postcondition, a temp-view-shadow regression and a static guard for new
  unpinned function definitions. Only `proconfig` changes (FR-008).
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
- Revoking the TEMP privilege on the database. The proven TEMP-shadow path
  through unpinned functions is closed by FR-010 (migration 358), not by a
  TEMP revoke. REVOKE TEMP is extra defence in depth under its own ticket,
  **PC-J407** (job 1iu), on HOLD until 358 is merged and SA's 358 retest
  passes; it needs its own compatibility analysis because PUBLIC holds TEMP
  by default. Privilege changes in other schemas remain separate follow-ups.
  Q-J357-3 requires SA's residual-risk decision before production promotion
  or closure of P2-SA-1. CREATE on `public` and public function-overload
  planting are covered by FR-009.
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

- Security Auditor / product owner: a leaked service key used on a direct
  connection cannot plant a trigger on any public table (NNN) or an overload
  in schema `public` (FR-009) to execute as the owner. It also cannot shadow
  a table read by an unpinned public function with a temp object and reach
  it through an owner-run FK cascade; that path is closed by FR-010
  (migration 358), not by NNN alone, and stays open until 358 is applied.
  Existing planted objects and residual paths require triage under Q-J357-3
  before P2-SA-1 is closed.
- Backend (FastAPI as `service_role` via PostgREST/RPC): every existing read,
  write and RPC keeps working unchanged.
- Leader / migration runner (`postgres`): applies `NNN` on staging, then on
  production at promotion, and reads a clear postcheck.

## Requirements

- **FR-001:** After migration NNN, coverage of **every** relation in schema `public` whose `relkind` is `r`, `p`, `v`, `m` or `f` (table, partitioned table, view, materialized view, foreign table) is mandatory; a group-1-only apply is not an accepted option. For relations not owned by `service_role`, `has_table_privilege(<role>, <relation oid>, <privilege>)` is false for `<role>` in `service_role`, `anon`, `authenticated` and every privilege in TRIGGER, REFERENCES and TRUNCATE, plus MAINTAIN when `server_version_num >= 170000`; PostgreSQL 16 never evaluates MAINTAIN as a privilege. `relacl` has no PUBLIC (grantee 0) entry carrying any of these privileges. The priority-1 tables in `research.md` §2 (`users`, `students`, `student_cohort_memberships`, `student_lifecycle_audit`, `cohorts`, `class_lifecycle_audit`, `access_codes`, `user_code_assignments`, `vocab_curated_cohort_events`, `staff_security_audit`, `owner_alert_outbox`, `activation_attempts`, `staff_mfa_status_throttle`, `ai_model_overrides`, `ai_model_override_audit`, plus `staff_privilege_evidence` and `class_action_log` when present) are also checked by name; a missing table is reported, not silently skipped or treated as an ACL failure.
- **FR-002:** Migration NNN contains no GRANT statement and changes no SELECT, INSERT, UPDATE or DELETE privilege, table-level or column-level, of any role on any `public` relation: before revoking, the migration snapshots `aclexplode(COALESCE(relacl, acldefault('r', relowner)))` and column ACLs (`pg_attribute.attacl`, with NULL treated as an empty column ACL) for those four privileges into a temporary table. The same normalization is used after revoking; the postcondition aborts if any entry is missing or new, including grant options. A fixture with `relacl IS NULL` must pass even if REVOKE materializes implicit owner rights. RLS settings, policies, ownership, triggers, functions and data are not changed; schema USAGE is also unchanged (FR-009).
- **FR-003:** For every `pg_default_acl` entry with `defaclobjtype = 'r'` and `defaclnamespace` equal to 0 (global) or to schema `public`, whose `defaclrole` the runner is a superuser for or a member of, migration NNN runs `ALTER DEFAULT PRIVILEGES FOR ROLE <defaclrole> [IN SCHEMA public] REVOKE TRIGGER, REFERENCES, TRUNCATE [, MAINTAIN on PG 17+] ON TABLES FROM service_role, PUBLIC, anon, authenticated` in the matching scope, using the 320 loop pattern (320:236-266). Afterwards no such entry grants any of these privileges to those grantees. Entries whose owner the runner cannot act for (hosted `supabase_admin`) are listed in a `RAISE WARNING` naming owner, scope, grantee and privilege, and recorded as a Supabase-support follow-up in `rollout.md`; this exception never waives FR-001 on existing relations. Inside the same transaction, the migration creates `public._svcpriv_default_probe` as the runner, asserts FR-001 on it, and drops it before commit. Only object type `r` carries the four targeted table privileges; function EXECUTE defaults are a separate follow-up under Q-J357-3.
- **FR-004:** Migration NNN runs in one transaction with `SET LOCAL lock_timeout = '5s'`, is safe to apply again, and ends with a postcondition `DO` block that raises an exception, rolling back the whole migration, when FR-001, FR-002, the actable part of FR-003 or FR-009 does not hold. Before any revoke, the precondition aborts with a message listing any `public` relation or schema `public` owned by a targeted role, because owner rights cannot be revoked. Effective privilege checks fail closed on inherited rights. The postcondition also emits `RAISE NOTICE` for other non-owner grantees retaining targeted table privileges or schema CREATE, and for triggers whose function is in `pg_temp_*` or owned by a role other than the relation owner. The pre-apply catalog additionally lists public functions owned by targeted roles and unexpected overloads; SA triages them before apply, since REVOKE does not remove existing objects.
- **FR-005:** On a real PostgreSQL 16 and 17 harness with a Supabase-style default ACL (`GRANT ALL ON TABLES TO anon, authenticated, service_role`) and the migrations that create the priority-1 tables, after NNN a session that is genuinely `service_role` (`SET LOCAL ROLE service_role` with `ASSERT current_user = 'service_role'` and fixture checks `rolsuper = false` for anon, authenticated and service_role, per P3-SA-8) gets SQLSTATE `42501` for `CREATE TRIGGER` on each priority-1 table, for `TRUNCATE` on each, for creating a table with `FOREIGN KEY … REFERENCES public.users(id)` in a harness-only scratch schema owned by `service_role`, and on PG 17 for `LOCK TABLE public.activation_attempts IN ACCESS EXCLUSIVE MODE` (a table where `service_role` has only SELECT); SA's P2-SA-1 sequence (planted `pg_temp` trigger, then `fn_set_staff_privilege`) stops at step 1 with `42501`, and no `users` row or ACL changes. The same session can still SELECT, INSERT, UPDATE and DELETE on representative backend tables, and `fn_set_staff_privilege`, `fn_archive_student`, `fn_restore_student`, `fn_add_student_cohort_membership`, `fn_remove_student_cohort_membership`, `fn_archive_cohort` and `fn_restore_cohort` succeed exactly as before NNN. A negative control built without NNN shows that the planted trigger does run as the owner.
- **FR-006:** A static test scans every forward migration numbered above NNN, **ALL** files in `backend/migrations/rollback/` regardless of number (including the down of 356), and every `.sh`, `.sql` or `.py` file under `backend/scripts/**` and the repository-root `scripts/**` (including `scripts/backup/**`, whose `restore_into_project.sh` restores dump ACLs). Only historical **forward** migrations numbered at or below NNN are exempt. Outside actual SQL/shell/Python comments it rejects: table/default-ACL `GRANT ALL [PRIVILEGES]`, TRIGGER, REFERENCES, TRUNCATE or MAINTAIN to `service_role`, PUBLIC, anon or authenticated (including `ON ALL TABLES IN SCHEMA`); `GRANT pg_maintain`, `pg_write_all_data` or `postgres TO service_role`; `ALTER … OWNER TO service_role`; and `GRANT CREATE` or `GRANT ALL [PRIVILEGES] ON SCHEMA public` to any targeted grantee. SQL strings in `EXECUTE format('GRANT …')`, script heredocs and Python strings are executable SQL for this check, not comments; literal format arguments identifying the grantee/schema are covered. Committed mutation fixtures exercise every forbidden family across `.sql`, `.sh` and `.py`, including mixed case, multiline/quoted names, a rollback below NNN, and `EXECUTE format('GRANT …')`. Safe explicit CRUD/USAGE grants and comments pass. `backend/migrations/README.md` documents explicit CRUD grants and no schema CREATE for API roles.
- **FR-007:** The clone script must not re-grant the four targeted table privileges or CREATE on schema `public` to `service_role`, PUBLIC, anon or authenticated, directly, through ALL or through table default ACLs. PR #2055 supplies the object-ACL dump change, but is insufficient while `GRANT ALL ON SCHEMA public TO postgres, service_role` remains; PC-J350 or its follow-up must replace that API-role grant with USAGE only before FR-006/FR-007 can pass. After any clone, re-run the FR-001/FR-003/FR-009 read-only postchecks before using staging for evidence. NNN must have a mandatory `pending_feature` entry in `backend/migrations/forward-policy.tsv` so a clone's `--baseline` leaves it pending. The baseline must exclude NNN's group from `MIGRATION_FEATURES`, clearing or refusing an inherited selection before baselining; a selected group could otherwise still be recorded without executing NNN. When the source lacks NNN, verify it is absent from the target ledger, then apply it with the authorized explicit pending-feature selection. A real clone/baseline/runner test must prove NNN executes and the postchecks pass; a ledger row without matching ACLs blocks use of the clone until reconciled through the supported runner workflow.
- **FR-008:** Migration NNN is independent of and consistent with 341 (#2050) and 356 (#2045/#2054): it does not require either forward migration, and is a no-op on tables where they already revoked the targeted rights. Their postconditions still hold. Before NNN is released, the down of 356 must be corrected under F5 so it never re-grants TRIGGER, REFERENCES, TRUNCATE or MAINTAIN on `class_action_log`; its older number is not an exemption from FR-006. No rollback restoring these rights or schema CREATE may run after NNN. A regression applies NNN with 356, runs the corrected down of 356, then repeats FR-001/FR-009 postchecks. NNN changes no function, trigger, policy or table other than the dropped FR-003 probe table. The only function change in this spec is FR-010 (migration 358): it sets the `search_path` entry in `proconfig` of `public` functions that have none and changes no function body, owner, ACL or trigger.

- **FR-009:** Migration NNN executes `REVOKE CREATE ON SCHEMA public FROM service_role, anon, authenticated, PUBLIC`. Its fail-closed postcondition requires `has_schema_privilege(<role>, 'public', 'CREATE') = false` for each named role and no CREATE entry for grantee 0 in `aclexplode(COALESCE(nspacl, acldefault('n', nspowner)))`; schema USAGE and owner privileges remain unchanged. Schema ownership or inherited CREATE that prevents this result aborts the transaction (FR-004). Real PG 16/17 tests use the P3-SA-8 pattern of FR-005 (fixture checks `rolsuper = false` for anon, authenticated and service_role; `SET LOCAL ROLE <role>` and `ASSERT current_user = '<role>'` in the same transaction) and try to create both `public.lower(varchar)` and `public.jsonb_build_object(text,uuid,text,text)` and get `42501`. A synthetic owner-owned definer RPC with `search_path = public, pg_temp` still returns the original result and leaves a private audit marker empty. The negative control revokes table privileges but retains schema CREATE: both overloads can be planted and each records `current_user = postgres` when that RPC is called. Fixtures clean up between controls. An injected schema re-grant or inherited CREATE makes NNN abort. FR-006 guards against restoring CREATE, and FR-007 preserves it across clones.

- **FR-010:** Migration 358 runs `ALTER FUNCTION … SET search_path = public, pg_temp` for every function in schema `public` whose `proconfig` has no `search_path` entry, including non-`SECURITY DEFINER` trigger functions that run as the table owner through FK cascades (staging: the 4 trigger functions of migration 283: `prevent_grammar_release_content_mutation`, `prevent_validated_grammar_release_rewrite`, `prevent_grammar_evidence_mutation`, `prevent_completed_grammar_session_mutation`). `pg_temp` is always last; an empty `search_path` is not allowed while the function body references unqualified names. Its fail-closed postcondition requires zero functions in `public` without `search_path` in `proconfig`, otherwise it raises and rolls back. The FR-006 guard also fails any new `CREATE [OR REPLACE] FUNCTION` in `backend/migrations/**` without `SET search_path`. Verified on real PostgreSQL 16 and 17 by a temp-view-shadow-through-FK-cascade test with a negative control, using the P3-SA-8 pattern (FR-005).

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
  `activation_attempts`, and one relation has `relacl IS NULL`
- **When** NNN is applied
- **Then** the normalized before/after snapshot of SELECT, INSERT, UPDATE
  and DELETE entries (table and column level) is identical for every role, and
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
  `backend/scripts/` or the root `scripts/` (including `scripts/backup/`)
  contains `GRANT ALL ON TABLE public.x TO service_role`,
  `GRANT TRIGGER ON ALL TABLES IN SCHEMA public TO service_role`, or `ALTER
  DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role`
  (including inside `EXECUTE format('GRANT …')`), or grants `pg_maintain`,
  `pg_write_all_data` or `postgres` membership, assigns ownership to
  `service_role`, or grants CREATE/ALL on schema `public`
- **Then** the static test fails and names the file and line, including for
  a rollback numbered below NNN. The clone script passes only after both
  #2055 and the remaining schema grant are fixed (FR-007).

### Scenario 7 — fail closed on unexpected state (FR-004)

- **Given** a database where `service_role` owns one `public` table, or where
  a revoke is undone between revoke and postcondition (test seam)
- **When** NNN runs
- **Then** the migration aborts with a message naming the relation and
  privilege, and no privilege or default ACL changes are committed

### Scenario 8 — overload planting is refused (FR-004, FR-009)

- **Given** a synthetic owner-owned definer with `search_path = public,
  pg_temp`, unqualified `lower(varchar)` / `jsonb_build_object` calls and a
  private audit marker, with NNN applied
- **When** a genuine `service_role` session (P3-SA-8 as in FR-005: `rolsuper = false` fixture check, `SET LOCAL ROLE service_role` and `ASSERT current_user = 'service_role'` in the same transaction) attempts to create either public overload from
  SA's probe, then calls the legitimate RPC
- **Then** both CREATE FUNCTION statements fail with `42501`, the RPC result
  is unchanged and no attacker marker is written. In a separate negative
  control with table privileges revoked but schema CREATE retained, using
  the same P3-SA-8 session checks, each overload records execution as
  `postgres`. A re-grant seam and inherited
  CREATE fixture both cause the migration postcondition to abort.

### Scenario 9 — direct writes cascade as owner (FR-001, FR-005)

- **Given** synthetic `users`, `access_codes.issued_by ON DELETE SET NULL`
  and `user_code_assignments.user_id ON DELETE CASCADE` fixtures
- **When** a genuine `service_role` session (P3-SA-8 as in FR-005: `rolsuper = false` fixture check, `SET LOCAL ROLE service_role` and `ASSERT current_user = 'service_role'` in the same transaction) deletes the parent directly
- **Then** without NNN, planted child triggers record `current_user =
  postgres`; with NNN, planting each trigger fails with `42501`, while the
  legitimate FK action still succeeds. UPDATE CASCADE/SET NULL is covered
  by an equivalent fixture. Group 1 never limits the all-relations check.

### Scenario 10 — older rollback cannot reopen privileges (FR-006, FR-008)

- **Given** 356 and NNN are applied
- **When** the corrected down of 356 runs
- **Then** the FR-001/FR-009 postchecks still pass, and a genuine `service_role` session (P3-SA-8 as in FR-005: `rolsuper = false` fixture check, `SET LOCAL ROLE service_role` and `ASSERT current_user = 'service_role'` in the same transaction) still gets
  `42501` for `CREATE TRIGGER` on `class_action_log` and for creating a
  `public` function. Mutating that down to
  restore a targeted privilege fails the guard despite its number being
  lower than NNN.

### Scenario 11 — clone from a source without NNN (FR-007)

- **Given** a synthetic clone source without NNN and a checkout containing
  NNN with its mandatory `pending_feature` policy entry
- **When** the clone baseline runs, followed by the authorized explicit
  pending-feature apply
- **Then** the baseline leaves NNN unapplied, the apply actually executes
  NNN, and all table/default/schema privilege postchecks pass. This scenario
  must not copy production data into staging.

### Scenario 12 — temp-view shadow through an FK cascade is refused (FR-008, FR-010)

- **Given** a real PostgreSQL 16 and 17 harness in the post-NNN state:
  `service_role` has CRUD but no TRIGGER on any `public` table and no CREATE
  on schema `public` (both checked first: `CREATE TRIGGER` and
  `CREATE FUNCTION public.lower(varchar)` give `42501`), keeps the default
  TEMP privilege, and migration 283's four trigger functions exist without
  `SET search_path`, with a draft `grammar_content_releases` row referenced by
  `grammar_*` child rows through `release_id … ON DELETE CASCADE`
- **When** a genuine `service_role` session (P3-SA-8 as in FR-005: `rolsuper = false` fixture check, `SET LOCAL ROLE service_role` and `ASSERT current_user = 'service_role'` in the same transaction) creates `TEMP VIEW grammar_content_releases` that
  calls a `pg_temp` function writing an attacker marker and running
  `GRANT TRIGGER ON public.users TO service_role`, then deletes the draft
  release directly
- **Then** before migration 358 the planted function runs as `postgres` and
  `has_table_privilege('service_role','public.users','TRIGGER')` becomes
  true (red control); after 358 it stays false, no attacker marker exists,
  and no `public` function lacks `search_path` in `proconfig`
- **Negative control:** after 358, owner-run paths still fire the four
  triggers correctly (the cascade delete of a draft and the guarded
  rewrites behave exactly as before), and the two functions that read
  same-named `public` tables return the same trigger results as before 358.
  Function bodies, owners, ACLs and triggers are unchanged.

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
  Removing such a trigger is a separate, explicitly authorized step. The
  same applies to previously planted public function overloads; revoking
  schema CREATE does not remove them. Untriaged objects block Q-J357-3.
- **Supabase re-granting.** Dashboard actions such as exposing a schema in the
  Data API may grant privileges again. The drift query in `rollout.md` is
  re-run after such an action, and SA's read-only check on
  `has_table_privilege('service_role','public.users','TRIGGER')` stays part of
  every retest.
- **LOCK TABLE.** On PG 17, SELECT permits ACCESS SHARE; INSERT also permits
  ROW EXCLUSIVE and less-conflicting modes. UPDATE, DELETE, TRUNCATE or
  MAINTAIN permits every lock mode. Revoking MAINTAIN therefore does not
  forbid locks allowed by retained CRUD rights. The FR-005 ACCESS EXCLUSIVE
  probe uses SELECT-only `activation_attempts` and must fail; no backend path
  issues `LOCK TABLE` (`research.md` §3). See the PostgreSQL
  [LOCK privilege rules](https://www.postgresql.org/docs/17/sql-lock.html#SQL-LOCK-NOTES).
- **pg_dump and backups.** These need only SELECT and run as `postgres`, so
  they are unaffected.
- **PG 16 CI and PG 17 staging/production.** The MAINTAIN keyword is gated on
  `server_version_num >= 170000` with dynamic SQL, as in 320 and 356.

## Success criteria

- On staging after the apply, the read-only drift query in `rollout.md`
  returns zero rows for `service_role`, anon, authenticated and PUBLIC. That
  query covers TRIGGER, REFERENCES, TRUNCATE and MAINTAIN on public relations,
  plus actable default ACLs and CREATE on schema `public` (including PUBLIC).
  `has_table_privilege('service_role','public.users','TRIGGER')` is false.
- SA reruns `sa2050_probe.py` section "== P" and gets `42501` at `CREATE
  TRIGGER` (P2-SA-1 retest).
- Staging E2E and backend smoke stay green. No `42501`/`permission denied`
  error from `service_role` appears in Railway staging logs in the 24 h after
  the apply.
- FR-001–FR-006 have passing real-PostgreSQL or static tests on PG 16
  (required CI) and PG 17; FR-007–FR-009 have passing clone, rollback and
  overload-shadow evidence; FR-010 has the Scenario 12 red/green evidence on
  PG 16 and 17, and after 358 on staging zero `public` functions lack
  `search_path` in `proconfig`. Q-J357-3 is resolved with environment-specific
  evidence before promoting production or closing P2-SA-1.

## Open questions

These are the approval questions. Leader forwards them to anh Vinh; T001 is
opened only after Q1 is answered.

- **Q-J357-1 (duyệt FR):** Anh duyệt SVCPRIV-0042 FR-001…FR-009 không?
  (FR-010 đã được anh Vinh duyệt riêng ngày 2026-10-30 22:13 UTC+7, "FR010
  ok", `process/vinh-decisions-20261030.md`; Leader cấp số migration 358.) Nội
  dung: migration `NNN` thu TRIGGER, REFERENCES, TRUNCATE và MAINTAIN (PG 17)
  khỏi `service_role` trên **mọi** bảng `public` và trong quyền mặc định. Giữ
  nguyên SELECT/INSERT/UPDATE/DELETE và schema USAGE; thu thêm CREATE trên
  schema `public`. Thêm hậu điều kiện, test PostgreSQL thật và guard tĩnh.
  Script clone staging phải sửa cả schema grant còn lại; #2055 chưa đủ.
  Trả lời gợi ý: "SVCPRIV ok".
- **Q-J357-2 (xác nhận phạm vi bắt buộc):** Anh xác nhận áp dụng mọi bảng
  `public` và schema CREATE cùng một đợt không? Không có lựa chọn chỉ nhóm 1:
  FK CASCADE/SET NULL chạy dưới quyền owner, kể cả từ DELETE/UPDATE trực tiếp
  của service_role và từ xoá `auth.users` qua GoTrue admin API; SA đếm
  được ≥139 bảng trên staging. Nhóm 1 chỉ dùng để kiểm
  theo tên và dựng fixture. Nếu chưa đồng ý phạm vi này, spec giữ draft;
  không mở T001 với phạm vi hẹp hơn.
- **Q-J357-3 (điều kiện chặn promote prod và đóng P2-SA-1):** Leader phải có
  kết luận SA bằng văn bản, kèm bằng chứng riêng cho staging và production,
  trước promote prod hoặc đóng P2-SA-1. Tối thiểu cần:
  - đọc ACL schema `public` trên production (chỉ đọc), rồi chứng minh
    FR-009 sau apply; staging có thể nhận CREATE từ script clone nên không
    được suy ra ACL production từ staging;
  - triage trigger/overload đã cài trước NNN và chứng minh không còn đường
    thực thi dưới quyền owner qua chúng;
  - **P2-R2-1 (TEMP-shadow qua hàm chưa pin `search_path` + FK cascade):**
    service_role tạo `TEMP VIEW grammar_content_releases`, xoá trực tiếp một
    release draft; FK CASCADE chạy dưới owner, trigger 283 đọc tên không
    qualify nên chạy object TEMP với `current_user = postgres` và tự cấp lại
    `TRIGGER ON public.users` (SA, `/workspace/qa/pr2060/r2/probe_temp_shadow.out`).
    Đường này là **điều kiện chặn promote prod và chặn đóng P2-SA-1 cho tới
    khi SA retest 358 ĐẠT**. Không được chấp nhận nó như rủi ro còn lại. Nó
    đóng bằng FR-010 (migration 358, PC-J406), không phải NNN một mình;
  - REVOKE TEMP chỉ là phòng thủ thêm, phiếu riêng **PC-J407** (job 1iu),
    HOLD sau 358; không phải điều kiện để đóng P2-R2-1;
  - quyết định xử lý hoặc ghi nhận rủi ro còn lại của schema khác: staging
    có TRIGGER trên 5/8 bảng `storage`, cùng default ACL của postgres trong
    `storage`; production chưa kiểm;
  - default EXECUTE (`f`) của postgres trong `public` cho hàm mới (SA
    P3-R2-3): phiếu riêng **PC-J364** (job 1gz); default ACL mà runner không
    sửa được: follow-up Supabase support trong `rollout.md`;
  - Functions whose search_path omits pg_temp or does not list it last (finding 001iv, `FINDING-pgtemp-first-pinned-paths.md`) — scope decision pending Q-0600-PGTEMP (Vinh); not covered by FR-010 as approved.

  Việc chỉ mở phiếu tiếp theo không tự gỡ chặn. Còn đường chạy code dưới
  quyền owner chưa xử lý thì không đóng P2-SA-1 hoặc promote production.
- **Q-J357-4 (thứ tự với 341):** P2-SA-1 có cần sửa tối thiểu trên
  `public.users` ngay trong 341/341b (#2050) trước khi promote không? SA đề
  nghị như vậy; FR-008 bảo đảm hai bên không xung đột. Hay chờ migration
  `NNN`, và coi P2-SA-1 là điều kiện chặn promote prod cho tới khi `NNN` lên?
