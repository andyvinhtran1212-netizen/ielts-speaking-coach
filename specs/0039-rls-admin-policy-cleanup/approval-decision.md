# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) approved this
work on 2026-10-29 at 14:44 (UTC+7), verbatim:

> "Duyệt cả 5 theo đề xuất"

The answer covers item (c) "RLS-ADMIN + BL-11 – bỏ policy gọi hàm đã thu hồi
quyền" in `handoff/leader/20261029-1442-fd-questions-vinh.md`. The Leader
verified it directly in the Leader chat. The decision recorded there for (c):
"RLS-ADMIN + BL-11: duyệt, migration 344, làm sau F14". The Leader chose option
(a) and confirmed spec number 0039 and migration number 344 on 2026-10-29 at
14:53 (UTC+7).

The approved proposal:

1. One migration that only runs DROP POLICY and REVOKE; no new GRANT.
2. Postcondition: no policy calls `public.is_current_user_admin()` or
   `public.is_current_user_instructor()`.
3. `service_role` privileges unchanged. Done after F14 (F14 is closed: migration
   320 is on staging and production).

Scope: staging only. The Leader applies 344 to staging under the advisory lock.
This does not authorize applying 344 to production; that needs the owner's
explicit authorization at the `staging` → `main` promotion.

This spec replaces PC-J07
(`handoff/leader/20261028-0920-project-coordinator-PC-J07-rls-admin-policy-spec.md`,
marked SUPERSEDED).
