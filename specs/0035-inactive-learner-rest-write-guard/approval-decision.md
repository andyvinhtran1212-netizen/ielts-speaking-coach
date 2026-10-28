# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) approved
INACTIVEWRITE-0035 (FR-001…FR-005) in the Leader chat on 2026-10-28 at 12:44
("duyệt"), including the three recommended defaults in `spec.md` §Decisions:

1. `DELETE` is blocked too, not only `INSERT`/`UPDATE`.
2. Reads stay unchanged: an inactive account can still read its own existing
   rows through REST.
3. Enrichment-batch hardening is a separate follow-up. The owner set its scope
   in the same message: at most 50 rows per owner per run of the admin IPA
   backfill, skip inactive owners, and a daily row-growth alert (more than 500
   new `user_vocabulary` or flashcard rows per user per day) through the
   existing alert path. No PostgREST/REST rate limit.

Migration number **335** was assigned by the Leader on 2026-10-28.

This approves the intent in `spec.md` and the rollout in `rollout.md`. It does
not authorize applying 335 to any database: staging apply follows the
staging-first runbook while staging is unfrozen, and production apply needs the
owner's explicit authorization at the `staging` → `main` promotion.
