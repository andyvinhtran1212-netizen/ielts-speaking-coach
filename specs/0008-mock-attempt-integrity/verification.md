# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=frontend/tests/mock-exam-next-behavior.test.mjs, frontend/tests/reading-exam-native-controller.test.mjs, frontend/tests/listening-test-native-controller.test.mjs; gap=bridge timeout and attach rejection journey | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_mock_exam_workflow.py, frontend/tests/mock-live-console-boot.test.mjs; local preflight, lookup-failure, late-orphan/repair and admin gate tests pass; gap=exact-SHA staging journey | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_mock_exam_workflow.py; local blank, linked, idempotent, missing/malformed clock, and batch-query tests pass; gap=exact-SHA staging and production journey | PENDING |

## Contract evidence

- Attach API and attempt/sitting wire shapes are unchanged. API drift and
  compatibility checks remain required on the implementation SHA.
- New player behavior relies on the existing MockHook attach response and
  existing error state; verify success and rejection.

## Data evidence

- No migration. Query the affected staging sitting and domain attempt by ID;
  verify the persisted link before answering and no terminal blank stamp on
  an anomalous attempt. Confirm the completion token stays empty and Advance
  rejects a late orphan until the exact two links are repaired and re-swept.
  Compare immediate state with reload.

## UI evidence

- Verify Reading and Listening entry, Listening start and resume, timeout and
  attach rejection at mobile/tablet/desktop widths, both themes, keyboard
  focus, and reduced motion where applicable.
- Verify admin Live requires Collect even with zero working, shows an unfinished
  sweep, and enables Advance only after the persisted completion marker matches.

## Release evidence

- PR head, staging deployment, integrated CI, and live Staging E2E SHA: PENDING.
- Promotion gate, production marker, and focused learner/operator smoke: PENDING.
