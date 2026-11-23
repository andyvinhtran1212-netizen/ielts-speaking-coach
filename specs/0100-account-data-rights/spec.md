---
id: ACCOUNTDATA-0100
title: Learners download a copy of their data and request account deletion, which a sweep carries out after a cancellable grace period while payment records stay on an anonymised id
status: draft
risk: high
owner: product
---

# Quyền với dữ liệu tài khoản: tải bản sao và yêu cầu xoá (G04-T18)

- **Lớp thay đổi:** `high-risk` (auth, xoá dữ liệu người học, migration, Storage). Không được hạ cấp.
- **Nguồn:** GOI-04 FR-04-052 và nhiệm vụ G04-T18; COURSEACCESS-0055 FR-052, plan "Xoá tài khoản và lưu giữ" và quyết định C2-SA-2335 của anh Andy (18/11: ẩn danh, giữ chứng từ 10 năm); tờ thiết kế `TaiKhoan` (khối "Dữ liệu của tôi", vùng nguy hiểm) và `GiaHanThemLuot` ("Tải các phiếu của khoá này (PDF)").
- **Phương án:** A (làm trước khi mở bán). Đây là mặc định tạm từ 18/11, còn chờ anh Andy xác nhận (câu hỏi mở 1). Nếu anh chọn để sau: spec này chuyển `superseded`, G07-T17 ẩn hai khối, trang Quyền riêng tư (G05) ghi cách yêu cầu qua kênh liên hệ.
- **Số:** spec 0100 cấp cho G04-T18 ở `docs/proposals/commercialization-2026-11/01-KE-HOACH-TONG.md` mục 6. Migration mang **nhãn 500**; số thật lấy từ `backend/migrations/register.tsv` khi mở PR mã (23/11 số kế tiếp là 503) và ghi hàng `reserved` trong chính PR đó, như COURSEACCESS-0055 (SA-2335-R1 C3).

## Problem

Hôm nay người học không có cách nào tự lấy bản sao dữ liệu của mình hay xoá tài khoản. Repo chưa có đường xoá tài khoản nào (`grep delete_user` chỉ thấy `scripts/staging_seed.py`). Trước khi mở bán khoá trả phí, người học cần hai quyền này ngay trong trang Tài khoản.

Xoá không làm được bằng cách xoá dòng `users`: các bảng chứng từ và sổ lượt của 0055 trỏ `users.id` bằng `ON DELETE RESTRICT` và có trigger chỉ ghi thêm, có chủ ý, vì đó là bằng chứng kế toán. Vì dòng `users` được giữ nên không khoá ngoại `CASCADE` nào chạy. Mọi bảng chứa bài làm hay dữ liệu cá nhân phải được xoá hoặc ẩn danh một cách tường minh, theo một danh sách đầy đủ và được kiểm bằng test.

## Scope

- Người học tự yêu cầu xoá tài khoản (gõ đúng email đăng nhập), bị đăng xuất mọi phiên, nhận thư xác nhận, và huỷ được yêu cầu trong hạn huỷ bằng cách đăng nhập lại.
- Job xoá chạy sau hạn huỷ: xoá bài làm, ghi âm và dữ liệu học; ẩn danh hồ sơ; vô hiệu đăng nhập; giữ chứng từ đơn đăng ký và sổ lượt trỏ về `id` đã ẩn danh.
- Người học tự yêu cầu gói tải dữ liệu (ZIP: JSON, phiếu PDF, bản ghi âm còn giữ). Job tạo gói, gửi thư, đường tải dùng được 7 ngày.
- Danh mục dữ liệu theo người học (`services/account_data_inventory.py`) và test chặn: mọi cột trỏ người dùng trong migration phải có trong danh mục.
- API học viên, bảng hàng đợi, bucket riêng tư cho gói tải (migration nhãn 500), bước mới của sweep.

## Non-goals

