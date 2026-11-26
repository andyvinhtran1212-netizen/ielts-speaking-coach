# Implementation plan

## Architecture impact

- `backend/routers/admin_class_assignments.py`: `_resolve_course_bank` drops the per-class refusal; `_last_given_at()`; catalogs add `last_given_at` / `can_regive`; `create_assignment` handles `give_request_id` for course gives (`_course_give_fingerprint`, receipt replay through `_existing_grammar_give(..., "course")`, catch of `uq_course_give_request`). New blocking reads run through `asyncio.to_thread`.
- `backend/migrations/509_course_give_request_unique.sql` (+ rollback, `register.tsv`, `forward-policy.tsv`, README).
- Frontend: `frontend/lib/admin-class-homework-model.mjs`, `admin-class-homework.tsx`, `admin-class-homework-types.ts`; `frontend/types/api.d.ts` docstring.

## Data and contracts

- Schema: one partial unique index (509). No column, no data change, no privilege change.
- `content_config` of new course assignments may carry `give_request_id` and `give_fingerprint`.
- Catalog responses add `last_given_at` (ISO string or null) and `can_regive` (bool). The create route accepts the existing optional `give_request_id` for course gives; a replay returns the same receipt shape as a fresh give.

## UI and interaction

- Existing homework editor; see `ui-states.md`.

## Rollout and rollback

- Apply 509 on staging, merge to staging, verify on a test class, apply 509 on production, then the hotfix reaches `main`. See `rollout.md`.

## Verification strategy

- Route tests in `backend/tests/test_course_assignment.py`; real-PostgreSQL tests in `backend/tests/test_migration_509_course_give_request.py` (two concurrent sessions, allowed cases, rollback); `test_no_sync_io_in_async`; frontend `tests/admin-class-homework-next-behavior.test.mjs`; staging journey on a test class.
