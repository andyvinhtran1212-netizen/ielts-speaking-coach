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

## Amendment 1

On 2026-11-23 at 17:08 Asia/Saigon (10:08:17 UTC), the owner (anh Andy) wrote in the
project chat of the Averlearning Claude Code project, verbatim:

> duyệt spec 0069 0070 0071, duyệt sửa đổi 1 spec 0066 (a)(b)(c)

Amendment 1 was proposed in EXAMREAD-0067 (open question 6, item (a)) and in the section
"Sửa đổi đề xuất cho EXAMROOM-0066" of EXAMLISTENP-0069 (items (b) and (c)), branch
`claude/examlistenp-0069-spec` head `807efcaf`. This commit applies it to this spec:

- **(a)** FR-034 and `submit.outcome` gain `expired_unsubmitted`: the server refused a
  submit that arrived after the grace period; the attempt is not submitted. Copy from
  EXAMREAD-0067 FR-021; no other outcome changes.
- **(b)** `ExamRoomSurface` gains `'listening-practice'` (Listening practice, `practice`
  mode); `'listening'` stays for Listening full test, mini test and drill. The flag name
  list in `generate-runtime-config.mjs` follows `EXAM_ROOM_SURFACES`.
- **(c)** FR-035 compares the local copy by value: each answer keeps `baseValue` (the
  value the server last acknowledged); `baseSavedAt` is kept for display only. The lib
  (T001, #2507) adds `baseValue` to `LocalCopyAnswer` and `planLocalCopyReplay` compares by
  it; a record without `baseValue` asks the learner instead of resending.

Status stays `approved`. Not approved by this decision: turning on any surface on staging
or production (each needs its own approval), and merging any PR.

## Amendment 2

On 2026-11-23 at 17:57 Asia/Saigon (10:57:43 UTC), the owner (anh Andy) wrote in the
project chat of the Averlearning Claude Code project, verbatim:

> duyệt amendment 2 spec 0066 FR-015 (chỉ "Ở lại" khi chưa giữ được bài); duyệt sửa chữ 0071 theo 0066

Amendment 2 answers the Codex finding on #2508 (FR-015 let "Sign in again" navigate away
when browser storage refused the copy, which destroys the only in-memory answers and
contradicts EXAMLISTENP-0069 FR-009, Writing FR-011 and Listening test FR-014). This
commit applies it to FR-015:

- When the local copy could not be read back **and** answers the server has not
  acknowledged remain, the session box offers only "Stay"/"Ở lại làm tiếp". It closes the
  box, stays on the page and has no same-tab `/login?next=` path; submit stays locked until
  the session is back.
- With no unacknowledged answers left, "Sign in again" stays available as before.

Status stays `approved`. Not approved by this decision: turning on any surface on staging
or production, and merging any PR.
