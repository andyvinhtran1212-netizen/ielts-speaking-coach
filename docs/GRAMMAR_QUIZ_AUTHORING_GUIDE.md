# Grammar Quiz — Hướng dẫn soạn ngân hàng bài tập (Authoring Guide)

> **Đối tượng đọc:** người/agent soạn bài tập grammar để import vào averlearning.
> **Mục tiêu:** tạo ngân hàng bài tập **lớn, không trùng lặp, bám sát nội dung bài Wiki**, phủ đủ grammar, có giải thích chi tiết, và **liên kết** với bài viết + luồng chấm Speaking/Writing.
> File này là **hợp đồng bắt buộc**: file `.md` soạn sai cấu trúc sẽ bị importer từ chối. Mọi quy tắc dưới đây đã đối chiếu trực tiếp với `backend/services/quiz_import.py` và `frontend/js/quiz-engine.js`.

---

## 0. Mô hình tư duy (đọc kỹ trước khi soạn)

- **1 file `.md` = 1 bank = bài check-up của ĐÚNG 1 bài Wiki.** Ví dụ bài `tenses/present-perfect` → 1 file `G-tenses-present-perfect.md`.
- Trong 1 bank có nhiều **`item_key`** = **điểm ngữ pháp con** cần kiểm tra (thường lấy từ các `anchor`/section của bài). Ví dụ bài present-perfect có các item_key: `pp-experience`, `pp-since-for`, `pp-vs-past-simple`.
- Mỗi `item_key` có nhiều **câu (variant)** ở nhiều **skill** và nhiều **level** → tạo độ lớn + tránh lặp.
- Engine **Adaptive Mastery** chạy ở trình duyệt: học viên làm tới khi "thuộc" từng item_key (không phải làm hết 1 lượt). Chấm **tức thì**, hiện `explain` ngay sau mỗi câu.
- **Không đụng vào file bài Wiki** (`backend/content/**`). Bài tập sống ở DB, chỉ **trỏ về** bài qua `grammar_article_slug`.

---

## 1. Cấu trúc file `.md`

File = **nhiều block YAML**, mỗi block ngăn bởi `---`. Block đầu là **META**, các block sau là **câu hỏi**. (Dòng `# ==== ... ====` giữa các block là comment tuỳ chọn cho dễ đọc — importer bỏ qua.)

```
---
kind: quiz            ← BẮT BUỘC, nhận diện META
code: "G-tenses-present-perfect"
...META fields...
---

---
id: "pp_exp_b1"
type: "mcq"
...question fields...
---

---
id: "pp_exp_i1"
...
---
```

---

## 2. Block META (bắt buộc, đúng 1 block)

| Field | Bắt buộc | Giá trị cho grammar | Ghi chú |
|-------|:---:|---------------------|---------|
| `kind` | ✅ | `quiz` | Cố định, nhận diện META |
| `code` | ✅ | `G-<category>-<article-slug>` | **Duy nhất theo (skill_area, code).** Import lại cùng code = ghi đè toàn bộ câu của bank |
| `title` | ✅ | `"Quick Check — <Tên bài>"` | Hiển thị cho học viên |
| `skill_area` | ✅ | `grammar` | **Phải khớp skill_area của topic** khi import, nếu không sẽ bị từ chối |
| `topic` | nên có | `"Tenses"` | Nhãn danh mục (category). Topic thực tế chọn ở admin lúc import |
| `mode` | ✅ | `adaptive_mastery` | |
| `grading` | ✅ | `instant` | |
| `correct_to_master` | ✅ | `2` | Số **skill khác nhau** phải đúng để "thuộc" 1 item_key |
| `require_distinct_skill` | ✅ | `true` | Bắt buộc đúng ở ≥2 skill khác nhau (không phải đúng 1 skill 2 lần) |
| `require_production_to_master` | ✅ | `true` | Bắt buộc có ≥1 câu **production** (gõ đáp án) đúng |
| `cooldown` | nên có | `2` | Số câu cách nhau trước khi hỏi lại cùng item_key |
| `shuffle_options` | nên có | `true` | Xáo phương án mcq |
| `words_count` | nên có | = số item_key | Để đối chiếu; không bắt buộc chính xác |
| `source` | tuỳ chọn | `"authored-2026-07"` | Ghi nguồn/đợt tạo |

