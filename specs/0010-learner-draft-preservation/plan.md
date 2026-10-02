# Implementation plan

## Architecture impact

- Reading: `frontend/app/(authed-reading)/reading/reading-detail.tsx` owns
  article answer controls; activate only for `library=vocab` (L1), leaving L2/L3
  untouched. A bounded domain draft model owns parsing/keying. Remove only a
  successfully checked question after valid ACK; preserve all unchecked and
  check-failed input drafts. Do not persist verdicts or lock state.
- Speaking: `frontend/app/(authed-speaking)/speaking/speaking-behavior.tsx` and
  `page-shell.tsx` own preparation, notices and discard. Do not fold the draft
  into `speaking-start-intent.mjs` retry receipts.
- Integrate existing auth provider lifecycle; no new auth/runtime owner.
- Implement only after status approval has landed on the base branch.

## Data and contracts

- Optional session-tab storage, versioned allowlisted input shape, account plus
  content/preparation identity. Auth tokens, answer keys, verdicts, recordings,
  arbitrary server objects and generated AI output are excluded.
- Reading public question shape fingerprint rejects changed authored questions
  without a migration or new backend persistence contract.
- Use a bounded owner envelope in the application's single sessionStorage
  namespace. An opaque UUIDv4 token in otherwise empty window.name is a tab
  candidate, never authentication. Preserve unrelated names. A fresh or
  mismatched owner clears the copied application namespace before reading any
  domain input. Native Duplicate and close/reopen observed an empty name while
  session storage was copied; same-tab reload and document Back preserved the
  owner in the qualified native environment. Never infer lineage from free
  Web Locks, navigation.type, a timeout or BroadcastChannel. No lock/heartbeat
  or general navigation platform is added.
- Confirm the signed-in account before restore. Invalidate owned name before
  logout/account storage cleanup so denied/quota clearing cannot revive an old
  handle or payload. Conceal private input on pagehide and persisted pageshow;
  recheck the existing auth session and make a fresh guarded domain read before
  revealing answers. A pending auth recheck is not logout.
- Initially admit only measured desktop Chrome152/macOS. Unqualified browser,
  unrelated name, corrupt/denied/quota/readback failure disables optional
  persistence with the FR-006 notice and editable input. Actual product
  clone/account/logout/reload/Back/discard/revision checks remain release gates.
- Synchronous latest-edit retention; parse/serialization failures are visible
  and fail-soft. Discard only its namespace; no grading/save endpoint changes.
- No migrations/RLS/OpenAPI changes proposed. Existing canonical backend results
  and start retry receipts remain authoritative for their own contracts.

## UI and interaction

- Waiting for identity cannot restore a previous account's fields. Preserve
  loading/error/permission behavior; no draft-triggered session or AI calls.
- Notice “Đã khôi phục nháp trong tab này”, action “Bỏ nháp”, and explicit failure
  when optional storage cannot save. Accessible announcements and focus remain
  scoped to the existing learner screens.
- Start is still explicit. Topics restore only after valid list hydration; no
  invisible Part/topic fallback. No server-side progress fabricated from drafts.

## Work decomposition

1. Land this approved product contract on staging before the feature PR.
2. Lock model fixtures and test tab/account/storage behavior before handlers.
3. Implement Reading and Speaking separately under non-overlapping ownership.
4. Exercise real Next journeys, then full affected local suites and review.

## Rollout and rollback

- Exact staging SHA, controlled learner fixtures, targeted journeys before
  promotion. Record production deployed SHA and final journey evidence.
- Rollback code stops using new draft keys without touching server records or
  retry receipts. Namespace/version allow incompatible data to fail safely.
- No historical result repair or backfill is applicable.

## Verification strategy

- Pure model tests: scoped keys, schema rejection, content revision, empty input,
  discard boundaries, denied/quota storage, tab cloning handling.
- React interactions: notice/discard/error, identity reset, Part/topic restore.
- Browser journeys: immediate Back/Forward/reload, two independent and cloned
  tabs, account switch/logout, content change, 360/390/768/1440 and keyboard.
- Assert zero restore-triggered check/session/AI writes; run Reading check and
  Speaking start/idempotency regressions. Human mobile/VoiceOver evidence is
  required before claiming accessibility coverage.
