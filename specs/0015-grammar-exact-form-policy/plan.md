# Implementation plan

## Architecture impact

Approved0015 extends approved0014 explicitly. Existing FastAPI quiz facade, bank
META JSONB, managed Grammar transactions, native Next quiz player and pure quiz
engine remain owners. No new table, per-question column, session-policy column,
grading service, background job or global focus/navigation/content platform.

Read complete existing parser/row transport, managed source/preview/copy/readback,
start RPC/context/trigger/grants, bank payload, outbox and historical reads before
edits. Coordinate file ownership; root owns schema/transactions/release, content
owns reviewed authoring, learner owns engine/player; independent audit reads the
whole combined contract. The js and public/js engine import surfaces must retain identical behavior.
Current frontend/js is a symlink to public/js; preserve that shared tracked source
and verify both imports without creating a duplicate engine.

## Data and contracts

### META and parser

Add exactly text_match_by_qid to real quiz META whitelist. Validate map against
final parsed qid/input/type/accept set before preview or commit. Use current safe
frontmatter parsing with local quiz META duplicate/alias checks and exactly one
raw META block for bounded revision/declared-policy quiz sources. Reject identical
duplicates, valid-first/missing-last META and multiple blocks before safe_load;
never retain last-META-wins fallback. Do not tighten
all article/other parser consumers globally. Current yaml.safe_load collapses
identical keys, so checking only the resulting dict is insufficient. Fail on
unknown keys/values, reserved keys, invalid eligible type, non-owned qid and caps.

Map eligibility is twelve explicit canonical codes. Nonempty opt-in publication
requires approved managed cutover; generic preview is not permission to replace
old live content. A stored nonempty map on an unmanaged/out-of-scope bank is
unavailable, not a route around revision/admission safeguards. Absent/empty-map
legacy banks retain matching/admission behavior. New mapped sources are not
published by migration/deploy or ordinary destructive import.

### Managed source, metadata exception and readback

Amend0014 scope and source manifest in a separately approved spec change. Review
raw authored bytes, map value selection and changed-qid/field manifest per code.
Rehash normalized META+questions; retain all old bank metadata extras and source
fingerprints. Existing preview equality compares all authored runtime META against
old META, so allow only exact approved map difference. Current new_bank clones old
META; explicitly compose validated approved policy with preserved old extras, then
read actual new map/hash under transaction before successful publication/receipt.
Read retained canonical question extras including why_wrong on changed keys before
publication. Unknown/missing reads or conflict blocks; do not auto-edit/drop extras.
Never relax arbitrary META mutation or raw source hash checks. Use one final approved
twelve-source/hash/map bundle and one cutover per code; reject already-cutover state
pending a separate approved decision, never publish six old interim hashes first.

Revise canonical-code enum/service/DB allowed-code predicate together to12. Preserve
0014's code/topic uniqueness, old IDs, locks, eligibility/cohort/first-mastery proof,
receipt integrity/retention and direct mutation/import guards. If306 already applied,
use additive follow-up migration. No in-place migration/legacy bank rewrite.

### Admission capability and concrete wire schema

Existing POST /api/quiz/sessions adds only this request property:

```json
{
  "bank_id": "corrected-bank-id",
  "grammar_revision": "64-lowercase-hex-frozen-revision",
  "admission_kind": "run",
  "text_match_policy": "qid-exact-v1"
}
```

The request property's concrete type is optional Literal qid-exact-v1 or null.
For nonempty-map bank only the literal passes admission; absence/null409, other
values/types422. For absent/empty map no marker is required; a supported redundant
marker has no grading/admission effect. Derive requirement from persisted META,
not a client bank code/map/skill flag. Existing kind/class_item/timer/retake and
absence behavior remain intact.

GET bank and successful managed session start keep existing payload shape; existing
`grammar` ManagedGrammarSessionState gains concrete frozen bank_id=b.id alongside
bank_revision=b.grammar_revision, and optional text_match_policy only for nonempty
valid map. current_bank_id/current_bank_revision remain current mapping. The exact
typed successful start envelope {session_id,resume,grammar} echoes this frozen tuple;
validate it against canonical served bank.id/revision/policy before activation. Preserve exact existing legacy optional timer/other fields and null
semantics; do not globally exclude every null merely to omit this new property.
Publish concrete request and success schemas, extending current managed-state and
session envelope; generate frontend API types. Runtime checks confirm map, served
state, response revision/policy and engine identity agree.

