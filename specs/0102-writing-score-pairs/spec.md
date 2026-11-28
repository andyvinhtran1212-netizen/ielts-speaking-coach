---
id: SCOREPAIR-0102
title: Every Writing essay a teacher returns keeps an immutable record of the original AI bands and the bands the teacher released
status: approved
risk: high
owner: product
---

# Mỗi bài Writing giáo viên trả có bản ghi bất biến gồm điểm AI gốc và điểm giáo viên chốt

Status: **approved**. Soạn ngày 23/11/2026 theo nhiệm vụ G12-C01 của
`docs/proposals/commercialization-2026-11/GOI-12-huong-phat-trien.md` (phần C,
mục 2.2, 4 và 5.C). Anh Andy đã đưa G12-C01…C03 vào đợt D, làm cùng G09-T17
(`00-QUY-UOC-CHUNG.md` điểm 24, 18/11). Số spec 0102 được cấp lại ngày 23/11 vì
0088 đã thuộc WRITINGGPT-0088 (sổ ở `01-KE-HOACH-TONG.md` mục 6). Chưa dòng mã
nào chạy theo spec này. Andy đã duyệt ngày 28/11/2026. [Quyết định duyệt](approval-decision.md). Bản thực thi gồm hai PR `high-risk` riêng (migration 480, rồi
backend), mở sau khi spec đã được duyệt trên `staging`.

Spec liên quan, không sửa: [WRITINGBAND-0050](../0050-writing-band-save-consistency/spec.md)
(cách lưu và tính overall của band Writing). Phần sau của phần C (công bố độ lệch,
SCOREGAP-0091) là spec khác, chưa viết.

FR trong GOI-12 đánh số `FR-12-C-001…006`; ở đây đánh lại `FR-001…006` giữ
nguyên thứ tự. FR-007 và FR-008 tách từ mục 5.C của gói (cờ và đối soát) để
kiểm được riêng. FR-009…FR-012 thêm ngày 23/11 theo HOLD của anh Andy và CR-2483-R1
(trigger lỗi không được làm hỏng việc chấm, công tắc tắt trigger, đường ẩn danh
người trả).

## Problem

Hôm nay không ai trả lời được câu "AI chấm lệch giáo viên bao nhiêu" từ dữ liệu
thật, vì hệ thống không lưu điểm AI gốc một cách chắc chắn và không lưu điểm
giáo viên chốt tại thời điểm trả bài. Đã kiểm trên `staging` @ `cc6dd4c8`
(23/11/2026):

1. **Điểm AI gốc hiện còn trong đa số ca nhưng không được bảo đảm.** Mỗi lần AI
   chấm là một dòng `writing_feedback` (`source='ai_pro'`, mig 033 + 109); admin
   sửa điểm thì `essay_service.upsert_composed_version` chèn dòng `composed` mới
   chứ không ghi đè dòng AI. Nhưng có năm đường làm mất hoặc đổi điểm AI gốc:
   - (a) không có trigger nào chặn UPDATE hay DELETE trên dòng AI;
   - (b) `instructor_workflow.deliver` bước (3) đổi `prompt_version` của dòng
     đang hiện thành `<gốc>-instructor`; khi không ai sửa, đó là chính dòng AI;
   - (c) `essay_service._gc_orphan_versions` xoá mọi dòng ngoài chuỗi tổ tiên
     của `current_version` trước khi chèn bản mới;
   - (d) `_bg_grade_essay` chạy lại cùng `job_id` thì gọi AI lần nữa và UPDATE
     band của chính dòng đó (`essay_service.py`, nhánh `if existing:`);
   - (e) dòng phản hồi trước mig 109 (`source` NULL) đã đi qua đường
     DELETE→INSERT cũ, nên có thể không còn bản AI đầu.
2. **Điểm giáo viên chốt không được lưu riêng.** "Điểm giáo viên" hôm nay là band
   của bản đang hiện lúc trả. Bản `composed` được UPDATE tại chỗ, kể cả sau khi
   thu hồi rồi trả lại, nên không có ảnh chụp lúc trả. `instructor_reviews`
   (mig 047) và `deliver` không ghi điểm.
