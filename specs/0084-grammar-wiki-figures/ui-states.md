# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Khối `figure` trong bài Grammar Wiki | — | bài không có hình → không có khối | "Hình N", `role="img"`, `aria-label` đọc thành câu, chữ ví dụ `lang="en"` | khối sai cấu trúc bị bỏ, ghi cảnh báo, bài vẫn hiện | trang công khai | rộng tối đa 640px; dưới 600px theo quy tắc điện thoại của từng kiểu; `@media print` đen trắng; sáng/tối |

Sau mỗi thao tác ghi, màn đọc lại API. Câu chữ theo 00 mục 3.
