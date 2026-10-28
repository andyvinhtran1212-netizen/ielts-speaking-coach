# Rollout and rollback

## Preconditions

- CLASSARCHIVE-0030 and 0029 Revision 1 approved on `staging` (this spec PR,
  merge commit).
- Migrations 320, 326 and 331 applied. 337 aborts without 320 or 326, or if
  `fn_restore_student` lost its `FOR UPDATE` literal. 331 is asserted by a
  test.
- The implementation lands after #1857 (async auth layer), because both edit
  `auth.py`.
- No long transaction on `cohorts`, `student_cohort_memberships`,
  `class_assignments`, `class_assignment_items` or `writing_assignments`.
  `lock_timeout` is 5 s, and the file is re-runnable.

## Staging

1. Before apply:
   - snapshot the `/my-class` and `/writing/my-assignments` responses of the 3
     learners of "QA Course 1 Resume 20261010" (FR-009);
   - snapshot the FR-009 count and P2 with separate read-only SELECTs.
2. Apply 337 with the advisory-locked runner. Do not archive or restore classes
   until step 3 is done.
3. Deploy the merged SHA (backend and frontend).
4. Compare the step-1 snapshot (AC-12). Any difference stops the rollout:
   report it and roll back the backend.
5. Run AC-1…AC-11, AC-13 and AC-14 on a fresh `staging_seed.py --ns`
   namespace.
6. Leave the legacy staging class alone unless Vinh asks otherwise.

## Production

1. **D6, authorized now and read-only.** Run P1–P5 (`research.md` §8) and send
   Vinh the per-class table of inactive classes: members, members with no
   other class, open gives, usable codes. Record his decision per class: keep
   legacy, apply archive, or restore.
2. At the `staging` → `main` promotion, with Vinh's explicit authorization:
   - apply 337 under the advisory lock;
   - promote and deploy;
   - run the post-apply catalog (AC-1 queries) and the FR-009 count. It must
     equal the pre-apply count, which is 0.
3. An admin carries out the step-1 decisions through `/admin/classes`: "Áp
   dụng lưu trữ" (with a reason) or "Khôi phục". Each action leaves one audit
   row. The agent never applies an archive on its own.

## Rollback and repair

- **Backend revert:** safe at any time.
  - Archived classes stay enforced by the DB guards; the old backend returns
    500 on those writes.
  - Legacy and active classes are unaffected.
  - Prefer a light schema rollback right after a backend revert.
- **Light schema rollback:** drop the RPCs, the counts function and the four
  guards. Keep the columns, metadata trigger, audit table and the 337
  `fn_restore_student`. The old backend works fully.
- **Full schema rollback:**
  1. Refused while audit rows or `archived_by` values exist (export first).
  2. Do the light steps.
  3. Re-create the 326 `fn_restore_student` body verbatim.
  4. Drop the trigger, the table, then the columns.

  It must not name any 331 object.
- **Repair:** no work rows change, so there is nothing to repair. To hide a
  class archived by mistake, or to show one again, restore it or archive it
  again through the RPCs.

## Observability

- `class_lifecycle_audit`: one row per app archive or restore, with
  `legacy_upgrade` and `was_legacy` flags.
- `access_code_audit`: `enroll_rejected_cohort_archived` (with `race`, and
  `compensation_failed` if set). Any `compensation_failed` row, or the CRITICAL
  log `[auth] cohort-archive activation revert FAILED`, is an incident.
- Request logs:
  - 409 `cohort_archived` per route;
  - zero 500s whose message contains `cohort_archived`;
  - zero 500s on `POST /admin/students/{id}/restore`.
- Owner: Vinh (product). The implementing agent reports T011 and T012 on the
  PR.
