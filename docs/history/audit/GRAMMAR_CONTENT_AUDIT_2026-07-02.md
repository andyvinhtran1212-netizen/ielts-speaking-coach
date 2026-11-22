# Grammar Content Audit — 2026-07-02
**Mục đích:** Đánh giá sâu toàn bộ nội dung Grammar Wiki đang chạy trên web (chất lượng, độ đầy đủ, chủ đề còn khuyết) và đánh giá mức sẵn sàng của hạ tầng để triển khai **bài tập check-up grammar trực tiếp**.

**Phạm vi:** 107 bài viết / 10 thư mục category (`backend/content/*`), taxonomy (`_groups.yaml`), mapping lỗi→anchor (`feedback-anchor-mapping.yaml`), và hạ tầng quiz (`services/quiz_import.py`, `routers/quiz.py`, `routers/admin_quiz.py`, `frontend/pages/quiz.html`, `frontend/js/quiz-engine.js`).

**Phương pháp:** 6 agent audit song song (5 cụm nội dung đọc toàn văn từng bài + 1 agent hạ tầng), sau đó kiểm chứng chéo các phát hiện then chốt bằng grep/đọc trực tiếp.

---

## 1. Kết luận nhanh (TL;DR)

- **Chất lượng nội dung: rất cao.** Đọc toàn văn 107 bài — **không phát hiện lỗi ngữ pháp/factual nào** ở cả 5 cụm. Giải thích rõ, ví dụ tự nhiên, bám sát lỗi của người học Việt, có band-relevance hợp lý.
- **Độ đầy đủ: mạnh ở Speaking/nền tảng, YẾU ở Writing.** `grammar-for-writing` chỉ có **3 bài** — lệch nghiêm trọng so với định hướng pivot "Writing first-class".
- **Hạ tầng bài tập: đã xây 100%, nhưng CHƯA có nội dung.** Hệ thống Quick-Check + Adaptive Mastery hỗ trợ sẵn grammar (mcq/gap/boolean/match, link `grammar_article_slug`, admin import). **Số bank grammar hiện tại = 0.** Đây là gap chính cần lấp.
- **2 vấn đề metadata cản trở "drill chính xác theo section":**
  1. **Chỉ 43/107 bài (~40%) có `anchors`** → chưa link được bài tập tới đúng mục của bài.
  2. **`common_error_tags` bị nhiễu** — 332 giá trị là slug bài viết/pathway, chỉ 96 là mã lỗi thật → không dùng làm taxonomy lỗi để auto-gen drill được.

**Verdict triển khai:** Có thể ship **MVP grammar check-up trong ~1 sprint** (dùng link cấp-bài, không cần chờ anchor), song song backfill anchor và bổ sung nội dung Writing.

---

## 2. Chất lượng nội dung — theo cụm

| Cụm | Số bài | Chất lượng | Lỗi factual | Ghi chú |
|-----|--------|-----------|-------------|---------|
| foundations + parts-of-speech + modifiers | 26 | 5/5 | 0 | Toàn diện, nhất quán; 3 bài thiên "khái niệm" (parts-of-speech, sentence-elements, pronouns) hợp bài tập kiểu scenario hơn fill-blank |
| tenses + verb-patterns | 17 | 5/5 | 0 | Xuất sắc; decision-tree ở future-forms/gerund-vs-infinitive/wish-hope rất tốt để làm drill |
| sentence-structures + grammar-for-meaning | 21 | 4–5/5 | 0 | conditionals/hedging/discourse-markers/complex-sentence nổi bật; reported-speech/so-vs-such/quantifiers ít bài tập |
| error-clinic | 17 | 5/5 | 0 | **Mỏ vàng bài tập:** ~120+ cặp wrong→right dùng lift trực tiếp; preposition-errors (50+ cặp), subject-verb-agreement (16), article-errors (10) |
| ielts-grammar-lab + grammar-for-writing | 26 | 4–5/5 | 0 | Speaking rất mạnh; **Writing chỉ 3 bài — mỏng** |

