# Rollout and rollback

## Preconditions

1. Land separately reviewed approved behavior first; implement under high-risk
   PR. Source correction is an independent content patch and does not close
   canonical F01 exercise acceptance.
## Staging

2. Apply additive migration on staging with unmanaged default fields. Do not
   cut over or rewrite content during migration. Verify N-1 ordinary quiz writes
   and reads unchanged, then managed safeguards in synthetic tests. Verify real
   canonical account erasure, live-owner direct-delete rejection and concurrent
   erasure/cutover serialization. Bank/questions, other owners and private
   receipt hashes must remain unchanged; erased ownership grants no continuation.
3. Deploy compatible backend/frontend to staging. Actual PostgreSQL races,
   old open/paused continuation, preserved completed history, loss/retry and
   current-article resolution must pass on exact deployed SHAs.
4. Preview the single final twelve-bundle source/map hashes against real staging metadata/footprint,
   snapshot backups. Reject each bank's cutover if any unknown/malformed/orphan
   reset-versus-review cohort or row/byte-limit breach remains; report only
   classification counts. Verify admitted-purpose provenance and first-progress
   all-mastery watermark at the same write boundary before explicit cutover.
   Then explicitly cut over each scoped bank. Reconcile every
   receipt/current bank and original source/question/history hash.
## Production

5. Apply additive production migration through advisory-locked runner and
   promote the verified code. Record actual frontend/backend SHAs. Deployment
   itself performs zero bank replacements.
6. Root reviews exact production previews and independent academic labels,
   source/old canonical hashes and backups. Explicit admin operation per code
   uses one UUID; reconcile ACK or retry the same request. Read back CTA/current
   bank/source/key and synthetic grading; old bank/history remain unchanged.
## Observability

7. Monitor scoped current/legacy starts, continuation conflicts, invalid/missing
   proof, receipt anomalies and canonical mapping consistency. Do not emit raw
   learner content or other owner identities to product UI/logs.

## Rollback and repair

Rollback disables managed corrected new starts while keeping every admitted
old/corrected session readable and finishable with its frozen bank. Do not drop
additive schema or deploy a backend that can bypass the admission/immutability
guards. Never delete new banks with activity, overwrite old questions, change
mastery, or restore scores as an automatic rollback action. A reversal of the
canonical mapping requires a separate reviewed CAS operation and explicit
source/version label, preserving all banks/receipts/active work; it does not
restore correctness of the original content or close F01 acceptance.
Keep immutable cutover receipt and cohort proof for every remaining legacy
admitted/continuable/history dependency, including during rollback. Generic
audit retention/purge must not remove required proof; no TTL is introduced.

No historical regrade. Completion requires per-eligible-code canonical bank/revision IDs within the twelve-code maximum,
source hashes and deployed SHA evidence, not merely a successful source PR.

## Synchronized amendment preconditions

This separately reviewed0014 amendment and0015 are approved for base landing.
Land this spec-only approval on the base before new behavior code. Use one final approved
twelve-source/hash/map bundle; do not publish interim old six hashes. Actual per-code
footprint includes already-cutover state and canonical question extras/why_wrong.
Missing/already-cutover/unknown/conflicting data blocks that code for a separate
reviewed decision; no invented predecessor/second cutover or automatic extra edit.

If306 already applied, apply additive follow-up schema/guard changes, preserving ledger.
New grammar_reset_at column is nullable server-only on existing sessions, not a policy
column/table/platform. Migration does not backfill it or infer purpose. Runtime current
reset is sole authorized NULL→DB transaction timestamp writer before stats delete.
Prove actual reset/group/lost-start/terminal identity/race gates with policy compatibility
before deployment/cutover; keep original erasure, provenance, caps, receipt retention,
parallel mastery and legacy forbidden reset contracts. Deployment/cutover creates no
reset or auto-start. Rollback retains current reset markers and matching/admission
runtime floor; historical markers/attempts/results/META/questions stay frozen.

## Reset-stale release floor

Before deploying this extension or cutting over any bank, actual PG and delivered
Next must prove open/lost-start-ACK reset, all-prior set-once marking, typed409 marked
progress rejection BEFORE attempts/stats/completion/KP/telemetry, applicable direct
write guards and owner-scoped history-only end. No “any open row” fallback is allowed.
Preserve reset-delete/account-erasure exceptions, repeated terminal end, original
legacy forbidden reset/cohort/completion and unmarked-only current proof gates.
Verify delayed progress/end/reset races and oldtab stale/reopen without automatic
progress retry, mastery resurrection or optimistic save. Rollback retains these
reset/admission/matching guards and stored marks while any admitted work depends on
them; no schema removal/mark clearing/history rewrite. Every release gate is PENDING.
