# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | `backend/tests/test_course_assignment.py` (`test_giving_the_same_lesson_twice_is_allowed`, library `last_given_at`/`can_regive`); staging re-give journey | PENDING |
| FR-002 | `frontend/tests/admin-class-homework-next-behavior.test.mjs`; staging editor check | PENDING |
| FR-003 | Route tests: new id creates, retry replays, changed intent 409; staging repeated-id call | PENDING |
| FR-004 | `backend/tests/test_migration_509_course_give_request.py` (concurrent sessions, allowed cases, rollback); route test for the lost race; staging and production read-back of `uq_course_give_request` | PENDING |
| FR-005 | `test_an_old_client_without_a_request_id_is_still_refused_a_second_give`, `test_an_old_client_first_give_without_a_request_id_still_works`; staging Scenario 4 | PENDING |

## Contract evidence

- OpenAPI/type drift: `frontend/types/api.d.ts` course-banks docstring synced.
- Backward compatibility: gives without `give_request_id` behave as before except the removed refusal.

## Data evidence

- Migration/schema query: `select indisunique, indisvalid from pg_index where indexrelid = 'public.uq_course_give_request'::regclass`; ledger row `509_course_give_request_unique.sql`.
- Immediate state versus full reload: the editor refetches the catalog after a give.

## UI evidence

- Viewports/themes/input methods: PENDING (staging journey).

## Release evidence

- Staging SHA and checks: PENDING
- Production verification: PENDING
