# Durable admission — local implementation checkpoint

Owner approved local ledger/reconciler implementation after the design/self-review.
No external reviewer is awaited. Work remains on the isolated
`codex/core-attempt-outcome-evidence` worktree. **Default OFF, no remote actions.**

## Implemented foundation

- Migration 247 creates private epochs, server scopes, episodes, commands,
  canonical bindings and transition journal. It opens no epoch, touches no
  product table and adds no background schedule.
- Transaction A serializes principal+nonce before resolving a scope and taking
  the shared epoch lock. Exact replay returns its original command and deadline;
  semantic/scope conflicts abort without another episode. Different commands
  can resolve one episode. Episode identity and first epoch cannot be rewritten.
- Epoch rotation compare-and-sets the predecessor, waits for in-flight A, and
  closes/publishes in one transaction. Stable operation UUID enables replay.
  Missing enrollment rolls A back; it never calls a legacy start endpoint.
- Bounded command-only reconciliation uses `FOR UPDATE SKIP LOCKED`. Expired
  unexecuted commands are fenced by generation and journaled `unstarted_expired`,
  not counted as failed/abandoned episodes. Coverage stays `unknown` and Gate F
  `not_assessed`. No grading, content or timer is changed.
- Tables are RLS-enabled and direct access is revoked from browser roles and
  service_role. Only bounded SECURITY DEFINER RPCs are granted to service_role;
  qualified table references and fixed search paths prevent caller shadowing.
  Owner/superuser maintenance is not covered by these controls.
- `services/core_admission.py` provides opt-in prepare/owned-status/reconcile
  transport, canonical metadata digests, bounded network deadlines and strict
  acknowledgment validation. Unknown responses/timeouts are explicitly uncertain;
  no implicit retry, fallback, logging of raw error payload or claim of success.
- `CORE_ADMISSION_LEDGER_ENABLED=False` is independent of diagnostic flags.
  Existing learner starts do not invoke the service. The follow-up slice adds
  opt-in Writing prepare/execute/status endpoints as described below. The public
  prepare endpoint uses the validated domain RPC, not generic preparation.

## Self-review findings and corrections

- **Medium, fixed:** PostgreSQL rejected an unparenthesized CASE inside the
  transition guard's IF expression. Corrected SQL and reran the actual migration.
- **Low, test fixture fixed:** `httpx.Response(json=None)` represents an empty
  body, not literal JSON null. Owned-status missing-row fixture now returns null;
  malformed/empty success bodies still fail acknowledgment validation.
- **Medium, hardened:** an existing table/index is not trustworthy solely because
  `IF NOT EXISTS` succeeded. Migration checks the replay/scope/binding uniqueness
  and single-open-epoch index; a deliberately broken local nonce key must fail
  reapplication. Broader deployed schema/privilege drift still needs verification.
- **Migration coordination:** another extant worktree contains Cambridge
  migrations 245 and 246, so this foundation uses 247. The earlier local
  receipt-aggregate draft originally also used 245. It has now been renumbered
  locally to 256, with its test and current references updated. Recheck concurrent
  branch numbering before PR/merge. No other worktree was changed.

## Verification and remaining scope

Initial corrected focused run: **42 passed, zero skips**, required disposable
PostgreSQL + mocked HTTP. Seven existing dependency/deprecation warnings. This
includes five design prototypes; it is not 42 production or Gate E runs.
The subsequent combined run passed **1,517 tests across 62 files, zero skips**
in 31.85 seconds with required local PostgreSQL. It includes the previous 1,474
backend tests plus 24 service tests, 14 actual ledger migration/RPC tests and
5 design prototypes. The schema-drift rejection test passed. Seven existing
warnings remain. Each fixture removed its isolated schema and the disposable
cluster stopped. `git diff --check` and explicit new-file whitespace checks
reported no patch errors. No frontend code changed in this slice; its previous
9,175-test checkpoint was not rerun and is not included in the backend count.

Still required: execution B for the remaining domains; Writing operational enrollment;
real-browser validation and baseline compatibility; independent source reconciliation
and coherent current-outcome report; erasure/retention policy and enforcement
rollout tests. Binding tables alone do not prove a canonical attempt exists, and
service-supplied principal IDs are not a substitute for HTTP authentication.
No anonymous capability protocol, organic attribution proof or whole-site
denominator is claimed by this foundation. The original full Gate F scope remains.

Next local work is real-browser verification of the Writing admission flow and
closing baseline compatibility on the provenance foundation below. Remote
deployment/migrations, activation, historical repair and legacy deletion remain
outside the present approval.

## Writing execution B and HTTP slice

Migration 248 implements `fn_execute_writing_admission` for an already validated
command. Lock order is scope → student owner → assignment → command; ownership,
generation, phase, execution deadline and live renderer lease are rechecked
after lock waits. Timer stamp, canonical binding, command phase and journal
commit together. Two concurrent executors preserve one initial timer. A later
command can resume that episode without replacing its initial start time.
Replaying a bound command reads current canonical state, including a subsequent
submit, without changing the timer, status or lease.

Known prior activity on an unbound assignment (start time, non-pending status or
any saved draft) is rejected as a baseline conflict. Migration 224's actual draft
guard serializes draft writes through the same assignment row lock. Migration
248 refuses installation when that required trigger is absent, disabled or has
the wrong trigger event/timing. Owner-modified function bodies still require
deployment verification; the trigger's presence alone is not a coverage proof.

