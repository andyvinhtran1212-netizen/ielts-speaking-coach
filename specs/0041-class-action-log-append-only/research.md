# Research

## Current state (staging, read-only)

From the Security Auditor's check in `reviews/PR-2022.md` (staging
`4c9becc28`, PostgreSQL 17.6):

- `aclexplode(relacl)` on `public.class_action_log`: anon = SELECT;
  authenticated = SELECT; `service_role` = SELECT, INSERT, UPDATE, DELETE,
  REFERENCES, TRIGGER, MAINTAIN (no TRUNCATE); `postgres` = ALL; no PUBLIC
  entry; no column ACLs.
- RLS enabled (not forced). Policies `cal_admin_read` (SELECT TO
  authenticated USING `is_current_user_admin()`) and `cal_admin_append` (INSERT
  TO authenticated WITH CHECK `is_current_user_admin()`).
- Triggers: `trg_class_action_log_append_only` BEFORE DELETE OR UPDATE FOR EACH
  ROW, enabled `O`. No BEFORE TRUNCATE trigger. `fn_class_action_log_append_only`
  has `search_path = public, pg_temp`. `service_role` has `rolbypassrls = t`.
- `pg_default_acl` (schema public, tables, owner `postgres`): `service_role`
  ALL including TRUNCATE for tables created later.

## Sources of each property

- Row trigger and policies: `backend/migrations/198_class_action_log.sql`
  (#1010, 2026-08-08), before spec governance.
- TRUNCATE revoke: `backend/migrations/204_reconcile_course_and_gate_e_schema.sql:15-23`.
- Client write lockdown (anon/authenticated INSERT/UPDATE/DELETE/TRUNCATE/
  REFERENCES/TRIGGER, PG 17 MAINTAIN):
  `backend/migrations/320_client_write_privilege_lockdown.sql`; it does not
  touch `service_role`.
- Precedent for a statement-level TRUNCATE trigger on audit tables:
  `332_staff_security_audit.sql:208-225`, `333` (`ai_budget_raise_events`).

## Usage

- Backend writes: `backend/services/class_assignment_service.py:479`
  (`insert`); reads: `:501`; admin route
  `backend/routers/admin_class_assignments.py:2850`. No code, script, test or
  workflow issues TRUNCATE, UPDATE or DELETE on the table (`git grep`, staging
  `0243e4e6f`).

## Related open work (2026-10-30)

- #2022 (PC-J262) adds `backend/tests/test_class_action_log_postgres.py`;
  #2041 (PC-J326/J336, stacked on #2022) extends it and adds the static guard
  `test_migrations_never_regrant_audit_log_truncate`. Both are open; #2041
  asserts `service_role` MAINTAIN is true, which 356 changes.

## Governance

- Migration 356 is a high-risk path (`backend/scripts/validate_specs.py`
  `HIGH_RISK_PATH_RE`), so its PR needs approved FRs on its merge base whose
  text matches; this spec provides FR-001..FR-003.
