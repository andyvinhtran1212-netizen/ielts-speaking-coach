# Verification

## Requirement coverage

Mọi dòng `PENDING`: spec đang `draft`. Cột bằng chứng là bằng chứng **dự kiến** theo task; khi mã merge, đổi sang `PASS`/`MANUAL`/`N/A` theo mẫu `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-030 | kind=test; ref=planned in G05-T08; scenarios in this file | PENDING |
| FR-031 | kind=test; ref=planned in G05-T08; scenarios in this file | PENDING |
| FR-032 | kind=test; ref=planned in G05-T09; scenarios in this file | PENDING |
| FR-033 | kind=test; ref=planned in G05-T09; scenarios in this file | PENDING |
| FR-035 | kind=test; ref=planned in G05-T12; scenarios in this file | PENDING |
| FR-036 | kind=test; ref=planned in G05-T12; scenarios in this file | PENDING |
| FR-037 | kind=test; ref=planned in G05-T12, T13; scenarios in this file | PENDING |
| FR-038 | kind=test; ref=planned in G05-T11, T12; scenarios in this file | PENDING |
| FR-039 | kind=test; ref=planned in G05-T12; scenarios in this file | PENDING |
| FR-040 | kind=test; ref=planned in G05-T12; scenarios in this file | PENDING |
| FR-041 | kind=test; ref=planned in G05-T13; scenarios in this file | PENDING |
| FR-042 | kind=test; ref=planned in G05-T14, T12; scenarios in this file | PENDING |
| FR-043 | kind=test; ref=planned in G05-T07; scenarios in this file | PENDING |
| FR-044 | kind=test; ref=planned in G05-T07..T24 copy grep; scenarios in this file | PENDING |
| FR-046 | kind=test; ref=planned in G05-T18, T19; scenarios in this file | PENDING |
| FR-047 | kind=test; ref=planned in G05-T19; scenarios in this file | PENDING |
| FR-048 | kind=test; ref=planned in G05-T19; scenarios in this file | PENDING |
| FR-049 | kind=test; ref=planned in G05-T18; scenarios in this file | PENDING |
| FR-050 | kind=test; ref=planned in G05-T18, T19; scenarios in this file | PENDING |
| FR-051 | kind=test; ref=planned in G05-T09, T19; scenarios in this file | PENDING |
| FR-052 | kind=test; ref=planned in G05-T20; scenarios in this file | PENDING |
| FR-053 | kind=test; ref=planned in G05-T20; scenarios in this file | PENDING |
| FR-054 | kind=test; ref=planned in G05-T08, T12, T13; scenarios in this file | PENDING |
| FR-055 | kind=test; ref=planned in G05-T12; scenarios in this file | PENDING |
| FR-056 | kind=test; ref=planned in G05-T12; scenarios in this file | PENDING |
| FR-057 | kind=test; ref=planned in G05-T12; scenarios in this file | PENDING |
| FR-058 | kind=test; ref=planned in G05-T09; scenarios in this file | PENDING |
| FR-059 | kind=test; ref=planned in G05-T24: failure at each post-Auth step → needs_reconcile, reconcile job → completed (idempotent); correct code but permission changed after the code was sent (suspended, role changed, timed work started, Google identity linked, new email taken) → no Auth write, row abandoned, right error; Auth write happens only via update_user_by_id after the re-check (mock asserts order); hook rejects every email_change* from GoTrue (no mail); failure injected right after update_user_by_id and before auth_changed → reconcile reads auth.users.email and resumes; auth/users drift without a row → needs_reconcile external_change + owner alert, no auto-sync; flag email_change off → block hidden and 503 regardless of email_code_login; concurrency with two QA sessions (email-change verify on device A, timed-work start on device B, both orders and simultaneous) → exactly one wins, timed work never starts after pending and verify never writes Auth while timed work is active, no running exam session is revoked; staging: direct PUT /auth/v1/user and /auth/v1/verify with the publishable key → no code, email unchanged | PENDING |
| FR-060 | kind=test; ref=planned in G05-T22, T14: state change between enqueue and send (unsubscribe, email change, entitlement, closed) → not sent incl. retry; anonymous re-subscribe gets no token | PENDING |
| FR-061 | kind=test; ref=planned in G05-T20; scenarios in this file | PENDING |
| FR-062 | kind=test; ref=planned in G05-T18 (auth_hooks pytest, fn_auth_access_token_hook PG test); route counts only ip/user and maps hook 429/503, send_direct called exactly once per request; shared hook policy table: explicit allowlist, unknown methods fail-closed; journey=staging evidence h–o of plan 5.6 (incl. signup by code, email change, OAuth and refresh) approved by Andy | PENDING |

## Kịch bản (gói mục 9, phần của spec này)

Môi trường: local cho test tự động; staging cho kịch bản đầu-cuối (tài khoản Google thử và hộp thư thử của dự án, không dùng tài khoản học viên thật). Production: không tạo đơn, không nhập mã kích hoạt, không bật cờ.

3. Given khách ở trang một khoá đang mở, When bấm "Đăng ký khoá này", Then tới `/login?next=/courses/<slug>/enroll` có dòng "Bạn đang đăng ký <tên khoá>"; When đăng nhập Google, Then về đúng `/courses/<slug>/enroll`, chưa có đơn nào được tạo, khung là thanh học viên 5 mục.
4. Given email chưa từng có tài khoản, When nhập email ở `/login`, bấm "Gửi mã đăng nhập", nhập đúng 6 số trong thư, Then đã đăng nhập, tài khoản mới được tạo, tới trang lần đầu (hoặc đích tạm khi cờ `AVER_HOME_OPEN_TO_INACTIVE='0'`). Given email đã có tài khoản Google, When đăng nhập bằng mã, Then vào đúng tài khoản đó (khoá và bài làm còn nguyên) và thấy dòng 3g một lần.
5. Given màn nhập mã, When nhập sai tới hết số lần thử, Then lần lượt thấy 3a với số lần còn lại giảm dần rồi 3b; When bấm "Gửi mã mới" quá số lần cho phép, Then 3d có "Tiếp tục với Google". When dán một mã kích hoạt 12 ký tự vào ô, Then 3h và không có yêu cầu nào gửi đi. Hai email (có và chưa có tài khoản) cho màn 2 và các thông báo giống hệt nhau.
6. Given đang ở màn 1 đơn đăng ký, When bỏ chọn ô đồng ý, Then nút tạo đơn tắt; When chọn và bấm, Then sang `/enroll/AVER-XXXXXX` màn 2 có QR, hạn giữ đơn theo `pay_by`, và hộp thư thử nhận thư "Đã tạo đơn".
7. Given màn 2, When quét QR bằng ứng dụng ngân hàng (người làm, ít nhất 3 ngân hàng, **không bấm xác nhận chuyển**), Then app điền đúng tài khoản nhận, số tiền, nội dung `AVER-XXXXXX`. When đổi sang chế độ tối, Then mã QR vẫn nền trắng và quét được.
8. Given đơn chờ chuyển, When bấm "Tôi đã chuyển khoản", Then màn 3 "Chờ xác nhận", **không** có thư nào được gửi cho sự kiện này; When admin xác nhận trên staging (G04/G09), Then trong ≤ 20 giây màn 3 tự sang màn 4, màn 4 có dòng "Tài khoản: Đã kích hoạt…", có thư "Khoá đã mở", và bấm "Bắt đầu học" không bị đẩy về `/login`.
9. Given tài khoản mới chưa có khoá, cờ `AVER_HOME_OPEN_TO_INACTIVE='1'` và G07 đã ở staging, When đăng nhập không có `next`, Then tới `/home` trạng thái "Chưa có khoá" với thanh học viên 5 mục — không tới Thư viện, không vòng lặp `/login`.
10. Given admin chuyển đơn sang Cần bổ sung vì thiếu tiền, Then màn 3 hiện khối "Thiếu tiền · chưa mở khoá" với ba con số, hạn bổ sung, lời nhắn của admin nguyên văn, khối liên hệ chung, và hộp thư thử nhận thư "Đơn cần bạn bổ sung".
11. Given đơn quá `pay_by` chưa báo chuyển, Then `/enroll/<code>` hiện màn 5 "Hết hạn" với "Tạo đơn mới" và "Tôi đã chuyển cho đơn này"; When admin ghi nhận khoản chuyển khớp mã của đơn đó, Then đơn thành "Đã mở khoá", trang hiện màn 4, có thư "Khoá đã mở".
12. Given tài khoản đã có đơn mở cho một khoá, When tạo đơn thứ hai cùng khoá, Then được đưa tới đơn đang mở.
13. Given học viên lớp offline mở liên kết thư mời `/activate#code=…` khi chưa đăng nhập, When đăng nhập (Google hoặc mã), Then về `/activate` với mã còn trong ô, chưa có gì được kiểm; When bấm "Kiểm tra mã", Then thấy khoá của lớp, thời hạn, số lượt kèm mã, mã chưa bị tiêu (admin xem mã vẫn "chưa dùng"); When "Xác nhận mở khoá", Then mã bị tiêu, hiện màn "Đã mở khoá · Mở bằng mã kích hoạt".
14. Given tài khoản học viên đang mở ở thiết bị A, cờ một phiên bật, When đăng nhập ở thiết bị B, Then B thấy 8a; bấm "Huỷ" → B không đăng nhập, A còn nguyên; bấm "Tiếp tục ở đây" → B vào, A ở thao tác kế tiếp thấy 8c và bản nháp đang viết còn. Given A đang làm bài có giờ, Then B thấy 8b, không có nút chiếm phiên. Tài khoản admin đăng nhập hai thiết bị không thấy màn nào.
15. Given `next=//evil.com`, Then sau đăng nhập không rời averlearning.
17. Given `/contact` khách gửi 4 lần trong một giờ, Then lần 4 nhận thông báo giới hạn, dữ liệu đã nhập còn nguyên; khối liên hệ ở `/contact` và ở màn 3 của đơn hiện cùng giá trị.
18. Mọi màn mới ở 1280px và 390px, sáng và tối: chụp ảnh đặt cạnh tờ thiết kế trong PR; dùng được bằng bàn phím (Tab qua thanh trên, FAQ, chương, sáu ô mã, nút sao chép).
19. (mới) Given tài khoản học viên thử đăng nhập bằng mã, đang mở ở hai thiết bị, When ở Hồ sơ bấm "Đổi email đăng nhập", nhập một hộp thư thử khác và nhập đúng mã 6 số nhận ở hộp thư MỚI, Then Hồ sơ hiện email mới, hộp thư CŨ nhận một thư báo đổi email, hộp thư cũ không nhận mã nào, thiết bị thứ hai bị đăng xuất ở thao tác kế tiếp, thiết bị đang dùng còn phiên. When đăng xuất rồi đăng nhập bằng mã với email mới, Then vào đúng tài khoản cũ (khoá, đơn, bài làm còn nguyên). When nhập một email đã thuộc tài khoản thử khác, Then màn nhập mã hiện như thường, không có câu nào nói email đã có tài khoản, và không mã nào được chấp nhận. Given tài khoản đang làm bài có giờ ở thiết bị khác, Then thấy câu "Bạn đang làm bài có giờ…" và không có mã nào được gửi. Given tài khoản từng đăng nhập bằng Google, Then thấy câu về Google và không có ô nhập email (mặc định tạm, mục 10 câu 19).
20. (mới) Given hai hộp thư thử đã bấm "Báo cho tôi khi mở" cho một khoá sắp mở (một khách, một tài khoản), một hộp thư thứ ba đã bấm rồi bỏ nhận, When admin mở đăng ký khoá đó trên staging, Then trong ≤ 10 phút hai hộp thư đầu mỗi hộp nhận đúng một thư "… đã mở đăng ký" có liên kết tới trang khoá và liên kết bỏ nhận, hộp thư thứ ba không nhận gì; When admin đóng rồi mở lại khoá, Then không hộp thư nào nhận thư thứ hai; When bấm liên kết bỏ nhận trong thư, Then trang khoá hiện dải "Bạn đã bỏ nhận…".

