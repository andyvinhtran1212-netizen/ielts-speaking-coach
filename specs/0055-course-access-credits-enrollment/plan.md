# Implementation plan

## Architecture impact

Chỉ backend, migration, test. Router mới `routers/courses_public.py`, `routers/enrollment.py`, `routers/me_access.py`,
`routers/account_sessions.py`, `routers/admin_commerce.py`; service mới `services/entitlements.py`,
`services/credits.py`, `services/enrollment_orders.py`, `services/learner_email.py`, `services/single_session.py`;
job `scripts/enrollment_sweep.py`. Điểm móc vào `routers/grading.py::grade_response_endpoint`,
`routers/writing_student.py::submit_my_assignment`, `services/essay_service.py`, `routers/auth.py::activate_account`
và `services/retention.py` — chi tiết đúng tên hàm ở 5.6, 5.13, 5.14. Không đặt trừ lượt ở tầng provider.
Giao diện dùng các API này thuộc G05, G07, G08, G09 và GOI-11.

Ràng buộc riêng của gói (mục 8), chép nguyên:

- Không sửa `backend/migrations/359_activation_serialize.sql` hay bất kỳ migration cũ; mọi thay đổi là migration mới.
- Không đổi hành vi, thông báo, mã lỗi của `/auth/activate` với mã không có `product_id` (kể cả câu riêng "Bạn đã kích hoạt mã này rồi." đang có).
- Lớp đang chạy bằng mã cũ chỉ bị đo lượt sau khi admin chủ động chuyển lớp đó (5.18); không job, migration hay cờ nào được tự chuyển hay tự chặn một lớp.
- Không thu, không lưu, không log địa chỉ IP, vị trí hay chuỗi `User-Agent` gốc ở bảng lần đăng nhập; `approx_location` luôn null.
- Thư học viên đi qua đúng một lớp gọi Resend (`owner_alerts.send_via_resend`); không thêm thư viện gửi thư, không thêm nhà cung cấp thứ hai; `RESEND_API_KEY` không vào `Settings`, không vào file `.env`, không vào log.
- Thời hạn 45 ngày chỉ **ẩn** bài Writing ở tầng đọc của học viên; không xoá `writing_essays`. Xoá thật chỉ có ở đường `retention_sweep` sẵn có của Speaking (mặc định DRY_RUN).
- Không đặt trừ lượt ở tầng provider (`grading_orchestrator.py`, `ai_router.py`, `claude_grader.py`, `gemini_writing_grader.py`).
- Một kho lượt: không thêm cột, bảng hay tham số nào tách số dư theo Writing/Speaking.
- Speaking luyện tập không bao giờ chờ giáo viên; không thêm trạng thái "chờ duyệt" cho `responses`.
- Không ghi cứng tên khoá, học phí, thời hạn, số lượt, ngày mở, tài khoản nhận tiền, hạn giữ đơn trong mã, migration hay fixture dùng chung; test tự tạo dữ liệu thử có tiền tố `test-`.
- Câu chữ trả cho người dùng và trong thư: "Đăng ký lại" cho khoá hết hạn; không dùng "mua", "bán", "giá", "đơn hàng", "thầy", "giảng viên"; xưng "bạn".
- Không lưu, không log mã đăng nhập, token, địa chỉ IP thô. Không ghi email, tên, số tiền, mã đơn vào log; chỉ ghi lý do, trạng thái, slug.
- Mọi cờ mới mặc định tắt; production không bật cờ nào và không đổi `RETENTION_AUDIO_DAYS` trong gói này.
- Không gọi AI trả phí trong test; grader, Whisper và Azure luôn là bản giả.
- Thứ tự áp: 381 → 382 → 383 → 388 (nhóm `course_commerce`, 381 và 382 luôn cùng một lượt), 384 → 387 (`single_session`), 385 (`pron_sample`); 386 không có file; **staging trước** dưới khoá tư vấn (`apply_migrations.sh` + `MIGRATION_FEATURES`), sau khi anh Andy duyệt chạy; production chỉ ở lần promote staging→main được anh cho phép, sau khi T11 có bằng chứng; backend chứa T03+ deploy **sau** migration (backend mới gọi RPC mới; backend cũ không biết bảng mới nên migration áp trước là an toàn).
- Quay lui: (1) tắt cờ `credit_metering`, `enrollment_orders`, `single_session_learners`, `retention_by_entitlement`, `pron_sample_window` (hiệu lực ≤15 s); (2) deploy lại backend trước đó; (3) chỉ khi cần mới chạy rollback theo thứ tự ngược với thứ tự áp: 385 → 387 → 384 → 388 → 383 → 382 → 381 — script 381–383 và 388 giữ bảng và dữ liệu, gỡ hàm/trigger, từ chối khi có dữ liệu đơn/lượt trừ khi GUC mở rõ ràng. Không bao giờ xoá dòng `credit_ledger`/`enrollment_orders`.
- Spec approval file theo mẫu repo; câu trả lời của anh Andy ghi nguyên văn kèm thời điểm.
- Quan hệ với GOI-11 phần C: bốn mẫu thư đơn, RPC nhắc và các RPC không ghi outbox đã nằm trong 381/382 của gói này. G11-T07 (sửa spec G04/G05) và phần "migration 472 cho thư đơn" của G11-T18 không còn việc ở phía G04; nếu 381/382 đã merge theo bản cũ trước khi file này được dùng, phần chênh (CHECK mẫu, RPC, cột `carry_*`, giá trị `class_conversion`, bỏ cột `retention_content_days`) đi bằng một migration mới số 389 (số dự phòng cuối cùng của dải; 387 và 388 đã có việc), không sửa file đã merge.

## Data and contracts

Mục 5 của gói, chép nguyên (lược đồ 381/382/383/384/385/387/388, RPC, quy tắc truy cập và đo lượt, trạng thái,
điểm móc, luồng trả kết quả, API, cấu hình và cờ, thư, sự kiện, một phiên, lưu dữ liệu, vòng đời lượt, đoạn mẫu
phát âm, chuyển lớp mã cũ). Migration 386 để trống có chủ ý; 389 dự phòng của gói.

### 5.1 Quyết định mô hình: mở rộng `courses` + bảng mới `course_products`

- `courses` giữ vai trò "giáo trình/nhãn nội dung" mà `cohorts.course_id`, `quiz_banks.course_id`, `speaking_lesson_sets.course_id` đang trỏ vào. Thêm một cột `kind` (`class` mặc định cho C1..C5, `online` cho 6 khoá kỹ năng) để G07 gắn ngân hàng bài của khoá online bằng đúng FK hiện có, và để bộ chọn khoá khi tạo lớp lọc `kind='class'`.
- Điều khoản đăng ký (học phí, thời hạn, lượt, hạn dùng lượt, trạng thái mở đăng ký, luồng trả kết quả Writing) nằm ở `course_products`. Lý do: (1) Course 1–5 không có học phí nhưng vẫn cần "sản phẩm" để mã kích hoạt và admin cấp quyền; (2) một khoá có thể có nhiều điều khoản (khoá của lớp và quyền luyện lại cùng C3); (3) đổi học phí không được làm thay đổi đơn đã tạo (đơn chụp lại); (4) không chạm bảng `courses` mà 344 đã đóng quyền và test `_pre_320()` dựng lại nguyên văn.
- `entitlements` trỏ `product_id` (bắt buộc) + `course_id` (bản sao để lọc nhanh, khớp bằng FK ghép).
- **Một kho lượt chung:** lượt gắn với một quyền (một khoá của một người), không gắn với kỹ năng. Writing và Speaking cùng trừ vào đó. Cột `feature` trên sổ chỉ để hiển thị "chấm bài gì", không tham gia tính số dư.
- **Hai loại lượt, một sổ:** lượt khoá online (cộng khi xác nhận đơn, hết hiệu lực khi khoá hết hạn, được chuyển toàn bộ sang kỳ mới khi đăng ký lại và bảo lưu 60 ngày — 5.15) và lượt lớp (cộng theo `grant_credits` của mã hoặc theo lệnh chuyển lớp mã cũ sang đo lượt, cấp thêm bằng `grant_extra`, hết khi quyền lớp hết, không chuyển). Khác nhau ở nguồn cấp và quy tắc hết hạn, không khác bảng.
- Thành viên lớp và mã cũ **không** ghi thành dòng `entitlements` (không backfill): `services/entitlements.py` suy ra chúng lúc đọc. Lý do: tránh động vào sự thật của các mã đã kích hoạt và các lớp đang chạy. Hệ quả có chủ ý: người chỉ có mã cũ không có nơi nhận lượt nên bài của họ không đo lượt **cho tới khi admin chuyển lớp của họ sang đo lượt** (5.18): lệnh đó tạo cho từng thành viên một dòng `entitlements` loại `class` kèm số lượt ban đầu, từ đó bài giao của lớp trừ vào lượt ấy. Không có đợt backfill tự động; mỗi lớp do admin chủ động chuyển.
- **Dữ liệu chưa chốt không nằm trong mã:** tên sáu khoá, học phí, thời hạn, số lượt, ngày mở là dữ liệu `course_products` do admin nhập qua API (G11-T29 nhập tên trên staging, để `coming_soon`); tài khoản nhận tiền và hạn giữ đơn là cấu hình (5.10), để trống thì không tạo được đơn. Migration không seed sản phẩm nào. Test dùng sản phẩm thử tự tạo.

### 5.2 Migration M1 — lược đồ (số 381, theo dải đã cấp ở `01-KE-HOACH-TONG.md` mục 6)

File `backend/migrations/381_course_commerce_core.sql`. Một giao dịch, `SET LOCAL lock_timeout = '5s'`, idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`), không đổi dòng dữ liệu cũ, khối DO cuối kiểm postcondition (RLS bật, không quyền client, ACL hàm, `search_path`) và `RAISE EXCEPTION` nếu sai. Mọi hàm: `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`, tên bảng/hàm ghi đủ `public.`, `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role`.

**`courses` (sửa):** `ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'class' CHECK (kind IN ('class','online'))`. Dòng cũ nhận `class`.

**`course_products` (mới)**

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK, default `gen_random_uuid()` |
| course_id | uuid | NOT NULL, FK `courses(id)` ON DELETE RESTRICT |
| slug | text | NOT NULL UNIQUE, CHECK `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'` và độ dài ≤ 80 |
| kind | text | NOT NULL CHECK IN (`online`,`class`,`repractice`) |
| title | text | NOT NULL, độ dài 1..120 |
| short_title | text | NULL, độ dài 1..60 (tên gọi tắt, ví dụ "Khoá Ngữ pháp nền tảng"; NULL → giao diện dùng `title`) |
| summary | text | NULL, ≤ 1000 |
| status | text | NOT NULL DEFAULT `draft` CHECK IN (`draft`,`coming_soon`,`open`,`closed`) |
| is_public | boolean | NOT NULL DEFAULT false; CHECK `kind = 'online' OR NOT is_public` |
| tuition_vnd | integer | NULL, CHECK `> 0`; CHECK `NOT (kind='online' AND status='open') OR tuition_vnd IS NOT NULL` |
| access_days | integer | NULL = không hạn, CHECK `BETWEEN 1 AND 3650`; CHECK `kind <> 'online' OR status <> 'open' OR access_days IS NOT NULL` |
| ai_credits | integer | NOT NULL DEFAULT 0, CHECK `BETWEEN 0 AND 100000`. Chỉ dùng cho `online` và cho admin cấp quyền; sản phẩm `class` lấy lượt từ `access_codes.grant_credits` |
| credit_valid_days | integer | NULL = lượt dùng tới hết hạn quyền; CHECK `BETWEEN 1 AND 3650` |
| features | text[] | NOT NULL DEFAULT `'{}'`, CHECK `features <@ ARRAY['speaking','writing','reading','listening','grammar','vocabulary']` |
| review_mode | text | NOT NULL DEFAULT `ai_instant` CHECK IN (`ai_instant`,`teacher_review`). **Chỉ áp cho Writing** (FR-020) |
| display_order | integer | NOT NULL DEFAULT 0 |
| expected_open_on | date | NULL |
| presentation | jsonb | NOT NULL DEFAULT `'{}'`; chỉ nhận các khoá `level_from`, `level_to` (text ≤ 40), `author` (`name` ≤ 120, `bio_line` ≤ 300, `photo_url` ≤ 500 hoặc null), `faq` (mảng ≤ 30 phần tử `{q ≤ 300, a ≤ 2000}`); kiểm ở backend khi lưu, không CHECK chi tiết trong SQL ngoài `jsonb_typeof(presentation) = 'object'` |
| archived_at, archived_by | timestamptz, uuid | NULL; CHECK `archived_at IS NULL OR (status IN ('draft','closed') AND NOT is_public)` |
| created_by | uuid | FK `users(id)` ON DELETE SET NULL |
| created_at, updated_at | timestamptz | NOT NULL DEFAULT now(); trigger `update_updated_at_column()` như mig 175 |

Thêm `UNIQUE (id, course_id)` (cho FK ghép), index `(display_order) WHERE is_public AND archived_at IS NULL`. Không có cột lưu audio theo sản phẩm, và **ĐÃ BỎ** cột `retention_content_days` của bản sáng 18/11: thời hạn giữ nội dung nay là một quy tắc chung "45 ngày sau khi quyền khoá cuối cùng hết hạn" (5.14), không đặt theo sản phẩm.

**`entitlements` (mới)**

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | NOT NULL, FK `users(id)` ON DELETE RESTRICT |
| product_id, course_id | uuid | NOT NULL; FK ghép `(product_id, course_id)` → `course_products(id, course_id)` ON DELETE RESTRICT |
| source | text | NOT NULL CHECK IN (`enrollment_order`,`access_code`,`admin_grant`,`class_conversion`) |
| source_ref | uuid | NOT NULL (id đơn / id mã / `request_key` của admin / `cohort_id` với `class_conversion`) |
| status | text | NOT NULL DEFAULT `active` CHECK IN (`active`,`revoked`) — "hết hạn" tính từ `expires_at`, không lưu |
| starts_at | timestamptz | NOT NULL DEFAULT now() |
| expires_at | timestamptz | NULL = không hạn; CHECK `expires_at IS NULL OR expires_at > starts_at` |
| credits_expire_at | timestamptz | NULL = theo `expires_at`; CHECK `credits_expire_at IS NULL OR credits_expire_at > starts_at` |
| credits_closed_at | timestamptz | NULL; job đặt một lần khi đã ghi (hoặc xác định không cần ghi) dòng `expire` |
| renews_entitlement_id | uuid | NULL, FK `entitlements(id)` ON DELETE RESTRICT — quyền trước của cùng người, cùng sản phẩm (đặt lúc xác nhận đơn) |
| carry_settled_at | timestamptz | NULL; job đặt một lần khi đã xử lý việc chuyển lượt từ quyền trước (kể cả khi chuyển 0) |
| carry_expires_at | timestamptz | NULL; mốc hết hạn bảo lưu của phần lượt chuyển, job đặt cùng lúc với `carry_settled_at` khi có ghi dòng `carry_over` (5.15); CHECK `carry_expires_at IS NULL OR carry_settled_at IS NOT NULL` |
| carry_closed_at | timestamptz | NULL; job đặt một lần khi đã ghi (hoặc xác định không cần ghi) dòng `carry_expire`; CHECK `carry_closed_at IS NULL OR carry_expires_at IS NOT NULL` |
| review_mode | text | NULL (ghi đè sản phẩm, chỉ áp Writing), CHECK IN (`ai_instant`,`teacher_review`) |
| granted_by | uuid | NULL, FK `users(id)` ON DELETE SET NULL |
| reason | text | NULL, ≤ 500 |
| revoked_at, revoked_by, revoke_reason | timestamptz, uuid, text | NULL; CHECK `(status='revoked') = (revoked_at IS NOT NULL)` |
| created_at, updated_at | timestamptz | NOT NULL DEFAULT now() |

`UNIQUE (source, source_ref, user_id)`; index `(user_id, course_id) WHERE status='active'`; index `(coalesce(credits_expire_at, expires_at)) WHERE credits_closed_at IS NULL AND status='active'`. Trigger `trg_entitlements_guard` BEFORE UPDATE: chỉ cho (a) `status` từ `active` sang `revoked` kèm `revoked_*`; (b) tăng `expires_at` (gia hạn) và, cùng lệnh, tăng `credits_expire_at`; (c) đặt `credits_closed_at`, `carry_settled_at` (kèm `carry_expires_at` trong cùng lệnh) hoặc `carry_closed_at` từ NULL sang một giá trị, đúng một lần; gia hạn ở (b) **không** đổi `carry_expires_at`. Đổi `user_id/product_id/course_id/source/source_ref/starts_at/renews_entitlement_id` hoặc `revoked → active` → `RAISE EXCEPTION 'entitlement_immutable'`. BEFORE DELETE/TRUNCATE → từ chối.

**`entitlement_events` (mới, chỉ ghi thêm):** `id bigint GENERATED ALWAYS AS IDENTITY PK`, `entitlement_id uuid NOT NULL FK`, `action text CHECK IN ('grant','extend','revoke')`, `actor_id uuid NULL`, `actor_kind text CHECK IN ('admin','instructor','system','learner')`, `before jsonb`, `after jsonb`, `reason text ≤500`, `created_at`. Trigger từ chối UPDATE/DELETE/TRUNCATE (mẫu mig 356 `class_action_log_no_truncate`).

**`access_codes` (sửa):** `ADD COLUMN product_id uuid NULL REFERENCES course_products(id) ON DELETE RESTRICT`, `ADD COLUMN grant_days integer NULL CHECK (grant_days BETWEEN 1 AND 3650)`, `ADD COLUMN grant_credits integer NULL CHECK (grant_credits BETWEEN 0 AND 100000)`, `ADD CONSTRAINT access_codes_product_credits CHECK (product_id IS NULL OR grant_credits IS NOT NULL)`. Với mã có `product_id`: `expires_at` nghĩa là **hạn nhập mã** ("Mã dùng được đến" ở hộp Tạo mã); thời hạn quyền = `coalesce(grant_days, product.access_days)` tính từ `used_at` (cả hai NULL → quyền không hạn); số lượt cộng = `grant_credits` ("Số lượt chấm cấp kèm mã"), **không** lấy `product.ai_credits`. Trigger `trg_access_codes_product_kind` BEFORE INSERT/UPDATE OF product_id: sản phẩm phải có `kind IN ('class','repractice')` (FR-010).

**Trigger cấp quyền từ mã:** `fn_access_code_entitlement_sync()` AFTER INSERT OR UPDATE OF `is_used, used_by, is_revoked, is_active` ON `access_codes` FOR EACH ROW WHEN (`NEW.product_id IS NOT NULL`):
1. Nếu `NEW.is_used AND NEW.used_by IS NOT NULL AND NOT NEW.is_revoked AND NEW.is_active`: INSERT `entitlements(source='access_code', source_ref=NEW.id, user_id=NEW.used_by, starts_at=coalesce(NEW.used_at, statement_timestamp()), expires_at=starts_at + days hoặc NULL)` ON CONFLICT DO NOTHING; nếu vừa chèn và `NEW.grant_credits > 0`: INSERT `credit_ledger(reason='grant', delta=NEW.grant_credits, idempotency_key='code:'||NEW.id||':'||NEW.used_by||':grant')` ON CONFLICT DO NOTHING; ghi `entitlement_events`. (Bảng `credit_ledger` do M2 tạo; trigger kiểm `to_regclass('public.credit_ledger')` và ném lỗi rõ nếu chưa có, để không ai dùng mã có sản phẩm trước khi áp M2 — xem vướng mắc ở G04-T01.)
2. Nếu UPDATE và `OLD.used_by IS DISTINCT FROM NEW.used_by` với `OLD.used_by` không NULL: thu hồi quyền `(access_code, NEW.id, OLD.used_by)`.
3. Nếu `NEW.is_revoked OR NOT NEW.is_active`: thu hồi mọi quyền `source_ref = NEW.id`, `revoke_reason='code_revoked'`.
Trigger thứ hai `fn_code_assignment_entitlement_revoke()` AFTER UPDATE OF `is_active` ON `user_code_assignments` WHEN `OLD.is_active AND NOT NEW.is_active`: thu hồi quyền `(access_code, NEW.code_id, NEW.user_id)`. Mã cũ (`product_id` NULL) không chạy trigger nhờ mệnh đề `WHEN`.

