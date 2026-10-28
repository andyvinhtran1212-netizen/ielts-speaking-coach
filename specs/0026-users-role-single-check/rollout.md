# Rollout and rollback

## Preconditions

- ROLECHECK-0026 approved on `staging` (this PR).
- Migration 320 applied in the target environment (323 aborts otherwise).
- Production read-only checks P1–P6 done 2026-10-27 ~07:19 UTC+7 with Vinh's
  permission: both constraints identical to staging, 126 rows (user 125,
  admin 1), zero rows outside the set, zero NULL, 320 trigger enabled, ledger
  highest 320. Re-run P1/P4/P5 immediately before the production apply.
- Ledger order: 323 may land before 321 (#1727) and 322 (#1720). The README
  rules allow a non-dense sequence and the runner applies any unapplied file
  regardless of order, so this only leaves a temporary gap.

## Staging

- Merge the implementation PR to `staging`, run `backend/scripts/apply_migrations.sh`
  with `DRY_RUN` first, then apply 323 with the advisory-locked runner.
- Run `research.md` §8 AC-1…AC-14 with the E2E namespace from
  `backend/scripts/staging_seed.py`, never with real accounts; clean up after.

## Production

- Apply only with Vinh's explicit authorization at the staging → main promotion.
- After apply: P1 shows a single validated `chk_users_role`; P3 unchanged
  (user 125, admin 1 or the counts captured just before); one instructor
  promotion of an account Vinh names.

## Rollback and repair

- Preferred: forward fix. Rollback re-creates A-05.
- Guarded rollback (`research.md` §6): abort if any `student`/`instructor` row
  exists, otherwise re-add `users_role_check CHECK (role IN ('user','admin'))`.
  `NOT VALID` is not a safe shortcut because updates to instructor rows would
  then fail. Never touch the 320 trigger or grants as part of rollback.

## Observability

- Backend logs: HTTP 500 "Role update failed" and "Lỗi khi kích hoạt tài khoản"
  must drop to zero for valid roles.
- `access_code_audit` actions `promote_role` / `promote_role_rejected`.
- Owner: Vinh (product); the implementing agent reports AC results on the PR.
