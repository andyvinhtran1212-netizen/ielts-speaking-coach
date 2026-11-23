# Tasks

Mỗi task một PR vào `staging`, sau khi spec `approved`, lớp `feature`, `Spec: PUBLICSITE-0059`. G05-T01 là chính PR spec này (chung với ENROLL-0060). Mã task giữ mã nhiệm vụ của gói; nội dung chép nguyên văn từ gói mục 6.

- [ ] T02 (G05-T02) Lớp dữ liệu thương mại phía frontend và dữ liệu giả. `depends: spec approved`
- [ ] T23 (G05-T23) Khối liên hệ chung và `GET /api/public/site-info`. `depends: T02`
- [ ] T03 (G05-T03) Trang chủ công khai mới. `depends: T02`
- [ ] T04 (G05-T04) Danh mục `/courses`. `depends: T02`
- [ ] T05 (G05-T05) Trang một khoá `/courses/[slug]`. `depends: T02`
- [ ] T06 (G05-T06) `/terms`, `/privacy`, `/about`. `depends: T02`
- [ ] T15 (G05-T15) Bộ trang lỗi. `depends: T03..T06`
- [ ] T16 (G05-T16) SEO và `/pricing`. `depends: T04, T05`
- [ ] T21 (G05-T21) Lối vào chấm thử trên trang công khai. `depends: T03; TRIALCAP-0080 public-config`

## Chi tiết từ gói

#### G05-T02 — Lớp dữ liệu thương mại phía frontend và dữ liệu giả
- Mục đích: các trang G05 làm được trước khi G04 xong, và đổi sang API thật bằng một chỗ.
- Đầu vào: mục 5.2, 5.3; `frontend/lib/grammar-api.ts`, `frontend/lib/backend.ts`, `frontend/lib/browser-api.ts`; GOI-11 mục 5.6.
- Việc làm: tạo `frontend/lib/commerce-types.ts`, `commerce-api.ts`, `commerce-model.mjs`, `frontend/tests/fixtures/commerce/`; tạo `frontend/lib/course-access-labels.mjs` nếu chưa có (đúng API của GOI-11 mục 5.6); test hành vi `frontend/tests/commerce-model.test.mjs`: `courseRowState` cho mọi cặp `status` × `viewer.state`, `orderScreen` mọi trạng thái (tên của G04), `orderBlocks` cho `needs_info` × `info_kind` và cho đơn `confirmed` có `overpaid_vnd`, `formatVnd(null) === null`, `catalogCounts` cho bộ một khoá mở.
- Đầu ra: 1 PR.
- Nghiệm thu: lệnh test hợp đồng frontend (mục 8) qua; `npx tsc --noEmit` qua; `grep -n "awaiting_confirmation\|needs_action\|hold_until" frontend/lib/commerce-*` rỗng.
- Không làm: không gọi API G04 chưa tồn tại từ trang thật; không đặt fixture trong `frontend/public/`; không cache phản hồi có `viewer`.
- Vướng mắc → cách gỡ: `next build` chạy không có backend (job build chung) → hàm server bọc lỗi như `app/sitemap.ts` và trang dùng `connection()`/Suspense như `app/(public-content)/vocabulary/page.tsx`. G11-T29 đã tạo `course-access-labels.mjs` → dùng lại, không tạo file thứ hai.
- Ước lượng: 1 phiên · 2.

