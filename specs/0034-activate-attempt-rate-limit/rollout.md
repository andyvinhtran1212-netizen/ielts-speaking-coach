# Rollout and rollback

## Preconditions

- `service_role` exists (Supabase). Migrations 332/333/335 are independent of 334.
- The owner has approved ACTIVATELIMIT-0034.

## Staging

1. Dry run through the Management API: `BEGIN;` + 334 body + header postcheck + `ROLLBACK;`.
2. Apply under `pg_advisory_lock(173204,1)`: ledger re-check, 334, `INSERT INTO _schema_migrations`, unlock; confirm no lock with classid 173204 remains.
3. Run the header postcheck: `t|t|f|f|t`.
4. Deploy the 0034 backend and frontend (merge to `staging`).
5. QA probe: one QA account, 11 activation attempts with an unknown code within 10 minutes → 10 × 400, then 429 with `Retry-After`; a valid code tried while refused stays unused.

## Production

- Owner's explicit authorization at the `staging` → `main` promotion. Apply 334
  under the advisory lock BEFORE the backend is promoted, then run the postcheck
  read-only. Watch `/auth/activate` 503s for 1 hour after promotion.

## Rollback and repair

- Code: revert the backend first (the old backend ignores 334).
- Schema: the header rollback (a new forward migration) drops the function then
  the table, only after the pre-0034 backend is live; no data repair needed.
- A learner wrongly locked out waits at most 10 minutes; support can delete
  their rows as the migration owner if needed.

## Observability

- 503s log `[safe_error] ref=<ref> code=activation_unavailable context=activate rate limit user=<id>`; the client receives `ref`.
- 429s are visible as status 429 on `POST /auth/activate` in Railway HTTP logs.
- Owner: Feature Developer on call; alert if 503 `activation_unavailable` appears on staging or production.
