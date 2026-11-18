# GÓI 03 — Nền giao diện "Bản in"

**Khớp chéo ngày 18/11/2026:** `LearnerShell` có slot chuông và thẻ "N quá hạn" (component của GOI-11 phần A), nút tra nhanh, chỗ "Chấm thử hôm nay còn N bài" thay lượt AI cho tài khoản chưa có khoá, và chạy được không có cổng kích hoạt; `StaffTopBar` nhãn "Giáo viên", có điều khiển Sáng · Tối · Theo thiết bị; khung giáo viên 5 mục (theo G09); `PublicTopNav` có slot "Chấm thử" ở menu điện thoại (G05-T21 cấp nội dung); bốn trang pháp lý nằm ở `(public-v2)` (G05-T06, T07 sửa nội dung tại đó); quy tắc admin ở 1024px (sidebar thu thành icon, bảng cuộn ngang giữ cột đầu) — tờ `Admin1024.dc.html` đang được vẽ, sẽ có; thoát bài thi không còn "Save and exit"; G03-T03 ĐÃ BỎ (thay bằng G11-T32: bộ 94 icon nét 2 của tờ ThanhPhanNenTang); bỏ ghi chú "GOI-11 thắng" vì nội dung đã vào thân. Ước lượng: 17 nhiệm vụ còn hiệu lực, 18 PR, khoảng 27 phiên.

## 1. Tóm tắt

- **Mục tiêu.** Dựng nền để các gói sau làm giao diện mới mà không phải sửa từng màn: bộ token v2, hai font Source Serif 4 + Source Sans 3 có tiếng Việt, một bộ icon, khoảng 25 component React dùng chung trong `frontend/components/ui/`, bốn khung trang (công khai · học viên 5 mục có bản máy tính bảng/điện thoại · thanh tập trung VN/EN · admin/giáo viên) thay cho hai thanh điều hướng JS cũ, một danh mục trang duy nhất có test CI, một trang thư viện component nội bộ để kiểm bằng mắt và test ảnh chụp cho component. Người dùng cuối chưa thấy thay đổi nào ở trang cũ; trang thật đầu tiên dùng nền mới là bốn trang pháp lý (G02-T13) để kiểm cơ chế.
- **Lớp thay đổi:** `feature` (không thuộc nhóm `high-risk`: không đổi chấm điểm, lưu kết quả, RLS, mã kích hoạt). Mã spec **UIBASE-0056**, rủi ro `medium` (số đã cấp ở `01-KE-HOACH-TONG.md` mục 6; anh Andy là người duy nhất vận hành repo, bảng đó là sổ cấp số; người thực thi kiểm số chưa bị dùng rồi ghi vào sổ đăng ký trong repo).
- **Phụ thuộc.**
  - 6 tờ Thành phần (`ThanhPhan`, `ThanhPhanDuLieu`, `ThanhPhanHocTap`, `ThanhPhanHocTap2`, `ThanhPhanKhungTrang`, `ThanhPhanKhungTrang2`) đã được anh Andy duyệt ngày 17/11 (00 mục 6, sửa 18/11 theo rà soát). Theo `thiet-ke/quy-tac-thiet-ke-ban-in.md` mục 2, design system rút ra từ tờ đã duyệt. T01 (spec) làm được ngay; mã chờ duyệt spec.
  - Song song: G01, G02, G04. G02-T13 phải merge trước G03-T13.
  - Sau: G05, G06, G07, G08, G09 dùng component và khung của gói này. G09 cung cấp dữ liệu sidebar admin 8 nhóm và khung giáo viên 5 mục (G09 là chuẩn điều hướng admin, không theo spec 0049 — 00 mục 2 điểm 20); G04 cung cấp API số lượt AI (một kho chung); GOI-11 cung cấp component chuông, thẻ quá hạn (G11-T11) và bộ 94 icon (G11-T32 thay G03-T03); G05-T21 cấp nội dung mục "Chấm thử" của menu công khai; G05-T20 cấp màn "một phiên" 8a–8c.
- **Ước lượng (giả định).** 17 nhiệm vụ còn hiệu lực (T01, T02, T04–T18; T03 ĐÃ BỎ), 18 PR (T18 hai PR), khoảng 27 phiên agent — cộng từ dòng "Ước lượng" của từng nhiệm vụ (bản 16/11 ghi 17 PR / 25 phiên, chưa tính T18 thêm ngày 17/11). Độ khó 2–4; cao nhất là T12 (cùng tồn tại với cascade cũ, CSP nonce, điều hướng mềm) và T14 (khung học viên ba kích thước). Giả định: tờ thiết kế không đổi lớn sau khi duyệt; CI có Chromium Linux ổn định để chụp ảnh; mỗi PR qua CI trong 1–2 vòng. Đây là ước lượng, không phải cam kết.

## 2. Hiện trạng trong repo (đã kiểm ở staging @ 93c7085)

| Thứ cần biết | File/đường dẫn thật | Ghi chú |
|---|---|---|
| Khung dùng chung route cần đăng nhập | `frontend/components/authed-shell.tsx` (216 dòng) | Phát theo thứ tự cố định: `<meta aver-auth-gated>` → script anti-flash (nonce) → `<link>` `tokens.css` → `components.css` → `ds.css` (nếu `utilityLayer`) → `pageStylesheets` → `tailwind.build.css` (nếu `tailwindLayer`) → `aver-chrome.js` (nếu `chrome='student'`) → `SupabaseRuntimeBoundary` (nạp `runtime-config.js`, `error-reporter.js`, `api.js`) → `aver-admin-chrome.js` (nếu `chrome='admin'`) → script nội tuyến gắn class `<body>` → `BodyClassBridge` → `AuthProvider`. Props: `pageStylesheets` (bắt buộc), `extraScripts`, `utilityLayer`, `tailwindLayer`, `chrome: 'student'|'admin'|'none'`, `authGated`, `lucideRuntime`, `bodyClass`. |
| Vì sao cascade cố định | comment đầu `authed-shell.tsx` | `home.css` có luật toàn cục (`* {box-sizing}`, `html, body`, `a`); 51 layout tắt `utilityLayer` vì preflight Tailwind đổi giao diện (h1 400 thay 700, link mất gạch). Quy ước chung mục 4.11 cấm đổi thứ tự này. |
| Route group | 80 thư mục `app/(…)`, 81 `layout.tsx`, 159 `page.tsx` | 39 layout `chrome="admin"`, 6 `chrome="none"`, 71 file có `<aver-chrome`. Mỗi trang tự ghi `<aver-chrome active="…">` bằng tay. |
| Thanh học viên cũ | `frontend/public/js/components/aver-chrome.js` (1.025 dòng, Shadow DOM, CSS trong chuỗi JS) | 8 mục; `VALID_ACTIVE` dòng 69; hamburger dưới 1025px (`MOBILE_NAV_QUERY` dòng 82); danh sách mục lặp hai lần (template dòng 441–448, speculation rules dòng 612–619). |
| Thanh admin cũ | `frontend/public/js/components/aver-admin-chrome.js` (1.078 dòng) | `NAV_GROUPS` dòng 425–574, `VALID_ACTIVE` dòng 45–53. Không có đăng xuất. |
| Cầu điều hướng | `frontend/components/chrome-navigation-bridge.tsx` (gắn ở `app/layout.tsx`) | Bắt click trong shadow root của hai thanh cũ và `router.push` → **điều hướng mềm** sang mọi route nội bộ. |
| Token cũ | `frontend/public/css/aver-design/tokens.css` (453 dòng, 132 token `--av-*`, sáng `:root[data-theme="light"]` dòng 200, tối dòng 291 và `@media (prefers-color-scheme: dark)` dòng 361) | `frontend/css` là symlink tới `public/css`. |
| Font | `frontend/app/layout.tsx`: `Plus_Jakarta_Sans` (preload), `JetBrains_Mono`, `Lora` (`preload:false`), `subsets ['latin','vietnamese']`, biến gắn lên `<html>` | `tests/next-font-delivery.test.mjs` ghim đúng ba họ và cách khai ở root. |
| CSS | 152 file `.css` trong `public/css` + 4 CSS Module (`app/error-screen.module.css`, `components/theme-toggle-button.module.css`, `components/vocabulary-audio-button.module.css`, một module admin vocab quiz) = 156 | CSS Module đã chạy được trong build và vitest. |
| Tailwind | `tailwind.config.cjs` `content` chỉ quét HTML + `js/**/*.js`, **không quét TSX**; bản build commit sẵn, CI dựng lại và so | Class Tailwind mới viết trong TSX không sinh CSS. |
| Icon | `lucide` 1.17.0 (vanilla) là dependency; chỉ nạp runtime 402 KB (`/vendor/lucide.min.js`) ở 3 route group; 66 `<svg>` viết tay trong 21 TSX; không có `lucide-react` | |
| Component dùng chung hiện có | `components/admin-directory-ui.tsx` (`StatusBanner`, `Field`, `Dialog`, `joinDialogStack`), `lib/use-dialog-focus.ts` (`useDialogFocus`), `lib/use-disclosure-focus.ts`, `lib/navigation-guard.ts` (`registerNavigationGuard`, `navigationGuardBlocks`) | Dùng lại logic focus, không dùng lại CSS. |
| Sổ route hiện có (rời rạc) | `docs/ROUTE_LEDGER.md` (666 dòng) + `tests/route-ledger-matches-app.test.mjs` (mỗi route phải có hàng) · `tooling/app-route-inventory.mjs` (`appPageRoute`, `NON_PRODUCT_APP_PAGE_ROUTES`) · `tooling/nonce-route-table.mjs` · `tooling/route-ownership-check.mjs` · `tests/route-auth-guard-inventory.test.mjs` (`GUARDED`, `PUBLIC_BY_DESIGN`, `DEBUG_GATED`) · `proxy.ts` `config.matcher` · `tooling/content-security-policy.mjs` `nonceRouteAllowed` dòng 178 · `app/robots.ts` `PRIVATE_PREFIXES` · `lib/diagnostic-routes.mjs` | Không cái nào biết route thuộc mục điều hướng nào, cha là ai, cần tham số gì. |
| Trang chỉ cho kỹ sư | `app/next-probe/page.tsx`, `app/(spike)/recorder-spike/page.tsx`; cổng `diagnosticRoutesEnabled()` trong `lib/diagnostic-routes.mjs` (chỉ `next dev` hoặc `AVER_ENABLE_DIAGNOSTIC_ROUTES=1`, đánh giá lúc build) | Mẫu cho trang thư viện component. |
| Kiểm thử | `npm --prefix frontend run test:react` (vitest 4.1.12, jsdom, `tests/react/**/*.test.tsx`, alias `@`, `/js/`) · node `--test` cho `tests/*.test.mjs` · Playwright 1.49 (`playwright.config.js` chỉ cho fixture tĩnh) · CI `.github/workflows/next-native-browser.yml` job "Next-native browser regression" (ubuntu-24.04: `npm run build` → `next start` → các `tooling/verify-*.mjs`) | Không có test ảnh chụp nào (`toHaveScreenshot`: 0). |
| `tsconfig.json` | `include` chỉ `app/**`, `types/**` | File trong `components/ui/` chỉ được kiểm kiểu khi có trang import. |

