# Pilots 3+4 cutover sheet — profile page `/profile`

Theo `docs/PILOT_ENTRY_CHECKLIST_2026-07-13.md` §6.3 + §6.4. Pilot 3 (authed
READ) và pilot 4 (reversible MUTATION) là **CÙNG một trang** (profile) — một
cutover mang cả hai.

> **TRẠNG THÁI VẬN HÀNH: CHUẨN BỊ SẴN, CHƯA cutover.** Diff build + suite
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

## GATE trước khi merge (BẮT BUỘC — lý do DRAFT)

**Pilot 3 (read) — ĐÃ ĐẠT:**
- [x] ADR-011 đóng (AuthProvider state machine)
- [x] Private no-store (`/auth/me`, `/auth/profile`, `PATCH /auth/profile`)
- [x] Isolation E2E: logout→back/forward, Login A→B, same-status switch (#742)

**Pilot 4 (mutation) — CÒN MỞ:**
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
