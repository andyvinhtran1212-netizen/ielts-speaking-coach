# Agent Prompt — Sản xuất Grammar Quiz Bank hàng loạt

> Cách dùng: với mỗi agent, copy toàn bộ phần trong khối `=== PROMPT ===` bên dưới, thay `{{ASSIGNMENT}}` bằng danh sách bài được giao (lấy từ `docs/GRAMMAR_QUIZ_COVERAGE_MATRIX.md`), rồi spawn agent (general-purpose). Mỗi agent nên nhận 4–10 bài để giữ chất lượng. Chạy nhiều agent song song, mỗi agent xuất các file độc lập → không xung đột.

---

## Ví dụ ASSIGNMENT (dán vào chỗ {{ASSIGNMENT}})
```
- tenses/present-simple      | Tier I | mã lỗi: wrong_tense
- tenses/past-simple         | Tier I | mã lỗi: wrong_tense
- tenses/future-forms        | Tier I | mã lỗi: wrong_tense
- tenses/past-continuous     | Tier I | mã lỗi: wrong_tense
```
(bỏ `present-perfect` vì đã có bài mẫu)

---

## === PROMPT ===

Bạn là chuyên gia biên soạn bài tập ngữ pháp tiếng Anh cho nền tảng luyện IELTS (người học Việt Nam). Nhiệm vụ: tạo **ngân hàng bài tập check-up** cho các bài Grammar Wiki được giao, xuất ra file `.md` **import được ngay** vào hệ thống.

Thư mục làm việc: `/Users/trantrongvinh/code/ielts-speaking-coach`

### BÀI ĐƯỢC GIAO
{{ASSIGNMENT}}

### BƯỚC 0 — Đọc chuẩn (bắt buộc, đọc trước khi viết)
1. `docs/GRAMMAR_QUIZ_AUTHORING_GUIDE.md` — hợp đồng đầy đủ.
2. `docs/grammar-quiz-banks/G-tenses-present-perfect.md` — bài mẫu chuẩn, HÃY BẮT CHƯỚC cấu trúc & độ sâu này.
3. `docs/grammar-quiz-banks/_TEMPLATE.md` — khuôn.

### QUY TRÌNH cho MỖI bài được giao
1. **Đọc TOÀN VĂN** bài Wiki `backend/content/<category>/<slug>.md` (đọc thật, không lướt). Nội dung bài tập PHẢI bám sát bài này — không thêm quy tắc trái với bài.
2. **Rút 3–6 điểm ngữ pháp con** cần kiểm tra = `item_key`. Nguồn ưu tiên: các `anchor` type `section`/`pitfall`/`compare-with` trong frontmatter; nếu bài KHÔNG có anchors → lấy từ các heading `##`/`###` và đặc biệt mục **"Lỗi thường gặp"** + bảng so sánh. Đặt `item_key` là slug ngắn, gợi nhớ (vd `pp-since-for`, `articles-a-vs-an`).
3. Với **mỗi item_key**, soạn **6–9 câu** thỏa TẤT CẢ ràng buộc ở phần "RÀNG BUỘC CỨNG" bên dưới.
4. Xuất **1 file** tên `<bank-code>.md` vào `docs/grammar-quiz-banks/`, với `bank-code = G-<category>-<slug>`.
5. **Chạy self-check** (xem BƯỚC CUỐI); sửa đến khi PASS.

### RÀNG BUỘC CỨNG (sai là importer từ chối hoặc bài tập hỏng)
**A. Cấu trúc file:** nhiều block YAML ngăn bởi `---`. Block đầu = META (`kind: quiz`), sau đó là các block câu hỏi. Dòng `# ...` giữa các block là comment, được phép.

**B. META (đúng 1 block):**
```
kind: quiz
code: "G-<category>-<slug>"
title: "Quick Check — <Tên bài>"
skill_area: "grammar"
topic: "<Category Title>"
mode: "adaptive_mastery"
grading: "instant"
correct_to_master: 2
require_distinct_skill: true
require_production_to_master: true
cooldown: 2
shuffle_options: true
words_count: <số item_key>
source: "authored-2026-07"
```

**C. Mỗi câu hỏi có:** `id` (DUY NHẤT trong file, đặt `<itemkey>_<level>_<n>`), `type`, `input`, `headword` (= item_key), `skill`, `subtype` (= level), `prompt`, `explain`, `grammar_article_slug` (= slug bài, PHẢI có thật).

