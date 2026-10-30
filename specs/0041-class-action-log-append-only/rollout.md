# Rollout and rollback

## Preconditions

- CALAPPEND-0041 approved on `staging`; T001 (PC-J286) merged.
- STAGING_FREEZE lifted; the Leader runs the apply under the migration apply
  procedure (re-creating STAGING_FREEZE for the apply if the procedure says
  so).
- Migrations 198, 204 and 320 are applied in the target environment; check the
  ledger read-only before apply.

## Staging

1. The Leader applies 356 with the advisory-locked runner on
   `ielts-coach-staging`.
2. Read-only postcheck:
   - `pg_trigger` has `trg_class_action_log_no_truncate` on
     `public.class_action_log`, `tgenabled = 'O'`, BEFORE TRUNCATE, FOR EACH
     STATEMENT; `trg_class_action_log_append_only` is unchanged.
   - `has_table_privilege('service_role','public.class_action_log', p)` is
     false for TRIGGER, REFERENCES, TRUNCATE, MAINTAIN and true for SELECT,
     INSERT; `aclexplode(relacl)` has no PUBLIC (grantee 0) entry.
   - `pg_policies` still lists `cal_admin_read` and `cal_admin_append` with
     their 198 definitions; the `cal_admin_append` comment is present.
3. No write probes on staging: TRUNCATE/UPDATE/DELETE behaviour is covered by
   the PostgreSQL tests in T001. A teacher due-date change on QA data and the
   admin log view may be checked as a smoke test.

## Production

Only with Vinh's explicit authorization at the `staging` → `main` promotion,
as a separate step: check the ledger read-only, apply 356 under the advisory
lock and run the same read-only postcheck. No production write probes.

## Rollback and repair

- Rollback: the 356 down script drops the TRUNCATE trigger (and any function
  356 created), re-grants TRIGGER, REFERENCES and (PG 17) MAINTAIN to
  `service_role`, and clears the policy comment. TRUNCATE stays revoked
  (204). Safe at any time; no data is written.
- No data to repair: 356 changes no rows. If a legitimate operation is refused
  after apply (none is known: the backend only INSERTs and SELECTs), roll back
  356 first, then fix in a spec revision.

## Observability

- A refused TRUNCATE/UPDATE/DELETE surfaces as a `P0001` error in the caller's
  logs (FastAPI or the operator's session); there is no product path that
  issues them, so any occurrence is investigated.
- Watch after apply: `class_action_log` row inserts from due-date changes and
  returns keep arriving; an INSERT failure would show as an error in
  `class_assignment_service` logs and means roll back.
- Owner: product owner; the Leader reports T002 on the PR, SA retests
  read-only.
