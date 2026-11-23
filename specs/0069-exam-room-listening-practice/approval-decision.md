# Owner approval

On 2026-11-23 at 17:08 Asia/Saigon (10:08:17 UTC), the owner (anh Andy) wrote in
the project chat of the Averlearning Claude Code project, verbatim:

> duyệt spec 0069 0070 0071, duyệt sửa đổi 1 spec 0066 (a)(b)(c)

The spec approved is `spec.md` on the spec PR #2504 (branch `claude/examlistenp-0069-spec`, head `ebd2227f`),
`spec.md` sha256 `62c8135bc9f8d9e7030c18764ea7917f0056ddb6ec912d486b02ef963c121e3f` before this status change.

Scope of this approval:

- EXAMLISTENP-0069 as written (status draft → approved). This commit does not change any
  requirement.
- The same message approved EXAMROOM-0066 amendment 1 (a)(b)(c); it is applied in
  `specs/0066-exam-room-shell/` and recorded in its `approval-decision.md`.
- Amendment 1 (b) is now approved, so the surface is `'listening-practice'` and the
  fallback rule of FR-015 no longer applies; amendment 1 (c) settles the value comparison.
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
