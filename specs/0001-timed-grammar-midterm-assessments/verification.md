# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_course_assessment_import.py | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_course_assignment.py | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_quiz_course_resume.py | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_quiz_service.py | PENDING |
| FR-005 | kind=test; ref=frontend/tests/course-runner.test.mjs | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_migration_268_guard_assessment_replace.py | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_course_mastery_gate.py | PENDING |

## Contract evidence

- OpenAPI/type drift must pass after backend response changes.
- Existing untimed Course assignment and retry tests must remain green.

## Data evidence

- Staging must record every forward migration exactly once.
- Transactional probes must demonstrate all-or-nothing bank replacement and
  rejection after an assignment or session exists.

## UI evidence

- Automated runner/admin tests must cover loading, valid and invalid duration,
  A–E choices, countdown, expiry, retry, and terminal result states.
- A staging journey must confirm server-authoritative behavior after reload.

## Release evidence

- Staging SHA and required checks: pending implementation PR.
- Production migration, deployment, and two-bank invariant queries: pending
  authorized promotion.
