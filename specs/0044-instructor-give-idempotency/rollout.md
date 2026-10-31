# Rollout and rollback

## Preconditions

- INSTRUCTORGIVE-0044 approved on `staging`.
- Migration 360 is `pending_feature` (group `instructor_give_idempotency`):
  merging does not apply it.
- Order matters: the new backend calls the RPC, so **360 is applied before
  the backend deploys** (otherwise both /instructor give routes return 500).
  The new frontend is harmless on the old backend (extra field ignored); the
  old frontend on the new backend gets 422 on a give until reload.
- No long transaction on `writing_assignments` is needed: 360 creates a new
  table and a function only (`lock_timeout = 5s`).

## Staging

1. Apply 360 with the advisory-locked runner and
   `MIGRATION_FEATURES=instructor_give_idempotency` (staging only, written
   authorization per the job rules).
2. Merge/deploy the PR SHA (Railway backend, Vercel frontend).
3. S1 (read-only): `to_regclass('public.instructor_writing_assignment_requests')`,
   `pg_proc` has `fn_create_instructor_writing_give_idempotent` with
   `prosecdef` and the pinned `search_path`; `has_function_privilege` false
   for `anon`/`authenticated`; RLS on, no policy.
4. S2 (AT, E2E/QA accounts only): give one prompt to a QA class, then replay
   the same POST body with the same `request_id` (DevTools "Replay XHR" or
   the API): 201 both times, identical body; read-only
   `select count(*) from writing_assignments where assignment_group_id = '<gid>'`
   unchanged; one ledger row.
5. S3: same `request_id` with another `name` → 409; another account → 409;
   no new rows.
6. S4 (read-only, after a week): no new pair of /instructor gives with the
   same `(assigned_by, student_id, prompt_id, name)` created < 60 s apart.

Do not delete existing duplicates (pair `8e0892b9`) or any assignment row.

## Production

Only with Vinh's explicit authorization at a `staging` → `main` promotion:

1. Apply 360 under the advisory lock before the backend is promoted.
2. Promote; P1 = S1 read-only; P2 = one QA-account give replay if Vinh allows
   a production write, otherwise skip.

## Rollback and repair

- Backend revert: safe at any time; the old backend never reads the ledger
  (gives become non-idempotent again).
- Schema rollback (after the backend revert): the SQL in the 360 header drops
  the function, then the table; only replay receipts are lost, every
  `writing_assignments` row stays.
- Repair: none needed; the change writes only new rows.

## Observability

- `[instructor-give] replayed request=… kind=… by=…` log lines on replays.
- 409 counts on the two routes; any 500 mentioning
  `fn_create_instructor_writing_give_idempotent` means 360 is missing.
- Owner: Vinh (product); Leader/AT for staging evidence.
