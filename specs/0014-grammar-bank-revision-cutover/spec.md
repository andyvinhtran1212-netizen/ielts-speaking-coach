---
id: GRAMMARCUTOVER-0014
title: Preserve Grammar quiz history during bounded bank revision cutover
status: approved
risk: high
owner: product
---

# Bounded Grammar bank revision cutover

## Problem

The six Grammar articles corrected for F01 have separately persisted quiz banks.
Their authored banks still reject valid contextual uses of love/want continuous.
The source correction reviews 26 affected-family questions and changes 23 of
154 questions; it preserves authored qids/order/mastery metadata. Production
read-only evidence confirms all six banks published, with session counts
0/1/1/3/0/4 for verbs/passive/past continuous/present continuous/perfect
continuous/present simple. Zero counts do not fence future starts.

The current atomic importer replaces all question rows. It cannot preserve old
question UUIDs or historical prompt/key/explanation evidence. Grammar mistakes
join current questions by bank_id/qid, even though persisted Grammar accuracies
remain stored. A suffix-code clone does not attach to the article CTA; the CTA
matches an exact code. Unpublishing an old Grammar bank blocks owned reloads.
Native quiz reload/start creates a new session with word-stat carryover, so an
open-session-only exception would also lose paused unfinished legacy work.

## Scope

Only these six canonical article codes are eligible:

- G-parts-of-speech-verbs
- G-sentence-structures-passive-voice
- G-tenses-past-continuous
- G-tenses-present-continuous
- G-tenses-present-perfect-continuous
- G-tenses-present-simple

Provide one controlled revision cutover per code for the reviewed authored
correction. Reuse existing quiz banks/questions/sessions, validated bank parser,
SQL transaction ownership and append-only governance audit. Preserve the existing
skill/topic/code uniqueness constraint. Do not repurpose topics as archives.

## Non-goals

- A general content editor, revision platform, background job or regrade system.
- Changing quiz scoring, mastery/filler policy, IELTS bands, RLS or role grants.
- Editing, deleting or regrading historical work as part of remediation or
  cutover. Existing canonical account erasure remains supported as below.
- Migrating learner mastery to the corrected bank or pretending it was earned
  under the corrected question set.
- Replacing the six source corrections with weaker UI-only explanations.

## Users and journeys

An admin reviews source/key diffs and a bounded canonical footprint, then
performs a revision with an expected fingerprint and operation identity. New
compatible work receives the corrected article bank. A learner with unfinished
pre-cutover work continues the original immutable bank, including after a pause
or reload. Historical review continues to show the original questions and keys.
Completed legacy learners may read their history and start corrected content as
new work, without a silent mastery reset or credit transfer.

## Requirements

- **FR-001:** Eligibility is the exact six-code allowlist, grammar skill,
  canonical article identity and original topic association. Source input is the
  reviewed six-bank correction, validated through the real existing parser and
  mastery/link gates. Preview binds exact raw-source SHA-256 and normalized
  question/metadata manifest. Reject unrelated codes, duplicate qids, invalid
  keys, unresolved article links and an unapproved wider question-set change.
- **FR-002:** Preserve every original bank/question ID, qid/order, source
  prompt/options/key/accept/explain and historical association. Create a separate
  corrected bank with a deterministic server-generated physical code and the
  same topic/skill. Add explicit canonical article mapping/current-revision,
  predecessor and immutable revision fingerprint fields; do not relax existing
  uniqueness. Learner article/exercise resolution selects exactly one current
  published bank, never first-match duplicate codes or a guessed latest date.
- **FR-003:** Preview and commit are concrete admin-only OpenAPI contracts.
  GET returns bounded source/footprint fingerprints and current bank/revision;
  preview returns the validated diff and source hash; commit accepts only the
  reviewed source, expected canonical fingerprint, preview fingerprint and UUID
  operation identity. Server derives topic, physical code and new mapping.
  Clients cannot replace arbitrary bank IDs, keys or associations.
