# Research

## Historical pre-344 state (staging, read-only)

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
- Approved [`RLSCLEANUP-0039`](../0039-rls-admin-policy-cleanup/spec.md)
  FR-001/FR-002: migration 344 drops `cal_admin_append` / `cal_admin_read`
  and revokes all anon/authenticated privileges on this table. The snapshot
  above predates that cleanup and is not the target state for 356.
- Precedent for a statement-level TRUNCATE trigger on audit tables:
  `332_staff_security_audit.sql:208-225`, `333` (`ai_budget_raise_events`).

## Usage

- PC-J347 audit on #2045 base `5d9296ec292db288d4209d14f563a38c3b352ca1`:
  `rg -n -i 'class_action_log' backend/` finds production writes only in
  `log_class_action`, `backend/services/class_assignment_service.py:479`
  (`insert`), and reads in `read_class_actions` (`:501`), called by the admin
  route `backend/routers/admin_class_assignments.py:2850`. The admin client
  uses `SUPABASE_SERVICE_KEY` (`backend/database.py:30-31`). No backend code or
  operational script UPDATEs or DELETEs this table; migration 198's commented
  UPDATE probe and trigger definition are not runtime consumers. No UPDATE or
  DELETE compatibility blocker was found. Re-run before T001; any newly found
  consumer requires stopping and reporting to PC/Leader.

## CALUD evidence and limits (SA F1/F2)

- `reviews/PR-2045.md` F1 records that the old FR-002 "keeps SELECT and INSERT"
  differed from its matrix retaining UPDATE/DELETE. Q-1403-CAL-REVOKE-UD is now
  approved: Leader báo anh Vinh duyệt 14:07 (t803u), verbatim "CALUD ok".
  FR-002/FR-004 make the final matrix SELECT and INSERT only.
- SA's local synthetic PG 17.11 probe2 (`/workspace/qa/pr2045/sa-probe2.sql`
  and `.out`, summarized in that review) shows ACCESS EXCLUSIVE LOCK succeeds
  with UPDATE/DELETE retained after MAINTAIN is removed, and fails with `42501`
  with SELECT+INSERT only. SELECT FOR UPDATE succeeds in the former case;
  its denial in the latter was not probed in those artifacts and remains
  required T001 evidence. These probes are not a deployed staging test.

## Related open work (2026-10-30)

- #2022 (PC-J262) adds `backend/tests/test_class_action_log_postgres.py`;
  #2041 (PC-J326/J336, stacked on #2022) extends it and adds the static guard
  `test_migrations_never_regrant_audit_log_truncate`. Both are open; #2041
  asserts `service_role` MAINTAIN is true, which 356 changes.

## Governance

- Migration 356 is a high-risk path (`backend/scripts/validate_specs.py`
  `HIGH_RISK_PATH_RE`), so its PR needs approved FRs on its merge base whose
  text matches; this amended spec provides FR-001..FR-004. PC-J347 changes
  intent documents only; no migration is applied and no database write or
  mutation probe is performed as part of this spec-only amendment.

## 344/356 compatibility audit

- Codex P1 `r4429549850` on #2045 identified the conflict: an unconditional
  policy comment in 356 would fail after 344, while keeping the policies or
  client SELECT privileges would contradict approved 0039. Deployment order
  is **344 then 356**; 356 makes no policy change and does not depend on
  either policy's existence. FR-003 is retained for compatibility coverage.
- At the verified job-start heads (#2045 `798d17a1c`, #2054 `69169ae2f`),
  neither migration 344 nor 356, a 356 down script, or the planned 356 test
  module exists. The addendum's conditional implementation fixes and
  fixtures-first failing migration run therefore do not apply on these
  branches. T001 must supply both real fixtures before its implementation
  fix: primary with 344 already applied, legacy control without 344.
- 0039 FR-003's service_role preservation check is safer as an in-transaction
  before/after snapshot in 344 rather than a comparison against the older
  T001 baseline, because 356 intentionally reduces service_role ACLs later.
  This alignment records that integration note without implementing 344.
