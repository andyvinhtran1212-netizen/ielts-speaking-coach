# Implementation plan after approval

## Architecture impact

- Use `mock_exam_service` for per-sitting section selection, required skills and Writing task states.
- Use `mock_review_workflow` for the roster and review requirements. Keep its existing claim, grading, unique review and release protections.

## Data and contracts

- Review the three nullable audit columns proposed in [#2717](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/2717) (migration 510). A null marker retains the original requirements.
- Add admin-only `POST /admin/mock-exams/sittings/{sitting_id}/writing-not-applicable` with a required reason and concrete OpenAPI request and success response schemas. Derive frontend wire types from the generated contract. Authorize before processing retries. Serialize the eligibility check and first write against competing changes. Reconcile on both first success and retry, preserving the first actor, timestamp and reason.
- Include the marker wherever the backend reads a sitting to determine review requirements. Return `writing_not_applicable` and `writing_na_eligible` in the roster.

## UI and interaction

- Wire confirmation and canonical refetch into `admin-mock-reviews` and its model. Use the roster's eligibility, handle stale conflicts and preserve the existing learner release controls. See [UI states](ui-states.md).

## Rollout and rollback

- Approve the product spec and review migration 510 separately. Deploy readers after the nullable columns are verified. Remove the action and roll back dependent code before considering a schema reversal. See the [rollout sequence](rollout.md).

## Verification strategy

- Use route and workflow tests for authorization, eligibility, audit, concurrency, retry and explicit release. Run the roster and learner journeys on staging with synthetic data. See [requirement coverage](verification.md#requirement-coverage).
