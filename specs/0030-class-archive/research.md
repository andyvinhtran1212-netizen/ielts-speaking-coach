# Research and evidence — CLASSARCHIVE-0030

Code references are to `origin/staging` @ `823b3eda7` (2026-10-28). Staging
data comes from the read-only review of 2026-10-28 ~20:50 (UTC+7). It was
run against Supabase project `zjphffoujxkpltixsbzj` with
`/database/query/read-only`; the queries are listed in the review's §F17.
**Production has not been queried.** D6 authorizes the read-only checks in
§8. No SQL in this file has been run anywhere yet.

## 1. Current state

- `cohorts.is_active` (migration 060, `BOOLEAN NOT NULL DEFAULT TRUE`) is the
  only archive state. The table comment reads "Soft-archive via
  is_active=false". The partial index `idx_cohorts_is_active` is
  `WHERE is_active`.
- Archive and restore use `PATCH /admin/cohorts/{id}` with `is_active`
  (`backend/routers/cohorts.py` `update_cohort`, `updates["is_active"]` at
  :149–150). The route accepts `is_active` together with name and description.
  It records no audit, no actor and no reason.
- The admin UI has Lưu trữ/Khôi phục and an "Đã lưu trữ" filter
  (`frontend/app/(authed-admin-classes)/admin/classes/admin-classes-directory.tsx`).
  The confirm text at :279 ("được lưu trữ mềm; sĩ số và lịch sử không bị
  xóa") will be untrue after A-10 (FR-010).
- The roster source is `student_cohort_memberships`. Helpers in
  `services/class_membership_service.py` filter only `membership.is_active`:
  - `active_cohort_ids_for_student` :32–45, including the legacy-pointer
    fallback at :43–44;
  - `student_is_active_in_cohort` :111–120.
- Places that already filter `cohorts.is_active`:
  - `admin_writing_cohorts.py` (admin Writing class list);
  - `admin_overview.py`;
  - SQL `fn_vocabulary_set_visible`;
  - `vocabulary_sets.py` audience;
  - admin pickers through `getAdminCohorts({ isActive: true })`.

### 1.1 Staging counts (read-only, 2026-10-28)

| Measure | Value |
| --- | --- |
| `cohorts` | 3: inactive "QA Course 1 Resume 20261010" (`a8e68c89…`, `updated_at` 2026-10-10 13:29Z); active "E2E VOCABSETS-0020 · Lớp C2 giả"; active "QA-0029 archive E2E" |
| Active memberships in the inactive class | 3. None of the 3 learners is archived, and none has another active class. |
| Open Writing gives (`pending`/`in_progress`) in the inactive class | **4** |
| Usable class codes into the inactive class | 0 |
| `access_code_audit.action` | no CHECK (only the PK) |
| `fn_add_student(s)_cohort_membership`, sync trigger | 326-guarded: lock the learner row and raise `student_archived` |
| `fn_restore_student` | live on staging and production (326). Its CTE `back` skips only **deleted** classes. |
| `writing_assignments` triggers | `archive_guard_writing_assignment_student` (331), `trg_guard_writing_assignment_terminal_mutation`, `update_writing_assignments_updated_at` |
| Staging ledger | 320, 323–326, 331, 332, 334, 335 |
| Grants for `authenticated` | SELECT only on `cohorts`, `class_assignments`, `class_assignment_items`, `writing_assignments`, `students`; none on memberships. No FORCE RLS. |

With the first draft's backfill (`archived_at = updated_at`), deploying
would have hidden the class from those 3 learners at once and closed the 4
gives. FR-009 removes that: the migration sets `archived_at` on no row, so
the class remains a **legacy inactive class** with today's behaviour.

### 1.2 Migration number (D1)

- On `origin/*` branches and open PRs (2026-10-28):
  - 322 → #1837;
  - 333 → #1773 (spec);
  - 336 → #1853 (`336_suspended_account_role_guard.sql`, ADMINAAL2-0032 FR-019).
- No branch or open PR has a `337_*` file or claims 337.
- The README reserves 333–337 for the Leader. Vinh's D1=a assigns **337** to
  A-10.
- "330 A-10" in the README was never used: there is no file and no ledger
  row. The implementation PR rewrites that line.
- 337 runs after 326 and 331, so a fresh numeric replay meets
  `fn_restore_student` and the 331 precondition in a safe order.

## 2. Schema notes

- **`cohorts`:** `id, name, code_prefix, description, is_active, created_by,
  created_at, updated_at, course_id`. No trigger, not even for `updated_at`.
  - RLS policies: `"Admins manage cohorts"`, `"Admins read all cohorts"`,
    `cohorts_instructor_own`.
  - FKs into `cohorts`:
    - CASCADE: `class_assignments`, `class_lessons`, `exam_content_cohorts`,
      `student_cohort_memberships`;
    - SET NULL: `access_codes`, `mock_exams`, `students.cohort_id`,
      `writing_assignments.cohort_id`.
- **`student_cohort_memberships` (227):**
  - `UNIQUE (student_id, cohort_id)`;
  - CHECK `membership_left_state`;
  - no trigger;
  - service_role only.
- **Live functions that write memberships** (all SECURITY DEFINER,
  service_role only):
  - `fn_add_student_cohort_membership` and `fn_add_students_cohort_membership`;
  - `fn_remove_student_cohort_membership`, which may move the legacy pointer
    into another class;
  - the trigger `trg_sync_legacy_student_cohort_membership` (`AFTER INSERT OR
    UPDATE OF cohort_id ON students`), which upserts an active membership and
    is a no-op for NULL;
  - `fn_restore_student`.

  The class-work writers `fn_create_class_assignment` and
  `fn_backfill_assignment_items` take their roster from active memberships.
  None of these functions checks `cohorts.is_active`.
- **SQL learner gates that read memberships without checking the class:**
  - `quiz_start_timed_course_session` / `quiz_insert_timed_course_attempts`
    (264/265/270);
  - the Advanced Vocabulary guards and `start_advanced_vocab_practice` (282);
  - `create_assigned_grammar_lesson_attempt` /
    `record_assigned_grammar_lesson_answer` (312).

  Variant A for these is enforced by the Python gate in front of each RPC
  (§5).

## 3. Read paths (FR-001, FR-009)

The single choke point is `active_cohort_ids_for_student`. It now drops
**archived** classes (`NOT is_active AND archived_at IS NOT NULL`), in both
the membership branch and the legacy-pointer fallback. Legacy inactive
classes are kept, as today. Callers that need history pass
`include_archived=True`. The implementation inventories every caller in a grep
test and records which mode each one uses.

| Surface | Code | After |
| --- | --- | --- |
| `/my-class` | `GET /class/me` (`class_student.py` `my_class` :1005–), `_visible_writing_gives` :432; `frontend/lib/my-class-model.mjs` | Archived classes are omitted. If none remain, `has_class=false` and the "chưa có lớp" state shows. |
| `/home` tile and to-do count | `home-behavior.tsx` → `/api/class/me?summary=true` | Follows the helper. |
| `/class/my-assignments` | `class_student.py` :651 | Follows the helper. |
| `/writing/dashboard` list and detail | `writing_student.py` `GET /my-assignments` :1292, `/{id}` :1374 | Still listed. New fields: `class_archived: bool` and `archive_finish_allowed: bool` (D3). No "Làm bài" when closed; the draft is readable. |
| Mock exams by class | `mock_exam_service.py` `_user_in_cohort` :516 (used :196, :783) | Follows the helper. A learner whose class is archived gets "Lớp của bạn đã kết thúc — kỳ thi này không còn mở." instead of "Bạn không thuộc lớp…". In-progress sittings are not re-gated. |
| Course quiz by class | `quiz_service.py` (`allow_reaper_finalize` :827/868/900) | Follows the helper. The reaper branch is kept. |
| Vocabulary sets | `fn_vocabulary_set_visible`, `vocabulary_sets.py` | Unchanged: these already filter `is_active`, which also hides legacy inactive classes, as today. |
| Instructor class list | `GET /instructor/cohorts` `instructor.py` :606 | Returns `is_active` and `archived_at` from the row. The table shows "Đã lưu trữ"; the give and mint pickers list active classes only. |
| Instructor roster/matrix | `GET /instructor/students`, summary | Unchanged. Work of an archived class shows as history. |
| Admin class list/detail/progress | `cohorts.py`, `class_service.py`, `admin-class-detail.tsx` | Archived and legacy classes stay readable. Detail disables add-learner, give and lesson actions for archived classes and shows the legacy badge plus "Áp dụng lưu trữ" for legacy ones. |
| Admin pickers | `getAdminCohorts({ isActive: true })` | Unchanged; they already hide both states. |

## 4. Write paths (FR-002, FR-003, FR-006)

### 4.1 Error contract

| Caller | HTTP | Body |
| --- | --- | --- |
| Admin/instructor write into an archived class | 409 | `{"code":"cohort_archived","message":"Lớp đã lưu trữ — khôi phục lớp trước khi thêm học viên hoặc giao bài."}` |
| Learner start/save/submit in an archived class (Variant A) | 409 | `{"code":"cohort_archived","message":"Lớp đã lưu trữ — bài này không nhận bài nộp mới. Bài và bản nháp của em vẫn được giữ."}` |
| Class-code activation (D4=a) | 400 | the existing `_GENERIC` text of `auth.py` |
| Activation revert failed (FR-008) | 503 | `{"error_code":"activation_incomplete","message":"Kích hoạt chưa hoàn tất. Mã CHƯA được sử dụng — vui lòng thử lại sau ít phút hoặc liên hệ admin."}` |
| DB guard (any path) | P0001, message `cohort_archived`, DETAIL = cohort id | mapped to the 409 above by `class_archive_service.is_cohort_archived_error(exc)` (substring, like `student_service.is_student_archived_error`) |

- **Precedence:** check `student_archived` before `cohort_archived`.
  - In SQL this is natural: the 326 guards and the sync trigger lock the
    learner and raise before the membership row is written.
  - In Python, call `raise_if_student_archived` before
    `raise_if_cohort_archived`.
- Existing `student_archived` mappings stay. `cohort_archived` is added next to
  them:
  - `cohorts.py`;
  - `admin_writing_assignments.py`;
  - `cohort_assignment_service.py`;
  - `instructor.py`.

### 4.2 Inventory

| # | Path | Code | Change |
| --- | --- | --- | --- |
| W1 | Class-code activation | `auth.py` `activate_account` Step 1c (:546–) | Pre-check that the code's class is not archived **before Step 2/3**. If it is, return the generic 400 and write the audit. FR-008 covers the race (§6). |
| W2 | Late-joiner backfill | `auth.py` Step 6 (:896–) → `cohort_assignment_service.backfill_cohort_writing_assignments` (:337); `scripts/backfill_class_enrollment_roster.py` | The service returns `{"created_count":0,"skipped":"cohort_archived"}` for an archived class. The script logs and skips it, as it does for `student_archived`. |
| W3/W4 | Admin add one / bulk | `cohorts.py` `assign_student_to_cohort` :302, `bulk_assign_students_to_cohort` :341 | 409. A bulk add is refused as a whole. |
| W5 | Admin add by issuing a code | `cohorts.py` `add_cohort_member` :225 | 409 before any code is issued. |
| W6 | Admin class codes | `admin.py` `POST /access-codes/generate` :1046, `generate-and-assign` :2624, `PATCH /access-codes/{id}` changing `cohort_id` | 409 when the target class is archived. |
| W7 | Instructor mint | `instructor.py` `POST /codes` :711 | 409. |
| W8 | Class assignments | `admin_class_assignments.py` `POST /{cohort_id}/assignments` :2592, `/backfill` :2770 | `_require_active_cohort` next to `_require_cohort` (:299) returns 409; the DB guard is the backstop. |
| W9 | Cohort Writing gives | admin `POST /admin/writing/assignments` with `cohort_id` and `/fan-out`; instructor `/assignments/fan-out` :304 → `fan_out_assignment` (:124); RPC `fn_create_writing_assignments_idempotent` | 409. A completed idempotent request replays its receipt after the archive (FR-003, as 0031 proves for `student_archived`). |
| W10 | Class lessons | `admin_class_lessons.py` POST :123 / PATCH :151 | 409. GET and DELETE stay allowed. |
| W11 | Direct membership writers | the 227 functions, the sync trigger, `fn_restore_student` | DB guard (§7). `fn_restore_student` skips archived classes (D2). |
| W12 | Learner work | §5 | Variant A gates. |
| W13 | Admin edit of a learner's `cohort_id` | `PATCH /admin/students/{id}` | A change to an archived class is refused with 409 before the write (`raise_if_cohort_archived`); the DB guard is the backstop when the learner is not already an active member. A name-only edit is unaffected. |
| W14 | Archive/restore itself | `PATCH /admin/cohorts/{id}` | An `is_active` change calls `fn_archive_cohort` / `fn_restore_cohort` **first**. If that fails, nothing else is written. Name and description are then updated in a plain UPDATE. New `GET /admin/cohorts/{id}/archive-preview` → `fn_cohort_archive_counts`. |

Unchanged: removing a member, grading/returning work, export, and renaming an
archived class.

## 5. Variant A and D3, per learner entry point (FR-004)

`class_archive_service.cohort_accepts_work(db, cohort_id)` is false for an
archived class only. A legacy inactive class still accepts work. The gate
sits in front of each entry point. Every row needs a route test.

| Entry point | Code | Archived class |
| --- | --- | --- |
| Writing draft PATCH | `writing_student.py` :1461 | 409, except a **timed** give with `started_at < archived_at` that is not yet submitted (D3) |
| Writing submit (also the auto-submit, `auto_submitted = timer["is_expired"]`) | :1552 (flag at :1700) | 409, except the same D3 case. There is no Writing reaper, so this exception is what saves a running timed essay. |
| Writing start / admissions | :2192, :2119–2159 | 409 (a new start) |
| Class item start/submit | `class_student.py` POST :684, `class_assignment_service.py` | 409 |
| Timed course session | `quiz_service.py` → `quiz_start_timed_course_session` | A new start or retry start gets 409. A session started before the archive keeps answering and is finalised by the reaper (`allow_reaper_finalize`). |
| Grammar lesson / diagnostic | `grammar_lesson_service.py`, `grammar_diagnostic_service.py` | 409 (untimed) |
| Advanced Vocabulary | `advanced_vocab_service.py` → `start_advanced_vocab_practice` (:930) | 409 (missing from the first draft's W12) |
| Mock sitting | `mock_exam_service.py` :196/:783 | Not eligible, with the truthful message (§3) |

D3 needs a reliable `archived_at`. Every enforced archive has one (§7 step
2). Legacy inactive classes are not gated, so they never need one.

## 6. Activation and the archive race (FR-008)

Order in `activate_account`:

| Step | What it does |
| --- | --- |
| rate limit | 334 |
| 1 | read the code |
| 1b | instructor gate |
| 1c | archived profile check |
| 2 | read or insert `users`, `was_already_active` |
| 3 | `UPDATE users SET is_active, access_code_used, permissions[, role]` |
| 3b | enroll: `students` UPDATE or INSERT → sync trigger → membership → **A-10 guard** |
| 4 | claim |
| 5 | `user_code_assignments` |
| 6 | backfill |

Today a guard raise inside Step 3b reaches `except Exception` and returns
`500 "Lỗi khi ghi danh học viên: <DB text>"`. Step 3 has already committed.

Required behaviour:

1. **Pre-check (W1).** Right after Step 1c, if the code has a `cohort_id`,
   read `cohorts.is_active, archived_at`.
   - Archived → generic 400 and `access_code_audit`
     `enroll_rejected_cohort_archived`. No write to `users`, `students` or
     the code.
   - Lookup failure → 503 "Mã CHƯA được sử dụng — vui lòng thử lại".
2. **Step 2 snapshot.** Step 2 also selects `access_code_used, permissions`, so
   the Step 3 values can be restored.
3. **Race in Step 3b.** The failing statement is rolled back by Postgres, so
   no `students` or membership row is left.
   - If `is_cohort_archived_error(exc)`, the handler restores the Step 3
     fields to the snapshot. That is the same rollback the lost-claim branch
     performs for a fresh activation, extended to `access_code_used`,
     `permissions` and a promoted `role`.
   - It skips Step 4, writes the audit row with `detail.race = true`, and
     returns the generic 400.
4. **Revert failure.** Retry once. If it still fails:
   - `logger.critical` with the request id and user id;
   - audit `detail.compensation_failed = true`;
   - 503 `activation_incomplete`.

   The code stays unused. The account may stay active in this case only. The
   admin sees it through the audit row, and the CRITICAL log line is the alert.
5. **Other Step 3b errors.** The generic `except Exception` no longer echoes
   database text (`safe_error`, 500, "Mã CHƯA được sử dụng"), so a guard error
   that was not detected can never leak.
6. **Archive after Step 3b committed.** The guard's `FOR SHARE` lock makes the
   archive wait for the enroll statement. The activation then completes
   normally, and the Step 6 refusal is a warning.

Tests: pre-check refusal, mid-flight archive (test seam between Step 3 and
3b), revert-failure 503, re-claim of one's own code after the archive, and
the rate limit still counts the attempt.

## 7. Migration 337 (proposed SQL; not run anywhere)

```sql
-- Migration: 337_class_archive_enforcement.sql
-- A-10 / CLASSARCHIVE-0030. cohorts.is_active=false was a flag no learner or
-- enrollment path enforced. An *archived* class (is_active=false AND
-- archived_at IS NOT NULL) now refuses new membership, class work and cohort
-- Writing gives; archive/restore go through locked, audited RPCs.
-- Classes already inactive before this file stay legacy (archived_at NULL):
-- nothing here backfills archived_at, so no learner-visible change at deploy.
-- fn_restore_student (326) skips archived classes (0029 FR-003 Rev 1).
-- Guards are SECURITY DEFINER with pinned search_path; no client grants.
-- Does not name, replace or bypass any migration-331 object.
-- Rollback: see the end of this file (code first).

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 0. Preconditions + snapshot of archived classes before apply
DO $$
DECLARE v_before bigint := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.users'::regclass
                    AND tgname = 'trg_users_guard_privileged_columns' AND tgenabled = 'O') THEN
        RAISE EXCEPTION 'migration_320_guard_missing';
    END IF;
    IF to_regprocedure('public.fn_restore_student(uuid,uuid,text,boolean,boolean)') IS NULL THEN
        RAISE EXCEPTION 'migration_326_missing';
    END IF;
    IF position('students WHERE id = p_student_id FOR UPDATE' IN
                (SELECT prosrc FROM pg_proc
                  WHERE oid = 'public.fn_restore_student(uuid,uuid,text,boolean,boolean)'::regprocedure)) = 0 THEN
        RAISE EXCEPTION 'fn_restore_student_lock_missing';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'cohorts'
                  AND ((column_name = 'archived_at' AND data_type <> 'timestamp with time zone')
                    OR (column_name = 'archived_by' AND data_type <> 'uuid')
                    OR (column_name = 'archive_reason' AND data_type <> 'text'))) THEN
        RAISE EXCEPTION 'cohorts_archive_columns_conflict';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'cohorts' AND column_name = 'archived_at') THEN
        EXECUTE 'SELECT count(*) FROM public.cohorts WHERE NOT is_active AND archived_at IS NOT NULL'
           INTO v_before;
    END IF;
    PERFORM set_config('m337.archived_before', v_before::text, true);
END $$;

-- 1. Archive metadata (no backfill, no is_active-dependent CHECK)
ALTER TABLE public.cohorts
    ADD COLUMN IF NOT EXISTS archived_at    timestamptz,
    ADD COLUMN IF NOT EXISTS archived_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS archive_reason text;
-- (named CHECK on archive_reason length <= 500, added if absent; it does not
--  depend on is_active, so the old backend can never trip it)

-- 2. Metadata normaliser: any writer (old backend, SQL editor, RPC)
CREATE OR REPLACE FUNCTION public.fn_cohorts_archive_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.is_active THEN
        NEW.archived_at := NULL; NEW.archived_by := NULL; NEW.archive_reason := NULL;
    ELSIF TG_OP = 'INSERT' OR OLD.is_active THEN
        NEW.archived_at := COALESCE(NEW.archived_at, now());   -- every new archive is enforced
    ELSE
        NEW.archived_at := COALESCE(NEW.archived_at, OLD.archived_at);  -- cannot un-enforce
    END IF;
    RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_cohorts_archive_metadata
    BEFORE INSERT OR UPDATE ON public.cohorts
    FOR EACH ROW EXECUTE FUNCTION public.fn_cohorts_archive_metadata();

-- 3. Append-only audit (no FK: survives a hard delete of the class)
CREATE TABLE IF NOT EXISTS public.class_lifecycle_audit (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cohort_id     uuid NOT NULL,
    action        text NOT NULL CHECK (action IN ('archive', 'restore')),
    actor_user_id uuid NOT NULL,
    reason        text,
    detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_class_lifecycle_audit_cohort
    ON public.class_lifecycle_audit (cohort_id, created_at DESC);
ALTER TABLE public.class_lifecycle_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.class_lifecycle_audit FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.class_lifecycle_audit FROM service_role;
GRANT SELECT, INSERT ON public.class_lifecycle_audit TO service_role;

-- 4. Counts + RPCs (SECURITY DEFINER, service_role only)
--   fn_cohort_archive_counts(p_cohort_id uuid) RETURNS jsonb STABLE:
--     active_members, open_writing_gives (pending/in_progress, cohort_id = p),
--     open_class_items (assigned/opened in non-archived class_assignments),
--     unused_class_codes (is_active AND NOT is_used AND NOT is_revoked).
--   fn_archive_cohort(p_cohort_id uuid, p_actor uuid, p_reason text DEFAULT NULL) RETURNS jsonb:
--     actor required; SELECT … FROM cohorts WHERE id = p_cohort_id FOR UPDATE;
--     not found → NULL (route 404); already archived → {status:'already_archived'} (no audit);
--     v_legacy := NOT is_active;  counts := fn_cohort_archive_counts(p_cohort_id);
--     UPDATE cohorts SET is_active = false, archived_at = now(), archived_by = p_actor,
--            archive_reason = NULLIF(btrim(p_reason), '');
--     INSERT audit ('archive', p_actor, reason, counts || {legacy_upgrade: v_legacy});
--     RETURN {status:'archived', archived_at, counts, legacy_upgrade}.
--   fn_restore_cohort(p_cohort_id uuid, p_actor uuid, p_reason text DEFAULT NULL) RETURNS jsonb:
--     FOR UPDATE; not found → NULL; is_active → {status:'not_archived'} (no audit);
--     v_was_legacy := archived_at IS NULL; UPDATE cohorts SET is_active = true (trigger clears metadata);
--     INSERT audit ('restore', …, counts || {was_legacy: v_was_legacy}); RETURN receipt.
--   REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role.

-- 5. Guards (SECURITY DEFINER; lock the class row FOR SHARE, then test)
--   fn_guard_membership_cohort_active — trigger trg_guard_membership_cohort_active
--     AFTER INSERT OR UPDATE OF is_active, cohort_id ON student_cohort_memberships
--     FOR EACH ROW:
--     IF NEW.is_active AND (TG_OP = 'INSERT' OR NOT OLD.is_active
--                           OR NEW.cohort_id IS DISTINCT FROM OLD.cohort_id) THEN
--         SELECT is_active, archived_at INTO v FROM cohorts WHERE id = NEW.cohort_id FOR SHARE;
--         IF FOUND AND NOT v.is_active AND v.archived_at IS NOT NULL THEN
--             RAISE EXCEPTION 'cohort_archived' USING DETAIL = NEW.cohort_id::text;
--     AFTER, not BEFORE: for INSERT … ON CONFLICT DO UPDATE, PostgreSQL fires
--     BEFORE INSERT before it resolves the conflict, but AFTER INSERT only for a
--     row actually inserted and AFTER UPDATE (with the real OLD) for the conflict
--     update. So an upsert of an already-active membership is judged as
--     active→active and passes, while a new row or an inactive→active conflict
--     update is refused. This keeps removal unchanged (§4 "Unchanged"):
--     fn_remove_student_cohort_membership may move students.cohort_id to an
--     archived class B the learner is still active in, and the sync trigger's
--     upsert of that already-active row must not abort the removal. Raising in an
--     AFTER ROW trigger still aborts the whole statement (bulk add refused as a
--     whole); student_archived still wins because the 326 checks raise before
--     the membership row is written.
--   fn_guard_class_assignment_cohort_active — BEFORE INSERT ON class_assignments (same test on NEW.cohort_id)
--   fn_guard_class_item_cohort_active       — BEFORE INSERT ON class_assignment_items (via assignment_id)
--   fn_guard_writing_give_cohort_active     — trigger trg_guard_writing_give_cohort_active
--     BEFORE INSERT ON writing_assignments, only when NEW.cohort_id IS NOT NULL
--     (name pinned by the 331 sort-order test; fires after the 331 learner guard)
--   Each: REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated.

-- 6. fn_restore_student (326) — CREATE OR REPLACE with the 326 body verbatim except:
--     after v_cohorts is read and before the back CTE, lock the candidate classes
--     in a deterministic order:
--                PERFORM 1 FROM public.cohorts c WHERE c.id = ANY (v_cohorts)
--                 ORDER BY c.id FOR SHARE;
--     back CTE:  AND EXISTS (SELECT 1 FROM public.cohorts c WHERE c.id = m.cohort_id
--                            AND (c.is_active OR c.archived_at IS NULL))
--     v_skipped := cohorts in v_cohorts that exist and are archived;
--     audit detail and receipt gain 'skipped_archived_cohort_ids'.
--   The lock is what makes the predicate and the membership guard agree. Without
--   it, an archive committing between the EXISTS read and the guard's FOR SHARE
--   would make the guard raise and abort the whole restore (500). With it,
--   fn_archive_cohort (FOR UPDATE on the class) either committed before the lock
--   — the back CTE, a later statement with a fresh READ COMMITTED snapshot, sees
--   the class archived and skips it — or waits until the restore commits, and
--   then counts the restored membership. Lock order stays students → cohorts.
--   Signature, SECURITY DEFINER, search_path, the literal
--   "students WHERE id = p_student_id FOR UPDATE" and the ACL are unchanged.

-- 7. Postconditions
--   - 3 columns present; trg_cohorts_archive_metadata + the 4 guard triggers enabled 'O'
--     and bound to their functions;
--   - every new function and fn_restore_student: prosecdef, proconfig has
--     search_path=public, pg_temp, no EXECUTE for PUBLIC/anon/authenticated;
--   - fn_restore_student body contains the FOR UPDATE literal, the candidate-class
--     FOR SHARE lock and the archived-class predicate;
--   - trg_guard_membership_cohort_active is an AFTER row trigger (tgtype) on
--     INSERT and UPDATE OF is_active, cohort_id;
--   - class_lifecycle_audit: RLS on; anon/authenticated no privilege; service_role no UPDATE/DELETE;
--   - authenticated/anon: no INSERT/UPDATE on cohorts, no privilege on student_cohort_memberships;
--   - FR-009: (SELECT count(*) FROM cohorts WHERE NOT is_active AND archived_at IS NOT NULL)
--             = current_setting('m337.archived_before')::bigint, else RAISE 'm337_archived_class_created'.
COMMIT;
```

Notes:

- No `NOT VALID` / `VALIDATE` pair and no `is_active`-dependent CHECK (F4,
  F13).
- `ADD COLUMN` takes a brief ACCESS EXCLUSIVE lock on `cohorts` (3 rows on
  staging). `CREATE TRIGGER` takes SHARE ROW EXCLUSIVE on five tables. The
  `lock_timeout` is 5 s, and the file is re-runnable.
- 337 must not mention `archive_guard_writing_assignment_student`,
  `fn_guard_writing_assignment_student_archived`, `session_replication_role`,
  or `DISABLE TRIGGER` on `writing_assignments`. This includes comments that
  survive stripping and the rollback block. The presence of 331 is asserted by
  a test, not in SQL.
- Python never writes `cohorts.archived_at`. All writes are in 337, which
  keeps `test_only_the_326_functions_write_archived_at` green. If a response
  needs the key, pass the selected row through. A literal `"archived_at":`
  in backend Python would require an explained test change in the same PR.
- `idx_cohorts_is_active` (partial `WHERE is_active`) serves the read
  filters, so no new index is needed.

### 7.1 Rollback (file header; code first)

- **Light** (preferred):
  - drop the RPCs and `fn_cohort_archive_counts`;
  - then the four guard triggers and their functions.
  - Keep the columns, `trg_cohorts_archive_metadata`, the audit table and the
    337 `fn_restore_student`. The old backend keeps working: the trigger only
    normalises, and there is no CHECK.
- **Full:**
  1. Refuse with `rollback_would_drop_class_audit` if any audit row exists, and
     with `rollback_would_drop_archive_actor` if any `archived_by IS NOT NULL`.
  2. Do the light steps.
  3. Re-create the 326 `fn_restore_student` body **verbatim** from
     `326_student_archive.sql`. The 337 body reads `cohorts.archived_at` and
     would fail once the column is gone.
  4. Drop `trg_cohorts_archive_metadata` and its function, then the audit
     table, then the three columns.
- Test on local PostgreSQL: rollback (both kinds) then re-apply, and the
  refusals.

## 8. Production read-only checks (D6 = authorized, read-only)

```sql
BEGIN TRANSACTION READ ONLY;
-- P1 catalog: columns/constraints/triggers/policies on cohorts, memberships,
--    class_assignments, class_assignment_items, writing_assignments, students
--    (same SELECTs as the first draft §8 P1).
-- P2 per inactive class (the list Vinh decides on):
SELECT c.id, c.name, c.updated_at,
       (SELECT count(*) FROM public.student_cohort_memberships m
         WHERE m.cohort_id = c.id AND m.is_active)                         AS active_members,
       (SELECT count(*) FROM public.student_cohort_memberships m
         WHERE m.cohort_id = c.id AND m.is_active
           AND NOT EXISTS (SELECT 1 FROM public.student_cohort_memberships o
                             JOIN public.cohorts oc ON oc.id = o.cohort_id
                            WHERE o.student_id = m.student_id AND o.is_active
                              AND oc.is_active))                            AS members_with_no_other_class,
       (SELECT count(*) FROM public.writing_assignments w
         WHERE w.cohort_id = c.id AND w.status IN ('pending', 'in_progress')) AS open_writing_gives,
       (SELECT count(*) FROM public.access_codes a
         WHERE a.cohort_id = c.id AND a.is_active AND NOT a.is_used
           AND NOT a.is_revoked)                                            AS usable_codes
  FROM public.cohorts c WHERE NOT c.is_active ORDER BY c.updated_at;
-- P3 open class items per inactive class (status/state counts).
-- P4 md5(prosrc) + ACL of fn_add_student(s)_cohort_membership,
--    fn_remove_student_cohort_membership, fn_sync_legacy_student_cohort_membership,
--    fn_create_class_assignment, fn_backfill_assignment_items, fn_restore_student
--    (compare with staging; fn_restore_student must equal the 326 plan md5 bf721ebc…).
-- P5 320 trigger enabled; ledger rows >= '320'.
ROLLBACK;
```

- The results go to Vinh as a per-class table: keep legacy, apply archive, or
  restore.
- Counts only, with class names. No learner PII.
- The Management API returns only the last result set, so run each SELECT
  separately and keep the outputs in the job notes.

## 9. Rejected variants (decided 2026-10-27 07:39)

| | B. Open until the deadline | C. Hide from learners |
| --- | --- | --- |
| Class items | unreachable: `/my-class` hides the class | hidden, not workable |
| Writing gives | listed; submittable until `deadline` | 404 on list/detail |
| Why rejected | inconsistent with "hidden from /my-class"; needs a rule for gives without a deadline | the learner "loses" work with no explanation |

Bringing either back needs a new forward migration (a per-class policy
column) and a branch in `cohort_accepts_work`.

## 10. Review findings → resolution

| Finding | Resolution |
| --- | --- |
| F1 restore abort | FR-007, §7 step 6, D2 + 0029 Rev 1 |
| F2 number | 337 (D1, §1.2) |
| F3 RPC writes | FR-006, §7 step 4; no Python `archived_at` write |
| F4 CHECK window | no CHECK; normalising trigger (FR-011) |
| F5 timed Writing | D3, §5 |
| F6 activation race | FR-008, §6 |
| F7 331 interaction | FOR SHARE/FOR UPDATE locking, 331 names untouched, precedence, replay |
| F8 RLS/privileges | DEFINER guards and RPCs, postconditions, AC on `/rest/v1/rpc/*` |
| F9 confirm copy | FR-010, `ui-states.md` |
| F10 path checklist | §3–§5 (Advanced Vocabulary, mock message, legacy pointer, W2 script, admin-only archive) |
| F11 stale evidence | §1.1 |
| F12 rollback | §7.1 |
| F13 metadata ordering | no backfill (FR-009), no NOT VALID |
| F14 overlap | `plan.md` |
| F16 tests | `plan.md` Verification strategy |
| Risk 6: learners lose a class at deploy | FR-009 |

## 11. T002a — kết quả staging 2026-10-29 02:49–02:53 (UTC+7), `origin/staging` @ `c8293ba97`

Read-only run against staging (`zjphffoujxkpltixsbzj`) only, through the
Management API `/database/query/read-only`. The session ran as
`supabase_read_only_user` with `transaction_read_only = on` (PostgreSQL 17.6).
Every statement was a SELECT on the catalog or on data. Nothing was written,
and production was not queried. Repo references are to `c8293ba97`. Staging
ledger at the time of the run: … 320, 321, 322, 323–326, 331, 332, 334, 335,
336, 338. 333 and 337 are absent, and none of the 337 objects exist yet
(`cohorts` has its 9 original columns, 0 of the 8 planned functions,
`to_regclass('public.class_lifecycle_audit')` is NULL).

### 11.1 Does any reaper or timed-course retry path INSERT `class_assignment_items` after a start?

**No.** The only writers are the two admin fan-out functions. The reaper and
every retry/retake path only UPDATE an existing item.

Catalog evidence:

```sql
-- Q1a: every function in a non-system schema that inserts items, directly or via EXECUTE
SELECT n.nspname, p.oid::regprocedure::text, md5(p.prosrc),
       p.prosrc ~* 'insert\s+into\s+(public\.)?class_assignment_items' AS inserts_items,
       (p.prosrc ~* 'execute' AND p.prosrc ~* 'class_assignment_items') AS dynamic_mention
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname NOT IN ('pg_catalog','information_schema')
   AND p.prosrc ~* 'class_assignment_items'
   AND (p.prosrc ~* 'insert\s+into\s+(public\.)?class_assignment_items'
        OR (p.prosrc ~* 'execute' AND p.prosrc ~* 'class_assignment_items'));
-- → exactly 2 rows, both inserts_items = true, dynamic_mention = false:
--   fn_backfill_assignment_items(uuid,uuid[])                 md5 d5c79ba4…
--   fn_create_class_assignment(uuid,text,…,uuid[])            md5 cec8a909…

-- Q1b: user triggers on the tables involved
SELECT t.tgname, c.relname, t.tgenabled, pg_get_triggerdef(t.oid)
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal
   AND c.relname IN ('class_assignment_items','class_assignments','student_cohort_memberships',
                     'cohorts','quiz_sessions','students');
-- class_assignment_items: trg_mark_timed_course_assignment_started (AFTER UPDATE OF opened_at),
--   trg_protect_advanced_vocab_item_evidence (BEFORE DELETE),
--   trg_snapshot_timed_course_item_cutoff (BEFORE INSERT OR UPDATE),
--   update_class_assignment_items_updated_at (BEFORE UPDATE).
-- student_cohort_memberships, cohorts: no user trigger (no "auto-backfill on join").
-- None of the trigger functions on these tables inserts into class_assignment_items (Q1c below).

-- Q1c: insert / cohorts / membership reads in the relevant live bodies
SELECT p.proname, p.prosrc ~* 'insert\s+into' AS has_insert,
       p.prosrc ~* '\mcohorts\M' AS reads_cohorts,
       p.prosrc ~* 'student_cohort_memberships' AS reads_memberships
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN (…14 names…);
-- snapshot_timed_course_item_cutoff, mark_timed_course_assignment_started: has_insert = false.
-- reads_cohorts = false for all 14, including every learner RPC below.

SELECT extname FROM pg_extension;
-- pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp: no pg_cron, so no in-DB schedule.
```

Code evidence:

- Python has no `.insert`/`.upsert` on `class_assignment_items`. The only
  calls to the two functions are in `services/class_assignment_service.py`:
  `fn_create_class_assignment` at :214, the scoped-exam wrapper at :209, and
  `fn_backfill_assignment_items` at :267. The scoped wrapper calls
  `fn_create_class_assignment` (`260_…:249`) and inserts no items itself.
- Those services are reached only from two admin routes in
  `routers/admin_class_assignments.py`. Both call `require_admin` and are
  triggered from the admin homework UI:
  - `POST /{cohort_id}/assignments` (:2592, call :2727);
  - `POST /{cohort_id}/assignments/{assignment_id}/backfill` (:2770, call
    :2795).
- **Course timer reaper.** `main.py:783` `_course_timer_reaper_loop` →
  `quiz_service.reap_expired_course_assessments` (:5200).
  - It reads items with `opened_at IS NOT NULL` and `passed_at IS NULL`.
  - It finalises them through `course_verdict(..., _allow_reaper_finalize=True)`
    (:5551), which writes by UPDATE/CAS on the existing item.
  - The other two loops do not touch items: `_writing_reaper_loop` (stuck
    essay grading) and `_retake_reaper_loop` (mock retake sittings).
- **Full retry.** `begin_course_full_retry` (:4173) UPDATEs `mastery` on the
  existing item with a CAS on `updated_at` (:4207–4209).
- **Timed start/retry/retake.** The live `quiz_start_timed_course_session`
  (`270_…:13`) INSERTs `quiz_sessions` and UPDATEs the item's `opened_at`/
  `state` (:156–166). Its `p_create_if_missing` retry branch only INSERTs a
  `quiz_sessions` row (:195). `quiz_insert_timed_course_attempts` (`279_…:11`)
  INSERTs `quiz_attempts`.
- **Advanced Vocabulary and grammar lessons.**
  `finalize_advanced_vocab_assignment` and
  `record_assigned_grammar_lesson_answer` only UPDATE the item.
  `create_assigned_grammar_lesson_attempt` and `start_advanced_vocab_practice`
  insert into their own tables.

Staging data agrees:

```sql
SELECT count(*) AS items_total,
       count(*) FILTER (WHERE i.created_at > a.created_at + interval '60 seconds') AS items_inserted_after_assignment,
       count(*) FILTER (WHERE i.created_at > a.created_at + interval '60 seconds'
                          AND i.created_at > i2.first_open) AS inserted_after_a_start_in_same_assignment
  FROM class_assignment_items i JOIN class_assignments a ON a.id = i.assignment_id
  LEFT JOIN LATERAL (SELECT min(x.opened_at) AS first_open FROM class_assignment_items x
                      WHERE x.assignment_id = a.id) i2 ON true;
-- 7 | 0 | 0   (2 timed Course assignments exist, both in reaper scope; 0 late items)
```

**Impact on §7.** `fn_guard_class_item_cohort_active` as **BEFORE INSERT
only** cannot block a reaper finalise or a retry/retake of a session started
before the archive. Those paths UPDATE the item or INSERT `quiz_sessions`/
`quiz_attempts`, which the guard never sees. §5 "Timed course session" holds
without an exemption. Two items to add when T002 writes 337:

1. Keep the item guard INSERT-only. Add a §7 step 7 postcondition: `tgtype`
   of `trg_guard_class_item_cohort_active` (and of the `class_assignments`
   guard) is BEFORE ROW INSERT with no UPDATE bit. If a later edit widened it
   to `INSERT OR UPDATE`, it would abort the reaper (`course_verdict` UPDATE),
   `begin_course_full_retry`, the `opened_at` UPDATE of a session already
   admitted by the Python gate, and both Advanced Vocabulary/grammar
   finalisers. That would turn D3/§5's "finalised by the reaper" into a
   silent `failed` count in `[course-timer-reaper]`.
2. The only late item insert is the admin backfill (W8), which the guard
   refuses by design. `trg_snapshot_timed_course_item_cutoff` is also BEFORE
   INSERT on the same table. Trigger order does not matter here: the
   snapshot trigger only fills `NEW` fields, and the guard reads only
   `NEW.assignment_id`.

### 11.2 Live bodies vs. repo migrations

**No drift.** All 22 live bodies are byte-identical (`md5(prosrc)`) to the
last definition of the same function in the repo, in numeric migration order.
Signature, `prosecdef`, `search_path` and ACL also match. For several
functions the last definition is in a **later** file than 264/265/270/282/312.
T002 must read the file in the "repo source" column, not the original number.

```sql
SELECT p.oid::regprocedure::text, p.proname, md5(p.prosrc), p.prosecdef, p.proconfig,
       p.proacl::text, p.prosrc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN (…22 names below…);
-- compared locally with md5 of the text between the dollar quotes of the
-- last CREATE [OR REPLACE] FUNCTION in backend/migrations/NNN_*.sql (rollback files excluded)
```

| Function | Repo source (last definition) | live md5 = repo md5 | DEFINER | EXECUTE |
| --- | --- | --- | --- | --- |
| `fn_create_writing_assignments_idempotent` (12 args) | `228_writing_idempotency_optional_cohort.sql:10` | `1cf19d87…` ✓ | yes | service_role |
| `quiz_start_timed_course_session(uuid,uuid,uuid,text,text,boolean)` | `270_atomic_timed_course_session_creation.sql:13` | `1ca01b7b…` ✓ | yes | service_role |
| `quiz_insert_timed_course_attempts(uuid,uuid,jsonb)` | `279_reject_superseded_timed_course_progress.sql:11` (265 superseded) | `d28d632e…` ✓ | yes | service_role |
| `start_advanced_vocab_practice` | `292_advanced_vocab_practice_rollout_compatibility.sql:99` (282 superseded) | `ec4a95b7…` ✓ | yes | service_role |
| `advanced_vocab_lock_open_item` | `282_…:50` | `b0b4c892…` ✓ | yes | service_role |
| `advanced_vocab_validate_selection` | `282_…:136` | `9fae894d…` ✓ | no | service_role |
| `advanced_vocab_canonical_practice_qids` | `292_…:12` | `9d3fe5c8…` ✓ | yes | service_role |
| `advanced_vocab_guard_selection` | `292_…:47` | `cf8bbf3e…` ✓ | yes | service_role |
| `advanced_vocab_guard_stage_progress` | `290_align_advanced_vocab_rewrite_evidence.sql:6` | `4037eff1…` ✓ | yes | service_role |
| `advanced_vocab_guard_question_attempt` | `292_…:209` | `e6017ef5…` ✓ | yes | service_role |
| `advanced_vocab_complete_practice_after_answer` | `282_…:452` | `f61627e9…` ✓ | yes | service_role |
| `advanced_vocab_guard_listening_attempt` | `282_…:490` | `b723a25f…` ✓ | yes | service_role |
| `advanced_vocab_guard_course_section` | `282_…:522` | `d7269ba7…` ✓ | yes | service_role |
| `finalize_advanced_vocab_assignment` | `282_…:587` | `d7c80650…` ✓ | yes | service_role |
| `guard_advanced_vocab_assignment_snapshot` | `282_…:672` | `34eec0c8…` ✓ | yes | service_role |
| `protect_advanced_vocab_bank` | `282_…:650` | `6df93cbf…` ✓ | no | PUBLIC (trigger fn; repo has no REVOKE) |
| `protect_advanced_vocab_item_evidence` | `291_repair_advanced_vocab_evidence_guard.sql:8` | `afce8e6a…` ✓ | no | PUBLIC (trigger fn; repo has no REVOKE) |
| `create_assigned_grammar_lesson_attempt` | `313_master30_original_full_banks.sql:191` (312 superseded) | `357a5f0b…` ✓ | yes | service_role |
| `record_assigned_grammar_lesson_answer` | `313_…:431` (312 superseded) | `b0995a5a…` ✓ | yes | service_role |
| `fn_create_class_assignment` (13 args) | `269_serialize_course_assignment_bank_revision.sql:49` | `cec8a909…` ✓ | yes | service_role |
| `fn_backfill_assignment_items(uuid,uuid[])` | `227_student_cohort_memberships.sql:406` | `d5c79ba4…` ✓ | yes | service_role |
| `fn_create_scoped_exam_class_assignment` (14 args) | `260_approve_web_explanation_paper.sql:179` | `ae935d20…` ✓ | yes | service_role |

The §7 preconditions were also run read-only:

- `trg_users_guard_privileged_columns` has `tgenabled = 'O'`;
- `fn_restore_student(uuid,uuid,text,boolean,boolean)` exists and contains
  the `students WHERE id = p_student_id FOR UPDATE` literal;
- its `md5(prosrc) = bf721ebc664d8875de2b9b91ac4a878f` equals the 326 body
  (`326_student_archive.sql:194`), which the §7.1 full rollback re-creates
  verbatim.

`writing_assignments` has exactly three user triggers:
`archive_guard_writing_assignment_student` (331, BEFORE INSERT OR UPDATE OF
student_id), `trg_guard_writing_assignment_terminal_mutation` and
`update_writing_assignments_updated_at`. The planned
`trg_guard_writing_give_cohort_active` sorts after the 331 trigger, as §7
step 5 requires.

**Impact on §7/§7.1:**

- 337 replaces none of these 22 functions. Variant A stays in the Python
  gates (§2, §5).
- No live learner RPC reads `cohorts` (Q1c). A session admitted before the
  archive therefore keeps answering and finalising at the SQL level, as §5
  requires, with no change to these bodies.
- `fn_create_writing_assignments_idempotent` behaves as §4.2 W9 and FR-003
  assume, so 337 needs no change to it:
  - The **replay** branch returns the stored receipt (`228_…:61–76`) before
    any `writing_assignments` INSERT. The BEFORE INSERT give guard therefore
    never fires on a replay, and a completed request still replays after the
    archive.
  - A guard raise in a new fan-out aborts the whole RPC transaction,
    including the `writing_assignment_requests` row inserted at `228_…:57`.
    No `writing_assignment_request_incomplete` orphan is left behind.
  - Individual gives keep `cohort_id` NULL (`228_…:80–81`, :112), so the
    guard does not refuse them.
- **Lock order:**
  - The fan-out takes `FOR SHARE OF` the membership rows (`228_…:82–87`)
    before the give guard takes `FOR SHARE` on the class.
  - The membership guard (AFTER ROW) also locks membership → class.
  - `fn_archive_cohort` takes the class `FOR UPDATE` first. So
    `fn_cohort_archive_counts` must stay a plain, non-locking SELECT over
    memberships, gives and items. A `FOR SHARE`/`FOR UPDATE` there would
    create a class → membership order that can deadlock with a concurrent
    fan-out or enroll. Add this as a review note on §7 step 4; no SQL change
    is needed beyond keeping it lock-free.

### 11.3 Staging data relevant to AC planning (counts only)

```sql
SELECT c.id, c.name, c.is_active, c.updated_at,
       (SELECT count(*) FROM class_assignments a WHERE a.cohort_id = c.id)                       AS assignments,
       (… items …), (… items created after c.updated_at …), (… opened, unsubmitted items …),
       (SELECT count(*) FROM writing_assignments w WHERE w.cohort_id = c.id
           AND w.status IN ('pending','in_progress'))                                            AS open_writing_gives,
       (SELECT count(*) FROM writing_assignments w WHERE w.cohort_id = c.id
           AND w.created_at > c.updated_at)                                                      AS gives_after_cohort_updated_at
  FROM cohorts c ORDER BY c.created_at;
SELECT w.status, w.is_timed, count(*), min(w.created_at), max(w.created_at), count(*) FILTER (WHERE w.started_at IS NOT NULL)
  FROM writing_assignments w
 WHERE w.cohort_id = 'a8e68c89-7dee-40a6-bd90-4e37f143d1b6' AND w.created_at > '2026-10-10 13:29:05.583381+00'
 GROUP BY 1, 2;
```

- The legacy inactive class "QA Course 1 Resume 20261010" (`a8e68c89…`) has:
  - 3 assignments and 3 items, with 0 items created after it went inactive
    and 0 opened-but-unsubmitted items;
  - 4 open Writing gives, all `pending`, untimed and unstarted (§1.1 confirmed);
  - **9 cohort Writing gives created on 2026-10-25/26, after the class went
    inactive on 2026-10-10**: 4 pending, 4 graded, 1 delivered.

  This is the W-10 behaviour (an inactive class still receives gives). Under
  FR-009 the class stays legacy, so 337 does not change this until an admin
  presses "Áp dụng lưu trữ".
- Staging has no timed Writing give and no open timed Course item in an
  inactive class. The D3 check (AC-13) and the FR-004 reaper-finalise check
  therefore need seeded data on the fresh `staging_seed.py --ns` namespace,
  as T011 already says. Existing rows cannot exercise them.

Raw outputs and the compare script are kept outside the repo in
`/workspace/qa/q14l-t002a/` (`live_funcs.json`, `compare.json`, `q1a.out`,
`q1b.out`, `*.sql`).
