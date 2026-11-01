# Rollout and rollback

## Preconditions

- RLSCLEANUP-0039 approved on `staging`.
- Migration 320 applied (F14 closed: on staging and production).
- No open PR or job uses migration 344 (Leader reservation, 2026-10-29 14:53).
- No long transaction on the 21 tables: each `DROP POLICY` / `REVOKE` takes a
  brief lock under `lock_timeout`; on timeout re-run off-peak (the file is
  re-runnable).

## Staging

1. The Leader applies 344 with the advisory-locked runner.
2. Re-run the T001 queries read-only (`research.md`): 0 function-calling
   policies, 0 BL-11 policies, no `anon`/`authenticated` entry in `relacl` of
   the 21 tables, 21 × `relrowsecurity = true`, and `service_role` entries
   equal to the T001 baseline.
3. Security Auditor JWT probe (T004). No backend deploy is needed.

## Production

With the owner's explicit authorization at the `staging` → `main` promotion:
take a read-only `relacl` / `pg_policies` snapshot, apply 344 under the
advisory lock, then run the catalog postconditions read-only. No production
write probes.

## Rollback and repair

- Rollback: the guarded down script in the 344 header recreates the dropped
  policies. It never grants a table privilege and never re-grants EXECUTE on
  either helper, so it cannot reopen client access. No data to repair.
- If a hidden direct JWT reader breaks (not expected: none found), restore
  access through a backend route, not by re-granting the table.

## Observability

- Supabase API logs: 401/403 on `/rest/v1/<one of the 21 tables>` with a
  learner or instructor JWT is expected; any FastAPI 500 on an admin page that
  mentions `permission denied` is a regression (none expected, FastAPI uses
  `service_role`).
- Owner: product owner; the implementing agent reports T003/T004 on the PR.
