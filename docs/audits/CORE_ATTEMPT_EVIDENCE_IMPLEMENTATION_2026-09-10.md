# Core attempt evidence — implementation checkpoint

Status: **local foundation + request/background outcomes + Speaking launch retry + per-attempt inspection/result proofs + server correlation and opt-in browser retry hints + receipt-cohort aggregate, evidence disabled, NOT Gate F closure**.

Current review/next-work decision: the owner authorized the
[durable admission and reconciliation design](../CORE_ADMISSION_LEDGER_DESIGN.md)
and requested self-review in this session instead of waiting for an external
reviewer. Earlier sections saying a Claude round was pending describe historical
checkpoints, not a current wait or an external approval. The latest Listening
HTTP follow-up passed 1,474 backend tests; frontend remains at 9,175 tests.
This decision does not authorize remote rollout or capture activation.
Subsequent approval now covers local durable admission implementation, default
OFF; see [the separate ledger checkpoint](CORE_ADMISSION_IMPLEMENTATION_2026-09-10.md).
It does not turn this receipt-only implementation into complete admission coverage.
Latest combined backend verification: 1,559 tests / 64 files, zero skips, including
the admission foundation, Writing execute/status slice and design prototypes.
OpenAPI types were regenerated and TypeScript passed; frontend behavior remains
unchanged. Public preparation and prospective source enrollment remain incomplete.

User approved backend/frontend/schema implementation and local tests on a
separate branch. This does not authorize applying a remote migration, enabling
capture, production deployment, historical data repair, or legacy deletion.

## Implemented in this batch

- Migration 240 adds a private canonical-attempt registry and append-only
  observation receipts. It contains no backfill, triggers or product writes.
- The atomic RPC deduplicates a receipt replay by event UUID. A conflicting
  replay rejects the transaction, including any newly inserted registry row.
- `(surface, attempt_kind, canonical_attempt_id)` is the logical attempt identity.
  Speaking explicitly distinguishes a plain session from a full-test group:
  a client-supplied session UUID must not collide with a full_test_attempt_id.
  Other surfaces use `default`. Event and operation counts are never substitutes
  for attempt counts; composite FKs enforce both surface and namespace.
- A start failure before canonical creation can be recorded without inventing
  a learner attempt. A failed operation has no attempt-level outcome field.
- Late first observations stay `start_observed=false`; a later retry does not
  turn missing history into known exposure.
- The backend writer is OFF by default. Its async entry point has a 500ms
  deadline and isolates validation from learner requests. Receipts distinguish
  `disabled`, `recorded`, `unavailable`, `invalid` and `conflict`; the last two
  must not be transport-retried. Only the matching DB receipt means recorded.
  Exceptions and learner content are not logged or stored as error codes.
- Renderer, release and organic/synthetic attribution default to unknown.
  Browser headers, production hostname and provider mode are not proof of
  organic use. SQL grants prohibit browser reads/writes and RPC execution.
- Migration 256 (renumbered from the uncommitted 245 draft) adds a private read-only receipt-cohort aggregate. It exposes
  explicit unknown eligibility/coverage; it is not an all-admission denominator.

## Request integration checkpoint

The feature flag remains OFF. Enabled local tests now exercise the following
server-owned boundaries without changing endpoint signatures or response shapes:

| Surface | Integrated observations | Still missing for outcome certification |
| --- | --- | --- |
| Reading | Authenticated/share start, answer save, submit; persisted UPDATE return determines success/unknown; acknowledged start-over abandonment | Renderer claim events, other abandonment/expiry paths, remaining retry/recovery boundaries and coverage |
| Listening test | Start, answer save, submit; persisted UPDATE return determines success/unknown; acknowledged start-over abandonment; non-reveal practice checks as grade operations; opt-in Next practice start/check/submit retry hints | Renderer claims, remaining recovery boundaries, other abandonment/expiry paths and coverage |
| Dictation | Start/resume, sentence grade/save, submit; canonical completed attempt/report/answer snapshot; acknowledged old-parent abandonment before replacement | Old submissions without attempt IDs, other lifecycle/expiry boundaries and coverage |
| Speaking | Create/replay, optional atomic v4 receipt, learner response grading, admin response/session regrade and rebuild, submit/complete, grouped result after background finalization | Browser operation/retry correlation, remaining recovery/expiry paths and coverage |
| Writing | Explicit learner start/draft/submit; background grading/recovery; admin/instructor result revisions, grading admission and accepted regrade moderation, including acknowledged partial writes followed by exceptions | Lost acknowledgements/process exits, lifecycle/operation correlation, delivery/viewing distinction and coverage; native mock essays are outside the assignment identity |

Reading/Listening terminal writes produce an `outcome_observed` directly from
UPDATE RETURNING. Their `success` means a persisted graded result, not a passing IELTS score.
The saved question IDs must match the loaded answer key exactly, verdicts must
be boolean and their sum must match the saved score. Legitimate low-score NULL
band estimates are not flagged as missing. This does not independently certify
that the authored test itself has the right content or number of questions.
Other successful HTTP operations are recorded as operations, NOT assumed final outcomes.
Sealed mock responses remain opaque; no scores enter the private receipt either.

Submit/finalize and integrated grade operations for Speaking/Dictation/Writing also read
canonical metadata and append a separate outcome receipt with the same operation
UUID. Reading/Listening also retain separate operation-success and outcome facts.
Independent receipts run concurrently, not serially, within a combined 500ms
request budget including canonical reads. A lost or timed-out receipt remains a coverage gap. Failed
HTTP operations never become a terminal attempt failure merely because of their
HTTP status, and are not replaced with a previously successful result.

Canonical outcome readers use one embedded PostgREST SELECT per attempt, rather
than application-side joins across changing snapshots. Projection relationships
are checked against repository schema; fake-client unit tests do NOT constitute
a live PostgREST embedding/latency verification. That remains required before
activation. No learner text, answers, audio, feedback body, email or auth token
is selected or persisted by this reader.

- Speaking full tests require exactly three owned parts, one full-test/sitting
  identity, 9/1/5 questions with exact graded-response coverage, finite saved
  bands and timezone-aware completion timestamps. Plain practice sessions retain
  the existing answered-subset behavior. `analysis_failed` is explicit failure;
  mixed/incomplete or malformed results remain unknown. The background hook
  executes after all canonical completion/recovery writes.
- Dictation requires the completed parent, its unique matching report, and
  exactly the original snapshot's sentence count/index range with valid saved
  scores. Migration 220's guard checks report/answer consistency; the existing
  route separately enforces whole-section submission. Neither is assumed to
  prove the other: migration 240 adds a private read-only computed count so the
  observer checks the snapshot's length without fetching learner-facing content.
  A low score is not an operational failure.
- Writing requires the assignment-to-essay/owner link, unflagged/non-deleted
  essay, current feedback version and valid saved band. Failed regrades preserve
  a prior valid result. A first-grade failure needs a terminal analyze job and
  no queued/running retry; tied job timestamps are unknown. Background hooks
  read after status/version/job writes. Background assignment fanout uses at
  most four concurrent observations with individual 500ms budgets and a bounded
  overall deadline, not one shared 500ms serial loop. A superseded successful
  worker discards its result before any feedback write. Superseded failure paths
  may still reach the independent snapshot, without claiming they changed the
  canonical result. Stuck-job recovery now uses the post-sweep batch below;
  normal admin/instructor delivery/version-selection returns now have hooks;
  the remaining lifecycle paths are listed below.

These observations certify neither learner-visible delivery nor the numerical
correctness of aggregate grading. Regrades and out-of-order event arrival still
require canonical readback. The per-attempt inspection API below provides a
bounded diagnostic readback; an aggregate eligibility report remains open.

## Speaking grade/regrade/rebuild boundaries — local implementation

The learner response endpoint binds only after session ownership, active-player
eligibility and question membership checks. Its saved `_stub: true` response is
an explicit operation failure, despite HTTP 200: the audio/transcript is saved,
but the AI grade is unavailable. The response body is unchanged. Provider error
messages, transcripts and scores never enter evidence. Hard HTTP failures remain
operation failures without an inferred attempt outcome.

The admin response regrade, session regrade and rebuild endpoints bind only after
admin authentication/resource validation; a multi-part rebuild additionally
validates shared owner, full-test identity and P1/P2/P3 membership. Full-test
parts bind their canonical group ID, never a new attempt per part or admin call.
Admin authority is not proof of organic learner traffic: attribution stays unknown.

After a normally returned grade/regrade/rebuild, the canonical outcome snapshot
is independent from the operation result. A successful single-response regrade
remains `operation_succeeded` when other responses are still bad; the whole-
attempt snapshot can separately be failed/unknown. A partially failed session
regrade/rebuild is `operation_failed`, not success inferred from top-level HTTP
200 or `ok`. The existing rebuild frontend partitions `result.sessions` using
each row's `ok`, not the outer `ok`; this established response contract stays
unchanged. Previously noted local exam verdicts are suppressed on soft failure.

The snapshot now preserves its triggering operation (`grade`, `submit` or
`finalize`) alongside the shared operation UUID. Background defaults remain
`finalize`. Unsupported operation values fail before querying the database.
`grading_failed`, already written by admin repair paths, is recognized as a
current failed Speaking outcome instead of an unrecognized state. It is not an
irreversible verdict: later repair appends another canonical observation.

No grading formula, source-row repair, session aggregate write, scoring policy,
HTTP signature or public payload was changed by these hooks. Reads add existing
full-test/renderer metadata (renderer schema migration 215), not columns from
unapplied 240/241. Live schema/embedding verification remains a rollout precondition.

Tests exercise actual routes with fake DB/auth/AI/storage, including the entire
learner endpoint's failed-grade save with evidence enabled/disabled, admin write-
before-read ordering, auth denial, full-test group identity, recoverable soft
failure, and privacy. Assertions about observation ordering are made outside the
observer mock so the fail-open wrapper cannot swallow a failing assertion.
The preliminary AST return-branch test was removed after full endpoint coverage
was added; no duplicated source-fragment harness remains. OpenAPI-generated
TypeScript stayed byte-identical.

Claude's first code-only review found no release-blocking defect but correctly
identified the single-response/sibling-failure distinction, which was fixed.
It also prompted suppression of local exam verdicts after soft failure. A proposed
rebuild response-shape change was rejected after checking the actual frontend
consumer; a proposed primary-row fallback was unnecessary because preceding
404/membership validation guarantees the row. No internal documentation or
learner data was sent to Claude.

Claude's second review returned **No confirmed blocking regressions**. After
that review only the redundant AST test was removed; runtime code was unchanged.
Each graded response now adds a bounded whole-attempt snapshot read, so the
per-session read multiplier must be included in live latency/pooling/load checks
before activation. A 500ms timeout alone is not a load/performance certificate.

Final verification after review: **672 combined backend tests passed**, no skips,
including required PostgreSQL migration tests and five-flow regressions; **9,121
frontend tests passed**, no skips. OpenAPI types stayed byte-identical. Frozen
Gate E v21 preflight, static cutover inventory and whitespace checks passed.
The local PostgreSQL cluster was stopped afterward. The initial 673 count included
the subsequently removed duplicate AST test; it is not the final suite count.
No commit/push, remote schema application, capture activation, deployment or
Gate E rerun occurred. Broader coverage/attribution/admin report and remaining
lifecycle hooks are still required before Gate F can be certified.

Start/save/submit auth or ownership failures before binding do not fabricate
attempt records. Request contexts contain only IDs and allowlisted metadata, not
answers, student/user IDs, tokens or request bodies. Concurrent contexts are
isolated; recorder failures preserve the endpoint's original result/exception.