**Self-review correction, Medium:** a long-lived repeatable-read snapshot could
miss a draft committed while execution waited for the parent lock. Mutating
ledger/epoch/reconcile/Writing RPCs now explicitly require READ COMMITTED. Tests
reject unsupported isolation before product writes. Source-lock/command-fence
tests use observed PostgreSQL blocking, not just concurrent task dispatch.

The existing Writing router now exposes authenticated, entitlement-checked
execute and owned-status endpoints under `/my-assignments/{id}/admissions/...`.
They use strict request/response models, server-derived user/student identity,
fixed sanitized errors and `private, no-store` responses. There is no fallback
to `/start`. Old start/draft/submit handlers are unchanged by this slice.
OpenAPI TypeScript definitions were regenerated and TypeScript strict check passed.

The first focused run passed 82 tests; the first combined run passed 1,558 tests.
The final combined run, including the trigger-disable regression, passed
**1,559 tests across 64 files, zero skips**, in 35.12 seconds, with seven existing
warnings. Actual PostgreSQL transaction tests cover replay/resume contention,
fenced executor contention, prior-draft contention using the real 224 guard,
cross-owner/resource access, missing lease, baseline rejection, journal-failure
rollback and bound readback after submission. Mocked HTTP tests cover actual
auth/entitlement dependencies, strict request shapes, default OFF, canonical
response validation, no fallback and sanitized errors. These separate layers
are not yet a real browser-to-production-backend end-to-end test.
The temporary PostgreSQL cluster stopped and test schemas were cleaned up.
TypeScript `tsc --noEmit --incremental false` passed after OpenAPI regeneration;
no new browser behavior or UI was introduced. The earlier 9,175 frontend tests
were not rerun for this generated-types-only frontend change.

**Checkpoint boundary:** the 248 tests create synthetic validated commands
directly through private RPCs. Migration 249 below adds prospective provenance;
250 validates that provenance in the public prepare endpoint. The subsequent
browser slice below adds an opt-in caller; learner activation is not ready. Full current-outcome
reconciliation/reporting, other domains and rollout requirements still remain.

## Prospective Writing provenance — migration 249

Default OFF at both boundaries: no row is inserted into the private DB capture
control, and the application flag remains false. No remote migration or activation
was performed. Under explicitly enabled **local test** capture, a source insert
records its immutable owner/assignment identity and birth epoch atomically.
Assignments allocated before capture stay untracked, without backfill/adoption.

The first draft, start or essay linkage records durable activity. A private
canonical binding already inserted by B classifies it as admitted; otherwise it
is unclaimed. Removing content or resetting status/timer never clears the marker.
Source deletion retains a tombstone to prevent UUID reuse resetting provenance.
Admin reassignment is preserved but invalidates the original provenance, including
after reassignment back. Active-source saves/submits do not update the origin.
Browser and service roles cannot directly change origins or invoke the unchecked
248 executor; only the checked wrapper retains service-role execute privilege.

Self-review corrections (Medium):

- `fn_capture_writing_origin` and `fn_track_writing_origin_activity`: pending state
  and a null timer alone missed linked essays. Imported or subsequently linked
  essays now leave an unclaimed marker, including after unlinking the essay.
- `fn_assert_writing_origin`: losing a canonical binding plus resetting a timer
  could make a previously admitted source appear new. An admitted origin without
  its binding now rejects execution without creating a second start.
- The identity-change trigger preserves existing admin reassignment behavior;
  it invalidates evidence rather than blocking the product operation.

Verification: migration applied twice to an isolated actual PostgreSQL schema;
initial combined focused run passed 49 tests, then the expanded provenance suite
passed **18 tests, zero skips**. Tests cover default OFF, epoch mismatch, origin
and product rollback, tombstones, reassignment, private privileges, removed draft,
reset timer, linked-essay history and missing-binding drift. The 248 concurrency,
draft contention and command-fence scenarios also run through the 249 wrapper.
These are local synthetic fixtures, not organic starts, deployed coverage proof
or Gate E runs.

Final combined regression: **1,577 passed across 65 backend files, zero skips**,
39.48 seconds, seven existing warnings. Required PostgreSQL tests ran against the
disposable local cluster on port 55480; fixtures cleaned their private schemas
and the cluster stopped successfully. `git diff --check` and explicit whitespace
checks on the new files passed. No frontend source or generated types changed in
the 249 slice, so no new frontend test result is claimed.

At this checkpoint, prospective validation before transaction A was still missing;
the following 250 slice closes that boundary. Browser recovery is not integrated;
full source/outcome reconciliation and other domains remain.
The inherited migration-245 collision was subsequently resolved locally as 256.
No commit, push, PR, schema application, deployment or capture activation was
performed in this provenance slice.

## Validated Writing preparation — migration 250 / HTTP

`POST /api/writing/my-assignments/{assignment_id}/admissions` now accepts only
the versioned protocol and UUID launch nonce. Existing verified JWT/student/
Writing-entitlement dependencies run before the service; source ownership is
revalidated in SQL. The service hashes the nonce; SQL derives resource semantics
and a two-minute command deadline. The client cannot supply a principal, episode,
fingerprint, status classification, clock or deadline.

Transaction order is nonce → scope → student → assignment → origin → open epoch.
Provisional scope creation rolls back on every validation failure. Baseline,
unclaimed or invalidated origins are rejected before an episode/command exists.
The initial canonical start/draft/essay checks run under the assignment lock.
An already admitted source must retain the correct binding, principal, scope and
timer. New commands resume that episode; its first epoch is immutable.
Preparation itself never starts the timer or updates status, lease or content.

