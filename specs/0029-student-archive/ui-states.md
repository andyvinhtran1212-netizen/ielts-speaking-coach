# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Admin students directory archive action | Confirm button disabled with progress while the request runs | Not applicable to a single row; list empty state unchanged | Row leaves the default list; banner names the learner and whether the account was locked | 404 or network error shows an error banner and keeps the row; retry re-sends the same request | Only admins see the action; instructors never see it | Dialog traps focus, returns focus to the row, works in light and dark at mobile and desktop widths |
| Admin students archived filter and restore | List skeleton while loading archived learners | "Không có học viên đã lưu trữ" when none | Restored learner returns to the default list with previous classes; banner confirms | 409 not archived refreshes the row; other errors keep the row with a retry banner | Admin only | Filter is a labelled control reachable by keyboard; restore has an accessible name |

Canonical data is `students.archived_at`; after a mutation settles the list is
re-fetched, and a reload must show the same archived state.
