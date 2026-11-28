# UI state matrix

Dữ liệu chuẩn là máy chủ: sitting (`status`, `activeSection`, `sectionTimeLeftSeconds`, `collected_section`, `*SubmittedAt`), bài Writing đã lưu, câu trả lời của trang con. Bản sao tại máy chỉ giữ chữ Writing chưa ack (EXAMROOM-0066 FR-035). Các trạng thái dưới chỉ áp cho nhánh cờ bật; nhánh cờ tắt giữ nguyên hôm nay.

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Phòng chờ, màn vào bài | "Loading your test…" | Chưa có phần nào mở: "Waiting for the invigilator to open the next section." | `self_paced`: tổng thời lượng, `selfPacedNotice`, nút bắt đầu | Mở phần lỗi: thông điệp hiện có, thử lại | Không trong danh sách người dự thi: 404 như kỳ không tồn tại (sau T004) | Dòng phụ tiếng Việt; dưới 768px: màn chặn |
| Thanh trên | — | — | "Mock test · <tên>", "Section i of n", "Time remaining" mm:ss, dải phần | Đồng hồ không chạy khi thiếu dữ liệu máy chủ | Không in email, tên | Luôn sáng; mốc 5 phút đọc một lần |
| Thân Reading/Listening | iframe đang tải | Nội dung phần không có: "Content for this section is unavailable. Contact your invigilator." | Trang con chế độ nhúng | `mock-flushed` sai hoặc quá 8 giây: thử lại flush | — | `inert` khi thu bài |
| Thân Writing | Ô khoá tới khi đọc bài đã lưu | Chưa viết: "Words: 0 · minimum 150/250" | "Saved at HH:MM"; hết giờ và `confirmed`: "Time is up. Your test has been submitted." kèm số từ | "Not saved. Retrying…", "Retry"; bản sao cũ khác: hỏi chọn | — | Thẻ Task có nhãn đọc; bộ đếm `aria-live="polite"` |
| Thu bài | "Saving your final answers…", thân khoá | — | `flush-ack` xong: phần đóng | Flush lỗi: thử lại mỗi giây như hôm nay | — | `role="status"` |
| Trạng thái nộp | `submitting` | — | `confirmed`: sang phần kế hoặc "Test collected" | `unconfirmed` (3 lần), `unconfirmed_manual` "Try again", `closed_unconfirmed` "This section was closed by our server at HH:MM." (mốc máy chủ, không tự suy giờ lưu); máy chủ đóng phần mà không gửi mốc (sitting hết trạng thái làm bài, `*SubmittedAt` trống): "This section was closed by our server." không kèm giờ, không lấy giờ máy; chỉ có `flush-ack` hoặc giám thị mới bắt đầu thu (`*SubmittedAt` trống): vẫn chờ và thử lưu lại; 403/404: thông điệp hiện có | — | `aria-live="polite"` |
| Hộp thoát | Đang flush: "Leave test" khoá | — | Về `/home` | Còn câu chưa lưu: nêu số câu, không thoát âm thầm; bản sao không đọc lại khớp: chỉ "Stay in test" | Không có "Abandon test" | Bẫy tiêu điểm; Esc đóng |
| Dải mất mạng | — | — | "Back online…" 5 giây | "Connection lost…" kèm "Keep this tab open" | — | `role="status"`; không che ô làm bài |
| Hộp đăng nhập lại | Đang đăng nhập: đồng hồ vẫn chạy | — | Đúng tài khoản: tiếp tục | Bản sao đọc lại không khớp: ở yên trong trang | Tài khoản khác: không thấy bản sao | Hộp chặn |
| Thông báo tab khác | — | Không hỗ trợ: không hiện | Tab giữ khoá làm bài | Không có khoá sau 5 giây: chỉ-đọc, không nạp iframe, "Reload" | — | `role="alert"` một lần |
| Chuyển phần `self_paced` | "Section submitted. Next: <section>" | — | Phần kế với đồng hồ theo mốc máy chủ | — | — | Không nút bỏ qua hay hoãn |
| Màn sau cùng | — | — | "Test collected" / "Test submitted", "Start Speaking →" nếu còn Speaking | Kỳ bị huỷ: "This test has been cancelled…" | — | Dòng phụ tiếng Việt |
