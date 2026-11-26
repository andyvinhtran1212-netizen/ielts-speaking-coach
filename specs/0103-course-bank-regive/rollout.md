# Rollout and rollback

## Preconditions

- This spec merged on `staging`. Migration 509 (`pending_feature course_give_request`) is not applied on merge; each apply needs the owner's typed approval and runs with `backend/scripts/apply_migration_locked.sql`, with a read-only pre-check (no duplicate `(cohort_id, give_request_id)` among course rows) and a read-back.

## Staging

- 509 on staging: PENDING evidence link. Applied 2026-11-25 10:47:09Z by `apply_migration_locked.sql` (status `processed`) on Andy's typed line "duyệt áp migration 509 lên staging" (10:44:43Z, thread "Cho giao lại bài đã giao, chỉ ghi chú"), read-back `indisunique=t`, `indisvalid=t`, ledger row present; the evidence is to be posted on #2694 before it merges. Merge the implementation PR after Code Reviewer and CI; on a staging test class, give a bank twice with the same id (one row, same receipt), with a new id (new assignment), and confirm the old assignment keeps its result; resend the old payload without an id and confirm 409 with no new row (FR-005).

## Production

- Under separate owner approval, apply 509 on production and record the read-back. Only then does hotfix #2693 reach `main` (owner-confirmed exception, 2026-11-25). Then back-merge `main` into `staging` before the next promotion cut, so the hotfix commits on `main` and their twins on `staging` reconcile and the promotion carries no surprise diff.

## Rollback and repair

- Code: revert the commits; the per-class 409 returns and stored request ids are ignored. Database: `backend/migrations/rollback/509_course_give_request_unique.sql` drops the index (same approval). Duplicate assignments created deliberately are ordinary rows and can be removed from the admin class view.

## Observability

- `logger.error` on a failed give (no request body); count of course rows with `content_config ? 'give_request_id'` per class. Owner: Andy.
