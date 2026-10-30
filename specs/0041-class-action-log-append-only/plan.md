# Implementation plan

## Architecture impact

- Database only, one table: migration 356 on `public.class_action_log`.
  - `CREATE OR REPLACE TRIGGER trg_class_action_log_no_truncate BEFORE
    TRUNCATE ON public.class_action_log FOR EACH STATEMENT`, executing
    `fn_class_action_log_append_only()` (198) or a new function in the 332
    pattern (`SET search_path = public, pg_temp`, `ERRCODE = 'P0001'`).
  - `REVOKE TRIGGER, REFERENCES ON public.class_action_log FROM PUBLIC,
    service_role`; `REVOKE MAINTAIN …` in a `DO` block only when
    `current_setting('server_version_num')::int >= 170000` (dynamic `EXECUTE`,
    because PG 16 rejects the keyword); repeat `REVOKE TRUNCATE … FROM PUBLIC,
    anon, authenticated, service_role` (idempotent, same as 204).
  - `COMMENT ON POLICY cal_admin_append ON public.class_action_log IS …`
    (FR-003).
  - A postcondition `DO` block that aborts unless the trigger exists and is
    enabled, `service_role` has SELECT and INSERT, and `service_role`/PUBLIC
    have no TRIGGER, REFERENCES, TRUNCATE (or MAINTAIN on PG 17+).
  - No `GRANT` statement, no data change, no change to 198's row trigger,
    function body, policies or RLS.
- FastAPI and frontend: unchanged. The backend only INSERTs
  (`class_assignment_service.py:479`) and SELECTs (`:501`).

## Data and contracts

- Privilege target after 356 on `public.class_action_log`:

  | Role | SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER | MAINTAIN (PG17) |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | service_role | yes | yes | yes (row trigger refuses) | yes (row trigger refuses) | no | no | no | no |
  | anon, authenticated | yes (RLS) | no | no | no | no | no | no | no |
  | PUBLIC | no | no | no | no | no | no | no | no |

  anon/authenticated are unchanged from 320; UPDATE/DELETE for `service_role`
  are unchanged (spec Decisions 1).
- Errors: UPDATE/DELETE keep the 198 message; TRUNCATE raises `P0001` with a
  message naming `class_action_log` as append-only. No API shape changes.

## Rollout and rollback

- Staging first, under the advisory lock, after STAGING_FREEZE is lifted
  (`rollout.md`); production only at an authorized promotion.
- Rollback: the 356 down script drops `trg_class_action_log_no_truncate` (and
  its function if 356 created one), re-grants TRIGGER, REFERENCES and (PG 17)
  MAINTAIN to `service_role`, and removes the policy comment. TRUNCATE stays
  revoked. No data is written.

## Verification strategy

- Real PostgreSQL (harness of `test_client_write_invariant_postgres.py` /
  `test_class_action_log_postgres.py`, Supabase-style default ACL, PG 16
  required, PG 17 advisory) loading 198, 204, 320 and 356 from the files:
  - FR-001: owner TRUNCATE → `P0001`; `SET ROLE service_role` TRUNCATE →
    `42501`, and `P0001` after the test re-grants TRUNCATE; UPDATE/DELETE as
    owner and `service_role` → `P0001` with the 198 message; row count
    unchanged.
  - FR-002: privilege matrix above via `has_table_privilege`,
    `has_any_column_privilege` and `aclexplode`; INSERT as `service_role`
    succeeds; MAINTAIN only on PG 17+.
  - FR-003: `pg_policies` unchanged; `obj_description` of the policy.
  - Second apply of 356 stays green.
  - Negative control (recorded in the PR): without the new trigger the owner
    TRUNCATE test fails.
- Update expectations in the existing tests this changes:
  `test_class_action_log_postgres.py` (#2022/#2041: `service_role` MAINTAIN is
  asserted true today; TRUNCATE trigger is noted as PC-J286's scope) and keep
  the #2041 static guard (`test_migrations_never_regrant_audit_log_truncate`)
  green; 356 must contain no `GRANT TRUNCATE`/`GRANT ALL`.
- Staging: read-only catalog postcheck (`rollout.md`).
