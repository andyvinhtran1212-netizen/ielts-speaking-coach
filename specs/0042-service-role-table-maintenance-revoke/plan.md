# Implementation plan

Draft. Written for the T001 ticket; becomes binding only after SVCPRIV-0042
is approved.

## Architecture impact

- Database only: one forward migration `NNN_service_role_table_maintenance_revoke.sql`.
  NNN statements, in order, all in one transaction:
  1. `SET LOCAL lock_timeout = '5s'`.
  2. Precondition (FR-004): abort if any `public` relation with `relkind` in
     `r`, `p`, `v`, `m`, `f`, or schema `public`, is owned by a targeted role.
     Triage previously planted functions/triggers from the pre-apply catalog.
  3. Snapshot (FR-002): a temp table with
     `aclexplode(COALESCE(relacl, acldefault('r', relowner)))` and column ACL
     entries (NULL means empty) for SELECT, INSERT, UPDATE and DELETE of
     every `public` relation and column. Normalize both sides identically;
     include grant options and a NULL-relacl fixture. Snapshot schema USAGE.
  4. Revoke (FR-001):
     - `REVOKE TRIGGER, REFERENCES, TRUNCATE ON ALL TABLES IN SCHEMA public
       FROM PUBLIC, anon, authenticated, service_role`.
     - A `pg_class` loop for any relkind that `ALL TABLES` does not cover.
     - `REVOKE MAINTAIN …` through dynamic `EXECUTE` only when
       `server_version_num >= 170000` (320:238 pattern).
     - `REVOKE CREATE ON SCHEMA public FROM service_role, anon,
       authenticated, PUBLIC` (FR-009).
  5. Default ACLs (FR-003): the 320:236-266 owner loop, extended to
     - grantee `service_role`;
     - both scopes: `IN SCHEMA public` for `defaclnamespace = public` and the
       global form for `defaclnamespace = 0`;
     - only owners the runner is a superuser for or a member of.

     Then create `public._svcpriv_default_probe(id int)`, assert FR-001 on
     it, and drop it.
  6. Postcondition `DO` block (FR-001–FR-004, FR-009):
     - `has_table_privilege` for `service_role`, anon and authenticated
       over all relations, plus the priority-1 names from
       `research.md` §2;
     - `aclexplode` for PUBLIC;
     - the default ACL entries;
     - the normalized CRUD snapshot diff and unchanged schema USAGE;
     - `has_schema_privilege` for all three roles and public schema CREATE
       entries for PUBLIC via `aclexplode`, failing also on inherited CREATE.

     It raises on any failure. It emits `RAISE WARNING` for default ACLs
     the runner cannot change, and `RAISE NOTICE` for other non-owner
     grantees and for triggers whose function is in `pg_temp_*` or owned by
     a role other than the relation owner.
- Every public relation is covered. Priority groups only order named checks
  and fixtures, including access_codes and user_code_assignments. They are
  never an optional reduced apply scope.
- FR-006 scans **all** rollback files without a numeric exemption. Correct
  the down of 356 under F5 before release; any other violating rollback must
  be made safe before the guard passes. Include table/default grants, role
  memberships, ownership changes, schema CREATE/ALL and dynamic SQL strings
  such as `EXECUTE format('GRANT …')` in the mutation fixtures.
- The NNN `pending_feature` forward-policy entry is mandatory, not optional.
  A clone baseline must exclude its group from `MIGRATION_FEATURES` and
  leave it unapplied; the authorized feature apply
  must then execute it and pass the privilege postcheck.
- NNN does not touch functions, triggers, policies, RLS flags, ownership, data,
  sequences, function EXECUTE or other schemas. No GRANT statement in NNN
  (FR-002, FR-008).
- Migration 358 (FR-010, T004, PC-J406) is separate from NNN and applied
  after 357. It sets `search_path = public, pg_temp` on every `public`
  function whose `proconfig` has no `search_path`, with a fail-closed
  zero-unpinned postcondition and a `pending_feature` entry. It changes only
  `proconfig`: no body, owner, ACL or trigger (FR-008). Its static guard
  rejects new unpinned `CREATE [OR REPLACE] FUNCTION` in
  `backend/migrations/**`.
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
- Schema `public`: CREATE absent for all API roles and PUBLIC; USAGE
  unchanged. Revoking CREATE also blocks public overload planting.
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
  - After #2055 and the J350 follow-up removing the API-role schema CREATE
    grant; #2055 alone does not satisfy FR-007/FR-009.
  - Independent of 341/356 forward applies; the unsafe down of 356 must
    nevertheless be corrected before release (FR-008).
  - Q-J357-3 blocks production promotion and closure of P2-SA-1 until SA's
    environment-specific decision is recorded. Staging ACLs do not prove
    production ACLs.
  - The migration number is assigned by the Leader.

## Verification strategy

- PG 16 and 17 real-database tests for scenarios 1–5 and 7–11, including:
  - a second apply;
  - a negative control without NNN, where the planted trigger runs as the
    owner;
  - the P2-SA-1 repro;
  - direct service_role DELETE/UPDATE → FK CASCADE/SET NULL → child-trigger
    probes, with both negative controls and refused planting after NNN;
  - overload-shadow probes with only table rights revoked as the negative
    control, then schema CREATE revoked, plus an inherited-CREATE abort;
  - corrected down-356 regression (genuine service_role UPDATE/DELETE on
    `class_action_log` → 42501 after the down) and synthetic pre-NNN
    clone/baseline/apply;
  - Scenario 12 for 358: temp-view shadow through an FK cascade, red before
    and green after 358, with an owner-path negative control.
- Static guard plus `.sql`, `.sh`, `.py` mutation fixtures for scenario 6,
  including rollback files below NNN and every forbidden grant family.
- Full backend suite on the worktree; `bash -n` not needed (no shell change).
- Staging: read-only postcheck, SA's `sa2050_probe.py` "== P" rerun,
  staging smoke and E2E green, and Railway staging logs free of
  `service_role` `42501` for 24 h.
