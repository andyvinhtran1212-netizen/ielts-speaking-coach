# Rollout and rollback

## Preconditions

- Spec `approved` trên `staging`; anh Andy chọn đường gửi mã A hoặc B (câu hỏi mở 4) và trả lời câu 3 (các số của mã) hoặc chấp nhận mặc định tạm.
- Số 390–395 còn trống trong `backend/migrations/register.tsv`; mỗi PR migration thêm dòng `present` cùng PR. 394 cần G04 mig 383 (đã có trên staging).
- Cờ tắt mặc định: runtime flag `email_code_login`, cờ build `AVER_PUBLIC_COMMERCE`, `enroll_prelearn_chapter1`.
- Biến bí mật `LOGIN_CODE_HASH_PEPPER` (rỗng → route trả 503) do anh đặt trên Railway staging rồi production; người thực thi không đặt.

### Migration và thứ tự áp

Migration của gói (dải 390–399 theo `01-KE-HOACH-TONG.md` mục 6; số dưới đây là dự kiến theo thứ tự làm, người thực thi kiểm sổ số và số cao nhất trong `backend/migrations/` trước khi dùng; 395–399 để trống):

| Số dự kiến | Nội dung | Nhiệm vụ | Phụ thuộc |
|---|---|---|---|
| 390 | `contact_messages` | T07 | — |
| 391 | `login_code_state` + `fn_login_code_send_check`, `fn_login_code_verify_check`, `fn_login_code_invalidate` | T18 | — |
| 392 | thay thân `fn_activate_attempt_check`: 5 lần / 15 phút | T09 | 334 (đã có) |
| 393 | `account_email_changes` | T24 | — |
| 394 | `course_open_alerts` + `fn_course_open_alerts_enqueue` + `fn_course_open_alert_send_check` | T22 | G04 mig 383 (đã có: `course_products`, `learner_email_outbox`) |
| 395 | `login_code_locks` + policy SELECT cho `supabase_auth_admin` (cả `runtime_flags`) + `fn_auth_access_token_hook` (Custom Access Token Hook, FR-062) | T18 | 391 |

Thứ tự áp theo thứ tự làm: 390 (T07) → 391 (T18) → 395 (T18) → 393 (T24) → 392 (T09) → 394 (T22). Mỗi migration: staging trước qua runner có khoá advisory, sau khi anh Andy gõ duyệt cho đúng lần áp; đọc lại bằng truy vấn chỉ đọc; production trước khi promote mã phụ thuộc, cũng cần anh gõ duyệt.

### Việc anh Andy làm trên bảng điều khiển Supabase (staging trước, production sau)

Người thực thi không đổi cài đặt dự án Supabase và không tạo khoá Resend (gói mục 8). Danh sách đánh dấu được (chép từ gói 5.6, áp cho đường A):

- [ ] Authentication › Hooks: bật Send Email Hook (`/auth/hooks/send-email`, secret qua kênh bí mật) và Custom Access Token Hook (`fn_auth_access_token_hook`, sau mig 395) — **chỉ staging** cho tới khi anh duyệt bằng chứng điểm h–o (plan 5.6). Với hook, bước SMTP dưới chỉ là dự phòng.
- [ ] (Dự phòng) Authentication › SMTP: bật SMTP tuỳ chỉnh trỏ vào Resend — máy chủ `smtp.resend.com`, cổng 465, tên đăng nhập `resend`, mật khẩu là một khoá API của Resend (nên tạo khoá riêng chỉ có quyền gửi, không dùng lại khoá của backend), địa chỉ gửi và tên người gửi theo mục 10 câu 5 (`CHƯA KIỂM` thông số SMTP với tài liệu Resend hiện hành; người thực thi ghi nguồn vào `rollout.md`).
- [ ] Authentication › Providers › Email: bật; **giữ bật "Confirm email"**; nếu OTP cho email mới không chạy khi nó bật thì dừng rollout và báo anh, không tắt bảo vệ; độ dài mã 6; thời hạn mã = `LOGIN_CODE_TTL_MINUTES`.
- [ ] Authentication › Email Templates: mẫu "Magic Link" (dùng cho OTP đăng nhập) và mẫu "Change Email Address" (dùng cho T24) chỉ chứa `{{ .Token }}`, không có `{{ .ConfirmationURL }}`; dán nội dung từ `docs/auth/login-code-email.*` và `docs/auth/email-change-code-email.*` (T14).
- [ ] "Secure email change": giữ nguyên ở mọi môi trường (đổi email không dùng cơ chế của GoTrue, plan 5.6b).
- [ ] Cờ `runtime_flags('email_change')`: mặc định tắt ở mọi môi trường; bật trên staging để thử T24; bật production chỉ khi anh duyệt riêng sau kịch bản 5.6b. Điều kiện trước khi bật ở bất kỳ môi trường nào: migration 394 (`course_open_alerts`, `fn_course_open_alerts_rekey`) đã áp ở môi trường đó (`SELECT to_regclass('public.course_open_alerts')` khác null) và T22 đã merge; `verify` cũng tự kiểm và trả 503 nếu thiếu.
- [ ] Bật gộp tài khoản cùng email đã xác minh (điểm (d)).
- [ ] Giới hạn của Supabase Auth (Rate Limits): **không nới**, ghi lại giá trị hiện tại. Production giữ nguyên cấu hình; đổi chỉ khi anh duyệt riêng kèm số đo staging.