#### G05-T23 — (mới) Khối liên hệ chung và cấu hình công khai `site-info`
- Mục đích: FR-026; nguồn cấu hình cho T12, T19.
- Đầu vào: `PhapLy.dc.html` màn 2 và ghi chú; `TroGiupLanDau.dc.html` màn 1 khối "Liên hệ trực tiếp"; `ThanhToan.dc.html` màn 3, 6; mục 5.7.
- Việc làm: `GET /api/public/site-info` trong `backend/routers/site_info.py` + biến `Settings` + exempt + test `backend/tests/test_site_info.py` (biến rỗng → `null`; không lộ biến ngân hàng; cờ đọc lỗi → `false`); `frontend/lib/site-info.ts` (đọc một lần mỗi trang, lỗi → mọi trường `null`/`false`); component `frontend/components/ui/contact-channels.tsx` (hoặc thư mục G03 chỉ định) theo FR-026; thêm vào trang mẫu `/ui-library` của G03 nếu có.
- Đầu ra: 1 PR.
- Nghiệm thu: test React: đủ bốn giá trị → bốn dòng theo thứ tự Email · Điện thoại · Zalo · Giờ trả lời; thiếu Zalo → ba dòng; cả bốn rỗng → liên kết `/contact`; không có chuỗi "XXX" trong DOM.
- Không làm: không gõ email, số điện thoại, Zalo thật vào mã hay fixture (fixture dùng `example.com` và số giả có chú thích); không đặt cấu hình này ở biến `NEXT_PUBLIC_*` (đổi giá trị phải build lại).
- Vướng mắc → cách gỡ: G07 dựng `/help` trước và tự gõ khối liên hệ → báo G07 dùng component này (một nguồn, theo ghi chú tờ PhapLy). Trang AdminCaiDat về sau có thẻ quản lý các giá trị này → đổi nguồn của `site-info` từ env sang bảng cài đặt, giữ nguyên hình dạng phản hồi.
- Ước lượng: 1 phiên · 2.

#### G05-T03 — Trang chủ công khai mới
- Mục đích: FR-001..004.
- Đầu vào: `thiet-ke/TrangChuCongKhai.dc.html` (màn 1–3, ghi chú), `PublicShell` của G03, `frontend/app/(marketing)/layout.tsx`, các test ở mục 2.
- Việc làm: 1) viết lại `frontend/app/(marketing)/page.tsx` (Server Component) dùng `PublicShell`; 2) thay `landing-behavior.tsx` bằng phần client nhỏ cho FAQ và đổi thanh trên khi có phiên (đọc phiên qua `AuthProvider` không cổng); 3) giữ nguyên `OAUTH_RECOVERY` và `ANTI_FLASH` trong layout; đổi danh sách CSS của layout sang CSS của G03; 4) mục lục sáu khoá + bảng học phí đọc `GET /api/courses` (ẩn khi cờ `AVER_PUBLIC_COMMERCE` tắt); 5) phần mở đầu để sẵn chỗ cho nút phụ: mặc định là "Đọc thử Thư viện miễn phí" (trạng thái (c) của FR-021) — T21 nối cấu hình chấm thử; 6) metadata giữ `canonical: '/'`.
- Đầu ra: 1 PR.
- Nghiệm thu: 1280px và 390px khớp màn 1, 2 ở cả sáng và tối; màn 3 khi đăng nhập; `curl -s localhost:3000/ | grep -c 'aria-expanded'` ≥ số câu FAQ; câu trả lời FAQ có trong HTML server; `grep -niE "\b(mua|bán|giá|đơn hàng|thầy|giảng viên)\b"` trên file mới rỗng; số bài mẫu ở mục Thư viện không gõ cứng (không có chuỗi `549` trong file; lấy từ API G06 hoặc ẩn con số khi chưa có).
- Không làm: không đổi `/login`; không bỏ `OAUTH_RECOVERY`; không chèn ảnh chưa có giấy phép (Hình 1 là sơ đồ câu chữ SVG tự vẽ theo tờ — 00 mục 2 điểm 22: minh hoạ của web là sơ đồ câu chữ, không dùng tranh khắc); không tự chèn logo (dùng `PublicShell`); không vẽ mục 4 "Học viên nói gì" của tờ và không thêm mục đó vào mục lục "Trên trang này" hay chân trang (chưa có nguồn dữ liệu, mục 10 câu 18) — các mục sau đánh số lại liền nhau.
- Vướng mắc → cách gỡ: (a) `tests/landing-links-u09.test.mjs` chỉ cho link chân trang `/`, `/login`, `/grammar` → sửa assert thành danh sách chân trang công khai mới (`/about`, `/courses`, `/library`, `/terms`, `/privacy`, `/contact`; khi G13-A10 merge thì thêm `/hoc-vien-noi-gi` "Học viên nói gì" (sửa 18/11 theo GOI-13)), vẫn cấm `href="#"`; ghi lý do trong PR. (b) `tests/pilot-landing.test.mjs` đòi các CSS cũ trong layout → sửa danh sách theo layout mới, giữ assert `access_token`, `av-theme`, Server Component. (c) `tests/react/landing-stats-fallback.test.tsx` kiểm bộ đếm `/api/public-stats` — tờ không có bộ đếm thì xoá test cùng phần mã đó, ghi "hành vi bỏ có chủ ý". (d) Số test vỡ > 30 thì dừng, báo danh sách.
- Ước lượng: 2 phiên · 3.

