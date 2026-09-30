# Verification

## Requirement coverage

| Requirement | Planned evidence | Result |
| --- | --- | --- |
| FR-001 | Duplicate-even-identical/empty/wrong-tab/tabless/conflicting item closed tests; plain valid-tab library; any assignment_id presence suppresses content without altering assignment owner | PENDING |
| FR-002 | Native one-entry repeated-open/Back/Forward journey | PENDING |
| FR-003 | Owned-open→reload→close with valid/damaged marker; direct/new-tab→reload→close fallback; no URL/referrer ownership inference | PENDING |
| FR-004 | Canonical permission/failure/deletion/late-read/account/logout journeys | PENDING |
| FR-005 | Keyboard focus entry/trap/return/fallback and shared tip/prompt identity interactions | PENDING |
| FR-006 | Zero submission/AI writes, analytics count and existing admission/submit/result suites | PENDING |
| FR-007 | Filter/scroll, viewport/theme/reduced-motion and mobile/VoiceOver evidence | PENDING |

This specification is approved; the approval authority and independent review
are recorded in spec.md. Source audit proves the current local-overlay handlers,
not the proposed behavior. Product implementation and its planned evidence
remain pending; no planned test is a PASS.

## Contract evidence

- OpenAPI/type drift: expected unchanged; verify implementation diff.
- Backward compatibility: assignment admission, retry receipts, draft/submit
  dialogs, permitted prompt bank and canonical body rendering must remain intact.

## Data evidence

- Migration/schema query: none proposed; confirm final diff.
- Immediate state versus full reload: native Back/Forward/deep-link/reload and
  BFCache/recreated-document evidence required.

## UI evidence

- Viewports/themes/input methods: 360/390/768/1440, light/dark, reduced motion,
  keyboard, mobile touch/VoiceOver and no horizontal overflow: PENDING.

## Release evidence

- Reviewing authority: root product scope approval and independent learner UX
  and admin engineering review, as recorded in spec.md. The approved base SHA
  becomes available after this specification PR merges; record it in the
  implementation evidence before product code begins.
- Staging SHA and checks: PENDING.
- Production frontend/backend deployed SHAs and read-only journeys: PENDING.
