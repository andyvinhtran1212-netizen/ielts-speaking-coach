# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_validate_specs.py::test_repository_accepts_complete_verified_feature | PASS |
| FR-002 | kind=check; ref=backend/scripts/validate_specs.py --root . | PASS |
| FR-003 | kind=test; ref=backend/tests/test_validate_specs.py::test_repository_rejects_stale_active_index_title | PASS |
| FR-004 | kind=test; ref=backend/tests/test_validate_specs.py::test_repository_rejects_underspecified_manual_and_na_evidence | PASS |
| FR-005 | kind=test; ref=backend/tests/test_validate_specs.py::test_prior_approval_must_exist_at_topic_merge_base | PASS |
| FR-006 | kind=test; ref=frontend/tests/staging-first-release-flow.test.mjs | PASS |
| FR-007 | kind=check; ref=backend/tests/test_validate_specs.py::test_repository_accepts_complete_verified_feature | PASS |
| FR-008 | kind=command; ref=git diff --check | PASS |

## Contract evidence

- No HTTP, OpenAPI, generated API type, or application contract changed.
- PR metadata contract is parsed from `Change class:` and `Spec:` lines.

## Data evidence

- No SQL migration, data script, schema, RLS, or storage change.

## UI evidence

- Not applicable: no rendered product surface changed.

## Release evidence

- Local repository validation: PASS.
- Focused pytest: PASS.
- Integrated PR/staging evidence: pending the normal GitHub workflow run and
  will be linked in the pull request rather than fabricated in this file.
