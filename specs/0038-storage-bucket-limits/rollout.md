# Rollout and rollback

## Preconditions

- STORAGELIMITS-0038 approved on `staging`; T002 (PC-J133) merged.
- The six buckets exist (343 aborts otherwise). Before an initial 343 apply,
  confirm the pre-343 T001 values (`NULL`, `NULL`) read-only. Staging already
  has 343 in its ledger at 2026-11-02 01:51:21Z: do not edit or replay it.
- The T002 backend (pre-checks and Speaking normalisation) is deployed to the
  target environment before 343 is applied, so no client type is refused by
  the bucket while the old code runs.

## Staging

1. Initial rollout: Leader applies 343 with the advisory-locked runner.
   BUCKET50 a follow-up (Vinh t1246u 02/11 06:37): deploy PC-J522's 50 MiB
   shared helper, then Leader applies 362 in `storage_bucket_limits` under
   the advisory lock; merging alone applies nothing.
2. Run the read-only postcheck in the 343 header: six rows equal to the limit
   table after 343 → 362, `listening-audio.file_size_limit = 52428800`,
   `public` unchanged (`writing-images` false, `vocab-audio` true).
   WM verifies a synthetic audio upload at 50 MiB succeeds and an upload
   one byte over gets 413 without creating an object. This remains pending
   Leader's apply; release 1mg (PC-J484) only after these checks pass.
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
343 and 362 under the advisory lock, run the postcheck. Neither production
read nor apply is authorized in PC-J522. No production write probes.

## Rollback and repair

- Rollback: the down script in the 343 header sets `file_size_limit` and
  `allowed_mime_types` back to the recorded pre-apply values (staging `NULL`,
  `NULL`) for the six ids. Safe at any time; it writes no object and leaves
  `public` alone.
- To undo BUCKET50 alone, use 362's down script under the same lock: restore
  only the historical Listening size, preserving all MIME and visibility
  settings. The project cap and 50 MiB helper still apply. Reconcile the
  forward ledger before reapplying; never edit or blindly replay 343.
- If a legitimate upload is refused after apply, report the bucket, size and
  type to Leader before widening the approved table or project cap.
- No data to repair: 343 does not touch existing objects.

## Observability

- FastAPI logs: `[storage_limits]` warnings with bucket, `error_code`, size
  and declared type (no path, no user id) for every 413/415, including mapped
  Storage refusals.
- Watch Speaking after apply: `responses.audio_storage_path` null rate and
  `recording_storage_unavailable` 503s should not rise; a rise means roll back.
- Owner: product owner; the Leader reports T003 on the PR.