Enforce capability in the existing serialized managed start boundary before INSERT
and transaction-local authorized session context. Old/default RPC/direct managed
writes without capability cannot start mapped work; absent-map N-1 calls still work.
No session policy column is needed because immutable bank_id/revision binds the
immutable map. A capability marker is a declared support contract; actual native
engine tests prove it is honored. It does not make client grading tamper-proof.

### Engine and native client

Resolve mode by own qid in validated local META. Exact equality loop returns before
all fuzzy branches. Optional helper policy context preserves direct helper legacy
calls; do not mutate q objects or introduce a dropped authored q-level strict flag.
Preserve normalizeText and punctuation-only fallback, accepted forms and all credit
logic. Explicit typo_tolerant retains old fuzzy eligibility guards.

Native managed payload.bank.meta is canonical and bound to payload.bank.id. Top-level
payload.meta cannot override/substitute for it; conflicting policy presence/value or
bank identity fails closed. An equivalent alternate is never chosen as owner and
cannot cover missing canonical policy. Shared validator and engine use the same
canonical META. Legacy direct helper input shapes retain
absence behavior; no conflicting shape can silently choose a different map.
After validation, pure preflight engine may derive existing remaining/all-mastered
without submit, active learner engine/outbox or writes. Send ACK only for nonempty
map. Actual start success frozen bank_id/revision/policy plus async request/account
scope is the activation boundary for live engine/outbox. Reset/reload/back-forward follow immutable
bank revision and 0014 ownership, never current-map grafting. Historical GET readers
have zero business writes. Existing explicit review-admission owner may create a
readonly session with ACK but outbox/end/progress do not write attempts/mastery.

Start remains non-idempotent. Lost ACK is unavailable; do not auto POST retry or
claim same session/ready. Explicit user reopen does canonical reads then existing
new-session create+canonical carryover under authoritative unfinished eligibility.
Keep committed old admission/history; do not invent learner start UUID/receipt or
reuse admin cutover operation receipt. One start POST per action, no writes/activated
engine on lost/stale/wrong ACK. A stale async response is not rebound to new scope.

Terminal repeated end may omit optional grammar envelope; validate actual owned
stored row bank_id/grammar_revision without current lookup/derivation/backfill.
Original pre-existing terminal NULL stays NULL; mapped/new managed start revisions
are nonNULL. This compatibility does not bypass start/progress or add global null
omission. Typed end success retains existing fields and stored frozen identity.

Synchronized0014 owns current reset: nullable TIMESTAMPTZ grammar_reset_at on existing
sessions, server-only set-once NULL→DB transaction timestamp under existing reset
locks before owned-current stats deletion. Mark all prior owned current admissions
(including review), preserve nonNULL markers/history/attempts/completion. Paused
current continuation chooses an owned unmarked same-bank/revision run|continuation
predecessor with canonicalremaining>0 and no completion anywhere in its matching
unmarked post-reset run/continuation group. Readonly review never proves unfinished
work. Direct marker change/clear/transfer/cross-owner reset rejected; legacy cohort/
completion/forbidden reset, erasure, caps/proof and existing formulas unchanged.

## UI and interaction

Reuse existing native quiz/admin components and feedback. Show incorrect for wrong
form, correct for authored normalized match, and canonical service errors for stale
or unsupported start. Admin sees exact source/qid/map/metadata diff and readback;
learners do not see policy tokens or physical revision codes. Cover state matrix,
keyboard Enter/check/next, focus/error return, both themes, reduced motion and width
matrix. No new policy toggle/editor or cosmetic substitute for canonical correctness.

## Work decomposition

1. Approve0015 and explicit0014 amendments on base, then independently review final
   authored bytes/map/raw hashes. Content-only authoring is separate from feature code.
2. Parser/META validation and concrete wire/admission contracts with unit/route tests.
3. Additive PG scope/signature/context checks, safe old-call compatibility/grants and
   metadata copy/readback with actual PG races/rollback/idempotency tests.
