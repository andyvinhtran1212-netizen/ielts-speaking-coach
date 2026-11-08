# UI states

- Loading: retain existing initial load; pending save/refetch disables conflicting edits, delivery and next-item actions.
- Empty: no essay selected keeps the existing choose-an-essay state.
- Success: show canonical refetched total, criteria and feedback, matching reload.
- Error: write failure keeps draft; successful write with failed refresh explicitly says saved but not refreshed and requires recovery before delivery.
- Retry: reload canonical state after refresh failure; repeated corrected saves do not create versions.
- Permission denied: existing errors and authorization gates remain.
- Layout/accessibility: no redesign; preserve both themes, responsive wrapping, labels, focus and keyboard access. No new animation or reduced-motion impact.

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Admin Writing grade | Disable conflicting actions during save/refetch | Existing no-essay state | Canonical server feedback matches reload | Preserve draft on write failure; distinguish saved-but-unrefreshed and require reload | Preserve staff/state gates | Existing layout, themes, keyboard labels and focus; no animation change |
