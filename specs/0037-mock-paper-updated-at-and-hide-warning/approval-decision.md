# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) approved this
work at t261u, 2026-10-28 21:33 (UTC+7), on the basis of the Security Auditor
report `/workspace/cc-jobs/security-auditor/avr-read-002-ispublic-flip-1028.md`:

1. A new migration adds a BEFORE UPDATE trigger that sets `updated_at = now()`
   on the Reading/Listening test tables, and on their passage/question tables
   where they have `updated_at`; idempotent; `trg_mock_paper_policy` behaviour
   intact; with a migration test.
2. The admin Mock Test form warns that creating the private copy hides a public
   source. The Vietnamese wording is a proposal in one constant, for Content
   Manager review.
3. The hide-on-copy behaviour itself does not change.

Scope: staging only. The Leader applies 338 to staging under the advisory lock.
This does not authorize applying 338 to production; that needs the owner's
explicit authorization at the `staging` → `main` promotion.

## Amendment 1 — FR-006 (Listening package transitions under the 306 policy trigger)

**State: APPROVED** by Vinh on 2026-10-30 at 06:58 (UTC+7), verbatim "Ok theo đề xuất" (approving Q-0600-SPEC0037-FR006 as proposed), relayed by the Leader. Proposed 2026-10-30 by the Project
Coordinator (PC-J252) after PC-J242 reproduced SQLSTATE 55000
`listening_package_child_immutable` on a permitted package publish
(`306_mock_paper_policy_and_admission.sql:717-724` bumps `policy_revision`;
`295_listening_content_programmes.sql:625,681-686` does not allow it).
Vinh approves the exact FR-006 text in `spec.md`; implementation (migration
353) starts only after this amendment is merged into `staging`.
