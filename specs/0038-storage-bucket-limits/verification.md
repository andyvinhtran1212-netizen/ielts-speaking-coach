# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_migration_343_storage_bucket_limits.py; ref=backend/tests/test_migration_362_listening_audio_bucket_50_mib.py — historical 343 and 343 → 362 current table, repeat, missing-bucket and postcondition abort; staging BUCKET50 postcheck remains T007 | PENDING |
| FR-002 | kind=test; ref=backend/tests/test_migration_343_storage_bucket_limits.py; ref=backend/tests/test_migration_362_listening_audio_bucket_50_mib.py — 343 down restores T001 NULL/NULL; 362 down restores historical Listening size and reapply succeeds; production pre-apply read remains T004 | PENDING |
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

## CI fix round R2 (PC-J133R, 2026-10-31)

- CI run 41117776949 on `a80009b6f` was red in two places that the run above
  skipped or did not include (it had no `TEST_PG_URL`, and the node suite was
  not run):
  - `tests/test_client_write_invariant_postgres.py`: the invariant harness
    applies every forward migration ≥ 320, and 343 aborted with
    `relation "storage.buckets" does not exist`. The harness now models the
    Supabase platform `storage` schema in `_create_database()`, beside `auth`:
    a superuser-owned `storage.buckets` with the six T001 rows (NULL/NULL;
    `vocab-audio` public) and only `USAGE` + `SELECT, UPDATE` for the
    NOSUPERUSER runner. The migration and its own 343 harness are unchanged.
  - `frontend/tests/sprint-20-14f-alpha-diagram-image.test.mjs` pinned
    `raise HTTPException(exc.http_status, str(exc))`. FR-003 intentionally
    makes 413/415 carry the structured body, so the pin now requires
    `exc.detail` and also pins `InvalidImageError.detail` (structured body for
    413/415, original text otherwise). `api.js` already reads `detail.message`.
- Red: both failures reproduced locally on `a80009b6f` (PG 16.2; Node 24.22.2).
  Green: invariant + 343 files 39 passed on PG 16.2 and on PG 17.11; the node
  file 27/27, with negative controls (router back to `str(exc)`, or 415 dropped
  from the service mapping) each failing it.
- Full backend `tests/` with `REQUIRE_PG=1` and the CI `*_TEST_DATABASE_URL`s
  on a local PG 16 cluster: **14,871 passed, 47 skipped, 0 failed**. Full node
  suite (CI command, Node 24): **13,375 passed, 1 skipped, 0 failed**.
- Merge of staging `69a09c923` (`fb545ea23`) resolved a conflict with PC-J250
  in `admin_upload_map_image`: `raise_storage_error` first, then PC-J250's
  static 500. CI on `fb545ea23`: Tests run 41138817729 success, 17/17 checks.
- Codex P2: an FR-005 Storage refusal (and the retry-safe 503) skipped the
  Whisper usage log after a paid transcription (AI-0004). `9aa0218ed` logs
  usage right after STT; the Speaking refusal test asserts it (red 2 failed,
  green 522 passed / 1 skipped over the grading/usage test files).

## Data evidence

- T001 census (staging, read-only, 2026-10-29 11:24:57Z): six buckets, all
  `file_size_limit = NULL`, `allowed_mime_types = NULL`; largest objects and
  mimetypes in [`research.md`](research.md). Project-wide limit 50 MiB.
- PC-J522 read-only Management API result: 343 applied on staging at
  `2026-11-02T01:51:21.569448+00:00`; historical Listening bucket size still
  `134217728`, MIME types unchanged and `public = false`. Request explicitly
  used `read_only: true` and reported `transaction_read_only = on`.
  Raw evidence: job log directory `staging-ledger-readonly.json{,.result}`.
- Postcheck after 362 on staging: pending T007 (Leader apply, then WM retest).

## UI evidence

- No UI code changes; message rendering through `api.js` `detail.message` to
  be checked in T003. Content Manager wording review: T005.

## Release evidence

- Initial 343 ledger row confirmed above; complete T003 acceptance is pending.
- BUCKET50 staging SHA, 362 ledger row and 50 MiB upload: pending T007.
- Production: pending T004 (owner authorization at promotion).

## BUCKET50 a, Vinh t1246u 02/11 06:37 (PC-J522)

- Immutable 343 SHA-256:
  `2a69754254b66627e12aa4a1f37f05267b0e53141b81c4d14db24f344aa9cc5b`.
- Migration 362 changes only the Listening bucket size to 52 428 800
  (50 MiB); the shared helper and renderer/audio boundaries use the same
  policy. Existing full-test/pack route-guard tests retain their stricter
  route checks and add effective-cap oversize coverage.
- Known limitations: historical source importer 128 MiB
  (`listening_source_package_import.py:344`), full test 100 MiB and pack
  60 MiB remain unchanged. Job 1mg (PC-J484) owns that alignment after T007.
- Local PostgreSQL 17: 176 passed in the affected storage, migration,
  invariant, renderer and audio suites; one README numbering wording check
  initially failed. After fixing README, forward-policy + migration 362
  recheck: **17 passed, 0 skipped**. No test assertion was weakened. The
  cluster used SCRAM host auth on loopback and was stopped/deleted afterwards.
- Full backend `python -m pytest tests/ -q`: **15,823 passed, 1,837 skipped**,
  33 warnings, 923.96 s, exit 0. The full run had no PostgreSQL/live-provider
  opt-ins; the affected PostgreSQL cases were covered without skips above.
  Existing background-task shutdown logging errors followed the passing
  summary. Logs: `storage-tests.log`, `storage-recheck.log`, `full-backend.log`
  in the PC-J522 job log directory.
- `validate_specs.py`: 49 specs passed; `git diff --check` passed. Exact-head
  PR CI evidence belongs on the PR. No hosted migration, upload, production
  read or merge in this job; T007 remains pending.