Exact nonce replay returns the persisted decision and current owned source state,
even after epoch closure, command expiry/fencing or submission. It never extends
the deadline or re-enrolls the source. A new nonce still requires fresh eligibility
and an open epoch. The two-minute limit concerns B execution only, not essay time
or the existing 24-hour renderer lease. SQL's `start` action denotes entering the
same assignment, not a destructive restart. No silent fallback or automatic B
call follows a failed/uncertain prepare.

Self-review checked rollback before admission, lock-order consistency with B
and draft guard 224, stable intent across source changes, role isolation, current
owner checks on replay, and no renewed deadline. The domain RPC remains callable
only by service_role; the HTTP route is authenticated and default OFF.
The generic prepare RPC remains an internal trusted-server foundation for other
domains; it is not exposed as a generic public HTTP endpoint or a coverage proof.

Verification: **1,613 backend tests passed across 66 files, zero skips**, in
47.71 seconds; seven existing warnings. This includes actual PostgreSQL tests
for concurrent same/different nonces, prior draft committed while A waits,
cross-owner/resource rejection, no phantom rows after baseline rejection,
journal failure rollback, stable first epoch, epoch closure, submission replay,
short-lived synthetic command fencing and unsupported transaction isolation.
HTTP/transport tests separately cover auth/entitlement rejection, strict payloads,
server-derived IDs, default OFF, private/no-store, sanitized errors, nonce hashing,
malformed acknowledgments and timeout without implicit retry or fallback.
The focused initial run passed 56 tests before the final two regressions were added.
These are separate mocked HTTP and real SQL layers, not a production end-to-end
or organic-traffic test. Fixtures removed their schemas and the PG cluster stopped.

OpenAPI types were regenerated with network blocked during schema generation.
TypeScript `tsc --noEmit --incremental false` and `git diff --check` passed.
No frontend behavior or public runtime flag changed in the 250 slice. The browser
slice follows below; all-domain execution/reconciliation and rollout/retention requirements remain;
the original Gate F objective is not complete. No remote write, commit/push/PR,
capture activation or legacy deletion was performed.

## Writing browser recovery — default OFF

Added `frontend/lib/writing-admission.mjs` and integrated it with the existing
Next Writing dashboard's card click/modal entry, leaving source backend schemas
and grading/save/submit handlers unchanged in this slice. The generated runtime
flag `writingAdmissionEnabled` is false unless the build explicitly receives
`AVER_WRITING_ADMISSION_ENABLED=true`; the optional observation flag cannot enable it.
No flag was activated outside isolated local fixtures.

The controller persists bounded IDs (no essay, token or other content) in
sessionStorage before prepare and command ID before execute. Same-tab overlapping
entry is single flight. After a lost A response, retry uses the same nonce;
after a lost B response, recovery GET reads the owned command before another
write. A valid bound readback uses its canonical timer. A fenced command requires
another explicit action to mint a nonce; a URL alone never does so. Complete
receipts remain readable on reload and a new explicit entry can resume the same
server episode via a new command. Storage write failure before A sends nothing;
failure between A/B prevents B; cleanup failure after a confirmed B does not
turn that canonical success into an error.

The request adapter uses existing `api.js` with the current SDK bearer pinned to
the intended account and an abort signal. Account/lifecycle changes suppress
later writes and stale UI application. Modal generation checks cover close/reopen;
closing disposes the controller without discarding an uncertain receipt. Account/
sign-out transitions clean only the admission namespace, not learner content.
No browser global is read during module import/server rendering.

Self-review findings (Medium, fixed):

- `openSubmitModal` previously treated every 409 as another-tab submission and
  removed `WritingSubmitReceipt`. Admission conflicts now use a separate typed
  inline warning and never erase that receipt. Only canonical terminal status
  readback displays submission success and refreshes lists without opening the editor.
- A pending admission must not redirect to a legacy auto-start renderer after a
  flag/affinity change. Selection happens before the affinity redirect; strict
  or pending commands fail visibly instead of switching protocols.
- Inline card entry initially did not retain its assignment URL, so reload could
  not locate the saved intent. The explicit click now shallow-updates only the
  assignment query parameter, then starts; a runtime test executes that actual
  click and recovers the lost-ACK receipt through the URL entry path.
- TypeScript inferred the cleanup helper's default argument as null-only. Its
  nullable string annotation was corrected; strict checks cover the integration.

Verification uses the actual transpiled `openSubmitModal` and card listener with
an isolated DOM/API fixture, plus controller tests and the existing broad frontend
suite. It is not a real rendered browser or browser-to-PostgREST E2E test. No
backend changes were made here; its last verified checkpoint remains 1,613 tests.
Initial focused controller/UI run passed 32 tests, then two additional integration
regressions (legacy redirect and click/URL recovery) were added. The first combined
frontend run passed 9,209 tests before the final URL regression.

Final frontend regression: **9,210 passed, zero failed/skipped/cancelled**, across
the CI's root `tests/*.test.mjs` + `tests/*.test.js` selection, 19.95 seconds.
TypeScript `tsc --noEmit --incremental false`, `git diff --check`, and whitespace
checks for new files passed. The 34 new controller/UI tests are synthetic local
tests, not additional Gate E runs or live learner starts. Runtime config was
regenerated with an empty environment and remains unconfigured/default OFF.

Remaining at that checkpoint before activation: real-browser local flow verification; explicit
baseline/untracked recovery UX (currently admission rejection stays visible);
operational handling for expired accepted commands while fencing is unavailable;
and rollout acceptance for unreadable retry storage, which fails closed even on
flag backout because absence of a pending intent cannot then be proved. These
must not be hidden by claiming default-OFF testing proves all backout behavior.
Other domains, canonical outcome reconciliation and Gate F closure remain open.
No remote deploy/database operation, commit/push/PR or external review occurred.

