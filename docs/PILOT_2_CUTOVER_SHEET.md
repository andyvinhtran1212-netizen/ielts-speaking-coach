# Pilot 2 cutover sheet — grammar article `/grammar/:category/:slug`

Theo `docs/PILOT_ENTRY_CHECKLIST_2026-07-13.md` §6.2.

> **TRẠNG THÁI VẬN HÀNH: CHUẨN BỊ SẴN, CHƯA cutover.** Diff đã build + verify
> (route-ownership + suite); PR **DRAFT**. **[CẬP NHẬT 2026-07-25 theo ADR-013]**
> gate KHÔNG còn là "soak 21 ngày" — grammar ~1 view/ngày là route low-traffic
> ⇒ dùng **early-stage rollout profile**: cutover tagged → **48–72h quan sát +
> synthetic n≥72 + risk acceptance ghi rõ**. `/grammar/:cat/:slug` hiện VẪN
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

- [ ] **Early-stage rollout profile (ADR-013)** thay soak-21-ngày: **48–72h
      quan sát** (bắt lỗi thời-gian-trôi: ADR-008 cache 1h/1d + client) +
      **synthetic n≥72** (production-smoke gánh vế số-lượng — grammar ~1 view/ngày
      nên organic KHÔNG đủ mẫu; bỏ sàn "20 interactions" vô nghĩa — DEBT-H) +
      **risk acceptance ghi rõ** (route, ngày, rollback plan). Persistence/security
      breach → rollback ngay. Không freeze-cứng-dài (quy kết một-biến từ TAG).
- [ ] **Production-smoke synthetic sống** trên route grammar TRƯỚC cutover
      (đây là vế số-lượng của ADR-013 — điều kiện tiên quyết).
- [ ] Traffic baseline re-run ≤72h trước cutover.
- [ ] Đo baseline grammar route ≤72h trước (Lighthouse + chunk-split /grammar-preview
      vs legacy /grammar/:cat/:slug) — đo tại thời điểm cutover.
- [ ] **REFRESH branch với main + re-verify**: DRAFT có thể sống lâu → main drift;
      merge main vào branch, rebuild `tailwind.build.css` nếu cần,
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

## Chuẩn bị đợt 2 — đã chạy 2026-07-28 (CHƯA cutover, CHƯA đếm giờ)

Nhánh refresh lần 2 lên `origin/main` (`c090c1da`, drift 353 commit) — merge
**sạch, 0 conflict**; invariant cutover còn nguyên (grammar là app route +
rewrite legacy đã GONE).

| Kiểm | Kết quả |
|---|---|
| Suite contract frontend | **5612 pass / 0 fail / 1 skipped** |
| `route-ownership` (heuristic) | clean — 5 app route · 304 public file · 27 config source |
| `route-ownership --manifest` | clean — 5 compiled route, khớp heuristic, 0 collision |
| `npm run build` | `◐ /grammar/[category]/[slug]` = Partial Prerender ✔ (và `/grammar-preview` đã biến mất) |
| Tailwind `build.css` + `inter.css` | FRESH (rebuild + diff, không stale sau merge) |
| ADR-008 cache | `lib/grammar-api.ts` không bị main đụng tới kể từ 14/07 (`git log` rỗng) |

**Traffic baseline chạy lại 2026-07-28 15:21 UTC** (`backend/scripts/traffic_baseline.sh`,
SELECT-only trên prod): grammar = **14 cặp reader-article active/14 ngày**
(28 ngày: 31) ⇒ ~1 lượt/ngày, **vẫn đúng lớp "public/read-only <3 lượt/ngày"**
của ma trận ADR-013 ⇒ early-stage profile (48–72h + synthetic n≥72 + risk
acceptance) là profile đúng. Đối chiếu: speaking 735/14d, vocab quiz 5457/14d.

