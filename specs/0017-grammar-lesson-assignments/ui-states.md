# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Class homework catalog | Fetch indicator, submit disabled | No ready Bxx shown with reasons | Ready Bxx, scoped recipients and deadline | Failed catalog or give is visible; retry refetches canonical ledger | Admin only; wrong course blocked | Existing dialog keyboard/focus; mobile scroll; both themes |
| My Class task | Ledger loading | No lesson assigned is neutral | Assigned Bxx and due state | Start failure visible; retry does not duplicate | Other learner's item unavailable | Keyboard link/focus; mobile card; both themes |
| Lesson and practice | Content loading | Missing practice blocked before start | Specific Bxx teaching, questions and feedback | Submit conflict, expiry or network error with safe retry | Active member and owner only | Keyboard answering; focus after feedback; reduced motion; both themes |
| Teacher results | Roster loading | No submissions stated | Canonical per-recipient completion and result | Reconcile/read failure is visible | Admin only | Responsive table and keyboard access; both themes |

Mutation pending states disable duplicate actions. Success is shown only after
canonical backend confirmation; a full reload must display the same assignment,
recipient scope, attempt and result. Dialog close restores focus to its trigger.
