# Staging-first release flow

## Canonical branches and environments

| Git ref | Frontend/backend environment | Data |
| --- | --- | --- |
| Feature branch | Vercel Preview (opt-in `[preview]`, see [AGENT_WORKFLOW.md](AGENT_WORKFLOW.md)) → staging services | Supabase staging |
| `staging` | `staging.averlearning.com` + Railway staging | Supabase staging |
| `main` | `www.averlearning.com` + Railway production | Supabase production |

`staging` is the integration branch. `main` is the production branch and may
only receive a promotion PR whose head is the repository `staging` branch or a
pinned release cut `release/<sha>` (see "Pinned release cut" below). Do not
merge the same feature independently into both branches.

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

## Pinned release cut (cadence approved 25/11/2026)

Daily staging lots keep moving `staging`, so a scheduled promotion (Tuesday and
Friday) is cut from a fixed commit instead of the moving branch:

1. Pick a commit `S` that was a staging tip and has green exact-SHA staging
   evidence (all integrated push checks and a live Staging release smoke that
   really ran, not one that finished as superseded).
2. Push `release/<S>` from this repository, naming the commit (7 to 40 lower-case
   hex characters; the head must start with that prefix). Never move the branch.
3. Open the promotion PR with head `release/<S>` and base `main`. The **Staging
   promotion gate** checks that the name pins the head, that `S` is contained in
   `staging`, that the branch does not move while the gate waits, and that every
   integrated staging push run for `S` passed. `Spec and PR metadata` treats this
   PR like a `staging` promotion.
   For every promotion head the gate also merges `S` into current `main` with
   `git merge-tree` and requires the result to be exactly `S`'s tree. A hotfix
   that main has on its own (not already in `S` with the same content) or a
   conflict fails the gate: bring that change into staging, cut a new release
   and verify staging again. A hotfix with identical content (other SHA, same
   tree, like #2674 under #2672) passes.
4. Any other `release/...` name (for example `release/<sha>-hotfix-N`) is not a
   promotion head: it is validated and gated like a normal PR.

The merge commit created on `main` can make the branch SHAs differ even when
their deployed trees are identical. That is normal release metadata. New work
continues from `origin/staging`; do not reset one protected branch onto another.

An older staging smoke may finish with a `superseded by <SHA>` notice and step
summary when the refreshed staging head contains its source commit and both
serving releases are newer descendants on that same staging history. If this
happens while waiting for deployment, the old run skips its grammar/browser
smoke. Supersession leaves exact-release evidence `ok: false`; it cannot replace
the current head's full smoke. The latest SHA, rollbacks, unrelated deployments
and unavailable ancestry still fail exact-release verification. Browser failures
already recorded remain failures even if deployment changes before final
verification.

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
