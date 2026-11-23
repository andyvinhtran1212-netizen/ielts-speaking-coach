# Owner approval

On 2026-11-23 at 17:08 Asia/Saigon (10:08:17 UTC), the owner (anh Andy) wrote in
the project chat of the Averlearning Claude Code project, verbatim:

> duyệt spec 0069 0070 0071, duyệt sửa đổi 1 spec 0066 (a)(b)(c)

The spec approved is `spec.md` on the spec PR #2509 (branch `claude/exammock-0071-spec`, head `b7ff5a3c`),
`spec.md` sha256 `460912ec113743784793d57c85d43be09bd83c615fc659d173db0e90b771a11e` before this status change.

Scope of this approval:

- EXAMMOCK-0071 as written (status draft → approved). This commit does not change any
  requirement.
- The same message approved EXAMROOM-0066 amendment 1 (a)(b)(c); it is applied in
  `specs/0066-exam-room-shell/` and recorded in its `approval-decision.md`.
- Amendment 1 (c) is now approved, so FR-010 compares the Writing copy by value
  (`baseValue`, keys `q = 'task1'/'task2'`) instead of asking the learner each time.
- The approval message did not answer the open questions separately. Each keeps its
  stated temporary default ("Mặc định tạm") for the tasks that need it, and anh Andy can
  change any of them before the step that depends on it.
- Tasks may start in the order of `tasks.md`. Each one goes into `staging` as its own PR.

Not approved by this decision:

- Turning on the exam room for this surface on staging or production: the staging flag
  task needs anh Andy's own typed approval, and production needs his explicit go.
- Any backend, database, environment or production change.
- Merging any PR. Each merge needs anh Andy's own "merge #N".

No learner data is included here.

## FR-007 change and wording aligned with EXAMROOM-0066

On 2026-11-23 at 17:57 Asia/Saigon (10:57:43 UTC), the owner (anh Andy) wrote in the
project chat of the Averlearning Claude Code project, verbatim (two lines of one message):

> duyệt sửa FR-007 0071

> duyệt amendment 2 spec 0066 FR-015 (chỉ "Ở lại" khi chưa giữ được bài); duyệt sửa chữ 0071 theo 0066

What these lines approve:

- The FR-007 change already in `spec.md` (commit `e5c0f200`, answering the Codex finding on
  #2509): a section whose collection has started while its `*SubmittedAt` is still null stays
  `submitting` and keeps retrying the final save; `closed_unconfirmed` only once
  `*SubmittedAt` is set or the sitting is no longer in progress. No further requirement change.
- The leave-box wording follows the EXAMROOM-0066 shell strings: "Leave this test?" with
  "Stay in test" (primary) and "Leave test" (FR-008, FR-009, `ui-states.md`,
  `verification.md`), replacing "Leave the test?" / "Continue test".

Status stays `approved`. Not approved by this decision: turning on the exam room for this
surface on staging or production, and merging any PR.
