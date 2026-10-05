# Implementation plan

## Architecture impact

FastAPI remains the business authority, PostgreSQL the persisted truth and Next
App Router the deployed UI. Extend existing Reading/Listening routes, graders,
mock/class services, attempt JSON/metadata, explanation-version objects and
append-only correction release events. Do not introduce a general content or
workflow platform. Source/template revisions remain separate from runtime
fixes and historical data repair.

Own the security transaction across `exam_content_service`, `mock_exam_service`,
`mock_correction_service`, both domain routers and legacy admin writers together.
Audit class/retake assignment RPCs, mock RPC260/261 successors and media issuance
as part of the same contract; a wrapper around only the central catalog is
insufficient. Retain existing spec0008 orphan recoverability and collection
behavior while adding the missing server-purpose boundary.

## Data and contracts

### Shared policy and serialized writes

Define one normalized decision receipt: purpose, permitted action, paper/version,
policy revision, entitlement identity and stable blocker objects. Reasons include
`planned_reservation`, `future_admission`, `active_delivery`, `valid_resume`,
`ambiguous_orphan`, `verification_unavailable`, `public_overlap_unapproved` and
`stale_revision`. Approved public overlap explicitly names protected mock/paper
revision identities and has an audit actor/reason/revision; later overlapping
references invalidate the grant until reviewed.

Use a shared per-paper transaction lock protocol and re-read dependencies after
acquisition. Every relevant writer participates, including direct legacy source
status/visibility writes and mock/assignment inserts/updates. Multi-paper locks
sort `(kind,id)` consistently. Existing-row locks alone do not cover phantom
references; concurrency tests must establish the chosen protocol on real
PostgreSQL. Enforce the invariant at the database write boundary where a route
could otherwise bypass it. No separate guard RPC followed by unguarded PATCH.

Historical eligibility excludes continuing delivery/admission but retains
submitted review. Pending marker/release work need not block metadata draft when
its exact submitted context and review authority are preserved. Draft planned
references are explicit blockers; do not silently invalidate an operator's plan.
No null or malformed cutoff becomes “expired”. Protect valid standalone active
attempts as well as mock attempts from disruptive metadata changes.

### Attempt purpose and historical compatibility

Add explicit purpose/sitting input to new transport contracts. Compatibility
requests may bind only an unambiguous owned current mock entitlement; ambiguity
returns a typed conflict before useful content or writes. Atomically establish
owner/section/paper binding and check collection state at admission; retrying a
lost acknowledgement returns the same canonical attempt. An existing frontend
attach remains compatible and idempotent, but is no longer the authority that
seals an admitted mock attempt. Never auto-link ambiguous legacy rows.

A deployed old client may continue safe already-bound work. An old client unable
to express the required unambiguous admission context gets an explicit recoverable
error rather than an unsealed attempt. Apply purpose checks to raw review,
correction, reveal, dictation and signed media before reading keys/transcripts.
Owner historical review need not require current paper publication.

### Policy, flags and review snapshots

Use additive migration(s), new revision/default legacy markers and complete
before/after release-event JSON; never edit previously applied migration261.
Preserve actor, release mode/version/time/by, exam_only and overlap provenance.
A restore supplies snapshot ID and expected current policy revision and runs the
same protected-dependency decision. Existing partial events are not trusted
complete restore baselines. Unauthorized service-role RPC execution remains
revoked from anon/authenticated/public roles.

Review flags use canonical attempt/question identity and per-question revision
with atomic idempotent writes. A stale update or response cannot overwrite a newer
flag or answer; explicit flag false is retained as acknowledged state. Ownership
is authenticated user or the existing anonymous attempt capability where that
product path is supported. Submitted flag reads remain possible; post-submission
writes may alter only flags, never result evidence, and need explicit unchanged
result tests.

