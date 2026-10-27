# Rollout and rollback

## Preconditions

- ASSIGNDRAFT-0027 approved on `staging` (this PR); #1732 already on `staging`.
- Production read-only checks P1–P5 (`research.md` §7): pending Vinh's
  read-only permission (chờ anh Vinh cho phép chạy chỉ đọc). P2 (orphan drafts)
  must be 0 and P1 must show the 037 CASCADE FK before applying.
- Ledger order: 324 may land before 321/322/323; the README allows a non-dense
  sequence and the runner applies unapplied files regardless of order.

## Staging

- Merge the implementation PR, dry-run then apply 324 with the advisory-locked
  runner, deploy the backend at the merged SHA.
- Run `research.md` §8 AC-1…AC-8 with E2E learners from `staging_seed.py`.

## Production

- Apply at the staging → main promotion with Vinh's explicit authorization.
- After apply: P1 shows `confdeltype = 'a'`, validated; P3 counts unchanged.

## Rollback and repair

- Rollback SQL (`research.md` §5) restores `ON DELETE CASCADE`; it changes no
  row but reopens the draft-loss hole. Use only if NO ACTION blocks a legitimate
  flow (for example a purge) that cannot be fixed forward quickly; ship it as a
  new forward migration.
- Backend rollback is independent: the guard simply never sees 23503.

## Observability

- Backend logs and responses: 409 `Học viên đã bắt đầu — không xoá được` counts
  on the two DELETE routes; zero 500s with `writing_drafts_assignment_id_fkey`.
- Owner: Vinh (product); the implementing agent reports AC results on the PR.
