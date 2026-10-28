# Research record — GIVEARCHIVE-0031

> Condensed from the reviewed draft that Vinh approved
> (`/workspace/specs-drafts/STUDENT-GIVE-RACE-spec.md`). Code was read at
> `origin/staging@7c7338f09` (STUDENTARCHIVE-0029 merged); `5a41a3a9a`
> changed only an unrelated spec. **No database was queried or written** while
> preparing this spec or its implementation. The canonical contract is
> `spec.md`.

## 1. Origin

- Codex P2 on PR #1746 (comment 4385047971) on
  `backend/routers/admin_writing_assignments.py`: the archived pre-check and the
  insert are separate statements. Acknowledged by the implementer (4385052713);
  Vinh deferred it to a separate spec with a database-level guard
  (4385148841, 2026-10-27 11:42 UTC+7).

## 2. Inventory of `writing_assignments` writers

| # | Writer | Kind | Guarded by 331 | Backend mapping |
| --- | --- | --- | --- | --- |
| W1 | `fn_create_writing_assignments_idempotent` (live = 228; earlier bodies 206, 227): admin individual give with `request_id` and admin fan-out with `request_id` | SQL `INSERT … SELECT` (Cartesian) | yes | both RPC `except` blocks in `routers/admin_writing_assignments.py` |
| W2 | admin legacy individual insert (`create_assignments`, no `request_id`) | PostgREST bulk insert (service role) | yes | wrapped insert, same router |
| W3 | instructor `create_assignment` | PostgREST insert via `instructor_db` (service role) | yes | wrapped insert, `routers/instructor.py` |
| W4 | `fan_out_assignment` (admin legacy fan-out, instructor fan-out via `instructor_fan_out`) | PostgREST bulk insert | yes | wrapped in the service |
| W5 | `backfill_cohort_writing_assignments` (`/auth/activate` Step 6, `scripts/backfill_class_enrollment_roster.py`) | PostgREST bulk insert | yes | wrapped in the service; Step 6 logs, the script skips |
| W6 | manual SQL / future code | `INSERT` | yes | n/a |
| — | `fn_create_class_assignment`, `fn_backfill_assignment_items`, exam scope RPCs | write `class_assignments` / `class_assignment_items`, not `writing_assignments` | n/a | n/a |
| — | `UPDATE writing_assignments` in routers/services (status, deadline, instructions, claim, renderer affinity) | never changes `student_id` | trigger fires only when `student_id` is in the SET list, and returns at once when it is unchanged | n/a |

`git grep` finds no other `INSERT INTO writing_assignments` in
`backend/migrations` and no other `.insert/.upsert` on the table in `backend/`.

Existing `BEFORE INSERT` triggers on the table: `core_capture_writing_origin`
(249, retired in the forward policy but possibly present), and
`trg_guard_writing_give_cohort_active` if A-10 / migration 330 lands. Both sort
after `archive_guard_writing_assignment_student`.

## 3. Lock analysis

- `fn_archive_student` / `fn_restore_student` (326) start with
  `SELECT … FROM public.students WHERE id = p_student_id FOR UPDATE`, then write
  `archived_at`. The 331 trigger takes `FOR KEY SHARE` on the same row, which
  conflicts only with `FOR UPDATE` and with key-changing updates/deletes.
- Archive first: the give's `FOR KEY SHARE` waits; under READ COMMITTED the
  locking read returns the newly committed row version, sees `archived_at` and
  raises. Give first: the archive's `FOR UPDATE` waits until the give commits;
  the give is then legitimate history and the archive ends memberships as usual.
- `FOR KEY SHARE` is the lock the FK check on `student_id` already takes, so 331
  adds no new conflict with the 326 membership writers (`FOR NO KEY UPDATE`),
  other gives or profile edits. `FOR SHARE` was rejected: it would block behind
  every student update and could deadlock with
  `fn_add_students_cohort_membership` (which locks in id order while bulk
  inserts lock in arbitrary order).
- Pre-existing deadlock: the cohort RPC locks memberships `FOR SHARE`, then
  (FK, now also 331) the student row; the archive locks the student `FOR UPDATE`,
  then updates memberships. PostgreSQL aborts one with 40P01; both are single
  transactions, so neither leaves partial state. 331 neither creates nor widens
  this window.
