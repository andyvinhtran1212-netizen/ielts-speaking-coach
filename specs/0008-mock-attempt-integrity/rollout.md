# Rollout and rollback

## Preconditions

- Approved spec is present on staging before the implementation PR is rebased.
- Existing attach route and attempt/sitting schema are deployed; no migration
  is required.

## Staging

- Merge the implementation to staging only after local full suites, PR review,
  and every applicable PR check pass on its exact head.
- Verify integrated CI and live Staging E2E on the exact resulting staging SHA.
  Exercise Reading and Listening start/resume plus a collection anomaly.

## Production

- Open a separate PR from staging to main. Require the Staging promotion gate
  to match the unchanged staging SHA and its completed live E2E evidence.
- After merge, verify the production release marker and a focused Mock Test
  Reading/Listening journey without changing live learner data.

## Rollback and repair

- Repair a known orphan only after comparing sitting, learner, configured test,
  section window, attempt status, and answers. Do not batch-link by test ID.
- A failed sweep remains retriable. Reverting code requires a new staging fix
  and gated promotion; no schema rollback is involved.

## Observability

- Watch scoped `[mock-exam]` logs for unlinked active attempt IDs and sweep
  preflight failures, plus attach-route errors. The release owner investigates
  any candidate before resolving a sitting; no automatic data repair runs.
