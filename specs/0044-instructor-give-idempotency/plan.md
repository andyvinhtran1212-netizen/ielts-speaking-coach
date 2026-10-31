# Implementation plan

## Architecture impact

- Database owns idempotency: migration 360 adds the ledger
  `instructor_writing_assignment_requests` and the SECURITY DEFINER RPC
  `fn_create_instructor_writing_give_idempotent` (`search_path = pg_catalog,
  pg_temp` with every relation and type `public.`-qualified, so a function
  created in `public` cannot shadow a built-in (SA-1); owner asserted in the
  postcondition; EXECUTE for `service_role` only). In one transaction it
  validates the request, refuses an owner that is not an active instructor or
  admin (SA-2), inserts the ledger row `ON CONFLICT (id) DO NOTHING` (a
  concurrent same-id request waits on the primary key), replays a completed
  receipt for the same owner/kind/payload or refuses, re-checks ownership,
  locks the active roster `FOR SHARE` (as 228), computes the allow + warn
  overlap, inserts with `grading_tier` and stores the receipt.
- Backend:
  - `services/instructor_give_service.py` (new): `replay_give` reads a
    completed receipt before the route pre-checks; `create_give` calls the RPC
    and maps refusals (409 mismatch / other owner / incomplete, 400 empty
    class, 403 via `PermissionError`, 422 backstop, 0029 409 for
    `student_archived`).
  - `routers/instructor.py`: `request_id: UUID` on `AssignBody` and
    `FanOutBody`; both routes: replay → existing W-3 pre-checks → RPC.
  - `services/instructor_access.py` / `services/cohort_assignment_service.py`:
    `instructor_fan_out_roster` / `verified_fan_out_roster` run the existing
    fan-out ownership gates and roster read without writing.
  - Unchanged: admin routes, `writing_assignment_requests`, 206/228, W-05
    (`routers/writing_student.py`), `fan_out_assignment` (still used by
    tests and the legacy service API).
- Frontend: `instructor-dashboard.tsx` keeps `giveRequest = {intent, id}` in a
  ref; `withRequestId(path, body)` reuses the id while the intent (account,
  impersonation target, route, body) is unchanged; a successful give clears it.

## Data and contracts

- `POST /instructor/assignments` body: + `request_id` (uuid, required).
  Response unchanged: the created `writing_assignments` row (a replay returns
  the stored row).
- `POST /instructor/assignments/fan-out` body: + `request_id`. Response
  unchanged: `{student_count, created_count, group_id, duplicates_warning,
  assignment_ids}`.
- New errors (wording signed by CM 31/10, see D6): 409 `Yêu cầu giao bài này đã được gửi trước đó với nội dung khác. Vui lòng tải lại trang rồi giao lại.`, 409
  `Yêu cầu giao bài này không thuộc tài khoản của bạn. Vui lòng tải lại trang rồi thử lại.`, 409 `Yêu cầu giao bài đang được xử
  lý. Vui lòng thử lại.` (not reachable in practice: the receipt is written
  in the same transaction), 422 when `request_id` is missing.
- `request_payload` = the body without `request_id` (`model_dump(mode="json")`),
  compared as jsonb; the ledger's `give_kind` separates the two routes.
- `frontend/types/api.d.ts` regenerated (two `request_id` fields, docstrings).

| Path | Before | After |
| --- | --- | --- |
| same give sent twice (lost response, second tab, API) | two gives | one give, same response twice |
| same `request_id`, other body or other route | n/a | 409, nothing written |
| `request_id` of another account | n/a | 409, nothing written |
| no `request_id` | 201 | 422, no DB call |
| admin giving from /instructor | instructor tier | unchanged (receipt in the new ledger) |

## UI and interaction

- See `ui-states.md`. No new component or copy on success; errors use the
  existing danger banner.

## Work decomposition

1. Spec (this directory) → approval.
2. Migration 360 + README + forward policy.
3. Backend service and routes; existing route tests updated to send
   `request_id` through a Python stand-in for the RPC (`tests/instructor_give_fake.py`).
4. Frontend dashboard + React/source/browser tests; regenerate `api.d.ts`.

## Rollout and rollback

- `rollout.md`: 360 on staging under the advisory lock **before** the backend
  that calls it; then the merged SHA; production only at an authorised
  promotion. Backend revert is safe at any time (the ledger is ignored);
  the schema rollback is in the 360 header.

## Verification strategy

- `backend/tests/test_migration_360_instructor_give_idempotency.py`: static
  contract; PostgreSQL behaviour (replay, mismatch per field and route, other
  owner, ownership re-check, active roster, overlap, archived learner rollback
  then retry, invalid input, privileges, postcondition abort); two sessions
  with lock observation (same id → one give, same receipt) for both kinds;
  bursts of three; negative control (two ids → two gives). PG 16 and 17.
- `backend/tests/test_client_write_invariant_postgres.py`: 360 applied through
  the locked runner as NOSUPERUSER; global client-privilege invariant holds.
- `backend/tests/test_instructor_give_idempotency.py`: route contract.
- Existing suites updated only to send `request_id` (isolation matrix, W-05,
  bounds, deadline, archive race, 0029).
- Frontend: `tests/react/instructor-dashboard-double-submit.test.tsx`
  (retry reuses the id, new give / changed give gets a new one; red on the
  old dashboard), `tests/instructor-dashboard-next.test.mjs`,
  `tooling/verify-instructor-dashboard-flow.mjs` (every give sends a UUID).
