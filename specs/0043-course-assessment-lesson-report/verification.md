# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_course_lesson_report.py (one case per source: AC4a meta.lesson_map, AC4b skill `Bxx` on a production-final-shaped fixture with every subtype `A1`, AC4c item_key `Buổi NN` NFC/NFD normalised to `BNN` plus rejected forms; AC4d conflict count; AC4 none; writing excluded; coverage complete/partial/none) | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_course_assessment_import.py (payload meta has lesson_map for 300 qids and lesson_counts equal to dry-run coverage; dry-run output unchanged) plus a staging import readback | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_course_lesson_report.py (single_attempt verdict sessions, mastery first answer, redone stage duplicate, server regrade overrides client is_correct, unanswered not correct, totals equal to bank counts) | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_course_lesson_report.py (single_attempt sum equals course_verdict correct for every fixture; score_mismatch flag; multi-section quiz_only=false; mastery full-retry and passing-revision fixtures whose first and final scores differ keep first-attempt numbers with reconciled=false, baseline=first_attempt, no score_mismatch and no stale) | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_course_lesson_report.py (no_account, untouched, in_progress, graded, timed_out, moved/archived learner kept) | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_course_lesson_report.py (class sums over counted rows only, counted/assigned, sample_low below 3) | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_course_lesson_report.py (strictly below 60, so 60.0 is not weak; bottom-3 ties by lesson number, numeric order, untagged last) plus frontend/tests/react/admin-class-lesson-report.test.tsx (text label present) | PENDING |
| FR-008 | kind=test; ref=backend/tests/test_course_lesson_report.py (verified, keys_verified, unknown, drift → 409) | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_course_lesson_report.py (admin 200; wrong cohort 404; non-course 404; advanced_vocab 422; no tags 200 none; OpenAPI schema published) | PENDING |
| FR-010 | kind=test; ref=backend/tests/test_instructor_lesson_report.py (owner 200; other owner's cohort, mixed ids and missing ids give identical 404; inactive instructor denied; as_instructor audited) | PENDING |
| FR-011 | kind=test; ref=backend/tests/test_course_lesson_report.py (forbidden-field schema walk; no insert/update/upsert/rpc-write calls recorded on the fake client; learner token 401/403 on both routes) | PENDING |
| FR-012 | kind=test; ref=frontend/tests/react/admin-class-lesson-report.test.tsx (tab hidden for none; loading, empty, success, stale, drift, error/retry; Inspect link) plus a staging MANUAL journey | PENDING |
| FR-013 | kind=test; ref=frontend/tests/react/instructor-lesson-report.test.tsx (own classes only, read-only, no Inspect) | PENDING |
| FR-014 | kind=test; ref=backend/tests/test_course_lesson_report.py (read failure → stale, no zeros; paged reads ordered) plus staging timing for 30 × 300 recorded in rollout evidence | PENDING |