- **FR-004:** Commit serializes the stable canonical bank scope before receipt
  lookup, fingerprint/CAS and all mutation. Question locks plus verified immediate
  FK protection fence deletes/updates/inserts while the source is fingerprinted.
  Create corrected bank/questions, select it as current and append receipt in
  one SQL transaction. New-start admission in the same managed scope serializes
  against cutover, including older/default/direct session writes. Managed
  progress, reset and finalization use the same scope and documented lock order
  while eligibility is frozen or consumed; a content/start lock alone cannot
  prove a stable carryover snapshot. A start before
  cutover retains the old bank; a start after cutover cannot accidentally create
  unrelated new legacy work. Canonical account erasure also serializes at this
  scope before parent deletion and its child FK actions, so classification
  cannot freeze an owner while the same transaction erases that owner's work.
  No partial publication or two current banks.
- **FR-005:** Freeze the old bank as immutable legacy evidence and define
  continuation eligibility from provably owned unfinished canonical work at
  cutover. Compute mastery with the existing engine's supported-input item pools,
  distinct confirmed skills/credits and production requirement under immutable
  original metadata. Do not infer mastery from `ended_by` or `word_stats.status`.
  Include paused work, admitted zero-attempt work without contrary completion
  evidence and completed sessions with unfinished carried-over items. A stale
  empty open session after true all-mastery does not create eligibility.
  Classify provably unfinished, genuinely mastered, never-started and unknown
  separately. Missing/reset/review provenance, malformed/orphan progress and
  partial storage reads block that bank's preflight and cutover BEFORE any
  publication; counts-only UI must say authoritative review is required. Do not
  freeze an incomplete cohort then make a promised paused owner unavailable.
  Persist a bounded private cutover snapshot with owned admission/progress
  references in the existing operation receipt, never public learner IDs.
  Proposed hard bounds are 128 actors, 2048 sessions, 8192 stats and 32768
  attempts per bank and 1 MiB encoded proof/receipt; exceeding any bound fails503
  without truncation or publication. These limits must be reviewed before
  approval; this capability does not introduce a generic cohort store.
  A proven cohort member with no terminal completion marker and canonical
  remaining work may create a new legacy continuation. For an older native
  `{bank_id}` request the server derives continuation kind and frozen revision
  from that proof; do not blanket-reject eligible old reloads or let the client
  choose another bank/purpose. Never adopt corrected keys. Newly created managed
  sessions record immutable server-validated run/review/continuation admission,
  owned same-bank predecessor and frozen revision; no purpose backfill is guessed
  for old sessions. A server-only set-once mastery-completion watermark is
  persisted as soon as accepted canonical progress reaches all-mastery under the
  same scope lock, without waiting for end ACK. That consumes old continuation
  admission permanently. Legacy reset/delete or stale parallel snapshots cannot
  erase that fence or reduce retained completed mastery. Already admitted old
  parallel sessions may still read, append owned attempts and finalize history;
  responses distinguish accepted attempt history from retained canonical mastery.
  Review admission cannot write graded attempts/mastery. Completed-history-only
  users retain historical reads and may start corrected content as new work.
  Cutover itself does not edit original sessions/results/progress, and never
  changes the existing scoring/credit/mastery formula.
  Preserve the existing migration119 account-erasure boundary: deletion of an
  auth.users owner may cascade that owner's sessions/attempts/stats. The narrow
  exception applies only when the canonical auth.users parent is already absent
  inside its FK action; a direct child delete with a live owner remains blocked.
  Allow an associated last_session_id to become NULL only under that same erased
  owner condition, preserving all other fields except the existing timestamp
  trigger. Never permit owner transfer, another owner's deletion, bank/question
  changes or receipt mutation through this exception. Erased owners cannot gain
  new continuation or have their deleted history reconstructed from proof.
- **FR-006:** Compatible new starts explicitly bind the returned current bank
  and revision fingerprint. Freeze that identity in the session contract and
  use it for reads/progress/completion/history. Older/default clients on
  unaffected banks retain behavior. An old active eligible client may continue
  legacy work as explicitly derived under FR005; an unversioned request to a managed corrected bank or a stale
  ineligible old bank fails with a clear reload/update state before creating a
  session. Never silently map old bank IDs to corrected questions.
