# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | `specs/_meta/constitution.md`; architecture assertions in validator tests | PASS |
| FR-002 | Six files under `specs/_templates/`; repository validator | PASS |
| FR-003 | Naming, metadata, file, section, ID, and index validator tests | PASS |
| FR-004 | Verified-state incomplete-task plus structured MANUAL/N/A evidence tests | PASS |
| FR-005 | Prior-base requirement approval, exact coverage, spec-free detail, and promotion-exemption tests | PASS |
| FR-006 | `typecheck.yml` invokes validator in an unfiltered lightweight job consumed by staging promotion | PASS |
| FR-007 | Updated `AGENTS.md` and `CLAUDE.md`; stale-path source scan | PASS |
| FR-008 | Final diff contains governance, tests, and top-level documentation only | PASS |

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
