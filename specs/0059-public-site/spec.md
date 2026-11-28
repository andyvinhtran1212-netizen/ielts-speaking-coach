---
id: PUBLICSITE-0059
title: Visitors see the new public home page, the six online courses with honest status and a free trial entry, legal pages and one consistent set of error pages, in light and dark mode
status: approved
risk: medium
owner: product
---

# Visitors see the new public home page, the six online courses with honest status and a free trial entry, legal pages and one consistent set of error pages, in light and dark mode

Status: **approved** — anh Andy duyệt 23/11/2026 18:08 giờ VN (xem `approval-decision.md`); soạn ngày 23/11/2026 cho nhiệm vụ `G05-T01` (thương mại hoá 2026-11), từ `docs/proposals/commercialization-2026-11/GOI-05-trang-cong-khai-va-dang-ky.md` (bản 18/11 chiều) nhóm A của mục 4, mục 5.1, 5.4, 5.5, phần `site-info` và `open-alerts` của 5.7, mục 9, 10. Chưa dòng mã nào chạy theo spec này. Chỉ anh Andy duyệt; khi duyệt, câu trả lời ghi nguyên văn kèm thời điểm vào `approval-decision.md` cùng thư mục và `status` đổi sang `approved`. Số 0059 lấy từ sổ cấp số ở `01-KE-HOACH-TONG.md` mục 6 và còn trống ở staging `31725a9b`. Spec này không có migration.

## Tóm tắt (tiếng Việt)

**Người dùng thấy gì.** Người lạ vào averlearning.com thấy trang chủ mới theo ngôn ngữ "Bản in" với lối "Xem các khoá học" và "Chấm thử một bài miễn phí" ngay phần mở đầu; danh mục sáu khoá online `/courses` với trạng thái thật (Đang mở đăng ký · Sắp mở · Bạn đang học · còn N ngày · Hết hạn) và nút "Báo cho tôi khi mở"; trang một khoá `/courses/[slug]` có chương, bài học thử, khối "Đăng ký khoá này bạn có gì", "Người soạn và giảng"; trang Điều khoản, Quyền riêng tư, Giới thiệu; khối liên hệ chung; một bộ trang lỗi thống nhất (404 hai khung, 403 ba ca, 500 có mã tham chiếu, bảo trì, mất mạng, phiên hết hạn, liên kết hỏng về trang cha); SEO đúng và `/pricing` về `/courses`. Mọi trang chạy đúng ở sáng và tối chỉ qua token G03.

**Tách hai spec (gói mục 1).** Spec này (`PUBLICSITE-0059`, risk `medium`) là phần trang đọc công khai. Đăng nhập, mã kích hoạt, đơn đăng ký, liên hệ có bảng, "Báo cho tôi khi mở" có bảng và thư thuộc `ENROLL-0060` (risk `high`). Ranh giới: nút "Báo cho tôi khi mở" và câu chữ ở `/courses`, trang khoá là của spec này (FR-022); bảng `course_open_alerts`, route `open-alerts`, thư là của ENROLL-0060 (G05-T22). Khối liên hệ (FR-026) và `GET /api/public/site-info` (G05-T23, không bảng) là của spec này; biểu mẫu `/contact` gửi đi (bảng `contact_messages`) là của ENROLL-0060 (G05-T07).

