# Verification

## Requirement coverage

No endpoint implementation, canonical repair or release evidence is claimed.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | L1 guarded canonical read/projection and stable fingerprint tests | PENDING |
| FR-002 | Strict focus/revision/operation shape and size validation tests | PENDING |
| FR-003 | Whole-state CAS, parent/question/FK locks, legacy empty-state and preservation evidence | PENDING |
| FR-004 | Competing edits and unchanged-timestamp source/metadata import tests | PENDING |
| FR-005 | No-op, lost ACK, operation reuse and concurrent retry receipt tests | PENDING |
| FR-006 | Atomic audit failure, bounded receipt lookup and unrelated non-JSON log tests | PENDING |
| FR-007 | OpenAPI/error/read-after/runtime contract checks | PENDING |
| FR-008 | Independent source parse, reviewed one-analysis diff and canonical read-after | PENDING |
| FR-009 | Separate approval, exact-SHA staging/release and bounded production/restore evidence | PENDING |

## Discovery evidence

- Production read probe confirms wrong first `analysis`; audit artifact
  `evidence/production-canonical-probe.json` captured2026-09-30.
- Local staging probe contains no copy of this record; it cannot prove repair.
- Existing import updates passage payload/metadata then deletes/reinserts
  comprehension questions; existing admin L1 list omits full metadata.
- Existing database transaction and governance audit schemas are present in
  source; actual configured environment availability remains to be verified.

## Contract evidence

- Models/OpenAPI, strict validation and existing consumer compatibility: pending.
- Atomic transaction transport with long translated metadata: pending.

## Data evidence

- Full unrelated fields/metadata and question IDs/hashes preserved: pending.
- Concurrency/no-op/retry/receipt and audit-failure rollback: pending.

## Academic evidence

- Proposed corrected analysis is in the external council evidence report.
- Second reviewer, actual source-text match and exact field diff: pending.

## Release evidence

- Spec approval and implementation PR/head: pending.
- Exact staging frontend/backend SHA and synthetic journey: pending.
- Actual production read-before/operation/read-after/restore evidence: pending.
