# Rollout and rollback

## Preconditions

- CALAPPEND-0041 approved on `staging`; T001 (PC-J286) merged.
- STAGING_FREEZE lifted; the Leader runs the apply under the migration apply
  procedure (re-creating STAGING_FREEZE for the apply if the procedure says
  so).
- Migrations 198, 204, 320 and **344** are applied in the target environment;
  deployment order is **344 then 356**. Check the ledger read-only before
  apply, plus 344's postconditions on `class_action_log`: both policies absent,
  no anon/authenticated table or column privileges, RLS enabled. Stop the
  deployment if that state is not established; the pre-344 fixture is only
  an isolated compatibility control.

## Staging

1. The Leader applies 356 with the advisory-locked runner on
   `ielts-coach-staging`.
2. Read-only postcheck:
   - `pg_trigger` has `trg_class_action_log_no_truncate` on
     `public.class_action_log`, `tgenabled = 'O'`, BEFORE TRUNCATE, FOR EACH
     STATEMENT; `trg_class_action_log_append_only` is unchanged.
   - `has_table_privilege('service_role','public.class_action_log', p)` is
     false for UPDATE, DELETE, TRIGGER, REFERENCES, TRUNCATE, MAINTAIN (PG 17+)
     and true for SELECT, INSERT: service_role has only those two privileges.
     anon/authenticated have no effective table or column privileges,
     including SELECT, as required by 344; `aclexplode(relacl)` has no PUBLIC
     (grantee 0) entry.
   - `pg_policies` has no `cal_admin_read` or `cal_admin_append` on
     `public.class_action_log`; no policy comment is expected. RLS remains
     enabled. The 356 fixture/postcheck must cover this already-applied-344
     state rather than assume the policies exist.
3. No write probes on staging: TRUNCATE/UPDATE/DELETE behaviour is covered by
   the PostgreSQL tests in T001. A teacher due-date change on QA data and the
   admin log view may be checked as a smoke test.

## Production

Only with Vinh's explicit authorization at the `staging` → `main` promotion,
as a separate step: check the ledger read-only, apply 356 under the advisory
lock and run the same read-only postcheck. No production write probes.

## Rollback and repair

- The 356 down script is owned by spec 0042 T001 (#2060,
  FR-008/Scenario 10). It must not grant UPDATE/DELETE or `GRANT ALL`, and must
  not re-grant TRIGGER, REFERENCES or MAINTAIN (SA F5).
- It must not recreate or comment on either policy, or restore any
  anon/authenticated privilege removed by 344. A 356 rollback leaves 344's
  policy removal and client lockdown intact; verify the same read-only
  policy/ACL/RLS postcheck after down. T001 also tests that down preserves the
  separate pre-344 fixture's policy/client-ACL state.
- No data to repair: 356 changes no rows. If a legitimate operation is refused
  after apply (none is known: the backend only INSERTs and SELECTs), roll back
  356 first, then fix in a spec revision.

## Observability

- A refused service_role TRUNCATE/UPDATE/DELETE surfaces as ACL `42501` in the
  caller's logs; a caller with the privilege (such as the owner) instead gets
  trigger `P0001`. There is no product path that issues them, so any occurrence
  is investigated. ACCESS EXCLUSIVE LOCK and SELECT FOR UPDATE denial for
  service_role must be covered by T001, without write probes on staging.
- Watch after apply: `class_action_log` row inserts from due-date changes and
  returns keep arriving; an INSERT failure would show as an error in
  `class_assignment_service` logs and means roll back.
- Owner: product owner; the Leader reports T002 on the PR, SA retests
  read-only.
