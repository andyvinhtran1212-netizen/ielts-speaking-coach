# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Phiếu Writing (cây mới) | khung phiếu giữ chỗ cùng kích thước | bài chưa có chú thích: ẩn "Xem lại" | nguồn chấm, band theo 5.1, việc nên sửa (có liên kết học khi có đích), ba lối ra, dòng lượt | lỗi tải phiếu: "Chưa tải được kết quả, thử lại"; lỗi số dư: ẩn dòng lượt | chờ giáo viên duyệt: 4 bước, không band/tiêu chí/nhận xét; bài của người khác: 404 như hiện có | 390/820/1280px; token G03 sáng/tối; `aria-current="step"` |
| Form chấm lại Writing | nút "Đang gửi…" | chưa gửi: nút "Yêu cầu chấm lại" | "Đã gửi yêu cầu chấm lại · <giờ>", lý do, ghi chú, trạng thái (Đang chờ / Đã nhận / Không chấp nhận + phản hồi / Đã chấm lại) | 422: lỗi dưới ô, tiêu điểm tới ô lỗi, giữ dữ liệu; 409: tải lại trạng thái; lỗi mạng: giữ dữ liệu, nút thử lại | chỉ bài `delivered` của chính mình; Speaking không có form | radio dùng bàn phím; bộ đếm n/300 có `aria-live` |
| Phiếu Speaking (cây mới) | giữ chỗ | không có đoạn chấm phát âm: không hiện dòng | "AI chấm, trả ngay", band, đoạn chấm phát âm và nút nghe, ba lối ra | bản ghi hết hạn: ẩn nút nghe, giữ dòng chữ | như hiện có | như trên |
| Phiếu thi thử (cây mới) | giữ chỗ từng phần | đề tự chọn: không có dòng Overall | kỳ được giao đủ 4 kỹ năng: Overall | còn phần đang chấm: "Chưa có Overall: còn chờ chấm …", phần đó "Đang chấm" (G08) | như hiện có | như trên; đề gọi bằng tên |
| `CreditsEmptyNotice` | — | — | `class`: "Liên hệ giáo viên để được cấp thêm"; `online` + `can_renew`: nút "Đăng ký lại khoá · kèm N lượt"; `online` không `can_renew`: "Liên hệ Aver để được cấp thêm lượt" + khối liên hệ | thiếu `credit_source`: câu chung "Bạn đã hết lượt chấm AI", không nút | — | không có chữ "mua", "giá" |
| Phiếu khi cờ `learner_v2` tắt | như hiện có | như hiện có | phiếu cũ y nguyên | như hiện có | như hiện có | ảnh trước/sau giống nhau |

Dữ liệu canonical là phản hồi API của phiếu và của yêu cầu chấm lại. Trang không giữ trạng thái lạc quan: sau khi gửi, trạng thái yêu cầu đọc lại bằng `GET`, nên tải lại trang cho cùng kết quả.