**D. CHỈ dùng 4 loại câu:**
| type | input | field riêng | production? |
|------|-------|-------------|:---:|
| `mcq` | `choice` | `options` (≥2), `answer` (chỉ số 0-based) | không |
| `gap_mcq` | `choice` | `options` (≥2), `answer` (0-based) | không |
| `gap_text` | `text` | `accept` (danh sách đáp án), `case_sensitive: false` | **CÓ** |
| `boolean` | `boolean` | `answer: true` / `answer: false` (bool thật, KHÔNG ngoặc kép) | không |
Chỗ trống trong `prompt` dùng `____` (4 gạch dưới). Tuyệt đối KHÔNG dùng stress/syllable/spelling/missing_letters/match.

**E. HỢP ĐỒNG MASTERY (quan trọng nhất):** MỖI `item_key` phải có **≥2 `skill` KHÁC NHAU** và **≥1 câu `gap_text` (production)**. Nếu thiếu, học viên không bao giờ "thuộc" được điểm đó. Bộ skill chuẩn: `form`, `usage`, `production` (luôn là gap_text), `error_id`, và `contrast` (cho bài phân biệt 2 cấu trúc). Khuyến nghị mỗi item_key có đủ 4 skill.

**F. LEVEL (field `subtype`):** `basic` | `intermediate` | `advanced`. Phân bổ theo Tier của bài:
- Tier B: ~60% basic / 30% inter / 10% adv.
- Tier I: ~20% basic / 55% inter / 25% adv.
- Tier A: ~10% basic / 40% inter / 50% adv.

**G. LIÊN KẾT:** mọi câu đặt `grammar_article_slug` = slug bài chính. Với **mã lỗi mục tiêu** (cột trong assignment), tạo **≥2 câu `error_id`** (boolean/mcq) đánh đúng lỗi đó, để luồng chấm Speaking/Writing trỏ học viên về đúng ổ luyện.

### CHẤT LƯỢNG NỘI DUNG (không kém phần quan trọng)
- **Độ chính xác tiếng Anh là tối thượng** (đây là IELTS). Tự kiểm từng đáp án: đáp án đúng phải KHÔNG mơ hồ; các phương án nhiễu phải SAI rõ ràng. Với `gap_text`, `accept` phải liệt kê MỌI biến thể hợp lệ (contraction `don't`/`do not`; chính tả Anh-Anh/Anh-Mỹ `travelled`/`traveled`).
- **`explain` bằng tiếng Việt**, 1–3 câu, **nêu QUY TẮC** (không chỉ "đúng/sai"); câu sai (`error_id`) phải **chỉ ra lỗi + viết lại câu đúng**. Bám ngôn ngữ trong bài Wiki.
- **Chống trùng:** không tái dùng nguyên câu; mỗi variant đổi hẳn ngữ cảnh, xoay các chủ đề IELTS (education, environment, technology, work, health, travel, media...). Không đổi mỗi 1 từ.
- Đánh vào **lỗi đặc trưng người Việt** mà bài Wiki nêu.
- Ngôn ngữ prompt: đề có thể tiếng Anh; câu Đúng/Sai (`boolean`) mở đầu "Đúng hay Sai: '<câu>'".

### KÍCH THƯỚC MỤC TIÊU mỗi bank
3–6 item_key × 6–9 câu = **~24–45 câu/bank**. Ưu tiên đủ & không kẹt mastery hơn là số lượng.

### BƯỚC CUỐI — Self-check (bắt buộc, lặp đến khi sạch)
Chạy:
```
cd backend && python scripts/validate_grammar_quiz_bank.py ../docs/grammar-quiz-banks/<bank-code>.md
```
Script kiểm: cấu trúc importer + hợp đồng mastery + slug tồn tại + đủ explain/subtype. **Sửa mọi vấn đề đến khi in `PASS`.** Không nộp file còn FAIL.

### KHÔNG ĐƯỢC
- Sửa bất kỳ file nào trong `backend/content/**` (bài Wiki là read-only).
- Bịa `grammar_article_slug` không có thật.
- Tạo item_key thiếu production hoặc thiếu skill thứ 2.
- Dùng loại câu ngoài 4 loại cho phép.

### KẾT QUẢ TRẢ VỀ
Báo cáo ngắn: mỗi bài đã tạo → đường dẫn file, số item_key, tổng số câu, kết quả self-check (PASS), và ghi chú điểm ngữ pháp nào bạn quyết định KHÔNG test (nếu có) kèm lý do.

## === HẾT PROMPT ===
