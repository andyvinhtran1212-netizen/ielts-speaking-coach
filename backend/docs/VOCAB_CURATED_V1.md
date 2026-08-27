# Vocab Curated V1 — vận hành, rollout và rollback

## Ranh giới sản phẩm

`vocab_cards` và `/vocabulary` tiếp tục là Reference Wiki rộng. Vocab Curated
không cạnh tranh với từ điển truyền thống: nó tuyển chọn một số learning unit có
identity rõ ràng theo:

`sense + construction + communicative function + context`.

Mỗi unit phải giúp học viên Việt Nam B1–B2 chuyển từ “biết nghĩa” sang “dùng
được khi nói”, qua ba construct độc lập:

1. `meaning_recall`
2. `usage_control`
3. `productive_transfer`

Không hiển thị điểm mastery 0–100. UI dùng trạng thái có ý nghĩa sư phạm:
`not_started → acquiring → controlled → transfer_ready → retained`, và
`needs_refresh` khi đã đến lịch ôn hoặc vừa dùng sai một cấu trúc từng làm được.
Recall/control chỉ lên `controlled` sau ít nhất ba lần đúng và accuracy ≥75%;
productive transfer cần ít nhất hai lần đúng và accuracy ≥67%, giảm khả năng
mastery tăng chỉ nhờ đoán lựa chọn.

## Thành phần đã triển khai

- Migration 234: unit identity, immutable version, card mapping, ba loại review,
  pathway và KP type `vocab_unit`.
- Migration 235: private task answer key, attempt UUID idempotency, server-side
  persistence RPC, advisory lock chống lost update và mastery ba chiều.
- Migration 236: canonical recommendation records và bốn runtime switch mặc
  định `false`.
- Migration 237: catalog signal Speaking riêng tư và RPC transaction để xác
  minh ownership, mapping active, unit published trước khi recommendation trở
  thành canonical.
- Migration 238: lifecycle `opened/completed` cho recommendation, cohort audit
  transaction và aggregate pilot ẩn danh cho immediate/7-day/28-day outcome.
- Public API: published units và pathways; answer key không có trong response.
- Learner API: Today queue, mastery và server-graded attempt.
- Today giữ tổng queue tối đa năm unit, xoay Discover ổn định theo user/ngày và
  loại unit đã retained đủ ba dimension. Mastery endpoint phân trang tối đa 100
  unit/lượt; `page_counts` chỉ mô tả đúng trang hiện tại.
- V1 chủ đích đọc toàn catalog để xoay Discover ổn định (12 unit pilot, tối đa
  60 unit theo rollout này). Trước khi vượt 200 published unit, chuyển sampling
  xuống database/RPC và benchmark p95 thay vì tiếp tục full-scan mỗi request.
- Task payload trước attempt chỉ có prompt/options; editorial explanation và model
  answer chỉ được trả sau khi server chấm và lưu kết quả idempotent.
- Admin API: tạo unit/version, validate, review ba cửa, publish và rollback.
- Frontend: entry card có cohort gate, Today/Paths và lesson loop tại
  `/vocabulary/learn`.
- Pilot: 12 units, 48 task, 3 pathway cho lỗi/cấu trúc trọng điểm của học viên
  Việt Nam. `scripts.seed_vocab_curated` kiểm định tất cả model answer và rule
  Speaking offline.
- Speaking practice: grader chỉ trả evidence chung gồm câu gốc, câu sửa,
  loại lỗi và confidence. Catalog signal, regex pair và unit identity không
  được gửi cho provider. Server chỉ nhận match khi transcript có đúng evidence,
  confidence `high`, đúng một rule biên tập match và target vẫn là published
  version; mơ hồ hoặc lỗi hạ tầng đều trả rỗng, không làm hỏng kết quả chấm.
- Pilot chỉ kích hoạt các rule có bằng chứng cấu trúc độc lập (preposition và
  verb frame). Năm clinic ngữ nghĩa hai chiều vẫn được seed `inactive` để biên
  tập/corpus audit, không được recommendation runtime dùng chỉ dựa trên nhận
  định `confidence` của model.
- Recommendation xuất hiện ngay trong feedback Speaking, được giữ trong
  persisted feedback để `/result` render lại, và vào Today queue từ bảng
  `vocab_unit_recommendations` chỉ khi recommendation flag, read switch và
  cohort `users.feature_flags.vocab_curated_enabled` cùng bật. Vì vậy mọi link
  được tạo đều trỏ tới một lesson mà chính học viên đó có quyền mở.

## Publish gate

Một version chỉ publish khi đồng thời đạt:

- đủ các trường chuyên môn và tối thiểu ba ví dụ ở ngữ cảnh khác nhau;
- có ít nhất một nguồn biên tập có `title` và `url`;
- có ít nhất bốn task active, phủ đủ ba mastery dimension;
- mỗi task tự chấm đúng model answer bằng production grader; construction task
  dùng ordered frame để không chấp nhận câu chỉ gom đủ keyword;
- có approval `language`, `pedagogy`, `assessment` và không còn
  `changes_requested`;
- DB RPC xác minh lại review/task/current identity trong transaction.