---

## 3. Block câu hỏi

### 3.1 Field chung (mọi loại câu)

| Field | Bắt buộc | Ý nghĩa |
|-------|:---:|---------|
| `id` | ✅ | Duy nhất trong file. Convention: `<itemkey>_<level>_<n>` vd `pp_exp_b1` |
| `type` | ✅ | `mcq` \| `gap_mcq` \| `gap_text` \| `boolean` (xem §3.3 — chỉ dùng 4 loại này cho grammar) |
| `input` | ✅ | `choice` \| `text` \| `boolean` (khớp với type, xem §3.3) |
| `headword` | ✅ | **= item_key** (gom pool). Dùng slug điểm ngữ pháp: `pp-since-for` |
| `skill` | ✅ | Khía cạnh kiểm tra (xem §4). Ví dụ: `form`, `usage`, `error_id` |
| `prompt` | ✅ | Đề bài. Chỗ trống dùng `____` (4 gạch dưới) |
| `explain` | ✅* | Giải thích chi tiết bằng tiếng Việt (xem §6). *Không bị importer bắt buộc nhưng BẮT BUỘC theo chuẩn nội dung này* |
| `grammar_article_slug` | ✅* | Slug bài Wiki để mở lại khi sai. **Phải là slug có thật**, sai → importer từ chối |
| `subtype` | nên có | **Dùng làm LEVEL**: `basic` \| `intermediate` \| `advanced` (xem §5) |
| `points` | tuỳ chọn | Mặc định 1 |
| `counts_toward_mastery` | tuỳ chọn | Mặc định `true`. Đặt `false` cho câu "warm-up" không tính |

### 3.2 Field riêng theo `input`

- **`input: choice`** (dùng cho `mcq`, `gap_mcq`):
  - `options: [...]` — **≥2 phương án**.
  - `answer: <int>` — **chỉ số 0-based** của đáp án đúng (0 = phương án đầu).
- **`input: text`** (dùng cho `gap_text` — đây là **production**):
  - `accept: [...]` — danh sách đáp án chấp nhận (mọi biến thể hợp lệ). VD `["has been raining"]` hoặc `["don't","do not"]`.
  - `case_sensitive: false` (khuyến nghị).
- **`input: boolean`** (dùng cho `boolean` — Đúng/Sai):
  - `answer: true` hoặc `answer: false` (YAML bool thật, KHÔNG để trong ngoặc kép).

### 3.3 Loại câu ĐƯỢC DÙNG cho grammar

Chỉ dùng **4** cặp type/input sau (player render + chấm được, hợp với ngữ pháp):

| type | input | Dùng để | Có phải production? |
|------|-------|---------|:---:|
| `mcq` | `choice` | Chọn dạng đúng / cách dùng đúng | Không |
| `gap_mcq` | `choice` | Điền chỗ trống bằng cách chọn | Không |
| `gap_text` | `text` | **Điền/chia động từ tự gõ** | ✅ **Có** |
| `boolean` | `boolean` | Phán đoán câu đúng/sai (spot-the-error) | Không |

> ❌ **KHÔNG dùng** `stress`, `syllable_count`, `spelling`, `missing_letters`, `match` cho grammar (dành cho vocab/phát âm; player không tối ưu cho ngữ pháp).

---

## 4. Hệ `skill` (khía cạnh kiểm tra)

Mỗi câu gắn 1 `skill`. Để 1 item_key "thuộc được", pool của nó phải có **≥2 skill khác nhau + ≥1 câu production (`gap_text`)**. Bộ skill chuẩn cho grammar:

