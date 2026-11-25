# Rollout and rollback

## Preconditions

- This spec merged on `staging`. Migration 509 (`pending_feature course_give_request`) is not applied on merge; each apply needs the owner's typed approval and runs with `backend/scripts/apply_migration_locked.sql`, with a read-only pre-check (no duplicate `(cohort_id, give_request_id)` among course rows) and a read-back.

## Staging

- 509 applied on staging 2026-11-25 10:47:09Z, read-back `indisunique=t`, `indisvalid=t`. Merge the implementation PR after Code Reviewer and CI; on a staging test class, give a bank twice with the same id (one row, same receipt), with a new id (new assignment), and confirm the old assignment keeps its result.

## Production

- Under separate owner approval, apply 509 on production and record the read-back. Only then does hotfix #2693 reach `main` (owner-confirmed exception, 2026-11-25). Later promotions carry the same code from `staging`.

## Rollback and repair

- Code: revert the commits; the per-class 409 returns and stored request ids are ignored. Database: `backend/migrations/rollback/509_course_give_request_unique.sql` drops the index (same approval). Duplicate assignments created deliberately are ordinary rows and can be removed from the admin class view.

## Observability

- `logger.error` on a failed give (no request body); count of course rows with `content_config ? 'give_request_id'` per class. Owner: Andy.
