# Grammar Check-Up — Kế hoạch vận hành (điều chỉnh 2026-07-02)

> **Thay đổi thực tế:** nội dung bank đang được **agent sản xuất song song** (dùng `docs/grammar-quiz-banks/AGENT_PROMPT.md`). Vì vậy kế hoạch đảo trọng tâm: WS "soạn nội dung" chuyển thành **cổng QA + import**; phần còn lại (code/UX, metadata) làm NGAY song song để khi bank về là ráp end-to-end được.
> Nền tảng đã có (verify): quiz engine + `skill_area=grammar` + `grammar_article_slug` + grammar topics (mig 117–123). KIT + coverage matrix xem `docs/GRAMMAR_QUIZ_AUTHORING_GUIDE.md`, `docs/GRAMMAR_QUIZ_COVERAGE_MATRIX.md`.

---

## Bức tranh 3 track chạy song song

- **Track A — Nội dung** (agent khác + user): tạo ~106 bank theo prompt. *Không phải việc của mình; mình chỉ cấp KIT + QA.*
- **Track B — Hạ tầng/UX + metadata** (mình làm NGAY): code để bài tập đi được end-to-end + dọn metadata mở khoá feedback cấp-section.
- **Track C — Cổng QA + import + go-live** (mình làm khi bank về): duyệt chất lượng hàng loạt, import, bật cho học viên.

---

## BƯỚC 0 — Tiền đề (làm trước tất cả)
- [x] **Verify migrations 117–123 + 120** — ✅ đã áp trên project `nqhrtqspznepmveyurzm` (mà `.env` trỏ tới): tất cả bảng `quiz_*` tồn tại; 10 grammar topics đủ; 0 grammar bank (đúng). ⚠️ Nếu prod là project Supabase KHÁC → verify lại trên project đó.
- [x] `content_topics` có đủ 10 grammar topic (mig 120). *Còn lại: lấy `id` từng topic cho bulk import (B2).*

---

## TRACK B — Việc mình làm NGAY (song song lúc agent tạo content)

### B1. Cổng QA harness (ưu tiên cao — cần sẵn TRƯỚC khi bank về) ✅ XONG
- [x] **Batch validator** `backend/scripts/validate_grammar_quiz_bank.py` — per-file, structural + mastery.
- [x] **QA harness gộp** `backend/scripts/qa_grammar_banks.py` — quét cả thư mục, 3 lớp: (1) cấu trúc+mastery, (2) **dedup chéo bank** (prompt chuẩn hoá), (3) **coverage vs 107 bank** (thiếu bao nhiêu/category) + cảnh báo bank có mã lỗi nhưng <2 câu error_id. Exit 0 nếu không lỗi chặn. Chạy: `cd backend && python scripts/qa_grammar_banks.py`.
- Đã test trên bài mẫu: PASS; báo đúng 1/107, thiếu 106 theo category.

### B2. Bulk import ✅ XONG (script)
- [x] `backend/scripts/import_grammar_banks.py` — đọc `docs/grammar-quiz-banks/G-*.md` → suy category từ code → map `topic_id` (grammar topic) → `import_quiz_file`. **Mặc định dry-run**; `--commit` để ghi; `--only <substr>` lọc; cổng QA (check_file) STRICT trước commit; all-or-nothing từng bank; batch_id theo timestamp.
- Test dry-run: 5 bank tenses → topic=tenses, 125 câu/21 item_key, QA sạch, sẵn sàng commit.
- [ ] (tuỳ chọn) Extend admin `POST /admin/quiz/import` để nhận nhiều file (không bắt buộc — script đã đủ).

### B3. Admin authoring UX ✅ ĐÃ CÓ SẴN (phát hiện khi khảo sát)
- [x] Admin nav Grammar đã có mục **"Bài tập (Exercises)"** → `admin/vocab/topics.html?skill_area=grammar` (`aver-admin-chrome.js` NAV_GROUPS).
- [x] `topics.html` xử lý `?skill_area=grammar`: list grammar topic + nút **"+ Import bank"** → `quiz.html?topic=<id>&skill_area=grammar`.
- [x] `admin/vocab/quiz.html` generic theo `skill_area`: dropdown topic + list bank + import dry-run/commit đều lọc grammar. **Không cần code mới.**
- Ghi chú: dùng script `import_grammar_banks.py` cho nạp hàng loạt; admin UI cho quản lý/publish từng bank.

### B4. Student-facing UX (đường đi chính) ✅ XONG (chờ bank để hiện)
- [x] **Backend public endpoints** (`routers/grammar.py`): `GET /api/grammar/article/{cat}/{slug}/exercise` (có bank cho bài này không → bank_id) + `GET /api/grammar/exercises` (list bank grammar đã publish). Public, không cache, không lộ đáp án.
- [x] **Nút "Kiểm tra nhanh"** trong `grammar-article.html` + `grammar.js` (`_initExerciseCTA`): chỉ hiện khi có bank publish `G-<category>-<slug>` → link `/pages/quiz.html?bank=<id>` (player đã có chrome grammar sẵn).
- [x] **Trang list** `frontend/pages/grammar-exercises.html` (nhóm theo category) + entry "Bài tập Grammar" ở hero `grammar.html`. Tái dùng player, không sửa engine.
- Đã verify: routes đăng ký, negative path đúng (chưa bank → available:false / list rỗng), 277 frontend theme-test + 148 backend grammar/quiz-test PASS. **Positive path (nút hiện + list có bài) sẽ thấy sau khi import bank qua QA.**

