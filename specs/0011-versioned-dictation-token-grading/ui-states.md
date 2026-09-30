# UI state matrix

This is proposed behavior pending approval, not implemented UI evidence. Server
session/result records own persisted scores, diffs, reference evidence and
grading versions. Local sentence input owns unsaved text only. Classification
reads never mutate either source.

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Learner start/sentence grade | Preserve typed input while version/reference loading or grade ACK is pending; disable duplicate submission | No lexical reference is invalid authored content, not 100% success; ordinary empty input keeps the approved grading policy | Show frozen policy and lexical word counts; display punctuation is visible without red missing-word treatment | Failed/lost ACK retains input and idempotent retry identity; unsupported version and invalid reference are explicit | Owner/expiry denial shows no private answer/reference and cannot resume another account's work | Keyboard submission/retry, announced feedback without focus theft, 44px controls, 360/390/768/1440, light/dark, reduced motion |
| Learner resume/result/history | Do not substitute current content or latest policy while saved evidence loads | Missing historical evidence is unknown/unavailable, not a reconstructed grade | Reload shows the same saved score, policy, source/user text and diff; legacy records have truthful legacy labels | Read failures retry without regrading or terminal writes; an expired attempt remains expired | Existing ownership gates apply to every record | Readable lexical/unscored distinctions, accessible text beyond color, same viewport/theme matrix |
| Admin aggregate/detail | Keep filter scope explicit; stale values are not labeled as settled current results | Separate no sessions, no lexical errors, punctuation-only trends and missing/invalid data | Rank each lexical/punctuation group before its cap; show raw punctuation totals and unchanged historical accuracy; mixed-version activity has separate policy scores | Retry the read with filters intact; never represent missing labels/counts as dash words | Existing admin gate; no learner-private evidence exposed outside allowed detail | Keyboard filters, loading/error announcements, readable numeric labels, same viewport/theme matrix |
| Authorized comparison/repair | Dry-run pending does not mutate history; authorized repair has a distinct pending/settled receipt | Inadequate original evidence is explicitly unrepairable/unknown | Show reviewed scope, old/new values and provenance; restore preserves original evidence | Concurrent/source-hash conflicts fail safely; retries cannot apply a repair twice | Only an explicitly authorized bounded repair may write; no deploy/startup authorization inferred | Review/confirmation focus is predictable, all values readable without color, same viewport/theme matrix |

Reload, Back/Forward, retries and a release during an active attempt must preserve
the frozen version/reference. No restore/read path may invoke grading or repair.
Focus remains on the learner's active input for a pending grade; settled errors
are announced and the retry control is keyboard reachable. Repair confirmation
applies only to an already reviewed concrete dry-run, with scope and before/after
values visible. Exact browser evidence remains pending in verification.md.
