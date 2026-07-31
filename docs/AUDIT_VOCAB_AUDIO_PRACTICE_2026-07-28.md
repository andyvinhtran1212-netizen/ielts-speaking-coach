# Audit: thẻ từ vựng (audio) + phần Luyện tập từ vựng — 2026-07-28

> **TRẠNG THÁI: ĐÃ SỬA.** Toàn bộ 11 hạng mục dưới đây đã được vá. Chi tiết bản vá,
> phân loại mức nghiêm trọng và các lệnh cần chạy: `docs/AUDIT_VOCAB_FIXES_2026-07-28.md`.
> Cổng kiểm tra tự động: `cd backend && python -m scripts.verify_vocab_quiz_health`.

Phạm vi: `/pages/vocabulary.html#vocab-topics` (thẻ từ + audio) và luồng **Luyện tập**
(`vocab-practice.html` → `quiz.html` → `quiz-progress.html`).
Dữ liệu đọc trực tiếp từ Supabase prod (`huwsmtubwulikhlmcirx`) + API prod Railway,
cộng một lượt kiểm tra thật trên trình duyệt (đã tạo 1 session + 1 attempt sai trên bank L08).

---

## PHẦN 1 — Audio của thẻ từ vựng

### Kết luận: audio ĐẦY ĐỦ 100%. Không có lỗ hổng dữ liệu.

| Kiểm tra | Kết quả |
|---|---|
| Tổng thẻ `vocab_cards` | **1 835** |
| Thiếu `audio_headword` | **0** |
| Có `example` nhưng thiếu `audio_example` | **0** (14 thẻ không có example → không cần) |
| `audio_status = final` | 1 835 / 1 835 |
| Thiếu IPA (`pronunciation`) | 0 |
| URL audio phân biệt | 3 569 |
| **HEAD-probe toàn bộ 3 569 URL** | **3 569 × HTTP 200, `audio/mpeg`**, 2.8 KB–32.9 KB |
| URL trỏ về project Supabase cũ (đã xoá) | 0 — tất cả đã ở `huwsmtub` |
| 1 file audio bị dùng cho 2 từ khác nhau | 0 |
| `audio_headword == audio_example` cùng dòng | 0 |

Kiểm tra qua API prod `/api/vocabulary/categories`: **811 từ curated trong 31 chủ đề,
0 từ thiếu audio, 0 thiếu IPA, 0 thiếu gloss VN**. Endpoint chi tiết
`/api/vocabulary/articles/{cat}/{slug}` trả cả `audio_headword` + `audio_example`.

Nội dung khớp text: hàm băm content-addressed đảm bảo 1 text → 1 file; không phát hiện
trường hợp file nói sai từ. Chỉ có 1 dị thường vô hại: "artificial intelligence" có 2 URL
audio khác nhau (2 thẻ ở 2 chủ đề, cùng nội dung).

### Nơi audio bị MẤT không phải do dữ liệu, mà do màn hình

| Màn hình | Audio từ | Audio câu ví dụ |
|---|---|---|
| Wiki master-detail `/vocabulary.html` | ✅ (cả hàng danh sách + thẻ chi tiết) | ✅ |
| Thẻ từ đơn `vocab-article.html` | ✅ | ✅ |
| Flashcards theo chủ đề `flashcard-study.html?stack=wiki:` | ✅ | ✅ |
| Flashcards luyện thi `?exam=` | ✅ | ✅ |
| Popup "📇 Xem nhanh thẻ từ" trong quiz | ✅ | ✅ |
| Câu hỏi quiz | ✅ (chỉ 1 dạng câu/từ — xem Phần 2) | ❌ |
| **Flashcards SRS cá nhân** (`flashcard-study.html?stack=<uuid>`) | ❌ **KHÔNG có nút nghe nào** | ❌ |