| skill | Kiểm tra | Loại câu hay dùng |
|-------|----------|-------------------|
| `form` | Cấu trúc/hình thái đúng | mcq, gap_text |
| `usage` | Khi nào dùng / chọn đúng ngữ cảnh | mcq, gap_mcq |
| `error_id` | Phát hiện & phán đoán lỗi | boolean, mcq |
| `contrast` | Phân biệt với cấu trúc gần giống (vd PP vs Past Simple) | mcq, gap_mcq |
| `production` | Tự tạo ra dạng đúng | **gap_text** (đây là câu production) |

**Công thức tối thiểu cho MỖI item_key (để không kẹt vòng mastery):**
> ≥3 câu, gồm ≥2 skill khác nhau, và ≥1 câu `gap_text`.
> Khuyến nghị "chuẩn": **form (mcq) + usage (gap_mcq) + error_id (boolean) + production (gap_text)** = 4 skill, dư điều kiện.

---

## 5. Hệ LEVEL (dùng field `subtype`)

Gắn `subtype: basic|intermediate|advanced` cho mỗi câu. Chọn level trọng tâm của bài theo cột **Tier** trong `GRAMMAR_QUIZ_COVERAGE_MATRIX.md`:

- **basic** (Tier B, band ≤5.5): nhận diện dạng cơ bản, câu ngắn, từ vựng dễ.
- **intermediate** (Tier I, band 6.0–6.5): ngữ cảnh IELTS thật, đánh vào lỗi phổ biến người Việt.
- **advanced** (Tier A, band 7.0+): sắc thái, phân biệt tinh vi, câu dài kiểu Speaking Part 3 / Writing Task 2.

**Phân bổ khuyến nghị theo Tier của bài:**
- Bài Tier B → 60% basic / 30% intermediate / 10% advanced.
- Bài Tier I → 20% basic / 55% intermediate / 25% advanced.
- Bài Tier A → 10% basic / 40% intermediate / 50% advanced.

> Mỗi item_key nên có câu ở ≥2 level để học viên yếu/mạnh đều gặp câu phù hợp.

---

## 6. `explain` — giải thích chi tiết (chuẩn chất lượng)

Đây là giá trị cốt lõi. Mỗi `explain` phải:
1. **Tiếng Việt**, ngắn gọn (1–3 câu).
2. **Nêu quy tắc**, không chỉ nói "đúng/sai". VD: *"for + khoảng thời gian → present perfect continuous."*
3. **Với câu sai (`boolean`/error_id): chỉ ra lỗi + sửa lại.** VD: *"SAI — 'know' là stative verb, không dùng continuous: 'I have known him for years'."*
4. **Bám nội dung bài Wiki** (lift/diễn giải từ mục "Lỗi thường gặp"/"Cách dùng" của bài đúng `grammar_article_slug`). Không mâu thuẫn với bài.

---

## 7. Tính LIÊN KẾT trên web (bắt buộc)

Đây là yêu cầu "tạo tính liên kết" — đảm bảo 3 chiều:

1. **Bài Wiki → bài tập:** `code = G-<category>-<slug>` khớp slug bài → trang `grammar-article.html` render nút **"Kiểm tra nhanh"** mở đúng bank. ⇒ Đặt code **đúng convention**, không tự chế.
2. **Câu → bài Wiki:** MỌI câu đặt `grammar_article_slug` = slug bài chính. Câu kiểu **contrast** (so sánh 2 cấu trúc) → đặt slug = bài chính, và nhắc bài đối chiếu trong `explain`.
3. **Chấm Speaking/Writing → bài tập:** hệ chấm gắn lỗi qua `common_error_tags` (mã lỗi underscore) + `feedback-anchor-mapping.yaml`. ⇒ Với mỗi **mã lỗi mục tiêu** ở cột "Mã lỗi" của ma trận, tạo ≥2 câu `error_id` cho item_key tương ứng, để result page trỏ học viên đúng ổ luyện.

---

## 8. Chống trùng lặp (để ngân hàng lớn mà không nhàm)