Writing's current admin transition matrix forbids reopening submitted/terminal
assignments. An assignment ID therefore represents this workflow, not a newly
invented per-lease attempt. If that business contract changes, attempt identity
must be revisited before using this evidence for a denominator.

## Writing stuck-job recovery — local implementation

The reaper collects unique essay IDs after a committed requeue, including when
subsequent scheduling fails, and before a best-effort terminal failure write.
Only after all recovery attempts does it read canonical outcomes. Summary
`failed`/`requeued` counters are not persisted outcome evidence: restoring a
previously delivered result can correctly produce a success snapshot even when
the regrade job exhausted its retries. A newer worker may already have changed
the result; these snapshots make no claim about which worker caused it.

The observer validates UUIDs, deduplicates and uses at most four essay workers
under a shared two-second async observation budget. Invalid IDs, item errors or
timeouts produce static warnings without IDs, exception details or learner
content. Evidence disabled means no validation/read work. Cancellation is
propagated, with siblings cancelled and drained; local tests cover child,
external and repeated external cancellation before event-loop shutdown.

Recovery writes in the current sweep finish before observations begin. The
serialized reaper loop still waits for the observation phase before its next
sleep/sweep. The budget does not bound arbitrary synchronous validation work or
uncooperative I/O cleanup. Each essay can itself fan out four assignment reads,
so the combined maximum of sixteen inner reads requires live load/pooling
verification before activation. Deadline omissions and sorted-ID selection are
coverage gaps, not representative sampling or a continuous coverage claim.
Completed helper calls are not receipt counts; warnings and summary counters
cannot reconstruct the set of recorded observations.

Claude reviewed the four-file code/test delta only and found no blocking defect
in the batch primitive. Follow-ups corrected the sweep-latency comment and added
true external/repeated cancellation tests (the original test covered child
cancellation only). Shielded detached work was not added. Deployment config pins
Python 3.12 (`.python-version`, `backend/nixpacks.toml`); local tests run Python
3.11. Both support `asyncio.timeout`, but this is not a deployment-runtime test.

Focused verification after review: **165 tests passed**, no skips, across
canonical outcomes, essay service and regrade resilience. Integration tests run
the actual reaper, batch observer and canonical classifier with fake DB writes:
requeue is pending, exhausted first grading fails, and preserved prior delivery
remains successful. Product API payloads and grading/retry policy are unchanged.
At this reaper checkpoint, delivery/version-selection hooks, operation
correlation, attribution, the admin report and coverage accounting remained
open; the subsequent admin/instructor batch below extends these hooks. No capture activation or remote
database change is part of this checkpoint.

Combined verification of this checkpoint: **687 backend tests passed**, no skips,
including PostgreSQL-required migration and five-flow regressions. Frozen Gate E
v21 preflight, static Next cutover inventory and whitespace checks passed. The
frontend suite was not rerun for this backend-only delta; its preceding result
is 9,121 passed. These checks do not restart Gate E or certify Gate F.

## Writing admin/instructor result revisions — local implementation

Canonical snapshots now follow normal returns from admin feedback edits,
single/bulk delivery and revoke, instructor composition/delivery/revoke, and
admin instructor-queue delivery. Authentication/ownership and mutation guards
stay before observation; service write order and HTTP payloads are unchanged.
The composition is selected via the existing `current_version` pointer and
`writing_feedback_current` view, not the legacy admin-edit overlay.

Bulk delivery records only confirmed successful items, deduplicated, after all
attempted writes. A later item's database exception still leaves earlier
commits in place, so a `finally` snapshot covers those prior successful IDs and
preserves the original product exception. An all-skipped/rejected batch does
not read evidence. The existing bounded batch observer is reused; evidence
read/record outages remain fail-open and the OFF flag makes no evidence queries.

These are `outcome_observed` snapshots under `finalize`, not successful-delivery
events. Both a reviewed/revoked essay and a delivered essay can have valid saved
feedback. The student detail route separately requires essay status `delivered`
before fetching `writing_feedback_current`; none of these hooks proves the
student received/rendered/read that feedback. The report must keep persistence,
release and actual viewing distinct. No delivery state was added to the ledger.

At that normal-return checkpoint, partial commits before a multi-write single-item
exception were not covered; the following partial-write batch addresses known
acknowledged writes. Accepted regrade moderation is covered by the later batch below; native mock Writing
publication is outside the assignment identity, as qualified below. These do not
become certified coverage merely because normal returns have snapshots. No
workflow causality, organic traffic, retry deduplication or complete denominator
is claimed. Each observed HTTP response can incur the shared async observation
budget; live latency/load verification is required before activation.

Local integration tests call the actual routes, batch observer and classifier
with fake product writes/metadata reads. They verify current-version/status read
after writes and mock/review synchronization, seven single-item paths, bulk
partial success/error, auth and instructor ownership denial, rejected/all-skipped
delivery, feature-OFF and evidence outages. Assertions are outside the fail-open
observer so it cannot swallow test failures. The focused combined suite passed
**291 tests** with no skips; generated OpenAPI TypeScript remained byte-identical.

Claude's code-only review found no confirmed blocking regression and raised
several points for validation. The suspected return-shape mismatch is not a
runtime bug: `instructor_workflow.deliver` returns an `InstructorReview` with
`essay_id`. New tests call that real service from both routes with fake database
writes, with capture ON/OFF, rather than relying on a `SimpleNamespace` mock.
The metadata fake now matches the actual table and essay/assignment filters.
Admin revoke's real helper already synchronizes the review after the essay
write; normal reads observe the resulting `reviewed` state. Batch concurrency
and deadlines are covered by the separate outcome tests, not just the new route
test file. Latency remains an activation precondition, not an unmeasured SLO pass.

The review also exposed a narrower real cancellation defect: cancelling an
assignment child made its inner `gather` raise without stopping siblings. The
new nested-worker regression failed with three active descendants before
event-loop teardown. External cancellation and deadline cases already passed;
they were not falsely labelled broken. The inner fanout now explicitly cancels
and drains its own children as well as the outer essay workers. All three cases
and the real delivery-service follow-ups pass (**121 focused tests**). Normal
cancellation still propagates; no detached/shielded writes were introduced.

Final combined local verification after these follow-ups: **908 backend tests
passed**, no skips, including required PostgreSQL migrations and the five-flow
regressions. Frozen v21 preflight, static Next inventory and whitespace checks
passed; the disposable PostgreSQL cluster was stopped. No frontend source changed
in this batch, so its earlier 9,121-test result is not a newly run result. No
commit/push, remote schema apply, evidence activation, deployment or Gate E rerun.

The focused cleanup diff received a second Claude review. Its claimed test/code
mismatch was checked against the call chain: the batch invokes the real
`observe_writing_background`, whose assignment fanout is the changed code.
The original deadline case covered the OUTER budget; this is now supplemented
by explicit INNER expiry and inner expiry DURING sibling cleanup. The test
matrix passes all **10 cases** (five cancellation/deadline modes, four/eight
assignment rows). Tracked task handles include semaphore waiters and must all
be done before event-loop teardown; waits have a local timeout. Under these
cooperative async paths the additional orphan hypothesis was not reproduced,
so no speculative TaskGroup/shield rewrite was applied. A child that ignores
cancellation indefinitely is outside the bounded-async-work guarantee and
remains a limitation, not something these tests certify. Propagating cancellation
rather than suppressing `BaseException` preserves the existing observer contract.
Only tests/documentation changed after the 908-test combined run; the runtime
fix was unchanged. The follow-up test expansion was not sent for a third review.

## Writing acknowledged partial-write failures — local implementation

Six existing admin/instructor routes now have an error-only, request-local
observation scope: admin feedback edit/revoke, instructor compose/revoke/deliver,
and admin instructor-queue deliver. Existing normal-return hooks remain unchanged;
the new scope emits no additional snapshot on normal returns. No new endpoint,
public payload, transaction, grading policy or source-row repair was introduced.

Synchronous write paths contribute only essay IDs after a write returns:
composed-feedback update/insert, a validated claimed-review delivery write (or
authorized identical persisted replay), and essay revoke before review sync.
They do not perform network observation themselves. On a subsequent ordinary
exception, the scope reads canonical state via the existing bounded batch helper
and re-raises the original exception. Auth/ownership denial or failure before any
acknowledged step yields no candidate and no evidence read. These IDs are read
candidates, not proof of affected-row count, end-to-end success or causality.

In particular, a feedback INSERT followed by failure to advance `current_version`
must read the old current version, not the newly inserted unselected row. A later
badge/status failure can leave the new version current. Review delivery can fail
after its review row changes but before the essay or prompt stamp changes. All
these states are read independently; valid prior feedback remains a successful
persistence snapshot even when the admin operation failed. No operation-success
receipt or learner-visible-delivery claim is synthesized from those snapshots.

ContextVar scopes isolate requests, restore parent scopes and deactivate before
observation/exit so an inherited late task cannot append afterward. Candidate IDs
are normalized/deduplicated with a 200-ID memory cap and static-only warnings;
the current six endpoints are single-essay operations. Disabled capture bypasses
the scope, normal exceptions from the observer cannot replace the product error,
and cancellation still propagates without starting a new error-path observation.

Tests exercise actual feedback composition and instructor delivery services on
fake databases, injecting errors before INSERT, on pointer/badge updates, on the
review/essay/stamp writes and on revoke synchronization. They assert canonical
readback, unchanged exceptions, no duplicate normal snapshots, feature-OFF,
privacy, nested/concurrent scope isolation and refusal of late candidates.
Generated OpenAPI types remain byte-identical. A test fixture originally kept
its default overall band 6 while expecting 7; the input was corrected explicitly,
not the product grading code.

This remains best-effort observation, not an outbox: a write that commits but
loses its acknowledgement, process termination, cancellation, receipt outage or
invalid identity can still leave a gap. At this partial-write checkpoint regrade moderation,
durable logical-operation correlation, coverage reconciliation and the admin
report remain required. No capture activation or remote migration was performed.

Scope revalidation removed a false-positive assignment-integration item: native
mock Writing promotion (`mock_exam_service._promote_writing_essays`) creates essay
rows with `sitting_id` and links them through `mock_exam_sittings.essay_task1_id` /
`essay_task2_id`. Its `create_essay_row_only` helper inserts no assignment, and the
promotion path does not create one afterward. Therefore native mock publication
cannot be counted as a missing `writing_assignment` receipt simply because it
shares the essay service. The observer must emit nothing when no assignment is
linked; a regression test fixes that boundary. This is not proof of mock-result
correctness or permission to exclude any real linked assignment. A broader mock
outcome profile would need its own sitting/task identity, not invented assignment
rows or a silently changed five-flow denominator.

Claude reviewed only the code/test delta. Validated follow-ups add a decoration-
time async-function guard, exact exception type/identity assertions, positive
static-warning assertions, and inspection of the canonical metadata consumed by
the classifier (including old band/version versus the unselected inserted row).
No score was added to receipt kwargs. The cancellation-during-observation test
confirms cancellation propagates with the original product failure retained as
exception context; ordinary observer failures still preserve the original raised
product exception. The focused post-review suite passed **154 tests**, no skips.

Other review suggestions were qualified against the actual source:

- New-file absolute names were a `git diff --no-index` transport artifact; the
  modules reside under `backend/services` and imports/API generation pass.
- All six routes are async and call the marked synchronous services inline.
  No detached executor write or thread-safe collector contract is introduced;
  future thread offloading needs separate lifecycle/isolation verification.
- The batch helper already sorts UUIDs; set iteration does not determine final
  observation order. Event order still does not establish causality.
- Auth/ownership denial and exactly-one normal snapshot already have integration
  tests. Real service tests verify the validated review replay/claim boundaries,
  and revoke markers follow essay writes before review synchronization.
