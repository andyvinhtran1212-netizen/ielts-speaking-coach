---
id: SKILLDRILLS-0054
title: Assign published Listening Skill Drills across courses
status: approved
risk: high
owner: product
---

# Listening Skill Drill homework

## Problem

Listening Skills is available for independent practice. Teachers need to assign the same published drills to classes and see what learners completed, how they used the audio, and which words they had difficulty transcribing.

## Scope

The existing Listening Skills catalog, admin class assignments, learner test and dictation players, and the submission report for assigned drills.

## Non-goals

Content reimport, course or level tagging, changes to Black Eye exercise books, AI diagnosis, or new public access rules.

## Requirements

- **FR-001:** Admin can select an existing published Skill Drill in a dedicated Listening picker grouped by drill type. Eligible drills can be assigned to any course using the existing class and recipient selection.
- **FR-002:** Public self-practice stays available at its existing URL. The same learner and drill can have separate public practice and assignment attempts, including when two assignments use the same drill.
- **FR-003:** Admin may require dictation for drills with usable transcripts. The learner submits the listening questions before dictation. A required assignment completes when all required sections are submitted. An optional assignment completes when the questions are submitted.
- **FR-004:** Admin can see correct answers out of graded questions and the browser-observed count and cumulative duration of audio playback for listening and dictation separately. Retries of the same playback checkpoint must not inflate the totals.
- **FR-005:** An authorized administrator can open the submitted dictation evidence from the class report to compare the learner text with the stored reference and inspect missing, wrong and extra words.
- **FR-006:** The same drill passes staging acceptance in two synthetic classes in different courses, one with required dictation and one with optional dictation. Independent public practice still opens and preserves its own progress.

## Acceptance scenarios

Assign the same published drill to classes A and B. In A the report shows a pending dictation after the questions are submitted, then shows completion when the final required section is submitted. In B the report shows completion as soon as the questions are submitted. Play, pause, seek and replay in both players, then compare the admin totals against the media interaction. Start a public practice attempt with the same learner and confirm that opening or restarting the homework preserves public progress.

## Success criteria

A teacher can give and review both assignments from the class interface, confirm the expected completion states, and inspect the submitted transcription. The public page can still launch self-practice.

## Approval record

On 2026-11-11, the owner approved the proposed workflow in the Codex conversation and requested implementation in a separate worktree, retaining public access and testing two staging classes from different courses with opposite dictation settings.