- Giao diện: G07-T17 gắn hai khối vào trang Tài khoản theo tờ `TaiKhoan` và `ui-states.md` của spec này.
- Nội dung Điều khoản và Quyền riêng tư (hoàn học phí, số năm giữ chứng từ hiển thị cho người học): G05.
- Xoá tài khoản nhân viên (`instructor`, `admin`): không làm qua đường này.
- Admin xoá hộ người học hay xem hàng đợi: để sau, spec riêng nếu cần.
- Chạy trên production, bật job thật: bước vận hành cần anh Andy gõ duyệt (`rollout.md`).
- Không gọi AI ở bất kỳ bước nào.

## Users and journeys

- **Người học muốn bản sao:** bấm "Yêu cầu tải dữ liệu" → thấy "đang chuẩn bị" → nhận thư trong tối đa `ACCOUNT_EXPORT_READY_HOURS` giờ → mở link (phải đăng nhập) → tải ZIP; quá 7 ngày link báo hết hạn và mời yêu cầu lại.
- **Người học muốn xoá:** đọc vùng nguy hiểm → gõ email → "Gửi yêu cầu xoá" → bị đăng xuất, nhận thư có ngày xoá → trong hạn huỷ, đăng nhập lại thấy thông báo và nút "Huỷ yêu cầu xoá" → không huỷ thì sau hạn tài khoản bị xoá, thư cuối báo đã xoá.
- **Admin / kế toán:** sau khi xoá, đơn đăng ký và sổ lượt vẫn đối soát được theo `id` đã ẩn danh; mã kích hoạt vẫn ghi "đã dùng".

## Requirements

