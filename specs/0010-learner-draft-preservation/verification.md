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