**`enrollment_orders` (mới)**

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| order_code | text | NOT NULL UNIQUE, CHECK `order_code ~ '^AVER-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$'` |
| user_id | uuid | NOT NULL FK `users(id)` ON DELETE RESTRICT |
| product_id | uuid | NOT NULL FK `course_products(id)` ON DELETE RESTRICT |
| status | text | NOT NULL DEFAULT `awaiting_transfer` CHECK IN (`awaiting_transfer`,`transfer_reported`,`needs_info`,`confirmed`,`expired`,`cancelled`) |
| tuition_vnd | integer | NOT NULL > 0 (chụp lại) |
| access_days | integer | NOT NULL > 0 (chụp lại) |
| ai_credits | integer | NOT NULL >= 0 (chụp lại) |
| credit_valid_days | integer | NULL (chụp lại) |
| product_title | text | NOT NULL (chụp lại `title`) |
| request_key | text | NOT NULL, 8..80 ký tự; `UNIQUE (user_id, request_key)` |
| learner_note | text | NULL ≤ 1000 |
| info_kind | text | NULL CHECK IN (`underpaid`,`not_found`,`other`) — lý do của `needs_info` (chuyển thiếu · chưa tìm thấy khoản chuyển · cần bổ sung khác); "sai lệch" không phải trạng thái riêng |
| received_vnd | integer | NULL, CHECK `>= 0` — số tiền admin ghi nhận đã về (chỉ để hiển thị và nhật ký; máy chủ không tự quyết theo số này) |
| admin_message | text | NULL ≤ 1000 (lời nhắn "Cần bổ sung", chép nguyên văn vào thư) |
| supplement_by | timestamptz | NULL (hạn bổ sung, admin đặt trong hộp đánh dấu) |
| pay_by | timestamptz | NOT NULL (hạn giữ đơn) |
| transfer_reported_at, late_transfer_reported_at, confirmed_at, cancelled_at, expired_at, reopened_at | timestamptz | NULL |
| confirmed_by, cancelled_by | uuid | NULL FK `users(id)` ON DELETE SET NULL |
| cancel_reason | text | NULL ≤ 500 |
| entitlement_id | uuid | NULL FK `entitlements(id)`; CHECK `(status='confirmed') = (entitlement_id IS NOT NULL)` |
| created_at, updated_at | timestamptz | NOT NULL DEFAULT now() |

`CREATE UNIQUE INDEX enrollment_orders_one_open ON enrollment_orders (user_id, product_id) WHERE status IN ('awaiting_transfer','transfer_reported','needs_info')`; index `(status, created_at)`, `(user_id, created_at DESC)`. Trigger `trg_enrollment_orders_transition` BEFORE UPDATE OF status kiểm bảng 5.5 và từ chối mọi đổi `user_id/product_id/order_code/tuition_vnd/access_days/ai_credits/credit_valid_days/product_title`; DELETE/TRUNCATE bị từ chối.

**`enrollment_order_events` (mới, chỉ ghi thêm):** `id bigint identity`, `order_id uuid NOT NULL FK`, `from_status text NULL`, `to_status text NOT NULL`, `action text NOT NULL` (tên hành động ở bảng 5.5), `actor_id uuid NULL`, `actor_kind text CHECK IN ('learner','admin','system')`, `note text ≤1000`, `created_at`. GOI-11 phần A đọc bảng này để sinh thông báo trong ứng dụng.

**`learner_email_outbox` (mới — bảng email duy nhất cho học viên, phân xử 1 ở `01-KE-HOACH-TONG.md` mục 6):** `id uuid PK`, `user_id uuid NULL FK`, `to_email text NULL` (≤ 254), CHECK `(user_id IS NOT NULL) <> (to_email IS NOT NULL)` (đúng một trong hai), `template text CHECK IN ('order_created','order_pay_reminder','order_needs_info','order_confirmed','course_open_alert','result_ready_digest','course_expiring','course_expired','staff_notice')` (chín giá trị; `course_expired` — thư 8 "Khoá đã hết hạn" của tờ EmailMau, nguồn sinh ở G11-T12, thêm 18/11 theo rà soát), CHECK `(template = 'course_open_alert') = (to_email IS NOT NULL)`, `dedupe_key text NOT NULL UNIQUE`, `payload jsonb NOT NULL`, `status text CHECK IN ('pending','sent','failed','skipped') DEFAULT 'pending'`, `attempts int DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5)`, `next_attempt_at timestamptz DEFAULT now()`, `sent_at`, `last_error_code text`, `created_at`. Index `(status, next_attempt_at) WHERE status='pending'`. Dòng có `user_id` không lưu địa chỉ (đọc `users.email` lúc gửi). Dòng `to_email` (không có `user_id`) dùng cho thư gửi người có thể chưa có tài khoản — đúng một mẫu: `course_open_alert` ("Báo cho tôi khi mở", bảng `course_open_alerts` của G05-T22; đã quyết làm, 00 mục 2 điểm 23). Mẫu này **luôn** dùng `to_email`, kể cả khi người đăng ký nhận báo đã đăng nhập (địa chỉ lấy từ `course_open_alerts.email`). Bảy mẫu còn lại bắt buộc có `user_id` (CHECK ở trên). Khoá payload của bốn thư đơn: `order_code, product_title, tuition_vnd, pay_by, starts_at, expires_at, ai_credits, info_kind, admin_message, supplement_by` — không có band, nội dung bài, số điện thoại. Khoá payload của `course_open_alert` (do hàm của G05 ghi, GOI-05 mục 5.7): `product_slug, product_title, unsubscribe_token`. `dedupe_key`: `order:<id>:created`, `order:<id>:pay_reminder`, `order:<id>:needs_info:<event_id>`, `order:<id>:confirmed`, `open_alert:<id dòng course_open_alerts>:<epoch của subscribed_at>`. Thư mã đăng nhập **không** qua bảng này (5.11).

**RLS cho mọi bảng mới:** `ENABLE ROW LEVEL SECURITY`, không tạo policy, `REVOKE ALL ON <bảng> FROM anon, authenticated, PUBLIC`; sequence identity cũng REVOKE. Học viên chỉ đọc qua API backend lọc theo `user_id` của token.

### 5.3 Migration M2 — sổ lượt và RPC (số 382)

File `backend/migrations/382_credit_ledger_enrollment_rpcs.sql`, cùng quy ước M1.

**`credit_reservations`**

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | NOT NULL FK `users(id)` ON DELETE RESTRICT |
| entitlement_id | uuid | NOT NULL FK `entitlements(id)` ON DELETE RESTRICT |
| feature | text | NOT NULL CHECK IN (`speaking_grading`,`writing_grading`,`short_writing_feedback`) |
| cost | integer | NOT NULL CHECK `BETWEEN 1 AND 20` |
| request_key | text | NOT NULL 8..120; `UNIQUE (user_id, feature, request_key)` |
| status | text | NOT NULL DEFAULT `open` CHECK IN (`open`,`committed`,`released`,`expired`) |
| resource_type | text | NULL CHECK IN (`speaking_response`,`speaking_cluster`,`writing_essay`,`short_writing`) |
| resource_id | text | NULL ≤ 80 |
| expires_at | timestamptz | NOT NULL |
| settled_at | timestamptz | NULL; CHECK `(status='open') = (settled_at IS NULL)` |
| release_reason | text | NULL CHECK IN (`grader_failed`,`stt_failed`,`request_failed`,`budget_refused`,`expired`,`admin`) |
| created_at | timestamptz | NOT NULL DEFAULT now() |

Index `(status, expires_at) WHERE status='open'`, `(resource_type, resource_id) WHERE status='open'`, `(entitlement_id) WHERE status='open'`; `UNIQUE (user_id, resource_id) WHERE resource_type='speaking_cluster' AND status IN ('open','committed')` (một cụm chỉ có một lần trừ còn hiệu lực). Trigger guard: chỉ `open → committed|released|expired`, không đổi cột khác.

**`credit_ledger`**

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | bigint | GENERATED ALWAYS AS IDENTITY PK |
| user_id | uuid | NOT NULL FK `users(id)` ON DELETE RESTRICT |
| entitlement_id | uuid | NOT NULL FK `entitlements(id)` ON DELETE RESTRICT |
| credit_kind | text | NOT NULL DEFAULT `ai_grading` CHECK IN (`ai_grading`) — một kho chung |
| delta | integer | NOT NULL CHECK `delta <> 0 AND abs(delta) <= 100000` |
| reason | text | NOT NULL CHECK IN (`grant`,`grant_extra`,`carry_over`,`carry_expire`,`reserve`,`release`,`admin_adjust`,`expire`) (tám giá trị) |
| — | — | CHECK `(reason IN ('grant','grant_extra','carry_over','release') AND delta > 0) OR (reason IN ('reserve','expire','carry_expire') AND delta < 0) OR reason = 'admin_adjust'` |
| reservation_id | uuid | NULL FK `credit_reservations(id)`; CHECK `(reason IN ('reserve','release')) = (reservation_id IS NOT NULL)` |
| idempotency_key | text | NOT NULL UNIQUE (`order:<id>:grant`, `code:<id>:<user>:grant`, `convert:<cohort_id>:<user_id>:grant`, `res:<id>:reserve`, `res:<id>:release`, `admin:<request_key>`, `extra:<request_key>:<entitlement_id>`, `ent:<id>:expire`, `ent:<id>:carry_expire`, `carry:<from_id>:<to_id>`) |
| feature | text | NULL CHECK IN (`speaking_grading`,`writing_grading`,`short_writing_feedback`) — chỉ để hiển thị |
| resource_type, resource_id | text | NULL |
| actor_id | uuid | NULL FK `users(id)` ON DELETE SET NULL |
| note | text | NULL ≤ 500 |
| created_at | timestamptz | NOT NULL DEFAULT now() |

Index `(user_id, created_at DESC)`, `(entitlement_id)`. Trigger BEFORE UPDATE OR DELETE và BEFORE TRUNCATE (statement) → `RAISE EXCEPTION 'credit_ledger_append_only'` (FR-011). Không có cột "số dư"; số dư luôn là tổng.

**`credit_cluster_members`** (382, N-1; chỉ `fn_credit_reserve`/`fn_credit_release` ghi):

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | bigint | GENERATED ALWAYS AS IDENTITY PK |
| user_id | uuid | NOT NULL FK `users(id)` ON DELETE RESTRICT (cùng quy tắc ẩn danh FR-052) |
| session_id | uuid | NOT NULL FK `sessions(id)` ON DELETE CASCADE (xoá phiên thì xoá thành viên cụm; giữ chỗ và sổ lượt vẫn còn) |
| part | smallint | NOT NULL CHECK IN (1, 2, 3) |
| question_id | uuid | NOT NULL (không FK: câu hỏi có thể bị sửa hay xoá sau khi chấm) |
| cluster_k | integer | NOT NULL CHECK `cluster_k >= 0` |
| reservation_id | uuid | NULL FK `credit_reservations(id)` ON DELETE RESTRICT; NULL khi câu được phủ bởi giữ chỗ của câu khác và giữ chỗ đó bị hoàn |
| graded_at | timestamptz | NULL; `fn_credit_commit` đặt khi giữ chỗ của cụm được chốt |
| created_at | timestamptz | NOT NULL DEFAULT now() |

`UNIQUE (session_id, part, question_id)`; index `(session_id, part)`. RLS bật và ép, không policy client; `REVOKE ALL … FROM PUBLIC, anon, authenticated`, chỉ `service_role`. Khi giữ chỗ mở cụm bị hoàn, `fn_credit_release` xoá các dòng có `reservation_id` đó và `graded_at IS NULL` (chỗ trống được cấp lại), giữ dòng đã chấm.

Nhãn hiển thị cho học viên (tờ TaiKhoan) do API trả trong `label_vi`: `grant` + nguồn đơn → "Cộng khi mở khoá"; `grant` + nguồn mã → "Cộng kèm mã lớp"; `grant` + nguồn `class_conversion` → "Cộng khi lớp chuyển sang tính lượt"; `grant_extra` → "Cấp thêm bởi admin"; `carry_over` → "Chuyển lượt chưa dùng từ kỳ trước khi đăng ký lại" (phần trăm chuyển là 100 thì không nêu số; nhỏ hơn 100 thì thêm "(N%)" lấy từ ghi chú dòng, không ghi cứng); `carry_expire` → "Lượt chuyển hết hạn bảo lưu"; `reserve` → "Chấm bài" (với `feature='short_writing_feedback'`: "Nhận xét đoạn viết"); `release` → "Hoàn lượt khi chấm lỗi"; `admin_adjust` → "Điều chỉnh bởi admin" kèm lý do; `expire` → "Hết hạn cùng khoá". Câu chữ cuối cùng do G07 duyệt theo tờ TaiKhoan; tờ còn ghi nhãn "Chuyển 50%…" thì theo file này.

**`writing_essays` (sửa):** `ADD COLUMN review_mode text NULL CHECK (review_mode IN ('ai_instant','teacher_review'))`. NULL = luồng cũ.

**Định nghĩa "quyền còn dùng được lượt"** (dùng chung trong mọi RPC): `status='active' AND starts_at <= now() AND (expires_at IS NULL OR expires_at > now()) AND (credits_expire_at IS NULL OR credits_expire_at > now()) AND credits_closed_at IS NULL`.

**MFA bước-lên cho cấp lượt lớn (Q13, anh Andy OK 18/11).** Bốn route có dấu "MFA bước-lên" ở bảng trên vào `CONDITIONAL_STEP_UP_ROUTES` của `tests/test_staff_guard_inventory.py` (cùng mẫu với `POST /admin/access-codes/generate`): ngay sau `require_admin`, tính điều kiện chỉ từ body đã chuẩn hoá, không đọc DB (`adjust`: `abs(delta) > 50`; `entitlements`: `(credits or 0) > 50`; `grant-extra`: có `cohort_id` thì luôn bắt (số người nhận chưa biết khi chưa đọc DB), không có thì `credits > 50`; `convert-class`: `credits_per_member > 0`), đúng thì `await require_recent_mfa(...)`. Xác nhận đơn, yêu cầu bổ sung, huỷ đơn chỉ `require_admin`. Ngưỡng 50 là hằng số trong mã (`CREDIT_STEP_UP_THRESHOLD = 50`), không phải env.

**Xoá tài khoản và lưu giữ (FR-052, ACCOUNTDATA-0100).** Các khoá ngoại `ON DELETE RESTRICT` tới `users` ở trên được giữ có chủ ý: sổ lượt chỉ ghi thêm và chứng từ đơn đăng ký là bằng chứng kế toán. Vì vậy "xoá thật" của FR-052 **không** xoá dòng `users`: job xoá của ACCOUNTDATA-0100 ẩn danh dòng `users` (xoá email, tên, ảnh, số điện thoại, đăng nhập Auth; giữ `id` làm khoá kỹ thuật), xoá bài làm, ghi âm, nhận xét, ghi chú; giữ `entitlements`, `credit_ledger`, `credit_reservations`, `enrollment_orders` và sự kiện đơn trỏ về `id` đã ẩn danh, trong thời hạn lưu chứng từ ACCOUNTDATA-0100 quy định. Spec 0100 phải ghi rõ danh sách bảng xoá, bảng ẩn danh, bảng giữ.

**C2-SA-2335 (anh Andy quyết 18/11: ẩn danh, giữ chứng từ 10 năm; ghi vào `approval-decision.md` khi duyệt spec):**
- **Không ghi PII vào cột tự do của bảng chỉ ghi thêm.** `credit_ledger.note`, `note` của sự kiện đơn và `reason` của các RPC admin chỉ chứa lý do nghiệp vụ; backend từ chối (422 `note_contains_contact`) chuỗi khớp mẫu email hoặc số điện thoại Việt Nam, và giao diện admin ghi chú "không ghi email, số điện thoại, tên học viên". Lý do: dòng chỉ ghi thêm không ẩn danh được sau này.
- **Danh sách xử lý khi xoá** (đầu vào cho ACCOUNTDATA-0100): *xoá* — `learner_email_outbox` (mọi dòng của người đó, kể cả `to_email`), `credit_cluster_members`, bài làm, ghi âm, nhận xét AI, ghi chú của học viên; *ẩn danh* — `users` (giữ `id`), `learner_login_events` (bỏ IP và user agent); *giữ nguyên, trỏ `id` đã ẩn danh* — `enrollment_orders` và sự kiện đơn, `entitlements`, `credit_ledger`, `credit_reservations`.
- **Thời hạn giữ (anh Andy quyết 18/11):** đơn đăng ký, sự kiện đơn và sổ lượt — **10 năm** (cấu hình `COMMERCE_RECORD_RETENTION_YEARS`, mặc định 10); outbox đã gửi — 90 ngày rồi xoá kể cả khi không có yêu cầu xoá; bài Writing và nhận xét — 45 ngày sau khi khoá hết hạn (điểm 23, đã chốt); bản ghi âm — tối đa 60 ngày (Q10).

**Định nghĩa "số dư dùng được" của một quyền** (dùng chung trong `fn_credit_reserve`, `fn_credit_balance`, `fn_credit_admin_adjust`; viết thành một hàm nội bộ `fn_credit_usable_balance(p_entitlement_id uuid) → table(balance int, carry_left int, carry_lapsed int)`, chỉ `service_role`; `carry_lapsed` = phần lượt chuyển đã quá hạn bảo lưu mà job chưa ghi sổ, bằng 0 trong mọi ca khác — hàm của 383 dùng đúng số này để ghi dòng `carry_expire`): gọi `S` = tổng `delta` mọi dòng của quyền; `c` = `delta` của dòng `carry_over` của quyền (không có → 0); `used` = −(tổng `delta` các dòng `reserve` và `release` của quyền) (≥ 0); `carry_left = greatest(0, least(c − used, S))` — tức **lượt chuyển được tiêu trước**: mọi lượt đã dùng ở quyền này trừ vào phần lượt chuyển trước, hết phần đó mới trừ vào lượt của kỳ mới. Nếu `carry_closed_at IS NOT NULL` thì `carry_left = 0` (phần còn lại đã được ghi `carry_expire`, đã nằm trong `S`). Nếu `carry_expires_at <= now()` mà `carry_closed_at IS NULL` (đã quá hạn bảo lưu, job chưa kịp ghi sổ) thì `carry_lapsed` = giá trị `carry_left` vừa tính, `balance = S − carry_lapsed` và `carry_left` trả về 0; ngược lại `balance = S`, `carry_lapsed = 0`. Nhờ vậy số dư trả cho học viên đúng theo thời gian, trước và sau khi job chạy. Các cột `carry_*` do 381 tạo; dòng `carry_over` và `carry_expire` do hàm của 383 ghi.

**RPC (tất cả trả `jsonb`, chỉ `service_role`):**

