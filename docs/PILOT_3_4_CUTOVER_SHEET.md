# Pilots 3+4 cutover sheet — profile page `/profile`

Theo `docs/PILOT_ENTRY_CHECKLIST_2026-07-13.md` §6.3 + §6.4. Pilot 3 (authed
READ) và pilot 4 (reversible MUTATION) là **CÙNG một trang** (profile) — một
cutover mang cả hai.

> **TRẠNG THÁI VẬN HÀNH: ĐÃ CUTOVER 2026-08-02 07:1x +07** (PR #756 merged,
> release `311f5086`). `/profile` là canonical trên production; cửa sổ quan sát
> 48–72h đang mở — xem mục cuối trang. Phần dưới giữ nguyên văn lúc prep.
>
> [LỊCH SỬ] **TRẠNG THÁI VẬN HÀNH: CHUẨN BỊ SẴN, CHƯA cutover.** Diff build + suite
> verified; PR **DRAFT**. Gate mutation **N/N−1 consumer test đã đóng
> (2026-07-14)** — blocker còn lại **[CẬP NHẬT 2026-07-25 theo ADR-013]**:
> profile authed traffic thấp ⇒ **early-stage profile** (48–72h + synthetic
> mutation coverage + N/N−1 đã pass + kill-switch drill + risk acceptance),
> KHÔNG soak-14-ngày-freeze; + re-measure ≤72h + refresh main (không có gate
> build-được nào còn mở). Profile hiện VẪN legacy tại
> `/pages/profile.html`; bản Next dark-launch ở `/profile-preview` (đã đổi
> thành `/profile` trong branch này).

## Khác biệt so với pilot 1/2 (đọc kỹ)

- Legacy profile là **file trực tiếp** `/pages/profile.html` — KHÔNG có
  clean-URL rewrite để gỡ. Cutover lập **URL canonical MỚI** `/profile` +
  redirect từ file cũ.
- Redirect `/pages/profile.html` → `/profile` là **TẠM THỜI (307)** không
  permanent: `/profile` sẽ **404 khi rollback** (khác `/` luôn serve), nên
  permanent-cached redirect sẽ kẹt client ở 404. Route authed = noindex nên
  không mất SEO.
- **KHÔNG đổi** link trong `aver-chrome.js`/`user-pill.js` (vẫn `/pages/profile.html`):
  redirect xử lý khi pilot live, serve legacy trực tiếp khi rollback → an toàn
  rollback. Đổi link = phá link đó trên MỌI trang nếu rollback.
- Route **authenticated** — AuthProvider fail-closed (signed-out → /login.html)
  thừa kế nguyên từ pilot 3, đã proven trên staging E2E #742/#743.

## Thay đổi (atomic — một commit)

| # | Thay đổi | File |
|---|---|---|
| 1 | `git mv` `profile-preview` → `profile` → route thành `/profile` | `app/(authed)/profile/*` |
| 2 | **Thêm** redirect `/pages/profile.html` → `/profile` (permanent:false) | `next.config.ts` |
| 3 | page.tsx: comment + `robots: { index:false }` (route private) | `app/(authed)/profile/page.tsx` |
| 4 | Test paths + flip pin cutover-ownership | `tests/pilot-profile.test.mjs` |
| 5 | Staging E2E specs: `/profile-preview` → `/profile` (test đúng URL sau cutover) | `tests/staging-e2e/pilot-3-profile.spec.js`, `pilot-4-profile-save.spec.js` |

## [LỊCH SỬ — đã đóng tại cutover 02/08] GATE trước khi merge