- **Không tái dùng nguyên câu** giữa các variant. Đổi chủ ngữ, ngữ cảnh, chủ đề IELTS (education, environment, technology, work, health, travel…).
- Trong 1 item_key, mỗi variant phải khác **bối cảnh** rõ rệt, không chỉ đổi 1 từ.
- Không lặp cùng cấu trúc câu hỏi 2 lần liên tiếp trong 1 pool.
- Đủ độ lớn: engine ưu tiên hỏi **skill chưa gặp** trước khi lặp → càng nhiều skill/variant, càng lâu mới lặp.

---

## 9. Kích thước khuyến nghị mỗi bank

- **item_key/bank:** 3–6 (bằng số điểm ngữ pháp con của bài — thường ≈ số anchor "section/pitfall/compare").
- **câu/item_key:** 6–9 (phủ 3–4 skill × ~2 level).
- **tổng câu/bank:** ~24–45.
- Toàn bộ 107 bank ⇒ ~3.000–4.500 câu (mục tiêu "ngân hàng lớn").

---

## 10. Quy trình cho agent tạo bài (làm đúng thứ tự)

1. Nhận 1 dòng trong `GRAMMAR_QUIZ_COVERAGE_MATRIX.md` (1 bài + Tier + mã lỗi mục tiêu + bank code).
2. **Đọc toàn văn** bài Wiki `backend/content/<category>/<slug>.md`.
3. Rút **3–6 điểm ngữ pháp con** cần test (ưu tiên: mục "Cách dùng", "Lỗi thường gặp", bảng so sánh, và các `anchor` type=`section`/`pitfall`/`compare-with`). Mỗi điểm = 1 `item_key` (đặt slug ngắn).
4. Với mỗi item_key: soạn 6–9 câu theo **§4 (đủ skill + ≥1 gap_text)** và **§5 (đúng phân bổ level)**; đảm bảo ≥2 câu `error_id` cho mã lỗi mục tiêu.
5. Viết `explain` chuẩn §6, đặt `grammar_article_slug` chuẩn §7.
6. **Tự kiểm** theo checklist §11.
7. Xuất **1 file** đặt tên = `<code>.md` (vd `G-tenses-present-perfect.md`).

---

## 11. Checklist tự kiểm trước khi nộp (importer sẽ chặn nếu sai)

- [ ] Có đúng 1 block META `kind: quiz`, `skill_area: grammar`, `code` đúng convention.
- [ ] Mọi câu có `id` **duy nhất**, `type`+`input` hợp lệ (chỉ 4 loại §3.3), `headword`(item_key), `skill`, `prompt`.
- [ ] `choice`: có `options` (≥2) + `answer` (0-based, trong phạm vi). `text`: có `accept` (≥1). `boolean`: có `answer: true/false` (bool thật).
- [ ] **Mỗi item_key: ≥2 skill khác nhau + ≥1 câu `gap_text`.** (nếu thiếu → học viên không bao giờ "thuộc" được item đó)
- [ ] Mọi `grammar_article_slug` là slug bài **có thật**.
- [ ] Mọi câu có `explain` tiếng Việt nêu quy tắc; câu sai có phần sửa.
- [ ] Không câu nào trùng nguyên văn; ngữ cảnh đa dạng.
- [ ] `subtype` (level) đặt cho mọi câu; phân bổ theo Tier.

---

## 12. Tham chiếu
- Khuôn trống: `docs/grammar-quiz-banks/_TEMPLATE.md`
- Bài mẫu chuẩn (làm theo): `docs/grammar-quiz-banks/G-tenses-present-perfect.md`
- Danh sách chủ đề bắt buộc phủ: `docs/GRAMMAR_QUIZ_COVERAGE_MATRIX.md`
- Schema nguồn (đừng sửa): `backend/services/quiz_import.py`, engine `frontend/js/quiz-engine.js`
- Import: admin → `POST /admin/quiz/import?topic_id=<grammar topic>&dry_run=true` (xem trước) rồi `dry_run=false`.
