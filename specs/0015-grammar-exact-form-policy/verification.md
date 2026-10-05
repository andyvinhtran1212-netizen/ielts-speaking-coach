# Verification

## Current implementation checkpoint — 2026-10-01

Approved base `47fbb311` landed separately before implementation. The current
implementation base is `0d9b886c`, integrating the Listening80 staging change with
reviewed task preservation and regenerated API `946acb1e`. The frozen integrated
backend passed **10089 tests / 38 documented skips** with actual PostgreSQL groups
required; no Grammar306, Dictation305, Listening304 or Reading PG group was skipped.
Final frontend gates passed **10591 Node / 0 skips**, **286 React**, strict and legacy
TypeScript, and the rebuilt production Next bundle. The first Node invocation's
two interpreter-environment skips are retained; the configured-venv invocation
ran both. Earlier component receipts and RED runs remain historical evidence.

Actual built Next with synthetic auth/intercepted business traffic passed
**311/311 Native checks in 64 scenarios**, **134/134 History checks in 9 scenarios**,
**25/25 Admin flow checks** and **9/9 shared quiz checks**. The Vocab compatibility
matrix retains 16 snapshots/112 controls. After three scoped Admin CSS fixes,
actual computed measurements passed the known contrast/44px-target/zero-duration
checks across 24 state/theme/width snapshots: 1192 supported text records,
128 outer controls and1696 motion records. **32 native-control contrast UNKNOWN**
and **8 disabled exemptions** remain separate; no whole-WCAG or physical/manual
certification is inferred. The minimum supported unrounded contrast is4.505561;
the minimum control width is44px. Independent source review accepts the exact
CSS `182ea351` and verifier `5083d38e` deltas, keeping assertions/fixture/engine
unchanged. History401 ownership, twelve-code Admin coverage and API preservation
have separate reviewed source evidence. Runtime config was restored exactly.

Actual local PG/ASGI public capture `9adcb759` records scoped Admin commit/replay
and original/current historical keys; auth and synchronous reads are synthetic
snapshots. Its503 case withholds one snapshot question without corrupting PG.
Six historical-read table digests are unchanged. The narrow missing-question
guard does not identify missing-parent/NULL managed-history markers.

Staging read-only preflight found ledger294,304/305 applied,306 absent and only306
pending. Relevant prerequisite catalog checks passed, while the raw result remains
FAIL for five historical ledger filenames; SQL provenance for160/263 is UNKNOWN.
The twelve canonical codes are missing in that staging footprint; this authorizes
neither zero-cohort inference nor automatic predecessors/publication. Root's bounded
migration-risk decision, after-migration preservation/readback, separately reviewed
predecessors and fresh canonical extras/backup gates remain open.

Spec governance validates17features and its88contract tests pass.
All22 requirement rows below remain PENDING. Exact-head CI, live principal/grants/
schema cache, fresh canonical/extras/backup/cutover, exact staging/promotion/
production and manual evidence are separate gates. No live306 migration, canonical
cutover or historical regrade has occurred.

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | Exact12 canonical/source enum/parser/DB/facade/articleresolver scope tests; source/hash independent review; missing original rejects without fabricated predecessor | PENDING |
| FR-002 | Raw exactly-one META/multiple identical or valid-first-missing-last rejection, duplicate keys identical/different, aliases/merges, wrong shape/values/keys, reserved/inherited/cross-bank/unowned qid, invalid input/type/accept, count/byte caps through real parser; zero-write failure | PENDING |
| FR-003 | Actual parser→wire→PG META roundtrip and served-payload retention; generic destructive opt-in refusal; stored invalid policy503 before session/engine; absent-map import controls | PENDING |
| FR-004 | Both real engine imports/parity; all selected accepted forms pass; five morphology negatives reject/no credit; long orthography exact bypass, normalization/punctuation-only controls; explicit typo and absence legacy outcomes | PENDING |
| FR-005 | Route/schema and actual PG session create: valid revision+missing/null ACK409, wrong marker422, invalid policy503, only-typo map ACK; mapped run/continuation/review/direct/default/N-1 fences; absent/empty old calls pass | PENDING |
| FR-006 | Concrete frozen grammar.bank_id/revision/policy OpenAPI/TS; canonical META precedence; pure preflight vs actual ACK live activation; terminal stored NULL/nonNULL optional-envelope omission; stale/async bank-switch failclosed | PENDING |
| FR-007 | Full source diff/qid/order/key/pool/mastery/accept invariant checks; visible target assertions + independently adjudicated gold; optional three objective targets/explain, no categorical passive ban; raw-hash review | PENDING |
| FR-008 | Actual PG preview/map diff/hash/CAS/copy/readback/receipt; map-only tamper or omitted persisted policy aborts/rolls back; import/direct mutation/race guards; old META extras preserved; changed-key why_wrong read-only preflight; single final12 bundle/no interim6/already-cutover workaround | PENDING |
| FR-009 | Actual PG original bank/question/map/history fingerprint preservation, zero credit transfer, paused/old mapped/old absence continuation, current reset marker/unmarked-group proof/review exclusion and actual races; unchanged legacy mastery/cohort/receipt fences; GET history zero writes versus explicit readonly admission row/zero attempts+mastery | PENDING |
| FR-010 | Actual Next loading/empty/ready/feedback/error/retry/stale/permission journeys; keyboard/focus/reducedmotion/light-dark/360-390-768-1440; no technical marker in learner flow, no optimistic grade/save | PENDING |
| FR-011 | Full affected local suites, real PG races and actual Next delivery gold/legacy batch; independent combined diff review; zero hidden skips/paid AI/fake scorer; exact head CI | PENDING |
| FR-012 | Separate approved spec base, staging-first additive migration/N-1 grants/cache proof, exact backend/frontend/staging/promotion SHAs, explicit12-scope reviewed per-bank receipts/readbacks/backups and compatible rollback drill | PENDING |

