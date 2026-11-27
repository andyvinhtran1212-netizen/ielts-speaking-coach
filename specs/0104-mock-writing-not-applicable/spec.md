---
id: MOCKLRONLY-0104
title: Admins can finish review of a closed sequential mock when Writing was never offered
status: draft
risk: high
owner: product
---

# Finish a closed mock with Listening and Reading results

## Problem

A learner submitted both Listening and Reading in a sequential mock. The room closed before Writing opened. The sitting still shows “Đang làm LRW”, so the reviewer cannot claim the work or release the earned results. An administrator needs a per-sitting exception with a recorded reason.

## Scope

- Record the exception on one eligible sequential sitting and let the existing review and release process handle its completed Listening and Reading sections.

## Non-goals

- Changing the exam configuration, reopening the room, or modifying another sitting's requirements.
- Modifying a retake's assigned skills or creating a Writing task or score for the marked sitting.

## Users and journeys

- An administrator marks an eligible sitting from the roster. A reviewer claims it and grades the required sections. An administrator explicitly releases the results to the learner.

## Requirements

- **FR-001:** Only an authenticated administrator can mark one sitting. Require a nonblank reason. Derive the actor from the session and the time from the server. Store the first decision and preserve it across retries.
- **FR-002:** For a new decision require a sequential exam, closed room, null exam Writing start time and sitting status `lrw_in_progress` or `lrw_submitted`. Refuse if the sitting has a Writing submission timestamp, either essay ID or any submitted Writing text. Require at least one configured section among Listening and Reading. Each configured L/R section must have both its sitting submission timestamp and a linked submitted attempt. Return 409 when these eligibility conditions fail. Recheck at the write boundary, including concurrent submissions and room changes.
- **FR-003:** Mark Writing inapplicable only on the selected sitting. Reconcile using its configured L/R sections, create at most one review and preserve the ordinary claim, grading and release workflow. A retry on an already marked sitting recovers interrupted reconciliation without changing the audit fields or issuing another release.
- **FR-004:** The roster exposes canonical eligibility and marked state. Admins see the action only for eligible rows without a review, confirm with a reason and see refreshed server state. The marked Writing cell reads “Không áp dụng”. The review requires final bands only for configured L/R, supplies no Writing tasks or fabricated Writing score, and retains existing release permission and duplicate-release protection.
- **FR-005:** Marking alone never publishes results. Access before and after explicit release follows the existing learner result policy. Operational logs record the sitting and administrator IDs, without names, scores or reason text.

## Acceptance scenarios

Given a closed sequential room with both configured L/R attempts submitted and Writing never opened, confirming one sitting enables a single review. A reviewer can claim it, record the L/R bands and an administrator can release them explicitly. A second learner in the same room still requires Writing. Given an open room, retake, started Writing or missing submitted attempt, a direct request is rejected and the original sitting is preserved. A room offering only Listening or only Reading follows the same rule for its one configured section. A room offering neither receives a 409, with the sitting unchanged and no review created. Two simultaneous confirmations yield one original decision and one review.

## Success criteria

- One eligible sitting has one recorded decision and one review for its configured L/R skills, including after retry or concurrent confirmation.
- The learner sees only their earned L/R results after explicit release. The sibling sitting and retake preserve their original required skills.

## Open questions

Resolved by Andy on 27 November 2026. The exception requires at least one configured L/R section, submission of every configured L/R section, and a closed room in which Writing never started. An administrator must explicitly release the results. This decision covers the eligibility rule. Migration 510 requires separate approval.