- **FR-001:** `POST /api/account/deletion-request` với `{"confirm_email": "..."}` chỉ nhận khi chuỗi gõ (bỏ khoảng trắng hai đầu, không phân biệt hoa thường) bằng email đăng nhập của tài khoản; khác thì 422 `confirm_email_mismatch` và không ghi gì. Tài khoản `instructor` hoặc `admin` nhận 403 `staff_account_not_self_deletable`. Gửi lại khi đã có yêu cầu `pending` trả lại đúng yêu cầu đó (200, không tạo dòng mới, không đổi hạn). Thành công tạo yêu cầu `pending` với `erase_after = now() + ACCOUNT_DELETE_GRACE_DAYS ngày` và trả `{status, requested_at, erase_after}`.
- **FR-002:** Khi yêu cầu xoá được ghi, mọi phiên Auth của người đó bị thu hồi ngay, kể cả khi đang làm bài có giờ. Thư xác nhận (ngày xoá, cách huỷ) gửi qua `learner_email.send_direct`. Thu hồi phiên hoặc gửi thư lỗi không làm mất yêu cầu: yêu cầu vẫn `pending`, response ghi `sessions_revoked=false` hoặc `email_sent=false`, log có mã lỗi, và job xoá thu hồi phiên lại trước khi xoá.
- **FR-003:** Trong hạn huỷ, người học đăng nhập lại được. `GET /api/account/deletion-request` trả trạng thái và `erase_after`. `POST /api/account/deletion-request/cancel` chuyển `pending` → `cancelled` (ghi `cancelled_at`); huỷ khi không có yêu cầu `pending` trả 409 `no_pending_deletion_request`. Trong lúc `pending`, mọi route học viên khác trả 403 `account_deletion_pending` (chỉ các route `/api/account/*`, route đơn đăng ký chỉ đọc và route công khai còn dùng được), để không phát sinh bài làm mới sẽ bị xoá.
- **FR-004:** Job xoá chỉ xử lý yêu cầu `pending` có `erase_after <= now()`, khoá dòng khi xử lý (không hai tiến trình cùng xử lý một yêu cầu), và đọc lại trạng thái ngay trước khi xoá: yêu cầu đã huỷ không bao giờ bị xoá. Job có `--dry-run` (mặc định ở mọi môi trường cho tới khi bật cờ `ACCOUNT_ERASURE_ENABLED`) liệt kê người sẽ bị xoá và số dòng theo từng bảng mà không đổi gì.
- **FR-005:** Khi xoá, job làm theo danh mục `services/account_data_inventory.py`: (a) *xoá* mọi dòng bài làm, ghi âm, nhận xét, tiến độ, ghi chú và nhật ký của người đó trong các bảng loại `delete`, kể cả các bảng dưới đây; (b) xoá mọi object Storage mà các dòng đó trỏ tới (bucket `audio-responses` và bucket học viên khác trong danh mục) **trước** khi xoá dòng; (c) *ẩn danh* các bảng loại `anonymize` (hàng `users`: email, tên, ảnh, số điện thoại, email nhận thông báo, mục tiêu, thời gian biểu và mọi cột cá nhân khác về NULL hoặc giá trị bia mộ, giữ `id`, `role`, `created_at`); (d) *giữ nguyên* các bảng loại `keep`, trỏ về `id` đã ẩn danh. Danh sách tối thiểu theo 0055 C2: xoá `learner_email_outbox`, `credit_cluster_members`, `credit_covered_requests`; ẩn danh `users`, `learner_login_events` (bỏ IP, user agent, vị trí); giữ `enrollment_orders`, `enrollment_order_events`, `entitlements`, `entitlement_events`, `credit_ledger`, `credit_reservations`. Bảng đầy đủ ở `plan.md` mục 2.
- **FR-006:** Mọi cột trỏ người dùng có trong migration (khoá ngoại tới `public.users(id)` hoặc `auth.users(id)`, và cột tên `user_id`/`learner_id` không có khoá ngoại) phải có một dòng phân loại trong danh mục (`delete`, `anonymize`, `keep` hoặc `staff_actor`). Test `tests/test_account_data_inventory.py` đọc `backend/migrations/*.sql` và thất bại khi có cột chưa phân loại, nên bảng mới thêm sau này không lọt khỏi đường xoá. Bảng có từ trước hệ migration (`users`, `sessions`, `responses` và các bảng gốc khác) được ghi tay trong danh mục và đối chiếu bằng truy vấn catalog chỉ đọc trên staging trước PR mã (`tasks.md` T001).
- **FR-007:** Khi xoá, các quyền khoá còn hiệu lực bị thu hồi qua đường thu hồi của 0055 với lý do `account_erased` (ghi sự kiện chỉ ghi thêm), nên lượt chấm AI chưa dùng hết hiệu lực; không dòng sổ lượt hay chứng từ nào bị sửa hoặc xoá. `access_codes.is_used`, `used_by`, `used_at` không đổi; `user_code_assignments` của người đó chỉ đổi `is_active=false`.
- **FR-008:** Đăng nhập bị vô hiệu vĩnh viễn: người dùng Auth được xoá mềm qua Supabase Auth admin (`should_soft_delete`), để GoTrue che email và số điện thoại, bỏ danh tính đăng nhập và giữ `id`, nên dòng `public.users` và các khoá ngoại `RESTRICT` không bị chạm. Sau khi xoá, đăng nhập bằng email cũ thất bại và mọi token cũ bị từ chối. Email cũ đăng ký lại được thành tài khoản mới, không liên kết với `id` cũ (kiểm trên staging trước khi bật, `rollout.md`).
- **FR-009:** Job xoá chạy được lại an toàn: mỗi bước idempotent; lỗi ở bước nào thì yêu cầu ở trạng thái `erasing` với `last_error_code`, không bước nào sau đó chạy cho người đó trong lượt này, và lượt sau làm lại từ bước đầu. Sau `ACCOUNT_ERASURE_MAX_ATTEMPTS` lượt lỗi, job gửi cảnh báo chủ dự án (`owner_alerts`) và ngừng thử người đó cho tới khi có người đặt lại. Xong mọi bước thì `erased` với `erased_at`. Dòng yêu cầu chỉ giữ `user_id` và các mốc thời gian, không lưu email.
- **FR-010:** `POST /api/account/data-export` tạo một việc xuất `queued` cho chính người gọi. Đang có việc `queued`/`building` thì trả lại việc đó (200). Đã có gói `ready` tạo trong `ACCOUNT_EXPORT_COOLDOWN_HOURS` giờ thì 429 `export_recently_requested` kèm `retry_after`. Tài khoản đang `pending` xoá vẫn tải được dữ liệu. `GET /api/account/data-export` trả việc gần nhất: `status`, `requested_at`, `ready_at`, `expires_at`, `size_bytes`.
- **FR-011:** Job tạo gói ZIP gồm `manifest.json` (thời điểm, phiên bản danh mục, danh sách tệp, phần bị bỏ và lý do), hồ sơ, dữ liệu mọi bảng loại `delete`/`anonymize` có cờ `export` của người đó dưới dạng JSON, phiếu kết quả PDF của từng phiên Speaking đã hoàn tất (`services/pdf_generator.py`), lịch sử lượt chấm AI và đơn đăng ký, và các bản ghi âm còn được giữ. Gói vượt `ACCOUNT_EXPORT_MAX_BYTES` thì bỏ bản ghi âm và ghi vào manifest. Gói lưu trong bucket riêng tư `account-exports` (chỉ `service_role`); không gói nào chứa dữ liệu của người khác. Xong thì `ready`, `expires_at = ready_at + 7 ngày`, gửi thư báo qua `send_direct`. Lỗi thì `failed` với `last_error_code`, người học yêu cầu lại được ngay.
- **FR-012:** Thư báo chỉ chứa link tới trang Tài khoản, không chứa URL Storage. `GET /api/account/data-export/{export_id}/download` chỉ cho chủ gói: gói của người khác hoặc không có → 404 `export_not_found`; quá `expires_at` → 410 `export_expired`; chưa `ready` → 409 `export_not_ready`; còn hạn → 302 tới URL ký sống `ACCOUNT_EXPORT_SIGNED_URL_SECONDS` giây (mặc định 60), `Cache-Control: no-store`. Job xoá object quá hạn và chuyển việc sang `expired`. Khi tài khoản bị xoá, mọi gói của người đó bị xoá cùng.
- **FR-013:** Mọi route của spec này cần đăng nhập, trả 401 khi không có phiên, có lược đồ request/response trong OpenAPI (`frontend/types/api.d.ts` sinh lại), và ghi log sự kiện (`account_deletion_requested`, `_cancelled`, `_erased`, `_failed`, `account_export_requested`, `_ready`, `_failed`, `_downloaded`) với `user_id` và id yêu cầu, không email.

