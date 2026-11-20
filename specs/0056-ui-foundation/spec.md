---
id: UIBASE-0056
title: New pages share one Ban in design foundation of tokens, fonts, components and four page shells, while every existing page keeps its current look
status: approved
risk: medium
owner: product
---

# New pages share one Ban in design foundation of tokens, fonts, components and four page shells, while every existing page keeps its current look

Status: **approved** — anh Andy duyệt ngày 20/11/2026 lúc 11:04 giờ Việt Nam (04:04:45 UTC), nguyên văn ở [`approval-decision.md`](approval-decision.md). Soạn ngày 18/11/2026 cho nhiệm vụ `G03-T01` (đợt A, thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-03-nen-giao-dien.md` và `00-QUY-UOC-CHUNG.md` mục 2 (bản trên `staging` sau PR #2331). Chưa dòng mã nào chạy theo spec này; mọi hợp đồng kỹ thuật là đề xuất đã kiểm trên giấy (BAN-GIAO mục 7). Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi vào `approval-decision.md` cùng thư mục, nguyên văn kèm thời điểm, và `status` đổi sang `approved`. Số spec 0056 lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6. Gói này không có migration.

## Tóm tắt (tiếng Việt)

- **Mục tiêu.** Dựng nền để các gói sau làm giao diện mới mà không phải sửa từng màn: bộ token v2, hai font Source Serif 4 + Source Sans 3 có tiếng Việt, một bộ icon, khoảng 25 component React dùng chung trong `frontend/components/ui/`, bốn khung trang (công khai · học viên 5 mục có bản máy tính bảng/điện thoại · thanh tập trung VN/EN · admin/giáo viên) thay cho hai thanh điều hướng JS cũ, một danh mục trang duy nhất có test CI, một trang thư viện component nội bộ để kiểm bằng mắt và test ảnh chụp cho component. Người dùng cuối chưa thấy thay đổi nào ở trang cũ; trang thật đầu tiên dùng nền mới là bốn trang pháp lý (G02-T13) để kiểm cơ chế.
- **Lớp thay đổi:** `feature` (không thuộc nhóm `high-risk`: không đổi chấm điểm, lưu kết quả, RLS, mã kích hoạt). Mã spec **UIBASE-0056**, rủi ro `medium` (số đã cấp ở `01-KE-HOACH-TONG.md` mục 6; anh Andy là người duy nhất vận hành repo, bảng đó là sổ cấp số; người thực thi kiểm số chưa bị dùng rồi ghi vào sổ đăng ký trong repo).
- **Phụ thuộc.**
  - 6 tờ Thành phần (`ThanhPhan`, `ThanhPhanDuLieu`, `ThanhPhanHocTap`, `ThanhPhanHocTap2`, `ThanhPhanKhungTrang`, `ThanhPhanKhungTrang2`) đã được anh Andy duyệt ngày 17/11 (00 mục 6, sửa 18/11 theo rà soát). Theo `thiet-ke/quy-tac-thiet-ke-ban-in.md` mục 2, design system rút ra từ tờ đã duyệt. T01 (spec) làm được ngay; mã chờ duyệt spec.
  - Song song: G01, G02, G04. G02-T13 phải merge trước G03-T13.
  - Sau: G05, G06, G07, G08, G09 dùng component và khung của gói này. G09 cung cấp dữ liệu sidebar admin 8 nhóm và khung giáo viên 5 mục (G09 là chuẩn điều hướng admin, không theo spec 0049 — 00 mục 2 điểm 20); G04 cung cấp API số lượt AI (một kho chung); GOI-11 cung cấp component chuông, thẻ quá hạn (G11-T11) và bộ 94 icon (G11-T32 thay G03-T03); G05-T21 cấp nội dung mục "Chấm thử" của menu công khai; G05-T20 cấp màn "một phiên" 8a–8c.
- **Ước lượng (giả định).** 17 nhiệm vụ còn hiệu lực (T01, T02, T04–T18; T03 ĐÃ BỎ), 18 PR (T18 hai PR), khoảng 27 phiên agent — cộng từ dòng "Ước lượng" của từng nhiệm vụ (bản 16/11 ghi 17 PR / 25 phiên, chưa tính T18 thêm ngày 17/11). Độ khó 2–4; cao nhất là T12 (cùng tồn tại với cascade cũ, CSP nonce, điều hướng mềm) và T14 (khung học viên ba kích thước). Giả định: tờ thiết kế không đổi lớn sau khi duyệt; CI có Chromium Linux ổn định để chụp ảnh; mỗi PR qua CI trong 1–2 vòng. Đây là ước lượng, không phải cam kết.

### Ghi chú khớp chéo của gói (chép nguyên)

**Khớp chéo ngày 18/11/2026:** `LearnerShell` có slot chuông và thẻ "N quá hạn" (component của GOI-11 phần A), nút tra nhanh, chỗ "Chấm thử hôm nay còn N bài" thay lượt AI cho tài khoản chưa có khoá, và chạy được không có cổng kích hoạt; `StaffTopBar` nhãn "Giáo viên", có điều khiển Sáng · Tối · Theo thiết bị; khung giáo viên 5 mục (theo G09); `PublicTopNav` có slot "Chấm thử" ở menu điện thoại (G05-T21 cấp nội dung); bốn trang pháp lý nằm ở `(public-v2)` (G05-T06, T07 sửa nội dung tại đó); quy tắc admin ở 1024px (sidebar thu thành icon, bảng cuộn ngang giữ cột đầu) — tờ `Admin1024.dc.html` đang được vẽ, sẽ có; thoát bài thi không còn "Save and exit"; G03-T03 ĐÃ BỎ (thay bằng G11-T32: bộ 94 icon nét 2 của tờ ThanhPhanNenTang); bỏ ghi chú "GOI-11 thắng" vì nội dung đã vào thân. Ước lượng: 17 nhiệm vụ còn hiệu lực, 18 PR, khoảng 27 phiên.

## Problem

Giao diện mới "Bản in" (00 mục 2 điểm 10, 16, 17) cần một nền chung để G05–G09 dựng màn mà không sửa từng trang,
trong khi mọi trang cũ phải giữ nguyên `<head>`, cascade CSS và hai thanh điều hướng Shadow DOM. Hiện trạng repo mà
gói đã đọc (staging @ 93c7085):

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

## Scope

1. Token v2 tiền tố `--av2-` (chỉ chế độ sáng), file CSS nền có phạm vi.
2. Font Source Serif 4 + Source Sans 3 qua `next/font/google`, chỉ nạp ở cây giao diện mới.
3. (Chuyển sang G11-T32) Bộ icon: 94 icon tự vẽ nét 2 của tờ ThanhPhanNenTang, render SVG tĩnh trong React; G03 giữ API `Icon`.
4. Component trong `frontend/components/ui/` theo 6 tờ Thành phần (bảng 5.4).
5. Bốn khung trang trong `frontend/components/ui/shell/` (bảng 5.5).
6. Cơ chế cùng tồn tại: `AuthedShell` thêm chế độ `design="v2"`, ranh giới điều hướng cứng giữa cây cũ và mới.
7. Danh mục trang `frontend/lib/route-registry.mjs` + test CI.
8. Trang thư viện component `/ui-library` (chỉ bật khi chẩn đoán) + test ảnh chụp chạy trong job CI sẵn có.
9. Chuyển bốn trang pháp lý của G02-T13 sang khung công khai mới (trang thật đầu tiên).

## Non-goals

- Chuyển bất kỳ trang học viên/admin cũ nào sang giao diện mới (G05–G09).
- Hub mới `/course`, `/practice`, `/tests`, `/library`, `/progress`, `/account`, `/help` và chuyển hướng 16 đường dẫn (G07). G03 chỉ khai các đường dẫn này trong danh mục với trạng thái `planned`.
- Dữ liệu sidebar admin 8 nhóm và tìm nhanh thật (G09); API số lượt AI (G04).
- Vòng đời phát audio/video thật, đồng hồ thi thật, nộp bài (G07/G08). G03 làm component hiển thị có props điều khiển.
- Xoá `aver-chrome.js`, `aver-admin-chrome.js`, `tokens.css`, CSS trang cũ (xoá khi trang cuối cùng đã chuyển; G10).

## Users and journeys

- Người học và khách: thấy trang mới dùng khung công khai/học viên/tập trung với chữ, màu, icon thống nhất; trang cũ không đổi.
- Admin và giáo viên: khung `StaffShell` có nhãn môi trường, nhãn vai trò, sidebar nhóm gập/mở (dữ liệu do G09).
- Người thực thi các gói sau (G05–G09): dùng component trong `frontend/components/ui/` và danh mục trang; xem trạng thái ở `/ui-library` và ảnh mốc CI.

## Requirements

Đánh số theo gói (FR-03-NNN → FR-NNN, giữ số). Ba FR có hậu tố chữ trong gói được cấp số mới vì validator chỉ nhận
`FR-NNN`: FR-03-007a → FR-016, FR-03-007b → FR-017, FR-03-010a → FR-018; tám FR chế độ tối FR-03-D1…D8 → FR-019…FR-026 (mọi chỗ dẫn chiếu trong thư mục này đã đổi theo).

- **FR-001:** Token v2 có đủ nhóm: màu (14 vai trò), chữ (2 họ, 11 cỡ, 2 độ đậm, line-height), khoảng cách, bo góc 2px, đường kẻ, focus ring, chiều cao điều khiển, điểm gãy (ghi hằng số), lớp z. Không token v2 nào trùng tên `--av-*`.
- **FR-002:** Trang dùng giao diện mới không nạp `tokens.css`, `components.css`, `ds.css`, CSS trang cũ, `tailwind.build.css`, `aver-chrome.js`, `aver-admin-chrome.js`.
- **FR-003:** Trang cũ (mọi route chưa chuyển) có HTML `<head>` giống hệt trước gói: cùng `<link>` theo cùng thứ tự, cùng script.
- **FR-004:** Hai font có ký tự tiếng Việt đủ dấu chồng ở cỡ 13–96px và độ đậm 400/600; ký tự IPA (`ə ʃ ʒ θ ð ŋ ˈ ˌ ː`) hiển thị bằng Source Sans 3. Trang cũ không tải hai font này.
- **FR-005:** Mỗi component trong bảng 5.4 có đủ trạng thái ghi trong bảng, dùng được bằng bàn phím, có tên đọc cho trình đọc màn hình, đạt tương phản AA, vùng bấm tối thiểu 44px (admin 36px).
- **FR-006:** Một bộ icon: mọi icon trong component mới qua `<Icon name>`; không emoji, không runtime lucide, không SVG viết tay ngoài thư mục icon. Bộ icon là **94 icon tự vẽ nét 2 của tờ ThanhPhanNenTang**, do G11-T32 dựng (thay G03-T03); API `Icon`/`IconName` giữ như mục 5.4.
- **FR-007:** Khung học viên: 5 mục cố định Hôm nay · Lộ trình · Luyện tập · Thi thử · Thư viện; ≥1024px một hàng; 768–1023px nút "Menu: <mục đang ở>"; <768px thanh dưới 64px; mục đang ở có gạch 3px và chữ đậm; mục đang ở tự suy từ danh mục trang, không ghi tay ở từng trang. Bên phải thanh trên, theo thứ tự của tờ ThanhPhanKhungTrang mục 1: chỉ báo lượt AI · thẻ "N quá hạn" · chuông · nút tra nhanh (kính lúp, từ 768px) · nút tài khoản. Chỉ một trong ba (ô tra, ngăn thông báo, menu tài khoản) mở một lúc.
- **FR-016:** _(trong gói: FR-03-007a)_ (mới) Đã đăng nhập thì luôn dùng khung học viên 5 mục, **kể cả tài khoản chưa có khoá** (`users.is_active=false`): `LearnerShell` không tự gắn cổng kích hoạt và không gọi API nào bị cổng kích hoạt chặn; việc trang nào cần cổng do layout của trang quyết (G07-T26 mở `/home`; G05 dùng cho `/courses`, `/enroll`, `/activate`). Tài khoản chưa có khoá: chỗ lượt AI hiện "Chấm thử hôm nay còn N bài" hoặc để trống (dữ liệu do trang truyền vào).
- **FR-017:** _(trong gói: FR-03-007b)_ (mới) Nút tra nhanh: bấm kính lúp hoặc phím `/` mở ô tra, tiêu điểm vào ô; gợi ý theo ba nhóm (Từ vựng · Bài ngữ pháp · Đề bài mẫu Writing), tối đa 2 dòng mỗi nhóm, mũi tên chọn, Enter mở, Esc đóng và trả tiêu điểm; không có gợi ý: "Không thấy kết quả. Thử từ khác hoặc vào Thư viện." Điện thoại: không có nút trên thanh (ô tra đặt đầu trang Thư viện — G06). G03 dựng giao diện nhận hàm `lookup(query)`; nguồn dữ liệu (API tìm của Grammar, Vocabulary, Thư viện) do G06 nối.
- **FR-008:** Menu tài khoản đúng thứ tự Tiến độ · Khoá học và lượt AI · Hồ sơ · Trợ giúp · (Đổi vai trò, chỉ khi máy chủ xác nhận admin) · Đăng xuất; đóng bằng bấm lại, bấm ra ngoài, Esc; tiêu điểm trở về nút.
- **FR-009:** Thanh tập trung có hai bản không trộn nhãn: luyện (nền giấy, tiếng Việt), thi (nền mực, tiếng Anh); hỏi lại chỉ khi thoát sẽ mất bài; không chân trang, không lượt AI, không nút tài khoản, không chuông. Bản thi: **không có "Save and exit"** — nút thoát là "Leave test", hộp hỏi lại ghi đồng hồ vẫn chạy; đề tự chọn có thêm "Abandon test" (00 mục 2 điểm 22; chi tiết ở GOI-08 FR-08-011, 041). Phòng thi full test luôn sáng (FR-025).
- **FR-010:** Khung admin/giáo viên: thanh trên có nhãn môi trường không bao giờ ẩn (Production/Staging khác cả chữ và kiểu nền), nhãn vai trò "Quản trị"/"Giáo viên" (không dùng chữ khác cho giáo viên), điều khiển giao diện ba lựa chọn Sáng · Tối · Theo thiết bị (`ThemeMenu`, mục 5.9); sidebar nhóm gập/mở, nhóm chứa trang hiện tại luôn mở, ngăn kéo dưới 768px; khung giáo viên **5 mục phẳng** (danh sách mục do G09-T20 cấp qua `nav`).
- **FR-018:** _(trong gói: FR-03-010a)_ (mới) Quy tắc admin ở 1024px (áp cho mọi trang admin trong khoảng 1024–1199px): sidebar thu thành cột icon (có `aria-label` và tooltip, nhãn môi trường vẫn hiện); bảng rộng hơn vùng nội dung thì **cuộn ngang trong khung bảng và giữ cột đầu cố định**, trang không cuộn ngang; thanh hành động của bảng không bị đẩy ra ngoài. Tờ `Admin1024.dc.html` (ba trang Việc cần làm, Chấm Writing, Lớp) **đang được vẽ, sẽ có** — khi có thì ba trang đó theo tờ; các trang khác theo quy tắc chung này (GOI-09 FR-09-009, Q30).
- **FR-011:** Khung công khai: Thư viện · Khoá học · Đăng nhập (liên kết chữ) · nút "Xem các khoá"; chân trang đầy đủ; không thanh dưới. Menu điện thoại có một slot cho mục "Chấm thử" (prop `mobileExtraItem`): G05-T21 truyền mục này khi chương trình chấm thử đang mở; không truyền thì menu không có dòng trống. Khung công khai chỉ cho người chưa đăng nhập (trừ trang chủ — GOI-05 mục 10 câu 11).
- **FR-012:** Danh mục trang: mọi `page.tsx` có đúng một mục; mục nào không có file thì test báo (trừ `status: 'planned'`); mọi mục `kind` `nav`/`child` nối được tới một gốc điều hướng qua `parent`; mục `requires` có `parentOnMissing`.
- **FR-013:** Trang `/ui-library` hiện mọi component ở mọi trạng thái, 1280px và 390px; trả 404 trên staging/production trừ khi bật cờ chẩn đoán.
- **FR-014:** Test ảnh chụp chạy trong job CI "Next-native browser regression" sẵn có; khác ảnh mốc quá ngưỡng thì job đỏ; ảnh mốc chỉ cập nhật bằng PR có ghi lý do.
- **FR-015:** Đi từ trang cũ sang trang mới (và ngược lại) luôn là tải lại trang đầy đủ; không còn CSS của cây kia trong tài liệu.

Chế độ tối (gói mục 5.9, FR-03-D1…D8 → FR-019…FR-026; đã duyệt 17/11/2026):

- **FR-019:** Mọi token màu v2 có giá trị cho `:root[data-theme="light"]`, `:root[data-theme="dark"]`, và khối `@media (prefers-color-scheme: dark) { :root:not([data-theme]) }` (cho lúc JS chưa chạy). Cấu trúc này chép từ `tokens.css` cũ.
- **FR-020:** Thứ tự ưu tiên giữ như cũ: giá trị `av-theme` đã lưu (`light` | `dark`) → `prefers-color-scheme` → sáng. "Theo thiết bị" = XOÁ khoá `av-theme` (không thêm giá trị thứ ba), để đoạn chống nháy đang có không phải sửa.
- **FR-021:** Component `ThemeMenu` có ba lựa chọn Sáng · Tối · Theo thiết bị; đổi là áp ngay; các tab khác đổi theo qua sự kiện `storage`; khi đang "Theo thiết bị" thì nghe thay đổi của `prefers-color-scheme`. Vị trí: menu tài khoản của `LearnerShell` và trang Tài khoản; nút biểu tượng trên `PublicShell` và `StaffShell`; trong menu trên điện thoại. Dùng lại `frontend/public/js/theme-toggle.js` / `lib/theme-toggle.mjs` (`setStoredTheme(null)` đã có sẵn).
- **FR-022:** Test tự động tính tương phản WCAG cho các cặp chữ/nền ở bảng trên, cả sáng và tối: chữ thường ≥ 4.5, chữ lớn và viền thành phần ≥ 3. Test đọc giá trị từ file token, không ghi lại số.
- **FR-023:** Trong CSS v2 không có mã màu ngoài file token; không dùng `opacity` để tạo màu phụ. Có test quét (dùng lại cách quét của G03-T11).
- **FR-024:** Luôn sáng dù web đang tối: thư email, bản in (`@media print`), vùng mã QR thanh toán, ảnh đề Task 1 (thêm viền). Cách làm: lớp bọc đặt lại bộ biến sáng.
- **FR-025:** Phòng thi full test: LUÔN SÁNG (phương án A, đã chốt); viết thành một cờ cấu hình `EXAM_ROOM_FOLLOWS_THEME=false` để đổi sang phương án B không phải sửa mã. Bài kiểm tra của khoá và luyện từng phần theo chế độ của web. Không đụng hộp Settings riêng của phòng thi Reading (khoá `ielts-exam-theme`).
- **FR-026:** Thẻ `meta name="theme-color"` có hai giá trị theo chế độ.

## Acceptance scenarios

**Kịch bản chấp nhận (Given/When/Then, chép vào `spec.md`)**
1. Given trang `/terms` đã chuyển khung mới, When tải trang, Then `document.styleSheets` không có `/css/aver-design/tokens.css`, `getComputedStyle(document.body).fontFamily` bắt đầu bằng tên font Source Sans 3 do `next/font` sinh.
2. Given đang ở `/home` (khung cũ), When bấm một liên kết tới `/terms`, Then trình duyệt tải lại trang (sự kiện `load` mới), không còn `<link href="/css/home.css">`.
3. Given `/ui-library` mở ở 390px, When cuộn tới khung học viên, Then thấy thanh dưới 5 ô, mục "Luyện tập" có gạch trên và chữ đậm.
4. Given tài khoản không phải admin, When mở menu tài khoản trong khung học viên, Then không có dòng "Đổi vai trò" và không có chỗ trống thay nó.
5. Given một PR thêm `app/(x)/foo/page.tsx` mà không khai trong danh mục, When chạy bộ test frontend, Then test danh mục đỏ và nêu `/foo`.
6. Given `/ui-library` khi build không có `AVER_ENABLE_DIAGNOSTIC_ROUTES=1`, When mở, Then HTTP 404.
7. Given nút `Button` biến thể chính đang xử lý, When đọc bằng trình đọc màn hình, Then nghe nhãn "Đang nộp…" và nút `aria-disabled`.

## Edge cases

**Ca biên (chép vào `spec.md`):** người dùng hệ điều hành chế độ tối mở trang mới (anti-flash vẫn đặt `data-theme="dark"`); trình duyệt chặn font (fallback phải đọc được); trang mới mở modal (`<dialog>` ở top layer vẫn kế thừa biến CSS); bàn phím ảo mở trên điện thoại (thanh dưới ẩn); admin thu sidebar rồi tải lại; tài khoản bị đổi vai trò giữa phiên (dòng Đổi vai trò biến mất ở lần nạp sau); CSP nonce bật ở staging (trang mới không thêm script nội tuyến); điều hướng mềm từ trang mới tới trang mới (được phép, vẫn giữ CSS mới).

Bảng vướng mắc của gói (mục 7):

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

## Success criteria

- Bốn trang pháp lý chạy khung công khai mới trên staging, `/home` và `/admin` không đổi (so ảnh chụp trước/sau), `/ui-library` trả 404 trên staging (mục 9).
- Job CI "Next-native browser regression" xanh gồm bước ảnh chụp; ảnh mốc chỉ đổi qua PR có lý do.
- Mọi `page.tsx` có đúng một mục trong danh mục trang; test danh mục đỏ khi thiếu.

## Related specifications

- ADMINIA-0074 (G09): dữ liệu sidebar admin 8 nhóm, khu giáo viên 5 mục; G09 là chuẩn điều hướng admin, không theo ADMINSIMPLE-0049 (PR #2254).
- LEARNERNAV-0062, LEARNERCORE-0063 (G07): hub học viên, 16 đường dẫn đổi, dùng `LearnerShell`.
- COURSEACCESS-0055 (G04): số lượt AI cho `AiCreditsIndicator`.
- NOTIFY-0079 (GOI-11 phần A): chuông và thẻ quá hạn trong `LearnerShell`; BRANDMARK-0083: logo trong các khung; bộ 94 icon do G11-T32 dựng (thay G03-T03).
- TESTPOLICY-0057 (G10 mục a): chính sách ảnh mốc và job CI.

## Open questions

Mục 4 của gói ghi: câu hỏi mở chép từ mục 10. Câu đã trả lời giữ để đối chiếu.

1. **Duyệt 6 tờ Thành phần** — ĐÃ TRẢ LỜI 17/11 ("Duyệt Canva: anh duyệt rồi"; 00 mục 6): đã duyệt; mã T02 trở đi chỉ chờ spec được duyệt.
2. **Chế độ nền tối cho giao diện mới.** ĐÃ CHỐT ngày 17/11/2026: làm ngay trong gói này (mục 5.9, nhiệm vụ G03-T18). Phòng thi full test: luôn sáng (phương án A), đã chốt ngày 17/11/2026.
3. **Xem `/ui-library` ở đâu.** Đề nghị: qua ảnh chụp trong artifact CI; khi cần xem trực tiếp, bật `AVER_ENABLE_DIAGNOSTIC_ROUTES=1` cho riêng bản preview Vercel của nhánh `preview/ui-library` (anh đặt biến môi trường). Mặc định tạm: chỉ artifact CI và local.
4. **Bộ icon.** KHÔNG CÒN HỎI: bộ 94 icon của tờ ThanhPhanNenTang, G11-T32 dựng (G03-T03 ĐÃ BỎ).
7. **Tờ `Admin1024.dc.html`** (ba trang admin ở 1024px) đã có trong `thiet-ke/` (18/11). Mặc định: G09-T17, T18, T29 dựng ba trang theo tờ; các trang admin khác áp quy tắc chung FR-018.
8. **Nguồn dữ liệu của nút tra nhanh** (từ vựng, bài ngữ pháp, đề bài mẫu): gộp ba API tìm hiện có ở trình duyệt hay một API tìm chung mới? Đề nghị: gộp ở trình duyệt trong đợt đầu (G06 nối). Mặc định tạm: như đề nghị; G03 chỉ dựng giao diện.
5. **"Khoá học"/"Xem các khoá" trên khung công khai khi `/courses` chưa có** (G05). Đề nghị: tạm trỏ `/`, đổi khi G05 merge. Mặc định tạm: như đề nghị.
6. **Gộp các bảng route cũ** (`ROUTE_LEDGER.md`, `PUBLIC_BY_DESIGN`, matcher `proxy.ts`, `robots.ts`) vào danh mục mới. Đề nghị: để G10 sau khi danh mục chạy ổn một thời gian. Mặc định tạm: giữ song song, không gộp ở G03.