## 3. Phạm vi

**Trong phạm vi**
1. Token v2 tiền tố `--av2-` (chỉ chế độ sáng), file CSS nền có phạm vi.
2. Font Source Serif 4 + Source Sans 3 qua `next/font/google`, chỉ nạp ở cây giao diện mới.
3. (Chuyển sang G11-T32) Bộ icon: 94 icon tự vẽ nét 2 của tờ ThanhPhanNenTang, render SVG tĩnh trong React; G03 giữ API `Icon`.
4. Component trong `frontend/components/ui/` theo 6 tờ Thành phần (bảng 5.4).
5. Bốn khung trang trong `frontend/components/ui/shell/` (bảng 5.5).
6. Cơ chế cùng tồn tại: `AuthedShell` thêm chế độ `design="v2"`, ranh giới điều hướng cứng giữa cây cũ và mới.
7. Danh mục trang `frontend/lib/route-registry.mjs` + test CI.
8. Trang thư viện component `/ui-library` (chỉ bật khi chẩn đoán) + test ảnh chụp chạy trong job CI sẵn có.
9. Chuyển bốn trang pháp lý của G02-T13 sang khung công khai mới (trang thật đầu tiên).

**Ngoài phạm vi**
- Chuyển bất kỳ trang học viên/admin cũ nào sang giao diện mới (G05–G09).
- Hub mới `/course`, `/practice`, `/tests`, `/library`, `/progress`, `/account`, `/help` và chuyển hướng 16 đường dẫn (G07). G03 chỉ khai các đường dẫn này trong danh mục với trạng thái `planned`.
- Dữ liệu sidebar admin 8 nhóm và tìm nhanh thật (G09); API số lượt AI (G04).
- Vòng đời phát audio/video thật, đồng hồ thi thật, nộp bài (G07/G08). G03 làm component hiển thị có props điều khiển.
- Xoá `aver-chrome.js`, `aver-admin-chrome.js`, `tokens.css`, CSS trang cũ (xoá khi trang cuối cùng đã chuyển; G10).

## 4. Yêu cầu (chép vào `spec.md`)

- **FR-03-001** Token v2 có đủ nhóm: màu (14 vai trò), chữ (2 họ, 11 cỡ, 2 độ đậm, line-height), khoảng cách, bo góc 2px, đường kẻ, focus ring, chiều cao điều khiển, điểm gãy (ghi hằng số), lớp z. Không token v2 nào trùng tên `--av-*`.
- **FR-03-002** Trang dùng giao diện mới không nạp `tokens.css`, `components.css`, `ds.css`, CSS trang cũ, `tailwind.build.css`, `aver-chrome.js`, `aver-admin-chrome.js`.
- **FR-03-003** Trang cũ (mọi route chưa chuyển) có HTML `<head>` giống hệt trước gói: cùng `<link>` theo cùng thứ tự, cùng script.
- **FR-03-004** Hai font có ký tự tiếng Việt đủ dấu chồng ở cỡ 13–96px và độ đậm 400/600; ký tự IPA (`ə ʃ ʒ θ ð ŋ ˈ ˌ ː`) hiển thị bằng Source Sans 3. Trang cũ không tải hai font này.
- **FR-03-005** Mỗi component trong bảng 5.4 có đủ trạng thái ghi trong bảng, dùng được bằng bàn phím, có tên đọc cho trình đọc màn hình, đạt tương phản AA, vùng bấm tối thiểu 44px (admin 36px).
- **FR-03-006** Một bộ icon: mọi icon trong component mới qua `<Icon name>`; không emoji, không runtime lucide, không SVG viết tay ngoài thư mục icon. Bộ icon là **94 icon tự vẽ nét 2 của tờ ThanhPhanNenTang**, do G11-T32 dựng (thay G03-T03); API `Icon`/`IconName` giữ như mục 5.4.
- **FR-03-007** Khung học viên: 5 mục cố định Hôm nay · Lộ trình · Luyện tập · Thi thử · Thư viện; ≥1024px một hàng; 768–1023px nút "Menu: <mục đang ở>"; <768px thanh dưới 64px; mục đang ở có gạch 3px và chữ đậm; mục đang ở tự suy từ danh mục trang, không ghi tay ở từng trang. Bên phải thanh trên, theo thứ tự của tờ ThanhPhanKhungTrang mục 1: chỉ báo lượt AI · thẻ "N quá hạn" · chuông · nút tra nhanh (kính lúp, từ 768px) · nút tài khoản. Chỉ một trong ba (ô tra, ngăn thông báo, menu tài khoản) mở một lúc.
- **FR-03-007a** (mới) Đã đăng nhập thì luôn dùng khung học viên 5 mục, **kể cả tài khoản chưa có khoá** (`users.is_active=false`): `LearnerShell` không tự gắn cổng kích hoạt và không gọi API nào bị cổng kích hoạt chặn; việc trang nào cần cổng do layout của trang quyết (G07-T26 mở `/home`; G05 dùng cho `/courses`, `/enroll`, `/activate`). Tài khoản chưa có khoá: chỗ lượt AI hiện "Chấm thử hôm nay còn N bài" hoặc để trống (dữ liệu do trang truyền vào).
- **FR-03-007b** (mới) Nút tra nhanh: bấm kính lúp hoặc phím `/` mở ô tra, tiêu điểm vào ô; gợi ý theo ba nhóm (Từ vựng · Bài ngữ pháp · Đề bài mẫu Writing), tối đa 2 dòng mỗi nhóm, mũi tên chọn, Enter mở, Esc đóng và trả tiêu điểm; không có gợi ý: "Không thấy kết quả. Thử từ khác hoặc vào Thư viện." Điện thoại: không có nút trên thanh (ô tra đặt đầu trang Thư viện — G06). G03 dựng giao diện nhận hàm `lookup(query)`; nguồn dữ liệu (API tìm của Grammar, Vocabulary, Thư viện) do G06 nối.
- **FR-03-008** Menu tài khoản đúng thứ tự Tiến độ · Khoá học và lượt AI · Hồ sơ · Trợ giúp · (Đổi vai trò, chỉ khi máy chủ xác nhận admin) · Đăng xuất; đóng bằng bấm lại, bấm ra ngoài, Esc; tiêu điểm trở về nút.
- **FR-03-009** Thanh tập trung có hai bản không trộn nhãn: luyện (nền giấy, tiếng Việt), thi (nền mực, tiếng Anh); hỏi lại chỉ khi thoát sẽ mất bài; không chân trang, không lượt AI, không nút tài khoản, không chuông. Bản thi: **không có "Save and exit"** — nút thoát là "Leave test", hộp hỏi lại ghi đồng hồ vẫn chạy; đề tự chọn có thêm "Abandon test" (00 mục 2 điểm 22; chi tiết ở GOI-08 FR-08-011, 041). Phòng thi full test luôn sáng (FR-03-D7).
- **FR-03-010** Khung admin/giáo viên: thanh trên có nhãn môi trường không bao giờ ẩn (Production/Staging khác cả chữ và kiểu nền), nhãn vai trò "Quản trị"/"Giáo viên" (không dùng chữ khác cho giáo viên), điều khiển giao diện ba lựa chọn Sáng · Tối · Theo thiết bị (`ThemeMenu`, mục 5.9); sidebar nhóm gập/mở, nhóm chứa trang hiện tại luôn mở, ngăn kéo dưới 768px; khung giáo viên **5 mục phẳng** (danh sách mục do G09-T20 cấp qua `nav`).
- **FR-03-010a** (mới) Quy tắc admin ở 1024px (áp cho mọi trang admin trong khoảng 1024–1199px): sidebar thu thành cột icon (có `aria-label` và tooltip, nhãn môi trường vẫn hiện); bảng rộng hơn vùng nội dung thì **cuộn ngang trong khung bảng và giữ cột đầu cố định**, trang không cuộn ngang; thanh hành động của bảng không bị đẩy ra ngoài. Tờ `Admin1024.dc.html` (ba trang Việc cần làm, Chấm Writing, Lớp) **đang được vẽ, sẽ có** — khi có thì ba trang đó theo tờ; các trang khác theo quy tắc chung này (GOI-09 FR-09-009, Q30).
- **FR-03-011** Khung công khai: Thư viện · Khoá học · Đăng nhập (liên kết chữ) · nút "Xem các khoá"; chân trang đầy đủ; không thanh dưới. Menu điện thoại có một slot cho mục "Chấm thử" (prop `mobileExtraItem`): G05-T21 truyền mục này khi chương trình chấm thử đang mở; không truyền thì menu không có dòng trống. Khung công khai chỉ cho người chưa đăng nhập (trừ trang chủ — GOI-05 mục 10 câu 11).
- **FR-03-012** Danh mục trang: mọi `page.tsx` có đúng một mục; mục nào không có file thì test báo (trừ `status: 'planned'`); mọi mục `kind` `nav`/`child` nối được tới một gốc điều hướng qua `parent`; mục `requires` có `parentOnMissing`.
- **FR-03-013** Trang `/ui-library` hiện mọi component ở mọi trạng thái, 1280px và 390px; trả 404 trên staging/production trừ khi bật cờ chẩn đoán.
- **FR-03-014** Test ảnh chụp chạy trong job CI "Next-native browser regression" sẵn có; khác ảnh mốc quá ngưỡng thì job đỏ; ảnh mốc chỉ cập nhật bằng PR có ghi lý do.
- **FR-03-015** Đi từ trang cũ sang trang mới (và ngược lại) luôn là tải lại trang đầy đủ; không còn CSS của cây kia trong tài liệu.

