# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_343_storage_bucket_limits.py (static contract, apply, double apply, missing-bucket abort, postcondition) plus the staging header postcheck (T003); not written yet | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_343_storage_bucket_limits.py (down script restores NULL, NULL and leaves public) plus T004 production pre-apply read; not written yet | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_storage_limits.py (oversize and wrong type per upload path → 413/415 body, no upload call) plus staging AC 1 (T003); not written yet | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_storage_limits.py (stubbed Storage 413 and mime refusal → 413/415 or mapped importer error, never 500) plus staging AC 5; not written yet | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_storage_limits.py (Speaking normalisation, 413 before transcription, Storage refusal → 413/415) plus staging AC 6 real-browser Speaking submit and Staging E2E; not written yet | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_migration_343_storage_bucket_limits.py (no public write) plus staging AC 4 (writing-images public=false, signed URL loads); not run yet | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_storage_limits.py (census max sizes and route limits pass) plus staging AC 2 synthetic uploads; not run yet | PENDING |

## Contract evidence

- OpenAPI/type drift: error `detail` objects for 413/415 only; to be checked
  in T002.

## Data evidence

- T001 census (staging, read-only, 2026-10-29 11:24:57Z): six buckets, all
  `file_size_limit = NULL`, `allowed_mime_types = NULL`; largest objects and
  mimetypes in [`research.md`](research.md). Project-wide limit 50 MiB.
- Postcheck after 343 on staging: pending T003.

## UI evidence

- No UI code changes; message rendering through `api.js` `detail.message` to
  be checked in T003. Content Manager wording review: T005.

## Release evidence

- Staging SHA, ledger row and postcheck: pending T003.
- Production: pending T004 (owner authorization at promotion).
