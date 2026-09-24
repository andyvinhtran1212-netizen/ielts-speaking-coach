# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Programme form | Keep current skeleton and no premature language control | Missing translation keeps original wording | Full form switches every prompt and option label; answer keys stay stable | Source mismatch falls back to original and logs a bounded error; save/reveal retry unchanged | Existing authenticated programme guard | Check mobile/desktop, 44px control, keyboard focus, both themes and reduced motion |
| Lesson/library | Keep current loading state | Unpublished revision invisible | Approved new title, instruction and outcomes show as canonical content | Existing retry/partial-data presentation | Existing programme auth | Long Vietnamese/English copy wraps without clipping in light/dark |

Canonical text comes from the new published package revision, not an optimistic
frontend sidecar. Switching language must not mutate an attempt; after reload,
the same answer/feedback is displayed regardless of current text preference.
