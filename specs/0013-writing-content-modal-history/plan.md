# Implementation plan

## Architecture impact

- The existing `frontend/app/(authed-writing)/writing/dashboard` route owns its
  content tabs and shared tip/prompt dialog. Keep its auth/admission/essay owners.
- A bounded domain model parses query and validates the owned entry marker; an
  explicit navigation handler changes URL, while a separate display reconciler
  derives loading/open/error/closed state from URL and current account/list.
- Factor only the shared read-only content dialog lifecycle. Do not refactor
  submission modal history or introduce a general navigation framework.
- Implementation begins only after approval lands on the base branch.

## Data and contracts

- Canonical tips and enabled prompt-bank reads remain authoritative. Persist only
  allowed tab/kind/item identity in URL and a versioned bounded parent marker in
  existing Next history state; preserve Next-owned fields.
- Parent paths are generated from fixed `/writing/dashboard` library routes.
  Never consume an arbitrary return URL or persist authored HTML/auth tokens.
- Ownership marker must match current route, query/kind/item and signed-in
  account. Deep links or uncertainty use replace, without inventing parent state.
- No migrations/RLS/OpenAPI changes; preserve `assignment_id`, admission requests,
  retry receipts and submission-draft behavior. Any `assignment_id` key presence,
  including empty/duplicate values, suppresses content and leaves assignment
  validation solely to the existing owner. Duplicate tab/tip/prompt keys are
  invalid even when identical; empty/missing/wrong-tab/conflicting item selectors
  stay closed, while plain valid-tab library views remain valid.

## UI and interaction

- Explicit open commits one entry through the documented Next Native History API.
  URL-derived restoration reads/display only; it never calls the open/push path.
- Central close policy distinguishes owned parent return from direct-link replace.
  Popstate reconciliation never Back/pushes again. Retain canonical library state
  and scroll for owned-return journeys.
- Generation and identity guards reject late loads on close, history change or
  account change. Model all loading/error/unavailable/missing-item states as
  closable, with no stale body fallback.
- Shared labeled dialog owns initial focus, trap, Escape and return/fallback.
  Background interaction honors aria-modal. Avoid simultaneous content and
  submission dialogs. Preserve theme, mobile containment and reduced motion.

## Work decomposition

1. Approve this spec in a separate base-branch PR.
2. Lock allowed URL, marker, parent fallback, content identity and race fixtures.
3. Integrate the content navigation and display owners in one scoped batch;
   submission/admission code stays under its existing owner.
4. Complete native histories, failure/auth/race and keyboard/shared-kind evidence,
   then existing Writing regression suites and independent review.

## Rollout and rollback

- Verify exact merged staging SHA with controlled learner fixtures before
  promotion. Record frontend/backend deployed SHA and final read-only journeys.
- Revert the UI change to local content overlays if needed. New query/marker
  namespaces become ignored; no server record or submission receipt needs repair.
- No migration/backfill or new backend feature flag is proposed.

## Verification strategy

- Model tests cover duplicate/conflicting queries, fixed internal parents,
  mismatched ownership, deterministic deep-link close and identity rejection.
- React/browser tests cover one entry, Back/Forward, close/Escape/backdrop,
  reload/direct links, BFCache/recreated documents, late reads, failed/deleted
  content, account/logout, disabled prompt-bank and tip/prompt body identity.
- Assert request counts: zero content-restore submission/AI writes and no repeated
  analytics restore event. Exercise existing admission, assignment affinity,
  submit receipt/result and submit-modal focus regressions.
- Test 360/390/768/1440 and themes; record actual keyboard and mobile/VoiceOver
  evidence before claiming accessibility completion.