- Single admin `mark_delivered` uses one atomic delivery RPC, not the multi-write
  instructor flow. Lost RPC acknowledgements remain explicitly unobserved.
- Arbitrary exception names/payloads were not added to logs; static warnings do
  not provide coverage accounting. The ID cap is a safety bound, not a volume
  metric or a promise about unbounded future call sites.

No final clean approval is implied: the follow-up guard/tests were verified
locally, not sent for another Claude round. At this checkpoint regrade/start-grading
admission and moderation remained open; the following batch covers those hooks.
Report/correlation/coverage work and live activation prerequisites remain open;
this checkpoint closes only the identified acknowledged partial
write paths.

Final verification after the review follow-ups: **941 combined backend tests
passed**, no skips, with PostgreSQL migration tests required. OpenAPI generation
remains byte-identical; frozen v21 preflight, static cutover inventory and
whitespace checks pass. The disposable PostgreSQL cluster stopped successfully.
No frontend changes or new frontend-suite claim, no commit/push, remote migration,
evidence activation, deployment, learner-data repair or Gate E restart.

## Writing grading admission and moderation — local implementation

Normal-return snapshots and acknowledged partial-write scopes now cover admin
start-grading/regrade and instructor regrade. The pending-essay claim marks its
ID only after a nonempty guarded UPDATE return; losing the claim does not create
evidence. Regrade marks after its existing status write returns. Job scheduling
also marks after a nonempty INSERT acknowledgement, before ETA/response building.
Later job/enqueue failures therefore trigger independent canonical readback.
Grading tasks are only scheduled in tests, never run against real AI.

An essay in `grading` remains a `pending` outcome even if job creation failed.
This is not a queued-job or grade-success certificate. The source workflow can
leave that status after a failed subsequent job INSERT; this batch observes it,
does not add a rollback, create a replacement job or repair learner data. A
future canonical report must flag missing/stalled jobs separately. Existing
prior versions and regrade `restore_status` payloads are preserved.

Accepted regrade moderation uses migration 205's existing atomic RPC. After its
successful matching request-row identity is validated, the essay ID is marked
before `_decorate` performs response enrichment; an enrichment exception cannot
hide that acknowledged change. A normal accept also reads the canonical essay
after enrichment. Rejecting a request does not change the essay and does not
become a failed attempt or new result snapshot. Invalid/rejected/mismatched RPC
responses do not invent an identity; lost acknowledgements remain a gap.

Tests exercise actual claim/job services with fake DB writes and cover status-
write errors, job INSERT errors, enqueue errors, lost claims, unchanged prior
feedback, restore metadata, feature ON/OFF, moderation accept/reject, formatter
failure, RPC failure/rejection/identity mismatch, and auth denial. The combined
suite passed **1,015 backend tests**, no skips, with local PostgreSQL required.
The disposable cluster stopped; frozen v21 preflight/static inventory and
whitespace checks pass. No Gate E restart, remote migration or activation.

OpenAPI checking found only two description changes: stale comments incorrectly
said regrading deleted feedback. Source descriptions and their generated
`frontend/types/api.d.ts` comments now describe the existing version-preserving
behavior. Generated output matches exactly; request/response types are unchanged.
No frontend runtime or learner-facing UI changed in this batch.

Claude reviewed the code/test delta. The accepted-moderation decision now follows
the RPC request row's `status == 'accepted'`, not the requested action. Added tests
cover differing intent/result, invalid/missing essay IDs, and evidence outages
across all new surfaces. UUID validation in the existing marker/batch primitives
rejects bad IDs before retaining/querying them; no new 500 or fallback identity
was introduced. The post-review focused suite passed **116 tests**, no skips.

Review assumptions were checked against unchanged source: the source paths are
real `backend/...` files (the absolute no-index header was a review transport
artifact); imports resolve; both regrade routes persist `restore_status` through
`schedule_grading_job`, whose INSERT error is translated to HTTP 500. Admin's
status-write errors are also translated, while the pending claim/instructor
status-write errors propagate as before. Existing/new auth and exact-one receipt
assertions cover the four routes. Scope markers do no work in callers without a
partial-write scope, so adding a marker to the shared scheduler does not silently
activate collection on unrelated routes.

The pending-on-regrade semantic concern does not justify changing the outcome
contract: `grading` is a not-yet-finalized lifecycle snapshot, even while an older
feedback row remains stored. The current learner detail route only serves that
feedback when essay status is `delivered`. Evidence is append-only, not a
last-write-wins overwrite of the prior success receipt; report consumers still
need canonical readback and must distinguish version persistence/availability
from active regrading. No historical success receipt or feedback row is erased.
The accepted-state follow-up was tested locally, not sent for another Claude
round; this is not an unconditional final approval or a coverage certificate.

Final combined verification after these follow-ups: **1,045 backend tests passed**,
no skips, including PostgreSQL-required migrations. Generated API output matches
the checked-in types exactly (description-only changes versus the prior file).
Whitespace, frozen v21 preflight and static cutover checks passed. PostgreSQL
test shutdown succeeded. No commit/push, remote schema apply, capture activation,
deploy, learner-data repair or Gate E rerun occurred. Frontend runtime tests were
not rerun for this backend/generated-comment batch.

## Admin per-attempt inspection — local implementation

`GET /admin/core-attempt-evidence/{surface}/{canonical_attempt_id}` is a mounted,
read-only API behind the existing authenticated admin-role guard. Speaking must
explicitly select `attempt_kind=speaking_session` or `speaking_full_test`; the
other four surfaces require `default`. Responses use `Cache-Control: no-store`.
There is no admin dashboard UI or aggregate eligible-attempt counter in this
batch. The response contract is `core-attempt-inspection-v1`.

Migration **242** adds a private invoker RPC which aggregates all stored receipts
for exactly one composite identity in one statement snapshot. The response has
fixed-size receipt/outcome/renderer/traffic partitions and release completeness
counts, not a paginated event dump. SQL aggregation does not inherit a client's
1,000-row result cap. Missing registry is `not_observed`; query/schema failure is
`unavailable`, never a fabricated zero. A late start still cannot upgrade the
registry's immutable first-observation flag. Unbound pre-create failures are
not attributed to an arbitrary canonical attempt. Insert timestamps are not
commit-order watermarks; in-flight receipts remain invisible until commit.

Canonical readback is a **separate snapshot**, not atomically joined to history.
The API exposes read start/finish bounds and this separation explicitly. It
does not derive current outcome or causal regression from the latest receipt.
Previously failed regrades can coexist with a currently valid prior result.
Speaking/Dictation/Writing reuse the existing metadata classifiers, not learner
answer/feedback bodies. A submitted Reading/Listening row without a matching
submission-result proof remains `unknown / exam_result_readback_not_verified`.
Its original outcome receipt alone is not a current result certificate. The
follow-up migration 243 below enables privacy-preserving proof readback without
substituting today's editable test for the question set observed at submission.

The migration also provides an invoker-only computed Writing job summary from
the same embedded essay snapshot. Its total and active-analyze counts support
`writing_grading_without_active_job` without mistaking a truncated embedded job
list for an empty queue. This is an inspection warning, not a failed attempt or
proof of a stalled worker. A job may be inserted after the read. Terminal job
failure is not certified from a truncated job history; a known active retry
remains pending. No retry/restore or learner data is changed by this endpoint.

`coverage=unknown`, `eligibility=not_assessed`, and `gate_f=not_assessed` remain
explicit even when canonical outcome is success. The capture flag is identified
as **this instance's current configuration**, not fleet uptime or historical
coverage. Attribution counts are receipts with recorded labels, not an organic
volume certificate. No scores, learner IDs, event bodies, answers or auth data
are returned in this diagnostic response. Canonical attempt IDs remain private
pseudonymous join keys, not anonymous data.

Independent Claude review was attempted for the six-file code-only diff, but
the CLI returned a **session usage limit** before providing a review. No review
or approval is claimed for this batch or its subsequent SQL job-summary fix.
Local verification is recorded below; live PostgREST discovery/embedding,
privileges against the deployed schema, query plans and latency remain rollout
prerequisites. Migration 242 is local only, neither applied nor activated.

Final local verification for this batch: **1,102 combined backend tests passed**,
no skips, with PostgreSQL required. New tests cover actual admin-role denial,
namespace isolation, independent read outages, malformed summaries, cancellation
and deadlines, restored Writing results, incomplete job history, actual SQL role
ACLs, 1,100+ event/job rows, migration rerun and uncommitted-receipt visibility.
The temporary PostgreSQL instance was stopped successfully. Generated OpenAPI
types match exactly; TypeScript `--noEmit --incremental false`, frozen v21
preflight, static cutover and whitespace checks passed. No frontend runtime test
rerun is claimed for this backend/generated-contract batch. No commit/push,
remote migration, deploy, capture activation or Gate E restart occurred.

## Reading/Listening submission-result proofs — local implementation

Root cause: the persisted `grading_details` contains submission-time verdicts,
but does not independently record whether they cover the entire answer key the
submit route actually loaded. The earlier outcome receipt checks that coverage
from UPDATE RETURNING, but contains only an outcome label. Treating its newest
label as current truth would miss a later result change; reloading the editable
test would instead invalidate legitimate historical results after content edits.

Migration **243** adds an append-only private result-proof table, an invoker-only
recorder, and private computed readback for both attempt types. It does not alter
learner tables, install triggers, backfill existing attempts or activate capture.
The request observer copies only validated metadata from the acknowledged UPDATE
return: canonical attempt identity, submission timestamp, saved score/band, and
question-number/boolean-verdict pairs. Expected question numbers come from the
then-loaded server answer key, not the browser. Local strict validation and the
SQL recorder both reject missing/duplicate/mismatched question sets, inconsistent
scores, invalid timestamps and content-bearing extra fields.

The database stores only a SHA-256 digest plus canonical identity, surface and
receipt identity/time; no expected answers, learner answers, feedback text or
raw scores are added to the private table. This digest is a **pseudonymous
consistency witness, not anonymization**, and remains subject to the pending
retention/erasure approval. It is not an organic-use label or an eligibility row.
The same server normalization computes submission proofs and current readback,
normalizing JSON key/question order, equivalent numeric representations and
timezone spelling. Replaying the same proof does not create another proof row.
Canonical identity and surface are isolated; earlier witnesses are not rewritten.

The inspector reads source status and the computed proof check in the same
statement snapshot. It returns success only for a structurally consistent
submitted result matching a saved witness. Missing witness stays unverified;
inconsistent persisted metadata remains unknown with `exam_state_incomplete`.
Changing the saved verdict composition, score/band or submission timestamp
cannot reuse the old witness. Restoring the same prior validated result can
match its retained witness. This is a **result-persistence/completeness check**,
not proof that the authored answers, explanations, numerical band conversion
or learner-visible result delivery are pedagogically correct. Answer/feedback
content is intentionally outside the fingerprint and never fetched by this API.

The writer joins the existing combined 500ms observation budget only after a
normally returned, owned/authorized successful submit. Proof failure, timeout,
schema absence and malformed receipts do not replace the learner response or
roll back the grading write. Hard/soft errors after a saved note do not mint a
normal-completion proof. A lost UPDATE acknowledgement can leave a successfully
saved attempt without a witness; this gap stays explicit. Sealed mock responses
remain opaque. Both capture flags are still OFF; there is no requirement for an
existing learner to redo an old attempt and no historical data is repaired.

Independent Claude review is still pending the session quota reset reported in
the previous batch; no approval for migration 243 is claimed. Local verification
does not replace live PostgREST computed-field discovery, service-role grants,
query-plan/latency/load checks, or remote apply/deploy/capture authorization.

