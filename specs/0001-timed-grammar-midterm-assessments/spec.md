---
id: GRAMMAR-0001
title: Timed grammar midterm assessment banks
status: implementing
risk: high
owner: learning-platform
---

# Timed grammar midterm assessment banks

## Problem

Course 1 needs two independently assignable midterm question banks sourced from
the teacher-approved 120-question and 200-question packages. Existing Course
assignments cannot impose a server-enforced maximum duration, so a browser can
remain open past an intended deadline or report stale completion state.

## Scope

- Import two private, quiz-only Course 1 banks as separate assignable sets.
- Require exactly five answer choices per question and preserve the reviewed key.
- Let an admin optionally set a maximum duration when assigning an eligible bank.
- Let an admin choose whether a Course assignment uses mastery retries or one
  terminal sitting with results released only after hand-in.
- Let an admin preview the canonical bank questions, choices, answer key, and
  explanations before creating the assignment.
- Keep the assignment dialog usable at every supported viewport by fixing its
  header and actions while only the body scrolls.
- Enforce timed start, progress, expiry, retry, and finalization on the server.
- Show answer choice E, the remaining time, and canonical timeout state.
- Preserve immutable attempt history and prevent unsafe replacement of a bank
  that already has assignments or sessions.

## Non-goals

- Adding reading, listening, writing, speaking, pronunciation, or audio sections.
- Making Course assessment banks public or changing mastery thresholds.
- Adding a timer to non-quiz or non-Course exercise types.
- Replacing the existing class assignment and quiz persistence models.

## Users and journeys

- An admin imports each reviewed bank, assigns either set, and may choose a
  maximum duration from 1 to 720 minutes.
- A learner starts an eligible timed assignment, sees five choices and a
  countdown, and receives the canonical result when submitting or expiring.
- Operations can run the expiry worker so abandoned timed attempts finalize
  without requiring the learner's browser to remain connected.

## Requirements

- **FR-001:** The system imports each reviewed source package as a separate private Course 1 quiz bank, rejects any question without exactly five distinct choices and one valid answer, and creates no non-quiz segments or audio.
- **FR-002:** An admin can assign an eligible quiz-only Course bank with no timer or with a maximum duration from 1 through 720 whole minutes, while ineligible content rejects a timer.
- **FR-003:** Starting a timed assignment atomically snapshots its duration and server start time, and every subsequent start, resume, progress, verdict, and expiry decision uses the earliest applicable timer or assignment due-date boundary.
- **FR-004:** Expired timed attempts are finalized server-side with unanswered questions counted as wrong, a background worker reconciles disconnected attempts, retries remain separate generations, and concurrent finalizers preserve one canonical terminal outcome.
- **FR-005:** The learner runner renders answer choice E and an accessible countdown, disables mutation after the canonical cutoff, and shows the server-authoritative pass, fail, or timed-out result; admin submissions expose timed-out state.
- **FR-006:** Re-import replaces an unused bank's questions and metadata atomically, but refuses replacement once assignments or quiz sessions exist so historical attempts cannot mix bank versions.
- **FR-007:** Timer and result persistence remain backward compatible for existing untimed assignments, existing retries, and already-passed attempts, including stale browser requests that arrive after a canonical pass.
- **FR-008:** A Course assignment stores `completion_mode=mastery|single_attempt`; missing or legacy values resolve to `mastery`, while Advanced Vocabulary keeps its dedicated completion contract and rejects the generic single-attempt option.
- **FR-009:** A `single_attempt` assignment admits exactly one canonical full attempt, withholds correctness, answer keys, explanations, and answer-bearing reports while that attempt is active, then persists a terminal completed result and immediately releases the percentage, per-question answer comparison, and explanation after hand-in or canonical timeout. Direct API calls, refreshes, stale tabs, and concurrent starts cannot create a second attempt.
- **FR-010:** Before assignment creation, an admin can open a read-only preview sourced from the canonical selected Course bank. The preview shows bank identity and counts, ordered questions and choices, answer keys and explanations, and available audio without creating an assignment, session, progress row, or learner-visible entitlement.
- **FR-011:** The assignment dialog keeps its header and primary actions visible while its body scrolls independently, uses the shared design tokens in light and dark themes, supports keyboard focus and Escape, and does not overflow horizontally at 390, 768, 1366, or 1920 CSS pixels.

