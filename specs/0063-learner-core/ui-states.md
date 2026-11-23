# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Hôm nay `/home` (cây mới, cờ bật) | khung 5 mục hiện ngay; vùng nội dung có khối giữ chỗ cùng kích thước, không nhấp nháy | không bài giao, không bài dở, không khoá: "Hôm nay không có bài đến hạn." và các khối rỗng ẩn, không thẻ trống | trạng thái theo `state` + `banner`; mỗi khối có nút mở đúng bài hoặc phiếu | API lỗi toàn phần: một `Notice` "Chưa tải được việc hôm nay" + nút "Thử lại" gọi lại API; một phần lỗi (`degraded`): chỉ khối đó báo, khối khác còn | chưa đăng nhập: luồng đăng nhập hiện có; `is_active=false`: cổng kích hoạt hiện có (mở ở G07-T26); 409 `session_not_current`: màn của G05-T20 | 1280px và 390px theo tờ; thanh dưới trên điện thoại; tên dài cắt "…"; mọi nhãn trạng thái có chữ, không chỉ màu; giao diện sáng/tối theo token `--av2-` |
| Khối lượt chấm AI | giữ chỗ | nguồn chưa có, lỗi hoặc học viên lớp mã cũ: ẩn khối, không hiện 0 | một số chung; hai dòng khi có hai nguồn | lỗi: ẩn khối, `degraded` có `credits` | chỉ số của chính người đó | số đọc được bằng trình đọc màn hình kèm nhãn |
| Trạng thái "Chưa có khoá", "Đơn chờ" (dữ liệu giả tới G07-T26) | như trên | — | lối "Xem các khoá", "Nhập mã kích hoạt", Thư viện; hoặc thẻ đơn có nhãn Cảnh báo và hạn bổ sung | lỗi đơn: ẩn thẻ đơn, giữ lối "Xem các khoá" | chỉ đơn của chính người đó | như trên |
| `/home` khi cờ tắt | như hiện có | như hiện có | giao diện cũ y nguyên | như hiện có | như hiện có | ảnh trước/sau giống nhau |

Dữ liệu canonical là `/api/student/today`; trang không giữ trạng thái lạc quan. Tải lại trang gọi lại API và cho cùng kết quả, trừ khối "Vừa có kết quả" (đã xem lần trước thì không hiện lại — FR-025). Bấm nút trong khối là điều hướng, không có thao tác ghi trên trang này.