**Kịch bản chấp nhận (Given/When/Then, chép vào `spec.md`)**
1. Given trang `/terms` đã chuyển khung mới, When tải trang, Then `document.styleSheets` không có `/css/aver-design/tokens.css`, `getComputedStyle(document.body).fontFamily` bắt đầu bằng tên font Source Sans 3 do `next/font` sinh.
2. Given đang ở `/home` (khung cũ), When bấm một liên kết tới `/terms`, Then trình duyệt tải lại trang (sự kiện `load` mới), không còn `<link href="/css/home.css">`.
3. Given `/ui-library` mở ở 390px, When cuộn tới khung học viên, Then thấy thanh dưới 5 ô, mục "Luyện tập" có gạch trên và chữ đậm.
4. Given tài khoản không phải admin, When mở menu tài khoản trong khung học viên, Then không có dòng "Đổi vai trò" và không có chỗ trống thay nó.
5. Given một PR thêm `app/(x)/foo/page.tsx` mà không khai trong danh mục, When chạy bộ test frontend, Then test danh mục đỏ và nêu `/foo`.
6. Given `/ui-library` khi build không có `AVER_ENABLE_DIAGNOSTIC_ROUTES=1`, When mở, Then HTTP 404.
7. Given nút `Button` biến thể chính đang xử lý, When đọc bằng trình đọc màn hình, Then nghe nhãn "Đang nộp…" và nút `aria-disabled`.

**Ca biên (chép vào `spec.md`):** người dùng hệ điều hành chế độ tối mở trang mới (anti-flash vẫn đặt `data-theme="dark"`); trình duyệt chặn font (fallback phải đọc được); trang mới mở modal (`<dialog>` ở top layer vẫn kế thừa biến CSS); bàn phím ảo mở trên điện thoại (thanh dưới ẩn); admin thu sidebar rồi tải lại; tài khoản bị đổi vai trò giữa phiên (dòng Đổi vai trò biến mất ở lần nạp sau); CSP nonce bật ở staging (trang mới không thêm script nội tuyến); điều hướng mềm từ trang mới tới trang mới (được phép, vẫn giữ CSS mới).

**Câu hỏi mở (chép vào `spec.md`, trùng mục 10):** câu 1–6 ở mục 10.

## 5. Hợp đồng kỹ thuật

### 5.1 Vị trí file

```
frontend/styles/av2/tokens.css        # token --av2-* trên :root (chỉ khai biến)
frontend/styles/av2/base.css          # luật phần tử, tất cả nằm dưới .av2-root
frontend/styles/av2/fonts.ts          # next/font: Source_Serif_4, Source_Sans_3
frontend/components/ui/<ten>.tsx      # mỗi component một file (kebab-case)
frontend/components/ui/<ten>.module.css
frontend/components/ui/icon/          # icon.tsx + icon-set.ts
frontend/components/ui/shell/         # public-shell, learner-shell, focus-shell, staff-shell + phần con
frontend/components/ui/index.ts       # export công khai
frontend/lib/route-registry.mjs       # danh mục trang
frontend/app/(ui-library)/ui-library/page.tsx
frontend/tests/react/ui/*.test.tsx    # test hành vi component
frontend/tests/route-registry.test.mjs
frontend/tests/visual/ui-library.spec.mjs   # Playwright ảnh chụp
frontend/tests/visual/__screenshots__/      # ảnh mốc (Linux)
frontend/playwright.visual.config.js
```

Lý do không đặt CSS mới vào `public/css`: mọi file ở đó bị nạp bằng `<link>` theo cascade cũ và bị các test quản trị quét theo luật cũ; CSS Module tự có phạm vi (tên class băm) nên không đụng luật toàn cục của `home.css`/`ds.css`.

### 5.2 Token v2 (`frontend/styles/av2/tokens.css`)

Giá trị lấy từ lớp `.pal-navy` có trong mọi tờ thiết kế và cỡ chữ/khoảng cách đo trong 6 tờ Thành phần.

| Nhóm | Token | Giá trị |
|---|---|---|
| Màu | `--av2-paper` `--av2-surface` `--av2-ink` `--av2-muted` `--av2-rule` `--av2-accent` `--av2-accent-hover` `--av2-link` `--av2-mark` `--av2-danger` `--av2-ok` `--av2-tint` `--av2-off` `--av2-on-dark` | `#FAF6EF` `#FFFFFF` `#1B1A17` `#5E5A52` `#D8D0C0` `#1A3561` `#11254A` `#1A3561` `#8A1C1C` `#9B1C1C` `#1F6B3A` `#EEF0F5` `#E8E2D5` `#FFFFFF` |
| Viền điều khiển | `--av2-control-border` | `var(--av2-muted)` — `--av2-rule` chỉ đạt 1,42:1 trên giấy, không đủ 3:1 cho viền ô nhập/ô chọn (WCAG 1.4.11); `--av2-rule` chỉ dùng làm đường phân cách |
| Họ chữ | `--av2-font-serif` `--av2-font-sans` | `var(--av2-ff-serif), Georgia, serif` · `var(--av2-ff-sans), system-ui, sans-serif` (biến `--av2-ff-*` do `next/font` sinh) |
| Cỡ chữ | `--av2-fs-12` … | 12, 13, 14, 15, 16, 18, 20, 24, 40 px; `--av2-fs-band-row` 18, `--av2-fs-band-md` 40, `--av2-fs-band-lg` 96, `--av2-fs-band-phone` 72 |
| Độ đậm | `--av2-fw-regular` `--av2-fw-strong` | 400, 600 |
| Dòng | `--av2-lh-body` `--av2-lh-tight` | 1.5 (theo tờ), 1.15 (H1). Kiểm dấu chồng ở 13–14px; nếu dấu bị cắt, nâng `--av2-lh-body` lên 1.55 và ghi trong PR |
| Khoảng cách | `--av2-space-1` … | 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 48, 56 px |
| Bo, kẻ, bóng | `--av2-radius` `--av2-rule-w` `--av2-rule-strong-w` | 2px · 1px · 2px; **không có token bóng** (tờ: "không đổ bóng") |
| Focus | `--av2-focus` | `outline: 3px solid var(--av2-ink); outline-offset: 2px` |
| Điều khiển | `--av2-control-lg/md/sm` · `--av2-row` `--av2-row-dense` | 48 / 44 / 36 · 52 / 40 |
| Khung | `--av2-topbar-h` `--av2-bottombar-h` `--av2-account-menu-w` `--av2-sidebar-row` | 64 · 64 · 288 · 36 (44 trên điện thoại) |
| Lớp | `--av2-z-sticky` `--av2-z-overlay` `--av2-z-toast` | 10 · 100 · 200 |
| Điểm gãy | (hằng số trong comment + `frontend/components/ui/breakpoints.ts`) | 768, 1024, 1200 (sidebar admin chỉ icon) — biến CSS không dùng được trong `@media` |

