---
id: LISTENING80-0009
title: Source-faithful 80-day Listening practice collection
status: approved
risk: high
owner: product
---

# Source-faithful 80-day Listening practice collection

## Problem

The supplied 80-day scanned book, transcripts and audio are not a uniform exam
bank. It contains short practice, teaching exercises, vocabulary references and
mock papers with variable question counts. The current programme importer and
player cannot truthfully represent missing audio, provisional answers,
unanswerable source questions or vocabulary-only days. Publishing raw OCR or
using every extracted key as an objective answer would give learners incomplete
questions and misleading feedback.

The immutable source at `PDF process/output/80-days-listening` has 80 day
packages, 70 transcript days, 69 day MP3s, 1,676 preferred answer positions
(1,198 short-practice, 69 teaching and 409 mock positions), 873 explicit printed
answers, two explanation-derived entries, 744 other answer candidates and 57
unresolved positions. Nine positions require an editorial prompt change.
Day 76 audio stops after Section 2; Day 77 has no supplied audio. Days 61–70
are vocabulary references. No day currently has a complete semantic grading
certification. Integrity and transcription audits are distinct from item
correctness.

## Scope

- Prepare and publish the whole source collection with all 80 days represented.
- Preserve source layout, question identifiers, audio, transcripts, answer
  provenance and explicit incomplete-content states.
- Provide genuine answerable Listening practice and persisted learner work for
  eligible parts, alongside useful vocabulary/source-study resources.
- Author Vietnamese explanations and independently review every answerable
  item; explain unresolved items using cited evidence and source limitations.
- Reuse programme attempt, reveal, result, private-media and release boundaries
  where their contracts fit the source; add only the missing collection support.
- Release through staging, then production with package-scoped rollback.

## Non-goals

- Inventing missing audio, transcript text, pictures, options or official keys.
- Claiming IELTS band, CEFR, mastery, psychometric equivalence or a complete
  official 40-question exam from the source mock papers.
- Replacing the existing General/IELTS packages, their active attempts, or the
  generic immutable-package validator.
- Runtime AI grading, paid AI evaluation or a new asynchronous job platform.

## Users and journeys

- A learner opens IELTS Listening Practice, selects the 80-day collection,
  chooses a day and sees its content type and actual asset readiness.
- A learner practises an eligible Part/Section, saves answers, reveals reviewed
  feedback for the answered item, listens again where supported, revises and
  submits. First answers and revised answers remain distinguishable.
- A learner opens a vocabulary day or an unavailable audio section as a clearly
  labelled learning resource without an unusable Listening attempt.
- An operator validates the complete source release, imports an unpublished
  package, verifies the pilot states on staging and publishes the reviewed
  collection. Archive preserves prior attempts and unrelated packages.

## Requirements

- **FR-001:** The collection represents all 80 original days and four source
  groups. Its item inventory preserves at least all 1,676 tracked preferred answer positions,
  question/exercise/section labels and question-resource coverage, with stable
  identifiers including exercise where numbering repeats. Vocabulary entries
  remain vocabulary content rather than invented question positions. An
  independent source walkthrough accounts for any additional exercises beyond
  the current preferred-answer inventory instead of treating that inventory as
  proof of source-question completeness.
- **FR-002:** Source files remain immutable. The release manifest binds every
  authored document, source reference and derived media asset by SHA-256 and
  records transforms, source PDF hash and source precedence. Explicit printed
  answers, explanation-derived entries, candidates and editorial answers are
  separate fields; the two derived entries are never called printed keys.
- **FR-003:** Learner question blocks preserve every required instruction,
  option, table, diagram and image in readable source-faithful form. Curated
  instructions and response controls match the source task and word/selection
  limits. OCR alone is not approval evidence. Derived crops retain provenance
  and must not clip context or expose protected answers.
