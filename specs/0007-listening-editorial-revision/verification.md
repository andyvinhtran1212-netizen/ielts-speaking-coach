# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=check; ref=translation-batch-01-draft.json exact prompt/option comparison with v1.0 package; runtime validator pending | PENDING |
| FR-002 | kind=check; ref=REVIEW.md source hashes; new revision not built | PENDING |
| FR-003 | kind=check; ref=lesson-metadata-draft.json 65/9/5 source comparison; editorial review pending | PENDING |
| FR-004 | kind=check; ref=translation-batch-01-draft.json; 44/1045 drafted, review pending | PENDING |
| FR-005 | kind=test; ref=frontend/tests/listening-programme-learning.test.mjs; new package-backed contract pending | PENDING |
| FR-006 | kind=report; ref=new revision full package validation and dry-run pending | PENDING |
| FR-007 | kind=journey; ref=staging unpublished import and explicit owner decision pending | PENDING |
| FR-008 | Owner selected new-start drain; migration and active-attempt staging query pending | PENDING |
| FR-009 | Bilingual museum-map labels, accessible alternatives and theme/mobile journeys pending | PENDING |

## Contract evidence

- OpenAPI/type drift: pending contract design and implementation.
- Backward compatibility: v1.0 player/attempt regression pending.

## Data evidence

- Migration/schema query: determine whether existing JSONB contract suffices.
- Immediate state versus full reload: pending staging verification.

## UI evidence

- Viewports/themes/input methods: pending complete-form bilingual implementation.

## Release evidence

- Staging SHA and checks: pending.
- Production verification: delegated authority is recorded in REVIEW.md, but
  exact-SHA staging, drain and promotion gates remain pending.
