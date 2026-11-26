---
id: MOCKLRONLY-0104
title: Admins can finish review of a closed sequential mock when Writing was never offered
status: draft
risk: high
owner: product
---

# Finish a closed mock with Listening and Reading results

## Problem and scope

A learner submitted both Listening and Reading in a sequential mock. The room closed before Writing opened. The sitting still shows “Đang làm LRW”, so the reviewer cannot claim the work or release the earned results. An administrator needs a per-sitting exception with a recorded reason. Retakes use their assigned skills. Other sittings in the same room keep their original requirements.

## Requirements

- **FR-001:** Only an authenticated administrator can mark one sitting. Require a nonblank reason. Derive the actor from the session and the time from the server. Store the first decision and preserve it across retries.
- **FR-002:** For a new decision require a sequential exam, closed room, null exam Writing start time and sitting status `lrw_in_progress` or `lrw_submitted`. Refuse if the sitting has a Writing submission timestamp, either essay ID or any submitted Writing text. Each configured L/R section must have both its sitting submission timestamp and a linked submitted attempt. Return 409 when these eligibility conditions fail. Recheck at the write boundary, including concurrent submissions and room changes.
- **FR-003:** Mark Writing inapplicable only on the selected sitting. Reconcile using its configured L/R sections, create at most one review and preserve the ordinary claim, grading and release workflow. A retry on an already marked sitting recovers interrupted reconciliation without changing the audit fields or issuing another release.
- **FR-004:** The roster exposes canonical eligibility and marked state. Admins see the action only for eligible rows without a review, confirm with a reason and see refreshed server state. The marked Writing cell reads “Không áp dụng”. The review requires final bands only for configured L/R, supplies no Writing tasks or fabricated Writing score, and retains existing release permission and duplicate-release protection.
- **FR-005:** Marking alone never publishes results. Access before and after explicit release follows the existing learner result policy. Operational logs record the sitting and administrator IDs, without names, scores or reason text.

## Acceptance scenarios

Given a closed sequential room with both configured L/R attempts submitted and Writing never opened, confirming one sitting enables a single review. A reviewer can claim it, record the L/R bands and an administrator can release them explicitly. A second learner in the same room still requires Writing. Given an open room, retake, started Writing or missing submitted attempt, a direct request is rejected and the original sitting is preserved. Two simultaneous confirmations yield one original decision and one review.

## Open question

If a sequential room has neither Listening nor Reading configured, the handoff does not define a releasable result. Proposed rule for product approval is to refuse this exception when no L/R skill is configured.
