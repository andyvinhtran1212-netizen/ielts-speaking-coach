---
id: GRAMMARTEXT-0015
title: Require exact authored forms for bounded Grammar questions while preserving old work
status: approved
risk: high
owner: product
---

# Per-question Grammar text matching

## Problem

The actual instant quiz engine treats a one-edit answer as a typo even when the
edit changes requested tense or subject agreement. Five canonical R03 examples
accept has already left/has lived/has submitted/has been introduced/recommend
against had already left/had lived/had submitted/had been introduced/recommends.
Actual engine submit/drainBatch records each as correct and grants one production
credit. Academic wording fixes alone cannot prevent this false credit.

Authored strict/case_sensitive flags do not survive the fixed question parser
and DB row contract. Spelling types still fuzzy-match long phrases. The smallest
missing behavior is bank-owned per-qid matching policy in existing META, plus a
capability acknowledgement that prevents a client which understands bank revision
but lacks matching-policy support from starting corrected work.

## Scope

Only the twelve explicit canonical article codes in source-scope.md are eligible:
six existing F01, four R03 and two audited optional banks. This is a maximum
allowlist, not permission to publish twelve arbitrary files. Each source/map/hash
and changed-qid/field manifest is separately reviewed before use. Candidate
selection is 49 exact text qids and nine retained legacy qids among 264 questions;
source-scope.md names them. The independently approved source manifest is bound
separately in approval.md; contract approval alone does not approve source bytes.

Extend 0014's bounded cutover scope/metadata contract explicitly and synchronously,
retaining its ownership, immutability, paused continuation, provenance, receipt,
locking and rollback rules. No deploy/migration/startup publishes any bank.

## Non-goals

- A new grading platform, question/session policy column, table or global registry.
- Blanket strict mode for Grammar or new matching behavior for Vocab/course banks.
- Changing credit/mastery/score formulas, fuzzy thresholds or text normalization.
- Historical regrade, credit transfer, old-source overwrite or guessed ownership.
- Unbounded free-prose/synonym acceptance or a generic content editor/revision API.
- Declaring the three disputed generic passive/purpose sentences ungrammatical.
- Claiming a client capability marker proves tamper-proof server-side grading.

## Users and journeys

A learner opening corrected Grammar work receives a validated policy with its
frozen bank, acknowledges supported matching, and earns credit only for authored
accepted forms on exact items. Owned old work retains its original matching.
An admin previews an independently reviewed source/hash/map and creates a separate
corrected bank through the existing bounded cutover owner. History readers see
original prompts/keys/results without mutation.

## Requirements

- **FR-001:** Eligibility is exactly the twelve canonical codes in source-scope.md,
  grammar skill, validated article/topic identity and reviewed source/qid/map/hash
  manifest. Amend 0014's exact-six scope to this exact-twelve maximum on the base
  branch before implementation. Parser, source service, canonical enum, DB guards,
  facade and article resolution agree. Missing/unknown canonical bank or source
  proof blocks that bank; do not invent a predecessor or interpret missing as zero.
- **FR-002:** Optional META `text_match_by_qid` is a bank-local mapping of owned qid
  to literal `exact` or `typo_tolerant`. No wildcard/global/default-all or key
  coercion. Present map must be an object; each key names one supported text
  question (input:text, gap_text/spelling/missing_letters, valid nonempty string
  accepts). Reject unknown/duplicate qids, duplicate policy YAML keys even identical,
  aliases/merges, null/array/scalar/nested/bool/numeric keys or values, unknown values,
  and reserved __proto__/prototype/constructor keys. Validate before any mutation.
  Limit entries to the actual eligible text count and 200, and canonical UTF-8 JSON
  map to16KiB. Use own-property lookup even after validation. Empty object is legacy
  equivalent; approved source must still equal its reviewed selection exactly.
  Scoped raw parsing of bounded revision sources and any quiz source declaring this
  policy requires exactly one quiz META block. Reject multiple META even if identical
  or if valid-first/policy-missing-last; no last-META-wins fallback after YAML collapse.
  Guard this raw structure before safe_load in the existing quiz parser; do not
  globally tighten unrelated article or absent-map unmanaged legacy parsers.
- **FR-003:** Add the field only to the real quiz META parser/transport. Persist
  validated policy in existing quiz_banks.meta JSONB and deliver it with its bank.
  Generic imports may validate/preview policy but cannot retrofit a nonempty map
  onto an existing owned or published canonical bank; approved opt-in publication
  uses bounded revision cutover. Existing absent-map/unmanaged imports retain their
  contract. Persisted/delivered present invalid policy yields503/unavailable before
  admission/grading, never fuzzy fallback; engine direct use rejects invalid policy.
