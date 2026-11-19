# Tasks

Mỗi task là một PR vào `staging`, nhánh `codex/<task>`, lớp `feature`, `Spec: UIBASE-0056`, chỉ sau khi spec này `approved`.
G03-T01 là chính PR spec này; G03-T03 **ĐÃ BỎ** (bộ icon chuyển sang G11-T32). Mã task giữ đúng mã nhiệm vụ của gói.

- [ ] T002 (G03-T02) Token v2, CSS nền, font. `owns: frontend/styles/av2/` `depends: spec approved`
- [ ] T004 (G03-T04) Trang `/ui-library` và test ảnh chụp. `owns: frontend/app/(ui-library)/, frontend/tests/visual/, frontend/playwright.visual.config.js` `depends: T002`
- [ ] T005 (G03-T05…T10) Component theo đợt (mỗi đợt một PR). `owns: frontend/components/ui/*.tsx, frontend/tests/react/ui/` `depends: T002, T004`
- [ ] T011 (G03-T11) Danh mục trang và test CI. `owns: frontend/lib/route-registry.mjs, frontend/tests/route-registry.test.mjs` `depends: spec approved`
- [ ] T018 (G03-T18) Chế độ tối cho cây v2 (2 PR). `owns: frontend/styles/av2/tokens.css (khối tối)` `depends: T002, T004` (trước T012…T016 để khung dựng ra đã đủ hai chế độ, theo chi tiết G03-T18)
- [ ] T012 (G03-T12) `AuthedShell design="v2"` và ranh giới điều hướng cứng. `owns: frontend/components/authed-shell.tsx (chỉ bọc điều kiện)` `depends: T002, T018`
- [ ] T013 (G03-T13) `PublicShell` và chuyển 4 trang pháp lý. `owns: frontend/components/ui/shell/public-*` `depends: T005, T012, G02-T13, T018`
- [ ] T014 (G03-T14) `LearnerShell` (máy tính, máy tính bảng, điện thoại). `owns: frontend/components/ui/shell/learner-*` `depends: T005, T012, T018`
- [ ] T015 (G03-T15) `FocusShell` (luyện tiếng Việt, thi tiếng Anh). `owns: frontend/components/ui/shell/focus-*` `depends: T005, T012, T018`
- [ ] T016 (G03-T16) `StaffShell` (admin, giáo viên). `owns: frontend/components/ui/shell/staff-*` `depends: T005, T012, T018`
- [ ] T017 (G03-T17) Đối chiếu cuối và cập nhật `verification.md`. `depends: T002–T018`

Chi tiết từng nhiệm vụ — mục 6 của gói, chép nguyên:

### G03-T01 — Soạn thư mục spec, mở PR spec, DỪNG chờ duyệt
- **Mục đích:** quy ước chung mục 4.6.
- **Đầu vào:** `specs/_templates/*`, `specs/README.md`, `specs/_meta/constitution.md`, file này.
- **Việc làm:** tạo `specs/<NNNN>-ui-foundation/` gồm `spec.md` (frontmatter `id: UIBASE-<NNNN>`, `status: draft`, `risk: medium`; Problem = mục 1; Scope/Non-goals = mục 3; Requirements = FR-001…015 đổi tên thành FR-001…015; Acceptance scenarios, Edge cases, Open questions = mục 4), `plan.md` (mục 5), `tasks.md` (T02–T17 với `depends:` và `owns:` theo mục 6), `verification.md` (bảng FR → bằng chứng dự kiến, kết quả `PENDING`), `ui-states.md` (bảng 5.4 và 5.5 cột "Trạng thái"). Thêm dòng vào bảng chỉ mục `specs/README.md`. Chạy `python backend/scripts/validate_specs.py`.
- **Đầu ra:** 1 PR chỉ có tài liệu spec. **Nghiệm thu:** `validate_specs.py` qua; `git diff --check` sạch. **Dừng** chờ anh duyệt; không viết mã.
- **Vướng mắc → cách gỡ:** `validate_specs.py` kiểm số thư mục khớp 4 số cuối của ID và trạng thái hợp lệ → dùng đúng `NNNN-kebab-case`; số trùng PR khác đang mở → đổi số, ghi trong PR.
- **Ước lượng:** 1 phiên · độ khó 2.