## Staging

- Thứ tự bật cờ `email_code_login`: (1) migration 391 đã áp và đọc lại; (2) sáu việc Supabase ở trên xong trên staging; (3) PR T18 lên staging, pytest xanh; (4) người thực thi kiểm sáu điểm `CHƯA KIỂM` của 5.6 trên Supabase staging và ghi kết quả vào PR T18; (5) PR T19 lên; (6) anh bật cờ trên staging; (7) chạy kịch bản 4, 5 với hộp thư thử; (8) kiểm gộp danh tính Google + mã cùng email (không ra hai tài khoản) trước khi coi là xong.
- Luồng đơn: kịch bản 6–12 với sản phẩm thử của G04 và tài khoản thử; quét QR không bấm chuyển.
- Chỉ bật luồng đơn (cho người học tạo đơn) sau khi `/enroll/[orderCode]` (T12) đã `live` trong `frontend/lib/route-registry.mjs`. Trước đó `/account/orders` (T13) vẫn liệt kê đơn nhưng các dòng chưa có liên kết hành động, vì liên kết chỉ trỏ tới trang đã live; chỉ dòng "Vào học" có liên kết.
- Mỗi PR chờ CI tích hợp và Staging E2E xanh đúng SHA.

## Production

- Chỉ qua PR promote `staging → main`. Migration production trước mã phụ thuộc, anh gõ duyệt từng lần.
- Sáu việc Supabase làm lại trên dự án production trước khi bật `email_code_login` production.
- Bật `AVER_PUBLIC_COMMERCE` và `email_code_login` trên production khi có học phí thật, nội dung pháp lý đã duyệt, SMTP đã cấu hình, và kịch bản mục 9 qua trên staging (câu 17). Không tạo đơn, không nhập mã kích hoạt thật để thử trên production.

## Rollback and repair

- Mã đăng nhập: tắt `email_code_login` (hiệu lực theo bộ đệm `runtime_flags`), `/login` về chỉ Google; phiên đã cấp vẫn hợp lệ. Bảng 391 giữ lại; rollback file chỉ chạy khi anh duyệt.
- `/activate` kiểm trước: revert mã; mig 392 có rollback trả thân `fn_activate_attempt_check` về 10 lần / 10 phút của mig 334.
- Đơn: revert giao diện; dữ liệu đơn là của G04 nên không mất. Đổi email: revert mã; nhật ký `account_email_changes` giữ để admin đối chiếu.
- "Báo cho tôi khi mở": tắt bằng cách bỏ bước gọi hàm trong `enrollment_sweep.py` của G04 (hàm thiếu thì bước tự bỏ qua); dòng đăng ký giữ lại.
- Mỗi migration có file `backend/migrations/rollback/<số>_*.sql`; chạy rollback cần anh gõ duyệt.

## Observability

- Log route mã đăng nhập, đổi email, liên hệ, open-alerts chỉ có `email_hash` rút gọn, `error_code`, `X-Request-ID`; không email, mã, token.
- Đếm `login_code_send_limited`, `login_code_locked`, `login_code_unavailable` theo giờ; tỉ lệ `unavailable` > 5% trong một giờ trên staging → dừng bật thêm và kiểm SMTP.
- Thư "khoá đã mở đăng ký": dòng `course_open_alerts` còn `notified_at is null` sau khi khoá mở quá 10 phút → kiểm G04 có gọi hàm trong sweep.
- Thư báo đổi email lỗi được ghi để admin xử lý (FR-059 c).
- Dòng `account_email_changes` ở `needs_reconcile`/`auth_changed` quá 30 phút → `owner_alerts` (FR-059 d); đếm theo ngày phải về 0.
- Hook gửi thư trả lỗi (cờ tắt, vượt giới hạn, chữ ký sai): log mức info với `email_hash` rút gọn và `error_code`; số lần hook bị gọi mà không qua route backend là dấu hiệu gọi thẳng GoTrue (FR-062).
- Outbox `course_open_alert` bị `skipped_*`: đếm theo lý do (FR-060).
