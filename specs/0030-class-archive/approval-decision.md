# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) decided the
A-10 / CLASSARCHIVE-0030 review at **t259u, 2026-10-28 21:23 (Asia/Saigon,
UTC+7)**, relayed by the Leader: **option (a) for all of D1–D6**, as
recommended in `/workspace/cc-jobs/a10-spec-review-1028.md`. In the same
decision he required the spec to also fix two serious findings, written here
as FR-008 and FR-009.

Earlier decision, carried over: Variant A for open work (close new
submissions, keep submitted work and drafts), decided directly by Vinh on
2026-10-27 07:39 (UTC+7). Variants B and C are rejected (`research.md` §9).

| # | Decision (a) | Where it lands |
| --- | --- | --- |
| D1 | A migration number above 335, assigned for A-10. 336 is now taken by ADMINAAL2-0032 FR-019 (#1853). The next free number is **337**: it is in the README's Leader-reserved range 333–337, is unassigned, and no open PR or remote branch has a `337_*` file (checked 2026-10-28). The README line "330 A-10" is released; 330 stays unused. | `spec.md` header, `plan.md`, `tasks.md` T002/T007 |
| D2 | `fn_restore_student` **skips** archived classes and records `skipped_archived_cohort_ids`. This amends STUDENTARCHIVE-0029 FR-003; Vinh's approval at t259u 21:23 is the 0029 re-approval, recorded as Revision 1 in `specs/0029-student-archive/approval-decision.md`. | FR-007 |
| D3 | A timed Writing give started before the archive (`started_at < cohorts.archived_at`) may save, submit and auto-submit. | FR-004 |
| D4 | A class code of an archived class gets the existing generic "mã không hợp lệ" message (S5 anti-enumeration). The code is not consumed and the attempt is audited. | FR-002, FR-008 |
| D5 | The archive reason is an **optional** field in the confirm dialog. | FR-006, FR-010 |
| D6 | Production read-only checks P1–P5 (`research.md` §8) may run now. Vinh confirms, per class, which production classes that are already inactive should really be hidden. | FR-009, `rollout.md` Production |

## Serious findings required in this version

1. **A class archived during activation** must not give the learner a 500
   while their account still ends up activated. FR-008 defines a consistent
   result: the same generic 400, Step 3 reverted, and the code unused. A
   failed revert gives an explicit 503 with an audit flag; it is never silent.
2. **Deploying must not make the 3 staging learners lose their class or close
   the 4 Writing gives.** FR-009 keeps classes that were inactive before 337 in
   a legacy state with today's behaviour. 337 backfills nothing, and its
   postcondition proves that no class became enforced. Applying the rules to a
   legacy class is an explicit, audited admin action.

The technical corrections F1–F16 of the review are part of this approved
intent; they need no further owner decision.

## What this approves

The intent in `spec.md` (FR-001…FR-011), `plan.md` and `rollout.md`, with
locked migration number 337. Merging this spec-only PR into `staging` with a
merge commit records the approval on the base branch.

## What this does not authorize

- Applying 337 to staging or production. Staging follows the staging-first
  runbook after the implementation merges. Production needs Vinh's explicit
  authorization at the `staging` → `main` promotion.
- Applying the archive to any legacy inactive class, on staging or production.
  That is an admin action per class after Vinh's per-class confirmation (D6).
- Any production write. D6 authorizes the read-only P1–P5 only.