**Phát hiện A1 — Flashcards SRS cá nhân không có audio.**
`renderCard()` (nhánh `mode='personal'`, `frontend/js/flashcard-study.js:397`) không render
nút 🔊 nào — khác hẳn `renderWikiCard()`. Gốc rễ ở backend: `_VOCAB_FIELDS` và
`_vocab_card_view()` (`backend/routers/flashcards.py:766, 361`) đọc từ `user_vocabulary`,
bảng này **không có cột audio nào**. Học viên ôn bộ thẻ cá nhân không nghe được phát âm,
kể cả fallback TTS trình duyệt.
*Mức độ thực tế: thấp — xem A2, gần như không ai vào được màn hình này.*

---

## PHẦN 2 — Phần "Luyện tập" (Quick-Check)

### 2.1 Nội dung: rất chắc về cấu trúc

30 bank `L01`–`L30`, tất cả `is_published = true`, **719 từ**, **8 847 câu hỏi**
(~12 câu/từ), phủ 15 kỹ năng.

Kiểm tra tính toàn vẹn — **0 lỗi** ở mọi hạng mục có thể chặn học viên:

- 0 câu MCQ có `answer` ngoài phạm vi `options`; 0 options rỗng; 0 options trùng
- 0 câu `text` thiếu `accept`; 0 câu `boolean` sai kiểu; 0 `segments` < 2
- 0 câu dùng `input` mà player không render được
- 0 từ thiếu câu production (bắt buộc để "thuộc"); 0 từ có < 2 kỹ năng đếm điểm
  → **không có từ nào bị kẹt vĩnh viễn** trong vòng lặp adaptive
- 0 placeholder chưa thay; 0 `gap_text` thiếu chỗ trống `____`
- Phân bố đáp án MCQ cân bằng (index 0/1/2/3 = 1578/1485/1265/1237),
  boolean 347 Đúng / 372 Sai → không đoán mò được theo vị trí
- Trùng `qid` 348 cặp nhưng **chỉ giữa các bank khác nhau** (28 từ nằm ở 2–3 lesson),
  engine chạy theo từng bank nên vô hại

### 2.2 Lỗi nội dung thật (cần sửa)

**B1 — 11 câu điền từ KHÔNG THỂ trả lời** (không có bất kỳ manh mối từ vựng nào):

| Bank | qid | Đề bài | Đáp án |
|---|---|---|---|
| L02 | `burn_the_midnight_oil_v10` | `I ____.` | burn the midnight oil |
| L02 | `pass_with_flying_colors_v10` | `I ____.` | pass with flying colors |
| L06 | `read_someone_s_mind_v9` | `You ____!` | read my mind |
| L07 | `get_the_wrong_end_of_the_stick_v9` | `He ____.` | get the wrong end of the stick |
| L25 | `have_a_sweet_tooth_v9` | `She ____.` | has a sweet tooth |
| L25 | `bite_off_more_than_you_can_chew_v9` | `I ____.` | bit off more than I could chew |
| L25 | `eat_like_a_horse_v11` | `He ____.` | eat like a horse |
| L18 | `it_s_a_small_world_v9` | `____!` | it's a small world |
| L18 | `think_globally_act_locally_v10` | `____.` | think globally, act locally |
| L24 | `only_time_will_tell_v10` | `____.` | only time will tell |
| L30 | `fit_like_a_glove_v11` | `It ____.` | fit like a glove |

Trong L02 hai câu `I ____.` còn **trùng đề nhau** với 2 đáp án khác nhau.
Đây là subtype `gap_reflex` — thiết kế "phản xạ" nhưng với thành ngữ thì mất hết ngữ cảnh.
Sửa: thêm ngữ cảnh vào đề, hoặc chuyển sang `hint` (cột `hint` đã có từ migration 159
nhưng **0/8 847 câu vocab đang dùng**).

**B2 — 5 câu spelling có đáp án dạng "hoặc/ngoặc", gần như không gõ đúng được:**

| Bank | Từ | `accept` duy nhất |
|---|---|---|
| L15 | Corporate Social Responsibility (CSR) | `corporate social responsibility (csr)` |
| L15 | In the red / In the black | `in the red / in the black` |
| L01 | Lenient / Permissive | `lenient / permissive` |
| L05 | Steeped in history/tradition | `steeped in history/tradition` |
| L18 | Import / Export | `import / export` |

