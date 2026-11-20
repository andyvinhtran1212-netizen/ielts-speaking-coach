# UI state matrix

| Surface | Loading | Empty | Success | Error/retry | Permission | Responsive/theme/a11y |
| --- | --- | --- | --- | --- | --- | --- |
| Sáu trạng thái chấm thử (màn 7 tờ ChamThuMienPhi) và thẻ Chấm thử ở `/admin/settings` | nút nộp "Đang kiểm lượt…" | — | `available` + số còn lại | `paused`, `site_daily_exhausted`, `daily_exhausted`, `total_exhausted`, `ip_shared_blocked` (có lối đi liên hệ), 503 `trial_unavailable` | `trial_not_eligible` cho người từng có khoá online | 1280/390px; sáng/tối; thông điệp tiếng Việt, không mã lỗi |

Sau mỗi thao tác ghi, màn đọc lại API. Câu chữ theo 00 mục 3.