> **Toàn bộ mục này là ghi chép giai đoạn chuẩn bị, KHÔNG còn là việc phải làm.**
> Đính chính theo review PR 893: để nguyên văn cũ khiến trang vừa nói "đã
> cutover" vừa nói "Pilot 4 CÒN MỞ" và vẫn liệt kê production-smoke như điều
> kiện tiên quyết — trong khi chính trang này (mục "Hai việc chặn") đã kết luận
> **smoke KHÔNG dùng được cho route authed**. Trạng thái đóng thật:
>
> - Pilot 4 (mutation): **ĐÃ ĐÓNG** — N/N−1 xanh, kill-switch đo lại 872/1094ms
>   (31/07), staging E2E 23/23.
> - Baseline `/profile` ≤72h: **ĐÃ ĐO** — 0 lượt organic/24h08m ⇒ xếp lớp
>   zero-traffic của ADR-013.
> - Production-smoke: **BỎ, có lý do** — browser ẩn danh bị đẩy sang `/login.html`.
>   Vế synthetic do staging E2E gánh.
> - Refresh main + re-verify: **ĐÃ LÀM** (drift 446 commit, suite 5792/0).

**Pilot 3 (read) — ĐÃ ĐẠT:**
- [x] ADR-011 đóng (AuthProvider state machine)
- [x] Private no-store (`/auth/me`, `/auth/profile`, `PATCH /auth/profile`)
- [x] Isolation E2E: logout→back/forward, Login A→B, same-status switch (#742)

**Pilot 4 (mutation) — [đã đóng 02/08; nguyên văn lúc prep]:**
- [x] Idempotency (set-semantics PATCH; replay pin)
- [x] Canonical reconcile GET + double-submit + timeout-after-commit (#743/#749)
- [x] Kill switch `require_flag("profile_update")` + drill đo (545ms/759ms)
- [x] **N/N−1 consumer test (ADR-009) — ĐÃ VIẾT + XANH (2026-07-14):**
      static contract `tests/profile-nn1-contract.test.mjs` (legacy + Next gửi/đọc
      shape GIỐNG HỆT, đều ⊆ backend accept/return — pin no-removal ADR-009 §1)
      + live `tests/staging-e2e/nn1-profile-consumer.spec.js` chạy payload CẢ HAI
      client với staging backend HEAD (legacy=rollback safety, Next=interchangeable,
      idempotent replay) — 3/3 pass live. Đóng gate mutation chốt.

**Chung:**
- [x] Nightly streak 20/20 · [ ] Traffic baseline re-run ≤72h · [ ] Đo baseline
      /profile ≤72h (profile authed — traffic thấp hơn root ⇒ **early-stage
      profile ADR-013**: 48–72h + synthetic mutation n≥72, KHÔNG dùng sàn "50
      attempts") · [ ] **Production-smoke synthetic sống trên /profile** (vế
      số-lượng ADR-013, điều kiện tiên quyết) · [ ] REFRESH main + rebuild
      tailwind + re-verify (DRAFT sống lâu).

## Verify SAU cutover (browser-based, ≥15s cadence)

1. `/profile` (đã đăng nhập) = Next; profile render đúng (identity/stats/form);
   save hoạt động (pilot 4); `/auth/*` trả `private, no-store`; zero error.
2. `/profile` (chưa đăng nhập) → redirect `/login.html` (fail-closed).
3. `/pages/profile.html` → 307 → `/profile`.
4. aver-chrome "Hồ sơ" pill vẫn tới được profile (qua redirect).
5. Legacy nguyên vẹn; auto-promote release=main; drift job xanh.
6. Kill switch: flip `profile_update` off → save trả 503 → on → phục hồi.
7. Dashboard ADR-012: error-rate `/profile` tag `implementation=next`.

## Rollback (freeze — checklist §4)

Trigger: error-rate profile > 2×/30ph · P1 (không load / auth loop / save mất
data) 1 báo cáo · **mutation sai/mất data → flip `profile_update` OFF TRƯỚC,
điều tra sau** (kill switch ≤15s) · private-data leak → NGAY. Cơ chế: Instant
Rollback ≤12s → Undo Rollback DUY NHẤT. Vì redirect tạm thời, rollback trả
`/pages/profile.html` về serve legacy trực tiếp.

## Verify tại PREP (2026-07-14)

- route-ownership **clean** (5 app routes, 29 config sources — +1 redirect;
  `/profile` không collide `/pages/profile.html`).
- build: `○ /profile` Static app route; `/profile` curl 200 + full profile
  shell SSR (mọi id profile-*/inp-*/btn-save present).
- redirect: `/pages/profile.html` → **307** → `/profile` (verified local).
- Suite: contract **5255/5255**; pilot-profile 7/7 pins flipped.
- Auth-gate SSR/hydration KHÔNG verify local được (headless CDN supabase load
  chặn DOMContentLoaded) — hành vi byte-identical pilot 3, proven staging #742.

## Register (checklist §5)

Frozen estimate: pilot 3 = 8h, pilot 4 = 8h. Đã tiêu tới prep: build #742 ~2h +
#743/#744 ~2.5h + prep ~0.5h. Số đo cutover (đo TẠI cutover): JS route-specific,
Lighthouse, API count, no-store header, kill-switch drill, isolation re-verify,
error rate 7 ngày trước/sau.

## Chuẩn bị 2026-07-31 (CHƯA cutover, CHƯA đếm giờ)

Nhánh refresh lên `origin/main` (`cb313997`, drift **446 commit**) — merge
**sạch, 0 conflict**; invariant cutover còn nguyên.

| Kiểm | Kết quả |
|---|---|
| Suite contract frontend | **5714 pass / 0 fail** |
| `npm run build` | **`○ /profile`** (Static) — `/profile-preview` đã biến mất |
| `route-ownership --manifest` | clean — 5 route compiled, 0 collision |
| `legacy-browser-scan` | sạch — 11 chunk + 128 script tĩnh + 220 script inline (sàn iOS 15) |
| Tailwind `build.css` | FRESH |
| Production hiện tại | `/profile-preview` = 200 Next SSR (dark) · `/profile` = **404** (đúng, chưa cutover) |

### HAI VIỆC CHẶN, tìm ra khi chuẩn bị

**1. Staging đứng yên ở `ba687867` (14/07) — lệch main 446 commit.**
Với pilot 1/2 chuyện này ít hệ quả. Với pilot 3+4 thì KHÔNG: ADR-013 xếp
route *authenticated + mutation* vào lớp đòi **synthetic mutation coverage**,
mà công cụ đó chính là **bộ staging E2E** (pilot-3 isolation matrix, pilot-4
save/double-submit/kill-switch, N/N−1 consumer). Nightly vẫn xanh mỗi đêm
(25→30/07) nhưng nó đang kiểm một bản build gần **3 tuần tuổi** — bằng chứng
xanh mà lệch bản thì không dùng để mở cổng được. **Phải cập nhật staging lên
nhánh cutover TRƯỚC khi chạy bộ E2E làm bằng chứng.** (Staging là nhánh con
trỏ; cập nhật = force-push, việc của chủ dự án.)

**2. `production-smoke` KHÔNG gánh được vế số-lượng cho route authed.**
Bộ smoke `page.goto(ROUTE)` bằng browser ẩn danh; `/profile` là route có
đăng nhập, AuthProvider fail-closed sẽ `location.replace('/login.html')`,
nên phép đo rơi vào vỏ trang hoặc trang login — con số vô nghĩa, tệ hơn là
"xanh giả". Với lớp route này, vế synthetic phải do **staging E2E** gánh
(nó đăng nhập bằng danh tính seed và thao tác thật), còn smoke chỉ dùng cho
route công khai. Ghi rõ ở đây để lần sau không ai chạy smoke rồi tưởng đã
đủ bằng chứng.

### Chuỗi còn lại khi chủ dự án quyết cutover

1. Cập nhật staging lên nhánh này → chạy **full staging E2E** (kỳ vọng toàn
   xanh, gồm pilot-3 isolation + pilot-4 mutation + N/N−1) = vế synthetic.
2. Kill-switch drill đo lại (ADR-010) — số cũ 545ms/759ms từ 13/07.
3. Traffic baseline + risk acceptance ≤72h, ký tên.
4. Cutover atomic → verify browser-based ≥15s → quan sát organic 48–72h.
   Trong cửa sổ, telemetry nay có `doc_release`/`age_ms` (DEBT-N đã đóng
   `cb313997`), nên nếu có lỗi thì quy kết được theo release thật.

### Bằng chứng synthetic mutation coverage — ĐÃ CÓ (2026-07-31)

Staging đã cập nhật lên nhánh cutover (`0db3f77b`, chủ dự án force-push) →
dispatch `staging-e2e` trên nhánh: **23/23 PASS** (run `30639297343`,
1.0 phút). Đây là vế **synthetic mutation coverage** mà ADR-013 đòi cho lớp
*authenticated + mutation* — gồm pilot-3 isolation matrix (signed-out
fail-closed, A→signout→Back→B, đổi tài khoản cùng-trạng-thái), pilot-4
save→reload→revert + double-submit + kill-switch, N/N−1 consumer, gate-a
flows và bộ platform.

**Lần chạy đầu ĐỎ và đó là chuyện tốt:** nó bắt được `gate-b-coexistence`
còn khẳng định grammar thuộc legacy — tripwire lẽ ra phải lật tại cutover
pilot 2 (28/07) nhưng nightly vẫn xanh 3 đêm vì staging ghim ở bản 14/07.
Sửa ở PR #885. Bài học đã ghi vào chính spec đó: **tripwire chỉ có giá trị
khi môi trường nó chạy CÙNG BẢN với môi trường nó bảo vệ.**

Ghi chú CI: job `production-release-drift` trong cùng workflow so production
với `GITHUB_SHA` của **ref được dispatch**, nên chạy trên nhánh là đỏ theo
thiết kế — không phải drift thật (production vẫn = main HEAD). Vá ở PR #886.

### Còn lại trước khi cutover

- [ ] Kill-switch drill đo lại (ADR-010) — số cũ 545ms/759ms từ 13/07.
- [ ] Traffic baseline ≤72h + **risk acceptance ký tên** (kèm điều kiện của
      pilot 2: nếu cửa sổ có lỗi trên route thì DEBT-N phải đóng trước khi
      tuyên PASS — DEBT-N ĐÃ đóng `cb313997`, nên điều kiện này đã sẵn).
- [ ] Cutover atomic → verify browser-based ≥15s → quan sát organic 48–72h
      (KHÔNG dùng production-smoke cho route authed — xem mục trên).

## Risk acceptance — ĐÃ KÝ 2026-08-02

**Lớp route theo ma trận ADR-013: `Zero-traffic` → điều kiện PASS là
"synthetic-only + risk acceptance"** (không đòi baseline organic, vì không thể
đòi thứ không tồn tại). Xếp vào lớp này dựa trên đo đạc, không phải phỏng đoán.

### Số đo (tất cả đều đo được, không phải suy luận)

| Hạng mục | Giá trị | Ghi chú |
|---|---|---|
| Traffic organic `/pages/profile.html` | **0 lượt xem / 24h08m** | cửa sổ 01/08 06:56 → 02/08 07:04 |
| Web Vitals organic trên trang đó | **0 mẫu** | ⇒ **không có baseline LCP tương đối**; trigger chạy ở ngưỡng TUYỆT ĐỐI (4000ms) |
| Lỗi trên route đó | **0** | |
| Đối chứng cùng cửa sổ | speaking 35 · result 27 · home 23 · `/` 8 | site vẫn có traffic ⇒ 0 là thật, không phải chết ống đo |
| **Ống đo đã kiểm chứng** | page_view ghi được với **`user_id` ≠ NULL** | tự vào trang bằng phiên đăng nhập lúc 07:04, hàng ghi xuất hiện đúng |
| **Synthetic mutation coverage** | **staging E2E 23/23 PASS** (run `30639297343`) | isolation matrix · save→reload→revert · double-submit · N/N−1 · gate-a · platform |
| Kill-switch drill (ADR-010) | **off→503 872 ms · on→200 1094 ms** | đo lại 31/07, ≪ TTL 15s |
| N/N−1 consumer test | PASS (14/07, spec vẫn trong bộ 23) | payload legacy ↔ Next hoán đổi được |
| DEBT-2026-07-30-N | **ĐÃ ĐÓNG** (`cb313997`) | điều kiện tôi tự đặt ở pilot 2 nay đã thoả |

### Rủi ro chấp nhận — nói thẳng cái mình KHÔNG có

1. **Không có baseline LCP/error-rate tương đối.** Cửa sổ quan sát sẽ so với
   ngưỡng tuyệt đối, y như pilot 1. Nếu route vẫn 0 traffic sau cutover thì
   verdict sẽ là `insufficient-sample` — tức **cửa sổ organic gần như không
   mang thông tin**, và sức nặng dồn hết vào synthetic + rollback readiness.
2. **Không đo được lịch sử.** Trang này trước 01/08 chưa từng có beacon, nên
   không thể nói "trước nay có bao nhiêu người dùng". Chỉ biết: 24h gần nhất = 0.
3. **Khoảng mù lỗi sớm vẫn còn** (đã thu hẹp ở PR #887): lỗi xảy ra trước khi
   script `defer` đầu tiên chạy vẫn ngoài tầm; muốn kín phải nội tuyến listener
   vào `<head>` — chưa làm.
4. **Đây là cutover đầu tiên có MUTATION.** Hỏng ở đây không chỉ là trang xấu:
   người dùng có thể lưu hồ sơ thất bại hoặc thấy dữ liệu người khác. Lưới:
   AuthProvider fail-closed, reconcile-sau-mọi-mutation, kill-switch
   `profile_update` (đo 872ms), và rollback ≤12s.

### Lưới an toàn (giữ cứng, không phụ thuộc mẫu thống kê)

- **Rollback Instant ≤12s** về deployment trước; khôi phục = **Undo Rollback
  DUY NHẤT**. `/pages/profile.html` giữ nguyên trên disk và redirect là **307
  tạm thời** đúng để rollback không kẹt client ở 404.
- **Kill-switch `profile_update`**: tắt mutation trong ~1s mà không cần deploy.
- **Persistence/security breach → rollback NGAY**, bất kể mẫu lớn nhỏ.

### Bảng ký

| Trường | Giá trị |
|---|---|
| Route | `/profile` (canonical MỚI) + `/pages/profile.html` → 307 tạm thời |
| Lớp rủi ro | **Zero-traffic**, authenticated + mutation |
| Ngày cutover | **2026-08-02** |
| Người duyệt | **Chủ dự án** — duyệt trong phiên 02/08 sau khi đọc bảng số và 4 mục "cái mình KHÔNG có" |
| Vế synthetic | staging E2E 23/23 (đã có) |
| Vế thời-gian | quan sát 48–72h ở chế độ ngưỡng tuyệt đối |
| Điều kiện dừng | bất kỳ lỗi persistence/security → rollback ngay; P1 trang không render → rollback |


## ✅ CUTOVER ĐÃ THỰC HIỆN — 2026-08-02 07:1x +07

Release **`311f5086`** (merge PR #756). Auto-promote: production
`runtime-config.release` = main HEAD ngay lần poll đầu.

| Kiểm (browser-based, cadence thưa) | Kết quả |
|---|---|
| `/profile` | **200, Next SSR** (`__next_f`), 24.9 KB |
| Trình duyệt thật (đang đăng nhập) | render đủ: tên, email, ngày tham gia, **75 sessions · band 5.5 · mục tiêu 5/tuần**, form thông tin + band mục tiêu + ngày thi + trình độ. **0 console error** |
| `/pages/profile.html` | **307 → `/profile`** (tạm thời, đúng thiết kế rollback) |
| Route khác | `/` NEXT · `/grammar/...` NEXT · `/pages/home.html` legacy · `/pages/speaking.html` legacy — nguyên vẹn |
| **Telemetry trên route mới** | `page_view` ghi ngay: **`implementation=next`, `user_id` ≠ NULL, release `311f5086`** |
| Kill-switch `profile_update` | **không có hàng trong `runtime_flags`** = mặc định BẬT theo ADR-010; PATCH sẽ tạo hàng và tắt trong ~1s (đo 872ms hôm 31/07) |

**Ghi chú về mẫu số — nói cho đúng mốc thời gian** (đính chính theo review
PR 893, bản đầu của tôi viết quá tay):

| Mốc | Trạng thái beacon trên trang hồ sơ |
|---|---|
| Trước **01/08** | **Không có** beacon nào — mọi con số "0 lượt xem" thời kỳ đó là hiện vật đo đạc |
| 01/08 06:56 (PR 887) | Gắn beacon vào `/pages/profile.html` (bản legacy) |
| 02/08 07:04 (**trước** cutover) | `page_view` đầu tiên có `user_id` ≠ NULL — chính là lần tôi tự vào để kiểm ống đo |
| 02/08 07:17 (**sau** cutover) | `page_view` từ route Next, `implementation=next` |

Nên câu đúng là: **trang hồ sơ có mẫu số thật từ 01/08**, không phải "lần đầu
sau cutover". Cái *không* tồn tại là **baseline có ý nghĩa thống kê** — 24h đó
đo được đúng 0 lượt organic (đã ghi trong risk acceptance).

**Chưa kiểm trên production: đường MUTATION.** Cố ý — nó ghi dữ liệu thật vào
hồ sơ của người dùng. Vế đó do **staging E2E 23/23** gánh (save→reload→revert,
double-submit, kill-switch). Nếu muốn xác nhận trên production thì phải là chủ
tài khoản tự đổi rồi đổi lại, không phải tôi tự ý ghi.

### Cửa sổ quan sát 48–72h — mở từ 2026-08-02 07:1x

- 48h: **04/08 07:1x** · 72h: **05/08 07:1x**
- Mỗi ngày: admin *Báo lỗi* → *Rollback trigger* → route `/profile`
  (**match = chính xác**, không phải prefix) → **Đo**; ghi vào bảng dưới.
- **KHÔNG dùng production-smoke** cho route này (browser ẩn danh bị đẩy sang
  `/login.html`, số đo vô nghĩa).
- Rollback ngay nếu: persistence/security breach · P1 trang không render ·
  lưu hồ sơ hỏng. Cơ chế: kill-switch trước (tắt mutation, giữ trang đọc), rồi
  Instant Rollback ≤12s nếu cần; khôi phục = **Undo Rollback DUY NHẤT**.

| Ngày | Views/Lỗi trên `/profile` | LCP p75 | Ghi chú |
|---|---|---|---|
| D0 02/08 | 1 view (của tôi) / 0 lỗi | — | cutover + verify |
| D1 03/08 | **0 view / 0 lỗi** | 10228ms (1 mẫu, KHÔNG dùng được — xem dưới) | cửa sổ mở 25,1h |
| D2 04/08 | — | — | **không đo: cửa sổ đóng sớm 03/08** |

---

## 🔚 ĐÓNG SỚM CỬA SỔ — 2026-08-03, T+25,1h

Chủ dự án quyết định đóng sớm thay vì chờ mốc 48h (04/08). Ghi lại **lý do
thật**, không phải lý do dễ nghe.

### Số đo tại thời điểm đóng

| | |
|---|---|
| Cửa sổ đã mở | **25,1 giờ** (cutover 02/08 00:17Z → đóng 03/08 01:25Z) |
| Sự kiện trên `/profile` **kể từ cutover** | **2** — cả hai đều của tôi |
| Lượt xem organic | **0** |
| `error_logs` dính `profile` kể từ cutover | **0** (toàn site chỉ 2 hàng lỗi) |
| Verdict lỗi / vitals | `insufficient-sample` / `insufficient-sample` |

Hai sự kiện đó là: `page_view` lúc 00:17:23Z (lần tôi mở để verify cutover) và
`web_vitals` lúc 06:59:47Z. **Bản ghi vitals KHÔNG phải lượt truy cập thứ hai**:
`loaded_at` của nó khớp tới giây với `page_view` trên, `age_ms = 24.144.051`
(6,7 giờ) — cùng một tab để mở rất lâu rồi mới chốt LCP. Nên **10228ms không
phải số đo tốc độ hợp lệ**, và ta đang có **0 mẫu LCP dùng được** cho `/profile`.

> Chính hai trường `loaded_at`/`age_ms` (thêm khi truy DEBT-N) là thứ phân biệt
> được "tab sống lâu" với "lượt xem bị mất đếm". Không có chúng, "0 view + 1
> LCP" trông y hệt một ống đo hỏng, và ta đã đi săn nhầm.

### Ống đo có sống không — kiểm TRƯỚC khi tin số 0

Bắt buộc, vì "0 lượt xem" đã từng là hiện vật đo đạc ở chính dự án này. Trong
60h: **610 sự kiện, 245 `page_view`** rải khắp site (`/pages/home.html` 93 ·
`/pages/speaking.html` 49 · `/pages/writing-dashboard.html` 35 ·
`/pages/result.html` 29 · `/` 24 · `/grammar.html` 5). Beacon sống.
**Số 0 của `/profile` là 0 thật.**

### Vì sao đóng sớm KHÔNG làm mất bằng chứng

Vì cửa sổ này chưa từng có khả năng sinh bằng chứng. Đo năng lực thống kê thật
của site (14 ngày, 2878 `page_view`):

| | |
|---|---|
| Lưu lượng | **8,6 page_view/giờ** toàn site · **31** người dùng đăng nhập |
| Route có lưu lượng | 51/127 → **76 trang 0 lượt xem suốt 14 ngày** |
| Route <20 lượt xem trong **14 ngày** | **42/51** |
| Route đạt n=20 trong ≤1 ngày | **6** |

Cổng soak đòi n≥20 views / n≥10 vitals. `/profile` có **0 view trong 14 ngày
trước cutover và 0 sau cutover**. Chờ thêm 23h nữa (tới mốc 48h) hay 47h nữa
(mốc 72h) đều cho ra cùng một thứ: **không có gì**. Đây không phải cửa sổ ngắn
đi — nó là cửa sổ **không định nghĩa được**, và điều đó đã được ghi trong
risk acceptance ký 02/08 (mục 1: "route vẫn 0 traffic sau cutover").

### Bằng chứng thật của pilot 3+4 — nằm ở đâu

Theo ADR-013 nhánh **synthetic-only** (áp dụng khi route 0 traffic):

| Bằng chứng | Trạng thái |
|---|---|
| Staging E2E đường mutation (save→reload→revert, double-submit, kill-switch) | **23/23 pass** |
| Render production bằng trình duyệt thật, tài khoản thật | đủ nội dung, **0 console error** |
| Telemetry trên route mới | `implementation=next`, `user_id` ≠ NULL, release `311f5086` |
| Redirect legacy `/pages/profile.html` → `/profile` | 307, đúng thiết kế rollback |
| Kill-switch `profile_update` | mặc định BẬT (ADR-010), tắt trong ~872ms (đo 31/07) |
| Lỗi client trên route kể từ cutover | **0** |

### Điều KHÔNG được suy ra từ trang này

- ❌ "0 lỗi / 0 view ⇒ đã chứng minh route an toàn dưới tải thật." Sai. Không
  có tải thật nào để chứng minh.
- ❌ "LCP 10228ms ⇒ route chậm." Sai — mẫu không hợp lệ (xem trên).
- ❌ "Đường mutation đã verify trên production." Sai — cố ý không verify, vì
  nó ghi vào hồ sơ người dùng thật. Staging E2E gánh vế đó.

### Kết luận

**Pilot 3+4 ĐÓNG — PASS theo nhánh synthetic-only, không phải theo bằng chứng
organic.** `/profile` giữ nguyên trên Next. Giám sát tiếp bằng ngưỡng **tuyệt
đối 0**: bất kỳ lỗi client nào trên `/profile` = điều tra ngay (khả thi chính
vì lưu lượng thấp — không có nhiễu để lọc). Rollback ≤12s vẫn là lưới đỡ.

**Hệ quả cho chương trình:** cổng soak theo thời gian chỉ áp dụng được cho 6
route đủ lưu lượng; 121 route còn lại cần cổng deterministic (parity diff +
replay dữ liệu thật + perf synthetic + ngưỡng lỗi 0). Đề xuất sửa ADR-013 theo
hướng đó là việc riêng, cần chủ dự án ký vì nó sửa chính sách phát hành đã ký.
