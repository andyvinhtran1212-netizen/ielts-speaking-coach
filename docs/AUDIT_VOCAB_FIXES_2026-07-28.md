# Bản vá cho audit từ vựng + Luyện tập — 2026-07-28

Nhánh: `worktree-audit-vocab-content`.
Audit gốc: `docs/AUDIT_VOCAB_AUDIO_PRACTICE_2026-07-28.md`.
Cổng kiểm tra: `cd backend && python -m scripts.verify_vocab_quiz_health` (exit ≠ 0 nếu còn lỗi).

---

## Phân loại mức nghiêm trọng

| Mức | Tiêu chí | Hạng mục |
|-----|----------|----------|
| **P0** | Học viên nhìn thấy số liệu SAI, hoặc câu hỏi không thể trả lời/không thể chấm đúng | C4, B2, B1 |
| **P1** | Mất dữ liệu học tập đã có, hoặc trộn dữ liệu giữa hai kỹ năng | C2, C3 |
| **P2** | Câu hỏi cho điểm ảo, phản hồi vô nghĩa, ngõ cụt UI, thiếu độ phủ | B3, B4, C5, C6, A1, audio-coverage |

---

## P0

### C4 — "Từ đã học" đọc sai nguồn *(số liệu sai với 13/13 học viên)*
`_build_vocabulary` chỉ đếm `user_vocabulary` (ví cá nhân sau feature flag default-deny).
Đối chiếu prod: 13 học viên có từ `mastered` trong Quick-Check, 1 người có dòng
`user_vocabulary`, **giao nhau = 0** → mọi người thực sự luyện tập đều thấy "0 từ".

- `backend/services/student_home_aggregator.py` — thêm `_vocab_quiz_progress()`
  (đọc `quiz_word_stats` theo trang, chỉ bank vocab đã publish) và **hợp** hai tập
  theo headword viết thường nên từ nằm ở cả hai chỉ đếm một lần. Lỗi phía quiz là
  best-effort: hỏng thì vẫn trả về đúng số của ví cá nhân.
- `frontend/pages/vocabulary.html` + `js/vocab-landing.js` — 3 ô thống kê đổi sang
  mặt Quick-Check: **Từ đã thuộc** / **Từ từng trả lời sai** / **Phiên đã luyện**
  (bỏ ô "Bộ flashcards" vốn hardcode `—`).
- Test: 5 ca mới trong `test_student_home_aggregator.py` (hợp tập, không đếm trùng,
  không lẫn grammar, chỉ đếm phiên đã kết thúc, quiz hỏng vẫn giữ số ví).

### B2 — đáp án không thể chấm đúng
`type='spelling'` **tắt** dung sai lỗi chính tả, còn `normalizeText()` chỉ cắt dấu câu
ở hai đầu chuỗi → `in the red / in the black` phải gõ nguyên cả dấu `/`.
Bằng chứng prod: `Corporate Social Responsibility (CSR)` là từ sai nhiều nhất hệ thống
(24 lượt) và `carried_over` với `production_done=false` ở 5 học viên.

- `backend/scripts/fix_vocab_quiz_accepts.py` — sinh thêm dạng chấp nhận **đã đúng sẵn**
  (tách `/`, tách ngoặc, gạch nối↔space↔liền, dấu nháy thẳng↔cong, bỏ `to`/mạo từ dẫn đầu,
  `one's`→`my/your/…`). Chỉ THÊM, không bỏ dạng nào. Dry-run: **110 câu** được mở rộng,
  trong đó **7 câu trước đây không thể chấm đúng**.
  Nhóm dạng "bỏ mạo từ/`to`" chỉ áp cho câu `spelling` — câu điền vào chỗ trống có ngữ
  pháp cố định nên không được nhận `to climb…` cho ô cần `climbing…`.
- `frontend/js/quiz-engine.js` — ngoại lệ **cụm dài**: câu orthography vẫn chấm chặt,
  trừ khi MỌI dạng chấp nhận đều ≥3 từ VÀ ≥15 ký tự (163 câu như vậy đang sống).
  Ngưỡng đặt cao có chủ đích: `in the red` (3 từ, 10 ký tự) vẫn chặt vì `in the bed`
  chỉ cách 1 phép sửa; một dạng ngắn như `csr` kéo cả câu về chấm chặt.