Final local verification: **1,190 combined backend tests passed**, no skips,
with PostgreSQL required and stopped successfully afterwards. Tests cover the
actual submit routes and graders for both skills (including sealed mocks),
before-write failure, lost acknowledgement, unauthorized ownership, capture OFF,
proof outage/deadline, metadata stripping, strict local/SQL rejection, low-score
NULL bands, equivalent numeric/timezone representations, exact proof replay,
identity/surface isolation, changed result rejection, retained prior proofs,
private ACLs and source/proof transaction visibility. A first route-fixture run
failed because the fixture used a string rather than Reading's answer object
and expected 404 instead of the existing 403; the fixture was corrected from
source evidence, without modifying the product's grader or ownership contract.
Assertions about write-before-proof ordering run outside the fail-open writer
so assertion failures cannot be swallowed into an apparently passing test.
Generated OpenAPI types remain identical; frozen v21, static cutover and
whitespace checks pass. No frontend runtime change or new frontend test run is
claimed. Migration 243 remains unapplied remotely; no commit, push or deploy.

## Server retry-hint correlation — local implementation

The existing server operation UUID is still fresh per observation. It is not
replaced with `X-Request-ID` or a browser-supplied value. An optional
`X-Core-Operation-ID` UUID is now scoped through the existing HTTP middleware;
missing, malformed or duplicate values are ignored without changing the learner
response. CORS permits this header under the existing origin/method policy.
The header is not authentication, renderer/release attribution, organic-use
evidence, or a command to make an operation idempotent.

Sixteen existing JSON-based endpoints explicitly declare which parsed body,
path and query fields participate in a fingerprint. The declaration rejects
auth/capability/request objects and unknown parameter names at import time;
endpoint signatures remain unchanged. Body fingerprinting sorts object keys,
preserves array order, and never consumes multipart/file streams. Only the hash
is retained in the observer context. It is scoped with a hash of the canonical
owner only **after** existing route authorization/ownership and attempt binding.
Narrow Writing-start and Dictation-replay projections use the already validated
student/user identity rather than guessing an owner. Unrecognized/missing owner
metadata leaves correlation unavailable. Anonymous capabilities are never saved
as plaintext; unrecognized historical capability shapes remain uncorrelated.

Migration **244** stores append-only correlations between a server operation
UUID, canonical attempt scope, client hint and server fingerprint. The recorder
is private, bounded within the existing combined observation budget and runs
outside the learner transaction. An exact replay is idempotent; a conflicting
fact set cannot overwrite the old row. Recorder errors do not replace either
the original successful response or its original exception. No business write,
score, assignment state or historical event is changed by this correlation.
Fingerprints remain pseudonymous derivatives, not anonymization; retention and
erasure approval is still required before activation. Fingerprinting itself is
synchronous and is not a proof of acceptable total overhead on large payloads.

The new private v2 history RPC preserves the v1 RPC for older deployments and
adds correlation groups in the **same history statement snapshot**. It matches
operation UUID, operation kind, surface, attempt kind and canonical identity,
not a UUID alone. Correlation rows without a matching event are not counted as
observed operations. Event rows without correlation stay explicitly uncorrelated.
Operation and outcome receipts sharing a server operation do not double-count
that observed operation. Grouping the same client hint with different server
fingerprints produces separate groups and a multiple-fingerprint diagnostic.
That diagnostic does not establish why fingerprints differ: input, owner,
endpoint name/defaults or a later protocol change can all affect them.

These are **observed-operation and client-input-group counts**, not an eligible
attempt denominator, all HTTP request volume or certified logical-intent volume.
Background operations are included in observed receipts; those without client
hints remain uncorrelated. Distinct canonical attempts created by repeated
Reading/Listening starts are not hidden or merged by a hint. Global coverage,
eligibility and Gate F status remain unknown/not-assessed regardless of these
counts. A successful response alone cannot prove that both independent receipts
arrived; out-of-order and missing evidence remain possible.

The opt-in browser integrations below persist/send hints for selected native
call sites. The audio/capability follow-up adds a content-aware Speaking
fingerprint at the existing authorized upload-read boundary; it is not hashed
from a random multipart boundary or inferred from question ID alone.
Pre-insert failures without a canonical owner/attempt, legacy callers and
admin/background operations are not falsely labeled as correlated learner
actions. Both capture flags remain OFF; no runtime capture is activated here.

Independent Claude review remains pending its reported session quota reset.
Migration 244 and its v2 RPC require separate remote apply/deploy permission and
live privacy/privilege, query-plan, latency/pooling/load verification. This local
batch does not certify durable browser retry correlation or Gate F completion.

Local verification for this server-correlation batch (2026-09-10):

- **1,231 combined backend tests passed**, no skips, with PostgreSQL required.
  Includes migrations 240–244, actual route/middleware correlation, canonical
  owner isolation, CORS, replay conflicts, missing evidence and role privileges.
- TypeScript `--noEmit --incremental false`: passed. Generated OpenAPI types
  match `frontend/types/api.d.ts` byte-for-byte.
- Frozen Gate E v21 preflight, static Next cutover inventory and staged/unstaged
  whitespace checks: passed. These are not a new Gate E streak or live E2E run.
- The disposable local PostgreSQL cluster was stopped after verification.
  No staging/production database, deployment or learner data was changed.
- No new full frontend regression or Claude approval is claimed for this batch.

## Browser operation correlation — local opt-in integration

The native Reading and Listening test start/save/submit handlers, Writing draft
and start handlers, Dictation start/sentence-save handlers, and Speaking full-test
finalize bridge now use a shared **optional** observation transport. Speaking
creation, Writing submission and Dictation submission forward their existing
durable receipt UUID instead of introducing competing business idempotency keys.
No learner API body, authorization, timeout, abort signal or keepalive policy is
changed; no transport request is coalesced or retried by the helper.

`AVER_CORE_OPERATION_CORRELATION_ENABLED=true` is a new public build opt-in.
The generator and committed runtime config default to **false**. A missing flag
also means OFF. Only a literal boolean true in generated config activates hints;
no staging/production setting has been changed. Backend CORS must be deployed
first, and privacy/load/retention verification and separate approval remain
prerequisites. This flag is not trusted for backend attribution or eligibility.

For the generic transport, sessionStorage retains a versioned pending UUID and
SHA-256 input fingerprint per account/method/path/question slot. Account UUIDs
are namespaced keys; paths, answers, essay text, anonymous capabilities, bearer
tokens and passwords are not retained by this new helper. These are still
pseudonymous records, not anonymized data. Existing business receipts retain
their pre-existing payload/reconciliation contracts; this patch does not broaden
their stored content.

Same pending input reuses its hint after retry/reload; changed input, explicit
replacement of a resumable test, or an acknowledged response produces a new
hint. Out-of-order acknowledgements compare the exact stored pending record
before clearing, so an old request cannot remove newer input. AuthProvider
clears other-account authenticated hints on account transitions and authenticated
hints on logout (capability-owned anonymous hints are separate, as below);
late acknowledgements cannot resurrect cleared records. Tombstones precede
best-effort removal so a removal-only error does not replay an acknowledged ID.

The helper invokes the existing transport **synchronously before any await**,
including pagehide/keepalive calls. SHA-256 is synchronous, bounded to 262,144
UTF-16 code units of serialized input, and tested against independent Node
crypto vectors (Unicode, padding boundaries, random inputs, maximum size).
The limit applies only to observation metadata, not accepted learner work.
Unsupported/oversize input, unavailable crypto/storage or failed persistence
omits the hint and sends the original learner request normally. No real-browser
mobile performance or backend pooling/load claim follows from local unit tests.

Acknowledgements use each endpoint's response contract; Speaking finalize's
`accepted` response means background admission, **not grading completion**.
Listening submit has an empty HTTP body, so the browser also fingerprints its
local answer snapshot; changing answers cannot reuse the previous submit hint.
Server-side correlation still fingerprints the declared route inputs, not a
transactional snapshot of Listening answers. Changes from another tab are not
proven by this local fingerprint.

Remaining correlation limits after the audio/capability follow-up below:

- Anonymous Reading uses a separate hashed capability scope, not a logged-in
  account. First-start lost replies can still create distinct canonical attempts;
  a shared hint never makes those starts business-idempotent.
- Speaking upload/completion and mock Reading/Listening domain collection are
  wired in the follow-up below. Result-page recovery and other legacy/background/
  admin callers remain outside this browser helper. Native mock Writing is still
  outside the assignment identity; parent mock receipts are not core attempts.
- Dictation sentence retries recompute elapsed/listen metrics in existing code.
  Different metric payloads form different fingerprint groups; these are not
  yet certified as one semantic retry. Existing submission receipts ARE reused.
- Tab duplication can clone sessionStorage pending IDs. Account switching,
  logout, tab closure/storage deletion, and total acknowledgement-storage
  failure limit durable correlation. If both tombstone and cleanup fail, an old
  pending hint can survive reload. No perfect logical-intent count is claimed.
- Result-page recovery, definitive-rejection/new-intent policy across remaining
  callers, renderer/release/organic attribution, coverage and the aggregate
  admin report still require closure. Header groups never merge canonical
  attempts or replace the eligible-attempt denominator.

Browser-batch verification (2026-09-10): **9,145 frontend tests passed**, no
failures/skips, using the same complete `.test.mjs`/`.test.js` inventory as CI.
The 23 new focused tests include extracted actual native handlers (not copied
implementations), synchronous keepalive dispatch, reload retry, changed input,
old acknowledgements, account cleanup, existing Writing/Dictation receipts,
anonymous capability preservation and failed flush. The generator test verifies
strict opt-in and byte-identical unconfigured output. TypeScript
`--noEmit --incremental false`, frozen Gate E v21 preflight, static Next route
inventory and whitespace checks passed. The earlier **1,231 backend tests** are
a separate server checkpoint, not a newly rerun backend count. Real-browser
E2E, mobile performance, independent Claude review and live rollout remain
unverified at this earlier checkpoint; no independent approval was claimed.
No commit/push, remote migration or capture activation.

## Audio, anonymous capability and mock collection follow-up — local only

Speaking uploads now prepare a SHA-256 of the existing in-memory audio before
the native adapter calls the original multipart transport. Preparation waits at
most 500ms; unsupported audio, unavailable WebCrypto or timeout sends the original
upload once without a hint. Late digest completion cannot write storage or send
a second upload. Flag OFF invokes the transport synchronously without reading
the blob. The existing submission controller still owns ordering, failed-reply
reconciliation and the blob; this change does **not** persist audio across reload.
Re-providing identical audio can reuse a pending hint; recovering lost audio is
not implemented. Browser fingerprints include filename and MIME, so renaming a
file may conservatively split hint groups even when the bytes match.
Direct upload replies acknowledge the hint. The existing controller's later
GET-based reconciliation is outside that helper: it can recover a saved response
while the optional hint remains pending. Closing that observation lifecycle
must preserve the current retake/version ambiguity checks, not infer audio
identity from a response row ID alone.

On the backend, existing session/question ownership, quota, single file read and
size guards precede hashing. The owned-session projection now includes `user_id`
so owner scoping is available; its existing user filter is unchanged. Only the
digest of authorized bytes plus canonical session/question IDs, resolved extension
and MIME is retained in observation state. Filename prefixes, multipart boundaries
and raw audio are not stored in receipts. The separate off-loop hash wait adds up
to 500ms before the existing receipt budget; local tests do not establish acceptable
staging latency, memory use or load. Capture remains OFF.

The native Speaking adapter supplies an additive `complete` method. The three
shared practice completion call sites use it only when present, otherwise keeping
the existing legacy PATCH. The completion response must match the session and
completed status before a hint is acknowledged. Its bodyless fingerprint does
not certify a transactional version of all graded responses or other-tab edits.
`api.uploadWith` accepts optional headers as a fourth argument; existing three-
argument calls, no-redirect policy, abort signal and multipart content type remain
unchanged. No global API interception is introduced.

