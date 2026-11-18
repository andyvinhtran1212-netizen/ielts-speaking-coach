# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | `backend/tests/test_sentence_lab.py` importer tests; dry run and staging import counts (45 banks, 540 questions) | PENDING |
| FR-002 | State/play-path gating tests; staging S01 journey response inspection | PENDING |
| FR-003 | Batching/retry/validator/submit tests, 600-character submit refusal test; staging S01 submission and `ai_usage_logs` call count | PENDING |
| FR-004 | Rewrite rule tests; staging rewrite of one item | PENDING |
| FR-005 | `frontend/tests/course-writing-sentence-lab.test.mjs`; staging browser journey | PENDING |
| FR-006 | Usage logging tests; calibration report on the 2026-11-18.1 package | PENDING |
| FR-007 | Cap tests (429 at the cap, 503 on lookup failure, no model call); single-flight test (second concurrent grading 409, one set of calls); staging `ai_usage_logs` count | PENDING |
| FR-008 | Kill-switch test (503, `work_saved`, no model call); staging toggle with an assigned test learner | PENDING |

## Contract evidence

- OpenAPI/type drift: `frontend/types/api.d.ts` regenerated (additive revise route).
- Backward compatibility: Course 1 writing tests unchanged and passing.

## Data evidence

- Migration/schema query: none. Counts: `select count(*) from quiz_banks where code like 'C5-SL-S%'` = 45; joined questions = 540.
- Immediate state versus full reload: rewrite state re-read after commit.

## UI evidence

- Viewports/themes/input methods: PENDING (staging journey).

## Release evidence

- Staging SHA and checks: PENDING
- Production verification: PENDING
