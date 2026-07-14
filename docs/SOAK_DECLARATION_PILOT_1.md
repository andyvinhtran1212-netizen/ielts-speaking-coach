# Soak declaration — Pilot 1 (`/` trên Next), đợt RESTART sau audit

**Ngày lập:** 2026-07-14 · **Căn cứ:** audit ngoài 2026-07-14 (F1–F8) + ADR-007 §6 + quy tắc reset trong ADR-007 "Cập nhật trạng thái"

> **PHỤ THUỘC BẮT BUỘC (review #765 — P1):** mọi telemetry mà protocol này
> tham chiếu (`GET /admin/error-logs/rollback-metrics`, collector
> `frontend/public/js/rum-vitals.js`, event `web_vitals`, panel admin
> "Rollback trigger") **ship trong PR #761**, KHÔNG trong tree của PR này.
> Đó là lý do PR này merge **CUỐI CÙNG** trong stack (#760 → #761 → #762 →
> #763 → #765) và điều kiện 1 + 4 dưới đây tồn tại: nếu #761 chưa merge thì
> gate này **bất khả thi by design** — không thể khai báo soak khi chưa có
> nguồn đo; đó chính là chốt chặn chống lặp lại lỗi F3 (soak không đo được).
> Điều kiện 4 là kiểm chứng THỰC NGHIỆM (đo thấy dữ liệu trên production),
> không phải kiểm chứng "code đã merge".

## Vì sao restart
Soak đầu (từ release `e22b84ff`, cutover 2026-07-14) bị VÔ HIỆU: 3 deploy production trong cửa sổ soak không cờ hotfix (vi phạm §6), ~2h đầu không có telemetry gắn tag từ `/`, và hai trigger rollback đã freeze không tính được từ dashboard thời điểm đó. Chi tiết: `PILOT_1_CUTOVER_SHEET.md` mục cuối.

## Điều kiện bắt đầu đồng hồ soak mới (tất cả phải ✅ trước khi hẹn giờ)
| # | Điều kiện | Cách xác nhận |
|---|---|---|
| 1 | 5 PR remediation merge liền nhau, không chen PR khác: #760 (F5+F4) → #761 (F1+F2) → #762 (F6) → #763 (F7+F8) → PR sheet này | ✅ 2026-07-14: `git log main` liên tục, stack SHA cuối `b2d7bdc2` |
| 2 | Auto-promote xong; production release = SHA merge CUỐI | ✅ 2026-07-14 16:31 +07: runtime-config production trả `b2d7bdc2092533c6986e8a81f9c8cde5b27cf5f0` = main HEAD (poll đầu tiên) |
| 3 | Điền **RELEASE ĐÓNG BĂNG** vào bảng dưới (sửa file này bằng 1 commit docs-only — commit đó KHÔNG tính là deploy vi phạm vì nó chính là mốc; nếu muốn tuyệt đối sạch, điền trước khi merge PR cuối) | ✅ chính là commit mốc này — release đóng băng = main HEAD SAU commit mốc (SHA thực verify bằng curl, ghi issue #766 entry D0) |
| 4 | Verify telemetry sống: mở `/` production → dashboard rollback-metrics (route `/`) thấy `page_view` + (khi rời trang) `web_vitals` tag `implementation=next`, `release` = SHA đóng băng | Panel admin Báo lỗi; kết quả ghi issue #766 D0 |

## Thông số soak (FREEZE)
| Mục | Giá trị |
|---|---|
| Route | `/` |
| Release đóng băng | **main HEAD sau commit mốc này** (stack `b2d7bdc2` + mốc docs-only này; SHA thực verify bằng curl runtime-config sau auto-promote — ghi issue #766 D0). Diff mốc vs `b2d7bdc2` = duy nhất file này, zero thay đổi runtime |
| Thời điểm bắt đầu (UTC+7) | **2026-07-14 ~16:40** (khi D0 verify xong — mốc chính xác ghi issue #766) |
| Thời lượng | 7 ngày → kết thúc dự kiến 2026-07-21 ~16:40 +07 |
| Trigger error-rate | > 2× baseline / cửa sổ 30 phút — đo bằng `GET /admin/error-logs/rollback-metrics?route=/` (từ review #761, MỖI verdict luôn tính ở đúng cửa sổ freeze của nó bất kể `window_minutes` — một call trả cả hai). Pilot 1 KHÔNG có baseline legacy in-window (legacy không còn phục vụ `/`) → chạy chế độ tuyệt đối: error-rate > 5% = breach; kèm theo dõi delta so với chính nó ngày-qua-ngày |
| Trigger LCP | p75 > 1.5× baseline / 24h — cùng call trên (`vitals_verdict`, cửa sổ 1440ph cố định). Không có baseline legacy → tuyệt đối: p75 > 4000ms = breach; đối chiếu thêm Lighthouse baseline 98/98 (lab, `PILOT_1_BASELINE_2026-07-14.md`) |
| Freeze deploy | ADR-007 §6 — KHÔNG merge gì vào main trong 7 ngày trừ hotfix có cờ incident-commander ghi vào issue #766; vi phạm ⇒ reset đồng hồ về 0 tại release mới |
| Nhật ký kiểm tra | Mỗi ngày 1 entry vào **issue #766** — KHÔNG commit doc hằng ngày (mỗi commit main là một deploy, tự vi phạm freeze). Chép về bảng dưới MỘT lần khi kết thúc soak |

## Nhật ký soak
**Ghi hằng ngày tại issue #766** (lý do ở bảng trên); chép về đây khi kết thúc.

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
