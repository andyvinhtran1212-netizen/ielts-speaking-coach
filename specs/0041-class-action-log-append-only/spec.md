---
id: CALAPPEND-0041
title: The class action log is append-only for every role, and no role can wipe it with TRUNCATE
status: approved
risk: high
owner: product
---

# The class action log is append-only for every role, and no role can wipe it with TRUNCATE

Approval: Leader báo anh Vinh duyệt CAL-APPENDONLY 30/10 13:38 (t744s2552).
Vinh's reply on 2026-10-30 13:38 (UTC+7), verbatim "CAL-APPENDONLY ok", to
question Q-0835-CAL-APPENDONLY (see [`approval-decision.md`](approval-decision.md)).
Spec number 0041 and migration number **356**: assigned by the Leader
(migration 356 on 2026-10-30 08:27 UTC+7).
Origin: Security Auditor notes P3-SA-1, P3-SA-2 and P3-SA-3 on #2022
(`reviews/PR-2022.md`), ticket PC-J286 (job 1ec); this spec is PC-J343.

## Tóm tắt (tiếng Việt)

`class_action_log` (mig 198) là nhật ký thao tác của giáo viên lên hồ sơ học
viên: đổi hạn nộp, trả bài. Hiện UPDATE/DELETE bị trigger chặn với mọi vai,
nhưng TRUNCATE chỉ bị chặn bằng quyền (REVOKE ở mig 204). Chỉ cần một migration
sau `GRANT ALL` cho `service_role` là mất lớp chặn duy nhất, và owner thì vẫn
TRUNCATE được. Migration 356 thêm trigger chặn TRUNCATE (kể cả owner và
`service_role`), thu các quyền thừa TRIGGER/REFERENCES/MAINTAIN của
`service_role` và PUBLIC, và ghi chú vì sao policy `cal_admin_append` không còn
tác dụng sau mig 320 (không xoá policy).

Người dùng không thấy thay đổi gì: giáo viên vẫn đổi hạn, trả bài, admin vẫn
đọc nhật ký như cũ. Chỉ áp staging; prod là bước promote riêng, cần anh Vinh
duyệt riêng.

## Problem

`public.class_action_log` is the only record of who changed a due date or
returned a learner's work, and from which value to which. Today (staging
`4c9becc28`, read-only check in `reviews/PR-2022.md`):

- UPDATE and DELETE are refused for every role by the row trigger
  `trg_class_action_log_append_only` (`198_class_action_log.sql:123-135`).
- TRUNCATE fires no row trigger and ignores RLS. It is refused only by the ACL
  line `REVOKE TRUNCATE … FROM PUBLIC, anon, authenticated, service_role`
  (`204_reconcile_course_and_gate_e_schema.sql:22-23`). The default ACL of
  `postgres` still grants TRUNCATE to `service_role` on new tables, so one later
  `GRANT ALL` removes the only barrier (P3-SA-1). The owner can TRUNCATE at any
  time. The other append-only audit tables already have a second layer:
  `staff_security_audit` (332) and `ai_budget_raise_events` (333) carry a
  `BEFORE TRUNCATE … FOR EACH STATEMENT` trigger.
- `service_role` still holds TRIGGER, REFERENCES and MAINTAIN (PG 17) on the
  table (P3-SA-2). The backend does not use them; they only matter on a direct
  database connection.
- The policy `cal_admin_append` (`198_class_action_log.sql:104-107`, INSERT TO
  authenticated) has had no effect since migration 320 revoked INSERT from
  `authenticated`; the backend writes as `service_role`
  (`backend/services/class_assignment_service.py:479`). Nothing records why it
  is still there (P3-SA-3).

