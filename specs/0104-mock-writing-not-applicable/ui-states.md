# Admin roster states

| State | Presentation and action |
|---|---|
| Eligible, no review | Show “Chốt L/R (Writing không áp dụng)” for this sitting. |
| Confirming | Identify the sitting, explain that review can proceed and results still require release. Require a reason. Cancel makes no request. |
| Saving | Disable repeated confirmation while the request is pending. |
| Success or replay | Refetch the roster. Show “Không áp dụng” in Writing and the canonical review state. |
| Eligibility changed | Explain the conflict, refetch and recalculate available actions. |
| Failed request or refetch | Show a retryable error. A failed refresh must not present cached data as confirmation. |
| Ineligible or another learner | The ordinary review controls follow that sitting's actual state. |