| Hàm | Tham số | Kết quả `status` | Ghi chú |
|---|---|---|---|
| `fn_credit_reserve` | `p_user_id uuid, p_feature text, p_cost int, p_request_key text, p_resource_type text, p_resource_id text, p_ttl_seconds int, p_course_ids uuid[], p_kinds text[]` | `reserved` (+`reservation_id, entitlement_id, product_kind, balance_after`), `replay` (+`reservation_id`; **chỉ** khi giữ chỗ cũ còn `open` **và** `p_feature`, `p_resource_type`, `p_resource_id` trùng giữ chỗ cũ), `already_committed` (+`reservation_id`; giữ chỗ cũ đã `committed` dù ba trường có trùng: lần nộp đó đã được chấm và đã trừ lượt), `request_key_conflict` (ba trường lệch, hoặc giữ chỗ cũ `released`/`expired`: bên gọi phải dùng khoá mới), `not_owner` (tài nguyên không thuộc `p_user_id`, xem dưới). Ba kết quả `replay`, `already_committed`, `request_key_conflict` không ghi dòng nào. Các kết quả còn lại: `covered` (+`reservation_id` của lần trừ đang phủ cụm; không trừ thêm), `insufficient_credits` (+`balance`), `no_entitlement` | Đầu hàm: `PERFORM pg_advisory_xact_lock(hashtextextended('aver.credit:'||p_user_id::text, 0))`. **Kiểm chủ sở hữu trước mọi bước khác (N-2):** `speaking_response`/`speaking_cluster` → phần `session_id` của `p_resource_id` phải là một dòng `sessions` có `user_id = p_user_id`; `writing_essay` → `writing_essays.user_id = p_user_id`; `short_writing` → `short_writing_submissions.user_id = p_user_id` (bảng của TOPICKNOW-0097, xem 5.6); không khớp hoặc không có dòng → `not_owner`, không chia cụm, không ghi gì. Chọn quyền theo FR-016 trong các quyền còn dùng được lượt, sản phẩm có `p_feature` trong `features` (map `speaking_grading→speaking`, `writing_grading→writing`, `short_writing_feedback→writing`), lọc `course_id = ANY(p_course_ids)` và `product.kind = ANY(p_kinds)` khi mảng không NULL, **số dư dùng được** (định nghĩa trên) ≥ cost. Khi `p_resource_type='speaking_cluster'`: `p_resource_id` là `<session_id>:p<part>:q<question_id>` (câu, không phải cụm); trong cùng khoá tư vấn, hàm cấp cụm cho câu đó **nguyên tử** bằng bảng `credit_cluster_members(user_id, session_id, part, question_id, cluster_k, reservation_id)` `UNIQUE (session_id, part, question_id)` (382): câu đã có dòng → dùng lại `cluster_k` (nộp lại, thử lại); chưa có → `cluster_k` = số dòng hiện có của (`session_id`, `part`) chia nguyên `CREDIT_SPEAKING_CLUSTER_SIZE`, đếm cả câu đang chấm dở, rồi chèn dòng. Cụm `c<k>` đã có giữ chỗ `open` hoặc `committed` → trả `covered` và gắn `reservation_id` đó; chưa có → trừ như thường. Giữ chỗ mở cụm bị hoàn → xoá các dòng thành viên còn trỏ tới nó chưa được chấm xong để chỗ trong cụm được cấp lại. Test: giữ bốn bài nộp Part 1 khác câu cùng lúc → đúng hai cụm, hai lượt. Ghi reservation + dòng `reserve` (−cost). `p_ttl_seconds` 60..86400. `no_entitlement` khi không quyền nào khớp bộ lọc; `insufficient_credits` khi có quyền khớp nhưng không quyền nào đủ số dư. |
| `fn_credit_commit` | `p_reservation_id uuid` | `committed`, `already_committed`, `not_open` (+status) | Không ghi dòng ledger. |
| `fn_credit_release` | `p_reservation_id uuid, p_reason text` | `released`, `already_released`, `not_open` | Ghi dòng `release` (+cost). |
| `fn_credit_release_for_resource` / `fn_credit_commit_for_resource` | `p_resource_type text, p_resource_id text, p_reason text` | như trên, `none` khi không có giữ chỗ mở | Cho Writing nền. |
| `fn_credit_expire_reservations` | `p_limit int` | `{expired: n}` | Giữ chỗ `open` quá `expires_at` → `expired` + dòng `release` (lý do `expired`). `FOR UPDATE SKIP LOCKED`. |
| `fn_credit_balance` | `p_user_id uuid` | `{items:[{entitlement_id, course_id, product_id, product_kind, balance, usable_from, usable_until, carry_balance, carry_expires_at}], total}` | Chỉ quyền `active` chưa hết hạn và chưa đóng sổ; quyền chưa tới `starts_at` vẫn liệt kê (kèm `usable_from`) nhưng không cộng vào `total`. `balance` là số dư dùng được; `carry_balance` = `carry_left` (0 khi không có lượt chuyển hoặc đã quá hạn bảo lưu), `carry_expires_at` null khi không có lượt chuyển. |
| `fn_credit_admin_adjust` | `p_admin_id, p_entitlement_id, p_delta int, p_reason text, p_request_key text` | `adjusted`, `replay`, `would_go_negative`, `not_usable`, `not_found` | `p_reason` bắt buộc 10..500 (tờ AdminLuotVaMa). |
| `fn_enrollment_order_create` | `p_user_id, p_product_id, p_order_code, p_request_key, p_pay_hours int` | `created`, `existing_open` (+đơn), `replay` (+đơn), `product_unavailable`, `account_suspended`, `code_collision` | Sản phẩm phải `online`, `open`, `is_public`, chưa lưu trữ. `p_pay_hours` 1..720. Chèn sự kiện + outbox `order_created`. Backend sinh mã, `code_collision` thì sinh lại tối đa 3 lần. |
| `fn_enrollment_order_learner_action` | `p_user_id, p_order_code, p_action text ('report_transfer','cancel','supplement'), p_note text` | `ok` (+đơn, `late: bool`), `invalid_transition`, `not_found` | `not_found` cả khi đơn của người khác (không lộ tồn tại). `report_transfer` trên đơn `expired` không đổi trạng thái: chỉ đặt `late_transfer_reported_at` và ghi sự kiện (`late: true`). Chỉ ghi `enrollment_order_events`, **không** ghi outbox. |
| `fn_enrollment_order_admin_action` | `p_admin_id, p_order_id, p_action ('request_info','cancel'), p_reason text, p_message text, p_supplement_by timestamptz, p_received_vnd int` | `ok` (+đơn), `invalid_transition`, `not_found` | `request_info`: `p_reason` (ghi vào `info_kind`) ∈ `underpaid`, `not_found`, `other`; `p_received_vnd` bắt buộc và nhỏ hơn học phí khi `underpaid`, NULL được ở hai lý do kia; `p_message` bắt buộc 3..1000; `p_supplement_by` bắt buộc và lớn hơn `now()`; ghi sự kiện + outbox `order_needs_info` (FR-037). `cancel`: `p_message` (lý do) bắt buộc 3..500; chỉ ghi sự kiện. |
| `fn_enrollment_order_confirm` | `p_admin_id, p_order_id, p_note text, p_allow_expired bool, p_carry_window_days int, p_received_vnd int` | `confirmed` (+`entitlement_id, starts_at, expires_at, credits_expire_at, credits_granted, reopened: bool, renews_entitlement_id`), `already_confirmed` (+ cùng các trường), `invalid_transition`, `has_open_order`, `account_suspended`, `not_found` | `SELECT … FOR UPDATE` đơn, rồi khoá tư vấn theo người. Đơn `expired` chỉ đi tiếp khi `p_allow_expired`; khi đó nếu người này có đơn mở khác cùng `product_id` → `has_open_order`, không đổi gì; nếu không: đặt `reopened_at`. Tính `starts_at = greatest(now(), max(expires_at) của quyền active cùng course_id của người đó)`; `expires_at = starts_at + access_days`; `credits_expire_at = least(expires_at, starts_at + credit_valid_days)` hoặc NULL; `renews_entitlement_id` = quyền `active` (chưa thu hồi) cùng `product_id` của người đó có `expires_at` lớn nhất, **chỉ khi đơn được tạo trong cửa sổ đăng ký lại**: `order.created_at <= quyền_trước.expires_at + p_carry_window_days ngày` (backend truyền `CREDIT_CARRY_VALID_DAYS`, bắt buộc 0..3650; đơn tạo khi kỳ cũ còn hạn luôn thoả). So theo **lúc tạo đơn**, không theo lúc xác nhận: đơn tạo trong cửa sổ mà admin xác nhận sau cửa sổ vẫn được liên kết; đơn `expired` được mở lại bằng `p_allow_expired` cũng xét theo `created_at` của chính nó. Ngoài cửa sổ, quyền trước không hạn, hoặc không có quyền trước → `renews_entitlement_id` NULL (không chuyển lượt). INSERT quyền `source='enrollment_order', source_ref=order.id`; INSERT dòng `grant` key `order:<id>:grant` khi `ai_credits > 0`; nếu `users.is_active=false` và `suspended_at IS NULL` thì `UPDATE users SET is_active=true`; sự kiện + outbox `order_confirmed`. `p_received_vnd` (tuỳ chọn) lưu vào đơn; lớn hơn học phí thì `p_note` bắt buộc (chuyển thừa: xác nhận được, không tự hoàn tiền). Kiểm `suspended_at` **trước** UPDATE (mig 332 sẽ ném lỗi nếu không). Không tự ghi `carry_over` (việc của 383, 5.15). |
| `fn_enrollment_orders_expire` | `p_limit int` | `{expired: n}` | `awaiting_transfer` có `pay_by < now()` → `expired`, sự kiện `system`. **Không** ghi outbox. |
| `fn_enrollment_order_pay_reminders` | `p_hours_before int, p_min_age_hours int, p_limit int` | `{queued: n}` | Chọn đơn `awaiting_transfer` có `pay_by > now()`, `pay_by - now() <= p_hours_before`, `now() - created_at >= p_min_age_hours`; chèn outbox `order_pay_reminder` ON CONFLICT (dedupe_key) DO NOTHING; `FOR UPDATE SKIP LOCKED`. |
| `fn_entitlement_admin_grant` | `p_admin_id, p_user_id, p_product_id, p_days int NULL, p_credits int NULL, p_review_mode text NULL, p_reason text, p_request_key uuid` | `granted`, `replay`, `product_invalid` | `source='admin_grant', source_ref=p_request_key`; `p_days` NULL → `product.access_days`; `p_credits` NULL → `product.ai_credits`. Dùng cho "Cấp quyền luyện lại". |
| `fn_entitlement_admin_revoke` | `p_admin_id, p_entitlement_id, p_reason` | `revoked`, `already_revoked`, `not_found` | Số dư còn lại không dùng được nữa; không ghi dòng âm ở đây (job đóng sổ ghi dòng `expire` sau); lượt của quyền bị thu hồi không được chuyển sang kỳ sau (5.15). |
| `fn_entitlement_admin_extend` | `p_admin_id, p_entitlement_id, p_days int 1..3650, p_reason` | `extended`, `revoked`, `not_found`, `no_expiry`, `credits_closed` | `expires_at = greatest(expires_at, now()) + days`; `credits_expire_at` (nếu có) tăng cùng số ngày; `carry_expires_at` **không** đổi (gia hạn khoá không kéo dài thời gian bảo lưu lượt chuyển). Quyền đã đóng sổ lượt → `credits_closed` (gia hạn không làm sống lại lượt đã ghi hết hạn; admin dùng cấp quyền mới). |
| `fn_course_product_archive` | `p_admin_id, p_product_id` | `archived`, `already_archived`, `has_active_learners` (+n), `has_open_orders` (+n), `not_found` | Đặt `archived_at`, `status='closed'`, `is_public=false`. |
| `fn_deliver_writing_essay_instant` | `p_essay_id uuid` | `delivered`, `not_instant`, `not_graded` | `UPDATE writing_essays SET status='delivered', delivered_at=now(), delivery_method='web_view' WHERE id=… AND status='graded' AND review_mode='ai_instant'`. |

### 5.4 Quy tắc truy cập và đo lượt (service Python)

File mới `backend/services/entitlements.py`:
- `list_access(user_id) -> list[AccessItem]`: hợp (a) `entitlements` của người đó; (b) **suy ra** từ `student_cohort_memberships` đang active của `students.user_id = user_id` có `cohorts.course_id` và `cohorts.archived_at IS NULL` → `source='class_membership'`, không hạn; (c) **suy ra** từ mã sống không có `product_id` (`_active_code_rows`) → một dòng `source='legacy_access_code'`, không gắn khoá, `features` từ quyền (`writing`, Speaking). `AccessItem`: `course_id | None, product_id | None, kind ('online'|'class'|'repractice'|None), source, starts_at, expires_at | None, status ('active'|'expired'|'revoked'), review_mode, features, credits_usable_until | None`.
- `has_course_access(user_id, course_id) -> bool` — đúng khi có bất kỳ `AccessItem` còn hiệu lực cho khoá đó (kể cả suy ra từ thành viên lớp). Dùng để mở nội dung.
- `has_course_entitlement(user_id, course_id, kinds=None) -> bool` — chỉ xét **dòng `entitlements`** `active` chưa hết hạn (không tính quyền suy ra). Dùng cho `already_has_course` khi kích hoạt mã (FR-009) và cho lệnh chuyển lớp (5.18).
- `has_ever_had_online_course(user_id) -> bool` (FR-042): tồn tại dòng `entitlements` của người đó nối `course_products.kind='online'`, bất kể `status` và hạn. Lỗi đọc → ném lỗi (bên gọi tự quyết fail-closed).
- `resolve_review_mode(user_id, *, context) -> 'ai_instant' | 'teacher_review' | 'legacy'` — **chỉ gọi cho Writing**: `context` có `writing_assignment_id` hoặc `class_assignment_item_id` → `legacy` (luồng duyệt hiện có); nếu không → `review_mode` của quyền dùng để trừ lượt (ghi đè trên quyền, rồi sản phẩm). Không hàm nào chọn luồng cho Speaking.

File mới `backend/services/credits.py`:
- `charge_plan(user_id, feature, *, session=None, assignment=None, trial=False, new_feature=False) -> ChargePlan(metered: bool, reason: str, course_ids: list | None, kinds: list | None)` — theo đúng thứ tự:
  1. cờ `credit_metering` tắt → `metered=False, reason='flag_off'`. Đọc cờ **lỗi** thì không coi là tắt: `charge_plan` ném `CreditUnavailable` (503), không chấm (fail-closed). Vì vậy cờ này đọc bằng `is_enabled(..., on_error=<ném lỗi>)`, không dùng `on_error=False` như cờ hiển thị. "Tắt" chỉ còn nghĩa là công tắc dừng khẩn do anh Andy bật/tắt có chủ ý: mỗi lần `charge_plan` trả `flag_off` sau khi cờ đã từng bật ghi log `[credits] flag_off user=<id> feature=<f>` (không email) để thấy ngay lượt chấm không trừ.
  2. `trial=True` (đường chấm thử của 0047/GOI-11 truyền vào) → `metered=False, reason='trial'`.
  3. `session.sitting_id` không NULL (thi thử/kỳ thi của admin) → `metered=False, reason='mock'`.
  4. Bài của lớp (`session.class_assignment_item_id`, hoặc `assignment` có `cohort_id`): lấy `course_id` của lớp (`class_assignment_items → class_assignments.cohort_id → cohorts.course_id`, hoặc `assignment.cohort_id → cohorts.course_id`). Người nộp **từng có** quyền `kind IN ('class','repractice')` cho `course_id` đó (bất kỳ trạng thái, kể cả đã hết hạn), hoặc lớp đã có lần chuyển sang đo lượt (5.18) → `metered=True, reason='class'`, `course_ids=[course_id]`, `kinds=['class','repractice']`; khi đó không còn quyền nào dùng được thì `reserve` trả `no_entitlement`/`insufficient_credits` như thường, **không** rơi về miễn phí. Chỉ khi lớp chưa từng chuyển và người nộp chưa từng có quyền đo lượt cho khoá đó (lớp chạy mã cũ, lớp không gắn khoá) → `metered=False, reason='legacy_class'`. Test: học viên lớp có quyền `class` trước và sau khi quyền hết hạn (sau hạn → 403/402, không chấm miễn phí); giữ test lớp mã cũ chưa chuyển. Sau khi admin chuyển lớp (5.18), thành viên có quyền `class` nên tự rơi vào nhánh đo, không cần cờ riêng theo lớp; lớp chuyển dở (người vào lớp sau) thì từng người được xét riêng.
  5. Người có quyền mã cũ cho kỹ năng (`has_speaking_permission` / `has_writing_permission` trên `get_user_access_code_permissions`) → `metered=False, reason='legacy_code'` (hạn mức `session_limit` cũ vẫn áp ở `POST /sessions`).
  6. Còn lại → `metered=True, reason='entitlement'`, không lọc khoá.
  Mọi lỗi đọc ở bước 4–5 khi cờ bật → ném `CreditUnavailable` (503), không coi là "không đo".
  **Tính năng mới không bao giờ miễn phí (C1 e).** Các lý do `flag_off`, `legacy_class`, `legacy_code` chỉ giữ hành vi cũ cho đường chấm đã có trước gói (Speaking luyện tập, Writing bài lớp và mã cũ). Với `feature='short_writing_feedback'` và với mọi route Tự luyện Writing của G08 (`charge_plan(..., new_feature=True)`; route G08 bắt buộc truyền), ba lý do đó **không** cho chấm miễn phí: `flag_off` → `CreditUnavailable` (503 `credits_unavailable`, không gọi AI); `legacy_class`/`legacy_code` → bỏ qua và đi tiếp bước 6 (trừ lượt theo quyền khoá; không có quyền → 403 `no_entitlement`). `trial`, `mock` giữ nguyên.
  `feature` ∈ `speaking_grading`, `writing_grading`, `short_writing_feedback`. `charge_plan` là hàm đồng bộ (có đọc DB); route async gọi bản bọc `async acharge_plan(...)` = `asyncio.to_thread(charge_plan, ...)` cùng tham số (5.6 dùng tên này).
- `async reserve(user_id, feature, *, request_key, resource_type, resource_id, ttl_seconds, course_ids=None, kinds=None) -> CreditHold`; ném `CreditRefused(code, credit_source)` với `insufficient_credits` (402) hoặc `no_entitlement` (403); RPC lỗi/timeout 2 s/hình dạng lạ → `CreditUnavailable` (503). Gọi RPC bằng `asyncio.to_thread(lambda: supabase_admin.rpc(...).execute())`, chấp nhận `data` là dict hoặc list một phần tử (như `routers/admin_writing.py::_deliver_essay`, dòng 142). `credit_source` = `class` khi `plan.reason='class'`, ngược lại `online`. **Cách bản bọc xử lý kết quả không phải `reserved` (C1 b)** — mọi trường hợp dưới đây **không gọi AI, không ghi sổ, không chốt hay hoàn**: `replay` → `CreditReplay` (409 `grading_in_progress`; một yêu cầu khác cùng khoá đang chấm); `already_committed` → `CreditReplay` (409 `already_graded`; route Speaking/Writing trả biên nhận đã lưu nếu nhánh `check_submission` có, nếu không thì trả 409); `request_key_conflict` → `CreditRefused('request_key_conflict')` (409); `not_owner` → `CreditRefused('not_owner')` (404, không lộ tài nguyên của người khác); `covered` → `CreditHold(covered=True)` (đi tiếp chấm, `commit`/`release` là no-op). Số lượt trừ (`p_cost`) do `reserve` tự lấy theo `feature`: `CREDIT_COST_SPEAKING_UNIT`, `CREDIT_COST_WRITING_ESSAY`, `CREDIT_COST_SHORT_WRITING` (5.10); bên gọi không truyền.
- RPC trả `covered` (cụm Speaking đã có lần trừ) → `reserve` trả `CreditHold(covered=True)`: `commit()` và `release()` của nó là no-op.
- `CreditHold.commit()`, `CreditHold.release(reason)` idempotent; `release_if_open(hold, reason)` không bao giờ ném (log `[credits] decision=release_failed`).

Sửa `routers/sessions.py::require_speaking_entitlement` / `_require_permission`: khi quyền mã cũ không đủ, chấp nhận nếu `credits.charge_plan(...).metered` và có quyền còn hiệu lực có `speaking`. Khi cờ `credit_metering` tắt, nhánh mới không chạy (hành vi cũ). `POST /sessions` (`create_session`, dòng 560) cũng phải qua cùng kiểm này; không đụng `get_user_session_quota` cho người không có mã.

### 5.5 Trạng thái và chuyển trạng thái

**Đơn đăng ký**

| Từ | Hành động | Ai | Sang | Ghi chú | Outbox |
|---|---|---|---|---|---|
| (mới) | create | học viên | `awaiting_transfer` | `pay_by = now() + hạn giữ đơn` | `order_created` |
| `awaiting_transfer` | pay_reminder | hệ thống | (không đổi) | một lần, trước `pay_by` | `order_pay_reminder` |
| `awaiting_transfer` | report_transfer | học viên | `transfer_reported` | `transfer_reported_at` | — |
| `awaiting_transfer` | expire | hệ thống | `expired` | chỉ khi `pay_by < now()` | — |
| `expired` | report_transfer | học viên | (không đổi) | đặt `late_transfer_reported_at` để admin đối chiếu sớm (tờ ThanhToan màn 5) | — |
| `awaiting_transfer`, `transfer_reported`, `needs_info` | cancel | học viên | `cancelled` | | — |
| `awaiting_transfer`, `transfer_reported`, `needs_info` | cancel | admin | `cancelled` | bắt buộc lý do | — |
| `awaiting_transfer`, `transfer_reported`, `needs_info` | request_info | admin | `needs_info` | lý do `underpaid`, `not_found` hoặc `other`, lời nhắn và hạn bổ sung bắt buộc; đánh dấu lại khi đang `needs_info` được phép (mỗi lần một thư) | `order_needs_info` |
| `needs_info` | supplement | học viên | `transfer_reported` | bước "Tôi đã bổ sung" kèm ghi chú 3..1000; có trong hợp đồng, G05 quyết có hiện nút hay không (G05 mục 10 câu 14) | — |
| `awaiting_transfer`, `transfer_reported`, `needs_info` | confirm | admin | `confirmed` | cấp quyền + lượt + kích hoạt tài khoản | `order_confirmed` |
| `expired` | confirm với `p_allow_expired=true` ("Ghi nhận khoản chuyển") | admin | `confirmed` | đơn tự mở lại (`reopened_at`); từ chối `has_open_order` nếu có đơn mở khác cùng sản phẩm | `order_confirmed` |
| `confirmed` | mọi hành động | — | — | 409 `invalid_transition`; confirm lặp → `already_confirmed` (200) | — |
| `cancelled` | mọi hành động | — | — | 409 `invalid_transition`; không bao giờ mở lại, kể cả khi tiền về sau | — |