#### G05-T04 — Danh mục khoá `/courses`
- Mục đích: FR-005, 006, 023.
- Đầu vào: `thiet-ke/DanhMucKhoa.dc.html` màn 1–4, `thiet-ke/DanhMucKhoaMoiMotKhoa.dc.html`; T02.
- Việc làm: tạo `frontend/app/(public-commerce)/layout.tsx` (AuthProvider không cổng; `PublicShell` hoặc `LearnerShell` theo phiên) và `courses/page.tsx`; dòng đếm "N khoá đang mở đăng ký · M khoá sắp mở"; bảng so sánh với cột khoá sắp mở; mục trọn bộ ẩn theo `COURSE_BUNDLE_MIN_OPEN` (hằng trong `commerce-model.mjs`, mặc định 2); khối "Có mã kích hoạt từ lớp?" dẫn `/activate` (chưa đăng nhập → `/login?next=/activate`); gợi ý chọn khoá là component client không gọi API; chỗ đặt liên kết "Báo cho tôi khi mở" ở dòng sắp mở là một slot — T22 gắn chức năng; thêm dòng `docs/SITE_OVERVIEW.md`.
- Đầu ra: 1 PR.
- Nghiệm thu: test React với fixture cho bốn trạng thái, cho bộ một khoá mở (đủ sáu dòng, năm dòng không có học phí, không có mục trọn bộ), đã đăng nhập (một nút chính "Vào học" duy nhất — `getAllByRole('link',{name:'Vào học'})` = 1), khoá hết hạn có nút đúng chữ "Đăng ký lại"; `frontend/tests/site-overview-coverage.test.mjs` qua.
- Không làm: không hiện Course 1–5 (lọc ở API G04; frontend không tự lọc theo tên); không gõ tên khoá trong mã.
- Vướng mắc → cách gỡ: thứ tự của API khác thứ tự cố định trên tờ → dùng thứ tự của API (dữ liệu thắng) và ghi `CẦN ANH ANDY QUYẾT`; cờ `AVER_PUBLIC_COMMERCE` tắt → `notFound()` ở đầu `page.tsx` để build vẫn qua.
- Ước lượng: 1 phiên · 3.

