# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| L1/L2 passage support | Keep existing passage load state | Hide unavailable support; show honest paragraph/full fallback | Source stays visible with inline translation and linked phrase highlights | Invalid/stale alignment falls back, does not invent links; check retry retains inputs | Existing signed-in published-passage boundary | 320/390px reflow; light/dark; native sentence actions and word controls; visible focus; copy/select and reduced motion |
| Practice questions | Pending check is distinct and cannot duplicate | Missing required statement/options fails visibly | Complete options, tables and checked evidence with return action | Failed/invalid ACK does not lock or clear newer answers | Result remains current-account/resource scoped | Keyboard checkbox/select and readable table gaps; no answer-bearing illustration before check |
| Reading libraries | Existing list state and abort fencing | Show no matching results and reset controls | Search/filter/batches/back restore consistent URL state | Retry retains existing loaded results where possible | Existing authenticated library boundary | Reflow toolbar/nav, actual metadata, canonical Mini groups |

Backend owns content/check truth. Local controls select only authored support;
no provider call or optimistic score. Preserve existing draft/revision fencing.
Reload reflects canonical content, while transient selected translation need not
be stored as learner progress. Closing lookup restores its trigger focus.
