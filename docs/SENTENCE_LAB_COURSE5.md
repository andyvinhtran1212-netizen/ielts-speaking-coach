# Kho luyện viết câu 45 buổi — Course 5

Gói nội dung `IELTS_45_buoi_Kho_bai_tap_AI.zip` (45 buổi × 12 câu = 540 bài,
`content_version` 2026-11-18.1) chạy như một dạng bài tập giao được cho lớp
Course 5, dựng trên phần tự luận sẵn có của bài tập theo buổi (Course 1).

## Hình dạng dữ liệu

| Thứ | Ở đâu |
|-----|-------|
| Một buổi | `quiz_banks` `skill_area='course'`, `code='C5-SL-Sxx'`, `course_id`=C5, `lesson_no` NULL (bài bổ trợ, không chiếm ô buổi canonical) |
| Hướng dẫn buổi (mục tiêu, ghi nhớ, ví dụ làm mẫu, tự kiểm tra) | `quiz_banks.meta.sentence_lab.guide` — đường phát đề lọc bỏ; chỉ `GET /api/quiz/course/writing` trả, và với S01/S45 chỉ sau lượt nộp đầu |
| Một bài | `quiz_questions` `type='writing'`; đề công khai + **khóa chấm** ở `segments.sentence_lab` (cột không bao giờ rời máy chủ với bank Course) |
| Đáp án tham khảo | `quiz_questions.explain` + bản chụp `items[].explain`; chỉ trả cho học viên sau khi lượt viết lại đã chốt |
| Lượt nộp / chấm | `course_writing_submissions` (một lượt mỗi full attempt, như Course 1). `items[i].feedback` là phản hồi đầy đủ theo `feedback.schema.json` của gói; `items[i].revision` là lượt viết lại |

Không có migration.

## Luồng học viên

1. Viết 12 câu → nộp một lần. Bộ chấm `services/sentence_lab_grader.py` chấm
   chế độ **coach**: 2 lượt gọi GPT (6 + 6, song song). Điểm của bài giao =
   số câu `accepted` / 12 (cùng hợp đồng `clean/total` của Course 1).
2. Đọc phản hồi (điểm luyện câu 0–10, tối đa 2 lỗi ưu tiên, gợi ý tự sửa — không
   lộ câu sửa).
3. Tự viết lại tối đa 6 câu → `POST /api/quiz/course/writing/revise`, chế độ
   **review**: 1 lượt gọi. Câu đầu không bị ghi đè, điểm bài giao không đổi.
   Gửi rỗng = chốt luôn. Sau khi chốt, đáp án tham khảo hiện ra. Viết lại chỉ
   được khi bài giao còn nhận bài (chưa quá hạn, lớp chưa lưu trữ); quá hạn thì
   chỉ còn nút chốt để xem đáp án, không tốn lượt gọi.
4. Trần **cứng** `SENTENCE_LAB_MAX_CALLS_PER_USER_PER_DAY` (mặc định 40) lượt
   gọi model mỗi học viên mỗi ngày UTC. Trước mỗi đợt chấm, máy chủ giữ chỗ số
   lượt TỐI ĐA đợt đó có thể dùng (`planned_calls`: mỗi 6 câu một lượt + một
   lượt gọi lại; nộp 12 câu = 3, viết lại ≤6 câu = 2). Đã dùng + số giữ chỗ vượt
   trần → 429 trước khi gọi model: ở lượt 38/40 không nộp được 12 câu, ở 39/40
   không viết lại được. Trong đợt, từng lượt gọi còn bị chặn bởi số lượt còn lại.
   "Đã dùng" = max(dòng `ai_usage_logs` hôm nay, số lượt tiến trình đã bắt đầu
   hôm nay) vì sổ ghi bất đồng bộ. Đếm hỏng → 503 (không cho qua). Bộ đếm phụ
   và `single_flight` nằm trong một tiến trình; nếu backend chạy nhiều worker,
   hai request cùng lúc ở hai worker vẫn có thể trễ đúng các lượt đang chạy.

Câu hỏng (JSON sai schema/validator, lộ lời giải ở coach, bỏ sót câu) được gom
vào **một** lượt gọi lại. Vẫn hỏng → không ghi gì, 503, nháp giữ nguyên.
Tổng số lượt gọi cho một bài: 1–3.

## Model

