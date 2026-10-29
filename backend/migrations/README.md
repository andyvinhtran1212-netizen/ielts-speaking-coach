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
sequence is dense. As of 2026-10-29 the highest is `345`, so by that rule the
next new migration is `346`. Ask the Leader before taking it.
The runner applies any unapplied file regardless of order.
Numbers 321–326 belong to 321 WRITINGRATE-0025, 322 AIOPS-0024 (#1837), 323
ROLECHECK-0026, 324 ASSIGNDRAFT-0027, 325 CODEUNIQ-0028 and 326
STUDENTARCHIVE-0029. 327–330 have no file and must not be reused: 327–329 were
reserved, and 330 was the first reservation for A-10, which took 337 instead
(CLASSARCHIVE-0030 D1). 331 is GIVEARCHIVE-0031, 332 is ADMINAAL2-0032, 333 is
AIBUDGET-0033, 334 is ACTIVATELIMIT-0034, 335 is INACTIVEWRITE-0035, 336 is
ADMINAAL2-0032 FR-019 (#1853), 337 is A-10 CLASSARCHIVE-0030 and 338 is
PAPERUPDATEDAT-0037. Every number from 331 to 338 now has a file. 345 is
PC-J119 (RLS-ADMIN-INLINE-AAL2 + GRAMMAR-FN-SEARCHPATH, spec ADMINAAL2-0032),
reserved by the Leader on 2026-10-29; 339–344 are reserved for other open
work and must not be reused.

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
326 or the `fn_restore_student` lock literal. It names no 331 object. It is a
normal forward migration (no `forward-policy.tsv` row) and is dormant until the
A-10 backend deploys. Apply it on staging first through the advisory-locked
runner, and do not archive or restore classes between apply and deploy. The
light and full rollbacks are in the file header; the full one re-creates the
326 `fn_restore_student` before dropping the columns. One transaction,
re-runnable.

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
role (repair that out of band first). It is held back with 332 (group
`admin_aal2`) and applied after it, on staging first. One transaction, no data
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
events.

Migration `332` (ADMINAAL2-0032) adds the staff security audit. It is held
back by `forward-policy.tsv` (group `admin_aal2`), so apply it only with
`MIGRATION_FEATURES=admin_aal2` through the advisory-locked runner, on staging
first (`specs/0032-admin-aal2-staff-guard/rollout.md` S1/S2), before the 0032
backend. It adds:

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
