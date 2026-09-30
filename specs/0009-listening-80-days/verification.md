# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | Full day/item/source inventory and stable-ID validation | PENDING |
| FR-002 | Immutable source and release SHA-256 attestation | PENDING |
| FR-003 | Full question-block geometry and source-content review | PENDING |
| FR-004 | Asset coverage validation plus special-day journeys | PENDING |
| FR-005 | Collection navigation, resource and eligible practice journeys | PENDING |
| FR-006 | Report-only/source numbering/denominator regression tests | PENDING |
| FR-007 | Complete authored explanation and limitation inventory | PENDING |
| FR-008 | Independent item-audit ledger and correctness exclusion tests | PENDING |
| FR-009 | Private asset authorization and truthful timing tests | PENDING |
| FR-010 | Pre-reveal protected-field and image leakage checks | PENDING |
| FR-011 | Saved/first/revised/reloaded/technical-error journeys | PENDING |
| FR-012 | Dry-run/idempotency/publish/archive coexistence tests | PENDING |
| FR-013 | OpenAPI/type, migration and compatibility checks | PENDING |
| FR-014 | Mobile/desktop, light/dark, keyboard and failure-state journeys | PENDING |
| FR-015 | Independent review, local gates and exact release evidence | PENDING |

## Initial evidence

Worktree: `/Volumes/Kingston SSD/Code/ielts-listening-80-days`.
Discovery branch: `codex/listening-80-days`; starting staging SHA: `10b45543`.
Implementation branch: `codex/listening-80-days-implementation`, based on the
approved staging commit `018c2c6702f541a21c59a626bb19c815eab205a1`.
Read-only source/web/reviewer findings are in the task's external
`80-days-listening-preview/phase-1-*` folders. Their source inventory is evidence
for preparation only, not published content or completed semantic review.

## Release evidence

- Specification-only approval: PR #1547 merged on 2026-09-30 as staging SHA
  `018c2c6702f541a21c59a626bb19c815eab205a1`. Independent reviewer accepted
  all six specification documents; required checks passed for PR head
  `c93b637b84a93153172f70a78dcd9b0a49a7e806`. Local validator contract tests:
  88 passed. Pre-push backend baseline: 8,884 passed, 355 skipped; skipped
  provider/live/PostgreSQL tests do not certify those contracts.
- Implementation PR/current head and local verification: pending.
- Package manifest, unpublished import and reviewed inventory: pending.
- Staging SHA, integrated checks and live source-collection journeys: pending.
- Production promotion SHA, deployed markers and package publication: pending.
