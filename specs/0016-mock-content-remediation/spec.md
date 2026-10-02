---
id: MOCKREPAIR-0016
title: Preserve mock paper security and repair Reading and Listening work truthfully
status: draft
risk: critical
owner: product
---

# Preserve mock paper security and repair Reading and Listening work truthfully

## Problem

The 2026-10-01 handoff records 368 findings across 80 Reading/Listening papers.
Completed QA is not evidence of a deployed correction. Current source confirms
that public visibility can bypass a future mock reservation; a live mock sitting
can obtain Listening dictation transcripts; and a direct attempt start can use
mock entitlement without persisting its sitting binding. Content status guards
also disagree across admin routes and can race a new reference. Hiding a paper
changes legacy policy fields without a complete restoration record.

Learners additionally lose review flags on resume, see blanks described as
wrong, receive different marking for equivalent typed values, or review letters
without the original options/summary. Review currently reads much of its context
from mutable source rows, although some Reading rationale is already frozen in
`grading_details`. These defects require source, runtime and historical evidence
to remain distinguishable throughout remediation.

The source audit used staging `0d9b886c56df87172b4cf09d8ed4232f9ea881f7`.
A later read-only production inventory located 80/80 paper IDs and verified the
backend runtime at main `f4f160b9330bc7fb3caa8bb4863ac49c226065c4`.
Neither fact supplies pre-audit policy values or proves a production leak.
The extracted source artifact's SHA-256 and protected corrections are in
[traceability.json](traceability.json).

## Scope

- Apply one purpose-aware Reading/Listening policy to catalog, direct/share
  content, start/resume, answer writes, submit, review, correction and dictation,
  and to all content/mock/retake/class writers affecting those rights.
- Permit safe historical metadata depublishing after proving no future or
  unfinished learner rights; preserve valid active work and submitted review.
- Keep truthful mutation errors, complete policy snapshots and safe restoration.
- Add reviewed item-specific typed equivalences, canonical owner-scoped review
  flags and submission-time question-context snapshots.
- Reconcile all 368 findings and all 80 papers against versioned correction,
  source/editorial/audio evidence and independent acceptance. Existing import,
  content revision and explanation-version contracts remain the starting point.

## Non-goals

- Automatic regrading, rewriting historical answers/grades, or reconstructing
  missing historical context/policy from today's source or an old UI badge.
- Archiving/deleting mocks, changing room clocks or assignment dates, removing
  dependencies, or fabricating an attempt binding to make a guard pass.
- A generic revision platform, cloning service, background repair worker,
  runtime translation, AI grading, or an unrelated Grammar/Writing redesign.
- Treating missing translation as an IELTS compliance violation, certifying
  Listening audio without listening, or reinstating withdrawn handoff claims.

## Users and journeys

- An operator changes a paper's status/visibility, sees the exact blocking
  dependency and whether the change persisted, and can restore a trusted policy
  snapshot without overwriting another operator's work.
- A learner enters or resumes the assigned mock section and receives usable
  content only through a server-bound attempt; pre-exam practice cannot reveal
  a confidential paper, and active delivery cannot reveal its transcript/key.
- A learner resumes the same attempt with its answers/flags intact and reviews
  the original question context with blanks distinguished from wrong answers.
- An editor and independent reviewer compare a proposed revision to permitted
  sources and mark each finding and paper accurately before release.

## Requirements

- **FR-001:** Every paper authorization decision distinguishes public practice,
  assigned class practice, mock delivery, owned active resume, submitted owner
  review, transcript/dictation/explanation access and admin preview. A catalog
  flag, share token, enrollment or sitting existence alone cannot override a
  confidential future/unfinished mock dependency. Checks run before sensitive
  payload reads or signed media issuance. A lookup/parse failure cannot grant
  access; owners receive actionable retry states without sensitive outsider
  resource disclosures.
