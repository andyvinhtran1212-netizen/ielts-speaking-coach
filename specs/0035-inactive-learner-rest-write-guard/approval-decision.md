# Approved intent decision

**State: NOT YET APPROVED.** This draft needs the human owner's approval of
INACTIVEWRITE-0035 (FR-001…FR-005) and of the three recommended defaults in
`spec.md` §Decisions before implementation can merge. Migration number **335**
was assigned by the Leader on 2026-10-28.

Approval of this spec would not authorize applying 335 to any database: staging
apply follows the staging-first runbook while staging is unfrozen, and
production apply needs the owner's explicit authorization at the `staging` →
`main` promotion.
