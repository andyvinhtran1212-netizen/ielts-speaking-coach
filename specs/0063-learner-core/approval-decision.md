# Approved intent decision — LEARNERCORE-0063

**State: base spec APPROVED by the owner's direct reply.** Andy approved this spec as proposed in PR #2461 (base spec, after CR approval). He typed the approval himself in the project chat on 2026-11-23 at 09:16:36 UTC (16:16 Vietnam time). His message reads:

> duyệt spec 0063

The coordinator session relayed it to this thread, with the message copied verbatim by the server.

| Phần | PR | Trạng thái |
| --- | --- | --- |
| Base spec (FR-019…FR-029, FR-070…FR-078; T05, T13, T14) | #2461 | APPROVED by Andy 2026-11-23 09:16 UTC, verbatim "duyệt spec 0063" |
| Amendment 1 (G07-T15, T16) | #2481 | PENDING: needs Andy's separate approval |
| Amendment 2 (G07-T17, T26) | #2482 | PENDING: needs Andy's separate approval |
| Amendment 3 (G07-T30a, T30b) | #2484 | PENDING: needs Andy's separate approval |
| Amendment 4 (G07-T31) | #2489 | PENDING: needs Andy's separate approval |
| Amendments 5 and 6 (G07-T25, T25s, T30c) | #2491 | PENDING: needs Andy's separate approval |

An amendment counts as approved only when Andy approves it himself and its spec-only PR is merged into `staging`. Until then, no task PR may rely on its requirements.

Scope of the base approval:
- It allows the task PRs for T05, T13 and T14 to be written and opened into `staging`, as `high-risk` PRs that cite `Spec: LEARNERCORE-0063`.
- It does not authorize turning on `learner_v2` for anyone on staging or production, applying a migration, writing to any database, changing env vars, or merging. Each of those still needs Andy's own approval at the time.
