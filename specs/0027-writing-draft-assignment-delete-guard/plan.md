# Implementation plan

## Architecture impact

- Database: one foreign key on `public.writing_drafts`.
- Backend: `backend/services/writing_assignment_delete_guard.py`
  (`delete_unstarted_assignment`, merged in #1732) wraps its final `DELETE` and
  maps a 23503 foreign-key violation to `HTTPException(409,
  ASSIGNMENT_STARTED_DETAIL)`; other errors keep their current behavior. Both
  routers already call this helper, so they need no change.
- The draft trigger `fn_guard_writing_draft_mutation` already locks the parent
  assignment `FOR UPDATE`, so the FK check and draft writes serialize.

## Data and contracts

- `backend/migrations/324_writing_drafts_assignment_fk_no_action.sql`, one
  transaction, `lock_timeout = 5s` (full SQL `research.md` §5):
  1. Abort `writing_drafts_orphans_exist` if any draft points at a missing assignment.
  2. If `confdeltype` is `c` (or the FK is missing), drop and re-add
     `writing_drafts_assignment_id_fkey ... ON DELETE NO ACTION NOT VALID`;
     return if already `a`; abort `writing_drafts_assignment_fk_unexpected` otherwise.
  3. `VALIDATE CONSTRAINT`.
  4. Postcondition: FK is `a` and validated; no FK into `writing_assignments`
     has `confdeltype = 'c'`.
- NO ACTION rather than RESTRICT: the check runs at end of statement, so a
  student delete that cascades to both rows in one statement is not blocked by
  RI trigger order (FR-003, must be proven by test).
- HTTP contract unchanged: 409 `ASSIGNMENT_STARTED_DETAIL`, 404 for missing or
  out-of-scope rows, 200/204 on success.
- Ordering: independent of 321/322/323; a ledger gap is allowed by
  `backend/migrations/README.md` ("The runner applies any unapplied file
  regardless of order").

## UI and interaction

- No UI calls these DELETE routes today (`research.md` §1); no UI change.

## Work decomposition

- T002 migration and T004 migration tests; T003 guard change and its unit test
  are independent of the migration file and can run in parallel.

## Rollout and rollback

- Staging then production; backend change is safe before or after 324
  (without 324 the 23503 branch never fires). See `rollout.md`.
- Rollback restores CASCADE (`research.md` §5 Rollback); data-safe but reopens
  the draft-loss hole.

## Verification strategy

- PostgreSQL test: delete with draft → 23503; delete without draft → OK;
  single-statement student delete with assignment + draft → OK; concurrent
  draft insert vs delete never loses the draft; re-apply is a no-op.
- Unit test: fake DELETE raising 23503 → 409 `ASSIGNMENT_STARTED_DETAIL` for
  both admin and instructor callers.
- Staging journeys `research.md` §8 AC-1…AC-8.