`SENTENCE_LAB_MODEL` (mặc định `gpt-6.1-terra`), `SENTENCE_LAB_REASONING_EFFORT`
(mặc định `medium`, chỉ áp cho model `gpt-5*`/`gpt-6*`/`o*`). Hiệu chỉnh: `gpt-5-mini`
đạt 20/20 ca gói ngày 18/11 (`low` chỉ 15–17/20). OpenAI tắt `gpt-5-mini` ngày
11/12/2026; `gpt-6.1-terra` đạt 19/20 ca gói + 3/3 ca tấn công ngày 22/11 ở cả
`medium` và `high` (ca C12 đúng status `revise` nhưng thiếu mã MODAL/SCOPE). Dùng
`OPENAI_API_KEY` sẵn có (Whisper). **Prompt chấm** là nội dung private, không nằm
trong repo: biến `SENTENCE_LAB_PROMPT` trên Railway chứa prompt v2.2 đã được SA
review và hiệu chỉnh (sha256 `e60e85992308196d006cbbdea0d8bf5119b624584b2ba6f162767bee43c61de1`), KHÔNG phải `private/ai_grader_prompt.md` gốc của gói
(bản gốc đã lộ trong lịch sử PR). Đặt trên staging rồi production; đổi env cần anh
Andy duyệt, production cần thêm Content Manager + SA duyệt. Thiếu biến này thì
nộp/viết lại bài lab trả 503, bài vẫn còn nguyên; script hiệu chỉnh cũng dừng.
Mỗi trường nhận xét có trần độ dài (400 ký tự tiếng Việt, 600 cho câu sửa); phản
hồi vượt trần, chép lại 12 từ liên tiếp của prompt, hoặc đánh vần lời giải bị bỏ
như lộ đáp án. Mọi lượt gọi ghi vào `ai_usage_logs`
`service='openai'`, `feature='sentence_lab'`; model chưa có dòng giá trong
`services/ai_pricing.py` được ghi `cost_source='unpriced'` kèm số token.

## Nhập nội dung (cần phê duyệt ghi DB)

```bash
cd backend
# 1. Thử khô — chỉ đọc gói, kiểm SHA-256 với manifest, 45×12, khớp 540 khóa chấm
python -m scripts.import_sentence_lab_course5 --package <zip>
# 2. Ghi thật (staging trước, rồi production) — chỉ khi đã có phê duyệt.
#    --expect-ref phải khớp SUPABASE_URL, sai là dừng. Staging: zjphffoujxkpltixsbzj.
python -m scripts.import_sentence_lab_course5 --package <zip> --commit --publish --expect-ref <ref>
```

Chạy lại lệnh cập nhật đúng 45 bank theo `code` (không tạo bank mới).

**Đang chặn (18/11):** trên staging, mọi lệnh ghi `quiz_banks` qua PostgREST của
service_role bị từ chối 42501, vì CHECK `quiz_banks_grammar_revision_shape`
(migration 309) gọi `grammar_quiz_allowed_code`, hàm mà 309 đã thu quyền
EXECUTE của service_role. Script này (và `import_course_exercise_bank.py`,
PATCH `/admin/quiz/banks/{id}`) chưa ghi được cho tới khi có hướng xử lý được duyệt.

## Hiệu chỉnh model trước khi giao cho học viên

```bash
OPENAI_API_KEY=… python -m scripts.calibrate_sentence_lab --package <zip>
```

Chạy 20 ca của `private/calibration_cases.json` cộng 3 ca INJ (học viên xin/ra
lệnh cho "accepted"; đạt khi không ra `accepted`), không đụng DB. Cần
`SENTENCE_LAB_PROMPT` đã đặt. Chạy lại khi đổi model hoặc prompt.

## Kiểm tra sau khi nhập

- `/admin` → lớp Course 5 → Giao bài lớp → bài tập theo buổi: thấy 45 mục
  `C5-SL-S01…S45`, mỗi mục 12 câu, `ready`.
- Giao S01 cho một tài khoản thử → mở bài: thấy đề có câu gốc + yêu cầu, chưa
  thấy ví dụ làm mẫu; nộp 12 câu → kết quả có điểm /10 và lỗi; viết lại 1 câu →
  thấy bản sửa tối thiểu và đáp án tham khảo.
- SQL: `select count(*) from quiz_banks where code like 'C5-SL-S%';` = 45;
  `select count(*) from quiz_questions q join quiz_banks b on b.id=q.bank_id where b.code like 'C5-SL-S%';` = 540.
