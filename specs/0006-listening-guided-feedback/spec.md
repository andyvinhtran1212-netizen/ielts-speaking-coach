---
id: LISTENING-0006
title: Guided per-question Listening feedback
status: implementing
risk: high
owner: product
---

# Guided per-question Listening feedback

## Problem

The two imported Listening programmes are practice material, but the current
report-only player releases answers only at final submission. The two-form
local learning demo established a more useful loop for learners restarting
Listening: answer a question, compare immediately, listen again, and revise.
Rolling that loop into the real player without a backend contract would expose
unrevealed answer keys, erase the distinction between first and revised work,
or misrepresent assisted completion as an independent result.

## Scope

- Apply one guided feedback loop to all 159 published General and IELTS
  programme forms, without changing their immutable source packages.
- Keep both continuous and one-question-at-a-time navigation and the existing
  English/Vietnamese question preference; missing reviewed translations stay in
  English rather than being machine-invented at runtime.
- Reveal feedback only for a question whose learner answer was successfully
  persisted, and retain the first answer separately from later revisions.
- Show objective-item comparison and unscored self-review using the same
  report-only rules as final submission.
- Preserve a truthful assisted marker through reload, submission, history, and
  analytics; protect existing diagnostic and exam-like attempts.

## Non-goals

- AI grading of short, written, or open-rubric answers; IELTS band, CEFR,
  mastery, pass/fail, or diagnostic-accuracy claims.
- Replacing Quick Practice's first-answer `/check` semantics or the full,
  mini, mock, class-assigned, or dictation flows.
- Exposing full scripts, transcript segments, teacher rubrics, or all keys
  before completion; changing source package bytes or replay policies.
- A second learning-session store, generic background worker, or new content
  import workflow.

## Requirements

- **FR-001:** Only the owner of an active, unexpired, standalone,
  `report_only` programme-form attempt may reveal a valid question. The
  existing Quick Practice `/check` route retains its current diagnostic-only
  contract; ineligible requests fail closed without answer leakage.
- **FR-002:** Reveal operates on the answer already acknowledged by the
  canonical answer-save endpoint. It atomically records one immutable first
  answer and reveal timestamp per attempt/question; retries are idempotent,
  while later edits continue through the existing mutable answer-save path.
- **FR-003:** Before reveal, learner responses expose no key, reference answer,
  rubric, or controlled transcript. Reveal and resume return feedback only for
  questions with persisted reveal records and only to the owner. An attempted
  reveal with no nonblank saved answer returns no protected material.
- **FR-004:** Objective choice/map feedback uses the existing report-only
  comparison rules. Short, written, and open-rubric feedback is labeled
  `Tự đối chiếu` and never automatically called correct or incorrect.
  Missing/invalid protected content is an explicit technical-error state.
- **FR-005:** An attempt becomes assisted upon its first successful reveal and
  remains assisted after revision, refresh, and submission. The label derives
  from persisted reveal records, not a duplicate client flag. First-answer
  comparison and final revised answer remain distinguishable in review.
- **FR-006:** Assisted activity is displayed separately from independent
  report-only completion in history/analytics; no assisted result contributes
  to diagnostic accuracy, band, CEFR, weakness, or mastery signals. It
  satisfies the existing form-completion milestone, but carries visible
  assisted provenance and is excluded from independent-completion counts.
- **FR-007:** The player presents the learning sequence in place: save answer,
  reveal immediately, show first answer and reference, offer replay when
  allowed, and allow revision. Learners can continue across questions or work
  one at a time, switch English/Vietnamese question text where reviewed text
  exists, and resume without losing revealed states.
- **FR-008:** Replay and transcript restrictions remain effective: once-only
  audio cannot be replayed through a revealed question window, and controlled
  transcripts stay behind their existing accommodation/post-submit boundary.
- **FR-009:** New response shapes are explicit in OpenAPI and generated
  frontend wire types. Migration is backward-compatible with the deployed
  backend/frontend, with ownership checks and service-only protected writes.
- **FR-010:** The affected UI covers loading, unsaved, saving, revealed,
  revised, invalid question, expired/forbidden, audio failure, and transient
  network failure states in light/dark themes at mobile and desktop widths,
  with keyboard focus, 44px targets, and reduced-motion behavior.

## Acceptance scenarios

1. A learner saves an answer, requests reveal, and sees that question's
   comparison immediately below it. A different question's key remains absent
   from the response and page source.
2. A learner changes the answer after reveal, reloads, and sees the immutable
   first answer, current revision, and same revealed feedback. Repeating the
   reveal request creates no second record.
3. A short-answer item shows reference material for self-review without a
   machine correctness verdict; a choice item shows the existing objective
   comparison without claiming a formal test score.
4. An unauthenticated, non-owner, expired, class/mock, unpublished, unsaved, or
   invalid-question request receives no protected material or reveal record.
5. An allowed-replay form offers question audio after reveal; a once-only form
   does not. Neither path releases controlled transcript text prematurely.
6. Immediate state and full reload agree on assisted provenance, first and
   revised answers, and the final result. Diagnostic Quick Practice behaves
   unchanged.

## Success criteria

- No unrevealed answer-key leaks in route, OpenAPI, or browser tests.
- Every published programme item can enter a stable reveal/resume/revision
  loop; failed save never yields a key.
- Assisted provenance survives retries, duplicate requests, refresh, and
  submission; existing Quick Practice and exam flows pass regression checks.
- Product approval of the assisted-completion rule is recorded in the
  2026-09-23 task conversation; implementation still waits until this approved
  spec is present on the `staging` base branch.
