# Implementation plan

## Architecture impact

- Reuse `class_assignments` and `class_assignment_items` for ownership, scope,
  deadlines and the canonical My Class ledger. Distinguish lesson assignments
  from existing Grammar Diagnostic assignments in an explicit persisted subtype.
- Keep the MASTER30 diagnostic service and its item selection unchanged.
- Serve lesson catalog/readiness and learner practice through authenticated
  FastAPI routes. Keep server-owned answer keys and completion decisions.
- Use a separate, reviewed practice content source; a lesson with only metadata
  or reserved diagnostic items is blocked until practice material exists.

## Data and contracts

- Store an immutable lesson/content revision on each assignment, with one
  attempt linked to each recipient item. Preserve old attempts when a lesson is
  assigned again. Add only schema needed beyond the current ledger.
- Define concrete OpenAPI request and response models for catalog, start,
  progress, submit, result and teacher read. Generate frontend wire types.
- Enforce class membership and assignment ownership on every learner read/write.
  Use atomic/idempotent create and submit boundaries and explicit deadline checks.
- Keep current diagnostic and course assignment payloads backward compatible.

## UI and interaction

- Extend the existing class homework dialog with a Grammar lesson choice and
  truthful readiness/blocked reasons; retain group and single-student selection.
- Route an assigned lesson from My Class to a focused Bxx learning and practice
  page; show persisted feedback and a revisit view after completion.
- Show canonical per-learner results in class submissions. Implement all states
  in `ui-states.md` using shared tokens and keyboard/focus patterns.

## Work decomposition

- Sequence content readiness and data contracts before changing the admin catalog.
- Keep edits to class homework, My Class, lesson player and backend services
  scoped in a dedicated worktree. Avoid quiz-engine files owned by the concurrent
  Grammar bank revision PR unless integration requires a reviewed dependency.
- Import only reviewed practice content for priority lessons; blocked lessons
  remain visible with reasons. Authoring all 30 is separate content work.

## Rollout and rollback

- Stage any additive migration and content with lesson assignments disabled,
  verify exact-SHA backend and frontend behavior, then enable the new path.
- Roll back the feature flag/code without erasing assignment or attempt history.
  Keep older deployed readers compatible with new subtype rows.

## Verification strategy

- Test single-recipient scope, repeated Bxx history, idempotent retries,
  membership/deadline gates, answer secrecy, immutable revision and no exposure
  of diagnostic items. Verify My Class and teacher state after full reload.
- Run relevant backend and frontend suites, generated API contract checks,
  browser keyboard/theme/mobile journeys and staging live E2E on exact SHA.
