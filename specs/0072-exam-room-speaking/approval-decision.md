# Owner approval

On 2026-11-23 at 17:57 Asia/Saigon (10:57:43 UTC), the owner (anh Andy) wrote in
the project chat of the Averlearning Claude Code project, verbatim:

> duyệt spec 0072

The spec approved is `spec.md` on the spec PR #2511 (branch `claude/examspeak-0072-spec`, head `010f9256`),
`spec.md` sha256 `0012f091a58f15c6bc31da745b3242289311ffaa6a126216d88e8871620ff63c` before this status change.

Scope of this approval:

- EXAMSPEAK-0072 as written (status draft → approved). This commit does not change any
  requirement.
- The approval message did not answer the open questions separately. Each keeps its
  stated temporary default ("Mặc định tạm") for the tasks that need it, and anh Andy can
  change any of them before the step that depends on it.
- Tasks may start in the order of `tasks.md`. Each one goes into `staging` as its own PR.

Not approved by this decision:

- Turning on the exam room for this surface on staging or production: the staging flag
  task needs anh Andy's own typed approval, and production needs his explicit go.
- Any backend, database, environment or production change, and any paid AI run.
- Merging any PR. Each merge needs anh Andy's own "merge #N".

No learner data is included here.

## Amendment 1

On 2026-11-24 at 08:43 Asia/Saigon (01:43:48 UTC), the owner (anh Andy) wrote in the
project chat of the Averlearning Claude Code project, verbatim:

> duyệt sửa 0072 FR-010 theo sửa đổi 2

Amendment 1 answers the Codex finding on #2511 and #2541 (`spec.md` FR-010: before G05-T19
the learner could choose to navigate away after a warning that unsent recordings would be
lost, which contradicts EXAMROOM-0066 FR-015 amendment 2). Speaking keeps unsent audio only
in page memory (FR-009), so an unsent take is always the "work not kept" case. This commit:

- rewrites FR-010: with an unsent take the 401 box offers only "Ở lại làm tiếp"/"Stay", with
  no same-tab `/login?next=` path and no discard-to-sign-in button; submit stays locked; the
  box tells the learner to sign in in another tab and press "Gửi lại bản ghi". With no unsent
  take left, "Đăng nhập lại"/"Sign in again" stays available;
- adds Scenario 8 (401 with an unsent take: the take and the URL stay);
- aligns `ui-states.md`, `tasks.md` T003 and the FR-010 row of `verification.md`.

Status stays `approved`. Not approved by this decision: turning on the surface on staging
or production, and merging any PR.
