# Migrations

Forward-only SQL migrations, applied in numeric order. Each file is named
`NNN_short_description.sql`. New migrations take the next unused number.

## Numbering quirks (read before auto-numbering a new migration)

The sequence is **not** perfectly contiguous. These gaps/suffixes are intentional
and must not be "filled in" by tooling:

- **091 and 092 do not exist.** The sequence jumps `090_reading_anon_attempts.sql`
  → `093_add_sessions_tokens_used.sql`. Numbers were reserved and dropped; do not
  reuse 091/092 — always take the next number **above the current max**.
- **Suffix numbers are deliberate variants**, not duplicates:
  `019/019b`, `022/022b`, `032/032_rollback`.
- **`032_rollback.sql` is a ROLLBACK**, not a forward migration. It lives here for
  colocation with `032_*`, but it reverses that change — do not apply it as part of
  a normal forward run, and ignore it when computing the next number.

## Finding the next number

Take the max numeric prefix across `*.sql` and add 1 — do **not** assume the
sequence is dense. As of 2026-11-04 the highest is `367` (PC-J612; `366` is
PC-J611, `365` is PC-J603, `363` is PC-J538, `361` is PC-J358, #2180; `360`
is PC-J192, INSTRUCTORGIVE-0044), so by that rule the next new
migration is `368`. Ask the Leader before taking it; 348–351 are reserved for other
work, `364` is held by PC-J544 (SVCPRIV-0042 T001), and 353–359 and 362 without a file here may be held by open PRs: none may be
reused.
The runner applies any unapplied file regardless of order.
Numbers 321–326 belong to 321 WRITINGRATE-0025, 322 AIOPS-0024 (#1837), 323
ROLECHECK-0026, 324 ASSIGNDRAFT-0027, 325 CODEUNIQ-0028 and 326
STUDENTARCHIVE-0029. 327–330 have no file and must not be reused: 327–329 were
reserved, and 330 was the first reservation for A-10, which took 337 instead
(CLASSARCHIVE-0030 D1). 331 is GIVEARCHIVE-0031, 332 is ADMINAAL2-0032, 333 is
AIBUDGET-0033, 334 is ACTIVATELIMIT-0034, 335 is INACTIVEWRITE-0035, 336 is
ADMINAAL2-0032 FR-019 (#1853), 337 is A-10 CLASSARCHIVE-0030, 338 is
PAPERUPDATEDAT-0037 and 339 is GRAMMARAUDIT-0019 Revision 2 (reserved by the
Leader on 2026-10-29). Every number from 331 to 339 now has a file. 340
is the AIBUDGET-0033 hardening. 345 is
PC-J119 (RLS-ADMIN-INLINE-AAL2 + GRAMMAR-FN-SEARCHPATH, spec ADMINAAL2-0032),
reserved by the Leader on 2026-10-29; 341 is PC-J88 (STAFF-GUC-BYPASS +
MIG322-HARDEN, #2050), assigned by the Leader on 2026-10-29; 342 is reserved
for other open work and must not be reused (343 is PC-J133R, STORAGELIMITS-0038). 344 is PC-J131R (RLSCLEANUP-0039, RLS-ADMIN +
BL-11), reserved by the Leader on 2026-10-29. 346 is PC-J153 (CLASSARCHIVE-0030 FR-003),
assigned by the Leader on 2026-10-29. 347 is PC-J163 (listening_tests client revoke,
spec LISTENING-0005), given by the Leader on 2026-10-29.

Migration `341` (PC-J88; Security Auditor PC-J74 F1/F2/F3, ADMINAAL2-0032
and AIOPS-0024) stops the 332/336 staff triggers trusting session settings. A
direct SQL session could `SET LOCAL aver.bootstrap`/`aver.staff_privilege`/
`aver.actor_id` and turn a suspended account into an active admin with no audit
row or owner alert. Now `fn_set_staff_privilege` and
`fn_bootstrap_admin_recovery` write one row in the owner-only
`staff_privilege_evidence` table (RLS on, no grant to any API role), keyed by
transaction id and target, right before their single UPDATE. The row is gone
before they return. The suspension guard opens only on that evidence. The role
freeze opens only on the bootstrap's evidence (FR-019). The audit trigger always
writes exactly one row: `admin_api` with the RPC's labels, `bootstrap_recovery`
for the bootstrap, and otherwise `service` (a real `service_role` session with
a service JWT) or `out_of_band` with no actor, reason or request id. Admin
changes still queue one outbox row. If the audit trigger is missing (332 header
rollback), both functions write that one row themselves. Function names,
arguments, results, security mode, `search_path` and ACLs are unchanged.
Migration 341 also revokes client privileges on the 322 identity sequences
(F2), and makes `fn_ai_model_override_audit` SECURITY DEFINER (F3). For F3,
`service_role` loses INSERT on `ai_model_override_audit` and a BEFORE TRUNCATE
trigger refuses TRUNCATE for every role. PC-J74 F5 is covered by `345`.
P2-SA-1 (PC-J356) removes service_role's TRIGGER, REFERENCES and TRUNCATE on
`public.users`, plus MAINTAIN on PG17+, to block a planted trigger executing as
the owner inside the staff RPC. Postconditions require those privileges to be
absent and the evidence ACL to grant nothing to any non-owner. Trigger checks
accept enabled (`O`) and always enabled (`A`) guards.
341 is held by `forward-policy.tsv` as `pending_feature admin_aal2`: apply only
with `MIGRATION_FEATURES=admin_aal2` through the advisory-locked runner, staging
first after SA review, production only at an explicitly authorised
staging→main promotion. It needs no backend change.
One transaction, no data change, re-runnable. Re-running 322/332/336 restores
the weak bodies, so re-run 341 after them. The rollback in the header reopens
F1.

Migration `361` (PC-J358; SA P3-2, P3-7, SA-R4-1/2/3, SA-2180-1 on #2180)
is the forward hardening of 341, which is applied on staging and never
edited. It needs 341 in `_schema_migrations` and runs after it: on staging on
top of the applied 341, on production back to back with 341 at one promotion
(the runner records 341 before opening 361). An owner-only deferred constraint
trigger rejects COMMIT with `staff_privilege_evidence_not_consumed` while any
evidence row remains, including a row whose key an owner changed; the RPC and
the bootstrap still consume theirs and commit. The audit trigger consumes the
evidence by `OLD.id`, like both guards. The postconditions repeat 341's and
also refuse client INSERT/UPDATE/DELETE, column-level I/U/R and privileges
reachable through a membership even with INHERIT FALSE (`MEMBER`,
fail-closed). The whole file runs under `SET LOCAL search_path = pg_catalog,
pg_temp`; catalog functions are called as `pg_catalog.<fn>` and the anyarray
operators as `OPERATOR(pg_catalog.||)` / `OPERATOR(pg_catalog.@>)`, because an
exact `text[]` copy in `public` would win over them even with `pg_catalog`
first. The precondition aborts with `catalog_name_shadowed_in_public` if
`public` holds a function or operator named like one the file uses. For manual
dumps use `pg_dump --exclude-table-data=public.staff_privilege_evidence`: the
table holds transient evidence, never audit data. The 341 header's client
sequence GRANT is **DO NOT RUN** (SA P3-6); the `updated_by` attribution and
parent-table owner TRUNCATE gaps (SA P3-5) stay open. 361 is held by
`forward-policy.tsv` as `pending_feature admin_aal2`: apply only with
`MIGRATION_FEATURES=admin_aal2` through the advisory-locked runner, staging
first after SA review, production only at an explicitly authorised
staging→main promotion after 341. One transaction, no data change,
re-runnable; re-running 341 restores the `NEW.id` audit body, so re-run 361
after it. Its header rollback drops only the 361 trigger and function and
restores the 341 audit body; it grants nothing.

Migration `362` (PC-J522, STORAGELIMITS-0038; BUCKET50 a, Vinh t1246u
02/11 06:37) follows immutable 343, confirmed in the staging ledger at
2026-11-02 01:51:21Z. It sets only `listening-audio.file_size_limit` to
`52428800` (50 MiB); all MIME types, visibility, other buckets and objects
are unchanged. One transaction, 5 s lock timeout, idempotent; a missing bucket
or failed postcondition aborts. The header down script restores the historical
343 limit only. Same `pending_feature storage_bucket_limits` group: no apply
on merge; Leader applies staging under the advisory lock, then checks the
bucket value and uploads up to 50 MiB. Production remains uninspected and
requires separate owner authorization at promotion.

Migration `363` (PC-J538; SA-2180-R3-2 on #2180) pins the users audit trigger
chain after 361, which it never edits. `fn_users_privilege_audit` (SECURITY
DEFINER) and the writer it calls, `fn_staff_security_record` (SECURITY
INVOKER, so it runs as the definer), kept `search_path = public, pg_temp`
and called `jsonb_build_object`, `gen_random_uuid`, `current_setting`,
`pg_current_xact_id` and `now` without a schema. A role with CREATE on
`public` could add an exact typed overload (for example
`jsonb_build_object(text,text,text,boolean,text,timestamptz)`) that beats the
catalog's VARIADIC version and runs as the owner on the next users update. 363
recreates both with their current bodies, `SET search_path = pg_catalog,
pg_temp` and `pg_catalog.<fn>` calls; owner, security mode and the owner-only
ACL are unchanged. It needs 361 in `_schema_migrations` (`migration_361_missing`)
and refuses with `catalog_name_shadowed_in_public` while a shadow is already
planted (remove it first: it is an incident). The postcondition checks the
exact `proconfig`, no unqualified catalog call in either body, the OLD.id key,
owner and EXECUTE, and the trigger. Order is 361 → 363: on staging on top of
the applied 361, on production back to back after 341 and 361 at one
promotion. 363 is held by `forward-policy.tsv` as `pending_feature
admin_aal2`: apply only with `MIGRATION_FEATURES=admin_aal2` through the
advisory-locked runner, staging first after SA review, production only at an
explicitly authorised staging→main promotion after 361. One transaction, no
data change, re-runnable; re-running 332, 341 or 361 restores the `public`
path, so re-run 363 after it. `rollback/363_users_privilege_audit_search_path.sql`
restores the 361/332 bodies, reopens SA-2180-R3-2 and grants nothing. Other
definers with `search_path = public, pg_temp` (`fn_set_staff_privilege`,
`fn_ai_model_override_audit`) are not covered by 363.

Migration `365` (PC-J603; SA-2209 residual P2 after 363) pins the rest of
the staff-security chain, which 332, 336, 341, 361 and 363 left on
`search_path = public, pg_temp` with unqualified catalog calls:
`fn_set_staff_privilege` (SECURITY DEFINER, EXECUTE for service_role, so the
role that can plant a typed `jsonb_build_object` overload in `public` can also
call the RPC that runs it as the owner), `fn_ai_model_override_audit`
(definer trigger), the 332/336 guards `fn_users_suspension_guard` and
`fn_users_suspension_role_guard` (invoker triggers the RPC runs as the owner),
`fn_bootstrap_admin_recovery` and `fn_staff_security_audit_append_only`. It
recreates the five functions that call catalog functions with their 341/332
bodies, `SET search_path = pg_catalog, pg_temp` and `pg_catalog.<fn>` calls,
and only `ALTER FUNCTION … SET search_path` on `fn_ai_model_override_audit`,
which calls none. Owner, security mode and ACLs are unchanged (service_role
keeps EXECUTE on the RPC only). It needs 361 and 363 in `_schema_migrations`
with the 363 pin in place (`migration_363_missing`) and refuses with
`catalog_name_shadowed_in_public` while a shadow is already planted (remove it
first: it is an incident). The postcondition checks the exact `proconfig`, no
unqualified catalog call, security mode, owner, EXECUTE and the five triggers.
Order is 361 → 363 → 365: on staging on top of the applied 363, on production
back to back after 341, 361 and 363 at one promotion. 365 is held by
`forward-policy.tsv` as `pending_feature admin_aal2`: apply only with
`MIGRATION_FEATURES=admin_aal2` through the advisory-locked runner, staging
first after SA review, production only at an explicitly authorised
staging→main promotion after 363. One transaction, no data change,
re-runnable; re-running 332, 336 or 341 restores the `public` path, so re-run
361, 363 and 365 after it; re-running 361 alone after 365 aborts at its
postcondition and changes nothing. `rollback/365_staff_security_chain_search_path.sql`
restores the 341/332 bodies and path, reopens SA-2209 for these six functions
and grants nothing. The other definers SA-2209 lists (326, 331, 333, 337, 339,
340 groups and older files) are not covered by 365.

Migration `366` (PC-J611; SA-2209 residual P2, STUDENTARCHIVE-0029 /
GIVEARCHIVE-0031) pins the SECURITY DEFINER functions of 326 and 331, which
ran as their owner on `search_path = public, pg_temp`:
`fn_archive_student`, `fn_add_student_cohort_membership` and
`fn_add_students_cohort_membership` (EXECUTE for service_role, which before
357 could also plant a typed overload such as `public.to_jsonb(uuid[])` or a
table named like an unqualified one), the legacy `cohort_id` trigger
`fn_sync_legacy_student_cohort_membership` and the 331 give guard
`fn_guard_writing_assignment_student_archived`. It recreates the four 326
functions with their bodies, `SET search_path = pg_catalog, pg_temp`,
`pg_catalog.<fn>` calls and `public.<table>` names (with `public` off the
path an unqualified table would resolve to `pg_temp`), and only
`ALTER FUNCTION … SET search_path` on the 331 guard, which calls no function.
Owner, SECURITY DEFINER and ACLs are unchanged; the file grants and revokes
nothing. It needs 326, 331 and 365 in `_schema_migrations`
(`migration_366_prerequisite_missing`) and refuses with
`catalog_name_shadowed_in_public` while a shadow is already planted (remove it
first: it is an incident). The postcondition checks the exact `proconfig`, no
unqualified catalog call or table, definer mode, owner, EXECUTE (none for
PUBLIC, anon or authenticated; service_role on the three RPCs) and the two
triggers. Order is 363 → 365 → 366, held with them by `forward-policy.tsv` as
`pending_feature admin_aal2`: apply only with `MIGRATION_FEATURES=admin_aal2`
through the advisory-locked runner, staging first after SA review, production
only at an explicitly authorised staging→main promotion after 365. One
transaction, no data change, re-runnable; re-running 326 or 331 restores the
`public` path, so re-run 366 after it.
`rollback/366_student_archive_definer_search_path.sql` restores the 326 bodies
and the 331 path, reopens SA-2209 for these five functions and grants nothing.
The other definers SA-2209 lists (333, 337, 339, 340 groups and older files)
are not covered by 366.

Migration `367` (PC-J612; SA-2209 residual P2, AIBUDGET-0033) pins the 22
SECURITY DEFINER functions 333 created and 340 left unchanged, which ran as
their owner on `search_path = public, pg_temp`: the 11 service_role RPCs
`fn_ai_budget_release`, `fn_ai_budget_expire`, `fn_ai_budget_close_scope`,
`fn_ai_deferred_save`, `fn_ai_deferred_claim`, `fn_ai_deferred_claim_writing`,
`fn_ai_deferred_aggregate_write`, `fn_ai_session_bands_write`,
`fn_ai_class_sync`, `fn_ai_budget_raise_end` and
`fn_ai_budget_raise_expire_sweep`, and the 11 internal functions
`fn_ai_budget_thresholds`, `fn_ai_budget_lock_counter`,
`fn_ai_budget_alert_crossings`, `fn_ai_budget_active_raise`,
`fn_ai_response_revision`, `fn_ai_patch_row`, `fn_ai_insert_row`,
`fn_ai_budget_ensure_refresh`, `fn_ai_budget_raise_record_end`,
`fn_ai_budget_recompute` and the `responses` trigger
`fn_ai_session_generation_bump`. A typed overload planted in public (before
357 service_role could, e.g. `public.to_jsonb(public.ai_deferred_grading_jobs)`,
`public.array_agg(uuid)` or `public.jsonb_populate_record(public.sessions,
jsonb)` reached through the dynamic UPDATE of `fn_ai_patch_row`) ran as the
owner. It recreates 18 of them with their 333 bodies,
`SET search_path = pg_catalog, pg_temp` and `pg_catalog.<fn>` calls (333
already names every table `public.<table>`), and only
`ALTER FUNCTION … SET search_path` on the four that call no catalog
function. Owner, SECURITY DEFINER, volatility and ACLs are unchanged; the file
grants and revokes nothing. It needs 333 and 340 in `_schema_migrations`
(`migration_367_prerequisite_missing`), refuses with
`catalog_name_shadowed_in_public` while a shadow is already planted (remove it
first: it is an incident) and with `trigger_function_without_search_path` if a
trigger on a table these functions write has no path of its own (it would
inherit the pinned one). The postcondition checks the exact `proconfig`, no
unqualified catalog call or table, definer mode, owner, EXECUTE (none for
PUBLIC, anon or authenticated; service_role on exactly the 11 RPCs) and the
generation trigger. It is held with 333 and 340 by `forward-policy.tsv` as
`pending_feature ai_budget`, not with 363/365/366: 340's postcondition still
requires the `public` path on these functions, so the order is 333 → 340 →
367. Apply only with `MIGRATION_FEATURES=ai_budget` through the
advisory-locked runner, staging first after SA review (staging has 333 but not
340 yet), production only at an explicitly authorised staging→main promotion
after 340. One transaction, no data change, re-runnable; re-running 333
restores the `public` path, so re-run 340 and then 367 after it; re-running
340 alone after 367 aborts on its own postcondition and changes nothing.
`rollback/367_ai_budget_definer_search_path.sql` restores the 333 bodies and
paths, reopens SA-2209 for these 22 functions and grants nothing. The six 340
definers (`fn_ai_budget_assert_finite`, `fn_ai_budget_reserve`,
`fn_ai_budget_settle`, `fn_ai_deferred_commit`,
`fn_ai_deferred_commit_writing`, `fn_ai_budget_raise_grant`) and the 337, 339
and older groups are not covered by 367.

Migration `356` (PC-J286, CALAPPEND-0041 FR-001..004) adds the statement trigger
`trg_class_action_log_no_truncate` and its pinned, `P0001`-raising function.
It keeps 198's row trigger unchanged and revokes UPDATE, DELETE, TRUNCATE,
TRIGGER, REFERENCES and PG17 MAINTAIN from `service_role` / PUBLIC; backend
SELECT and INSERT remain. Managed databases must have the 344 ledger row and
neither old `cal_admin_*` policy before any change; a ledger-free legacy test
control preserves its policies and client SELECT ACL. Postconditions reject
residual effective table/column privileges (including those a role reaches by
`SET ROLE` through a membership), a disabled row trigger, unsafe service-role
ownership/membership, client EXECUTE on the trigger function (SA-R4-1, P3) or
replication-parameter grants. No policy
DDL, grants or data changes; one transaction, 5 s lock timeout, re-runnable.
The `class_action_log_append_only` forward-policy group holds it out of normal
applies. This job opens a PR only: the Leader must separately authorize the
staging apply with SA and establish STAGING_FREEZE; production requires its
own authorized promotion. Deployment order is **344 then 356**. Rollback is
assigned to the separate 0042 task by the PC-J401 job addendum: it must keep
privileges revoked and policies absent, and run before any down 344. There is no
356 down script in this patch. Trigger mode remains `O` as approved: an owner
with permission to set `session_replication_role=replica` can deliberately
bypass it; service_role must have no such parameter permission.
After an authorized apply, check the trigger catalog, effective privilege
matrix and policy absence per `specs/0041-class-action-log-append-only/rollout.md`.
Watch for the warning `[class] KHÔNG ghi được nhật ký` on failed backend inserts.

Migration `355` (PC-J267, VOCABGUARD-0040 FR-001) replaces only the published
curated vocabulary review/task guards from 234/235. UPDATE checks both OLD and
NEW parent versions and rejects either published parent with the existing
immutable error; INSERT still checks NEW and DELETE still checks OLD. Parent
rows are locked `FOR SHARE` in ascending UUID order. No data, trigger, owner,
grant or RLS changes; one transaction with a 5 s lock timeout, re-runnable. The
executable manual down script in the file header restores the 234/235 bodies
and reopens the bypass. `forward-policy.tsv` holds 355 in the separate
`vocab_curated_guard_reparent` group so opting into the original `curated_vocab`
group does not authorize this apply. The Leader verifies 234/235 are applied,
then explicitly opts in with `MIGRATION_FEATURES=vocab_curated_guard_reparent`
under the advisory-locked runner and STAGING_FREEZE, staging first. Production
requires separate owner approval at promotion; merging does not apply 355.

Migration `353` (PC-J252 / PC-J512, PAPERUPDATEDAT-0037 FR-006 + FR-007)
fixes the Listening package publish/archive RPC
(`set_listening_content_package_status`), which raised 55000
`listening_package_child_immutable` once 306/308 were active. It replaces only
two function bodies, both pinned to `search_path = pg_catalog, public, pg_temp`:
295's `fn_protect_listening_package_child` also accepts the `policy_revision`
+1 that 306's policy guard derives from a status/`is_public` change (contract
active, transition GUC still required), and 306's `fn_guard_mock_paper_source`
no longer bumps `listening_tests.mock_content_revision` for an UPDATE of
`listening_content`/`listening_exercises` that changes only `status` (and
`updated_at`). Other column changes, INSERT and DELETE are unchanged, so
importing a new package with 306 active still raises 55000 (Q-J252-IMPORT,
open). No data, trigger, owner or RLS change; the 306 ACL of the source guard is
re-asserted; one transaction with a 5 s lock timeout, re-runnable. The manual
down script `rollback/353_listening_package_status_revision.sql` restores the
exact 295/306 bodies. `forward-policy.tsv` holds 353 in the
`listening_package_status_revision` group: the Leader applies it with
`MIGRATION_FEATURES=listening_package_status_revision` under the
advisory-locked runner and STAGING_FREEZE, staging first; merging does not
apply 353.

348–350 remain allocated to other jobs; do not reuse them. 351 is PC-J220,
allocated by the Leader on 2026-10-29 (350 belongs to PC-J170).

Migration `344` (PC-J131R, RLSCLEANUP-0039) drops the 29 policies calling
`is_current_user_admin()` / `is_current_user_instructor()` and the three dead
BL-11 write policies on `error_logs`, `essay_regrade_requests` and
`writing_drafts`. It revokes SELECT through TRIGGER, plus MAINTAIN on PG17,
from `anon` and `authenticated` on the 21 tables in the spec's T001 catalog.
Migration 320 must already be in the ledger; all 21 tables must exist with
RLS enabled. No data changes or grants. The postconditions check effective
client table/column privileges (including PUBLIC and inherited grants), RLS,
unchanged `service_role` ACL entries, unchanged helper ACLs, and unchanged
non-target policies. Surviving PUBLIC/column grants or helper policies in
any schema abort the transaction instead of expanding the drop/revoke scope.
The learner own-read policies stay. Migration 345 already revokes client
access to `access_codes`; 344 repeats that revoke safely and never recreates
`"Admin only"`. It does not touch the six other 345 tables, the 332 audit
tables or `public.regrade_requests` (342). One transaction, `lock_timeout`
5 seconds, re-runnable. Group `rls_admin_cleanup` in `forward-policy.tsv`:
merging does not apply it. The Leader applies staging first, after
STAGING_FREEZE is lifted, with the advisory-locked runner; production only
at a separately authorized staging-to-main promotion approved by Vinh.
The guarded manual down script is
`rollback/344_rls_admin_policy_cleanup.sql`: set
`aver.allow_rls_admin_policy_rollback = 'on'` in that session first. It
recreates the original 32 policies only when all client table/column
privileges and both helpers' client EXECUTE are still closed. It never
restores a table privilege or helper EXECUTE and is safe to repeat.

Migration `343` (PC-J133R, STORAGELIMITS-0038) sets the T001 size/MIME limits
on the six Storage buckets. It updates only `file_size_limit` and
`allowed_mime_types`; visibility and existing objects stay unchanged, including
private `writing-images`. One transaction, `lock_timeout` 5s, re-runnable;
missing buckets or incorrect postconditions abort. The header contains the
read-only postcheck and a down script restoring the staging T001 `NULL`/`NULL`
values. Deploy the upload checks and Speaking MIME normalisation first.
Group `storage_bucket_limits` in `forward-policy.tsv`: no apply on merge;
Leader applies staging under the advisory lock. Production census and apply
require Vinh's separate approval at promotion; verify rollback values first.
The project-wide cap still applies (staging 50 MiB).

Migration `347` (PC-J163) revokes ALL on `listening_tests` from `PUBLIC`,
`anon` and `authenticated` (MAINTAIN included on PG 17). 295 closed the other
Listening content tables but missed this one, which kept the 320-narrowed
`anon`/`authenticated` SELECT. RLS with no policy hid the rows, so one broad
SELECT policy would have exposed every Listening form and its answers through
`/rest/v1/`. FastAPI reads and writes the table with `service_role` only, and
`listening_public_practice_catalog` (306) is owner-run and granted to
`service_role` only, so no product path changes. The postcondition fails if
`anon` or `authenticated` still has SELECT, if any client role keeps a table
or column privilege (a grant from another grantor survives the REVOKE), or if
`service_role` lost SELECT/INSERT/UPDATE/DELETE. Group
`listening_tests_revoke` in `forward-policy.tsv`: merging does not apply it;
staging first under the advisory lock, production only at an authorised
promotion. One transaction, no data change, re-runnable; the emergency-only
rollback (the old SELECT grant) is in the file header.

Migration `360` (PC-J192, INSTRUCTORGIVE-0044, number allocated by the
Leader on 2026-10-31) makes the two `/instructor` Writing gives idempotent. It
adds the ledger `instructor_writing_assignment_requests` (PK = client
`request_id`, `assigned_by` ON DELETE CASCADE, `give_kind`, payload, receipt)
and the SECURITY DEFINER RPC `fn_create_instructor_writing_give_idempotent`,
which in one transaction records the request, replays a completed receipt for
the same owner and body, refuses another body or another owner, re-checks
prompt/class/learner ownership, locks the active roster `FOR SHARE` (as 228)
and inserts with `grading_tier`. It is deliberately separate from
`writing_assignment_requests`: a receipt there marks admin-tool gives for W-05,
so an admin teaching from `/instructor` keeps the instructor tier; 206/228 are
not touched. RLS is on with no policy; clients have no table or EXECUTE
privilege and `service_role` keeps SELECT plus EXECUTE only; the postcondition
checks this. One additive transaction, re-runnable, no existing data change.
Group `instructor_give_idempotency` in `forward-policy.tsv`: merging does not
apply it; staging first under the advisory lock with
`MIGRATION_FEATURES=instructor_give_idempotency` BEFORE the 0044 backend (the
new backend's give routes answer 500 without the RPC), production only at an
authorised promotion. Rollback SQL is in the header (pre-0044 backend first).

Migration `351` (PC-J220) revokes EXECUTE from `PUBLIC`, `anon` and
`authenticated` on four migration-139 SECURITY INVOKER RPCs, each with one
`timestamptz` argument: `fn_dashboard_daily_tokens`, `fn_dashboard_tokens_called`,
`fn_dashboard_daily_visitors` and `fn_dashboard_visitors`. Only
`services/admin_dashboard.py` calls them, with `supabase_admin` behind
`require_admin`; the frontend and user-JWT backend clients do not call them.
`fn_dashboard_daily_practices` is outside this change. All four exact signatures
must exist and be SECURITY INVOKER or the transaction aborts. The postcondition
requires no effective client EXECUTE, no PUBLIC ACL entry (including grants
from another grantor), and retained `service_role` EXECUTE. An explicit service
grant is preserved or added if missing, preventing silent fallback to capped
dashboard counts. One transaction, `lock_timeout = '5s'`, no data writes,
re-runnable; emergency-only rollback restores EXECUTE to PUBLIC/anon/authenticated
as recorded in the old staging ACL. Group `dashboard_rpcs_revoke` is
`pending_feature`: **merging does not apply it (merge KHÔNG áp)**. Leader/RM
applies it to staging through the advisory-locked runner; production only at a
Vinh-approved promotion. It can follow 349 but does not require it. After apply,
run the catalog query in the SQL header (client false/false, service true, no
PUBLIC `=X`), then view admin overview/trends and check backend logs for RPC
42501/fallback. No staging or production application is part of this code job.

Migration `357` (mig 357, PC-J365/1h1, SVCPRIV-0042 FR-009; not the PC-J357
spec ticket #2060) runs `REVOKE CREATE ON SCHEMA public FROM service_role,
anon, authenticated, PUBLIC`. API roles keep USAGE, and the schema owner can
still create. API roles get explicit CRUD/USAGE grants and never schema CREATE:
with CREATE, a role could plant a `pg_catalog`-shadowing overload, such as
`public.lower(varchar)` or `public.has_table_privilege(text,text,text)`, that
owner-run definers and migration DO blocks then execute as the owner. The
postconditions raise on any CREATE entry left for these grantees (naming the
grantor), on effective CREATE (including inherited or SET ROLE membership),
and on any `public` function or operator named like a `pg_catalog` one outside
the empty allowlist. They report the remaining CREATE grants and the API-owned
`public` routines. It is a no-op on production (no CREATE there, Leader read
2026-10-30). The down in `rollback/357_public_schema_create_revoke.sql` is a
documented no-op: restoring CREATE needs a new spec. Group
`public_schema_create_revoke` is `pending_feature` (merge KHÔNG áp): staging
first under the advisory lock, before 358; production only at a Vinh-approved
promotion, before 341/341b.

Migration `358` (PC-J406, widened by PC-J510; SVCPRIV-0042 FR-010,
PGTEMP option a, Vinh t1246u; SA P2-R2-1) makes `pg_temp` the last `search_path`
entry of every function and procedure in `public` and `app_private`. A path
that does not name `pg_temp` searches it first for relations and types, so a
`service_role` temp view or temp domain could shadow a name the routine
resolves while it runs as the owner. Rules: no path → `public, pg_temp`;
`''` → `pg_catalog, pg_temp`; any other list → the same list with `pg_temp`
moved to the end (`pg_catalog, public` → `pg_catalog, public, pg_temp`). The
224 trigger `fn_guard_active_player_terminal_mutation()` is narrowed to
`pg_catalog, pg_temp` (Leader addendum, SA via PR-2116). On staging
(2026-11-02) this is the four 283 grammar triggers, the five `fn_admin_*`
definers of 297–302, 334 and 335; the migration re-reads the catalog rather
than using that list. Bodies, owners, ACLs and volatility are unchanged; 345
pins the four 283 triggers too and 358 does not depend on it. The
precondition aborts if the runner cannot alter a target or cannot parse an
entry; the postcondition fails if any routine in those schemas still lacks
a `pg_temp`-last path. Group `function_search_path_pin` in
`forward-policy.tsv`: merging does not apply it; staging first under the
advisory lock after 357, production only at an authorised promotion after the
SA retest passes. One transaction, no data change, re-runnable. There is no
rollback: removing the pin reopens the hole, and the header rollback of 345
(`RESET search_path`) must not run after 358.
`tests/test_migration_function_search_path_guard.py` fails any new
`CREATE FUNCTION`/`CREATE PROCEDURE` or `ALTER … SET search_path` in
`backend/migrations/` without `SET search_path`, with `search_path = ''` or
with `pg_temp` not last, and any new `RESET search_path`.

Migration `352` (PC-J201, ADMINAAL2-0032 FR-010/FR-011, SA #1936 P3 c–f)
adds the private `staff_mfa_status_throttle` table for shared admission to the
caller-only MFA status sweep: successful-state cooldown, six rolling-minute
attempts per account and at most two active leases across workers. The backend
holds its admission advisory lock only for short transactions, never during
Auth HTTP. Failed passes consume an attempt without starting a cooldown;
expired leases recover and completion is fenced by its lease token. Old
backends ignore the table; without it PC-J201 logs and skips the caller pass
while the status read and cron fallback remain available. RLS is enabled with
no policies, and PUBLIC, anon, authenticated and service_role lose all table
privileges; the postcondition checks privacy. One additive transaction,
re-runnable, no existing data change. It is held by `forward-policy.tsv`
(group `mfa_status_throttle`); it must not apply on merge or join the 30 October
promotion. A separately authorized apply uses
`MIGRATION_FEATURES=mfa_status_throttle` through the advisory-locked runner,
staging first before the PC-J201 backend, then production only at an authorized
promotion. Rollback SQL is in the header: deploy the pre-PC-J201 backend, then
drop only this operational table in a new forward migration.

Migration `345` (PC-J119) removes the RLS policies that granted admin reads
with an inline `users.role = 'admin'` check and nothing else (no AAL2, no
`is_active`, no `suspended_at`): the admin read policies on
`dictation_sessions`, `dictation_attempts`, `dictation_attempt_answers` and
`user_feedback`, `"Admins manage lemma overrides"`,
`vocab_exercises_admin_write`, the admin branch of `vocab_exercises_select`
(now `status = 'published'` only) and the dashboard-created `access_codes`
`"Admin only"`. Admin access to these tables goes through FastAPI
(`service_role` + the 0032 staff guard) only. The learner own-row dictation
policies are unchanged. `user_feedback` and `lemma_overrides` lose every
`anon`/`authenticated` privilege (no policy and no JWT reader is left), and so
does `access_codes` (no JWT reader; its 106 helper policies stay but admit no
client role, so the codes no longer depend on 108's EXECUTE revoke, PC-J161);
the dictation tables and `vocabulary_exercises` keep SELECT. It also pins
`search_path = public, pg_temp` on the four 283 grammar trigger functions
(`prevent_grammar_evidence_mutation`,
`prevent_completed_grammar_session_mutation`,
`prevent_grammar_release_content_mutation`,
`prevent_validated_grammar_release_rewrite`), bodies unchanged. The
postcondition fails if any `public` policy still contains the literal
`'admin'`, so a later admin policy must call a function that also checks AAL2
and an active, non-suspended account. Each step skips an absent object (the
PC-J94 invariant harness has none of these tables). Group `rls_admin_inline`
in `forward-policy.tsv`: staging first under the advisory lock, production only
at an authorised promotion. One transaction, no data change, re-runnable;
the rollback (which reopens the hole) is in the file header.

Applying `345` (runbook, PC-J162):

- **A dry run is required first, on staging and on production.** The
  postcondition is a gate on the whole `public` schema, so any other policy
  with `'admin'` in it (for example a dashboard-created one that was not in the
  2026-10-29 staging check) makes 345 abort with `inline_admin_policy_remains`.
  That abort is safe: the transaction rolls back. Run the dry run and the
  read-only query below before the real apply. The dry run must list only
  `345`, plus any migration the Leader has already approved for the same
  window:

  ```bash
  DRY_RUN=1 MIGRATION_FEATURES=rls_admin_inline ./backend/scripts/apply_migrations.sh "$STAGING_DB_URL"
  # production, only at an authorised promotion:
  ALLOW_PROD=1 DRY_RUN=1 MIGRATION_FEATURES=rls_admin_inline ./backend/scripts/apply_migrations.sh "$DATABASE_URL"
  ```

  ```sql
  -- read-only, before apply: every public policy with the literal 'admin'
  SELECT c.relname, p.polname FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relnamespace = 'public'::regnamespace
     AND concat_ws(' ', pg_get_expr(p.polqual, p.polrelid),
                   pg_get_expr(p.polwithcheck, p.polrelid)) ~* '''admin'''
   ORDER BY 1, 2;
  ```

  The rows may only come from the 8 policies 345 handles:
  `dictation_sessions`/`"admins read dictation sessions"`,
  `dictation_attempts`/`"admins read dictation attempts"`,
  `dictation_attempt_answers`/`"admins read dictation attempt answers"`,
  `user_feedback`/`"admins read feedback"`,
  `lemma_overrides`/`"Admins manage lemma overrides"`,
  `vocabulary_exercises`/`vocab_exercises_admin_write`,
  `vocabulary_exercises`/`vocab_exercises_select` and
  `access_codes`/`"Admin only"`. Fewer rows are fine, because each step skips
  an absent object. If any other row appears, do not apply. Report it to the
  Leader and the Security Auditor.
- **Production: apply off-peak.** After `LOCK TABLE … ACCESS EXCLUSIVE` on
  the 7 target tables (`access_codes`, `dictation_attempt_answers`,
  `dictation_attempts`, `dictation_sessions`, `lemma_overrides`,
  `user_feedback`, `vocabulary_exercises`), the migration runs `count(*)` on
  each of them twice: once after the locks in step 1 and once in the final
  row-count check. The locks are held until `COMMIT`, so reads are blocked
  too. This includes access-code activation and dictation. On staging this is
  acceptable because the tables are small. On production, apply in a low-traffic
  window. If an open transaction holds one of these tables, the
  `lock_timeout` of 5 s aborts the whole migration with nothing changed, and it
  can be re-run. The file is approved and the release register pins its
  sha256, so do not edit it to remove the counts. Staging and production must
  run the same bytes.
- **After apply, run `backend/scripts/verify_migration_345_client_acl.sql`
  read-only (PC-J169).** 345's own postcondition checks only table-level
  `SELECT` … `TRIGGER`, and its `REVOKE` removes only the runner's grants. A
  column-level `INSERT`/`UPDATE`/`REFERENCES` or a `MAINTAIN` (PG17) grant
  that another role passed on survives both. The verifier reads every
  `relacl`/`attacl` entry for `PUBLIC`, `anon` and `authenticated` on
  `user_feedback`, `lemma_overrides` and `access_codes`, whatever the grantor,
  plus their effective privileges. It must return the single row
  `verify_345_client_acl: ok`. Any `client_acl_entry_remains` or
  `client_privilege_effective_remains` error names `table[.column]:grantee:privilege[/grantor]`:
  report it to the Leader and the Security Auditor. On staging it runs through
  the Management API with `"read_only": true` or with `psql -v ON_ERROR_STOP=1 -f`.

Migration `337` (CLASSARCHIVE-0030, A-10) enforces class archive. An
*archived* class is `cohorts.is_active = false AND archived_at IS NOT NULL`. It
adds:

- `cohorts.archived_at`, `archived_by` and `archive_reason` (at most 500
  characters). The `trg_cohorts_archive_metadata` trigger stamps `archived_at` on
  every true → false change, clears the metadata on restore and cannot be used
  to un-enforce. There is no `is_active`-dependent CHECK, so the old backend's
  `PATCH {is_active}` keeps working;
- the append-only `class_lifecycle_audit` (no FK, RLS on, clients get nothing,
  `service_role` SELECT/INSERT only);
- the service-role-only RPCs `fn_archive_cohort`, `fn_restore_cohort` and the
  non-locking `fn_cohort_archive_counts`. The RPCs lock the class `FOR UPDATE`,
  write the flag, metadata and one audit row together, and are idempotent;
- four SECURITY DEFINER guards that lock the class `FOR SHARE` and raise
  `cohort_archived` (DETAIL = class id): the `AFTER INSERT OR UPDATE OF
  is_active, cohort_id` membership guard (an upsert of an already-active row
  passes), and the `BEFORE INSERT`-only guards on `class_assignments`,
  `class_assignment_items` and cohort `writing_assignments` gives. Individual
  gives, item UPDATEs (reaper, retries, finalisers) and idempotent replays are
  untouched;
- `fn_restore_student` (326) now locks the candidate classes `FOR SHARE` in id
  order, skips archived classes and reports them as
  `skipped_archived_cohort_ids` (0029 FR-003 Revision 1). The signature, ACL
  and `FOR UPDATE` literal are unchanged.

Classes that were inactive before 337 stay *legacy* (`archived_at` NULL) with
the old behaviour. Nothing is backfilled, and the postcondition fails if the
number of archived classes changes (FR-009). An admin applies the rules per
class through `fn_archive_cohort` ("Áp dụng lưu trữ"). 337 aborts without 320,
326 or the `fn_restore_student` lock literal. It names no 331 object. It is
held back by `forward-policy.tsv` (group `class_archive`, PC-J106 F1) and is
dormant until the A-10 backend deploys. Apply it only with
`MIGRATION_FEATURES=class_archive` through the advisory-locked runner, on staging
first and only after a backend whose `AdminCohortOut` accepts the three archive
columns is deployed there (an older one answers 500 on `GET /admin/cohorts`).
Do not archive or restore classes between apply and deploy. The
light and full rollbacks are in the file header; the full one re-creates the
326 `fn_restore_student` before dropping the columns. One transaction,
re-runnable.

Migration `346` (PC-J153, CLASSARCHIVE-0030 FR-003, audit PC-J106 F4) also
refuses *moving* work into an archived class. 337's work guards fire on INSERT
only, so an UPDATE of `class_assignments.cohort_id`,
`writing_assignments.cohort_id` or `class_assignment_items.assignment_id` could
still put existing work into an archived class (service role or SQL editor
only: clients cannot write these tables and no backend path changes these
columns). 346 adds `trg_guard_class_assignment_cohort_move`,
`trg_guard_writing_give_cohort_move` and `trg_guard_class_item_cohort_move`:
`BEFORE UPDATE OF <column>` row triggers with `WHEN (NEW.<column> IS DISTINCT
FROM OLD.<column>)` that call the unchanged 337 guard functions, so they raise
`cohort_archived` only when the class binding really changes to an archived
class. The 337 INSERT-only triggers (`tgtype = 7`, research.md §11.1) are not
touched, and UPDATEs of any other column (reaper, retries, timed start,
finalisers, due date, status) never fire the new triggers. It aborts without
337's guard functions and enabled INSERT triggers; the postcondition pins
`tgtype = 19`, the single-column `tgattr` and the WHEN clause. Group
`class_archive` in `forward-policy.tsv`: apply after 337 with
`MIGRATION_FEATURES=class_archive` through the advisory-locked runner, staging
first, production only at an authorised promotion. One transaction, no data
change, re-runnable. The rollback (drop the three triggers) is in the file
header and must run BEFORE any 337 rollback, which drops the functions these
triggers use.

Migration `338` (PAPERUPDATEDAT-0037) adds `update_<table>_updated_at` BEFORE
UPDATE row triggers on `reading_tests`, `listening_tests`, `reading_passages`,
`reading_questions` and `listening_content`, so every UPDATE advances
`updated_at` (it only had `DEFAULT now()`; the AVR-READ-002 visibility flip on
2026-10-28 left it unchanged). The triggers call the existing
`update_updated_at_column()` and sort after `trg_mock_paper_*` /
`trg_protect_listening_package_child`, which already ignore `updated_at`, so
policy revisions, release events and `mock_content_revision` are unchanged.
`listening_exercises` keeps 208's trigger. No data change; later files must not
drop these triggers or add a BEFORE row trigger that sorts after them.

Migration `339` (GRAMMARAUDIT-0019 Revision 2, T011; number reserved by the
Leader on 2026-10-29) widens the one Long Sentence Untangling follow-up of 314
to exactly three codes: LSU, Grammar in Task 1 and Few / A few / Little / A
little. It is function-only: the new private IMMUTABLE
`grammar_quiz_followup_pair(code)` returns the (middle, final) reviewed source
of those three codes and NULL for every other code, and replaces each LSU
literal in `grammar_quiz_audit_chain`, `grammar_quiz_guard_bank`,
`grammar_quiz_validate_receipt_envelope` and `grammar_quiz_receipt_data`.
`grammar_quiz_audit_binding` embeds the new
`services/grammar_quiz_reviewed_sources.json` (every 314 binding unchanged, two
v3 bindings added). Signatures, SECURITY DEFINER, `search_path` and 314's
REVOKE/GRANT block are unchanged, so no grammar function is client-executable.
It aborts without 314; the postcondition fails if a bank, question, session,
attempt, stat or receipt count, or any managed chain's validity, changes. A
normal forward migration (no `forward-policy.tsv` row), one transaction,
re-runnable. Apply it under the advisory lock before the dependent backend:
staging first, production before the staging → main promotion. Publishing the
two v3 banks is a separate admin preview/commit step (T012/T013). The rollback
lives outside the forward glob, in `rollback/339_grammar_quiz_followup_codes.sql`
(run by hand with `psql -v ON_ERROR_STOP=1 -f`): it re-creates the 314 bodies
and drops the lookup, and refuses once a v3 bank exists. After a publication,
roll back by pausing new starts on the v3 bank instead.

Migration `335` (INACTIVEWRITE-0035, SEC-20261028-02) closes the direct-REST
write path for inactive accounts. 320 kept `authenticated` writes on the five
learner-owned Vocabulary/flashcard tables and `UPDATE (is_active)` on
`user_d1_questions` because FastAPI writes them with the learner's JWT, but
their policies check only ownership, so an account the W-03 gate refuses could
still `POST /rest/v1/user_vocabulary`. 335 adds `require_active_account_insert`
/ `_update` / `_delete`, RESTRICTIVE policies `TO authenticated` on those six
tables, all calling `app_private.is_current_user_active()` (SECURITY DEFINER,
STABLE, `search_path = ''`, caller only, missing row or NULL = inactive; kept
out of `public` because 320 forbids client-executable definers there). An
inactive INSERT fails with 42501 (PostgREST 403); UPDATE/DELETE change 0 rows;
reads, active learners, the invoker SRS RPC and `service_role` are unchanged.
The postcondition fails if any `public` table `authenticated` can write lacks
the matching restrictive policy, so a later client write grant must add one.
One transaction, no data change, re-runnable, no backend deploy needed. Later
migrations must not drop or replace the policies or the helper; rollback is in
the file header.

Migration `336` (ADMINAAL2-0032 FR-019, Vinh's decision 1A of 2026-10-28)
freezes `users.role` while `suspended_at` is set. The `BEFORE UPDATE OF role`
trigger `trg_users_suspension_role_guard` raises P0001
`account_suspended_role_change` for any role change of a suspended account. That
includes `fn_set_staff_privilege`, alone or combined with reactivation, as well
as REST, the owner and a superuser. Only `fn_bootstrap_admin_recovery`
(`aver.bootstrap`) is exempt. An admin reactivates the account first, then
changes its role. `PATCH /admin/users/{id}/role` maps the error to a 409 with a
Vietnamese message. It sorts after 332's suspension guard, so activation still
fails with `account_suspended`. It aborts with
`suspended_non_staff_account_exists` while a suspended row holds a non-staff
role (repair that out of band first). It shipped with 332 (former group
`admin_aal2`) and was applied after it, on staging first. One transaction, no data
change, re-runnable; the rollback is in the file header.

Migration `334` (ACTIVATELIMIT-0034, F09) moves the `POST /auth/activate`
rate limit from a per-worker dict into Postgres: `activation_attempts(user_id,
attempted_at)` and the service-role-only SECURITY DEFINER
`fn_activate_attempt_check(uuid)`, which allows 10 attempts per rolling 10
minutes per user under a per-user transaction advisory lock and returns
`{allowed, retry_after_s}`. A refused call records nothing; each call deletes
that user's rows older than 1 day. Apply it before the 0034 backend, which
fails closed (503 `activation_unavailable`, no code consumed) without it. It
is a normal forward migration, so it has no `forward-policy.tsv` row: a
`pending_feature` row would let the runner skip it while the dependent code is
promoted. Rollback (deploy the pre-0034 backend first) is in the file header.

Migration `340` (AIBUDGET-0033 hardening, PC-J85) fixes the Security
Auditor's PC-J67 findings on 333 without editing it. It replaces five 333
function bodies with the same names, arguments, return types, security,
`search_path` and ACL, adds the internal `fn_ai_budget_assert_finite` (no API
role may execute it) and adds:

- F01: `fn_ai_budget_reserve`, `fn_ai_budget_settle` and
  `fn_ai_budget_raise_grant` raise 22023 `ai_budget_non_finite_amount` for a
  NaN or ±Infinity cap (hard, soft or total), estimate, actual, raise amount or
  base cap before any write, and `*_finite_usd` CHECKs cover every money column
  of the counters, reservations, raises, raise events and alerts (added `NOT
  VALID`, then validated; an existing non-finite row aborts the migration with
  its count and is never rewritten);
- F02: `fn_ai_deferred_commit` refuses a null/empty result or one without what
  the live success mapper writes (`overall_band`, `feedback`, a transcript and
  `stt_status = 'completed'` after the patch). Nothing is written, so the job
  is claimed again after its lease;
- F04: `fn_ai_deferred_commit_writing` commits only a `running` job;
- F05: the postcondition aborts and names any policy on the eight budget
  tables, without dropping it.

It belongs to the same `forward-policy.tsv` group: apply it after 333 with
`MIGRATION_FEATURES=ai_budget` through the advisory-locked runner, on staging
first and on production only at an authorised promotion together with 333,
before the 0033 backend. Re-running 333 afterwards restores the old bodies, so
re-run 340 after it. One transaction, no business data change, re-runnable.
Its header carries ROLLBACK (a) (down 340 only) and ROLLBACK (b) (the whole
`ai_budget` group, F03); both are Leader-approved forward migrations.

Migration `333` (AIBUDGET-0033) adds the database half of the hard AI budget
(`specs/0033-ai-budget-hard-cap/plan.md` "Migration 333"). It is held back by
`forward-policy.tsv` (group `ai_budget`), so apply it only with
`MIGRATION_FEATURES=ai_budget` through the advisory-locked runner, on staging
first (rollout.md S1) and on production only at an authorised promotion (P2),
before the 0033 backend. It adds:

- `ai_budget_counters` and `ai_budget_reservations`. Every line counts on its
  provider scope and on `total`. `anthropic` and `total` are soft: counted and
  alerted, never refused for a cap. `fn_ai_budget_reserve` locks the counter
  rows in `(scope, period_kind)` order, refuses a bundle all-or-nothing, and
  never grants a replayed request key. Settle, release, expire and the
  provider spend-limit closure go through functions, and
  `fn_ai_budget_recompute` is an owner-only repair;
- `ai_deferred_grading_jobs`, `ai_deferred_session_refresh` and the Speaking
  deferred save/claim/commit functions; the `writing_jobs` budget-drain columns
  and their claim/commit functions (`attempt_count` is never touched);
- `fn_ai_session_bands_write`, `fn_ai_deferred_aggregate_write` and
  `fn_ai_class_sync`: the generation-fenced band and class-score writers;
- `ai_budget_alerts` (once per scope, period and threshold, plus one row per
  raise event) and `ai_budget_heartbeat`;
- `ai_budget_raises` and the append-only `ai_budget_raise_events` (hard scopes,
  whole dollars up to 100% of the base cap, 1–24 h, `aal2` actor, one active
  raise and three grants a month per scope);
- the `trg_ai_session_generation` trigger on `responses`. Any band-bearing
  response write advances the session's refresh generation in the writer's
  transaction. It locks the session before the refresh row.

RLS is on with no policies, clients get nothing, and `service_role` gets only
SELECT except INSERT/UPDATE on the jobs and heartbeat and UPDATE of the alert
send columns. The N-1 backend reads none of it; its response writes just gain
one refresh-row upsert. The guarded down script in the file header refuses
while saved work waits for grading or a raise is active, and keeps the raise
events. It misses an owed class-score sync (PC-J67 F03), so roll back 333
only with ROLLBACK (b) in the 340 header, never with the 333 header script.

Migration `332` (ADMINAAL2-0032) adds the staff security audit. It was held
back by `forward-policy.tsv` (group `admin_aal2`) and applied with
`MIGRATION_FEATURES=admin_aal2` through the advisory-locked runner, staging
first (`specs/0032-admin-aal2-staff-guard/rollout.md` S1/S2), before the 0032
backend. Production applied 332 and 336 on 2026-10-29 (04:53Z, ledger confirmed
read-only by the Release Manager), so both are now normal forward migrations
with no policy row (PC-J354). The `admin_aal2` group no longer holds 332 or
336; it is kept only for later work in the same spec, such as 341. It
adds:

- the `public.users` suspension marker (`suspended_at`, `suspended_by`,
  `suspension_reason`, set and cleared together and never on an active row);
- the `trg_users_suspension_guard` trigger. It refuses (`account_suspended`)
  any `is_active` false → true while suspended, and any marker change, except
  inside `fn_set_staff_privilege` or `fn_bootstrap_admin_recovery`. This
  covers `/auth/activate`, admin-issued codes, `fn_restore_student` and SQL
  updates, including an activation that waits on the suspension's row lock;
- the append-only `staff_security_audit`. UPDATE, DELETE and TRUNCATE are
  refused by triggers, even for the owner. `service_role` gets SELECT and
  INSERT only;
- `owner_alert_outbox`, `staff_mfa_factor_snapshot` and
  `staff_security_sweep_cursor`;
- the `trg_users_privilege_audit` trigger. It writes exactly one audit row per
  change of `role`, `is_active` or the marker, and per inserted admin or
  instructor row, from every path (`admin_api`, `service`, `out_of_band`).
  Admin events also get one email-safe outbox row;
- the service-role-only RPC `fn_set_staff_privilege`. It locks the actor, the
  target and the active admins in id order, then re-checks the actor
  (`actor_not_admin`, `self_change_forbidden`, `target_not_staff`,
  `last_admin`). A repeated call is a no-op that writes no row;
- the owner-only `fn_bootstrap_admin_recovery` (rollout path (e)). Not even
  `service_role` can execute it. It refuses `admins_exist`.

The deployed backend keeps working: its role/`is_active` writes just gain an
audit row. Rollback (in the file header and rollout.md) drops the triggers and
functions and keeps the tables. It refuses while any account is suspended.

Migration `322` (AIOPS-0024) is additive: `ai_model_overrides` (admin
per-feature preferred provider / Claude model, NULL = env/code default), the
trigger-written append-only `ai_model_override_audit`, the routing-layer
`ai_provider_failures` log and two read-only dashboard rollups. RLS is on with
no policies, nothing is granted to `anon`/`authenticated`, and `service_role`
gets only the privileges the backend uses. No data is written; with no
override row routing is unchanged. Apply it to staging before merging the
dependent code; code deployed first keeps env/code-default routing and the
dashboard shows "migration not applied". Rollback SQL (destroys audit/failure
history) is in `specs/0024-admin-ai-model-control/rollout.md`.

Migration `331` (GIVEARCHIVE-0031) adds the `BEFORE INSERT OR UPDATE OF
student_id` trigger `archive_guard_writing_assignment_student` on
`writing_assignments`. It locks the learner row `FOR KEY SHARE` (the lock the
FK check already takes) and raises `student_archived` (DETAIL = student id) for
an archived learner, so a give can no longer slip in between the 0029 Python
pre-check and the insert: it either commits before `fn_archive_student` takes
its `FOR UPDATE` (kept as history) or is refused as a whole statement (no
partial bulk insert, no idempotency ledger row). It covers the idempotent RPC,
every PostgREST insert (admin/instructor individual, class fan-out, late-joiner
backfill) and manual SQL; updates that keep `student_id` are untouched. It
changes no row, aborts unless 326 is applied and both lifecycle functions still
lock `FOR UPDATE`, and is re-runnable. The 0031 backend maps the refusal to the
existing 409 `student_archived`; without it a refused give is a 500 with no
row. Migration 337 (A-10) and later files must not drop, replace or disable the
trigger or `fn_guard_writing_assignment_student_archived()`. Rollback (drop the
trigger, then the function; reopens the race only) is in the file header.

Migration `326` (STUDENTARCHIVE-0029) turns `DELETE /admin/students/{id}` into an
archive: `students.archived_at/archived_by/archive_reason`, the append-only
`student_lifecycle_audit` and the service-role-only `fn_archive_student` /
`fn_restore_student`. Archiving ends every active class membership, clears
`students.cohort_id`, optionally sets `users.is_active = false` and writes one
audit row; no learner work changes. It re-creates the 227 membership writers
with an archive guard (`student_archived`) so no class add, direct-code bridge or
legacy `cohort_id` write can bring an archived learner back. It aborts unless the
320 users guard is enabled. Apply it, then deploy the 0029 backend right away:
the previous backend's admin student list rejects the new columns. Rollback is
guarded (zero archived learners and an empty audit table); see the file header
and `specs/0029-student-archive/rollout.md`.

Migration `323` (ROLECHECK-0026, bug A-05) keeps `chk_users_role`
(`user, student, instructor, admin`, from 106) as the only CHECK on
`public.users.role` and drops `users_role_check` (`user, admin`, created
outside the repo), whose intersection blocked every `instructor`/`student`
write, even by `service_role`. It changes no row, aborts on a role outside the
four values, re-creates `chk_users_role` only if missing or drifted, and its
postcondition requires exactly one validated role CHECK and the enabled 320
trigger `trg_users_guard_privileged_columns`. Grants, policies and the trigger
are untouched, so clients still cannot change `role`. Run the read-only checks
in `specs/0026-users-role-single-check/research.md` §5 first; rollback is only
safe while no `student`/`instructor` row exists (§6.4).

Migration `324` (A-08B, ASSIGNDRAFT-0027) changes
`writing_drafts_assignment_id_fkey` from `ON DELETE CASCADE` (037) to
`ON DELETE NO ACTION`, so Postgres refuses to delete a `writing_assignments`
row while a learner's draft references it (23503, for every role and path);
`services/writing_assignment_delete_guard.py` maps that to the existing 409
("Học viên đã bắt đầu làm bài nên không xóa được bài giao này."). NO ACTION
rather than RESTRICT keeps a single-statement student delete, which cascades
to both rows, working. One
transaction with `lock_timeout = 5s`: it aborts on orphan drafts or an
unexpected FK action, adds the FK `NOT VALID` then validates it, and its
postcondition requires no cascading child FK on `writing_assignments`. No row
changes; re-applying is a no-op. The backend change is safe before or after
apply. Rollback (restores CASCADE and reopens the draft-loss hole) is in
`specs/0027-writing-draft-assignment-delete-guard/research.md` §5 and must ship
as a new forward migration.

Migration `325` (CODEUNIQ-0028, F07) codifies `access_codes_code_key UNIQUE
(code)`, which existed only as dashboard drift: no repository migration creates
`access_codes` (009/062/106 only alter it), so a repo-built database had no
uniqueness. It also adds `chk_access_codes_code_canonical CHECK (code =
upper(btrim(code)) AND code <> '')`, matching the `strip().upper()` lookup in
`/auth/activate`, so plain uniqueness covers every way a code can be typed. It
has no outer transaction because the index is built `CONCURRENTLY IF NOT EXISTS`
(a no-op where it already exists, as on staging); the CHECK runs in its own
transaction with a postcondition. It changes no row: it aborts with counts on
exact/normalized duplicates or non-canonical codes (any dedupe is a separate,
reviewed, dry-run-first step — `specs/0028-access-code-unique-canonical/research.md`
§6), and on an INVALID leftover index (`DROP INDEX CONCURRENTLY
public.access_codes_code_key;` then re-run). Run the read-only P1–P6 checks in
that research record before production. Rollback drops only the CHECK; never
drop `access_codes_code_key` where it predates 325. The drifted `"Admin only"`
policy on `access_codes` is recorded there and out of scope.

Migration `321` (WRITINGRATE-0025) repairs schema drift in `writing_grade_ratings`. Staging and
production were migrated with an early draft of `116` (commit `df4fce621`): it
had no `feedback_version` column and a `UNIQUE (essay_id)` constraint. `116`
uses `CREATE TABLE IF NOT EXISTS` and is already in both ledgers, so the revised
`116` can never reach them, and the admin grade-rating read/upsert fails with
42703. `321` adds `feedback_version`, backfills legacy rows from
`writing_essays.current_version`, then sets it NOT NULL. It drops any
single-column `UNIQUE (essay_id)` and adds
`writing_grade_ratings_essay_id_feedback_version_key`, the name `116` produces
on a fresh database, unless an equivalent constraint already exists. On the
revised shape it is a no-op. RLS and grants are unchanged. A postcondition aborts
the transaction if the result is not the revised shape. Both hosted tables had 0
rows on 2026-10-26. Apply it to staging first, then to production before or with
the release. No backend change is needed.

Migration `319` (REVEXPLAIN-0022) re-states `fn_approve_web_explanation_paper` (260) with one
change: the `web_explanation_content_version_unavailable` refusal now names its
cause — `:none` (no current object bound to this paper, e.g. a MOCK0016 REVxx
copy whose set is still bound to the original Cambridge paper),
`:multiple:N` or `:pinned_not_current`. Signature, grants, approval writes and
every other refusal are unchanged, and it still never chooses a version. No data
changes; safe to re-apply. Binding a REVxx copy is a separate, reviewed data
step: `python -m scripts.bind_revision_web_explanations` (dry run by default;
`--commit` requires the reviewed `--plan-sha`).

Migration `320` is a security lockdown (staging audit 2026-10-25, F01/F03/F04/
F14, plus the Project Coordinator review of 2026-10-26). It revokes
INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER from `anon` and
`authenticated` on every `public` relation and sequence UPDATE (setval), and
runs `ALTER DEFAULT PRIVILEGES FOR ROLE` for the table owner `postgres` (and
`supabase_admin` when it exists and the runner may act for it) so later
tables/sequences are not client-writable. Function EXECUTE defaults are left
unchanged on purpose; instead every SECURITY DEFINER trigger function loses
client EXECUTE (trigger firing does not check EXECUTE, so the guards still run).
`authenticated` keeps writes only on the five learner-owned Vocabulary/flashcard
tables written with the learner's JWT, plus `UPDATE (is_active)` on
`user_d1_questions`. D1 results (`d1_sessions`, `vocabulary_exercise_attempts`)
are now written by `routers/exercises.py` with the service role and the
verified user id, sealed through the new service-only
`fn_finalize_d1_attempt_for_user`; apply 320 and promote that backend together,
because the previous backend's D1 writes fail closed in between. On
`public.users` no client UPDATE remains (PATCH `/auth/profile` writes with the
service role), the dashboard policy "Users can update own data" becomes
`TO authenticated` with WITH CHECK, and a trigger rejects any non-profile
column change by a client role. `users_role_check` was left in place here and
is dropped by `323`.
The browser performs no direct PostgREST writes. A new table that genuinely
needs a client write must now `GRANT` that exact privilege in its own
migration. The migration ends with a postcondition over privileges, default
ACLs, SECURITY DEFINER functions and the users policy, and aborts if any client
write survives. Run the pre-checks in
`specs/0022-client-write-privilege-lockdown/rollout.md`, apply to staging, run
the read-only queries in its header, then apply to production with the
advisory-locked runner. Never roll it back with a blanket re-grant.

Migration `318` adds a default-empty personal vocabulary pronunciation column
under existing row ownership/RLS. After applying it, render missing headwords
with local Kokoro `bf_emma` and upload their content-addressed objects to the
target's existing `vocab-audio` bucket. With that environment's service
configuration loaded, run `python -m scripts.backfill_personal_vocabulary_audio
--project-ref PROJECT_REF --expect-count N` from `backend`, then repeat with
`--apply`. The checked-in command validates every recording before writing,
compares each row's current headword/audio, prints counts only and is idempotent.
Use `--user-id` only to limit synthetic staging acceptance; production repair
checks all active rows. Missing recordings block the repair and no paid TTS is
called. This step changes only pronunciation URLs, never learner evidence.

Migration `317` adds admin-owned Vocabulary class sets, published snapshots,
private study sessions, independent shared-card progress and atomic receipts.
It leaves personal stacks, Quiz and D1 history intact. Enable only the
`vocabulary_class_sets` forward-policy group on the authorized target before
deploying its APIs; no content is seeded and no learner evidence is rewritten.

Migration `305` adds frozen Dictation grading versions/references and their
ownership/immutability guards. It does not enable lexical-v2 starts or regrade
historical results; compatible code and explicit staged enablement are separate.

The unapplied Grammar revision candidate was renamed from
`306_grammar_quiz_revision_cutover.sql` to
`309_grammar_quiz_revision_cutover.sql` after the independently released Mock
migrations used 306–308. Its SQL is unchanged; no applied ledger row is renamed
or baselined. Verify the candidate is still unapplied on the target before
release; an already applied old filename requires an additive follow-up.

The unapplied assignment candidate was renamed from
`307_assigned_master30_grammar_lessons.sql` to
`312_assigned_master30_grammar_lessons.sql` after released Mock migrations used
306–308. Read-only staging and production ledger checks on 2026-10-05 confirmed
the old assignment filename was absent and the attempt table did not exist.
Migration `312` adds assignment-scoped MASTER30 lesson practice attempts and a
default-off runtime flag. It does not rewrite diagnostic items or learner history.

Migration `313` adds the default-off original full-bank version: 90 scored
MCQs and 10–30 ungraded writing responses per frozen attempt. It preserves
legacy attempts and serializes practice exposure with diagnostic admission and
finalization. Content publication and staged activation are separate release steps.

Migration `314` extends the guarded Grammar publication owner to the exact
reviewed audit sources. It retains historical receipts and learner rows, and
allows only the named long-sentence follow-up revision. It changes functions,
not bank content; content publication remains a separate guarded operation.

Migration `315` creates private Reading/Listening copies atomically with a mock
draft and hides selected public sources without revoking existing resume rights.
Exam explanation copies retain independent bindings across Cambridge imports.
Deploy it before the create API/UI; existing drafts and legacy RPC calls retain
their admission guards.

Migration `316` follows the already applied `315` without replaying it. Owned,
unexpired standalone attempts retain their frozen resume entitlement when a
shared source is hidden, while unrelated exam references still block new starts.
Immutable Listening programme forms are excluded from the mock picker and
rejected before source hiding or copying; their package identities stay intact.
Apply `316` on staging, verify the corrected journeys, then apply it to production
before promoting the matching picker/API code.

## Conventions

- Idempotent where possible: `CREATE ... IF NOT EXISTS`, `CREATE OR REPLACE`,
  and a no-op dedup step before adding a UNIQUE index (see
  `077_responses_unique_session_question.sql`, `124_questions_unique_session_part_order.sql`).
- Functions pin `SET search_path = public, pg_temp` (hardening — see 108/113).

## Forward policy and hosted ledger status (closed 2026-09-15)

The Next.js renderer migration is complete. The former ledger ambiguity is now
represented explicitly in `forward-policy.tsv` rather than being left for the
numeric directory scan to guess:

- `233` is a completed production-only recovery and is retired from replay;
- `234–239` are the independent Curated Vocabulary feature group. Staging has
  the group; production requires an explicit
  `MIGRATION_FEATURES=curated_vocab` release;
- `240–244` and `247–256` are retired Gate F evidence/admission experiments.
  Their runtime flags remain off and a normal forward run skips them;
- `245–246` and `257–262` are active Mock/correction/release migrations.

On 2026-09-15, production `233` and staging `245`, `246`, `257`, `259`, `260`
were fingerprinted against their durable postconditions and recorded under the
shared advisory lock without replaying schema or data DML. Migration `262`
repairs the importer drift discovered during that verification and is applied
normally to both environments.

`DRY_RUN=1` must list only genuinely active pending migrations. A retired or
pending-feature file is reported as `policy skip`; it is not silently treated as
an applied ledger row. Do not use `--baseline` to override this policy.

## Historical production ledger reconciliation (173–204)

The one-time production drift was reconciled and verified during the Next.js
migration. Its dedicated reconciler has been retired; do not replay or baseline
this historical range. Normal forward migrations continue through the shared
advisory-locked runner below. The completed audit remains in `docs/` as history,
not as an operational procedure.

## Historical staging Next.js ledger reconciliation (215–221)

Staging received the durable renderer-affinity contracts before their ledger
rows were consistently recorded. Do **not** replay the range or use
`--baseline`: migration 217's one-time backfill would now misclassify a fresh
claim-v1 Speaking session whose affinity is legitimately still `NULL`.

This reconciliation is complete. The commands below are retained only to
explain the historical evidence and must not be used as a general-purpose
forward runner:

```bash
# Read-only contract verification and exact ledger plan.
DRY_RUN=1 python backend/scripts/reconcile_staging_nextjs_migrations.py "$DATABASE_URL"

# Record only the six audited missing rows after locked verification.
python backend/scripts/reconcile_staging_nextjs_migrations.py "$DATABASE_URL"
```

The procedure refuses every database except the pinned staging project,
requires migrations 205–214 and 219 to already exist in the ledger, verifies
the final 215–221 schema/function/ACL/RLS/trigger contracts, and records only
215–218 plus 220–221. It shares the forward runner's advisory lock and finishes
with the standard migration dry-run; no migration in 215–221 may remain pending.

## Historical production forward scope 213–225

Production applied this range through the standard locked forward runner.
Migration 222 is safe to encounter when its two tables already exist outside
the ledger: its table/index/RLS statements are idempotent, and the production
verifier pins the complete table fingerprints. Migration 223 must still revoke
all direct client table grants and preserve full `service_role` access.
Migration 224 adds the hard 24-hour active-player resume TTL and the reclaimable
Writing renderer lease. Database guards cover Speaking question/response
writes, Reading/Dictation answer rows, Listening answer RPCs and Writing draft
writes so N-1 application instances cannot bypass expiry. Parent status
triggers additionally reject expired open -> terminal transitions for
Speaking, Reading and Listening plus expired Writing learner finalization that
links an essay, closing the N-1 direct-finalizer path while preserving the
admin Writing status override. Dictation completion reports have a DB guard ordered before the
migration-220 finalizer, so an expired report cannot complete its parent
indirectly. The retention worker must
transition a TTL-expired open Speaking session to `abandoned` before it scrubs
response content. Current Reading, Listening, Dictation, Speaking and Writing
finalizers also bind the expiry/lease predicate to their terminal mutation,
closing the request-straddles-deadline race without blocking admin repair of
terminal records. The postcondition verifier checks columns, bounded
constraints, indexes, pre/post-224 function fingerprints, security/ACLs,
triggers and live data.

Migration 225 is the forward-only correction for an admitted Speaking grading
request racing `finalize-full-test`: an unexpired response INSERT may finish
after its parent becomes `submitted`, while the router continues to reject any
new request that starts after submission. This prevents a valid in-flight grade
from being dropped and later misclassified as `analysis_failed`.

```bash
ALLOW_PROD=1 DRY_RUN=1 ./backend/scripts/apply_migrations.sh "$DATABASE_URL"
ALLOW_PROD=1 ./backend/scripts/apply_migrations.sh "$DATABASE_URL"
python backend/scripts/verify_prod_nextjs_migrations.py "$DATABASE_URL"
```

The verifier refuses every database except the pinned production Supabase
project and executes `verify_prod_nextjs_migrations_213_225.sql` inside a
read-only transaction. It proves the exact 213–225 ledger range, Mock
collection columns/constraints, affinity functions/tables/policies/triggers,
pronunciation table fingerprints, RLS/table grants and the TTL/lease contract.

## Historical forward scope 226–229

Migrations 226–229 were originally authored on `main` with prefixes 216–219
while the long-lived Next.js staging branch already owned those numbers for
renderer affinity. The integration branch renumbered them forward instead of
creating two meanings for one ledger row:

- 226 stores canonical multi-section course results;
- 227 adds the normalized multi-class membership source of truth;
- 228 restores idempotent individual Writing assignment creation after 227;
- 229 codifies the quiz RPC and Writing view hardening already present on the
  hosted databases.

All four were applied through the normal advisory-locked forward runner. They are
additive or idempotent so a hosted database that already has some durable
effects outside the ledger converges safely and records the unambiguous new
prefixes.

## Forward scope 230–302

- 230 versions writing drafts/submissions, reading/listening results and
  pronunciation grading by the canonical full-course attempt. Existing rows
  are attached to their current run without deleting history; a later full
  retry can therefore submit every required section again.
- 231 snapshots the hybrid question-count weights onto legacy course
  assignments that predate weight snapshots. This keeps the denominator tied
  to sections that actually exist and prevents later bank edits from changing
  an assignment under learners' feet.

Migrations 230–232 preserve full-course attempt history and reconcile legacy
course weights. Migration 233 is the one data-scoped exception described
above. Migrations 234–239 add optional curated vocabulary; 240–244 add optional
core attempt evidence; 245–246 add the active Mock/Cambridge correction
foundation; 247–256 add optional core admission and Writing provenance; and
257–261 add active correction persistence, public visibility and atomic
assignment/explanation policy contracts.

Migration 262 restores the structured Cambridge 15 Test 4 Reading Q07
explanation after the canonical importer had overwritten migration 246's richer
tips and removed its trap analysis. The importer and migration now share the
same canonical payload.

Migration 263 atomically anchors the per-student timer and creates the first
quiz session before a timed Course bank releases its answer-bearing questions.
It prevents both pre-start question exposure and a half-started timer with no
session available for canonical timeout submission.

Migration 264 closes the remaining authorization race by locking and rechecking
the published assignment, release/deadline window, and canonical active cohort
membership inside that same start transaction.

Migrations 265–268 make timed progress/finalization and Course assessment bank
replacement transactional and history-safe. Migration 269 gives assignment
creation and bank replacement the same bank-row lock, then verifies an exact
preflight revision before persisting the assignment's shape snapshot.
Migration 270 extends the same locked authorization boundary to every later
timed Course run/revision session; a bank read may only adopt, while an explicit
start creates the entitled session before releasing assignment/membership locks.
Migration 271 gives new Course assessment banks the same transactional import
guarantee: the bank row and complete question set commit together or not at all.

Migration 272 freezes a timed Course assignment's class deadline after the
first learner opens it. A marker on the assignment row makes concurrent start
and due-date writes serialize on one canonical record, preventing the browser
and server from enforcing different cutoffs.

Migration 273 makes the timeout envelope atomic: any final answers restored
after a transient eager-save failure are inserted at the canonical cutoff in
the same transaction that records the immutable `time_cap` session ending.

Migration 274 bounds that final-answer envelope to the same 15-second grace
used by the timeout reaper. It preserves lost-response idempotency while
preventing the recovery path from becoming an unlimited post-exam write lane.

Migration 275 makes a terminal retry prove that every submitted client ID is
already present, instead of reporting success after the reaper wins the lock.
Migration 276 closes the remaining open-session loophole: timeout finalization
is verification-only, rejects every client ID not admitted before the cutoff,
and derives score totals from the canonical attempt ledger rather than the
client summary.

Migration 277 atomically closes an expired on-time retry entitlement only when
no retake/full-retry generation exists. It shares the assignment-item row lock
with timed session creation, then leaves a durable marker so the minute reaper
does not scan settled historical sessions forever.

Migration 278 makes assignment deletion respect the same timed-attempt truth.
The locked delete RPC now refuses an assignment once its timer marker or any
item `opened_at` exists, and treats every attached Course quiz session as
durable learner work instead of waiting for `ended_by = 'completed'`.

Migration 279 makes timed progress admission respect the current retry
generation under the same item lock. A stale full-run tab can no longer write
after a near-pass authorizes only a retake, nor can an earlier run cross into a
new full-retry generation.

Migration 280 snapshots each timed Course item's duration and effective cutoff
when `opened_at` is first set. It locks later edits to the assignment duration
and the item snapshot, so the player, progress gate, finalizer, and reaper keep
one immutable boundary for the whole attempt.

Migration 281 adds the assignment-only Advanced Vocabulary learner-evidence
ledger, protected initial Listening attempts, immutable stage/section writes,
and atomic finalization. Anonymous and authenticated PostgREST roles receive no
direct bank, solution, or learner-evidence access; the backend service role owns
all runtime reads and writes. Apply it before importing the 30 core banks.

Migration 282 adds the immutable Practice-selection ledger and enforces the
Advanced persistence boundary under membership → assignment → item row locks.
It also restricts every direct client bank policy, guards attempt-1 section
evidence and terminal finalization, blocks hard deletion of immutable Advanced
banks, and revalidates publication plus the frozen runtime snapshot when an
assignment is issued.

Migration 284 adds the database boundary for one-sitting Course assignments.
It rejects retake sessions for that mode and prevents stale or internal paths
from creating sessions or answers after the canonical result has been handed
in. The normal mastery mode remains unchanged.

Migration 285 removes any explicit `anon` or `authenticated` EXECUTE grants
left by an existing Supabase environment on migration 284's trigger-only guard
functions. Runtime use remains internal to their table triggers.

Migration 286 adds the append-only AI usage ledger. Migration 287 safely remaps
an existing complete Advanced Vocabulary core-30 package to Course 5 and is a
no-op on a clean database before content import. Migrations 288–290 add the
single batch-graded Controlled Rewrite submission, repair its portable JSONB
count, and align its immutable completion evidence. Migration 291 reinstalls
the assignment-item deletion guard with the complete union of Practice,
stage, question, Listening, and Controlled Rewrite evidence stores. Migration
292 makes the Practice gate migration-first compatible: it derives the
canonical 28/20 selections from imported questions, backfills legacy attempt
evidence, and lets a pre-selection backend atomically create only that canonical
selection on its first answer.
Migration 293 gives the Advanced importer one database transaction for the
bank metadata, canonical 48 questions, and explicit publication decision, so
neither failure nor concurrent assignment can observe a mixed revision.
Migration 294 makes that lock-and-transaction boundary canonical for the
existing admin quiz import route and adds the explicit
`preserve|published|unpublished` publication contract without changing the
new-bank default for ordinary quiz banks.
Migration 295 adds immutable General/IELTS Listening content packages,
report-only attempt truth, and service-role-only atomic import and publication
contracts without changing existing diagnostic Listening rows.
Migration 296 records the first answer revealed during standalone General/IELTS
Listening programme practice through a service-role-only, owner-checked RPC.
Migration 297 adds backend-only bounded Writing queue pagination with exact
filtered totals. Migration 298 adds backend-only Review eligibility based on
persisted sitting/review work in every exam mode, including published sequential
exams, open retakes, and archived exams. Migration 299 adds service-role-only,
database-bounded catalog pagination and
distinct course-level suggestions for the admin content library.
Migration 300 replaces the Writing page routine so filtered IDs, base rows,
deadline and exact total are read in one PostgreSQL statement; migration 297
remains immutable after staging application.
Migration 301 replaces the catalog page routine so each filtered page includes
base content, cohort links, Mock references and exact total from one statement;
migration 299 remains immutable after staging application.
Migration 302 adds a separate backend-only Mock exam list routine that snapshots
each persisted exam row together with its actionable Review decision; migration
298 remains immutable for already deployed callers.
Migration 304 extends the existing Listening package contract for the 80-day
source collection: lessons may have zero practice forms and transcript timings
may be absent. It keeps controlled transcript hashes required and preserves the
existing atomic import, publication and service-role boundaries.
Migration 306 adds the approved managed Grammar revision/admission boundaries,
retained private cutover proof and serialized start/progress/reset/end routines.
It does not publish or replace a bank. Canonical account erasure uses the same
statement-first scope and only erases that absent owner's personal history;
bank/question revisions and private audit receipts remain immutable.

Apply any genuinely pending active file only through the advisory-locked
forward runner. Do not run a data-deleting reset or use `--baseline` to silence
hosted drift. A pending feature group requires its explicit
`MIGRATION_FEATURES` opt-in after staging validation.

Mock remediation rolls out as306307 additive migrations, then deployment and
verification of the exact new backend SHA, then opt-in308
(`mock_content_remediation_activation`). Before308, attempts remain honest
legacy rows without frozen marking snapshots; N-1 start/attach/save/submit
remain compatible. Apply308 only through the locked runner after setting
`mock_paper.deployed_backend_sha` to that verified40-character SHA in its
session;308 records the SHA on the service-only activation function. Do not
include308 in the migration-before-code batch. It activates typed admission
and frozen snapshots for new work, with no backfill or regrade of old work.

Migration 359 (`activation_serialize`, pending feature) adds the service-role-only
`fn_activation_serialize` RPC. Its per-user transaction advisory lock covers fresh
account/code/profile checks, activation, enrollment and the code claim. Native
rollback includes membership trigger writes; the router performs no compensation
UPDATE or DELETE. It neither installs nor depends on migration 337/346 objects.
Leader alone applies 359 to staging in the freeze window **after
SA-DESIGN-359 APPROVE**, using the advisory-locked runner. Production follows only
at an authorised staging→main promotion. Deploy the previous backend before
running `rollback/359_activation_serialize.sql`; rollback preserves account,
enrollment and claim data. This PR supplies migration files only; hosted
application remains blocked pending that design approval.
