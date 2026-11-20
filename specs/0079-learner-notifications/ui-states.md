# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Chuông, ngăn thông báo, trang `/notifications`, thẻ "N quá hạn" | chuông hiện không số khi đang tải | "Chưa có thông báo"; 0 chưa đọc thì không hiện số | danh sách gộp theo `group_key`, "9+" khi trên 9 | API lỗi → chuông không số, ngăn hiện lỗi + thử lại; số quá hạn lỗi → ẩn thẻ, không hiện 0 | chỉ thông báo của chính người đó; người chưa kích hoạt vẫn đọc được | 1280/390px; sáng/tối; ngăn đóng bằng Esc, trả focus về chuông |

Sau mỗi thao tác ghi, màn đọc lại API. Câu chữ theo 00 mục 3.