#### G05-T05 — Trang một khoá `/courses/[slug]`
- Mục đích: FR-007..009, 024, 025, 028.
- Đầu vào: `thiet-ke/TrangKhoaHoc.dc.html` màn 1–3 và ghi chú.
- Việc làm: `frontend/app/(public-commerce)/courses/[slug]/page.tsx` + `generateMetadata` (title "<title của khoá> — Aver Learning", description từ `summary`); khối đăng ký theo `courseRowState`, nhãn nút từ `accessActionLabel`; "Đăng ký khoá này": chưa đăng nhập → `/login?next=/courses/<slug>/enroll`, đã đăng nhập → `/courses/<slug>/enroll`; `viewer.state='open_order'` → nút "Tiếp tục thanh toán" tới `/enroll/<open_order_code>`; khối "Đăng ký khoá này bạn có gì" (FR-024); mục "Người soạn và giảng" và mảnh phiếu nhận xét (FR-025); chương gập/mở; thanh dính đáy dưới 1024px dùng `short_title`; hàm thuần `carryOverSentence({credit_carry_percent, credit_carry_valid_days})` trong `commerce-model.mjs` dựng câu về lượt chưa dùng theo FR-024 (dùng lại ở T12); màn khoá hết hạn có câu `content_visible_until`; để sẵn một slot rỗng cho khối "Học viên khoá này nói gì" (không vẽ gì, mục 10 câu 18).
- Đầu ra: 1 PR.
- Nghiệm thu: slug lạ → HTTP 404 (`curl -o /dev/null -w '%{http_code}' localhost:3000/courses/khong-co` = 404); test React bốn trạng thái khối đăng ký + `open_order`; fixture thiếu `author`, `chapters`, `credit_carry_percent` → các khối đó không có trong DOM, không có chữ "XXX"; test `carryOverSentence`: `(100, 60)` → câu có "toàn bộ lượt chưa dùng" và "60 ngày"; `(100, null)` → không có vế ngày; `(null, 60)` và `(0, 60)` → chỉ còn câu "hết hiệu lực khi khoá hết hạn"; `(50, 30)` → "50%" và "30 ngày" lấy từ dữ liệu; `grep -nE "50%|toàn bộ|60 ngày|2 tháng|45 ngày" "frontend/app/(public-commerce)"` chỉ ra kết quả trong file test/fixture, không trong mã trang; khoá hết hạn có `content_visible_until` → có câu kèm ngày, `null` → không có câu; bàn phím mở/gập chương.
- Không làm: không mở bài khoá (G07); bài "Học thử" chỉ là liên kết `preview_href` của API; không thêm `opengraph-image.tsx` (G11-T31).
- Vướng mắc → cách gỡ: với `cacheComponents: true`, `notFound()` sau khi shell `loading.tsx` đã stream chỉ ra soft 404 (bài học ở `proxy.ts` phần Grammar) → **không** tạo `loading.tsx` cho route này; đọc khoá trước khi render và gọi `notFound()` ở đầu. `credit_carry_percent` hoặc `credit_carry_valid_days` chưa có trong API → câu rút gọn theo FR-024, không gõ "toàn bộ", "100%" hay "60 ngày" vào mã. Tờ TrangKhoaHoc còn ghi "50% số lượt đó được chuyển sang" ở ba chỗ (khối lượt, khối đăng ký, màn hết hạn) → theo FR-024, không theo tờ.
- Ước lượng: 2 phiên · 3.

#### G05-T06 — Pháp lý: `/terms`, `/privacy`, `/about`
- Mục đích: FR-010, 011.
- Đầu vào: `thiet-ke/PhapLy.dc.html` màn 1, 3, 4; mục 5.4; kết quả G02-T13 và G03-T13 (`ls "frontend/app/(public-v2)" "frontend/app/(marketing)"`).
- Việc làm: 1) kiểm bốn trang đang ở đâu: đã ở `app/(public-v2)/` (G03-T13 xong) thì sửa tại đó; còn ở `app/(marketing)/` thì dừng nhiệm vụ này chờ G03-T13 (không tạo route group thứ ba cho cùng URL); 2) `frontend/lib/legal-content.ts` (đọc file, sinh mục lục từ `h2`); 3) thay nội dung gõ tay của ba trang bằng nội dung nạp từ `frontend/content/legal/*.md` `status: placeholder`; 4) component mục lục dính có theo dõi mục đang đọc (`IntersectionObserver`); 5) đặt khối liên hệ chung (T23) cuối `/terms`, `/privacy`.
- Đầu ra: 1 PR.
- Nghiệm thu: test hợp đồng: thêm một `## Điều` vào file thử → mục lục có thêm mục, neo `#dieu-N` đúng; trang placeholder có `noindex` và dải "Bản nháp"; 390px mục lục mặc định đóng.
- Không làm: không viết nội dung pháp lý; không chép mẫu điều khoản của trang khác.
- Vướng mắc → cách gỡ: `pageExtensions: ['tsx','ts']` → `.md` không thành route, an toàn; Vercel build ở `frontend/` → dùng `path.join(process.cwd(), 'content/legal', …)` và kiểm bằng `npm run build`.
- Ước lượng: 1 phiên · 2.