### G03-T02 — Token v2, CSS nền, font
- **Đầu vào:** mục 5.2, 5.3; `ThanhPhan.dc.html` (lớp `.pal-navy`, `<header>`), `quy-tac-thiet-ke-ban-in.md`.
- **Việc làm:** tạo `styles/av2/tokens.css`, `base.css`, `fonts.ts`, `components/ui/breakpoints.ts`; sửa `hex-budget.test.mjs`, `undefined-token-sentinel.test.mjs` theo 5.8. Chưa có trang dùng.
- **Đầu ra:** 1 PR. **Nghiệm thu:** bộ hợp đồng frontend qua (gồm 2 test đã sửa); `npm run build` qua; thử thêm một hex vào file CSS Module tạm → `hex-budget` đỏ (rồi bỏ).
- **Không làm:** không sửa `public/css/aver-design/tokens.css`, `app/layout.tsx`.
- **Vướng mắc → cách gỡ:** `fonts.ts` chưa được import thì Next không kiểm subset → T04 (trang thư viện) là nơi đầu tiên build thật; nếu subset/trục sai, sửa ở T04 và ghi lại.
- **Ước lượng:** 1 phiên · độ khó 2.

### G03-T03 — ĐÃ BỎ (bộ ~30 icon lấy từ `lucide`, nét 1,5)
- Lý do: thay bằng **G11-T32** (GOI-11 mục 5.7.3): bộ 94 icon tự vẽ nét 2 theo tờ ThanhPhanNenTang, cùng file `components/ui/icon/icon-set.ts`, cùng API `Icon`/`IconName`. G11-T32 chạy sau G03-T02; các nhiệm vụ T05–T16 của gói này cần icon thì chờ G11-T32 (hoặc dùng tên icon đã có trong danh sách 94 của tờ với một bản giữ chỗ, ghi trong PR).
- Ước lượng: 0 phiên.

### G03-T04 — Trang `/ui-library` và test ảnh chụp
- **Mục đích:** FR-013, FR-014. Làm sớm để mỗi PR component sau thêm mục + ảnh mốc.
- **Đầu vào:** `app/next-probe/page.tsx` (cổng chẩn đoán tĩnh), `lib/diagnostic-routes.mjs`, `.github/workflows/next-native-browser.yml` (bước "Build Next…", "Khởi động Next"), `playwright.config.js`.
- **Việc làm:**
  1. `app/(ui-library)/layout.tsx`: không dùng `AuthedShell` (trang không cần đăng nhập, chỉ bật khi chẩn đoán), import token/base, bọc `.av2-root` + font.
  2. `app/(ui-library)/ui-library/page.tsx`: `generateMetadata` và trang gọi `notFound()` khi `!diagnosticRoutesEnabled()`; nội dung: mỗi component một mục có `id`, hiện mọi trạng thái; tham số `?only=<id>` hiện riêng một mục (để chụp ảnh từng mục).
  3. `playwright.visual.config.js` (testDir `tests/visual`, `baseURL` lấy từ biến môi trường, viewport 1280×800 và project thứ hai 390×844, `expect.toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled' }`).
  4. `tests/visual/ui-library.spec.mjs`: với mỗi id trong danh sách xuất từ `components/ui/index.ts` (hoặc một mảng `UI_LIBRARY_SECTIONS`), mở `/ui-library?only=<id>`, chờ `document.fonts.ready`, chụp.
  5. Workflow: ở job "Next-native browser regression", bước build thêm `AVER_ENABLE_DIAGNOSTIC_ROUTES: '1'` vào `env`; thêm bước "Kiểm ảnh chụp thư viện component" chạy `npx playwright test -c playwright.visual.config.js`; tải thư mục kết quả lên artifact khi đỏ. Thêm glob đường dẫn (mục 5.8). **Không đổi tên job.**
  6. Cập nhật `app-route-inventory.mjs`, `route-ledger-matches-app.test.mjs` (`EXEMPT`), `route-auth-guard-inventory.test.mjs` (`DEBUG_GATED`).
