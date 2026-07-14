# Pilot 1 cutover sheet — landing `/`

Điền theo `docs/PILOT_ENTRY_CHECKLIST_2026-07-13.md` §6.1. **Trạng thái: CHUẨN BỊ
SẴN, CHƯA cutover.** Diff đã build + verify local; PR để **DRAFT** cho tới khi
các gate dưới đây xanh.

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

## GATE trước khi merge (BẮT BUỘC — đây là lý do PR để DRAFT)

- [x] Nightly streak **20/20** frozen matrix — ĐẠT 2026-07-14 (20 run liên tiếp success từ mốc 2026-07-13T21:26Z; PR #752).
- [ ] Traffic baseline re-run ≤72h trước (`backend/scripts/traffic_baseline.sh`) —
      root là route traffic cao nhất site → exposure floor chuẩn OK.
- [ ] Đo lại `docs/PILOT_1_BASELINE_2026-07-14.md` ≤72h trước (Lighthouse +
      chunk-split); confirm không hồi quy.
- [ ] Rebuild `css/tailwind.build.css` nếu main đã drift (memory: tailwind-stale).

## Verify SAU cutover (browser-based, ≥15s cadence — bài học Gate B)

1. `https://www.averlearning.com/` = Next landing (view-source có `__next_f`);
   stats render số thật; h1 đúng; zero console error.
2. `/index.html` → 308 → `/`.
3. Legacy nguyên vẹn: `/pages/home.html`, `/pages/speaking.html`,
   `/grammar/tenses/present-simple` (rewrite) đều 200 + legacy.
4. Auto-promote: release SHA trên `/js/runtime-config.js` = main HEAD; nightly
   `production-release-drift` job xanh.
5. Dashboard ADR-012: error-rate `/` theo tag `implementation=next` — so baseline.

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

Frozen estimate pilot 1 = 6h. Đã tiêu tới cutover-ready: build ~1h (#740) +
baseline ~0.5h (#750) + cutover prep ~0.5h ≈ **2h** — dưới xa 2× gate. Số đo
cutover (điền khi thực thi): JS route-specific ~0.9 KB (đo #750), Lighthouse
98/98, API count 1=1, diff size (PR này), visual parity (đã proven #740).
