# Approved intent decision — COURSELESSON-0064

**State: APPROVED by the owner's direct reply.** Andy approved this spec in full, as proposed in PR #2468. He typed the approval himself in the project on 2026-11-26 at 02:03:25 UTC (09:03 Vietnam time). His message reads:

> duyệt toàn bộ spec 0064 và 0065

The coordinator relayed it to this thread, with the message copied verbatim by the server.

Approved text: `specs/0064-course-lessons/spec.md` at PR #2468 head `8fdac6a6`, sha256 `898f98fd9c7e119d2ed7091f4faaf6345a80f784b6e73ea07ccfdebdf705165c` (taken before this commit, which changes only the two status lines).

Open questions: Andy accepted Q1–Q6 at the spec's recommendations on 2026-11-23. Writing those answers into the spec is done separately in #2617, which is stacked on this PR. That commit must not change the intent approved here; if it does, it needs its own approval.

Scope of the approval:
- It allows the task PRs of this spec (G07-T18, T19, T28, T29) to be written and opened into `staging`, as `high`-risk PRs that cite `Spec: COURSELESSON-0064`.
- It does not authorize applying a migration, writing to a database, turning on a flag, changing env vars, changing the production CSP, or merging. Each of those still needs Andy's own approval at the time.
