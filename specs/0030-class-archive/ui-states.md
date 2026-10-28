# UI state matrix

All strings are drafts pending Content review (T008).

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Admin classes directory: archive confirm (`admin-classes-directory.tsx`) | Counts load from `archive-preview`; confirm disabled until loaded | — | Title "Lưu trữ lớp?". Text: "Học viên sẽ không còn thấy lớp **{name}**, không ai vào lớp được nữa, và bài đang mở sẽ ngừng nhận bài nộp. Bài đã nộp, bản nháp và điểm được giữ nguyên." Counts: "{n} học viên · {g} bài Writing đang mở · {i} bài lớp đang mở · {c} mã lớp chưa dùng". Optional field "Lý do (không bắt buộc)", ≤500 chars. The list refetches after the receipt. | Preview failure: "Không tải được số liệu lớp — thử lại." with retry; confirm stays disabled. Archive failure: the error message; the row is unchanged after the refetch. | Admin only | Focus moves to the dialog and returns to the button; Esc closes; desktop/mobile, light/dark |
| Restore confirm | Busy state on confirm | — | "Khôi phục lớp?" Text: "Học viên của lớp **{name}** sẽ thấy lại lớp và bài đang mở nhận bài nộp lại theo hạn hiện có." | Error message; refetch | Admin only | As above |
| Legacy inactive class (row and detail) | — | — | Badge "Lưu trữ cũ — chưa áp dụng". Hint: "Học viên vẫn thấy lớp này như trước. Bấm 'Áp dụng lưu trữ' để ẩn lớp và đóng bài, hoặc 'Khôi phục'." The "Áp dụng lưu trữ" action opens the archive confirm. | As archive | Admin only | As above |
| Admin class detail, archived class (`admin-class-detail.tsx`) | — | — | Status "Đã lưu trữ {dd/mm/yyyy HH:mm}" with reason if any; add-learner, give and lesson buttons disabled with tooltip "Lớp đã lưu trữ — khôi phục lớp trước." | A 409 `cohort_archived` from a stale page shows its message and refetches | Admin only | Disabled buttons keep `aria-disabled` and the tooltip is keyboard reachable |
| Learner `/my-class`, `/home` tile | Unchanged | Only archived classes: the existing "chưa có lớp" state | Archived classes omitted | Unchanged | Learner | Unchanged |
| Learner Writing dashboard / detail | Unchanged | Unchanged | Archived class give: label "Lớp đã lưu trữ — đã đóng"; no "Làm bài"; draft read-only. D3 case: label "Lớp đã lưu trữ — hoàn tất bài đang làm" and "Tiếp tục làm bài" until submit or auto-submit. | 409: "Lớp đã lưu trữ — bài này không nhận bài nộp mới. Bài và bản nháp của em vẫn được giữ."; the page refetches | Learner | Label text, not colour only; 375 px and desktop, light/dark |
| Activation (`/login` activate code) | Unchanged | — | Unchanged | Archived class code: the existing generic invalid-code message. FR-008 revert failure: "Kích hoạt chưa hoàn tất. Mã CHƯA được sử dụng — vui lòng thử lại sau ít phút hoặc liên hệ admin." | Signed-in user | Unchanged |
| Instructor dashboard (`instructor-dashboard.tsx`) | Unchanged | Pickers with no active class: existing empty text | Class table shows "Đã lưu trữ" for archived classes; give and mint pickers list active classes only | 409 `cohort_archived`: the message is shown in the form error | Instructor's own classes | Unchanged |
| Admin/instructor give and add forms | Unchanged | Unchanged | Unchanged | 409: "Lớp đã lưu trữ — khôi phục lớp trước khi thêm học viên hoặc giao bài." | Unchanged | Unchanged |
| Mock exam list/start | Unchanged | Unchanged | Unchanged | "Lớp của bạn đã kết thúc — kỳ thi này không còn mở." | Learner | Unchanged |

Canonical data: `cohorts` (`is_active`, `archived_at/by/reason`) and
`class_lifecycle_audit`. Every archive, restore or apply waits for the RPC
receipt and then refetches the list and detail; there is no optimistic flip.
A reload must show the same state.
