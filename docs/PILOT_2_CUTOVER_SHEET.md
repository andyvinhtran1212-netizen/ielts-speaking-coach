# Pilot 2 cutover sheet — grammar article `/grammar/:category/:slug`

Theo `docs/PILOT_ENTRY_CHECKLIST_2026-07-13.md` §6.2.

> **TRẠNG THÁI VẬN HÀNH: ĐÃ CUTOVER + CỬA SỔ QUAN SÁT ĐÃ ĐÓNG, PASS.**
> Cutover **2026-07-28 22:37:10 +07** (merge PR #754 = `524fd210`, auto-promote
> ~20s sau); **PASS chốt 2026-07-31 01:47 +07 = 51h10m** — xem mục cuối trang.
> `/grammar/:cat/:slug` trên production **đang chạy Next**; `/grammar-preview/...`
> không còn tồn tại. Gate áp dụng là **early-stage rollout profile** (ADR-013):
> cutover tagged → **48–72h quan sát + synthetic n≥72 + risk acceptance ghi rõ**
> — KHÔNG phải soak-21-ngày.
> **Cửa sổ quan sát ĐÃ ĐÓNG** — không còn cadence smoke/giám sát hằng ngày.
> Phần dưới giữ nguyên văn lúc prep để đọc được lịch sử quyết định.

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
2. **PPR/cache**: response có streamed shell; **bài không tồn tại ⇒ thân 404 +
   `<meta name="robots" content="noindex">`**, để không có gì bị index.
   **ĐÍNH CHÍNH 2026-07-28/29 (đo trên production, cùng UA + cùng điều kiện
   cache):** câu "= HTTP 404 thật" viết lúc prep là SAI với PPR — route trả
   **HTTP 200 cho MỌI bài thiếu**, vì shell prerender được phục vụ từ cache
   (`x-nextjs-prerender: 1`, `x-vercel-cache: HIT`) trước khi `generateMetadata`
   kịp chạy, nên status đã chốt. **KHÔNG có khác biệt theo category** — cả slug
   sai lẫn category sai đều 200 + noindex (`grammar_content.get_article()` trả
   `None` cho cả hai, `fetchArticle()` map cả hai về `null`, cùng một
   `notFound()`). Lần đầu tôi ghi "category sai ⇒ 404 cứng" là do **so hai phép
   đo khác điều kiện** (curl vs điều hướng trong trình duyệt): trình duyệt hiển
   thị trang 404 của Next sau khi phần stream giải quyết, nhưng **status của
   document vẫn là 200**. Legacy cùng ca trả 200 **KHÔNG** noindex ⇒ Next vẫn
   tốt hơn về SEO, không hồi quy. Tiêu chí đúng = "thân 404 + noindex", không
   phải "404 cứng". (Phát hiện bởi Codex review trên PR #878 — P2.)
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

## ✅ CUTOVER ĐÃ THỰC HIỆN — 2026-07-28 22:37:10 +07

Release: **`524fd210`** (merge PR #754 lúc 22:37:10 +07). Auto-promote: production
`runtime-config.release` = main HEAD ngay ở lần poll đầu (≤20s).

**Bằng chứng verify (đo trên production, cadence thưa):**

| Mục | Kết quả |
|---|---|
| Canonical `/grammar/:cat/:slug` | **Next SSR** (`__next_f`), 200, ~116KB |
| Title/description | server-rendered đúng định dạng legacy (mục tiêu SEO của pilot 2) — vd `Present Perfect — IELTS Grammar \| Aver Learning` |
| Phủ toàn bộ danh mục | **11/11 category** (tenses, grammar-for-meaning, grammar-for-writing, grammar-for-reading, verb-patterns, modifiers, sentence-structures, parts-of-speech, foundations, ielts-grammar-lab, error-clinic) — mỗi cái 1 bài thật: **200 + Next SSR + title đúng** |
| Trình duyệt thật | 2 bài (`tenses/present-perfect`, `grammar-for-meaning/conditionals`): chrome nav + breadcrumb + TOC + thân bài + nút Lưu bài render đúng, **0 console error** |
| Font parity (sau #877) | trang phục vụ đúng link Plus Jakarta + JetBrains + Lora |
| Legacy nguyên vẹn | `/grammar.html` 200 legacy · `/pages/grammar-article.html?...` 200 legacy (target rollback vẫn trên disk) · `/pages/home.html` 200 legacy · `/` 200 Next (pilot 1) |
| Rewrite đã gỡ | `next.config.ts` trên main không còn `source: '/grammar/:category/:slug'` |
| Synthetic n=75 TRƯỚC cutover (`/grammar-preview/...`) | run `30373000306` — LCP p75 **956ms**, 0 lỗi |
| Synthetic n=75 SAU cutover (`/grammar/tenses/present-perfect`) | run `30374618340` — LCP p75 **848ms**, 0 lỗi (ceiling 4000ms) |

**Cửa sổ quan sát ADR-013 mở từ 2026-07-28 22:37:10 +07** (giờ merge `524fd210`)
→ mốc 48h = **30/07 22:37:10**, mốc 72h = **31/07 22:37:10**. Mỗi ngày: admin *Báo lỗi* →
*Rollback trigger* → route `/grammar` → **Đo**, cộng 1 lần dispatch Production
Smoke; ghi vào bảng dưới. Hết cửa sổ, nếu không breach ⇒ tuyên PASS.

| Ngày | Views/Lỗi trên `/grammar/*` | LCP p75 organic | Smoke p75 (n=75) | Release | Verdict |
|---|---|---|---|---|---|
| D0 28/07 22:4x | 80 view (76 = smoke) / **0 lỗi** | 12624ms (n=4) — xem ghi chú | **848ms / 0 lỗi** | `524fd210` | ok |
| D1 29/07 | 80 view / **0 lỗi** | 12624ms (n=4), verdict *insufficient-sample* | **976ms / 0 lỗi** | `cedd4dd5` | ok |
| D2 30/07 22:36 | **229 view / 0 lỗi** | 3432ms (n=5), verdict *insufficient-sample* | **968ms / 0 lỗi** | `cedd4dd5` | ok — **nhưng CHƯA đủ 48h**, xem dưới |
| **D3 31/07 01:47 — chốt (51h10m)** | **231 view / 0 lỗi** | không có mẫu mới sau D2 (vẫn 6 mẫu cả cửa sổ) | **856ms / 0 lỗi** | `cedd4dd5` | **PASS** |

**ĐÍNH CHÍNH — bản chốt đầu tiên bị hụt giờ (Codex review #881, P2).** Bản
ghi trước ghi "chốt 30/07 22:36, đủ 48h01" là **SAI**: cutover thật là
`524fd210` lúc **28/07 22:37:10 +07** (không phải 22:35), nên ảnh chụp lúc
22:36 ngày 30/07 mới chỉ **47h58m50s** — **thiếu ~1 phút**. Mốc 48h thật là
**30/07 22:37:10**. Bản chốt hợp lệ là D3 ở trên (**51h10m**), đo lại toàn bộ
kèm một lần smoke mới. Ghi lại ở đây thay vì lặng lẽ sửa số: tuyên PASS sớm
dù chỉ một phút vẫn là dời cột gôn, và đây đúng là loại lỗi mà cửa sổ quan
sát sinh ra để chống.

**Ghi chú trung thực về cột LCP organic:** con số này **KHÔNG phải một verdict
đạt** — công cụ trả `insufficient-sample` ở mọi lần đo (ngưỡng ≥10 mẫu; cả cửa
sổ chỉ có **6 mẫu organic**). Đây là điểm khác pilot 1: lần đó n=21 đủ để verdict
tuyên breach; lần này công cụ nói thẳng là chưa kết luận được. Toàn bộ 6 mẫu
trong cửa sổ: **288 · 532 · 1496 · 3432 · 12624 · 17236 ms**. Hai mẫu ≥12s là
tab trình duyệt tự động của phiên làm việc (22:40 ngày 28 và 06:38 ngày 29 —
beacon flush khi điều hướng), không phải khách; bốn mẫu còn lại đều <4000ms.
Vế số-lượng do **synthetic** gánh, đúng thiết kế ADR-013 — không phải lách.

## ✅ KẾT LUẬN CỬA SỔ QUAN SÁT — PASS (2026-07-31 01:47 +07, 51h10m sau cutover)

| Điều kiện ADR-013 (lớp public/read-only <3 lượt/ngày) | Kết quả |
|---|---|
| Quan sát 48–72h với telemetry tagged | **51h10m** (cutover 28/07 22:37:10 → chốt 31/07 01:47) ✔ — **nhưng vế "tagged" chỉ đạt MỘT PHẦN, xem risk acceptance bổ sung dưới** |
| Synthetic n≥72 | **4 lần**: 848 / 976 / 968 / **856ms**, mỗi lần n=75, **0 lỗi**, trần 4000ms ✔ — lần cuối chạy SAU mốc 48h thật |
| Risk acceptance ghi rõ + ký | ✔ (28/07, bảng trên) |
| Persistence/security invariant | không vi phạm ✔ |
| Rollback trigger §4 | **không cái nào chạm**: 0 lỗi trên route suốt cửa sổ; error verdict `no-baseline` (rate 0); LCP organic `insufficient-sample`; không P1; không cache poisoning ✔ |

**Số chốt (đo từ đúng mốc cutover 28/07 22:37:10 tới 31/07 01:47):**
`/grammar/*` = **231 lượt xem / 0 lỗi**; **toàn site 0 lỗi** trong suốt cửa sổ.
Đối chứng `/` 24h = 12 lượt / **0 lỗi** / LCP p75 2976ms (n=10, dưới trần).

**Dòng thời gian release trong cửa sổ (đính chính theo review #881).** Bản ghi
trước viết "production = `cedd4dd5` trong toàn bộ thời gian đo" — **sai**.
Production đi qua **3 release**:

| Khoảng | Release | Vào production do |
|---|---|---|
| 28/07 22:37 → 29/07 06:44 | `524fd210` | chính cutover (PR #754) |
| 29/07 06:44 → 29/07 11:12 | `10405d0e` | PR #878 (hồ sơ) |
| 29/07 11:12 → hết cửa sổ | `cedd4dd5` | PR #879 (telemetry) |

**2 lần merge trong cửa sổ**, không phải 4: **#878** và **#879** (mỗi PR đúng
một merge commit). **#877** (font parity) merge lúc **22:30:04**, tức **7 phút
TRƯỚC cutover** — nó thuộc phần chuẩn bị, không phải nhiễu trong cửa sổ.
ADR-013 cho phép merge trong cửa sổ vì quy kết đi bằng tag
`implementation`/`release`.

**MỘT DEPLOY KHÔNG ĐƯỢC SMOKE — nói thẳng (review #881).** Câu "mỗi deploy đều
đã smoke lại theo luật §12.6" ở bản trước là **sai**. Bảng thật:

| Release | Sống từ → đến (+07) | Smoke trong khoảng đó |
|---|---|---|
| `524fd210` | 28/07 22:37 → 29/07 06:44 | ✔ run `30374618340` lúc 22:41 — 848ms |
| `10405d0e` | 29/07 06:44 → 29/07 11:12 (4h28m) | ✘ **KHÔNG có** |
| `cedd4dd5` | 29/07 11:12 → hết cửa sổ | ✔ 3 run: `30421689223` (11:13, 976ms), `30557484374` (30/07 22:36, 968ms), `30571613070` (31/07 01:47, 856ms) |

Bằng chứng thay thế cho khoảng `10405d0e` (đo lại trên DB): **0 lỗi toàn site**,
`/grammar/*` nhận **0 lượt xem và 0 mẫu vitals** (toàn site đúng 1 lượt xem)
trong suốt 4h28m đó — tức khoảng bị bỏ sót cũng là khoảng không có ai dùng
route và không có lỗi nào. Ghi chú thêm: **luật smoke-sau-mỗi-deploy của §12.6
chính là do PR #879 mang lên lúc 11:12**, tức nó ra đời SAU deploy này — nên
đây là thiếu sót về bằng chứng, không phải vi phạm một luật đang có hiệu lực.
Vẫn ghi vào hồ sơ thay vì bỏ qua.

## Risk acceptance BỔ SUNG — vế "telemetry tagged" chỉ đạt một phần (review #881)

ADR-013 đặt **telemetry tagged** làm điều kiện tiên quyết, trong khi chính hồ sơ
này ghi **DEBT-2026-07-30-N**: thẻ `release` có thể cũ (2/6 mẫu vitals + 1 lượt
xem mang release `856688dd` của 17/07), và nguyên nhân **chưa sửa**. Vì
production đi qua 3 release trong cửa sổ, một thẻ không đáng tin làm suy yếu
đúng thứ ADR-013 dựa vào. Phân tích phạm vi ảnh hưởng, không giấu:

| Chỗ dựa của verdict | Có bị thẻ release làm hỏng không |
|---|---|
| **0 lỗi** (trên route và toàn site) | **Không** — không có lỗi nào để quy sai chỗ. Đây là chân đỡ chính của PASS |
| **Synthetic 4 lần** (848/976/968/856ms) | **Không** — quy kết đến từ chính workflow run (route + thời điểm + SHA đang deploy), không đọc thẻ của client |
| **LCP organic** | **Có thể** — mẫu có thể bị gán nhầm release. Nhưng verdict là `insufficient-sample`, **không mang trọng số nào** trong PASS |
| Điều KHÔNG loại trừ được | Tỷ lệ release thật của 6 mẫu organic là bất định; và có client chạy JS cũ hơn deploy mà mình không nhận diện được |

**Quyết định:** chấp nhận rủi ro có-ghi-rõ và giữ PASS, vì chân đỡ của verdict
(0 lỗi + synthetic) không phụ thuộc thẻ client. **Điều kiện lật ngược:** nếu
trong cửa sổ có **bất kỳ lỗi nào** trên route thì quy kết theo release trở
thành thiết yếu — khi đó **không được tuyên PASS** trước khi đóng DEBT-N. Ràng
buộc này áp cho **pilot 3+4 trở đi**: DEBT-N phải đóng, hoặc phải viết lại
đúng khối risk acceptance như trên trước khi mở cửa sổ.

| Trường | Giá trị |
|---|---|
| Rủi ro chấp nhận | Vế "telemetry tagged" đạt một phần — thẻ `release` phía client có thể cũ (DEBT-2026-07-30-N) |
| Người duyệt | **Chủ dự án** — xác nhận bằng việc merge PR #881; nếu không chấp nhận thì verdict phải hạ xuống *chưa kết luận* cho tới khi DEBT-N đóng |
| Ngày | 2026-07-31 |

### Nợ mở ra từ cửa sổ này

- **DEBT-2026-07-29-K** (đã ghi §12.6): chunk Next dùng `static{` ⇒ iOS ≤16.3
  không hydrate. **Giờ là việc kế tiếp** — cửa sổ đã đóng nên không còn lý do hoãn.
- **DEBT-2026-07-30-N — thẻ `release` không mô tả được thời điểm tải trang.
  NGUYÊN NHÂN CHƯA XÁC ĐỊNH** (đã hạ cấp từ khẳng định "cache trung gian" sau
  review #881 — kết luận cũ vượt quá bằng chứng).

  *Quan sát:* hai mẫu vitals ngày 30/07 (02:36 và 02:52, `/grammar/tenses/past-simple`)
  mang release `856688dd` — bản phục vụ production **17/07 → 25/07** — và thiếu
  trường `ua` dù bản có UA lên lúc **29/07 11:12**. Tức tài liệu đang chạy dùng
  `runtime-config.js` + `rum-vitals.js` cũ hơn deploy hiện hành.

  *Hai giả thuyết, chưa cái nào chứng minh được:*

  | # | Giả thuyết | Điểm mạnh | Điểm yếu |
  |---|---|---|---|
  | A | Tài liệu tải asset từ **cache client/trung gian** | Repo **không có service worker**; header hiện tại `no-store` (runtime-config) + `max-age=300, must-revalidate` (rum-vitals) ⇒ nếu đúng thì cache nằm ngoài tầm kiểm soát | Không quan sát trực tiếp được cache đó |
  | B | **Tab sống lâu**: `rum-vitals.js` chỉ gửi ở lần `hidden`/`pagehide` ĐẦU TIÊN, nên một tab mở từ lâu và đóng ngày 30/07 sinh đúng payload này — khi đó thẻ **nói thật** về asset đang chạy | Giải thích được việc thiếu `ua` mà không cần cache | **Không tự nó giải thích được thẻ `856688dd`**: đường dẫn `/grammar/:cat/:slug` chỉ tồn tại dưới dạng route Next từ **28/07 22:37**, trước đó là trang legacy (không nạp `rum-vitals.js`) ⇒ tài liệu phải được tải SAU 28/07 22:37, lúc production đã là `524fd210`, chứ không phải `856688dd`. Muốn khớp thì vẫn phải giả định thêm một asset cũ |

  *Hệ quả cho ADR-012:* dù nguyên nhân là A hay B, **thẻ `release` không cho biết
  tài liệu được tải lúc nào**, nên quy kết một-biến theo release bị suy yếu ở
  đúng ca này.

  *Việc cần làm — theo thứ tự:* (1) **thêm mốc thời gian tải trang + build id
  đọc tại lúc parse tài liệu** vào payload — đây là thứ phân biệt được A với B,
  và phải làm TRƯỚC khi kê đơn; (2) tái hiện riêng hai kịch bản (giữ một tab
  xuyên qua một lần deploy; và một lần điều hướng mới qua chỗ nghi có cache);
  (3) chỉ khi kết luận là A mới gắn `?v=<release>` cho runtime-config.js —
  **cách này KHÔNG cứu được kịch bản B**, vì tài liệu đã mở thì không thể cập
  nhật config bằng URL mới.

Rollback nếu: persistence/security breach (ngay lập tức), P1 trang không render,
error-rate > 2× baseline/30ph, LCP p75 > 1.5×/24h, cache poisoning. Cơ chế:
Instant Rollback ≤12s → điều tra → **Undo Rollback DUY NHẤT** (không bao giờ
"rollback tiến" — bài học Gate B đã làm production kẹt pin 5 tiếng).
