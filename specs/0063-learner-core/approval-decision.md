# Approved intent decision — LEARNERCORE-0063

**State: base spec and amendments 1–6 APPROVED by the owner's direct replies.** Andy approved this spec as proposed in PR #2461 (base spec, after CR approval). He typed the approval himself in the project chat on 2026-11-23 at 09:16:36 UTC (16:16 Vietnam time). His message reads:

> duyệt spec 0063

The coordinator session relayed it to this thread, with the message copied verbatim by the server.

| Phần | PR | Trạng thái |
| --- | --- | --- |
| Base spec (FR-019…FR-029, FR-070…FR-078; T05, T13, T14) | #2461 | APPROVED by Andy 2026-11-23 09:16 UTC, verbatim "duyệt spec 0063" |
| Amendment 1 (G07-T15, T16) | #2481 | APPROVED by Andy 2026-11-23 09:23 UTC, verbatim "duyệt sửa đổi 0063: #2481 #2482 #2484 #2489 #2491" |
| Amendment 2 (G07-T17, T26) | #2482 | APPROVED by Andy 2026-11-23 09:23 UTC, verbatim "duyệt sửa đổi 0063: #2481 #2482 #2484 #2489 #2491" |
| Amendment 3 (G07-T30a, T30b) | #2484 | APPROVED by Andy 2026-11-23 09:23 UTC, verbatim "duyệt sửa đổi 0063: #2481 #2482 #2484 #2489 #2491" |
| Amendment 4 (G07-T31) | #2489 | APPROVED by Andy 2026-11-23 09:23 UTC, verbatim "duyệt sửa đổi 0063: #2481 #2482 #2484 #2489 #2491" |
| Amendments 5 and 6 (G07-T25, T25s, T30c) | #2491 | APPROVED by Andy 2026-11-23 09:23 UTC, verbatim "duyệt sửa đổi 0063: #2481 #2482 #2484 #2489 #2491" |

Andy approved all five amendment PRs (amendments 1–6) himself in the project chat on 2026-11-23 at 09:23:57 UTC (16:23 Vietnam time), after CR approval. His message reads:

> duyệt sửa đổi 0063: #2481 #2482 #2484 #2489 #2491

The coordinator session relayed it to this thread, with the message copied verbatim by the server. The heads he approved are #2481 `8a8f5f04`, #2482 `15caa0d0`, #2484 `0a5b08de`, #2489 `565a3d4e` and #2491 `495377b9`. The frontmatter goes back to `approved` in this commit. Each amendment takes effect on `staging` when its spec-only PR is merged.

Scope of the approvals:
- They allow the task PRs in `tasks.md` (T05, T13, T14 and the amendment tasks) to be written and opened into `staging`, as `high-risk` PRs that cite `Spec: LEARNERCORE-0063`.
- They do not authorize turning on `learner_v2` for anyone on staging or production, applying a migration, writing to any database, changing env vars, or merging. Each of those still needs Andy's own approval at the time.
