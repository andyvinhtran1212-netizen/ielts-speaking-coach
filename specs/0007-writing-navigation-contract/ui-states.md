# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Writing Queue | Keep URL filters, page, and size visible while fetching | Exact empty page names active filters; incomplete empty snapshot retains requested offset | Controls, request limit/offset, count, and deep links agree with normalized URL | Preserve safe snapshot with warning and retry; never label partial total exact | Existing admin gate; no unauthorized rows or action | 390/768/1440; light/dark; visible focus, 44px targets, keyboard controls, reduced motion |
| Writing Status | Preserve Queue context during canonical status read/poll | Missing essay ID offers a safe Queue link | Grade link carries the complete Queue context | Failed read offers retry/return without losing source | Existing admin gate remains authoritative | Embedded Mock and standalone layouts, readable status/focus in both themes |
| Writing Grade | Keep validated source context during essay load | Missing essay ID has truthful fallback | Queue-origin return/next preserves filters and size; Instructor-origin return preserves view; direct entry does not fake either source | Save/readback failure remains in workspace; retry/return target is safe and source-aware | Existing admin gate and canonical essay authorization | Existing grade layout at all widths, themes, focus and reduced-motion behavior |

The backend remains canonical for essay status and grading. Session storage may
only assist a validated Queue-origin next action; URL context owns navigation.
Mutation completion and a full reload must agree. An account switch or changed
URL invalidates stale requests and saved sequence context.
