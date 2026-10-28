# Rollout and rollback

## Preconditions

- INACTIVEWRITE-0035 approved on `staging`.
- Migration 320 applied (335 aborts with `migration_320_missing` otherwise).
- No long transaction on the six tables: each `CREATE POLICY` takes a brief
  `ACCESS EXCLUSIVE` lock under `lock_timeout = 5s`; on timeout re-run
  off-peak (the file is re-runnable).
- Ledger order: 335 may land before 332–334; the runner applies unapplied files
  regardless of order.

## Staging

1. When staging is unfrozen, apply 335 with the advisory-locked runner.
2. Run the read-only catalog query in the 335 header (zero rows).
3. REST probe: inactive QA JWT `POST /rest/v1/user_vocabulary` → 403; active QA
   JWT → 201, then delete the probe row. No backend deploy is needed.

## Production

With the owner's explicit authorization at the `staging` → `main` promotion:
apply 335 under the advisory lock, then run the catalog query read-only. No
production write probes.

## Rollback and repair

- Rollback: the forward migration in the 335 header (drop the 18
  `require_active_account_*` policies, then the helper). Safe at any time; it
  only reopens SEC-20261028-02. No data to repair.
- If an active learner's write is wrongly refused (e.g. `users` ownership or
  RLS changed so the helper cannot see the row), the postcondition would have
  failed at apply; otherwise roll back and investigate.

## Observability

- FastAPI logs: any Vocabulary/flashcard 500 mentioning `row-level security`
  for an active learner is a regression (none expected).
- Supabase API logs: 403 on `/rest/v1/user_vocabulary` and the flashcard
  tables from inactive accounts.
- Owner: product owner; the implementing agent reports T004 on the PR.
