# Approved intent decision

**State: APPROVED by the human owner.** Leader báo anh Vinh duyệt
CAL-APPENDONLY 30/10 13:38 (t744s2552). Vinh (repository owner) replied on
2026-10-30 at 13:38 (UTC+7), Leader reference t744s2552; the reply contains,
verbatim, "CAL-APPENDONLY ok" (recorded in `process/vinh-decisions-20261030.md`
line 15 and `process/questions-for-vinh.md`).

The question approved, Q-0835-CAL-APPENDONLY (asked 2026-10-30 08:23 UTC+7,
recommendation: approve):

> class_action_log: add BEFORE TRUNCATE trigger + revoke
> TRIGGER/REFERENCES/MAINTAIN from service_role (mig 356, J286/1ec, SA P3 from
> #2022), needs spec amendment.

Context of the question (ticket PC-J286, `reviews/PR-2022.md` P3-SA-1/2/3):

1. TRUNCATE on `class_action_log` is refused only by the ACL (204:22-23);
   332 and 333 already add a `BEFORE TRUNCATE` trigger to their audit tables.
2. `service_role` still holds TRIGGER, REFERENCES and MAINTAIN on the table.
3. The policy `cal_admin_append` is inert since 320; by default it is only
   commented, not dropped.
4. One migration; the Leader assigned number 356 (2026-10-30 08:27 UTC+7) and
   spec number 0041 (ticket PC-J343).

Scope: staging only. The 356 migration is applied to staging under the
advisory lock, after STAGING_FREEZE is lifted, following the migration apply
procedure. This does not authorize applying 356 to production; that is a
separate promotion step and needs Vinh's explicit approval at the `staging` →
`main` promotion.

Not approved here: revoking UPDATE or DELETE from `service_role`, dropping
either policy, or any change to anon/authenticated privileges.