Tương phản đã tính: muted/giấy 6,37:1; accent/giấy 11,3:1; mark/giấy 8,61:1; ok/giấy 6,05:1; trắng/accent 12,17:1; trắng/mark 9,28:1; ink/giấy 16,15:1.

`base.css`: `.av2-root { background: var(--av2-paper); color: var(--av2-ink); font: var(--av2-fw-regular) var(--av2-fs-16)/var(--av2-lh-body) var(--av2-font-sans); }`, H1–H3 dưới `.av2-root` dùng `--av2-font-serif` 600, `a` dùng `--av2-link`, `:focus-visible` dùng `--av2-focus`, `.av2-ipa { font-family: var(--av2-font-sans) }`. Không luật nào ngoài `.av2-root`, trừ `:root` khai biến.

### 5.3 Font (`frontend/styles/av2/fonts.ts`)

```ts
import { Source_Sans_3, Source_Serif_4 } from 'next/font/google';
export const av2Serif = Source_Serif_4({ subsets: ['latin', 'latin-ext', 'vietnamese'], weight: ['400', '600'], display: 'swap', variable: '--av2-ff-serif' });
export const av2Sans = Source_Sans_3({ subsets: ['latin', 'latin-ext', 'vietnamese'], weight: ['400', '600'], display: 'swap', variable: '--av2-ff-sans' });
export const av2FontClass = `${av2Serif.variable} ${av2Sans.variable}`;
```

- Chỉ layout của cây mới import file này và gắn `av2FontClass` lên phần tử `.av2-root` (không lên `<html>`), nên trang cũ không tải font. Không sửa `app/layout.tsx`.
- `latin-ext` cần cho IPA (U+0250–02AF). CHƯA KIỂM: tên subset và trục `opsz` mà `next/font` hỗ trợ cho Source Serif 4 trong Next 16 — đọc `node_modules/next/dist/docs/` và danh sách trong `node_modules/next/dist/compiled/@next/font/dist/google/font-data.json`.
- Component không bao giờ import `fonts.ts` (vitest/jsdom không chạy được `next/font`).

### 5.4 Component trong `frontend/components/ui/`

Quy ước chung: mỗi component nhận `className?` để ghép; không nhận `style` tuỳ ý; nhãn là `string` tiếng Việt mặc định, riêng component có chế độ thi nhận `lang: 'vi' | 'en'` và mọi nhãn mặc định đổi theo `lang`. Dữ liệu chưa chốt hiển thị qua `PendingValue` (chữ `XXX`). Màu không bao giờ là tín hiệu duy nhất.

| # | Component | Tờ (mục) | Props chính | Trạng thái phải có |
|---|---|---|---|---|
| 1 | `Button` | ThanhPhan §1 | `variant: 'primary'\|'secondary'\|'text'\|'danger'`, `size: 'lg'\|'md'\|'sm'` (48/44/36), `loading?`, `loadingLabel?` ("Đang nộp…"), `disabled?`, `type`, `iconStart?`, `href?` (thành `<a>`) | mặc định, rê chuột, focus bàn phím, đang xử lý (`aria-disabled`, giữ độ rộng), vô hiệu. `danger` chỉ được dùng trong `ConfirmDialog`/`Notice` cảnh báo (ghi trong JSDoc) |
| 2 | `IconButton` | §1 | `icon`, `label` (bắt buộc, thành `aria-label`), `size` | như Button |
| 3 | `Icon` | — | `name: IconName`, `size: 16\|20\|22\|24`, `title?` (không có → `aria-hidden`) | — |
| 4 | `TextField` | §2 | `label`, `hint?`, `error?`, `readOnlyReason?`, `value`, `onChange`, `type`, `placeholder?` | thường, đang nhập (viền 2px), lỗi (chữ lỗi nói cách sửa, `aria-describedby`), chỉ đọc kèm lý do |
| 5 | `TextArea` | §2 | `label`, `saveStatus?` ("Đã lưu lúc 10:42"), `wordCount?: {count, limit}`, `error?` | như TextField + đếm từ |
| 6 | `Select` | §2 | `label`, `options: {value,label}[]`, `value`, `onChange` | dùng `<select>` gốc, style lại |
| 7 | `SearchField` | §2 | `label` (ẩn bằng mắt, còn cho trình đọc), `onSearch` | rỗng, có chữ (nút xoá) |
| 8 | `ChoiceGroup` | §2 | `mode: 'single'\|'multiple'`, `legend`, `options`, `value`, `onChange` | radio/checkbox gốc trong `<fieldset>` |
| 9 | `StatusBadge` | §3 | `set: 'work'\|'content'\|'access'`, `value` (khoá enum), `detail?` ("2 ngày") | Bộ chữ cố định từ tờ: work = Chưa làm · Đang làm · Đã nộp · chờ chấm · Đã chấm · Đã trả bài · Quá hạn; content = Bản nháp · Đã phát hành · Lưu trữ; access = Đang học · Sắp hết hạn · Hết hạn · Đã khoá |
| 10 | `Notice` | §4 | `kind: 'info'\|'success'\|'warning'\|'error'`, `title?`, `children`, `action?`, `lang?` | cảnh báo/lỗi: viền trái dày, nền nhạt, icon tam giác/tròn, nhãn chữ "Cảnh báo"/"Lỗi" ("Warning"/"Error" khi `lang='en'`) |
| 11 | `Dialog` | ThanhPhanDuLieu §6 | `open`, `title`, `onClose`, `variant: 'modal'\|'drawer'`, `busy?`, `children`, `actions` | dùng `<dialog>` gốc + `showModal()`; Esc, nút đóng, bấm nền; focus vào trong, trả về nút mở (dùng `useDialogFocus`) |
| 12 | `ConfirmDialog` | ThanhPhan §4 | `tone: 'default'\|'warning'`, `lang`, `title` (là câu hỏi), `body`, `confirmLabel` (lặp động từ của câu hỏi), `cancelLabel`, `onConfirm`, `busy?` | cảnh báo: nút xác nhận `danger`; mặc định: nút chính là "ở lại" khi dùng cho thoát |
| 13 | `PageState` | ThanhPhan §5 | `kind: 'empty'\|'error'\|'loading'\|'locked'`, `title`, `body`, `action?` | 4 kiểu như tờ; `loading` có `role="status"` và chữ |
| 14 | `MediaPlaceholder` + `PendingValue` | §5 | `kind: 'illustration'\|'video'\|'chart'`, `ratio`, `caption` · `PendingValue` không props (in `XXX`, có `title="Chưa chốt"`) | — |
| 15 | `Tabs` | §6 | `items: {id,label,count?,href?}[]`, `active`, `onChange?` | `tablist/tab/tabpanel` khi không có `href`; điều hướng thì là `<nav>` liên kết |
| 16 | `Breadcrumb` + `BackLink` | §6, KhungTrang §5 | `items: {label, href?}[]` · `parentLabel`, `href` | ≥768px breadcrumb; <768px chỉ "‹ {trang cha}"; không bao giờ cả hai |
| 17 | `Pagination` | §6 | `page`, `totalPages`, `totalLabel` ("549 đề"), `hrefFor(page)` | trang đầu/cuối vô hiệu nút tương ứng |
| 18 | `DataTable` | DuLieu §1–2 | `columns: {key,label,align?,sortable?}[]`, `rows`, `rowKey`, `density: 'comfortable'\|'dense'` (52/40), `selectable?`, `sort?`, `onSort?`, `filters?` (chip), `bulkActions?`, `emptyState`, `loading?` | trống, đang tải, có chọn nhiều (thanh hành động), điện thoại thành thẻ; số căn phải `font-variant-numeric: tabular-nums`; ô trống ghi "chưa có" |
| 19 | `StatCard` | DuLieu §3 | `value`, `label`, `comparison` (câu chữ, không màu xanh/đỏ) | — |
| 20 | `Chart` | DuLieu §4 | `type: 'bar'\|'line'`, `title` (câu kết luận), `unit`, `source`, `data: {label, value}[]` | SVG tự vẽ (không chart.js), luôn có bảng số liệu ngay dưới |
| 21 | `ProgressBar` | DuLieu §5 | `mode: 'determinate'\|'indeterminate'\|'steps'`, `value?`, `total?`, `label` | luôn có chữ tiến độ |
| 22 | `FileUpload` | DuLieu §7 | `accept`, `maxSizeMb`, `files: {name, status, error?}[]`, `onAdd`, `onRemove` | nói trước định dạng/cỡ; mỗi file một dòng trạng thái bằng chữ |
| 23 | `Stepper` | DuLieu §8 | `steps: {label, status: 'done'\|'current'\|'todo'\|'locked'}[]` | tên bước là động từ |
| 24 | `DateField` / `TimeField` / `DateRangeField` | DuLieu §9 | `label`, `value` (ISO), `onChange`, `min?`, `max?` | gõ tay `dd/mm/yyyy`, giờ `hh:mm` 24h, tuần bắt đầu thứ Hai; điện thoại: tấm trượt đáy, nút "Xong"; không dùng `<input type="date">` |
| 25 | `BandScore` (+ `CriteriaList`, `OverallBlock`) | HocTap §1 | `size: 'lg'\|'md'\|'row'\|'phone'`, `state: 'ready'\|'insufficient'\|'grading'`, `skill`, `band?`, `basis` ("Dựa trên 1 bài, 268 từ"), `previous?: {band, date}`, `criteria?: {name, band, note}[]`; `OverallBlock`: `skills: {name, band \| null}[]`, `missing: string[]` | luôn có dòng "Điểm ước lượng, không phải điểm thi"; `insufficient` không có số; so sánh bằng chữ ("Cao hơn lần trước 0.5 band (6.0, bài ngày 02/11)"); Overall chỉ có số khi đủ 4 kỹ năng |
| 26 | `Timer` | HocTap §4 | `mode: 'countdown'\|'countup'`, `seconds`, `lang`, `thresholds: {at, label}[]` | không nhấp nháy; chữ đổi ở mốc ("5 minutes left", "Còn 15 giây"); `aria-live` đọc đúng một lần mỗi mốc; số đều cột |
| 27 | `QuestionPalette` | HocTap2 §5 | `lang`, `items: {num, state: 'unanswered'\|'answered'\|'flagged'\|'current'\|'correct'\|'wrong'\|'blank'}[]`, `onSelect` | mỗi trạng thái khác nền/viền/biểu tượng + tên đọc đầy đủ; số ghi "Q5" khi `lang='en'` |
| 28 | `VocabEntry` | HocTap2 §6 | `variant: 'full'\|'popover'`, `headword`, `ipa`, `pos`, `defEn`, `defVi`, `example`, `collocations`, `audio?` | thứ tự cố định theo tờ; IPA trong `.av2-ipa` |
| 29 | `AnnotatedText` | HocTap2 §7 | `segments: {text, mark?: 1\|2\|3\|4, note?: number}[]`, `notes: {number, label, body}[]` | 4 kiểu gạch khác nhau + số chú thích + nhãn chữ ở lề; màu là lớp thứ ba |
| 30 | `Figure` | HocTap2 §8 | `children` (SVG), `caption`, `alt` | nét mảnh, viền 1px, chữ trong hình dùng hai họ chữ của trang |
| 31 | `AudioPlayer` (giao diện) | HocTap §2 | `variant: 'full'\|'compact'\|'phone'\|'once'`, `state: 'loading'\|'ready'\|'playing'\|'paused'\|'error'\|'locked'`, `current`, `duration`, `speed`, `loop?: {a,b}`, `onPlay/onPause/onSeek/onSpeed/onSetA/onSetB/onClearLoop/onRetry`, `mode: 'practice'\|'exam'` | nút Phát luôn có chữ; `exam`/`once` không có A–B; `once` có màn "chỉ nghe một lần" và "Đã nghe · đã khoá"; lỗi nói câu trả lời vẫn còn |
| 32 | `VideoFrame` (giao diện) | HocTap §3 | `source: 'youtube'\|'self'`, `title`, `meta`, `state: 'idle'\|'loading'\|'playing'\|'error'\|'locked'`, `resumeAt?`, `embedUrl?`, `transcriptHref?` | YouTube nhúng chế độ không cookie (`youtube-nocookie.com`), không vẽ nút đè; video không tự phát |

