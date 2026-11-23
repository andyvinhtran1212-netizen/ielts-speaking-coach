# Owner approval

On 2026-11-23 at 16:18 Asia/Saigon (09:18:48 UTC), the owner (anh Andy) wrote in
the project chat of the Averlearning Claude Code project, verbatim:

> duyệt spec 0066

The spec approved is `spec.md` on the spec PR #2487 (branch
`claude/examroom-0066-spec`, head `15b2729f`), `spec.md` sha256
`1c112adb1d53a634803446aea78646b0c395fe44331f8062763e5e1c88d40a68` before this status change.
That head includes the fixes for the owner's two conditions posted on the PR at
09:13 UTC (FR-017 write lock, FR-034 `closed_unconfirmed`).

Scope of this approval:

- EXAMROOM-0066 as written (status draft → approved). This commit does not change any
  requirement.
- The approval message did not answer the ten open questions separately. Each keeps
  its stated temporary default ("Mặc định tạm") for the tasks that need it, and anh
  Andy can change any of them before the step that depends on it. In particular:
  question 1 (flag source) stays on option A for G08-T02; no surface turns on in
  production before PHONEGATE-0081 (question 7) or, for Listening test, before the
  English `AudioPlayer` copy exists (question 9).
- Tasks T001–T004a may start in the order of `tasks.md`. Each one goes into `staging`
  as its own PR.

Not approved by this decision:

- Turning on the exam room for any surface (`examRoomSurfaces` stays empty); each
  surface spec (0067–0073) needs its own approval.
- Any backend, database, environment or production change.
- Merging any PR. Each merge needs anh Andy's own "merge #N".

No learner data is included here.