### B5. Metadata cleanup (mở khoá feedback cấp-section — không chặn import bank)
- [x] **KIT anchor-backfill sẵn sàng để fan-out cho agent:** `docs/ANCHOR_BACKFILL_GUIDE.md` (hợp đồng 2-phần: body marker + frontmatter, drift rules), `docs/ANCHOR_BACKFILL_LIST.md` (63 bài checklist + note điều phối), `docs/ANCHOR_BACKFILL_AGENT_PROMPT.md` (prompt fan-out), + **gold example đã làm** `backend/content/tenses/past-perfect.md` (7 anchor, PASS `verify_anchor_drift.py` strict + 47 anchor-test).
- Khung giá trị (trung thực): mapping HIỆN đã resolve đủ (0 deferred) → backfill KHÔNG unblock feedback đang chạy; nó bật deep-link TOC + cho phép mapping cấp-section TƯƠNG LAI.
- ⚠️ Gate điều phối: `test_grammar_loader_anchors.py` cần ≥1 bài KHÔNG anchor → chừa lại ≥1 (đề xuất cụm grammar-for-writing) hoặc sửa test khi làm nốt.
- [ ] **Tách `common_error_tags`**: ĐÃ HẠ ƯU TIÊN — verify cho thấy `get_articles_by_error_tag` **không có caller** (field hiện không consumer nào đọc, không test pin). Chỉ làm khi nối feedback→drill theo mã lỗi.
- [ ] **Mở rộng `feedback-anchor-mapping.yaml`** phủ verb-patterns & error-clinic (làm kèm khi backfill anchor + thêm mapping mới).

### B6. Testing (DoD)
- [x] **CI gate** `backend/tests/test_grammar_quiz_banks.py` — parametrize mọi `docs/grammar-quiz-banks/G-*.md`, chạy `check_file` (cấu trúc + mastery + slug resolve + explain/subtype). Bank hỏng → CI đỏ. Hiện 8 bank tenses PASS. Đây cũng phủ luôn "ref-drift" slug (mọi `grammar_article_slug` phải trỏ article sống).
- [x] Existing `test_quiz_import.py` + `test_quiz_service.py` vẫn xanh; full suite **3159 passed / 24 skipped** sau thay đổi.
- [ ] (tuỳ chọn) `node --test` bổ sung cho quiz-engine với fixture bank grammar (engine chưa đổi nên hiện đủ).

---

## TRACK C — Cổng QA khi bank về (đây là chỗ "bạn check lại sau")

> Rủi ro lớn nhất của sản xuất hàng loạt = **đáp án sai / tiếng Anh không tự nhiên / trùng lặp**. Duyệt 4 lớp:

1. **Lớp 1 — Tự động (rẻ, chạy trước):** batch validator + dedup + coverage (B1). Bank FAIL → trả agent sửa, không import.
2. **Lớp 2 — Đúng đáp án (quan trọng nhất):** với mỗi bank PASS lớp 1, spawn **agent phản biện** giải lại độc lập từng câu, cờ những câu bất đồng với `answer`/`accept`. Mình/agent review chỉ tập trung vào các câu bị cờ → sửa. (Không đọc tay 3.000 câu; để adversarial agent lọc.)
3. **Lớp 3 — Bám bài Wiki:** kiểm mẫu `explain` không mâu thuẫn bài; `grammar_article_slug` đúng bài.
4. **Lớp 4 — Import + smoke test:** import bank đã duyệt; chơi thử 1–2 bank end-to-end (mastery loop không kẹt, "Kiểm tra nhanh" mở đúng bank).

Chỉ **publish** bank qua đủ 4 lớp. Tick `GRAMMAR_QUIZ_COVERAGE_MATRIX.md`.

---

## TRACK D (sau MVP) — Vòng feedback → drill
- [ ] Sau grading Speaking/Writing: từ lỗi (`grammar_recommendations` + mapping) → trỏ tới **bank drill** tương ứng (qua `grammar_article_slug`). Nút "Luyện lỗi này" ở result page.
- [ ] Cần ≥10–15 bank đã publish mới bật.

---

## Trình tự PR (cập nhật)
| PR | Track | Nội dung | Phụ thuộc |
|----|-------|----------|-----------|
| PR-1 | B0+B1 | Verify migrations; QA harness (batch validate + dedup + coverage) | — |
| PR-2 | B2+B3 | Bulk import + admin grammar quiz tab | PR-1 |
| PR-3 | B4 | Student "Kiểm tra nhanh" + trang exercise list | PR-2 |
| PR-4 | B5 | Dọn common_error_tags + backfill anchors (đợt 1) + CI guard | song song |
| PR-5 | B6 | Test import + ref-drift + engine | theo PR-2/3 |
| PR-6 | D | Feedback→drill ở result page | ≥10 bank publish |

**Mốc MVP:** PR-1→PR-3 xong + lô bank đầu qua QA ⇒ học sinh có check-up sau bài + trang exercise, admin tự thêm bank. ~1 sprint.

---

## Rủi ro (cập nhật cho sản xuất hàng loạt)
- **Đáp án sai hàng loạt** → cổng QA lớp 2 (adversarial) là bắt buộc, không bỏ.
- **Trùng câu giữa bank** → dedup lớp 1.
- **Mastery kẹt** (item_key thiếu production) → validator đã chặn tại nguồn (agent phải PASS mới nộp).
- **Migration chưa áp prod** → BƯỚC 0.
- **Không sửa file bài Wiki** khi thêm bank (giữ CI ref-drift xanh).
