# Implementation plan

## Architecture impact

- `backend/routers/auth.py`: only the `_rate_limit_activate` block. The call
  site (first statement after `get_supabase_user`) is unchanged.
- `backend/migrations/334_activate_attempt_rate_limit.sql`: new table and RPC.
- `frontend/lib/login-model.mjs` + `frontend/app/(public-auth)/login/login-behavior.tsx`:
  error-code mapping for a refused activation.

## Data and contracts

- RPC `fn_activate_attempt_check(p_user_id uuid) → jsonb {allowed: bool, retry_after_s: int}`,
  `SECURITY DEFINER`, `search_path = ''`, EXECUTE `service_role` only.
- 429 `detail {error_code: "activate_rate_limited", retry_after_s, message}` +
  `Retry-After`; 503 `detail {error_code: "activation_unavailable", message, ref}`
  (built with `services.errors.safe_error`, so the central 5xx sanitizer keeps it).
- Success schema (`AuthActivateResponse`), path and body unchanged → no OpenAPI
  or `api.d.ts` change.
- Backward compatibility: the old backend never touches 334's objects. The old
  `/login` shows "Kích hoạt thất bại (HTTP 429)" for the new dict detail until
  the frontend deploys (same release).

## UI and interaction

- `/login` activation dialog error line only; see `ui-states.md`.

## Work decomposition

- T002 migration → T003 PG tests → T004 backend → T005 frontend → T006 README.

## Rollout and rollback

- Apply 334 before the backend (the new backend fails closed without it). See
  `rollout.md`.

## Verification strategy

- `backend/tests/test_migration_334_activate_attempt_rate_limit.py` on PG 16 and
  17 (grants, two-connection race + negative control, burst, expiry, prune,
  re-run, rollback note, postcondition).
- `backend/tests/test_activate_rate_limit.py` (AC1–AC5; AC1/AC2 with two real
  processes and PostgreSQL).
- `frontend/tests/login-next-model.test.mjs`, `login-next-behavior.test.mjs`.
- Staging: header postcheck query and an 11-attempt QA probe.
