---
id: LISTENING-0007
title: Versioned Listening editorial revision and bilingual questions
status: implementing
risk: high
owner: product
---

# Versioned Listening editorial revision and bilingual questions

## Problem

The published v1.0 General and IELTS packages are immutable. Their learner
payloads contain 65 identical generic lesson instructions, nine titles that
still announce draft/rewrite status, and five lessons without outcomes. The
player's English/Vietnamese pilot is hard-coded for 12 of 1,045 questions;
neither package data nor the import contract carries a reviewed translation.
The current toggle can therefore cover only two demo forms, and translating
prompts without their choice labels could change what learners think they are
answering.

## Scope

- Prepare new package IDs/revisions, leaving both v1.0 package bytes and the
  published release index untouched until direct or recorded delegated review
  and all release gates pass.
- Edit the 65 instructions, nine titles, and five missing outcome sets as
  learner-facing editorial content, with no change to audio, timing, answer
  keys, scoring, or report-only claims.
- Carry reviewed English and Vietnamese question prompts and choice labels as
  source-bound content, in approved batches until all 1,045 source items are
  covered. A question with identical labels in both languages may share them.
- Make the language control available only when a whole form has complete,
  source-matched translations. Preserve the original-language fallback.
- Give editors a per-batch diff with source ID, original wording, proposed
  wording, validation result, and explicit approve/reject state.

## Non-goals

- Runtime machine translation or automatically claiming machine output was
  editorially reviewed.
- Retrofitting the already published v1.0 rows in place, changing existing
  learner attempts, answer keys, audio, timing, or grading.
- Publishing any revision or declaring full bilingual coverage before all
  batches have been reviewed and the new package has passed complete import
  validation and staging verification.
- Turning programme practice into a test, adding IELTS bands/CEFR/mastery
  claims, or adding dictation in this revision.

## Users and journeys

- An editor compares each proposed lesson/question line with its exact source,
  approves or rejects it, and sees how much of each form remains untranslated.
- A learner chooses English or Vietnamese on a completely reviewed form,
  answers and revises normally, and can return to the original language.
- An operator validates and imports new package IDs as non-public content,
  inspects a complete diff, and records direct owner or explicitly delegated
  editorial approval before publish.

## Requirements

- **FR-001:** Every editorial entry is keyed by immutable programme/package
  source identity and exact source lesson/item ID. A source prompt or option
  mismatch fails closed; unknown, duplicate, or stale IDs are rejected.
- **FR-002:** Both v1.0 packages and their release-index bindings remain
  byte-for-byte unchanged. A new revision uses new package IDs and manifest
  hashes, with a rollback path that does not delete attempt history.
- **FR-003:** Metadata review covers exactly 65 generic instructions, nine
  draft/rewrite titles, and five empty outcome sets. Each proposed instruction
  names the listening action and avoids unsupported proficiency claims.
- **FR-004:** Each question has a complete, reviewed pair of prompt and
  selectable option labels in English/Vietnamese. Option keys, response type,
  maximum score, and protected answer mapping remain identical. Textual answer
  expectations are explained when switching display language.
- **FR-005:** Until an entire form is reviewed and source-matched, it renders
  the original question language without a misleading bilingual toggle.
  Choosing a language never changes saved answers, feedback, or progress.
- **FR-006:** Package validation checks the full artifact inventory, public vs
  protected boundary, 66 lessons/159 forms/1,045 items, audio/timing integrity,
  metadata counts, and translation coverage before import. Dry-run stays pure.
- **FR-007:** Import/publish remains package-scoped and idempotent. New revisions
  stage unpublished first; exact-SHA staging and representative learner review
  in both themes precede an explicit owner publish decision or a documented
  owner delegation of that decision.
- **FR-008:** Revision cutover must account for in-progress v1.0 attempts. A
  learner must not silently lose saved answers or be shown an unusable resume
  link; the selected cutover policy and any interruption window are explicit
  before direct or delegated publish approval.
- **FR-009:** A form using a learner visual offers a language switch only when
  its visible labels, title/description and accessible alternative are also
  reviewed in both languages. Localized visual variants preserve the same
  geometry, answer-letter anchors and protected-answer boundary.

## Review and release gates

1. Review each editorial batch against the source transcript/context and mark
   accepted or rejected items; no pending entry is represented as approved.
2. Approve this spec on the staging base branch before any runtime/importer
   implementation; the spec and implementation belong to separate PRs.
3. Validate and dry-run new packages without changing the current release
   index. Compare old/new IDs, counts, hashes, answers, media and timing.
4. Import the approved revision as non-public, check representative forms and
   existing attempts, then publish only under direct owner approval or the
   recorded owner delegation, with all technical gates passing.

## Acceptance scenarios

- A title or translated option copied against a different source revision is
  rejected before packaging.
- A mixed reviewed/unreviewed form keeps original-language questions and does
  not show an unusable language control.
- A fully reviewed form switches all prompts and choice labels between English
  and Vietnamese while answers, immediate feedback, and resume remain stable.
- Existing v1.0 attempts remain viewable if the new revision is unpublished,
  published, or rolled back; submitted attempt review is preserved, and the
  chosen policy for in-progress attempts is verified separately.
- Loading, empty, error/retry, permission, mobile/desktop, keyboard, reduced
  motion, and light/dark states remain usable on affected learner surfaces.

## Edge cases

- A corrected source prompt, changed choice label, stale translation ID,
  incomplete option set, or unreviewed form remains original-language only.
- A translated map question with an untranslated English diagram remains
  original-language only; a reviewed visual variant preserves the same A–F
  or P–U positions and remains legible in light/dark themes.
- A learner switching language after a saved or revealed answer retains the
  same selected option key and feedback; no duplicate attempt is created.
- A failed import, interrupted publish, or archived new revision leaves v1.0
  available and preserves existing attempt history.
- The current database permits only one published package per programme. A
  cutover must verify the old/new status transition and active-attempt policy
  rather than treating two independent status calls as atomic.

## Success criteria

- 66 lessons have truthful instructions/outcomes/titles after editorial
  approval; no draft/rewrite marker remains in a learner title.
- All 1,045 items are covered by reviewed bilingual text and choice labels,
  with zero source mismatches or missing/duplicate IDs.
- Full package validation, import dry-run, exact-SHA staging checks, and
  representative bilingual learner journeys pass before publication.

## Decisions and remaining gates

- The owner approved this contract, the 65/9/5 metadata packet, and batch 01's
  44 items against PR #1501 head `c19e7febb2b0a279c23b07d2d100799f6ffae93c`
  on 2026-09-24. The owner later delegated editorial validation and release
  without personally reviewing the remaining items. Publication
  remains subject to all technical gates.
- The full translation corpus will ship as one new v1.1 package per programme;
  never republish an existing package ID with changed bytes.
- The owner chose to block new v1.0 starts and wait for active v1.0 attempts
  to finish or expire before the controlled cutover. The current unique
  published-package index rules out simultaneous v1.0/v1.1 publication.