Anonymous Reading start/save/submit use the same capability snapshot for both
the unchanged access header and a separate hashed storage namespace. Neither
capability nor share token is stored as plaintext by the new helper. The first
start without a capability uses a hashed share scope; the backend still owns
capability minting and canonical attempt identity. Auth transitions intentionally
do not erase these capability-owned receipts. Changing capability partitions the
scope; unavailable/malformed capability on save/submit omits correlation.
Anonymous records remain pseudonymous and subject to the tab's storage lifecycle,
not a retention/erasure policy or proof of organic use.

Mock Reading/Listening collection preserves the order: flush embedded answers,
submit the canonical domain attempt, then record the parent mock section receipt.
The domain hint is acknowledged only after both steps succeed. A parent-receipt
failure retains the domain hint for retry without inventing a parent core identity.
The parent call's body and headers are unchanged. Native mock Writing remains
outside this integration; no assignment is synthesized for it.

Local verification: **9,157 frontend tests passed**, no failures/skips, and
**1,239 combined backend tests passed**, no skips, with PostgreSQL required.
The two initially failing answer-sheet tests omitted the newly extracted real
completion helper; the harness now includes that helper without weakening the
double-click or rejection/retry assertions. Actual-handler tests cover anonymous
reload/account transitions, mock domain/parent ordering, Speaking adapter remount,
audio retries, timeout and optional multipart headers. These are fixture-backed
tests, not browser E2E or production observations. The disposable PostgreSQL
cluster stopped after the run. TypeScript, byte-identical OpenAPI generation,
frozen Gate E v21 preflight and static Next inventory also passed. An additional
**45 focused backend tests passed** after extending MIME-versus-extension
fingerprint assertions. A code-only Claude review of this follow-up is
complete; the review-fix verification below supersedes this frontend count.
No remote changes or Gate E restart.

### Audio/capability review disposition

Claude reviewed the bounded code-only follow-up, without tools, documents,
unchanged source, learner data or secrets. It identified a confirmed per-session
upload-key collision: a pending Q1 upload could be overwritten by Q2 before Q1
retried. The transport now passes `slot: input.question_id`. A regression test
failed before the fix and passes afterward, including independent retries after
helper recreation and Q2 acknowledgement preserving Q1's pending hint.

The shared completion adapter is now async, preserving immediate invocation but
turning synchronous adapter throws into rejected promises. A reproduced test
shows that all three completion calls can reach their error handlers instead
of the first throw aborting the loop. This is a defensive adapter-boundary fix,
not evidence that the normal `api.patchWith` currently throws synchronously or
that a production learner lost completion. Existing double-click protection and
legacy transport assertions pass unchanged.

Other findings were validated against local source rather than applied blindly:

- Reading `_gen_anon_id()` uses `secrets.token_urlsafe(24)`, producing the admitted
  32-character URL-safe capability shape. A backend test now calls that actual
  generator. The share-start endpoint is anonymous-only and always returns
  `anon_id` on success; it is not a password-authenticated branch. Acknowledgement
  is not weakened to accept a missing capability.
- When a resumable attempt exists, the start button explicitly confirms its
  abandonment/replacement. The error action reboots state, not blindly re-POSTs;
  mock auto-entry resumes an existing attempt. Rotating the hint for a confirmed
  replacement is intentional. Neither this behavior nor a hint makes repeated
  start requests idempotent or proves one semantic intent across reloads.
- `_emit` requires a non-null scoped digest before writing correlation. Rejected
  sizes/unsupported formats/hash failure do not create a null-digest group.
- The added session owner projection feeds only owner hashing, not a new response
  field. The controller has no pre-existing `complete` method to shadow. The
  completion/mock response shapes match current endpoints, and TypeScript checks
  the actual `MockExamRunner` user binding.
- The local Speaking upload path has no keepalive/pagehide auto-upload; its
  beforeunload handler warns about unsaved work. Client and server size limits are
  both 50 MiB. Additional allocation, executor contention and latency remain
  deployment prerequisites, not a reason to invent an unmeasured inline-hash
  threshold. Hash-error logs remain deliberately generic; they do not establish
  coverage or diagnose an outage by themselves.
- The installed Python timeout implementation checks cancellation counts before
  converting its own cancellation to TimeoutError; external cancellation is not
  generically caught. Existing cancellation tests pass. No speculative swallowing
  or retry of a cancelled learner request was added.

A second, narrow code-only review confirmed the two targeted fixes. Its extra
session-collision claims were checked against the omitted dependency: the actual
storage key includes account plus the hash of **method, path and slot**, and the
path includes session ID. The transport never coalesces or skips business sends.
New actual-helper/bridge tests prove same-question uploads across two sessions
and pending completions across two parts stay independent, including one ACK
not erasing the other. No redundant composite slot or behavior change was made.
The review's claim that the pre-fix early Q1/Q2 assertions would pass is also
contradicted by the recorded failing test (first retry assertion failed before
the slot fix). Capability tests now retain deterministic alphabet fixtures and
assert exact SHA-256 output as well as exercising the real mint. These additional
tests were locally checked, not sent for a third review. This narrow second review
does not approve migrations 242–244 or the full cumulative batch.

Final post-fix local verification: **9,159 frontend tests passed** with zero
failures/skips; **1,239 combined backend tests passed** with PostgreSQL required
and zero skips. TypeScript, frozen Gate E v21 preflight, static Next inventory
and whitespace checks passed. The backend run includes the real anonymous mint
and MIME fingerprint tests; the temporary database was stopped afterward.
The final exact-hash/deterministic-alphabet test extension was additionally
verified by **23 focused backend tests**, all passed without skips.

## Reading/Listening start-over abandonment — local implementation

**Root cause / severity:** Medium, an evidence-completeness gap, not an observed
student mutation failure. `reading_student._abandon_open_attempts`,
`start_shared_reading_test_attempt`, and `listening.start_listening_test_attempt`
already commit the old attempt's `abandoned` status before creating a new attempt.
Their new observer only bound the newly created attempt (or recorded an unbound
creation failure). Consequently that operation could leave no abandonment receipt
for the old canonical attempt, although the learner-facing update was correct.

The three call sites now pass the existing UPDATE response to
`core_attempt_observation.note_abandoned_exam_attempts`. The helper runs only in
an admitted, enabled Reading/Listening start context. It validates the returned
canonical ID, test ID, owner/capability, abandoned status and renderer before
retaining only the old attempt UUID/renderer. It adds no pre-read, source write,
query filter, learner retry or extra update. User/share credentials and answers
are never retained in observation state. Empty RETURNING is not inferred from a
pre-read; unavailable/malformed responses stay an explicit logged evidence gap.

At request exit, up to four workers record the confirmed old outcomes in parallel
with the existing new-start/creation-failure observation, within the **same 500ms
combined receipt budget**. A later creation error or invalid new-attempt binding
must not turn an acknowledged old abandonment into a nonexistent event. A later
retry with unavailable RETURNING data does not erase already verified old IDs.
The in-memory bound is 100 distinct old IDs; an invalid or over-bound return batch
is not partially accepted and no unbounded task list is created. This bound is
not proof that a large/repeated start operation had complete coverage.

Old outcome receipts share the server start-operation UUID but keep their own
canonical IDs and `start_observed=false`. They do not fabricate an initial start,
new attempt or client-input correlation. In particular, the new attempt's hint
must never be joined to an old abandonment merely because the operation UUID
matches. The existing full-scope history join is tested on real local PostgreSQL.
These remain historical observations, not claims that the old row can never
change afterward, nor proof of terminal abandonment on TTL expiry.

Final verification after review fixes: **1,285 combined backend tests passed**, PostgreSQL required,
zero skips; actual three-route tests cover capture ON/OFF, failure after old
UPDATE, denied access, failed UPDATE, different owner/test and already-submitted
rows. Unit tests cover invalid/missing return data, repeated returns, metadata
privacy, preserving earlier verified rows, bounded fanout, timeout and cancellation.
Eight PostgreSQL scope-isolation/concurrency cases pass: old abandoned attempts
never borrow the new attempt's correlation, including when creation failed,
with one or three old IDs and with/without previously recorded starts.
Frozen Gate E v21 preflight, static Next inventory and whitespace checks passed.
OpenAPI byte identity passed at the preceding checkpoint; no endpoint
signature, response or frontend runtime changed in the failure-isolation fix.
The disposable PostgreSQL cluster stopped after the final suite. Capture flags
remain OFF; no commit/push, remote schema change or deployment occurred.
The full follow-up code/test review process ended at its 240-second timeout
without a verdict. A narrower code-only retry completed and confirmed sibling
isolation for ordinary errors. It returned other findings, locally dispositioned
below rather than treated as blanket approval. That retry reviewed only the
observer and PostgreSQL test diffs, not the whole cumulative branch or the new
route-fake test file. Diagnostic-label and test-strengthening changes after that
review are locally verified, not a third independent verdict.
No frontend runtime changed in this batch; the prior 9,159-test frontend result
is a separate checkpoint, not a newly rerun suite.

### Start-over review dispositions

- **Confirmed, Medium (evidence loss, not product-write loss):** an unexpected
  exception escaping either top-level emitter caused `TaskGroup` to cancel the
  sibling's pending receipt. Two new tests reproduced both directions before
  the patch (2 failed / 33 passed). Each emitter now catches ordinary exceptions
  independently inside the task group. Timeout and request cancellation still
  cancel and drain both branches; no shielding or detached task is introduced.
  Three actual-route tests also preserve the exact original insert exception.
- **Fixed diagnostic gap:** the incomplete-return marker was write-only. It now
  emits one coarse request-exit warning with surface and server operation UUID,
  not raw rows, owner/capability, answers or exception text. The UUID is a
  pseudonymous diagnostic link, not anonymous data or durable coverage proof.
  Invalid batches still cannot erase earlier acknowledged old IDs.
- Follow-up diagnostics now distinguish operation, abandonment, boundary and
  actual shared-deadline failures using static component labels. An inner
  `TimeoutError` is not automatically labeled as expiration of the outer
  budget. These logs count recorder incidents, never attempts or a success rate.
- **Concurrency claim disproven by schema and real PostgreSQL tests:** event
  rows are keyed by event UUID, not operation UUID. Multiple receipts already
  ran concurrently in `_emit`; the operation summary uses `DISTINCT`, not a
  shared operation-row insertion. Old-abandonment workers never call migration
  244's separate correlation writer. Expanded tests run simultaneous old/new
  writes, with one or three old IDs and with/without prior start receipts.
  Each canonical history stays separate; the unbound failure is verified in
  the event table and cannot gain a correlation.
- `start_observed=false` on an abandonment receipt means the recorder is not
  asserting an initial start at that boundary; it does not deny the canonical
  row exists. Tests now cover both a previously recorded start and a late first
  observation, preserving the registry's original flag.
- Review's Python-test absence was an excerpt limitation: the separate new
  route-fake/unit file exercises validation, capture OFF, exceptions and drain.
  Source validation confirms required imports, writers catching `Exception`
  rather than `BaseException`, and no `_emit` dependency on context-variable
  reassignment. Batch-atomic validation is intentional: preserve earlier known
  batches but reject a malformed return set; do not assert or raise caller
  wiring errors into learner requests.
- Both old and new outcomes matter; no contract makes one strictly more
  valuable. The four-worker bound/shared budget remain, with no completeness
  or load guarantee. Recorder contention/latency is a rollout verification
  requirement, not solved by serializing and starving old outcomes.
