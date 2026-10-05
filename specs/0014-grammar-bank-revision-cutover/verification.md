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

| Requirement | Evidence required | Result |
| --- | --- | --- |
| FR-001 | exact12/one-final-bundle source/map/raw-META/mastery/link/hash; academic why_wrong extras read-only preflight; missing/already-cutover bank blocks | PENDING |
| FR-002 | old bank/question UUID and raw prompt/key/review hash preservation; deterministic current mapping; uniqueness/invalid duplicate states | PENDING |
| FR-003 | OpenAPI models/generated types, auth/error shape tests; bounded preview/footprint and canonical readback | PENDING |
| FR-004 | actual PG concurrent start/progress/reset/finalize/cutover/generic import/child insert-delete-update; serialized order/CAS/audit rollback | PENDING |
| FR-005 | open zero-attempt, paused, completed-with-carryover, true mastered/stale empty open, reset-versus-review unknown blocks before writes; missing/orphan/malformed/capped evidence; N-1 proven reload; first-progress completion watermark despite lost endACK; parallel attempt history retained without mastery regression; row/byte bounds, owned proof/retention and no public IDs | PENDING |
| FR-006 | frozen bank_id/revision/policy ACK; pure preflight vs activated engine; non-idempotent lost ACK/reopen; terminal stored NULL/nonNULL identity; N-1/unsupported starts and unmanaged controls | PENDING |
| FR-007 | lostACK/retry scoped action+actor+code+UUID tuple, changed same-tuple payload409, other actor/code auth/CAS independently; bounded lookup/nonJSON unrelated logs; duplicate/corrupt/missing proof failclosed; no TTL/purge while any legacy dependency exists inclrollback | PENDING |
| FR-008 | actual write-boundary mutation/delete/import refusal for managed current/legacy; unchanged unmanaged imports | PENDING |
| FR-009 | browser full states, history old rawsource/key/result, keyboard/focus/themes/motion/width matrix | PENDING |
| FR-010 | staging-first additive migration/N-1 compatibility, exact deploy SHAs, explicit final twelve-bundle operations/backups/new-start-disable compatible rollback; no interim six/second cutover | PENDING |

Academic gold covers contextual love/want correctness and preserved genuine
know/is-want errors. Baseline source evidence: grammar-linked-bank-audit.json,
production-grammar-bank-footprint.json and grammar-linked-bank-remediation.md.
These read-only/offline artifacts are not feature or canonical-cutover proof.

Actual-PG erasure acceptance for FR004/005/007 additionally proves the existing
auth.users cascade, absence-only FK deletion/link-clearing exception, rejection
of live-owner child deletion or link clearing, unchanged other owners/content/
private receipt and serialized erasure/cutover. A retained pseudonymous receipt
does not restore an erased owner or deleted history. These are pending gates.

Before/after DB verification reconciles old bank/question IDs/source hashes,
historical session/attempt references and stored scores. Ordinary concurrent
learner progress may change legitimately; verify that the cutover itself writes
none of those rows. New synthetic work has separate corrected-bank identity.

Actual PostgreSQL tests are mandatory; mocked RPC/source assertions do not prove
locks, FK phantom protection, rollback, receipt uniqueness or N-1 insert guards.
Missing credentials/skips remain an open gate. No real learner regrade or paid
provider calls. Record final PR/staging/main/backend/frontend SHAs separately.

The actual unchanged engine was exercised offline in eight mastery/state cases
plus an ambiguity control, with 14 assertions passing. Independent admin probe
also passed eight assertions for completed-with-carryover and status-label
counterexamples. This supports the classification semantics only, not DB cohort
classification, session provenance, cutover locks or deployment acceptance.
The unchanged existing-column counts SQL proposal was independently executed
against canonical synthetic PostgreSQL shapes: 23/23 classifications passed.
Persisted PG readback matched the unchanged engine in 22/22 cases; one malformed
shape was gated before the engine. External admin-grammar-cutover-review.md
records scripts/results and scope. This is classifier feasibility evidence,
not actual feature transaction/lock/provenance/retention or live cohort proof.
Authoritative live counts and every feature/release gate above remain pending.

Status: synchronized technical amendment and final18 academic/source bytes approved as bound in0015 approval.md/source-scope.md/json. Separate base approval landed47fbb311; all feature/deployed acceptance remains PENDING.

## Current reset/continuation and identity gates (FR004/005/006/008/009)

Actual PG: mark every prior owned-current admission NULL→transaction timestamp under
existing reset locks BEFORE stats DELETE; preserve prior nonNULL markers, attempts,
history/results/completion watermarks. Repeat reset preserves old timestamp and marks
only newly prior NULL rows. Fresh post-reset rows are unmarked. Eligible paused
current continuation uses owned unmarked same-bank/revision run|continuation predecessor,
canonicalremaining>0 and no completion marker anywhere in its matching unmarked group.
Readonly review, marked, wrong-owner/bank/revision, forged predecessor or absent stats
alone never qualifies. Current reset permits fresh current work while legacy permanent
completion fence/forbidden reset remains unchanged. Preserve all cap/privacy/receipt/
erasure/FK proof. Direct clear/set/transfer and concurrent reset/start/progress/end/
cutover/erasure tests are mandatory; source-string/mock lock assertions are not proof.

Actual schema/Next: grammar.bank_id is frozen b.id, current_bank_id is mapping.
Pure engine preflight derives exact existing remaining with no submits/business writes;
activation waits for validated real start ACK identity. Delayed/stale/wrong/lost ACK
creates no live engine/outbox/progress/end/optimistic ready; one POST per start action.
Explicit reopen performs GET then native create under authoritative carryover, not
same-session/start receipt recovery. Repeated terminal owned end may omit grammar;
stored bank_id/grammar_revision verified exactly, original NULL retained, mapped/new
revision nonNULL; no current lookup/backfill and no start/progress bypass.

Single final12 source bundle hashes include maps; raw multiple META/conflicting delivered
META fail closed. Read actual canonical question extras/why_wrong; changed-key conflict,
missing read, prior cutover or unapproved raw source blocks without auto-edit or
interim old-six publication. Feature evidence for every gate above remains PENDING.

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
