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