- **FR-004:** Every day and Part/Section exposes truthful availability for
  questions, audio, transcript, printed key and reviewed explanations. Day 76
  offers only audio-covered sections as Listening practice; Day 77 offers no
  Listening start; Days 61–70 offer grouped vocabulary resources. Missing assets
  and unresolved questions remain visible with an understandable reason.
- **FR-005:** The full collection is reachable within IELTS Listening Practice
  with four content groups and day navigation. Eligible parts use real persisted
  practice; resource-only days remain reachable even with zero forms. Existing
  Listening routes, packages, counts and resume links retain their meaning.
- **FR-006:** Practice uses `report_only` and never emits band, CEFR, mastery,
  diagnostic weakness or official-exam claims. Variable-size mock days are
  grouped by authentic Section with separate local and source numbering.
  Completion denominators describe playable/answerable items and distinguish
  source positions excluded because of missing or defective evidence.
- **FR-007:** Every answerable item has an authored Vietnamese explanation with
  answer provenance, shortest sufficient source evidence, reasoning, relevant
  paraphrase and applicable answer-format/trap notes. Multiple-choice review
  gives a precise evidence-based reason for every printed distractor, and
  retains an ambiguous verdict if another option remains defensible. Every
  unresolved item has an evidence-backed limitation and next action. No generic
  filler rationale or unreviewed draft is represented as a reviewed explanation.
- **FR-008:** Independent item review records `CONFIRMED`, `SUSPECT`,
  `AMBIGUOUS` or `UNRESOLVED`, confidence, instruction/alternative checks and
  citations for every source position. Only eligible `CONFIRMED` objective items
  may receive correctness. Unconfirmed candidate, ambiguous, unresolved and textual
  self-review items never receive a machine correctness verdict. Key changes
  and edited prompts preserve the original and explicit editorial provenance.
- **FR-009:** Audio assets are private and authorized. Timing granularity is
  explicit: a source Day/Part window may support whole-part replay, but is never
  presented as a precise sentence/question anchor. Verified timestamps remain
  within the correct asset timeline; absent alignment is not fabricated.
- **FR-010:** Unrevealed learner payloads contain no keys, evidence quotations,
  explanation text, solved teaching answers or controlled transcripts. The
  existing owner/save/reveal boundary protects eligible question feedback;
  transcript access follows the accommodation/post-submit boundary. Resource
  study that intentionally reveals solutions is labelled as study and never
  recorded as independent practice.
- **FR-011:** Reload, retry, submission and history preserve the saved answer,
  immutable first answer and assisted provenance. Unavailable source positions
  and intentionally unscored items have explicit authored states; missing
  protected content caused by a technical failure remains a visible error.
- **FR-012:** Import is dry-run-first, package-scoped and idempotent. The new
  source collection coexists with published General and IELTS revisions.
  Conflicting immutable bytes fail closed. Publication requires complete
  content/media attestation, review coverage and staging journey evidence.
  Partial upload/import failure never makes incomplete content visible; retry
  verifies or resumes immutable asset uploads and atomically commits complete
  rows or leaves the package unpublished. Conflicting bytes require a new
  revision rather than overwriting assets or deleting attempt dependencies.
  Rollback archives only this package and retains attempt history.
- **FR-013:** New/changed APIs have concrete OpenAPI schemas and generated
  frontend wire types. Any schema changes are forward and backward-compatible
  with deployed consumers, with private assets and protected writes authorized
  through existing owners. Generic package validation remains unchanged.
- **FR-014:** Affected collection/day/player/result UI covers loading, empty,
  success, error/retry, permission, partial-source and audio-failure states;
  supports mobile/desktop, light/dark, keyboard focus, 44px targets and reduced
  motion. Image questions offer readable zoom and accessible curated text
  without changing answer mappings.
- **FR-015:** Completion requires full 80-day content validation, independent
  item and code review, applicable local suites, exact-SHA staging CI/journey
  evidence, package publication verification and the affected production
  journey after promotion. Each batch report states accepted/rejected counts,
  remaining work and release state without treating partial progress as done.

