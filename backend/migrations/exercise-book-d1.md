# Exercise-book D1 migration contract

377/378 are reserved, `pending_feature`, and **not applied by merge**. This PR
has no staging or production executor. Run 376 → 377 → 378 only in a separately
approved release, staging first through the advisory-locked runner; production
requires direct specific owner approval at T014. 376 and its proposal mirror
are byte-identical to PR1 `3f41c672f`.

D↔E SQL contract **v1.3.2 §8.15**, FD signed and Leader co-signed on
2026-11-12 at 11:04, governs all twelve RPCs. PR1 R12b
`3f41c672f` is merged without changing 376. Grant writes accept an optional
validated `auth_session_id`; list/log require `p_step_up_at` at position 2;
submit accepts persisted expected answers and blank confirmation, with no
caller-supplied result summary. Session IDs are audit correlation only, never
MFA proof or part of the replay fingerprint; replay retains the first session.

All product RPCs require service_role; actors/users come from D2's freshly
verified token. The DB rechecks active, unsuspended admin accounts and cohort
grants under locks. The owner has only implicit `assigner` rights, which suffice
for progress/review; every other admin needs an explicit latest-sequence grant.
Per Vinh t1766s5978, instructor grants return `EB422 validation` and write no
event/log. Instructor access is deferred. Revocation remains possible after a
grantee's suspension, deactivation or demotion, so reactivation cannot revive
revoked access. `service_role` has SELECT only on all seven new tables, no direct
writes, no internal-function EXECUTE and no sequence access. RLS is enabled
without policies; these tables are not published to Realtime. Postconditions
and PG17 tests enforce this under permissive Supabase defaults.

## Owner bootstrap and audit

`exercise_book_grant_owners` starts empty and is constrained to at most one row.
There is no API, RPC or service_role write grant to populate it. Empty, inactive,
suspended and non-admin owners fail closed. The approved default window is
a fixed 600 seconds (CHECK = 600; SQL uses the constant, not the column). DB checks use `clock_timestamp()` and allow
at most 30 seconds of future clock skew. This fails closed more strictly than
the backend's 300-second tolerance.

RM must obtain the immutable UUID directly from Vinh's own verified session,
then prepare a separate, exact, one-off SQL file outside this repository with
that literal UUID. Independently review its hash before Vinh approves running
that exact file. The transaction must lock the owner table, require emptiness,
lock/recheck the active unsuspended admin row, insert exactly one owner with
600 seconds, and read back the owner/config plus its dedicated owner audit ID.
Record the approved script SHA and readback in that future execution result.
An existing/mismatched owner means stop; do not UPSERT or replace it. No real
UUID, script execution, owner verification or bootstrap completion is claimed
by this PR.

Every owner insert/update/delete writes exactly one row to the dedicated
`exercise_book_grant_owner_audit`: complete before/after owner rows, operation,
DB session user and `service`/`out_of_band` source. UPDATE, DELETE and TRUNCATE
are refused on that audit; TRUNCATE is also refused on owners, grants and grant
log. There is no shared 332 audit event, outbox entry or automatic notification.
Grant events and their immutable log retain step_up_at, request_id and validated
GoTrue auth_session_id (NULL or `^[A-Za-z0-9._:-]{1,64}$`). D2 passes NULL for a
missing/invalid verified claim and does not log session values.

The DB step-up check defends against D2 omission; it is **not independent MFA
verification**. D2 must enforce recent MFA and the factor-change cool-off for
POST grant AND GET grant list/log even when `ADMIN_STEP_UP_ENFORCE=false`.
This PR does not change that flag. D2 must log a configuration failure using
function name and SQLSTATE only, without parameters, reason or grantee IDs.

## Assignment and attempt integrity

Each assignment has one unchanged parent item per recipient and one immutable
`class_assignment_activities` row per selected activity. The attempt-link table
binds retries to that cell and holds per-question client sequence numbers.
No request table or shared assignment UNIQUE is added. Activity uniqueness is
checked under the request lock by both create and the insert trigger. Child
FKs are RESTRICT; links and activity identity cannot be rewritten or deleted.

Create serializes by request UUID, shares the cohort/programme grant lock with
revoke, and locks papers in UUID order. Its SHA-256 fingerprint includes actor,
cohort, programme, ordered activities, sorted recipients, UTC deadline, timezone,
replay policy and resolved title. Cross-actor/course/non-book collisions get the
same fixed conflict token. Receipt replay is checked before time/readiness
validation, so a successful request can be retried after its deadline.

Acquire uses the same paper then user:test advisory locks as 376. It shares the
assignment row with close and reuses live attempts; submitted/expired work is
retained and explicit reacquisition creates a retry. Reuse does not take an
attempt UPDATE lock while holding the paper lock: existing saves take the row
before 311 takes the paper lock. Start and expiry use the same statement timestamp
so the 24-hour TTL CHECK cannot fail from microsecond skew.

Save serializes on the attempt row; client_seq is per question. Older/equal
sequence values return current state without applying. Submit checks persisted
answers under that same lock and computes the summary from the frozen snapshot;
there is no `p_result_summary` input. Blank
confirmation is required. Exact submitted replay is allowed; differing answers
get `attempt_changed`. No completion, artifact or score fields on the parent item
are changed. Closed assignments and overdue writes fail closed; an already
submitted exact replay returns existing evidence without writing.