- Test: 3 ca mới trong `quiz-engine.test.mjs` (chấp nhận 1 lỗi trong cụm dài; cụm ngắn
  vẫn chặt; một dạng ngắn ghim cả câu về chặt).

### B1 — câu điền từ không có manh mối
`gap_reflex` rút câu xuống còn `I ____.` — với thành ngữ thì mất sạch thông tin,
và L02 có hai câu `I ____.` trùng nhau, hai đáp án khác nhau.

- `backend/scripts/fix_vocab_quiz_cueless_gaps.py` — điền cột `hint` (đã có từ
  migration 159, player đã render sẵn, nhưng **0/8 847** câu vocab dùng) bằng nghĩa
  tiếng Việt của chính từ đó, lấy từ `vocab_cards`, dự phòng là đáp án đúng của câu
  MCQ nghĩa trong cùng bank. Dry-run: **46 câu** (rộng hơn 11 câu đã nêu trong audit —
  ngưỡng là <12 ký tự ngữ cảnh sau khi bỏ chỗ trống).

---

## P1

### C2 — không review lại được câu sai sau phiên
`sessionLog` chỉ nằm trong RAM của tab. Dữ liệu vẫn còn (6 948 dòng `quiz_attempts`,
`is_difficult` bật ở 47% dòng `quiz_word_stats`) — thiếu đúng một đường đọc.

- `backend/services/quiz_service.py` — `student_mistakes()`: gom câu sai mới nhất theo
  từ → theo câu hỏi, join `quiz_questions`, và **dịch `answer_given` sang chữ**
  (bảng lưu chỉ số phương án, không phải nội dung). Đọc `quiz_questions` chia lô 100 qid
  vì `in_()` nằm trong query string.
- `backend/routers/quiz.py` — `GET /api/quiz/mistakes?skill_area=`.
- `frontend/pages/quiz-progress.html` — mục **"Câu tôi đã trả lời sai"**: bấm vào một từ
  để mở đề bài, gợi ý, đáp án đã chọn, đáp án đúng, giải thích. Từ đã thuộc hiển thị
  "✓ đã thuộc" thay vì như lỗi còn mở. Lỗi khi tải mục này không xoá phần tiến độ đã render.
- Test: 7 ca backend + `frontend/tests/quiz-mistakes-page.test.mjs`.

**Hai lỗi phát sinh, bắt được khi kiểm thử lại và đã vá:**

1. **`{{audio}}` lọt ra màn hình.** Chạy hàm render của trang trên payload THẬT
   (47 từ của một học viên prod) cho thấy **16/47 thẻ in nguyên chuỗi `{{audio}}`** —
   đó là placeholder của player, màn review không có nút 🔊 để thay vào.
   Đã strip ở backend (`_display_prompt`) để mọi nơi tiêu thụ đều an toàn, khớp cả dạng
   `**{{audio}}**` (bỏ mỗi token sẽ để lại `****`). Có test ghim.
2. **Hai màn hình báo hai con số.** Trang tiến độ cộng số từ theo từng bank (141) còn ô
   trên hub đếm từ khác nhau (136) — chênh vì 28 từ nằm ở 2 bài. Gộp về MỘT định nghĩa
   dùng chung `quiz_service.mastered_item_keys(sb, …)`, cả hai màn giờ đều đọc số **distinct**.
   Có test ghim (sum theo bank = 4, distinct = 3).

### C3 — trang tiến độ trộn vocab với grammar
- `student_progress(user_id, skill_area)` lọc cả bank lẫn phiên; phiên lọc theo `bank_id`
  **trước** khi cắt 20 dòng (lọc sau sẽ giấu phiên vocab dưới phiên grammar mới hơn).
  `_bank_ids_for_skill()` **fail closed** — lỗi tra cứu thì 500, không im lặng trả về
  toàn bộ kỹ năng.
- `GET /api/quiz/progress?skill_area=`; trang tự đọc `?skill_area=` và đổi cả link quay lại.
- Mọi lối vào vocab (`vocab-landing.js`, `vocab-practice.html`) truyền `skill_area=vocab`;
  màn kết quả của player đóng dấu đúng kỹ năng vừa luyện.

---

## P2

