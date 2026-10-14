# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Learner hub/library | Stable nav and skeletons | Explain missing assigned sets, retain collections | Canonical audience and cards | Visible retry; no fake zero | Sign-in or denied state | 320px/400px/desktop, both themes, real links, focus |
| Set/player | Load exact set/session | Explain empty/due/example scope | Acknowledged progress, resume same selection | Keep answer and stable mutation ID for retry | Recheck active access, show denied | Accessible flip/answer controls, reduced motion, return context |
| Admin sets/results | Preserve filters while loading | Create set or explain no evidence | ACK/refetch before success | Keep draft, display conflict/retry | Admin-only authoring | Keyboard forms, responsive table, both themes |

State is keyed by account; switching accounts removes previous learner data.
Pending mutations do not claim saved results. Session reload returns accepted
evidence and the original frozen content, not a regenerated selection.
