# Implementation plan

## Architecture impact

- **Database (migration 337, `research.md` §7)** owns these invariants:
  - "no new membership, class work or cohort give in an archived class": four
    SECURITY DEFINER guards that lock the class row `FOR SHARE`;
  - "archive and audit are one transaction": `fn_archive_cohort` and
    `fn_restore_cohort` lock the class row `FOR UPDATE`;
  - "active ⇒ no archive metadata; every new archive has `archived_at`": the
    `trg_cohorts_archive_metadata` trigger;
  - 0029 restore skips archived classes.
- **Backend:**
  - new `services/class_archive_service.py`:
    - `archive_class`, `restore_class` and `archive_preview` (RPC calls);
    - `is_cohort_archived(row)`;
    - `cohort_accepts_work`;
    - `is_cohort_archived_error` and `raise_if_cohort_archived` (409 mapping);
  - `class_membership_service.active_cohort_ids_for_student(…,
    include_archived=False)`;
  - `routers/cohorts.py` routes `is_active` changes to the service and adds
    `GET /admin/cohorts/{id}/archive-preview`;
  - write-path 409s, W1–W14 (`research.md` §4);
  - Variant A/D3 gates (§5);
  - `/auth/activate` pre-check and race handling (§6).
- **Frontend:**
  - admin classes directory and detail: confirm dialog with counts and an
    optional reason, a legacy badge and "Áp dụng lưu trữ", disabled actions;
  - Writing dashboard: closed label and D3 continue state;
  - instructor dashboard: "Đã lưu trữ" label, active-only pickers;
  - mock exam message;
  - regenerate `frontend/types/api.d.ts`.
- **Scripts:** `backfill_class_enrollment_roster.py` and `staging_seed.py` skip
  archived classes.

## Data and contracts

- Schema: `research.md` §7. No row changes at apply: no backfill, and the
  FR-009 postcondition holds.
- API before → after:

| Path | Before | After |
| --- | --- | --- |
| `PATCH /admin/cohorts/{id}` `{is_active:false}` | 200, flag only | 200 with receipt `{status, archived_at, counts, legacy_upgrade}`; one audit row. A repeat returns `already_archived` with no audit row. Body accepts `archive_reason` (optional, ≤500). |
| `PATCH /admin/cohorts/{id}` `{is_active:true}` | 200 | 200 with receipt; one audit row. All archive metadata is cleared. |
| `GET /admin/cohorts/{id}/archive-preview` | — | `fn_cohort_archive_counts` |
| `GET /admin/cohorts`, `GET /instructor/cohorts` | rows | rows plus `archived_at`, `archived_by`, `archive_reason` (selected row passed through) |
| Write paths W2–W13 into an archived class | 2xx | 409 `{"code":"cohort_archived","message":…}` |
| `POST /auth/activate` with an archived class's code | 200, enrolled | 400 generic, code unused; a race gives the same. A failed revert gives 503 `activation_incomplete`. |
| `GET /class/me`, `/class/my-assignments` | all memberships | archived classes omitted |
| `GET /writing/my-assignments` (+ detail) | rows | plus `class_archived`, `archive_finish_allowed` |
| Learner work in an archived class | 2xx | 409 `cohort_archived`, except the D3 timed case |
| `POST /admin/students/{id}/restore` (0029) | 500 when a former class is archived | 200; receipt and audit include `skipped_archived_cohort_ids` |

- Legacy inactive classes: no row in this table changes behaviour for them.
  Only the admin labels and the "Áp dụng lưu trữ" action are new.
- Overlap with open PRs (`gh pr list`, 2026-10-28):
  - #1857 and #1835: `auth.py`, `admin.py`, `student_service.py`;
  - #1851: instructor dashboard files;
  - #1837 and #1853: `backend/migrations/README.md`;
  - #1837: `frontend/types/api.d.ts`.

  Start the implementation after #1857 settles, rebase on `auth.py`, and
  regenerate the types last.

## UI and interaction

- See `ui-states.md`. All mutations refetch canonical state (`loadCodes` /
  class list reload), with no optimistic flip.

## Rollout and rollback

- Order:
  1. Apply 337. It is dormant: there are no archived classes, and the old
     backend's PATCH works.
  2. Deploy the backend and frontend.
  3. Per-class admin decisions (D6).
- Do not archive or restore classes between steps 1 and 2.
- Rollback: backend first, then the light or full schema rollback
  (`research.md` §7.1). Details are in `rollout.md`.

## Verification strategy

Use the 326/331 local-PostgreSQL pattern (PG16 and PG17): a disposable
cluster, a double apply, a negative control without 337, and lock-observed
race tests.

1. **Static migration test** (`test_migration_337_class_archive.py`):
   - one transaction with `lock_timeout`;
   - no destructive DDL, no backfill, no `is_active`-dependent CHECK;
   - DEFINER, pinned `search_path` and no client EXECUTE on every new
     function;
   - no 331 object names;
   - `fn_restore_student` keeps the FOR UPDATE literal;
   - preconditions abort without 320 or 326;
   - the rollback note order.
2. **Behaviour:**
   - guard matrix:
     - refused: INSERT, inactive→active, `cohort_id` change;
     - allowed: active→inactive, an already-active upsert (`INSERT … ON
       CONFLICT DO UPDATE` on an active row), name edits, legacy inactive
       classes;
     - removal from A when the next primary class B is archived and still
       active for the learner: succeeds, `students.cohort_id` = B;
     - the membership guard is an `AFTER` row trigger;
     - a bulk add is refused as a whole;
     - `student_archived` takes precedence;
   - metadata trigger:
     - an old-backend-style `UPDATE is_active` both ways never errors;
     - `archived_at` is stamped on true→false and cannot be un-enforced;
   - RPC idempotence, counts and audit;
   - FR-009: apply on a database with a legacy inactive class → it stays
     legacy, the postcondition passes, and the counts are unchanged;
   - restore-student × archived class, with a negative control that shows the
     500 without the fix;
   - rollback (light and full) then re-apply, and the full-rollback refusals.
3. **Races:**
   - archive-first then enroll or give: refused; archive-first then
     restore-student: 200 with the class skipped;
   - archive committing between restore-student's candidate read and its
     membership reactivation (lock-observed): restore 200, class in
     `skipped_archived_cohort_ids`, no 500; archive starting after the
     restore's class lock waits and counts the membership;
   - enroll first then archive: kept and counted, with a measured wait;
   - activation archive mid-flight (FR-008).
4. **Routes** (`test_class_archive_routes.py`):
   - W1–W14;
   - every §5 entry point, including Advanced Vocabulary, grammar lesson and
     diagnostic, timed course, and the mock message;
   - D3 submit and auto-submit;
   - fan-out replay;
   - name-only student PATCH;
   - activation: pre-check, race, revert-failure 503, re-claim, rate limit;
   - no DB text in any response.
5. **Helper grep test:** every `active_cohort_ids_for_student` caller is
   listed with its mode.
6. **Frontend:**
   - `/my-class` model with only-archived and mixed classes;
   - `/home` count;
   - Writing dashboard: closed state and D3 state;
   - instructor table and pickers;
   - admin directory: confirm copy, counts, reason, legacy badge;
   - admin detail: disabled actions.

   Verifier stubs must include `is_active` and `archived_at`.
7. **Existing suites unchanged and green:** 0029, 0031 (including
   `test_only_the_326_functions_write_archived_at`), 334 and 335.
