---
id: WRITINGBAND-0050
title: Saving reviewed Writing criteria keeps the total and feedback consistent
status: approved
risk: high
owner: product
---

# Canonical Writing band after review

## Problem

The admin criteria editor changes four criterion scores but leaves the old
`overallBandScore`. The save route persists that old total, so reviewed essays
can display corrected criteria with contradictory overall and trajectory bands.
The owner approved repairing, testing and deploying this bounded fix on
2026-11-08; see approval-decision.md. This spec lands before implementation.

## Scope

Existing admin Writing feedback saves, composed-version score persistence, and
canonical UI refresh after save. No schema or model change is needed.

## Non-goals

No AI regrade, new grading policy, bulk rewrite, retrospective source-version
changes, unrelated feedback edits, permission changes or automatic delivery.
The six pending learner submissions are a separate authorized operational step.

## Requirements

- **FR-001:** Saving feedback computes the overall from the four validated criterion scores using the existing backend half-up-to-0.5 rule, including 6.25 to 6.5 and 6.75 to 7.0; a stale client total cannot override it.
- **FR-002:** Saving an otherwise unchanged stale reviewed record repairs its current composed feedback and total; repeating the repaired save does not create another version. Immutable AI source versions and instructor notes remain unchanged.
- **FR-003:** Persisted overallBandScore, overall_band_score, trajectory current band and attained-score narrative agree, preserving unrelated qualitative feedback through the existing band alignment helper.
- **FR-004:** After save, the admin displays freshly read canonical feedback and total. A failed refresh is visibly distinguished from a failed write and cannot enable delivery or next-item navigation on unverified state.
- **FR-005:** Existing authorization, graded/reviewed state restrictions, composed-version budget and review-before-delivery behavior remain enforced. No save implicitly delivers work.

## Acceptance scenarios

Given corrected criteria 7/6/6/6 with stale total 6, saving yields 6.5 in the
current database row, feedback JSON, trajectory and refreshed UI. Reload agrees.
A second save has no content change or extra version. Given a failed canonical
refresh after a successful write, the user sees a recoverable refresh error and
cannot deliver or navigate to the next essay on the stale workspace.

## Edge cases

Reject invalid criterion values through the existing schema. Reconcile retries
using current persisted feedback; no extra slot on composed updates. Keep
existing permission and status failures visible. Do not silently overwrite edits
made while a save/refetch is pending. Old clients remain accepted, but their
stale totals are normalized server-side. Existing concurrency controls and
version limits are retained; no new last-writer semantics are introduced.

## Success criteria

Regression tests cover FR-001 through FR-005, complete affected local suites and
exact-SHA staging gates pass, then production markers and the affected journey
are verified before any learner return.

## Open questions

None within the owner-approved scope.