## Local rendered Writing verification and modal safety fixes

The subsequent browser pass uses `frontend/tooling/verify-writing-admission-flow.mjs`
against the existing local Next server on 127.0.0.1:3017, whose process cwd was
verified as this worktree. It runs the actual Next page, shared API helper,
sessionStorage, modal and autosave. Supabase SDK/auth and backend responses are
explicit fixtures; Markdown CDN libraries are inert and use the safe plaintext
fallback. Only the local page/assets are forwarded; unexpected network requests
are blocked and fail the scenario. No real learner, token or remote backend is used.

Self-review findings, reproduced before patching:

- **Critical — cross-assignment draft write.** `openSubmitModal` switches the
  shared `assignmentId` before the new workspace loads. Hidden textarea content
  from the previous assignment remained available to the close/Escape save
  handler. Browser reproduction: write/save A, close A, open B with prepare held,
  close B; a PATCH to B carried A's full text. Minimal fix: `workspaceReady` guards
  save and submit, becomes false on entry/close, and stale displayed text is
  cleared without removing persistent receipts. Verification: the same browser
  flow now sends no B draft and retains A's saved text.
- **Critical — empty forced submission on expired entry.** `renderModal` handled
  an expired canonical timer before setting textarea content. Browser reproduction
  with a nonempty server draft sent `essay_text: ''`. Minimal fix: load the current
  draft or exact pending submit receipt and set workspace readiness before timer
  side effects. Verification: browser auto-submit now carries the complete saved
  draft; unit regressions cover both server-draft and pending-receipt precedence.
- **Medium — stale save callbacks.** `saveDraft` could update a later modal's
  status or call its auto-submit handler when an earlier save returned a timeout
  rejection. It now captures assignment and modal generation before dispatch and
  suppresses stale callbacks, including delayed status hiding. A focused unit
  regression changes workspace before an expired-save rejection and verifies no
  new submission. The original draft snapshot is still sent to its original path.

The rendered-browser suite passed **11 scenarios**: ordinary start/autosave/reload,
lost A acknowledgment with identical nonce, lost B acknowledgment with owned GET,
the same recovery after flag rollback, admission 409 preserving pending submission,
direct URL requiring explicit intent, legacy-affinity refusal, default-OFF ordinary
start, canonical terminal recovery, cross-assignment loading/close, and expired
entry with a saved draft. All scenarios assert no unexpected egress or browser
runtime errors. This is local browser integration evidence, not staging E2E,
production verification or an additional Gate E run.

Four permanent unit regressions were added. Two existing transport fixtures were
updated to represent a loaded (`workspaceReady: true`) modal; all original
snapshot/idempotency assertions remain. Before that fixture update, the broad run
reported 9,212 passed and 2 failed because the new loading guard correctly rejected
their incomplete mock state. Focused admission tests passed 38/38; TypeScript passed.

Final broad frontend regression: **9,214 passed, 0 failed/skipped/cancelled**, 1,825
suites, 19.74 seconds. `tsc --noEmit --incremental false` and `git diff --check`
passed. Runtime config still has Writing admission and optional operation
correlation OFF. Backend code was not changed in this browser slice; its last
verified regression checkpoint remains 1,613 tests across 66 files.

At that checkpoint, activation remained blocked on baseline/untracked recovery UX,
stale-command operational fencing, storage-backout policy and live browser-to-PostgREST
verification. All-domain admission and canonical outcome reconciliation are still
open. Migration-number collision resolution remains required before PR/merge.
No remote operations, flags, review delegation or unrelated working-tree edits
were performed in this slice.

## Owned on-demand Writing command reconciliation (migration 251)

Root cause (Medium): an accepted command past `execute_before` was rejected by B,
but stayed `accepted` until the separate batch reconciler ran. The browser had to
retain that ambiguous intent, leaving the user unable to advance when no job was
running. Creating a fresh nonce or falling back to old `/start` would not resolve
the old command safely.

Implemented a bounded private SQL RPC, matching HTTP route/service and browser
recovery. Only the authenticated learner's exact Writing command is eligible;
SQL verifies current student/source ownership and takes the command lock only.
Database time after lock waits decides whether fencing is allowed. The existing
journal trigger is atomic with generation advancement. A previously bound result
wins; an early request cannot cancel a live command. No new episode/command,
timer/lease reset, content mutation, enrollment or attempt-failure label is produced.
The backend uses the existing three-second RPC timeout and fixed sanitized errors;
the route has strict protocol-only input and private/no-store responses.

Browser behavior: execution 410 triggers one owned reconcile POST, not a blind
execution retry. If the command is still accepted (e.g. renderer lease expired),
the pending receipt remains and the existing warning is shown. Bound results use
canonical timer/status. Fenced results preserve IDs and require another explicit
action before a new nonce. An uncertain reconcile retains pending metadata for
GET recovery after reload. Browser time is never used for the transition. Backend
flag remains OFF in committed config; frontend flag backout with backend recovery
still available is tested, not an unrestricted backend-flag rollback guarantee.

Verification covers actual isolated PostgreSQL migrations 247–251, reapplication,
foreign/missing/current-owner checks, permissions, isolation rejection, unchanged
source/draft/lease/denominator, no blocking on held scope/source locks, executor
versus fencer races, deadline after command-lock waits, already-started episode
with expired resume command, and journal-failure rollback. No periodic job was
used by these tests. Browser fixtures now cover 14 scenarios, adding expiration,
lost fence ACK with GET recovery, and live-command/expired-lease no-loop behavior.
The focused controller/integration suite passed 43 tests. OpenAPI types were
regenerated using dummy Supabase configuration and a socket/DNS-denied import.
The initial generation without fixture config failed before writing types; no
real credential or network request was used to resolve it.