## Acceptance scenarios

1. Day 1 shows the original question block and permits answering. Its reviewed
   explanation cites the matching transcript and separately identifies the
   printed key; no protected answer appears before saved-answer reveal.
2. A Day 28 answer derived from audio/transcript retains that provenance. It
   cannot be objectively marked until item review confirms its instruction and
   alternatives; self-review is available only with reviewed reference content.
3. Day 29 Q13 remains represented with its unsupported departure-time reason.
   The learner can continue eligible work and the incomplete position does not
   inflate an accuracy or completion denominator.
4. Day 51 exercises with repeated Q1 have different IDs and matching images,
   instructions and feedback. Solved teaching examples are labelled resources.
5. Day 61 shows a complete curated topic vocabulary resource and no fake audio
   or question-key controls. Day 77 shows source-study availability but no
   Listening start; Day 76 starts only sections covered by actual audio.
6. Day 75 retains its 42 source positions and authentic sections. Local form
   numbers map explicitly to source labels without truncating or renumbering
   the original book as a standard 40-question test.
7. A retry or second import of identical bytes creates no duplicate content or
   overwritten media. Another published Listening package stays available.
8. An independent-practice source image crop with clipped choices or an
   embedded answer fails content validation; labelled solved study resources
   may show solutions. An unconfirmed choice item never displays
   correct/incorrect.
9. A learner who reveals one answer, edits it and reloads sees the first and
   revised answers and assisted state. Another item's solution stays protected.
10. Archive removes this collection from new starts while existing submitted
    review and unrelated programme content remain available.

## Edge cases

- Missing source audio, section coverage, image labels, word limits or reliable
  transcript alignment produces explicit source states, not guessed content.
- Multi-column OCR, cross-page choices, repeated numbering, picture questions,
  table cells and multiple-letter responses must preserve source geometry.
- Publication or asset signing failure fails visibly; private source solutions
  never become public to repair playback or image access.
- Another staging deployment may advance during work. Release evidence must
  bind to the actual current SHA and package revision, not an earlier green run.

## Success criteria

- All 80 days and source positions are accounted for; no omitted/mock-truncated
  day and no candidate labelled as a printed answer.
- Every displayed explanation has independent review and cited evidence; every
  incomplete item has an honest source state.
- Learners complete usable practice, reveal and review flows, including reload,
  across the representative and full release inventory without answer leaks.
- The source collection is published and verified on the requested web through
  the existing staging-first release gates.

## Decisions and approval

The owner requested a complete implementation on 2026-09-30, explicitly
delegated agent coordination and reviewer validation, and requested reports
after each batch. The earlier independent HTML demo and proposal establish the
four groups and incomplete-source presentation. The delegated independent
reviewer accepted this specification on 2026-09-30 after all five review findings
were resolved, including the full UI state and rollout documents. Approval is
limited to implementation intent; it does not certify the demo, source content,
answer correctness or release. This specification-only PR must land on staging
before runtime or importer implementation. Source-first pilot preparation may
continue outside the repository while that durable approval is pending.


### Later user-approved synthetic study audio — 2026-10-05

The user's later instruction to retain originals and create a new Kokoro version
for each lesson, followed by authorization to continue the complete collection,
adds optional, explicitly labelled synthetic free-study audio for all 80 days.
Days 61–70 pronounce the existing English vocabulary; Day 77 reads the supplied
printed English transcript. No missing Chinese story or dialogue is invented.
These supplements are not supplied source recordings: all 69 originals and
source-availability/coverage states remain unchanged. They do not enable
Listening starts for Day 77 or vocabulary days, add question/key controls, or
change practice audio, attempts or grading. The missing-source/non-fabrication
protections in FR-004 and acceptance scenario 5 remain in force for source
assets and independent practice. This later authorization permits labelled
synthetic study tracks; it does not certify human listening acceptance.