- **FR-004:** Exact named items try accepted equality under CURRENT normalization
  then return false before every fuzzy path, including long spelling/missing_letters
  phrases. Preserve trim, whitespace collapse, surrounding punctuation stripping,
  lowercase unless existing case_sensitive, interior punctuation and punctuation-only
  raw-trim comparison. All authored accepted alternatives remain accepted. Explicit
  typo_tolerant and absence use current legacy guards/thresholds/first-character and
  orthography/case-sensitive rules. No stemming, tense/number equivalence, contraction
  expansion, Unicode rewrite or new default helper behavior.
- **FR-005:** For any session-create request against a bank with a valid nonempty
  map, require typed request `text_match_policy: 'qid-exact-v1'` in addition to
  existing revision/admission fields. Requirement is derived from persisted bank
  metadata, including a map containing only typo_tolerant entries; clients cannot
  choose another map or opt out. Missing/null ACK with a valid revision fails409
  before INSERT; unsupported marker fails422; invalid stored policy fails503.
  Require ACK for run, continuation and explicit review admission. Check the actual
  immutable bank/revision/policy within the existing serialized DB admission owner,
  not only an earlier facade read. N-1/default/direct managed session writes cannot
  bypass this gate. Valid absent/empty-map starts require no ACK and keep legacy
  matching/admission; a supported redundant ACK is harmless there.
- **FR-006:** Served managed Grammar state and successful start echo supported
  `text_match_policy: 'qid-exact-v1'` only for a nonempty valid map, alongside frozen
  bank_id = frozen b.id and bank_revision = b.grammar_revision; absent/empty-map
  states omit only the optional capability. current_bank_id is canonical current
  mapping, not the selected bank and cannot prove frozen legacy identity. Extend concrete request/success
  schemas and generated types. Native player validates map and matching capability
  before sending ACK. The canonical delivered META is payload.bank.meta bound to
  payload.bank.id. A top-level payload.meta cannot override or substitute for it;
  conflicting policy presence/value or bank identity is invalid. An equivalent
  alternate is never selected as owner, and cannot cover missing canonical policy.
  Shared validation and engine consume this same canonical validated META; preserve legacy direct
  helper shapes/calls outside managed wire. A pure preflight engine may derive
  existing mastery/remaining before admission, with no submit/active learner engine/
  outbox/business writes. Only actual successful typed start ACK with verified
  frozen bank_id/revision/policy and async scope activates live engine/outbox. Stale/tampered/mismatched metadata or start response
  produces unavailable/reload, no graded/progress/end writes and no silent bank swap.
  A frontend request race cannot attach another bank's engine/policy.
  Repeated end of an already terminal owned session may omit optional grammar;
  verify owned stored bank_id/grammar_revision exactly, never look up current mapping
  or derive/backfill revision. Original pre-existing terminal NULL stays NULL;
  new/mapped managed admission has nonNULL frozen revision. Terminal compatibility
  does not bypass start/progress gates or change unmanaged optional/null semantics.
- **FR-007:** Academic authoring remains the exact bounded corrections in
  source-scope.md: visible tense/form cues, Type3 task clarity, main S+V/core versus
  full-clause distinction, past reference clarity and objective optional tasks.
  Preserve qids/order/pools/mastery/types. Relative to the prior reviewed corrected
  source baseline, further key changes are limited to the three
  named FALSE-to-TRUE cases ps_adv_a1, ps_vspc_a2 and pc_interrupt_a1 in their
  specified banks; their contextual grammaticality tasks remain meaningful. Further options
  differ only at pc_while_i1 index0 and pc_temp_a2 index3, with choice keys retained.
  Preserve reviewed F01 accepts and R03 short/full alternatives, adding only the
  independently approved which were published in journals at rrc_v3_i2 and the two
  already approved optional invalid accept removals. All these changes occur only
  in NEW revised banks, never original content or stored grades. The three disputed
  purpose/passive tasks use objective targets, not blanket grammaticality judgments.
  No unrelated source rewrite; final raw bytes/map/change manifests need independent
  root/content approval before implementation source allowlists or publication.
- **FR-008:** Approved policy participates in normalized META/question manifest,
  immutable revision hash, preview/CAS fingerprint and receipt. The only metadata
  exception to 0014's original equality gate is exact approved text_match_by_qid;
  preserve all unrelated canonical META extras. Corrected-bank creation explicitly
  copies approved policy and verifies actual DB readback hash; cloning old META alone
  is insufficient. Map tamper, missing persisted map or mismatch fails and rolls back
  before publication. Read retained canonical question extras including why_wrong
  during academic preflight; if a changed key conflicts, block for an independently
  approved source/extras decision. Unknown/unread extras are not zero and are never
  auto-edited/dropped. Use one final approved twelve-code source bundle; no interim
  six-old-hash publication then second cutover. Already-cutover code is blocked for a
  separate approved decision. No post-cutover bank/question/map edits or generic-import bypass.