Sản phẩm đang `closed` (tạm dừng) vẫn xác nhận được đơn đã có: đơn dùng số đã chụp. "Đủ học phí lúc tạo đơn" là việc admin đối chiếu ở trình duyệt (tờ AdminDonDangKy); máy chủ chỉ lưu `received_vnd` admin gửi kèm để trang đơn hiện ba con số (học phí · đã nhận · còn thiếu hoặc thừa), không tự chuyển trạng thái theo số đó.

Nhãn giao diện — học viên (G05): `awaiting_transfer` "Chờ chuyển khoản", `transfer_reported` "Chờ xác nhận", `needs_info` "Cần bổ sung", `confirmed` "Đã mở khoá", `expired` "Hết hạn", `cancelled` "Đã huỷ". Admin (G09, phân xử 13): "Chờ chuyển khoản", "Đã báo chuyển", "Cần bổ sung" (lý do `underpaid` hiện "Cần bổ sung · sai lệch"), "Đã xác nhận", "Hết hạn", "Đã huỷ". Nhãn hành động khi khoá hết hạn hoặc sắp hết hạn: **"Đăng ký lại"** (module nhãn của G11-T29).

**Giữ chỗ lượt:** `open → committed` (chấm xong) · `open → released` (lỗi) · `open → expired` (job). Không chuyển nào khác.

**Quyền:** `active → revoked` (admin, mã bị thu hồi). "Hết hạn" là trạng thái suy ra (`expires_at <= now()`). Gia hạn chỉ tăng `expires_at`.

**Sổ lượt của một quyền:** mở (lúc cấp) → đóng (`credits_closed_at`, sau hạn dùng lượt, do job 5.15). Đã đóng thì không dòng nào được ghi thêm ngoài `release` của giữ chỗ còn treo.

**Phần lượt chuyển của một quyền:** chưa có → đã chuyển (`carry_settled_at`, có `carry_expires_at` khi số chuyển > 0) → đã đóng (`carry_closed_at`, sau hạn bảo lưu hoặc khi cả quyền đóng sổ). Mỗi bước đi đúng một lần, do job 5.15.

### 5.6 Điểm móc trong luồng chấm (chỉ rõ hàm)

**Speaking — `routers/grading.py::grade_response_endpoint`:**
1. Sau `require_speaking_entitlement(user_id, session)` (dòng 519): `plan = await credits.acharge_plan(user_id, "speaking_grading", session=session)`.
2. Đặt giữ chỗ **sau** nhánh replay (`check_submission`, dòng 585 — replay không bao giờ trừ lượt và không bao giờ chạy chấm lại; `fn_credit_reserve` trả `request_key_conflict` khi một `submission_id` cũ được dùng cho câu khác, backend trả 409, không chấm) và sau bước `rate_limit` (dòng 600), **trước** `step = "whisper"` (dòng 609). `step = "credit_reserve"`. `request_key = submission_id`, `ttl = CREDIT_HOLD_TTL_SPEAKING_SECONDS`, `course_ids=plan.course_ids`, `kinds=plan.kinds`, `cost = CREDIT_COST_SPEAKING_UNIT`. Đơn vị trừ theo Part của câu hỏi (FR-044):
   - **Part 2:** mỗi bài một lượt — `resource_type='speaking_response'`, `resource_id = f"{session_id}:{question_id}"`.
   - **Part thuộc `CREDIT_SPEAKING_CLUSTER_PARTS` (mặc định 1 và 3):** `resource_type='speaking_cluster'`, `resource_id = f"{session_id}:p{part}:q{question_id}"`; cụm do `fn_credit_reserve` cấp nguyên tử (xem bảng RPC), backend không tự đếm câu đã chấm. Câu thứ 1–3 của phiên (theo thứ tự được cấp) rơi vào cụm `c0`, câu thứ 4–6 vào `c1`. RPC trả `covered` → câu này không trừ lượt: không có gì để chốt hay hoàn, đi tiếp như phiên không đo. Lỗi đọc `n` → 503 `credits_unavailable` (không đoán cụm).
   - Nộp lại một câu đã chấm trong cụm đang được phủ (N-3 của SA-2335-R2; **anh Andy quyết 18/11:** chấm thêm miễn phí tối đa 1 lần mỗi câu; ghi vào `approval-decision.md` khi duyệt spec): mỗi câu được chấm lại miễn phí tối đa `CREDIT_CLUSTER_FREE_REGRADES` lần (mặc định **1**, tức 2 lần chấm một câu). `credit_cluster_members` thêm cột `regrade_count smallint NOT NULL DEFAULT 0`, `fn_credit_reserve` tăng nó trong cùng khoá tư vấn khi trả `covered` cho một câu đã có dòng. Vượt mức thì câu đó trừ 1 lượt như một bài nộp riêng (`resource_type='speaking_response'`, `resource_id = f"{session_id}:{question_id}:r{regrade_count}"`), không chặn học viên. Kèm theo: khi cờ `credit_metering` bật, trần `MAX_GRADINGS_PER_USER_PER_DAY` phải đóng an toàn (đọc lỗi → 503) và áp cả cho yêu cầu không có `submission_id`. Hôm nay trần này fail-open và chỉ chạy trong `if retry_safe:` (`grading.py` 596–603); lỗi có từ trước gói này, đề nghị Leader mở việc FU riêng. Test: câu thứ nhất của cụm nộp 3 lần → lần 1 trừ hoặc được phủ theo cụm, lần 2 `covered` miễn phí, lần 3 trừ 1 lượt.
3. Chốt khi `grading` có giá trị và đã qua `db_save` — đặt `await hold.commit()` ngay trước `return _build_response_payload(...)` (dòng 1284). Nhánh trả `sealed` (1277–1282) chỉ xảy ra với phiên có `sitting_id`, tức `plan.metered=False`: không có giữ chỗ để chốt.
4. Hoàn: nhánh `if not grading:` (stub `_ai_unavailable`) → `release('grader_failed')`; Whisper lỗi (502) → `stt_failed`; mọi `HTTPException`/`Exception` khác sau khi giữ chỗ → `request_failed`. Cài bằng một `finally:` bọc khối `try` hiện có: `await credits.release_if_open(hold, reason)`. Kiểm độ dài 422 ở `duration_check` cũng hoàn (bài không được chấm).
5. Bài của lớp hết lượt: 402 `insufficient_credits` với `credit_source='class'`; frontend hiện "Liên hệ giáo viên để được cấp thêm", giữ bản ghi nháp, không trừ lượt (tờ GiaHanThemLuot). Khoá online hết lượt: `credit_source='online'`, lối ra "Đăng ký lại".
6. Câu mở cụm bị hoàn lượt (chấm lỗi) thì cụm trở lại chưa được phủ: câu kế tiếp của cụm sẽ trừ lượt. Câu đi sau được `covered` trong lúc câu mở cụm còn đang chấm mà rồi câu mở cụm lỗi → câu đi sau đã được chấm không mất lượt; chấp nhận (hiếm, chỉ lệch có lợi cho người học), ghi trong spec.
6b. Azure phát âm không làm thay đổi việc trừ lượt: đơn vị trừ như trên dù câu đó có được lấy mẫu phát âm hay không (5.16).
7. Khi 0033 T004 được gắn lại: thứ tự là giữ chỗ lượt → giữ chỗ ngân sách; ngân sách từ chối → hoàn lượt `budget_refused` (ghi vào plan.md, không làm trong gói này).

**Writing — `services/essay_service.py` và `routers/writing_student.py`:**
- Bài của lớp (`submit_my_assignment`, dòng 1790): sau các kiểm quyền hiện có và sau khi `create_essay_with_job` trả `essay_id`, nếu `credits.charge_plan(user_id, "writing_grading", assignment=assignment).metered` thì gọi `essay_service.reserve_writing_credit(...)` **trước** khi lên lịch chấm; `CreditRefused` → trả 402/403 và **không** để lại bài đang chờ chấm (xem vướng mắc G04-T08 về thứ tự tạo bài/giữ chỗ). Bài của lớp không đổi luồng duyệt: `review_mode` để NULL.
- Tự luyện (route của G08): G08 gọi `acharge_plan(..., new_feature=True)` (5.4, không rơi về miễn phí khi cờ tắt hay có mã cũ) rồi `reserve_writing_credit` sau khi tạo `writing_essays` (có `review_mode` từ `resolve_review_mode`) và trước `schedule_grading_job`. Gói này cung cấp hàm và test, **không** thêm route tự luyện.
- `_bg_grade_essay`: ngay sau `essay_update = {"status": "graded", ...}` được ghi (dòng 1154) gọi `credits.commit_for_resource('writing_essay', essay_id)` rồi, nếu `essay.review_mode == 'ai_instant'`, gọi RPC `fn_deliver_writing_essay_instant` và `writing_assignment_status_sync.mark_assignment_delivered` (dòng 55). Không có giữ chỗ → no-op.
- `_mark_failed` (1249) khi trạng thái cuối là `failed` (không phải nhánh `_RESTORABLE_STATUSES`) và `reap_stuck_grading_jobs` (1308) khi đánh hỏng hẳn → `release_for_resource(..., 'grader_failed')`. `_schedule_requeue` **không** hoàn (còn chạy lại).
- Full test Writing (đề tự chọn, G08): hai bài (Task 1, Task 2) là hai dòng `writing_essays`, mỗi bài một lần `reserve_writing_credit` → **2 lượt** (đã xác nhận 18/11 chiều). Không có đơn vị "cả đề"; còn 1 lượt thì bài thứ hai nhận 402 — G08 phải kiểm `GET /api/me/courses` (`credits.total >= 2`) trước khi cho vào full test Writing.
- Writing của thi thử và mock test được giao (`writing_essays.sitting_id` không NULL): `charge_plan` trả `metered=False, reason='mock'`, không gọi `reserve_writing_credit`. Mock test được giao **không trừ lượt** cả Writing lẫn Speaking (mặc định tạm 18/11, chờ anh Andy xác nhận); tờ MockTestDuocGiao, ThiThu ghi khác thì gói thắng.

**Đoạn viết ngắn ở Kiến thức nền (FR-051) — điểm móc cho gói khác:** trang Kiến thức nền mở công khai (thuộc Thư viện); nộp đoạn viết cho AI nhận xét cần đăng nhập và tốn 1 lượt. Trang và route nộp thuộc GOI-13 phần C (G13-C05, C07, C08; spec TOPICKNOW-0097) (sửa 18/11 theo GOI-13); route đó gọi `plan = await credits.acharge_plan(user_id, "short_writing_feedback")` rồi `credits.reserve(user_id, "short_writing_feedback", request_key=f"short_writing:{sub_id}", resource_type='short_writing', resource_id=sub_id, ttl_seconds=CREDIT_HOLD_TTL_SPEAKING_SECONDS)` với `cost = CREDIT_COST_SHORT_WRITING`. **`sub_id` do máy chủ sinh (C1 c):** route chèn trước một dòng `short_writing_submissions` (`id uuid DEFAULT gen_random_uuid()`, `user_id` từ JWT, bảng của TOPICKNOW-0097) rồi mới gọi `reserve`; id hay khoá do client gửi lên chỉ dùng để chống bấm hai lần (`client_nonce` UNIQUE theo `user_id`, trùng thì trả lần nộp cũ), không bao giờ làm `request_key`. Chốt khi có nhận xét, hoàn khi AI lỗi; mọi lời gọi AI ghi qua `services/ai_usage_logger.py`. Sản phẩm phải có `writing` trong `features`. Gói này chỉ thêm giá trị vào CHECK (382), map trong `fn_credit_reserve`, nhãn hiển thị và một test RPC; không dựng route.

Không đặt trừ lượt trong `grading_orchestrator.py`, `ai_router.py`, `claude_grader.py`, `gemini_writing_grader.py`: các tầng này chạy theo lần gọi provider, có retry/fallback, và còn được dùng cho chấm lại của admin.

### 5.7 Luồng trả kết quả

| Nguồn quyền dùng cho lần chấm | Speaking | Writing | Đo lượt |
|---|---|---|---|
| Bài giao của lớp — người nộp có quyền `class`/`repractice` (mã mới) | AI chấm, trả ngay | như hôm nay: AI chấm, giáo viên duyệt rồi giao (tier theo `_assignment_grading_tier`) | có, vào lượt lớp |
| Bài giao của lớp — lớp chạy mã cũ **đã được chuyển** sang đo lượt (5.18) | AI chấm, trả ngay | như hôm nay | có, vào lượt cấp lúc chuyển |
| Bài giao của lớp — lớp chạy mã cũ **chưa chuyển** | AI chấm, trả ngay | như hôm nay | không (không chặn ai) |
| Thi thử/kỳ thi của admin (`sitting_id`) | giáo viên chấm từ bản ghi (G08/G09); không thuộc gói này | như hôm nay | không (cả Writing — 5.6; mặc định tạm 18/11, chờ anh Andy xác nhận) |
| Quyền từ mã cũ, tự luyện | AI chấm, trả ngay | như hôm nay | không |
| Quyền `online` (đơn) | AI chấm, trả ngay | `ai_instant` → tự giao; admin đổi `review_mode` của sản phẩm sang `teacher_review` thì chỉ Writing đi duyệt | có |
| Quyền `repractice` do admin cấp ("Cấp quyền luyện lại") | AI chấm, trả ngay | theo `review_mode` chọn lúc cấp (hộp có dòng "Luồng chấm Writing (Speaking luôn AI trả ngay)") | có |

Không có cờ hay hàng chờ nào làm Speaking luyện tập chờ giáo viên (FR-034). Đổi `review_mode` chỉ áp cho bài Writing nộp sau khi lưu.

### 5.8 Ranh giới với chấm thử miễn phí (0047, GOI-11 phần B) và trần ngân sách (0033)

- Bốn tầng, mỗi tầng một việc: (1) **0033** là trần **USD theo provider cho cả nền tảng**; (2) **`credit_ledger`** là **lượt của từng người có khoá hoặc mã lớp**; (3) **`trial_usage`** (0047) cùng các trần của GOI-11 là hạn mức chấm thử của người chưa có khoá; (4) `MAX_GRADINGS_PER_USER_PER_DAY` là trần chống lạm dụng theo ngày, giữ nguyên.
- **Không gộp** chấm thử vào sổ lượt (GOI-11 mục 5.2.6). Các trần đã chốt — mỗi người mỗi ngày 1 Writing Task 1 + 1 Task 2 + 2 Speaking Part 2; tổng mỗi người 10 Writing (5 + 5) và 10 Speaking Part 2 tính theo email và IP; toàn web 5 USD chi phí chấm mỗi ngày; người từng có khoá online không được chấm thử — **do GOI-11 phần B hiện thực**, không nằm trong bảng hay RPC nào của gói này. `entitlements.source` không có giá trị `trial`.
- Hai điểm móc gói này cấp cho GOI-11/0047:
  1. `entitlements.has_ever_had_online_course(user_id)` — đường chấm thử gọi để loại người từng có khoá online, kể cả đã hết hạn (trả lời câu 8 của GOI-11). Trước khi G04-T03 merge, GOI-11 dùng điều kiện "chưa từng kích hoạt" của 0047; xác nhận đơn bật `users.is_active` nên hai điều kiện khớp nhau với người đăng ký online.
  2. `credits.charge_plan(..., trial=True)` — nếu đường chấm thử đi qua chung hàm chấm với học viên, nó truyền `trial=True` để không bao giờ gọi RPC lượt.
- Chiều ngược lại: `charge_plan` và mọi RPC lượt không đọc `trial_usage`, `free_trial_caps` (giữ 0047 FR-002, GOI-11 FR-11-029).

### 5.9 API

Quy ước: JSON, thời gian ISO 8601 UTC có `Z`; tiền là số nguyên VND; lỗi theo khuôn hiện có `{"detail": {"error_code": "...", "message": "<tiếng Việt, xưng bạn>"}}`; không trả mã nội bộ thô cho học viên ngoài `error_code`. Router mới: `routers/courses_public.py` (prefix `/api/courses`), `routers/enrollment.py` (prefix `/api/enrollment-orders`), `routers/me_access.py` (`/api/me`, `/api/account`), `routers/admin_commerce.py` (prefix `/admin`; gồm cả ba route `/admin/credits/convert-class*` của T15). `GET /api/account/login-events` (T16) nằm trong `routers/me_access.py`. `main.py`: ba router học viên include **với** `_ACTIVE_LEARNER`, và các route đánh dấu "có" dưới đây được thêm vào `ACTIVATION_EXEMPT_ROUTES` kèm lý do (người đăng ký chưa được kích hoạt trước khi admin xác nhận).