Câu `type='spelling'` **tắt hoàn toàn dung sai lỗi chính tả** (`textFuzzyAllowed()`,
`quiz-engine.js:97`), và `normalizeText()` chỉ cắt dấu câu ở **hai đầu** chuỗi — nên
gõ "corporate social responsibility" hay "in the red" đều bị chấm SAI.
Cùng lớp lỗi với 29 đáp án `plant(s) / mustard` đã sửa bên Reading.

Dữ liệu thật xác nhận: `Corporate Social Responsibility (CSR)` là từ sai nhiều nhất toàn hệ
thống (24 lượt sai) và bị `carried_over` ở 5 học viên khác nhau với `production_done = false`.

Cùng nhóm rủi ro: **163 câu spelling yêu cầu gõ cụm ≥3 từ, chỉ 1 dạng chấp nhận, không dung sai**.

**B3 — 61 câu MCQ lộ đáp án ngay trong đề** (đáp án đúng nằm luôn trong từ khoá in đậm):
- `collocation` 32 câu — vd: `Cụm nào đi ĐÚNG với **Wipe out**?` → đáp án `wipe out a species`
  (đã xác nhận trực tiếp trên trình duyệt), `**To date back to**` → `date back to`
- `word_form` 23 câu — vd: `Trong họ từ của **Tuition fees**, dạng danh từ là từ nào?` → `tuition`
- `def_cloze` 4, `synonym` 1, `meaning_vn_en` 1

**B4 — 719/719 giải thích của câu collocation là lời nói lặp** (100% loại này, 8% tổng số câu):
`Đúng: "wipe out a species".` — trong khi UI đã in "Đáp án đúng: wipe out a species" ngay
phía trên. Học viên không được giải thích vì sao 3 lựa chọn kia sai.
Ngoài ra 111 câu có `explain` < 20 ký tự.

**B5 — 43 đề bài trùng nhau trong cùng một bank.** Chủ yếu là
`Câu nào đúng ngữ pháp / cách dùng từ?` lặp cho **mọi từ** trong bank (18–22 lần/bank).
Không sai, nhưng học viên gặp đúng một câu hỏi đó hơn 20 lần mỗi bài.

### 2.3 Logic bài test: đúng và chắc

Engine `quiz-engine.js` (adaptive mastery) — đã đọc kỹ, không tìm thấy lỗi logic:

- Thuộc = `correct_to_master`(2) kỹ năng **khác nhau** + ≥1 câu tự gõ + xác nhận đảo chiều
- Chống đoán mò: MCQ đúng lần đầu chỉ được credit "tạm" (`provisional`), phải đúng thêm
  1 câu kỹ năng khác mới tính — và UI có nói rõ điều này cho học viên
- Cooldown 3, xoay vòng từ, `max_attempts_per_word` 8 → `carried_over` (không kẹt vô hạn)
- `pickVariant` có nhánh riêng để không bao giờ đốt lượt vào cùng một kỹ năng đang chờ xác nhận
- Random theo seed = `session_id` → thứ tự từ + thứ tự đáp án khác nhau giữa học viên,
  nhưng ổn định khi resume; chấm điểm vẫn dùng index gốc (`data-oi`) → xáo trộn không ảnh hưởng
- `get_resume`/`start_session` **fail closed**: lỗi đọc tiến độ → 500, không tạo session
  trắng đè lên tiến độ cũ
- Outbox + `keepalive` beacon + upsert idempotent theo `client_id`; `finish()` chỉ đánh dấu
  `completed` khi flush thành công, không thì `paused`

Dữ liệu vận hành xác nhận: 230 phiên vocab / 15 học viên, độ chính xác TB **85.9%**,
2 128 từ đạt `mastered`, chỉ 32 `carried_over`. Vòng lặp hoạt động đúng thiết kế.

**Điểm cần lưu ý (không phải bug):** `start_session` tạo dòng session ngay khi mở trang.
83/230 phiên vocab (36%) có 0 câu hỏi. `student_progress` đã lọc theo `ended_at` nên
số liệu học viên thấy không bị thổi phồng — nhưng bảng `quiz_sessions` thì có rác.