- **FR-009:** Original owned bank/questions/META/map/revision/history remain immutable.
  Old absent-map continuation keeps legacy behavior; already admitted mapped work
  keeps its frozen map. No historical regrade/reset/credit/mastery transfer. Historical
  receipt/history GET journeys perform zero start/progress/end/reset writes. Existing
  explicit 0014 review admission may create one readonly session with required ACK,
  but writes zero attempts/mastery. Keep ownership/private-answer safeguards and all
  original 0014 legacy cohort/completion/receipt-retention behavior. The explicit
  current reset exception is governed solely by synchronized0014: server-only set-once
  grammar_reset_at TIMESTAMPTZ marks every prior owned-current NULL admission before
  stats deletion under existing reset locks; attempts/history/completion watermarks
  and nonNULL markers remain. Current paused continuation requires owned unmarked
  same-bank/revision run|continuation predecessor, canonicalremaining>0 and no
  completion watermark in its matching unmarked post-reset run/continuation group.
  Review is never predecessor/proof. No direct marker clear/mutation/transfer or
  cross-owner reset; no purpose/revision backfill. Include prior still-open and
  committed-start/lost-ACK admissions; do not reject reset merely because an old row
  is open. Under verified owner/frozen scope and the same locks, marked-session
  progress returns typed409 error_code=grammar_reset_stale before attempts/stats/completion/KP/telemetry;
  direct managed attempt/stat writes tied to it cannot bypass this guard. Preserve
  authorized reset stats deletion and canonical erasure exceptions. Marked owned-open
  end may only terminalize its same frozen row, retaining identities, markers and
  answers and producing no mastery/KP/new eligibility; terminal repeat-end stays
  unchanged. All current paused predecessor/continuation/completion-fence eligibility
  queries use only unmarked run/continuation admissions. Legacy reset/fence is unchanged.
- **FR-010:** Preserve complete learner/admin loading, empty, ready, feedback, error,
  retry, stale-content and permission states in ui-states.md. No technical qid/policy
  token in learner flow. Failed ACK/map/revision cannot show a ready exercise or
  optimistic saved/mastered state. Start is non-idempotent: committed start with
  lost ACK is unavailable, with exactly one POST for that action and no automatic
  POST retry/live engine/outbox/progress/end. User reopen explicitly reads canonical
  state then native create+canonical carryover under authoritative eligibility; a
  new session may result, not a promised same session/start UUID receipt. Admin
  cutover operation UUID/replay is separate; no new start idempotency platform.
  Keyboard/focus, reduced motion,44px targets, both themes and360/390/768/1440 apply.
- **FR-011:** Actual PG parser/persistence/cutover/admission tests, real engine
  negatives/legacy controls, actual delivered Next journeys and concurrency gates in
  verification.md are mandatory. No fake scorer, dropped q-level flag, mocked-lock
  proof, hidden skips or source-only grading closure. Gold target pass rate100%;
  measured wrong-form acceptance0/5; legacy expected outcomes unchanged; historical
  hash deltas from cutover0. Full affected suites and independent complete-contract
  review pass before CI/push or release.
- **FR-012:** Land separately reviewed approved0015 and explicit0014 amendments
  first; implementation is high-risk. Stage additive routine/allowlist changes before
  code; never edit an already-applied306 migration. Preserve N-1 absent-map clients
  and grants. Verify exact deployed staging backend/frontend SHAs before promotion.
  Explicit per-code reviewed source/hash cutover and canonical/historical readback
  follow backups/preflight. Publish only the single final approved twelve-code
  source/hash/map bundle, once per eligible code; no interim six old hashes or
  already-managed second-cutover workaround. Rollback disables new starts while retained compatible
  code finishes old/new admitted work; never remove mapped-bank matching/admission
  support, revert META in place, delete active revised banks or transfer credits.

## Acceptance scenarios

### Requested form versus one-edit morphology

Given corrected Past Perfect bank with reviewed nonempty map, when the compatible
native client acknowledges policy and enters has already left, the result is
incorrect and saved attempt contains is_correct:false with no new production credit.
Had already left and every explicitly accepted alternative pass. Old absent-map
owned work keeps its historical matching and no credit is transferred.

### Revision-aware client without matching support