### B3 — 61 MCQ lộ đáp án → `backend/scripts/fix_vocab_quiz_leaks.py`
Ba hình dạng, ba cách vá, không bịa nội dung:

| Hình dạng | Số câu | Cách vá |
|---|---|---|
| Collocation vòng tròn (`Cụm nào đi ĐÚNG với **Throw in the towel**?` → `throw in the towel`) | 32 | Lấy collocation THẬT từ chính thẻ từ (`be ready to throw in the towel`, `never cross one's mind`). **32/32 vá được**, không câu nào phải hạ cấp. Riêng `When in Rome…` thẻ chỉ có đúng câu tục ngữ và một khúc đầu của nó, nên thêm vào thẻ đúng cách diễn đạt mà pipeline nội dung ĐÃ dùng cho câu tục ngữ anh em (`the saying 'prevention is better than cure'`) — theo mẫu có sẵn, không bịa cụm mới |
| Headword nằm trong đề (`**Tuition fees**` → đáp án `tuition`) | 24 | Thay headword in đậm bằng nghĩa tiếng Việt: `Trong họ từ của từ mang nghĩa "học phí", dạng **danh từ** là từ nào?` |
| Đề/phương án tự nói ra đáp án | 9 | Sửa tay từng câu: 4 định nghĩa có mệnh đề đuôi lặp lại từ bị khoét, gloss `"Gen, gene"`, và 2 câu in đáp án cạnh chỗ trống. Sửa cả `vocab_cards.definition_vi` của *Gene* để lần import sau không tái lập |

### B4 — 719 giải thích collocation lặp lại đáp án → `backend/scripts/fix_vocab_quiz_explains.py`
Distractor được lấy từ các từ khác trong cùng bank, và collocation của mọi từ nằm sẵn
trên `vocab_cards`, nên truy ngược được. Giải thích mới:
`Đúng: "…". Cụm khác với **X**: …. Các phương án còn lại đi với: W1, W2, W3.`
Dry-run: **719/719 câu** đều có đủ cả ba mệnh đề (0 câu còn một mệnh đề).

*Ghi chú trung thực:* 111 câu `explain` < 20 ký tự nêu trong audit, khi soi lại thì
hợp lệ (`Obesity ↔ leanness.` là một giải thích đầy đủ cho câu trái nghĩa) — không sửa.

### C5 — 2 mode-card ngõ cụt
67/68 tài khoản có `feature_flags` rỗng (default-deny), nên Flashcards + Exercises
hiện với mọi người rồi mở ra "Tính năng chưa được bật".
- `vocabulary.html` — thêm mode-card **"Luyện tập"** (→ `vocab-practice.html`), thứ duy
  nhất mọi học viên dùng được nhưng trước đây chỉ nằm trong một nút nhỏ ở thẻ chủ đề.
- Hai card còn lại mang `data-flag`; `gateModeCards()` đọc `/auth/me` và **gỡ khỏi DOM**
  (không phải `display:none`) khi flag tắt. Lỗi đọc `/auth/me` → cũng gỡ (default-deny).
- Test: 3 ca trong `vocab-landing.test.js` + 2 ca cấu trúc trong `vocabulary-redesign.test.mjs`.

### C6 — nút "Luyện tập" bỏ qua chủ đề đã chọn
Kiểm chứng: 30/31 chủ đề ánh xạ 1:1 sang một bank qua `topic_id`.
- `vocab_content` đưa `topic_id` vào feed `/api/vocabulary/categories`, **chỉ khi chủ đề
  đồng nhất một topic** (chủ đề lẫn topic thì thà để picker còn hơn vào nhầm bài).
- `vocab-landing.js` truyền `&topic_id=`; `quiz.html` chuyển tiếp vào
  `/api/quiz/banks?...&topic_id=` → 1 bank → vào thẳng. Topic không khớp bank nào →
  quay về picker, không dead-end.
- Test: 3 ca trong `test_vocab_content.py`.

### A1 — flashcards SRS cá nhân không có nút nghe
`user_vocabulary` không có cột audio (thẻ dựng từ transcript của học viên).
- `backend/routers/flashcards.py` — `_audio_by_headword()` / `_with_audio()` resolve
  `audio_headword` từ `vocab_cards` theo headword lúc phục vụ (cùng cách
  `quiz_service._resolve_question_audio` làm, không cần migration).
