# Staging-first release flow

## Canonical branches and environments

| Git ref | Frontend/backend environment | Data |
| --- | --- | --- |
| Feature branch | Vercel Preview → staging services | Supabase staging |
| `staging` | `staging.averlearning.com` + Railway staging | Supabase staging |
| `main` | `www.averlearning.com` + Railway production | Supabase production |

`staging` is the integration branch. `main` is the production branch and may
only receive a promotion PR whose head is the repository `staging` branch.
Do not merge the same feature independently into both branches.

## Normal release

1. Fetch origin and create the feature branch from `origin/staging`.
2. Open the feature PR with base `staging`.
3. Resolve review comments and require all applicable PR checks to be green.
4. Merge into `staging`. The push runs full backend/frontend tests, typecheck,
   OpenAPI drift, production build/route ownership, the Legacy retirement guard
   and live Staging E2E. Staging E2E also proves Vercel staging and Railway
   staging both serve the exact staging SHA against Supabase staging.
5. Do not promote a red or incomplete staging release. Fix it with another PR
   to `staging`, or rerun an infrastructure-only failure after the environment
   is healthy.
6. Once exact-SHA staging evidence is green, open one PR with head `staging`
   and base `main`. The required **Staging promotion gate** rejects any other
   source branch, a stale staging head, skipped E2E or missing/failed integrated
   checks.
7. Merge the promotion PR. Vercel/Railway production deploy from `main`; verify
   the production release marker and the affected user journey.

The merge commit created on `main` can make the branch SHAs differ even when
their deployed trees are identical. That is normal release metadata. New work
continues from `origin/staging`; do not reset one protected branch onto another.

## Database migrations

Migrations are deployed separately from Git refs:

1. Keep schema changes backward-compatible with the currently deployed code.
2. Apply the migration to Supabase staging, then merge/deploy the code to
   `staging` and verify it there.
3. Before promoting code that requires the schema, apply the same migration to
   production with the repository's advisory-locked runner.
4. Promote `staging` to `main` immediately after the production schema check.
5. Destructive cleanup is a later release only after old code no longer reads
   the retired shape.

## Emergency release

Production rollback may temporarily point Vercel at a previous deployment, but
it does not rewrite `main`. Create the repair from `staging`, validate it, and
promote it normally. Bypassing the main protection is reserved for an explicit
owner-authorized incident; record the reason and restore protection immediately.
