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
  - `REVOKE UPDATE, DELETE ON public.class_action_log FROM service_role`;
    repeat for PUBLIC, anon and authenticated (FR-004; their 320 revokes stay
    effective). The row trigger from 198 remains unchanged as a second layer.
  - `COMMENT ON POLICY cal_admin_append ON public.class_action_log IS …`
    (FR-003).
  - A postcondition `DO` block that aborts unless the trigger exists and is
    enabled, `service_role` has SELECT and INSERT, and `service_role`/PUBLIC
    have no TRIGGER, REFERENCES, TRUNCATE (or MAINTAIN on PG 17+), and
    service_role/PUBLIC/anon/authenticated have no UPDATE or DELETE, including
    column UPDATE grants. Fail on residual effective privileges rather than
    claiming the final SELECT/INSERT-only matrix holds.
  - No `GRANT` statement, no data change, no change to 198's row trigger,
    function body, policies or RLS.
- FastAPI and frontend: unchanged. The backend only INSERTs
  (`class_assignment_service.py:479`) and SELECTs (`:501`).

## Data and contracts

- Privilege target after 356 on `public.class_action_log`:

  | Role | SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER | MAINTAIN (PG17) |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | service_role | yes | yes | no | no | no | no | no | no |
  | anon, authenticated | yes (RLS) | no | no | no | no | no | no | no |
  | PUBLIC | no | no | no | no | no | no | no | no |

  service_role has SELECT and INSERT only. anon/authenticated retain their
  SELECT-only matrix from 320; their UPDATE/DELETE revokes are repeated.
- Errors: service_role UPDATE/DELETE fail with ACL `42501` before the trigger;
  the owner, or service_role after an isolated test re-grant, still gets the
  198 `P0001` message. TRUNCATE is ACL `42501` for service_role or trigger
  `P0001` when the caller has that privilege. No API shape changes.
- ACCESS EXCLUSIVE LOCK and SELECT FOR UPDATE as service_role must fail with
  `42501`; ordinary INSERT/SELECT succeed. See spec Decisions 1 for the exact
  SA probe coverage and the SELECT FOR UPDATE denial still to verify.

## Compatibility risk and stop condition

- At base #2045 `5d9296ec2`, `rg -n -i 'class_action_log' backend/` finds
  INSERT in `log_class_action` (`class_assignment_service.py:479`) and SELECT
  in `read_class_actions` (`:501`), used by the admin read route
  (`admin_class_assignments.py:2850`). The shared admin client uses
  `SUPABASE_SERVICE_KEY` (`backend/database.py:30-31`). No backend UPDATE or
  DELETE consumer was found. No frontend or API contract needs changing.
- Re-run that audit before T001. If any backend UPDATE/DELETE consumer is
  found, stop and report to PC/Leader; do not hide the dependency by changing
  the FR or granting the privileges back.

## Rollout and rollback

- Staging first, under the advisory lock, after STAGING_FREEZE is lifted
  (`rollout.md`); production only at an authorized promotion.
- Rollback: the 356 down script drops `trg_class_action_log_no_truncate` (and
  its function if 356 created one), re-grants TRIGGER, REFERENCES and (PG 17)
  MAINTAIN to `service_role`, and removes the policy comment. TRUNCATE and
  FR-004 UPDATE/DELETE stay revoked, including for PUBLIC/anon/authenticated.
  No UPDATE/DELETE grant or `GRANT ALL` is allowed in the down script (SA F5);
  restoring the other legacy privileges does not restore these. No data is
  written.

## Verification strategy

- Real PostgreSQL (harness of `test_client_write_invariant_postgres.py` /
  `test_class_action_log_postgres.py`, Supabase-style default ACL, PG 16
  required, PG 17 advisory) loading 198, 204, 320 and 356 from the files:
  - FR-001: owner TRUNCATE → `P0001`; `SET ROLE service_role` TRUNCATE →
    `42501`, and `P0001` after the test re-grants TRUNCATE; UPDATE/DELETE as
    owner → `P0001` with the 198 message; service_role → `42501`, then
    `P0001` after an isolated test re-grant; row count unchanged.
  - FR-002: privilege matrix above via `has_table_privilege`,
    `has_any_column_privilege` and `aclexplode`; INSERT as `service_role`
    and SELECT succeed; MAINTAIN only on PG 17+.
  - FR-003: `pg_policies` unchanged; `obj_description` of the policy.
  - FR-004: non-owner, non-superuser service_role via `SET LOCAL ROLE` with
    `current_user` asserted; UPDATE and DELETE each → `42501` on a seeded row,
    including an isolated owner-disabled-row-trigger control to prove ACL
    refusal precedes the trigger. ACCESS EXCLUSIVE LOCK and SELECT FOR UPDATE
    each → `42501`; INSERT/SELECT succeed. After the down script, effective
    UPDATE/DELETE privileges remain false and both statements still → `42501`;
    statically reject direct UPDATE/DELETE grants and `GRANT ALL` in down.
  - Second apply of 356 stays green.
  - Negative control (recorded in the PR): without the new trigger the owner
    TRUNCATE test fails.
- Update expectations in the existing tests this changes:
  `test_class_action_log_postgres.py` (#2022/#2041: `service_role` MAINTAIN is
  asserted true today, UPDATE/DELETE expect trigger `P0001`; update their
  post-356 expectations to MAINTAIN=false and UPDATE/DELETE ACL `42501`,
  retaining isolated re-grant tests for trigger `P0001`) and keep
  the #2041 static guard (`test_migrations_never_regrant_audit_log_truncate`)
  green; 356 must contain no `GRANT TRUNCATE`/`GRANT ALL`.
- Staging: read-only catalog postcheck (`rollout.md`).
