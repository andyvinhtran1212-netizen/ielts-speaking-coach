# Verification

## Requirement coverage

| Requirement | Evidence and remaining check | Result |
| --- | --- | --- |
| FR-001 | Backend catalog test confirms 30 rows, B02 blocked and C4 refusal; staging flag-on check pending. | PENDING |
| FR-002 | One-recipient fan-out test and migration retry index pass; full live retry and group check pending. | PENDING |
| FR-003 | Private PostgreSQL 18 confirmed ownership, active membership, publication and deadline gates; staging auth check pending. | PENDING |
| FR-004 | React start/answer/reload passes; all 15 article targets exist and B02 is unavailable; staging browser check pending. | PENDING |
| FR-005 | 124 reviewed Quick Check questions frozen from 15 sources; source hashes match; read-only active release audit found 0 normalized prompt overlaps against 733 diagnostic/reserved items (280/231/222); staging smoke pending. | PENDING |
| FR-006 | Private PostgreSQL verified answer idempotency, terminal ledger, artifact link and mastery percent with score NULL; React reload passes; staging roster check pending. | PENDING |
| FR-007 | Private PostgreSQL verified two independent B04 assignments and frozen attempt snapshots; staging repeat check pending. | PENDING |
| FR-008 | Semantic controls, focus styles and responsive token CSS plus React interaction tests pass; real browser viewport/theme check pending. | PENDING |
| FR-009 | Full backend/frontend suites, both TypeScript boundaries and Next build pass; flag-off preserves completed history; staging rollback drill pending. | PENDING |

## Contract evidence

- OpenAPI/type drift: generated `frontend/types/api.d.ts` from current FastAPI schema; TypeScript passed.
- Backward compatibility: existing diagnostic assignment route and artifact remain separate; targeted regression tests passed.

## Data evidence

- Source audit: `06_KHO-BAI-TAP/MANIFEST-MASTER-30.tsv` lists canonical JSONL for all 30 lessons (3,100 items in total): 17 `ACTIVE`, 6 `BLOCKED-QA`, 3 `BLOCKED-CONTENT`, 2 `REVIEW-REQUIRED`, and 2 conditional active statuses. B02, B07 and B18 are `ACTIVE`, with 100 source items each. Their absence from `master30-assigned-practice/v1.json` means only that this assignment path has no reviewed practice package for them. The MASTER30 importer currently stores 30 lesson metadata rows and 733 diagnostic runtime items; it does not import the 3,100 source items as assignable practice. The v1 assignment package instead uses 15 Grammar Wiki Quick Check mappings. Source-bank status and assignment-package readiness are distinct.
- Migration/schema and practice-pool provenance: migration 307 applied and exercised against private PostgreSQL 18; 306 from concurrent Grammar PR must land first on staging. Authenticated role has neither RPC execute nor attempt-table SELECT.
- Immediate state versus full reload: private SQL terminal ledger and React reload tests pass; live staging check pending.

## UI evidence

- Viewports/themes/input methods: semantic radio/fieldset controls and shared design tokens implemented; viewport/theme browser check pending.

## Release evidence

- Staging SHA and checks: PENDING — implementation branch is isolated and migration 306 is still in concurrent PR #1563.
- Production verification: PENDING — this implementation has not been deployed.