- **Not a demonstrated defect:** empty UPDATE RETURNING may mean no matching
  old attempt. The pinned `postgrest==2.28.3` sync builder defaults to
  `return=representation`; `database.py` and all three callers do not override
  that preference. Keep empty as no observed abandonment, not invented error
  or asserted complete coverage. Missing/malformed data remains a gap; deployed
  PostgREST response/role/latency verification is still required before capture.
- **Contract-backed exclusions:** Reading/Listening use `attempt_kind=default`
  by migration 240 and `EvidenceEvent`, so inheriting arbitrary kinds would
  violate the schema. IDs here are strings from route/PostgREST JSON; accepting
  arbitrary UUID-object inputs is not required by these callers. Renderer is
  attribution under a closed schema enum, not cosmetic; invalid values are not
  silently downgraded. Failed validation rejects that batch rather than making
  unsupported evidence claims.
- Receipt order remains nondeterministic; a shared operation can affect several
  canonical attempts. The full-scope join, not arrival time or operation ID
  alone, controls correlation. This request observer awaits its bounded emission
  before returning; it is not an after-response durable task.

### Aggregate-contract audit carried forward

Source inspection confirms `_emit` and `observe_persisted_outcome` do not supply
`traffic_class` or `release_id`; `EvidenceEvent` therefore defaults to `unknown`
and null. There is no server-owned organic/synthetic classifier in this pipeline.
The optional browser hint is neither such a classifier nor a trusted frontend
release assertion. Enabling capture alone cannot supply the missing eligibility
or release-attribution evidence. Per-attempt counts also cannot prove collection
continuity or count admissions that never obtained a canonical ID exactly once.

The next aggregate must keep canonical attempts, unbound admitted failures,
transport operations and receipts distinct; include unknown/incomplete partitions;
and reconcile all five surfaces with independent coverage/attribution sources.
Master-plan §12.3/§16 and ADR-013 A1/A2 still require reconciliation before any
PASS calculation. No new numeric floor, historical backfill, organic inference,
time-window restart or risk waiver is introduced by this implementation.

### Dictation old-parent abandonment — local implementation

`listening.start_dictation_attempt` has a distinct acknowledged-write gap:
after an owned latest-parent read and `admit_start()`, an unresumable old parent
is updated from `in_progress` to `abandoned` before section-content loading and
new insertion. Previously, binding observed only the new or concurrently created
attempt. An exception loading content can occur after the old update but before
creation. **Severity: Medium — missing operational evidence, not lost answers.**

The route now passes its existing UPDATE response to
`note_abandoned_dictation_attempt`. In an admitted Dictation start context only,
the helper validates exactly one returned parent against its expected ID,
owner, test, integer section and abandoned status. It keeps only UUID/renderer,
uses the existing bounded isolated old-attempt emitter and never rebinds the
new attempt. Empty RETURNING does not use the pre-read as proof; missing,
multiple, invalid or conflicting returned rows set the existing gap marker.
Neither predicate, business write, creation retry nor learner payload changes.
The GET resume lookup remains read-only, and active POST resume emits no new
start or abandonment. Saved answers are preserved on every tested path.

Final verification after review fixes: **1,336 combined backend tests passed**,
55 files with local PostgreSQL required and zero skips. The 43 new Dictation cases execute actual
routes and helpers, covering capture ON/OFF, active resume, missing expiry,
content/insert/update failure, conditional-update race, duplicate-insert recovery
and failed reconciliation, denied auth/unpublished test, exact return scope,
deduplication and content-free metadata. Eight extra actual PostgreSQL cases
verify Dictation old/new canonical/correlation isolation, including concurrent
receipt writes and previously observed versus unknown starts. PostgreSQL was
stopped afterward. OpenAPI regenerated byte-identically; frozen Gate E v21
preflight, static Next cutover inventory and whitespace checks pass unchanged.
Code/test-only Claude review completed for this focused batch. It did not
inspect unchanged source, deployment or the cumulative branch. Review-driven
fixes and additional tests below are locally verified, not a second independent
verdict. Capture remains OFF and no commit/push, remote migration, activation or
deployment occurred.

The previously verified Reading/Listening checkpoint was staged locally before
this batch to isolate its review diff. Dictation changes remain local; unrelated
`.gitignore` edits were not staged or changed.

Review dispositions:

- An UPDATE exception can mean an uncommitted failure **or** a committed write
  whose acknowledgement was lost. The route now calls the observer in `finally`
  with no returned rows on exception, marking an explicit diagnostic gap while
  preserving the original business exception. Both pre-commit and post-commit
  failures are tested; neither fabricates an abandoned receipt. Earlier absence
  of a receipt was already unknown coverage, not a certified zero, but the
  request-specific warning makes the uncertainty visible.
- A real configured sync-client request-builder test pins
  `Prefer: return=representation` without executing a network call. `[]` remains
  no acknowledged old row; positive affected-row count is not requested by this
  route and no count-only/pre-read inference is introduced. Live PostgREST
  response and latency verification remains required before activation.
- Tests now assert the gap flag stays false on valid actual-route returns,
  reaches the request-exit warning on failed UPDATE, and rejects malformed
  argument UUIDs, nonpositive/bool sections and non-list responses. A failed
  old evidence receipt cannot break new creation or be counted as saved.
- Source validation resolves the review's missing-context questions: only
  `_Observation`/None populate the private context; `admit_start` precedes the
  UPDATE; UUID test identity is migration 220's FK, not a display slug; Dictation
  has `default` kind by migration 240; retry recovery uses the owned
  user/test/section/in-progress lookup. Missing expiry already fails closed in
  the unchanged lifecycle helper, so its test adds no business expiration rule.
- Missing/NULL renderer is unknown attribution, not a claim of a known renderer
  or complete metadata. No arbitrary driver/context type is accepted merely to
  silence a hypothetical error. Validation gaps are consumed by the shared
  request-exit logger; they are not silent or a durable coverage ledger.

This is not permission to infer abandonment from every expired clock:
`active_player_lifecycle.require_resume_active` rejects mutation without
rewriting the historical row; `writing_student._effective_writing_renderer`
clears only an expired lease in the returned view, preserving assignment/draft
identity for later resume. Treat those as separate lifecycle/availability facts,
not terminal failed/abandoned attempts. Missing expiry also fails closed, so
the Dictation branch does not by itself prove a valid TTL elapsed. The proposed
receipt records an acknowledged abandoned status, not an inferred cause.

## Receipt-cohort aggregate — local implementation

The [versioned aggregate contract](../CORE_ATTEMPT_AGGREGATE_CONTRACT.md)
preserves the full Gate F requirement and defines this diagnostic component.
`GET /admin/core-attempt-evidence?window_start=...&window_end=...` reads exactly
six surface/kind streams through migration 256's private SQL RPC. Speaking
session/full-test namespaces remain separate even for identical canonical UUIDs.

The single-statement snapshot counts distinct canonical identities, scoped
operations, unbound start failures and receipts separately. Outcome-history
sets deliberately overlap; mixed and missing outcomes are explicit. The report
does not infer current canonical outcomes, first exposure, organic learner
volume or an exact all-eligible denominator. Capture OFF still permits reading
old history. Unknown eligibility and missing-source reasons cannot become a
passing percentage merely because the SQL read succeeded.

Window boundaries are half-open receipt ingestion times with a 31-day query
limit (not a soak threshold). PostgreSQL tests demonstrate late commits can
enter the same requested window after an earlier read; this is not a commit
watermark or coverage certificate. Existing migration 240 window/attempt
indexes support selection; no learner table write, event rewrite, new capture
flag or database backfill is added.

The new route uses the existing verified-token/DB-role admin guard, sanitizes
its errors at this boundary and sends `no-store`. Invalid timezone/range shapes
are rejected before the aggregate query; the database clock resolves an omitted
cutoff and rejects future windows. Requested and resolved windows stay separate,
so clock skew cannot silently change the request. Unavailable or malformed RPCs
yield no summary, not zero counts: window rejection/size failures are HTTP 422,
other read failures HTTP 503, with allowlisted reason codes only.
Strict result validation checks
surface/kind completeness, timestamps, window equality, integer counts and
partition invariants. The two-second async read deadline cancels/drains client
work; it is not proof that PostgreSQL cancels server execution or a live load
certificate. Pre-activation role/schema/pooling/latency checks remain required.

Local verification after aggregate review fixes: **1,421 backend tests passed** across 57 files, PostgreSQL
required and zero skips; **9,159 frontend tests passed**, zero skips; TypeScript
passed after generated API types were refreshed. Cases cover >1,000 events,
replay, changed outcomes, old/new operation fanout, unbound failures, namespaces,
receipt attributes, half-open windows, late commit, browser-role denial,
read-only execution, invalid payloads, sanitized auth errors and cancellation.
Frozen Gate E v21 preflight/static Next inventory and whitespace checks pass.
The disposable PostgreSQL cluster stopped afterward. The first code/test-only
Claude review completed for the new SQL, service, route delta and tests;
documents, generated API types and unchanged source were not sent. Validated
follow-ups now implement classified unavailable reasons/request-window echo,
DB-authoritative default cutoff, migration dependency/stream-drift guards,
non-overridable scope/coverage caveats and sanitized 401/403 guard details.
Installed PostgREST RPC client tests with mock HTTP transport verify scalar JSON,
array rejection and structured/malformed errors. A 100,000-receipt query ceiling
rejects oversized selections without partial counts; actual PostgreSQL tests
cover both exact limit and limit+1. This bounds aggregate input cardinality, not
physical scan cost or elapsed server execution; staging timeout/index/load
verification remains open. The second code/test-only Claude review completed
with **Approve with changes**. Follow-ups below are locally verified, not a
subsequent independent verdict. No Gate F PASS is claimed.
No remote migration/activation, commit/push or deploy occurred.

Second-review disposition:

- Dedicated application SQLSTATEs (`ZC001` size, `ZC002` unsupported stream,
  `ZC003` invalid window) now distinguish these conditions from generic database
  failures; an unrelated `54000` no longer tells an admin to shrink the window.
- Failure handling clears a previously prepared summary defensively. A test
  injects context-exit failure; it does not establish the proposed real
  `asyncio.timeout` race, because normal exit has no suspension after parsing.
- Request-validation errors for the private inspection/aggregate router now
  redact the supplied value and set `no-store`, including errors before auth.
  OpenAPI documents actual 422/503 report/error unions and includes computed
  missing-evidence reasons in response schemas, not an input-only schema.
- Both axes of namespace drift, exact end-window echo, contract/snapshot
  literals, dedicated/generic error codes, single RPC signature, NOT NULL start
  flag and a rejected unbound non-start operation are verified. The exact
  31-day test uses 744 elapsed hours to avoid DST-dependent fixture arithmetic.
- The unbound operation dimensionality allegation is not a reachable defect:
  migration 240 restricts unbound receipts to `start` failures. A subsequent
  bound observation of the same operation is correctly present in both scoped
  history sets, not an extra canonical attempt; an actual PG test covers this.
- `Count` already rejects booleans; the registry start flag is NOT NULL; replay
  uses the event UUID primary key. Do not weaken strict validation or turn a
  missing start flag into a known historical value to accommodate these false
  positives. Existing 240 tests execute the actual schema and immutable receipts.
- Server cancellation can arise from deployed settings/admin cancellation even
  without a producer in this patch; `query_cancelled` is a valid diagnostic,
  not proof that this function configures a timeout. Rollout verification and
  coverage/eligibility sources remain separate requirements.

Initial false-positive validation: the enum/text-join objection does not apply
because migration 240 uses `TEXT + CHECK` and the PostgreSQL fixture executes
that actual migration. Browser roles, non-null operation IDs, namespace checks,
window/attempt indexes and module-scoped local fixtures were confirmed in
source/tests. A disposable PostgreSQL execution probe disproved a function-local
`statement_timeout` guarantee: a function setting 5ms completed its 50ms sleep
in 57.52ms; setting 5ms before a separate control statement cancelled that
statement as expected. The temporary function vanished on disconnect and the
cluster stopped. No ineffective function-local timeout or global role change
was added. A real deployed pre-statement timeout remains a rollout check.

