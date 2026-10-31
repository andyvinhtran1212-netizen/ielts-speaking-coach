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
3. The policy `cal_admin_append` was inert since 320 (P3-SA-3). Approved
   RLSCLEANUP-0039 assigns removal of it and `cal_admin_read`, plus all
   anon/authenticated privileges on the table, to migration 344.
4. One migration; the Leader assigned number 356 (2026-10-30 08:27 UTC+7) and
   spec number 0041 (ticket PC-J343).

Scope: staging only. The 356 migration is applied to staging under the
advisory lock, after STAGING_FREEZE is lifted, following the migration apply
procedure. This does not authorize applying 356 to production; that is a
separate promotion step and needs Vinh's explicit approval at the `staging` →
`main` promotion.

## Approved CALUD amendment (PC-J347)

Leader báo anh Vinh duyệt 14:07 (t803u). On 2026-10-30 at 14:07 (UTC+7),
Vinh's verbatim reply to Q-1403-CAL-REVOKE-UD was "CALUD ok"
(`process/questions-for-vinh.md:146-147`,
`process/vinh-decisions-20261030.md:20`; SA F1/F2 in `reviews/PR-2045.md`).

This extends the original approval: migration 356 revokes UPDATE and DELETE
from service_role as a second defense beside the row trigger from 198,
repeating the revoke for PUBLIC, anon and authenticated. After 356,
service_role has SELECT and INSERT only. Its UPDATE/DELETE failure changes
from trigger `P0001` to ACL `42501`; ACCESS EXCLUSIVE LOCK and SELECT FOR
UPDATE must also be refused. The down script must not restore UPDATE/DELETE.
The backend audit found only INSERT and SELECT consumers (see `research.md`).

The CALUD amendment was originally stacked on #2045 head
`5d9296ec292db288d4209d14f563a38c3b352ca1`; implementation and real-PostgreSQL
acceptance evidence remain T001. The staging-only authorization above still
applies. Policy DDL in 356, granting client privileges, changing default ACLs,
and applying 356 to production remain outside this approval.

## Alignment with approved RLSCLEANUP-0039

Leader's alignment instruction for #2045 and #2054 pins **344 then 356**.
Migration 344 drops both policies and revokes every anon/authenticated
privilege under 0039 FR-001/FR-002. Migration 356 must not preserve, recreate,
comment on or rely on those policies, or change that client-ACL state.
FR-003 is retained and rewritten as this compatibility requirement, with
fixtures for both already-applied-344 and isolated pre-344 databases; it is
not removed. The approved CALUD FR-004 is retained in both copies of 0041 so
the directories are identical on #2045 and #2054. No migration implementation
or database apply is included in this alignment.
