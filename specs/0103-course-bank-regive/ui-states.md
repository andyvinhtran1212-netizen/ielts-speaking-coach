# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Admin homework editor, Course bank picker | Existing catalog loader | Existing "no banks" state | A previously given bank is selectable with "Đã giao ngày … · giao lại được"; after giving, the catalog refetch shows the new date | A failed give keeps the editor open; retry sends the same request id; 409 on a changed intent shows the server message | Existing staff guard on the admin class routes | Existing option labels and tokens; the note is text, not colour only |

Canonical data is `class_assignments`; after a give the editor refetches the
catalog, and a reload shows the same last-given date.
