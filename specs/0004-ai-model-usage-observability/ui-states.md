# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Admin AI usage dashboard | Preserve filter controls and show the existing loading state without invented zero totals | Show a clear no-events result while retaining selected filters and data-quality metadata | Render provider/model/feature/status totals, dated pricing metadata, and unknown services from the canonical endpoint | Keep the previous settled view or explicit error state; show legacy/truncated/unpriced warnings and permit a safe reload | Existing admin gate remains canonical; unauthenticated/non-admin users receive the existing denied flow with no usage payload | Tables/cards remain keyboard-readable, responsive, and compatible with existing light/dark tokens |
| Learner Speaking result | Existing submission/grading progress remains unchanged | Existing no-result state remains unchanged | Existing band, feedback, recommendation, and audio result shape renders regardless of which configured provider succeeds | Existing retry/failure message remains; provider fallback is not presented as a second learner submission | Existing learner ownership and authentication checks remain unchanged | No new controls; current focus, mobile, theme, and screen-reader behavior must regress neither |

Canonical backend records own usage totals and selected-model truth. The UI must not
infer missing provider data as zero, discard unknown provider rows, or display a
Writing cost twice. Changing the Speaking model is operational configuration and
does not create optimistic learner state.
