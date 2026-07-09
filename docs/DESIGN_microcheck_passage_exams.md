# Thiết kế: mở rộng micro-check sang đề có passage (TOEIC Part 6/7, THPT QG)

*Đề xuất kiến trúc — CHƯA build. WP6 của đợt mở rộng micro-check. Cần bạn chốt hướng trước khi hiện thực.*

## 1. Vì sao cần một quyết định

Micro-check hiện chạy trên **câu đơn không passage** (`exam_questions.question_type = 'mcq_single'`, không có `passage_id`). Ba nguồn đề còn lại đều **gắn với đoạn văn**:

| Nguồn | Dạng | Vướng gì |
|---|---|---|
| TOEIC Part 6 | Text completion — 1 đoạn ~4 chỗ trống | Cần nhóm câu theo 1 passage |
| TOEIC Part 7 | Reading comprehension — 1–3 đoạn + nhiều câu | Passage + nhiều loại câu |
| THPT QG | Hỗn hợp: MCQ ngữ pháp (giống P5) + cloze + đọc hiểu | Một phần cần passage |

Hai "nhà" hiện có đều không vừa:

- **Exam module** (`exam_tests/exam_questions`, mig 134): gọn, KP-first, đã có micro-check — nhưng `exam_questions` **không có `passage_id`**, `question_type` CHECK chỉ `mcq_single`.
- **Reading module** (`reading_*`): có passage nhưng **coupled chặt IELTS** — `passage_id NOT NULL`, CHECK `skill_tag` 8 giá trị, `q_num` 1–40, bảng band Academic. Không hợp cho TOEIC/THPT.

## 2. Ba lựa chọn

### Phương án A — Mở rộng exam module để đỡ passage (khuyến nghị)
Thêm khái niệm "section" (khối) mang passage tùy chọn vào exam module, giữ nguyên KP + micro-check.

- **Schema** (migration mới, additive):
  - `exam_sections(id, test_id, section_order, passage_text, passage_title, instructions)` — 1 test có nhiều section; section không passage vẫn hợp lệ (P5 = 1 section không passage).
  - `exam_questions` += `section_id UUID NULL REFERENCES exam_sections`, và nới `question_type` CHECK thêm `text_completion`, `mcq_passage` (đọc hiểu).
- **Contract**: `get_for_play` trả `sections[]` (passage đã strip đáp án) + questions theo section. Grader + KP evidence + stepper **tái dùng nguyên** (micro-check vẫn nằm trong `solution_steps`, không đổi).
- **Frontend**: `exam-player.js` render passage trên nhóm câu của section; phần review/stepper/micro-check **không đổi**.
- **Ưu**: giữ toàn bộ đầu tư KP/micro-check; không đụng reading IELTS; additive.
- **Nhược**: exam module phình nhẹ (thêm 1 bảng + vài loại câu).

### Phương án B — Tách lớp passage dùng chung
Rút passage ra một bảng `content_passages` trung lập, cả exam lẫn reading trỏ vào. Sạch về lâu dài nhưng **đụng reading module đã ổn định** (rủi ro regression cao — CLAUDE.md cảnh báo). Không khuyến nghị cho bước này.

### Phương án C — Giữ nguyên, chỉ làm phần KHÔNG passage
THPT QG phần MCQ ngữ pháp + TOEIC P5 mở rộng có thể làm ngay dưới `grammar_practice`/`thpt_qg` mà **không cần passage**. Micro-check chạy được luôn. Passage (P6/P7, đọc hiểu THPT) để sau.
- **Ưu**: 0 thay đổi schema, ship được ngay phần lớn giá trị THPT ngữ pháp.
- **Nhược**: chưa phủ đọc hiểu.

## 3. Khuyến nghị

**Làm C trước (ngay), A sau (khi cần passage).**

1. **Ngay** — dưới `thpt_qg` (đã có sẵn trong exam_source): soạn bộ đề THPT phần ngữ pháp/từ vựng câu đơn + micro-check (giống WP1/WP4). 0 schema.
2. **Khi mở đọc hiểu** — hiện thực Phương án A (exam_sections + 2 question_type), rồi soạn TOEIC P6/P7 + đọc hiểu THPT với micro-check ở bước decode.

## 4. Khối lượng ước tính
- Phương án C (THPT ngữ pháp + micro-check): ~1 bộ đề, 0 schema — cỡ WP4.
- Phương án A (schema + FE + grader): 1 migration + sửa `exam_service`/`exam-player` + test; rồi mỗi bộ P6/P7 là content.

## 5. Bất biến giữ nguyên
Micro-check vẫn ở `solution_steps[].microcheck`, evidence rule-based, KP resolve qua `kp_registry`; passage chỉ là ngữ cảnh — KHÔNG đổi cách ghi bằng chứng. Copyright: tự soạn đề theo format (không chép đề gốc ETS/Cambridge); THPT dùng đề công khai của Bộ, tự viết lời giải.
