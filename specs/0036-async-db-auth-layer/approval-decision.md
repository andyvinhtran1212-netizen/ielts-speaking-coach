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
