# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Mock Test cockpit | Stable task shell and explicit busy label | No exams or no open room gives a purposeful next action | Task-aware rail and selected workspace agree with URL/context | Keep usable prior snapshot, show stale/error warning and retry | Existing admin gate remains authoritative | Compact rail at narrow widths; localized labels, visible focus, 44px targets, both themes |
| Manage/Create | List skeleton without mounting creation | No exams or picker no-result is explicit | List is default; creation is deliberate and preserves payload contract | Partial picker/progress failure blocks only unsafe actions and supports reload | Existing admin gate remains authoritative | Searchable selectors are keyboard operable and selected identity stays visible |
| Content bank | Bounded page loading does not clear a previously complete total | No matches names active filters and clear action | Only active page mounts; total/filter/readback are canonical when all sources succeed | Preserve prior page, name failed sources, mark surviving subtotal incomplete, and retry explicitly | Existing admin gate remains authoritative | Table/cards avoid page overflow; row actions have contextual names; explicit save/cancel |
| Live/Review | Selected exam context remains stable while refreshing | No open/actionable exam has a purposeful CTA | Defaults are task-appropriate while explicit valid links win | Stale snapshot and unsafe mutation states stay visible | Existing admin gate remains authoritative | Compact context, keyboard task switching, enum fallback, both themes |
| Mock Writing queue | Stable filters and page while request is active | No matches preserves filters and offers reset | Exact total, bounded rows, query context, polling and canonical readback agree | Keep last safe snapshot and show retry; an old-backend 404 may use the legacy array only with a visible incomplete compatibility warning after applying active query/overdue filters locally | Existing admin gate remains authoritative | 390px rows become readable cards; filters and actions have visible focus/44px targets |

Canonical ownership remains with FastAPI and PostgreSQL. Mutation success is
settled only after canonical readback; automatic page correction preserves its
outcome notice. Account or filter changes invalidate stale in-flight responses.
