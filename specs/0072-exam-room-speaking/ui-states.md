# UI state matrix

Dữ liệu chuẩn là máy chủ: phiên (`GET /sessions/{id}`), câu đã gửi và chấm. Bản ghi chưa gửi chỉ ở bộ nhớ trang (LEARNERDRAFT-0010), không lưu vào trình duyệt. Các trạng thái dưới chỉ áp cho nhánh cờ bật; nhánh cờ tắt giữ nguyên hôm nay.

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Thanh tập trung | Tên bài | — | "‹ Thoát", đồng hồ đếm lên, Part hiện tại | — | Không in email | Chế độ luyện; 390px gọn |
| Micro | Đang chờ trình duyệt: "Hãy chọn Cho phép…", nút khoá | Trước khi xin: "Cần micro để ghi âm câu trả lời." | Đã cho phép: "Sẵn sàng" | Không tìm thấy micro, micro bận: lý do và "Thử lại" | Bị từ chối: ba bước mở lại và "Thử lại" | `aria-live="polite"`; ca từ chối `role="alert"` một lần |
| Ghi âm | — | "Sẵn sàng" | "Đang ghi" mm:ss; "Đã ghi" kèm thời lượng và nghe lại | "Không nghe thấy tiếng" sau 3 giây im lặng; "Tạm dừng" khi micro bị tắt; bản quá ngắn: lý do có số giây | — | Chữ, không chỉ màu; giảm chuyển động cho dạng sóng |
| Gửi bản ghi | "Đang gửi…" | — | Sang feedback như hôm nay | Gửi lỗi: "Gửi lại bản ghi"; 422 quá ngắn: lý do theo `min_seconds` | 401: bản ghi còn trong trang; còn bản chưa gửi thì hộp chỉ có "Ở lại làm tiếp" (trước G05-T19), hết bản chưa gửi thì "Đăng nhập lại" (FR-010) | — |
| Hộp ghi lại | — | Bản đã gửi: không hỏi | "Xoá và ghi lại" xoá bản chưa gửi | — | — | Tiêu điểm đầu ở "Giữ bản ghi" |
| Hộp rời bài | — | Không còn bản chưa gửi: thoát ngay | "Bỏ bản ghi và thoát" điều hướng bằng mã | — | — | Tiêu điểm đầu ở "Ở lại"; Esc đóng |
| Hộp nộp | "Đang nộp…" | Không còn bản chưa gửi: nộp như hôm nay | Sang kết quả | Lần ghi đầu gửi lỗi: Nộp khoá, "Gửi lại bản ghi" trên ô; ghi lại gửi lỗi khi câu đã có bản lưu: "Gửi lại bản ghi" hoặc "Vẫn nộp"; 402: khối "Hết lượt chấm" | — | Câu về lượt chỉ khi có số liệu G04 |
| Thông báo tab khác | — | Không hỗ trợ: không hiện | Tab giữ khoá ghi được | Chỉ-đọc: không mở micro, "Tải lại"; tab cũ còn bản chưa gửi hoặc đang tải lên: từ chối bàn giao, tab mới `stuck` với lý do | — | `role="alert"` một lần |