- SECURITY DEFINER: row locks need UPDATE privilege on `students`, which 320
  revoked from client roles; the lock must hold whoever inserts.

## 4. Alternatives and follow-ups

1. Re-create the 228 RPC with a student lock — rejected: does not cover W2–W6
   and duplicates a large body.
2. Python `SELECT … FOR UPDATE` before the insert — rejected: PostgREST runs one
   statement per transaction, so the lock cannot span the insert.
3. Map 40P01 (deadlock) and 40001 (serialization / `roster_changed` is already
   mapped) on the give routes to a retryable 409 — recommended as a separate
   `small` follow-up, not implemented here.
4. Composite FK on an "active" key — rejected: it would make the archive itself
   fail on existing gives.
5. `RETURN NULL` (skip the archived learner's row in a class give) — rejected by
   decision 2: it silently drops the row and makes the receipt count lie.

## 5. A-10 / migration 330

Migration 330 (A-10, CLASSARCHIVE-0030) is not written yet. It must not drop,
replace or disable `archive_guard_writing_assignment_student` or
`fn_guard_writing_assignment_student_archived()`, must not insert into
`writing_assignments` with triggers disabled (`session_replication_role`,
`DISABLE TRIGGER`), and if it re-creates `fn_create_writing_assignments_idempotent`
the insert must stay a plain `INSERT INTO writing_assignments` so the guard
fires. `test_no_other_migration_drops_replaces_or_bypasses_the_guard` in
`backend/tests/test_migration_331_archived_student_give_guard.py` fails on any
such file regardless of its number.

## §R Retest plan

### Assignment Tracker (database, read-only — approved for staging, and production at promotion)

- **R1 (catalog):**

  ```sql
  SELECT tgname, tgenabled, pg_get_triggerdef(oid)
    FROM pg_trigger
   WHERE tgrelid = 'public.writing_assignments'::regclass
     AND NOT tgisinternal
   ORDER BY tgname;
  ```

  Expect `archive_guard_writing_assignment_student` first, enabled `O`,
  `BEFORE INSERT OR UPDATE OF student_id … FOR EACH ROW`.
- **R2 (privileges):**

  ```sql
  SELECT p.prosecdef, p.proconfig, p.proacl
    FROM pg_proc p
   WHERE p.oid = 'public.fn_guard_writing_assignment_student_archived()'::regprocedure;
  ```

  Expect `prosecdef = t`, `search_path=public, pg_temp`, no `anon` /
  `authenticated` EXECUTE.
- **R3 (candidates from the old race):**

  ```sql
  SELECT wa.id, wa.student_id, wa.status, wa.created_at, s.archived_at,
         (SELECT max(a.created_at) FROM public.student_lifecycle_audit a
           WHERE a.student_id = s.id AND a.action = 'archive') AS archive_logged_at
    FROM public.writing_assignments wa
    JOIN public.students s ON s.id = wa.student_id
   WHERE s.archived_at IS NOT NULL
     AND wa.created_at > s.archived_at
   ORDER BY wa.created_at;
  ```

  Expect 0. `created_at` is the transaction start, so any row is a candidate
  only: confirm against `student_lifecycle_audit` and request receipts and send
  it to Vinh. Run before apply, after apply and after the Web Manager journey.
- **R4 (after the journey):** R3 returns 0 for the archived E2E learner; no
  `writing_assignment_requests` row exists for W1's refused `request_id`; no
  `writing_assignments` row exists for the refused fan-out; no
  `core_writing_origins` row (if the table exists) points at a missing
  assignment.
- **R5 (write-then-rollback probe): not approved** (decision 3). Not run.

### Web Manager (UI on staging, E2E accounts only)

- **W1:** Archive an E2E learner; from an admin "Giao bài" tab opened before the
  archive, give them a prompt. Expect "Học viên đã được lưu trữ — khôi phục hồ
  sơ trước khi thao tác." and no new row after a reload.
- **W2:** The same from the instructor dashboard (stale tab).
- **W3:** Give to a class of active E2E learners: success, receipt count =
  learners × prompts.
- **W4:** Restore the learner and give again: success; the learner sees it on
  `/writing/dashboard`.
- **W5:** An existing give of another learner can still be edited (deadline)
  and submitted.

The millisecond race cannot be reproduced reliably in a browser; it is proven
by the two-session tests, including the negative control.
