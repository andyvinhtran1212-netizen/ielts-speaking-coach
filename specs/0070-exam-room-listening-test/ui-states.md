# UI state matrix

Dữ liệu chuẩn là máy chủ: câu trả lời (`attempt.answers`, `PATCH .../answers`), cờ xem lại, `started_at` (vị trí tiếp tục audio full test), trạng thái lượt. Bản sao tại máy chỉ giữ câu chưa ack (EXAMROOM-0066 FR-035). Các trạng thái dưới chỉ áp cho nhánh cờ bật; nhánh cờ tắt giữ nguyên hôm nay.

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Màn trước khi bắt đầu (`prestart`) | Khung với tên đề, nút khoá tới khi boot xong | Đề không có câu: "This test is not available" với "Back" | "Start test" chính, "Back" phụ; có lượt dở thì "Resume test" và "Start a new attempt" mở hộp trong trang | Boot lỗi: màn lỗi hiện có với "Retry" (`bootWithRecovery`) | 409 `admission_required`, 403: màn hiện có | Full test dưới 768px: màn chặn; full test luôn sáng; tiếng Anh |
| Thanh trên | Tên đề | — | "Listening · <tên đề>", "Part i of n", tiến độ audio bằng chữ | — | Không in email, tên; admin: "Admin preview" | Không có "Time remaining"; 390px gọn |
| Trình phát `test` (full) | "Loading audio…", nút khoá | — | Đang phát, chỉ âm lượng; tải lại tiếp từ `listeningResumeOffsetSeconds` | Không tự phát được: "Play" kèm "The test timer continues."; lỗi tải: "Reload audio" | — | Không phím cách; nhãn đọc |
| Trình phát `practice` (mini, drill, practice) | Như trên | Không có audio: không hiện | Tạm dừng, tua, tốc độ | Như trên | — | Phím cách khi tiêu điểm không ở ô nhập |
| Dải câu | Chưa có đề: không hiện | — | Ô theo Part, bốn trạng thái; bấm số chỉ cuộn | — | — | `aria-current`; 1280/768/390 theo 0066 FR-008 |
| Trạng thái lưu | "Saving…" | Chưa trả lời: không chữ | "Saved at HH:MM" | "Not saved. Retrying…", rồi "Retry" | — | `aria-live="polite"` |
| Hộp nộp | "Submitting…", nút khoá, Esc không đóng | Không câu trống: hộp thường | `confirmed` → kết quả như hôm nay | Câu chưa lưu: nút nộp khoá kèm "Retry"; `unconfirmed`: ở lại trong bài, ô khoá, tự thử tối đa 3 lần; `unconfirmed_manual`: "Try again"; quá 24 giờ: thông điệp máy chủ và "Back" | Nhúng, admin: không có nút nộp | Bẫy tiêu điểm; tiêu điểm đầu ở nút an toàn |
| Thoát và bỏ bài | Đang flush: "Leave test" khoá | — | Rời về `backHref`; bỏ bài: lượt `abandoned`, về màn trước khi bắt đầu | Còn câu chưa lưu: hộp nêu số câu; route bỏ trả 409: "This attempt has already been submitted." và mở kết quả | Bài giao, sitting, admin: không có "Abandon test" | Full test: câu "The recording keeps playing on our side…" |
| Dải mất mạng | — | — | "Back online…" 5 giây | "Connection lost. Your work was saved up to HH:MM…"; nút nộp "Waiting for connection" | — | `role="status"` |
| Hộp đăng nhập lại | Đang đăng nhập | — | Đúng tài khoản: gửi câu mà máy chủ vẫn bằng `baseValue` | Bản sao đọc lại không khớp: chỉ "Stay", nêu câu chưa lưu ở đâu cả, không chuyển sang `/login` | Tài khoản khác: không thấy bản sao | Hộp chặn, bẫy tiêu điểm |
| Thông báo tab khác | — | Không hỗ trợ: không hiện | Tab giữ khoá ghi được, phát audio được | Không có khoá sau 5 giây: chỉ-đọc, "Reload" | — | `role="alert"` một lần |
| Nhúng (`mock_embed=1`) | — | — | Không thanh trên, không nộp, không thoát; trả lời `mock-flush` | — | — | Theo runner thi thử |
