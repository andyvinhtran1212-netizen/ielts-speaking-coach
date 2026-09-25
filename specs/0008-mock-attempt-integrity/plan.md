# Implementation plan

## Architecture impact

- Keep the existing MockHook route script and native Reading/Listening players.
- Add an attach gate at player entry; do not redesign the players or orchestration.
- Add a collection preflight in the existing Mock Test service.

## Data and contracts

- Existing attach API and attempt/sitting columns remain the source of truth.
  No route shape, database column, migration, or RLS policy changes.
- The preflight reads only the configured test, learner, active status,
  nullable sitting link, and attempt start. It does not mutate candidate rows.
- Existing deployed clients remain compatible. Backend protection is additive;
  new clients wait for attachment before showing an attempt.

## UI and interaction

- Mock entry waits for the bridge and attach request. Failure uses the existing
  player error state and leaves the attempt hidden; reload can resume it.
- Non-mock entry stays unchanged. Keyboard, responsive layout, both themes,
  and focus behavior remain in their existing player surfaces.

## Work decomposition

- Land this approved spec on staging before rebasing the code PR.
- Gate both native players, add the backend preflight, then verify the combined
  contract with service and player tests.
- Review the affected backend/frontend contract and run the full local suites
  before the implementation PR is ready.

## Rollout and rollback

- Merge the code only to staging, verify exact-SHA integrated CI and live E2E,
  then use a staging-to-main promotion PR.
- If the new guard blocks collection, keep the sitting recoverable and inspect
  its candidate attempt. Roll back code through a new staging fix and promotion;
  no schema rollback is needed.

## Verification strategy

- Backend: anomalous attempt, old standalone attempt, linked attempt, retry,
  and lookup failure.
- Frontend: Reading entry, Listening start/resume, bridge timeout, attach
  rejection, and non-mock path.
- Release: exact PR head checks, exact staging SHA and live journey, promotion
  gate, production marker and focused learner/operator smoke.
