# UI state matrix

Dữ liệu chuẩn là server: bản nháp (`draft_text`, `updated_at`), trạng thái bài, đồng hồ (`GET /timer`). Bản sao tại máy (EXAMROOM-0066 FR-035) và biên nhận nộp (`WritingSubmitReceipt`) chỉ giữ chữ để không mất bài; không bao giờ tự ghi đè bản server mới hơn. Các trạng thái dưới chỉ áp cho nhánh cờ bật; nhánh cờ tắt giữ nguyên hôm nay.

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Trình soạn (mở bài) | Ô nhập khoá, "Đang mở bài…" tới khi `renderer-affinity`, `start`, chi tiết bài xong | Bài chưa có nháp: ô trống, "0 từ · cần ít nhất 250" | Ô nhập có bản đã chọn theo FR-009; bộ đếm theo Task | Mở bài lỗi: thông báo hiện có với "Thử lại" | Bài lưu trữ: chỉ đọc, không nút lưu/nộp; 409 `admission_required`: luồng hiện có | Bài có giờ: thanh tập trung chế độ luyện; 390px dùng được; nhãn đọc ô nhập |
| Hỏi chọn bản nháp | — | — | Chọn một bản; chọn bản máy thì lưu lên | Lưu lên lỗi: trạng thái lưu FR-007 | Chủ khác: không hỏi, bản sao bị xoá không đọc | Bẫy tiêu điểm; hai bản có số từ và giờ bằng chữ |
| Trạng thái lưu | "Đang lưu…" | Chưa gõ gì: không hiện | "Đã lưu lúc HH:MM" giữ nguyên | "Chưa lưu được, đang thử lại", rồi "Thử lưu lại" | — | Chữ, không chỉ màu; `aria-live="polite"` |
| Bộ đếm từ | — | 0 từ | Đủ mức: chữ thường | Thiếu mức: viền `--mark`, nhãn "Cảnh báo" | — | Không chỉ dựa vào màu |
| Hộp thiếu từ, hộp hỏi lại | — | — | "Nộp chấm" gọi `submit` một lần | Nộp lỗi: thông báo hiện có (đối chiếu, 409, từ chối); 402: khối hết lượt | — | Tiêu điểm đầu ở nút an toàn ("Viết tiếp", "Quay lại"); Esc đóng |
| Hết giờ (bài có giờ) | `submitting`: "Đang nộp bài…"; ô khoá | — | Chỉ khi phản hồi nộp được xác nhận: "Bài của bạn đã được lưu và nộp." | `unconfirmed`: thử lại tối đa 3 lần cùng `request_id`; rồi `unconfirmed_manual` có "Thử lại" | 401: hộp đăng nhập lại | `aria-live`; không thêm giờ |
| Dải mất mạng | — | — | Có mạng lại: "Đã kết nối lại…" 5 giây | "Mất kết nối mạng. Bài của bạn đã lưu tới HH:MM…" | — | `role="status"`; không che ô nhập |
| Hộp đóng | Đang lưu nốt: nút "Đóng" khoá | Đã lưu hết: đóng ngay | Đóng, bỏ `assignment_id` khỏi URL | Lưu nốt lỗi: "Bài còn phần chưa lưu" với "Ở lại" chính | — | Bài có giờ: "Đồng hồ vẫn chạy khi bạn đóng bài." |
| Thông báo tab khác | — | Không hỗ trợ: không hiện | Tab giữ khoá ghi được | Không có khoá sau 5 giây: chỉ-đọc với "Tải lại" | — | `role="alert"` một lần |
