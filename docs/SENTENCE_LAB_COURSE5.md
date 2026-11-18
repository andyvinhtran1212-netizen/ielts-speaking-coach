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
   Gửi rỗng = chốt luôn. Sau khi chốt, đáp án tham khảo hiện ra.

Câu hỏng (JSON sai schema/validator, lộ lời giải ở coach, bỏ sót câu) được gom
vào **một** lượt gọi lại. Vẫn hỏng → không ghi gì, 503, nháp giữ nguyên.
Tổng số lượt gọi cho một bài: 1–3.

## Model

`SENTENCE_LAB_MODEL` (mặc định `gpt-5-mini`), `SENTENCE_LAB_REASONING_EFFORT`
(mặc định `low`, chỉ áp cho model `gpt-5*`/`gpt-6*`/`o*`). Dùng
`OPENAI_API_KEY` sẵn có (Whisper). Mọi lượt gọi ghi vào `ai_usage_logs`
`service='openai'`, `feature='sentence_lab'`; model chưa có dòng giá trong
`services/ai_pricing.py` được ghi `cost_source='unpriced'` kèm số token.

## Nhập nội dung (cần phê duyệt ghi DB)

```bash
cd backend
# 1. Thử khô — chỉ đọc gói, kiểm SHA-256 với manifest, 45×12, khớp 540 khóa chấm
python -m scripts.import_sentence_lab_course5 --package <zip>
# 2. Ghi thật (staging trước, rồi production) — chỉ khi đã có phê duyệt
python -m scripts.import_sentence_lab_course5 --package <zip> --commit --publish
```

Chạy lại lệnh cập nhật đúng 45 bank theo `code` (không tạo bank mới).

## Hiệu chỉnh model trước khi giao cho học viên

```bash
OPENAI_API_KEY=… python -m scripts.calibrate_sentence_lab --package <zip>
```

Chạy 20 ca của `private/calibration_cases.json`, không đụng DB. Chạy lại khi đổi
model hoặc prompt.

## Kiểm tra sau khi nhập

- `/admin` → lớp Course 5 → Giao bài lớp → bài tập theo buổi: thấy 45 mục
  `C5-SL-S01…S45`, mỗi mục 12 câu, `ready`.
- Giao S01 cho một tài khoản thử → mở bài: thấy đề có câu gốc + yêu cầu, chưa
  thấy ví dụ làm mẫu; nộp 12 câu → kết quả có điểm /10 và lỗi; viết lại 1 câu →
  thấy bản sửa tối thiểu và đáp án tham khảo.
- SQL: `select count(*) from quiz_banks where code like 'C5-SL-S%';` = 45;
  `select count(*) from quiz_questions q join quiz_banks b on b.id=q.bank_id where b.code like 'C5-SL-S%';` = 540.