## Acceptance scenarios

### Scenario 1 — Gõ sai email

- **Given** người học đăng nhập với `a@example.com`
- **When** gửi yêu cầu xoá với `confirm_email = "b@example.com"`
- **Then** nhận 422 `confirm_email_mismatch`, không có dòng yêu cầu, phiên vẫn còn

### Scenario 2 — Gửi yêu cầu xoá

- **Given** người học có hai thiết bị đang đăng nhập
- **When** gửi yêu cầu xoá với email đúng
- **Then** nhận 200 `pending` có `erase_after` sau 30 ngày (mặc định tạm), cả hai thiết bị bị đăng xuất ở yêu cầu kế tiếp, và có thư xác nhận

### Scenario 3 — Huỷ trong hạn

- **Given** yêu cầu `pending`, người học đăng nhập lại
- **When** gọi một route học viên thì nhận 403 `account_deletion_pending`; gọi huỷ thì nhận `cancelled`
- **Then** route học viên dùng lại được, và job chạy sau `erase_after` không xoá gì của người này

### Scenario 4 — Xoá sau hạn

- **Given** yêu cầu `pending` đã qua `erase_after`, người học có phiên Speaking kèm ghi âm, bài Writing, một đơn đăng ký đã xác nhận và dòng sổ lượt
- **When** job chạy với cờ bật
- **Then** không còn phiên, câu trả lời, object ghi âm, bài Writing của người đó; hàng `users` không còn email hay tên; đơn đăng ký và sổ lượt còn nguyên và trỏ cùng `id`; đăng nhập bằng email cũ thất bại; yêu cầu `erased`

### Scenario 5 — Dry-run

- **Given** cờ `ACCOUNT_ERASURE_ENABLED` tắt
- **When** job chạy
- **Then** log liệt kê người đến hạn và số dòng theo bảng, không dòng nào đổi

