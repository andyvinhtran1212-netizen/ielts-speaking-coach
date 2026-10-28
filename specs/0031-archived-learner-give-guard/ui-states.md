# UI state matrix

No component changes. The 409 `student_archived` detail object already exists
(STUDENTARCHIVE-0029) and the shared transport (`public/js/api.js`) surfaces
`detail.message` for object details.

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Admin Writing "Giao bài" dialog (`admin-writing-assignments.tsx`), individual and class | Submit disabled while busy (unchanged) | Unchanged | Unchanged receipt and list refetch | 409 `student_archived` shows "Học viên đã được lưu trữ — khôi phục hồ sơ trước khi thao tác." in the dialog error, never `[object Object]`; the list refetch shows no new row; a retry with the same `request_id` repeats the 409 (the RPC rolled back, no ledger row) and never shows "request incomplete" | Admin only (unchanged) | Error announced in the dialog's existing error region; desktop and mobile, light and dark |
| Instructor dashboard give and class fan-out (`instructor-dashboard.tsx`, `public/js/instructor-app.js`) | Unchanged | Unchanged | Unchanged | Same 409 message; a class fan-out creates nothing, and a re-submit after the archive succeeds for the remaining learners | Instructor's own learners and classes (unchanged) | As above |

Canonical data is `writing_assignments`. After any give, settled or refused,
the list refetches, and a reload must show the same rows.
