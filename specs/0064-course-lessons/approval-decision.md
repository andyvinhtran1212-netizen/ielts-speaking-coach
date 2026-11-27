# Approved intent decision — COURSELESSON-0064

**State: APPROVED by the owner's direct reply.** Andy approved this spec in full, as proposed in PR #2468. He typed the approval himself in the project on 2026-11-26 at 02:03:25 UTC (09:03 Vietnam time). His message reads:

> duyệt toàn bộ spec 0064 và 0065

The coordinator relayed it to this thread, with the message copied verbatim by the server.

Approved text: `specs/0064-course-lessons/spec.md` at PR #2468 head `8fdac6a6`, sha256 `898f98fd9c7e119d2ed7091f4faaf6345a80f784b6e73ea07ccfdebdf705165c` (taken before this commit, which changes only the two status lines).

Open questions: Andy accepted Q1–Q6 at the spec's recommendations on 2026-11-23. Writing those answers into the spec is done separately in #2617, which is stacked on this PR. That commit must not change the intent approved here; if it does, it needs its own approval.

Scope of the approval:
- It allows the task PRs of this spec (G07-T18, T19, T28, T29) to be written and opened into `staging`, as `high`-risk PRs that cite `Spec: COURSELESSON-0064`.
- It does not authorize applying a migration, writing to a database, turning on a flag, changing env vars, changing the production CSP, or merging. Each of those still needs Andy's own approval at the time.

## Clarification approved

The approved text describes a `lesson_code` with odd characters in the URL as "so khớp chính xác, không phân biệt hoa thường thì không trả, và 404". That wording can be read as case-insensitive. #2617 states the edge case as case-sensitive. Because the two readings differ, Andy was asked to confirm. He typed this in the project on 2026-11-26 at 02:25:50 UTC (09:25 Vietnam time):

> duyệt làm rõ lesson_code phân biệt hoa thường #2617

The thread that took over the team process relayed the message and recorded it on #2617 (comment 7180801216).

The canonical rule, as `spec.md` now reads:

> `lesson_code` có ký tự lạ trong URL: so khớp chính xác và phân biệt hoa thường (CHECK `^[A-Z0-9][A-Z0-9-]{0,15}$`). Mã viết thường hoặc có ký tự ngoài mẫu trả 404, không tự đổi sang chữ hoa.

This approval covers only that clarification. It does not authorize merging #2617; that still needs Andy's own "merge #2617".