## Acceptance scenarios

### Import two distinct sets

- **Given** the reviewed 120-question and 200-question JSON packages
- **When** an operator imports them using distinct stable bank codes
- **Then** Course 1 contains two private quiz-only banks with respectively 120
  and 200 questions, exactly five choices per question, and no audio or other
  exercise segments.

### Assign an optional maximum duration

- **Given** an admin selects an eligible Course quiz bank
- **When** the admin leaves the duration empty or enters a whole number from 1
  through 720
- **Then** the assignment is saved as untimed or with that duration snapshot;
  invalid values and ineligible banks are rejected without partial mutation.

### Expire a disconnected attempt

- **Given** a learner started a timed attempt and closed the browser
- **When** the canonical cutoff passes and the expiry worker runs
- **Then** the attempt is finalized once, unanswered items count as wrong, and
  later browser requests return the same terminal result.

### Preserve a completed pass

- **Given** an attempt already has a canonical passing outcome
- **When** a stale timeout writer or retrying request arrives
- **Then** the pass remains authoritative and no contradictory timeout result is
  persisted.

### Complete a one-sitting assessment

- **Given** an admin assigned an eligible Course bank as `single_attempt`
- **When** the learner completes or times out that first full attempt
- **Then** the server persists one terminal result, the learner immediately sees
  the percentage and per-question explanations, and every later start or retry
  request resolves to read-only review without creating another session.

### Keep answers sealed during a one-sitting assessment

- **Given** a learner has an active `single_attempt` assignment
- **When** the learner answers a question, refreshes, or requests the report API
- **Then** no correctness, answer key, or explanation is returned until the
  canonical terminal verdict has been stored.

### Preview before assigning

- **Given** an admin selected a Course bank in the assignment dialog
- **When** the admin opens preview
- **Then** the UI renders the canonical ordered content and admin-only answers
  without creating any assignment or learner attempt, and returning to the form
  preserves the draft.

### Guard bank history

- **Given** a bank has at least one assignment or quiz session
- **When** an operator attempts to replace it by re-importing the same bank code
- **Then** the transaction fails and the prior questions and metadata remain
  unchanged.

## Edge cases

- The assignment due date may be earlier than the duration cutoff.
- Multiple worker sweeps or browser requests may race at the cutoff.
- A retry may begin after a previous timed generation has finalized.
- Existing assignments have no `completion_mode` key.
- A stale or forged client requests a retry for a completed single-attempt item.
- Preview content is long, contains audio, or changes before the final create
  request; assignment creation still uses the existing revision guard.
- Preview fails while the draft is otherwise valid; assignment creation remains
  available and the failure is shown without inventing cached content.
- The dialog body exceeds the viewport on desktop or mobile.
- A timeout ledger may exist before a submission receipt is repaired.
- Server and browser clocks may disagree; the server timestamp is authoritative.
- An unused bank import may fail midway; neither questions nor metadata change.

## Success criteria

- Both reviewed banks pass dry-run validation and production verification at
  their expected counts and answer-key distributions.
- Automated backend, migration, frontend, browser, OpenAPI, and route-manifest
  checks pass.
- Staging verifies timer creation, countdown/resume, canonical expiry, retry,
  and bank replacement guards before production promotion.
- Staging verifies unchanged mastery, a terminal one-sitting result with answers
  sealed until hand-in, mutation-free preview, and visible dialog actions across
  the required viewport, theme, and keyboard matrix.
- Production imports occur only after migrations and application deployment.

## Open questions

- None. Product scope, timer bounds, source packages, and promotion sequence are
  approved for implementation.
