# Soak declaration — Pilot 1 (`/` trên Next), đợt RESTART sau audit

**Ngày lập:** 2026-07-14 · **Căn cứ:** audit ngoài 2026-07-14 (F1–F8) + ADR-007 §6 + quy tắc reset trong ADR-007 "Cập nhật trạng thái"

## Vì sao restart
Soak đầu (từ release `e22b84ff`, cutover 2026-07-14) bị VÔ HIỆU: 3 deploy production trong cửa sổ soak không cờ hotfix (vi phạm §6), ~2h đầu không có telemetry gắn tag từ `/`, và hai trigger rollback đã freeze không tính được từ dashboard thời điểm đó. Chi tiết: `PILOT_1_CUTOVER_SHEET.md` mục cuối.

## Điều kiện bắt đầu đồng hồ soak mới (tất cả phải ✅ trước khi hẹn giờ)
| # | Điều kiện | Cách xác nhận |
|---|---|---|
| 1 | 5 PR remediation merge liền nhau, không chen PR khác: #760 (F5+F4) → #761 (F1+F2) → #762 (F6) → #763 (F7+F8) → PR sheet này | `git log main` liên tục |
| 2 | Auto-promote xong; production release = SHA merge CUỐI | `curl -s https://averlearning.com/js/runtime-config.js` → `release` khớp `git rev-parse origin/main` |
| 3 | Điền **RELEASE ĐÓNG BĂNG** vào bảng dưới (sửa file này bằng 1 commit docs-only — commit đó KHÔNG tính là deploy vi phạm vì nó chính là mốc; nếu muốn tuyệt đối sạch, điền trước khi merge PR cuối) | |
| 4 | Verify telemetry sống: mở `/` production → dashboard rollback-metrics (route `/`, 30ph) thấy `page_view` + (sau vài phút tương tác) `web_vitals` tag `implementation=next`, `release` = SHA đóng băng | Panel admin Báo lỗi |

## Thông số soak (FREEZE)
| Mục | Giá trị |
|---|---|
| Route | `/` |
| Release đóng băng | `________________` (điền SHA khi bắt đầu) |
| Thời điểm bắt đầu (UTC+7) | `________________` |
| Thời lượng | 7 ngày (chuẩn Pilot Entry) |
| Trigger error-rate | > 2× baseline / cửa sổ 30 phút — đo bằng `GET /admin/error-logs/rollback-metrics?route=/&window_minutes=30`. Pilot 1 KHÔNG có baseline legacy in-window (legacy không còn phục vụ `/`) → chạy chế độ tuyệt đối: error-rate > 5% = breach; kèm theo dõi delta so với chính nó ngày-qua-ngày |
| Trigger LCP | p75 > 1.5× baseline / 24h — `?window_minutes=1440`. Không có baseline legacy → tuyệt đối: p75 > 4000ms = breach; đối chiếu thêm Lighthouse baseline 98/98 (lab, `PILOT_1_BASELINE_2026-07-14.md`) |
| Freeze deploy | ADR-007 §6 — KHÔNG merge gì vào main trong 7 ngày trừ hotfix có cờ incident-commander ghi vào file này; vi phạm ⇒ reset đồng hồ về 0 tại release mới |
| Nhật ký kiểm tra | Mỗi ngày 1 dòng vào bảng dưới (giờ, error verdict, LCP verdict, ghi chú) |

## Nhật ký soak
| Ngày | Error verdict (30ph tại giờ check) | LCP verdict (24h) | Ghi chú |
|---|---|---|---|
| D1 | | | |
| D2 | | | |
| D3 | | | |
| D4 | | | |
| D5 | | | |
| D6 | | | |
| D7 | | | |

## Kết thúc soak
- 7 ngày sạch (không breach, không vi phạm freeze) → soak PASS → mở lại Pilot 2 entry (checklist riêng, gồm baseline legacy `/grammar/...` bằng rum-vitals gắn TRƯỚC cutover ≥24h theo protocol trong `frontend/public/js/rum-vitals.js`).
- Breach bất kỳ → xử lý theo §4 sheet cutover (Instant Rollback → Undo Rollback khi restore) và ghi hậu quả vào đây.
