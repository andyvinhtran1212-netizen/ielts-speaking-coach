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

- No migration, new table, column or RLS policy. One new server-side setting, `SENTENCE_LAB_PROMPT`, holds the pack's private grading prompt.
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
- **FR-002:** The grading key and reference answer stay on the server. Keys live only in `quiz_questions.segments`, which no learner route returns for a Course bank. The play path strips the session guide. The writing state returns the guide only after the first submission for checkpoint sessions that require it (S01, S45). Reference answers (`explain`) are returned only after the rewrite round is final. No grading key field and no reference answer appears in any learner response or frontend bundle before that gate opens. A model request carries only the item, its key and the learner's answer text: no learner name, email or id (the learner id is used only for the server-side usage row).
- **FR-003:** A first submission of 12 sentences (each at most 600 characters, else 422 before any call) is graded in coach mode with at most 3 model calls: two parallel calls of 6 items, and one combined retry call for every item whose output fails the schema, the validator, or the no-reveal check, or is missing. An empty answer is `no_attempt` without a model call. Each item gets a status (`accepted`, `revise`, `needs_review`, `no_attempt`), a 0–10 score from the five rubric dimensions, at most 2 errors from the pack's catalog, and a self-fix hint that does not contain the reference answer. The learner's answer is sent only as a JSON data field and the prompt treats it as data; status and score come only from schema-validated structured fields, and the total must equal the sum of the components. Coach output is rejected as revealing when any free-text field contains the reference answer or any accepted variant of four or more words, verbatim after normalisation or as a near copy (a run of words at least 85% similar). If any item is still invalid after the retry, nothing is written, the learner gets a 503, and their draft is kept. The assignment score is accepted items / 12, using the existing `clean/total` contract.
- **FR-004:** After a graded submission the learner may rewrite up to 6 items once (`POST /api/quiz/course/writing/revise`), only while the assignment still accepts submissions: the same authenticated owner and active-assignment check as submit. After the deadline or once the class is archived the rewrite returns 404 before any model call and the learner sees their coaching feedback without a rewrite bar. The rewrite is graded in review mode with one call plus at most one retry, and returns a minimal correction. The first-submission answers, feedback and assignment score are never changed. An empty rewrite finalises the round. More than 6 items, an unknown item, an answer over 600 characters, a second rewrite, or a concurrent rewrite returns 4xx without a model call or without a second write (compare-and-set on `graded_at` and the missing revision). A grader failure returns 503 and writes nothing. `regrade_failed_course_writing` skips sentence-lab banks; a lab submission never stores ungraded items, so the Course 1 grader never re-grades one.
- **FR-005:** The learner page shows each state: the form with the source sentence and task (and no worked example before the first submission for gated sessions), coaching results with status, score out of 10, errors and next action, a rewrite bar with a 6-item limit and a finalise action, and the final view with minimal correction diff, optional alternative and reference answer. A committed rewrite stays visible even if the follow-up state read fails. All learner and model text is HTML-escaped before rendering.
- **FR-006:** The model is `SENTENCE_LAB_MODEL` (default `gpt-5-mini`) with `SENTENCE_LAB_REASONING_EFFORT` (default `medium`; calibration on 18/11 passed 20/20 at medium and 15–17/20 at low) using the existing `OPENAI_API_KEY` and strict JSON-schema output. The pack's grading prompt is private content: it is never committed to the repository and is read from the server-side setting `SENTENCE_LAB_PROMPT`; when that setting is empty, lab submit and rewrite pause as in FR-008. Every call writes an `ai_usage_logs` row with `service='openai'`, `feature='sentence_lab'` and token counts; a model without a dated price rule is logged as `cost_source='unpriced'`. A calibration script runs the pack's 20 cases through the real grader without touching the database and exits non-zero on any failed case.
- **FR-007:** Paid calls are capped per learner. Before any model call on submit or rewrite, the server counts that learner's `ai_usage_logs` rows with `feature='sentence_lab'` since UTC midnight. The cap `SENTENCE_LAB_MAX_CALLS_PER_USER_PER_DAY` (default 40, enough for about eight sessions with every retry) is hard: the server reserves the most calls the batch can use (one per six answered items plus the single retry: 3 for a 12-item submit, 2 for a rewrite of up to six) and, when calls already used plus that reservation exceed the cap, returns 429 with the reset time and makes no call; within the batch each call is also refused once the remaining allowance is spent. Calls already used is the larger of the ledger count and the calls this backend process has started that UTC day, so calls whose usage row is not yet written still count. A submit with no answered item makes no call and is not refused. A failed count lookup or a non-positive cap refuses with the existing paid-AI 503 (fail closed). Usage rows are written asynchronously, so concurrent requests could all count below the cap; therefore each learner has at most one sentence-lab grading in flight per backend process, and a second concurrent submit or rewrite gets 409 before any model call. With several backend replicas the bound is one in-flight grading per replica. This cap is per feature and does not consume COURSEACCESS-0055 grading credits.
- **FR-008:** Operations can pause sentence-lab grading in place with `SENTENCE_LAB_ENABLED=false` (default true): submit and rewrite on lab banks return 503 with `work_saved: true` and make no model call, while learners can still open their work and stored results. This is the rollback path once lab assignments exist; reverting the lab code is not, because assigned learners reach Course banks through assignments regardless of `is_published`.

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

- Concurrent double submit or double rewrite: one write wins; the other gets 409 (the single-flight rule in FR-007 stops a concurrent second grading with 409 before any call). The rewrite compare-and-set on `items->0->revision` is exercised on staging after merge.
- Repeated submits after a grader 503: each spends calls and counts toward FR-007.
- Prompt injection inside a learner answer: output is accepted only if it passes the strict schema and validator (FR-003); free text is never executed or rendered as HTML (FR-005). A paraphrase that the 85% near-copy check misses is a residual risk reviewed through calibration.
- A key missing for an item at rewrite time: 409, no model call.
- Worst-case latency: three sequential call rounds; the UI shows a pending state for the whole submit.

## Success criteria

- 45 banks and 540 questions on staging, then production, each `ready` in the admin picker.
- Calibration: 20/20 cases pass before production import, or failures are reviewed and accepted by the content owner.
- No learner response in any state contains a grading key field, and none contains a reference answer before the rewrite round is final.
- At most 3 model calls per submission and 2 per rewrite in `ai_usage_logs`.

## Open questions

- None blocking.