### 2.4 Hiển thị câu hỏi + đáp án: tốt

Đã kiểm tra thật trên prod (bank L08):

- Đề bài render `**đậm**` và `____` đúng; token `{{audio}}` được strip sạch, không lọt ra UI
- Có dòng hướng dẫn riêng theo từng dạng ("Chọn đáp án đúng." / "Gõ đáp án vào ô trống (2 từ).")
- Chấm ngay khi click; ✓ xanh ở đáp án đúng, ✗ đỏ ở lựa chọn sai của học viên
- Panel phản hồi: verdict → đáp án đúng → giải thích → "📇 Xem nhanh thẻ từ"
- Popup thẻ từ đầy đủ: IPA, nghĩa VN + EN, 🔊 nghe từ, ví dụ + 🔊 nghe ví dụ, collocations,
  đồng nghĩa, trái nghĩa, lỗi thường gặp, mẹo nhớ — **đây là điểm mạnh nhất của luồng**
- Gõ sai chính tả nhẹ ở câu `gap_text` vẫn được chấp nhận và hiện "Đáp án chuẩn: …"

**Câu hỏi có audio:** đúng **719 câu — 1 câu/từ**, luôn là câu `spelling`
("Gõ từ tiếng Anh có nghĩa: … 🔊"). Nghĩa là audio chỉ xuất hiện ở **1/12 câu hỏi**;
không có dạng "nghe → chọn nghĩa", "nghe → chọn trọng âm", "nghe câu ví dụ".
Về mặt kỹ thuật đã được vá tốt: chỉ 261/719 câu có `audio_url` lưu sẵn, 458 câu còn lại
được `_resolve_question_audio()` gắn live từ `vocab_cards.audio_headword` khi phục vụ →
**0 câu audio bị mất nút 🔊**. Có prefetch 2 từ kế tiếp nên phát tức thì.

---

## PHẦN 3 — Review câu sai & xem tiến độ

### C1 — Review trong phiên: ĐÃ CÓ và làm tốt
Màn hình kết quả có "Xem lại bài làm": mặc định chỉ hiện câu sai, toggle xem tất cả.
`buildReviewList()` gộp theo `qid`, giữ lần trả lời **sai gần nhất** kèm số lần sai, rồi
mới hiện đáp án đúng — đúng thứ tự người học cần. Có chip "từ cần ôn" bấm mở thẻ từ.

### C2 — Review SAU phiên: KHÔNG CÓ (lỗ hổng lớn nhất)
`sessionLog` chỉ nằm trong RAM của tab. **Rời màn hình kết quả là mất sạch.**
Dữ liệu thì vẫn còn ở server (6 948 dòng `quiz_attempts` có đủ `qid`, `answer_given`,
`is_correct`) nhưng **không có endpoint nào để học viên đọc lại attempt của chính mình** —
`routers/quiz.py` chỉ có banks / resume / reset / sessions / progress.

Tương tự, `quiz_word_stats.is_difficult` đang bật cho **1 029/2 183 dòng (47%)** —
hệ thống *biết* từ nào học viên hay sai nhưng **chưa bao giờ hiển thị cho họ**.

### C3 — Trang tiến độ `quiz-progress.html`: có, nhưng mỏng và lẫn kỹ năng
Hiện: tổng thời gian, số phiên, số từ đã thuộc, độ chính xác TB, thanh tiến độ theo bank,
bảng 20 phiên gần nhất.

Thiếu / sai:
- **Không lọc theo skill_area.** `student_progress()` trả cả bank *grammar* và phiên grammar,
  trong khi lối vào là "📊 Tiến độ luyện tập" từ trang Từ vựng và nút back ghi "← Luyện tập".
  (`admin_student_detail` đã lọc `skill_area`, còn view của chính học viên thì không.)
- Không có danh sách từ hay sai, không có biểu đồ xu hướng, không mở lại được phiên cũ.

