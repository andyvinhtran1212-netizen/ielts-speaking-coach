# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) approved
GIVEARCHIVE-0031 and every recommendation of the reviewed draft
(`/workspace/specs-drafts/STUDENT-GIVE-RACE-spec.md`), relayed in the
implementation brief of 2026-10-27:

1. Spec number **0031** and migration number **331** are locked.
2. FR-003: also block changing an existing `writing_assignments.student_id` to
   an archived learner — **yes**.
3. A class give with any learner archived mid-way is **refused as a whole**
   with a clear 409 (the same behaviour as migration 326 / STUDENTARCHIVE-0029).
4. The Assignment Tracker may run the **read-only** checks R1–R4
   (`research.md` §R) on staging, and on production at promotion time. The
   write-then-rollback probe R5 is **not approved**.

Out of scope by the same decision: mapping deadlock/serialization failures
(40P01/40001) to a retryable 409 stays a separate follow-up.

This approves the intent in `spec.md` (FR-001…FR-006) and the rollout in
`rollout.md`. It does not authorize applying 331 to any database: staging
apply follows the staging-first runbook, and production apply needs Vinh's
explicit authorization at the `staging` → `main` promotion.
