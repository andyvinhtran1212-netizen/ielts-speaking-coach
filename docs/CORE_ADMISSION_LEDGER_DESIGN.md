# Durable core admission ledger and reconciliation

Design v1 — 2026-09-10. **Local implementation authorized; foundation and Writing
prepare/execute/status implemented behind default OFF, no browser admission activation.**
Migrations 247–255 and `backend/services/core_admission.py` implement the private
command/epoch/reconciliation layer, Writing execution B, prospective source
origin/first-activity capture, validated preparation A, owned on-demand fencing,
baseline compatibility, nonce lookup, closed-Writing-cohort source reads and
private two-phase durable Writing reports. Writing browser
prepare/execute/status recovery is wired behind a separate default-OFF flag;
local rendered-browser fixtures and the opt-in local HTTP/PostgREST/PG tests are
verified separately. Browser-to-PostgREST verification and operational rollout
closure remain incomplete.
DB capture has not been activated. Existing diagnostic
migrations 240–244 and 256 stay separate (the uncommitted aggregate draft was
renumbered from 245 to avoid the Cambridge branch's migration).
The owner's approval covers local implementation/testing with default OFF; it
does not authorize remote schema application, deployment or capture activation.
Review mode for this session: owner requested self-review, not waiting for an
external reviewer. This is not an independent Claude/Codex approval or Gate F PASS.
No existing threshold, eligibility exception, retention duration or deployment
permission is changed by this proposal.

## 1. Objective and boundaries

Prove which eligible learner starts the server accepted, associate them with
canonical attempts, and reconcile their current persisted outcomes. Existing
migrations 240–244 and 256 remain optional diagnostic observations; they are not moved
inside learner transactions or silently reclassified as the admission ledger.

Three different units must remain visible:

- **Command:** an accepted request to start/resume/restart. Transport retry of
  the same command is not another command. A denied unauthenticated request is
  not a learner attempt.
- **Episode:** one eligible logical attempt, including a durably accepted start
  that fails before its canonical row exists. Several commands may resume or
  retry the same episode. Regrades and answer checks do not create episodes.
- **Canonical unit:** existing product identity, not an observation/event UUID.
  An episode may be bound to a full-test group containing several source rows.

The proposed admission boundary is after server auth/capability, entitlement,
resource and assignment validation, and before the first attempt mutation.
Dynamic quota/lease/state checks remain authoritative at execution time. An
accepted command may fail those checks; the reason must be explicit. A request
lost before durable acceptance remains pre-admission availability evidence,
not a fabricated episode. Such failures/gaps must stay visible and cannot be
excluded to make a clean Gate F result. This definition must be frozen before
activation; the design permission does not ratify a weaker evidence profile.

## 2. Source map and product invariants

| Source | Canonical unit / episode mapping | Required invariant |
| --- | --- | --- |
| `routers/sessions.py:create_session`, migration 241 v4 creation receipt | Plain `sessions.id`; full test uses server-validated `full_test_attempt_id` | Quota and user→session lock order preserved; parts 2/3 join the owned preceding part's group, never a client-chosen group; one full-test episode, not three |
| `routers/reading_student.py:start_reading_test_attempt` and `start_shared_reading_test_attempt` | `reading_test_attempts.id` | Explicit start-over stays a new episode; exact command replay must not abandon another attempt; anonymous capability remains separate from account identity |
| `routers/listening.py:start_listening_test_attempt` | `listening_test_attempts.id` | Full/mini/practice subtype comes from the test source; answer/reveal requests are not admissions; first-answer grading is unchanged |
| `routers/listening.py:start_dictation_attempt` | `dictation_attempts.id` | Resume/concurrent first starts resolve to one active section parent; expired-parent replacement is a new episode; old answers remain intact |
| `routers/writing_student.py:start_assignment`, `upsert_my_draft` | `writing_assignments.id` | Admin assignment creation is not admission; repeated learner start and lease renewal stay one episode; draft status transitions are not proof of an observed timer start; original start time is not overwritten |
| `app/(authed-mock-exam)/mock-exam/mock-exam-runner.tsx`, `/api/mock-exams/sittings/...` | Sitting coordinates domain units; mock Writing is not an assignment | Never count sitting + its Reading/Listening/Speaking children as extra equivalent attempts; Writing mock needs its own owned unit/section mapping before claiming coverage |

The current six-row diagnostic report is not an exhaustive admission inventory.
Before implementation is declared complete, enumerate every production start
caller and direct source writer, including native mock Writing, admin/import
creation and N−1 paths. Any unmodelled path is a named coverage gap, not silently
out of scope. New namespaces belong to a versioned admission report; do not
change the meaning of existing diagnostic rows.

## 3. Protocol: explicit, versioned, recoverable

Proposed `admission-v1`, negotiated only on enrolled routes:

1. On an explicit learner start action, the browser creates a high-entropy
   `launch_nonce` and preserves it until acceptance is resolved. No nonce or
   write occurs during SSR/render. The existing optional `X-Core-Operation-ID`
   remains diagnostic and is **not** upgraded into an idempotency key.
2. A prepare/admit endpoint validates the actor and resource, canonicalizes
   semantic input on the server and durably creates/returns the command in
   transaction A. Uniqueness is `(principal, protocol, launch_nonce)`; a reused
   nonce with different resource/input is 409, not another episode.
3. The response contains an opaque server command ID and execution/reconcile
   location, not permission to bypass auth. An ambiguous prepare ACK is retried
   with the same nonce; the server returns the same command. Different tabs
   may intentionally issue different commands; copied nonces do not bypass
   actor/resource ownership or uniqueness.
4. Execute takes that command ID. Transaction B locks and revalidates it, then
   performs canonical creation/start, episode binding and durable commit marker
   atomically. Exact replays return the bound canonical result without rerunning
   start-over. A changed/new attempt requires a new explicit command.
5. Lost execute ACK leads to owner-only status/readback. No automatic fallback
   to an old destructive POST. Continuing an already bound attempt reads its
   current source state; it does not assert an old JSON response is current.

Preparation does not start the exam timer or consume quota. Execution applies
those product rules exactly once. Authorization and resource state are checked
again at execution; a prepared command is not a perpetual entitlement.

**Anonymous Reading:** establish an unguessable server-issued admission-scope
capability before prepare, or validate the existing owned capability. A public
share token plus client nonce alone must never recover another visitor's command
or answer capability. An ACK-lost bootstrap only leaves an unused scope, not an
eligible episode. Store only a verifier in the private scope store; never raw
capabilities in evidence, logs or report responses. Apply expiry, rate/size
limits and constant ownership checks. Do not merge a later signed-in account
with this anonymous principal without an explicit ownership-transfer protocol.

## 4. Proposed private data model

Names below are design names, not reserved migration numbers or deployed tables.

| Entity | Minimum fields and constraints |
| --- | --- |
| `core_admission_commands` | UUID, protocol version, principal reference, launch nonce verifier, semantic fingerprint/version, validated resource reference, action, episode ID, epoch ID, execution generation, phase, fixed reason code; unique principal/protocol/nonce |
| `core_attempt_episodes` | UUID, surface/kind, first accepted DB time, immutable `first_admission_epoch_id`, eligibility version, optional canonical unit, principal, disposition; unique bound `(surface, kind, canonical_id)`; no raw answer/audio/prompt |
| `core_admission_bindings` | Command→episode and episode→source-unit associations; full-test part membership; foreign keys and immutable binding identity; collision fails the transaction |
| `core_admission_journal` | Append-only state transitions with command/episode/generation, fixed transition/reason, DB time; unique transition identity for replay; no exception messages |
| `core_admission_epochs` | Versioned route/writer enrollment, deployment metadata references, open/closed state and closure proof; membership cut is not derived from timestamps alone |
| `core_reconciliation_reports` | Immutable report ID/version, closed epoch set, source snapshot metadata, disjoint outcome counts and gap counts, artifact digest, redaction status |

Ownership is checked via the authenticated server, not client-supplied owner
columns. Principal/resource references are private pseudonymous data, not
anonymous data. Fingerprints use a versioned server computation over bounded
semantic inputs; secrets/capabilities are excluded. A cryptographic digest of
an easily guessed answer is not a privacy policy.

For resume-only semantics (Writing and Dictation), use a server-controlled scope
row to resolve concurrent commands to one episode before counting it. Writing's
known assignment anchors that identity; Dictation uses its owned test/section
generation. A pending new-parent reservation is unique for that generation.
Execution must validate the reservation and existing active parent together.
For explicit Reading/Listening start-over, a genuinely new command creates a
new episode; old/new canonical effects and bindings commit together. Never
deduplicate unrelated start-over requests solely by equal request content.

## 5. Transactions, failures and reconciliation

Lifecycle:

`accepted → execution under lock → bound to canonical unit → current outcome`

Failures are not all terminal. The command can remain `accepted/uncertain`, or
receive a durable `rejected/failed_prestart` decision. The episode separately
tracks `unstarted`, `active`, `success`, `failed`, `abandoned` or `unknown`.
Successful command execution is not a passing IELTS score or completed attempt.

- A commits acceptance before B starts. A failure must not trigger B, and must
  not silently fall back to a path lacking the admission contract.
- B holds the command row lock across canonical writes and binding. It respects
  a documented global lock order with product user/scope/session locks; audit
  every old/new caller for inversions before integrating. No network/provider
  call is held inside this transaction.
- If B rolls back, neither new canonical unit nor binding/commit marker remains.
  Existing Reading/Listening multi-request abandon→insert must become one
  versioned SQL operation on this path; do not pretend two PostgREST calls share
  a transaction. This is a deliberate behavior change requiring implementation
  verification, not reuse of the current optional observer.
- If B commits but ACK is lost, status/readback finds its binding. Reconciliation
  is read-only for grading and learner content; it never resubmits or creates a
  second attempt to infer success.
- A durable failure record after a failed B is a separate transaction. If that
  also fails, acceptance remains unresolved, not successful or implicitly zero.
- A reconciler uses bounded `FOR UPDATE SKIP LOCKED` selection. It may close an
  unexecuted command only under the same row lock and generation check used by
  executors. Incrementing/fencing the generation prevents a delayed old worker
  from committing after closure. No closure from a stale GET or timeout alone.
  It must not acquire product user/scope locks after taking a command lock if an
  executor takes those locks in the opposite order. Either follow the same
  product→command order or restrict the locked reconciliation transaction to
  command-only fencing plus nonlocking source reads. A fixed global order is an
  implementation prerequisite, not implied by `SKIP LOCKED`.
- Pending preparation expiry is not automatically learner abandonment or an
  application failure. Preserve `unknown(reason=unstarted_expired)` until an explicit
  product disposition is available. In-progress expiry likewise does not equal
  an acknowledged abandonment. Unknowns remain visible to the acceptance gate.

Rollout modes are `off`, `shadow`, then explicitly approved `enforced`.
Shadow mode preserves availability but cannot certify all-admission coverage.
Enforced mode adds a dependency to the start path: if durable acceptance is
unavailable, new starts fail safely before mutation. Saving/submitting already
running attempts must not depend on the admission service or stop because the
reporting worker is down. This availability tradeoff must be measured and
approved before activation; it is not authorized by a design-only request.

## 6. Coverage and coherent reporting

**Closed membership:** admissions take a shared row lock on their enrollment
epoch and recheck it is open inside A. An epoch closer takes an exclusive row
lock, waits for in-flight A transactions, closes the old epoch and publishes its
successor. Late starters reselect the open epoch. A report starts after closure
commits, with a fresh snapshot. Test the precise lock/isolation behavior; an
insert timestamp or sequence ID alone cannot prove this cut.

Closing membership does not stop B or freeze learning outcomes. Report source
outcomes for that closed cohort in one database snapshot, persist the report's
version and counts, and distinguish that observation from historical outcomes.
Episode membership uses its immutable **first admission epoch**, not the epoch
of each later command. Resume, retries and Speaking parts 2/3 in another epoch
do not re-enroll the episode or add it to that later epoch's denominator. A new
episode and its first-epoch assignment must be committed together in A under the
domain's scope uniqueness rules. Command activity can be reported by its own
epoch separately. Include late-bind/unbound episodes from the closed first-epoch
cohort, rather than silently dropping episodes not yet joined to source rows.
A later regrade may legitimately produce a different report. Do not paginate
changing source rows across independent snapshots and call the result coherent.
Large cohorts need snapshot-preserving partition/materialization, bounded query
volume and a real pre-statement timeout; truncation is not a passing report.

**Independent reconciliation:** compare the enrolled canonical source inventory
with admission bindings, including direct/admin/background/N−1 writers. In an
enforced cohort, all product creation/start transactions need a database-enforced
admission context/binding or a typed, audited non-learner disposition. An app
feature flag alone cannot prevent an old writer bypass. Guard rollout, emergency
disable and owner/superuser writes must produce explicit coverage intervals;
never assume the privileged owner cannot bypass DB controls.

Source rows lacking admission are anomalies, not rows to backfill as if observed
at start. Existing pre-enrollment rows retain an explicit baseline provenance.
Deletion/erasure requires a retained disposition sufficient to explain a missing
bound source; a rolling scan alone cannot detect a row created and deleted
between scans. Unknown writer/instance coverage prevents certification.

Report equations for a fixed admitted-episode cohort:

`D = unstarted + active + success + failed + abandoned + unknown`

Each episode occupies exactly one current partition. Retry command volume,
pre-admission availability failures, unmatched canonical rows, unknown traffic,
unknown release and coverage gaps are separate reported measures, never quietly
removed from D or interpreted as zero. No new numeric floor or automatic gate
decision is introduced here; existing acceptance requirements must be evaluated
against these richer states, not rewritten to accommodate them.

**Attribution:** persist server-side deployment/enrollment facts and separately
label client-reported frontend release. Backend SHA is not frontend SHA; a public
signed build marker proves issuer, not that a browser actually rendered it.
Record provenance and unknown/mixed states. Test-account registry membership can
prove synthetic classification; absence does not prove organic use. Agree the
admissible organic/exposure evidence before any claimed organic denominator.

## 7. Security, privacy and operations

- No anon/authenticated table or RPC access. Owner-only command status with
  sanitized 404/409/503, private/no-store responses and no cross-user existence
  oracle; admin aggregate excludes individual identities and content.
- Capability verifiers and account mappings live in a separately restricted
  ownership store. No JWTs, share tokens, emails, IPs or raw learner content in
  journal/report rows. Rate limits and payload limits precede durable allocation
  where possible; typed pre-admission failures remain availability metrics.
- Propose separate retention for nonce/replay records, command journal, principal
  mappings and aggregate reports. Do not pick a purge duration by guess: it must
  cover supported retry/TTL/revisit windows and erasure obligations. User approval
  is required before capture. Erasure must revoke replay access, maintain truthful
  redaction markers and invalidate reports whose completeness can no longer be
  demonstrated; it must not recreate deleted identities on reconciliation.
- Applying additive schema, enabling guarded writers and enabling reporting are
  separate steps. Do not deploy active source guards before every intended writer
  is compatible. Existing active attempts retain save/submit/recovery capability.
- No new schedule is created by this design. No legacy artifact is deleted; no
  Gate E rerun, historical data repair or retrospective traffic fabrication.

## 8. Implementation order and acceptance tests

1. Freeze source/caller inventory, eligibility/retry semantics, per-domain lock
   order, privacy/retention and rollout failure policy. Use the source map above
   as the starting inventory, not proof it is exhaustive.
2. Implement private command/episode/binding schema and status API, default OFF;
   test permissions, replay conflicts, unsupported versions and erasure.
3. Integrate one domain at a time with atomic SQL and browser recovery; retain
   N−1 compatibility and separately label unenrolled writers. Do not reserve a
   migration number before checking concurrent branches.
4. Implement epoch closure, source reconciliation and versioned snapshot report;
   keep the receipt-only diagnostic API separate and compatible.
5. Self-review each batch, run local PostgreSQL races + backend + real browser
   tests, then obtain exact commit/PR/staging/migration/activation authority.
6. Verify staged roles/schema/timeouts/load, mixed deployments, backout, old
   active attempts and missing-coverage alarms. Only then propose production
   activation; evidence collected earlier is not upgraded retroactively.

Required fault matrix: A commit/ACK loss; crash before B; B rollback; B commit/ACK
loss; failure-record loss; stale fenced executor; simultaneous same/different
nonce; changed payload; account switch; anonymous capability theft/replay;
Dictation concurrent resume; Reading/Listening explicit restart with partial
failure; Writing simultaneous timer start; Speaking three-part/quota replay;
mock section/attempt double-count; revoked entitlement; delayed old writer;
recorder OFF/outage; late commit at epoch closure; regrade during report; source
deletion/erasure; missing schema/role; oversized report; report timeout.

Expected outcomes must be asserted against canonical database rows, not just
HTTP 2xx or count equality. Tests must prove prior answers/timers/quota remain
correct immediately and after reload, and distinguish unknown from failed.

## 9. Self-review record

Reviewed against current route/SQL implementations and the project checklist.
No implementation or live guarantees are claimed by this document.

- **Critical design risk avoided — replaying start-over after lost ACK.** Current
  Reading/Listening POSTs can abandon work. The proposed command replay uses a
  bound result and never falls back blindly. Verify B-commit/ACK-loss and N−1.
- **Critical design risk avoided — anonymous nonce as ownership.** Public share
  + guessed nonce cannot be sufficient authority. Add independently possessed
  scope capability and test cross-visitor command/result access.
- **Medium design risk avoided — double counting preparation/resume/parts.**
  Separate commands from episodes; resolve resume aliases under server scope
  locking and canonical uniqueness. Test multi-command/single-parent mappings.
- **Medium self-review correction — cross-epoch double counting.** A resumed
  command may belong to a later activity epoch, but its episode keeps an immutable
  first admission epoch. Add first-epoch cohort membership to the schema/report
  contract and test retries and Speaking parts across epoch boundaries.
- **Medium design risk avoided — late commits absent from a timestamp report.**
  Use closed-epoch membership and fresh coherent source snapshots; verify locks
  and late commit behavior in real PG before claiming a completeness cut.
- **Medium design risk avoided — instrumentation outage blocks in-flight work.**
  Strict admission dependency applies only to newly enrolled starts; existing
  save/submit and optional diagnostic observers remain isolated. Rollout testing
  must demonstrate this distinction.
- **Remaining, not hidden:** exact organic/exposure criteria, retention periods,
  complete writer census and measured load remain activation prerequisites.
  Design permission and self-review do not silently choose those policies.

The [source/writer inventory](audits/CORE_ADMISSION_WRITER_INVENTORY_2026-09-10.md)
now records concrete domain boundaries, dynamic assignment writes, native mock
Writing capture, Speaking attachment effects and an import-script false positive.
It is a bounded local census, not proof of complete deployed enrollment. Exact
caller/trigger/cascade closure and implementation contracts remain prerequisites.
No SQL migration or product write-path change was made for that design checkpoint.
The subsequent approved implementation begins with migration 247; see the
[implementation checkpoint](audits/CORE_ADMISSION_IMPLEMENTATION_2026-09-10.md).

### Executed design checks

`backend/tests/test_core_admission_design_postgres.py` passed **5/5** with required
local PostgreSQL and zero skips. It proves shared-epoch-lock versus exclusive
closure ordering with an observed `pg_blocking_pids` overlap; atomic product/
binding rollback followed by committed readback on a fresh connection; and a
waiting stale generation being rejected after reconciliation closes it. Two
additional cases observe concurrent scope-lock contention: a first preparation
commits or rolls back, the competitor resolves exactly one surviving episode,
and a later-epoch resume keeps that episode in its original cohort. An attempted
first-epoch rewrite is rejected by the prototype trigger.
The isolated schema was removed by its fixture and the disposable cluster was
stopped. No learner data or production/staging database was involved.

These are intentionally retained design-prototype tests, not tests of a deployed
admission RPC. Auth, complete writer enrollment, product-domain episode uniqueness,
contended successor publication, `SKIP LOCKED` batching, production lock order,
performance and rollout still need implementation tests. Prior application
regression results remain 1,474 backend / 9,175 frontend; those suites were not
rerun for this documentation/prototype-only change.

The first invocation from the repository root failed at fixture setup because
`routers` was not importable. Running from `backend/` fixed the command environment;
no application change was made to conceal that error. The successful run had
zero skips and seven existing dependency/deprecation warnings.

## 10. Bounded first-domain contract — proposed Writing assignment admission

Writing assignment admission is a proposed first vertical slice because its
canonical assignment exists before the learner starts. This ordering does not
remove the other domains from Gate F or certify the whole site after one slice.
Local implementation is now authorized. Enforced-start activation is not.

### Baseline versus newly admitted work

Before A allocates a new eligible episode, distinguish an enrolled episode,
provably unstarted eligible assignment, and pre-enrollment/unknown activity.
`pending` alone is not proof of inactivity: drafts and compatibility leases can
exist, and current source state does not prove deleted history was absent.
The source baseline and writer enrollment must support the classification.

- Resume of an already enrolled episode creates only a command activity record;
  its immutable first admission epoch stays unchanged.
- A genuinely eligible new start may allocate its first episode in A.
- Existing/unknown baseline activity must use owned baseline recovery, not be
  enrolled retrospectively as a newly observed start. Existing save/submit paths
  remain available under their original ownership, lease and timer rules.
  An owned baseline response is not permission for an ambiguous new-admission
  client to blindly retry a destructive old start route.
- Baseline inventory and unresolved attribution remain separate visible report
  measures. This distinction is a measurement contract, not an eligibility waiver.

### Proposed transaction ordering and responsibilities

Only for this single-assignment slice, propose the following order; validate
against **all** existing triggers and callers before implementing it:

1. Writing A (migration 250): principal+nonce advisory lock → server-owned scope
   row → owned student row → owned assignment row → origin row → shared open
   epoch row → episode and command records. Replay uniqueness is checked on the authenticated principal,
   protocol and nonce; a resource/fingerprint mismatch cannot create a new scope
   as a side effect of a conflicting replay. Scope allocation needs its own
   uniqueness and bounded allocation checks, not an unchecked row per request.
2. B: same scope row → owned student row → owned assignment row → origin row → command row/generation → bindings
   and journal. Revalidate owner, assignment status, eligibility and renderer
   lease while the relevant source row is locked. Set `started_at` only if NULL
   in the locked canonical row; use its persisted value in the response. Preserve
   existing status/timer on resume. Bind and mark committed in the same DB
   transaction; do not compose multiple PostgREST requests and call them atomic.
3. Reconciler: command-only lock/fence transaction; no subsequent scope or
   assignment lock. If a source-specific decision needs those locks, retry that
   work in B's order in a new transaction. Epoch closer takes epoch locks only,
   never waits for a scope while holding an epoch lock.
4. New source guards must not acquire scope/command locks from an assignment
   trigger if that reverses B's order. Private writer context must not be accepted
   from an arbitrary caller-supplied header or session variable as authorization.
   Binding/context checks require a separately reviewed DB privilege contract.

Migration 249 implements the origin check in B; migration 250 validates it before
A in the authenticated Writing prepare endpoint. The empty private capture-control table keeps new-source
capture OFF after installation. When explicitly enabled with a matching open
epoch, source allocation and its origin commit together. Old allocations remain
untracked, without historical backfill. First draft/start/essay linkage records
`unclaimed` unless the private executor has already inserted the canonical
binding in the same transaction. Removing the draft/essay or resetting source
state cannot clear that first-activity marker. Deletion retains a tombstone;
admin reassignment remains possible but permanently invalidates original-owner
provenance. An admitted origin missing its canonical binding fails closed.
Existing in-progress saves/submits do not update the origin store. These local
guards do not prove uninterrupted deployed writer coverage or certify Gate F.

The Writing prepare request accepts only `protocol=admission-v1` and a UUID
launch nonce; authenticated principal/student and assignment path are validated
server-side. The service hashes the nonce; SQL derives a fixed versioned semantic
fingerprint for entering that assignment, whether starting or resuming its same
episode. This is not a restart action and does not derive a different intent
from mutable source status. A command has a server-owned two-minute execution
window, distinct from the learner timer and 24-hour renderer lease; replay never
extends it. Exact replay still recovers accepted/bound/fenced commands after
epoch closure or submission, subject to current ownership/HTTP entitlement.
A new nonce cannot enroll baseline work or allocate a new episode on resume.
Preparation changes no timer, status, draft or essay. HTTP errors are sanitized,
responses private/no-store, and uncertain A never invokes a legacy start or B.

### Browser implementation boundary

`writing-admission.mjs` implements tab/account/assignment-scoped recovery, separate
from the optional observation transport. It persists a nonce before A and the
returned command ID before B, stores no essay/token, and coalesces overlapping
calls. Missing/malformed responses and storage failures retain uncertainty.
Pending command IDs recover through owned GET; a lost A acknowledgment retries
the same nonce. Bound acknowledgment marks the receipt complete. Only a new
explicit action can replace complete/fenced metadata with a new nonce; plain
URL load does not mint an intent. A card click keeps the assignment in the URL
so reload can locate its receipt. Auth is checked before/after async operations
and the ordinary SDK bearer is pinned to the same account at dispatch.

`AVER_WRITING_ADMISSION_ENABLED` controls the frontend independently of the backend
flag and DB capture. Its committed value is false. A known pending receipt keeps
using the admission status path after the frontend flag is disabled, and cannot
redirect into a legacy auto-start renderer. Unreadable retry metadata fails closed
rather than claiming there was no pending request; this storage-failure backout
behavior needs explicit rollout acceptance. The baseline/untracked compatibility
UX and whole-writer enforcement are not closed
by these browser changes. No deployed activation or coverage claim is made.

The reused Writing modal now rejects save/submit while its workspace is loading.
It clears only stale displayed text at entry, loads the assignment draft (or the
exact pending submission receipt) before expired-timer auto-submit, and ignores
late save callbacks from earlier modal generations. These guards are exercised
by real local Chromium with fixture auth/API; they do not prove live deployment,
Supabase SDK behavior or database enrollment.

### Owned expired-command recovery (migration 251)

The private `fn_reconcile_writing_admission` and authenticated POST
`/api/writing/my-assignments/{assignment_id}/admissions/{command_id}/reconcile`
allow recovery without a periodic fencer. The body accepts only `admission-v1`;
identity comes from the existing JWT/student/Writing-entitlement dependency and
the path. The RPC locks only the matching principal's Writing command, validates
current ownership with the existing nonlocking coherent getter, then compares
the immutable execution deadline with database time after lock waits. Only an
expired `accepted` command transitions to `unstarted_expired` with generation+1.
The marker and existing journal entry commit together. Early requests and already
bound/fenced commands return canonical state without mutation. No source timer,
lease, draft, episode, binding or enrollment changes here. This state describes
the command, not a failed/abandoned learner attempt; an existing bound episode
can outlive an expired resume command unchanged.

The browser sends one such request only following an execution HTTP 410. It does
not fence using its own clock, retry B in a loop, mint a new nonce or call legacy
start. A renderer-lease expiration with a still-live command returns accepted and
keeps the pending intent. A bound result recovers the canonical start. A confirmed
fence requires another explicit action to mint a replacement intent. Lost fence
ACK retains pending metadata; reload uses owned GET of the same command. Generic
transport failures remain uncertain and do not trigger this mutation. This closes
the local Writing stale-command recovery implementation, not the all-domain
operational deployment requirement. Backend recovery must remain available while
pending commands exist; turning both backend flags OFF is not a proven backout.

### Baseline compatibility (migration 252 and browser controller)

The owned read-only `/entry` endpoint classifies canonical source/provenance as
eligible, admitted, baseline-untracked, baseline-unclaimed, terminal or blocked.
This is a hint only. `/baseline-entry` revalidates ownership, source history and
renderer lease under the same nonce → scope → student → assignment → origin lock
order as preparation. It rejects any existing admission episode/binding for the
resource, including a prior owner's history, and any admission command using the
same nonce. A stale classification cannot authorize legacy `/start` fallback.

Baseline entry preserves drafts and the first persisted clock, creates no
episode/command/binding, and never retroactively enrolls old work. A mutex scope
may be created; it is not an eligible-start record. `allow_start` defaults false:
an unstarted baseline needs an explicit learner action. Resume cannot reset an
expired exercise timer or renew a renderer lease. The nonce guards crossing the
admission protocol; it is not a durable baseline admission receipt.

Self-review also found that old `start_assignment` could overwrite a competing
request's first clock using an earlier SELECT. Its timestamp UPDATE now includes
`started_at IS NULL`; a losing request reads and returns canonical state instead.
The route regression simulates that race and checks it emits no second start.
This is locally verified code, not a claim about deployed behavior.

The browser reads `/entry` before minting a fresh nonce. An unresolved known
command ID still recovers only through its status/reconcile protocol. For pending
metadata without a command ID, a baseline hint uses the same nonce with the
locked baseline RPC; only a confirmed response marks the metadata `kind=baseline`.
Lost ACKs and conflicts preserve the old pending identity. Baseline resume after
reload sends `allow_start=false`; a lost request that never started the source
requires another explicit action, using the same nonce. No error-driven legacy
`/start` fallback is added.

A fresh URL can read an already-started baseline and load its draft without
minting a nonce or performing a baseline start. An untouched clock needs an
explicit click. Canonical terminal entry without pending metadata refreshes the
list, not the editor. Invalid/blocked classification does not mint intent. An
expired baseline uses the existing draft-before-auto-submit guard. Confirmed
baseline metadata cannot be relabeled into prospective admission.

### Owned read-only nonce recovery (migration 253)

GET `/api/writing/my-assignments/{assignment_id}/admission-intents/{launch_nonce}`
recovers the original command before classifying a pending intent with no command
ID. The private STABLE SQL RPC uses the existing principal/protocol/nonce unique
index and canonical ownership-filtered getter. It requires the current owned
source, exposes no draft/content or stored nonce digest, and takes no row locks
or mutations. A valid owned absence is `{found:false,admission:null}`; permission,
source, transport and malformed-response errors are not converted to absence.
An absent read can race an in-flight A; subsequent preparation/baseline entry must
therefore retain the same nonce and its existing locked revalidation.

A found command is persisted before any execution and bypasses classification
and new preparation. Terminal source state returns to the existing completed-list
UI without executing B, even when the command remains accepted/fenced. Metadata
stays pending for accepted, fenced for expired, or complete for bound: source
completion never invents command success. The asynchronous operational reconciler
still owns later expiration of accepted commands; the read does not perform it.

### Separate backend recovery gate (local default OFF)

`CORE_ADMISSION_RECOVERY_ENABLED` is independent of the browser flag and permits
an explicit server recovery-only mode when `CORE_ADMISSION_LEDGER_ENABLED` is
false. Both server flags remain false by default. The same allowlist gate runs
at the HTTP route and again before RPC transport; clients cannot select its mode.

| Ledger | Recovery | Admission protocol behavior |
| --- | --- | --- |
| OFF | OFF | All admission RPC access disabled; not a safe pending-command rollback. |
| OFF | ON | Owned reads/nonce lookup, execution of existing commands, fencing, and baseline resume-only. New preparation and new baseline clock requests denied. |
| ON | OFF or ON | Existing validated admission and recovery paths enabled. |

Recovery-only execution can start a clock for an **already admitted** command;
SQL still validates its generation, deadline, ownership and source/binding. This
mode is not read-only and not a universal stop-writing switch. It cannot prepare
a new episode/command, and baseline entry requires literal `allow_start=false`.
An unknown nonce absent after a lost request cannot be prepared until admission
is restored. A baseline request with `allow_start=true` is denied even if the
source is already started; reload's resume-only request remains available.
Unmodified legacy `/start`, save and submit paths are outside this protocol gate.

The rollout/backout procedure must pre-enable and verify recovery access before
disabling new admission, retain compatible API/schema while pending commands
exist, account for in-flight requests and all instances, and verify DB capture/
epoch state separately. Flags are checked before dispatch, not a distributed
drain/barrier for transactions already in flight. Browser flag OFF alone cannot
discard saved pending metadata. N−1 clients without nonce lookup and storage-loss
cases still need explicit rollout acceptance; no safe-backout certificate is
claimed from this local flag implementation.

Local browser fixtures validate recovery behavior with mocked auth/API. After
explicit owner approval, a pinned temporary PostgREST container now verifies the
real service/REST/SQL path, including one FastAPI route chain with fixture-owned
learner identity/entitlement. Actual browser-to-PostgREST and hosted auth/gateway
verification remain open, as do retention/erasure and operational backout
acceptance. No deployed runtime flag has been changed; repository defaults remain OFF.

### Closed Writing cohort current-outcome read (migration 254)

`fn_read_writing_admission_cohort` is a private STABLE, content-free RPC for one
already-closed Writing epoch. Membership is selected by immutable first-admission
epoch, not later command activity epochs. It retains unbound episodes and missing
source rows. Source, current owner, origin, binding, command-phase counts, current
feedback view and grading-job metadata are read from one database snapshot.
Open/foreign/missing epochs are refused. The RPC does not rotate epochs, fence
commands, mutate learner data or persist a report. `snapshot_at` uses the clock
at reader entry, after any outer capture lock waits, and labels the read;
it is not a commit watermark or a replayable MVCC snapshot identifier.

`core_writing_cohort.py` reuses the canonical Writing outcome classifier and
produces disjoint state counts: success, failed, pending, unresumable, unstarted,
unstarted-expired or unknown. Success means a valid current persisted grading
result, not meeting an academic pass score. Failure means canonical grading
failure, not a learner's low score. A fenced unbound command is not abandonment.
Lost/deleted/reassigned source, invalidated provenance, broken binding and partial
current feedback remain counted as unknown. An expired lease for a bound,
unsubmitted source is unresumable, not abandoned. A failed regrade cannot erase
valid current feedback. Later source changes yield different current counts for
the same first-epoch membership; historical observer receipts are not consulted.

Safety limits refuse cohorts above 1,000 episodes instead of paginating snapshots
or certifying a truncated cohort. At most 1,001 analyze-job rows are read per essay;
overflow prevents a failure verdict that depends on full job history. Valid
current feedback does not depend on those old jobs. These are technical limits,
not new Gate F sample/acceptance thresholds. Larger cohorts require explicit
snapshot-preserving materialization. The three-second HTTP budget is not a proven
database pre-statement timeout. The local PostgREST fixture below verifies a
connection-role statement timeout, but the deployed version/configuration must
still be inspected, configured and verified before operational use.

The returned preview has `admitted_episode_count`, no learner IDs/content in the
summary, `coverage=unknown` and `gate_f=not_assessed`. It is not the all-domain
eligible denominator, a durable immutable report artifact or organic-release
evidence. Migration 255 adds separate durable persistence below; provenance,
retention/erasure and reporting for remaining domains still need
implementation/acceptance. No public route or UI
is added; access remains behind the default-OFF ledger/recovery gates.

### Private durable Writing report (migration 255)

The caller allocates and retains a report UUID before capture. A private SQL RPC
captures one closed cohort and stores the exact source JSON plus its server SHA256
digest. The Python classifier reads that stored snapshot, then finalizes one
immutable summary pinned to the same report ID and snapshot digest. A lost capture
or finalization response is recovered by reading the same ID; retries never
silently recapture newer learner state or overwrite a completed result. A new
snapshot requires a new report ID. Concurrent callers serialize on capture's
advisory lock and finalization's report-row lock.

New captures require the separate DB report control, default OFF, with a policy
digest. Reapplying the migration preserves that control. Capture OFF still allows
existing report reads/replay and finalization. Application recovery-only allows
get/finalize, not new capture. No public route, scheduler, provider call, product
mutation, backfill or automatic retention period is introduced.

Report tables are private with RLS and no direct service-role/learner grants;
only service-role RPC execution is granted. Stored source metadata includes
learner/resource identifiers but no essay text; the returned aggregate omits the
source snapshot. Capture rejects snapshots above 8 MiB rather than truncating.
Summary validation allows only fixed metadata and enumerated integer state/reason
counts that account for the entire captured cohort. SQL does not independently
recompute Python classification: the private classifier remains trusted.
`writing-current-v1` is a semantic profile, not verified release/traffic provenance.

The artifact remains `coverage=unknown`, `gate_f=not_assessed`. Retention and an
audited erasure/redaction mechanism are still required before activation: the
current guard rejects report deletion and prevents cascading source deletion
from silently erasing an artifact. The policy digest alone does not establish
approved retention or implemented erasure. Local REST/DB timeout evidence below
does not close deployed integration, operational timeouts or large-cohort
materialization. Direct-driver SQL and mock-transport tests remain separate
evidence and must not be presented as live REST integration.

### Local PostgREST integration checkpoint

`backend/tests/test_core_admission_postgrest.py` explicitly opts in with
`RUN_LOCAL_POSTGREST=1` and requires an already-running disposable PostgreSQL at
`127.0.0.1:55480/postgres` plus the already-downloaded official PostgREST v13.0.7
image pinned to digest
`sha256:0a46780309a604cdc8b56c776c6e5e15788ce58174d709e40459ab5a2d44d228`.
The test never starts Docker Desktop or pulls images itself. Normal test runs
skip this module unless explicitly opted in; required opt-in runs fail on a
missing runtime rather than count missing integration as a pass.

It creates a unique restricted login role, temporary private fixture schema,
ephemeral JWT secret and a read-only, capability-dropped container with no host
mounts and a loopback-only published port. Cleanup stops/removes that exact
container and removes the exact test role/schema. The loopback HTTP proxy changes
only `/rest/v1` to standalone PostgREST's root prefix and can discard a response
after an actual upstream commit. It does not mock RPC responses or claim to
reproduce Supabase's gateway API-key policies.

Twelve cases prove real prepare/execute/replay/nonce readback, committed A/B ACK
loss, private role isolation, invalid JWT and cross-owner rejection, durable
report capture/finalization ACK loss, capture OFF, and route-to-service-to-REST
recovery without timer reset. Authenticated learner identity and entitlement in
the FastAPI case are fixture-owned, not a live Supabase Auth sign-in. Product
dependencies use the existing isolated SQL fixture, not a full deployed schema.

The fixture's **750 ms test-only connection-role statement timeout** follows
[PostgREST transaction settings](https://docs.postgrest.org/en/v13/references/transactions.html#impersonated-role-settings).
One case holds the actual assignment lock and observes the waiting DB session;
the HTTP response is SQLSTATE 57014 while that lock is still held, with no
surviving scope/command. Another injects a test-only slow trigger after the actual
timer UPDATE and proves cancellation rolls back timer, binding and journal;
retrying the same command then succeeds. This is not a newly approved production
latency budget, nor proof that deployed PostgREST has the same version/settings.
Browser-to-REST, full schema/deployed parity, load and rollout remain unverified.

### Required slice verification and handoff

- HTTP/auth: same nonce replay, changed payload, cross-owner/assignment access,
  revoked permission, unsupported protocol and ambiguous A/B ACKs.
- Actual new SQL: concurrent prepares, scope allocation rollback, command conflict
  across scopes, B rollback after timer update, immutable initial timer, expired
  lease, submit racing start, and stale executor fencing before product mutation.
- Compatibility: baseline pending+draft, unknown start history, active old-client
  save/submit, N−1 start, recorder unavailable and explicit guarded-writer backout.
- Browser: nonce persisted only after a user action, account switch isolation,
  reload/readback without duplicate timer start, and no destructive fallback.
- Report: first-epoch membership versus later command activity, one disjoint
  current outcome per episode, baseline gaps, and unchanged receipt-only API.

The 5 prototype tests are inputs to this verification, not replacements for it.
Before rollout, settle retention/erasure and enforced-start availability policy
and close the domain's actual caller/trigger/privilege inventory. Local
implementation approval does not settle those policies. Remote schema application,
deployment and capture activation remain separately authorized actions.