Final verification: **1,649 backend tests passed across 67 selected regression
files**, zero skips, seven existing dependency/deprecation warnings, 52.32 seconds.
The new migration file contributes 15 real local PostgreSQL tests; the HTTP/
transport file adds 21 tests. **9,219 frontend tests passed**, zero failed/skipped/
cancelled, 19.98 seconds. All 14 local browser scenarios passed. Strict TypeScript,
`git diff --check` and new-file whitespace checks passed. These are separate
evidence layers; fixture browser tests are not browser-to-live-PostgREST tests.

At the migration-251 checkpoint, baseline compatibility remained unimplemented.
The following slice adds its backend only. Browser integration, backend recovery/
backout availability, browser-to-PostgREST verification and all-domain admission/
outcome reconciliation remain open. The previously identified 245 number collision
was subsequently resolved locally as 256. No remote migration/deploy/capture, commit/push, PR or
external review occurred. Self-review only, per owner instruction.

## Baseline Writing backend and legacy first-clock guard (migration 252)

Reviewed locally on 2026-09-11. **Medium — compatibility gap:** prospective
admission intentionally rejects old work, but the new browser path does not yet
provide a safe way to open it. Migration 252 and `core_admission.py` now provide
owned classification and separately locked baseline entry. The new routes in
`writing_student.py` use existing JWT/student/entitlement checks, strict bodies,
sanitized errors and private/no-store responses. Default OFF is unchanged.

Baseline entry preserves draft/content, original clock, renderer lease and
provenance. It creates no episode, command or binding; a mutex scope alone does
not enter the denominator. It rejects existing admission history, including a
different principal's episode and a cross-resource command sharing the nonce.
Revalidation after locks prevents a stale ownership/classification read from
authorizing mutation. Starting a null clock requires explicit `allow_start=true`;
the default is resume-only. No capture, backfill or epoch rotation occurs.

**Medium — first-clock race:** legacy `start_assignment` constructed an UPDATE
from an earlier SELECT without a null-clock predicate. A competing start could
commit in between and have its clock overwritten. The minimal fix adds
`started_at IS NULL`, reads canonical state after a lost race, and suppresses a
duplicate observed start. Successful UPDATEs also use the returned canonical row.
The permanent route regression reproduces the intervening competing write.

Verification includes real isolated PostgreSQL reapplication, concurrent entry
with equal/different nonces, unchanged drafts/clock/lease/denominator, ownership
changes during lock waits, eligibility/history rejection, private privileges and
READ COMMITTED enforcement. HTTP tests cover authentication, entitlement,
default-OFF, strict input, private responses and malformed/uncertain RPC results.
The first broad rerun reported 1,699 passes and two fixture failures: the existing
observation mock lacked `is_`. Its dispatcher now enforces the null predicate;
original one-attempt and optional-correlation assertions are retained.

Final regression: **1,701 backend tests passed across 69 selected files**, zero
skips, seven existing dependency/deprecation warnings, 63.23 seconds. **9,219
frontend tests passed**, zero failed/skipped/cancelled, 20.12 seconds. TypeScript
(`--noEmit --incremental false`) passed. Generated API types include both new
routes and strict response/request models. The existing 14-scenario browser
checkpoint applies to migration 251; it was not rerun or relabeled as baseline
browser evidence in this backend slice.

At this backend checkpoint, the controller did not yet call `/entry` or
`/baseline-entry`. The subsequent browser slice below supplies that integration.
Local tests are not staging E2E or additional Gate E/F evidence.

## Baseline browser compatibility (2026-09-11)

The controller now classifies owned source state before minting a fresh nonce.
Known unresolved commands retain their existing GET/execute/reconcile path.
Baseline entry carries the existing nonce when old metadata lacks a command ID;
the record is marked baseline only after the RPC confirms it. Stale hints,
transport errors and SQL conflicts do not clear metadata, mint a replacement,
invoke legacy `/start`, discard a submission receipt or claim admission success.
Baseline records contain only identity/state metadata, never learner content.

Fresh URLs read already-started baselines without a nonce/start write. Null
clocks require an explicit action; baseline recovery after reload is resume-only.
If the first request never committed, a later explicit action reuses the nonce.
Canonical terminal entries without pending metadata refresh lists. Expired
baseline entry loads the draft before the existing auto-submit action.

Self-review covered API response validation, unsupported/corrupt metadata,
classification before nonce creation, guarded baseline relabeling, current-account
checks after network waits, uncertain ACK recovery, storage failures and no
error-driven fallback. Existing protocol tests retain their original assertions;
the shared fixtures now expose classification GETs separately from mutation and
command-recovery requests, with a full ordered event trace for the new read.
The real modal integration fixture explicitly checks claim → classification →
prepare → execute; default-OFF claim → old start → detail remains unchanged.

Final local frontend regression: **9,240 tests passed**, zero failed/skipped/
cancelled, 20.14 seconds; focused controller/modal suite **64 passed**. TypeScript
and tracked/new-file whitespace checks passed. The rendered-browser fixture
passed **23 scenarios**, including both baseline kinds, fresh-URL resume-only,
null-clock refusal, lost ACK, lost request before commit, retained old A nonce,
stale-classification conflict and expired draft-first auto-submit. API/auth remain
stubbed; this is not live PostgREST evidence. A final copy-only change removes the
misleading claim that a nonce was already saved when a classification read fails
before one is minted. The final unit regression explicitly records safe refusal
of the terminal/unknown-command edge below; it does not claim successful recovery.
Backend code was unchanged in this slice; its latest verified run remains 1,701
passes across 69 files. Both admission flags remain false.

