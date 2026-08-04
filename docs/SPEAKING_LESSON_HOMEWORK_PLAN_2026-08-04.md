# Bài tập Speaking sau buổi học — khảo sát hiện trạng & đề xuất cấu trúc

Ngày 04/08/2026. Mọi con số dưới đây đo trực tiếp trên prod, không phải ước lượng.

---

## Phần 1 — Web đang có gì (khảo sát)

### 1.1 Bài Speaking hằng ngày (vừa lên, PR #917/#918)

```
class_assignments (skill='speaking', content_id=<topic>, content_config={mode,part,question_ids,questions})
   └── class_assignment_items (1 dòng / học viên; artifact_id = sessions.id)
         └── sessions → responses (1 dòng / câu trả lời)
```

- Đề **chốt lúc giao**, chụp cả nội dung vào `content_config.questions` — sửa kho
  sau đó không đổi bài đã giao.
- Số câu đóng cứng: `_QUESTIONS_PER_PART = {1: 2, 2: 1, 3: 1}`.
- Hạn là **mốc tuyệt đối** (ngày + giờ VN, mặc định 19:00).
- Part 1/3 giao bằng **audio**, chữ không rời máy chủ (`question_visibility.py`).
- Phiếu làm bài nhiều ô đã có, và **đã sẵn sàng cho N ô**: `_initSheet` dựng ô
  bằng `_questions.map(...)` và bật từ 2 câu trở lên. Không phải viết lại.

### 1.2 Cơ chế xoá dần — **CHƯA TỪNG CHẠY**

| đo trên prod | |
|---|---|
| phiên đã xoá audio | **0** / 5.514 |
| phiên đã xoá nội dung | **0** / 5.514 |
| phiên đã quá mốc 15 ngày mà audio còn nguyên | **5.087** |

`jobs/retention_sweep.py` có thật, nhưng `RETENTION_SWEEP_DRY_RUN` mặc định
`true` và **trong repo không có cấu hình cron nào gọi nó**. Nghĩa là:

- **Chưa mất gì cả.** Còn nguyên thời gian để dựng sổ tiến bộ trước khi bật.
- Nhưng dung lượng cũng **chưa hề được giảm** — mục tiêu ban đầu chưa đạt.

Khi nó chạy, mốc 15 ngày xoá audio, mốc 60 ngày xoá `transcript`, `feedback`,
`pronunciation_payload`, `raw_transcript_text`.

### 1.3 Cái gì sống sót, cái gì chết

Sweep **không bao giờ** đụng cột điểm. Đo dung lượng thật:

| cột | dung lượng | số phận ở mốc 60 ngày |
|---|---|---|
| `pronunciation_payload` | 23 MB | **xoá** |
| `feedback` (chữ) | 16 MB | **xoá** |
| `transcript` | 3,1 MB | **xoá** |
| `feedback_json` | *rỗng hoàn toàn* | cột chết, chưa ai ghi |
| `overall_band`, `pronunciation_*`, `band_*` | — | **giữ vĩnh viễn** |

⇒ Sau 60 ngày còn lại **một con số**. Thấy được em ấy tụt từ 5.5 xuống 5.0,
nhưng **không còn biết vì sao**. Đây chính là lỗ hổng cần vá.

### 1.4 Đã có sẵn cờ chất lượng — chưa ai nhìn

`score_confidence` và `transcript_reliability` được tính lúc chấm và lưu sẵn.
Phân bố thật trên prod:

| `score_confidence` | số bài | band trung bình |
|---|---|---|
| high | 5.076 | 5.98 |
| medium | 1.034 | 5.77 |
| **low** | **44** (0,7%) | **3.13** |

Cờ này **hiếm và có nghĩa** — không phải nhiễu. Chênh gần 3 band giữa `low` và
`high` nghĩa là nó đang bắt đúng thứ cần bắt. Chỉ thiếu một mặt đọc.

### 1.5 Kho đề và "buổi học"

- `topics`: 104 chủ đề, 697 câu, **631 câu đã có audio**.
- `class_lessons` **có bảng nhưng RỖNG (0 dòng)**, và mỗi dòng thuộc về **một
  lớp** ⇒ không phải kho tái dùng được.
