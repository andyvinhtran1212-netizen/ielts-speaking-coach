# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) approved this
work on 2026-10-30 at 06:59 (UTC+7). Verbatim reply: "Ok với đề xuất"
(question 11, SPEC0040; Leader reference t631u). The Leader relayed the reply
on 2026-10-30 07:00 (UTC+7) and assigned spec number 0040 and migration 355.

The proposal approved (PC-J267 draft
`cc-jobs/reviews/PC-J267-spec-draft-vocab-curated-guard.md`):

1. A review or task of a **published** curated vocabulary version can be moved
   to a draft version and then edited, so the published version silently loses
   it. Found by the PostgreSQL test job; no sign it has happened.
2. Approve a new spec (one FR) and migration 355 that blocks this in the
   database. Only the two guard functions change; no data changes.
3. Production is changed only when the owner approves it at promotion.

Scope: staging only. The Leader applies 355 to staging under the advisory
lock. This does not authorize applying 355 to production; that needs the
owner's explicit authorization at the `staging` → `main` promotion.
