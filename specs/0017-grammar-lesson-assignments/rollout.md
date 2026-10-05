# Rollout and rollback

## Preconditions

- Approved spec on `staging`, reviewed practice material for at least one Bxx,
  distinct practice source, additive schema if required, runtime flag default off.
- Confirm concurrent Grammar quiz revision PR has not changed an assumed API or
  data contract; resolve any dependency before implementation merge.

## Staging

- Apply additive migration through the normal runner before dependent code.
- Import and validate reviewed practice content without serving diagnostic or
  reserved items. Deploy exact SHA with flag off, run focused/full suites and live
  assignment-to-result E2E, then enable for a controlled Course 5 cohort.
- Verify single-recipient visibility, repeat assignment history, immediate and
  reload truth, and zero diagnostic exposure events from lesson practice.

## Production

- Obtain release authorization, apply production migration/content through
  the advisory-locked runner, then promote the exact verified staging SHA.
- Enable the flag only after a controlled read-only readiness check and verify
  one real assignment/result without changing existing learner history.

## Rollback and repair

- Disable only the new lesson-assignment path; do not delete assignments,
  attempts or historical content revisions. Keep schema compatible with the
  previous deployed API. Restore code via staging-first promotion if required.
- Reconcile incomplete ledger items against persisted attempts; do not infer
  completion from a client event or rewrite completed answers.

## Observability

- Log assignment ID, item ID, lesson ID, revision and stable error code without
  learner answers. Track catalog blocked reasons, failed starts/submissions and
  ledger reconciliation failures. Review during controlled rollout.