Bảng có 32 dòng vì tách nhỏ cho rõ; theo cách gom của tờ (các ô nhập là một họ, ba ô ngày là một họ) là khoảng 25 thành phần.

`AudioPlayer`/`VideoFrame` chỉ là giao diện điều khiển bằng props; không tự tạo `<audio>`/`<video>`. G07/G08 nối với vòng đời phát hiện có (quy tắc `frontend/AGENTS.md`: giữ nguyên vòng đời trình phát).

### 5.5 Khung trang trong `frontend/components/ui/shell/`

| Khung | Thành phần con | Props | Tờ |
|---|---|---|---|
| `PublicShell` | `PublicTopNav` (Thư viện · Khoá học · "Đăng nhập" liên kết chữ · nút chính "Xem các khoá"; điện thoại: "Đăng nhập" ngoài menu, còn lại trong menu, thêm slot `mobileExtraItem` cho mục "Chấm thử" của G05-T21), `PublicFooter` (Giới thiệu · Khoá học · Thư viện · Điều khoản · Quyền riêng tư · Liên hệ · ©) | `active?: 'library'\|'courses'`, `mobileExtraItem?: {label, href}`, `children` | KhungTrang §4, KhungTrang2 §9 |
| `LearnerShell` | `LearnerTopNav` (5 mục), `TabletMenu` (768–1023px, nút "Menu: {mục}", danh sách đẩy nội dung xuống, dòng 48px), `BottomTabBar` (<768px, 64px, 5 ô, icon 22px, chữ 12px, ẩn khi `focus` hoặc bàn phím ảo mở), `AiCreditsIndicator` (`credits: {remaining: number\|null, low: boolean}`; `null` → `PendingValue`; "Sắp hết · còn N lượt" khi `low`), `OverdueSlot` + `NotificationsSlot` (chỗ đặt thẻ "N quá hạn" và chuông — component thật do G11-T11 dựng và truyền vào; không truyền thì không chiếm chỗ), `QuickLookup` (nút kính lúp + ô tra, từ 768px; nhận `lookup(query) → Promise<{group, items}[]>`), `AccountMenu` (popover 288px máy tính; tấm trượt đáy điện thoại), `CompactFooter` (© · Trợ giúp · Điều khoản · Quyền riêng tư), `RedirectNotice` (dải dưới thanh, như G02 nhưng giao diện mới) | `user: {name, email, initials}`, `canSwitchToAdmin: boolean` (lấy từ hồ sơ máy chủ `/auth/me`, không suy ở client), `credits` (một con số chung; `null` → `PendingValue`), `trialLeft?: number|null` (tài khoản chưa có khoá: "Chấm thử hôm nay còn N bài"), `notificationsSlot?: ReactNode`, `overdueSlot?: ReactNode`, `lookup?`, `children`. Khung không có prop cổng kích hoạt: chạy được với tài khoản `is_active=false` (FR-03-007a). Mục đang ở **không** là prop: suy từ `usePathname()` + `route-registry` | KhungTrang §1–3, KhungTrang2 §9–10 |
| `FocusShell` | `FocusBar` (trái: thoát; giữa: tên bài, cắt "…"; phải: slot đồng hồ/tiến độ/trạng thái lưu), `LeaveConfirm` (dựa trên `ConfirmDialog`) | `mode: 'practice'\|'exam'`, `title`, `exitHref`, `hasUnsavedWork: () => boolean`, `right: ReactNode`, `bottom?: ReactNode` (bảng câu hỏi), `children` | KhungTrang §6 |
| `StaffShell` | `StaffTopBar` (tên · nhãn vai trò "Quản trị"/"Giáo viên" · `EnvBadge` · ô tìm nhanh ⌘K · "Xem như học viên" · `ThemeMenu` Sáng · Tối · Theo thiết bị · nút tài khoản có Đổi vai trò, Đăng xuất), `StaffSidebar` (nhóm gập/mở, mục con thụt 10px trên đường dọc mảnh, số việc chờ màu `--av2-mark`, nhóm thu cộng dồn, dòng 36px; <1200px chỉ icon — gồm 1024px, FR-03-010a), `StaffDrawer` (<768px, dòng 44px, nhãn môi trường thành dải ngang), `QuickSearch` (giao diện; nhận `search(query) → Promise<{group, items}[]>`) | `role: 'admin'\|'instructor'`, `nav: StaffNavGroup[]` (G09 cung cấp; G03 dùng dữ liệu mẫu trong `/ui-library`), `environment: 'production'\|'staging'\|'local'`, `user`, `children` | KhungTrang2 §7–8 |

- `EnvBadge` lấy môi trường từ `window.__AVER_RUNTIME_CONFIG__.environment` (khai ở `public/js/runtime-config.js` dòng 5, sinh bởi `tooling/generate-runtime-config.mjs`). CHƯA KIỂM giá trị chính xác cho staging (`preview`?) — người thực thi đọc `tooling/runtime-origins.mjs` và ánh xạ: `production` → "Production · dữ liệu thật", còn lại → "Staging · dữ liệu thử".
- Đổi vai trò, đăng xuất: dùng lại logic đăng xuất của thanh cũ (đọc `aver-chrome.js` phần `user-menu-logout` và `tests/react/chrome-logout-*.test.tsx`), không viết luồng đăng xuất mới.

### 5.6 Danh mục trang (`frontend/lib/route-registry.mjs`)

```js
/** @typedef {{
 *  route: string,               // '/writing/result', '/grammar/[category]/[slug]'
 *  owner: string | null,        // 'app/(authed-writing-result)/writing/result/page.tsx'; null khi planned
 *  status: 'live' | 'planned' | 'redirect',
 *  audience: 'public' | 'learner' | 'instructor' | 'admin' | 'diagnostic',
 *  kind: 'nav' | 'child' | 'deep-link-only' | 'focus' | 'redirect' | 'diagnostic',
 *  section: 'home'|'course'|'practice'|'tests'|'library'|'account'|'public'|'admin:<nhóm>'|'instructor'|null,
 *  parent: string | null,       // route cha
 *  requires: string[],          // tham số query bắt buộc
 *  parentOnMissing: string | null,
 *  ui: 'v1' | 'v2',
 * }} RouteEntry */
export const ROUTES = Object.freeze([ /* … */ ]);
export function routeFor(pathname) {}      // khớp cả đoạn động
export function sectionFor(pathname) {}    // khung học viên dùng để tô mục đang ở
export function isV2Route(pathname) {}     // cầu điều hướng dùng
```