3. **Giáo viên vai trò instructor không tự đặt được band.**
   `PATCH /instructor/essays/{id}/feedback` luôn trả 403. Giáo viên chỉ giữ
   nguyên, cho AI chấm lại, hoặc ghép từng tiêu chí từ các bản AI
   (`compose_version`). Vì vậy chỉ cặp do tài khoản admin trả mới phản ánh điểm
   người chấm. Đo độ lệch phải biết ai trả và người đó có quyền sửa band không.
4. **Cặp điểm của thi thử không dùng được.** `mock_exam_reviews.ai_draft.writing`
   bị `mock_review_workflow.sync_writing_band_for_essay` ghi lại sau khi admin
   sửa, và chỉ có band kỹ năng, không có bốn tiêu chí.

## Scope

- Chụp điểm AI vào bảng chỉ ghi thêm ngay khi dòng AI được chèn, và mỗi lần band
  của dòng AI đổi.
- Ghi một bản ghi cặp điểm bất biến mỗi lần bài Writing được trả qua tầng duyệt
  (`instructor_workflow.deliver`, gồm cả admin trả qua
  `/admin/instructor/reviews/{id}/deliver`) hoặc qua đường admin
  (`admin_writing._deliver_essay`: `mark-delivered` và `bulk-mark-delivered`).
- Dựng lại cặp cho bài đã trả trước khi bật, đánh dấu `reconstructed`.
- Đối soát hằng đêm ghi bù cặp bị sót.
- Toàn bộ chạy nền sau cờ `writing_score_pairs_record` (tắt mặc định).

## Non-goals

- Mọi giao diện: không trang, thẻ hay dòng nào mới cho học viên, giáo viên hay
  admin. Đọc cặp điểm chỉ bằng truy vấn và báo cáo của script.
- Tổng hợp, so sánh hay công bố độ lệch (SCOREGAP-0091, G12-C04…C08).
- Bài thi thử (`writing_essays.sitting_id` không NULL), trả qua
  `essay_service.deliver_reviewed_essay` khi công bố kỳ thi (GOI-12 mục 10 câu C5).
- Bài trả tức thì không qua người (`review_mode='ai_instant'`, RPC
  `fn_deliver_writing_essay_instant` của mig 384) và bài bị gắn cờ tạo thẳng ở
  trạng thái `delivered` mà không có phản hồi: không có điểm người chấm nên
  không có cặp.
- Mở quyền sửa band cho giáo viên instructor (GOI-12 câu C9, quyết cùng G09-T17).
- Đổi thứ tự, nội dung hay kết quả của bất kỳ bước trả bài nào; đổi cách đóng
  dấu `prompt_version`; sửa `mock_review_workflow`.
- Thêm cột vào `writing_essays`, `instructor_reviews`, `writing_feedback`.

## Users and journeys

- Giáo viên hoặc admin trả bài như hôm nay. Không thấy gì khác; việc trả bài
  không bao giờ thất bại vì bản ghi cặp điểm.
- Anh Andy (người vận hành) chạy `writing_score_pairs_reconcile --report` để biết
  số cặp theo tháng, theo vai trò người trả, và số bài bỏ qua kèm lý do.
- Chặng sau (SCOREGAP-0091) đọc hai bảng này để tính độ lệch; spec này chỉ bảo
  đảm dữ liệu đúng và đủ.

## Requirements

- **FR-001:** Mỗi dòng `writing_feedback` có `source` bắt đầu bằng `ai_` được
  chụp vào bảng chỉ ghi thêm `writing_ai_score_snapshots` ngay khi chèn, và chụp
  thêm mỗi lần một trong năm cột band của dòng đó đổi giá trị (đường (d)). Ảnh
  chụp giữ năm band, `prompt_version` đã bỏ hậu tố (`-instructor-pending`,
  `-instructor`, `-composed`), `model_used`, `task_type`, `source`. `source` chép
  nguyên giá trị của dòng phản hồi và **không** có CHECK liệt kê giá trị: nguồn AI mới
  (ví dụ đường GPT của WRITINGGPT-0088) vẫn được chụp nhờ điều kiện `LIKE 'ai\_%'`,
  không làm lỗi lần ghi điểm. Chụp bằng trigger
  database để mọi đường chấm, kể cả đường thêm sau này, đều được ghi. UPDATE chỉ
  đổi `prompt_version` (đường (b)) không tạo ảnh chụp. Dòng `composed`,
  `partial` không được chụp.
