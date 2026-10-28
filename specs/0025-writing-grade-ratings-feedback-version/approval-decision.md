# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) approved
WRITINGRATE-0025 together with implementation PR #1727 (migration 321) on
2026-10-27 07:14 (UTC+7), for merge into `staging` after CI and review,
relayed in the refresh brief of 2026-10-28:

1. Spec number **0025** and migration number **321** are locked
   (321 = #1727). Draft #1720 (AIOPS-0024) uses 322.
2. The intent in `spec.md` (FR-001…FR-009) and the rollout in `rollout.md`
   are approved as written in the reviewed draft.

This does not authorize applying 321 to any database. Staging apply follows
the staging-first, advisory-locked runbook in `rollout.md`; production apply
needs Vinh's explicit authorization at the `staging` → `main` promotion.
