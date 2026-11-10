# Rollout and rollback

## Preconditions

- Spec BLACKEYE-0052 merge vào `staging` ở trạng thái `approved`.
- PR1 dựng lại theo Q-5; CI xanh; web-reviewer, web-security (AC01) và Security Auditor đạt trên đúng head.
- Migration admission có số do Release Manager cấp và được anh Vinh duyệt chạy (Q-12). Không có thì start Black Eye trả 503.
- `DICTATION_LEXICAL_V2_ENABLED` giữ `False`. Không có dữ liệu Black Eye published trên staging hay prod.

## Staging

- Thứ tự: migration đã duyệt (runner có khóa) → deploy code phụ thuộc → QA đúng SHA.
- Chỉ lớp giả và tài khoản giả (FR-024); không thông báo thật; ghi staging cần quyết định riêng.
- Mỗi merge vào `staging` cần anh Vinh duyệt đúng PR và SHA.

## Production

- Promote `staging` → `main` cần quyết định riêng.
- Giao bài cho học viên thật course 2 là bước release riêng (T014, FR-025): anh Vinh duyệt đúng SHA, migration, revision nội dung, danh sách audio. Merge PR1/PR2 không bật việc này.
- Đọc lại sau release: chỉ học viên course 2 nhận bài; không lỗi quyền.

## Rollback and repair

- Code: revert PR; nhánh Black Eye fail closed, shape chung không đổi nên an toàn.
- Dữ liệu: không xóa, không chấm lại bài đã nộp; ẩn bằng cách bỏ publish gói hoặc đóng bài giao.
- Migration: forward-only; sửa bằng migration mới đã review.

## Observability

- Theo dõi 503 "Black Eye frozen contract unavailable" và 422/409 theo route, kèm request id, không log câu trả lời hay PII.
- Ngưỡng: 503 Black Eye > 1% request trong 1 giờ khi đã bật cho học viên → Release Manager báo Leader.
- Owner: Release Manager (sau release), web-qa (staging).