| Method · Path | Auth | Miễn cổng kích hoạt | Request | Response 200/201 | Lỗi |
|---|---|---|---|---|---|
| GET `/api/courses` | không bắt buộc (có token thì thêm trạng thái theo người) | có | — | `{"items":[{"slug","title","short_title","summary","status","tuition_vnd","access_days","ai_credits","credit_valid_days","credits_expire_note","credit_carry_percent","credit_carry_valid_days","level_from","level_to","lesson_count","author":{"name","bio_line","photo_url"} hoặc null,"features":[...],"expected_open_on","viewer":{"state","days_left","can_renew","open_order_code"}}]}`; `status` ∈ `open`, `coming_soon`, `closed`; `viewer.state` ∈ `guest`, `can_enroll`, `open_order`, `enrolled`, `expired` | 503 `catalog_unavailable` |
| GET `/api/courses/{slug}` | như trên | có | — | một item như trên + `"course_code"`, `"faq":[{"q","a"}]` hoặc null, `"chapters"` hoặc null (xem dưới bảng) | 404 `course_not_found` (cả sản phẩm không công khai, đã lưu trữ) |
| POST `/api/enrollment-orders` | bắt buộc (phiên Google hoặc mã 6 số) | có | `{"product_slug":str,"request_key":str 8..80}` | 201 `{"order": Order}` (`existing_open`/`replay` → 200 cùng hình) | 401; 403 `account_suspended`, `sign_in_again` (xem dưới bảng); 404 `course_not_found`; 409 `course_not_open`, `already_enrolled` (đang có quyền còn hạn nhiều hơn `ENROLL_RENEW_WINDOW_DAYS`); 503 `orders_paused` (cờ `enrollment_orders` tắt, hoặc thiếu cấu hình nhận tiền/hạn giữ đơn), `orders_unavailable` |
| GET `/api/enrollment-orders/me` | bắt buộc | có | `?limit=20&cursor=` | `{"items":[Order],"next_cursor"}` | 401 |
| GET `/api/enrollment-orders/{order_code}` | bắt buộc, chủ đơn | có | — | `{"order": Order}` | 404 `order_not_found` |
| POST `/api/enrollment-orders/{order_code}/report-transfer` | chủ đơn | có | `{"note":str≤1000 hoặc null}` | `{"order": Order, "late": bool}` (đơn `expired`: `late=true`, trạng thái không đổi) | 404; 409 `invalid_transition` |
| POST `/api/enrollment-orders/{order_code}/supplement` | chủ đơn | có | `{"note":str 3..1000}` | `{"order": Order}` | 404; 409; 422 |
| POST `/api/enrollment-orders/{order_code}/cancel` | chủ đơn | có | `{}` | như trên | 404; 409 |
| GET `/api/me/courses` | bắt buộc | có | — | `{"items":[{"course_code","product_slug","title","short_title","kind","source","state","starts_at","expires_at","days_left","review_mode","can_renew","renew_order_code","credits":{"balance","usable_from","usable_until","carry_balance","carry_expires_at"}}],"credits":{"total":int,"by_kind":{"online":int,"class":int}},"content_visible_until":ISO hoặc null,"content_days_after_expiry":int hoặc null}`; `kind` ∈ `online`, `class`, `repractice`, null; `source` ∈ `enrollment_order`, `access_code`, `admin_grant`, `class_conversion`, `class_membership`, `legacy_access_code`; `state` ∈ `active`, `expired`, `revoked`; `carry_balance` = số lượt chuyển còn dùng được (0 khi không có), `carry_expires_at` = hạn bảo lưu (null khi không có); `content_visible_until`, `content_days_after_expiry`: xem dưới bảng | 401; 503 `access_unavailable` |
| GET `/api/me/credits` | bắt buộc | có | `?limit=20&cursor=` | `{"balance":int,"items":[{"at","delta","reason","balance_after","course_code","feature","label_vi","note"}],"next_cursor"}`; `reason` ∈ `grant`, `grant_extra`, `carry_over`, `carry_expire`, `reserve`, `release`, `admin_adjust`, `expire`; `balance` là số dư dùng được (đã loại lượt chuyển quá hạn bảo lưu dù job chưa ghi sổ) | 401 |
| GET `/api/account/session/status` | bắt buộc | có | — | `{"enabled":bool,"state","other_session":{"device_label","since","approx_location"} hoặc null,"timed_activity":{"title","device_label","minutes_left"} hoặc null}`; `state` ∈ `current`, `other_device`, `other_device_timed`; `approx_location` luôn null ở gói này (không thu địa chỉ mạng) | 401; 503 `session_status_unavailable` |
| POST `/api/account/session/claim` | bắt buộc | có | `{}` | `{"enabled":bool,"state":"current","revoked":int}` | 401; 409 `timed_activity_in_progress` (+`timed_activity`); 503 `session_claim_unavailable` |
| POST `/api/account/sessions/revoke-all` | bắt buộc | có | `{}` | `{"revoked":int,"deferred_timed":{"title","device_label","minutes_left"} hoặc null,"at"}` | 401; 503 |
| GET `/api/account/login-events` | bắt buộc, chỉ phiên đang dùng | có | `?limit=3` (1..10) | `{"enabled":bool,"items":[{"at","device_kind","device_label","method","outcome","is_current","approx_location"}]}`; `device_kind` ∈ `desktop`, `phone`, `tablet`, `unknown`; `method` ∈ `google`, `email_code`, `unknown`; `outcome` ∈ `signed_in`, `pending`, `claimed`, `claim_refused_timed`, `displaced`, `signed_out_all`; `approx_location` luôn null; cờ `single_session_learners` tắt → `{"enabled":false,"items":[]}` (5.13b) | 401; 409 `session_not_current`; 503 `login_events_unavailable` |
| GET `/admin/course-products` · POST · PATCH `/admin/course-products/{id}` | admin | (staff) | các cột 5.2 trừ id/thời gian/lưu trữ | `{"product":{...,"open_orders":int,"active_learners":int}}` / `{"items":[...]}` | 403; 409 `slug_taken`; 422 vi phạm CHECK (thông điệp tiếng Việt, không tên cột) |
| POST `/admin/course-products/{id}/archive` | admin | — | `{"confirm_title":str}` | `{"product":{...}}` | 409 `has_active_learners`, `has_open_orders`; 422 `title_mismatch` |
| GET `/admin/enrollment-orders` | admin | — | `?status=&q=<order_code hoặc email>&late=1&limit&cursor` | `{"items":[Order + {"user":{"id","email","display_name"}}],"next_cursor"}` | 403 |
| GET `/admin/enrollment-orders/counts` | admin | — | — | `{"awaiting_transfer":int,"transfer_reported":int,"needs_info":int,"confirmed":int,"expired":int,"cancelled":int,"expired_late_reported":int}` | 403 |
| GET `/admin/enrollment-orders/{id}` | admin | — | — | Order + `events[]` + `"other_open_order_code"` | 404 |
| POST `/admin/enrollment-orders/{id}/confirm` | admin | — | `{"note":str hoặc null,"allow_expired":bool=false,"received_vnd":int hoặc null}` | `{"status":"confirmed" hoặc "already_confirmed","order":Order,"entitlement":{...},"credits_granted":int,"reopened":bool}` | 404; 409 `invalid_transition`, `has_open_order`, `account_suspended`; 503 |
| POST `/admin/enrollment-orders/{id}/request-info` | admin | — | `{"info_kind":"underpaid" hoặc "not_found" hoặc "other","received_vnd":int hoặc null,"message":str 3..1000,"supplement_by":ISO hoặc null}` (null → `now() + ENROLL_SUPPLEMENT_HOURS`) | `{"order":Order}` | 404; 409; 422 |
| POST `/admin/enrollment-orders/{id}/cancel` | admin | — | `{"message":str 3..500,"confirm_order_code":str}` | `{"order":Order}` | 404; 409; 422 `order_code_mismatch` |
| GET `/admin/users/{user_id}/access` | admin | — | — | như `/api/me/courses` + `entitlement_id`, `events[]` | 404 |
| GET `/admin/users/{user_id}/credits` | admin | — | `?limit&cursor` | như `/api/me/credits` + `entitlement_id`, `actor` | 404 |
| POST `/admin/entitlements` | admin (MFA bước-lên khi `credits > 50`, Q13) | — | `{"user_id","product_id","days":int hoặc null,"credits":int hoặc null,"review_mode":str hoặc null,"reason":str 3..500,"request_key":uuid}` | `{"status":"granted" hoặc "replay","entitlement":{...}}` | 404; 422 |
| POST `/admin/entitlements/{id}/revoke` · `/extend` | admin | — | `{"reason"}` / `{"days","reason"}` | `{"status", "entitlement"}` | 404; 409 |
| POST `/admin/credits/adjust` | admin (MFA bước-lên khi `abs(delta) > 50`, Q13) | — | `{"entitlement_id","delta":int≠0,"reason":str 10..500,"request_key":uuid}` | `{"status":"adjusted" hoặc "replay","balance":int}` | 409 `would_go_negative`, `not_usable`; 404 |
| POST `/admin/credits/grant-extra` | admin (giáo viên: xem Q5 mục 10; MFA bước-lên khi tổng lượt cấp trong yêu cầu > 50, Q13) | — | `{"cohort_id":uuid hoặc null,"user_ids":[uuid] hoặc null,"entitlement_id":uuid hoặc null,"credits":int 1..100000,"reason":str 3..500,"request_key":uuid}` — có `cohort_id` mà không có `user_ids` = cả lớp; không có `cohort_id` → `user_ids` đúng một người và bắt buộc `entitlement_id` (5.15) | `{"granted":[{"user_id","entitlement_id","balance"}],"skipped":[{"user_id","reason"}]}`; `skipped.reason` ∈ `no_class_entitlement`, `not_usable` | 404 `cohort_not_found`; 422 |
| GET `/admin/credits/convert-class/pending` | admin | — | — | `{"items":[{"cohort_id","cohort_name","course_code","members":int,"pending_members":int}]}` — lớp chưa lưu trữ, có gắn khoá, còn ít nhất một thành viên đang học có tài khoản mà chưa có quyền `class`/`repractice` dùng được cho khoá của lớp (5.18); G09 dùng cho Việc cần làm và trang Lớp | 403; 503 |
| GET `/admin/credits/convert-class/preview?cohort_id=…` | admin | — | — | `{"cohort":{"id","name","course_code"},"product":{"id","title"} hoặc null,"products":[{"id","title"}],"suggested_credits":int hoặc null,"members":[{"user_id","display_name","state","expires_at"}],"counts":{"to_convert":int,"already_metered":int,"no_account":int}}`; `members.state` ∈ `to_convert`, `already_metered`, `no_account`; `expires_at` = hạn quyền sẽ cấp (null = không hạn); `suggested_credits` = `LEGACY_CLASS_INITIAL_CREDITS` (null khi chưa đặt) | 404 `cohort_not_found`; 409 `cohort_archived`, `cohort_has_no_course` |
| POST `/admin/credits/convert-class` | admin (MFA bước-lên khi `credits_per_member > 0`, Q13: luôn là cấp hàng loạt) | — | `{"cohort_id":uuid,"credits_per_member":int 0..100000,"request_key":uuid,"product_id":uuid hoặc null}` | `{"status":"converted" hoặc "replay","converted":[{"user_id","entitlement_id","expires_at","balance"}],"skipped":[{"user_id" hoặc null,"reason"}]}`; `skipped.reason` ∈ `already_metered`, `no_account` | 404 `cohort_not_found`; 409 `cohort_archived`, `cohort_has_no_course`, `no_class_product`, `product_ambiguous`; 422; 503 |

`Order` = `{"order_code","status","product":{"slug","title","short_title"},"tuition_vnd","access_days","ai_credits","credit_valid_days","pay_by","created_at","transfer_reported_at","late_transfer_reported_at","confirmed_at","reopened_at","info_kind","received_vnd","overpaid_vnd","admin_message","supplement_by","cancel_reason","cancel_note","cancelled_at","entitlement_expires_at","credits_granted","transfer":{"bank_bin","bank_name","account_no","account_name","amount_vnd","memo":order_code,"vietqr_payload","qr_image_url"} hoặc null}`.
- `transfer` lấy từ cấu hình `ENROLL_BANK_*` (G05 dùng đúng các biến này, không khai biến ngân hàng thứ hai); chỉ trả khi trạng thái là `awaiting_transfer`, `transfer_reported`, `needs_info`, `expired` (đơn hết hạn vẫn cần hiện đúng nội dung chuyển khoản cho người đã chuyển); các trạng thái khác `null`.
- `transfer.vietqr_payload`: chuỗi EMVCo do `backend/services/vietqr.py::build_payload` sinh — mô-đun này thuộc **G05-T11** (GOI-05 mục 5.8). G04-T04 gọi nó ở nơi dựng `transfer`; nếu G05-T11 chưa merge thì trả `null` và bên merge sau nối một dòng kèm test. `qr_image_url` dựng từ `ENROLL_VIETQR_IMAGE_TEMPLATE` (null khi chưa cấu hình; dùng hay không là G05 mục 10 câu 2).
- `info_kind`, `received_vnd`, `supplement_by`, `admin_message`: có giá trị khi đơn ở hoặc từng ở `needs_info`. `overpaid_vnd` = `received_vnd − tuition_vnd` khi dương, ngược lại null.
- `cancel_reason` ∈ `learner`, `admin` (ai huỷ; suy từ `cancelled_by` so với `user_id`); `cancel_note` là lý do admin ghi (cột `enrollment_orders.cancel_reason`), null khi học viên tự huỷ.
- `entitlement_expires_at`, `credits_granted`: có khi `confirmed` (hạn của quyền vừa cấp; số lượt cộng lúc xác nhận, **chưa gồm** lượt chuyển từ kỳ trước — số lượt chuyển đọc ở `GET /api/me/courses` → `credits.carry_balance`).
- `content_visible_until` (ở `GET /api/me/courses`, `GET /admin/users/{user_id}/access`): mốc cuối cùng người đó còn xem được nội dung bài làm và nhận xét = lúc quyền khoá cuối cùng hết hạn + `RETENTION_CONTENT_DAYS_AFTER_EXPIRY` ngày (5.14). `null` khi: cờ `retention_by_entitlement` tắt; hoặc người đó còn quyền hiệu lực (chưa có mốc cắt); hoặc chưa từng có dòng `entitlements`. `content_days_after_expiry` = giá trị cấu hình (45) khi cờ bật, `null` khi cờ tắt — để G05/G07 dựng câu "Bài làm và nhận xét xem được thêm N ngày sau khi khoá hết hạn" mà không gõ số trong mã. Bản ghi âm theo mốc riêng (tối đa 60 ngày kể từ lúc ghi).

Nguồn các trường trình bày của `GET /api/courses*` (thiếu dữ liệu → `null`, G05 ẩn khối tương ứng, không bao giờ trả `XXX`):
- `level_from`, `level_to`, `author`, `faq`: cột `course_products.presentation` (jsonb, admin nhập qua `/admin/course-products`; 5.2).
- `credits_expire_note`: câu tiếng Việt do backend dựng từ `credit_valid_days` (NULL → "Dùng tới hết hạn khoá"; có số → "Dùng trong N ngày kể từ ngày mở khoá"); `ai_credits = 0` → null.
- `credit_carry_percent`: giá trị `CREDIT_CARRY_PERCENT` (mặc định 100); 0 → null (không chuyển lượt, G05 ẩn câu). `credit_carry_valid_days`: giá trị `CREDIT_CARRY_VALID_DAYS` (mặc định 60); null khi `credit_carry_percent` null. G05 dựng câu "Đăng ký lại trong N ngày kể từ ngày hết hạn thì lượt chưa dùng được chuyển sang kỳ mới và dùng được N ngày" từ hai trường này.
- `lesson_count`, `chapters:[{title, lessons:[{title, kind, duration_min, is_preview, preview_href}]}]`: dữ liệu bài học thuộc bảng `course_lessons` của **G07** (spec COURSELESSON; phân xử 2 ở `01-KE-HOACH-TONG.md` mục 6). G04 để một điểm ghép duy nhất `routers/courses_public.py::_outline_for(product) -> {"lesson_count": None, "chapters": None}`; G07 thay thân hàm khi có bảng. Tới lúc đó hai trường là `null`.

`viewer.can_renew` / `can_renew`: true khi khoá online đã hết hạn, hoặc còn hạn không quá `ENROLL_RENEW_WINDOW_DAYS` ngày, và chưa có đơn mở cho cùng sản phẩm, và sản phẩm đang `open`.

`sign_in_again` (403): phòng thủ cho tài khoản GoTrue không có `email_confirmed_at` (chỉ có thể sinh ra từ đăng ký bằng mật khẩu, cách này đã bị bỏ). Thông điệp: "Vui lòng đăng nhập lại bằng Google hoặc mã gửi qua email." Đọc trường này từ user GoTrue trả về, không từ `user_metadata`. Không có màn hay thư "xác minh email".

Mã lỗi cho đường chấm (thêm vào khuôn `HTTPException` hiện có của `grading.py` và `writing_student.py`): 402 `insufficient_credits` (`{"message":"…","balance":0,"credit_source":"online" hoặc "class"}`), 403 `no_entitlement`, 503 `credits_unavailable`. Kiểm `services/errors.py` (bộ lọc 5xx cho qua `error_code`) để thông điệp 503 không bị thay.

### 5.10 Cấu hình và cờ

| Tên | Loại | Mặc định | Ý nghĩa |
|---|---|---|---|
| `credit_metering` | runtime flag (`is_enabled(..., default=False)`, đọc lỗi thì **ném** `CreditUnavailable`, không dùng `on_error=False`; xem 5.4 bước 1) | tắt | Bật đo lượt ở đường chấm; tắt không mở miễn phí cho tính năng mới (5.4) |
| `enrollment_orders` | runtime flag (default False) | tắt | Cho tạo đơn mới |
| `single_session_learners` | runtime flag (default False) | tắt | FR-028, 040, 041; cũng bật việc ghi và đọc "Lần đăng nhập gần đây" (FR-049) |
| `retention_by_entitlement` | runtime flag (default False) | tắt | Nội dung xem được tới 45 ngày sau khi quyền khoá cuối cùng hết hạn (5.14, FR-048) |
| `pron_sample_window` | runtime flag (default False) | tắt | Chấm phát âm trên đoạn mẫu (5.16) |
| `ENROLLMENT_PAY_HOURS` | env int | **không có** (0) → `orders_paused` | Hạn giữ đơn; anh Andy điền (Q11) |
| `ENROLL_BANK_BIN`, `ENROLL_BANK_NAME`, `ENROLL_BANK_ACCOUNT_NO`, `ENROLL_BANK_ACCOUNT_NAME`, `ENROLL_VIETQR_IMAGE_TEMPLATE` | env str | rỗng → `orders_paused` | Tài khoản nhận tiền; anh Andy điền (Q11) |
| `ENROLL_RENEW_WINDOW_DAYS` | env int | `30` (tạm, Q7) | Còn không quá N ngày thì cho đăng ký lại |
| `ENROLL_PAY_REMINDER_HOURS_BEFORE`, `ENROLL_PAY_REMINDER_MIN_AGE_HOURS` | env int | `24`, `6` (tạm, GOI-11 câu 24) | Thư nhắc một lần |
| `ENROLL_SUPPLEMENT_HOURS` | env int | `72` (tạm, Q8) | Hạn bổ sung điền sẵn khi admin không nhập |
| `CREDIT_COST_SPEAKING_UNIT`, `CREDIT_COST_WRITING_ESSAY` | env int | `1`, `1` | Số lượt cho một đơn vị Speaking (một bài Part 2 hoặc một cụm) và một bài Writing — đã chốt 18/11. Full test Writing = 2 bài = 2 lượt (đã xác nhận 18/11 chiều) |
| `CREDIT_COST_SHORT_WRITING` | env int | `1` (đã chốt 18/11 chiều) | Số lượt cho một đoạn viết ngắn ở Kiến thức nền nộp cho AI nhận xét (`feature='short_writing_feedback'`) |
| `CREDIT_SPEAKING_CLUSTER_PARTS` | env str, danh sách Part | `1,3` (đã chốt 18/11) | Part tính lượt theo cụm |
| `CREDIT_SPEAKING_CLUSTER_SIZE` | env int 2..3 | `3` (Q2) | Số câu tối đa một lượt phủ trong một cụm |
| `CREDIT_CARRY_PERCENT` (trường API `credit_carry_percent`) | env int 0..100 | `100` (đã chốt 18/11 chiều: chuyển toàn bộ) | Phần trăm lượt chưa dùng được chuyển khi đăng ký lại; nhỏ hơn 100 thì làm tròn xuống; 0 = không chuyển. **Thay** `CREDIT_CARRY_OVER_RATIO` (ĐÃ BỎ) |
| `CREDIT_CARRY_VALID_DAYS` (trường API `credit_carry_valid_days`) | env int 0..3650 | `60` ("bảo lưu tối đa 2 tháng"; cách áp là mặc định tạm, Q3) | Một số dùng cho hai việc: (1) cửa sổ đăng ký lại — đơn phải được tạo không muộn hơn N ngày sau ngày hết hạn của kỳ cũ; (2) hạn bảo lưu — lượt chuyển dùng được N ngày kể từ `starts_at` của quyền mới. **Thay** `CREDIT_CARRY_OVER_MAX_GAP_DAYS` (ĐÃ BỎ, gộp vào đây); `CREDIT_CARRY_OVER_ROUNDING` cũng **ĐÃ BỎ** (luôn làm tròn xuống) |
| `LEGACY_CLASS_INITIAL_CREDITS` (cấu hình `legacy_class_initial_credits`) | env int 0..100000, rỗng được | rỗng → admin phải tự nhập (Q4) | Số lượt điền sẵn trong hộp "Chuyển lớp sang đo lượt"; chỉ là gợi ý, số thật là `credits_per_member` admin gửi lên |
| `CREDIT_HOLD_TTL_SPEAKING_SECONDS`, `CREDIT_HOLD_TTL_WRITING_SECONDS` | env int | `600`, `86400` | Hạn giữ chỗ |
| `LEARNER_EMAIL_FROM` | env str | rỗng → outbox `skipped` | Địa chỉ gửi thư học viên, thuộc tên miền đã xác minh trên Resend (Q9) |
| `LEARNER_EMAIL_REPLY_TO` | env str | rỗng → không đặt `reply_to` | Hộp thư nhận trả lời (Q9) |
| `PUBLIC_SITE_URL` | env str | rỗng → thư bỏ dòng liên kết, vẫn gửi | Địa chỉ gốc của web để dựng liên kết trong thư (`config.py` chưa có biến nào như vậy — đã kiểm 18/11) |
| `RESEND_API_KEY` | **biến môi trường tiến trình**, không thêm vào `Settings` | đã có trên Railway cho thư báo chủ dự án | Dùng chung một khoá cho thư học viên; đọc bằng `os.environ` như `owner_alerts.transport_config` (thêm vào `Settings`/`.env` sẽ làm hỏng khởi động — `.env.example` dòng 93–96) |
| `RETENTION_AUDIO_DAYS` | env int | `15` trong mã (hành vi hôm nay); trần cứng 60 | Số ngày giữ bản ghi âm kể từ lúc ghi (5.14, Q10) |
| `RETENTION_CONTENT_DAYS_AFTER_EXPIRY` | env int 1..3650 | `45` (đã chốt 18/11 chiều) | Số ngày còn xem được nội dung bài làm và nhận xét sau khi quyền khoá cuối cùng hết hạn (5.14); chỉ có hiệu lực khi cờ `retention_by_entitlement` bật |
| `LOGIN_EVENTS_KEEP_DAYS` | env int 7..365 | `90` (tạm, Q18) | Số ngày giữ dòng `learner_login_events` trước khi sweep xoá |
| `PRON_SAMPLE_SECONDS` | env int 10..60 | `30` (đề xuất, Q6) | Độ dài đoạn mẫu phát âm |
| `PRON_ONE_PER_SESSION_PARTS` | env str, danh sách Part | `1` (Q6) | Part mà mỗi phiên chỉ chấm phát âm một câu |
| `PRON_ONE_PER_SESSION_MIN_SECONDS` | env int | `12` (lấy từ `select_part1_sample` hiện có) | Câu ngắn hơn thì chờ câu sau |

