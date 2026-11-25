# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Trang Kết quả một bài giao, thành phần giao bài dùng chung, bảng công bố điểm | 5 khối hiện khung chờ | chưa ai nộp → chỉ khối 1, không vẽ điểm | 5 khối, một bộ 5 trạng thái từ một API tổng hợp | API lỗi → `PageState` error + thử lại; giao lại cùng bài không tạo trùng (idempotent) | giáo viên khác lớp → 404, về trang cha | 1280/390px; sáng/tối; bảng cuộn ngang ở 1024px |

Sau mỗi thao tác ghi, màn đọc lại API (không trạng thái lạc quan). Chữ: "giáo viên", không "giảng viên/thầy", không "đơn hàng/bán/giá".