- **FR-002:** Khi cờ bật, mỗi lần một bài chuyển sang `delivered` qua
  `instructor_workflow.deliver` hoặc `admin_writing._deliver_essay`, hệ thống ghi
  một dòng `writing_score_pairs` gồm: ảnh chụp AI đầu tiên của bài, ảnh chụp AI
  ngay trước khi người duyệt sửa (bản AI gần nhất trong chuỗi tổ tiên của bản
  đang hiện), band của bản đang hiện lúc trả, bản và nguồn đang hiện, người trả,
  vai trò người trả, `reviewer_can_edit_bands`, đường trả, ngữ cảnh bài (bài lớp,
  tự luyện), lớp, Task. Ảnh chụp được ghép theo `writing_feedback_id` của các
  dòng trong chuỗi, không theo số version (số version được dùng lại sau
  `_gc_orphan_versions`).
- **FR-003:** Hai bảng chỉ ghi thêm. UPDATE, DELETE trực tiếp và TRUNCATE bị từ
  chối với mọi vai trò kể cả `service_role`, lỗi `<tên bảng>_append_only`. Chỉ có
  hai ngoại lệ, mỗi ngoại lệ gắn với đúng dòng cha đang bị xoá, không với một cờ chung
  của giao dịch:
  - DELETE một dòng (ở bảng nào trong hai bảng) chỉ đi qua khi dòng cha của chính nó
    không còn: `NOT EXISTS (SELECT 1 FROM public.writing_essays WHERE id = OLD.essay_id)`. Hành
    động `ON DELETE CASCADE` chạy sau khi dòng bài đã bị xoá trong giao dịch, nên điều
    kiện này đúng khi và chỉ khi bài của dòng đó đang bị xoá cứng. Dòng mà bài còn tồn
    tại không xoá được bằng bất kỳ đường nào.
  - UPDATE ẩn danh người trả của FR-011.
  `pg_trigger_depth() > 1` chỉ được giữ như một điều kiện AND phòng thủ, không bao giờ
  đủ một mình; nếu test PG17 cho thấy nó không đúng trong hành động FK thì bỏ điều kiện
  này, kiểm dòng cha vẫn giữ. Không dùng biến phiên hay cờ giao dịch làm quyền.
  Hàm trigger là `SECURITY DEFINER` với `SET search_path = pg_catalog, public, pg_temp`,
  không cấp `EXECUTE` cho `PUBLIC`, và gọi bảng kèm schema (`public.writing_essays`,
  `public.users`), để kiểm dòng cha không phụ thuộc quyền hay `search_path` của vai trò
  gây ra lệnh xoá. Thu hồi rồi trả lại thêm dòng mới, dòng cũ giữ nguyên. Bản
  "mới nhất mỗi bài" là view `writing_score_pairs_latest`. Một lần trả chỉ có một
  dòng: `delivery_key` UNIQUE, gọi lại giống hệt trả `duplicate`.
- **FR-004:** Ghi cặp điểm không bao giờ làm hỏng hay đổi kết quả việc trả bài.
  Mọi lỗi bên trong được nuốt ở `record_delivery`, ghi log
  `[score-pair] failed essay=<id>` (không email, không tên), và để đối soát ghi bù.
- **FR-005:** Bài đã trả trước khi bật cờ được dựng lại từ chuỗi phiên bản (bản AI
  đầu trong chuỗi, bản đang hiện), đánh dấu `reconstructed=true`,
  `delivery_path='reconcile'`. Bài không dựng được (không còn ảnh chụp AI nào,
  không có phản hồi) bị bỏ qua và đếm theo lý do.
- **FR-006:** Không màn hình, response API hay thông báo nào của học viên, giáo
  viên, admin đổi.
- **FR-007:** Cờ `runtime_flags.writing_score_pairs_record` được seed `false`.
  Đọc bằng `runtime_flags.is_enabled(..., default=False, on_error=False)`: lỗi đọc
  cờ thì coi như tắt (không ghi), đối soát ghi bù sau. Trigger chụp điểm AI
  (FR-001) không phụ thuộc cờ này, vì nó chỉ thêm dòng và là thứ duy nhất giữ
  được điểm AI trước khi bị mất; nó có công tắc riêng ở FR-010.
