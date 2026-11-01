# Rollout and rollback

## Preconditions

- VOCABGUARD-0040 approved on `staging`; T001 merged.
- Migrations 234 and 235 are applied in the target environment (355 replaces
  their functions); check the ledger read-only before apply.

## Staging

1. The Leader applies 355 with the advisory-locked runner, respecting
   STAGING_FREEZE.
2. Read-only postcheck: `pg_get_functiondef` of both functions matches 355
   and both triggers still reference them.
3. No staging write probes are needed; the behaviour is covered by the
   PostgreSQL tests in T001.

## Production

Only with Vinh's explicit authorization at the `staging` → `main` promotion:
apply 355 under the advisory lock and run the same read-only postcheck.

## Rollback and repair

- Rollback: the 355 down script restores the 234/235 function bodies. Safe at
  any time; it writes no data.
- No data to repair: 355 changes no rows. If an admin edit of a draft child is
  wrongly refused after apply, roll back 355 first, then fix in a spec
  revision.

## Observability

- Admin curated vocabulary edits that hit the guard return the existing
  `published_vocab_review_is_immutable` / `published_vocab_task_is_immutable`
  error in the FastAPI logs; a rise on draft-only edits means roll back.
- Owner: product owner; the Leader reports T002 on the PR.