## Listening practice check — local implementation and race remediation

`check_listening_practice_answer` now uses the existing opt-in `grade` operation
observer, binding only after auth and ownership verification, and only for
non-reveal checks. Correct and incorrect learner answers can both produce a
successful grade operation; neither is a terminal attempt verdict or a new
attempt. Ordinary rechecks (including page-restore checks) are operations, not
claims that each request inserted a new canonical answer. Reveal, successful or
refused, performs no evidence mutation/correlation. The existing request budget,
metadata stripping, cancellation and fail-open recorder boundary are reused.
All 17 decorated JSON routes retain their original FastAPI signatures.

Two source/contract issues were validated and minimally patched in this route:

1. **Medium: `FALSE` does not prove a rival answer exists.** The unchanged
   migration-224 `fn_insert_listening_answer_once` initially reads the active
   attempt, then conditionally updates it. Finalization between those steps can
   make the UPDATE affect no row and return FALSE while the answers remain
   empty. The old caller's reread then had no `prior` but returned HTTP 200 with
   `canonical_correct=false`. The caller now returns a recoverable 409 when its
   existing reread cannot verify that first answer, instead of inventing a
   canonical verdict. A genuine rival answer remains a successful recheck.
2. **Medium: truthiness accepted malformed RPC acknowledgements.** `bool(wrote)`
   accepted strings/integers/containers as write results. The route now accepts
   only actual booleans after its existing NULL rejection; unknown shapes give
   a sanitized 503. Installed synchronous PostgREST client tests verify JSON
   true/false/null retain their intended Python types. No SQL type/contract was
   changed. These two correctness guards also apply with capture OFF.

Verification: **1,469 combined backend tests passed** across 59 files with local
PostgreSQL required and no skips; **9,159 frontend tests passed**, no skips;
TypeScript passed and generated OpenAPI types are byte-identical. The 48 new
cases include actual HTTP routing, first-wrong/then-right/reveal/submit without
score inflation, auth/ownership/expiry rejection, write failure and lost ACK,
grading failure after a successful write, client return shapes, explicit hint
correlation, raw-content exclusion, and recorder failure isolation. Real PG
tests execute the unchanged 224 function body against a minimal isolated table,
wait for observed row-lock overlap, and reproduce both FALSE/rival-answer and
FALSE/finalization-without-answer. They do not certify the whole migration-224
schema/rollout. The disposable cluster was stopped afterward. Frozen Gate E v21
preflight, static Next inventory and whitespace checks pass; no Gate E rerun.

Independent review is **pending**: Claude was invoked with the 22,762-character
practice-only code/test diff, no documents or unchanged source. It exited at its
session limit without a verdict (reported reset 22:10 Asia/Saigon). No attempt
was made to bypass that limit. Flag-OFF and HTTP regression cases were added
after this attempted review and also require independent review. This is not
covered by the earlier aggregate review's verdict.

Frontend inspection confirmed the existing Next/legacy check-error paths do not
apply a success result after a non-2xx response; Next retains the submitted
answer for retry. No frontend runtime or grading formula was changed here.
The subsequent browser integration is described below; server hint support by
itself does not certify logical intent. The remaining admission/attribution/
coverage and rollout requirements below stay open. Capture stays OFF; no new
migration, commit/push, deployment, live data repair or legacy deletion occurred
in this backend batch.

## Next Listening practice retry hints — local browser integration

`practice-run-player.tsx` now supplies optional account/path/input-scoped hints
for start, ordinary answer checks (including stored-answer restoration), and
submit through the unchanged authenticated `api.postWith` helper. Checks use
separate question slots: identical pending input keeps its hint across retry
and reload, while changed input or an acknowledged check rotates it. Reveal
does not send or consume an answer-submission hint. Only opaque IDs/digests are
stored by the shared transport, not raw learner answers or revealed solutions.
The digests are comparison metadata, not encryption or anonymization.

Existing response normalizers still guard the learner state outside best-effort
metadata handling. Malformed, wrong-question or answer-leaking responses cannot
become a verdict or clear pending metadata. A valid wrong-answer check is still
an acknowledged grade operation; it does not mean the learner passed. Existing
start/submit single-flight and owner-GET reconciliation remain unchanged: an
uncertain start is not blindly retried; only a valid submit summary clears its
hint. A canonical GET can settle the UI without proving which POST caused that
state. Submit comparison uses question IDs, not an immutable answer snapshot.
Hints remain observational, not an idempotency guarantee or coverage certificate.

Verification: **9,175 frontend tests passed**, no skips; TypeScript passed.
Sixteen new tests execute callbacks extracted from the actual TSX and the real
transport/normalizers, covering account/attempt/question separation, malformed
ACKs, storage denial, flag OFF, cancellation, single-flight, late ACK after auth
cleanup, and retained exact pending input. The existing source-order assertion
now checks the moved start call; behavioral tests also prove resume-before-POST.
The strengthened UI error test verifies the checker actually ran, so a missing
callback caught by the UI cannot create a false-positive passing test.

The actual Next dev route and API helper passed fixture-only browser checks:
**15/15 with flag OFF**, **20/20 with `--operation-hints`**, including lost start,
check and submit ACKs, changed-answer/reveal separation, canonical first-answer
score, reload restoration, signed-out handling and a 375px mobile fallback.
Those 20 assertions are **not a Gate E streak**. No real learner/session or live
backend was used. The optional flag was overridden only in the browser fixture;
the committed runtime flag stays OFF. The local server was stopped afterward.
Gate E v21 frozen preflight and static migration inventory remain PASS.

Backend files and schema were not changed in this frontend batch; the previous
1,469-test backend checkpoint is not a new backend run. Claude review of this
code/test delta and the preceding practice backend delta remains pending due to
the previously reported quota limit. No commit/push/PR, migration application,
capture activation, remote deployment, or legacy deletion occurred.

## Remaining integrations — not implemented by this checkpoint

### Listening HTTP review follow-up

Local review using the project `review` checklist found a verification gap:
the new practice HTTP tests did not previously install the actual request-ID/
operation-hint middleware. They now exercise that middleware with the actual
Listening router and Pydantic request model, including capture OFF/ON, success,
409 race rejection, 503 malformed acknowledgement and ownership rejection.
A further real-HTTP sequence checks same-answer retry, changed answer, reveal
and a subsequent headerless request: canonical first-answer data (including its
timestamp) remains unchanged, server operations remain distinct, input digests
separate changed answers, reveal does not correlate, and context does not leak
into the next request. This closes a test-boundary gap, not a new production bug.

The first test run exposed an over-specific fixture assertion that omitted the
existing `answered_at`; the assertion now compares the complete first-write
snapshot and independently checks question/answer identity. Production code was
not changed to satisfy it. Final combined verification: **1,474 backend tests
passed** across the same 59 files with required local PostgreSQL, zero skips,
and seven existing warnings. The temporary cluster was stopped. Frontend was
unchanged; its prior 9,175-test and browser results remain the previous checkpoint.
Claude has not reviewed these additional test changes; independent review and
the [next evidence decision](GATE_F_EVIDENCE_NEXT_DECISION_2026-09-10.md) remain
open. No admission write-path expansion, capture activation or remote action
was authorized or performed by this follow-up.

### Remaining scope

1. Complete and verify the missing correlation boundaries above, extending the
   local opt-in browser integration across the remaining transport paths;
   classify deliberate restart separately from retry. Preserve current learner
   business behavior, including Reading/Listening explicit-start semantics.
2. Speaking's v4 client-UUID creation receipt is implemented locally (see below),
   but must be separately verified/rolled out. Legacy fallback/disabled v4 client
   UUID starts remain unknown. Extend grouped-result checks to recovery/regrade
   paths. Anonymous Reading needs classification.
3. Capture recoverable save/submit/grade failures separately from final outcome.
   An HTTP 2xx alone does not prove result persistence. A regrade may supersede
   an earlier observed result; do not infer causality just from event timestamps.
4. Define and verify coverage accounting, including recorder outages, disabled
   instances, missing receipts and out-of-order observations. This foundation's
   warning log alone cannot prove continuous coverage or a zero-error interval.
5. Verify the local Reading/Listening proof readback on the deployed schema
   after separate authorization. Extend the versioned receipt-cohort component
   into the full eligible-admission/current-outcome aggregate using independent
   attribution and coverage sources. Its current unknown partitions are not
   closure of that requirement. Do not certify organic volume or redefine the
   existing Gate F evidence profile; reconcile that profile before activation.
6. Verify route/frontend integration tests and independent code review, then
   obtain separate authority for remote database application and rollout.

The Speaking launch retry integration below, admin per-attempt inspector and
receipt-cohort aggregate are local only. No aggregate eligibility report, coverage certification, or live
evidence collection is claimed.
No request is captured while the evidence flag is OFF.
Historical Gate E v20 PASS 20/20 is unchanged; no new streak is started here.

## Speaking atomic creation receipt — migration 241

`SPEAKING_CREATION_RECEIPT_ENABLED=false` is a separate write-path rollout flag.
Both it and the evidence flag must be on before `/sessions` selects v4. Applying
the migration does not switch callers or mutate source rows; v1/v2/v3 stay intact.
Migration 241 is local only, unapplied on staging/production.

V4 preserves v3's user/session lock order, quota, replay identity and affinity
semantics, but returns `{session_data, created}`. Only actual INSERT RETURNING
can return `created=true`; an owned, payload-matching replay returns false before
quota checks. A first implementation wrapped v3 with an EXISTS probe; it was
replaced because source writers/deletes outside the advisory-lock protocol can
change state between that probe and v3's second read. V4's source of truth now
is the executed insert branch, not the probe. The existing v3 function definition
is tested byte-identical before/after migration application.

The API unwraps the receipt before returning its existing public payload. Part
2/3 rows still bind to the shared full-test namespace without starting another
attempt. No receipt or learner-content logging occurs inside the create SQL
transaction. An invalid RPC receipt is rejected, never guessed to be a start;
the resulting missing observation remains a gap, not a historical backfill.

Only a structured `PGRST202` naming v4 permits one call to the prior RPC/params:
that error establishes the missing RPC was not executed. No permission error,
SQL error, network failure or timeout may trigger the fallback. Client-UUID
starts on the fallback remain `start_observed=false`; the static error log
explicitly marks evidence incomplete. This is a compatibility escape, not a
passing coverage signal. Missing Supabase roles deliberately fail the migration.

Local verification includes concurrent v2/v3/v4 replay, both renderer protocols,
client/server-minted UUIDs, quota and payload conflicts, full-test trigger IDs,
RLS-hidden rows, role grants, NULL IDs, transaction-isolation rejection, and
all flag-off write-path combinations. A malformed receipt is not retried through
another write path. Final combined results: **577 backend tests passed**, with
PostgreSQL required and no skips; **9,090 frontend tests passed**, no skips.
OpenAPI TypeScript output is byte-identical; frozen Gate E v21/static cutover
preflights pass. Whitespace checks pass. No commit, push, remote migration,
flag activation, deployment, or new Gate E streak occurred.

Claude reviewed only this batch's code diff. Validated fixes added the separate
rollout flag, narrow missing-RPC fallback, single-source affinity value, server-
minted UUID tests, NULL identity tests, v2 concurrency, explicit advisory-wait
verification and flag-off parity. Role-skipping and raw identity/shape logging
suggestions were rejected because they weaken security/privacy. Claude's second
independent code-only review returned **No confirmed blocking findings**.
Its source-verification assumptions were checked against migrations 200/216 and
the configuration/route code. Additional SQL tests compare v3/v4 acceptance at
the same seeded quota boundary (completed/abandoned/full-test parts, previous-day
and foreign-owner exclusions) and their installed advisory-lock expressions/order.
These tests were added after that review; runtime code was unchanged afterward.
Live schema-cache discovery, role grants and rollout verification remain required
before either flag is enabled outside local tests.

