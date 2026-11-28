# Verification

All checks below are planned for implementation. Runtime acceptance will be recorded on the implementation PR.

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | Route tests reject anonymous, learner and non-admin calls without changes. Reject blank and whitespace reasons. Confirm that the first successful write records the authenticated actor, server time and reason and that a retry preserves them. | PENDING |
| FR-002 | Exercise each refusal independently: retake, open room, Writing started, invalid status, Writing submitted, either essay ID, Writing text, missing L/R timestamp, missing or non-submitted linked attempt. Verify that a refusal leaves the sitting and review unchanged. Test Listening only, Reading only and both skills with complete submissions. With neither skill configured, assert HTTP 409, an unchanged sitting and no review. With both skills configured and just one submitted, assert the same refusal. Race marking against a concurrent eligibility change. | PENDING |
| FR-003 | Race two admin confirmations and retry after marking but before review creation. Assert exactly one review with the configured L/R requirements. Claim and grade the marked review and compare a sibling sitting and retake with their original state. | PENDING |
| FR-004 | In the admin roster exercise cancel, blank reason, confirm, stale conflict, failed request, failed refresh and retry. Reload the row and compare its marker, review state, required bands and empty Writing task list with canonical state. | PENDING |
| FR-005 | Use a synthetic learner before marking, after marking and after explicit release. Confirm sealing through review, then only earned L/R results. Refuse duplicate release and check that operational logs contain only the specified IDs. | PENDING |

## Contract evidence

- Compare the endpoint and roster fields with the frontend types. Verify that a null marker retains the previous contract.

## Data evidence

- Verify nullable audit columns in staging. Compare first-write and retry state, then reload and check the same audit values and review ID.

## UI evidence

- Run the admin and learner journeys on staging and check keyboard focus, narrow viewports and supported themes.

## Release evidence

- Record the deployed staging SHA and the outcome of the synthetic journeys. Record production verification only after separate authorization.
