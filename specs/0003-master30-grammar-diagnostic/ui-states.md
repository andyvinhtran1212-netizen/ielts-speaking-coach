# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Learner setup | Stable setup skeleton | No assignment explains next step | Quick/Full scope and no-grade policy are explicit | Retry preserves mode choice | Wrong or inactive assignee receives unavailable state without content | Aver tokens, keyboard choices, visible focus, mobile stack |
| Diagnostic session | Progress shell preserves question position | Invalid release fails closed | Server-selected item and saved progress survive reload | Failed answer stays local and can retry canonical state | Every read/write rechecks assignment and membership | Large targets, labelled options, reduced motion, dark/light themes |
| Readiness report | Report skeleton | Incomplete session links back safely | Priorities, evidence, and review routes match persisted snapshot | Failed read distinguishes error from no report | Owner/admin only; no cross-user evidence | Semantic sections, responsive cards, non-color status cues |
| Educator report | Canonical loading state | No completed report is explicit | Objective evidence and misconception summary match learner report | Lookup failure is visible and reload-safe | Admin gate hides learner data from non-admins | Responsive table/cards, focus order, Aver tokens |

Pending UI mutations never create optimistic completion. Productive tasks have no
automatic submission or scoring action in these surfaces.
