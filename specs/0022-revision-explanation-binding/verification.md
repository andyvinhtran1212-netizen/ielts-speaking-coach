# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_explanation_version_reason_postgres.py (PR #1692); real PostgreSQL R+L × none / multiple / pinned / historical-only / single; negative control against migration 260; then staging approval query | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_class_assignment_service.py::test_scoped_exam_version_refusal_names_the_cause; frontend/tests/admin-class-homework-next-behavior.test.mjs (both shipped in #1689) | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_bind_revision_web_explanations.py (PR #1692); dry-run default, single paper, operator-named version | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_bind_revision_web_explanations.py (PR #1692); one case per refusal incl. canonical list, override, reviewed-change mismatch, malformed rows | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_bind_revision_web_explanations.py (PR #1692); row shape, identity, version, pending statuses, source untouched | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_bind_revision_web_explanations.py (PR #1692); plan SHA coverage, single insert, read-back; plus production read-back records | PENDING |
| FR-007 | kind=query; staging rehearsal and production read-back for C19T1 REV01 R+L on 2026-10-25 (plan SHAs e43b2e1d…, e459ba28…; import batches 67c47f5a…, f0212a9a…); learner tables compared before/after | PENDING |
| FR-008 | kind=query; locked-runner output for 319 on staging and production; migration number reconciled with #1699 | PENDING |

The 2026-10-25 C19T1 REV01 binding is recorded under FR-007 as executed with
owner approval; it is not evidence that 319 is deployed.