- `courses`: 5 khoá. **Course 3 = C3 "Khóa kỹ năng nâng cao cho bài thi IELTS"**.

### 1.6 Giọng Kokoro — bảng hạng chính chủ (`VOICES.md`)

54 giọng, 28 giọng tiếng Anh. Chỉ **4 giọng đạt B- trở lên**:

| giọng | hạng | dữ liệu huấn luyện | vùng |
|---|---|---|---|
| af_heart | **A** | — | Mỹ |
| af_bella | **A-** | HH hours | Mỹ |
| af_nicole | B- | HH hours | Mỹ |
| **bf_emma** | **B-** | **HH hours** | **Anh** |

Giọng Anh kế tiếp tụt hẳn xuống C (bf_isabella, bm_fable, bm_george) rồi D
(bf_alice, bf_lily, bm_daniel, bm_lewis).

⇒ **bf_emma là giọng Anh DUY NHẤT trên hạng C** — và đang là mặc định. Lựa chọn
hiện tại đã đúng. Muốn thêm giọng cho đa dạng thì phải chọn: hoặc tụt xuống hạng
C mà giữ giọng Anh, hoặc lấy hạng A mà đổi sang giọng Mỹ.

---

## Phần 2 — Đề xuất cấu trúc

### 2.1 Nguyên tắc: **một sổ cái, thêm một LOẠI** — không dựng hệ song song

`class_assignments.kind ∈ ('daily','lesson')`. Toàn bộ hạ tầng phía sau — sổ
cái `class_assignment_items`, bảng tổng kết, trang "Lớp của tôi", ma trận tiến
độ, liên kết `class_assignment_item_id` — dùng lại nguyên vẹn.

| | hằng ngày | **sau buổi học** |
|---|---|---|
| nguồn đề | `topics` (kho chung) | **kho theo buổi** (mới) |
| số câu | 2 (P1) / 1 (P2, P3) | do bộ đề quyết — 6→15 câu |
| hạn | ngày + giờ tuyệt đối | **N ngày kể từ lúc giao** + giờ |
| nộp | phiếu 2 ô | phiếu N ô, nộp từng câu |
| chấm | như nhau | như nhau |

### 2.2 Kho theo buổi là **bảng riêng**, không nhồi vào `topics`

Đã cân nhắc dùng lại `topics` (được ngay audio, bộ chọn câu, chốt che chữ). Bác
bỏ vì `topics` đang bị **`admin.py` xoá hàng loạt và xoay vòng** (`delete().in_`,
`last_rotated_at`), và `questions.py` đọc nó để sinh đề luyện tự do. Một bộ đề
của buổi học nằm lẫn trong đó có thể **bị luồng xoay chủ đề xoá mất**, hoặc hiện
ra trong luyện tự do.

```sql
speaking_lesson_sets           -- "C3 · Buổi 1 · Part 1"
  (id, course_id→courses, lesson_no, part, title, description,
   is_active, created_by, created_at, updated_at)
  UNIQUE (course_id, lesson_no, part)

speaking_lesson_set_questions
  (id, set_id→speaking_lesson_sets ON DELETE CASCADE, order_num,
   question_text, question_type, level, cue_card_bullets, cue_card_reflection,
   audio_url, audio_path, is_active, created_at, updated_at)
  UNIQUE (set_id, order_num) WHERE is_active
```

Kho này **thuộc về KHOÁ**, không thuộc về lớp ⇒ soạn một lần, mọi lớp của khoá
đó dùng lại. Đó là điều `class_lessons` (gắn cứng vào một lớp) không làm được.

**Dùng lại đường ống audio**, không chép: `render_question_audio(q, title)` vốn
nhận một dict nên đã độc lập với bảng; chỉ cần tham số hoá bảng ghi lại trong
`pregen_speaking_question_audio.py`.

### 2.3 Hạn nộp: đổi cách NHẬP, giữ nguyên cách LƯU