Pin served question context at admission and preserve protected marking/support
context from that same revision for submission. Extend existing attempt/
`grading_details` JSON with a bounded submission context snapshot and marking
policy/version. Sensitive pre-release fields must remain in server-only storage
under deny-client grants/RLS, reusing existing protected correction persistence
where suitable; never add keys to a client-selectable owned-attempt JSON field.
Verify direct anon/authenticated database reads as well as HTTP responses. Store passage/section/summary banks once per
attempt and let item snapshots refer within that immutable context, avoiding
repeating full text 40 times. Preserve stable option IDs, grouped context,
original blank/diagram/table structure and source asset object paths/hash/window.
Never persist expiring signed URLs; sign authorized media on read and report
missing historical assets truthfully. Snapshot fields that are missing, empty or
legacy have distinct provenance; current fallback cannot replace a frozen value.

### Typed grading and content revisions

Extend protected authored answer metadata with an explicit versioned response
policy and source-reviewed accepted alternatives. Configure affected item
revisions only; do not infer a telephone/date/number from text shape or globally
strip punctuation. Phone normalization retains the digit sequence including
leading zeros/extensions. English numeric grouping validates grouping before
Decimal/value comparison; declared locale/sign/unit rules prevent ambiguous or
wrong-value matches. Literal/date/option/group rules remain separate.

Existing submitted grading_details remain frozen. Existing active attempts use
original recorded/legacy policy until submit; new revised attempts pin reviewed
policy. New review promises come from that same policy. Content import supplies
exact item/source hash and revision diffs with rights/editorial acceptance;
regrades and historic backfills remain separately approved operations.

### API compatibility

Publish concrete OpenAPI request/success/error schemas for policy/blocker,
flag/readback, purpose admission and snapshot-provenance additions; regenerate
frontend wire types and validate malformed runtime receipts. Preserve existing
array endpoints and ordinary public owner review where unaffected. Do not treat
unknown new fields or version skew as authority. Document every legacy writer
that is retained or routed through the invariant in the implementation PR.

## UI and interaction

The content library keeps mutation outcome and refresh status separate and shows
blocker reasons/dependency links without false success. Hide and Restore have
different labeled outcomes. A deliberate public assessment decision displays
specific overlap and exposure implications; no UI badge supplies approval.
Players reconcile answers/flags and expose pending/failed saves. Review renders
blank/incorrect/correct independently of score and shows full question context,
snapshot provenance and missing-support states. Use the exact surface matrix in
[ui-states.md](ui-states.md).

## Work decomposition

1. Owner approves intent; root coordinator lands a spec-only staging change.
2. Backend/migration specialist owns policy/resolver/transaction/attempt purpose,
   all legacy writer joins and real PostgreSQL concurrency tests.
3. Grader/context specialist owns typed policy and submitted snapshots. Coordinate
   domain router edits sequentially with backend owner; graders/content import
   code can run in parallel only with declared non-overlapping file ownership.
4. UI/flag specialist owns native and compatible player/review changes; shared
   routes/migrations are patched by the backend owner after contract agreement.
5. Content specialists propose source-grounded per-paper revisions and ledger
   receipts. Audio review is explicitly separate from code/clock verification.
6. Independent acceptance compares final diff/spec/full affected tests and the
   complete 368/80 ledger before root release/handoff.

## Rollout and rollback

Use [rollout.md](rollout.md). Migrations are backward compatible and applied to
staging first. No production policy repair, guessed snapshot backfill or score
change occurs automatically. A rollback leaves additive records/history intact,
keeps safe purpose enforcement and permits valid already-created work; never
revert to a leaking backend merely to match an older UI.

## Verification strategy

Every requirement has a pending gate in [verification.md](verification.md).
Test full role/purpose/section/lifecycle combinations, all source writers and raw
sensitive JSON fields, not only the browse page. Real PostgreSQL two-connection
barriers verify phantom new link/assignment/start, stale restore and transaction
failure. A reviewed positive/negative typed cohort prevents false positives;
edit/delete-after-submit tests verify immutable context and legacy labels.
Native browser journeys cover canonical flag reload/second-client/account switch,
operator 409/503+refresh and all listed themes/widths. Full relevant local suites
precede one consolidated push; exact-SHA staging gates then control promotion.
