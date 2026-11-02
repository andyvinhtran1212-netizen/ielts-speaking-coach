# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_quiz_check_endpoint.py (row stored before response, response = one qid, why_wrong of picked option only, metadata from question row; red before the route exists) | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_quiz_check_endpoint.py (Course session 409 no key, session with class item 409, Advanced Vocabulary 409) | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_quiz_check_endpoint.py (foreign session 404, ended 409, foreign qid 422, malformed 422, nothing stored, no key field in any error body) plus PG managed reset refusal | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_quiz_check_endpoint.py (replay returns stored verdict, stored answer wins, one row; client_id of another session 409 no key; same qid new client_id = new row) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_quiz_answer_grader_parity.py plus frontend/tests/quiz-grader-parity.test.mjs (same fixture, every branch; integer branch equals grade_attempt) | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_quiz_server_grading.py (legacy and managed PG: forged is_correct ignored; row without is_correct graded not dropped; metadata from question row; missing qid 422 not 500 in self-study and Course; /check rows not duplicated; single_attempt write after due_at 409) | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_quiz_server_grading.py (timed time-cap PG: forged flag → stored rows, RPC totals, /mistakes and report all wrong) | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_quiz_server_grading.py (self-study and Course non-time-cap end: totals = stored counts whatever the body says; managed summary carries counted totals) | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_quiz_bank_student_payload.py (missing/unknown contract marker → 409 quiz_client_refresh_required, no questions or key fields; server-check-v1 → 200 key-free; auth/access and Course admission unchanged; no mode, Grammar current/legacy, Vocab, Course every mode, has answer/accept/explain/why_wrong; derived fields correct; red before guard) plus pre-upgrade-tab journey below | PENDING |
| FR-010 | kind=test; ref=frontend/tests/quiz-engine.test.mjs (credit only after verdict, no local grading, retry same client_id, identical loop given same verdicts) plus frontend/tests/react quiz-player states, API marker on initial/reset/reopen bank GET, full page reload on refresh-required, plus browser verifier | PENDING |
| FR-011 | kind=test; ref=backend/tests/test_single_attempt_key_release.py (A handed in, B not: sealed before due_at on report, mistakes, resume; open after; null due_at → all_submitted; read error sealed; due_at moved later re-seals; teacher path unchanged) | PENDING |
| FR-012 | kind=test; ref=backend/tests/test_single_attempt_key_release.py (sealed body fields) plus course review page test for both notices | PENDING |
| FR-013 | kind=test; ref=backend/tests/test_course_verdict_session_collection.py (abandoned wrong session then 100 % session: verdict reflects abandoned answers, red on staging before the fix; dropped session 422 with ids; recorded-verdict replay; >40 sessions; on-time not turned into timeout; reaper mastery vs single_attempt; full-retry boundary; retake union) plus frontend/tests/course-runner*.test.mjs (one re-post) | PENDING |
| FR-014 | kind=test; ref=backend/tests/test_course_verdict_session_collection.py (policy is the only scorer; first attempt by server time, tie by id) | PENDING |
| FR-015 | kind=test; ref=backend/tests/test_course_verdict_session_collection.py (ledger counts) plus admin homework view test ("—" for old entries) | PENDING |
| FR-016 | kind=test; ref=backend/tests/test_quiz_check_endpoint.py (review: answered qid → verdict + key, nothing stored; unanswered → 409 no key; managed review session forced to review) plus quiz-player review-state test | PENDING |

Note on the ticket's "FE node test for course-runner.js through /check":
Course banks do not use `/check` (FR-002); the course runner gets its
server verdict from `/progress` since #2091 and is covered by
`frontend/tests/course-runner-server-feedback.test.mjs`. This change adds
only the verdict re-post test for `course-runner.js`.

## Contract evidence

- OpenAPI/type drift: `frontend/types/api.d.ts` regenerated with the new
  route and models; `test_openapi_contract` green.
- Backward compatibility: `/progress` and `PATCH /sessions` wire unchanged
  (`is_correct` optional and ignored); before FR-009, unmarked bank GETs
  still work. After FR-009, the server enforces `quiz_contract=server-check-v1`
  before returning self-study questions (rollout step B); missing/unknown
  values return 409 `quiz_client_refresh_required`, not a key-free 200 to
  an old grader. Course admission stays unchanged.

### Pre-upgrade tab across both promotions (FR-009/FR-010)

PENDING T005/T006/T009; this is build/release acceptance, not evidence of
runtime behavior in this draft-only PR.

1. Before FR-010, open a managed Grammar bank in a QA learner tab and keep
   its pre-FR-010 JavaScript running. Record the frontend deployment SHA.
2. Deploy FR-010 with keys retained, then FR-009 with the server guard;
   keep the tab open across both promotions. Record both exact backend
   and frontend deployment SHAs. New FR-010 clients send the marker on
   initial, reset and reopen fetches.
3. In the original tab invoke `resetProgress()` and reopen/refetch the bank
   without reloading the page. Verify every unmarked bank GET returns
   409 `quiz_client_refresh_required`, no questions or key fields, and the
   tab shows its existing load error without grading a fresh bank or
   passing it to the old policy validator. A client without the supported
   marker stays blocked however long it has been open.
4. Perform a full page reload: the new bundle sends
   `quiz_contract=server-check-v1`, receives 200 without key fields and
   answers via `/check`; displayed verdict and stored attempt agree.
5. Probe missing and unknown markers for managed/legacy Grammar and Vocab:
   same 409/no questions. Supported marker: 200 key-free. Existing auth,
   ownership/access refusals and Course admission stay unchanged. Verify
   the FR-010 refresh-required UI performs a full page reload, not a bank
   refetch (375/1280, light/dark, keyboard and screen reader).
6. Attach the red-before-guard/passing-after route tests and browser/network
   evidence with deployment SHAs. Block FR-009 promotion if any check fails.

## Data evidence

- Migration/schema query: none (no migration). Read-only staging query
  before build: count of self-study `quiz_attempts` whose stored
  `is_correct` disagrees with the server grader for MCQ rows (historical
  client flags, repair baseline).
- Immediate state versus full reload: after a verdict, reload restores the
  same progress from stored rows; counts equal.

## UI evidence

- Viewports/themes/input methods: player pending/error/retry at 375 and
  1280, light and dark, keyboard (Enter, Tab), screen reader live region;
  course sealed notice both variants; teacher counts.

## SA retest (ticket)

- GET Grammar/Vocab has no key field.
- Missing/unknown client contract marker on a self-study bank refetch is
  blocked (409, no questions); the pre-FR-010 tab reset/reopen journey passes.
- `/check` reveals no key before a stored attempt; none for a sealed Course item.
- Forged `is_correct` has no effect (`/progress`, time-cap).
- Time-cap rows regraded.
- A handed-in learner sees no key before `due_at`.
- Mastery peek via an abandoned session no longer helps.

## Release evidence

- Staging SHA and checks: pending T009.
- Production verification: pending (promotion PR).