- **Đầu ra:** 1 PR (trang mới chỉ có mục Token: bảng màu, cỡ chữ, dấu tiếng Việt "Ước lượng · Thử thách · Nguyễn Thị Hằng", IPA).
- **Nghiệm thu:** build không cờ → `curl -o /dev/null -w '%{http_code}' …/ui-library` = 404, và `/next-probe`, `/recorder-spike` cũng trả 404 trên bản build production (00 mục 2 điểm 22; thêm 18/11 theo rà soát); build có cờ → 200; job CI chạy bước ảnh chụp và xanh với ảnh mốc đầu tiên.
- **Vướng mắc → cách gỡ:**
  - Ảnh mốc phụ thuộc hệ điều hành → chỉ sinh trên Linux. Sinh bằng Docker cùng bản Playwright: `docker run --rm -v "$PWD":/w -w /w/frontend mcr.microsoft.com/playwright:v1.49.0-noble bash -lc "npm ci && AVER_ENABLE_DIAGNOSTIC_ROUTES=1 npm run build && (npx next start -p 3100 &) && sleep 8 && BASE_URL=http://localhost:3100 npx playwright test -c playwright.visual.config.js --update-snapshots"` (bản Playwright lấy đúng theo `package-lock.json`). Không commit ảnh sinh trên macOS.
  - `next build` gọi `prebuild` (`tooling/generate-runtime-config.mjs`) — không có `VERCEL_ENV` thì cấu hình rỗng, trang thư viện không cần Supabase nên không sao; khôi phục file sinh ra trước khi commit (quy tắc `frontend/AGENTS.md`).
  - Cổng chẩn đoán đánh giá lúc build: bật cờ ở bước build, không phải bước start.
  - Workflow sửa phải qua `next-native-browser-workflow.test.mjs` và `workflow-path-coverage.test.mjs`; chạy hai test này trước khi đẩy.
- **Ước lượng:** 2 phiên · độ khó 3.

### G03-T05 … T10 — Component theo đợt
Mỗi đợt một PR; mỗi component có: file `.tsx` + `.module.css` (chỉ `var(--av2-*)`, không hex), export trong `index.ts`, mục trong `/ui-library` đủ trạng thái ở bảng 5.4, ảnh mốc 1280/390, test React hành vi trong `tests/react/ui/` (role/nhãn, bàn phím, `aria-*`; không `querySelector('.class')`).

| Nhiệm vụ | Component (số ở bảng 5.4) | Tờ đối chiếu | Phiên · độ khó |
|---|---|---|---|
| G03-T05 | 1 Button, 2 IconButton, 4 TextField, 5 TextArea, 6 Select, 7 SearchField, 8 ChoiceGroup, 9 StatusBadge | ThanhPhan §1–3 | 2 · 2 |
| G03-T06 | 10 Notice, 11 Dialog (modal + drawer), 12 ConfirmDialog, 13 PageState, 14 MediaPlaceholder/PendingValue | ThanhPhan §4–5, DuLieu §6 | 1 · 3 |
| G03-T07 | 15 Tabs, 16 Breadcrumb/BackLink, 17 Pagination, 21 ProgressBar, 23 Stepper | ThanhPhan §6, DuLieu §5, §8 | 1 · 2 |
| G03-T08 | 18 DataTable, 19 StatCard, 20 Chart, 22 FileUpload, 24 Date/Time/DateRange | DuLieu §1–4, §7, §9 | 2 · 4 |
| G03-T09 | 25 BandScore (+CriteriaList, OverallBlock), 26 Timer, 27 QuestionPalette, 28 VocabEntry, 29 AnnotatedText, 30 Figure | HocTap §1, §4; HocTap2 §5–8 | 2 · 3 |
| G03-T10 | 31 AudioPlayer, 32 VideoFrame (giao diện) | HocTap §2–3 | 1 · 3 |