- **FR-002:** Dependency eligibility aggregates every linked mock, retake/class
  assignment and valid unfinished attempt for the paper. A draft planned mock
  remains an explicit `planned_reservation` blocker. Published not-started or
  future-window exams, current sections, future/unbounded retake assignments,
  and valid unfinished owned work protect the paper. An ended sequential exam
  is historical only when `active_section=done` and no qualifying unfinished
  attempt/sitting remains; an expired retake entry window is historical only
  when no future assignment or valid finish/resume right remains. Malformed
  clocks or ambiguous orphan work block with a distinct reason. Safe historical
  references may remain linked while the paper returns to draft; submitted
  owner/admin review and persisted grades remain available. `is_open=false`,
  a closed badge, or an elapsed entry date alone is never sufficient.
- **FR-003:** Confidential overlapping mock use is the default. Ordinary public
  practice still works when no protected dependency remains. A deliberate
  public/practice assessment overlap requires an explicit admin decision naming
  every protected mock and paper revision, recording actor, reason and expected
  dependency/policy revision. It permits public practice only for that reviewed
  overlap and is never inferred from an old public flag; a later protected
  reference or revision requires another decision. The operator sees that
  prior public exposure cannot be undone by hiding a paper. A separately
  authored practice revision may be used where existing import contracts
  support it; no automatic paper duplication is required.
- **FR-004:** A new or resumed attempt admitted through mock entitlement is
  server-bound to the exact owner, sitting, paper revision and assigned section
  before usable content/answer writes. Omitting the frontend attach call cannot
  create or finish a standalone unsealed attempt. A submitted/voided/collected
  section cannot create a replacement usable attempt; ambiguous historical
  orphans require scoped investigation instead of guessed relinking. Existing
  valid attempts, idempotent start/attach/submit retries and genuine blank-paper
  collection remain recoverable without duplicate grading.
- **FR-005:** Sequential entry closure denies new entrants while preserving an
  existing valid active sitting's resume. Retake access requires its assigned
  skill and legitimate start/window/countdown contract; an entry window ending
  does not cancel an already valid finish right. Submitted sealed work exposes
  no key, transcript, rationale or explanation before its configured result/
  correction/capture release. Listening dictation/grade/session/flag and other
  transcript-bearing practice cannot reuse active mock-delivery permission.
  Submitted released owners keep their historical access after draft/archive;
  void/unsubmitted draft or archived sittings grant no new paper delivery.
- **FR-006:** All relevant writer paths enforce the same invariant in one
  serialized database decision: paper status/visibility/policy/restore, legacy
  archive/delete/metadata writers, mock create/link/swap/publish/room transitions,
  and retake/class assignment creation/window/status changes. A new reference,
  assignment or in-progress attempt racing public-enable/depublish cannot leave
  forbidden combined state. Multi-paper operations use a deterministic lock
  order; missing infrastructure fails closed. Status-only changes cannot alter
  content, attempts, grades, explanation versions or room timing.
- **FR-007:** A blocked mutation returns a typed error with operation, stable
  reason code, canonical dependency identities, current revision and safe next
  actions. Validated dependency conflict is 409; unavailable verification is
  503; permission/input/not-found retain their existing semantics. UI preserves
  the mutation notice through successful or failed list refresh, blocks duplicate
  submissions, and presents canonical readback separately from the mutation
  result. Lost acknowledgements are reconciled rather than declared successful
  or automatically repeated as a different operation.
- **FR-008:** Hide changes only explicitly requested policy fields. It does not
  implicitly clear `exam_only`, change explanation version, or release metadata.
  Each policy transaction records complete before/after values for status,
  `is_public`, `exam_only`, `public_practice_enabled`, explanation mode/version,
  released-at/by, approved overlap and policy revision, plus actor/operation.
  Restore names a trusted snapshot and expected current revision, reapplies
  current dependency checks and rejects stale or unknown-baseline requests.
  Concurrent edits cannot be overwritten. Existing atomic paper approval and
  service-role-only mutation privileges are preserved.
- **FR-009:** Newly revised answer items may declare a versioned response policy
  `literal`, `phone`, `number`, `date` or `option_id` using existing protected
  answer/payload metadata. Missing type never triggers numeric/date guessing.
  Matching and learner review use the same reviewed accepted-answer policy.
  Phone formatting removes only configured presentation separators and keeps
  every digit, leading zero and extension identity; numeric grouping follows
  the declared locale and preserves sign, decimal value, unit and magnitude.
  Date alternatives require explicit unambiguous item-supported forms. Word
  count/instructions and existing option/group identity remain authoritative.
