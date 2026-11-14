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
- **FR-004:** The class tally returns correct answers out of graded questions, plus playback starts and milliseconds separately for listening and dictation. A start counts when media enters actual playback following an initial play, pause, or replay. Buffer recovery and seeking alone do not increment the counter. Playback milliseconds accumulate while the media advances, excluding buffering, pauses and skipped intervals. The same or older cumulative checkpoint leaves totals unchanged. Across all pages and attempts of one assignment item and stage, stored increments saturate at 120 starts and 3,600,000 ms, with at most 64 checkpoint rows. An attempt cannot add more playback milliseconds than the wall time since its server-recorded start, or exceed one start per elapsed second plus the initial start.
- **FR-005:** An authorized administrator can open the submitted dictation evidence from the class report to compare the learner text with the stored reference and inspect missing, wrong and extra words.
- **FR-006:** The same drill passes staging acceptance in two synthetic classes in different courses, one with required dictation and one with optional dictation. Independent public practice still opens and preserves its own progress.

## Authorization, safety and learner data

| Role | Read | Write |
| --- | --- | --- |
| Public library visitor | Existing Listening Skills catalog and existing sign-in behavior | Existing self-practice behavior only |
| Assigned learner | Own active class item, own attempts and own results | Start or resume only the matching item and drill. Record checkpoints only on an owned, class-linked attempt. |
| Admin | Drill picker and class tally for the selected class. Existing authenticated dictation report detail. | Use the existing class-admin guard and recipient validation to give an eligible drill. |
| Instructor without admin access | Existing instructor access | This feature grants no additional report or assignment API access. |
| Backend service role | Assignment, dictation and playback data needed to operate the feature | Only the authenticated backend invokes the checkpoint RPC. |

The server resolves learner identity from the session, then verifies item ownership, active class membership, test ID, due state and attempt scope. Admin tally queries bind the assignment ID to the cohort in the path. A public attempt or a different homework item cannot satisfy an assignment. The playback table enables RLS, revokes grants from public, anonymous and authenticated roles, and limits the service role to SELECT, INSERT and UPDATE. Only the service role can call the playback RPC. Existing dictation policies continue to govern learner text and results. Foreign keys restrict deleting linked homework evidence.

The client sends cumulative checkpoints every five seconds during a session, plus a checkpoint on pause, submit or page exit. Identical and older values add no new telemetry. The server caps accepted growth by elapsed time and the aggregate limits in FR-004. Each backend worker accepts up to 60 checkpoint requests per minute per authenticated learner and returns HTTP 429 with Retry-After beyond that limit. The database enforces FR-004 totals across workers.

Draft retention proposal for Vinh to approve. Retain detailed playback and dictation evidence for 180 days after assignment completion or due date, whichever is later. Where neither date exists, measure from the last submission or recorded checkpoint. Keep the homework status and score under the existing class ledger policy. The current patch does not schedule deletion. Confirm the retention period, deletion owner and purge path before production collects real learner data. Staging acceptance uses synthetic learner data only.

## Data and API contract

- `listening_tests` is the single published drill record. `class_assignments.content_config.skill_drill` stores `dictation_required` and required section numbers. `class_assignment_items` remains one assignment × one learner. `listening_test_attempts.class_assignment_item_id` reuses the existing link.
- Migration **380** is registered as `pending_feature` for `listening_skill_drill_homework`. It adds the nullable assignment-item link to `dictation_attempts` and `dictation_sessions`, separate public and class active-attempt indexes, and private `listening_drill_playback`. The playback identity is (assignment item, stage, attempt, page). The migration provides a readiness RPC for new assignments. Public dictation continues before 380 is present.
- `GET /admin/cohorts/{cohort_id}/listening-skill-drills` returns drill identity, category, audio readiness and dictation readiness. `POST /admin/cohorts/{cohort_id}/assignments` accepts `listening_skill_drill` and `dictation_required` for eligible Listening drills.
- Existing Listening and dictation routes accept `class_item` when launched from a class. Public routes omit that context and keep an independent attempt. `POST /api/listening/skill-drill-playback/{attempt_id}` accepts `stage`, `page_id`, cumulative `plays` and `played_ms`. The backend derives the item from the owned attempt and returns 204 after a valid checkpoint. It serializes updates per item and stage to make the aggregate bounds and retries deterministic.
- `GET /admin/cohorts/{cohort_id}/assignments/{assignment_id}/tally` returns completion, raw score, playback totals by stage and references to existing `/admin/listening/dictation-reports/{session_id}` reports. Required dictation completion is recorded at submission of the final required section.

## Related specifications and work

- **0052 Black Eye.** Align with one class-assignment item per assignment × learner. The Black Eye activity mapping discussed for migration 378 is separate. Skill Drills 380 does not require the exercise-book table or alter Black Eye visibility, grading or course 2 gates.
- **0011 versioned dictation grading.** Reuse the frozen reference, grading version and per-token comparison. Skill Drills adds assignment linkage and playback evidence around that existing grading flow.
- **0049 and PR #2254.** Use the existing class-first admin assignment workflow. The picker remains part of the class homework screen while the proposed admin navigation changes are reviewed separately.
- **PR #2285.** The exercise-book activity selector has its own data source and permissions. Skill Drills uses a separate Listening catalog option. Both keep the existing class and recipient selection and may coexist.

## Acceptance scenarios

Assign the same published drill to classes A and B. In A the report shows a pending dictation after the questions are submitted, then shows completion when the final required section is submitted. In B the report shows completion as soon as the questions are submitted. Play, pause, seek and replay in both players, then compare the admin totals against the media interaction. Start a public practice attempt with the same learner and confirm that opening or restarting the homework preserves public progress.

## Success criteria

A teacher can give and review both assignments from the class interface, confirm the expected completion states, and inspect the submitted transcription. The public page can still launch self-practice.

## Approval record

Approved by Vinh in typed message **t1713u** on **2026-11-11 18:15 Asia/Saigon**: “Duyệt spec 0054 Skill Drills bản #2291 head 0534cb07, gồm giữ dữ liệu 180 ngày”. This approval covers the specification exactly as in PR #2291 head `0534cb07804f9e28236534fff325b3a9b5894c48`, including 180-day retention.

Vinh authorized this status and approval-record update on **2026-11-11 22:52 Asia/Saigon** (reply to **t1733s5821**). Approval evidence: `handoff/leader/20261111-1815-approval-spec-0054.md` and `handoff/leader/20261111-2252-approval-spec0054-status-pr.md` in the job orchestration workspace. No requirement text is changed.
