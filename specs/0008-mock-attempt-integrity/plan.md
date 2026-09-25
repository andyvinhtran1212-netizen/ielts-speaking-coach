# Implementation plan

## Architecture impact

- Keep the existing MockHook route script and native Reading/Listening players.
- Add an attach gate at player entry; do not redesign the players or orchestration.
- Add a collection preflight in the existing Mock Test service. Before the
  section closes, reject collection when a missed attachment can still use
  the normal learner attach route. During the sweep, keep the completion token
  unset while any sitting remains unsubmitted.

## Data and contracts

- Existing attach API and attempt/sitting columns remain the source of truth.
  No route shape, database column, migration, or RLS policy changes.
- The preflight reads only the configured test, learner, active status,
  nullable sitting link, and attempt start. It batches candidate reads by
  learner set and pages the result; it does not mutate candidate rows. A missing
  or malformed section start rejects a blank-paper decision, except a retake
  that never started before its assignment window closed can use the persisted
  sitting creation time as its earliest attempt boundary.
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
- If the preflight blocks collection, leave the section open so the learner can
  reload and attach normally. If a late orphan appears after the pause marker,
  keep Advance blocked; inspect and repair the exact persisted links, then
  re-sweep. Roll back code through a new staging fix and promotion; no schema
  rollback is needed.

## Verification strategy

- Backend: anomalous attempt, old standalone attempt, linked attempt, retry,
  and lookup failure.
- Frontend: Reading entry, Listening start/resume, bridge timeout, attach
  rejection, and non-mock path.
- Release: exact PR head checks, exact staging SHA and live journey, promotion
  gate, production marker and focused learner/operator smoke.
