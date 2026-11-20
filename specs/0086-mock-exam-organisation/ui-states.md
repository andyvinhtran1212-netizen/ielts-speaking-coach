# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Danh sách kỳ thi, Tổ chức kỳ thi ba bước, trang một kỳ thi 7 thẻ | bảng thí sinh hiện khung chờ | chưa có kỳ thi → nút "Tổ chức kỳ thi" | trạng thái Nháp → Đã lên lịch/Đang mở → Đang diễn ra → Chờ chấm → Đã trả kết quả | thao tác giám thị lỗi → giữ trạng thái cũ, báo lỗi, không đoán; thu bài có hộp hỏi lại | chỉ admin/giáo viên của lớp | 1280/390px; sáng/tối; phòng thi học viên luôn sáng (G08) |

Sau mỗi thao tác ghi, màn đọc lại API (không trạng thái lạc quan). Chữ: "giáo viên", không "giảng viên/thầy", không "đơn hàng/bán/giá".
