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
| FR-008 | kind=test; ref=backend/tests/test_course_assignment.py,backend/tests/test_course_mastery_gate.py | PENDING |
| FR-009 | kind=test; ref=backend/tests/test_course_mastery_gate.py,backend/tests/test_quiz_service.py,frontend/tests/course-behavior-retake.test.mjs | PENDING |
| FR-010 | kind=test; ref=backend/tests/test_course_assignment.py,frontend/tests/admin-class-homework-next-behavior.test.mjs | PENDING |
| FR-011 | kind=test; ref=frontend/tests/react/admin-directory-ui.test.tsx,frontend/tests/admin-class-homework-next-behavior.test.mjs; kind=manual; ref=staging assignment dialog viewport/theme/keyboard matrix | PENDING |

## Contract evidence

- OpenAPI/type drift must pass after backend response changes.
- Existing untimed Course assignment and retry tests must remain green.
- Existing assignments with no completion-mode key must remain mastery.
- The preview response must use a concrete OpenAPI schema and generated type.

## Data evidence

- Staging must record every forward migration exactly once.
- Transactional probes must demonstrate all-or-nothing bank replacement and
  rejection after an assignment or session exists.

## UI evidence

- Automated runner/admin tests must cover loading, valid and invalid duration,
  A–E choices, countdown, expiry, retry, and terminal result states.
- A staging journey must confirm server-authoritative behavior after reload.
- Focused tests must prove active single-attempt reports do not return answers,
  terminal reports do, and direct second-start/retry requests create no session.
- Manual evidence must cover 390, 768, 1366, and 1920 CSS pixels in both themes,
  keyboard traversal, Escape, fixed actions, and independently scrolling content.

## Release evidence

- Implementation is present in the integrated tree recorded in the
  [2026-09-26 status ledger](../IMPLEMENTATION_STATUS.md). Reconcile each task
  against its approved revision before marking it complete.
- Feature-specific hosted migration, two-bank invariant queries and authenticated
  behavior evidence remain pending; integration CI does not close these gates.
