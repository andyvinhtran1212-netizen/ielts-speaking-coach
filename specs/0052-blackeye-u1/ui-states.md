# UI state matrix

PR1 không có UI. Bảng dưới là yêu cầu cho PR2.

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Danh sách Unit 1 của học viên | Khung chờ, không hiện activity giả | Chưa có activity published: thông báo "Chưa có bài", không hiện 0% | A1–A20 theo thứ tự; A8/A14/A19 có nhãn lý do và nút "Bắt đầu" khóa | 503: thông báo lỗi kỹ thuật và nút thử lại, không coi là rỗng | 401 về đăng nhập; 404 "không khả dụng" | 390 px không vỡ thẻ; nhãn khóa đọc được bằng trình đọc màn hình; 44 px; hai theme đủ tương phản |
| Runner activity | Chờ snapshot | Ô chưa làm hiện trống | Lưu: đang lưu → đã lưu theo ACK thật | Lưu lỗi: "chưa lưu", giữ chữ đã gõ, thử lại; 409/422 hiện lý do | Attempt người khác: 403 | Bảng giữ ngữ cảnh hàng/cột trên mobile; ô KEEP/CHANGE dùng được bằng bàn phím |
| Nộp bài | Nút nộp bận | Danh sách ô trống trong hộp xác nhận | Đã nộp theo ACK server; "Không chấm điểm tự động" | Mất ACK: đọc lại trạng thái, không đoán; 409 hiện "bài đã đổi" | — | Focus vào hộp xác nhận rồi về kết quả |
| Chữa bài sau nộp | Chờ tải chữa bài | Thiếu đáp án/giải thích: "chưa có", không hiện sai | Câu trả lời, đáp án tham chiếu, nguồn gốc, giải thích, ghi chú giới hạn, transcript đúng activity | 503: giữ bài đã nộp, nút thử lại không nộp lại | 403/409 rõ ràng | Không lộ đáp án qua nhãn trước nộp; hai theme |
| Admin xem trước và giao bài course 2 | Chờ catalog | Lớp không có học viên đủ điều kiện: nêu rõ | Biên nhận: số người nhận thật, activity, hạn | Lỗi tra cứu học viên hiện lỗi, không hiện rỗng; gửi lại cùng request trả cùng biên nhận | Admin không thuộc cohort: 403/404 | Bảng chọn dùng bàn phím; 1440 và 390 |
| Bảng tiến độ course 2 | Chờ dữ liệu | Chưa ai làm: "chưa bắt đầu" cho mọi ô | Trạng thái từng học viên × activity, giờ nộp, số ô trống; chính tả cột riêng | Lỗi tra cứu hiện lỗi, không hiện 0 | Chỉ giáo viên/admin được phép của course 2 | Bảng cuộn ngang giữ tên học viên; hai theme |

Dữ liệu chuẩn: `listening_test_attempts` và snapshot. Tải lại trang phải hiện
đúng trạng thái đã lưu. Card chính tả: "Bổ trợ tự chọn / Chưa mở", nút khóa,
cho tới khi FR-023 mở.