- **FR-007:** Lost ACK/retry with the same actor, canonical code, operation UUID
  and payload returns the original receipt without a second bank or write.
  Identity is the tuple action+actor+canonical_code+operation_UUID. Reusing that
  exact tuple with a different payload fails409; the UUID by itself is not a
  global identity, so another actor/code is a distinct scoped operation subject
  to its own auth/CAS, not a promised global-UUID conflict. Receipt reads
  are bounded parameterized server-side lookups by action/actor/operation/code;
  tolerate unrelated non-JSON audit TEXT. Duplicate/corrupt matching receipts or
  missing continuation evidence fail closed as unavailable, never guessed
  success. Return committed and current revisions separately after later state
  changes. Audit failure rolls back publication/content.
  Keep the immutable private cutover receipt/cohort proof as long as any legacy
  admitted, continuable or historical dependency remains, including rollback.
  No TTL/purge or generic audit-maintenance deletion may remove this bounded
  required proof. Protect its append-only retention at the actual write boundary;
  missing-proof503 does not substitute for promised retention.
  Account erasure does not delete or rewrite the private operation receipt,
  following migration107's existing no-FK audit survival. Its pseudonymous
  admission references confer no ownership after the canonical owner is erased.
  This clarification adds no TTL, retention platform or new erasure service.
- **FR-008:** Generic bank import, direct replacement, question mutation, bank
  deletion and destructive admin updates reject managed current/legacy banks.
  Keep old/default import of unmanaged banks unchanged. Safeguards operate at
  the actual DB write boundary as well as app validation; a concurrent generic
  import cannot bypass cutover locks or destroy an already frozen bank. Allow
  only the narrowly authorized mapping transition, not a generic editor bypass.
- **FR-009:** Admin and learner surfaces show truthful current/legacy content
  state, loading/empty/error/retry/permission and content-revised states. An
  unfinished legacy learner can choose continuing the old work or starting the
  corrected bank as separate new work, with no automatic reset/credit transfer.
  History preserves the old stem/key/result. Use generated wire types and
  runtime validation. Keyboard/focus, reduced motion, 44px targets, both themes
  and 360/390/768/1440 widths are acceptance criteria.
- **FR-010:** Migration is additive and staged before dependent code. No
  production cutover happens during migration/deploy/startup. After exact-SHA
  staging verification, an explicit bounded admin operation applies only the
  reviewed source/hash per code. Record original/current bank, source/question
  fingerprints, eligibility proof and backups. Rollback disables new starts
  without making old or corrected active work unreadable/unfinishable. Never
  delete a corrected bank that has activity or restore by overwriting historical
  questions/results. Final acceptance records frontend/backend SHAs and canonical
  bank IDs/revision hashes in both environments.

## Concrete contracts

Proposed routes under existing require_admin:

| Route | Input | Success |
| --- | --- | --- |
| GET /admin/quiz/grammar-revisions/{canonical_code} | exact allowed code | current bank ID/revision, original topic, question/metadata hashes, comprehensive bounded history/open/paused/assignment counts, eligibility classification; no learner identities |
| POST .../{canonical_code}/preview | source_markdown max256KiB, expected_revision 64 lowercase hex | source_sha256, preview_fingerprint, changed-qid/key manifest, validation messages, footprint and proposed new revision |
| POST .../{canonical_code}/commit | same source and expected_revision, preview_fingerprint 64hex, operation_id UUID | receipt, action applied/replayed, old/new bank IDs, committed/current revision, preserved-history fingerprints, canonical readback state |

Reject unknown request fields/types/nulls. A source parse failure is 422; source
or preview conflict is 409; missing/wrong scope is 404; auth remains 401/403;
storage/receipt/footprint unavailable is 503 with no mutation. Do not turn a
partial footprint into zero. Preview does not reserve a revision: commit
revalidates source and CAS under locks, while legitimate learner progress may
continue without invalidating a content fingerprint.

Minimal additive data shape, subject to technical review before approval:
quiz_banks canonical article code, immutable revision hash, current marker,
predecessor bank ID and retirement timestamp; quiz_sessions nullable frozen
Grammar revision, immutable managed admission kind and owned same-bank
predecessor_session_id, plus server-only set-once grammar_mastery_completed_at.
The completion marker may be recorded on an already admitted original session
when its future accepted canonical progress completes; existing purpose remains
unknown rather than backfilled. Existing bank_id freezes the immutable question set. One
partial unique current-mapping constraint covers the six managed identities.
Eligibility proof and operation receipt use the existing private audit row,
bounded to this operation; no new general-purpose table or public user list.

