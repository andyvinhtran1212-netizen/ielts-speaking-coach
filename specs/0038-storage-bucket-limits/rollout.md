# Rollout and rollback

## Preconditions

- STORAGELIMITS-0038 approved on `staging`; T002 (PC-J133) merged.
- The six buckets exist (343 aborts otherwise) and still hold the pre-343
  values from T001 (`NULL`, `NULL` on staging); re-run the T001 query
  read-only just before apply.
- The T002 backend (pre-checks and Speaking normalisation) is deployed to the
  target environment before 343 is applied, so no client type is refused by
  the bucket while the old code runs.

## Staging

1. The Leader applies 343 with the advisory-locked runner.
2. Run the read-only postcheck in the 343 header: six rows equal to the limit
   table, `public` unchanged (`writing-images` false, `vocab-audio` true).
3. AC 1–2 with synthetic files only (QA admin, QA prompts/papers): oversize
   and wrong-type uploads → 413/415, no object; the largest census size per
   bucket still uploads; delete only the synthetic objects created by the
   test.
4. AC 4: open a Writing chart via signed URL.
5. AC 6: real-browser Speaking submit on `staging.averlearning.com`; Staging
   E2E green.

## Production

Only with Vinh's explicit authorization at the `staging` → `main` promotion:
run the T001 query and the `config/storage` read on production (read-only),
report any bucket outside the six and any non-NULL current value (amend the
down script before continuing), confirm the T002 backend is deployed, apply
343 under the advisory lock, run the postcheck. No production write probes.

## Rollback and repair

- Rollback: the down script in the 343 header sets `file_size_limit` and
  `allowed_mime_types` back to the recorded pre-apply values (staging `NULL`,
  `NULL`) for the six ids. Safe at any time; it writes no object and leaves
  `public` alone.
- If a legitimate upload is refused after apply: roll back 343 first (restores
  today's behaviour), then widen the table in a spec revision.
- No data to repair: 343 does not touch existing objects.

## Observability

- FastAPI logs: `[storage_limits]` warnings with bucket, `error_code`, size
  and declared type (no path, no user id) for every 413/415, including mapped
  Storage refusals.
- Watch Speaking after apply: `responses.audio_storage_path` null rate and
  `recording_storage_unavailable` 503s should not rise; a rise means roll back.
- Owner: product owner; the Leader reports T003 on the PR.