Published version không được sửa tại chỗ. Mọi thay đổi tạo version mới. Rollback
chỉ đổi `current_published_version_id` về một published version cũ.
Version identity băm toàn bộ `{content, sources, tasks}`; thay nguồn hoặc task
vẫn luôn tạo artifact mới dù phần bài viết không đổi.

## Trình tự deploy

1. Backup/đo schema và áp dụng migrations `234`, `235`, `236`, `237`, `238` theo thứ tự.
2. Chạy lại năm migration để kiểm tra idempotency.
3. QA nội dung offline:

   ```bash
   cd backend
   python -m scripts.seed_vocab_curated
   ```

4. Seed draft bằng một admin UUID thật:

   ```bash
   python -m scripts.seed_vocab_curated --apply --admin-id <ADMIN_UUID>
   ```

5. Ba reviewer khác nhau duyệt language/pedagogy/assessment. Có thể dùng Admin
   API, hoặc publish pilot bằng script với ba UUID reviewer khác nhau:

   ```bash
   python -m scripts.seed_vocab_curated --apply --publish \
     --admin-id <ADMIN_UUID> \
     --language-reviewer <LANGUAGE_REVIEWER_UUID> \
     --pedagogy-reviewer <PEDAGOGY_REVIEWER_UUID> \
     --assessment-reviewer <ASSESSMENT_REVIEWER_UUID>
   ```

6. Bật `users.feature_flags.vocab_curated_enabled=true` chỉ cho staff/pilot.
7. Bật runtime flags theo thứ tự:
   - `vocab_units_read`
   - `vocab_unit_attempts_write`
   - `vocab_unit_recommendations` chỉ sau khi seed signal catalog, chạy probe
     đúng/sai/mơ hồ và audit false positive trên feedback thật
   - giữ `vocab_ai_scoring=false`; deterministic grader là canonical V1.

Runtime flags chỉnh qua `PATCH /admin/runtime-flags/{key}` và có hiệu lực trong
tối đa 15 giây.

## Rollout gate

Không scale theo số lượng bài đã viết. Scale khi dữ liệu học đạt gate:

| Wave | Đối tượng | Điều kiện lên wave |
|---|---|---|
| Staff | giáo viên + content editor | không leak answer key; publish/rollback và replay attempt đúng |
| Pilot | 10–20 học viên B1–B2 | ≥70% hoàn tất unit bắt đầu; lỗi kỹ thuật <2%; không có false-positive grading nghiêm trọng |
| 10% | cohort có feedback thật | improvement ở delayed check 7 ngày và ≥30% productive transfer thành công |
| 25–50% | cohort mở rộng | retention 28 ngày không giảm, support burden chấp nhận được |
| 100% | toàn bộ học viên phù hợp | metric học tốt hơn Reference-only baseline, content QA SLA ổn định |

Metric canonical lấy từ `vocab_unit_attempts`, task/version và lifecycle
`vocab_unit_recommendations`; client analytics không quyết định mastery hoặc
recommendation completion. Dashboard `/admin/vocab/pilot-metrics` dùng các định
nghĩa cố định:

- immediate: 0–24 giờ từ attempt đầu tiên của learner/unit; chỉ unit-start đã
  đủ 24 giờ mới vào mẫu số completion;
- day 7: attempts từ ngày 6 đến trước ngày 10; chỉ unit-start đã đi hết 10 ngày
  mới vào mẫu số follow-up;
- day 28: attempts từ ngày 25 đến trước ngày 35; chỉ unit-start đã đi hết 35
  ngày mới vào mẫu số follow-up;
- accuracy và productive transfer để `null` khi chưa có attempt, không chuyển
  thiếu dữ liệu thành `0%`;
- dưới 10 unit-start đủ hạn chỉ được đọc như tín hiệu sớm, không dùng để quyết
  định scale rollout.

Recommendation chuyển `pending → opened` bằng endpoint có kiểm tra owner và
đúng unit slug. Trigger sau attempt chuyển `pending/opened → completed` trong
cùng transaction khi learner đã thử đủ task active của đúng version. Trạng thái
terminal không bị request mở lại làm lùi. `opened_at` chỉ ghi khi learner đi từ
recommendation; hoàn tất unit qua Discover/Path vẫn có `completed_at` nhưng
không giả lập một lượt mở recommendation.
Hai trigger completion dùng cùng transaction advisory lock theo learner + unit,
tránh bỏ sót terminal state khi các attempt cuối hoặc recommendation insert chạy
đồng thời.

## Rollback

1. Tắt `vocab_unit_attempts_write` nếu mutation có vấn đề.
2. Tắt `vocab_units_read`; hub tự quay về các công cụ Vocabulary cũ vì card mới
   mặc định không render.
3. Nếu chỉ một content version lỗi, gọi
   `POST /admin/vocabulary/units/{unit_id}/rollback` với published version cũ.
4. Không down-migrate hoặc xóa attempt/mastery khi rollback UI.

## Các pha tiếp theo

- Mở từ 12 lên 24–30 unit sau pilot; chỉ lên 60 khi gate delayed transfer đạt.
- Context lookup trong nội dung học có thể link sang curated unit khi match chắc
  chắn; không triển khai double-click toàn site trong V1.
