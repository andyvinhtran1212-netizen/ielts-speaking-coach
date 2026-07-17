# Audit Grammar Quiz — hiển thị câu hỏi rối & không xem lại được bài sau khi làm xong (2026-07-17)

**Bối cảnh:** người dùng báo 2 vấn đề khi làm Quick Check từ Grammar Wiki (screenshot: bank `G-foundations-parts-of-speech`, câu `pos_id_i2`):
1. Phần hiển thị câu hỏi rối mắt — yêu cầu, câu hỏi chính và gợi ý trộn vào nhau.
2. Làm xong chỉ thấy màn "hoàn tất" — không có chỗ xem lại các câu đã trả lời / các câu sai.

**Phạm vi:** 139 bank grammar (3.019 câu, trong đó 592 gap_text) tại `docs/grammar-quiz-banks/`; engine `frontend/js/quiz-engine.js`; player `frontend/public/pages/quiz.html`; trang thống kê `quiz-progress.html`; routes `backend/routers/quiz.py`; import `backend/services/quiz_import.py`.

**Quan hệ với audit 2026-07-16** (`AUDIT_GRAMMAR_QUIZ_UX_CONTENT_2026-07-16.md`): Đợt 2 UI của audit đó **đã ship** (PR #793 — dòng instruction theo loại câu, copy grammar, hiện provisional). Audit này đi tiếp 2 tầng audit trước chưa chạm: (a) cấu trúc *bên trong* chuỗi prompt, (b) luồng *sau khi* làm xong. Findings máy-quét kèm file `AUDIT_GRAMMAR_QUIZ_DISPLAY_REVIEW_2026-07-17.findings.json` (qid lấy trực tiếp từ file bank — không hallucinate; riêng **nhãn phân loại** là heuristic, cần thẩm định từng câu trước khi sửa).

---

## I. VẤN ĐỀ 1 — Hiển thị câu hỏi rối (yêu cầu / câu chính / gợi ý trộn nhau)

### Root cause: schema chỉ có `prompt` — không có field `hint`/`instruction` riêng

`quiz_import.py` chỉ nhận `prompt`, `options`, `accept`, `explain`… Mọi thứ tác giả muốn nói thêm (cách trả lời, gợi ý dạng từ, số từ cần gõ) **buộc phải nhét vào chuỗi prompt**, và `renderQuestion()` render nguyên chuỗi đó thành MỘT thẻ `<p class="qz-prompt">` cỡ chữ lớn, in đậm — không có phân tầng thị giác nào.

Câu trong screenshot (`pos_id_i2`) là ca điển hình — 1 chuỗi chứa 3 vai trò:

```
Complete with the correct part of speech:      ← instruction nhúng (tiếng Anh)
'His ____ (speak) English is very good.'       ← câu chính + từ gốc cần biến đổi
— write the word needed here (adjective form   ← instruction nhúng lần 2 + hint dài
of 'speak' that means 'in spoken form').
```

### D1. Trùng lặp 3–4 lớp chỉ dẫn trên cùng một màn hình — HIGH (UX)

Sau PR #793, với câu gap_text người học đồng thời thấy:
1. `qz-sub` (cố định dưới progress bar): "Trả lời đúng mỗi điểm ngữ pháp ở nhiều dạng câu…"
2. Instruction **nhúng trong prompt**: "Complete with the correct part of speech… — write the word needed here…"
3. `qz-instr` (dòng mới từ #793): "Gõ đáp án vào ô trống."
4. Placeholder của input: "Gõ đáp án…"

→ 3 câu lệnh "hãy gõ" bằng 2 thứ tiếng, trong khi **câu đề thật bị chôn giữa chuỗi**, phải tự lọc bằng mắt. Đây chính là cái "rối" người dùng mô tả. Quét máy: **135 câu gap_text** có instruction nhúng kiểu "— write…/Complete with…" (48 bank, nặng nhất là cụm `G-foundations-*`: 4–5 câu/bank); **35 câu** vừa dài >140 ký tự vừa có đủ cả instruction nhúng + hint ngoặc + câu chính.

### D2. Instruction nhúng bằng tiếng Anh trong bank Foundations — MED

Foundations là tầng cho người mới (band thấp nhất), nhưng meta-instruction lại là tiếng Anh học thuật ("write the word needed here", "functioning as an OBJECT") — **khó hơn chính câu hỏi**. Các bank khác (error-clinic, modifiers…) dùng tiếng Việt ("viết đúng dạng", "chỉ gõ 1 từ") → không nhất quán cả về ngôn ngữ lẫn vị trí.

### D3. Hint trong ngoặc LỘ ĐÁP ÁN trên diện rộng — HIGH (content)

Audit 16/07 (P5) mới bắt 2 câu lẻ; sweep hệ thống lần này (accept xuất hiện nguyên văn trong prompt) ra **~92 câu gap_text nghi lộ**, chia 4 lớp (chi tiết trong findings.json):

| Lớp | Số câu | Mô tả | Ví dụ |
|---|---|---|---|
| B — đáp án lọt trong hint mô tả | 24 | Hint dài vô tình chứa đáp án | `pos_id_i2` (câu screenshot!): hint "…that means **'in spoken form'**" — accept là `spoken`; `acn_subord_i2`: "(write 'even though')" — accept `Even though` |
| A — hint = nguyên văn cụm đáp án | 32 | Cho sẵn cụm, bắt gõ lại | `oat_fixed_i2` "(in other words)" accept `in other words`; cả series `dms_*` (you know / sort of / the thing is) |
| A-i — "biến đổi rỗng" | 31 | Convention `(verb)` = chia dạng đúng, nhưng dạng đúng **trùng nguyên mẫu** → thành cho đáp án | `dm_noise_i2` "they ____ (make)" accept `make`; `ps_truth_i2` (argue), `rrc_main_i2` (recommend) |
| C — hint lựa chọn (x/y) kèm lý do | 5 | MCQ trá hình: hint vừa cho 2 phương án vừa giải thích nên chọn cái nào | `mma_much_i2` "(many/much — choose for 'legroom', an **uncountable** noun)" |

Lưu ý thẩm định: (a) lớp B có false-positive — bài scan/substitution mà đáp án *hợp lệ* lặp lại từ trong đoạn (vd `cmp_naa_i1`, `sub_one_i1` — cần đọc tay từng câu); (b) lớp A/A-i **có thể là chủ ý** "guided production" (vì `require_production_to_master` bắt buộc có câu tự gõ) — nhưng hệ quả đo lường = 0 (copy-to-pass) và chính nó gây khó hiểu kiểu "đưa sẵn đáp án rồi bắt gõ lại làm gì?". Nếu giữ chủ ý này thì instruction phải nói thẳng ("gõ lại chính xác cụm sau") thay vì giả dạng câu hỏi.

### Đề xuất sửa (vấn đề 1)

1. **Schema: thêm field `hint` (optional) cho câu hỏi** — migration cột `quiz_questions.hint` + `quiz_import.py` nhận + serve + `renderQuestion()` render thành dòng riêng nhỏ, màu muted, sau widget hoặc ngay dưới prompt (`💡 gợi ý: dạng tính từ của 'speak'`). Instruction "cách trả lời" đã có `qz-instr` (#793) lo — **cấm tác giả nhúng instruction vào prompt** từ nay (thêm mục vào `GRAMMAR_QUIZ_AUTHORING_GUIDE.md`).
2. **Content wave — tách 135 prompt nhúng instruction**: script bán tự động tách phần "— write…/Complete with…" và ngoặc hint ra khỏi prompt (đưa vào `hint` mới), dịch instruction tiếng Anh → tiếng Việt cho cụm Foundations; review tay trước khi re-import.
3. **Sửa lớp lộ đáp án**: B (24 câu) — viết lại hint không chứa đáp án (ca `pos_id_i2`: đổi hint thành "dạng tính từ của 'speak' (V3)" hoặc bỏ hẳn vì đã có "(speak)" trong câu); A-i (31 câu) — đổi ngôi/thì để dạng đúng ≠ nguyên mẫu; A (32 câu) — hoặc đổi instruction thành "gõ lại chính xác cụm sau" (nếu giữ guided-copy), hoặc chuyển hint thành mô tả nghĩa; C (5 câu) — chuyển thành `gap_mcq` 2 option cho trung thực với bản chất.
4. **Lint mới cho `validate_grammar_quiz_bank.py`**: (a) accept nguyên văn nằm trong prompt của gap_text (trừ pattern Viết lại/Sửa/Đoạn/Passage), (b) prompt chứa `— write|Complete with` (sau khi content wave xong → chặn tái phát).

---

## II. VẤN ĐỀ 2 — Không xem lại được câu đã làm sau khi kết thúc

### Hiện trạng (đã kiểm code, không phải giả thuyết)

| Điểm kiểm | Kết quả |
|---|---|
| Màn `#qz-summary` (quiz.html) | Chỉ có aggregate: thời gian, số câu, đã nắm x/y, độ chính xác, đúng/sai, "điểm khó nhất". **Không có danh sách câu đã làm.** |
| Chip "Cần ôn lại" | Chỉ là item_key (điểm ngữ pháp bị carry-over). Với grammar **không click được** (không có glance card — hint bấm-để-xem bị ẩn chủ đích trong `wireChrome()`), và chỉ hiện khi còn điểm chưa nắm — phiên nắm hết 4/4 thì card này **ẩn luôn**, dù người học có thể đã sai nhiều lần dọc đường. |
| Engine (`quiz-engine.js`) | `attemptsBatch` bị **drain** lên backend theo lô rồi xoá khỏi memory; `summary()` chỉ trả counters. Client không giữ lịch sử câu + đáp án đã đưa. |
| Backend (`routers/quiz.py`) | Chỉ có POST `/sessions/{id}/progress` (ghi). **Không có GET attempts** cho học viên — `quiz_attempts` hiện chỉ phục vụ admin analytics. |
| Trang Thống kê (`quiz-progress.html`) | Cũng chỉ aggregate (tổng, theo bộ, phiên gần đây). |
| Link "📖 Ôn lại bài" (về bài Wiki) | Chỉ hiện **thoáng qua** trong feedback ngay sau câu sai; bấm "Tiếp →" là mất. |
| Chế độ "Ôn tập lại" (mastered gate) | reviewMode drop toàn bộ attempts (chủ đích, không ghi analytics) → càng không có gì xem lại. |

→ Đúng như người dùng mô tả: sau câu cuối là `finish()` → màn done, mọi câu hỏi + đáp án + giải thích biến mất.

### Đề xuất: màn "Xem lại các câu đã làm" — thuần client, không cần backend

Mọi dữ liệu cần thiết đều đi qua tay `grade()` (quiz.html) ngay trước khi mất: `q` (prompt, options, answer, accept, explain, article_url), đáp án người dùng, `res.correct`. Chỉ cần:

1. **Log phiên trong quiz.html**: mảng `sessionLog`, mỗi `grade()` push `{qid, item_key, prompt, given, correctText, correct, explain, article_url, attempt_no}`. Hoạt động cả ở reviewMode (log là in-memory, độc lập với việc không persist).
2. **`renderResult()` thêm card "Xem lại bài làm"**: mặc định lọc **các câu sai** (đúng trọng tâm "review lại các câu sai"), toggle "Hiện tất cả". Mỗi item: câu đề (đã strip `{{audio}}`), "Bạn trả lời: …", "Đáp án đúng: …", explain, link 📖 Ôn lại bài (article_url — đưa link này về vị trí bền thay vì chỉ thoáng qua).
3. **Group theo qid**: một câu có thể bị hỏi lại và đúng ở lần sau (adaptive loop) — hiện attempt cuối + badge "sai N lần trước đó" để không báo "sai" một câu người học đã sửa được.
4. Giữ nguyên hợp đồng backend — không đổi API, không đổi engine (log đặt ở tầng page, engine vẫn pure). Ước lượng ~100–120 dòng HTML+JS trong quiz.html, 1 PR nhỏ, có thể test bằng `node --test` (tách hàm build-review-list thuần ra module nếu muốn test).

Phương án backend (GET attempts theo session) **không cần** cho nhu cầu này — chỉ cân nhắc sau nếu muốn xem lại bài làm của *các phiên cũ* từ trang Thống kê.

---

## III. ƯU TIÊN HÀNH ĐỘNG

1. **PR UI nhỏ (làm ngay, độc lập content):** màn "Xem lại bài làm" (§II) + bỏ bớt 1 lớp chỉ dẫn trùng (đổi placeholder input thành ví dụ định dạng, hoặc bỏ placeholder khi `qz-instr` đã hiện).
2. **Data hotfix (không cần code):** 24 câu lớp B lộ đáp án — thẩm định tay từng qid trong findings.json, sửa hint, re-import. Ưu tiên `pos_id_i2` (câu người dùng chụp) + cụm Foundations.
3. **Schema `hint` + content wave 135 câu** (§I đề xuất 1–2): migration nhỏ + script tách prompt + dịch instruction Foundations sang tiếng Việt.
4. **Content wave lộ-đáp-án còn lại** (A/A-i/C ≈ 68 câu) + 2 lint mới — gộp chung đợt 3 của audit 16/07 (vẫn chưa chạy) để re-import một lần.

**Artifacts:** `AUDIT_GRAMMAR_QUIZ_DISPLAY_REVIEW_2026-07-17.findings.json` (cùng thư mục) — danh sách qid đầy đủ theo lớp, kèm prompt + accept để thẩm định.
