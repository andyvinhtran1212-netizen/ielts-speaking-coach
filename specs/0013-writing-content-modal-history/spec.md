---
id: WRITINGMODAL-0013
title: Make Writing content dialogs follow browser history and keyboard focus
status: implementing
risk: medium
owner: product
---

# Writing content modal history

## Problem

Opening a Writing tip currently changes only a local overlay. Browser Back
leaves Writing instead of closing that overlay, while Forward may restore it
through browser document caching. The same dialog is reused for prompt-bank
reading. Its current open/close handlers do not establish a focus trap or return
focus to the activating content card.

## Scope

- Make the existing read-only tip and prompt-bank dialog a bounded navigation
  state within `/writing/dashboard`, including explicit close and browser history.
- Restore the selected content tab and canonical item through reload/deep-link
  and Back/Forward after identity, availability and list reads are resolved.
- Provide accessible dialog focus entry, containment and return.

## Non-goals

- Writing submission/essay dialogs, answer keys, AI/grading, assignments,
  admission tokens, draft persistence and submission retry receipts.
- New CMS content, changing access permissions or creating an auth/history
  platform shared with other skills. Spec0010 draft isolation is independent.
- Restoring private dialog body HTML from local storage or browser history.

## Users and journeys

- A learner opens a tip, uses Back to return to its library, and Forward to read
  it again without leaving Writing or creating a submission.
- A learner opens an existing prompt-bank item and closes the shared dialog
  with Escape, its close button or its backdrop.
- A learner follows a content link in a new tab or reloads an open item, then
  closes it safely without navigating away to an unrelated previous website.

## Requirements

- **FR-001:** The URL represents a validated dashboard tab and at most one
  content dialog identity. Allowed tabs are `assignments`, `essays`, `tips` and
  `prompt-bank`; absent/invalid/duplicate tab falls back to `assignments` and
  cannot open content. `tab=tips&tip=<canonical-id>` opens a tip;
  `tab=prompt-bank&prompt=<canonical-id>` opens a prompt. Any duplicate tab/tip/
  prompt key, even identical values, is invalid. Empty/missing item IDs, missing
  or mismatched tabs and conflicting tip/prompt selectors leave content closed.
  A plain valid tab with no item selector remains a valid library view.
  Existing assignment query and permission/admission ownership remain compatible:
  presence of any `assignment_id` key, including empty/duplicate values,
  suppresses content without removing or rewriting assignment parameters.
  Only the existing assignment owner validates and handles that intent. The
  content query cannot activate a submission dialog.
- **FR-002:** An explicit content-card activation creates one owned browser
  history entry for that dialog. Activating the same visible item repeatedly
  does not add duplicate entries. Browser Back closes the dialog and restores
  its library; Forward restores its tab/item after valid reads. Rendering or
  handling a history event never pushes another history entry.
- **FR-003:** Close, Escape and backdrop close obey the same bounded history
  policy. A current app-owned content entry with a validated same-dashboard
  parent can return to that parent. A direct/new-tab entry or uncertain owner
  replaces the current URL with its canonical library URL; it must not call
  Back into an unrelated previous page. Neither path creates history loops or
  an arbitrary redirect. After an owned open then reload, only an existing
  marker that still validates against the current account, route, kind/item and
  fixed parent can retain ownership. URL/referrer alone cannot establish it;
  missing/damaged/mismatched state uses replacement. Reload must not invent
  parent ownership.
- **FR-004:** Resolve content against the current canonical item list and
  permissions. Pending, failed, deleted/unpublished/missing-item and disabled
  prompt-bank states are explicit and closable. No stale response may display
  another item, content kind or account. Back/close during a pending read must
  keep the dialog closed when that read later settles. Signed-out/account-change
  lifecycle resets dialog state before another identity can see old content.
