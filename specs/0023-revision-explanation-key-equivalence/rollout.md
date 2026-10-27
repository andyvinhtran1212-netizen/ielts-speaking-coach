# Rollout and rollback

## Preconditions

This spec is approved on staging; the binder PR is green with Codex review
finished. No migration. Other sessions' work on the binder or
`web_explanation_objects` is checked before each run.

## Staging

1. Merge the binder PR to staging.
2. Rehearse on `QA-CAM19-20261024-{LIS-CAM-B19-T2,T3,T4,RDG-CAM-B19-T2}-REV01`:
   dry run, commit, read-back, and build the overlaid runtime key for the
   override questions to confirm the union.

## Production

1. Dry-run each of the 35 refused Cambridge papers with the staging-merged
   binder (exact commit recorded).
2. Owner reviews each paper's changed questions, synced forms and grading
   changes on a review page that also shows each synced question's
   `answer_summary` and `marking_note`, so visible text that contradicts a form
   the REV marks right is caught before commit.
3. Commit only approved papers with their reviewed plan SHA and lists; read
   back; record evidence in this spec.

## Rollback and repair

- A bound revision with no give or attempt referencing it: set its rows
  `is_current = false` after owner approval, which also removes its override
  overlay. Rows used by a give or attempt stay; fix forward with a reviewed new
  binding. Source rows and learner history are never changed.

## Observability

- Each run prints the plan SHA, per-question classification, import batch and
  read-back counts, recorded in this spec's evidence.