The narrow resolver branch runs only for a Listening book paper with a class
item. It checks the owned activity, assignment status/publish/deadline, active
membership and protected-reference/overlap rules; failure returns unavailable
without public fallback. Every non-book body path remains the 316 implementation.
306's snapshot capture is unchanged. D2 must derive assigned context from the
immutable link, attempt and item/assignment, with an owner join at read time.

## Rollback and erasure

Use only the reviewed manual files under `rollback/`, with a separate execution
approval and ledger decision. They take relation locks under a five-second
lock_timeout. Roll back 378 before 377. 378 refuses to proceed if activities,
links or assigned book attempts exist; archive instead. With no such history it
drops the new RPCs/triggers before children, restores 376/316 bodies exactly,
and asserts the resulting catalog. The class_action_log CHECK is discovered and checked against 198 before widening,
then validated and checked again before COMMIT. The extended CHECK remains
to preserve any audit evidence. 377 disables four product RPCs but retains all
registry/owner/grant/log rows, the dedicated owner audit and all audit guards.
Both rollback postconditions raise 55000. The 378 rollback verifies the restored
316 resolver body hash, SECURITY DEFINER, search_path and service-only ACL.

User/paper/item deletion can fail with RESTRICT or immutable-identity errors.
This includes standalone Black Eye attempts captured in 306 snapshots: the
shared users cascade must not remove frozen evidence. Archive is supported;
physical erasure is not implemented here. Removing RESTRICT or bypassing the
immutable triggers would change retention and data scope without approval.

### Erasure request runbook (SA-2282-R1-F8)

1. Release Manager owns the request. Stop a generic account-delete retry after
   RESTRICT/`attempt_changed`; retain the error code without parameters/PII.
   Archive/deactivate through the existing approved account workflow as needed;
   do not disable constraints, triggers or RLS to force deletion.
2. Inventory READ-ONLY the affected user's owner/grant/log references, assignment
   items and activity/attempt links, standalone Listening attempts, 306 frozen
   snapshots and shared class-action rows. Record row IDs/counts and hashes in
   the access-controlled request package. Include historical grants/owner audit
   JSON and free-text reasons; do not copy production data to staging.
3. Obtain Vinh's specific decision on retention versus pseudonymisation versus
   physical deletion, with the affected scope. No prior merge or migration
   approval supplies this decision. Escalate conflicting retention requirements
   before preparing a write. Security Auditor reviews the exact one-off SQL,
   rollback/backup package, row counts/hashes and any narrowly scoped trigger
   exception. Release Manager obtains approval for that script hash/executor.
4. Prefer an approved pseudonymisation procedure that preserves stable IDs and
   audit linkage. It must explicitly cover identity text in historical JSON,
   reasons and snapshots; changing only users.display_name is insufficient.
   The append-only guards deliberately require a separately reviewed exception.
   Physical erasure requires its own ordered dependent-row plan and authorization.
5. In the separately authorized execution workflow, lock and compare the approved
   IDs/counts/hashes; stop on any mismatch. Apply once using the required write
   journal and advisory-locked runner. Read back exact postconditions, retained
   linkage and absence of scoped identifying text, then check unaffected records.
   Roll back only using the approved package if postconditions fail. Record the
   execution result privately; never record sensitive before-images in git/logs.

This PR supplies the runbook, not approval or an erasure executor. The existing
immutable trigger still checks every Listening UPDATE/DELETE, including other
programmes. It probes indexed attempt links/snapshots, and a paper lookup on
UPDATE. Keep that coverage: an attempt-purpose shortcut could bypass frozen
Black Eye evidence or a change into a book paper. The R2 RESULT records synthetic
PG17 save/submit latency with and without this trigger, including sample count
and local-only limitations. Production latency remains an RM apply-plan check.

D2/E must label reason inputs as a non-PII purpose and exclude them from logs.
Shared class-action routes must exclude/authorize book rows before exposing close
reasons (D2 scope). No erasure or real-data operation runs in this PR.

## D2/E preservation and verification

Original PR2 `8305385426be022d5ad89ace060ed53ac4d92907` remains on local branch
`wip/d2-from-2282`. It includes all prior routes/services/models, UI, generated
API types, tests and documentation. D2/E must selectively port and fix that work
against D1; blindly merging it would overwrite 376 and restore stale contracts.
This D1 PR adds no routes and opens no learner UI or grant writer.

`tests/test_exercise_book_postgres.py` executes the real 306/311/316/376 chain
with synthetic data on an explicitly local disposable PostgreSQL instance. It
checks exact signatures/defaults, ACL/RLS/publication, audit, fan-out, conflicts,
sequence ordering, deadlines, ownership, full-binding freeze, races, rollback
and the all-course differential resolver matrix. Both grant regression tests
and the existing 376 tests remain in the PG17 CI file list. Existing dormant
377 test expectations were updated for the approved active RPC contract;
client/direct-write denials and evidence-retention assertions are stronger.
No test is skipped, xfailed or given a larger timeout by this change.
