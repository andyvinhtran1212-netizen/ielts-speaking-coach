# Implementation plan

## Architecture impact

Reuse the published Listening drill record and the class assignment ledger. Extend the listening and dictation players with assignment context while preserving the public entry points.

## Data and contracts

A class assignment stores the dictation policy and section identifiers. Listening and dictation results are scoped by the assignment item. The browser records bounded cumulative checkpoints per player instance. The service role upserts those checkpoints monotonically. Persisted dictation results provide the original reference, learner text and versioned grading evidence.

## UI and interaction

The assignment picker includes a Skill Drills library and a dictation requirement checkbox. The learner can resume the remaining part through My Class. Admin sees both audio totals and the section reports in class submissions.

## Rollout and rollback

Reserve the migration number in the shared register and deploy the additive schema to staging before activating the feature code. Preserve stored assignment and dictation evidence during rollback. For any rollback after assignments exist, retain the scope-aware dictation reads so class records remain separate from public attempts.

## Verification strategy

Verify catalog and class policy, attempt isolation, progress transitions, score and playback readback, then run the two-course staging journey on matching frontend and backend releases.
