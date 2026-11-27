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

## Amendment 1 — `class_action_log.student_name` (2026-11-23 11:18 UTC)

The read-only staging catalog query (T001 gate 2, approved by Andy at 11:06
UTC) found that `class_action_log.student_name` copies the learner's name
into a log that migration 198 makes append-only (`trg_class_action_log_append_only`
blocks every UPDATE and DELETE). FR-005 asks for names in kept logs to be
anonymised.

Verbatim, typed by Andy in the project chat and relayed by the coordinator:

> duyệt 0100: ẩn danh student_name bằng hàm hẹp

Decision: the code PR adds one narrow function in a migration. It sets
`student_name` to NULL only on the rows of the learner being erased, and only
when the erasure job calls it. The append-only trigger stays on for every
other update and delete. The migration is written as a file only; applying
it follows the rule above.

## Amendment 2 — erasure through append-only and immutability triggers (2026-11-23 11:29 UTC)

While writing T005, about ten tables that FR-005 deletes turned out to carry
triggers that refuse DELETE to protect grading evidence: grammar diagnostic
and lesson history (283, 313), advanced vocabulary evidence (281, 282, 291),
`learner_goal_events` (452), Listening feedback reveals (296) and grammar
quiz progress (309). Without a change, the erasure job cannot delete the
learner's work.

Andy chose option A on the decision card "Cho job xoá tài khoản đi qua các
trigger 'không được xoá' của bài làm?": **"Hàm xoá + cửa hẹp ở trigger"**.

Decision:
- Migration 504 (file only, not applied; first drafted as 501, renumbered because 501 and 503 were taken) adds one `SECURITY DEFINER`
  function that runs plan step 5 (deletes, anonymisation, `student_name`
  from amendment 1) in one transaction. `EXECUTE` is revoked from `PUBLIC`,
  `anon` and `authenticated`; only `service_role` may call it (CR nit).
- The function sets a transaction-local erasure context naming the learner.
  Each blocking guard gains one early return that lets through only rows of
  that learner while that context is set. Every other update or delete is
  refused exactly as before.
- Applying migration 504 follows the rule above (Andy's typed approval).