- **FR-005:** The shared dialog has a clear label, initial focus inside it,
  keyboard focus containment, Escape support and safe focus return to the
  connected activating card. Deep-link or removed-card closure uses a stable
  tab/library fallback. Focus and background interaction must match aria-modal;
  loading/error content must retain a usable close action. Tips and prompt-bank
  use the same lifecycle without restoring the wrong content kind.
- **FR-006:** URL/history restoration performs only permitted canonical reads.
  It cannot submit/check/grading/AI work or alter assignment admission/retry
  identity. Analytics view events, if retained, occur only on explicit content
  activation and are not duplicated by history restoration or a render effect.
- **FR-007:** The dialog remains readable and operable at 360/390/768/1440 widths,
  in light/dark themes and reduced motion, with keyboard and mobile touch. The
  current library filters/scroll are retained when closing its owned entry;
  fresh backend content and permissions remain authoritative.

## Acceptance scenarios

### Browser history and repeated activation

- **Given** the Tips tab and an existing card
- **When** the learner opens it, presses Back, then Forward, then closes it
- **Then** the library and dialog follow those states with one entry per explicit
  open, no additional history from restore, and no submission or AI call.
  A second Back after a normal Back-close follows the original page history.

### Direct link and reload

- **Given** a valid content URL in a new tab with no owned parent entry
- **When** the canonical item loads, the learner reloads and then closes it
- **Then** the item restores after permitted reads; close replaces its query
  with the same dashboard library and does not leave for an unrelated website.

### Owned entry and reload

- **Given** an explicit card activation created an owned content entry
- **When** the learner reloads and closes it
- **Then** only a still-valid history marker permits returning to its fixed
  parent; absent or damaged ownership safely replaces the URL. No ownership is
  reconstructed from the item URL or referrer.

### Async, identity and missing content

- **Given** a pending tip/prompt read, a failed list or an item removed from it
- **When** the learner closes, uses Back, changes account or signs out
- **Then** a late response cannot reopen stale content; loading/error remains
  closable, permission failure is explicit, and no old body is reused.

### Keyboard and shared content kind

- **Given** a keyboard-activated tip or prompt card
- **When** the dialog opens, Tab/Shift+Tab/Escape are used, then another content
  kind is opened
- **Then** focus stays in the open dialog, returns safely on close, and the new
  title/body/URL correspond to the correct canonical content kind.

## Edge cases

- Duplicate/conflicting query values, invalid item, malformed canonical payload,
  unavailable prompt-bank, denied identity and stale account/list response.
- Plain valid tab without an item is a library state. Invalid item selector
  syntax is closed safely; a syntactically valid ID missing from a canonical
  list has an explicit closable missing-item state.
- Item deleted while open, trigger removed by filtering, browser BFCache versus
  recreated documents, mobile viewport and scroll restoration.
- Existing `assignment_id` query, unsent essay text, admission/submit receipts and
  submission dialogs must not be touched by a read-only content restore.
- Damaged/missing ownership marker falls back to same-dashboard replacement.

## Success criteria

- All FR-linked native journeys and meaningful model/interaction tests pass;
  existing Writing admission/assignment/submit/result regressions still pass.
- Restore assertions report zero submission/grading/AI writes, with independent
  review, exact staging/production SHA and keyboard/mobile evidence recorded.

## Approval record

Approved on 2026-09-30 under the user's authorization to complete validated
remediation with controlled agents. The root coordinator approved product scope;
the learner UX council inspected the current content-dialog owner, and the
admin engineering council independently reviewed the bounded URL/history,
assignment precedence, async identity and accessibility contract. Review clarified
duplicate/empty/mismatched selectors, any assignment_id key precedence, and
owned versus direct-link reload close behavior.

This separately landed approval does not certify an implementation, browser
journey, accessibility acceptance or deployed SHA. Those evidence gates remain
pending. No submission/admission ownership, schema or grading change is approved.

## Open questions

None in the bounded behavioral contract. Implementation and release evidence
must satisfy the specified requirements without weakening the existing owners.