No existing spec mentions `class_action_log` (migration 198 predates spec
governance, #1010), and migration 356 is a high-risk path, so it needs these
requirements on its merge base.

## Scope

- Migration 356 on `public.class_action_log` only: a `BEFORE TRUNCATE … FOR
  EACH STATEMENT` trigger, the privilege revokes below, and a `COMMENT ON
  POLICY cal_admin_append`; README and `forward-policy.tsv` entries; a down
  script.
- Real-PostgreSQL tests for each requirement, and the expectation updates this
  change causes in the existing `class_action_log` ACL tests (#2022, #2041).

## Non-goals

- Changing what the backend writes to the log, the admin read route
  (`admin_class_assignments.py` `class_action_log`), or any UI.
- Revoking UPDATE or DELETE from `service_role`. They are not part of
  Q-0835-CAL-APPENDONLY; both stay refused by the existing row trigger
  (FR-001). See Decisions.
- Dropping or changing the policies `cal_admin_read` or `cal_admin_append`.
- Changing anon or authenticated privileges (SELECT only since 320) or the
  default ACL for future tables.
- A cleanup or retention process for the log.
- Applying 356 to production in this spec's staging work.

## Users and journeys

- A teacher changes a due date or returns work: the action is logged exactly as
  today.
- An admin opens the class action log: they read every row as today.
- An operator or a backend bug (service-role key, direct connection, a later
  migration with `GRANT ALL`) tries to UPDATE, DELETE or TRUNCATE the log: the
  statement fails and every row stays.
- A deliberate, audited cleanup (for example a personal-data deletion request)
  must disable the trigger on purpose first, as the 198 header already
  describes for UPDATE/DELETE.

## Requirements

- **FR-001:** `public.class_action_log` is append-only for every role, including the table owner and `service_role`: UPDATE and DELETE stay refused by the existing `BEFORE UPDATE OR DELETE … FOR EACH ROW` trigger `trg_class_action_log_append_only` (198:123-135) with its current message, and TRUNCATE is refused by a new `BEFORE TRUNCATE … FOR EACH STATEMENT` trigger added in migration 356; every refusal raises SQLSTATE `P0001`, and no row is changed or removed.
- **FR-002:** After migration 356, `service_role` keeps SELECT and INSERT on `public.class_action_log` (the backend write path); TRIGGER, REFERENCES and, on PostgreSQL 17 or later only, MAINTAIN are revoked from `service_role` and PUBLIC; TRUNCATE stays revoked from PUBLIC, anon, authenticated and `service_role` as in 204:22-23; the migration grants no privilege to any role.
- **FR-003:** The policy `cal_admin_append` is not dropped or changed; migration 356 adds a `COMMENT ON POLICY cal_admin_append ON public.class_action_log` stating that it has had no effect since migration 320 revoked INSERT from `authenticated`, that the backend writes as `service_role`, and that it is kept on purpose (P3-SA-3).

## Acceptance scenarios

### Scenario 1 — TRUNCATE refused for the owner and service_role (FR-001)

- **Given** migrations 198, 204, 320 and 356 are applied on a real PostgreSQL with a Supabase-style default ACL, and the log has rows
- **When** the owner runs `TRUNCATE public.class_action_log`, and separately `SET ROLE service_role` runs the same statement
- **Then** the owner's statement fails with SQLSTATE `P0001` from the new trigger, `service_role`'s fails (with `42501` from the ACL while 204 holds, and with `P0001` when TRUNCATE is re-granted to it in the test), and the row count is unchanged

### Scenario 2 — UPDATE and DELETE still refused (FR-001)

- **Given** the same database
- **When** the owner and `service_role` UPDATE or DELETE an existing row
- **Then** each fails with SQLSTATE `P0001` and the existing 198 append-only message, and the row is unchanged

### Scenario 3 — backend write path intact, extra privileges gone (FR-002)

- **Given** the same database
- **When** the test reads `has_table_privilege` / `has_any_column_privilege` and `aclexplode(relacl)` for `public.class_action_log`
- **Then** `service_role` has SELECT and INSERT, an INSERT as `service_role` succeeds, `service_role` and PUBLIC have no TRIGGER, REFERENCES or TRUNCATE, and on PostgreSQL 17 or later no MAINTAIN; on PostgreSQL 16 the migration runs without naming MAINTAIN

### Scenario 4 — policy kept and explained (FR-003)

- **Given** the same database
- **When** the test reads `pg_policies` and `obj_description` of the `cal_admin_append` policy
- **Then** both `cal_admin_read` and `cal_admin_append` exist with their 198 definitions, and the comment states the policy is inert since 320 and kept on purpose

### Scenario 5 — re-run and negative control (FR-001, FR-002, FR-003)

- **Given** migration 356 has been applied
- **When** it runs a second time, and, in a negative control, the database is built without the new trigger
- **Then** the second run succeeds and every assertion above still holds; without the trigger the owner TRUNCATE test fails (the owner empties the table)

## Edge cases

- `TRUNCATE … CASCADE` from another table: `class_action_log` has no foreign
  keys (198 header), so no cascade reaches it; a direct or multi-table TRUNCATE
  that names it fires the statement trigger and is refused.
- A superuser can still bypass the triggers with `ALTER TABLE … DISABLE
  TRIGGER` or `session_replication_role = replica`. That is the deliberate,
  auditable cleanup path from the 198 header and is accepted; it is not open to
  `service_role` or any client role.
- PostgreSQL 16 (CI) has no MAINTAIN privilege and rejects the keyword, so the
  revoke is gated on `server_version_num >= 170000` (staging and production run
  17.6).
- The 204:19-21 comment allowed owner TRUNCATE as maintenance; after 356 the
  owner must disable the trigger first, the same rule as UPDATE/DELETE.
- A later migration that runs `GRANT TRUNCATE`/`GRANT ALL` on the log is caught
  statically by the #2041 guard and, if it lands anyway, still refused by the
  FR-001 trigger.

## Success criteria

- On staging after apply, `pg_trigger` shows the new `BEFORE TRUNCATE` trigger
  enabled on `public.class_action_log`, and
  `has_table_privilege('service_role','public.class_action_log','TRIGGER')`,
  `… 'REFERENCES'` and `… 'MAINTAIN'` are false while `… 'SELECT'` and
  `… 'INSERT'` are true.
- Teachers' due-date changes and returns still write log rows on staging, and
  the admin log view still reads them.
- Every scenario has a passing real-PostgreSQL test on PG 16 (required CI) and
  PG 17.

## Decisions

1. UPDATE/DELETE are not revoked from `service_role`. Q-0835-CAL-APPENDONLY,
   as approved, asks for the TRUNCATE trigger and for revoking
   TRIGGER/REFERENCES/MAINTAIN. "service_role keeps SELECT and INSERT" means
   the backend path needs exactly those two; UPDATE/DELETE stay refused by the
   row trigger (P0001), which #2041 already tests for `service_role`. Revoking
   them as well would change that refusal to `42501` and needs a separate
   amendment.
2. The TRUNCATE trigger may reuse `fn_class_action_log_append_only()` (a
   plpgsql trigger function works at statement level) or use a new function
   following 332:208-218 (`SET search_path = public, pg_temp`, ERRCODE
   `P0001`); either satisfies FR-001.

## Open questions

- None for approval. Ordering with #2022 and #2041 (both open on 2026-10-30) is
  handled in `tasks.md` T001.