## Contract evidence

- OpenAPI/type drift: mỗi PR thêm `response_model` sinh lại `frontend/types/api.d.ts` (lệnh gói mục 8).
- Backward compatibility: đăng nhập Google giữ nguyên `redirectTo` `${origin}/login` và `OAUTH_RECOVERY`; `/auth/activate` cũ vẫn chạy; cờ `email_code_login` tắt thì `/login` như hôm nay.

## Data evidence

- Migration/schema query: sau mỗi lần áp staging, đọc lại bảng/hàm bằng `information_schema` và `pg_proc` (chỉ đọc), ghi vào PR; `has_function_privilege` của `anon`/`authenticated` là false với hàm mới.
- Immediate state versus full reload: màn đơn, `/account/orders`, Hồ sơ sau đổi email tải lại cho cùng trạng thái máy chủ.

## UI evidence

- Viewports/themes/input methods: 1280px và 390px, sáng và tối; bàn phím qua sáu ô mã, nút sao chép; mã QR nền trắng ở chế độ tối.

## Release evidence

- Staging SHA and checks: ghi SHA staging từng PR, CI tích hợp và Staging E2E đúng SHA; ghi migration đã áp kèm giờ.
- Production verification: sau promote với cờ tắt, `/login` chỉ có Google như cũ; chỉ xem, không tạo đơn.
