# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Teacher catalog | Fetch blocks give | Reasons for blocked banks | Exact90+10/additions, recipients | Visible failure/refetch | Admin/C5 only | Dialog focus/keyboard/themes/mobile |
| Learner | Auth bootstrap | Frozen start; no keys | MCQ/E controls and saved feedback/counts | Retain drafts, safe retry, visible conflict | Owner/member, expiry/paused read-only | Labeled textarea/radio, focus, themes, reduced motion/mobile |
| Teacher report | Auth-aware read | Untouched distinct from unknown | Actual E text/model/rubric, objective counts | Unknown lookup/refetch | Admin, reject stale account | Responsive text/table and keyboard/themes |
| Diagnostic | Exposure history loading | Insufficient evidence visibly blocked | Independent evidence | Visible exposure/exhaustion, no silent fallback | Existing owner/phase gates | Existing responsive/focus/theme behavior |

Success follows backend state; pending mutation prevents duplicates. Logout/route
change clears private state and ignores stale reads. Response loss preserves
safe drafts. Writing never displays a correct/incorrect badge.
