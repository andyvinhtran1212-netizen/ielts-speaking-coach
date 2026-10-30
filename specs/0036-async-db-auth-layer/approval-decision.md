# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) approved
ASYNCAUTH-0036 on 2026-10-28 12:44 (UTC+7) in the Leader chat ("duyệt"),
relayed by the Leader:

1. PR #1805 (PC-J05 D1, async-DB auth layer) is **reclassified as
   `high-risk`**. It was first filed as `small` / `Spec: N/A`; the
   constitution lists auth among high-risk areas.
2. The spec states **behaviour parity**: no access decision, body, status,
   error detail or query sequence changes (FR-001, FR-002, FR-004).
3. The **`USE_ASYNC_DB` flag stays default off** (FR-001).
4. The spec carries a **measurement plan** for staging (FR-006,
   `rollout.md`).
5. **Rollback** is `USE_ASYNC_DB=false` plus a restart (FR-007).

Earlier decisions this builds on: D1 (a)+(b) from the PC-J05 report (#1795),
approved 2026-10-28 10:49; D2 (worker count) is explicitly not changed.

This approves the intent in `spec.md` (FR-001…FR-007) and the rollout in
`rollout.md`. It does not authorize any Railway variable change by the
implementing agent: the Leader enables `USE_ASYNC_DB` on staging after the
implementation merges. Production keeps the flag off until Vinh gives a
separate go after the staging evidence.

## Revision 1 — FR-001 insert-if-absent provisioning (option 2A)

**State: APPROVED by the human owner.** Vinh approved option 2A for PR #1835
on 2026-10-28 17:53 (UTC+7), relayed by the Leader: update the spec text so
FR-001 describes the actual behaviour. This is a docs/spec change only; no code
changes with it.

- Commit `31ba3f406924` on #1835 (Codex P2 on #1805) made `/auth/me`
  first-visit provisioning conflict-safe: `INSERT … ON CONFLICT (id) DO NOTHING`
  (PostgREST `upsert(on_conflict="id", ignore_duplicates=True)`) followed by
  the existing re-SELECT, in both flag states.
- The approved FR-001 said every converted path runs "its existing sync
  query" with the flag off. Provisioning no longer sends the plain INSERT, so
  FR-001 now names the insert-if-absent exception. The edge case on first
  `/auth/me` was aligned with it.
- Unchanged: risk `high`, FR-002…FR-007, flag default off, parity of the
  query sequence between flag states, and the rollout. The only behaviour
  change is the race outcome: a concurrent first visit gets 200 instead of
  500, and an existing row's role, activation and profile fields are never
  overwritten.

## Revision 2 — a DB failure answers 503 on every auth read (SPEC-DECISIONS-J76 F-4)

**State: APPROVED by the human owner.** Vinh decided on 2026-10-29 13:58
(UTC+7), relayed by the Leader: when the DB is unavailable or errors, the
learner activation gate, the staff guards (`require_admin` /
`require_instructor`) **and** `/auth/check-active` all return 503, and the
spec says 503.

- Context: PC-J76 F-4 and PR #1915 (PC-J86). The spec said 500 for a staff
  role lookup error, while the code (`services/staff_guard.py`, ADMINAAL2-0032
  FR-001) already returned 503. `/auth/check-active` returned 500, unlike the
  gate's 503.
- Spec text: the staff journey and edge cases now say 503, and a
  `/auth/check-active` edge case was added. FR-001…FR-007 text is unchanged;
  FR-002 still requires the same status in both flag states.
- Behaviour change: only `/auth/check-active` on a lookup failure, 500 → 503.
  The body stays `{"detail": {"error_code": "internal_error", "message", "ref"}}`
  (sanitized by `main.py`), so no error text reaches the client. The frontend
  activation probe treats any non-2xx as unknown and fails open, unchanged.
- Unchanged: risk `high`, flag default off, access decisions, the
  `/auth/me` error contract and the rollout.

## Revision 3 — flag-off paths run the sync query in a worker thread (Q5: b)

**State: APPROVED by the human owner.** 2026-10-30 22:13 (UTC+7) Vinh chọn
Q5: b (t1098u, Leader báo): khi cờ tắt, các đường a* và `aexecute` chạy truy
vấn sync trong worker thread; cờ vẫn tắt.

The question (Q5 in the Leader's 2026-10-30 question batch) offered (a) enable
`USE_ASYNC_DB` again, or (b) amend this spec so that with the flag off the a*
functions and `aexecute` run their query in a worker thread
(`asyncio.to_thread`) instead of on the event loop, with results, error codes
and query order unchanged and the flag still off. Vinh answered "Q5: b". The
Leader's addendum of 2026-10-30 22:28 (UTC+7) adds:

- (a) Q5: b includes `aexecute`, so every path it pulls in is in scope:
  `routers/grading.py` (seven calls, one of them an insert),
  `services/student_service.py`, the `routers/admin.py` staff role read and
  `/auth/check-active`. Their existing tests stay green and are not edited to
  pass.
- (b) Sharing the sync singleton across threads rests on the job 001jy
  evidence (PR #2093, `test_supabase_singleton_threadsafe.py`, "THREADSAFE:
  SAFE"). The implementation corrects the code comments that forbid it
  (`backend/database.py:228–234`, `backend/services/db_async.py:20–23`,
  `:182–183`) and the spec records the library versions.
- (c) "Q5: b" is enough to write this amendment and its code and to merge to
  `staging` through the normal gate. **Production still needs Vinh's separate
  approval at the promotion.**
- (d) #2093 (PC-J428) already runs `/auth/me` (`get_me`) in a worker thread
  with the flag off.

Spec text changed:

- `spec.md`: a Revision 3 paragraph; the Vietnamese summary no longer says the
  flag-off code runs exactly as today; Problem, Scope and Non-goals extended;
  FR-001 now says the flag-off sync query runs in a worker thread, awaited in
  sequence; new FR-008 (exact flag-off scope, matching FR-005) and FR-009
  (thread-safety evidence and version pins, comment fix, G4 check for writes);
  Scenario 4; edge cases for the per-request memo, the concurrency change,
  thread safety, the executor, cancellation and rollback; success criteria for
  the flag-off load test and parity.
- `plan.md`, `tasks.md`, `verification.md`, `rollout.md`: the implementation,
  tests, checks and rollback (revert the code; there is no separate flag).

Behaviour change: with the flag off, these queries no longer block the event
loop, and requests for the same entity that used to run one after another can
now overlap (G4). Unchanged: risk `high`, `USE_ASYNC_DB` default off on
staging and production, access decisions, bodies, statuses, error details, the
503 fail-closed contract, the query sequence, the per-request memo, the test
seams, Revisions 1 and 2, the executor size, and no migration or environment
change.
