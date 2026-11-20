# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Màn chặn full test, dải nhắc giữa bài, nút trên `/tests` | kiểm vùng nhìn trước khi vào | — | ≥ ngưỡng: vào được | dưới ngưỡng: màn chặn tiếng Anh + dòng phụ tiếng Việt; hẹp lại giữa bài: dải nhắc, bài và đồng hồ tiếp tục | máy chủ không dựa vào độ rộng để cho/không cho | 390/768/820/1280px; phòng thi luôn sáng |

Sau mỗi thao tác ghi, màn đọc lại API. Câu chữ theo 00 mục 3.