**Đối chiếu staging `31725a9b`.** G03 đã có `PublicShell` và bốn trang `/terms`, `/privacy`, `/contact`, `/about` trong `app/(public-v2)/` (#2444, nội dung tạm của G02-T13); G06 đã có `/library` (#2447). Chưa có `/courses`, `/courses/[slug]`, API khoá công khai của G04 (`GET /api/courses*`), `GET /api/trial/public-config` (TRIALCAP-0080), `frontend/lib/course-access-labels.mjs` (G11-T29). Danh mục trang G03 đã khai `/courses`, `/courses/[slug]` là `planned`. Khi API G04 chưa có, giao diện làm trên dữ liệu giả cùng kiểu (G05-T02, gói 5.3).

**Ngôn ngữ và đánh số.** Thân viết tiếng Việt; tiêu đề mục giữ tiếng Anh cho `validate_specs.py`. `FR-05-001…028` của gói → `FR-001…FR-028`, giữ số và giữ nguyên văn (chỉ đổi mã); tham chiếu sang nhóm B ghi `ENROLL-0060 FR-0NN`. Phần hợp đồng ở `plan.md` chép nguyên văn từ gói, đã đánh dấu chỗ khác với mã hiện tại.

## Quyết định đã có

- **Đề công khai và lối chấm thử:** chấm thử miễn phí Writing Task 1, Task 2, Speaking Part 2 là ngoại lệ có chủ đích của "nộp bài AI chấm thì cần khoá" (00 mục 2 điểm 22, FREETRIAL-0047 đã duyệt, TRIALCAP-0080). Tài khoản mã email được chấm thử như Google (gói câu 16, GOI-11 FR-11-031).
- **Lượt chưa dùng khi đăng ký lại:** chuyển toàn bộ, bảo lưu tối đa 2 tháng, không còn quy tắc 50%; bài làm xem được 45 ngày sau khi khoá hết hạn (00 mục 2 điểm 23). Số đọc từ API G04, không gõ trong mã (FR-024).
- **Khoá `status: closed` hiện nhãn "Tạm đóng đăng ký"** (anh Andy duyệt 23/11 13:21Z), không gọi là "Sắp mở"; dòng đếm ở `/courses` tách riêng "K khoá tạm đóng đăng ký". Hành vi khác như khoá sắp mở: không hiện học phí, có "Báo cho tôi khi mở".
- **Nhãn khoá hết hạn là "Đăng ký lại"** ở mọi nơi, lấy từ `course-access-labels.mjs` (GOI-11 phần F).
- **Khối "Học viên nói gì"** do G13-A10 dựng; spec này chỉ chừa chỗ (gói mục 3, câu 18).
- **Không viết nội dung pháp lý thật**; chỉ khung và nơi nạp nội dung (gói mục 3).

## Problem

Trang chủ hiện tại (`app/(marketing)/page.tsx`, 802 dòng) chưa có khoá học, chưa có lối chấm thử; `/pricing` chỉ `redirect('/')`; chưa có danh mục và trang khoá cho sáu khoá online sắp bán; trang lỗi chưa phân biệt người đã đăng nhập, chưa có 403 theo quyền khoá, chưa có màn bảo trì hay dải mất mạng thống nhất. Người lạ không có đường từ trang chủ tới đăng ký một khoá, và không biết khoá nào đang mở, khoá nào sắp mở.

## Scope

- Trang chủ `/` mới, có lối chấm thử và menu điện thoại; bản đã đăng nhập (FR-001…003, FR-021).
- `/courses` và `/courses/[slug]` cho sáu khoá online, gồm nút "Báo cho tôi khi mở" (FR-004…009, FR-022…025, FR-028).
- `/terms`, `/privacy`, `/about` theo khung tờ PhapLy (FR-010, FR-011); khối liên hệ chung và `GET /api/public/site-info` (FR-026).
- Bộ trang lỗi và dải trạng thái (FR-012…018).
- SEO và `/pricing` (FR-019, FR-020); sáng/tối và logo qua G03 (FR-027).
- Lớp dữ liệu thương mại phía frontend và dữ liệu giả (G05-T02).

## Non-goals

- Mọi thứ của ENROLL-0060: `/login`, đường quay lại `next`, `/activate`, đơn đăng ký, VietQR, biểu mẫu `/contact` gửi đi (bảng), bảng và thư "Báo cho tôi khi mở", đổi email, giao diện một phiên.
- Lược đồ và API khoá, quyền, lượt, đơn → COURSEACCESS-0055 (G04). Màn admin → G09.
- Màn chấm thử `/trial/*`, trần và API chấm thử → FREETRIAL-0047, TRIALCAP-0080. Spec này chỉ dựng lối vào.
- `Logo`, favicon, ảnh OG → GOI-11 phần G. `ThemeMenu`, token → G03. Khối "Học viên nói gì" → G13-A10. `/library` và nội dung Grammar/Vocabulary → G06.
- Nội dung pháp lý thật; cổng thanh toán tự động.

## Users and journeys

- Khách: xem trang chủ, chấm thử một bài, xem danh mục, mở trang khoá, bấm "Đăng ký khoá này" (sang ENROLL-0060), hoặc "Báo cho tôi khi mở".
- Học viên đã đăng nhập ghé `/`: nút "Vào học" về `/home`; ở `/courses` thấy khoá đang học kèm tiến độ và "Đăng ký lại" cho khoá hết hạn.
- Bất kỳ ai gặp link hỏng, trang không có, không đủ quyền, lỗi máy chủ, bảo trì, mất mạng: một màn rõ ràng có lối đi tiếp.

## Requirements

- **FR-001:** `/` hiện trang chủ theo `TrangChuCongKhai.dc.html` màn 1 (1280px) và màn 2 (390px). Phần mở đầu: nút chính "Xem các khoá học", nút phụ "Chấm thử một bài miễn phí", "Đọc thử Thư viện" là liên kết chữ (chi tiết ở FR-021). Mục lục sáu khoá theo thứ tự cố định Grammar, Listening, Reading, Writing, Speaking, Vocabulary Skills + Ideas, không đánh số; Course 1–5 không xuất hiện ngoài dòng "Bạn có mã kích hoạt từ lớp?" và câu hỏi thường gặp về lớp offline.
- **FR-002:** Đã đăng nhập ghé `/`: không chuyển hướng; phần phải thanh trên đổi thành nút tài khoản + "Vào học" (→ `/home`), hai lối ở phần mở đầu hạ thành nút phụ (màn 3). Đây là ngoại lệ duy nhất của quy tắc "đã đăng nhập dùng thanh học viên" (mục 10 câu 11).
- **FR-003:** Câu hỏi thường gặp ở `/`: mặc định mở câu 1, mở nhiều câu cùng lúc được, nút có `aria-expanded`, nội dung trả lời nằm sẵn trong HTML server.
- **FR-004:** Tên, tên ngắn, trình độ, học phí, thời hạn, lượt AI, ngày dự kiến mở đọc từ dữ liệu khoá; trường rỗng không hiện "0", "XXX" hay ô trống; khoá chưa mở đăng ký ghi "Sắp mở" (một nhãn duy nhất ở trang chủ, danh mục, trang khoá), không có nút đăng ký, không hiện học phí ("Học phí công bố khi mở đăng ký"); có ngày dự kiến thì hiện "Dự kiến mở: …", không có thì bỏ dòng.
- **FR-005:** `/courses` hiện bốn trạng thái theo người xem: Đang mở đăng ký · Sắp mở · Bạn đang học · còn N ngày · Hết hạn; cùng nhãn và màu với trang một khoá. Đã đăng nhập: dòng khoá đang học thay học phí bằng tiến độ; chỉ một nút chính "Vào học" trên trang (khoá còn hạn xa nhất). Khoá hết hạn: nút ghi "Đăng ký lại", lấy từ `accessActionLabel('expired')` của `frontend/lib/course-access-labels.mjs` (G11-T29), không gõ chuỗi tại chỗ.
- **FR-006:** Gợi ý chọn khoá ở `/courses` chạy hoàn toàn ở trình duyệt, không gọi API, không lưu, mặc định chọn câu đầu.
- **FR-007:** `/courses/[slug]` theo `TrangKhoaHoc.dc.html`: khối đăng ký dính (sticky) từ 1024px, dưới 1024px thành thanh dính đáy; chương gập/mở riêng, khách mặc định mở chương 1 và 2, người đã đăng ký mở chương chứa bài tiếp theo; bài "Học thử" bấm được cho mọi người; bài khác khi chưa đăng ký hiện tên, không bấm được; FAQ mỗi lúc mở một câu.
- **FR-008:** "Còn N ngày" lấy `viewer.days_left` của API (G04 làm tròn lên theo ngày giờ Việt Nam); N ≤ 0 hoặc `viewer.state='expired'` là "Hết hạn".
- **FR-009:** slug không tồn tại hoặc khoá không công khai (Course 1–5) → HTTP 404 thật (không phải 200 kèm thông báo).
- **FR-010:** `/terms` và `/privacy` dùng một mẫu trang văn bản dài; mục lục sinh từ các `h2`; mỗi điều có neo `#dieu-N`; mục lục dính từ 1024px, mục đang đọc gạch trái 3px + chữ đậm; 390px mục lục là khối mở/đóng, mặc định đóng. Ngày hiệu lực và ngày cập nhật là hai trường riêng.
- **FR-011:** `/about` dựng khung "Giới thiệu"; không có số liệu, tiểu sử, lời nhận xét cho tới khi có nguồn thật (khối đó ẩn khi trường rỗng).
- **FR-012:** 404: chưa đăng nhập → thanh và chân trang công khai (màn 1); đã đăng nhập → thanh học viên (màn 2). HTTP status vẫn 404 ở cả hai.
- **FR-013:** Liên kết thiếu/sai tham số ở trang con không hiện trang lỗi mà về trang cha cố định kèm dải thông báo đóng được, mất khi rời trang (màn 3). Bảng cặp trang con → trang cha ở mục 5.5.
- **FR-014:** Component 403 ba ca: 4a chưa có phiên (nút chính "Đăng nhập", kèm `next`); 4b có phiên, không có khoá chứa nội dung (nút chính tới trang khoá, thêm liên kết "Nhập mã kích hoạt của lớp"); 4c khoá hết hạn (khoá online: "Đăng ký lại"; khoá của lớp: "Hỏi giáo viên"). Ca được chọn bằng dữ liệu, không bằng mã HTTP.
- **FR-015:** 500: hiện mã tham chiếu (API: `X-Request-ID`; lỗi render: `error.digest`), không hiện thông báo kỹ thuật; "Thử lại" gọi lại đúng yêu cầu; "Sao chép mã" đổi nhãn "Đã sao chép" 3 giây, báo qua `role="status"`.
- **FR-016:** Bảo trì: khi cờ `maintenance_mode` bật, trang học viên hiện màn 6; trang công khai đọc vẫn mở; API ghi trả 503 có `code: "maintenance"`.
- **FR-017:** Mất mạng: dải trên cùng theo sự kiện `offline`/`online` và khi một lệnh lưu thất bại vì mạng; đang làm bài thì ghi giờ lưu thành công gần nhất; có mạng lại thì dải xanh 5 giây.
- **FR-018:** Phiên hết hạn (token hết hạn, không phải bị chiếm phiên — ca đó là ENROLL-0060 FR-052): lưu nháp đang soạn trước khi mở hộp thoại; đăng nhập lại thì về đúng trang; nhãn tiếng Anh nếu đang ở trang thi, còn lại tiếng Việt.
- **FR-019:** SEO: `/`, `/courses`, `/courses/[slug]` (khoá công khai), `/terms`, `/privacy`, `/contact`, `/about` có `title`, `description`, `canonical`, nằm trong sitemap, được `robots` cho phép; `/courses/[slug]/enroll`, `/enroll/*`, `/account/*`, `/activate` là `noindex`; `/enroll`, `/account`, `/activate` nằm trong `PRIVATE_PREFIXES`, còn `/courses/[slug]/enroll` chặn bằng dòng `Disallow: /courses/*/enroll` (không thêm được tiền tố vì `/courses` phải mở — T16). Ảnh `og:image` là ảnh do GOI-11 phần G cung cấp; G05 không vẽ ảnh riêng.
- **FR-020:** `/pricing` chuyển về `/courses` (kiểu chuyển: mục 10 câu 1).
- **FR-021:** (mới) Lối vào chấm thử miễn phí — ngoại lệ có chủ đích của quy tắc "nộp bài AI chấm thì cần khoá": Writing Task 1, Task 2 và Speaking Part 2. Trang chủ đọc `GET /api/trial/public-config` (GOI-11 mục 5.2.3) và hiện đúng một trong các trạng thái: (a) đang mở → nút phụ "Chấm thử một bài miễn phí" → `/trial/writing` (chọn Writing/Speaking ở đó), dòng chú "số bài mỗi ngày có giới hạn" lấy số từ API, menu điện thoại có mục "Chấm thử"; (b) toàn web hết lượt hôm nay (`reason='site_daily_exhausted'` ở cả hai kỹ năng) → lối vẫn hiện, kèm dòng "Hôm nay đã hết lượt chấm thử · mở lại 00:00"; (c) tạm dừng (`reason='paused'`) → nút phụ là "Đọc thử Thư viện miễn phí", menu không có "Chấm thử"; (d) đọc cấu hình lỗi hoặc `reason='unavailable'` → như (c); (e) người xem đã đăng nhập và `GET /api/trial/status` trả 403 `trial_not_eligible` (từng có khoá online, kể cả đã hết hạn) → không hiện lối, không nói lý do. Không hiện số tiền, không đếm ngược, không hộp bật lên. Đơn vị Speaking luôn là "bài Part 2".
- **FR-022:** (mới) "Báo cho tôi khi mở" ở mỗi dòng "Sắp mở" của `/courses` và ở khối đăng ký của trang khoá sắp mở: khách bấm thì mở ô email ngay dưới dòng (không cửa sổ bật lên); đã đăng nhập thì chỉ còn nút, dùng email tài khoản. Đăng ký xong hiện "Đã đăng ký nhận báo" kèm lối bỏ nhận. Câu chú: "Chỉ gửi một thư khi khoá mở đăng ký. Bạn bỏ nhận được bất cứ lúc nào." Phản hồi của máy chủ giống nhau dù email đã đăng ký hay chưa. Bỏ nhận được ở hai chỗ: liên kết bỏ nhận trong thư, và nút "Bỏ nhận" khi đã đăng nhập đúng email đó. Khách không nhận mã bỏ nhận trên trang (ENROLL-0060 FR-060); câu sau đăng ký với khách: "Thư sẽ có liên kết bỏ nhận." Việc gửi thư: ENROLL-0060 FR-060.
- **FR-023:** (mới) Khi mới có một khoá mở đăng ký (tờ DanhMucKhoaMoiMotKhoa): danh sách vẫn đủ sáu dòng, đầu danh sách ghi "N khoá đang mở đăng ký · M khoá sắp mở" tính từ dữ liệu; bảng so sánh ghi "Công bố khi mở đăng ký" ở hàng Học phí và "Khi mở đăng ký" ở hàng Bài học thử của cột khoá sắp mở; mục trọn bộ ẩn khi số khoá mở đăng ký nhỏ hơn `COURSE_BUNDLE_MIN_OPEN` (mục 10 câu 12).
- **FR-024:** (mới) Trang khoá có khối "Đăng ký khoá này bạn có gì" ghi đúng ba ý: (1) admin xác nhận đơn là tài khoản được kích hoạt, mở luôn phần luyện Reading, Listening, ngữ pháp, từ vựng dành cho tài khoản đã kích hoạt; (2) lượt chấm AI của khoá là một kho chung cho Writing và Speaking, có hạn dùng (giá trị từ dữ liệu, rỗng thì bỏ vế hạn dùng); (3) lượt chưa dùng (00 mục 2 điểm 23, thay quy tắc 50%): bạn đăng ký lại khoá này thì toàn bộ lượt chưa dùng được chuyển sang kỳ mới và dùng được thêm tối đa 2 tháng; không đăng ký lại thì lượt còn lại hết hiệu lực khi khoá hết hạn. Hai con số đọc từ API G04: `credit_carry_percent` (cấu hình G04, hiện 100) và `credit_carry_valid_days` (hiện 60); không gõ số trong mã giao diện. Cách ghép câu: `credit_carry_percent = 100` → "toàn bộ lượt chưa dùng"; số khác → "N% số lượt chưa dùng"; `null` hoặc 0 → bỏ vế chuyển lượt, chỉ còn câu "lượt hết hiệu lực khi khoá hết hạn"; `credit_carry_valid_days` có số → "dùng được trong N ngày kể từ ngày kỳ mới bắt đầu", `null` → bỏ vế này. "Đăng ký lại" nghĩa là gì (mặc định tạm của G04: đơn đăng ký lại cùng khoá được tạo trước ngày hết hạn hoặc trong vòng 60 ngày sau đó; lượt chuyển hết hạn sau 60 ngày tính từ ngày khoá mới bắt đầu) do G04 quyết và tính; giao diện không tự tính ngày. Cùng bộ câu này dùng ở: khối "Lượt chấm AI dùng vào đâu" và khối đăng ký của trang khoá, màn khoá hết hạn (dòng dưới nút "Đăng ký lại"), màn 1 và màn 4 của đơn khi là đơn đăng ký lại (ENROLL-0060 FR-055). Khi `viewer.can_renew = true` mà khoá còn hạn, khối đăng ký có thêm lối phụ "Đăng ký lại" kèm đúng câu trên. Khoá đã hết hạn còn hiện câu "Bài đã nộp và nhận xét vẫn xem được trong Tiến độ đến <ngày>" lấy từ `content_visible_until` của `GET /api/me/courses` (G04; 00 mục 2 điểm 23: giữ 45 ngày sau khi khoá hết hạn; số ngày là cấu hình của G04); trường `null` thì ẩn câu, không ghi "XXX ngày".
- **FR-025:** (mới) Trang khoá có mục "Người soạn và giảng" (tên, một dòng kinh nghiệm, liên kết video bài 1.1; ô ảnh chỉ hiện khi có ảnh được duyệt) và dòng "Người soạn và giảng: …" ở `/courses`; cả mục ẩn khi dữ liệu rỗng. "Mảnh giao diện · phiếu nhận xét" chỉ hiện ở trang khoá có `features` chứa Writing hoặc Speaking.
- **FR-026:** (mới) Một component khối liên hệ dùng chung hiện bốn dòng Email · Điện thoại · Zalo · Giờ trả lời, đọc từ một nguồn cấu hình (5.7); dùng ở `/contact`, `/enroll/[orderCode]` màn 3 và 6, `/terms`, `/privacy`, và cấp cho G07 dùng ở `/help`. Dòng nào chưa có giá trị thì ẩn dòng đó; cả bốn rỗng thì khối thay bằng liên kết tới `/contact`.
- **FR-027:** (mới) Mọi trang G05 chạy đúng ở cả chế độ sáng và tối chỉ qua token của G03 (không viết màu tối riêng cho từng trang); mã QR luôn nền trắng (`--qr`, `--qrInk` cố định, lề trắng 16px, viền 1px), không đảo màu; layout mới có đoạn chống nháy như GOI-03 mục 5.9. Logo lấy từ `<Logo>` qua khung G03, G05 không chèn chữ trần hay SVG riêng.
- **FR-028:** (mới) Tên khoá hiển thị là `title` của dữ liệu; chỗ hẹp (thanh dính đáy, bảng đơn ở 390px, breadcrumb) dùng `short_title` nếu có, không thì `title`. Không gõ tên khoá trong mã giao diện.
- **FR-029:** (mới, CR-2463-R1) Khi cờ `AVER_PUBLIC_COMMERCE` tắt, không lối nào dẫn tới trang 404: mọi link tới `/courses*` dựng qua một helper chung `coursesHref()` trong `frontend/lib/public-commerce.mjs` (cùng file có `publicCommerceEnabled()`, đọc cờ build một chỗ). Cờ tắt: "Khoá học" của `PublicShell` (`PUBLIC_HREF.courses`) và nút CTA thanh trên về `/`; trang chủ ẩn nút "Xem các khoá học" cùng mục khoá học; lối "Xem các khoá" ở trạng thái "Chưa có khoá" của LEARNERCORE-0063 FR-027 ẩn (chỉ còn "Nhập mã kích hoạt", Thư viện, chấm thử); sitemap không có `/courses*`; `robots.ts` không đổi theo cờ. Cờ bật: các lối trên trỏ `/courses`. Dòng registry `/courses`, `/courses/[slug]` đổi `live` trong PR G05-T04; test route-registry/planned-href cho phép `live` mà link vẫn qua `coursesHref()`.

## Acceptance scenarios

### Scenario 1 — Phần mở đầu trang chủ (gói kịch bản 1)

- **Given** khách chưa đăng nhập ở `/`, chấm thử đang mở
- **When** nhìn phần mở đầu
- **Then** có nút chính "Xem các khoá học" và nút phụ "Chấm thử một bài miễn phí"; khi admin tạm dừng chấm thử trên staging và tải lại, nút phụ là "Đọc thử Thư viện miễn phí"

### Scenario 2 — Danh mục khi mới một khoá mở (gói kịch bản 2)

- **Given** khách ở `/courses` khi mới một khoá mở đăng ký
- **When** trang vẽ xong
- **Then** đủ sáu dòng, "1 khoá đang mở đăng ký · 5 khoá sắp mở", năm dòng không có học phí; bấm "Báo cho tôi khi mở" ở một dòng mở ô email ngay dưới dòng

### Scenario 3 — 404 hai khung (gói kịch bản 16)

- **Given** một URL không tồn tại
- **When** người đã đăng nhập mở, rồi khách mở
- **Then** cả hai nhận HTTP 404; người đã đăng nhập thấy thanh học viên, khách thấy khung công khai

### Scenario 4 — Khối "Đăng ký khoá này bạn có gì" (gói kịch bản 21)

- **Given** trang một khoá online đang mở, cấu hình G04 chuyển 100% và bảo lưu 60 ngày
- **When** khách đọc khối
- **Then** câu ghi đăng ký lại thì toàn bộ lượt chưa dùng được chuyển sang và dùng thêm được 60 ngày; không đăng ký lại thì lượt hết hiệu lực khi khoá hết hạn; không có chuỗi "50%"

## Edge cases

- Slug không tồn tại hoặc khoá không công khai (Course 1–5) → HTTP 404 thật, không soft 404 (bỏ `loading.tsx` của route động, gọi `notFound()` trước khi stream).
- Trường dữ liệu khoá rỗng: không hiện "0", "XXX" hay ô trống (FR-004); `credit_carry_percent` null hoặc 0 bỏ vế chuyển lượt (FR-024).
- `GET /api/trial/public-config` lỗi hoặc `unavailable` → như tạm dừng (FR-021 d); người từng có khoá online → không hiện lối, không nói lý do (FR-021 e).
- `robots.ts` so tiền tố: `/courses` phải mở, nên `/courses/[slug]/enroll` chặn bằng dòng `Disallow: /courses/*/enroll`, không bằng tiền tố (FR-019); không thêm `'/course'` trần (lưu ý của LEARNERNAV-0062).
- `OAUTH_RECOVERY` trong `app/(marketing)/layout.tsx` phải giữ nguyên khi thay trang chủ.
- Khối liên hệ: dòng rỗng ẩn; cả bốn rỗng → liên kết `/contact` (FR-026).
- Chế độ tối: mã QR và thư luôn sáng (FR-027).
- Hơn 30 assert của test ghim landing vỡ → dừng, gửi danh sách (gói mục 7).

## Success criteria

- Kịch bản 1, 2, 16, 18, 21 của gói chạy trên staging, có ảnh 1280px và 390px ở sáng và tối đặt cạnh tờ thiết kế.
- `curl -sI` slug lạ trên staging trả 404; sitemap chứa đúng các route FR-019.
- 0 chuỗi cấm ("mua", "bán", "giá", "đơn hàng", "thầy", "giảng viên") trong file mới (`grep -rniE`), trừ nội dung pháp lý nguyên văn.

## Related specifications

- ENROLL-0060 (G05 nhóm B): đăng nhập, `next`, `/activate`, đơn, liên hệ gửi đi, bảng và thư "Báo cho tôi khi mở".
- COURSEACCESS-0055 (G04): `course_products`, `GET /api/courses*`, `GET /api/me/courses`.
- UIBASE-0056 (G03): `PublicShell`, `LearnerShell`, token, `RedirectNotice`, danh mục trang.
- FREETRIAL-0047, TRIALCAP-0080: `GET /api/trial/public-config`, `GET /api/trial/status`.
- LEARNERCORE-0063 (G07): `/home` các trạng thái; `/help` dùng khối liên hệ.
- LIBRARY-0061 (G06): `/library`.
- BRANDMARK-0083 (GOI-11 G): `Logo`, ảnh OG.

## Open questions

Các câu của gói mục 10 thuộc spec này; người thực thi dùng mặc định tạm ở cột cuối cho tới khi anh Andy trả lời.

| # | Câu hỏi | Phương án đề nghị | Mặc định tạm người thực thi dùng |
|---|---|---|---|
| 1 | `/pricing` chuyển về `/courses` kiểu tạm (307) hay vĩnh viễn (308)? | Tạm (307) tới khi danh mục ổn định, rồi đổi 308 | 307, và vẫn `redirect('/')` khi cờ thương mại tắt |
| 6 | Chính sách hoàn tiền là trang riêng hay một điều trong Điều khoản? | Một điều trong `/terms` có neo `#hoan-tien` | Như đề nghị |
| 7 | Giá trị khối liên hệ (email, điện thoại, Zalo, giờ trả lời), giờ làm việc đối chiếu, thời gian xử lý, mốc "quá XXX mà khoá chưa mở" | Anh điền vào biến cấu hình của `site-info` | Rỗng → ẩn dòng/câu tương ứng |
| 11 | Trang chủ `/` khi đã đăng nhập: giữ thanh công khai, chỉ đổi phần phải (tờ TrangChuCongKhai màn 3), hay dùng thanh học viên 5 mục như mọi trang khác (quy tắc ở tờ ThanhPhanKhungTrang)? | Theo tờ TrangChuCongKhai màn 3, vì đây là trang giới thiệu | Theo tờ TrangChuCongKhai màn 3 |
| 12 | Mục "trọn bộ" ở danh mục ẩn khi còn dưới hai khoá mở đăng ký (tờ ghi "giả định")? | Đúng, ngưỡng 2 | `COURSE_BUNDLE_MIN_OPEN=2` |
| 17 | Khi nào bật `AVER_PUBLIC_COMMERCE` và `email_code_login` trên production? | Sau khi có học phí thật, nội dung pháp lý đã duyệt, SMTP đã cấu hình, và kịch bản mục 9 qua trên staging | Cả hai tắt |
| 18 | (mới) Khối "Học viên nói gì" (trang chủ mục 4, trang khoá, mục ở chân trang, trang `/hoc-vien-noi-gi` theo tờ HocVienNoiGi) do G13-A10 dựng (GOI-13 phần A, (sửa 18/11 theo GOI-13)); nguồn dữ liệu (khảo sát, duyệt, ghim ở tờ AdminKhaoSat) cũng do GOI-13 phần A dựng. GOI-13 xếp làm trước khi mở đăng ký (sửa 18/11 theo GOI-13). | Một gói riêng (trang công khai + bảng nhận xét + màn admin duyệt), làm trước khi mở đăng ký; khi làm theo 00 mục 2 điểm 23: hiện cả ở trang sáu khoá online, không ghi là của lớp offline | G05 không vẽ khối, không gõ nhận xét mẫu, chân trang không có mục này; T03, T05 để sẵn chỗ |