- **FR-010:** Every added equivalence has source/item provenance and independent
  content review. `11000` and `11,000` match for a reviewed English-grouped
  integer item; `0412665903` and `0412 665 903` match for that phone item, while
  dropping its leading zero, changing a digit, or changing an extension fails.
  `11.000` does not mean `11000` under an English decimal policy; negative and
  positive values, `1.10` and `1.01`, wrong units, ambiguous date order and extra
  words do not gain credit. `hair/hairs`, `2D material/two-dimensional material`
  and duplicated option labels gain equivalence only from a reviewed item
  revision, never a blanket plural/synonym/label rule. Grouped multi-select
  remains cardinality/set aware and repeated selections cannot earn twice.
- **FR-011:** New attempts pin paper/answer-policy version before answering and
  persist that marking evidence on submit. Existing submitted grades, band
  estimates, keys, grouping and rationale snapshots remain unchanged; existing
  active attempts keep their original known policy. Unknown historical policy
  is labeled legacy/unknown and is not silently upgraded. Deployment, migration
  and content import perform no automatic regrade; any later historical score
  repair requires separate bounded approval, dry-run and original-evidence
  preservation.
- **FR-012:** Review flags persist canonically by owner, domain attempt and
  question identity with atomic idempotent flag/unflag writes and readback in
  start/resume. Reload, a second supported client and account switching cannot
  lose or cross-share flags; delayed earlier responses cannot overwrite newer
  intent. Flag writes cannot replace saved answers, reset countdowns, bind a
  different sitting or modify a submitted result. Unacknowledged local state is
  shown as pending/failed, with explicit retry and server reconciliation.
- **FR-013:** Result/review cards, filters, navigation and totals distinguish
  `blank`, `incorrect` and `correct` from persisted answers/grading. Blank still
  earns zero; display changes cannot recalculate grades. A QA-unanswerable control
  defect is an editorial finding, not evidence that a learner answered wrongly.
  Historical missing state uses explicit unknown/currently derivable provenance;
  renderers do not use client flags to infer correctness.
- **FR-014:** New submitted attempts freeze the context needed for each rendered
  question type: paper/version/hash, passage/section and referenced text/summary,
  stem/instructions, stable option IDs with labels/text, blank/table/diagram
  context, original accepted-answer policy, rationale/evidence and relevant
  transcript/audio asset identity/window when present. Existing `grading_details`
  and content revision/metadata structures are extended rather than replaced by
  a general snapshot service. Review uses the frozen submitted context even if
  current source is edited/deleted; sensitive snapshot fields remain protected
  by the same owner/seal/release rules and never enter pre-submit payloads.
- **FR-015:** Historical review keeps persisted scores/answers/rationale and
  explicitly labels per-field context as `submission_snapshot`,
  `verified_original_revision`, `current_content_fallback` or `unavailable`.
  A current source fallback is identified as possibly changed and never claimed
  to reconstruct the original question; an intentionally empty frozen field
  stays empty. Options/summary can be displayed as current fallback where useful
  without changing original answer identity. Missing explanation/translation
  receives a truthful unavailable state; coverage does not imply editorial
  approval or change the agreed release criteria.
- **FR-016:** All 368 stable finding IDs and all 80 source paper identities have
  separate validation, remediation, deployed-revision and independent-acceptance
  records. A paper's “revised” marker names the actual revision/hash, scope,
  reviewer and unresolved findings; QA finalized is never converted to repaired.
  A technical cluster fix closes a finding only after verifying its concrete
  paper/question behavior. Preserve withdrawn claims and evidence gaps, including
  R001-04 missing historical screenshots, C18R3 not submitted, C20L3 Q17 tester
  error and absent Listening auditory certification.
- **FR-017:** Content repairs for QA01/02/04/05/09 preserve stable option/group/
  question IDs, selectable keys, semantic blank locations, instructions and
  passage/table/diagram relationships. Each revision has a permitted source,
  before/after diff and editorial approval; no speculative key/claim repair is
  published. Replay/UI work for QA06/07 and missing support for QA10 retain their
  own concrete acceptance evidence. Audio/transcript/timing certification
  requires a real listening pass and is tracked separately from timer tests.