Thêm biến env vào `config.py` (lớp `Settings`) với kiểu và mặc định; runtime flag đọc qua `services/runtime_flags.py`. Mọi giá trị đăng ký đọc qua một hàm `services/enrollment_orders.py::enrollment_config()` để sau này chuyển nguồn sang trang Cài đặt › Thanh toán (tờ AdminCaiDat, chưa gói nào nhận) mà không sửa nơi dùng. Không ghi số học phí/thời hạn/lượt/tên khoá nào vào mã.

### 5.11 Email

- **Dịch vụ gửi: Resend, đã có trong repo** (00 mục 2 điểm 23). Hiện trạng (mục 2, dòng Email): `services/owner_alerts.py` chỉ gửi thư báo chủ dự án; người gửi ghi cứng `alerts@averlearning.com`; người nhận là danh sách `OWNER_ALERT_EMAILS`; thư chỉ có `subject` + `text`; khoá `RESEND_API_KEY` đọc từ biến môi trường tiến trình. Không dựng hệ thứ hai, không thêm thư viện gửi thư: viết `services/learner_email.py` gọi **cùng hàm** `owner_alerts.send_via_resend`.
- **Dùng lại nguyên vẹn** từ `owner_alerts`: `RESEND_URL`, header `Authorization` và `Idempotency-Key`, `SEND_TIMEOUT_SECONDS`, kiểu trả `SendResult` cùng bộ mã lỗi ngắn (`timeout`, `transport_*`, `http_<mã>[:tên]`), `MAX_ATTEMPTS` (5 — khớp CHECK `attempts BETWEEN 0 AND 5` của `learner_email_outbox`), `backoff_seconds()` / `BACKOFF_SECONDS` cho `next_attempt_at`, `VIETNAM_TIME`, và quy tắc `Idempotency-Key` = id dòng outbox (gửi lại sau lỗi dùng cùng khoá nên Resend không gửi trùng).
- **Phải mở rộng** (ba chỗ, đều giữ mặc định cũ để `tests/test_owner_alerts*.py` xanh không sửa): (1) *người gửi* — `send_via_resend` (dòng 270, chữ ký hôm nay `send_via_resend(email, *, config, idempotency_key, client=None)`) thêm tham số chỉ-theo-tên `sender: str | None = None` (None → `SENDER`) và `reply_to: str | None = None`; (2) *người nhận* — thêm `recipients: tuple[str, ...] | None = None` (None → `config.recipients` như cũ); thư học viên luôn truyền đúng **một** địa chỉ; (3) *HTML* — `Email` (dòng 139) thêm trường `html: str | None = None`; khi khác None thì thân yêu cầu gửi Resend có thêm khoá `"html"` cạnh `"text"`. Không sửa `transport_config()`: nó coi thiếu `OWNER_ALERT_EMAILS` là chưa cấu hình, nên `learner_email` tự dựng cấu hình bằng `learner_email.transport() -> TransportConfig(recipients=(), api_key=os.environ["RESEND_API_KEY"] đã strip, missing=…)` với `missing` gồm `RESEND_API_KEY` và/hoặc `LEARNER_EMAIL_FROM` khi rỗng.
- **Không dùng lại:** bảng `owner_alert_outbox`, `PgOutboxStore`, `dispatch_due` và `render` của owner alerts (gắn với sự kiện an ninh staff và kết nối `DATABASE_URL` trực tiếp). Thư học viên có outbox riêng `learner_email_outbox` (5.2), đọc ghi qua `supabase_admin`; `learner_email.dispatch_due(limit=50)` nhận dòng `pending` tới hạn bằng UPDATE có điều kiện (`attempts` cũ) để hai tiến trình không gửi trùng, gửi, rồi đánh `sent` hoặc tăng `attempts` + `next_attempt_at = now() + backoff_seconds(attempts)`; hết `MAX_ATTEMPTS` → `failed`.
- Hàng outbox của thư đơn được ghi **trong** RPC chuyển trạng thái (cùng giao dịch). Gửi bằng `scripts/enrollment_sweep.py`, các bước độc lập (một bước lỗi không chặn bước sau) theo thứ tự: (1) hết hạn đơn `fn_enrollment_orders_expire`; (2) xếp thư nhắc `fn_enrollment_order_pay_reminders`; (3) hết hạn giữ chỗ `fn_credit_expire_reservations`; (4) đóng sổ lượt, chuyển lượt, hết hạn lượt chuyển `fn_credit_expire_entitlements` (sau khi 383 có; chưa có hàm thì bước này tự bỏ qua và ghi log); (5) xếp thư "khoá đã mở đăng ký" `fn_course_open_alerts_enqueue(200)` — hàm do **G05-T22** tạo trong migration của G05 (bảng `course_open_alerts` có số migration lớn hơn 381 nên hàm đọc bảng đó không thể nằm trong migration của gói này); PostgREST báo không tìm thấy hàm (`PGRST202`) → bỏ qua và ghi log `[enroll] open_alerts skipped=no_function`, như bước 4; (6) xoá dòng `learner_login_events` quá `LOGIN_EVENTS_KEEP_DAYS` ngày (bảng chưa có → bỏ qua, ghi log); (7) gửi outbox. Cờ `--no-mail` cho staging (bỏ bước 7). File cron `backend/railway.enrollment-sweep.json` (`*/5 * * * *`, `python -m scripts.enrollment_sweep`, mẫu `railway.staff-security-sweep.json`). Tạo service cron trên Railway là việc của anh Andy.
- **Hàm `fn_course_open_alerts_enqueue(p_limit int) RETURNS integer`** do G05-T22 viết và sở hữu; định nghĩa đầy đủ ở **GOI-05 mục 5.7** (bản đó thắng nếu khác). Phần gói này dựa vào: hàm chỉ xếp thư cho sản phẩm đang `status='open'`, công khai, chưa lưu trữ; bỏ qua người đã có dòng `entitlements` còn hiệu lực của sản phẩm đó; mỗi dòng outbox có `template='course_open_alert'`, `user_id = NULL`, `to_email` = email của dòng đăng ký, `payload = {product_slug, product_title, unsubscribe_token}`, `dedupe_key = 'open_alert:' || <id dòng>` với `ON CONFLICT (dedupe_key) DO NOTHING`; hàm đặt `notified_at` trong cùng giao dịch và trả số dòng đã xử lý. Bảng `course_open_alerts` có chỉ mục duy nhất `(product_id, lower(email))` và `notified_at` nên **một người một khoá chỉ nhận một thư**, kể cả khi sweep chạy lại, khoá đóng rồi mở lại, hay người đó bấm đăng ký nhận báo lần nữa (G05 FR-05-060).
- Lúc gửi: dòng có `user_id` → đọc `users.email` và tên hiển thị hiện tại; dòng `to_email` → gửi tới đúng địa chỉ đó, không tra `users`; thiếu tên dùng "Chào bạn,"; `LEARNER_EMAIL_FROM` rỗng → `skipped`; thiếu `RESEND_API_KEY` → dòng ở lại `pending`, ghi một cảnh báo `learner_email_transport_unconfigured` nêu tên biến thiếu (không nêu giá trị). Mẫu `order_pay_reminder`: đọc lại đơn, khác `awaiting_transfer` hoặc `pay_by` đã qua → `skipped` (FR-039). Mẫu `course_open_alert`: đọc lại sản phẩm theo `payload.product_slug`, không còn `open` + công khai → `skipped` (FR-050). Bốn thư đơn và thư `course_open_alert` **không** đọc công tắc `users.notification_email` (thư đơn là thư bắt buộc; thư báo mở khoá do chính người nhận đăng ký). `Idempotency-Key` = id outbox.
- Mẫu thư: `backend/templates/email/<template>.txt` (văn bản thuần) và `.html` (HTML đơn giản), tiếng Việt, xưng "bạn", dùng "Đơn đăng ký", "Học phí", "Thanh toán", "Đăng ký khoá", "Đăng ký lại"; ngày giờ theo giờ Việt Nam dạng `21:14, 16/11/2026`; không có liên kết đăng nhập kèm token; liên kết trỏ trang thường `/enroll/<order_code>` (route `/enroll/[orderCode]` của G05-T12), dựng từ `PUBLIC_SITE_URL` (biến mới ở 5.10 — đã kiểm 18/11: `config.py` chưa có biến địa chỉ gốc của web; rỗng thì thư bỏ dòng liên kết). `render(template, payload, user) -> Email` trả `Email(subject, text, html)`; thiếu file `.html` thì `html=None` và thư đi dạng văn bản thuần. G04-T04 viết bản `.txt` của bốn thư đơn theo tờ EmailMau thư 4, 5, 14, 6 đủ để test đầu-cuối; G04-T17 viết bản `.txt` tối thiểu của `course_open_alert` (tiêu đề "Khoá <short_title hoặc title> đã mở đăng ký"; thân: lời chào, một câu "Bạn đã đăng ký nhận báo khi khoá <title> mở. Khoá đang mở đăng ký.", liên kết `/courses/<product_slug>`, liên kết bỏ nhận dựng từ `unsubscribe_token` theo đường dẫn ở GOI-05 mục 5.7); G05-T14 hoàn thiện câu chữ và bản `.html` của mọi mẫu (phân xử 1). Thư `course_open_alert` chưa có trên tờ EmailMau (Q16b).
- **Thư mã đăng nhập (`login_code`, tờ EmailMau thư 1) không đi qua `learner_email_outbox`** và không có trong CHECK. Lý do: (1) thư này phải gửi ngay, outbox chỉ được quét 5 phút một lần; (2) mã không được nằm ở dạng đọc được trong `payload`; (3) phiên đăng nhập do Supabase Auth cấp, nên mã do chính Supabase Auth sinh, kiểm và gửi là đường ít rủi ro nhất. G05 đã chọn đúng đường này: mã OTP email của Supabase Auth qua hai route backend `/auth/login-code/request` và `/auth/login-code/verify` cùng bảng đếm `login_code_state` (G05-T18, GOI-05 mục 5.6). Gói này không có bảng, route hay mẫu nào cho mã đăng nhập. Tài khoản mới tạo từ mã đi chung đường `GET /auth/me` hiện có, sinh dòng `users` với `is_active=false`; các route đánh dấu "có" ở 5.9 phải chạy được với tài khoản đó, và xác nhận đơn là lúc `is_active` được bật. `learner_email.send_direct(template, to, payload)` (cùng transport, không ghi outbox) vẫn được G04-T04 cấp cho thư không gắn tài khoản về sau. Mẫu `class_invite` (thư 3 tờ EmailMau: lời mời vào lớp kèm mã kích hoạt; người nhận có thể chưa có tài khoản) đi `send_direct`, không qua outbox (giống `email_changed_notice`); G09-T29 gọi, G05-T14 viết câu chữ (thêm 18/11 theo rà soát).
- Bốn mẫu `result_ready_digest`, `course_expiring`, `course_expired` (thêm 18/11 theo rà soát), `staff_notice` dùng chung bảng và dispatcher; nguồn sinh, mẫu chữ và việc kiểm công tắc thư thuộc GOI-11 (G11-T12, T13). Dispatcher gặp mẫu chưa có file template → `failed` với `last_error_code='template_missing'`, không làm hỏng các thư khác.

### 5.12 Sự kiện ghi email và log

| Chuyển | Email (outbox) | Sự kiện `enrollment_order_events` | Log (không có email/tên/số tiền/mã đơn) |
|---|---|---|---|
| tạo đơn | `order_created` | có | `[enroll] order_created product=<slug>` |
| nhắc trước hạn | `order_pay_reminder` (một lần) | có (`pay_reminder`) | `[enroll] pay_reminder queued=<n>` |
| báo đã chuyển (kể cả báo muộn) | — | có | `[enroll] transfer_reported late=<bool>` |
| `needs_info` | `order_needs_info` (mỗi lần đánh dấu) | có | `[enroll] needs_info kind=<k>` |
| bổ sung | — | có | `[enroll] supplemented` |
| `confirmed` (kể cả mở lại đơn hết hạn) | `order_confirmed` | có | `[enroll] confirmed credits=<n> reopened=<bool>` |
| `expired` | — | có | `[enroll] expired count=<n>` |
| `cancelled` | — | có | `[enroll] cancelled by=<learner hoặc admin>` |
| giữ chỗ/chốt/hoàn | — | — | `[credits] decision=reserved|committed|released|insufficient|unavailable feature=<f> reason=<r> source=<online|class>` |
| đóng sổ, chuyển lượt, hết hạn lượt chuyển, cấp thêm, chuyển lớp sang đo lượt | — | — | `[credits] lifecycle=expired|carried|carry_expired|grant_extra|class_converted count=<n>` |
| xếp thư "khoá đã mở đăng ký" | `course_open_alert` (do hàm của G05 ghi) | — | `[enroll] open_alerts queued=<n>` hoặc `skipped=no_function` |
| ghi lần đăng nhập | — | — (bảng `learner_login_events`) | `[session] login_event outcome=<o>`; lỗi ghi: `[session] login_event_failed` (không có nhãn thiết bị, không có địa chỉ mạng) |

Thông báo trong ứng dụng cho huỷ, hết hạn, báo đã chuyển, cần bổ sung, đã mở khoá, được cấp thêm lượt: GOI-11 phần A sinh từ `enrollment_order_events` và `credit_ledger`; gói này không ghi bảng thông báo.

### 5.13 Một phiên mỗi tài khoản học viên (hỏi trước khi chiếm, không đẩy bài có giờ)

Chỉ áp `users.role IN ('user','student')` khi cờ `single_session_learners` bật; `instructor`, `admin` không bao giờ qua cổng này. Tự làm, không dùng "Single session per user" của Supabase (tính năng đó áp cả admin và không hỏi trước).

**Migration 384** `backend/migrations/384_learner_active_sessions.sql`: bảng `learner_active_sessions(user_id uuid PK FK users ON DELETE CASCADE, session_id uuid NOT NULL, device_label text NULL ≤ 120, claimed_at timestamptz NOT NULL DEFAULT now(), previous_session_id uuid NULL, displaced_at timestamptz NULL, revoke_pending_at timestamptz NULL)`; RLS bật, không policy, REVOKE như 5.2. `session_id` là claim `session_id` trong JWT của Supabase Auth, đọc bằng cách giải mã payload của token **đã được GoTrue chấp nhận** như `services/staff_guard.py::_token_claims` (144) đang làm với `aal`/`amr` — tách phần giải mã đó thành hàm dùng chung thay vì viết bản thứ hai (CHƯA KIỂM claim `session_id` có trong token của dự án: giải mã phần payload của một access token staging, tìm khoá `session_id`; không có thì dừng và báo).

**`backend/services/timed_work.py`** — `active_timed_work(user_id) -> TimedWork(title, minutes_left) | None` (API trả ra dưới tên `timed_activity`), gộp các nguồn: (a) `mock_exam_service.live_sitting_for_user` + `section_time_remaining_seconds`; (b) `class_assignment_items.timed_expires_at > now()` chưa nộp của `students.user_id`; (c) `reading_test_attempts` / `listening_test_attempts` `status='in_progress'` còn trong giờ (đã kiểm 18/11: cả hai bảng có `started_at`; giới hạn giờ của Reading là `reading_tests.time_limit_minutes` — mig 087 dòng 13–14, 45; CHƯA KIỂM cột giới hạn giờ của Listening: `grep -rn "time_limit\|duration" backend/migrations/06[5-9]_*.sql backend/routers/listening*.py | head`); (d) full test Speaking và bài luyện có đồng hồ: CHƯA KIỂM nguồn dữ liệu (`grep -rn "full_test_attempt" backend/routers/sessions.py | head`), bổ sung khi G08 có khung phòng thi. `minutes_left` lấy theo đồng hồ máy chủ, làm tròn lên. **Lỗi đọc bất kỳ nguồn nào → ném lỗi**; bên gọi coi như "có bài có giờ" (không bao giờ chiếm phiên khi không chắc).

**Ba trạng thái của một phiên học viên khi cờ bật** — (1) *đang dùng*: gọi được mọi API; (2) *chưa claim* (đăng nhập xong nhưng tài khoản đang có phiên đang dùng khác): **không dùng được API học viên** (409 `session_not_current`), chỉ gọi được ba route `/api/account/session*`, các route đơn đăng ký và route công khai — nên "Huỷ" ở màn 8a là thật; (3) *đã bị chiếm*: 401 `session_displaced`. Claim **không** tự chạy lúc đăng nhập: phiên khác chỉ bị xoá sau khi người dùng bấm "Tiếp tục ở đây" và máy chủ xác nhận không có bài có giờ.

**`backend/services/session_gate.py`:**
- `ensure_current(user_id, role, session_id)`: cờ tắt hoặc vai trò không phải học viên → qua. Chưa có dòng → tự ghi phiên này là phiên đang dùng (không xoá phiên nào). Trùng `session_id` → qua; nếu dòng có `revoke_pending_at` và `active_timed_work` trả None → xoá phiên này (`delete_auth_sessions` cho đúng `session_id`) và trả 401. Khác `session_id` → 409 `session_not_current`. **Lỗi đọc bảng → cho qua và ghi log** (cổng này chống dùng chung tài khoản, không bảo vệ AI trả phí; một lỗi DB không được đá người đang làm bài).
- Gọi từ `services/activation_gate.py::require_active_learner` sau bước kiểm kích hoạt, và trong ba route `/api/account/session*` (các route này miễn cổng kích hoạt nên tự gọi phần đọc trạng thái).
- `status(...)` cho `GET /api/account/session/status`: `current`; hoặc `other_device` / `other_device_timed` kèm `other_session` (`device_label` suy từ `User-Agent` lúc claim, dạng "Chrome trên Windows"; `since` = `claimed_at`) và `timed_activity` (`device_label` là của phiên đang dùng).
- `claim(...)`: `active_timed_work` khác None hoặc ném lỗi → 409 `timed_activity_in_progress` / 503 `session_claim_unavailable`, không đổi gì. Ngược lại: upsert dòng sang `session_id` mới rồi `DELETE FROM auth.sessions WHERE user_id = :uid AND id <> :sid` (thêm `delete_other_auth_sessions(engine, user_id, keep_session_id)` cạnh `delete_auth_sessions` trong `services/staff_security.py`); ghi `previous_session_id` = phiên vừa bị thay và `displaced_at = now()` vào dòng.
- `session_displaced`: phiên đã bị xoá thì GoTrue từ chối token trước khi tới cổng. Trong nhánh lỗi 401 của `routers/auth.py::get_supabase_user`, khi cờ bật: đọc `session_id` từ payload JWT (không xác minh chữ ký — chỉ dùng để **chọn mã lỗi**, không cấp quyền gì) và nếu trùng `learner_active_sessions.previous_session_id` thì trả 401 `{"detail":{"error_code":"session_displaced","displaced_at":…}}` thay cho 401 chung. Không trùng hoặc lỗi đọc → 401 như cũ.
- `revoke_all(...)`: không có bài có giờ → xoá mọi `auth.sessions` của người đó và xoá dòng; có bài có giờ → xoá mọi phiên **trừ** phiên đang dùng, đặt `revoke_pending_at=now()`, trả `deferred_timed` khác null.

Luồng phía trình duyệt (**G05-T20** dựng theo tờ TaiKhoanDangNhap; tên route và mã lỗi khớp GOI-05 mục 5.2b): sau khi đăng nhập xong gọi `GET /api/account/session/status`; `other_device` → màn 8a ("Tiếp tục ở đây" gọi claim; "Huỷ" đăng xuất thiết bị này); `other_device_timed` → màn 8b (không có nút chiếm phiên); thiết bị cũ nhận 401 `session_displaced` → màn 8c. Bất kỳ route học viên nào trả 409 `session_not_current` → mở lại màn 8a/8b. "Huỷ mã đăng nhập chưa dùng" khi đăng xuất mọi thiết bị thuộc bên giữ mã đăng nhập (G05).

Giới hạn đã biết: PostgREST trực tiếp với JWT cũ còn đọc được tới khi JWT hết hạn (research §9.2) — chấp nhận vì dữ liệu học viên đi qua backend. Nhiều tab cùng trình duyệt dùng chung một phiên nên không bị hỏi.

