# Implementation plan

Hợp đồng dưới đây chép nguyên văn từ gói (bản 18/11 chiều, đo ở staging `93c7085`, kiểm lại ở `c3bc71574`). Đối chiếu ở staging `31725a9b` (23/11/2026): bốn trang pháp lý đã nằm ở `app/(public-v2)/` (G03-T13, #2444) chứ không ở `app/(marketing)/`; `PublicShell` có ở `frontend/components/ui/shell/public-shell.tsx`; `/library` đã chạy. Người thực thi đo lại số dòng trước khi sửa.

## Architecture impact

- Trang công khai mới dùng `PublicShell` của G03 (khách) và `LearnerShell` (đã đăng nhập, trừ `/` theo FR-002 và trang pháp lý). Route `/courses`, `/courses/[slug]` thêm vào cả `lib/route-registry.mjs` (`ui: 'v2'`, đổi `planned` → `live`) và `lib/v2-routes.mjs` (test đồng bộ).
- Trang chủ thay `app/(marketing)/page.tsx` và `landing-behavior.tsx`; giữ `OAUTH_RECOVERY`, `ANTI_FLASH` trong `app/(marketing)/layout.tsx`.
- Lớp dữ liệu thương mại `frontend/lib/commerce-*` (G05-T02) đọc API G04; G04 chưa có thì dữ liệu giả cùng kiểu.
- Trang lỗi thay `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx`; component 403 dùng chung; dải mất mạng và hộp thoại phiên hết hạn gắn qua khung G03.
- SEO: `app/sitemap.ts`, `lib/public-sitemap-model.mjs`, `app/robots.ts`; `/pricing` trong `app/(marketing)/pricing/page.tsx` cùng `tests/pricing-next-behavior.test.mjs`, `tooling/verify-pricing-redirect-flow.mjs`, `docs/ROUTE_LEDGER.md` sửa trong cùng PR.
- Backend: `GET /api/public/site-info` (đọc env, không bảng) và cờ `maintenance_mode` (`runtime_flags`).

## Data and contracts

Không có migration. Phần sau chép từ gói.

#### 5.1 Route frontend

| Đường dẫn | Route group | Khung (G03) | Auth | Dữ liệu | robots |
|---|---|---|---|---|---|
| `/` | `(marketing)` (giữ group, viết lại `page.tsx`) | `PublicShell`; có phiên: đổi phần phải thanh trên | không | `GET /api/courses` (server, cache); `GET /api/trial/public-config` (client) | index |
| `/courses` | `(public-commerce)` mới | `PublicShell` khi chưa có phiên, `LearnerShell` khi có | tuỳ chọn | `GET /api/courses` (có token thì kèm `viewer`); `GET /api/me/open-alerts` | index |
| `/courses/[slug]` | `(public-commerce)` | như trên | tuỳ chọn | `GET /api/courses/{slug}` | index |
| `/courses/[slug]/enroll` | `(public-commerce)` | `LearnerShell` | bắt buộc (thiếu → `/login?next=…`) | `GET /api/courses/{slug}`, `GET /auth/me`, `POST /api/enrollment-orders` | noindex |
| `/enroll/[orderCode]` | `(public-commerce)` | `LearnerShell` | bắt buộc | `GET /api/enrollment-orders/{order_code}`, `POST …/report-transfer`, `…/supplement`, `…/cancel`; `GET /api/public/site-info` | noindex |
| `/account/orders` | trong khung `/account` của G07; G07 chưa có thì đặt trong `(public-commerce)` | `LearnerShell` | bắt buộc | `GET /api/enrollment-orders/me` | noindex |
| `/activate` | `(public-auth)` | `LearnerShell` (không cổng kích hoạt) | bắt buộc | `POST /auth/activate/preview`, `POST /auth/activate` | noindex |
| `/login` | `(public-auth)` | thanh công khai tối giản | — | 5.6; màn 1, 2, 3, 8a–8c, 9 là các trạng thái của cùng một route, không có URL riêng (mã và email không vào lịch sử trình duyệt) | noindex (đang có) |
| `/terms`, `/privacy`, `/about`, `/contact` | `(public-v2)` do G03-T13 tạo | `PublicShell`; chân trang gọn khi có phiên | không | file nội dung (5.4); `POST /api/contact`; `GET /api/public/site-info` | index khi nội dung đã duyệt |

Không còn route `/welcome`. `/trial/*` thuộc spec 0047, G05 chỉ liên kết tới. Đổi email đăng nhập không có route riêng: thành phần `ChangeEmail` (T24) nằm trong trang Hồ sơ `/profile` của G07. Liên kết bỏ nhận trong thư "khoá đã mở đăng ký" mở `/courses/<slug>#bo-nhan=<token>` (token ở phần hash, không vào log máy chủ; trang đọc xong thì xoá hash như `/activate`).

Quy tắc bắt buộc cho mọi layout ở trên: gắn `AuthProvider` **không** có `activationGate` (người đăng ký online chưa được xác nhận có `users.is_active=false`; gắn cổng là họ bị đẩy về `/login`). Nếu `LearnerShell` của G03 được dựng trên `AuthedShell` thì truyền `authGated={false}` và thêm tiền tố route vào `proxy.ts` matcher + `nonceRouteAllowed`, chạy `frontend/tests/csp-nonce-report-only.test.mjs`. `CHƯA KIỂM` `LearnerShell` dựng trên gì: `grep -rn "AuthedShell\|AuthProvider" frontend/components | grep -i learner`.

Cờ build `AVER_PUBLIC_COMMERCE` (khai trong `next.config.ts` → `env`, giống cách `AVER_CSP_NONCE_*` đang làm): `'1'` thì `/courses*`, `/enroll/*`, `/account/orders` hoạt động; `'0'` (mặc định production tới khi anh Andy bật) thì các `page.tsx` đó gọi `notFound()` và `/pricing` giữ `redirect('/')`. Trang chủ khi cờ tắt ẩn mục khoá học và bảng học phí (không vẽ khối rỗng).


#### 5.3 Lớp dữ liệu và dữ liệu giả

- `frontend/lib/commerce-types.ts`: kiểu TypeScript đúng 5.2 (sau khi G04 merge: thay bằng kiểu sinh trong `frontend/types/api.d.ts`, giữ tên export).
- `frontend/lib/commerce-api.ts`: server dùng `frontend/lib/backend.ts` (giống `lib/grammar-api.ts`, có `'use cache'` + `cacheLife` cho `GET /api/courses*` **không kèm token**); client dùng `frontend/lib/browser-api.ts` cho mọi lời gọi có token (không cache phản hồi có `viewer`).
- `frontend/lib/commerce-model.mjs`: hàm thuần — `courseRowState(item)` → `'open'|'upcoming'|'learning'|'expired'` (từ `status` + `viewer.state`), `orderScreen(order)` → `2|3|4|5`, `orderBlocks(order)` (khối sai lệch/thừa tiền/lý do huỷ cần vẽ), `formatVnd(n)` (trả `null` khi `n` null), `nextActionForOrder(order)`, `catalogCounts(items)` → `{open, upcoming}`. Nhãn hành động khoá gọi `accessActionLabel` của `frontend/lib/course-access-labels.mjs`; module đó chưa có (G11-T29 chưa merge) thì T02 tạo đúng file và đúng API ghi ở GOI-11 mục 5.6, G11-T29 dùng lại.
- `frontend/tests/fixtures/commerce/*.json`: đủ sáu khoá (một `open`, năm `coming_soon` — đúng ca tờ DanhMucKhoaMoiMotKhoa; thêm một bộ hai `open`), đơn ở mọi `status`, mọi `info_kind`; khoá có và không có `credit_carry_percent`, `credit_carry_valid_days`; phản hồi `GET /api/me/courses` có và không có `content_visible_until`, `credits.carry_balance`, `credits.carry_expires_at`. Chỉ dùng trong test. **Không** có đường nào ở production đọc fixture. Khi G04 chưa merge, trang chạy thật gặp 404 từ backend → hiện trạng thái lỗi; PR ghi rõ "chưa nối API thật".

#### 5.4 Nội dung pháp lý

- Thư mục `frontend/content/legal/`: `terms.md`, `privacy.md`, `about.md`. Frontmatter: `title`, `effective_date` (YYYY-MM-DD), `updated_date`, `version`, `status: placeholder|reviewed`. Thân: Markdown, mỗi điều một `## Điều N. …`.
- Bản `status: placeholder` có đúng các tiêu đề điều mẫu trong `PhapLy.dc.html`, mỗi đoạn ghi `XXX — nội dung do người duyệt cung cấp`. Trang placeholder hiện dải "Bản nháp — chưa có hiệu lực" và `robots: noindex`.
- Nạp: Server Component đọc file lúc build (`fs` + `marked` 12.0.2). Không dùng `dompurify` ở đây (cần DOM). Cấu hình `marked` bỏ HTML thô (renderer `html` trả chuỗi rỗng). Sinh `id="dieu-N"` cho `h2` theo thứ tự.
- Chính sách hoàn tiền (màn 1 ThanhToan dẫn tới): mặc định là một mục `## Điều N. Hoàn tiền` trong `terms.md` với neo cố định `#hoan-tien` (mục 10 câu 6).
- Bản cũ: `version` tăng khi đổi; lưu bản cũ ở `frontend/content/legal/archive/<slug>-<version>.md` nếu pháp lý yêu cầu (chưa làm route xem bản cũ).

#### 5.5 Bảng "trang con → trang cha" (FR-013)

`frontend/lib/parent-route-model.mjs` export `PARENT_ROUTES` dạng `[{pattern, parent, message}]`, ví dụ `{pattern:'/enroll/[orderCode]', parent:'/account/orders', message:'Không tìm thấy đơn đăng ký này.'}`, `{pattern:'/courses/[slug]/enroll', parent:'/courses', …}`. Trang gọi `redirectToParent(pattern, reason)`: `router.replace(parent + '?notice=<key>')`; trang cha đọc `notice` (chỉ nhận key có trong bảng, không hiện chuỗi tuỳ ý từ URL), hiện dải, rồi `history.replaceState` bỏ `notice`. Các gói khác thêm dòng vào bảng.


#### Phần `site-info` và `open-alerts` của 5.7 (route `open-alerts` và bảng thuộc ENROLL-0060; spec này chỉ đọc)

| Method · path | Auth | Request → Response | Ghi chú |
|---|---|---|---|
| `GET /api/public/site-info` | không | `{contact:{email\|null, phone\|null, zalo\|null, reply_hours\|null}, enroll:{office_hours\|null, confirm_sla\|null, escalate_after\|null}, login_code_enabled:bool, enroll_prelearn_chapter1:bool}` | Đọc env `SITE_CONTACT_EMAIL`, `SITE_CONTACT_PHONE`, `SITE_CONTACT_ZALO`, `SITE_CONTACT_REPLY_HOURS`, `ENROLL_OFFICE_HOURS_TEXT`, `ENROLL_CONFIRM_SLA_TEXT`, `ENROLL_ESCALATE_AFTER_TEXT` (mặc định rỗng → `null`); hai cờ đọc `runtime_flags` (`default=False`). Cache trong tiến trình 60 s. Exempt. Không bao giờ trả số tài khoản ngân hàng. |

## UI and interaction

Ma trận trạng thái ở `ui-states.md`. Tờ thiết kế (thư mục `docs/proposals/commercialization-2026-11/thiet-ke/`): TrangChuCongKhai, DanhMucKhoa, DanhMucKhoaMoiMotKhoa, TrangKhoaHoc, PhapLy, TrangLoi, ThanhPhanKhungTrang. Mọi màn 1280px và 390px, sáng và tối, dùng được bằng bàn phím (Tab qua thanh trên, FAQ, chương). Câu chữ theo quy ước chung mục 3; khác biệt với tờ ghi trong PR.

## Work decomposition

Thứ tự gói mục 6: T02 → (T23, T03, T04, T05, T06 song song) → T15 → T16 → T21. Mỗi task một PR vào `staging`, lớp `feature`, `Spec: PUBLICSITE-0059`. Chi tiết từng task ở `tasks.md`. File dùng chung với gói khác (gói mục 8): `frontend/lib/course-access-labels.mjs` (G11-T29), `frontend/proxy.ts`, `app/robots.ts`, `docs/SITE_OVERVIEW.md`.

## Rollout and rollback

Không migration, không đổi dữ liệu. Trang thương mại sau cờ build `AVER_PUBLIC_COMMERCE` (tắt: `/pricing` vẫn `redirect('/')`, nút đăng ký ẩn — gói câu 1, 17); bật trên production là quyết định của anh Andy (câu 17). Lùi: tắt cờ hoặc revert PR; trang cũ trở lại. Staging: kịch bản ở `verification.md`, tài khoản thử, không tạo đơn.

## Verification strategy

- Mỗi PR: bộ lệnh quy ước chung mục 5.3, `npm --prefix frontend run test:react`, `node frontend/tooling/route-ownership-check.mjs`, và khi đổi route thì build + `--manifest`.
- Test React cho từng trạng thái ở `ui-states.md`; test node cho lớp dữ liệu (trường rỗng, `short_title`, nhãn từ `course-access-labels.mjs`); pytest cho `site-info` và `maintenance_mode` (API ghi trả 503 `maintenance`).
- `curl -sI` 404 thật cho slug lạ; sitemap/robots theo FR-019; ảnh 1280/390 sáng/tối.
