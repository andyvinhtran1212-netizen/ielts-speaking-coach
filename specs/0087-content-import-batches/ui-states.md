# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Thẻ Lô nhập và Câu cần kiểm của sáu trang Nội dung | bảng hiện khung chờ | chưa có lô → "Chưa có lần nhập nào"; hàng chờ trống → "Không còn câu cần kiểm" | mỗi lần chạy script một dòng chỉ đọc; mỗi câu một dòng dù nhiều lý do | API lỗi → `PageState` error + thử lại; đánh dấu trùng không đổi trạng thái lần hai | chỉ admin | 1280/390px; sáng/tối; bàn phím |

Sau mỗi thao tác ghi, màn đọc lại API (không trạng thái lạc quan). Chữ: "giáo viên", không "giảng viên/thầy", không "đơn hàng/bán/giá".
