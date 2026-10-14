---
id: VOCABSETS-0020
title: Vocabulary class sets and unified learning workspace
status: approved
risk: high
owner: product
---

# Vocabulary class sets and unified learning workspace

## Problem

Vocabulary mixes content collections and learning modes in five peer entry
points. Exercises adds a duplicate Flashcards entry, progress labels combine
saved words with demonstrated mastery, and existing personal stacks cannot
represent admin-authored sets shared across course levels and classes.

## Scope

- Adopt the approved Học theo lớp layout with one set-centred learner journey.
- Let admins add/select canonical vocabulary, publish ordered sets and distribute
  them to existing courses and cohorts.
- Reuse current vocabulary content, flashcard presentation, SRS and exercise
  logic for account-scoped study and assessment.
- Preserve existing personal vocabulary, quiz and D1 evidence.

## Approval

The product owner approved the Vocabulary audit and Học theo lớp proposal with
the message “proceed” on 2026-10-14 in the current task. The approved audit is
the 2026-10-14 Vocabulary audit; this spec records its product outcomes before
implementation. Production database changes and production promotion require
separate explicit release authorization.

## Non-goals

- Learner-authored shared words or shared sets.
- AI-generated content, paid grading, new background workers, matching games
  or listening-spelling modes in this release.
- Regrading, deleting or migrating historical learner evidence into claimed mastery.

## Users and journeys

- Admin: choose or add words, arrange a set, select its audience, preview it,
  publish it, and inspect learner outcomes.
- Learner: open Vocabulary, find a set for their class, choose a study mode,
  leave and resume, then review due or self-marked words.

## Requirements

- **FR-001:** Vocabulary provides persistent Học hôm nay, Bộ từ, Ôn tập and
  Tra cứu navigation; sets expose study modes locally, Exercises no longer
  duplicates a peer hub, and legacy links, browser history and return links
  preserve the originating set or collection.
- **FR-002:** Only admins author canonical shared cards and ordered sets;
  admins can select existing cards, add words, edit draft membership, preview,
  publish and archive a set, and success is shown only after canonical persistence.
- **FR-003:** Sets explicitly target the common library, existing course IDs
  or cohort IDs; course level and CEFR are distinct, learners see only published
  content in their permitted scope, and every learner write rechecks that scope.
- **FR-004:** Shared-card progress is stored per learner and canonical card ID,
  with distinct self-mark, recall evidence and SRS fields; different accounts
  never share progress, device changes resume acknowledged state, and replay
  of the same mutation never advances progress twice.
- **FR-005:** Thẻ ghi nhớ, Luyện nhớ, Điền từ theo ngữ cảnh and Kiểm tra use only
  members of the selected published set; missing examples/questions are reported
  honestly, deterministic grading remains on the backend, and Test answers are
  withheld until the immutable submission is accepted.
- **FR-006:** Learning sessions freeze the published revision and selected
  content, resume the same selection after reload, preserve accepted work on
  retries, reject conflicting replay, and retain historical results after
  later content edits or archival.
- **FR-007:** Existing personal vocabulary, flashcard reviews, Quick Check and
  D1 attempt history remain readable through their owning flows; new admin sets
  do not transfer personal ownership or copy legacy marks into mastery.
- **FR-008:** Hub and set progress distinguish saved words, self-reported
  familiarity, demonstrated recall and completed quiz sessions; importing or
  saving a word does not by itself count as mastery.
- **FR-009:** Learner and admin surfaces implement loading, empty, success,
  error/retry and permission states, respect account switches, both themes,
  320px/400px/desktop layouts, keyboard/focus and reduced motion; the primary
  learning action precedes cumulative metrics.
- **FR-010:** Admins inspect canonical set audience, publication state and
  per-learner study/results without invented completion or scores, and mutation
  acknowledgement agrees with a full reload.

## Acceptance scenarios

- Given an admin publishes a set for course C2, when an active learner in a
  C2 cohort opens Vocabulary, then that learner finds the set and its exact
  ordered cards without confusing the course with CEFR C2.
- Given two learners study the same shared card, when one rates or answers it,
  then only that learner's progress changes.
- Given a Test starts at revision A, when the admin later publishes revision B,
  then submission and history continue to use A's frozen content and answers.
- Given a save response is lost, when the client retries the same ID, then the
  backend returns the original receipt without duplicate attempts or SRS updates.
- Given a legacy AWL or topic link, when the learner opens and leaves the player,
  then the correct originating collection is restored.

## Edge cases

Multiple cohorts, cohorts without a course, removed membership, unpublished or
archived sets, empty sets, missing audio or examples, stale admin revisions,
concurrent progress updates, duplicate submission, network failure, account
switch and unavailable schema all have explicit states.

## Success criteria

An admin can publish one set to a named course/class; the eligible learner
can complete and resume each supported mode with correct account-scoped
evidence; a second learner and an ineligible learner cannot alter that evidence.
Existing Vocabulary journeys and history continue to work.

## Open questions

None for implementation. Production release remains a separate authorized step.
