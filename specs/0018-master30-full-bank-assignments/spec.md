---
id: MASTER30FULL-0018
title: Assign the complete original MASTER30 Grammar banks
status: approved
risk: high
owner: product
---

# Full original MASTER30 assignments

## Problem

The user supplied thirty original banks and expects one hundred core questions
per lesson. Deployed GRAMMARLESSON-0017 v2 has twelve newly authored MCQs. Its
mini practice approval cannot certify the user's full original bank request.

## Scope

- Thirty full original banks: ninety MCQs and ten core E writing items each.
- Preserve one hundred extra source writing backports across fourteen lessons.
- Reuse individual Grammar assignments, frozen history, class ledger and reports.
- Correct a release copy with independent senior review of every item.
- Protect diagnostic validity when original practice overlaps its pool.

For v3 full banks, this spec supersedes GRAMMARLESSON-0017 FR-005's separate
pool and FR-009's diagnostic-unchanged clause. Old v1/v2 attempts and content
remain immutable. Existing user continuation and release authorization applies.

## Non-goals

- Replacing supplied questions with short practice or deleting writing additions.
- Editing the source library, unrelated Course 1 or Advanced Vocabulary banks.
- Automatic IELTS bands, writing correctness certification or a new AI grader.
- Assigning real learners during acceptance, new content/audio/worker platforms.
- Fake diagnostic sessions or a new exposure persistence table.

## Users and journeys

Teachers select B01–B30, see exact counts, and assign to one learner or a subset.
Learners start a frozen bank, submit MCQs and E text, compare saved work with
feedback, and revisit it. Teachers read actual writing alongside model/rubric
and separate objective accuracy and writing submission counts.

## Requirements

- **FR-001:** All thirty ready v3 banks preserve every original stable ID: ninety MCQs, ten core E items and all additional writing backports. Source/corrected hashes and provenance are recorded. An independent senior reads every prompt, option, key, explanation, model, variant and rubric and approves exact final content. Shape and mirror validation alone cannot approve quality. Catalog distinguishes full banks from mini history and gives blocked reasons.
- **FR-002:** Individual/subset/repeated assignments preserve canonical ownership, deadlines, idempotency and immutable revisions. Starting freezes the complete bank before serving questions. Content or rollout updates never recompute earlier started/completed v1/v2/v3 work.
- **FR-003:** MCQ and nonempty writing answers persist atomically under the same attempt lock. Owner, membership, publication, deadline, frozen revision and question type are enforced. Same-answer retries are idempotent; conflicting retries cannot overwrite; concurrent MCQ/E writes cannot lose answers.
- **FR-004:** Unsubmitted questions reveal prompts and controls but no key/model/variants/rubric. Saved MCQs reveal key and explanation; saved E text reveals its model, accepted variants, output requirements, explanation and rubric for comparison. Writing is explicitly ungraded; grammar cleanliness or string match cannot certify task attainment or imply an IELTS band.
- **FR-005:** Completion requires all assigned source items including additions. Objective accuracy uses ninety MCQs, with separate writing submitted counts and no E correct/incorrect claim. Learner, My Class, roster and teacher report agree with persisted answers/counts immediately and after reload. Failed lookups are unavailable progress, not zero or an empty hand-in.
- **FR-006:** A started full bank records actual exposure of every served frozen question, retaining original IDs and complete q-matrix family/parallel mapping. Diagnostic selection excludes affected IDs/families/parallel sets even after archive or flag disable. Practice writes no fake diagnostic events. Pending items, finalization and concurrent practice/diagnostic requests cannot bypass exclusion or certify newly exposed evidence as independent. Failed exposure/mapping reads fail closed; insufficient independent evidence is visibly blocked. Diagnostics completed before practice remain preserved. Pre-start teaching uses independently reviewed v2 notes without protected examples.
- **FR-007:** Concrete additive OpenAPI and UI contracts distinguish MCQ/E, core/additions, counts, saved feedback and completed/expired/paused/unavailable states. Loading, permission and error/retry preserve drafts and reject stale-account data. Affected views support keyboard/focus, reduced motion, both themes and mobile without overflow.
- **FR-008:** A separate default-off full-bank flag enables only exact approved v3 after schema and exposure guards are ready. Backward-compatible migration retains legacy attempts. Disabling creation preserves history and exposure safety. Exact-SHA staging then production acceptance verifies all thirty full banks using synthetic identities, including writing, old history and diagnostics, before readiness is reported; task fixtures are safely cleaned.

## Acceptance scenarios

### Full B26

- **Given** B26 with100 core plus20 extra E items
- **When** a learner submits its full assignment
- **Then** all120 original IDs persist; accuracy is out of90 and30 E submissions are ungraded.

### E feedback

- **Given** an E task requiring meaning and explanation
- **When** a clean sentence omits the required meaning
- **Then** its exact text/model/rubric are saved and shown without a correctness claim; identical retry preserves it.

### Diagnostic exposure

- **Given** full-bank practice starts before or during a diagnostic
- **When** affected evidence is selected or finalized
- **Then** original/family/parallel exposure prevents independence claims, including pending/racing operations; exhaustion is explicit.

### Legacy history

- **Given** completed12-question v2 work
- **When** full banks are released/disabled/reassigned
- **Then** original questions, answers and scores stay unchanged and readable.

## Edge cases

Duplicate/conflicting writes, response loss, membership/expiry, concurrent E/MCQ,
account changes, missing content/mapping hashes, diagnostic races and exhaustion.

## Success criteria

Thirty exact senior-approved banks,2700MCQs and400E items, verified through real
assignment/result/report paths with traceable IDs and safe diagnostic evidence.

## Open questions

None for product intent. The user explicitly requires100 original questions and
continuation to completion. Content approval and release evidence remain gates.