Given correct bank_revision but no ACK, when any mapped run/continuation/review
session-create is attempted, it fails before INSERT. A supported ACK is accepted
only with canonical bank/revision/admission checks; typo_tolerant-only nonempty map
still requires it. Direct/default DB admission cannot bypass the check.

### Metadata identity and source review

Given independently approved source bytes/maps, when preview then cutover succeeds,
the corrected bank's actual persisted map/revision equals preview and original
META/questions/history are unchanged. A one-value map tamper or lost map aborts
without publication; retry after lost cutover ACK returns the existing receipt.

### Historical reads and explicit review admission

Given an owned old/new history record, reload/Back/Forward reads original evidence
with zero write requests. Separately, an explicit review-admission action can create
a readonly session, requiring ACK if mapped, while attempts/mastery remain unchanged.

### Bounded optional tasks

Given rewritten dm_clause_b2/dm_toinf_b2/dm_toinf_a1, keys assert expressed-subject
recognition or reject a universal passive guarantee. Explanations do not claim the
original generic passive/purpose sentence is categorically ungrammatical.

## Edge cases

Duplicate/alias malformed map; unknown or cross-bank qid; identical qid in two banks;
empty map; only-typo map; long phrase; punctuation-only answer; preserved alternative;
missing/unsupported ACK; old client with revision; stale schema-cache/RPC signature;
cutover/start/import race; pause/reload; lost start/cutover ACK; invalid response;
review-only user; missing original bank/cohort; over-limit proof; new starts disabled.

## Success criteria

Exact target gold all pass; the five measured morphology false positives all fail
without new credit; selected additional form controls fail; absent/typo legacy
controls and mastery formulas match baseline. Reviewed maps survive actual DB and
Next delivery, and unsupported mapped starts create zero sessions. Original source,
META/questions/history hashes are unchanged by cutover; both review journeys obey
their explicit write rules. Required exact-SHA staging/production evidence is complete.

## Open questions

Root approves this contract and synchronized0014 amendments separately from the
independently approved final source/map bytes; exact decisions and hashes are in
approval.md. plan.md lists bounded implementation decisions requiring actual source
and PostgreSQL proof: safe RPC signature/grants/cache compatibility, scoped YAML
key/alias rejection, concrete response shape omission and canonical footprint.
None permits weakening requirements or implementing before approved base landing.

## Additional admission/reset/terminal acceptance

- Valid managed canonical META and pure preflight preserve baseline remaining and
  all-mastered gates with zero submission/write. Conflicting wire/multiple raw META, malformed
  map or state/start bank_id/revision/policy mismatch leaves unavailable, no live engine.
- Server commits start but ACK is lost: client makes one POST, never retries it
  automatically or sends progress/end. Explicit reopen GETs canonical state then
  may create a different session using authoritative owned unfinished carryover.
  No learner UUID/start receipt is invented from admin cutover operation receipts.
- Current reset marks prior owned-current admissions NULL→DB transaction timestamp
  before stats deletion. Prior marks/history/attempts/completion remain. New paused
  post-reset run continues only within unmarked same-bank/revision run|continuation
  group with remaining>0 and no completion; marked/review rows never prove eligibility.
  Legacy consumed completion/reset fences and erasure boundary remain unchanged.
- Terminal repeated end without grammar envelope validates owned stored frozen
  bank_id/grammar_revision; original NULL is exact NULL, mapped/new is nonNULL.
  No lookup current mapping/backfill or NULL loophole for start/progress.
- Read canonical why_wrong/extras before changed-key publication. Conflict/unknown
  data or already-cutover code blocks; no automatic editing or intermediate six
  old-source publication. Final twelve-source/map/hash approval is independently required.

## Approved reset-stale lifecycle clarification

Explicit owned-current reset marks every prior same-current-bank admission, including
still-open/lost-start-ACK rows, once before stats deletion. It neither closes these
rows nor changes saved answers, results, completion markers or prior nonNULL reset
marks. A marked session cannot submit new progress: verified owner/frozen scope and
locks precede typed409 error_code=grammar_reset_stale; refusal occurs before attempts/stats/completion/
KP/telemetry. UI displays stale/reopen without automatic progress retry or optimistic
saved/mastered truth. Explicit reopen reads canonical state and follows existing
create/carryover rules, not automatic resubmission or session recovery. Marked owned
end is history-only terminalization of the same frozen row, with no mastery/KP/new
eligibility. Every current paused proof/predecessor/completion-group gate excludes
marked admissions; readonly review remains no proof. Unmanaged and original legacy
cohort/reset/completion/erasure behavior is unchanged.
