# Approval decision — ACCOUNTDATA-0100

**State: APPROVED by Andy (owner) on 2026-11-23 09:39 UTC (16:39 UTC+7).**

Verbatim, typed by Andy in the project chat and relayed by the coordinator:

> duyệt spec 0100, gỡ HOLD 09:28 09:35, Q6 giữ, Q7 đồng ý

## What the approval covers

| Item | Decision |
| --- | --- |
| Spec 0100 (FR-001 … FR-014, plan, tasks, verification, rollout, ui-states) at head `f7dd7a40` | Approved ("duyệt spec 0100") |
| HOLD comments posted 09:28 and 09:35 on this pull request | Lifted by Andy in chat ("gỡ HOLD 09:28 09:35") |
| Open question 6 — `credit_covered_requests` | Keep (`keep`, pointing at the anonymised id): "Q6 giữ" |
| Open question 7 — `learner_care_notes` | Agreed as proposed: deleted on erasure, never included in the export: "Q7 đồng ý" |
| Open questions 1–5 | Accepted at the proposed defaults by approving the spec (Q1 also matches "đồng ý cả 11", 2026-11-20) |

## What it does not authorize

Approving this spec authorizes writing and testing the implementation in
pull requests to `staging` only. It does not authorize merging, applying any
migration to staging or production, changing any environment variable
(including `ACCOUNT_ERASURE_ENABLED`, which stays off until Andy types it),
or running the erasure job outside `--dry-run`. Each of those needs Andy's
own typed approval at the time.
