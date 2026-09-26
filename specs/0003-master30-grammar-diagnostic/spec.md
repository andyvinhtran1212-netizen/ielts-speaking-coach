---
id: MASTER30-0003
title: MASTER30 Grammar Diagnostic and Adaptive Review
status: implementing
risk: high
owner: product
---

# MASTER30 Grammar Diagnostic and Adaptive Review

## Problem

The approved MASTER30 package contains 30 lessons and a large objective item
matrix, but Aver Learning has no assignment-only diagnostic that selects a
bounded, balanced subset, scores it safely on the server, and turns the result
into a useful review route for learners and educators. Productive items cannot
be trusted to automatic scoring yet and must not delay the objective release.

## Scope

- Ship an admin-assigned beta reachable from My Class.
- Offer Quick and Full objective diagnostics with adaptive focused checks.
- Persist immutable exposure, responses, completion, and educator reports.
- Import the approved MASTER30 package as a checksum-bound release.
- Keep productive tasks available only as separately assigned teacher-reviewed
  material, with automatic scoring disabled.

## Non-goals

- Public self-enrolment or public catalog discovery in this release.
- IELTS band conversion, psychometric claims, live calibration, or AI scoring.
- Default learner submission or grading of productive tasks.
- Replacing the existing teacher-assignment and marking workflow.

## Users and journeys

- An admin assigns a Quick or Full diagnostic to a class or selected learners.
- An assigned learner completes a baseline and focused confirmation set, then
  receives an immediate Grammar Readiness Profile and bounded review routes.
- An educator opens the immutable learner report from the class workspace.

## Requirements

- **FR-001:** Only an actively assigned learner can create, resume, answer, or
  read a diagnostic session; every operation rechecks active cohort membership,
  assignment ownership, publication state, and deadline, while public self-serve
  remains controlled by a separate default-off runtime flag.
- **FR-002:** Quick mode serves exactly 18 baseline plus 10 focused objective
  questions, and Full mode serves exactly 34 baseline plus 20 focused objective
  questions; selection is server-owned, history-aware, and capped at six exposed
  items per MASTER30 lesson M01-M14.
- **FR-003:** Objective responses are server-scored without sending answer keys
  before submission; repeated requests are idempotent, conflicting immutable
  responses fail closed, and completion cannot occur with missing responses.
- **FR-004:** Finalization atomically creates one immutable learner report with
  readiness priorities, evidence, and review routes; learner and admin reloads
  read the same persisted report and the class ledger keeps score null.
- **FR-005:** Productive tasks are imported with provenance but are excluded from
  diagnostic selection and automatic scoring; they can be graded only when a
  teacher separately assigns them through the existing marking workflow.
- **FR-006:** The canonical release validates 30 lessons, 733 runtime objective
  items, 3,338 matrix rows, 19 productive tasks, 16 review routes, and 14
  misconception definitions against manifest SHA-256
  `86a55dc1c3a8e5221eef9daa4772404f358ebb8f87c1284224e5197f58dbe531`.
- **FR-007:** Additive schema, RLS, immutable exposure/report guards, release
  promotion, and session finalization are idempotent and safe for staging-first
  rollout; a validated retired release can be promoted again for rollback.
- **FR-008:** Learner and educator surfaces follow the Aver design system and
  expose honest loading, empty, permission, retry, in-progress, and completed
  states without psychometric or IELTS-band claims.

## Acceptance scenarios

### Assigned Quick diagnostic

- **Given** an active published assignment and the feature flag enabled
- **When** the learner completes 18 baseline and 10 focused objective items
- **Then** one immutable readiness report is available to the learner and admin,
  and the assignment remains explicitly ungraded.

### Access revoked during a session

- **Given** a learner has an in-progress assigned session
- **When** cohort membership ends before the next read or mutation
- **Then** the operation returns the stable unavailable response and persists no
  additional exposure, response, or report.

### Productive content boundary

- **Given** productive tasks exist in the imported release
- **When** a learner starts either diagnostic mode
- **Then** no productive task is selected, submitted, or automatically scored.

## Edge cases

- Concurrent session creation converges on one open session per assignment and mode.
- Lost-response retries return canonical state without selecting replacement items.
- A stale or cross-session item ID cannot be answered.
- Release rollback keeps old reports readable and never mutates their snapshots.
- Flag-off behavior fails closed before protected diagnostic content is returned.

## Success criteria

- Exact package counts and checksum validate in staging and production.
- All required CI, migration, authorization, idempotency, and UI contract tests pass.
- One assigned staging journey produces the same learner/admin report after reload.
- Production launches assigned-only with self-serve and productive auto-scoring off.

## Open questions

- Psychometric calibration thresholds and any trusted productive scorer require a
  later, separately approved spec backed by live evidence.
