# Implementation plan

## Architecture impact

Phần G của GOI-11. Các file và module ở mục Data and contracts. Ràng buộc riêng của gói (mục 8):

- Không sửa migration cũ; mọi thay đổi CSDL là migration mới trong dải 470–479 (472 không dùng). Gói này không sửa 381–388 của G04 và 440–451 của G09.
- Không viết mã gửi thư đơn, không dựng bảng công bố phía giáo viên, không dựng lối vào chấm thử trên trang công khai: ba việc đó thuộc G04, G09-T30, G05-T21.
- Không đổi cách chấm, điểm lưu, hay đường admin của bài kiểm tra; phần E chỉ đổi ai đọc được gì.
- Ở chế độ công bố, che ở giao diện không bao giờ là đủ: mọi trường ở 5.5.4 phải vắng khỏi phản hồi máy chủ; test 5.5.5 là cổng merge của T22.
- Mọi cờ mới mặc định tắt (`notifications_enabled`, `notification_emails`); production không bật cờ nào trong gói; `free_trial_enabled` theo rollout 0047.
- Không ghi email, tên, số tiền, mã đơn, nội dung bài vào log hay vào `params` của thông báo (trừ `order_code` trong `params` thông báo đơn của chính chủ đơn — cần để mở đúng đơn; không ghi vào log).
- Câu chữ: "giáo viên", "Đơn đăng ký", "Học phí", "Thanh toán", "Đăng ký khoá", "Đăng ký lại"; không "mua", "bán", "giá", "đơn hàng"; xưng "bạn"; full test tiếng Anh, bài kiểm tra của khoá tiếng Việt; không emoji; không "0/0", không band ở bài kiểm tra.
- Không gọi AI trả phí trong test; không gửi thư thật; không thao tác dữ liệu production.
- Không viết test kiểu đọc mã nguồn so chuỗi; riêng `brand-favicon.test.mjs` đã tồn tại được sửa có chủ ý, và `build-brand-assets.mjs --check` là kiểm tài sản sinh, không phải test mã nguồn.

## Data and contracts

Gói mục 5.7.1, 5.7.2, chép nguyên:

#### 5.7.1 Logo
- Nguồn hình duy nhất: `frontend/lib/brand/logo-geometry.mjs` (toạ độ `rect`/`polygon` trên lưới 48 theo tờ NhanDienLogo Hướng 1, màu bằng tên vai trò `frame|letter|bar|paper`).
- `frontend/components/brand/logo.tsx`: `<Logo variant tone size title?>` render SVG nội tuyến, màu qua `var(--av2-…)` của G03 (ánh xạ `--accent`, `--mark`, `--paper`, `--ink` của tờ sang token G03; G03 chưa có thì dùng mã màu 00 mục 2 điểm 10 trong một file token tạm và ghi trong PR); chữ "Aver Learning" Source Serif 4 600.
- Script `frontend/tooling/build-brand-assets.mjs`: sinh từ hình gốc các file tĩnh `frontend/public/favicon.svg`, `frontend/public/brand/logo-{horizontal,stacked,mark}-{color,mono,reverse}.svg`, `frontend/public/brand/logo-horizontal-color@2x.png` (đầu thư `.html` của G05-T14, vì nhiều ứng dụng thư chặn SVG — thêm 18/11 theo rà soát), `frontend/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (180); chế độ `--check` so kết quả sinh với file trong repo và thoát mã 1 nếu lệch (chạy trong CI ở job frontend hiện có; tên job bắt buộc không đổi). PNG sinh bằng thư viện đã có trong `frontend/package.json` (CHƯA KIỂM có `sharp`/`@resvg/resvg-js` không: `grep -n "sharp\|resvg" frontend/package.json`; không có thì hỏi trước khi thêm dependency, mục 10 câu 19).
- Chép `frontend/public/favicon.svg` sang `docs/brand/assets/favicon.svg` và `frontend/favicon.svg` (giữ ba bản trùng như hôm nay để test byte-identical còn đúng); ghi vào `docs/brand/README.md` rằng bộ "Mũi lên" đã thay.
- Sửa `frontend/tests/brand-favicon.test.mjs` trong cùng PR (đổi có chủ ý): giữ test bản trùng và test mọi trang dùng `/favicon.svg`; thay hai test hình bằng kiểm Ấn ký (`<rect` khung, `<polygon` chữ A, thanh ngang màu đánh dấu `#8A1C1C`, không `<text>`, không `#0F766E`, không `#F59E0B`); test `layout.tsx` đổi theo khối `icons` mới (`icons: { icon: '/favicon.svg', apple: '/icons/apple-touch-icon.png' }`) — ghi lý do từng dòng sửa trong PR.
- `frontend/app/manifest.ts`: thêm icon 192, 512, maskable 512 (`purpose: 'maskable'`), giữ SVG `any`; `theme_color`, `background_color` theo tờ NhanDienLogo mục 3d (đọc tờ; mặc định tạm: nền `#FAF6EF`, theme `#1A3561`).
- Thay chữ trần ở khung mới (G03 `LearnerShell`, khung công khai, `StaffShell`) bằng `<Logo variant="horizontal" size={24}>`. Khung cũ (`frontend/public/js/components/aver-chrome.js` dòng ~438, `aver-admin-chrome.js` dòng 697–698): dùng `<img src="/brand/logo-horizontal-color.svg" alt="Aver Learning" height="24">`, theo thứ tự sửa file `aver-chrome.js` ở 01 mục 3 (G02-T09 → G07 → G09-T09 → gói này).

#### 5.7.2 Ảnh chia sẻ liên kết
- `frontend/app/opengraph-image.tsx` (trang chủ, `ImageResponse`, 1200×630, nhúng Source Serif 4 và Source Sans 3 từ file font trong repo — CHƯA KIỂM đường dẫn font G03 đặt: `ls frontend/public/fonts frontend/app/fonts 2>/dev/null`), và `opengraph-image.tsx` trong segment `courses/[slug]` (G05), `library/writing/[id]` (G06, theo route thật G06 đặt), `grammar/[category]/[slug]`, đề Speaking (G06). Khuôn: nhãn loại đỏ mận · tiêu đề Serif 64 tối đa hai dòng, cắt "…" · một dòng phụ · chân trang domain. Không đặt band, số học viên, học phí chưa chốt.
- Không đổi cách sinh `og:title`/`og:description` (`layout.tsx` dòng 19–31 giải thích bẫy merge nông của Next: segment nào thêm `opengraph-image` thì kiểm lại `tests/next-metadata.test.mjs`).
- Tài nguyên social: xuất PNG theo tờ NhanDienSocial mục 2–3 vào `docs/brand/social-assets/png/` bằng cùng script (`--social`), giữ các SVG cũ trong thư mục `archive/`.

## UI and interaction

Xem `ui-states.md`.

## Rollout and rollback

Không cờ máy chủ riêng; đổi tới người dùng qua PR mã của từng nhiệm vụ. Quay lui = revert PR của nhiệm vụ đó.

## Verification strategy

Lệnh mỗi PR (00 mục 5): backend `cd backend && python -m pytest tests/ -q`; PG17 `REQUIRE_PG=1 TEST_PG_URL=… python -m pytest tests/test_migration_47*.py tests/test_client_write_invariant_postgres.py -q`; frontend hợp đồng, React, `tsc`, `build`; `python backend/scripts/validate_specs.py`; `git diff --check`.
Không kiểm trên production: không nộp bài thử, không công bố điểm, không gửi thông báo hay thư, không bật cờ, không đổi trần chấm thử. Production chỉ xem sau khi anh Andy cho promote.
