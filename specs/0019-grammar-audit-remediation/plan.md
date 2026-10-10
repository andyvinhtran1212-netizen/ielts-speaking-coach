# Implementation plan

## Architecture impact

Extend existing grammar_quiz_revision_source, policy/model allowlists, revision
resolution and the serialized DB publication/admission guards. Reuse the current
admin endpoints and native player; no new worker, editor, persistence platform or
scoring algorithm. The only multi-publication case is the named LSU follow-up.
Implement only after this independently approved spec-only change lands on staging.

## Data and contracts

Bind new source/qid/field identities separately from retained historical identities.
Read complete canonical extras/footprints before choosing operations. Preserve all
history and immutable bank/question rows. An additive migration must support the
exact ninety-code union and the bounded LSU state without weakening original
receipt/provenance/ownership/reset/account-erasure validation. Generated OpenAPI
and UI allowlists must agree. Seed absent staging content from reviewed production
content snapshots only, without learners or guessed production predecessors.

## Rollout and rollback

Follow rollout.md. Approve and land intent first; implement once in a separate PR.
Use the existing staging-first release flow and explicit data publication after
code readiness. Disable new starts for a faulty revision while retaining historical
reads; mapping reversal requires reviewed CAS and does not restore by deleting data.

## Verification strategy

Use the original GA gold evidence, composed-frame negative controls and the actual
parser/engine submit/drainBatch. Review related lesson summaries, tables, examples
and conclusions. Run existing affected suites, real PostgreSQL lifecycle/race tests,
native browser journeys, exact-SHA CI/staging release checks and production reads.
The final per-ID ledger is evidence, not a substitute for execution.
