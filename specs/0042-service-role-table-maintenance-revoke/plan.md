# Implementation plan

Draft. Written for the T001 ticket; becomes binding only after SVCPRIV-0042
is approved.

## Architecture impact

- Database only: one forward migration `NNN_service_role_table_maintenance_revoke.sql`.
  Statements, in order, all in one transaction:
  1. `SET LOCAL lock_timeout = '5s'`.
  2. Precondition (FR-004): abort if any `public` relation with `relkind` in
     `r`, `p`, `v`, `m`, `f` is owned by `service_role`.
  3. Snapshot (FR-002): a temp table with `aclexplode(relacl)` and
     `aclexplode(attacl)` entries for SELECT, INSERT, UPDATE and DELETE of
     every `public` relation and column.
  4. Revoke (FR-001):
     - `REVOKE TRIGGER, REFERENCES, TRUNCATE ON ALL TABLES IN SCHEMA public
       FROM PUBLIC, anon, authenticated, service_role`.
     - A `pg_class` loop for any relkind that `ALL TABLES` does not cover.
     - `REVOKE MAINTAIN …` through dynamic `EXECUTE` only when
       `server_version_num >= 170000` (320:238 pattern).
  5. Default ACLs (FR-003): the 320:236-266 owner loop, extended to
     - grantee `service_role`;
     - both scopes: `IN SCHEMA public` for `defaclnamespace = public` and the
       global form for `defaclnamespace = 0`;
     - only owners the runner is a superuser for or a member of.

     Then create `public._svcpriv_default_probe(id int)`, assert FR-001 on
     it, and drop it.
  6. Postcondition `DO` block (FR-001–FR-004):
     - `has_table_privilege` for `service_role`, anon and authenticated
       over all relations, plus the priority-1 names from
       `research.md` §2;
     - `aclexplode` for PUBLIC;
     - the default ACL entries;
     - the snapshot diff.

     It raises on any failure. It emits `RAISE WARNING` for default ACLs
     the runner cannot change, and `RAISE NOTICE` for other non-owner
     grantees and for triggers whose function is in `pg_temp_*` or owned by
     a role other than the relation owner.
- Not touched: functions, triggers, policies, RLS flags, ownership, data,
  sequences, function EXECUTE, other schemas. No GRANT statement anywhere
  (FR-002, FR-008).
- FastAPI, frontend, OpenAPI: unchanged.
- Tests (T001):
  - `backend/tests/test_migration_NNN_service_role_table_maintenance_revoke.py`:
    real-PostgreSQL harness on PG 16 and 17 with a Supabase-style default
    ACL, built like the 326/332 harnesses with the P3-SA-8 assertions;
  - a static guard test, `backend/tests/test_service_role_table_privilege_guard.py`
    (FR-006).

## Data and contracts

Privilege target for every `public` relation not owned by `service_role`:

| Grantee | SELECT/INSERT/UPDATE/DELETE | TRIGGER | REFERENCES | TRUNCATE | MAINTAIN (PG 17) |
| --- | --- | --- | --- | --- | --- |
| service_role | unchanged (snapshot-equal) | no | no | no | no |
| anon, authenticated | unchanged (320) | no | no | no | no |
| PUBLIC | unchanged | no | no | no | no |
| owner (`postgres`) | owner rights | owner | owner | owner | owner |

- Default ACLs (actable owners, `public` + global, objtype `r`): the same
  four privileges are absent for the same grantees.
- Errors: a refused statement raises `42501` (insufficient privilege). No
  backend path issues one; API shapes are unchanged.
- Interaction:
  - 320 already holds the anon/authenticated part, so NNN re-asserts it.
  - CALAPPEND-0041 FR-002 (356) asserts the same for `class_action_log`.
  - 341/341b may revoke on `users` first (Q-J357-4).

  All of these postconditions agree.

## Rollout and rollback

- Staging first: the Leader applies `NNN` on `ielts-coach-staging` and runs
  the read-only postcheck in `rollout.md`; SA retests. Production only at a
  `staging` → `main` promotion with Vinh's authorization.
- Rollback is targeted, not blanket. No backend path needs these privileges,
  so the migration header documents re-granting only the single privilege
  on the single table that a confirmed incident needs, through a new forward
  migration under a spec revision. A full re-grant would reopen P2-SA-1 on
  every table, and the header says so. Code rollback: none (database only).
- Ordering:
  - After #2055 (J350) merges, because FR-006's guard scans
    `backend/scripts/` and fails on base lines 58–63.
  - Independent of 341 and 356 (FR-008).
  - The migration number is assigned by the Leader.

## Verification strategy

- PG 16 and 17 real-database tests for scenarios 1–5 and 7, including:
  - a second apply;
  - a negative control without NNN, where the planted trigger runs as the
    owner;
  - the P2-SA-1 repro;
  - a FK-cascade probe (`research.md` §1) proving that a BEFORE trigger on a
    child runs as the owner without NNN and cannot be planted with NNN.
- Static guard test plus mutation fixtures (`.sql` and `.sh`) for scenario 6.
- Full backend suite on the worktree; `bash -n` not needed (no shell change).
- Staging: read-only postcheck, SA's `sa2050_probe.py` "== P" rerun,
  staging smoke and E2E green, and Railway staging logs free of
  `service_role` `42501` for 24 h.
