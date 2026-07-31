# Pilot 1 cutover sheet — landing `/`

Điền theo `docs/PILOT_ENTRY_CHECKLIST_2026-07-13.md` §6.1.

> **TRẠNG THÁI VẬN HÀNH: ✅ ĐÃ CUTOVER — `/` ĐANG LIVE TRÊN NEXT** (2026-07-14,
> release `e22b84ff`, PR #751). Chi tiết post-cutover ở mục cuối file. Nếu
> `/` có sự cố → theo **Rollback §dưới** ngay. Các mục "Thay đổi", "gate",
> "verify" dưới đây là hồ sơ cách cutover đã được thực hiện (lịch sử), KHÔNG
> phải việc còn chờ.

## Thay đổi (atomic — một commit)

| # | Thay đổi | File |
|---|---|---|
| 1 | `git mv` landing page + behavior lên `app/(marketing)/` → route thành `/` | `app/(marketing)/page.tsx`, `landing-behavior.tsx` |
| 2 | **Gỡ** rewrite `{ source: '/', destination: '/index.html' }` | `next.config.ts` beforeFiles |
| 3 | **Thêm** redirect `{ source: '/index.html', destination: '/', permanent: true }` — một canonical landing | `next.config.ts` redirects |
| 4 | Cập nhật path + thêm pin cutover-ownership | `tests/pilot-landing.test.mjs` |

`public/index.html` **giữ trên disk** — redirect chạy trước filesystem nên nó
không bao giờ được serve khi cutover active, nhưng revert commit là khôi phục
ngay (rollback safety). OAuth-redirect recovery (Supabase OAuth đáp về `/` với
hash) đã có sẵn trong `app/(marketing)/layout.tsx` → `/` cutover an toàn OAuth.
aver-chrome logout (`→ '/index.html'`) giờ redirect về `/` — vẫn đúng.

## Verify đã chạy (local + build)

- `route-ownership-check`: **clean** (5 app routes; ép tính atomic — nếu quên
  gỡ rewrite `/` sẽ COLLISION vì beforeFiles shadow app route).
- `npm run build`: `○ /` = Static app route (trước là rewrite).
- Browser local: `/` = Next landing (`__next_f` present, h1 đúng), `/index.html`
  → redirect `/`, `/pages/home.html` vẫn 200 + legacy. Zero lỗi app (chỉ CORS
  public-stats do không có backend local — production OK).
- Suites: contract **5253/5253**, pilot-landing pins 5/5.

## GATE trước khi merge — ✅ CẢ 3 ĐÃ ĐẠT trước cutover (hồ sơ)

- [x] Nightly streak **20/20** frozen matrix — ĐẠT 2026-07-14 (20 run liên tiếp success từ mốc 2026-07-13T21:26Z; PR #752).
- [x] Traffic baseline ≤72h — thỏa bằng `docs/TRAFFIC_BASELINE_2026-07-13.md`
      (đo 2026-07-13, <72h so cutover 2026-07-14) + root là route traffic cao
      nhất site → exposure floor chuẩn thừa. LƯU Ý: KHÔNG chạy fresh
      `traffic_baseline.sh` (cần prod `DATABASE_URL` trong `backend/.env`, chỉ
      chạy được qua `!`); recency + vị thế root đủ cho gate này.
- [x] Đo lại baseline ≤72h — `docs/PILOT_1_BASELINE_2026-07-14.md` đo cùng ngày
      (98/98 parity, chunk-split); không hồi quy.
- [x] `css/tailwind.build.css` — main không drift class Tailwind mới (CI xanh).

## Verify SAU cutover — ✅ ĐÃ CHẠY (kết quả ở mục cuối file)

Checklist verify (browser-based, ≥15s cadence — bài học Gate B); tất cả PASS,
kết quả thực tế ghi ở "## ✅ CUTOVER THỰC HIỆN" cuối file:

1. `/` = Next landing (`__next_f`), stats số thật, h1 đúng, zero console error.
2. `/index.html` → 308 → `/`.
3. Legacy nguyên vẹn (`/pages/home.html`, `/pages/speaking.html`,
   `/grammar/tenses/present-simple`) đều 200 + legacy.
4. Auto-promote: release = main HEAD; drift job xanh.
5. Dashboard ADR-012: error-rate `/` theo tag `implementation=next` — soak đang
   theo dõi (chưa có ngưỡng nào chạm — xem Rollback).

## Rollback (đã freeze — checklist §4)

Trigger (bất kỳ): error-rate `/` > 2× baseline/30ph · P1 flow break (trắng
trang / không load / OAuth loop) 1 báo cáo xác nhận · Web Vitals LCP p75 >
1.5× baseline/24h.
Cơ chế: **Instant Rollback** (≤12s đo thật) về deployment trước → điều tra →
**Undo Rollback DUY NHẤT** khi khắc phục (KHÔNG Instant-Rollback "forward" —
bài học re-drill). Sau đó: banner mất + merge kế tiếp auto-promote + drift job
xanh. Verify browser-based hoặc polling ≥15s (`x-vercel-mitigated: challenge`
= firewall, không phải app state).

## Register (checklist §5)

Frozen estimate pilot 1 = 6h. **Thực tế đã tiêu (cutover xong):** build ~1h
(#740) + baseline ~0.5h (#750) + cutover prep + thực thi ~1h (#751) ≈ **2.5h**
— dưới xa 2× gate. Số đo cutover (đã đo, không còn placeholder): JS
route-specific **~0.9 KB** (#750), Lighthouse **98/98** parity, API count
**1 = 1**, CLS **0/0**, visual parity pixel-identical (screenshot post-cutover +
đã proven #740). Không có metric nào chạm ngưỡng đầu tư/rollback.

---

## ✅ CUTOVER THỰC HIỆN — 2026-07-14 (release `e22b84ff`)

Merged #751 → auto-promote **20s** → production phục vụ Next tại `/`.

**Post-cutover verify (browser thật trên production):**
- `/` = 200, served by Next (`__next_f` present), h1 = "Luyện thi IELTS toàn diện cùng AI Coach.", **zero console/page error**.
- Stats render số thật: **67+ học viên · 3.1K+ buổi luyện · 6 kỹ năng** (khớp production public-stats) — screenshot lưu.
- `/index.html` → 308 → `/` ✓ (một canonical landing).
- Legacy nguyên vẹn: `/pages/home.html`, `/pages/speaking.html`, `/grammar/tenses/present-simple` đều 200 + legacy (Next không shadow).
- Auto-promote OK: release trên `/js/runtime-config.js` = main HEAD `e22b84ff` → nightly `production-release-drift` sẽ xanh.

**Đây là route production ĐẦU TIÊN của chương trình migration cutover sang Next.** Soak window bắt đầu; rollback trigger + cơ chế (Instant Rollback ≤12s → Undo Rollback) đã freeze ở §4 trên. Theo dõi error-rate `/` theo tag `implementation=next` trên dashboard ADR-012.

---

## ⚠️ SOAK TỪ `e22b84ff` VÔ HIỆU — audit ngoài 2026-07-14 (F3)

Cửa sổ soak khai báo ở trên **không đạt chuẩn soak hợp lệ**, hạ cấp thành *diagnostic observation*:
1. **Vi phạm ADR-007 §6:** 3 deploy production sau cutover không cờ hotfix/incident-commander (`67b7b56e`, `a05c5816`, `0afefe88`) — mỗi deploy đổi release đang soak.
2. ~2 giờ đầu **zero telemetry gắn tag** từ `/` (error-reporter chỉ được thêm vào landing ở #755, sau cutover) — khoảng mù không đo được.
3. Trigger error-rate/LCP khi đó **không tính được** từ dashboard (thiếu denominator/route/cửa sổ 30ph/baseline — đóng ở audit F1/F2).

**Quyết định:** giữ `/` trên Next (không rollback — quan sát diagnostic không thấy tín hiệu xấu); đồng hồ soak **reset về 0** theo `docs/SOAK_DECLARATION_PILOT_1.md` sau khi merge trọn gói remediation (F1–F8) thành MỘT release đóng băng. Pilot 2 **No-Go** cho tới khi soak mới hoàn tất.
