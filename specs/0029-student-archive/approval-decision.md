# Approved intent decision

**State: APPROVED by direct human owner reply.** Vinh (repository owner)
approved this spec in his own words at **2026-10-27 07:14 (Asia/Saigon,
UTC+7)**, in the list "0024, 0025, A-05, A-08B, F07-UNIQUE, STUDENT-DELETE".
STUDENT-DELETE is STUDENTARCHIVE-0029.

Approval note: approved by Vinh 2026-10-27 07:14 UTC+7.

This approves the intent in `spec.md` (FR-001…FR-006) and the rollout in
`rollout.md`, with locked migration number 326. It does not authorize running
any production query: the read-only production checks remain pending Vinh's
explicit permission (chờ anh Vinh cho phép chạy chỉ đọc). Production apply
needs its own authorization at release time.

## Revision 1 — FR-003: restore skips archived classes (CLASSARCHIVE-0030 D2=a)

**State: APPROVED by the human owner.** Vinh chose option (a) for decision D2
of the A-10 / CLASSARCHIVE-0030 review at t259u, 2026-10-28 21:23 (UTC+7),
relayed by the Leader. That choice re-approves this spec with the FR-003
change below.

- **Why:** `fn_restore_student` (326, live on staging and production)
  re-activates every membership the archive ended. Its CTE skips only deleted
  classes. CLASSARCHIVE-0030 (migration 337) refuses any membership becoming
  active in an archived class, so without this change a restore that touches
  an archived class aborts as a whole and the route returns 500.
- **Change:** restore skips memberships in archived classes (`is_active =
  false AND archived_at IS NOT NULL`). It never points `students.cohort_id` at
  one, and it lists them as `skipped_archived_cohort_ids` in the receipt and
  the restore audit row. Classes that were inactive before 337 (legacy, with
  `archived_at` NULL) are restored as today.
- **Implemented by** CLASSARCHIVE-0030 migration 337, which replaces the
  function body in the same transaction as the guard. The replacement keeps
  the signature, SECURITY DEFINER, `search_path`, the ACL and the literal
  `students WHERE id = p_student_id FOR UPDATE` that 331 relies on.
- **Unchanged:** FR-001, FR-002 and FR-004…FR-006, the risk class, and the
  rollout. `research.md` §4 keeps the original 326 SQL as the historical
  record.
