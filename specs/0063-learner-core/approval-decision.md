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

## HOLD patch (approved 2026-11-23 09:51 UTC)

Seven HOLD comments on the amendment PRs had been posted before the 09:23 approval and were still unanswered. They are fixed in one consolidated spec patch, together with the open Codex review threads and one gap in the base spec (FR-078 against the ledger reconcile that `_visible_assignments` performs). Andy approved the patch himself in the project chat at 09:51:13 UTC (16:51 Vietnam time). The coordinator relayed his message, which the server copied verbatim:

> duyệt bản vá HOLD 0063

| Amendment | PR | What the patch changes |
|---|---|---|
| 1 | #2481 | FR-082: mock results show band, Overall and grading detail only once the sitting is `released`, in the JSON as well. FR-037: an expired course shows no lesson list, because 0064 returns 403 `course_access_expired`. |
| 2 | #2482 | No text change. The FR-094 HOLD was already resolved by the CR R2 fixes (suspended accounts excluded, flag-bound exemptions, field whitelist). |
| 3 | #2484 | FR-100: the self-practice route checks `student_is_active_in_cohort`. FR-078 and FR-103: "read-only" allows only the ledger reconcile done inside `_visible_assignments`. FR-096: reopened course work (`course_action`) groups as "Cần làm". |
| 4 | #2489 | FR-110: the preflight uses the index predicate (`attempt_id IS NOT NULL`). Real duplicates are repaired with an archive script that needs a separate DB-write approval; marking them `resolved` no longer counts as a fix. |
| 5, 6 | #2491 | FR-116: `credits.metering` is computed by the server with `charge_plan`. FR-124: `degraded: ['class']` hides every class-scoped block on `/course/class`. |

The approval covers spec text only. It does not authorize applying a migration, running the archive script, writing to a database or merging.

## OQ17 patch after mig 441 (PENDING Andy's approval)

Mig 441 (ADMINIA-0074 G09-T24) is applied on staging. It adds `cohorts.instructor_id`, `weekly_schedule` (`dow` 1–7, `start` "HH:MM"), `start_date` and `class_lessons.starts_at`, so open question 17 was out of date. This patch to amendment 6 (#2491) changes the spec text only:

- FR-120: the `/course/class` card shows the teacher and the weekly start times from 441 ("Thứ Hai và Thứ Tư, 18:30"), next to "Đã học n buổi". End time, room and the planned number of sessions stay hidden.
- `GET /api/class/me` gains two read fields per class, `instructor: {name} | null` and `weekly_schedule: [{dow, start}]`. No other field changes. T30c now depends on G09-T24 (mig 441 applied).
- Open question 17 is reduced to the three missing columns (end time, room, planned sessions). The default is still to add none, until the class edit screen of G09.
- T25 lists G04-T03 (#2485, `charge_plan` of 0055) in its depends (CR nit on the HOLD patch).

The text is not in force until Andy approves it in his own words.