### Scenario 6 — Tải dữ liệu

- **Given** người học yêu cầu tải dữ liệu
- **When** job tạo gói xong
- **Then** người học nhận thư, mở trang Tài khoản tải được ZIP gồm manifest, JSON, phiếu PDF; ngày thứ 8 link trả 410 `export_expired`; người khác dùng id gói nhận 404

## Edge cases

- Hai yêu cầu xoá gửi cùng lúc: một dòng `pending` (ràng buộc duy nhất một yêu cầu đang mở mỗi người), yêu cầu thứ hai nhận lại dòng đó.
- Huỷ đúng lúc job đang xoá: job khoá dòng và đọc lại trạng thái; nếu huỷ ghi trước thì job bỏ qua; nếu job đã sang `erasing` thì huỷ trả 409 `deletion_in_progress`.
- Người học có bài có giờ đang làm: vẫn bị đăng xuất ngay (người học đã chủ động xoá); bài đó bị xoá cùng tài khoản.
- Người học là thành viên lớp: hàng `students` của lớp được ẩn danh (giữ để số liệu lớp không đổi, câu hỏi mở 5); bài giao lớp đã nộp bị xoá.
- Object Storage đã mất trước đó (retention đã xoá): coi như đã xoá, không lỗi.
- Supabase Auth không trả lời: bước Auth lỗi, yêu cầu ở `erasing`, lượt sau làm lại; dữ liệu đã xoá không được khôi phục.
- Gói tải lớn, nhiều bản ghi âm: bỏ ghi âm theo FR-011 thay vì làm hỏng gói.
- Người học yêu cầu xoá khi có gói tải đang tạo: gói vẫn tạo và tải được tới khi tài khoản bị xoá.
- Tài khoản đã `erased` cố đăng nhập: GoTrue từ chối; backend không bao giờ trả dữ liệu cho `id` đã xoá.

## Success criteria

- Trên staging, một tài khoản thử đi hết kịch bản 4: truy vấn kiểm sau xoá trả 0 dòng ở mọi bảng loại `delete` cho `id` đó, 0 object ghi âm, và số dòng chứng từ/sổ lượt không đổi so với trước.
- `tests/test_account_data_inventory.py` xanh và thất bại khi thêm thử một migration có cột trỏ người dùng chưa phân loại.
- Người học tự tải được gói trong tối đa `ACCOUNT_EXPORT_READY_HOURS` giờ ở staging.

## Open questions

1. **Phương án A hay để sau?** (04-VIEC-DE-LAI câu 3). Đề xuất: A, vì đây là quyền của chủ thể dữ liệu và chi phí là 3 phiên mã.
2. **`ACCOUNT_DELETE_GRACE_DAYS`** — `CẦN ANH ANDY QUYẾT`. Đề xuất 30 ngày (cấu hình được).
3. **Thời gian chuẩn bị gói và nội dung:** đề xuất `ACCOUNT_EXPORT_READY_HOURS = 24`, gồm bản ghi âm còn giữ, trần `ACCOUNT_EXPORT_MAX_BYTES = 200 MiB` (quá thì bỏ ghi âm), cooldown 24 giờ.
4. **Chặn học trong hạn huỷ (FR-003):** đề xuất có, để không tạo bài làm mới sẽ bị xoá và để người học thấy rõ trạng thái.
5. **Hàng `students` của lớp:** đề xuất ẩn danh (giữ hàng, bỏ tên, email, số điện thoại) để thống kê lớp của giáo viên không đổi; xoá hẳn thì số học viên lớp cũ thay đổi.
6. **`credit_covered_requests`** có trigger chỉ ghi thêm (migration 384). Đề xuất: migration nhãn 500 thêm một hàm `SECURITY DEFINER` chỉ `service_role` gọi được, xoá dòng của đúng một người khi việc xoá của người đó đang `erasing`; trigger cho phép đúng đường này. Cần SA duyệt vì nới một bảng chỉ ghi thêm.