- **Nghiệm thu chung:** `test:react` qua; ảnh chụp xanh; `tsc` + build qua; kiểm bằng bàn phím trong `/ui-library` (Tab tới mọi điều khiển, focus ring thấy rõ, Esc đóng lớp phủ) ghi lại trong PR; đối chiếu cạnh nhau với tờ thiết kế ở 1280px và 390px, ghi chỗ lệch.
- **Không làm:** không dùng component mới ở trang cũ; không nối API thật.
- **Vướng mắc → cách gỡ:**
  - `<dialog>.showModal()` chưa có trong jsdom 26 → trong test React giả `HTMLDialogElement.prototype.showModal/close` ở `beforeAll` (ghi chú vì sao), còn hành vi thật kiểm bằng ảnh chụp/Playwright.
  - `DateField` gõ tay `dd/mm/yyyy`: tách hàm phân tích/định dạng vào `lib/av2-date.mjs` để test `node --test` (ngày 29/02, 31/04, năm 2 số).
  - `Chart` không dùng `chart.js` (chỉ 3 trang cũ dùng) để giữ SSR và ảnh chụp ổn định.
  - Số đều cột: `font-variant-numeric: tabular-nums` — kiểm Source Sans 3 có tính năng `tnum` trong `/ui-library` (nếu không, ghi lại; vẫn căn phải).
  - YouTube trong ảnh chụp: không nạp iframe thật trong `/ui-library` (dùng khung giữ chỗ `[TRÌNH PHÁT YOUTUBE NHÚNG]` như tờ) để ảnh không phụ thuộc mạng.

### G03-T11 — Danh mục trang và test CI
- **Đầu vào:** mục 5.6; `tooling/app-route-inventory.mjs`; `docs/ROUTE_LEDGER.md`; `S/reports/12-navigation-ia.md` mục 1–3 (đối chiếu với mã, mã thắng).
- **Việc làm:** tạo `lib/route-registry.mjs` (159 mục live + mục planned), `tests/route-registry.test.mjs` (6 kiểm ở 5.6). Ghi vào PR danh sách mồ côi hiện tại (báo cáo 12 thấy `/exam`, `/listening/lessons/[lessonId]`): khai `kind: 'deep-link-only'` kèm `note` thay vì để test đỏ; không xoá trang.
- **Đầu ra:** 1 PR (độc lập, làm song song T02–T10 được).
- **Nghiệm thu:** test mới qua; thử thêm `app/(tmp)/zz/page.tsx` → test đỏ nêu `/zz` (rồi bỏ).
- **Không làm:** không đổi `proxy.ts`, `robots.ts`, `ROUTE_LEDGER.md`.
- **Vướng mắc → cách gỡ:**
  - Thư mục bắt đầu bằng `_` và `@` bị `appPageRoute` bỏ qua; route động `[slug]` phải khớp trong `routeFor` bằng regex đoạn — viết test cho `/grammar/tenses/present-simple`.
  - 159 mục điền tay dễ sai `parent` → điền theo nhóm (admin theo `NAV_GROUPS` hiện tại của `aver-admin-chrome.js`; học viên theo `section` đích của gói G07 mục "Route mới"); mục chưa rõ để `parent: null, kind: 'deep-link-only'` và liệt kê trong PR cho G07/G09 xác nhận.
- **Ước lượng:** 2 phiên · độ khó 3.

### G03-T12 — `AuthedShell design="v2"` và ranh giới điều hướng cứng
- **Mục đích:** FR-002, 003, 015.
- **Đầu vào:** mục 5.7, 5.8; `components/authed-shell.tsx`; `components/chrome-navigation-bridge.tsx`; `tests/authed-shell.test.mjs`; `tests/csp-nonce-*.test.mjs`; `tests/react/admin-chrome-navigation.test.tsx`. Phụ thuộc T02, T11.
- **Việc làm:**
  1. Thêm prop `design` theo 5.7.1; bọc các `<link>`/`<Script>` cũ trong `design === 'v1' && …` mà không đổi thứ tự xuất hiện trong nguồn.
  2. Trước khi sửa, lưu HTML `<head>` của `/home`, `/profile`, `/admin` từ `next start` (`curl -s`); sau khi sửa so lại → giống hệt (bằng chứng FR-003 trong PR).
  3. Cầu điều hướng: dùng `isV2Route` theo 5.7.3; thêm ca test React.
  4. Tạo route group thử `app/(authed-v2-pilot)/v2-pilot/page.tsx` chỉ bật khi `diagnosticRoutesEnabled()` để kiểm kịch bản 1–2 bằng journey Playwright `tooling/verify-v2-boundary-flow.mjs` (hoặc gộp vào `tests/visual/` nếu đơn giản hơn), rồi gỡ route này ở T14 khi đã có khung học viên.