At the baseline-browser checkpoint, a pending A without a known command ID could
later see a terminal source with admission history. Baseline SQL safely rejected
it, but successful command recovery was still missing. Migration 253 and the
following browser update close that local recovery edge.
Live PostgREST/browser verification, backend recovery/backout policy and other
domains' admission/current-outcome reconciliation remain unfinished. No remote
operations, capture activation, commit/push/PR or delegated review occurred.

## Owned nonce lookup and terminal recovery (migration 253; 2026-09-11)

**Medium — missing recovery identity.** A lost A acknowledgment left only the
nonce, not command ID, in the browser. Classifying a subsequently terminal source
could not distinguish admission history from old baseline work. The new private
STABLE RPC reads the original command using the principal/protocol/nonce unique
index and existing canonical getter. Ownership is current, not inferred from the
nonce. The HTTP route uses the existing JWT/student/entitlement chain, strict UUID
paths and private/no-store responses. Only a successful owned read can report
absence; network/HTTP/shape failures preserve uncertainty. No start, row lock,
enrollment, capture, epoch, deadline, generation or source mutation occurs here.

The controller looks up pending unknown commands before classification. A found
ID is persisted before execution, without new preparation. An absent read still
uses the same nonce in the existing locked A/baseline path because an uncommitted
A may be invisible to the read. If source state is terminal, the modal refreshes
the completed list without B; accepted commands remain pending, bound commands
complete, and fenced commands fenced. This fixes UI recovery without falsifying
the command ledger. Existing expiration reconciliation remains a separate concern.