#### G05-T15 — Bộ trang lỗi
- Mục đích: FR-012..018.
- Đầu vào: `thiet-ke/TrangLoi.dc.html` màn 1–9; `app/not-found.tsx`, `not-found-card.tsx`, `app/error.tsx`, `global-error.tsx`; `services/runtime_flags.py`.
- Việc làm: 1) 404: giữ `app/not-found.tsx` tĩnh, thêm phần client nhỏ đọc phiên để đổi sang thanh học viên sau khi tải — HTML server luôn là bản công khai; 2) `frontend/components/ui/access-denied.tsx` (hoặc tên G03 đặt) nhận `{reason:'signed_out'|'no_entitlement'|'expired', courseKind, courseSlug, next}`; ca `expired` + khoá online dùng `accessActionLabel('expired')`; 3) `app/error.tsx`: thêm "Sao chép mã"; lỗi API hiện `X-Request-ID` (kiểm transport `browser-api.ts` đã giữ header chưa, chưa thì thêm); 4) bảo trì: cờ `maintenance_mode` (mặc định tắt, `on_error=False`), backend trả 503 `code:'maintenance'` cho route ghi học viên qua một dependency, frontend hiện màn 6; 5) `OfflineBanner` dùng chung; 6) `SessionExpiredDialog` gọi hàm lưu nháp do trang truyền vào; 401 có `error_code='session_displaced'` **không** mở hộp này mà đi đường của T20; 7) `PARENT_ROUTES` + dải thông báo.
- Đầu ra: 1 PR.
- Nghiệm thu: `curl -w '%{http_code}' localhost:3000/khong-co-trang` = 404 cả khi đã đăng nhập; `tests/grammar-article-not-found.test.mjs`, `tests/csp-nonce-enforce.test.mjs`, `tests/post-migration-security-headers.test.mjs`, `tests/section-index-redirects.test.mjs` vẫn qua; test React ba ca 403; `window.dispatchEvent(new Event('offline'))` → dải hiện.
- Không làm: không biến 404 gốc thành trang động (phá cách CSP/nonce coi URL không có route là 404 tĩnh); không hiện mã HTTP.
- Vướng mắc → cách gỡ: (a) 404 gốc tải trước khi biết phiên → chấp nhận khung công khai làm mặc định, chỉ đổi phần phải thanh trên và lối "Về Hôm nay" sau khi biết phiên. (b) Dependency bảo trì chặn nhầm route đọc/công khai → chỉ gắn vào router ghi học viên, test liệt kê route bị chặn; hai route `/auth/login-code/*` không bị chặn.
- Ước lượng: 2 phiên · 3.

