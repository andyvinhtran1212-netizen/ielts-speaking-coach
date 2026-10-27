# Rollout and rollback

## Preconditions

- CODEUNIQ-0028 approved on `staging` (this PR); #1733 already on `staging`.
- Production read-only checks P1–P6 (`research.md` §8): pending Vinh's
  read-only permission (chờ anh Vinh cho phép chạy chỉ đọc). Duplicates or
  non-canonical codes block the apply until a reviewed dedupe runs.
- Ledger order: 325 may land before 321–324; the README allows a non-dense
  sequence and the runner applies unapplied files regardless of order.

## Staging

- Merge, dry-run, apply 325 with the runner (no outer transaction), deploy the
  backend at the merged SHA, run `research.md` §9 AC-1…AC-8.

## Production

- Apply at promotion with Vinh's explicit authorization after clean P1–P6.
- After apply: P1 shows the unique constraint and validated CHECK; P2–P4 zero.

## Rollback and repair

- `ALTER TABLE public.access_codes DROP CONSTRAINT IF EXISTS chk_access_codes_code_canonical;`
  is data-safe but re-allows non-canonical codes.
- Do not drop `access_codes_code_key` where it predates 325 (staging); dropping
  uniqueness re-opens wrong-row activation. Any rollback ships as a new forward
  migration.
- Invalid index after a failed build: `DROP INDEX CONCURRENTLY public.access_codes_code_key;` then re-run 325.

## Observability

- Logs: `access_codes insert hit a unique violation; regenerating` warnings
  (expected to be rare); zero 500 "Lỗi khi tạo access codes" from 23505/23514.
- Owner: Vinh (product); the implementing agent reports AC results on the PR.
