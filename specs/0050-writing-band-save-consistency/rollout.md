# Rollout and repair

## Preconditions

Owner approval recorded; spec approved on staging before code implementation.
No migration, secrets, new persistent access or provider changes are involved.

## Staging

Use an isolated origin/staging worktree. Run focused then full affected suites.
Merge a reviewed implementation PR to staging only after required checks pass.
Require integrated CI and live Staging E2E for that exact staging SHA.

## Production

Promote staging to main through the required promotion gate. Verify frontend
and backend release SHAs. The parent operational task then opens each of the
six already-reviewed essays, verifies criterion values, saves, reloads, checks
total/trajectory consistency and returns it only after those checks agree.

## Rollback and repair

A normal rollback must preserve already-corrected records and immutable AI
versions. Pause delivery if markers or scores disagree. Existing reviewed
records are repaired by explicit normal save after deployment, never bulk SQL
or AI regrading. Repeated save after repair is content-idempotent.

## Observability

Record PR/head/staging/main and deployment SHAs, test counts, skips and live
journey evidence in verification.md or the PR. Existing errors stay visible;
refresh failure must not be misreported as a failed write or successful review.
