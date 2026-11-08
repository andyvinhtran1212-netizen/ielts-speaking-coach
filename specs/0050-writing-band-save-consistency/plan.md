# Implementation plan

## Architecture impact

Normalize the validated feedback before the admin route compares it to current
feedback. Reuse the same deterministic calculation at composed persistence.
Refresh the existing React workspace from the detail endpoint after saving.

## Data and contracts

No schema migration or wire-shape change. Existing full-feedback PATCH clients
remain valid. Preserve current-version ownership, AI source immutability,
instructor notes, authorization and state guards. The existing alignment helper
updates only overall-score-dependent summary and trajectory claims.

## UI and interaction

Retain existing controls, styling, keyboard access, focus and responsive layout.
Block conflicting actions while save/refetch is pending. Surface a distinct
saved-but-refresh-failed state, with reload/retry recovery before delivery.

## Rollout and rollback

Follow rollout.md; no direct database writes or provider calls.

## Verification strategy

Backend route and composed-version regression tests; React save/refetch/error
interactions; frontend contracts, typechecks, build and affected browser journey.
Full backend/frontend suites, spec validator, exact staging checks and production
release markers precede operational record verification.