- Khởi tạo: sinh danh sách 159 route bằng `appPageRoute` của `tooling/app-route-inventory.mjs`, rồi điền tay `section/parent/kind/requires` dựa trên `docs/ROUTE_LEDGER.md` và báo cáo 12 (`S/reports/12-navigation-ia.md` mục 1). Các route chưa có file của G05–G07 (`/course`, `/practice`, `/tests`, `/library`, `/progress`, `/account`, `/help`, `/courses`, `/courses/[slug]`, `/enroll/[orderCode]`) khai `status: 'planned'`.
- Xung đột phải ghi vào mục `note`: `/practice` (planned, hub Luyện tập) cùng tiền tố với `/practice/session` (đang là trình luyện Speaking); `/library` công khai nhưng khi đăng nhập dùng khung học viên.
- Test `frontend/tests/route-registry.test.mjs` (import module, không so chuỗi mã nguồn):
  1. tập route từ cây `app/` = tập mục `status !== 'planned'`;
  2. mỗi `owner` tồn tại; mục `planned` không có file;
  3. mọi mục `nav`/`child` đi theo `parent` tới một mục `nav` trong vòng ≤6 bước, không vòng lặp → không mồ côi;
  4. mục có `requires` phải có `parentOnMissing` trỏ tới mục `live` không có `requires`;
  5. mỗi `section` học viên là một trong 5 mục hoặc `account`;
  6. `isV2Route` khớp đúng tập `ui: 'v2'`.
- Không xoá `docs/ROUTE_LEDGER.md` hay các bảng khác ở gói này (G10 quyết gộp).

### 5.7 Cùng tồn tại (cơ chế)

1. **`AuthedShell` thêm prop `design?: 'v1' | 'v2'` (mặc định `'v1'`).** Với `'v1'` mọi thứ phát ra giữ nguyên byte. Với `'v2'`: không phát năm thẻ `<link>` cũ, không phát `aver-chrome.js`/`aver-admin-chrome.js`; vẫn phát `<meta aver-auth-gated>`, script anti-flash, `SupabaseRuntimeBoundary`, script gắn class `<body>` (với `bodyClass='av2-body'`), `BodyClassBridge`, `AuthProvider`. Vẫn đúng **2** thẻ `<script` nội tuyến. Layout v2 tự `import '@/styles/av2/tokens.css'` và `base.css`, bọc `children` trong `<div className={'av2-root ' + av2FontClass}>` và khung tương ứng.
2. **Route group mới** cho trang v2 đặt tên `(authed-v2-<khu>)` (học viên/admin) để `tests/authed-shell.test.mjs` (lọc `^\(authed`) vẫn ép đi qua `AuthedShell`; mỗi layout có `export const instant = false;` (test `csp-nonce-report-only` đòi). Trang công khai v2: `(public-v2)`, layout riêng không dùng `AuthedShell`, tự có anti-flash như `app/(marketing)/layout.tsx`.
3. **Ranh giới điều hướng cứng.** `ChromeNavigationBridge` (cây cũ): trước `router.push`, nếu `isV2Route(url.pathname) !== isV2Route(location.pathname)` thì không chặn click (để trình duyệt tải trang). Khung v2: liên kết tới route `ui: 'v1'` dùng `<a>` thường, không dùng `next/link`. Lý do: CSS cũ (`home.css`, `ds.css`, class `av-page` trên `<body>`) và CSS mới không được cùng sống trong một tài liệu.
4. **Theme (sửa ngày 17/11/2026).** Cây v2 có HAI chế độ sáng và tối, theo mục 5.9. Token v2 đổi theo `[data-theme]` trên `<html>`, dùng lại khoá `av-theme` và đoạn chống nháy đang có. Khung v2 có điều khiển ba lựa chọn Sáng · Tối · Theo thiết bị.
5. **Không đổi**: thứ tự cascade v1, `app/layout.tsx`, `tokens.css`, hai web component cũ.

### 5.8 Test phải cập nhật

| Test | Vì sao vỡ/đổi | Cách sửa |
|---|---|---|
| `tests/authed-shell.test.mjs` | Thêm nhánh `design` | Giữ nguyên kiểm cascade v1; thêm ca: khi `design==='v2'` không có chuỗi `tokens.css` trong nhánh v2 (đọc nhánh bằng cách dựng component trong test React thì tốt hơn — xem T12) |
| `tests/csp-nonce-report-only.test.mjs`, `tests/csp-nonce-enforce.test.mjs` | Đếm thẻ `<script`; so `proxy.ts` matcher với tiền tố URL của mọi layout có `<AuthedShell`; đòi `instant = false` | Không thêm script; khi G07 thêm tiền tố mới thì sửa `proxy.ts` matcher + `nonceRouteAllowed` cùng PR. G03 chỉ thêm `ui-library` nếu nó dùng `AuthedShell` (không nên — xem T04) |
| `tests/route-ledger-matches-app.test.mjs` | Route mới (`/ui-library`) | Thêm vào `EXEMPT` như `/next-probe` |
| `tests/route-auth-guard-inventory.test.mjs` | Route mới | `/ui-library` vào `DEBUG_GATED`; trang pháp lý v2 giữ `PUBLIC_BY_DESIGN` |
| `tooling/app-route-inventory.mjs` | `NON_PRODUCT_APP_PAGE_ROUTES` | Thêm `/ui-library` |
| `tests/hex-budget.test.mjs` | Chỉ quét `css/` | Thêm gốc quét `styles/` và `components/ui/` (ngân sách 0), miễn đúng một file `styles/av2/tokens.css` |
| `tests/undefined-token-sentinel.test.mjs` | Regex `--(av-…)` không bắt `--av2-` | Thêm khối kiểm `--av2-*`: nguồn `styles/av2/tokens.css`, quét `styles/`, `components/ui/`, `app/(authed-v2-*)`, `app/(public-v2)` |
| `tests/font-system-ratchet.test.mjs`, `tests/next-font-delivery.test.mjs` | Không vỡ (không đụng root, không đụng `css/`) | Chạy để chắc chắn |
| `tests/primitive-families.test.mjs` | Không vỡ (CSS Module ngoài `css/`) | — |
| `tests/react/admin-chrome-navigation.test.tsx` | Cầu điều hướng đổi hành vi ở ranh giới | Thêm ca: click từ trang v1 tới route v2 không gọi `router.push` |
| `tests/workflow-path-coverage.test.mjs`, `tests/next-native-browser-workflow.test.mjs` | Thêm bước/tệp mà workflow đọc | Thêm glob `frontend/tests/visual/**`, `frontend/playwright.visual.config.js`, `frontend/components/ui/**`, `frontend/styles/**` vào bộ lọc đường dẫn của job |

### 5.9 Chế độ tối (thêm ngày 17/11/2026)

Tờ thiết kế: `thiet-ke/CheDoToi.dc.html` (quy cách), `CheDoToiHocVien.dc.html`, `CheDoToiCongKhaiAdmin.dc.html`. Lý do: web hiện tại đã có sáng/tối cho mọi trang (`frontend/public/css/aver-design/tokens.css`, khoá `av-theme`, đoạn chống nháy trong `components/authed-shell.tsx` và ba layout công khai); dựng lại mà chỉ có sáng là làm mất tính năng của người đang dùng.

**Giá trị token** (bảng màu Navy + đỏ mận; tương phản tính theo WCAG, chữ/nền ghi ở cột cuối):

| Token | Sáng | Tối | Tương phản sáng / tối |
|---|---|---|---|
| `--av2-paper` | `#FAF6EF` | `#1C1A16` | ink trên paper 16.15 / 13.97 |
| `--av2-surface` | `#FFFFFF` | `#24211C` | ink trên surface 17.40 / 12.90 |
| `--av2-off` | `#E8E2D5` | `#2F2B25` | muted trên off 5.32 / 6.02 |
| `--av2-ink` | `#1B1A17` | `#EDE6D6` | — |
| `--av2-muted` | `#5E5A52` | `#B2A994` | muted trên paper 6.37 / 7.44 |
| `--av2-rule` | `#D8D0C0` | `#3F3A31` | chỉ trang trí |
| `--av2-accent` | `#1A3561` | `#A3B8DF` | chữ trên accent 12.17 / 8.67 |
| `--av2-accent-hover` | `#11254A` | `#C0D0EC` | 15.14 / 11.15 |
| `--av2-link` | `#1A3561` | `#AFC3E8` | link trên paper 11.30 / 9.76 |
| `--av2-mark` | `#8A1C1C` | `#E8A29A` | mark trên paper 8.61 / 8.33 |
| `--av2-danger` | `#9B1C1C` | `#F2958B` | danger trên surface 8.15 / 7.22 |
| `--av2-ok` | `#1F6B3A` | `#93CBA3` | ok trên surface 6.52 / 8.64 |
| `--av2-tint` | `#EEF0F5` | `#262A33` | ink trên tint 15.26 / 11.56 |
| `--av2-on-accent` (thay `--av2-on-dark`) | `#FFFFFF` | `#1C1A16` | — |
| `--av2-highlight` (mới) | `#F6E3A1` | `#655120` | ink trên highlight 13.61 / 6.14 |
| `--av2-warn-bg` (mới) | `#F7EFEF` | `#3C302B` | mark trên nền 8.19 / 6.10 |
| `--av2-error-bg` (mới) | `#F8EFEF` | `#3D2F29` | danger trên nền 7.21 / 5.77 |
| `--av2-ok-bg` (mới) | `#EFF5F1` | `#31352C` | ok trên nền 5.90 / 6.75 |
| `--av2-qr-bg` / `--av2-qr-ink` (mới) | `#FFFFFF` / `#111111` | giữ nguyên | QR luôn nền trắng |
| `--av2-logo-mark` (mới) | `var(--av2-mark)` | `var(--av2-ink)` | logo một màu ở tối |