- **FR-008:** Script `writing_score_pairs_reconcile` mặc định dry-run; chỉ ghi khi
  có `--execute`. Nó ghi bù ảnh chụp cho dòng AI còn trong `writing_feedback` mà
  chưa có ảnh chụp khớp band hiện tại (sót do FR-009 hoặc lúc công tắc FR-010 tắt;
  ảnh ghi bù có `captured_late=true`), ghi bù bài `delivered` (sau khi bật cờ) chưa có cặp, dựng lại
  bài trả trước khi bật cờ, bỏ qua bài thi thử, bài `ai_instant` và bài không có
  phản hồi. `--report` in số cặp theo tháng và theo `reviewer_role`, số bài bỏ qua
  theo lý do, số ảnh chụp ghi bù. Đầu ra không có email, tên học viên hay nội dung bài.
- **FR-009:** Trigger chụp điểm AI không bao giờ làm hỏng lần ghi điểm AI. Toàn bộ thân
  hàm trigger, gồm cả lần đọc cờ của FR-010 và INSERT ảnh chụp, nằm trong một khối bắt
  `WHEN OTHERS`, ghi `RAISE WARNING '[score-snapshot] failed feedback=%'`
  (chỉ id dòng phản hồi, không nội dung), trả `NEW`, nên INSERT/UPDATE trên
  `writing_feedback` vẫn thành công. Ảnh chụp sót được đối soát ghi bù (FR-008). Test
  PG17 ép trigger lỗi (lỗi INSERT và lỗi đọc cờ) và kiểm dòng phản hồi vẫn được ghi kèm
  WARNING. `WHEN OTHERS` không bắt `query_canceled` (statement_timeout, huỷ lệnh) và
  `assert_failure`; đó là chủ ý: một lệnh bị huỷ thì cả lần ghi bị huỷ, G12-C02 không cố
  bắt hai lỗi này.
- **FR-010:** Công tắc tắt trigger chụp: cờ `runtime_flags.writing_ai_snapshot_capture`
  seed `true`. Trigger đọc thẳng dòng cờ (không qua cache backend) mỗi lần chạy;
  `false` thì bỏ qua không chụp; thiếu dòng cờ thì coi như bật; lần đọc nằm trong khối
  bắt lỗi của FR-009, nên lỗi đọc cờ (đổi tên cột, mất quyền, hết thời gian chờ khoá) chỉ
  làm mất ảnh chụp của lần đó, không làm hỏng lần ghi điểm. Tắt cờ có hiệu lực ngay ở lần ghi kế tiếp, không cần migration, deploy hay
  xoá bảng. Dự phòng khẩn cấp (khi chính bảng `runtime_flags` lỗi):
  `ALTER TABLE writing_feedback DISABLE TRIGGER trg_writing_feedback_ai_snapshot`, chỉ
  chạy khi anh Andy gõ duyệt (xem `rollout.md`).
- **FR-011:** Xoá tài khoản người trả không bị chặn và không đổi điểm. `reviewer_id`
  có FK `users(id) ON DELETE SET NULL`. Trigger chỉ-ghi-thêm cho một UPDATE đi qua khi
  đủ các điều kiện: `OLD.reviewer_id` khác NULL và `NEW.reviewer_id` là NULL; người trả
  đó không còn: `NOT EXISTS (SELECT 1 FROM public.users WHERE id = OLD.reviewer_id)` (đúng khi
  và chỉ khi chính tài khoản đó đang bị xoá trong giao dịch); mọi cột khác của `NEW`
  giống hệt `OLD` (so cả dòng sau khi đặt `reviewer_id` của `OLD` về NULL); và điều kiện
  phòng thủ `pg_trigger_depth() > 1` như FR-003. `reviewer_role` và
  `reviewer_can_edit_bands` giữ nguyên. Mọi UPDATE trực tiếp khác, kể cả UPDATE trực
  tiếp chỉ đặt `reviewer_id = NULL`, vẫn lỗi `writing_score_pairs_append_only`. Test
  PG17: xoá người trả trong khi bài vẫn còn thì cặp còn, điểm không đổi, `reviewer_id`
  NULL; UPDATE trực tiếp vẫn bị chặn.