### 5.13b Lần đăng nhập gần đây (migration 387, G04-T16)

Nguồn dữ liệu cho khối "Lần đăng nhập gần đây" ở Hồ sơ (tờ TaiKhoan dòng 246–253 và ghi chú cuối tờ: "3 dòng gần nhất (thiết bị, giờ, nơi gần đúng theo địa chỉ mạng, kết quả) để nhận ra đăng nhập lạ"; tờ TaiKhoanDangNhap màn 5, 8a–8c). Giao diện thuộc **G07** (FR-07-064); hộp "Đăng xuất khỏi mọi thiết bị" thuộc **G05-T20**. Gói này chỉ ghi và trả dữ liệu.

**Migration 387** `backend/migrations/387_learner_login_events.sql` (phụ thuộc 384; nhóm forward-policy `single_session`): bảng `learner_login_events`:

| Cột | Kiểu | Ràng buộc |
|---|---|---|
| id | bigint | GENERATED ALWAYS AS IDENTITY PK |
| user_id | uuid | NOT NULL FK `users(id)` ON DELETE CASCADE |
| session_id | uuid | NOT NULL (claim `session_id` của phiên mà sự kiện nói tới) |
| occurred_at | timestamptz | NOT NULL DEFAULT now() |
| device_kind | text | NOT NULL CHECK IN (`desktop`,`phone`,`tablet`,`unknown`) |
| device_label | text | NULL ≤ 120 — dạng "Chrome trên Windows", "iPhone · Safari"; suy từ `User-Agent` bằng đúng hàm đang dựng `learner_active_sessions.device_label` (5.13); không lưu chuỗi `User-Agent` gốc |
| method | text | NOT NULL CHECK IN (`google`,`email_code`,`unknown`) |
| outcome | text | NOT NULL CHECK IN (`signed_in`,`pending`,`claimed`,`claim_refused_timed`,`displaced`,`signed_out_all`) |

`UNIQUE (user_id, session_id, outcome)` (mỗi phiên mỗi loại kết quả ghi một lần; ghi bằng `ON CONFLICT DO NOTHING`); index `(user_id, occurred_at DESC)`. RLS bật, không policy, REVOKE như 5.2 (chỉ backend đọc ghi bằng `service_role`). **Không có cột địa chỉ IP, không có cột vị trí.** Bảng không phải loại chỉ ghi thêm: sweep được xoá dòng quá hạn. Rollback: DROP bảng (không chứa dữ liệu học tập).

**Kết quả (`outcome`) và nơi ghi** — tất cả trong `services/session_gate.py`, qua một hàm `services/login_events.py::record(user_id, session_id, outcome, *, request=None, device_label=None, device_kind=None, method=None)`; hàm này **không bao giờ ném lỗi** (bắt mọi ngoại lệ, ghi log `[session] login_event_failed`) và chỉ chạy khi cờ `single_session_learners` bật:

| `outcome` | Ghi khi nào | Thiết bị được ghi | Câu trên tờ (G07 dựng) |
|---|---|---|---|
| `signed_in` | `ensure_current` tự ghi phiên này là phiên đang dùng vì tài khoản chưa có phiên nào (lần đầu ghi phiên) | thiết bị của phiên này | "Đang dùng" khi `is_current`, ngược lại "Đã đăng nhập" |
| `pending` | `status()` lần đầu trả `other_device` cho một phiên chưa claim (người vừa đăng nhập thấy màn 8a) | thiết bị mới | "Đã đăng nhập, chưa chọn tiếp tục" |
| `claimed` | `claim()` thành công | thiết bị mới | "Đang dùng" khi `is_current` |
| `displaced` | cùng lúc với `claimed`, cho phiên vừa bị thay | thiết bị cũ (lấy `device_label` của dòng `learner_active_sessions` **trước** khi upsert; `session_id` = `previous_session_id`; `method` chép từ sự kiện `signed_in`/`claimed` gần nhất của phiên đó, không có thì `unknown`) | "Đã đăng xuất: bạn chọn 'Tiếp tục ở đây' trên máy khác" |
| `claim_refused_timed` | `status()` lần đầu trả `other_device_timed`, hoặc `claim()` trả 409 `timed_activity_in_progress` | thiết bị mới | "Bị từ chối: bạn đang làm bài có giờ" |
| `signed_out_all` | `revoke_all()` | thiết bị gọi lệnh | "Đã đăng xuất khỏi mọi thiết bị" |

**Loại thiết bị và nhãn:** suy từ `User-Agent` của request (chuỗi có `iPad` hoặc `Android` không kèm `Mobile` → `tablet`; có `Mobi`/`iPhone` → `phone`; nhận ra trình duyệt máy tính → `desktop`; còn lại `unknown`). Chỉ lưu kết quả đã suy.

**Cách đăng nhập (`method`):** đọc claim `amr` của access token (danh sách `{method, timestamp}`, cùng nguồn `staff_guard` đang đọc cho `totp`): có phần tử `method='oauth'` → `google` (repo chỉ bật một nhà cung cấp OAuth là Google: `frontend/app/(public-auth)/login/login-behavior.tsx`); có `method='otp'` → `email_code`; còn lại → `unknown`. CHƯA KIỂM giá trị thật của `amr[].method` trên token staging cho hai cách đăng nhập (mã hiện chỉ xét `totp`): đăng nhập bằng Google và bằng mã 6 số trên staging, giải mã payload access token, đọc khoá `amr`; nếu giá trị khác `oauth`/`otp` thì sửa bảng ánh xạ, không đoán. Không gọi thêm GoTrue để lấy thông tin này.

**API `GET /api/account/login-events?limit=`** (trong `routers/me_access.py`; miễn cổng kích hoạt như ba route phiên; hợp đồng ở 5.9): chỉ phiên đang dùng gọi được (phiên chưa claim nhận 409 `session_not_current` — người lạ vừa đăng nhập không đọc được lịch sử). `limit` mặc định 3, tối đa 10. Backend đọc 30 dòng mới nhất của người đó, gộp theo `session_id` lấy **sự kiện mới nhất của mỗi phiên**, sắp theo thời gian giảm dần, cắt `limit`. `is_current` = `session_id` của dòng trùng `learner_active_sessions.session_id` và `outcome` ∈ `signed_in`, `claimed`. `approx_location` luôn `null` (cùng quy ước với `GET /api/account/session/status`): gói này **không thu địa chỉ mạng**, G07 ẩn cột "nơi gần đúng" và câu "Nơi là vị trí gần đúng theo địa chỉ mạng" (Q18). Cờ tắt → `{"enabled": false, "items": []}`, G07 ẩn cả khối. Lỗi đọc → 503 `login_events_unavailable`.

**Thời hạn giữ:** `LOGIN_EVENTS_KEEP_DAYS` (mặc định tạm 90); bước 6 của `scripts/enrollment_sweep.py` xoá dòng có `occurred_at` cũ hơn (5.11). Xoá tài khoản thì dòng mất theo (`ON DELETE CASCADE`).

**Không làm ở đây:** "Cách đăng nhập đang dùng" (danh sách Google / mã qua email ở cùng khối) — G07 lấy từ nguồn của G05; "Đổi email đăng nhập" — G05-T24; cảnh báo đăng nhập lạ qua thư — chưa ai yêu cầu.

### 5.14 Thời hạn lưu dữ liệu

- **Bản ghi âm:** tối đa 60 ngày, một giá trị cho mọi người học. `services/retention.py`: `RETENTION_AUDIO_DAYS` đọc từ `settings.RETENTION_AUDIO_DAYS` (mặc định trong mã 15 để merge không đổi hành vi), kẹp vào `1..RETENTION_AUDIO_DAYS_CEILING` với `RETENTION_AUDIO_DAYS_CEILING = 60` là hằng trong mã; giá trị cấu hình lớn hơn 60 bị kẹp về 60 và ghi cảnh báo lúc khởi động. Giữ nguyên tên hằng `RETENTION_AUDIO_DAYS` (test `test_retention_sweep.py` dùng). Không có cột lưu audio theo sản phẩm. Đặt giá trị trên staging/production là bước vận hành của anh Andy, ghi trong `rollout.md` (Q10).
- **Nội dung bài làm và nhận xét — quy tắc đã chốt 18/11 chiều (00 mục 2 điểm 23):** xem được tới `RETENTION_CONTENT_DAYS_AFTER_EXPIRY` ngày (45) sau khi **quyền khoá cuối cùng** của người đó hết hạn. Bản ghi âm vẫn theo mốc riêng ở trên (tối đa 60 ngày kể từ lúc ghi): mốc nào tới trước thì áp cho phần của nó — bản ghi âm có thể hết trước, nội dung chữ còn.
- **Tính mốc cho một người** — file mới `services/retention_policy.py`:
  - `content_window(user_id, now=None) -> ContentWindow(mode, visible_until)` với `mode` ∈ `default`, `open`, `until`:
    - cờ `retention_by_entitlement` tắt → `default` (hành vi hôm nay: 60 ngày theo tuổi phiên);
    - còn ít nhất một quyền hiệu lực theo `entitlements.list_access` (dòng `entitlements` `active` chưa hết hạn hoặc không hạn, **hoặc** quyền suy ra từ thành viên lớp, mã cũ còn sống) → `open` (không có mốc cắt, `visible_until=None`); xét nhánh này TRƯỚC nhánh dưới (sửa 18/11 theo rà soát: học viên chỉ có mã cũ còn sống không có dòng `entitlements` nhưng phải là `open`);
    - không còn quyền hiệu lực nào và chưa từng có dòng `entitlements` → `default`;
    - còn lại → `until`, `visible_until = E + RETENTION_CONTENT_DAYS_AFTER_EXPIRY ngày`, trong đó `E` = lớn nhất của `least(expires_at, revoked_at)` trên mọi dòng `entitlements` của người đó (quyền bị thu hồi tính tới lúc thu hồi).
  - `content_windows(user_ids) -> dict` cho sweep (một lượt truy vấn theo lô).
  - Lỗi tra: read-time dùng `default` (chỉ có thể ẩn sớm hơn, không xoá gì); sweep **bỏ qua** người đó (không xoá).
- **`services/retention.py`:** thêm `@dataclass(frozen=True) RetentionPolicy(audio_days: int, content_days: int, window: ContentWindow | None = None)`, `DEFAULT_POLICY = RetentionPolicy(RETENTION_AUDIO_DAYS, RETENTION_CONTENT_DAYS)`; `compute_expiry(session, now=None, policy=DEFAULT_POLICY)`; `content_purge_cutoff(now=None, content_days=RETENTION_CONTENT_DAYS)`. Giữ chữ ký cũ (gọi không có tham số mới = y như cũ). Với `policy.window.mode`: `default` → như hôm nay; `open` → nội dung chưa hết hạn (`is_content_purged=False`, `days_until_content_purge=None`); `until` → nội dung hết hạn khi `now >= visible_until` (không còn xét tuổi phiên), `days_until_content_purge` = số ngày tới `visible_until`, làm tròn lên. Phần audio không đổi theo `window`.
- **Áp cho Speaking (đường retention sẵn có):** gọi ở `routers/sessions.py:923` (cutoff danh sách lịch sử — với `open` bỏ lọc cutoff, với `until` còn hạn cũng bỏ lọc, quá hạn thì trả danh sách rỗng), `:952`, `:1224`; `jobs/retention_sweep.py::_eligible` (68) lọc thô bằng mặc định rồi `compute_expiry(row, policy=policies[row.user_id])` — sweep nội dung chỉ xoá khi `is_content_purged` đúng theo chính sách của người đó.
- **Áp cho Writing (mặc định tạm, Q20):** bài Writing hôm nay không có cơ chế ẩn hay xoá. Gói này **chỉ ẩn ở tầng đọc, không xoá dữ liệu**: khi `mode='until'` và đã quá `visible_until`, `routers/writing_student.py::list_my_essays` (334) trả danh sách rỗng, `get_my_essay` (522) và `export_my_essay_docx` (646) trả 410 `{"error_code":"content_expired","message":"Bài làm này đã quá thời hạn xem. Đăng ký lại để xem tiếp các bài sau."}`. Đăng ký lại (có quyền hiệu lực) thì `mode='open'` và các bài hiện lại. Lượt làm Reading/Listening: không đổi.
- **Trả mốc cho giao diện:** `GET /api/me/courses` và `GET /admin/users/{user_id}/access` trả `content_visible_until` (= `visible_until` khi `mode='until'`, ngược lại null) và `content_days_after_expiry` (5.9). G07 dùng cho câu "xem được trong Tiến độ thêm N ngày" (tờ TaiKhoan, GiaHanThemLuot); G05 dùng ở trang khoá hết hạn.
- Đoạn mẫu phát âm (5.16) chỉ nghe lại được khi bản ghi còn: quá hạn giữ audio thì API trả mốc thời gian nhưng không có URL audio; phiếu vẫn hiện dòng chữ.
- Số "XXX ngày" ở tờ TaiKhoan, GiaHanThemLuot ("xem được trong Tiến độ thêm XXX ngày") nay là `content_days_after_expiry` = 45. Còn mở: hết 45 ngày thì xoá thật hay chỉ ẩn; có áp cho Reading/Listening không (Q20).
- Không có đường nào giữ bản ghi quá hạn trên hay dùng bản ghi cho mục đích khác (cải thiện chấm bài, làm mẫu): `retention_sweep` xoá đúng hạn với mọi người. Tính năng xin đồng ý để dùng bản ghi đã hoãn (5.17 ĐÃ BỎ).

### 5.15 Vòng đời lượt: hết hạn, chuyển toàn bộ khi đăng ký lại (bảo lưu 60 ngày), cấp thêm (migration 383)

File `backend/migrations/383_credit_lifecycle.sql` (phụ thuộc 381, 382; cùng quy ước).

**Quy tắc đã chốt 18/11 chiều (00 mục 2 điểm 23, thay "chuyển 50%"):** đăng ký lại (không huỷ) → chuyển TOÀN BỘ lượt chưa dùng sang, bảo lưu tối đa 2 tháng; không đăng ký lại → khi khoá hết hạn số lượt còn lại hết hiệu lực. Cách gói này hiện thực (ba điểm in nghiêng là **mặc định tạm**, hỏi ở Q3, Q17):
- *"Đăng ký lại"* = đơn cùng sản phẩm được **tạo** trước ngày hết hạn của kỳ cũ, hoặc trong `CREDIT_CARRY_VALID_DAYS` ngày (60) sau ngày đó; đơn phải được xác nhận thì mới có quyền mới (xác nhận muộn hơn cửa sổ vẫn tính). Việc xét cửa sổ nằm ở `fn_enrollment_order_confirm` (5.3): thoả thì quyền mới có `renews_entitlement_id`, không thoả thì NULL.
- "Toàn bộ" = `CREDIT_CARRY_PERCENT` = 100. Giá trị nhỏ hơn 100 vẫn chạy được (làm tròn xuống) để anh Andy đổi mà không sửa mã.
- *"Bảo lưu tối đa 2 tháng"* = phần lượt chuyển dùng được `CREDIT_CARRY_VALID_DAYS` ngày (60) **kể từ ngày kỳ mới bắt đầu** (`starts_at` của quyền mới), không vượt quá hạn dùng lượt của quyền mới. Mốc lưu ở `entitlements.carry_expires_at`.
- *"Huỷ gói"* được hiểu là **không đăng ký lại** (cách hiểu của người viết, 00 ghi cần anh Andy xác nhận): không có thao tác "huỷ gói" nào khác trong hệ thống; đơn đăng ký lại bị huỷ hoặc hết hạn thì coi như chưa đăng ký lại.
- Không đăng ký lại: quyền cũ tới hạn → bước 1 dưới đây ghi dòng `expire`; lượt mất hiệu lực đúng lúc hết hạn (số dư tính theo thời gian, không chờ job).

**`fn_credit_expire_entitlements(p_user_id uuid, p_limit int, p_carry_percent int, p_carry_valid_days int) → {closed: n, carried: n, carry_expired: n}`** — `p_user_id` NULL = mọi người (sweep); khác NULL = chỉ người đó (gọi ngay sau khi xác nhận đơn). `p_carry_percent` 0..100, `p_carry_valid_days` 0..3650 (ngoài khoảng → `RAISE EXCEPTION`). Ba bước theo thứ tự trong một giao dịch, mỗi quyền khoá bằng `FOR UPDATE SKIP LOCKED` và khoá tư vấn theo người như `fn_credit_reserve`. Quyền nào còn giữ chỗ `open` thì cả ba bước bỏ qua quyền đó lần này (giữ chỗ tự hết hạn trong tối đa 24 giờ):
1. **Hết hạn phần lượt chuyển.** Quyền có `carry_expires_at <= now()` và `carry_closed_at IS NULL`: gọi `fn_credit_usable_balance` (5.3) lấy `carry_lapsed`; `carry_lapsed > 0` → ghi dòng `carry_expire` (−carry_lapsed, key `ent:<id>:carry_expire`, `note` = `"hết hạn bảo lưu <ngày>"`); đặt `carry_closed_at = now()`.
2. **Đóng sổ.** Quyền có `credits_closed_at IS NULL`, không còn dùng được lượt vì đã quá `coalesce(credits_expire_at, expires_at)` hoặc đã `revoked`: nếu quyền có phần lượt chuyển chưa đóng (`carry_settled_at IS NOT NULL`, `carry_expires_at IS NOT NULL`, `carry_closed_at IS NULL`) thì đóng phần lượt chuyển của quyền đó trước, bất kể `carry_expires_at` (ghi `carry_expire` bằng `carry_left + carry_lapsed` nếu lớn hơn 0, đặt `carry_closed_at`) — để **lượt đã chuyển một lần không lẫn vào số được chuyển tiếp**; rồi tính số dư còn lại `b`; `b > 0` → ghi dòng `expire` (−b, key `ent:<id>:expire`); đặt `credits_closed_at = now()`.
3. **Chuyển lượt.** Quyền `active` có `renews_entitlement_id` khác NULL và `carry_settled_at IS NULL`, mà quyền trước đã có `credits_closed_at`: `u` = trị tuyệt đối `delta` của dòng `expire` (key `ent:<id>:expire`) của quyền trước (không có dòng → 0; dòng `carry_expire` **không** tính); quyền trước `revoked` → `u = 0`. `c = floor(u × p_carry_percent / 100)` (số nguyên; 100 → `c = u`). `c > 0` → ghi dòng `carry_over` (+c, key `carry:<from_id>:<to_id>`, `note` = `"<u> × <phần trăm>% = <c>"`) vào quyền mới và đặt `carry_expires_at = least(quyền_mới.starts_at + p_carry_valid_days ngày, coalesce(quyền_mới.credits_expire_at, quyền_mới.expires_at))`; đặt `carry_settled_at = now()` trong mọi trường hợp (cùng lệnh UPDATE với `carry_expires_at`). Quyền mới đã đóng sổ hoặc đã `revoked` trước khi kịp chuyển → chỉ đặt `carry_settled_at`, không ghi dòng.

**Thứ tự tiêu:** lượt chuyển tiêu trước. Sổ không tách hai "ví": phần lượt chuyển còn lại được **tính ra** từ sổ theo công thức `carry_left` ở 5.3 (mọi lượt đã dùng ở quyền mới trừ vào phần chuyển trước). `fn_credit_reserve` không cần biết gì thêm ngoài "số dư dùng được".

Hai tình huống đều đi qua hàm này: (a) đăng ký lại khi kỳ cũ còn hạn — quyền mới bắt đầu ở mốc hết hạn kỳ cũ; sweep đóng sổ kỳ cũ khi tới hạn rồi chuyển, nên lượt chuyển xuất hiện chậm nhất một chu kỳ sweep (5 phút) sau khi kỳ mới bắt đầu; hạn bảo lưu vẫn tính từ `starts_at`, không tính từ lúc sweep ghi dòng; (b) đăng ký lại sau khi đã hết hạn — backend gọi hàm với `p_user_id` ngay sau `fn_enrollment_order_confirm` thành công, lượt chuyển có ngay; lời gọi này lỗi thì chỉ ghi log, sweep sẽ làm lại (xác nhận đơn không bị hoàn tác).

**Ca biên** (ca ghi "tạm" là 00 chưa quyết, có câu hỏi ở mục 10):