## Speaking browser launch retry — local implementation

Ordinary topic, custom-question and full-test launches now persist an account-
and tab-scoped pending intent before POST. The existing `client_session_id`
contract (migrations 201/216, optional local 241) is authoritative: the server
inserts that UUID as the primary key and replays only matching owner/mode/part/
topic before quota. This client fix does not require enabling evidence capture.

Same-input retries reuse the UUID and an allowlisted snapshot of prepared
questions/random full-test topics, including the Part 2 handoff. A different
input after a failed request deliberately starts a new intent. Concurrent same-
slot requests share work; conflicting input cannot overwrite an in-flight start.
The ordinary topic entry points share one slot intentionally: entry-point UI is
not treated as a different logical attempt when payload and account are equal.
Retries after a reload require the same inputs; this patch does not restore the
form or create a separate pending-attempt inbox.

Browser storage writes/readback precede POST. There is no arbitrary application
byte cap; actual quota exhaustion has an actionable error and prevents a create
without durable identity. POST timeout aborts the transport, not the canonical
server transaction; the receipt remains for reconciliation by replay. Custom
questions are replay-safe through the existing unique-index conflict handler.
The 15-second client timeout is a UX retry bound, not a measured live latency SLO.

The shared SDK account is checked around asynchronous work, with the configured
same-account bearer pinned through `api.postWith`; no token is persisted. Tests
execute the actual api.js helper with an account switch during its own auth
await. An unmounted component cannot send follow-on writes or navigate on a late
response. Corrupt receipts and terminal custom-save HTTP 410 offer an explicit
discard action, after warning the learner to check history. Discard removes only
that local retry key and never creates/deletes a canonical session. Automatic
deletion of corrupt state was rejected: corruption cannot prove no prior commit.

After create/custom-save acknowledgements, best-effort receipt cleanup cannot
block entry to the saved session. If cleanup fails, a leftover receipt may
replay that already-created session on a later same-input start. It never turns
the acknowledgement into an invented new UUID. The handoff is not evidence of
learner-visible page entry or a completed learning attempt.

Privacy boundary: sign-out clears feature receipts; an account switch purges
other accounts' receipts while preserving the current account's pending key.
Consequently this feature does NOT promise retry deduplication across logout,
browser-storage deletion, tab closure, deliberate discard or expired/deleted
canonical resources. Do not use its receipts as an organic-use denominator.

Claude reviewed only frontend code diffs. Validated fixes: clear-phase storage
failure no longer blocks an acknowledged start; malformed/expired receipts have
explicit recovery; cross-account residue is purged; storage errors distinguish
quota exhaustion. The arbitrary byte cap was removed. API absence concerns were
checked against actual source and route/SQL contracts. The suggestion to restore
detached DOM unconditionally was rejected: stale callbacks must not mutate a new
mount's controls; the wiring effect has no changing dependencies. Initial
StrictMode setup/cleanup is synchronous before user interactions.

Claude's third frontend review returned **No confirmed blocking findings**.
Two additional non-blocking findings were patched afterward: coalesced callers
now share the same mapped HTTP 410 recovery error, and a failed discard keeps
its recovery button available. Focused tests and the full frontend suite passed
after those changes; they have not received a fourth Claude review. A changed
input deliberately remains a new intent, as documented above; it may leave an
unentered prior session consuming quota. This is not evidence that the prior
server operation failed. Stored-value changes during preparation fail before
POST; that rare guard currently uses the generic storage error message.

Final local browser-batch verification:

- **9,121 frontend tests passed**, no failures/skips, including actual extracted
  topic/custom/full-test handlers and actual api.js with fake SDK/fetch. These
  are not real-browser visual or staging E2E checks.
- TypeScript `--noEmit --incremental false`: passed.
- **24 targeted backend tests passed**, including new route-level unique-
  conflict reconciliation for custom questions. No backend runtime was changed
  in this browser batch; the earlier 577-test PostgreSQL-required result remains
  its separately recorded backend checkpoint, not a newly rerun count.
- Frozen Gate E v21 preflight and static cutover inventory: passed; whitespace
  checks passed. No streak was restarted or declared complete.
- No commit/push, remote migrations, activation, deployment or data repair.

Remaining: `api.js` still mints a fresh `X-Request-ID` per transport request.
This stable canonical session ID is NOT durable correlation for every save,
submit, grade or other flow. Dictation's existing submission receipt and the
Speaking result-page retry are not reimplemented here. Five-flow logical
operation correlation, attribution, coverage and the admin report remain open.
No generic header proves payload equality, ownership or organic use.

## Verification

Local PostgreSQL 18 disposable cluster only; migration executed twice in an
isolated schema. Tests cover service-role permissions, concurrent duplicate
receipts, conflicting replay rollback, failed-submit-then-success, pre-insert
failure and late observations. The backend test command uses `REQUIRE_PG=1`
so database verification cannot silently skip. No Supabase DB was touched.

Local results before the latest outcome batch:

- Combined evidence, migration and five-flow request regression tests after
  review fixes: **356 passed**, no skips.
- Existing frontend regression suite: **9,090 passed**, no failures or skips.
- Generated OpenAPI TypeScript output matches the existing `frontend/types/api.d.ts` exactly.
- Gate E frozen v21 preflight: unchanged/pass; static route inventory: pass.
- `git diff --check`: pass. Temporary PostgreSQL cluster stopped after tests.
- No commit, push, remote migration application, capture activation or deploy.

Latest local outcome batch verification (2026-09-10):

- Combined evidence, PostgreSQL migration, five-flow, full-test finalization,
  essay-service and regrade-resilience regression suite: **518 passed**, no skips.
- Namespace collision test proves an identical UUID can identify two distinct
  Speaking kinds without merging the attempts.
- Classifier tests cover missing/partial results, low scores, ownership mismatch,
  duplicate/missing responses, feedback version mismatch, failed regrade, pending
  retry, tied jobs, malformed metadata, bounded timeouts and cancellation.
- Additional hook-order assertions verify outcome reads occur after canonical
  full-test and Writing status/version/job writes; the focused rerun passed
  **189 tests** before the final review fixes.
- OpenAPI TypeScript generation remains byte-identical; frozen Gate E v21
  preflight and static Next inventory pass. No new Gate E run was started.
- Frontend regression: **9,090 passed**, no failures/skips. The first command
  hit a broken Homebrew Node library; bundled Codex Node ran the suite cleanly.

## Latest outcome-batch review disposition

Claude reviewed the cumulative code-only diff (no documents or unchanged source).
Validated fixes now preserve a committed/bound start before a later operation
failure, classify permanent RPC 4xx rejections as non-retryable `invalid`, retain
separate submit-success/outcome facts, run independent request observations
concurrently, bound Writing background fanout, and verify signatures for all
16 decorated endpoints. The final combined review-fix suite passed **535 tests**,
with PostgreSQL required and no skips. These changes have not themselves been
re-approved by Claude.

The local follow-up additionally found that report/answer agreement alone does
not prove Dictation covers the whole snapshot. The private computed count and
its role-ACL tests close that specific false-success case without reading text.
This computed field was added after Claude's snapshot; live PostgREST discovery
and embedding remain unverified and are a prerequisite to activation.

Retained/qualified findings:

- The nullable Dictation replay warning repeats a previously checked false
  positive: the second query is explicitly filtered by a non-null attempt ID,
  with no earlier binding on that branch. Silently ignoring inconsistent IDs
  would conceal corruption, so invalid evidence remains intentional.
- Array-index expressions have preceding owned-row/empty-result guards.
  Existing endpoint behavior and generated OpenAPI remain unchanged. Eager
  signature resolution is tested for all current decorated routes rather than
  silently disabling future broken instrumentation at import time.
- Python 3.11 is pinned in backend CI; the service-key attribute and awaited
  async DB getter exist. Writing explicitly updates its local row after the
  committed patch. Background superseded-worker early return remains a stated
  coverage gap, not a falsely certified terminal outcome.
- Cancellation propagation is intentional. No BaseException suppression or
  shielded orphan write was added to mask ASGI shutdown/disconnect behavior.
- The fresh async receipt client's connection setup still needs pooling and
  measured staging latency/load verification before activation. Concurrent
  scheduling improves the budget allocation but is not evidence of acceptable
  real-world receipt coverage. Capture stays disabled.

## Independent review disposition

Claude reviewed only the five-file code diff, with no tools or unchanged source
attached. Verdict: **Approve with changes**, not an unconditional approval.
The follow-up fixes add the bounded async boundary, non-retryable conflict and
invalid statuses, explicit standalone-transaction contract, stricter start
semantics, a surface-consistent composite FK, missing-constraint preflight, and
a deterministic PostgreSQL lock-overlap test. Verification follows the fixes;
this is not a claim that Claude re-reviewed the final version.

Claude's subsequent cumulative code-only review completed. Validated follow-ups
add strict Speaking identity metadata, exact saved-question-set/score checks,
column type/nullability/default preflight, and a tighter 500ms receipt deadline.
Pooling/load measurements remain required before activation. These follow-up
changes were tested locally, not subsequently re-approved by Claude.

The following review claims were checked against the unchanged source and were
not treated as confirmed runtime bugs:

- Writing resolver selects the assignment's own `id` from `writing_assignments`.
  Start's explicit ID only compensates for its narrower timer SELECT; it does
  not imply an essay/student ID mismatch in save/submit.
- Speaking full-test SELECT includes mode/part/canonical ID, while complete
  selects `*`; `_VALID_MODES` uses `practice`, `test_part`, `test_full`. Existing
  chain/ownership validation rejects an empty set before the indexed bind.
- Speaking uses `in_progress`, and Writing explicitly `row.update`s the
  committed start patch before the final bind. No extra active-status aliases
  or fallback-to-part identity were introduced.
- The second dictation replay query is filtered by a non-null attempt ID. A
  returned row without that ID is inconsistent backend metadata, not a normal
  legacy replay; invalid evidence is preferable to inventing its identity.
- Cancellation is intentionally propagated rather than catching BaseException
  and suppressing ASGI shutdown/disconnect semantics. Recorder exceptions and
  its internal timeout remain isolated from the learner's original exception.

Additional findings were qualified rather than applied mechanically:

- A sequence ID also precedes commit visibility; neither an insert timestamp
  nor a sequence alone is a safe incremental-export watermark. There is no
  reader/exporter in this batch. Snapshot/coverage reconciliation remains a
  prerequisite, not a solved problem or an invented fixed lag window.
- The function requires a standalone READ COMMITTED transaction. Retrying a
  lookup inside a REPEATABLE READ snapshot does not make concurrent data visible.
- Append-only privileges defend against ordinary service-role updates/deletes,
  not the owner/superuser. FORCE RLS would not constrain a superuser either.
- Canonical IDs are pseudonymous join keys. A retention/erasure design needs
  separate approval before activation; no arbitrary retention interval or purge
  job has been installed.
- Supabase roles and PostgreSQL >=13 are project prerequisites. Missing roles
  should fail a migration, not silently skip security grants. Tests intentionally
  require an explicit local TCP URL and privileged disposable cluster, stripping
  libpq environment overrides; unsupported socket URLs are not accepted.
- Full lowercase 40-character commit SHAs are this repository's current release
  identifier contract, not a promise to accept tags, abbreviated SHAs or future
  SHA-256 repositories. Invalid metadata now returns `invalid` safely.