### C4 — Chỉ số trên trang Từ vựng đang nói SAI về tiến độ *(nghiêm trọng)*
Ô "Từ đã học" đọc `user_vocabulary` (ví cá nhân từ auto-discovery), **không** đọc
`quiz_word_stats`. Đối chiếu prod:

- 13 học viên có từ `mastered` trong Quick-Check (nhiều nhất: 128 từ)
- 1 học viên có dòng trong `user_vocabulary` (96 dòng)
- **Giao nhau: 0**

→ **Cả 13 học viên thực sự luyện tập đều thấy "Từ đã học: 0 từ"** ngay trên trang Từ vựng.
"Bộ Flashcards" thì hardcode `—`.

### C5 — 2/4 mode-card trên trang Từ vựng là ngõ cụt với gần như mọi học viên
"Flashcards" và "Exercises" đều gate bằng `feature_flags` (default-deny, `is_flashcard_enabled`
/ `is_d1_enabled`). Trong `users`: **67/68 người có `feature_flags` rỗng**, chỉ 1 người bật.
Bấm vào → "Tính năng chưa được bật" / "Exercises are not enabled".
Đây cũng là lý do phát hiện A1 gần như không ảnh hưởng thực tế.

### C6 — Lối vào "✍️ Luyện tập" trên thẻ chủ đề bỏ qua chủ đề đã chọn
Link cứng `quiz.html?skill_area=vocab`; vì có 30 bank published (>1) nên
`resolveBankId()` luôn `location.replace('/pages/vocab-practice.html')`.
Học viên chọn "Environment" rồi vẫn phải chọn lại lesson từ L01–L30.
Nguyên nhân gốc: taxonomy lesson (L01–L30) ≠ taxonomy chủ đề wiki — nhưng
`quiz_banks.topic_id` **đã có sẵn** ở cả 30 bank, đủ để map.

### C7 — Hai chủ đề gần như rỗng trên trang chủ đề
`economy` (0 từ curated / 142 thẻ đều là exam) bị ẩn khỏi lưới;
`people-society` chỉ còn **3 từ** curated trên tổng 221 thẻ.

---

## Ưu tiên đề xuất

| # | Việc | Vì sao |
|---|---|---|
| 1 | Ô "Từ đã học" đọc từ `quiz_word_stats` (hoặc gộp cả hai) | 13/13 học viên đang thấy số 0 sai sự thật (C4) |
| 2 | Sửa 5 đáp án "hoặc/ngoặc" + nới `accept` cho 163 câu spelling cụm dài | Câu không thể chấm đúng, chặn mastery (B2) |
| 3 | Sửa/thêm ngữ cảnh cho 11 câu điền từ không manh mối | Không thể trả lời (B1) |
| 4 | Endpoint + màn "Từ tôi hay sai" từ `quiz_attempts` / `is_difficult` | Đúng yêu cầu review lại câu sai; dữ liệu đã có sẵn (C2) |
| 5 | Lọc `student_progress` theo `skill_area` | Trang tiến độ vocab đang lẫn grammar (C3) |
| 6 | Sửa 61 câu MCQ lộ đáp án | Điểm ảo, sai tín hiệu mastery (B3) |
| 7 | Bật `feature_flags` hoặc gỡ 2 mode-card chết | 67/68 học viên bấm vào ngõ cụt (C5) |
| 8 | Map `topic_id` cho nút "Luyện tập" trên thẻ chủ đề | Bỏ 1 bước chọn lại thừa (C6) |
| 9 | Viết lại 719 `explain` của câu collocation | 100% loại này là lời nói lặp (B4) |
| 10 | Bổ sung dạng câu có audio (nghe → nghĩa / trọng âm) | Audio đủ 100% nhưng chỉ dùng ở 1/12 câu hỏi |
| 11 | Thêm audio cho flashcards SRS cá nhân | Chỉ đáng làm sau khi mở feature flag (A1) |

Không cần migration cho hạng mục 1–6, 8–10 (sửa dữ liệu / query / nội dung).
Hạng mục 4 cần thêm route đọc; hạng mục 11 cần cột audio trên `user_vocabulary`.
