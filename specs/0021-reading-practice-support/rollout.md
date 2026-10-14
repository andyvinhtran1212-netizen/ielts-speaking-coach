# Rollout and rollback

## Preconditions

Separate spec approval lands on staging before feature/grading implementation.
User approval is required for every external API action not already within the
read-only grant. There are no paid provider calls or schema migrations. Preserve
the active Vocabulary release and worktree; do not move staging during its
exact-SHA promotion without a safe sequencing decision.

## Staging

Run local backend, frontend and native fixture journeys first. Prepare concrete
scoped code/content diffs, then obtain write permission. Use the existing staging
release workflow and verify exact code SHA, content fields, IDs and library/check
journeys. Do not import via a browser or delete/reinsert questions for support.

## Production

Only a separately user-approved staging-to-main promotion and bounded canonical
content operation can affect production. Keep exact-SHA gates and read-after
verification. Report deployed and live acceptance separately from local work.

## Rollback and repair

Revert only this feature's code or restore only its content fields under fresh
revision checks. Never clear learner history or overwrite another editor's later
work. Existing fields/clients remain compatible; stale support fails closed and
falls back to the current paragraph or full translation, without attaching old text.

## Observability

Use existing safe request errors, release checks and content operation evidence.
Record failing source/translation identities without tokens or learner data.
The single Reading agent owns reconciliation of findings R01–R10. No new telemetry
platform, monitoring service or provider-budget feature is introduced.
