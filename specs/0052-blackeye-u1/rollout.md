# Rollout and rollback

## Preconditions

- Spec BLACKEYE-0052 merge vào `staging` ở trạng thái `approved`.
- PR1 dựng lại theo Q-5; CI xanh; web-reviewer, web-security (AC01) và Security Auditor đạt trên đúng head.
- Migration admission có số do Release Manager cấp và được anh Vinh duyệt chạy (Q-12). Không có thì start Black Eye trả 503.
- Trước PR2 (T005): anh Vinh trả lời CV-1 (ai cấp/thu quyền FR-027); migration danh sách cấp quyền có số do Release Manager cấp, Security Auditor review, anh Vinh duyệt chạy; Security Auditor xác nhận C3 (SA-2280-R2). Chưa có thì danh sách rỗng, mặc định từ chối, chỉ người tạo bài giao có quyền.
- `DICTATION_LEXICAL_V2_ENABLED` giữ `False`. Không có dữ liệu Black Eye published trên staging hay prod.

Không áp migration 376, không seed/import Black Eye trên bất kỳ môi trường nào trước khi FU-2281-NAMESPACE (M-A/M-B) hoàn tất, migration 347 đã áp, ma trận/inventory qua kiểm và SA ký. 376 tiếp tục pending_feature; merge không tự áp. Mọi apply/import cần quyết định riêng theo workflow, không được suy ra từ merge.

Importer fail closed trước mọi ghi DB/Storage và mọi RPC import 295: package/test programme Black Eye, hoặc metadata có khóa blackeye trên bất kỳ package/form/content sinh ra, chỉ đi qua khi RESTRICTED_NAMESPACE_READY bật VÀ catalog xác nhận M-A qua fn_content_namespace_ready(). Cờ mặc định false; thiếu hàm (PGRST202/42883), catalog false hoặc mọi lookup/transport error đều 503 + private, no-store, không ghi. Dry-run trả cùng lỗi với commit. Cờ không tự bật từ catalog; cờ bật một mình cũng không cho qua. RPC này do M-A cung cấp ở follow-up; #2281 không tạo RPC/schema/view mới.

## Staging

- Thứ tự: migration đã duyệt (runner có khóa) → deploy code phụ thuộc → QA đúng SHA.
- Chỉ lớp giả và tài khoản giả (FR-024); không thông báo thật; ghi staging cần quyết định riêng.
- Mỗi merge vào `staging` cần anh Vinh duyệt đúng PR và SHA.

## Production

- Promote `staging` → `main` cần quyết định riêng.
- Giao bài cho học viên thật course 2 là bước release riêng (T014, FR-025): anh Vinh duyệt đúng SHA, migration, revision nội dung, danh sách audio. Merge PR1/PR2 không bật việc này.
- Security Auditor ký phiếu cho đúng bản release (T014).
- Đọc lại sau release theo 5 hậu kiểm của T014: danh sách quyền course 2 đúng; admin toàn cục không được gán không thấy dữ liệu Black Eye; payload học viên không có `answer_set_revision`/đáp án trước nộp (tài khoản giả/canary, không đọc dữ liệu học viên thật); log/`error_logs`/Sentry không có câu trả lời hay PII; bước tắt đã thử trên staging.

## Rollback and repair

- Code: revert PR; nhánh Black Eye fail closed, shape chung không đổi nên an toàn.
- Dữ liệu: không xóa, không chấm lại bài đã nộp; ẩn bằng cách bỏ publish gói hoặc đóng bài giao.
- Migration: forward-only; sửa bằng migration mới đã review.

## Observability

- Theo dõi 503 "Black Eye frozen contract unavailable" và 422/409 theo route, kèm request id; không đưa câu trả lời, đáp án, transcript hay PII vào log, `error_logs`, Sentry hay URL (FR-026).
- Ngưỡng: 503 Black Eye > 1% request trong 1 giờ khi đã bật cho học viên → Release Manager báo Leader.
- Owner: Release Manager (sau release), web-qa (staging).
