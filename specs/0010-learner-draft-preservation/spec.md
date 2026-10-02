---
id: LEARNERDRAFT-0010
title: Preserve Reading answers and Speaking preparation within a browser tab
status: approved
risk: medium
owner: product
---

# Learner draft preservation

## Problem

Leaving a Vocab Reading article and returning clears answers that have not been
checked. Reloading Speaking clears a learner's custom questions and selected
Part. Neither action is a request to discard preparation. Reading L1 check
responses are currently unpersisted practice feedback; Speaking session retry
receipts exist only after Start. They do not supply pre-submission drafts.

## Scope

- Preserve unsubmitted Reading L1 Vocab answers and Speaking preparation in the
  current browser tab through Back/Forward and reload.
- Provide explicit discard and visible storage-failure behavior.
- Isolate drafts by signed-in account, content and preparation mode.

## Non-goals

- Reading L2 Skill Practice and L3 attempts; cross-tab, device, browser or server
  synchronization; long-term backups.
- Persisting Reading verdicts/score, writing essays, graded attempts, audio or
  Speaking session results; changing grading, paid AI, RLS or auth APIs.
- Altering Speaking start-idempotency receipts, retry identity or persistence.
- Changing Grammar/Writing modal history or course/mock assignment contracts.

## Users and journeys

- A learner enters answers in a Reading article, leaves, then returns to finish.
- A learner prepares Speaking questions and chooses Part 2, reloads, then
  continues with the same questions and Part without creating a session.
- A learner explicitly discards preparation or signs out on a shared device.

## Requirements

- **FR-001:** Restore Reading answer text and selections after Back/Forward and
  reload within the same tab/account/article and compatible question revision.
  Empty edits stay empty. Unknown questions and incompatible question shapes
  must not receive a prior answer. Only values for currently visible authored
  L1 Vocab questions may be restored; draft values never restore verdicts or
  answer keys. After a question receives a valid check ACK and becomes locked
  in the current component, remove only that question from the draft. Other
  unchecked answers remain. Reload retains existing behavior for checked
  questions: no prior verdict/lock is fabricated and their old answer is not
  restored as an unchecked draft. A failed check ACK retains that input draft.
- **FR-002:** Restore Speaking's selected preparation panel/mode, relevant Part,
  custom questions and selected/custom topic after reload and Back/Forward in
  the same tab/account. Validate selected topics against the loaded Part's
  current topic list. Missing or failed topic reads must not silently substitute
  another topic or Part for Start. With no draft, retain the dashboard default.
- **FR-003:** Draft restore must never submit/check Reading, create or resume a
  Speaking session, invoke AI/grading or fabricate a completed result. Speaking
  Start continues to use the existing idempotency controller. A lost ACK keeps
  its retry identity; clearing a draft must not clear a pending start receipt.
- **FR-004:** Drafts are account/content/mode/version scoped and confined to the
  current tab. Wait for a confirmed signed-in identity before restore. Account
  changes reset visible preparation before another account can read it. Logout
  and browser Back after logout cannot expose private input. Independent tabs
  cannot overwrite or receive each other's active draft, including a newly
  opened or duplicated tab with browser-cloned session storage.
- **FR-005:** Drafts expire when the tab session ends, on logout, on explicit
  discard, or when authored question identity/shape changes. No promise of
  browser crash/session recovery is made. A clear “Bỏ nháp” control removes only
  the current draft and resets its inputs; other content/mode drafts and pending
  start retry receipts remain intact. Restoration shows a concise draft notice.
- **FR-006:** The latest visible edit is retained before immediate navigation
  or reload. Corrupted or unsupported draft schemas fail safely without crash
  or restore to another question. Storage denied/quota errors retain current
  editable input and show that the tab draft was not saved; never claim success
  or prevent ordinary practice merely because optional local storage failed.
  A confirmed leave warning may serve as a fallback while a draft is unsaved.
- **FR-007:** Draft notice/discard/storage failure states are keyboard-operable,
  announced without stealing focus, readable at 360/390/768/1440 widths in
  light/dark themes and compatible with reduced motion. Existing question
  controls, dictionary popovers, Part/cue-card warnings and start error/retry
  behavior continue to work.

## Acceptance scenarios

### Reading immediate return

- **Given** a new answer `servant` in question 2, not checked
- **When** the learner immediately leaves and returns via Back/Forward or reload
- **Then** the same value appears, no check request occurs, and no correct/score
  state is inferred. Erasing the value and repeating the journey keeps it empty.

### Speaking preparation and retry ownership

- **Given** Part 2 and a custom cue card are prepared
- **When** the learner reloads and then explicitly starts
- **Then** preparation/Part are restored without a session write during restore;
  Start uses the restored values through the existing idempotency protocol.
  Discarding a local draft does not silently discard a pending retry receipt.

### Account, tab and content isolation

- **Given** drafts for account A/article X and two independent tabs
- **When** a tab edits, another tab loads the same article, the user switches to
  account B, logs out, or authored question content changes
- **Then** no draft crosses tab/account/question boundaries and logout does not
  leave the old preparation visible through browser history.

### Optional storage failure

- **Given** browser storage is denied, full, or contains malformed JSON
- **When** the learner edits, restores or discards
- **Then** input remains usable, failure is explicit, and no server/AI side
  effect occurs as a workaround.

### Partially checked Reading article

- **Given** question 1 has a successful check ACK and is locked, question 2 is
  still unchecked, and question 3 has a failed check request
- **When** the learner reloads
- **Then** only questions 2 and 3 restore their draft inputs; question 1 neither
  restores its answer as a draft nor fabricates a verdict/lock. The current
  check feedback remains visible until navigation as it is today.

## Edge cases

- Strict Mode setup/cleanup; first input before runtime readiness; immediate
  Back; Enter/IME composition; empty text; long cue cards; topic list failure;
  content re-import; duplicated tabs/opener cloning; logout while mounted;
  storage quota/denial; pending Start response after navigation/account change.

## Success criteria

- Browser journeys prove preserved field values and zero restore-triggered
  submit/check/session/AI requests for each requirement, with fresh fixtures.
- Draft/account/tab boundaries and failure states have executable coverage.
- Existing Reading check and Speaking idempotency suites remain passing.

## Supported persistence and approval

- Initial qualified native environment: desktop Chrome152/macOS. Same-tab
  lifetime and panel restoration are approved within the existing remediation
  authorization. Other engines/versions are unqualified and use FR-006's
  explicit unsaved/editable behavior until their lifecycle is measured.
- The owner-envelope design was reviewed together with native Duplicate to
  Back before the first guard and actual new-document same-tab Back on
  2026-10-02. Approval of intent does not prove product implementation, privacy
  across unmeasured engines or completed FR acceptance.
- No server save, synchronization, new auth permission, retry-receipt change or
  cross-tab restoration is authorized by this feature. All FR definitions and
  the pending browser, physical and human acceptance remain unchanged.
