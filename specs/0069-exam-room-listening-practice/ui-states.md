# UI state matrix

Dữ liệu chuẩn là máy chủ: câu trả lời (`attempt.answers`, `PATCH .../answers`), câu đã đối chiếu (`guided-state`), lượt nghe một lần (`playback_started_at`). Bản sao tại máy chỉ giữ câu chưa ack (EXAMROOM-0066 FR-035). Các trạng thái dưới chỉ áp cho nhánh cờ bật; nhánh cờ tắt giữ nguyên hôm nay.

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Runner (mở bài) | "Đang tải bài nghe…" tới khi tạo lượt, đề, `guided-state` xong | Bài không có câu: không dải câu | Câu hỏi, dải câu, trình phát | Lỗi tải: thông báo hiện có "Không tải được bài nghe." với "Thử lại" | Bài không thuộc report-only: thông báo hiện có | Thanh điều hướng thường; 390px; theo theme |
| Trạng thái lưu | "Đang lưu…" | Chưa trả lời: "Câu trả lời được tự động lưu" | "Đã lưu lúc HH:MM" | "Chưa lưu được, đang thử lại", rồi "Thử lưu lại" | — | `aria-live="polite"`; chữ, không chỉ màu |
| Hộp hoàn thành | Đang nộp: nút khoá "Đang hoàn thành…"; đang đối chiếu: "Đang đối chiếu, chờ một chút" | Không còn câu trống: hộp thường | Sang trang kết quả | Nộp lỗi: hộp giữ mở, "Chưa hoàn thành được…", "Thử lại" | — | Tiêu điểm đầu ở "Quay lại làm bài"; Esc đóng |
| Trình phát `practice` | Đang tải audio: nút "Phát" khoá | Không có audio: không hiện trình phát | Tạm dừng, tua, tốc độ, A–B | Lỗi tải: "Chưa tải được bài nghe" với "Tải lại bài nghe" | — | Phím cách chỉ khi tiêu điểm không ở ô nhập |
| Trình phát `once` | "Đang bắt đầu…" | — | Đang phát không tạm dừng; xong "Đã nghe · đã khoá" | Máy chủ chưa nhận: "Xác nhận lượt nghe"; mất mạng: "Nghe tiếp từ mm:ss" | — | Màn cảnh báo trước khi phát |
| Dải mất mạng | — | — | "Đã kết nối lại…" 5 giây | "Mất kết nối mạng. Bài của bạn đã lưu tới HH:MM…" | — | Chỉ runner `active`; `role="status"` |
| Hộp đăng nhập lại | Đang đăng nhập | — | Quay lại đúng tài khoản: gửi câu chưa lưu (máy chủ chưa đổi) | Lỗi đăng nhập: thông điệp của component | Tài khoản khác: không thấy bản sao | Chỉ runner `active` |
| Thông báo tab khác | — | Không hỗ trợ: không hiện | Tab giữ khoá ghi được | Không có khoá sau 5 giây: chỉ-đọc với "Tải lại" | — | `role="alert"` một lần |
