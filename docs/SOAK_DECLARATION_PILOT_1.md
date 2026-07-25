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
| Thời điểm bắt đầu (UTC+7) | **2026-07-14 ~16:40** (đợt đầu). ⚠️ **RESTART #2 mới là đợt thực sự PASS** — xem mục "Restart #2" ngay dưới bảng này |
| Thời lượng | 7 ngày (đợt đầu drift/reset nhiều lần) |

### Restart #2 — đợt thực sự PASS
Đợt soak đầu (start 2026-07-14) trôi/reset nhiều lần vì các merge feature vào main trong cửa sổ. Đồng hồ **khởi động lại lần cuối 2026-07-17 22:22 +07** (ghi #766), lần này giữ trọn freeze tới hết.

| Mục | Giá trị (restart #2) |
|---|---|
| Release đóng băng | **`856688dddbd67facb5c893bc24e3812e2ff0b6b4`** (#810) — verify liên tục qua `runtime-config.release` suốt cửa sổ |
| Bắt đầu | 2026-07-17 22:22 +07 (D0) |
| Kết thúc | 2026-07-24 22:22 +07 (D7) — trọn 7 ngày (mốc early-exit 5 ngày đã vô hiệu 22/07, xem D6) |
| Freeze | ✅ 0 merge vào main toàn cửa sổ (`git rev-list --count 856688dd..origin/main` = 0 tại mốc kết thúc) |
| Trigger error-rate | > 2× baseline / cửa sổ 30 phút — đo bằng `GET /admin/error-logs/rollback-metrics?route=/` (từ review #761, MỖI verdict luôn tính ở đúng cửa sổ freeze của nó bất kể `window_minutes` — một call trả cả hai). Pilot 1 KHÔNG có baseline legacy in-window (legacy không còn phục vụ `/`) → chạy chế độ tuyệt đối: error-rate > 5% = breach; kèm theo dõi delta so với chính nó ngày-qua-ngày |
| Trigger LCP | p75 > 1.5× baseline / 24h — cùng call trên (`vitals_verdict`, cửa sổ 1440ph cố định). Không có baseline legacy → tuyệt đối: p75 > 4000ms = breach; đối chiếu thêm Lighthouse baseline 98/98 (lab, `PILOT_1_BASELINE_2026-07-14.md`) |
| Freeze deploy | ADR-007 §6 — KHÔNG merge gì vào main trong 7 ngày trừ hotfix có cờ incident-commander ghi vào issue #766; vi phạm ⇒ reset đồng hồ về 0 tại release mới |
| Nhật ký kiểm tra | Mỗi ngày 1 entry vào **issue #766** — KHÔNG commit doc hằng ngày (mỗi commit main là một deploy, tự vi phạm freeze). Chép về bảng dưới MỘT lần khi kết thúc soak |

## Nhật ký soak (chép từ issue #766 khi kết thúc — restart #2, D0 = 2026-07-17 22:22 +07)

| Ngày | Error verdict (30ph) | LCP verdict (24h) | Ghi chú |
|---|---|---|---|
| D1 · 18/07 | insufficient-sample | no-baseline · no-breach | không sự kiện (gộp vào D2) |
| D2 · 19/07 | insufficient-sample | no-baseline · no-breach | freeze nguyên; nightly streak tăng |
| D3 · 20/07 | insufficient-sample | no-baseline · no-breach | không sự kiện (gộp vào D4) |
| D4 · 21/07 | insufficient-sample | no-baseline · no-breach | 1 view / 0 lỗi / LCP p75 2336ms (n=2); nightly streak = 7 |
| D5 · 22/07 | insufficient-sample | no-baseline · no-breach | 1 lỗi PostgREST 555 (reading, 21:14 21/07) — transient, **ngoài route `/`**; nightly streak = 8 |
| D6 · 22/07 | insufficient-sample | no-baseline · no-breach | **React #418 trên `/` lúc 15:20** → phá tiêu chí early-exit 5 ngày ⇒ chạy trọn 7 ngày; điều tra không quy được lỗi code; LCP p75 1664ms (n=15) |
| D7 · 23→24/07 | insufficient-sample | no-baseline · no-breach | 24h qua **0 lỗi**; LCP p75 1190ms (n=16, sáng 24/07) |
| **Kết · 24/07 22:22** | insufficient-sample | ⚠️ **BREACH** (p75 4180ms, n=22) | breach LCP tại mốc — điều tra bên dưới |

## Kết thúc soak — ✅ PASS (có ngoại lệ LCP ghi rõ) · 2026-07-24 22:3x +07

**3/4 tiêu chí xanh:** freeze nguyên (0 merge main; prod = release đóng băng `856688dd`), nightly streak không gãy, trigger error-rate không breach (insufficient-sample), lỗi tag `next` trên `/` vẫn đúng 1 cả cửa sổ.

**Tiêu chí LCP = BREACH** (p75 4180ms > ngưỡng tuyệt đối 4000ms) — **ghi thẳng, không giấu.** Đã điều tra trước khi quyết (không nới verdict):
- Tam giác hoá cửa sổ (API rollback-metrics): cụm ~3 mẫu chậm ~4.9–5s ở **chiều 24/07 (~16–18h)**; 60 phút gần nhất nhanh (1260ms).
- Tự đo landing (mạng tốt): load 1265ms, TTFB 978ms, font Google không block (max 35ms), 0 resource >800ms → code render nhanh.
- Suốt D0–D5 p75 = 1190–1979ms.
- ⇒ Kết luận: **outlier môi trường khách** (mạng yếu / thiết bị chậm) trên mẫu nhỏ (n=22), **không phải regression**. Rollback không cải thiện (legacy cùng font CDN + mạng khách).

**Quyết định (chủ dự án):** chấp nhận rủi ro có ghi rõ → **TUYÊN PASS**, không rollback. Ghi minh bạch tại issue #766 (comment 5071611461) + doc này.

**Freeze Pilot-1 KẾT THÚC** — merge vào main không còn reset đồng hồ.

### Follow-up (không chặn PASS)
- **TTFB landing ~978ms** hơi cao (Vercel SSR/cold) — cải thiện để hạ nền LCP cho khách mạng yếu, giảm nguy cơ p75 chạm ngưỡng ở các cutover sau. → ghi tech-debt.
- Mở lại Pilot 2 entry: baseline legacy `/grammar/...` bằng rum-vitals gắn TRƯỚC cutover ≥24h; rebase #756 (profile) qua #762.
- Quy tắc breach chung (rút ra từ đợt này): trigger LCP tuyệt đối trên **n nhỏ** dễ bị outlier môi trường đẩy qua ngưỡng — cân nhắc thêm điều kiện mẫu tối thiểu lớn hơn hoặc lọc outlier ở các soak traffic-thấp sau.
