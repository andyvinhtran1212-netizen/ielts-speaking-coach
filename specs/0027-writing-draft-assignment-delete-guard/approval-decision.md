# Approved intent decision

**State: APPROVED by direct human owner reply.** Vinh (repository owner)
approved this spec in his own words at **2026-10-27 07:14 (Asia/Saigon,
UTC+7)**, in the list "0024, 0025, A-05, A-08B, F07-UNIQUE, STUDENT-DELETE".
A-08B is ASSIGNDRAFT-0027.

Approval note: approved by Vinh 2026-10-27 07:14 UTC+7.

This approves the intent in `spec.md` (FR-001…FR-004) and the rollout in
`rollout.md`, with locked migration number 324. It does not authorize running
any production query: the read-only production checks remain pending Vinh's
explicit permission (chờ anh Vinh cho phép chạy chỉ đọc). Production apply
needs its own authorization at release time.

## Revision 1 — 409 message wording (Content Manager item #9)

**State: APPROVED.** Vinh approved at **2026-10-28 21:23 (Asia/Saigon,
UTC+7)** (Leader relay t259u): change `ASSIGNMENT_STARTED_DETAIL` from
"Học viên đã bắt đầu — không xoá được" to Content Manager review item #9 for #1836
(`handoff/leader/20261028-1800-content-manager-review-1836-1825-quyetdinh.md`
§1), spelled "xóa": "Học viên đã bắt đầu làm bài nên không xóa được bài giao này."

Only the wording changes. FR-001…FR-004, the 409 status code, both DELETE
routes, the refusal rules and migration 324 are unchanged. The implementation
updates the constant and its pins (backend test, admin delete-dialog browser
verifier, `backend/migrations/README.md`) in a separate PR after this revision
is on `staging`.
