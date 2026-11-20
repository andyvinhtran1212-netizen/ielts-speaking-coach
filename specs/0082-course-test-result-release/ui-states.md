# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Màn học viên KiemTraKhoa 1–8 theo trạng thái × mức | khung chờ | chưa mở → "Chưa mở" | `released` theo mức `score` / `score_correctness` / `full` | `awaiting_release` → "Chờ giáo viên công bố", không số; lỗi API → thử lại, không suy điểm | mọi đường học viên đi qua `result_gate`; giáo viên luôn thấy điểm | 1280/390px; sáng/tối; bàn phím |

Sau mỗi thao tác ghi, màn đọc lại API. Câu chữ theo 00 mục 3.