4. Real engine policy and legacy/gold coverage; keep duplicate source copies in sync.
5. Native payload/start/state/outbox/history integration, generated types and actual
   production-Next fixture journeys. Do not use fake q-level flags or scorer doubles.
6. Full local suites, independent full-contract audit, exact-head CI/staging gates,
   explicit reviewed cutovers/readbacks and production promotion/continuation evidence.

## Bounded implementation decisions for review

- **D1 RPC signature:** Inspect dependencies/grants/PostgREST schema cache before
  choosing a compatible additive signature or narrowly versioned existing facade
  routine. No ambiguous overload/default resolution, DROP CASCADE or lost service
  grants. Actual four-argument N-1 absent-map and new ACK calls must both pass while
  mapped no-ACK calls fail. This is not permission for a new general start platform.
- **D2 raw META:** Scoped existing quiz guard before YAML collapse rejects duplicate
  policy keys/aliases/merges and multiple META blocks, including identical or
  valid-first/missing-last. Canonical delivered payload.bank.meta is the sole managed
  wire META, with conflicting alternate policy presence/value/identity rejected and
  no missing-canonical-policy fallback. Prove absence/link/mastery
  and legacy helper compatibility. Keep normalization owned
  by real existing parser; no permissive parallel bank parser.
- **D3 response schema (behavior resolved):** Concrete ManagedGrammarSessionState
  bank_id=b.id plus bank_revision/policy echo the frozen admitted bank; current_bank_id
  remains mapping. Keep session/timer/resume/null fields and omit only absent optional
  capability. Terminal repeated owned end may omit grammar but stored bank_id/revision
  remains exact, including historical NULL. Generate types, not handwritten wires.
- **D4 footprint:** Read actual twelve canonical code/topic/bank associations and
  source/history hashes. Absent optional bank is a blocked/not-present outcome, not
  zero footprint or authorization to invent original predecessor/import it silently.
- **D5 reviewed source:** The49 exact candidates/root wording decisions are recorded,
  but final authored source/map bytes and hash manifest still require root review.
  No hardcoded source allowlist may be guessed or approved by its implementation.
  A single final12 bundle and actual prior-cutover/why_wrong read-only preflight are
  required. Missing/conflicting canonical extras cannot be guessed zero or edited.

## Rollout and rollback

Follow rollout.md. Land behavior approval first, stage additive routines/allowlist
before compatible code, then exact-SHA staging proofs. Publish per reviewed code
only through explicit bounded operation after footprint/backup checks. Preserve
old/new compatible runtime on rollback; disable new starts rather than removing
matching support or rewriting bank META/history.

## Verification strategy

verification.md maps every FR to meaningful parser/wire/actual PG/real engine/native
Next/race/history/staging/production evidence. Required gold is all selected accepts,
five measured wrong forms and additional tense/agreement/voice negatives; baseline
legacy corpus and credit/mastery controls stay unchanged. Cost is zero paid AI;
provider calls are unnecessary. Required manual/a11y/live gates remain PENDING until
observed and recorded against exact artifacts/SHAs; documentation validation alone
is not implementation evidence.

## Reset-stale implementation boundary

Remove the managed current-reset “any open row” refusal. Under verified owner/current
bank and existing shared/code locks, mark ALL prior owned current NULL admissions,
including open/orphan lost-start-ACK, before stats delete. Preserve old timestamps,
answers/history/results/completion marks; no auto-close or history rewrite. Add
marked-progress typed409 error_code=grammar_reset_stale after owner/frozen scope/locks and before ALL
attempt/stat/completion/KP/telemetry writes, including applicable direct managed
attempt/stat guards. Authorized reset stats DELETE and canonical erasure retain
existing narrow exceptions. Marked owned-open end may terminalize only its same
frozen row with normal reason/summary, immutable identity/markers and no mastery/KP/
eligibility effect. Repeated terminal end is unchanged. Current predecessor/paused
proof/completion-watermark gates are unmarked run/continuation only; reviews never
prove unfinished work. Client reset-stale stops automatic progress retry/optimistic
saved state; explicit reopen reads canonical state. No endpoint/table/retry platform.
