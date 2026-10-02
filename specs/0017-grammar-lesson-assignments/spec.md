---
id: GRAMMARLESSON-0017
title: Assign individual MASTER30 Grammar lessons to Course 5 learners
status: draft
risk: high
owner: product
---

# Individual MASTER30 Grammar lesson assignments

## Problem

Teachers can assign a Quick or Full MASTER30 diagnostic, but cannot assign a
specific B01–B30 lesson to one learner or a chosen subset and see whether that
learner practised it. A diagnostic report names lessons to review, yet its
review route currently opens the general Grammar Wiki. Reusing diagnostic and
reserved questions as homework would weaken later diagnostic evidence.

## Scope

- Let a Course 5 teacher assign one Bxx lesson to one or more selected learners
  from the class workspace, with a due date and teacher instructions.
- Show the assigned lesson, its approved learning material and a separate
  practice activity in My Class; persist progress and the learner's result.
- Show each learner's canonical completion and practice evidence in the class
  workspace, including after reload.
- Permit an intentional later assignment of the same Bxx to the same learner,
  retaining earlier work as a separate historical attempt.
- Keep MASTER30 diagnostic selection, exposure and readiness reports independent.

## Non-goals

- Automatic assignment based on a diagnostic result or prior learner history.
- Replacing the Quick or Full diagnostic or changing its scoring and reports.
- Automatically grading open-ended sentence-writing or converting lesson work
  into an IELTS band.
- Publishing the MASTER30 lesson catalog for unassigned self-study.
- Requiring all 30 lessons to be ready before any reviewed lesson can be given.

## Users and journeys

- A teacher opens a Course 5 class, selects **Bài tập → Giao bài lớp → Grammar
  lesson**, chooses Bxx, sets recipients and due date, and sees whether the
  chosen lesson has approved teaching and practice content.
- A learner opens the assignment in My Class, studies the named lesson, submits
  its practice activity, sees corrections, and can revisit the completed work.
- The teacher sees the persisted per-learner status and result, then may assign
  the same Bxx again later to check retention without overwriting the first run.

## Requirements

- **FR-001:** The admin catalog lists B01–B30 from an approved MASTER30 release
  with stable IDs and titles. Each row truthfully indicates whether teaching
  content and a separate, reviewed practice activity are ready. An unready or
  wrong-course lesson cannot be assigned.
- **FR-002:** A teacher may assign one ready Bxx to a selected Course 5 class
  subset, including one learner, or to the whole class. The persisted assignment
  records the exact lesson, content revision, recipient scope, instructions and
  deadline. A repeated assignment creates a new history entry; an accidental
  duplicate submission of the same create request does not fan out twice.
- **FR-003:** Only the assigned learner with active class membership can open,
  submit or resume that assignment. The backend enforces publication and deadline
  rules; learner URLs do not grant access by themselves.
- **FR-004:** The learner sees the specific Bxx title, reviewed learning content,
  then lesson-specific practice and feedback. A missing content link or practice
  bank fails visibly before assignment rather than opening an empty player.
- **FR-005:** Practice uses a reviewed pool separate from all
  `DIAGNOSTIC_APPROVED`, `CONFIRMATION_RESERVED` and `HOLDOUT_RESERVED` MASTER30
  items. Answer keys are protected until the relevant answer is submitted, and
  the diagnostic exposure history is unaffected by practice.
- **FR-006:** Completion, answers, corrections and any score are persisted per
  assignment item. My Class, the learner result and the teacher roster read the
  same canonical state immediately after submission and after reload. Revisits
  do not create a second attempt for that assignment item.
- **FR-007:** An intentionally repeated Bxx assignment retains earlier answers
  and results, each tied to its own deadline and content revision. Content
  updates cannot silently change a started or completed learner result.
- **FR-008:** The admin and learner surfaces show loading, empty, ready, blocked,
  expired, completed, permission-denied and retry states accurately. They support
  keyboard use, focus visibility, responsive layout, reduced motion and both
  themes.
- **FR-009:** Existing course exercises, Grammar Wiki Quick Checks and MASTER30
  diagnostics keep their current behavior and history. Rollout can be disabled
  without deleting learner work.

## Acceptance scenarios

### Individual assignment

- **Given** a reviewed B04 lesson and practice activity and a Course 5 class
- **When** the teacher assigns B04 only to learner A
- **Then** A sees B04 in My Class, other learners do not, and the teacher sees
  one canonical recipient and its submission state.

### Repeated targeted review

- **Given** learner A has completed a B04 assignment
- **When** the teacher assigns B04 again with a new deadline
- **Then** A sees a new task and both attempts remain separately available.

### Protected diagnostic pool

- **Given** the approved MASTER30 objective release
- **When** a learner practises an assigned Bxx lesson
- **Then** none of the 733 diagnostic, confirmation or holdout items are served
  from that lesson and no diagnostic exposure event is written.

### Unready lesson

- **Given** B02 lacks a reviewed practice activity
- **When** the teacher views the catalog or tries to assign B02
- **Then** B02 is visibly blocked with a concrete reason and no homework ledger
  entry is created.

## Edge cases

- A learner leaves the class during an attempt; new reads and writes fail closed
  while completed historical evidence remains preserved under existing policy.
- Two browser submissions of the same answer do not duplicate or change a
  persisted result. An expired assignment accepts no new work.
- The teacher sees an explicit error if content readiness cannot be checked.
- A released lesson revision never retroactively rewrites prior evidence.

## Success criteria

- A teacher can assign one ready Bxx to one learner and verify the same result
  from the teacher roster and the learner's My Class after full reload.
- A repeated assignment preserves both attempts.
- Diagnostic item and exposure counts remain unaffected by lesson practice.

## Open questions

- None for product intent. Implementation may choose existing class-assignment
  and quiz contracts where they satisfy the requirements without widening scope.
