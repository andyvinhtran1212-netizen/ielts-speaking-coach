# Implementation plan

## Architecture impact

Phần D của GOI-11. Các file và module ở mục Data and contracts. Ràng buộc riêng của gói (mục 8):

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

Gói mục 5.4, chép nguyên:

### 5.4 Phần D — Chặn full test trên điện thoại

- Module `frontend/lib/full-test-device-gate.mjs` (ES module thuần, test bằng node):
  - `fullTestMinViewportPx(config = globalThis.__AVER_RUNTIME_CONFIG__)` → số nguyên ≥ 320, mặc định 768. Tên biến cấu hình trình duyệt `fullTestMinViewportPx`; cách thêm khoá vào `runtime-config.js`: CHƯA KIỂM (lệnh ở mục 2).
  - `measureViewportWidth(win = window)` → `win.innerWidth` (cùng thước với `@media (min-width: …)`).
  - `fullTestEntryDecision({width, min})` → `'allowed' | 'blocked'`.
- Hook `frontend/lib/use-full-test-gate.ts`: trả `'measuring'` khi chưa có `window` (SSR), rồi `'allowed'|'blocked'` sau lần đo đầu; **mọi lệnh tạo lượt/sitting chỉ được gọi khi `'allowed'`**. Nghe `resize` và `orientationchange` chỉ để báo `narrowDuringAttempt: boolean` sau khi lượt đã tạo.
- Component `frontend/components/exam-room/full-test-phone-block.tsx` (tiếng Anh, `lang="en"`), câu chữ đúng tờ ThanhPhanKhungTrang mục 6: tiêu đề "Full tests cannot be taken on a phone"; đoạn "This test needs a screen at least {min} pixels wide: a computer or a tablet. Open it there to start. Nothing has started and no AI credits were used."; nút "Back to Mock tests"; khối "Practise on this phone instead" + nút "Go to section practice"; dưới cùng một dòng phụ tiếng Việt `lang="vi"` (FR-056; câu đề xuất: "Bài thi đầy đủ cần màn hình rộng từ {min} điểm ảnh: máy tính hoặc máy tính bảng. Mini test và luyện từng phần vẫn làm được trên điện thoại." — mục 10 câu 27). Component nhận prop `viNote` để G08 dùng lại cho màn lỗi thiết bị. Dùng `Notice kind="warning" lang="en"` của G03 khi đã có; trước đó dựng bằng CSS tạm trong cùng thư mục và ghi rõ trong PR.
- Dải nhắc giữa bài `full-test-narrow-notice.tsx`: "Your screen is now narrower than {min} pixels. Your test continues and the timer keeps running. Rotate your device or widen the window to see the full layout." (câu chữ đề xuất, mục 10 câu 12); không che bài.
- Lối vào phải nối (G11-T19 và T20): `/tests` (trang mới G07-T12a/T16); `(authed-full-test)/full-test` (Speaking full test); `(authed-mock-exam)` (phòng thi thử, gồm phòng chờ/chuyển phần); `(authed-reading-player)/reading/exam/session` khi chạy chế độ test (gate phải chạy **trước** effect gọi `POST /api/reading/test/{id}/attempts`, file `reading-exam-session.tsx` dòng 965–981); `(authed-listening-player)/listening/test/session` (CHƯA KIỂM endpoint tạo lượt: `grep -n "attempts" frontend/app/(authed-listening-player)/listening/test/session/listening-test-session.tsx | head`); Writing full test trong Mock; khung `ExamRoom` của G08 khi `mode === 'exam'` **và bài là full test** (gate đặt trong một wrapper `ExamEntryGate` để mọi trình G08 dùng chung; G08 truyền `isFullTest`). Không gate: **mini test** (kể cả khi chạy ở chế độ thi tiếng Anh), chế độ luyện, bài giao `delivery_mode='assigned_practice'`, bài kiểm tra của khoá (tờ KiemTraKhoa "điện thoại vẫn làm được").
- Máy chủ: không chặn theo độ rộng. Người thực thi kiểm và ghi vào PR cho từng lối vào: (1) GET trang không tạo lượt; (2) lệnh tạo lượt là POST tường minh và idempotent (bài dở → trả lượt cũ); (3) không giữ chỗ lượt AI lúc tạo lượt. Nếu một lối vào tạo lượt ngay khi mở trang mà không thể gate trước ở client, ghi `CHƯA AN TOÀN` trong PR và mở nhiệm vụ backend riêng, không sửa backend trong PR D.
- Sự kiện: `full_test_phone_blocked {surface, width_bucket: "<360|360-479|480-767"}` qua `POST /api/analytics/events` (CHƯA KIỂM danh sách tên sự kiện cho phép: `grep -n "event_name\|ALLOWED" backend/routers/analytics.py`; có danh sách thì bỏ log, ghi vào PR).

## UI and interaction

Xem `ui-states.md`.

## Rollout and rollback

Không cờ máy chủ riêng; đổi tới người dùng qua PR mã của từng nhiệm vụ. Quay lui = revert PR của nhiệm vụ đó.

## Verification strategy

Lệnh mỗi PR (00 mục 5): backend `cd backend && python -m pytest tests/ -q`; PG17 `REQUIRE_PG=1 TEST_PG_URL=… python -m pytest tests/test_migration_47*.py tests/test_client_write_invariant_postgres.py -q`; frontend hợp đồng, React, `tsc`, `build`; `python backend/scripts/validate_specs.py`; `git diff --check`.
Không kiểm trên production: không nộp bài thử, không công bố điểm, không gửi thông báo hay thư, không bật cờ, không đổi trần chấm thử. Production chỉ xem sau khi anh Andy cho promote.