| # | Ca | Kết quả |
|---|---|---|
| 1 | Đăng ký lại khi kỳ cũ còn hạn (đơn tạo và xác nhận trước ngày hết hạn) | Quyền mới `starts_at` = hết hạn kỳ cũ, có `renews_entitlement_id`. Tới hạn: kỳ cũ ghi `expire` −u, kỳ mới nhận `carry_over` +u; `carry_expires_at = starts_at + 60 ngày`. Trong lúc kỳ cũ còn hạn, lượt cũ vẫn dùng bình thường ở kỳ cũ |
| 2 | Đơn tạo sau khi hết hạn, trong vòng 60 ngày | Lúc hết hạn kỳ cũ đã ghi `expire` −u. Khi xác nhận đơn: quyền mới `starts_at` = lúc xác nhận, nhận `carry_over` +u ngay; bảo lưu 60 ngày từ `starts_at` |
| 3 | Đơn tạo muộn hơn 60 ngày sau khi hết hạn | `renews_entitlement_id` NULL; không chuyển; lượt cũ đã hết hiệu lực từ lúc hết hạn |
| 4 | Đơn tạo trong cửa sổ, admin xác nhận sau cửa sổ | Vẫn chuyển (mốc là lúc tạo đơn). Bảo lưu 60 ngày tính từ `starts_at` của quyền mới (lúc xác nhận) |
| 5 | Đơn đăng ký lại bị huỷ hoặc hết hạn (`cancelled`, `expired`) | Không có quyền mới → không chuyển. Người đó tạo đơn khác còn trong cửa sổ thì xét lại theo đơn mới. Đơn `expired` được admin mở lại bằng `allow_expired` thì xét theo `created_at` của chính đơn đó |
| 6 | Quyền cũ bị thu hồi (`revoked`) | Không chuyển (`u = 0`); bước 2 vẫn ghi `expire` để đóng sổ |
| 7 | Quyền mới bị thu hồi sau khi đã nhận lượt chuyển | Lượt chuyển mất cùng quyền mới; không trả về quyền cũ |
| 8 | Khác sản phẩm (hết Khoá A, đăng ký Khoá B) | Không chuyển; `renews_entitlement_id` chỉ nối hai quyền cùng `product_id` |
| 9 | Lượt đã chuyển một lần còn dư khi kỳ mới đóng sổ, người học đăng ký kỳ thứ ba | **Không chuyển tiếp** (tạm, Q19): bước 2 ghi phần dư của lượt chuyển thành `carry_expire`, chỉ dòng `expire` (lượt của chính kỳ đó) mới được chuyển sang kỳ thứ ba |
| 10 | Lượt cấp thêm (`grant_extra`) hoặc điều chỉnh (`admin_adjust`) trên quyền online còn dư | **Được chuyển** như lượt gốc (tạm, Q19): sổ không tách nguồn, số chuyển là toàn bộ số dư lúc đóng sổ trừ phần lượt chuyển |
| 11 | Lượt hết hạn sớm do `credit_valid_days` (trước khi khoá hết hạn) | **Được chuyển** nếu sau đó có đăng ký lại hợp lệ (tạm, Q19): dòng `expire` nào của quyền trước cũng là nguồn chuyển |
| 12 | Lượt lớp offline (quyền từ mã, từ lệnh chuyển lớp, quyền luyện lại) | **Không chuyển**: các quyền này không bao giờ có `renews_entitlement_id`; hết khi quyền lớp hết hạn hoặc mã bị thu hồi (bước 2 ghi `expire`) |
| 13 | Còn giữ chỗ `open` lúc đóng sổ hoặc lúc hết hạn bảo lưu | Bỏ qua quyền đó lần này; giữ chỗ được chốt, hoàn hoặc tự hết hạn (tối đa 24 giờ) rồi sweep kế tiếp mới ghi. Số dư trả cho học viên trong lúc chờ vẫn đúng vì tính theo thời gian |
| 14 | Admin gia hạn quyền mới (`fn_entitlement_admin_extend`) | `carry_expires_at` không đổi (tạm, Q19) |
| 15 | Kỳ mới ngắn hơn 60 ngày, hoặc `credit_valid_days` của kỳ mới ngắn hơn 60 | `carry_expires_at` bị kẹp về hạn dùng lượt của quyền mới |
| 16 | `CREDIT_CARRY_PERCENT = 0` | Bước 3 chỉ đặt `carry_settled_at`; API trả `credit_carry_percent: null` |

Chỉ chuyển giữa hai quyền **cùng sản phẩm** và chỉ với quyền khoá online (nguồn `enrollment_order`).

**`fn_credit_grant_extra(p_actor_id uuid, p_actor_kind text, p_entitlement_id uuid, p_credits int, p_reason text, p_request_key text) → granted | replay | not_usable | not_found`** — `p_actor_kind` ∈ `admin`, `instructor`; `p_credits` 1..100000; `p_reason` 3..500; ghi dòng `grant_extra` (+N, key `extra:<request_key>:<entitlement_id>`, `actor_id`, `note = p_reason`). `not_usable` khi quyền không còn dùng được lượt.

Backend `services/credits.py::grant_extra_for(...)` cho `POST /admin/credits/grant-extra`: với `cohort_id` → lấy thành viên đang active của lớp và `cohorts.course_id`; với mỗi người, chọn quyền còn dùng được lượt có `kind IN ('class','repractice')` cho khoá đó (nhiều quyền → quyền hết hạn muộn nhất); không có → đưa vào `skipped` với `no_class_entitlement`. Không có `cohort_id` (cấp từ hồ sơ một học viên) → `user_ids` đúng một người và body thêm `entitlement_id`. Mỗi người một lời gọi RPC, cùng `request_key`; gọi lại cả lô với cùng `request_key` không cộng thêm.

### 5.16 Chấm phát âm trên một đoạn mẫu (migration 385)

Mục tiêu: Azure (đắt) chỉ nhận một đoạn; các tiêu chí khác vẫn chấm trên cả bài; phiếu nói rõ đoạn nào được chấm và cho nghe lại đúng đoạn đó. Sau cờ `pron_sample_window`; cờ tắt → `_assess_pronunciation_safe` chạy y như hôm nay.

**Migration 385** `backend/migrations/385_response_pronunciation_sample.sql`: `ALTER TABLE public.responses ADD COLUMN IF NOT EXISTS pronunciation_sample_start_s numeric(7,2) NULL, ADD COLUMN IF NOT EXISTS pronunciation_sample_end_s numeric(7,2) NULL, ADD COLUMN IF NOT EXISTS pronunciation_sample_scope text NULL CHECK (pronunciation_sample_scope IN ('segment','full','not_sampled'))`, CHECK `end > start` khi cả hai khác NULL. Không đổi dòng cũ, không đổi quyền bảng (CHƯA KIỂM `responses` có nằm trong danh sách bảng client được ghi cột nào của bất biến 320 không: `grep -n "responses" backend/tests/test_client_write_invariant_postgres.py | head`).

**Chọn đoạn — `services/pronunciation_sampling.py`:** thêm hàm thuần `sample_window(duration_s: float, sample_seconds: int) -> tuple[float | None, float | None]`: `duration_s <= sample_seconds + 5` hoặc không rõ độ dài → `(None, None)` (gửi cả bản ghi, `scope='full'`); ngược lại lấy đoạn `sample_seconds` giây **ở giữa bài**: `start = round((duration_s - sample_seconds) / 2, 1)`, `end = start + sample_seconds` (`scope='segment'`). Ví dụ tờ PhieuKetQua: bài 1 phút 52 giây, đoạn 30 giây → 0:41–1:11. **Không sửa** `_part2_segment`, `select_part*_sample` (đường `/pronunciation/full` của full test và test của nó vẫn dùng).

**Sửa `routers/grading.py`:**
1. `_assess_pronunciation_safe` (dòng 261): khi cờ bật, thay nhánh `if part == 2 and duration_sec >= 25` (dòng 291–304) bằng `sample_window(duration_sec, settings.PRON_SAMPLE_SECONDS)` cho **mọi** Part; giữ nguyên cách gọi `extract_audio_segment` qua `asyncio.to_thread`, kiểm "trả về cùng đối tượng thì không đổi nhãn WAV", và nhánh lỗi cắt → gửi cả bản ghi (`scope='full'`). Hàm trả thêm mốc đã dùng: đổi kiểu trả thành `tuple[dict | None, PronSample]` với `PronSample(scope, start_s, end_s)`; mọi nơi gọi và mọi test hiện có cập nhật theo.
2. Trước khi tạo `pron_task` (dòng 848): nếu cờ bật và `part` thuộc `PRON_ONE_PER_SESSION_PARTS`, quyết định có lấy mẫu câu này không bằng hàm mới `_should_sample_pronunciation(session_id, question_id, duration_sec)`: trả False khi phiên đã có một câu **khác** với `pronunciation_status='completed'` (đọc `responses` của phiên qua `asyncio.to_thread`); trả False khi `duration_sec < PRON_ONE_PER_SESSION_MIN_SECONDS` và đây chưa phải lần nộp lại của câu đã được lấy mẫu; còn lại True. Lỗi đọc → True (thà chấm thừa một câu còn hơn mất điểm phát âm). Không lấy mẫu → không tạo `pron_task`, `scope='not_sampled'`.
3. `_merge_pronunciation_into_grading` (dòng 361): thêm tham số `sample: PronSample`. `not_sampled` ở chế độ test: `band_p = None`, `pronunciation_source = 'not_sampled'`, `p_feedback` = câu mới `_PRON_NOT_SAMPLED_FEEDBACK` ("Phát âm của phần này được chấm trên một câu trả lời khác trong cùng phiên."), **không** dùng `_PRON_UNAVAILABLE_FEEDBACK`; `overall_band` của câu đó tính từ ba tiêu chí còn lại như nhánh hiện có. Khối trả về thêm `"sample": {"scope", "start_s", "end_s"}`; payload dòng 989 trả `{"status": "not_sampled", "provider": "azure", "sample": {...}}` cho câu không lấy mẫu.
4. Ghi DB (dòng 1066–1079): luôn ghi ba cột `pronunciation_sample_*` khi cờ bật (kể cả `not_sampled`); các cột này không thuộc `_CORE_COLUMNS`.
5. Band phiên: `routers/sessions.py` dòng 147–162 đã chỉ lấy trung bình các câu có `final_band_p`, nên phiên Part 1 nhận band P từ đúng câu được lấy mẫu; không sửa hàm này. Phiên không có câu nào đủ dài → không có band P cho phiên (hiện "chưa đánh giá"), là giới hạn đã biết (Q6).
6. `audio_seconds` ghi qua `services/ai_usage_logger.py` đã là độ dài đoạn gửi (`assessment_duration`); giữ nguyên để báo cáo chi phí phản ánh đúng.

Hợp đồng cho G07 (phiếu Speaking): trường `pronunciation.sample` như trên trong payload chấm và trong API đọc lại câu trả lời; G07 hiện "Phát âm được chấm trên một đoạn trích N giây (từ m:ss đến m:ss); ba tiêu chí còn lại chấm trên toàn bộ bài." và nút "Nghe đoạn được chấm phát âm" phát bản ghi gốc từ `start_s` tới `end_s`. `scope='full'` → "Phát âm được chấm trên toàn bộ câu trả lời."

### 5.17 ĐÃ BỎ — Ghi nhận đồng ý dùng bản ghi âm đã ẩn danh (migration 386)

ĐÃ BỎ — hoãn theo quyết định 18/11/2026; nếu làm lại sau thì phải là lựa chọn tự bật, có rà pháp lý. Không có bảng `learner_consent_events`, không có `services/consents.py`, không có route `/api/me/consents/audio-improvement`, không có env `AUDIO_CONSENT_COPY_VERSION`, không có khối `consents` trong `GET /admin/users/{user_id}/access`. Số migration 386 để trống. Giữ nguyên: bản ghi âm giữ tối đa 60 ngày rồi xoá (5.14).

### 5.18 Chuyển lớp đang chạy bằng mã cũ sang đo lượt (migration 388, G04-T15)

Quyết định 18/11 chiều (00 mục 2 điểm 23): lớp đang chạy bằng mã cũ **CÓ** chuyển sang đo lượt. Mã cũ không có `product_id` nên thành viên không có dòng `entitlements`, không có nơi nhận lượt. Bước chuyển đổi cấp cho từng thành viên một quyền lớp kèm số lượt ban đầu; từ đó `charge_plan` nhánh 4 (5.4) tự đo bài giao của lớp đó. Không sửa mã cũ, không sửa `fn_activation_serialize`, không backfill tự động.

**Mặc định tạm (Q4):** admin nhập số lượt cho **từng lớp** khi bấm chuyển (`credits_per_member`); `LEGACY_CLASS_INITIAL_CREDITS` chỉ là số điền sẵn, mặc định rỗng → admin phải nhập. Lớp **chưa được chuyển** thì thành viên dùng mã cũ **chưa bị đo, không bị chặn** cho tới khi admin chuyển — không có hạn chót tự động. Trang Việc cần làm và trang Lớp của G09 liệt kê lớp chưa chuyển bằng `GET /admin/credits/convert-class/pending`. Giáo viên của lớp không được cấp lượt (không phải thành viên học; Q5 giữ nguyên).

**Migration 388** `backend/migrations/388_class_credit_conversion.sql` (phụ thuộc 381, 382; nhóm forward-policy `course_commerce`; cùng quy ước 5.2). Giá trị `class_conversion` của `entitlements.source` đã nằm trong CHECK của 381. Một hàm:

**`fn_credit_convert_class(p_admin_id uuid, p_cohort_id uuid, p_product_id uuid, p_credits_per_member int, p_request_key uuid) → jsonb`** — `SECURITY DEFINER`, chỉ `service_role`. Kết quả `status` ∈ `converted` (+`converted:[{user_id, entitlement_id, expires_at, balance}]`, `skipped:[{user_id, reason}]`), `replay` (cùng hình, `converted` rỗng), `cohort_not_found`, `cohort_archived`, `cohort_has_no_course`, `product_invalid`. Trong một giao dịch:
1. `SELECT … FOR UPDATE` dòng `cohorts`. Không có → `cohort_not_found`; `archived_at IS NOT NULL` → `cohort_archived`; `course_id IS NULL` → `cohort_has_no_course`.
2. Sản phẩm `p_product_id` phải có `kind='class'`, `course_id` = khoá của lớp, `archived_at IS NULL` → sai thì `product_invalid`. (Backend chọn sản phẩm trước khi gọi — xem dưới.)
3. `p_credits_per_member` 0..100000 (0 được phép: có quyền, chưa có lượt, sau đó "Cấp thêm lượt").
4. Với mỗi dòng `student_cohort_memberships` `is_active` của lớp, nối `students`:
   - `students.user_id IS NULL` (học viên chưa có tài khoản) → `skipped` với `no_account`;
   - người đó đã có dòng `entitlements` còn dùng được lượt (định nghĩa 5.3) với sản phẩm `kind IN ('class','repractice')` cùng `course_id` → `skipped` với `already_metered`;
   - còn lại: khoá tư vấn theo người (như `fn_credit_reserve`); tính hạn `v_expires` = **hạn của mã cũ gắn lớp này mà người đó đang dùng**: trong các mã `access_codes` có `cohort_id = p_cohort_id`, `product_id IS NULL`, còn sống (`NOT is_revoked AND is_active`, chưa quá `expires_at`) mà người đó giữ qua `used_by` hoặc qua `user_code_assignments` đang `is_active` — có mã không hạn (`expires_at IS NULL`) → NULL; ngược lại lấy `expires_at` lớn nhất; người không giữ mã nào của lớp (được admin thêm thẳng vào lớp) → NULL (quyền không hạn, theo tư cách thành viên lớp). INSERT `entitlements(user_id, product_id, course_id, source='class_conversion', source_ref=p_cohort_id, starts_at=now(), expires_at=v_expires, granted_by=p_admin_id, reason='class_conversion')` `ON CONFLICT (source, source_ref, user_id) DO NOTHING`; **chỉ khi vừa chèn** và `p_credits_per_member > 0`: INSERT `credit_ledger(reason='grant', delta=p_credits_per_member, idempotency_key='convert:'||p_cohort_id||':'||user_id||':grant', actor_id=p_admin_id)` `ON CONFLICT DO NOTHING`; ghi `entitlement_events(action='grant', actor_kind='admin', after={request_key, cohort_id, credits})`. Dòng `ON CONFLICT` không chèn (người đã từng được chuyển ở lớp này, quyền đó nay hết hạn hoặc đã thu hồi) → `skipped` với `already_metered`; cấp lại cho người này là việc của `POST /admin/entitlements`.
5. Không ai được chèn và đã có `entitlement_events` mang cùng `request_key` → `status='replay'`; ngược lại `converted`.

Không đổi `access_codes`, `user_code_assignments`, `student_cohort_memberships`. Mã cũ của thành viên vẫn sống và vẫn cho quyền tự luyện như trước (không đo — `charge_plan` nhánh 5; Q4). Quyền tạo ra có `review_mode` NULL: bài Writing của lớp vẫn đi luồng giáo viên duyệt như hôm nay.

**Idempotency:** khoá tự nhiên là `UNIQUE (source, source_ref, user_id)` của `entitlements` + `idempotency_key` của sổ — một người chỉ được cấp một lần cho một lớp, dù admin bấm lại, dù hai admin bấm cùng lúc (khoá dòng `cohorts` xếp hàng hai lời gọi), dù dùng `request_key` khác. Gọi lại sau khi lớp có thành viên mới → chỉ thành viên mới được cấp (với `credits_per_member` của lần gọi đó).

**Backend `services/credits.py`:**
- `convert_class_preview(cohort_id) -> dict`: dựng phản hồi của `GET /admin/credits/convert-class/preview` (5.9) bằng truy vấn chỉ đọc, cùng điều kiện phân loại ở bước 4 (`to_convert`, `already_metered`, `no_account`) và cùng cách tính hạn; `products` = mọi sản phẩm `class` chưa lưu trữ của khoá; `product` = sản phẩm duy nhất nếu chỉ có một, ngược lại null.
- `convert_class(admin_id, cohort_id, credits_per_member, request_key, product_id=None)`: chọn sản phẩm — không có sản phẩm `class` nào cho khoá → 409 `no_class_product` (admin tạo sản phẩm ở trang Khoá học trước); có nhiều mà không gửi `product_id` → 409 `product_ambiguous`; rồi gọi RPC. RPC lỗi → 503, không có trạng thái dở (một giao dịch).
- `list_classes_pending_conversion() -> list`: cho `GET /admin/credits/convert-class/pending` — lớp chưa lưu trữ, có `course_id`, có ít nhất một thành viên ở trạng thái `to_convert`. Lớp mở mới bằng mã có sản phẩm không bao giờ xuất hiện (thành viên đã có quyền từ mã).

**Sau khi chuyển:** bài giao của lớp trừ vào lượt vừa cấp; hết lượt → 402 `credit_source='class'`, lối ra "Liên hệ giáo viên để được cấp thêm"; `POST /admin/credits/grant-extra` cho cả lớp nay cấp được cho những người này (trước đó họ nằm ở `skipped`). `GET /api/me/courses` trả khoá của lớp với `source='class_conversion'`, `kind='class'` — `services/entitlements.py::list_access` phải bỏ dòng suy ra `class_membership` cùng khoá khi người đó đã có dòng `entitlements` cho khoá ấy, để không hiện hai dòng.

**Quay lui một lớp chuyển nhầm:** thu hồi từng quyền bằng `POST /admin/entitlements/{id}/revoke`; người bị thu hồi quay về nhánh `legacy_class` (không đo). Không có lệnh "huỷ chuyển" cả lớp.

## Rollout and rollback

Xem `rollout.md`. Tóm tắt: thứ tự áp 381 → 382 → 383 → 388, 384 → 387, 385 trên staging trước dưới khoá
advisory; mọi cờ mặc định tắt; quay lui bằng tắt cờ (≤15 s) rồi deploy lại backend, migration giữ nguyên
(tương thích ngược với mã đang chạy).

## Verification strategy

Bằng chứng theo kịch bản E1–E21 (spec, mục Acceptance scenarios) và bảng `verification.md`. Lệnh:
`cd backend && python -m pytest tests/ -q`; test PG17 cho từng migration
(`REQUIRE_PG=1 TEST_PG_URL=… python -m pytest tests/test_migration_38*_*.py`); bất biến client
`tests/test_client_write_invariant_postgres.py`; kiểm RLS live (E11) trên staging bằng JWT học viên thử. Test gọi
Resend, GoTrue, Azure, grader luôn là bản giả; không gọi AI trả phí. Test `livenet` tự skip khi thiếu credential và
phải ghi là "skip", không tính là pass.
