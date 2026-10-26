# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Existing Grammar revision admin | Pending canonical read | Missing source is unavailable, not zero | Preview and settled canonical readback | Conflict reload; lost ACK reconcile same UUID | Admin-only reads and publication | Preserve existing keyboard/focus/dialog semantics, themes and responsive layout |
| Native Grammar player/history | Frozen bank/revision pending | No start without valid content | Current work or owned frozen legacy source | Unavailable/stale; no automatic writes/retry | Owned work only | Preserve keyboard, focus, reduced motion, theme and mobile behavior |
| Grammar article CTA/result | Existing loading state | No exercise link if unavailable | True concept count and practice-count label | Existing error/retry owner | Public article; exercise auth unchanged | Text wraps in existing responsive/theme styles |

Reload must show canonical current mapping and retain original historical content.
Pending mutation does not optimistically claim successful publication or saved work.