## Acceptance scenarios

- Concurrent start/cutover/import has one linearization: old admitted work keeps
  original keys; new compatible work chooses corrected keys; a conflicting
  import fails without deleting old questions or creating two current banks.
- Pause an unfinished legacy run, cut over, reload with an older client and
  continue: old raw questions/mastery remain, no silent upgrade or reset. A
  completed session with `carried_over` still reloads unfinished original work.
  A true all-mastered owner, including one with a stale empty open row, can read
  old mistakes/history but does not create a new
  old-version run through reset or stale bookmark.
- Retry after lost ACK: one new bank and one receipt, exact same IDs. A changed
  source/operation pairing returns409. Missing/corrupt proof fails503. Unknown
  reset-versus-review cohort and over-limit evidence block cutover before writes.
- First all-mastery progress saves but end ACK is lost: no new old-bank session
  or reset reopens admission. Parallel already-admitted attempts still append
  and finalize; stale snapshots retain completed mastery with truthful response.
- New source accepts contextual love/want forms while malformed know/is-want
  controls remain wrong. Source/key labels match independently reviewed bank
  fixtures; preserved historical scores and question hashes are unchanged.
- Disable new starts after some corrected activity: both old and corrected
  active work still finishes under its frozen bank; no historical regrade.
- Erase one canonical account through the existing auth.users deletion: only
  its FK-bound progress disappears, other owners and all bank/question/receipt
  hashes remain unchanged. Direct child deletes and link clearing while the
  owner exists are rejected. Concurrent erasure/cutover has one serialized
  outcome; an erased owner cannot resume from a retained private receipt.

## Success criteria

All FR-linked actual-PG, contract, source-gold and browser evidence passes.
Every old bank/question/history hash remains unchanged; corrected canonical
mapping and compatible new grading use reviewed keys. Both pre-cutover open
and paused unfinished work continues under original content after reload.
Final staging/production bank IDs/revisions and deployed SHAs are recorded,
with a rollback that preserves all admitted work and never regrades history.

## Approval record

Approved2026-09-30 under the user's authorization to complete validated
remediation with controlled agents and independent review. Root approves this
bounded product contract and each independent cap: 128 actors, 2048 sessions,
8192 stats, 32768 attempts per bank and 1MiB encoded private proof/receipt.
Any exceeded cap or unknown cohort blocks that bank before publication.

Clarification approved2026-09-30 under the same authorized remediation: preserve
existing migration119 canonical account erasure while retaining migration107
private audit proof. This is a narrow FK exception to learner-history retention,
not authorization for remediation to delete historical work. Independent
engineering actual-PG probes confirmed that canonical parent absence separates
the FK cascade from direct child deletion. Implementation and erasure/cutover
race acceptance remain required after this separately landed clarification.

Content council and root independently reviewed the 26 affected stative-family
items, with 23 authored changes across the six sources. Admin engineering
reviewed final draft SHA bd0a5b92b2020abb9d0e8761864b11c46dbef82ec574ff149b9706d9cdd3f9d2,
including scoped receipt identity, immutable retention, continuation provenance,
first-progress mastery watermark and preservation of parallel admitted history.
The unchanged existing-column classifier was exercised on canonical PostgreSQL
shapes: 23/23 cases passed, with 22/22 persisted-readback engine parity and one
malformed shape gated before the engine. External audit evidence is recorded in
admin-grammar-cutover-review.md and the classifier scripts/results.

This separately landed approval permits implementation only after it is on the
base branch. It does not approve live cutover, claim production cohorts are
within bounds, or prove feature locks, immutability, retention, browser behavior
or deployed acceptance. No learner history is regraded or overwritten.

## Open questions

None in this bounded behavior. Unknown/reset/review provenance, partial evidence
and missing configured transaction/FK guarantees remain explicit implementation
or per-bank operational blockers; they cannot be guessed or weakened. Production
source/hash, backup and authoritative preflight are required before each cutover.