Vẫn lưu `due_at` là một **mốc tuyệt đối** — mọi so sánh đã là so sánh thời điểm,
đổi sang "đếm ngày sống" sẽ làm hạn trôi theo lúc học viên mở bài. Chỉ đổi ô
nhập: admin gõ **N ngày** + giờ, backend quy ra `due_at` ngay lúc giao và lưu
`due_days` để hiển thị lại ("hạn 7 ngày — 23:59 ngày 11/08").

### 2.4 Sổ tiến bộ bền — vá lỗ 60 ngày

Vấn đề: chẩn đoán chết ở mốc 60 ngày, chỉ còn con số.

Đề xuất: lúc chấm xong, rút một **bản tóm nhỏ** ghi sang bảng riêng, sweep không
bao giờ đụng tới:

```sql
speaking_progress_marks
  (id, user_id, response_id, session_id, class_assignment_item_id,
   recorded_at, part, band, band_f, band_lr, band_gra, band_p,
   duration_seconds, words_per_minute,
   top_error_tags text[],        -- 3-5 nhãn lỗi, KHÔNG phải cả đoạn feedback
   weak_phonemes text[],         -- từ pronunciation_payload trước khi nó bị xoá
   score_confidence)
```

Vài trăm byte mỗi bài thay vì vài KB — giữ được **hàng chục nghìn** bài trong
cùng dung lượng mà `pronunciation_payload` hiện chiếm. Đây là thứ khiến câu "em
này yếu ở đâu, có đang khá lên không" **còn trả lời được sau 60 ngày**.

### 2.5 Gắn cờ bài cần xem lại

Ghép **hai loại vấn đề khác nhau**, đừng trộn:

1. **Bài hỏng (kỹ thuật)** — `score_confidence='low'`, bài dưới 10 giây, bản ghi
   gần như không có tiếng. Dùng tín hiệu **đã có sẵn**, chỉ thiếu mặt đọc.
2. **Học viên đang gặp vấn đề (sư phạm)** — tụt band so với chính mình, trễ hạn
   liên tiếp, bỏ bài. Suy ra từ sổ tiến bộ ở 2.4.

Cờ phải **nói được lý do và việc cần làm**, không chỉ tô đỏ.

---

## Phần 3 — Chia giai đoạn

| GĐ | việc | migration | giao diện | trạng thái |
|---|---|---|---|---|
| A | kho đề theo buổi + bộ nạp + đường render | **183** | không | ✅ mã xong |
| B | audio Kokoro + chốt giọng | không | không | ✅ 12 clip đã lên Storage |
| C | admin giao bài theo buổi | **184** | có | ✅ |
| D | phiếu làm bài N ô | không | có | ✅ |
| E | cờ "cần xem lại" + hiệu suất lớp | không | có | ✅ |
| F | sổ tiến bộ bền | **185** | không | ✅ mã xong |

Tất cả nằm ở PR #921 (8 commit). Ba vòng review: codex cục bộ ×3 + bot inline ×1
→ 12 lỗi thật đã vá, 1 phát hiện của bot bị bác có dẫn chứng.

## Còn phải làm bằng tay (cần quyền prod)

1. Áp ba migration 183 → 184 → 185, theo đúng thứ tự.
2. `python -m scripts.import_speaking_lesson_sets --file content/speaking_lessons/c3_lesson01_part1.json --commit`
3. `python -m scripts.pregen_speaking_question_audio --lesson-set --commit`
   (12 clip đã nằm sẵn trong Storage, nên lệnh này chỉ ghi con trỏ — không render lại.)
4. `python -m scripts.backfill_speaking_progress --commit` — **chạy TRƯỚC khi bật
   cơ chế dọn**, nếu không thì phần chẩn đoán của 6.219 bài mất vĩnh viễn.

## Quyết định còn treo

**Giọng đọc.** Giữ `bf_emma` (mặc định hiện tại) hay đổi. Đây là lựa chọn của
người nghe, không phải của số liệu — bảng hạng chỉ nói được rằng bf_emma là giọng
Anh duy nhất trên hạng C. Đổi giọng kéo theo render lại toàn bộ 631 bản đọc.

**Cơ chế dọn.** Nó vẫn chưa chạy. Bật hay không là quyết định về dung lượng; điều
kiện tiên quyết là bước 4 ở trên đã chạy xong.
