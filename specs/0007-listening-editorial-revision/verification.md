# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=check; ref=translation-batch-01-draft.json exact prompt/option comparison with v1.0 package; runtime validator pending | PENDING |
| FR-002 | kind=check; ref=REVIEW.md source hashes; new revision not built | PENDING |
| FR-003 | kind=check; ref=REVIEW.md; 65/9/5 source comparison and owner text approval complete; new package application pending | PENDING |
| FR-004 | kind=check; ref=REVIEW.md and REVIEW-WAVE-02.md; 44/1045 owner-approved, 134 IELTS drafts pending review, remaining 867 General drafts local only | PENDING |
| FR-005 | kind=test; ref=frontend/tests/listening-programme-learning.test.mjs; new package-backed contract pending | PENDING |
| FR-006 | kind=report; ref=new revision full package validation and dry-run pending | PENDING |
| FR-007 | kind=journey; ref=staging unpublished import and explicit owner decision pending | PENDING |

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
- Production verification: not authorized; pending owner publish decision.
