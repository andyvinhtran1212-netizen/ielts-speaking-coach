# Implementation plan

## Audit and ownership

Root coordinates review/release; content council owns academic labels and source
diff; admin engineering reviews transactions, proof/persistence and auth; learner
council reviews pause/reload/history states. Read current source and test
contracts before each layer. The source-only twelve-bank bundle is separate and does not implement this
approved amendment. Root/Content have independently approved final authored bytes/hash; no interim
six-bank publication precedes the final policy-compatible bundle.

Baseline: migrations118/119/186/294, quiz_import real parser/atomic payload,
quiz_service current start/publication/carryover/history paths, public Grammar
CTA/exercise resolver and native quiz player. Preserve unrelated quiz/vocab/course
consumers. The existing topic/code uniqueness remains authoritative.

## Architecture impact

Use nullable managed Grammar fields on existing banks and nullable frozen
revision/admission-kind/owned-predecessor fields on sessions, plus a server-only
set-once canonical mastery-completion watermark and server-only set-once nullable
quiz_sessions.grammar_reset_at TIMESTAMPTZ for prior owned-current reset admissions. No purpose backfill is guessed
for existing sessions. Unmanaged rows/clients retain their existing shape. Add a
partial unique current mapping and immutable-question guards for managed banks.
Keep original source/code/topic/question rows intact; corrected physical code is
server-generated while explicit canonical article mapping attaches its CTA.

Reuse the existing configured SQL engine or DB function ownership; no new pool,
service→router cycle, PostgREST write chain or generalized editing framework.
Cutover transaction validates source, locks topic/canonical parent/bank in one
documented order, locks old questions, verifies immediate FK child-insert
protection, fingerprints content, freezes continuation proof, creates corrected
bank/questions and flips current mapping plus audit receipt atomically.

Managed session admission uses the same lock order and DB boundary, including
direct/default inserts. A DB check prevents an N-1 caller bypassing current
mapping/revision eligibility. Compatible new sessions require the returned
fingerprint; eligible old unfinished work binds the old fingerprint. Inspect
legacy pause behavior explicitly: neither paused nor completed session status
proves completion of mastery. The engine can end a completed session after
max-attempt carryover while reload still has remaining work. Freeze progress,
reset, finalization and starts under the same scope as cohort classification.
Unknown reset-versus-review provenance blocks that bank before publication;
never guess purpose from a zero-attempt open session after completed history.
Proven eligible N-1 `{bank_id}` reloads derive continuation server-side; new
corrected/ineligible old unversioned requests fail before INSERT.
Consume admission at the first canonical all-mastery progress write, independent
of end ACK. Reject old reset/delete and retain completed mastery when an admitted
parallel snapshot is stale, while still appending owned attempt history and
allowing finalization with explicit response truth.
Receipt proof remains private, append-only and bounded; no public bank payload
may contain learner IDs. Missing proof produces unavailable, not fresh-looking
progress. Original FR005 bounds/provenance/retention were approved on the base; this twelve-code,
current-reset and0015 integration amendment is approved in this spec-only change
and requires base landing before its new behavior is implemented.
Receipt identity is action+actor+canonical_code+operation_UUID, not UUID alone.
Retain immutable cutover/cohort proof while any old admitted/continuable/history
dependency exists, including rollback; no TTL or generic audit purge bypass.
Preserve migration119 auth.users erasure under that same statement-level scope
gate. Only absent canonical-owner FK actions may delete the erased owner's
progress or clear its last_session_id; live-owner direct writes remain blocked.
The existing no-FK migration107 private receipt survives unchanged and cannot
restore ownership/history. No erasure service or general retention mechanism
is introduced.

## Existing-write safeguards

Guard import_quiz_bank_atomic and the lower quiz_replace_questions boundary,
question direct mutation and managed-bank admin delete/update. Existing unscoped
import still works for unmanaged banks. Locks alone are not an immutability
policy once a transaction ends. Test actual concurrent generic import and child
insert/update/delete on PostgreSQL; source-text tests are insufficient.

## Data and contracts

Concrete admin models/routes expose bounded preview/CAS/receipt, never a generic
bank patch. Generate OpenAPI frontend types. Extend managed learner bank/start/
progress/result contracts additively with revision and legacy-continuation state.
Deterministic Grammar CTA/exercises use current mapping; unmanaged exact-code
lookup remains unchanged. Never silently replace the bank in an active engine.

## Verification strategy

Follow verification.md and rollout.md. Separate approved spec PR from high-risk
implementation PR. Migrate staging before dependent code, validate actual PG and
exact-SHA browser old/new clients, then promote code. Production cutover is an
explicit admin operation per final twelve-bundle code/hash, after independent review and backup.
Persisted historical scores/source IDs/hash are acceptance evidence, not inferred
from passing parser tests. No paid evaluation is necessary.

## Rollout and rollback

Apply classification/mapping safeguards before explicit cutover. Disable new
managed starts on rollback while retaining immutable old/corrected bank reads,
continuation, completion and history. Do not undo schema, delete active content
or infer that an importer restores original UUIDs. Follow rollout.md gates.

## Synchronized0015/reset/identity implementation boundaries

Use the existing META/quiz/transaction/reset owners. One final source bundle,
exact twelve-code maximum enum and raw hash manifest serve parser/source/DB/facade/
article resolution together. Only text_match_by_qid differs from old runtime META;
preserve other META/question extras, including read-only why_wrong academic preflight
on any changed key. Unknown/conflicting extras or already-cutover code blocks;
no second revision/generic reversion or automatic extra rewrite.

Current reset serializes on the existing documented global/shared and canonical-code
owner lock. Before deleting owned current stats, mark all prior owned same-current-bank
admissions whose grammar_reset_at is NULL with DB transaction timestamp. Do not rewrite
nonNULL markers, history/attempts/results/completion watermarks. The transaction is
the only authorized marker writer; no client field/direct clear/owner transfer.
Current continuation uses an owned unmarked run/continuation predecessor with same
bank/revision, canonicalremaining>0 and no completion watermark in its matching
unmarked post-reset group. Readonly review is never proof. Keep original legacy
cohort/completion/reset policy, caps, privacy, retention and erasure unchanged.

Managed state adds concrete frozen bank_id=b.id; current_bank_id remains mapping.
Typed start success binds bank_id/revision/policy; pure validated engine preflight
may derive remaining before admission, but no active engine/outbox/submit/progress/end.
Actual verified ACK is the activation boundary. Non-idempotent start ACK loss has
no automatic POST retry/recover-by-UUID; explicit reopen follows current create and
canonical carryover proof. Admin cutover UUID receipt remains separate.

Terminal repeat-end reads/validates the already terminal owned row's stored bank_id
and grammar_revision, allowing omitted optional grammar envelope without current
lookup. Original NULL revision stays NULL; new/mapped managed rows are nonNULL;
terminal compatibility never bypasses start/progress. Preserve unmanaged null/timer
semantics and generated request/success types. If306 already applied, follow-up
additive migration changes scope/admission/reset guards; do not rewrite306.

Actual PG acceptance covers reset+start+progress+end+cutover+erasure races, post-reset
group fences and immutable marker attacks, plus all original FK/receipt/import and
N-1 gates. Actual delivered Next covers preflight/ACK/lost ACK/reopen/pause/history.
All new feature evidence remains PENDING; technical/source approval does not close implementation or release gates.

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
