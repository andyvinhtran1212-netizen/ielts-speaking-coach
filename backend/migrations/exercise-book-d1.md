# Exercise-book D1 migration contract

377/378 are reserved, `pending_feature`, and **not applied by merge**. This PR
has no staging or production executor. Run 376 → 377 → 378 only in a separately
approved release, staging first through the advisory-locked runner; production
requires direct specific owner approval at T014. 376 and its proposal mirror
are byte-identical to PR1 `1d472f801e0a7c811a64ef845bbb1301e4dea157`.

This job is pinned to D↔E v1.1 §8 (8c7365d95bea), which supplies the twelve
RPC signatures. Leader's 15:35 handoff explicitly keeps this running job pinned;
v1.3 (b0736b75cf99) is assigned to the subsequent delta round. Do not integrate
D2/E until its newer signatures and policy changes are reconciled. In particular,
this patch retains the v1.1 summary argument (ignored), nine-argument grant write,
and grant reads without a step-up parameter; these are not the v1.3 signatures. All product
RPCs require service_role; actors/users come from D2's freshly verified token.
The DB rechecks active/not-suspended staff and cohort grants under locks. The
owner has implicit assigner/teacher rights; every other global admin needs an
explicit latest-sequence grant. `service_role` has SELECT only on the six new
tables, no direct writes, no internal-function EXECUTE and no sequence access.
RLS is enabled without policies; none of these tables is published to Realtime.
Postconditions and PG17 tests enforce these properties even under permissive
Supabase default privileges.

## Owner bootstrap and audit

`exercise_book_grant_owners` starts empty and is constrained to at most one row.
There is no API, RPC or service_role write grant to populate it. Empty, inactive,
suspended and non-admin owners fail closed. The approved default window is
600 seconds, with a maximum of 600. DB checks use `clock_timestamp()` and allow
at most 30 seconds of future clock skew. This fails closed more strictly than
the backend's 300-second tolerance.

RM must obtain the immutable UUID directly from Vinh's own verified session,
then prepare a separate, exact, one-off SQL file outside this repository with
that literal UUID. Independently review its hash before Vinh approves running
that exact file. The transaction must lock the owner table, require emptiness,
lock/recheck the active unsuspended admin row, insert exactly one owner with
600 seconds, and read back the owner/config plus its audit and outbox IDs.
Record the approved script SHA and readback in that future execution result.
An existing/mismatched owner means stop; do not UPSERT or replace it. No real
UUID, script execution, owner verification or bootstrap completion is claimed
by this PR.

Every owner insert/update/delete uses 332's append-only `staff_security_audit`
and `owner_alert_outbox`. The existing event `role_changed` denotes a privilege
change; `detail.scope=exercise_book_grant_owner` distinguishes this configuration
from `users.role`. Before/after include the complete owner row, source is
`service` or `out_of_band`, and operator is the DB session user. TRUNCATE is
refused. No alert is sent by this PR. Grant events and their immutable log keep
step_up_at and request_id for correlation. The service-role contract provides
no verified GoTrue session_id to SQL; D2 must not fabricate one.

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
`p_result_summary` is retained for signature compatibility but ignored. Blank
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
registry/owner/grant/log rows and owner/grant audit guards; existing 332 audit
and outbox evidence is never deleted.

User/paper/item deletion can fail with RESTRICT or immutable-identity errors.
That is expected. Retire by archive. Erasure requires a separate owner-approved,
security-reviewed procedure: preserve IDs and audit linkage, pseudonymise free
text reasons under an explicit exception, and reconcile retained evidence.
D2/E must label reason inputs as a non-PII purpose and exclude them from logs.
There is no erasure or real-data operation in this PR.

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