#### G05-T16 — SEO và `/pricing`
- Mục đích: FR-019, 020.
- Đầu vào: `app/sitemap.ts`, `lib/public-sitemap-model.mjs`, `app/robots.ts`, `tests/next-metadata.test.mjs`, các chỗ ghim `/pricing` ở mục 2.
- Việc làm: thêm `/courses`, các `/courses/<slug>` công khai (đọc `GET /api/courses`, lỗi thì bỏ qua như Grammar), `/terms`, `/privacy`, `/contact`, `/about` vào sitemap (trang placeholder không vào); `robots.ts` thêm allow `/courses`, `/terms`, `/privacy`, `/contact`, `/about`, thêm vào `PRIVATE_PREFIXES`: `/enroll`, `/account`, `/activate`; `/pricing`: chuyển về `/courses` khi cờ `AVER_PUBLIC_COMMERCE='1'` (giữ `redirect('/')` khi tắt), sửa `tests/pricing-next-behavior.test.mjs`, `tooling/verify-pricing-redirect-flow.mjs`, dòng `docs/ROUTE_LEDGER.md`.
- Đầu ra: 1 PR.
- Nghiệm thu: `curl localhost:3000/sitemap.xml` có các URL trên; `curl -I localhost:3000/pricing` → `Location: /courses` (cờ bật); `node tooling/verify-pricing-redirect-flow.mjs http://localhost:3000` qua; HTML `/courses/<slug>` có `og:image` tuyệt đối (ảnh kế thừa của GOI-11 phần G); `curl localhost:3000/robots.txt` có `Disallow: /courses/*/enroll`, `/enroll`, `/account`, `/activate` và không có dòng nào chặn `/courses`.
- Không làm: không thêm tiền tố `'/course'` hay `'/courses'` vào `PRIVATE_PREFIXES`; không đưa trang placeholder pháp lý vào sitemap; không đổi `next.config.ts` ngoài những gì `/pricing` cần.
- Vướng mắc → cách gỡ: `/courses/<slug>/enroll` nằm dưới `/courses` được allow → thêm `Disallow: /courses/*/enroll` và `noindex` ở trang; kiểm `tests/next-metadata.test.mjs`. G07 thêm tiền tố riêng tư cho Lộ trình phải là `'/course/'` (có gạch cuối), nếu không sẽ chặn `/courses` — thấy `'/course'` trong `PRIVATE_PREFIXES` thì báo G07.
- Ước lượng: 1 phiên · 2.

#### G05-T21 — (mới) Lối vào chấm thử miễn phí trên trang công khai
- Mục đích: FR-021. Trần, API và các màn `/trial/*` thuộc 0047 và GOI-11 phần B.
- Đầu vào: `thiet-ke/ChamThuMienPhi.dc.html` phần đầu, màn 1 và ghi chú; `TrangChuCongKhai.dc.html` màn 1, 2; GOI-11 mục 5.2.3, G11-T17; T03.
- Việc làm: 1) `frontend/lib/trial-entry-model.mjs`: `trialEntryView(publicConfig, viewerStatus)` → `'open'|'site_exhausted'|'paused'|'hidden'` theo năm ca (a)–(e) của FR-021; 2) component client `TrialEntry` ở phần mở đầu trang chủ và mục "Chấm thử" trong menu điện thoại của `PublicTopNav` (qua prop/slot của G03, không sửa component G03); HTML server luôn là ca (c) rồi client nâng lên, để không nháy nút sai khi cấu hình chưa đọc xong; 3) câu ở mục 3 trang chủ ("tài khoản miễn phí được chấm thử…") lấy số từ `public-config`, ẩn câu khi không đọc được; 4) đích `/trial/writing`.
- Đầu ra: 1 PR.
- Nghiệm thu: test `frontend/tests/trial-entry-model.test.mjs` đủ năm ca và ca API lỗi; test React: cấu hình mở → nút "Chấm thử một bài miễn phí"; tạm dừng → nút "Đọc thử Thư viện miễn phí", menu không có "Chấm thử"; toàn web hết → nút còn và có dòng "Hôm nay đã hết lượt chấm thử · mở lại 00:00"; không có chuỗi số lượt nào gõ cứng trong file.
- Không làm: không dựng màn chấm thử; không gọi `/api/trial/status` khi chưa có phiên; không hiện lý do cho ca (e).
- Vướng mắc → cách gỡ: `GET /api/trial/public-config` chưa có (G11-T15 chưa merge) → lời gọi lỗi rơi vào ca (d), trang giữ lối Thư viện; PR ghi "chưa nối". G11-T17 cũng ghi "lối vào ở trang chủ" → lối vào trên trang chủ và menu công khai là của nhiệm vụ này; G11-T17 chỉ còn các màn `/trial/*`; khối "Chấm thử miễn phí đề này" ở trang bài mẫu và trang đề Speaking do G06-T10, G06-T13 dựng bằng lối vào chấm thử của nhiệm vụ này (`trial-entry-model.mjs`) với đề điền sẵn (sửa 18/11 theo rà soát).
- Ước lượng: 1 phiên · 2.
