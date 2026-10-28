# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_admin_students_archive.py (DELETE archives, idempotent, 404) plus research.md §7 AC-2, AC-3 on staging | PENDING |
| FR-002 | kind=journey; ref=research.md §7 AC-4 to AC-8 and AC-14 (lists, roster, assignments, Writing 403, activation 403 with code unused, single/bulk class add and direct-code bridge refused with no membership reactivated) on staging; kind=test; ref=backend/tests/test_migration_326_student_archive.py (membership guards, concurrent archive vs add) | PENDING |
| FR-003 | kind=journey; ref=research.md §7 AC-4 and AC-11 (include_archived listing and restore) on staging; Revision 1 (archived classes skipped): kind=test; ref=specs/0030-class-archive/verification.md FR-007 and AC-10 | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_migration_326_student_archive.py (client cannot execute functions or change is_active) plus AC-9, AC-10 on staging | PENDING |
| FR-005 | kind=query; ref=research.md §7 AC-2 row counts before and after archive and restore | PENDING |
| FR-006 | kind=test; ref=backend/tests/test_admin_students_archive.py (no hard delete reachable from the route); ci=Tests run 40784593322 on staging `56a8c344f`, 35 passed, 0 skipped | PASS |

## Contract evidence

- OpenAPI/type drift: regenerate `frontend/types/api.d.ts` for the new restore
  route, the `include_archived` query and `archived_at` field.
- Backward compatibility: DELETE keeps its path and success status.

## Data evidence

- Migration/schema query: `research.md` §6 P1–P5 on staging after apply.
  Production P1–P6 before apply and the post-apply catalog are recorded under
  Release evidence.
- Immediate state versus full reload: archived learner stays hidden after reload; restore persists.

## UI evidence

- Viewports/themes/input methods: admin students page at desktop and mobile
  widths, light and dark, keyboard-only archive and restore.

## Release evidence

- Staging SHA and checks: the promoted staging SHA
  `c028ed21c910f469d36abfa0907e3fd71d363709` passed Staging release smoke
  (run 40481428210) plus Tests, Next-native, Typecheck, Build checks, Spec
  governance and Legacy guard on 2026-10-27. The staging apply and AC run of
  T008 are not in that record and stay pending.
- Staging apply (reconciled 2026-10-29 from the staging ledger, read-only):
  `326_student_archive.sql` applied 2026-10-27 04:51:15Z (11:51:15 UTC+7),
  after #1746 merged as `7c7338f09ff281d234659b35dd8b24fa682dcceb` (11:43 UTC+7)
  (`/workspace/qa/pcj60/ledger.out.tsv`). The AC-1…AC-14 run is still not
  recorded, so FR-001 to FR-005 stay PENDING.
- Rollback readiness: any backend rollback records the archived-learner count;
  with archived learners present, the archive-compatible rollback build passes
  AC-2, AC-7, AC-8 and AC-14 before taking traffic (`rollout.md`).
  At release, production had 0 archived learners and nothing was rolled back.
- Production verification: migration done (T007, T009); UI journeys pending.
  Details below.

### Production — 2026-10-27

Released with promotion PR #1763 (`staging` → `main`), merge commit `c9d564dfeac2df42611dcd308aaad1a2e970c580`, merged 2026-10-27 17:09 UTC+7.
Vinh authorized the apply on 2026-10-27 16:32–16:33 UTC+7. Every check below
is a read-only catalog or count query (no PII). The results come from the
operator's release log for #1763.

| Step | Time (UTC+7) | Observed |
| --- | --- | --- |
| P1–P6 before apply | 17:08:40 | P1: the 27 FKs into `students`, `writing_essays` and `class_assignment_items` are byte-identical to the 15:43 read. P2: no `archived_*`/`archive_reason` columns, no `student_lifecycle_audit`, no archive functions. P3: students 73, linked 73, essays 692, drafts 4, active memberships 62. P4: trigger 320 enabled `O`. P5: fingerprints and ACLs of the roster, fan-out and membership functions are identical to the 15:43 read; `authenticated` has no UPDATE on `students`. P6: 326 not in the ledger; ledger from 321 onward = 323, 324, 325. |
| Apply 326 | 17:08:59 | Locked runner. Lock released; ledger `applied_at` 2026-10-27 10:09:01 UTC. |
| Merge | 17:09:02 | `gh pr merge 1763 --merge --match-head-commit c028ed21c…`. Merged 10:09:05 UTC, about 4 s after 326. |
| After apply | 17:09 | Columns `archive_reason`, `archived_at`, `archived_by` present. 0 archived learners; 0 `student_lifecycle_audit` rows; audit RLS on; no client EXECUTE on the archive functions. md5 matches the plan exactly: `fn_archive_student` 18cb413e…, `fn_restore_student` bf721ebc…, `fn_add_student_cohort_membership` ec382a74…, `fn_add_students_cohort_membership` efeee5b2…, `fn_sync_legacy_student_cohort_membership` 2b53d497…. Scale unchanged at 73/73/692/4/62. Ledger from 321 onward = 323, 324, 325, 326; lock not held. |
| Deploy | 17:09:39–17:10:52 | Railway deploy `64a398a8-ec41-4208-8f87-ed71793f641f` (`c9d564dfe`) succeeded; Vercel `runtime-config.js` release = `c9d564dfe`. The new backend served about 1 m 51 s after 326. During that gap the old deploy logged 60 requests with 0 × 5xx and no `/admin/students` hits. |
| Smoke | 21:16–21:18 | Anonymous `GET /admin/students` returns 401. Railway HTTP logs on the new deploy from 10:10 to 14:17 UTC: 2832 requests, 0 × 5xx. `main` CI on `c9d564dfe` is green, and Production release drift run 40519770482 passed. |

This is the production counterpart of AC-1 (catalog). The FR rows above stay
`PENDING` because they cite CI tests and staging journeys that this record does
not cover.

Not yet run on production:

- Archive and restore one E2E or Vinh-designated test learner (`rollout.md`
  Production; FR-001, FR-003, FR-005). **Pending — owner account decision (not
  yet run).**
- An authenticated admin load of `/admin/students` (`GET /admin/students`,
  including `?include_archived=true`). Only the anonymous 401 and the absence
  of 5xx in the logs are recorded. **Pending — owner account decision (not yet
  run).**
