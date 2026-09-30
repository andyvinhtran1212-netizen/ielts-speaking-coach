# Implementation plan

## Audit and ownership

Root coordinates review/release; content council owns academic labels and source
diff; admin engineering reviews transactions, proof/persistence and auth; learner
council reviews pause/reload/history states. Read current source and test
contracts before each layer. Source-only six-bank correction is separate and
does not implement this approved feature.

Baseline: migrations118/119/186/294, quiz_import real parser/atomic payload,
quiz_service current start/publication/carryover/history paths, public Grammar
CTA/exercise resolver and native quiz player. Preserve unrelated quiz/vocab/course
consumers. The existing topic/code uniqueness remains authoritative.

## Architecture impact

Use nullable managed Grammar fields on existing banks and nullable frozen
revision/admission-kind/owned-predecessor fields on sessions, plus a server-only
set-once canonical mastery-completion watermark. No purpose backfill is guessed
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
progress. FR005 eligibility, row/byte bounds, provenance and retention are approved in
the separately landed spec; implement only after that approval is on the base.
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
explicit admin operation per six-code/hash, after independent review and backup.
Persisted historical scores/source IDs/hash are acceptance evidence, not inferred
from passing parser tests. No paid evaluation is necessary.

## Rollout and rollback

Apply classification/mapping safeguards before explicit cutover. Disable new
managed starts on rollback while retaining immutable old/corrected bank reads,
continuation, completion and history. Do not undo schema, delete active content
or infer that an importer restores original UUIDs. Follow rollout.md gates.
