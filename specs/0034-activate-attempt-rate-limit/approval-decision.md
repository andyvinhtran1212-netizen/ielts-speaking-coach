# Approved intent decision

**State: NOT YET APPROVED.** Vinh chose the Postgres counter on 2026-10-28 at
09:40 (+07) (brief H-1028-FD4, "Cập nhật 28/10 09:40"): an atomic
`fn_activate_attempt_check(user_id)` callable only by `service_role`, 10
attempts per 10 minutes per user, 503 `activation_unavailable` on database
failure (fail-closed), no code consumed. That decision fixes the contract; this
spec's FR-001…FR-005 text and its Decisions (in-RPC cleanup of rows older than
1 day, per-user advisory lock, only allowed attempts counted) still need the
owner's approval before implementation can merge. Migration number **334** was
assigned by the Leader.

Approval of this spec would not authorize applying 334 to production: staging
apply follows the staging-first runbook, and production apply needs the
owner's explicit authorization at the `staging` → `main` promotion.