**Tổng: 0 lỗi factual trên 107 bài.** Nội dung đạt chuẩn phát hành. Chất lượng không phải vấn đề — vấn đề là **phủ Writing** và **hạ tầng bài tập chưa có nội dung**.

---

## 3. Độ đầy đủ & chủ đề còn khuyết

> ⚠️ **Đính chính lỗi "mù cụm":** Agent audit cụm foundations báo thiếu *comparatives, passive voice, conditionals, relative clauses, gerund-vs-infinitive* — **thực tế các bài này ĐÃ tồn tại** ở cụm khác (`grammar-for-meaning/comparison`, `sentence-structures/passive-voice`, `grammar-for-meaning/conditionals`, `sentence-structures/relative-clauses`, `verb-patterns/gerund-vs-infinitive`). Không cần viết mới. Danh sách khuyết dưới đây đã loại các false-positive này.

### 3a. Writing grammar — GAP LỚN NHẤT (ưu tiên theo pivot)
Hiện chỉ có: `grammar-in-task1`, `grammar-in-task2`, `task1-trend-grammar`. Cần bổ sung (10–14 bài):
- **Task 1:** mô tả số liệu tĩnh (bảng/pie không có trục thời gian); so sánh 2+ biểu đồ (whereas/in contrast); ngữ pháp mô tả bản đồ (was relocated to, shifted); định lượng số liệu (approximately/just over — đứng riêng).
- **Task 2:** signposting cohesion (The first reason is…/In conclusion…); dựng counter-argument (Critics would contend…); nominalisation (The reduction of…); phrasing khuyến nghị (It would be beneficial if…); tích hợp stance + evidence; chuyển đoạn (While this has merit, it overlooks…); cause–effect nâng cao (attributable to/stems from).
- **Chung:** embedding clause / expanded noun phrase (danh từ hoá + relative clause dày).

### 3b. Tenses / verb-patterns
- Future perfect (will have + V3), Future perfect continuous.
- Reporting verbs + patterns (told/said/claimed…) — quan trọng cho Writing Task 2.
- Participle clauses (Having studied…/Studying hard…) — dấu hiệu Band 7+.
- Mixed conditionals đứng riêng (hiện chỉ nhắc trong past-perfect/conditionals).

### 3c. Sentence-structures / grammar-for-meaning
- Nominalisation (đứng riêng); Participle clauses; Ellipsis & substitution (So do I / Neither did they — cần cho Speaking fluency); Expanded noun phrases; Parallelism.

### 3d. Error-clinic — loại lỗi chưa có bài (mở rộng "clinic")
Countable/uncountable errors (a lot of informations); comparative/superlative errors (more better); adverb placement (enjoy very much tennis); dangling modifiers; gerund/infinitive confusion (đứng riêng như 1 error pattern); "one of the + N số nhiều".

