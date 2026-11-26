# Verification matrix

All checks below are planned for implementation. No runtime acceptance is claimed by this draft.

| Contract | Evidence to collect |
|---|---|
| FR-001 | Anonymous, learner and non-admin calls fail without changes. Blank or whitespace reason fails. Successful write records authenticated actor, server time and reason. |
| FR-002 | Individually exercise retake, open room, Writing started, invalid status, Writing submitted, each essay ID, Writing text, each configured L/R timestamp absent, missing or non-submitted linked attempt. Verify refusal leaves sitting and review unchanged. Test single configured L/R skill and the agreed empty-skill decision. |
| FR-002–003 | Race first mark against an eligibility change and two admin confirmations. Retry after marking but before review creation. Verify immutable audit and exactly one review. |
| FR-003–004 | Reconcile, claim and grade the marked row. Confirm required bands match configured L/R, Writing tasks are empty, and a sibling sitting and ordinary retake retain their own requirements. |
| FR-004 | In the admin roster exercise cancel, blank reason, confirm, stale conflict, failed request, failed refresh and retry. Reload the row and compare with its server state. |
| FR-005 | Use a synthetic learner before marking, after marking and after explicit release. Confirm sealing through review, then only earned L/R results. A second release is refused. Inspect operational logs for IDs only. |
