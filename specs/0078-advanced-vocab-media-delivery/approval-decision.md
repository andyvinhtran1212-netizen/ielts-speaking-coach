# Owner approval

On 2026-11-21 at 08:28 Asia/Saigon (01:28:29 UTC), the owner (anh Andy) wrote in
the project chat of the Averlearning Claude Code project, verbatim:

> duyệt spec 0078; duyệt PATCH 0074 0061; đồng ý Q-b1 theo đợt

The spec approved is `spec.md` on the spec PR #2407 (branch
`codex/g10-t16-t17-spec-mediaout`), `spec.md` sha256
`6bfd562adeedb0e6553c50241b6b12e2f286b7f7dca98c1639c36cec7686a042` before this status change.

Scope of this approval:

- MEDIAOUT-0078 as written (status draft → approved). This commit does not change any
  requirement. The approval message did not answer the open questions separately, so
  Q-e1 (which option), Q-e1b (bucket layout) and Q-e2 (staging `SELECT`) stay open.
  Each needs its own answer from anh Andy before the step that depends on it.
- Tasks that need no answer to an open question may start in the order of `tasks.md`.
  Each one goes into `staging` as its own PR.

Not approved by this decision:

- Choosing option A, B, C or D (Q-e1), and removing any file under
  `frontend/public/assets/advanced-vocab/**` (T19 needs Q-e1 approved in writing).
- Any database read or write, including the staging `SELECT` of Q-e2; any environment or
  bucket change; any production read, write or deploy.
- Merging any PR. Each merge needs anh Andy's own "merge #N".

No learner data is included here.