### 3e. Speaking functional (ielts-grammar-lab)
Repair language (Let me rephrase…); time-buying fillers (That's a tricky question…); tag questions & short answers; informal conjuncts (I mean / The thing is).

---

## 4. Hạ tầng bài tập — mức sẵn sàng

**Đã có (production-ready, không phải build lại):**
- **Format bank** `.md`: 1 META block (`kind: quiz`, `skill_area: grammar`, config Adaptive Mastery) + N block câu hỏi. Parser `services/quiz_import.py` commit all-or-nothing.
- **Loại câu hỏi:** `mcq, gap_mcq, gap_text, spelling, missing_letters, stress, syllable_count, boolean, match` → thừa cho grammar check-up (chọn đáp án, điền chỗ trống, đúng/sai, nối cặp).
- **Link bài viết:** field `grammar_article_slug` (validate lúc import — slug không tồn tại thì reject).
- **DB:** `quiz_banks` + `quiz_questions` (migrations 118–119), có sẵn cột `grammar_article_slug`, `skill_area`.
- **API admin:** import (dry-run preview), list, publish, delete, analytics — `routers/admin_quiz.py` (require_admin).
- **API student:** list/play/resume + vòng Adaptive Mastery — `routers/quiz.py`.
- **Player FE:** `frontend/pages/quiz.html` + `js/quiz-engine.js` (grade tức thời client-side).
- **Admin UI:** `frontend/pages/admin/vocab/quiz.html` nhận sẵn `?skill_area=grammar`.
- **Mẫu tham khảo:** `docs/research/sample_grammar_quiz_bank.md` (G-TENSES-01).

**Còn thiếu / cản trở:**
- ❌ **0 bank grammar** đã tạo (cần author nội dung).
- ❌ **Chưa surface trong UI học sinh** — không có link từ home/grammar wiki tới `/pages/quiz?skill_area=grammar` (route có, UX chưa).
- ❌ **Anchor coverage 43/107 (~40%)** — 64 bài thiếu `anchors` (toàn bộ verb-patterns, ~20/21 ielts-grammar-lab, 15/17 error-clinic). → bài tập chỉ link được **cấp bài**, chưa link được **cấp section**.
- ⚠️ **`common_error_tags` nhiễu** — 332 giá trị là slug/pathway, 96 là mã lỗi thật. Không dùng field này làm taxonomy lỗi để auto-gen drill; nguồn canonical error→article là `feedback-anchor-mapping.yaml`.
- ⚠️ **Mapping lỗi→anchor phủ 45/107 bài** (61 mapping). Đủ cho MVP nhưng cần mở rộng cho verb-patterns & error-clinic.
- 🟡 Chưa có e2e test cho luồng grammar quiz (mới có cho vocab).

---

## 5. Lộ trình đề xuất triển khai grammar check-up

**Phase 0 — MVP (ship ~1 sprint, KHÔNG chờ anchor):**
1. Chọn 5 bài "đòn bẩy cao": `articles`, `conditionals`, `present-perfect`, `subject-verb-agreement`, `preposition-errors` (đều đã sẵn cặp wrong→right / decision-tree).
2. Author 5 bank check-up (mỗi bank 8–12 câu, dùng `grammar_article_slug` cấp bài) — nguồn câu hỏi lift trực tiếp từ mục "Lỗi thường gặp" + "Bài tập luyện" của bài.
3. Thêm link từ student home + trong trang grammar-article ("Kiểm tra nhanh").
4. Backfill `anchors` cho đúng 5 bài này để bật feedback cấp section.

**Phase 1 — Backfill anchor + mở rộng bank:** backfill 64 bài thiếu anchor (ưu tiên verb-patterns → error-clinic → ielts-grammar-lab); tăng lên 15–20 bank.

**Phase 2 — Lấp nội dung Writing** (theo pivot): viết 10–14 bài grammar-for-writing (mục 3a) + tạo bank tương ứng.

**Phase 3 — Auto-gen từ lỗi thực tế:** dọn `common_error_tags` (tách mã-lỗi khỏi slug), mở rộng `feedback-anchor-mapping.yaml`, nối luồng grading → gợi ý drill theo lỗi user vừa mắc.

---

## 6. Việc dọn dẹp metadata nên làm trước khi scale
1. **Chuẩn hoá `common_error_tags`:** chỉ chứa mã lỗi (underscore). Chuyển slug/pathway sang `related_pages`/`pathways`. (test CI hiện chưa gác field này.)
2. **Backfill `anchors`** 64 bài — dùng convention section sẵn có (## Tóm tắt / ## Cấu trúc / ## Cách dùng / ## Lỗi thường gặp), 99% bài đã có mục "Bài tập luyện" nên map anchor thuận lợi.
3. **Mở rộng `feedback-anchor-mapping.yaml`** phủ verb-patterns & error-clinic còn trống.

---
*Báo cáo tạo bởi 6-agent parallel audit, đã kiểm chứng chéo. Không sửa nội dung bài viết trong lần audit này — chỉ đánh giá.*
