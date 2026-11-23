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
- **FR-003:** Trong hạn huỷ, người học đăng nhập lại được. `GET /api/account/deletion-request` trả trạng thái và `erase_after`. `POST /api/account/deletion-request/cancel` chuyển `pending` → `cancelled` (ghi `cancelled_at`); không có yêu cầu `pending` → 409 `no_pending_deletion_request`; yêu cầu đã `erasing` → 409 `deletion_in_progress`. Trong lúc `pending`, một hàm quyết định duy nhất `account_deletion_gate.allows(method, route)` (cùng kiểu `is_exempt` của cổng kích hoạt, gọi ngay sau cổng kích hoạt trong `require_active_learner`) chỉ cho qua: `GET /auth/me`, mọi route `/api/account/deletion-request*` và `/api/account/data-export*`, `GET` các route đơn đăng ký của chính người đó (`/api/enrollment-orders/me*`) và route công khai không cần đăng nhập; mọi route học viên khác trả 403 `account_deletion_pending`. Danh sách nằm trong mã và có test kê đủ (như `test_activation_gate_inventory.py`).
- **FR-004:** Job xoá chỉ nhận yêu cầu `pending` có `erase_after <= now()`, hoặc yêu cầu `erasing` đã hết hợp đồng thuê (`lease_until < now()`). Nhận yêu cầu là một câu cập nhật có điều kiện, ghi `status='erasing'`, `erasing_owner` (id tiến trình) và `lease_until = now() + ACCOUNT_ERASURE_LEASE_SECONDS`; trước mỗi bước, tiến trình gia hạn bằng câu cập nhật có điều kiện `erasing_owner = <mình>`, không gia hạn được (bị tiến trình khác tiếp quản) thì dừng ngay. Yêu cầu đã huỷ không bao giờ bị nhận. Job có `--dry-run` (mặc định ở mọi môi trường cho tới khi bật `ACCOUNT_ERASURE_ENABLED`) liệt kê người đến hạn và số dòng theo bảng mà không đổi gì.
- **FR-005:** Khi xoá, job làm theo danh mục `services/account_data_inventory.py`: (a) *xoá* mọi dòng loại `delete` của người đó (bài làm, ghi âm, nhận xét, tiến độ, nhật ký, ghi chú của nhân viên về người học); (b) xoá object Storage mà các dòng đó trỏ tới **trước** khi xoá dòng, trong đúng hai bucket: `audio-responses` (ghi âm Speaking và phát âm khoá học) và `account-exports` (gói tải, theo tiền tố `<user_id>/`). Bucket `writing-images` chỉ chứa ảnh đề Task 1 do admin tải lên (`prompts/…`, `services/writing_prompt_image.py`), không có tệp người học, nên không quét; các bucket nội dung khác (`listening-*`, `reading-images`, `vocab-audio`, `library-media`) cũng không có tệp người học. T001 xác nhận lại mọi đường ghi Storage của người học; (c) *ẩn danh* bảng loại `anonymize` (hàng `users`: email, tên, ảnh, số điện thoại, email nhận thông báo, mục tiêu, thời gian biểu và mọi cột cá nhân khác về NULL hoặc giá trị bia mộ, giữ `id`, `role`, `created_at`); (d) *giữ nguyên* bảng loại `keep`, trỏ về `id` đã ẩn danh. Danh sách tối thiểu theo 0055 C2: xoá `learner_email_outbox`, `credit_cluster_members`; ẩn danh `users`, `learner_login_events` (bỏ IP, user agent, vị trí); giữ `enrollment_orders`, `enrollment_order_events`, `entitlements`, `entitlement_events`, `credit_ledger`, `credit_reservations`, và `credit_covered_requests` (mặc định, câu hỏi mở 6). Bảng đầy đủ ở `plan.md` mục 2.
- **FR-006:** Mọi cột trỏ người dùng trong migration phải có một dòng phân loại trong danh mục (`delete`, `anonymize`, `keep`, `staff_actor` hoặc `staff_only`). "Trỏ người dùng" gồm: khoá ngoại tới `public.users(id)`, `auth.users(id)` hoặc `public.students(id)`; mọi cột tên `user_id`, `learner_id`, `student_id`, `used_by` hoặc kết thúc bằng `_user_id`, kể cả khi không có khoá ngoại; và các đường JSON mang id người dùng khai trong danh mục (ví dụ `access_code_audit.before->>assigned_user`). Test `tests/test_account_data_inventory.py` đọc `backend/migrations/*.sql`, sinh danh sách `(bảng, cột, migration)` và thất bại khi có cột chưa phân loại hoặc danh mục ghi cột không còn tồn tại, nên bảng mới thêm sau này không lọt khỏi đường xoá. Bảng có từ trước hệ migration (`users`, `sessions`, `responses` và các bảng gốc khác) được ghi tay và đối chiếu bằng truy vấn catalog chỉ đọc trên staging trước PR mã (`tasks.md` T001).
- **FR-007:** Khi xoá, các quyền khoá còn hiệu lực bị thu hồi qua đường thu hồi của 0055 với lý do `account_erased` (ghi sự kiện chỉ ghi thêm), nên lượt chấm AI chưa dùng hết hiệu lực; không dòng sổ lượt hay chứng từ nào bị sửa hoặc xoá. `access_codes.is_used`, `used_by`, `used_at` không đổi; `user_code_assignments` của người đó chỉ đổi `is_active=false`.
- **FR-008:** Đăng nhập bị vô hiệu vĩnh viễn: người dùng Auth được xoá mềm qua Supabase Auth admin (`should_soft_delete`), để GoTrue che email và số điện thoại, bỏ danh tính đăng nhập và giữ `id`, nên dòng `public.users` và các khoá ngoại `RESTRICT` không bị chạm. Sau khi xoá, đăng nhập bằng email cũ thất bại và mọi token cũ bị từ chối. Email cũ đăng ký lại được thành tài khoản mới, không liên kết với `id` cũ (kiểm trên staging trước khi bật, `rollout.md`).
- **FR-009:** Job xoá chạy lại an toàn: mỗi bước idempotent (bước làm lại sau khi đã xong không đổi gì và không lỗi); lỗi ở bước nào thì yêu cầu giữ `erasing` với `last_error_code`, tiến trình nhả hợp đồng thuê, và lần nhận sau làm lại từ bước đầu. Sau `ACCOUNT_ERASURE_MAX_ATTEMPTS` lần lỗi, job gửi cảnh báo chủ dự án (`owner_alerts`) và chuyển `failed` cho tới khi có người đặt lại. Xong mọi bước thì `erased` với `erased_at`. Dòng yêu cầu chỉ giữ `user_id` và các mốc thời gian, không lưu email. Thư "đã xoá" gửi thẳng (không qua outbox) và đánh dấu `erased_notice_sent_at` trên dòng yêu cầu, nên chạy lại không gửi lần hai và không để lại email trong outbox.
- **FR-010:** `POST /api/account/data-export` tạo một việc xuất `queued` cho chính người gọi. Đang có việc `queued`/`building` thì trả lại việc đó (200). Đã có gói `ready` tạo trong `ACCOUNT_EXPORT_COOLDOWN_HOURS` giờ thì 429 `export_recently_requested` kèm `retry_after`. Tài khoản `pending` xoá vẫn tải được dữ liệu; tài khoản `erasing` nhận 409 `account_erasing`. `GET /api/account/data-export` trả việc gần nhất: `status`, `requested_at`, `ready_at`, `expires_at`, `size_bytes`.
- **FR-011:** Job tạo gói ZIP gồm `manifest.json` (thời điểm, phiên bản danh mục, danh sách tệp, phần bị bỏ và lý do), hồ sơ, dữ liệu mọi bảng loại `delete`/`anonymize` có cờ `export` của người đó dưới dạng JSON, phiếu kết quả PDF của từng phiên Speaking đã hoàn tất (`services/pdf_generator.py`), lịch sử lượt chấm AI và đơn đăng ký, và các bản ghi âm còn được giữ. Gói vượt `ACCOUNT_EXPORT_MAX_BYTES` thì bỏ bản ghi âm và ghi vào manifest. Gói lưu trong bucket riêng tư `account-exports` (chỉ `service_role`); không gói nào chứa dữ liệu của người khác. Xong thì `ready`, `expires_at = ready_at + 7 ngày`, gửi thư báo qua `send_direct`. Lỗi thì `failed` với `last_error_code`, người học yêu cầu lại được ngay.
- **FR-012:** Thư báo chỉ chứa link tới trang Tài khoản, không chứa URL Storage. `GET /api/account/data-export/{export_id}/download` chỉ cho chủ gói: gói của người khác, không có, hoặc tài khoản đã `erasing`/`erased` → 404 `export_not_found`; quá `expires_at` → 410 `export_expired`; chưa `ready` → 409 `export_not_ready`; còn hạn → 302 tới URL ký sống `ACCOUNT_EXPORT_SIGNED_URL_SECONDS` giây (mặc định 60), `Cache-Control: no-store`. Job xoá object quá hạn và chuyển việc sang `expired`.
- **FR-013:** Mọi route của spec này cần đăng nhập, trả 401 khi không có phiên, có lược đồ request/response trong OpenAPI (`frontend/types/api.d.ts` sinh lại), và ghi log sự kiện (`account_deletion_requested`, `_cancelled`, `_erased`, `_failed`, `account_export_requested`, `_ready`, `_failed`, `_downloaded`) với `user_id` và id yêu cầu, không email.
- **FR-014:** Xuất gói và xoá tài khoản không chạy chồng lên nhau. (a) Câu cập nhật nhận yêu cầu sang `erasing` (FR-004) cùng một giao dịch chuyển mọi việc xuất `queued`/`building` của người đó sang `cancelled`; từ đó không việc xuất mới nào được tạo (FR-010). (b) Mỗi lần job xuất nhận một việc có `claim_token` riêng và tải ZIP lên đường riêng `account-exports/<user_id>/<export_id>/<claim_token>.zip`; hợp đồng thuê được gia hạn ngay trước khi tải và kiểm lại ngay sau; `ready` chỉ ghi bằng câu cập nhật có điều kiện khớp `export_owner`, `claim_token`, hợp đồng thuê còn hạn và không có yêu cầu xoá `erasing`/`erased`; thua thì chỉ xoá đúng đường của mình. (c) Việc xoá chỉ ghi `erased` khi không còn việc xuất nào của người đó còn hạn thuê, rồi quét toàn bộ tiền tố `account-exports/<user_id>/`. (d) Một bước dọn định kỳ xoá mọi object trong bucket không phải gói `ready` còn hạn hay đường của một lần nhận còn hạn thuê. Sau `erased`, không còn object nào dưới tiền tố đó và không lượt tải nào thành công; một tiến trình cũ không bao giờ xoá gói `ready` của tiến trình mới.

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
- Huỷ đúng lúc job đang xoá: nhận yêu cầu là câu cập nhật có điều kiện `status='pending'`; huỷ ghi trước thì job không nhận được; job nhận trước thì huỷ trả 409 `deletion_in_progress`.
- Tiến trình xoá chết giữa chừng hoặc bước Storage/Auth chạy lâu: hợp đồng thuê hết hạn thì tiến trình khác tiếp quản và làm lại từ bước đầu; tiến trình cũ tỉnh lại không gia hạn được nên dừng trước bước kế.
- Job xuất đang chạy khi yêu cầu sang `erasing`: việc xuất bị huỷ, job xuất không ghi được `ready` và xoá object của nó; bước quét Storage xoá phần còn sót (FR-014).
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
6. **`credit_covered_requests`** (mặc định `keep`, theo CR/SA R1). Sau khi `users` bị ẩn danh, dòng của bảng này chỉ còn `user_id`, `request_key` và id tài nguyên (đã bị xoá), không email, nội dung hay IP, nên giống `credit_reservations`/`credit_ledger` mà spec đã giữ. Giữ thì không phải nới trigger chỉ ghi thêm. Việc này đổi danh sách 0055 C2 (xếp bảng vào "xoá"), nên cần anh quyết. Đề xuất: giữ. Nếu anh muốn xoá: migration thêm hàm `SECURITY DEFINER` chỉ `service_role` gọi được, khoá `FOR UPDATE` dòng yêu cầu; trigger chỉ cho `DELETE` khi cùng lúc có yêu cầu `erasing` của đúng `OLD.user_id`, biến phiên đặt đúng người đó và `current_user` là chủ hàm; `DELETE` trực tiếp vẫn bị thu hồi khỏi `service_role`; test PG chứng minh xoá trực tiếp, đặt biến phiên khi không có yêu cầu `erasing`, `UPDATE`, `TRUNCATE` đều thất bại.
7. **`learner_care_notes` (mig 442, #2471):** ghi chú tự do của admin về người học. Đề xuất: xoá khi xoá tài khoản, và không đưa vào gói tải (đây là ghi chú nội bộ của nhân viên).