- **Đầu ra:** 1 PR.
- **Nghiệm thu:** `authed-shell.test.mjs`, `csp-nonce-*` qua; so `<head>` giống hệt; journey ranh giới qua.
- **Vướng mắc → cách gỡ:**
  - `csp-nonce-report-only.test.mjs` đòi tiền tố URL của mọi layout có `<AuthedShell` nằm trong `proxy.ts` matcher: route `/v2-pilot` mới sẽ làm test đỏ → hoặc thêm `v2-pilot` vào matcher và `nonceRouteAllowed` (rồi gỡ ở T14), hoặc đặt trang thử dưới tiền tố có sẵn trong matcher (ví dụ `/profile/v2-pilot`). Chọn cách thứ hai, ghi trong PR. Trang thử cũng phải vào `EXEMPT` của `route-ledger-matches-app.test.mjs`, `DEBUG_GATED` của `route-auth-guard-inventory.test.mjs`, `NON_PRODUCT_APP_PAGE_ROUTES` và danh mục (`kind: 'diagnostic'`); gỡ cả bốn chỗ khi gỡ trang.
  - `instant = false` bắt buộc trong layout có `AuthedShell`.
  - `BodyClassBridge` và script nội tuyến gắn class `<body>`: với `design='v2'` truyền `bodyClass="av2-body"`; kiểm trang v2 không có class `av-page` trên `<body>` sau khi tải.
  - Next 16 `<link rel="stylesheet">` trong JSX có thể được React đưa lên `<head>`; đó là lý do không dựa vào gỡ CSS khi điều hướng mềm mà ép tải lại ở ranh giới.
- **Ước lượng:** 2 phiên · độ khó 4.

### G03-T13 — `PublicShell` và chuyển 4 trang pháp lý (trang thật đầu tiên)
- **Đầu vào:** mục 5.5; `ThanhPhanKhungTrang.dc.html` §4, `ThanhPhanKhungTrang2.dc.html` §9, `PhapLy.dc.html`; 4 trang của G02-T13. Phụ thuộc T05–T07, T12, G02-T13 đã merge.
- **Việc làm:** dựng `PublicShell`, `PublicTopNav`, `PublicFooter`; tạo `app/(public-v2)/layout.tsx`; **di chuyển** `terms/privacy/contact/about` từ `app/(marketing)/` sang `app/(public-v2)/` (cùng URL); dựng lại nội dung theo `PhapLy.dc.html` bằng component mới (từ đây bốn trang pháp lý **ở `(public-v2)`**; G05-T06 và G05-T07 sửa nội dung và nối form liên hệ tại đó, không tạo route group thứ ba); `PublicTopNav` có slot `mobileExtraItem`; cập nhật `docs/ROUTE_LEDGER.md` (đổi `owner`), `route-registry` (`ui: 'v2'`). "Khoá học" và "Xem các khoá" trỏ `/courses` — route này chưa có (G05): tạm trỏ `/` và ghi `CẦN ANH ANDY QUYẾT` (mục 10, câu 5).
- **Đầu ra:** 1 PR. **Nghiệm thu:** kịch bản 1, 2 ở mục 4; ảnh chụp 4 trang 1280/390; `route-ledger-matches-app`, `route-auth-guard-inventory` qua.
- **Vướng mắc → cách gỡ:** hai route group không được cùng cung cấp một URL → xoá file cũ trong `(marketing)` cùng PR; `npm run build` báo trùng nếu sót.
- **Ước lượng:** 1 phiên · độ khó 2.

