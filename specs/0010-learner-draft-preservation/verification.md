# Verification

## Requirement coverage

| Requirement | Planned evidence | Result |
| --- | --- | --- |
| FR-001 | L1-only immediate-return/reload/empty-value and partial checked/failed-ACK journey | PENDING |
| FR-002 | Speaking Next Part/topic/panel preparation restoration journey | PENDING |
| FR-003 | Browser request-count assertions plus existing check/start retry suites | PENDING |
| FR-004 | Two-tab/cloned-tab/account-switch/logout/history isolation journeys | PENDING |
| FR-005 | Discard and content-revision incompatibility tests, session-lifetime manual check | PENDING |
| FR-006 | Quota/denied/corrupt storage interactions and immediate-exit journey | PENDING |
| FR-007 | Viewport/theme/keyboard and manual mobile/VoiceOver evidence | PENDING |

Intent is approved; all functional results remain PENDING until the actual
product implementation and required acceptance are verified. External native
owner-envelope observations qualify only the initial Chrome152/macOS candidate,
not any of FR-001–007. See `feasibility.md`.

## Contract evidence

- OpenAPI/type drift: expected unchanged; verify during implementation.
- Backward compatibility: Reading check, Speaking session retry receipts and
  current default dashboard behavior without a draft must remain intact.

## Data evidence

- Migration/schema query: no migration proposed; confirm final diff.
- Immediate state versus full reload: browser evidence required for FR-001–006.

## UI evidence

- 360/390/768/1440, light/dark, reduced motion, keyboard, IME, mobile keyboard,
  and VoiceOver: PENDING.

## Release evidence

- Approved spec base SHA: record this spec-only merge before the feature PR.
- Reviewing authority: Root under the user-authorized Aver remediation scope;
  product/human acceptance is still pending.
- Staging SHA and checks: PENDING.
- Production frontend/backend deployed SHAs and journeys: PENDING.

## Implementation evidence and limits

- Approved staging base: df760bc6b74d1c99ae890dbe70de5a3bc7061a63
  (PR1575); the seven requirement definitions and medium risk are unchanged.
- Actual Reading/Speaking consumers with the shared helper:19 focused React
  interactions; complete React layer263 passed. These intentionally mock only
  browser admission and do not qualify another engine/version. Auth signal
  ordering, current account concealment, failed-clear revival, empty edits,
  revision, scoped discard and topic absence are covered.
- Shared model/admission controls12 passed, including a later document when
  both owner and storage writes are denied. No Start/retry source is modified.
- Production-built journeys24 Reading and32 Speaking passed in the actual
  newly launched desktop Chrome154 and default Chromium. Both exercised the
  UNQUALIFIED/UNSAVED branch. They verify usable input, existing checks/Start,
  keyboard discard and360/390/768/1440 light/dark controls. They do not prove
  positive persistence in the already running, measured native Chrome152.
- The qualified positive journeys are present in the existing drivers and
  still require an actual Chrome152 product run. Do not spoof navigator data
  or use test admission as browser qualification. Live Speaking on the current
  signed-in staging session is the next acceptance step after deployment.
- Reading staging L1 library is currently empty and admin access is denied;
  canonical published content and a valid admin session remain prerequisites
  for its live content/positive draft acceptance.
- Full contract run exposed stale source harness assumptions and modal versus
  panel copy drift; consumers preserve both existing copy variants and use the
  existing cleanup helper. Focused corrections38 passed; two localhost-blocked
  Pricing tests were rerun with unchanged assertions13 passed. Final full
  contract/build/PR gates will be recorded against the committed feature SHA.
- No production, historical grade repair, physical mobile/VoiceOver or human
  acceptance is claimed by this implementation PR. All FR release results
  above stay pending until their complete evidence exists.

Final consolidated local checks: production Webpack build and both TypeScript
boundaries passed; full Node9590 passed/2 skipped and full React263 passed.
The earlier seven failed checks and the exact source/environment corrections
remain in the task logs; no assertion was removed or disabled. These local
checks still do not close positive supported-browser/live/human acceptance.