- **FR-012:** Ngoại lệ của FR-003 và FR-011 không mở cửa cho dòng khác trong cùng giao
  dịch. Test PG17, trong **cùng một giao dịch** với một lần xoá bài hợp lệ và một lần xoá
  người trả hợp lệ: DELETE hay UPDATE trên cặp hoặc ảnh chụp của **bài khác** (bài còn
  tồn tại, người trả còn tồn tại) vẫn lỗi `_append_only`, cả khi lệnh đó chạy từ bên trong
  một trigger khác (`pg_trigger_depth() > 1`). UPDATE đặt `reviewer_id = NULL` cho cặp
  của người trả còn tồn tại vẫn lỗi.

## Acceptance scenarios

### Scenario 1: giáo viên giữ nguyên điểm AI

- **Given** cờ bật, bài có một dòng AI version 1, giáo viên instructor đã nhận bài
- **When** giáo viên trả bài
- **Then** có đúng một dòng `writing_score_pairs` với band giáo viên bằng band
  ảnh chụp AI, `current_source='ai_pro'`, `reviewer_role='instructor'`,
  `reviewer_can_edit_bands=false`, `delivery_path='instructor_review'`; và dòng AI
  sau bước (3) có `prompt_version` đổi nhưng ảnh chụp vẫn giữ `prompt_version_base`
  gốc.

### Scenario 2: admin sửa một tiêu chí rồi trả

- **Given** cờ bật, bài có dòng AI version 1, admin sửa band Coherence qua
  `PATCH /admin/writing/essays/{id}/feedback` (tạo `composed` version 2)
- **When** admin bấm trả (`mark-delivered`)
- **Then** cặp có `reviewer_role='admin'`, `reviewer_can_edit_bands=true`,
  `delivery_path='admin_mark_delivered'`, và chỉ band Coherence khác ảnh chụp AI.

### Scenario 3: chấm lại rồi sửa

- **Given** bài có AI version 1, AI chấm lại thành version 2, admin sửa thành
  `composed` version 3
- **When** bài được trả
- **Then** `ai_first_snapshot_id` trỏ ảnh chụp của dòng version 1,
  `ai_before_edit_snapshot_id` trỏ ảnh chụp mới nhất của dòng version 2.

### Scenario 4: chạy lại cùng job đổi band

- **Given** dòng AI đã có một ảnh chụp
- **When** tác vụ chấm chạy lại cùng `job_id` và UPDATE band của dòng đó
- **Then** có thêm một ảnh chụp mới, ảnh cũ giữ nguyên; cặp ghi sau đó dùng ảnh
  mới nhất làm `ai_before_edit`.

### Scenario 5: ghi cặp lỗi

- **Given** cờ bật và insert vào `writing_score_pairs` ném lỗi
- **When** giáo viên trả bài
- **Then** API trả bài trả kết quả như hôm nay, bài ở `delivered`, log có
  `[score-pair] failed essay=<id>`, và lần đối soát kế tiếp ghi bù đúng một dòng bằng khóa của đường trả ban đầu. Gọi lại cùng lượt trả vẫn chỉ có một cặp.

### Scenario 6: thu hồi rồi trả lại

- **Given** bài đã có một cặp
- **When** bài bị thu hồi rồi trả lại
- **Then** có hai dòng, dòng đầu không đổi, view `writing_score_pairs_latest` trả
  dòng sau.

## Edge cases

- Gọi lại `deliver` giống hệt sau khi bước (1) đã ghi: `instructor_reviews.delivered_at`
  không đổi nên `delivery_key` trùng, kết quả `duplicate`, vẫn một dòng.
- Bulk mark-delivered: mỗi bài một lần gọi `record_delivery`; một bài lỗi không
  chặn bài khác.
- Số version được dùng lại sau `_gc_orphan_versions` (bản mới lấy `max(live)+1`):
  ghép ảnh chụp theo `writing_feedback_id`, nên không ghép nhầm sang dòng đã bị xoá.
- Dòng AI bị `_gc_orphan_versions` xoá: ảnh chụp vẫn còn (không có FK tới
  `writing_feedback`).
- Dòng `source` NULL (trước mig 109): nạp lại với `source='legacy'`,
  `legacy=true`; khi chọn `ai_first` thì ưu tiên ảnh chụp không `legacy`.
- Bài AI lỗi một phần (bốn tiêu chí NULL): ảnh chụp và cặp nhận NULL ở tiêu chí,
  `overall` bắt buộc.
- Không nối được bài với bài giao: `context='self_practice'`, `cohort_id` NULL;
  không đoán.