### G03-T14 — `LearnerShell` (máy tính, máy tính bảng, điện thoại)
- **Đầu vào:** `ThanhPhanKhungTrang.dc.html` §1–3, §5; `ThanhPhanKhungTrang2.dc.html` §9–10; logic đăng xuất của `aver-chrome.js`; `lib/auth/auth-provider` (lấy `user`, vai trò). Phụ thuộc T05–T07, T11, T12.
- **Việc làm:** dựng các phần ở bảng 5.5, gồm hai slot chuông/quá hạn (hiện đúng vị trí tờ khi được truyền, `/ui-library` dùng bản mẫu ba trạng thái của tờ), `QuickLookup` với dữ liệu mẫu, và biến thể tài khoản chưa có khoá (`trialLeft`); khung không gắn cổng kích hoạt (FR-016); mục đang ở = `sectionFor(usePathname())`; `canSwitchToAdmin` chỉ true khi hồ sơ `/auth/me` có vai trò admin; ẩn thanh dưới khi `visualViewport.height` giảm >25% (bàn phím ảo) và trong `FocusShell`. Hiện trong `/ui-library` với dữ liệu mẫu ba kích thước; thay trang thử `v2-pilot` của T12 bằng một trang thử dùng `LearnerShell`, rồi gỡ trang thử trước khi merge nếu G07 chưa cần.
- **Đầu ra:** 1 PR.
- **Nghiệm thu:** kịch bản 3, 4; test React: Esc đóng menu và trả focus; bàn phím đi hết 5 mục; tài khoản học viên không có "Đổi vai trò"; chỉ một trong ba (ô tra, ngăn thông báo, menu tài khoản) mở một lúc; phím `/` mở ô tra khi con trỏ không ở ô nhập; không truyền slot chuông thì không có khoảng trống; ảnh chụp 1280/900/390.
- **Không làm:** không gắn vào trang học viên thật.
- **Vướng mắc → cách gỡ:**
  - `usePathname` trong client component chạy được khi prerender; không dùng `useSearchParams` trong khung (cần `Suspense` với `cacheComponents`).
  - Lượt AI chưa có API (G04) → prop `credits={null}` hiện `PendingValue`; không gọi API giả.
  - Component chuông thật thuộc G11-T11: G03 chỉ cấp slot và bản mẫu trong `/ui-library`; không gọi `/api/notifications` từ khung.
  - Đăng xuất phải đi đúng đường cũ (dọn phiên, `aver:supabase-runtime-ready`) — đọc `tests/react/chrome-logout-session-purge.test.tsx` và viết ca tương tự cho khung mới.
- **Ước lượng:** 2 phiên · độ khó 4.

### G03-T15 — `FocusShell` (luyện tiếng Việt, thi tiếng Anh)
- **Đầu vào:** `ThanhPhanKhungTrang.dc.html` §6; `PhongThi.dc.html` (thanh trên phòng thi); `lib/navigation-guard.ts`. Phụ thuộc T06, T09.
- **Việc làm:** dựng `FocusBar`, `LeaveConfirm`; `hasUnsavedWork()` false → thoát ngay; true → hỏi lại (luyện: "Ở lại ghi tiếp" chính, "Bỏ đoạn ghi và thoát" nguy hiểm; thi: "Continue test" / "Leave test" kèm câu "The timer keeps running while you are away." — không còn "Save and exit"; nút "Abandon test" là prop tuỳ chọn do G08 truyền cho đề tự chọn); đăng ký `registerNavigationGuard` để cầu điều hướng cũng hỏi. Không in email/tên tài khoản.
- **Đầu ra:** 1 PR. **Nghiệm thu:** test React cả hai `mode` (không chữ tiếng Việt trong `mode='exam'`, kiểm bằng regex ký tự có dấu trên `textContent`); ảnh chụp.
- **Ước lượng:** 1 phiên · độ khó 3.

### G03-T16 — `StaffShell` (admin, giáo viên)
- **Đầu vào:** `ThanhPhanKhungTrang2.dc.html` §7–8; `aver-admin-chrome.js` (thu sidebar lưu `localStorage`, ngăn kéo); `public/js/runtime-config.js`. Phụ thuộc T05–T07.
- **Việc làm:** dựng phần ở bảng 5.5 với `nav` truyền vào; dữ liệu mẫu 8 nhóm trong `/ui-library` theo quy ước chung mục 2.8 (Tổng quan · Học viên và quyền truy cập · Khoá học và bán hàng · Chấm bài · Nội dung · Thi thử · Báo cáo · Hệ thống); giáo viên 5 mục phẳng theo G09-T20 (trang đầu "Việc của tôi"; danh sách mục lấy từ `nav` G09 truyền, `/ui-library` dùng dữ liệu mẫu theo `thiet-ke/CHUAN-ADMIN.md` mục A); `ThemeMenu` ở thanh trên; quy tắc 1024px theo FR-018 (sidebar icon, bảng cuộn ngang giữ cột đầu — phần bảng nằm ở `DataTable` của T08: thêm prop `stickyFirstColumn`). `QuickSearch` nhận hàm tìm; ⌘K/Ctrl+K mở, ↑↓ Enter Esc.
- **Đầu ra:** 1 PR. **Nghiệm thu:** test React: nhóm chứa trang hiện tại mở; nhãn môi trường hiện cả khi thu; Esc đóng tìm nhanh; ảnh chụp 1280/1100/1024/390.
- **Không làm:** không thay `<aver-admin-chrome>` ở trang admin nào (G09-T08); không dựng ba trang của tờ `Admin1024.dc.html` (G09-T17, T18, T29 — tờ đã có trong `thiet-ke/`).
- **Ước lượng:** 2 phiên · độ khó 3.