Verification includes real local SQL for all phases, terminal/expired-lease
source, ownership revocation, foreign/missing source, cross-resource nonce,
private roles, read-only transactions, and uncommitted A/source row-lock cases.
HTTP/transport tests verify auth, entitlement, default-OFF, nonce hashing and
absence/error separation. Early test failures were fixture defects (missing
`probe`/autouse `capture_on`, a direct decorated-fixture invocation subsequently
removed, and HTTP mock's empty body instead of JSON null), not production schema
changes; the final run below is authoritative. OpenAPI types were regenerated
using dummy configuration with socket/DNS disabled.

Final regression: **1,727 backend tests passed across 71 selected files**, zero
skips, seven existing warnings, 63.93 seconds. **9,251 frontend tests passed**,
zero failed/skipped/cancelled, 19.96 seconds; **75 focused controller/modal tests**
passed. TypeScript and tracked/new-file whitespace checks passed. All **27 local
rendered-browser scenarios** passed, including lost A recovered by nonce without
another prepare, terminal source with accepted/bound/fenced commands, and lookup
failure preserving pending identity. SDK/API browser fixtures and direct SQL
tests remain separate layers, not browser-to-live-PostgREST evidence.

Rollout is still not approved by these tests: backend/browser flags are OFF,
retention/erasure and recovery/backout policy are unresolved, other domains and
canonical cohort outcome reconciliation were unfinished at this checkpoint;
the migration-number collision was subsequently resolved locally as 256. No remote mutation or external
review occurred. The temporary PostgreSQL fixture is stopped after verification.

## Independent recovery gate and PostgREST availability audit (2026-09-11)

**Medium — coupled enablement could disable recovery.** Both HTTP guards and the
RPC transport previously depended only on `CORE_ADMISSION_LEDGER_ENABLED`.
Turning that off rejected status/nonce reads and execution/fencing of already
accepted commands together with new preparation. The minimal server change adds
default-OFF `CORE_ADMISSION_RECOVERY_ENABLED` and one shared route/transport
allowlist. With ledger OFF/recovery ON it permits existing command reads,
execution/fencing and baseline resume-only. It denies preparation, unlisted RPCs,
and baseline requests with true/missing/nonboolean `p_allow_start`. Authentication,
entitlement, ownership, SQL locks/generation/deadline checks remain unchanged.

This is a bounded code capability, not verified operational backout. It does not
drain in-flight requests, coordinate instances, change DB capture/epochs or stop
legacy save/submit/start paths. Existing accepted commands may legitimately start
their source clock during recovery. A nonce with no committed command cannot
prepare until admission is restored. N−1 client behavior and storage-loss policy
still require acceptance. No runtime flag or deployment was changed.

The 188-test focused backend run passed, including 58 new flag-matrix and route
tests. They distinguish both-OFF, full-admission and recovery-only, strict
baseline resume, unknown RPC rejection and entitlement denial. Full regression:
**1,785 tests passed across 72 selected backend files**, zero skips, seven existing
warnings, 61.43 seconds. SQL was unchanged; this includes its real local PG
invariants. Whitespace checks passed. No frontend code changed; its last verified
checkpoint remains 9,251 unit tests, TypeScript and 27 fixture browser scenarios.

At the recovery-gate checkpoint, PostgREST integration was **not verified**: no local executable was found; Docker
CLI reported its configured `desktop-linux` daemon unreachable. No container/image
inventory could be read, no daemon was started and no image downloaded. This
failure is not counted as a passing integration test. The later owner-authorized
local PostgREST checkpoint below verifies a bounded API/REST/DB slice, not a browser chain. Existing
browser fixture evidence and direct SQL evidence remain explicitly separate.

## Closed Writing cohort snapshot and current outcomes (migration 254)

**Medium — current-outcome aggregation was missing.** Admission rows and optional
historical receipts alone cannot describe one current outcome per member. The
new private RPC reads one closed Writing first-admission cohort in a single
STABLE snapshot, including unbound episodes and missing source. It joins current
ownership/provenance, canonical binding, command phases, essay and the actual
`writing_feedback_current` view, with bounded grading-job metadata. No learner
content is selected. It does not mutate product or ledger state or persist a
report. Open cohorts and oversized cohorts are refused rather than truncated.

The Python reader reuses `writing_outcome`, verifies complete unique first-epoch
membership and returns disjoint state/reason counts. Unknown source/ownership,
invalidated origin or incomplete feedback never disappear from the denominator.
Late execution and later regrades can update current states without re-enrollment;
resume-command epochs do not add membership. Expired unsubmitted renderer leases
are unresumable, not abandoned. Valid current feedback is not hidden by an older
failed regrade or a large irrelevant job history. Failure classification that
depends on truncated job history stays unknown. Output remains `coverage=unknown`
and `gate_f=not_assessed`, not a globally certified eligible-attempt count.

Tests cover all these classifications, malformed/truncated/duplicate membership,
empty cohorts, no input mutation, privacy, default-gate compatibility, actual
view version selection, ownership changes, source deletion, late binding, later
command epochs, read-only/private SQL and refusal of 1,001-member cohorts. A real
PG repeatable-read test performs a committed regrade on a second connection and
verifies the reader retains coherent old version/feedback until a new snapshot.

Migration 254 is a source-read/preview layer; migration 255 below adds the separate
immutable persisted report.
At the 254 checkpoint, actual PostgREST integration and a real pre-statement DB
timeout were unverified; the transport timeout alone is not proof. The later
local REST checkpoint adds bounded evidence, not operational acceptance.
Larger cohorts need snapshot-preserving
materialization, and report retention/erasure, release/traffic attribution and
other domains remain open. Docker approval had not arrived at that checkpoint;
nothing was started or downloaded to bypass that boundary. No deployment, capture, public endpoint,
commit/push/PR or external review occurred.

Final cohort-slice verification: **1,819 backend tests passed across 74 selected
files**, zero skips, seven existing warnings, 63.51 seconds. The new cohort files
contain 30 tests, including seven real-PG cases; the recovery gate matrix adds
four combinations for the new private read. Whitespace checks passed. No frontend
changes were made; its prior 9,251-test/TypeScript/27-browser-fixture checkpoint
is unchanged, not a newly rerun result. Runtime ledger, recovery and browser flags
remain OFF. The temporary PG fixture is stopped after checking no remaining test
schemas or other client connections.

## Durable Writing reports and lock-wait clock correction (migration 255)

Self-review only, as requested. No independent reviewer was invoked.

- **Medium — report identity did not preserve source across retries.** The 254
  reader was a fresh preview, so later execution/regrading could change a retry's
  source. `255_writing_cohort_reports.sql` now separates immutable capture from
  one-time finalization. `core_writing_reports.create_or_resume_writing_report`
  reads the same caller-retained UUID after uncertainty and classifies only its
  stored snapshot. SQL pins finalization to the snapshot digest, rejects changed
  summaries, and serializes concurrent writers. Returned aggregates omit stored
  learner/source identifiers. There is no public endpoint or provider call.
- **Medium — snapshot clock could predate closure after waiting for locks.** The
  nested 254 reader previously used the outer statement timestamp. A capture
  waiting on the report-control lock could later observe a closed epoch while
  labeling its snapshot before closure. It now takes `clock_timestamp()` at
  reader entry after the caller's lock waits. This is a read-clock label, not a
  commit watermark/MVCC snapshot ID. A two-connection blocking test reproduces
  closure during the wait and verifies the resulting cohort is valid.
- **Low — missing epoch could reach the private transport.** The report creation
  service now requires both UUIDs before any RPC; the read-only getter still
  requires only report identity. Three invalid-epoch cases verify no transport.

Verification: **1,862 backend tests passed across 76 selected files**, zero skips,
seven existing warnings, 71.68 seconds. This includes **31 report tests** (16
service tests and 15 real local PostgreSQL cases) and 12 additional recovery-gate
matrix combinations. Coverage includes migration reapplication, default OFF,
open-epoch refusal, source changes after capture, replay after capture OFF,
same-ID concurrent capture/finalization, digest/summary rejection with rollback,
private permissions, lost acknowledgments, immutable metadata and the lock-wait
clock regression. A direct asyncpg adapter also runs the Python workflow against
actual service-role SQL responses, including completed-report read/replay. This
is **not** PostgREST transport or browser-to-REST integration evidence.

The new separate report capture control remains OFF and requires a policy digest
before new capture. Application recovery-only allows get/finalize, not capture.
Ledger/recovery/browser flags remain OFF. No frontend changes or reruns occurred;
the prior frontend verification checkpoint is unchanged. No remote mutation,
commit/push/PR, automation or external review occurred.

Before activation, implement/approve report retention and erasure/redaction: the
current immutable guard rejects deletion, and the policy digest is not itself a
privacy approval. The classifier profile is not trusted release provenance, and
SQL validates summary shape/count completeness, not the classification algorithm.
Coverage remains unknown and Gate F not assessed. At the 255 checkpoint, true
PostgREST and enforced DB timeout were unverified; the local REST slice below
adds test evidence, not deployed parity. Large-cohort materialization and other domains remain open. This local
slice does not close those conditions. The migration-number collision is handled
by the separate local renumbering below.

## Migration-number coordination closed locally (2026-09-11)

**Medium — two concurrent branches allocated 245.** Read-only worktree inspection
confirmed Cambridge owns `245_cambridge_mock_correction_foundation.sql` and 246;
this branch's aggregate draft was untracked and absent from local Git history.
No existing 256 was found in the inspected code worktrees or local Git refs.
The minimal patch moves only this branch's draft to
`256_core_attempt_observation_aggregate.sql`, renames its matching test module and
updates current documentation references. The SQL body and RPC name are unchanged;
its only read prerequisite is migration 240, so moving it after 255 does not
change admission/Writing dependencies. No installed migration ledger was altered.

Verification: **1,863 backend tests passed across 76 selected files**, zero skips,
seven existing warnings, 69.34 seconds. This reruns the actual aggregate SQL with
the new filename on isolated PostgreSQL and the prior Writing/admission/regression
matrix. A new repository check rejects duplicate migration numbers at/above 240
and confirms the obsolete local aggregate draft is absent. Tracked diff whitespace
checks pass. No frontend changes or new frontend test claim. No other worktree,
index, commit, remote branch, deployment, runtime flag or migration ledger was
modified. Concurrent branch numbering must still be rechecked immediately before
PR/merge; this is not a reservation against future work.

At the renumbering checkpoint, a fresh read-only Docker check still returned
daemon unreachable. The owner subsequently explicitly approved opening Docker
Desktop, downloading PostgREST if missing and running a temporary local-only test
container. No automatic goal continuation was used as that approval; no remote
fallback or credential repurposing was attempted.

## Owner-authorized local PostgREST integration (2026-09-11)

The owner explicitly authorized opening Docker Desktop, downloading a missing
PostgREST image and running a temporary container against a local test database.
Docker Desktop started successfully; the official v13.0.7 arm64 image was pulled
and pinned to digest `sha256:0a46780309a604cdc8b56c776c6e5e15788ce58174d709e40459ab5a2d44d228`.
No staging/production credentials, data or connection were used. The retained
test does not start Docker or download an image itself; opt-in requires the
runtime and pinned image to be present.

**Medium evidence gap, now closed for this bounded local path:** earlier mocked
HTTP and direct SQL tests did not prove actual PostgREST decoding, role handling,
transaction mode or timeout rollback. `test_core_admission_postgrest.py` adds real
loopback HTTP to the pinned PostgREST and disposable PG, with the actual Writing
admission/report migrations and existing isolated product dependency fixtures.
Its prefix-only proxy never synthesizes RPC responses. For ACK-loss tests, it
waits for an actual upstream response then closes the connection before returning
it to the caller. No new product runtime behavior or migration was needed.

### Self-review — passes

- Twelve integration cases verify A/B replay, nonce recovery after committed ACK
  loss, direct-table/RPC role isolation, invalid JWT and cross-owner denial,
  report capture/finalization ACK loss and capture OFF. Same report IDs retain
  their original pre-execution snapshot even after Writing B changes live state.
- The source-lock timeout case observes `pg_blocking_pids`, receives SQLSTATE
  57014 while the source lock is still held and verifies no command/scope survives.
  The after-timer fault receives the same real PostgREST 500/57014 and verifies
  canonical timer, binding and bound journal all roll back. The same command
  succeeds after the test-only slow trigger is removed.
- A FastAPI route/service/REST/SQL chain verifies recovery-only refuses a new A
  before transport, while lost B ACK returns sanitized 503/private-no-store and
  nonce/read/replay restores the canonical timer. Only learner identity and
  entitlement are fixture-owned; this is not live Supabase Auth verification.
- The container has no mounts, is read-only/capability-dropped/resource-limited,
  and publishes only a random 127.0.0.1 port. Secrets and login role are generated
  per fixture. Cleanup targets only its own container ID, UUID-suffixed role and
  schema. Normal Python network/provider guards remain enabled.

### Verification

The initial collection failed because the new test referenced unavailable
`python-jose`; it was corrected to the existing PyJWT import without installing
a dependency. The corrected initial 9-case run passed; the complete focused run
passed **12 tests**, seven existing warnings, 15.82 seconds. Full regression then
passed **1,875 tests across 77 selected backend files**, zero skips, seven existing
warnings, 96.44 seconds. The latter includes the strengthened exact SQLSTATE
assertion for the post-timer rollback case. No frontend source changed or frontend
suite rerun occurred; older browser fixture results are not a new integrated run.

After the run, Docker reported no test container, and PostgreSQL reported zero
test schemas, zero `rest_probe_` roles and zero other client connections. The
test data is intentionally disposable and reproducible from fixtures. The pinned
image remains cached (131,794,827 bytes); Docker Desktop is left open for the user.
The local PostgreSQL fixture is stopped after these checks. No commit, push, PR,
deployment, remote migration, capture activation or external review occurred.

### Still required before rollout

The fixture's 750 ms connection-role timeout is test configuration, not an
approved production latency policy. PostgREST applies connection/impersonated
role settings before the main query; see the official
[transaction documentation](https://docs.postgrest.org/en/v13/references/transactions.html#impersonated-role-settings).
Deployment version, gateway/API-key policy, complete product schema/triggers,
real learner Auth, browser-to-REST flow, load and operational backout still need
verification. Retention/erasure, larger-cohort materialization, trusted release/
traffic provenance and other domains remain open. Repository defaults stay OFF;
coverage remains unknown and Gate F is not assessed. This checkpoint is local
integration evidence, not Gate F PASS or permission to deploy/activate capture.