Các con số trên do người thiết kế tính; người thực thi phải tính lại bằng test (FR-03-D4) chứ không tin bảng.

**Đã được anh Andy duyệt ngày 17/11/2026:** FR-03-D2 và FR-03-D3 (ba lựa chọn Sáng · Tối · Theo thiết bị thay nút lật hiện nay; lưu trên trình duyệt), FR-03-D6 (các vùng luôn sáng). FR-03-D7: phòng thi full test luôn sáng (phương án A) — đã chốt.

**Yêu cầu:**
- **FR-03-D1** Mọi token màu v2 có giá trị cho `:root[data-theme="light"]`, `:root[data-theme="dark"]`, và khối `@media (prefers-color-scheme: dark) { :root:not([data-theme]) }` (cho lúc JS chưa chạy). Cấu trúc này chép từ `tokens.css` cũ.
- **FR-03-D2** Thứ tự ưu tiên giữ như cũ: giá trị `av-theme` đã lưu (`light` | `dark`) → `prefers-color-scheme` → sáng. "Theo thiết bị" = XOÁ khoá `av-theme` (không thêm giá trị thứ ba), để đoạn chống nháy đang có không phải sửa.
- **FR-03-D3** Component `ThemeMenu` có ba lựa chọn Sáng · Tối · Theo thiết bị; đổi là áp ngay; các tab khác đổi theo qua sự kiện `storage`; khi đang "Theo thiết bị" thì nghe thay đổi của `prefers-color-scheme`. Vị trí: menu tài khoản của `LearnerShell` và trang Tài khoản; nút biểu tượng trên `PublicShell` và `StaffShell`; trong menu trên điện thoại. Dùng lại `frontend/public/js/theme-toggle.js` / `lib/theme-toggle.mjs` (`setStoredTheme(null)` đã có sẵn).
- **FR-03-D4** Test tự động tính tương phản WCAG cho các cặp chữ/nền ở bảng trên, cả sáng và tối: chữ thường ≥ 4.5, chữ lớn và viền thành phần ≥ 3. Test đọc giá trị từ file token, không ghi lại số.
- **FR-03-D5** Trong CSS v2 không có mã màu ngoài file token; không dùng `opacity` để tạo màu phụ. Có test quét (dùng lại cách quét của G03-T11).
- **FR-03-D6** Luôn sáng dù web đang tối: thư email, bản in (`@media print`), vùng mã QR thanh toán, ảnh đề Task 1 (thêm viền). Cách làm: lớp bọc đặt lại bộ biến sáng.
- **FR-03-D7** Phòng thi full test: LUÔN SÁNG (phương án A, đã chốt); viết thành một cờ cấu hình `EXAM_ROOM_FOLLOWS_THEME=false` để đổi sang phương án B không phải sửa mã. Bài kiểm tra của khoá và luyện từng phần theo chế độ của web. Không đụng hộp Settings riêng của phòng thi Reading (khoá `ielts-exam-theme`).
- **FR-03-D8** Thẻ `meta name="theme-color"` có hai giá trị theo chế độ.
- **FR-03-D9** Trang cũ chưa dựng lại vẫn dùng bộ `--av-*` cũ và giữ sáng/tối như hiện nay; hai cây dùng chung `data-theme` nên đổi chế độ áp cho cả hai.


## 6. Nhiệm vụ (theo thứ tự phụ thuộc)

### G03-T01 — Soạn thư mục spec, mở PR spec, DỪNG chờ duyệt
- **Mục đích:** quy ước chung mục 4.6.
- **Đầu vào:** `specs/_templates/*`, `specs/README.md`, `specs/_meta/constitution.md`, file này.
- **Việc làm:** tạo `specs/<NNNN>-ui-foundation/` gồm `spec.md` (frontmatter `id: UIBASE-<NNNN>`, `status: draft`, `risk: medium`; Problem = mục 1; Scope/Non-goals = mục 3; Requirements = FR-03-001…015 đổi tên thành FR-001…015; Acceptance scenarios, Edge cases, Open questions = mục 4), `plan.md` (mục 5), `tasks.md` (T02–T17 với `depends:` và `owns:` theo mục 6), `verification.md` (bảng FR → bằng chứng dự kiến, kết quả `PENDING`), `ui-states.md` (bảng 5.4 và 5.5 cột "Trạng thái"). Thêm dòng vào bảng chỉ mục `specs/README.md`. Chạy `python backend/scripts/validate_specs.py`.
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
- **Mục đích:** FR-03-013, FR-03-014. Làm sớm để mỗi PR component sau thêm mục + ảnh mốc.
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
- **Mục đích:** FR-03-002, 003, 015.
- **Đầu vào:** mục 5.7, 5.8; `components/authed-shell.tsx`; `components/chrome-navigation-bridge.tsx`; `tests/authed-shell.test.mjs`; `tests/csp-nonce-*.test.mjs`; `tests/react/admin-chrome-navigation.test.tsx`. Phụ thuộc T02, T11.
- **Việc làm:**
  1. Thêm prop `design` theo 5.7.1; bọc các `<link>`/`<Script>` cũ trong `design === 'v1' && …` mà không đổi thứ tự xuất hiện trong nguồn.
  2. Trước khi sửa, lưu HTML `<head>` của `/home`, `/profile`, `/admin` từ `next start` (`curl -s`); sau khi sửa so lại → giống hệt (bằng chứng FR-03-003 trong PR).
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
- **Việc làm:** dựng các phần ở bảng 5.5, gồm hai slot chuông/quá hạn (hiện đúng vị trí tờ khi được truyền, `/ui-library` dùng bản mẫu ba trạng thái của tờ), `QuickLookup` với dữ liệu mẫu, và biến thể tài khoản chưa có khoá (`trialLeft`); khung không gắn cổng kích hoạt (FR-03-007a); mục đang ở = `sectionFor(usePathname())`; `canSwitchToAdmin` chỉ true khi hồ sơ `/auth/me` có vai trò admin; ẩn thanh dưới khi `visualViewport.height` giảm >25% (bàn phím ảo) và trong `FocusShell`. Hiện trong `/ui-library` với dữ liệu mẫu ba kích thước; thay trang thử `v2-pilot` của T12 bằng một trang thử dùng `LearnerShell`, rồi gỡ trang thử trước khi merge nếu G07 chưa cần.
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
- **Việc làm:** dựng phần ở bảng 5.5 với `nav` truyền vào; dữ liệu mẫu 8 nhóm trong `/ui-library` theo quy ước chung mục 2.8 (Tổng quan · Học viên và quyền truy cập · Khoá học và bán hàng · Chấm bài · Nội dung · Thi thử · Báo cáo · Hệ thống); giáo viên 5 mục phẳng theo G09-T20 (trang đầu "Việc của tôi"; danh sách mục lấy từ `nav` G09 truyền, `/ui-library` dùng dữ liệu mẫu theo `thiet-ke/CHUAN-ADMIN.md` mục A); `ThemeMenu` ở thanh trên; quy tắc 1024px theo FR-03-010a (sidebar icon, bảng cuộn ngang giữ cột đầu — phần bảng nằm ở `DataTable` của T08: thêm prop `stickyFirstColumn`). `QuickSearch` nhận hàm tìm; ⌘K/Ctrl+K mở, ↑↓ Enter Esc.
- **Đầu ra:** 1 PR. **Nghiệm thu:** test React: nhóm chứa trang hiện tại mở; nhãn môi trường hiện cả khi thu; Esc đóng tìm nhanh; ảnh chụp 1280/1100/1024/390.
- **Không làm:** không thay `<aver-admin-chrome>` ở trang admin nào (G09-T08); không dựng ba trang của tờ `Admin1024.dc.html` (G09-T17, T18, T29 — tờ đã có trong `thiet-ke/`).
- **Ước lượng:** 2 phiên · độ khó 3.