### G03-T18 — Chế độ tối cho cây v2
- **Mục đích:** giao diện mới có sáng và tối, không làm mất tính năng đang có.
- **Phụ thuộc:** sau G03-T02 (token) và G03-T04 (`/ui-library`, test ảnh chụp); trước G03-T12…T16 (các khung) để khung dựng ra đã đủ hai chế độ.
- **Đầu vào:** mục 5.9; ba tờ `CheDoToi*`; `frontend/public/css/aver-design/tokens.css` dòng 200–370; `frontend/public/js/theme-toggle.js`; `frontend/components/theme-toggle-button.tsx`; `frontend/components/authed-shell.tsx` (đoạn chống nháy).
- **Việc làm:** (1) thêm khối giá trị tối và khối `prefers-color-scheme` vào file token v2; (2) thêm các token mới ở bảng, thay mọi chỗ component v2 đang dùng màu cứng cho tô sáng, nền cảnh báo, chữ trên nút; (3) viết `ThemeMenu` và test đơn vị cho ba lựa chọn, sự kiện `storage`, thay đổi của thiết bị; (4) trang `/ui-library` thêm công tắc xem cả hai chế độ, test ảnh chụp chạy ở cả sáng và tối; (5) test tương phản FR-022 và test quét FR-023; (6) lớp bọc "luôn sáng" FR-024 kèm ví dụ trên `/ui-library`.
- **Đầu ra:** 2 PR (token + test; `ThemeMenu` + `/ui-library`).
- **Nghiệm thu:** `npm test` trong `frontend` qua, gồm test tương phản và test quét; mở `/ui-library` ở sáng, tối, và khi xoá `av-theme` với thiết bị đặt tối: không nháy sáng lúc tải lại; đổi ở tab này thì tab kia đổi theo; in thử một trang ra PDF vẫn nền sáng.
- **Không làm:** không sửa `tokens.css` cũ; không viết kiểu tối riêng cho từng trang (chỉ qua token); không lưu chế độ theo tài khoản; không đụng `ielts-exam-theme`.
- **Vướng mắc → cách gỡ:** (a) ảnh chụp tăng gấp đôi làm CI chậm → chỉ chụp tối cho trang `/ui-library` và mỗi khung một trang đại diện; (b) component bên thứ ba hoặc SVG ghi màu cứng → đổi sang `currentColor` hoặc token, không thêm ngoại lệ vào test quét; (c) trang cũ nhúng trong khung mới lệch tông (bộ tối cũ là navy lạnh, bộ mới là mực ấm) → chấp nhận trong giai đoạn chuyển tiếp, ghi vào `verification.md`, không sửa bộ cũ; (d) test tương phản rớt ở một cặp → sửa giá trị token rồi báo lại trong PR, không hạ ngưỡng.
- **Ước lượng:** 3 phiên · độ khó 3.

### G03-T17 — Đối chiếu cuối và cập nhật `verification.md`
- **Việc làm:** chạy toàn bộ lệnh ở quy ước mục 5.3; điền bằng chứng từng FR vào `specs/<NNNN>-ui-foundation/verification.md`; liệt kê chỗ lệch với tờ thiết kế còn mở; chuyển spec sang `verified` chỉ khi mọi FR có bằng chứng.
- **Đầu ra:** 1 PR tài liệu. **Ước lượng:** 1 phiên · độ khó 1.
