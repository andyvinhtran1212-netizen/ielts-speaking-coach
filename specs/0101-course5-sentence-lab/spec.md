---
id: SENTLAB-0101
title: Course 5 learners practise 45 sentence-writing sessions with AI coaching that never reveals the answer before they rewrite
status: approved
risk: high
owner: product
---

# Course 5 sentence-writing lab (45 sessions)

## Problem

Andy's content team produced a 45-session sentence-writing bank
(`IELTS_45_buoi_Kho_bai_tap_AI.zip`, 540 items, `content_version`
2026-11-18.1) with a private grading key per item, a grading prompt, an error
catalog, a feedback JSON schema and 20 calibration cases. Course 5 teachers need
to assign each session from the admin class assignment flow. Learners need
feedback that coaches them to fix their own sentence first and only then shows a
minimal correction and the reference answer.

Course 1's session writing exercise already supports one graded submission per
attempt, but its grader only checks grammar and spelling. It cannot use a
per-item key, cannot withhold the solution, and has no rewrite round.

## Scope

- Import the 45 sessions as assignable Course 5 session exercises, reusing the
  Course 1 session-writing persistence (`course_writing_submissions`, drafts,
  attempts and assignment scoring).
- A key-aware GPT grader with a coach mode (first submission) and a review mode
  (one rewrite round).
- Learner form, results, rewrite and session guide states on the existing
  course exercise page.
- A dry-run-first import script and a calibration script for the pack's 20
  cases.

## Non-goals

- No migration, new table, column, RLS policy or environment secret.
- No change to Course 1 grading, prompts or results.
- No teacher re-grade, manual override or admin feedback editor.
- No routing through `services/ai_router.py` or the AI-0004 admin model
  override. The model is selected by `SENTENCE_LAB_MODEL`. AIBUDGET-0033 budget
  enforcement applies once that feature lands; this spec does not implement it.
- No publication of the pack, its keys or its calibration cases outside the
  server and the owner's machine.

## Users and journeys

- **Admin / teacher:** opens a Course 5 class, chooses Give class work, picks a
  session exercise `C5-SL-Sxx` and assigns it.
- **Learner:** opens the assignment, writes 12 sentences, submits once, reads
  coaching feedback, rewrites up to 6 sentences once (or finalises without
  rewriting), then sees the minimal corrections and reference answers.
- **Content owner:** dry-runs the package, imports it to staging, runs
  calibration, then imports to production under separate approval.

## Requirements

- **FR-001:** The importer validates the package before any write: manifest SHA-256 for every file, exactly 45 sessions of 12 items with ids `Sxx-Qyy`, a one-to-one match between public items and private keys with identical `required` fields, the course JSON agreeing with the JSONL, and no key field inside a public item. Without `--commit` it writes nothing. With `--commit` it upserts exactly the 45 Course 5 banks `C5-SL-S01…S45` by code (`skill_area='course'`, `lesson_no` NULL), refuses a code owned by another course or source, replaces each bank's 12 questions and verifies the count, and publishes only with `--publish`.
- **FR-002:** The grading key and reference answer stay on the server. Keys live only in `quiz_questions.segments`, which no learner route returns for a Course bank. The play path strips the session guide. The writing state returns the guide only after the first submission for checkpoint sessions that require it (S01, S45). Reference answers (`explain`) are returned only after the rewrite round is final.
- **FR-003:** A first submission of 12 sentences is graded in coach mode with at most 3 model calls: two parallel calls of 6 items, and one combined retry call for every item whose output fails the schema, the validator, or the no-reveal check, or is missing. An empty answer is `no_attempt` without a model call. Each item gets a status (`accepted`, `revise`, `needs_review`, `no_attempt`), a 0–10 score from the five rubric dimensions, at most 2 errors from the pack's catalog, and a self-fix hint that does not contain the reference answer. If any item is still invalid after the retry, nothing is written, the learner gets a 503, and their draft is kept. The assignment score is accepted items / 12, using the existing `clean/total` contract.
- **FR-004:** After a graded submission the learner may rewrite up to 6 items once (`POST /api/quiz/course/writing/revise`). The rewrite is graded in review mode with one call plus at most one retry, and returns a minimal correction. The first-submission answers, feedback and assignment score are never changed. An empty rewrite finalises the round. More than 6 items, an unknown item, an answer over 600 characters, a second rewrite, or a concurrent rewrite returns 4xx without a model call or without a second write (compare-and-set on `graded_at` and the missing revision). A grader failure returns 503 and writes nothing.
- **FR-005:** The learner page shows each state: the form with the source sentence and task (and no worked example before the first submission for gated sessions), coaching results with status, score out of 10, errors and next action, a rewrite bar with a 6-item limit and a finalise action, and the final view with minimal correction diff, optional alternative and reference answer. A committed rewrite stays visible even if the follow-up state read fails.
- **FR-006:** The model is `SENTENCE_LAB_MODEL` (default `gpt-5-mini`) with `SENTENCE_LAB_REASONING_EFFORT` (default `low`) using the existing `OPENAI_API_KEY` and strict JSON-schema output. Every call writes an `ai_usage_logs` row with `service='openai'`, `feature='sentence_lab'` and token counts; a model without a dated price rule is logged as `cost_source='unpriced'`. A calibration script runs the pack's 20 cases through the real grader without touching the database and exits non-zero on any failed case.

## Acceptance scenarios

### Scenario 1: import

- **Given** the 2026-11-18.1 package and staging credentials
- **When** the owner runs the dry run, then `--commit --publish`
- **Then** staging has 45 banks `C5-SL-S%` and 540 questions, and a re-run updates the same 45 banks without creating new ones

### Scenario 2: coach then rewrite

- **Given** S01 assigned to a test learner
- **When** they open it, submit 12 sentences, then rewrite one
- **Then** the form shows no worked example; the results show score /10 and errors without any corrected sentence; after the rewrite the minimal correction and reference answers appear, and the assignment score is unchanged

### Scenario 3: grader failure

- **Given** the model returns invalid output twice
- **When** the learner submits
- **Then** they see a temporary error, no submission row is written and the draft remains

## Edge cases

- Concurrent double submit or double rewrite: one write wins; the other gets 409 (it may still spend model calls before the write is refused).
- Prompt injection inside a learner answer: output is accepted only if it passes the strict schema and validator; free text is never executed or rendered as HTML.
- A key missing for an item at rewrite time: 409, no model call.
- Worst-case latency: three sequential call rounds; the UI shows a pending state for the whole submit.

## Success criteria

- 45 banks and 540 questions on staging, then production, each `ready` in the admin picker.
- Calibration: 20/20 cases pass before production import, or failures are reviewed and accepted by the content owner.
- No learner response in any state contains a grading key field, and none contains a reference answer before the rewrite round is final.
- At most 3 model calls per submission and 2 per rewrite in `ai_usage_logs`.

## Open questions

- None blocking. The coach no-reveal check compares against the reference answer only, not every accepted variant; extending it is a possible follow-up.