### G03-T18 — Chế độ tối cho cây v2
- **Mục đích:** giao diện mới có sáng và tối, không làm mất tính năng đang có.
- **Phụ thuộc:** sau G03-T02 (token) và G03-T04 (`/ui-library`, test ảnh chụp); trước G03-T12…T16 (các khung) để khung dựng ra đã đủ hai chế độ.
- **Đầu vào:** mục 5.9; ba tờ `CheDoToi*`; `frontend/public/css/aver-design/tokens.css` dòng 200–370; `frontend/public/js/theme-toggle.js`; `frontend/components/theme-toggle-button.tsx`; `frontend/components/authed-shell.tsx` (đoạn chống nháy).
- **Việc làm:** (1) thêm khối giá trị tối và khối `prefers-color-scheme` vào file token v2; (2) thêm các token mới ở bảng, thay mọi chỗ component v2 đang dùng màu cứng cho tô sáng, nền cảnh báo, chữ trên nút; (3) viết `ThemeMenu` và test đơn vị cho ba lựa chọn, sự kiện `storage`, thay đổi của thiết bị; (4) trang `/ui-library` thêm công tắc xem cả hai chế độ, test ảnh chụp chạy ở cả sáng và tối; (5) test tương phản FR-03-D4 và test quét FR-03-D5; (6) lớp bọc "luôn sáng" FR-03-D6 kèm ví dụ trên `/ui-library`.
- **Đầu ra:** 2 PR (token + test; `ThemeMenu` + `/ui-library`).
- **Nghiệm thu:** `npm test` trong `frontend` qua, gồm test tương phản và test quét; mở `/ui-library` ở sáng, tối, và khi xoá `av-theme` với thiết bị đặt tối: không nháy sáng lúc tải lại; đổi ở tab này thì tab kia đổi theo; in thử một trang ra PDF vẫn nền sáng.
- **Không làm:** không sửa `tokens.css` cũ; không viết kiểu tối riêng cho từng trang (chỉ qua token); không lưu chế độ theo tài khoản; không đụng `ielts-exam-theme`.
- **Vướng mắc → cách gỡ:** (a) ảnh chụp tăng gấp đôi làm CI chậm → chỉ chụp tối cho trang `/ui-library` và mỗi khung một trang đại diện; (b) component bên thứ ba hoặc SVG ghi màu cứng → đổi sang `currentColor` hoặc token, không thêm ngoại lệ vào test quét; (c) trang cũ nhúng trong khung mới lệch tông (bộ tối cũ là navy lạnh, bộ mới là mực ấm) → chấp nhận trong giai đoạn chuyển tiếp, ghi vào `verification.md`, không sửa bộ cũ; (d) test tương phản rớt ở một cặp → sửa giá trị token rồi báo lại trong PR, không hạ ngưỡng.
- **Ước lượng:** 3 phiên · độ khó 3.

### G03-T17 — Đối chiếu cuối và cập nhật `verification.md`
- **Việc làm:** chạy toàn bộ lệnh ở quy ước mục 5.3; điền bằng chứng từng FR vào `specs/<NNNN>-ui-foundation/verification.md`; liệt kê chỗ lệch với tờ thiết kế còn mở; chuyển spec sang `verified` chỉ khi mọi FR có bằng chứng.
- **Đầu ra:** 1 PR tài liệu. **Ước lượng:** 1 phiên · độ khó 1.

## 7. Vướng mắc chung của gói và cách tháo gỡ

| Tình huống | Dấu hiệu | Cách gỡ | Khi nào dừng và hỏi |
|---|---|---|---|
| CSS cũ lọt vào trang mới | Ảnh chụp lệch; `getComputedStyle` ra Plus Jakarta Sans; `document.styleSheets` có `/css/…` | Kiểm ranh giới tải lại (T12); kiểm layout v2 không đi qua nhánh `v1` | Lỗi chỉ xuất hiện khi điều hướng mềm mà không chặn được |
| Thứ tự cascade v1 bị đổi | `authed-shell.test.mjs` đỏ; so `<head>` khác | Hoàn lại; chỉ bọc điều kiện, không dời dòng | Cần dời dòng mới làm được |
| CSP nonce | `csp-nonce-*` đỏ vì số `<script`, matcher, `instant` | Không thêm script nội tuyến; mọi JS của khung là component React | Cần script nội tuyến mới |
| Tailwind không quét TSX | Class utility không có tác dụng | Không dùng Tailwind trong cây v2 | — |
| `components/ui` không được kiểm kiểu | Lỗi kiểu chỉ hiện khi có trang import | `/ui-library` import mọi component; chạy `npx tsc --noEmit` | — |
| `next/font` trong vitest | Test React lỗi khi import font | Component không import `styles/av2/fonts.ts` | — |
| Ảnh mốc chập chờn | Khác vài pixel giữa các lần | `animations: 'disabled'`, chờ `document.fonts.ready`, không ảnh mạng, không ngày giờ thật (truyền ngày cố định) | Ngưỡng phải nới quá 0,5% |
| Workflow bắt buộc | Đổi tên job làm cổng promotion mất check | Chỉ thêm bước vào job sẵn có | Cần job mới phải là required check |
| Next 16 khác trí nhớ | API `next/font`, `notFound`, `cacheComponents` lạ | Đọc `frontend/node_modules/next/dist/docs/` trước | — |
| Tờ thiết kế đổi sau khi đã dựng | Anh sửa tờ | Cập nhật component + ảnh mốc trong PR riêng, ghi "theo tờ Version …" | Thay đổi phá API component đã có người dùng |
| Vỡ nhiều test ngoài dự kiến | >30 test đỏ | Dừng, báo danh sách | Luôn |

## 8. Ràng buộc riêng của gói

- Không đổi giao diện hay `<head>` của bất kỳ trang cũ nào (bằng chứng: so `<head>` ở T12).
- Token mới chỉ tiền tố `--av2-`; không sửa giá trị `--av-*`.
- Không emoji; chữ giao diện tiếng Việt; component có `lang` thì toàn tiếng Anh khi `lang='en'`.
- Không thêm dependency npm mới nếu chưa có quyết định của anh (mục 10, câu 4).
- Mọi giá, tên khoá, số lượt AI trong `/ui-library` là `XXX`.
- Dữ liệu mẫu trong `/ui-library` là tên giả (như trong tờ), không lấy học viên thật.

## 9. Kiểm thử và bằng chứng hoàn tất của cả gói

- **Local:** bộ đầy đủ ở quy ước mục 5.3; `npx playwright test -c playwright.visual.config.js` trong Docker Linux.
- **CI:** job "Next-native browser regression" xanh gồm bước ảnh chụp.
- **Staging (sau merge, chỉ xem):** `/terms`, `/privacy`, `/contact`, `/about` dùng khung công khai mới; `/home`, `/admin` không đổi gì (so ảnh chụp trước/sau bằng mắt); `/ui-library` trả 404.
- **Kịch bản đầu-cuối:** 7 kịch bản ở mục 4.
- **Bằng chứng anh xem bằng mắt:** ảnh chụp `/ui-library` từng mục ở 1280 và 390 (artifact CI hoặc thư mục `__screenshots__`) đặt cạnh tờ thiết kế.
- **Không làm trên production:** không bật cờ chẩn đoán, không thử đăng xuất/đổi vai trò.

## 10. Cần anh Andy quyết

1. **Duyệt 6 tờ Thành phần** — ĐÃ TRẢ LỜI 17/11 ("Duyệt Canva: anh duyệt rồi"; 00 mục 6): đã duyệt; mã T02 trở đi chỉ chờ spec được duyệt.
2. **Chế độ nền tối cho giao diện mới.** ĐÃ CHỐT ngày 17/11/2026: làm ngay trong gói này (mục 5.9, nhiệm vụ G03-T18). Phòng thi full test: luôn sáng (phương án A), đã chốt ngày 17/11/2026.
3. **Xem `/ui-library` ở đâu.** Đề nghị: qua ảnh chụp trong artifact CI; khi cần xem trực tiếp, bật `AVER_ENABLE_DIAGNOSTIC_ROUTES=1` cho riêng bản preview Vercel của nhánh `preview/ui-library` (anh đặt biến môi trường). Mặc định tạm: chỉ artifact CI và local.
4. **Bộ icon.** KHÔNG CÒN HỎI: bộ 94 icon của tờ ThanhPhanNenTang, G11-T32 dựng (G03-T03 ĐÃ BỎ).
7. **Tờ `Admin1024.dc.html`** (ba trang admin ở 1024px) đã có trong `thiet-ke/` (18/11). Mặc định: G09-T17, T18, T29 dựng ba trang theo tờ; các trang admin khác áp quy tắc chung FR-03-010a.
8. **Nguồn dữ liệu của nút tra nhanh** (từ vựng, bài ngữ pháp, đề bài mẫu): gộp ba API tìm hiện có ở trình duyệt hay một API tìm chung mới? Đề nghị: gộp ở trình duyệt trong đợt đầu (G06 nối). Mặc định tạm: như đề nghị; G03 chỉ dựng giao diện.
5. **"Khoá học"/"Xem các khoá" trên khung công khai khi `/courses` chưa có** (G05). Đề nghị: tạm trỏ `/`, đổi khi G05 merge. Mặc định tạm: như đề nghị.
6. **Gộp các bảng route cũ** (`ROUTE_LEDGER.md`, `PUBLIC_BY_DESIGN`, matcher `proxy.ts`, `robots.ts`) vào danh mục mới. Đề nghị: để G10 sau khi danh mục chạy ổn một thời gian. Mặc định tạm: giữ song song, không gộp ở G03.