**MỘT BLOCKER PARITY ĐÃ PHÁT HIỆN + VÁ — PR #877** (vá trên `main`, không nằm
trong nhánh này): `app/(public-content)/layout.tsx` vẫn nạp `Lora + DM Sans`
trong khi `grammar-wiki.css` đã chuyển sang `var(--av-font-*)` từ #828
(DEBT-2026-07-24-J bước b, quét thiếu `frontend/app/`) ⇒ bản Next của bài
Grammar rơi về font hệ thống, **lệch font so với legacy**. Ratchet test nay quét
cả `frontend/app/**/*.tsx`. **#877 ĐÃ MERGE vào main 2026-07-28** (`444b4c4c`);
nhánh này đã refresh qua nó — suite **5617 pass / 0 fail / 0 skipped**,
`route-ownership --manifest` clean, build vẫn `◐ PPR`, Tailwind FRESH.

## Risk acceptance (ADR-013 — ĐÃ KÝ)

| Trường | Giá trị |
|---|---|
| Route | `/grammar/:category/:slug` (canonical chuyển từ legacy → Next) |
| Lớp rủi ro | Public / read-only, traffic <3 lượt/ngày (đo 14/14d) |
| Ngày cutover | **2026-07-28** |
| Người duyệt | **Chủ dự án** (duyệt trong phiên 28/07: "cutover luôn đi", sau khi #877 merge + #754 refresh xanh) |
| Vế số-lượng | Production Smoke n=75 trên route sau cutover, p75 < 4000ms, 0 lỗi |
| Vế thời-gian | Quan sát organic **48–72h**, rollback trigger ở chế độ tuyệt đối |
| Rollback | Instant Rollback ≤12s về deployment N−1; khôi phục = **Undo Rollback DUY NHẤT**; legacy `public/pages/grammar-article.html` vẫn nằm trên disk |
| Chấp nhận rủi ro | Traffic organic quá thưa để có ý nghĩa thống kê; synthetic gánh vế số-lượng; blast-radius ~1 người đọc/ngày |

## Runbook ngày cutover (thứ tự bắt buộc)

1. ~~Merge **#877** (font parity) → refresh nhánh này qua `main` → suite + build lại.~~
   **XONG 2026-07-28** (#877 = `444b4c4c` trên main; nhánh này đã refresh + verify lại).
2. ~~Chạy `backend/scripts/traffic_baseline.sh` (≤72h) + dispatch **Production Smoke**
   trên `/grammar-preview/tenses/present-perfect` = baseline TRƯỚC cutover.~~
   **XONG 2026-07-28**: baseline 15:21 UTC (grammar 14 cặp/14d) + smoke run
   `30373000306` n=75 → **LCP p75 956ms, 0 lỗi**.
3. ~~Điền + ký bảng risk acceptance ở trên.~~ **XONG 2026-07-28.**
4. Merge PR này (atomic: đổi ownership + gỡ rewrite trong CÙNG một commit).
5. Chờ auto-promote (~20s), verify `runtime-config.release` = main HEAD.
6. Verify browser-based theo mục "Verify SAU cutover" (cadence ≥15s, KHÔNG poll
   nhanh — bài học Gate B: poller 5s kích hoạt DDoS mitigation của Vercel).
7. Dispatch **Production Smoke** trên `/grammar/tenses/present-perfect` (n=75)
   = verdict SAU cutover; so với baseline bước 2.
8. Mở cửa sổ quan sát 48–72h: mỗi ngày đo panel Rollback trigger route
   `/grammar` + 1 lần smoke; ghi nhật ký. Hết cửa sổ → tuyên PASS hoặc rollback.

## Register (checklist §5)

Frozen estimate pilot 2 = 8h. Đã tiêu tới prep: build ~1.5h (#741) + prep ~0.5h.
Số đo cutover (đo TẠI cutover): JS route-specific, Lighthouse, API count, cache
hit-rate, visual/SEO parity (title/meta), error rate 7 ngày trước/sau.