## Contract evidence

Publish concrete request/success schema and regenerate existing frontend wire types;
TS tests cover omitted capability, literal capability, absent-map legacy and strict
nonempty-map state/start agreement. Backend requests with numeric/bool/unknown ACK
fail422; missing/null against mapped bank fails409 before session count changes.
Do not change every legacy session optional/null field while adding one property.
Actual PostgREST/PG old-call compatibility and service-role/anon/authenticated grants
are required, not inferred from source signature strings.

## Academic and matching gold

Baseline is r03-independent-academic-review.json, parser proof and actual-engine
counterexamples, plus grammar-text-policy-inventory.json. Candidate final scope:
12 codes/264 questions/58 text questions,49 exact and9 retained legacy. These counts
are bound to the approved final18 authored source/map hashes in source-scope.md/json; runtime matching/admission/persistence and canonical release acceptance remain PENDING.

For every selected exact qid, test all authored accepts and current normalization
case/spacing/surrounding punctuation variation. Target gold pass100%; the five
measured wrong forms accept0/5, produce is_correct:false and no new correct credit
or production confirmation. Add had→has finished, singular/plural auxiliaries,
missing base/V3/-s/-ing and long phrases. Include valid full/reduced/passive/perfect
and contraction alternatives; never infer validness from old scorer output.

Legacy controls include environment/enviroment, short first-character/minimal-pair
rejection, case-sensitive items, strict single-word spelling, retained long-phrase
fuzzy exception and punctuation-only ; versus .; unchanged credit/distinct/production/
provisional/reversal/exhaustion/carryover. Explicit typo_tolerant retains those same
guards. Bank-scoped duplicate qid across Past/Present Continuous resolves separately.
No paid provider evaluation is needed; evaluation cost0 and no external model fallback.

## Data evidence

Actual PostgreSQL is mandatory. Confirm parser-validated map survives new-bank META,
manifest/revision/receipt and delivery; unrelated META extras unchanged. Malformed
stored map blocks before admission. Invalid source/alias/duplicate or cap errors
create no bank/question/session/audit receipt. Old/current source/map/history checks
compare immutable fields; legitimate concurrent learner progress is not mistaken
for a cutover write.

Run actual races: cutover/start with and without ACK; old/default direct insert;
generic import/map mutation/child insert/delete/update; map tamper after preview;
rollback due readback/audit failure; lost cutover ACK replay. Preserve0014 scoped
receipt identity/cohort/provenance/first-mastery/parallel stale-progress behavior.
No test may merely mock a lock/RPC and claim transactional proof. Required PG skips
or unavailable live credentials leave gates open.

## UI evidence

Production Next build uses real served bank payload and engine. Intercept all local
business traffic synthetically; assert exact GET/POST/PATCH requests, capability,
revision, attempt correctness, progress credit and ACK timing. Cover wrong/valid
form, only-typo map, missing/invalid map/start echo, delayed bank switch, reload,
Back/Forward, pause/continue, stale content, errors/permissions and new-start disable.

Historical receipt/history GET journey produces0 start/progress/end/reset requests
and0 DB business writes. Explicit readonly review admission is a separate journey:
one admission row is permitted, mapped ACK required, attempts/mastery writes0.
Do not conflate them or silently weaken the existing review owner.

Test keyboard Enter/check/next and error focus, no duplicate admission on rapid
clicks, focus return, reduced motion, both themes and360/390/768/1440. Mobile browser/
VoiceOver/manual evidence remains pending where tooling cannot prove it.

## Release evidence

Record spec approval/implementation PR/head, actual staging migration ledger,
backend/frontend deployed SHAs, integrated CI/live staging, source/map/code manifests,
per-bank original/current IDs/revisions and receipts, old history hashes and rollback
drill. Production promotion must be the exact verified staging SHA. Source PR,
offline probe, build or unrelated historical green run does not close feature gates.

