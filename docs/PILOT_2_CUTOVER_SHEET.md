# Pilot 2 cutover sheet — grammar article `/grammar/:category/:slug`

Theo `docs/PILOT_ENTRY_CHECKLIST_2026-07-13.md` §6.2.

> **TRẠNG THÁI VẬN HÀNH: CHUẨN BỊ SẴN, CHƯA cutover.** Diff đã build + verify
> (route-ownership + suite); PR **DRAFT**. Khác pilot 1: **gate là soak
> 21 ngày** (không rút ngắn bằng dispatch). `/grammar/:cat/:slug` hiện VẪN
> legacy trên production; bản Next dark-launch ở `/grammar-preview/...` (đã gỡ
> URL đó trong branch này — sau cutover chỉ còn canonical).

## Thay đổi (atomic — một commit)

| # | Thay đổi | File |
|---|---|---|
| 1 | `git mv` thư mục `grammar-preview` → `grammar` → route thành `/grammar/[category]/[slug]` | `app/(public-content)/grammar/[category]/[slug]/*` |
| 2 | **Gỡ** rewrite `{ source: '/grammar/:category/:slug', destination: '/pages/grammar-article.html' }` | `next.config.ts` beforeFiles |
| 3 | Cập nhật comment page.tsx + test paths + flip 2 pin cutover-ownership | `page.tsx`, `tests/pilot-grammar.test.mjs`, `tests/route-ownership.test.mjs` |

**KHÔNG redirect `/pages/grammar-article.html`**: nó param-driven (`?category=&slug=`)
nên không map sang clean path bằng static redirect; cả site link qua clean URL
`/grammar/:cat/:slug` (`grammar.js` buildUrl:58) nên direct .html hit ~unused.
File giữ trên disk = instant-rollback target.

## GATE trước khi merge (BẮT BUỘC — lý do PR DRAFT)

- [ ] **Soak 21 ngày low-traffic profile** (grammar ~1 view/ngày — B36): 21 ngày
      + ≥20 interactions thật + synthetic crawl. Đây là gate DÀI, không rút
      ngắn được; bắt đầu tính từ khi pilot 1 soak sạch + quyết định mở pilot 2.
- [ ] Traffic baseline re-run ≤72h trước cutover.
- [ ] Đo baseline grammar route ≤72h trước (Lighthouse + chunk-split /grammar-preview
      vs legacy /grammar/:cat/:slug) — **đo tại thời điểm cutover, KHÔNG đo sớm 21 ngày**.
- [ ] **REFRESH branch với main + re-verify**: DRAFT sống ~21 ngày → main drift
      nhiều; merge main vào branch, rebuild `tailwind.build.css` nếu cần,
      chạy lại route-ownership + suite trước khi ready.
- [ ] ADR-008 cache: xác nhận `lib/grammar-api.ts` cacheLife (1h stale/revalidate,
      1d expire) + PPR loading.tsx còn nguyên sau refresh.

## Verify SAU cutover (browser-based trên production, ≥15s cadence)

1. `/grammar/tenses/present-simple` = Next SSR (`__next_f`); title/meta
   server-rendered (SEO — mục tiêu pilot 2); TOC/breadcrumb/body render đúng;
   guest CTA + save button hoạt động; zero console error.
2. **PPR/cache**: response có streamed shell; article 404 (slug sai) = HTTP 404
   thật (notFound trong generateMetadata — không soft-200).
3. Legacy nguyên vẹn: grammar wiki home `/grammar.html`, `/pages/home.html`,
   `/` (pilot 1 Next) đều đúng.
4. Auto-promote: release = main HEAD; drift job xanh.
5. Dashboard ADR-012: error-rate `/grammar/*` theo tag `implementation=next`.

## Rollback (freeze — checklist §4)

Trigger: error-rate grammar > 2× baseline/30ph · P1 (trang trắng / SSR 5xx
loop / article không render) 1 báo cáo xác nhận · Web Vitals LCP p75 > 1.5×/24h ·
cache poisoning (sai article cho slug khác). Cơ chế: **Instant Rollback** ≤12s
→ điều tra → **Undo Rollback DUY NHẤT**. Verify browser-based/≥15s.

## Verify đã chạy tại thời điểm PREP (2026-07-14)

- route-ownership **clean** (5 app routes, 27 config sources — bớt 1 do gỡ
  grammar rewrite; grammar route không collide public/pages/grammar-article.html).
- `npm run build`: `◐ /grammar/[category]/[slug]` = Partial Prerender app route.
- Suite: contract **5254/5254**; pilot-grammar 4/4 + route-ownership pins flipped.
- Content parity KHÔNG verify local được (SSR fetch backend, không có backend
  :8000 local) — đã proven trên Vercel preview #741 ở `/grammar-preview`; sau
  cutover component byte-identical, chỉ đổi URL. Re-verify trên preview khi refresh.

## Register (checklist §5)

Frozen estimate pilot 2 = 8h. Đã tiêu tới prep: build ~1.5h (#741) + prep ~0.5h.
Số đo cutover (đo TẠI cutover): JS route-specific, Lighthouse, API count, cache
hit-rate, visual/SEO parity (title/meta), error rate 7 ngày trước/sau.
