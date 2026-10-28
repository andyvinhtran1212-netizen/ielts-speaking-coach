# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) approved
ACTIVATELIMIT-0034 (FR-001…FR-005) as written in the Leader chat on 2026-10-28
at 16:26 (+07), including the Decisions in `spec.md` §Decisions (in-RPC cleanup
of rows older than 1 day, per-user transaction advisory lock, only allowed
attempts counted, no FK to `users`).

Earlier, on 2026-10-28 at 09:40 (+07) (brief H-1028-FD4, "Cập nhật 28/10
09:40"), Vinh chose the Postgres counter: an atomic
`fn_activate_attempt_check(user_id)` callable only by `service_role`, 10
attempts per 10 minutes per user, 503 `activation_unavailable` on database
failure (fail-closed), no code consumed. Migration number **334** was assigned
by the Leader.

This approves the intent in `spec.md` and the rollout in `rollout.md`. It does
not authorize applying 334 to any database: the Leader applies it on staging
under the staging-first runbook, and production apply needs the owner's
explicit authorization at the `staging` → `main` promotion.
