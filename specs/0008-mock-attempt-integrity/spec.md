---
id: MOCKATTACH-0008
title: Mock Reading and Listening attempt integrity
status: implementing
risk: high
owner: product
---

# Mock Reading and Listening attempt integrity

## Problem

A native Reading or Listening player can create a domain attempt before the
Mock Test route script installs its attach bridge. A one-time optional lookup
then skips the link to the mock sitting, while answer saves still succeed.
At section collection, the sitting appears to have no paper and can be stamped
as a blank submission despite recoverable answers on the unlinked attempt.

## Scope

- Require successful mock attachment before an attempt becomes usable in the
  native Reading or Listening player, including Listening start and resume.
- Keep a sitting recoverable when the section sweep sees an active, unlinked
  attempt for its learner and configured test in the current section window.
- Preserve genuine blank-paper collection and existing non-mock behavior.

## Non-goals

- No new grading, score, section-clock, assignment, or result-release policy.
- No automatic relinking of ambiguous legacy attempts during a timer sweep.
- No database migration or new persistence store.

## Users and journeys

- A learner entering a mock Reading or Listening section can answer only after
  the domain attempt belongs to the current sitting.
- A learner whose bridge or attach request fails sees an error and can reload
  or retry the existing attempt without being shown a usable unlinked paper.
- An operator can investigate an anomalous unlinked attempt while the sitting
  remains unsubmitted instead of seeing a false blank paper.

## Requirements

- **FR-001:** In a mock sitting, native Reading and Listening start/resume
  waits for the route bridge and successful attach of the created or resumed
  domain attempt before exposing the attempt for answering or autosave. Bridge
  timeout or attach failure is visible and does not expose an unlinked attempt.
  Non-mock starts retain their existing path.
- **FR-002:** Before collecting an unlinked Reading or Listening paper as
  blank, the backend checks for an active attempt for the same learner and
  configured test that began in the current section window. If one exists,
  collection leaves the sitting unsubmitted, preserves its answers, and logs
  the attempt and sitting IDs for scoped operator repair. Lookup failure also
  leaves the sitting unsubmitted. The sweep does not guess a cross-table link.
- **FR-003:** A linked attempt is collected through the existing path; a
  sitting with no qualifying attempt can still be collected as a genuine
  blank paper. Repeated collection must not duplicate submission or grading.

## Acceptance scenarios

### Mock player starts before the bridge

- **Given** the Reading or Listening domain attempt exists and MockHook has
  not loaded
- **When** the native player enters or resumes the attempt
- **Then** answering remains unavailable until attach succeeds; a timeout or
  rejected attach shows an error and keeps the saved attempt recoverable.

### An orphaned attempt reaches collection

- **Given** a sitting has no linked Reading/Listening attempt but has an
  in-progress attempt for the same learner and test, started after the current
  section opened, with persisted answers
- **When** the section sweep runs
- **Then** it does not stamp the section submitted or discard the attempt,
  and it records a scoped anomaly for repair.

### A paper is genuinely blank

- **Given** there is no qualifying attempt, or only an old standalone attempt
  from before the section opened
- **When** collection runs
- **Then** the existing blank-paper submission behavior remains available.

## Edge cases

- Retake uses the sitting's section start; a sequential exam uses the exam's
  section start. A never-started retake whose assignment window has closed
  uses the sitting's creation time as the earliest possible attempt boundary.
  A malformed clock, missing fallback anchor, or failed attempt lookup blocks
  a destructive blank-paper decision and is logged.
- A failed attach can race the sweep. The sweep must not infer completion from
  a client-side start; the persisted link and attempt rows are authoritative.
- A later ordinary attempt for the same test may need operator disambiguation;
  the sweep favors recoverability and logs the candidate instead of linking it.

## Success criteria

- Tests prove attach precedes attempt exposure for both players and both
  Listening entry paths.
- Backend tests prove anomalous attempts stay recoverable and old standalone
  attempts do not block genuine blank collection.
- Exact-SHA staging CI and live Mock Test journey pass before promotion.

## Open questions

- None for this scoped repair. An operator reviews any historical orphan before
  manually linking or resolving it.

Approval record: the product owner requested merging and promoting the scoped
repairs in PR #1519 on 2026-09-25. This specification records that behavior
before the implementation branch is rebased for release.

Amendment approval record: the same owner instruction covers the review-required
retake expiry repair. The closed-window creation-time boundary is approved here
before its implementation is rebased for release.
