# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_343_storage_bucket_limits.py — PG17 apply twice, exact table, missing-bucket atomic abort and forced postcondition failure; staging postcheck remains T003 | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_343_storage_bucket_limits.py — header down restores T001 NULL/NULL and reapply succeeds; production pre-apply read remains T004 | PENDING |
| FR-003 | kind=test; ref=backend/tests/test_storage_limits.py | PASS |
| FR-004 | kind=test; ref=backend/tests/test_storage_limits.py — SDK, legacy SDK and HTTP refusals; image/audio/Speaking/source-import paths, CLI wrapper and background-render failure; staging AC 5 remains T003 | PENDING |
| FR-005 | kind=test; ref=backend/tests/test_storage_limits.py — Speaking 50 MiB boundary, parameters, unknown types, 413 before STT, refused upload stops grading and thread offload retained; browser submit remains T003 | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_migration_343_storage_bucket_limits.py — public flags, unrelated bucket and objects unchanged, including down; ref=backend/tests/test_storage_limits.py — signed image preview paths still work; live signed reads remain T003 | PENDING |
| FR-007 | kind=test; ref=backend/tests/test_storage_limits.py — every T001 maximum, bucket boundary and existing manual-image/Listening route cap accepted against stub Storage; effective global-cap check remains T003 | PENDING |

## Contract evidence

- FastAPI error transport remains `{"detail": {...}}`; 413/415 now carry
  `error_code`, `message`, and `max_bytes` or `allowed`. No success-response
  or frontend type changes. Existing `api.js` consumers read `detail.message`;
  deployed rendering remains a T003 check.
- The existing Writing wrong-header test changes 400 → 415 under FR-003 and
  additionally asserts `unsupported_media_type` and the exact allowed list.
  Its no-service-call assertion is retained.

## Offline verification (PC-J133R resume, 2026-10-31)

- Worktree `/workspace/wt-q-1kg-j133r-a-st-mig343`, branch
  `q/1kg-j133r-a-st-mig343`; resumed drafts from `28fd53ddd`, updated without
  conflicts to staging `e64ab9043`.
- Red: prior job's Writing test reproduced `415 != 400`. New route tests then
  reproduced four Listening size/type contract failures (71 passed, 4 failed).
  Green: final focused run **222 passed**, including **87 storage-contract**
  tests and **9 migration checks** with `REQUIRE_PG=1` on local PostgreSQL 17.
- PostgreSQL used a disposable database on a job-owned loopback-only cluster,
  with SCRAM host auth and peer local auth. No staging/production connection,
  migration apply, census or data write was performed.
- Final full backend run: **13,536 passed, 1,382 skipped**, 397.24s. Skips
  include live/provider/integration opt-ins; they are not live acceptance evidence.
- The first full run had three failures: the draft had bypassed Speaking's
  `_MAX_BYTES` guard (restored and covered by the existing observation test);
  two source-inspection tests failed while source edits shifted line positions.
  Both inspection tests passed on unchanged staging and on the final patch,
  followed by the clean full run above. No test assertions were weakened.
- Pre-push and PR checks are recorded on the implementation PR's exact head.
- Test artifacts remain outside the repository in the resume job's `.log.d`.

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