- **FR-018:** Affected operator/player/review surfaces have truthful loading,
  empty, success, pending/error/retry and permission states; keyboard focus,
  accessible notices, 44px actions, light/dark themes and reduced motion work at
  390/768/1180/1440 widths. Every supported control maps to the canonical question
  identity. Navigation/Submit stay reachable without whole-page horizontal
  overflow; review context and flags are readable without relying on color.
- **FR-019:** Additive migrations, request/success/error schemas, generated
  frontend types and old/new client compatibility protect the currently
  deployed consumer. Old clients missing a new purpose/flag/snapshot field
  receive a safe compatible contract or explicit retry/upgrade error, never an
  authority bypass. Staging migrations precede dependent code and exact-SHA
  backend, native browser, PostgreSQL concurrency/rollback and live staging
  gates precede promotion. Final reports separate patch, deployed code, content
  revision, data repair and acceptance; report completion to the originating
  report chat only from verified evidence.

## Acceptance scenarios

### Protect an upcoming paper through every entry point

- **Given** a confidential paper is bound to a planned/future mock
- **When** an outsider uses catalog/direct/share/start/dictation/correction paths
- **Then** no paper or answer-bearing content/media is returned; making the paper
  public is rejected with named dependencies unless the explicit overlap decision
  matches every protected current reference and revision.

### Close entry while preserving seated work

- **Given** the invigilator closes entry during Listening or an already started
  retake passes its entry deadline
- **When** the owner resumes and an outsider tries to start
- **Then** the owner retains valid work through a bound attempt, the outsider is
  denied, and neither can obtain a transcript/key through delivery permission.

### Depublish historical content without canceling a room

- **Given** every shared reference is historical, all relevant work is submitted
  or void, and no valid future/resume right remains
- **When** the operator requests draft and a second writer links a new mock
- **Then** serialized decisions either reject draft or reject/require readiness
  for the new link; no unpublished usable room exists. Existing grade and
  submitted owner/admin review bytes remain unchanged.

### Preserve exact typed meaning

- **Given** reviewed phone/number alternatives and negative controls
- **When** new-version answers are submitted through either domain
- **Then** approved formatting equivalents match, changed digits/sign/value do
  not, and old submitted attempts keep their original persisted result.

### Resume flags and original review context

- **Given** an owner flags a question, receives canonical acknowledgement and
  submits against version A before source version B is edited
- **When** the owner reloads/resumes/reviews or another account uses the ID
- **Then** the owner's flags and version-A context persist; the other account is
  denied; old unsnapshotted fields are clearly labeled fallbacks/unknown.

## Edge cases

- Multiple mocks use one paper; a future retake exists on a closed room; dates
  are null/unbounded or malformed; a started countdown crosses entry closure.
- A source/policy update races link/start/submit, or two admins restore different
  snapshots; malformed receipts, network timeout and deployment skew occur.
- A shared token predates reservation; a caller omits attach or duplicates flag/
  answer writes; an orphan's ownership/purpose is ambiguous.
- A historic source row is deleted or intentionally has no explanation; a
  grouped item has a shared bank/rationale; an answer looks numeric but is text.

## Success criteria

- No early sensitive payload in the complete role/purpose/lifecycle matrix;
  race barriers prove the persisted invariant and history remains unchanged.
- Typed marking's reviewed positive/negative cohort passes with zero added
  false-positive matches; flags and frozen context survive canonical round trips.
- All 368 findings and 80 papers have reconciled evidence-based outcomes; none
  claims revision, repair, audio validation or production restoration without
  the corresponding receipt and independent acceptance.
- Relevant full local suites and exact-SHA staging/release gates pass; incomplete
  evidence remains visibly pending instead of being hidden by deployment.

## Open questions

- Approve the recommended contract in [approval-decision.md](approval-decision.md),
  including the planned-reservation blocker and explicit per-overlap public
  assessment decision. This document remains **draft** until the owner approves
  intent and the approved spec-only change lands on the staging base.
- Production restoration scope/source baseline and any future score repair are
  separate operational decisions. No guessed restoration or regrade is implied
  by approving this implementation intent.