- `flashcard-study.js` — nút 🔊 ở cả mặt trước và mặt sau thẻ cá nhân; không khớp thẻ
  curated thì vẫn chạy bằng speechSynthesis.
- Test: `backend/tests/test_flashcard_card_audio.py` (6 ca, gồm cả hỏng-thì-không-vỡ).

### Độ phủ audio — audio chỉ dùng ở 1/12 câu
`backend/scripts/gen_vocab_listening_questions.py` — thêm **719 câu "nghe → chọn nghĩa"**
(1 câu/từ, 719/719 từ đủ điều kiện). Đáp án là nghĩa của chính từ đó; distractor là nghĩa
của các từ khác trong cùng bank; vị trí đáp án và bộ distractor suy ra từ `qid` nên chạy
lại cho ra đúng cùng kết quả. `skill` là giá trị MỚI (`listening`) — mastery cần N kỹ năng
**khác nhau**, nên thêm kỹ năng chỉ có thể mở rộng đường tới "thuộc", không bao giờ làm kẹt.
Test: `backend/tests/test_gen_vocab_listening_questions.py` (8 ca).

---

## Còn phải chạy — ghi dữ liệu lên prod

Auto mode chặn ghi prod DB, nên 5 lệnh sau cần bạn chạy (gõ `!` rồi dán).
**Thứ tự có ý nghĩa**: `leaks` sửa lại phương án của 31 câu collocation, `explains` giải
thích các phương án ĐÃ sửa đó. Mỗi script chạy lại được nhiều lần (idempotent) và có
dry-run mặc định nếu bạn muốn xem trước.

```bash
cd /Users/trantrongvinh/code/ielts-speaking-coach/.claude/worktrees/audit-vocab-content/backend
python3 -m scripts.fix_vocab_quiz_accepts       --commit   # 110 câu, mở 7 câu bất khả chấm
python3 -m scripts.fix_vocab_quiz_cueless_gaps  --commit   # 46 câu được thêm gợi ý
python3 -m scripts.fix_vocab_quiz_leaks         --commit   # 66 câu lộ đáp án
python3 -m scripts.fix_vocab_quiz_explains      --commit   # 719 giải thích collocation
python3 -m scripts.gen_vocab_listening_questions --commit  # +719 câu nghe
python3 -m scripts.verify_vocab_quiz_health                # phải in "All checks passed."
```

Sau khi chạy xong: `vocab_service.reload()` không cần thiết (quiz đọc thẳng DB mỗi
request), nhưng script `leaks` có sửa 1 dòng `vocab_cards` nên hãy redeploy Railway
hoặc gọi admin reload để wiki nhận nghĩa mới của *Gene*.

## Đã mô phỏng trước: các lệnh trên sẽ dọn sạch cổng kiểm tra

Áp bản vá của từng script vào dữ liệu prod **trong bộ nhớ** rồi chạy lại đúng phép
kiểm của cổng:

| Kiểm | Trước | Sau (mô phỏng) |
|---|---|---|
| B2 mọi dạng chấp nhận đều cần `/` hoặc `()` | 6 | **0** |
| B3 MCQ có đáp án nằm trong đề | 61 | **0** |
| B4 giải thích collocation chỉ lặp đáp án | 719 | **0** (719/719 có đủ 3 mệnh đề) |
| Câu bị hạ `counts_toward_mastery` | – | **0** |

B1 là 0 theo cấu tạo: cổng kiểm tra cột `hint` không rỗng, và script điền đúng 46 câu đó.

## Trạng thái cổng kiểm tra (trước khi chạy các lệnh trên)

```
✓ A1 cards missing headword audio                0
✓ A2 cards with an example but no example audio  0
✗ B1 cue-less typed items with no hint           46   → fix_vocab_quiz_cueless_gaps
✗ B2 items whose every accepted form needs …      6   → fix_vocab_quiz_accepts
✗ B3 MCQs whose answer appears in the prompt     61   → fix_vocab_quiz_leaks
✗ B4 collocation explanations that restate …    719   → fix_vocab_quiz_explains
✓ M1 words with no production item                0
✓ M2 words with too few distinct counting skills  0
✓ S1 structurally broken questions                0
✓ A3 audio questions with no resolvable audio     0
```