- Cờ đổi giữa chừng (cache 15 s của `runtime_flags`): bài trả trong lúc cache
  còn cũ được đối soát ghi bù.
- Xoá cứng bài hoặc xoá tài khoản kéo theo xoá bài: hai bảng xoá theo dây chuyền;
  FK từ cặp tới ảnh chụp là `NO ACTION` (kiểm cuối câu lệnh), nên xoá cùng lúc cả hai
  không lỗi.
- Người trả bị xoá trong khi bài còn: đường ẩn danh FR-011, cặp và điểm giữ nguyên.
- Trigger chụp lỗi hoặc công tắc FR-010 đang tắt: lần chấm vẫn ghi; đối soát ghi bù
  ảnh chụp cho dòng AI còn tồn tại. Dòng AI bị xoá hay đổi band trong lúc tắt thì
  mất bản trung gian đó; `--report` đếm số dòng ghi bù để biết khoảng hở.
- Bài thi thử, bài `ai_instant`, bài gắn cờ không có phản hồi: không ghi cặp,
  đối soát bỏ qua và đếm.

## Success criteria

- Sau khi áp migration và mỗi lần đối soát, đếm các dòng phản hồi AI còn tồn tại
  (kể cả dòng legacy có source NULL) thiếu ảnh chụp của chính writing_feedback_id
  khớp cả năm band hiện tại, so sánh NULL an toàn. Mục tiêu sau ghi bù là 0.
  Ảnh chụp của phản hồi đã bị thu gom vẫn được giữ và không tham gia mẫu số.
- Trên staging, sau khi bật cờ, mọi bài trả qua hai đường trong phạm vi có đúng
  một cặp cho mỗi lần trả (đối soát dry-run báo 0 bài cần ghi bù sau một ngày).
- Thời gian ghi cặp thêm vào request trả bài được đo trên staging và ghi vào
  verification. Đề xuất ngưỡng p95 ≤ 100 ms; anh Andy đã duyệt ngưỡng này ngày 27/11/2026 (quyết định 6).

## Open questions

**Quyết định ngày 27/11/2026.** Andy đã duyệt các mặc định ở mục 1, 2, 4, 5 và 6 dưới đây. Mục 3 đã chốt ngày 23/11. Quyết định này ghi nhận phạm vi nghiệp vụ, lịch đối soát dự kiến và ngưỡng nghiệm thu. Tạo cron hoặc triển khai vẫn cần duyệt riêng.

1. **Bài thi thử (GOI-12 câu C5).** Chưa đưa vào, tách sau khi có đủ số
   cặp bài lớp. Lý do: band thi thử theo kỹ năng, luồng công bố khác.
2. **Giáo viên instructor sửa band (câu C9).** Giữ quyền hiện tại trong spec này;
   cặp của instructor ghi `reviewer_can_edit_bands=false`. Nếu G09-T17 mở sửa
   band, đường đó phải đi qua `upsert_composed_version`, và hằng
   `INSTRUCTOR_CAN_EDIT_BANDS` đổi trong cùng PR đó.
3. **Ngoại lệ cho hành động FK (FR-003, FR-011).** Đã chốt (HOLD của anh Andy 23/11
   09:15Z, CR-2483-R2): ngoại lệ dựa vào việc dòng cha của chính dòng đó không còn
   (`writing_essays` cho DELETE, `users` cho UPDATE ẩn danh); `pg_trigger_depth() > 1`
   chỉ là điều kiện AND phòng thủ, bỏ được nếu test PG17 bác. Không dùng biến phiên hay
   cờ giao dịch. Câu này không còn mở.
4. **Cron đối soát.** Lịch đã chọn: 02:30 giờ VN hằng ngày qua
   `backend/railway.score-pairs-reconcile.json`; tạo service cron trên Railway là
   việc của anh Andy. Trước khi có cron, chạy tay `--report` mỗi tuần.
5. **Bài `ai_instant` (G04).** Không ghi cặp (không có người chấm). Nếu
   sau này cần đo AI với chính nó qua thời gian, đọc thẳng
   `writing_ai_score_snapshots`.
6. **Ngưỡng thời gian.** Ngưỡng đã chọn: p95 ghi cặp ≤ 100 ms trên staging. Vượt thì
   chuyển lời gọi `record_delivery` ra sau khi response đã trả (background task),
   không bỏ ghi.