Status: separate technical/source approval47fbb311 and the reviewed final local
implementation are established as bounded above. All22 feature requirements,
exact-head CI, canonical publication and deployed/live/manual acceptance remain
PENDING; local evidence does not close those gates.

## Resolved review contract gates — all PENDING

- Raw parser: exactly one quiz META for bounded revision or declared-policy source;
  two identical META, valid first/policy missing last, first/last code divergence,
  duplicate text_match_by_qid or values and alias/merge fail before safe_load/mutation.
  Canonical managed wire is payload.bank.meta; root payload.meta cannot override or
  substitute for it. Conflicting policy presence/value or bank identity fails closed;
  equivalent alternates are never chosen as owner. No alternate shape may cover a
  missing canonical map. Raw duplicate keys/multiple quiz META still reject even identical.
  Shared validator and both real engine imports bind same bank-local qids/META.
- Pure preflight: valid mapped/legacy progress has existing remaining/all-mastered
  parity, no submit/drain/active engine/outbox/progress/end/admission before intended
  start. Invalid delivered policy fails before preflight. Actual ACK echo exact
  grammar.bank_id/revision/policy and account/request scope before live activation.
- Lost start ACK: actual start commits, transport drops ACK; exactly one POST for
  this action, unavailable UI, no activated engine/outbox/progress/end. Explicit
  reopen GET+native create may return new session with canonical owned carryover.
  Unknown/closed/missing eligibility blocks. No guessed same session/start UUID or
  admin receipt recovery; old committed row remains historical evidence.
- Terminal repeat-end: owned already-ended row can omit optional grammar and returns
  stored bank_id/grammar_revision exactly. Original historical NULL retained, new/mapped
  nonNULL expected. Assert no current mapping lookup/revision graft/backfill/writes;
  NULL compatibility never permits a new mapped start or unmanaged progress bypass.
- Actual PG current reset: under approved lock order mark every prior owned current
  admission NULL→transaction timestamp before stats delete. Repeat resets preserve
  previous timestamp, history/attempts/completion. New post-reset run/continuation
  rows are unmarked. Pause/reload requires owned unmarked same-bank/revision predecessor,
  canonicalremaining>0, no completion marker in matching unmarked run/continuation
  group. Marked/review/otherowner/bank/revision/forged rows never prove unfinished work.
  Direct clear/rewrite/transfer and reset/start/progress/end/cutover/erasure races
  exercise real guards; old legacy cohort/reset/completion fences remain unchanged.
- Final source: all twelve final candidate hashes/maps/qid-field changes independently
  approve together before publication. Actual canonical extras/why_wrong read-only
  academic preflight checks changed keys; missing/conflicting data blocks without
  auto-edit/zero inference. Already-cutover code blocks; no interim old6 publication
  or unapproved second revision. Preserve normalized map hash/copy/readback/receipt.

Feature PASS cannot be inferred from the frozen478 content-source tests, local engine
negative proof, specification validation or formal review. Actual local PG and delivered-Next fixture results are recorded above;
a11y/manual/live/exact-SHA feature gates remain PENDING.

## Mandatory reset-stale acceptance — all PENDING

On actual PG, commit a current start and drop ACK, explicitly reopen/new-session,
finish that work, then reset while the orphan first row remains open. Reset succeeds
under existing locks and marks EVERY prior owned-current admission before stats
DELETE; it does not auto-close rows or alter saved answers/results/completion/prior
marks. Direct set/clear/transfer remain forbidden. Replay/new progress for any marked
row returns typed409 error_code=grammar_reset_stale after verified owner/frozen scope and locks, before
ANY attempts/stats/completion/KP/telemetry; no mastery resurrection. Applicable direct
attempt/stat writes cannot bypass it; reset stats deletion and absent-owner canonical
FK erasure remain accepted. Test both serialized outcomes of progress/reset and
start/reset, plus end/reset/cutover/erasure. Marked owned-open end terminalizes only
its original frozen row and normal summary; saved identities/markers/answers remain,
mastery/KP/new eligibility do not change, repeated terminal end is exact/no-write.
Current paused predecessor/proof/completion group filters ALL exclude marked rows,
readonly review cannot qualify, and original legacy cohort/fence/forbidden reset plus
unmanaged behavior remain unchanged.

Actual delivered Next oldtab receives reset-stale and shows explicit stale/reopen,
no automatic progress resubmission/retry or optimistic saved/mastered. Explicit reopen
reads current canonical state and performs existing create/carryover only if allowed.
Use the real engine/outbox and inspect intercepted calls/DB effect, not a scorer double.
Lost-start-ACK plus reset must not leave a permanent reset-lock or imply recovered UUID.
